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

import type Database from 'better-sqlite3';
import { Horse } from '../entities/Horse';
import { Jockey, JockeyBuilder } from '../entities/Jockey';
import { Race } from '../entities/Race';
import { RaceResult } from '../entities/RaceResult';
import type { ScoreComponents } from '../valueObjects/ScoreComponents';
import { HorseQueryRepository } from '../../repositories/queries/HorseQueryRepository';
import { RaceQueryRepository } from '../../repositories/queries/RaceQueryRepository';
import { JockeyQueryRepository } from '../../repositories/queries/JockeyQueryRepository';
import type { EntryWithDetails, RaceWithVenue, HorseDetail, HorseRaceResult, CourseStats, TrackStats } from '../../types/RepositoryTypes';

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

export class ScoringOrchestrator {
  private readonly horseRepo: HorseQueryRepository;
  private readonly raceRepo: RaceQueryRepository;
  private readonly jockeyRepo: JockeyQueryRepository;

  constructor(db: Database.Database) {
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
   * @param raceId - レースID
   * @returns 全出走馬のスコア結果
   * @throws {Error} レースが見つからない場合
   */
  calculateScoresForRace(raceId: number): HorseScoreResult[] {
    const raceRecord = this.raceRepo.getRaceWithVenue(raceId);
    if (!raceRecord) {
      throw new Error(`Race not found: ${raceId}`);
    }

    const race = Race.fromDbRecord(raceRecord);
    const entries = this.raceRepo.getRaceEntries(raceId);

    if (entries.length === 0) {
      return [];
    }

    // 馬IDを収集
    const horseIds = entries
      .map(e => e.horse_id)
      .filter((id): id is number => id != null);

    // バッチ取得（4クエリ）
    const detailsMap = this.horseRepo.getHorsesWithDetailsBatch(horseIds);
    const resultsMap = this.horseRepo.getHorsesRaceResultsBatch(horseIds);
    const courseStatsMap = this.horseRepo.getHorsesCourseStatsBatch(horseIds);
    const trackStatsMap = this.horseRepo.getHorsesTrackStatsBatch(horseIds);

    const results: HorseScoreResult[] = [];

    for (const entry of entries) {
      if (!entry.horse_id) continue;

      // キャッシュからエンティティを構築
      const horse = this.buildHorseEntityFromCache(
        entry.horse_id,
        entry.horse_name,
        detailsMap,
        resultsMap,
        courseStatsMap,
        trackStatsMap
      );

      const jockey = entry.jockey_id
        ? this.buildJockeyEntity(entry.jockey_id, race.venue, entry.trainer_id)
        : null;

      // TODO: Trainerエンティティの構築は将来実装
      // const trainer = entry.trainer_id
      //   ? this.buildTrainerEntity(entry.trainer_id)
      //   : null;

      // 計算はエンティティに委譲（枠番情報を追加）
      const scores = horse.calculateTotalScore(
        jockey,
        race,
        null,  // trainer（将来実装）
        entry.horse_number  // 枠番
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
  calculateScoreForEntry(entry: EntryWithDetails, race: Race): ScoreComponents {
    const horse = this.buildHorseEntity(entry.horse_id);
    const jockey = entry.jockey_id
      ? this.buildJockeyEntity(entry.jockey_id, race.venue, entry.trainer_id)
      : null;

    // 計算はエンティティに委譲（枠番情報を追加）
    return horse.calculateTotalScore(
      jockey,
      race,
      null,  // trainer（将来実装）
      entry.horse_number  // 枠番
    );
  }

  /**
   * キャッシュから馬エンティティを構築
   *
   * @param horseId - 馬ID
   * @param horseName - 馬名
   * @param detailsMap - 馬詳細のキャッシュ
   * @param resultsMap - レース結果のキャッシュ
   * @param courseStatsMap - コース成績のキャッシュ
   * @param trackStatsMap - 馬場成績のキャッシュ
   * @returns Horse エンティティ
   */
  private buildHorseEntityFromCache(
    horseId: number,
    horseName: string,
    detailsMap: Map<number, HorseDetail>,
    resultsMap: Map<number, HorseRaceResult[]>,
    courseStatsMap: Map<number, CourseStats[]>,
    trackStatsMap: Map<number, TrackStats[]>
  ): Horse {
    const detail = detailsMap.get(horseId);
    const raceResults = resultsMap.get(horseId) ?? [];
    const courseStats = courseStatsMap.get(horseId) ?? [];
    const trackStats = trackStatsMap.get(horseId) ?? [];

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
  buildHorseEntity(horseId: number): Horse {
    const detail = this.horseRepo.getHorseWithDetails(horseId);
    const raceResults = this.horseRepo.getHorseRaceResults(horseId);
    const courseStats = this.horseRepo.getHorseCourseStats(horseId);
    const trackStats = this.horseRepo.getHorseTrackStats(horseId);

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
   * @returns Jockey エンティティ
   */
  buildJockeyEntity(jockeyId: number, venue: string, trainerId?: number): Jockey {
    const jockeyRecord = this.jockeyRepo.getJockeyById(jockeyId);
    const name = jockeyRecord?.name ?? `Jockey#${jockeyId}`;

    const builder = Jockey.builder(jockeyId, name);

    // 会場別成績を取得
    const venueStats = this.jockeyRepo.getJockeyVenueStats(jockeyId, venue);
    if (venueStats) {
      builder.withVenueStats(venue, venueStats);
    }

    // 全体成績を取得
    const overallStats = this.jockeyRepo.getJockeyOverallStats(jockeyId);
    if (overallStats) {
      builder.withOverallStats(overallStats);
    }

    // 調教師コンビ成績を取得
    if (trainerId) {
      const comboStats = this.jockeyRepo.getJockeyTrainerStats(jockeyId, trainerId);
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
   * @returns レース情報、見つからない場合は undefined
   */
  getRaceWithVenue(raceId: number): RaceWithVenue | undefined {
    return this.raceRepo.getRaceWithVenue(raceId);
  }

  /**
   * 全レースを取得
   *
   * @returns 全レースの配列
   */
  getAllRaces(): RaceWithVenue[] {
    return this.raceRepo.getAllRaces();
  }

  /**
   * レースをIDまたは名前で取得
   *
   * @param idOrName - レースIDまたはレース名
   * @returns レース情報、見つからない場合は undefined
   */
  getRaceByIdOrName(idOrName: string): RaceWithVenue | undefined {
    const race = this.raceRepo.getRaceByIdOrName(idOrName);
    if (!race) return undefined;
    return this.raceRepo.getRaceWithVenue(race.id);
  }

  /**
   * レースの出走馬を取得
   *
   * @param raceId - レースID
   * @returns 出走馬エントリの配列
   */
  getRaceEntries(raceId: number): EntryWithDetails[] {
    return this.raceRepo.getRaceEntries(raceId);
  }
}
