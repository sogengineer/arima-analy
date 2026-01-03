/**
 * バックテストコマンド
 *
 * @remarks
 * 過去レースでスコアリングシステムの予測精度を検証。
 * 専門家会議で推奨された検証手法を実装。
 *
 * 評価指標:
 * - 的中率: スコア上位N頭が実際に上位N着に入った割合
 * - 回収率: 仮想馬券購入時のリターン
 * - 要素別寄与度: 各スコア要素の予測への貢献度
 */

import { DatabaseConnection } from '../database/DatabaseConnection';
import { ScoringOrchestrator } from '../domain/services/ScoringOrchestrator';
import { RaceQueryRepository } from '../repositories/queries/RaceQueryRepository';
import { SCORE_WEIGHTS } from '../constants/ScoringConstants';
import * as ss from 'simple-statistics';

interface BacktestResult {
  raceId: number;
  raceName: string;
  raceDate: string;
  venue: string;
  predictions: PredictionResult[];
  actuals: ActualResult[];
  metrics: RaceMetrics;
}

interface PredictionResult {
  horseId: number;
  horseName: string;
  predictedRank: number;
  totalScore: number;
  components: Record<string, number>;
}

interface ActualResult {
  horseId: number;
  horseName: string;
  actualPosition: number;
}

interface RaceMetrics {
  top1Hit: boolean;      // 1位的中
  top3Hit: number;       // 上位3頭中何頭が3着内
  top5Hit: number;       // 上位5頭中何頭が5着内
  rankCorrelation: number; // 順位相関
}

interface BacktestSummary {
  totalRaces: number;
  top1Accuracy: number;    // 1位的中率
  top3Accuracy: number;    // 上位3頭の3着内率
  top5Accuracy: number;    // 上位5頭の5着内率
  avgRankCorrelation: number; // 平均順位相関
  elementContribution: { name: string; correlation: number }[];
  simulatedROI: SimulatedROI;
}

interface SimulatedROI {
  winBet: { bets: number; hits: number; roi: number };
  showBet: { bets: number; hits: number; roi: number };
  trioBox: { bets: number; hits: number; roi: number };
}

interface BacktestOptions {
  limit?: number;
  gradeOnly?: boolean;
  verbose?: boolean;
  /** 外部からDB接続を渡す場合（接続をcloseしない） */
  externalConnection?: boolean;
}

export class Backtest {
  private readonly connection: DatabaseConnection;
  private readonly orchestrator: ScoringOrchestrator;
  private readonly raceRepo: RaceQueryRepository;
  private readonly ownsConnection: boolean;

  constructor(externalDb?: ReturnType<DatabaseConnection['getConnection']>) {
    if (externalDb) {
      this.connection = null as unknown as DatabaseConnection;
      this.orchestrator = new ScoringOrchestrator(externalDb);
      this.raceRepo = new RaceQueryRepository(externalDb);
      this.ownsConnection = false;
    } else {
      this.connection = new DatabaseConnection();
      const db = this.connection.getConnection();
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
      const top3HitsTotal = results.reduce((sum, r) => sum + r.metrics.top3Hit, 0);
      const correlations = results.map(r => r.metrics.rankCorrelation).filter(c => !isNaN(c));

      return {
        totalRaces: results.length,
        top1Accuracy: results.length > 0 ? top1Hits / results.length : 0,
        top3Accuracy: results.length > 0 ? top3HitsTotal / (results.length * 3) : 0,
        avgCorrelation: correlations.length > 0 ? ss.mean(correlations) : 0
      };
    } catch {
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

      for (const race of targetRaces) {
        const result = this.evaluateRace(race.id, race.race_name, race.race_date, race.venue_name);
        if (result) {
          results.push(result);
          if (options.verbose) {
            this.displayRaceResult(result);
          }
        }
      }

      // サマリー計算・表示
      const summary = this.calculateSummary(results);
      this.displaySummary(summary);

      // 重み改善提案
      this.suggestWeightImprovements(results);

    } catch (error) {
      console.error('❌ バックテストに失敗:', error);
    } finally {
      this.close();
    }
  }

  private evaluateRace(
    raceId: number,
    raceName: string,
    raceDate: string,
    venue: string
  ): BacktestResult | null {
    try {
      // スコア計算
      const scoreResults = this.orchestrator.calculateScoresForRace(raceId);
      if (scoreResults.length === 0) return null;

      // 予測順位
      const predictions: PredictionResult[] = scoreResults
        .map(r => {
          const plain = r.scores.toPlainObject();
          return {
            horseId: r.horseId,
            horseName: r.horseName,
            predictedRank: 0,
            totalScore: plain.totalScore,
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
      const actuals: ActualResult[] = actualResults
        .filter(r => r.finish_position != null)
        .map(r => ({
          horseId: r.horse_id,
          horseName: r.horse_name,
          actualPosition: r.finish_position!
        }));

      if (actuals.length === 0) return null;

      // メトリクス計算
      const metrics = this.calculateMetrics(predictions, actuals);

      return { raceId, raceName, raceDate, venue, predictions, actuals, metrics };
    } catch {
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

  private calculateSummary(results: BacktestResult[]): BacktestSummary {
    const totalRaces = results.length;

    // 的中率計算
    const top1Hits = results.filter(r => r.metrics.top1Hit).length;
    const top3HitsTotal = results.reduce((sum, r) => sum + r.metrics.top3Hit, 0);
    const top5HitsTotal = results.reduce((sum, r) => sum + r.metrics.top5Hit, 0);

    const top1Accuracy = totalRaces > 0 ? top1Hits / totalRaces : 0;
    const top3Accuracy = totalRaces > 0 ? top3HitsTotal / (totalRaces * 3) : 0;
    const top5Accuracy = totalRaces > 0 ? top5HitsTotal / (totalRaces * 5) : 0;

    // 平均順位相関
    const correlations = results.map(r => r.metrics.rankCorrelation).filter(c => !isNaN(c));
    const avgRankCorrelation = correlations.length > 0 ? ss.mean(correlations) : 0;

    // 要素別寄与度
    const elementContribution = this.calculateElementContribution(results);

    // ROIシミュレーション
    const simulatedROI = this.simulateROI(results);

    return {
      totalRaces,
      top1Accuracy,
      top3Accuracy,
      top5Accuracy,
      avgRankCorrelation,
      elementContribution,
      simulatedROI
    };
  }

  private calculateElementContribution(
    results: BacktestResult[]
  ): { name: string; correlation: number }[] {
    const elementNames = [
      { key: 'recentPerformance', name: '直近成績' },
      { key: 'venueAptitude', name: 'コース適性' },
      { key: 'distanceAptitude', name: '距離適性' },
      { key: 'last3FAbility', name: '上がり3F' },
      { key: 'g1Achievement', name: 'G1実績' },
      { key: 'rotationAptitude', name: 'ローテ適性' },
      { key: 'jockey', name: '騎手能力' },
      { key: 'trackCondition', name: '馬場適性' },
      { key: 'postPosition', name: '枠順効果' },
      { key: 'trainer', name: '調教師' }
    ];

    const contributions: { name: string; correlation: number }[] = [];

    for (const { key, name } of elementNames) {
      const scores: number[] = [];
      const positions: number[] = [];

      for (const result of results) {
        for (const pred of result.predictions) {
          const actual = result.actuals.find(a => a.horseId === pred.horseId);
          if (actual) {
            scores.push(pred.components[key] || 0);
            positions.push(actual.actualPosition);
          }
        }
      }

      if (scores.length > 10) {
        try {
          // 高スコア = 良い順位（小さい値）なので、負の相関が良い
          const corr = -ss.sampleCorrelation(scores, positions);
          contributions.push({ name, correlation: isNaN(corr) ? 0 : corr });
        } catch {
          contributions.push({ name, correlation: 0 });
        }
      } else {
        contributions.push({ name, correlation: 0 });
      }
    }

    return contributions.sort((a, b) => b.correlation - a.correlation);
  }

  private simulateROI(results: BacktestResult[]): SimulatedROI {
    let winBets = 0, winHits = 0;
    let showBets = 0, showHits = 0;
    let trioBets = 0, trioHits = 0;

    for (const result of results) {
      if (result.predictions.length < 3 || result.actuals.length < 3) continue;

      // 単勝: スコア1位に100円
      winBets++;
      const top1 = result.predictions[0];
      const actual1 = result.actuals.find(a => a.horseId === top1.horseId);
      if (actual1?.actualPosition === 1) winHits++;

      // 複勝: スコア1位に100円
      showBets++;
      if (actual1 && actual1.actualPosition <= 3) showHits++;

      // 3連複BOX: スコア上位3頭
      trioBets++;
      const top3Ids = result.predictions.slice(0, 3).map(p => p.horseId);
      const actual3 = result.actuals.filter(a => a.actualPosition <= 3).map(a => a.horseId);
      const allIn = top3Ids.every(id => actual3.includes(id));
      if (allIn) trioHits++;
    }

    // 仮想オッズで回収率計算（実際のオッズがないので固定値）
    const avgWinOdds = 5.0;   // 単勝平均5倍
    const avgShowOdds = 1.8;  // 複勝平均1.8倍
    const avgTrioOdds = 15.0; // 3連複平均15倍

    return {
      winBet: {
        bets: winBets,
        hits: winHits,
        roi: winBets > 0 ? (winHits * avgWinOdds * 100) / (winBets * 100) : 0
      },
      showBet: {
        bets: showBets,
        hits: showHits,
        roi: showBets > 0 ? (showHits * avgShowOdds * 100) / (showBets * 100) : 0
      },
      trioBox: {
        bets: trioBets,
        hits: trioHits,
        roi: trioBets > 0 ? (trioHits * avgTrioOdds * 100) / (trioBets * 100) : 0
      }
    };
  }

  private displayRaceResult(result: BacktestResult): void {
    console.log(`\n📍 ${result.raceName} (${result.raceDate} ${result.venue})`);
    console.log(`   1位的中: ${result.metrics.top1Hit ? '✅' : '❌'}`);
    console.log(`   上位3頭→3着内: ${result.metrics.top3Hit}/3`);
    console.log(`   順位相関: ${result.metrics.rankCorrelation.toFixed(2)}`);
  }

  private displaySummary(summary: BacktestSummary): void {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 バックテスト結果サマリー');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`【対象レース数】${summary.totalRaces}件\n`);

    console.log('【的中率】');
    console.log(`  1位的中率:     ${(summary.top1Accuracy * 100).toFixed(1)}%`);
    console.log(`  上位3頭精度:   ${(summary.top3Accuracy * 100).toFixed(1)}%`);
    console.log(`  上位5頭精度:   ${(summary.top5Accuracy * 100).toFixed(1)}%`);
    console.log(`  平均順位相関:  ${summary.avgRankCorrelation.toFixed(3)}\n`);

    console.log('【仮想回収率】（オッズ仮定: 単勝5倍/複勝1.8倍/3連複15倍）');
    const win = summary.simulatedROI.winBet;
    const show = summary.simulatedROI.showBet;
    const trio = summary.simulatedROI.trioBox;
    console.log(`  単勝:   ${win.hits}/${win.bets}的中 → 回収率 ${(win.roi * 100).toFixed(0)}%`);
    console.log(`  複勝:   ${show.hits}/${show.bets}的中 → 回収率 ${(show.roi * 100).toFixed(0)}%`);
    console.log(`  3連複:  ${trio.hits}/${trio.bets}的中 → 回収率 ${(trio.roi * 100).toFixed(0)}%\n`);

    console.log('【要素別予測寄与度】（正の相関 = 予測に有効）');
    summary.elementContribution.forEach((c, i) => {
      const bar = this.createCorrelationBar(c.correlation);
      const corr = c.correlation >= 0 ? '+' : '';
      console.log(`  ${(i + 1).toString().padStart(2)}. ${c.name.padEnd(10)} ${bar} ${corr}${(c.correlation * 100).toFixed(1)}%`);
    });
  }

  private createCorrelationBar(correlation: number): string {
    const maxLen = 15;
    const len = Math.round(Math.abs(correlation) * maxLen);
    if (correlation >= 0) {
      return '░'.repeat(maxLen) + '|' + '█'.repeat(len) + '░'.repeat(maxLen - len);
    } else {
      return '░'.repeat(maxLen - len) + '█'.repeat(len) + '|' + '░'.repeat(maxLen);
    }
  }

  private suggestWeightImprovements(results: BacktestResult[]): void {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💡 重み改善提案');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const contributions = this.calculateElementContribution(results);

    // 現在の重み
    const currentWeights = [
      { name: '直近成績', weight: SCORE_WEIGHTS.recentPerformance },
      { name: 'コース適性', weight: SCORE_WEIGHTS.venueAptitude },
      { name: '距離適性', weight: SCORE_WEIGHTS.distanceAptitude },
      { name: '上がり3F', weight: SCORE_WEIGHTS.last3FAbility },
      { name: 'G1実績', weight: SCORE_WEIGHTS.g1Achievement },
      { name: 'ローテ適性', weight: SCORE_WEIGHTS.rotationAptitude },
      { name: '騎手能力', weight: SCORE_WEIGHTS.jockey },
      { name: '馬場適性', weight: SCORE_WEIGHTS.trackCondition },
      { name: '枠順効果', weight: SCORE_WEIGHTS.postPosition },
      { name: '調教師', weight: SCORE_WEIGHTS.trainer }
    ];

    console.log('要素          現在重み  寄与度   提案');
    console.log('-'.repeat(50));

    for (const cw of currentWeights) {
      const contribution = contributions.find(c => c.name === cw.name);
      const corr = contribution?.correlation ?? 0;
      const currentPct = (cw.weight * 100).toFixed(0).padStart(3);
      const corrPct = (corr * 100).toFixed(1).padStart(6);

      let suggestion = '';
      if (corr > 0.15 && cw.weight < 0.20) {
        suggestion = '↑ 増加推奨';
      } else if (corr < 0.05 && cw.weight > 0.08) {
        suggestion = '↓ 減少検討';
      } else {
        suggestion = '  適正';
      }

      console.log(`${cw.name.padEnd(10)} ${currentPct}%   ${corrPct}%  ${suggestion}`);
    }

    console.log('\n※ Phase3で自動最適化を実行できます');
  }
}
