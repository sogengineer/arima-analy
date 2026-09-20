/**
 * スコアリングオーケストレーター
 *
 * @remarks
 * エンティティを組み立て、スコア計算を委譲する薄いサービス層。
 * バッチ取得メソッドを使用してN+1問題を回避する。
 *
 * 責務:
 * - リポジトリからのデータ取得
 * - エンティティの構築
 * - スコア計算の委譲
 *
 * @example
 * ```typescript
 * const orchestrator = new ScoringOrchestrator(db);
 * const results = orchestrator.calculateScoresForRace(raceId);
 * results.forEach(r => console.log(`${r.horseName}: ${r.scores.calculateTotalScore()}`));
 * ```
 */

import type { Database } from 'bun:sqlite';
import { Horse } from '@/domain/entities/Horse';
import { Jockey } from '@/domain/entities/Jockey';
import { Race } from '@/domain/entities/Race';
import { RaceResult } from '@/domain/entities/RaceResult';
import type { ScoreComponents } from '@/domain/valueObjects/ScoreComponents';
import { HorseQueryRepository } from '@/repositories/queries/HorseQueryRepository';
import { RaceQueryRepository } from '@/repositories/queries/RaceQueryRepository';
import { JockeyQueryRepository } from '@/repositories/queries/JockeyQueryRepository';
import { calculateFrameNumber } from '@/constants/ScoringConstants';
import type { HorseRaceResult, CourseStats, TrackStats } from '@/types/RepositoryTypes';
import type { HorseDetailRow } from '@/repositories/queries/HorseQueryRepository';
import type { EntryWithDetailsRow, RaceWithVenueRow } from '@/repositories/queries/RaceQueryRepository';

/**
 * 馬のスコア計算結果
 */
export interface HorseScoreResult {
  /** 馬ID */
  horseId: number;
  /** 馬名 */
  horseName: string;
  /** 馬番 */
  horseNumber?: number;
  /** スコア構成要素 */
  scores: ScoreComponents;
}

/** レース単位でまとめ取りした馬データのキャッシュ（horseId → 各種データ） */
interface RaceHorseDataCache {
  detailsMap: Map<number, HorseDetailRow>;
  resultsMap: Map<number, HorseRaceResult[]>;
  courseStatsMap: Map<number, CourseStats[]>;
  trackStatsMap: Map<number, TrackStats[]>;
}

export class ScoringOrchestrator {
  private readonly horseRepo: HorseQueryRepository;
  private readonly raceRepo: RaceQueryRepository;
  private readonly jockeyRepo: JockeyQueryRepository;

  constructor(db: Database) {
    this.horseRepo = new HorseQueryRepository(db);
    this.raceRepo = new RaceQueryRepository(db);
    this.jockeyRepo = new JockeyQueryRepository(db);
  }

  /**
   * レースの全出走馬のスコアを計算
   *
   * @remarks
   * バッチ取得を使用してN+1問題を回避。
   * 従来: 1 + 4N クエリ（N=出走馬数）
   * 改善後: 5クエリ固定
   *
   * as-of 評価:
   * 特徴量は `asOf` より前のデータのみから組み立てる。
   * 省略時は当該レースの開催日を使うため、同じレースを
   * 「結果投入前」「結果投入後」のどちらで評価しても同じスコアになる
   * （look-ahead リークの遮断）。
   *
   * @param raceId - レースID
   * @param asOf - 評価基準日（YYYY-MM-DD）。省略時は当該レースの race_date
   * @returns 全出走馬のスコア結果
   * @throws {Error} レースが見つからない場合
   */
  calculateScoresForRace(raceId: number, asOf?: string): HorseScoreResult[] {
    const raceRecord = this.raceRepo.getRaceWithVenue(raceId);
    if (!raceRecord) {
      throw new Error(`Race not found: ${raceId}`);
    }

    const race = Race.fromDbRecord(raceRecord);
    const entries = this.raceRepo.getRaceEntries(raceId);

    if (entries.length === 0) {
      return [];
    }

    // as-of 基準日（省略時は当該レースの開催日）
    const cutoff = asOf ?? raceRecord.race_date;

    // 馬IDを収集
    const horseIds = entries
      .map(e => e.horse_id)
      .filter((id): id is number => id != null);

    // バッチ取得（4クエリ）。いずれも cutoff より前のデータのみを使う
    const detailsMap = this.horseRepo.getHorsesWithDetailsBatch(horseIds);
    const resultsMap = this.horseRepo.getHorsesRaceResultsBatch(horseIds, cutoff);
    const courseStatsMap = this.horseRepo.getHorsesCourseStatsAsOf(horseIds, cutoff);
    const trackStatsMap = this.horseRepo.getHorsesTrackStatsAsOf(horseIds, cutoff);

    const results: HorseScoreResult[] = [];

    for (const entry of entries) {
      if (!entry.horse_id) continue;

      // キャッシュからエンティティを構築
      const horse = this.buildHorseEntityFromCache(entry.horse_id, entry.horse_name, {
        detailsMap,
        resultsMap,
        courseStatsMap,
        trackStatsMap
      });

      const jockey = entry.jockey_id
        ? this.buildJockeyEntity(entry.jockey_id, race.venue, entry.trainer_id ?? undefined, cutoff)
        : null;

      // TODO: Trainerエンティティの構築は将来実装
      // const trainer = entry.trainer_id
      //   ? this.buildTrainerEntity(entry.trainer_id)
      //   : null;

      // 計算はエンティティに委譲（枠番情報を追加）
      // frame_number が未登録のデータでは馬番と総頭数から枠番を算出する
      const framePosition = entry.frame_number
        ?? calculateFrameNumber(entry.horse_number, race.totalHorses ?? entries.length);

      const scores = horse.calculateTotalScore(
        jockey,
        race,
        null,  // trainer（将来実装）
        framePosition,   // 枠番
        entry.trainer_id ?? undefined // 騎手×調教師コンビ成績の参照用
      );

      results.push({
        horseId: entry.horse_id,
        horseName: entry.horse_name,
        horseNumber: entry.horse_number,
        scores
      });
    }

    return results;
  }

  /**
   * 出走エントリのスコアを計算（単体用）
   *
   * @param entry - 出走エントリ
   * @param race - レースエンティティ
   * @returns スコア構成要素
   */
  calculateScoreForEntry(entry: EntryWithDetailsRow, race: Race, asOf?: string): ScoreComponents {
    const cutoff = asOf ?? race.date;
    const horse = this.buildHorseEntity(entry.horse_id, cutoff);
    const jockey = entry.jockey_id
      ? this.buildJockeyEntity(entry.jockey_id, race.venue, entry.trainer_id ?? undefined, cutoff)
      : null;

    const framePosition = entry.frame_number
      ?? calculateFrameNumber(
        entry.horse_number,
        race.totalHorses ?? this.raceRepo.getRaceEntries(race.id).length
      );

    // 計算はエンティティに委譲（枠番情報を追加）
    return horse.calculateTotalScore(
      jockey,
      race,
      null,  // trainer（将来実装）
      framePosition,      // 枠番
      entry.trainer_id ?? undefined     // 騎手×調教師コンビ成績の参照用
    );
  }

  /**
   * キャッシュから馬エンティティを構築
   *
   * @param horseId - 馬ID
   * @param horseName - 馬名
   * @param cache - レース単位でまとめ取りした馬データのキャッシュ
   * @returns Horse エンティティ
   */
  private buildHorseEntityFromCache(
    horseId: number,
    horseName: string,
    cache: RaceHorseDataCache
  ): Horse {
    const detail = cache.detailsMap.get(horseId);
    const raceResults = cache.resultsMap.get(horseId) ?? [];
    const courseStats = cache.courseStatsMap.get(horseId) ?? [];
    const trackStats = cache.trackStatsMap.get(horseId) ?? [];

    const name = detail?.name ?? horseName;

    const builder = Horse.builder(horseId, name);

    if (detail) {
      builder.withDetail(detail);
    }

    return builder
      .withRaceResults(raceResults.map(r => new RaceResult(r)))
      .withCourseStats(courseStats)
      .withTrackStats(trackStats)
      .build();
  }

  /**
   * 馬エンティティを構築（単体取得用、後方互換）
   *
   * @param horseId - 馬ID
   * @returns Horse エンティティ
   */
  buildHorseEntity(horseId: number, asOf?: string): Horse {
    const detail = this.horseRepo.getHorseWithDetails(horseId);
    const raceResults = this.horseRepo.getHorseRaceResults(horseId, undefined, asOf);
    const courseStats = asOf
      ? (this.horseRepo.getHorsesCourseStatsAsOf([horseId], asOf).get(horseId) ?? [])
      : this.horseRepo.getHorseCourseStats(horseId);
    const trackStats = asOf
      ? (this.horseRepo.getHorsesTrackStatsAsOf([horseId], asOf).get(horseId) ?? [])
      : this.horseRepo.getHorseTrackStats(horseId);

    const name = detail?.name ?? `Horse#${horseId}`;

    const builder = Horse.builder(horseId, name);

    if (detail) {
      builder.withDetail(detail);
    }

    return builder
      .withRaceResults(raceResults.map(r => new RaceResult(r)))
      .withCourseStats(courseStats)
      .withTrackStats(trackStats)
      .build();
  }

  /**
   * 騎手エンティティを構築
   *
   * @param jockeyId - 騎手ID
   * @param venue - 会場名
   * @param trainerId - 調教師ID（省略可）
   * @param asOf - 評価基準日（省略時は全期間の成績を使う）
   * @returns Jockey エンティティ
   *
   * @remarks
   * 騎手成績も `race_results` からの集計なので、`asOf` を渡さないと
   * 未来のレース結果が騎手スコアに混入する（look-ahead リーク）。
   */
  buildJockeyEntity(
    jockeyId: number,
    venue: string,
    trainerId?: number,
    asOf?: string
  ): Jockey {
    const jockeyRecord = this.jockeyRepo.getJockeyById(jockeyId);
    const name = jockeyRecord?.name ?? `Jockey#${jockeyId}`;

    const builder = Jockey.builder(jockeyId, name);

    // 会場別成績を取得
    const venueStats = this.jockeyRepo.getJockeyVenueStats(jockeyId, venue, asOf);
    if (venueStats) {
      builder.withVenueStats(venue, venueStats);
    }

    // 全体成績を取得
    const overallStats = this.jockeyRepo.getJockeyOverallStats(jockeyId, asOf);
    if (overallStats) {
      builder.withOverallStats(overallStats);
    }

    // 調教師コンビ成績を取得
    if (trainerId) {
      const comboStats = this.jockeyRepo.getJockeyTrainerStats(jockeyId, trainerId, asOf);
      if (comboStats) {
        builder.withTrainerComboStats(trainerId, comboStats);
      }
    }

    return builder.build();
  }

  /**
   * レースエンティティを構築
   *
   * @param raceId - レースID
   * @returns Race エンティティ、見つからない場合は null
   */
  buildRaceEntity(raceId: number): Race | null {
    const raceRecord = this.raceRepo.getRaceWithVenue(raceId);
    if (!raceRecord) return null;
    return Race.fromDbRecord(raceRecord);
  }

  /**
   * レース情報を取得
   *
   * @param raceId - レースID
   * @returns レース情報、見つからない場合は null
   */
  getRaceWithVenue(raceId: number): RaceWithVenueRow | null {
    return this.raceRepo.getRaceWithVenue(raceId);
  }

  /**
   * 全レースを取得
   *
   * @returns 全レースの配列
   */
  getAllRaces(): RaceWithVenueRow[] {
    return this.raceRepo.getAllRaces();
  }

  /**
   * レースをIDまたは名前で取得
   *
   * @param idOrName - レースIDまたはレース名
   * @returns レース情報、見つからない場合は null
   */
  getRaceByIdOrName(idOrName: string): RaceWithVenueRow | null {
    const race = this.raceRepo.getRaceByIdOrName(idOrName);
    if (!race) return null;
    return this.raceRepo.getRaceWithVenue(race.id);
  }

  /**
   * レースの出走馬を取得
   *
   * @param raceId - レースID
   * @returns 出走馬エントリの配列
   */
  getRaceEntries(raceId: number): EntryWithDetailsRow[] {
    return this.raceRepo.getRaceEntries(raceId);
  }
}
