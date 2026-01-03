/**
 * スコアリングオーケストレーター
 * エンティティを組み立て、スコア計算を委譲する薄いサービス層
 */

import type Database from 'better-sqlite3';
import { Horse, HorseBuilder } from '../entities/Horse';
import { Jockey, JockeyBuilder } from '../entities/Jockey';
import { Race } from '../entities/Race';
import { RaceResult } from '../entities/RaceResult';
import type { ScoreComponents } from '../valueObjects/ScoreComponents';
import { HorseQueryRepository } from '../../repositories/queries/HorseQueryRepository';
import { RaceQueryRepository } from '../../repositories/queries/RaceQueryRepository';
import { JockeyQueryRepository } from '../../repositories/queries/JockeyQueryRepository';
import type { EntryWithDetails, RaceWithVenue } from '../../types/RepositoryTypes';

export interface HorseScoreResult {
  horseId: number;
  horseName: string;
  horseNumber?: number;
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
   */
  calculateScoresForRace(raceId: number): HorseScoreResult[] {
    const raceRecord = this.raceRepo.getRaceWithVenue(raceId);
    if (!raceRecord) {
      throw new Error(`Race not found: ${raceId}`);
    }

    const race = Race.fromDbRecord(raceRecord);
    const entries = this.raceRepo.getRaceEntries(raceId);

    const results: HorseScoreResult[] = [];

    for (const entry of entries) {
      const scores = this.calculateScoreForEntry(entry, race);
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
   * 出走エントリのスコアを計算
   */
  calculateScoreForEntry(entry: EntryWithDetails, race: Race): ScoreComponents {
    const horse = this.buildHorseEntity(entry.horse_id);
    const jockey = entry.jockey_id
      ? this.buildJockeyEntity(entry.jockey_id, race.venue, entry.trainer_id)
      : null;

    // 計算はエンティティに委譲
    return horse.calculateTotalScore(jockey, race);
  }

  /**
   * 馬エンティティを構築
   */
  buildHorseEntity(horseId: number): Horse {
    const detail = this.horseRepo.getHorseWithDetails(horseId);
    const raceResults = this.horseRepo.getHorseRaceResults(horseId);
    const courseStats = this.horseRepo.getHorseCourseStats(horseId);
    const trackStats = this.horseRepo.getHorseTrackStats(horseId);

    const name = detail?.name ?? `Horse#${horseId}`;

    return Horse.builder(horseId, name)
      .withDetail(detail!)
      .withRaceResults(raceResults.map(r => new RaceResult(r)))
      .withCourseStats(courseStats)
      .withTrackStats(trackStats)
      .build();
  }

  /**
   * 騎手エンティティを構築
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
   */
  buildRaceEntity(raceId: number): Race | null {
    const raceRecord = this.raceRepo.getRaceWithVenue(raceId);
    if (!raceRecord) return null;
    return Race.fromDbRecord(raceRecord);
  }

  /**
   * レース情報を取得
   */
  getRaceWithVenue(raceId: number): RaceWithVenue | undefined {
    return this.raceRepo.getRaceWithVenue(raceId);
  }

  /**
   * 全レースを取得
   */
  getAllRaces(): RaceWithVenue[] {
    return this.raceRepo.getAllRaces();
  }

  /**
   * レースをIDまたは名前で取得
   */
  getRaceByIdOrName(idOrName: string): RaceWithVenue | undefined {
    const race = this.raceRepo.getRaceByIdOrName(idOrName);
    if (!race) return undefined;
    return this.raceRepo.getRaceWithVenue(race.id);
  }

  /**
   * レースの出走馬を取得
   */
  getRaceEntries(raceId: number): EntryWithDetails[] {
    return this.raceRepo.getRaceEntries(raceId);
  }
}
