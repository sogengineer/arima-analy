/**
 * バックテストコマンド
 *
 * @remarks
 * 過去レースで予測精度を検証する。
 *
 * ## リーク遮断
 * 各レースのスコアは `asOf = そのレースの race_date` で計算するため、
 * 検証対象レース当日以降の結果は特徴量に入らない。
 *
 * ## 評価対象
 * 1. ルールベース10要素（従来）
 * 2. 市場ベースライン（控除率補正済み暗黙確率）
 * 3. ML（`--ml` 指定時、walk-forward 検証 + 採用ゲート判定）
 *
 * ## 市場ベースラインの算出元
 * JRAの過去レース結果ページには全馬の事前単勝オッズが無い。
 * そのため暗黙確率は
 * **全馬にオッズが揃っているレースではオッズから**、
 * **揃っていないレースでは人気順位から**（人気別勝率テーブルの単調変換）算出する。
 * どちらを使ったかはサマリーに件数で表示する。
 *
 * ## 回収率
 * **実際のオッズ**（final_win_odds ?? win_odds）で算出する。固定オッズ（単勝5倍等）の仮定は廃止した。
 * 対象は **全出走馬に事前オッズが揃っているレースのみ**。
 * 結果ページから復元できる確定オッズは1着馬ぶんしか無いため、
 * 「賭けた馬にオッズがあるレース」を対象にすると的中レースだけを賭けたことになり、
 * 回収率が平均配当に化ける。揃うレースが0件なら **算出不能** と表示する。
 */

import { DatabaseConnection } from '../database/DatabaseConnection';
import { ScoringOrchestrator } from '../domain/services/ScoringOrchestrator';
import { RaceQueryRepository } from '../repositories/queries/RaceQueryRepository';
import { raceMarketProbabilities } from '../features/MarketProbability';
import { MachineLearningModel } from '../models/MachineLearningModel';
import * as ss from 'simple-statistics';
import { calculateSummary } from './backtest/summary';
import { displayRaceResult, displaySummary, suggestWeightImprovements } from './backtest/display';
import type {
  ActualResult,
  BacktestOptions,
  BacktestResult,
  PredictionResult,
  RaceMetrics
} from './backtest/types';

export type { MarketBaselineSummary } from './backtest/types';

export class Backtest {
  private readonly connection: DatabaseConnection | null;
  private readonly orchestrator: ScoringOrchestrator;
  private readonly raceRepo: RaceQueryRepository;
  private readonly db: ReturnType<DatabaseConnection['getConnection']>;
  private readonly ownsConnection: boolean;
  /** evaluateRace が失敗したレース数（サマリーに出す） */
  private failedRaces = 0;
  /** 最初に起きた例外のメッセージ */
  private firstError: string | null = null;

  constructor(externalDb?: ReturnType<DatabaseConnection['getConnection']>) {
    if (externalDb) {
      this.connection = null;
      this.db = externalDb;
      this.orchestrator = new ScoringOrchestrator(externalDb);
      this.raceRepo = new RaceQueryRepository(externalDb);
      this.ownsConnection = false;
    } else {
      this.connection = new DatabaseConnection();
      const db = this.connection.getConnection();
      this.db = db;
      this.orchestrator = new ScoringOrchestrator(db);
      this.raceRepo = new RaceQueryRepository(db);
      this.ownsConnection = true;
    }
  }

  /**
   * インポート後に自動実行される簡易バックテスト
   * @returns サマリー情報（UIに表示用）
   */
  runQuickSummary(): { totalRaces: number; top1Accuracy: number; top3Accuracy: number; avgCorrelation: number } | null {
    try {
      const races = this.raceRepo.getRacesWithResults(true); // 重賞のみ
      const targetRaces = races.slice(0, 10); // 最新10レース

      if (targetRaces.length === 0) {
        return null;
      }

      const results: BacktestResult[] = [];
      for (const race of targetRaces) {
        const result = this.evaluateRace(race.id, race.race_name, race.race_date, race.venue_name);
        if (result) {
          results.push(result);
        }
      }

      if (results.length === 0) {
        return null;
      }

      const top1Hits = results.filter(r => r.metrics.top1Hit).length;
      let top3HitsTotal = 0;
      for (const r of results) {
        top3HitsTotal += r.metrics.top3Hit;
      }
      const correlations = results.map(r => r.metrics.rankCorrelation).filter(c => !Number.isNaN(c));

      return {
        totalRaces: results.length,
        top1Accuracy: results.length > 0 ? top1Hits / results.length : 0,
        top3Accuracy: results.length > 0 ? top3HitsTotal / (results.length * 3) : 0,
        avgCorrelation: correlations.length > 0 ? ss.mean(correlations) : 0
      };
    } catch (error) {
      console.warn(
        `⚠️  簡易バックテストをスキップしました: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * 接続をクローズ
   */
  close(): void {
    if (this.ownsConnection && this.connection) {
      this.connection.close();
    }
  }

  async execute(options: BacktestOptions = {}): Promise<void> {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 バックテスト - スコアリング精度検証');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // 過去レースを取得（結果があるもの）
      const races = this.raceRepo.getRacesWithResults(options.gradeOnly ?? true);
      const targetRaces = options.limit ? races.slice(0, options.limit) : races;

      if (targetRaces.length === 0) {
        console.log('⚠️  バックテスト対象のレースがありません');
        console.log('   結果が登録されている過去レースが必要です');
        return;
      }

      console.log(`🏁 対象レース: ${targetRaces.length}件\n`);

      const results: BacktestResult[] = [];
      this.failedRaces = 0;
      this.firstError = null;

      for (const race of targetRaces) {
        const result = this.evaluateRace(race.id, race.race_name, race.race_date, race.venue_name);
        if (result) {
          results.push(result);
          if (options.verbose) {
            displayRaceResult(result);
          }
        }
      }

      if (this.failedRaces > 0) {
        console.log(
          `⚠️  ${this.failedRaces}件のレースで評価に失敗しました（最初の理由: ${this.firstError}）\n`
        );
      }

      if (results.length === 0) {
        console.log('⚠️  評価できたレースがありません');
        return;
      }

      // サマリー計算・表示
      const summary = calculateSummary(results);
      displaySummary(summary);

      // 重み改善提案
      suggestWeightImprovements(results);

      // ML の walk-forward 検証と採用ゲート
      if (options.ml) {
        this.runMlAdoptionGate(options.blocks ?? 5);
      }

    } catch (error) {
      console.error('❌ バックテストに失敗:', error);
    } finally {
      this.close();
    }
  }

  /**
   * ML の walk-forward 検証を実行し、採用ゲートを判定して表示する
   *
   * @remarks
   * 採用条件:
   * 1. 勝ち馬 log loss が「市場特徴量のみモデル」を下回る
   * 2. top-1 が市場のみモデル以上、または Brier が市場のみモデル以下
   *
   * 満たさない場合、`race-list` などの表示では **ルールベースを主** とし、
   * ML確率は参考値として併記する（フォールバック方針）。
   */
  runMlAdoptionGate(blocks = 5): void {
    const ml = new MachineLearningModel(this.db);
    try {
      const result = ml.walkForwardValidate({ blocks });
      ml.displayWalkForward(result);

      if (result.insufficientReason) {
        console.log('\n  → データが揃うまでは race-list の表示はルールベースを主とすること');
      }
    } finally {
      ml.close();
    }
  }

  private evaluateRace(
    raceId: number,
    raceName: string,
    raceDate: string,
    venue: string
  ): BacktestResult | null {
    try {
      // スコア計算（as-of = そのレースの開催日。当日以降の結果は使わない）
      const scoreResults = this.orchestrator.calculateScoresForRace(raceId, raceDate);
      if (scoreResults.length === 0) return null;

      // 市場データ（事前オッズ・人気）と払戻用の確定オッズ
      // 全馬にオッズが揃っているレースのみオッズを使い、それ以外は人気順位から算出する
      const market = this.getMarketData(raceId);
      const impliedByHorse = new Map<number, number>();
      const marketProbs = raceMarketProbabilities(
        market.map(m => m.win_odds ?? null),
        market.map(m => m.popularity ?? null)
      );
      for (let i = 0; i < market.length; i++) {
        impliedByHorse.set(market[i].horse_id, marketProbs.probabilities[i]);
      }

      // 予測順位
      const predictions: PredictionResult[] = scoreResults
        .map(r => {
          const plain = r.scores.toPlainObject();
          const entry = market.find(m => m.horse_id === r.horseId);
          return {
            horseId: r.horseId,
            horseName: r.horseName,
            predictedRank: 0,
            totalScore: plain.totalScore,
            marketImpliedProb: impliedByHorse.get(r.horseId) ?? 0,
            payoutWinOdds: entry?.final_win_odds ?? entry?.win_odds ?? null,
            components: {
              recentPerformance: plain.recentPerformanceScore,
              venueAptitude: plain.venueAptitudeScore,
              distanceAptitude: plain.distanceAptitudeScore,
              last3FAbility: plain.last3FAbilityScore,
              g1Achievement: plain.g1AchievementScore,
              rotationAptitude: plain.rotationAptitudeScore,
              jockey: plain.jockeyScore,
              trackCondition: plain.trackConditionScore,
              postPosition: plain.postPositionScore,
              trainer: plain.trainerScore
            }
          };
        })
        .sort((a, b) => b.totalScore - a.totalScore)
        .map((p, i) => ({ ...p, predictedRank: i + 1 }));

      // 実際の結果を取得
      const actualResults = this.raceRepo.getRaceResults(raceId);
      const actuals: ActualResult[] = [];
      for (const r of actualResults) {
        if (r.finish_position == null) continue;
        actuals.push({
          horseId: r.horse_id,
          horseName: r.horse_name,
          actualPosition: r.finish_position
        });
      }

      if (actuals.length === 0) return null;

      // メトリクス計算
      const metrics = this.calculateMetrics(predictions, actuals);

      return {
        raceId, raceName, raceDate, venue, predictions, actuals, metrics,
        marketProbSource: marketProbs.source
      };
    } catch (error) {
      // 1レースの失敗で全体を落とさないが、黙って捨てない（件数と最初の理由を残す）
      this.failedRaces++;
      this.firstError ??= error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  private calculateMetrics(
    predictions: PredictionResult[],
    actuals: ActualResult[]
  ): RaceMetrics {
    // 1位的中
    const topPrediction = predictions[0];
    const topActual = actuals.find(a => a.actualPosition === 1);
    const top1Hit = topPrediction?.horseId === topActual?.horseId;

    // 上位3頭が3着内
    const top3Predicted = predictions.slice(0, 3).map(p => p.horseId);
    const top3Actual = actuals.filter(a => a.actualPosition <= 3).map(a => a.horseId);
    const top3Hit = top3Predicted.filter(id => top3Actual.includes(id)).length;

    // 上位5頭が5着内
    const top5Predicted = predictions.slice(0, 5).map(p => p.horseId);
    const top5Actual = actuals.filter(a => a.actualPosition <= 5).map(a => a.horseId);
    const top5Hit = top5Predicted.filter(id => top5Actual.includes(id)).length;

    // 順位相関（スピアマン）
    const rankCorrelation = this.calculateSpearmanCorrelation(predictions, actuals);

    return { top1Hit, top3Hit, top5Hit, rankCorrelation };
  }

  private calculateSpearmanCorrelation(
    predictions: PredictionResult[],
    actuals: ActualResult[]
  ): number {
    const pairs: { predicted: number; actual: number }[] = [];

    for (const pred of predictions) {
      const actual = actuals.find(a => a.horseId === pred.horseId);
      if (actual) {
        pairs.push({
          predicted: pred.predictedRank,
          actual: actual.actualPosition
        });
      }
    }

    if (pairs.length < 3) return 0;

    try {
      const predictedRanks = pairs.map(p => p.predicted);
      const actualRanks = pairs.map(p => p.actual);
      return ss.sampleCorrelation(predictedRanks, actualRanks);
    } catch {
      return 0;
    }
  }

  /**
   * 市場データ（事前オッズ・人気順位・確定オッズ）を取得
   *
   * @remarks
   * `win_odds` は結果ページからは取れないため大半のレースで NULL になる。
   * 暗黙確率の算出では全馬に揃っている場合のみ使い、
   * それ以外は全馬ぶん取得できる `popularity` を使う。
   */
  private getMarketData(raceId: number): {
    horse_id: number;
    win_odds: number | null;
    popularity: number | null;
    final_win_odds: number | null;
  }[] {
    return this.db.prepare(`
      SELECT e.horse_id, e.win_odds, e.popularity, rr.final_win_odds
      FROM race_entries e
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.race_id = ?
      ORDER BY e.horse_number
    `).all(raceId) as {
      horse_id: number;
      win_odds: number | null;
      popularity: number | null;
      final_win_odds: number | null;
    }[];
  }
}
