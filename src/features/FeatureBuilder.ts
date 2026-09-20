/**
 * ML 特徴量ビルダー
 *
 * @remarks
 * レース単位で、出走各馬の特徴量を「as-of（レース開催日より前のデータのみ）」で組み立てる。
 *
 * 設計方針:
 * 1. **生特徴量が一次**: 市場（オッズ・人気）、馬体重・斤量、通算成績、前走情報。
 * 2. **ルールベース10要素は二次の派生特徴**: `ruleScores` として同梱し、
 *    説明・ベースライン・特徴量の3役で使い続ける（廃止しない）。
 * 3. **レース内相対化**: 競馬の勝敗は絶対値ではなく同一レース内の相対評価で決まるため、
 *    z-score / 順位を明示的に特徴量に入れる。
 * 4. **リーク遮断**: 集計テーブル（horse_course_stats 等）は使わず、
 *    `HorseQueryRepository` の as-of 集計のみを使う。
 *    当該レースの結果（着順・確定オッズ）は一切参照しない。
 * 5. **市場系は人気順位が主軸**: JRAの過去レース結果ページには全馬の事前単勝オッズが無い。
 *    単勝オッズは「同一レースの全出走馬に揃っている場合のみ」使い、
 *    1頭でも欠けているレースでは **全馬まとめて欠損扱い** にする
 *    （部分的な存在自体が「勝ち馬かどうか」の情報になるのを防ぐ）。
 *    人気順位は全馬ぶん取得できるため、こちらを主軸に据える。
 *
 * ## 予測時点の定義（重要）
 *
 * この特徴量セットの **予測時点は「発売締切直前」** である。
 *
 * - 人気順位（`popularity`）・単勝オッズは締切時点で確定する **事前情報** であり、
 *   レース結果には依存しない。したがって「当日以降の情報の混入」という意味での
 *   look-ahead リークでは **ない**。
 * - ただしこれは「締切より前（前日など）には予測できない」ことを意味する。
 *   締切前に予測したい用途にはこのモデルはそのまま使えない
 *   （市場系特徴量を落とした別モデルが必要）。
 * - 市場情報を特徴量に入れている以上、モデル確率と市場暗黙確率の差
 *   （`Predict` の「妙味」）は **市場との独立な差ではなく「市場の誤差」の予測** である。
 *   市場を情報源として取り込んだうえで、その偏りを補正した結果に過ぎない。
 *
 * @example
 * ```typescript
 * const builder = new FeatureBuilder(db);
 * const set = builder.buildForRace(raceId);
 * for (const row of set.rows) {
 *   console.log(row.horseName, row.vector);
 * }
 * ```
 */

import type { Database } from 'bun:sqlite';
import { ScoringOrchestrator } from '../domain/services/ScoringOrchestrator';
import { HorseQueryRepository } from '../repositories/queries/HorseQueryRepository';
import { RaceQueryRepository } from '../repositories/queries/RaceQueryRepository';
import {
  ASSIGNED_WEIGHT_BASE,
  HORSE_WEIGHT_BASE,
  type RaceFeatureSet
} from './featureSpec';
import type { EntryWithDetails } from '../types/RepositoryTypes';
import { mean, stdDev, zScores, normalizedRanks } from './featureMath';
import {
  hasCompleteOdds,
  raceMarketProbabilities,
  MIN_VALID_WIN_ODDS
} from './MarketProbability';
import { buildHorseFeatureRow, type RaceFeatureContext } from './horseFeatureRow';

export {
  hasCompleteOdds,
  marketImpliedProbabilities,
  popularityImpliedProbabilities,
  popularityWinRate,
  raceMarketProbabilities,
  POPULARITY_WIN_RATES,
  MIN_VALID_WIN_ODDS,
  type MarketProbSource,
  type MarketProbabilityResult
} from './MarketProbability';
export {
  FEATURE_NAMES,
  MARKET_FEATURE_NAMES,
  MARKET_FEATURE_INDICES,
  SMALL_MODEL_FEATURE_NAMES,
  SMALL_MODEL_FEATURE_INDICES,
  FEATURE_DIMENSION,
  toVector,
  type MLFeatures,
  type HorseFeatureRow,
  type RaceFeatureSet
} from './featureSpec';

export class FeatureBuilder {
  private readonly orchestrator: ScoringOrchestrator;
  private readonly horseRepo: HorseQueryRepository;
  private readonly raceRepo: RaceQueryRepository;

  constructor(private readonly db: Database) {
    this.orchestrator = new ScoringOrchestrator(db);
    this.horseRepo = new HorseQueryRepository(db);
    this.raceRepo = new RaceQueryRepository(db);
  }

  /**
   * レース1件分の特徴量を構築
   *
   * @param raceId - レースID
   * @param asOf - 評価基準日（省略時は当該レースの race_date）
   * @returns 特徴量セット。レースまたは出走馬が無い場合は null
   */
  buildForRace(raceId: number, asOf?: string): RaceFeatureSet | null {
    const race = this.raceRepo.getRaceWithVenue(raceId);
    if (!race) return null;

    const entries = this.raceRepo.getRaceEntries(raceId).filter(e => e.horse_id != null);
    if (entries.length === 0) return null;

    const cutoff = asOf ?? race.race_date;
    const context = this.buildRaceContext(raceId, entries, race.total_horses, cutoff);

    return {
      raceId,
      raceName: race.race_name,
      raceDate: race.race_date,
      venue: race.venue_name,
      asOf: cutoff,
      marketProbSource: context.marketProbSource,
      rows: entries.map((entry, i) => buildHorseFeatureRow(entry, i, context))
    };
  }

  /**
   * レース単位で各馬に共通の材料を先に計算する
   *
   * @param raceId - レースID
   * @param entries - 出走エントリ（以降の配列はこの並びに対応する）
   * @param totalHorses - レースの登録頭数（無ければ出走エントリ数で代用）
   * @param cutoff - as-of 基準日
   */
  private buildRaceContext(
    raceId: number,
    entries: EntryWithDetails[],
    totalHorses: number | undefined,
    cutoff: string
  ): RaceFeatureContext {
    const horseIds = entries.map(e => e.horse_id);

    // ルールベース10要素（同じ as-of で計算）
    const ruleResults = this.orchestrator.calculateScoresForRace(raceId, cutoff);
    const ruleMap = new Map(ruleResults.map(r => [r.horseId, r.scores]));

    // ---- 市場系（オッズは全馬揃っているレースでのみ使う） ----
    const rawOdds = entries.map(e =>
      e.win_odds != null && e.win_odds >= MIN_VALID_WIN_ODDS ? e.win_odds : null
    );
    // 人気順位は 1 以上のみ有効。0 や負値は「取得できなかった」の意味であり、
    // そのまま使うと 0 が「1番人気」と同値に正規化されてしまう（MarketProbability と同じ条件）
    const popularities = entries.map(e =>
      e.popularity != null && e.popularity >= 1 ? e.popularity : null
    );
    const oddsUsable = hasCompleteOdds(rawOdds);
    // 1頭でも欠けているレースはオッズ由来の特徴量を全馬まとめて捨てる
    const oddsList: (number | null)[] = oddsUsable ? rawOdds : entries.map(() => null);
    const market = raceMarketProbabilities(rawOdds, popularities);
    const oddsRanks = oddsUsable
      ? normalizedRanks(oddsList.map(o => o ?? 0), false)
      : entries.map(() => 0.5);

    const horseWeights = entries.map(e => e.horse_weight ?? null);
    const knownWeights = horseWeights.filter((w): w is number => w != null);

    const assignedWeights = entries.map(e => e.assigned_weight ?? ASSIGNED_WEIGHT_BASE);
    const ruleTotals = entries.map(e => ruleMap.get(e.horse_id)?.calculateTotalScore() ?? 0);

    const fieldSize = totalHorses ?? entries.length;

    return {
      ruleMap,
      // 前走（as-of）
      prevMap: this.horseRepo.getPreviousRacesAsOf(horseIds, cutoff),
      // 払戻用の確定オッズ（特徴量には使わない）
      payoutOddsMap: this.getPayoutOdds(raceId),
      oddsList,
      popularities,
      impliedProbs: market.probabilities,
      oddsRanks,
      oddsUsable,
      marketProbSource: market.source,
      weightMean: knownWeights.length > 0 ? mean(knownWeights) : HORSE_WEIGHT_BASE,
      weightSd: knownWeights.length > 1 ? stdDev(knownWeights) : 0,
      assignedZ: zScores(assignedWeights),
      ruleTotals,
      ruleZ: zScores(ruleTotals),
      ruleRanks: normalizedRanks(ruleTotals, true),
      fieldSize,
      fieldSizeLog: Math.log(Math.max(2, fieldSize)),
      cutoffTime: new Date(cutoff).getTime()
    };
  }

  /**
   * 払戻計算用の確定単勝オッズを取得
   *
   * @remarks
   * レース後にしか分からない値なので **特徴量には絶対に使わない**。
   * バックテストの回収率シミュレーションでのみ使用する。
   */
  private getPayoutOdds(raceId: number): Map<number, number> {
    const rows = this.db.prepare(`
      SELECT e.horse_id, rr.final_win_odds
      FROM race_entries e
      JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.race_id = ? AND rr.final_win_odds IS NOT NULL
    `).all(raceId) as { horse_id: number; final_win_odds: number }[];

    return new Map(rows.map(r => [r.horse_id, r.final_win_odds]));
  }
}
