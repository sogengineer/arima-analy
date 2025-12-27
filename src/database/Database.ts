import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  DBVenue, DBSire, DBMare, DBTrainer, DBOwner, DBBreeder, DBJockey,
  DBHorse, DBRace, DBRaceEntry, DBRaceResult,
  HorseDetail, RaceResultDetail,
  HorseImportData, RaceImportData, EntryImportData, ResultImportData
} from '../types/HorseData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ArimaDatabase {
  private db: Database.Database;

  constructor(dbPath: string = './arima.db') {
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    try {
      const schemaPath = join(__dirname, 'schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  // ============================================
  // マスタテーブル操作
  // ============================================

  public getOrCreateVenue(name: string): number {
    const existing = this.db.prepare('SELECT id FROM venues WHERE name = ?').get(name) as DBVenue | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare('INSERT INTO venues (name) VALUES (?)').run(name);
    return result.lastInsertRowid as number;
  }

  public getOrCreateSire(name: string): number {
    if (!name) return 0;
    const existing = this.db.prepare('SELECT id FROM sires WHERE name = ?').get(name) as DBSire | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare('INSERT INTO sires (name) VALUES (?)').run(name);
    return result.lastInsertRowid as number;
  }

  public getOrCreateMare(name: string, maresSireName?: string): number {
    if (!name) return 0;
    const existing = this.db.prepare('SELECT id FROM mares WHERE name = ?').get(name) as DBMare | undefined;
    if (existing) return existing.id;

    const maresSireId = maresSireName ? this.getOrCreateSire(maresSireName) : null;
    const result = this.db.prepare('INSERT INTO mares (name, sire_id) VALUES (?, ?)').run(name, maresSireId);
    return result.lastInsertRowid as number;
  }

  public getOrCreateTrainer(name: string, stable?: '美浦' | '栗東'): number {
    if (!name) return 0;
    const existing = this.db.prepare('SELECT id FROM trainers WHERE name = ?').get(name) as DBTrainer | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare('INSERT INTO trainers (name, stable) VALUES (?, ?)').run(name, stable || null);
    return result.lastInsertRowid as number;
  }

  public getOrCreateOwner(name: string): number {
    if (!name) return 0;
    const existing = this.db.prepare('SELECT id FROM owners WHERE name = ?').get(name) as DBOwner | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare('INSERT INTO owners (name) VALUES (?)').run(name);
    return result.lastInsertRowid as number;
  }

  public getOrCreateBreeder(name: string): number {
    if (!name) return 0;
    const existing = this.db.prepare('SELECT id FROM breeders WHERE name = ?').get(name) as DBBreeder | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare('INSERT INTO breeders (name) VALUES (?)').run(name);
    return result.lastInsertRowid as number;
  }

  public getOrCreateJockey(name: string, weight?: number): number {
    if (!name) return 0;
    const existing = this.db.prepare('SELECT id FROM jockeys WHERE name = ?').get(name) as DBJockey | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare('INSERT INTO jockeys (name, default_weight) VALUES (?, ?)').run(name, weight || null);
    return result.lastInsertRowid as number;
  }

  // ============================================
  // 競走馬操作
  // ============================================

  public insertHorseWithBloodline(data: HorseImportData): { id: number; updated: boolean } {
    const sireId = data.sire ? this.getOrCreateSire(data.sire) : null;
    const mareId = data.mare ? this.getOrCreateMare(data.mare, data.maresSire) : null;
    const trainerId = data.trainer ? this.getOrCreateTrainer(data.trainer, data.trainerStable) : null;
    const ownerId = data.owner ? this.getOrCreateOwner(data.owner) : null;
    const breederId = data.breeder ? this.getOrCreateBreeder(data.breeder) : null;

    const existing = this.db.prepare('SELECT id FROM horses WHERE name = ?').get(data.name) as DBHorse | undefined;

    if (existing) {
      // 既存の馬を更新
      this.db.prepare(`
        UPDATE horses SET
          birth_year = COALESCE(?, birth_year),
          sex = COALESCE(?, sex),
          sire_id = COALESCE(?, sire_id),
          mare_id = COALESCE(?, mare_id),
          trainer_id = COALESCE(?, trainer_id),
          owner_id = COALESCE(?, owner_id),
          breeder_id = COALESCE(?, breeder_id),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        data.birthYear || null,
        data.sex || null,
        sireId,
        mareId,
        trainerId,
        ownerId,
        breederId,
        existing.id
      );
      return { id: existing.id, updated: true };
    }

    // 新規作成
    const stmt = this.db.prepare(`
      INSERT INTO horses (name, birth_year, sex, sire_id, mare_id, trainer_id, owner_id, breeder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.name,
      data.birthYear || null,
      data.sex || null,
      sireId,
      mareId,
      trainerId,
      ownerId,
      breederId
    );
    return { id: result.lastInsertRowid as number, updated: false };
  }

  public getHorseByName(name: string): DBHorse | undefined {
    return this.db.prepare('SELECT * FROM horses WHERE name = ?').get(name) as DBHorse | undefined;
  }

  public getHorseWithBloodline(horseId: number): HorseDetail | undefined {
    return this.db.prepare('SELECT * FROM v_horse_details WHERE id = ?').get(horseId) as HorseDetail | undefined;
  }

  public getAllHorsesWithBloodline(): HorseDetail[] {
    return this.db.prepare('SELECT * FROM v_horse_details ORDER BY name').all() as HorseDetail[];
  }

  // 後方互換性のため
  public getAllHorses(): DBHorse[] {
    return this.db.prepare('SELECT * FROM horses ORDER BY name').all() as DBHorse[];
  }

  public getTrackPerformance(horseId: number): any[] {
    return this.db.prepare(`
      SELECT * FROM horse_track_stats WHERE horse_id = ?
    `).all(horseId);
  }

  public getCoursePerformance(horseId: number): any[] {
    return this.db.prepare(`
      SELECT hcs.*, v.name as venue
      FROM horse_course_stats hcs
      JOIN venues v ON hcs.venue_id = v.id
      WHERE hcs.horse_id = ?
    `).all(horseId);
  }

  // ============================================
  // レース操作
  // ============================================

  public insertRace(data: RaceImportData): { id: number; updated: boolean } {
    const venueId = this.getOrCreateVenue(data.venue);

    // 既存チェック（日付＋会場＋レース番号で一致）
    const existing = this.db.prepare(`
      SELECT id FROM races WHERE race_date = ? AND venue_id = ? AND race_number = ?
    `).get(data.raceDate, venueId, data.raceNumber || 1) as DBRace | undefined;

    if (existing) {
      // 既存レースを更新
      this.db.prepare(`
        UPDATE races SET
          race_name = COALESCE(?, race_name),
          race_class = COALESCE(?, race_class),
          race_type = COALESCE(?, race_type),
          distance = COALESCE(?, distance),
          track_condition = COALESCE(?, track_condition),
          total_horses = COALESCE(?, total_horses)
        WHERE id = ?
      `).run(
        data.raceName,
        data.raceClass || null,
        data.raceType || null,
        data.distance,
        data.trackCondition || null,
        data.totalHorses || null,
        existing.id
      );
      return { id: existing.id, updated: true };
    }

    const stmt = this.db.prepare(`
      INSERT INTO races (race_date, venue_id, race_number, race_name, race_class, race_type, distance, track_condition, total_horses)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.raceDate,
      venueId,
      data.raceNumber || 1,
      data.raceName,
      data.raceClass || null,
      data.raceType || null,
      data.distance,
      data.trackCondition || null,
      data.totalHorses || null
    );
    return { id: result.lastInsertRowid as number, updated: false };
  }

  public getRaceById(raceId: number): DBRace | undefined {
    return this.db.prepare('SELECT * FROM races WHERE id = ?').get(raceId) as DBRace | undefined;
  }

  // ============================================
  // 出馬表操作
  // ============================================

  public insertRaceEntry(raceId: number, data: EntryImportData): { id: number; updated: boolean } {
    const horse = this.getHorseByName(data.horseName);
    if (!horse) {
      throw new Error(`Horse not found: ${data.horseName}`);
    }
    const jockeyId = this.getOrCreateJockey(data.jockeyName, data.assignedWeight);

    // 既存チェック（レースID＋馬番で一致）
    const existing = this.db.prepare(`
      SELECT id FROM race_entries WHERE race_id = ? AND horse_number = ?
    `).get(raceId, data.horseNumber) as DBRaceEntry | undefined;

    if (existing) {
      // 既存エントリを更新
      this.db.prepare(`
        UPDATE race_entries SET
          jockey_id = COALESCE(?, jockey_id),
          frame_number = COALESCE(?, frame_number),
          assigned_weight = COALESCE(?, assigned_weight),
          win_odds = COALESCE(?, win_odds),
          popularity = COALESCE(?, popularity),
          horse_weight = COALESCE(?, horse_weight),
          career_wins = COALESCE(?, career_wins),
          career_places = COALESCE(?, career_places),
          career_shows = COALESCE(?, career_shows),
          career_runs = COALESCE(?, career_runs),
          total_prize_money = COALESCE(?, total_prize_money)
        WHERE id = ?
      `).run(
        jockeyId,
        data.frameNumber || null,
        data.assignedWeight || null,
        data.winOdds || null,
        data.popularity || null,
        data.horseWeight || null,
        data.careerWins || null,
        data.careerPlaces || null,
        data.careerShows || null,
        data.careerRuns || null,
        data.totalPrizeMoney || null,
        existing.id
      );
      return { id: existing.id, updated: true };
    }

    const stmt = this.db.prepare(`
      INSERT INTO race_entries (
        race_id, horse_id, jockey_id, frame_number, horse_number, assigned_weight,
        win_odds, popularity, horse_weight, career_wins, career_places, career_shows, career_runs, total_prize_money
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      raceId,
      horse.id,
      jockeyId,
      data.frameNumber || null,
      data.horseNumber,
      data.assignedWeight || null,
      data.winOdds || null,
      data.popularity || null,
      data.horseWeight || null,
      data.careerWins || null,
      data.careerPlaces || null,
      data.careerShows || null,
      data.careerRuns || null,
      data.totalPrizeMoney || null
    );
    return { id: result.lastInsertRowid as number, updated: false };
  }

  // ============================================
  // レース結果操作
  // ============================================

  public insertRaceResult(entryId: number, data: ResultImportData): { id: number; updated: boolean } {
    // 既存チェック（エントリIDで一致）
    const existing = this.db.prepare('SELECT id FROM race_results WHERE entry_id = ?').get(entryId) as DBRaceResult | undefined;

    if (existing) {
      // 既存結果を更新
      this.db.prepare(`
        UPDATE race_results SET
          finish_position = COALESCE(?, finish_position),
          finish_status = COALESCE(?, finish_status),
          finish_time = COALESCE(?, finish_time),
          margin = COALESCE(?, margin),
          last_3f_time = COALESCE(?, last_3f_time),
          corner_positions = COALESCE(?, corner_positions)
        WHERE id = ?
      `).run(
        data.finishPosition || null,
        data.finishStatus || null,
        data.finishTime || null,
        data.margin || null,
        data.last3fTime || null,
        data.cornerPositions || null,
        existing.id
      );
      return { id: existing.id, updated: true };
    }

    const stmt = this.db.prepare(`
      INSERT INTO race_results (entry_id, finish_position, finish_status, finish_time, margin, last_3f_time, corner_positions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      entryId,
      data.finishPosition || null,
      data.finishStatus || '完走',
      data.finishTime || null,
      data.margin || null,
      data.last3fTime || null,
      data.cornerPositions || null
    );
    return { id: result.lastInsertRowid as number, updated: false };
  }

  // ============================================
  // 分析用クエリ
  // ============================================

  public getHorseRaceHistory(horseId: number, limit: number = 10): RaceResultDetail[] {
    const stmt = this.db.prepare(`
      SELECT * FROM v_race_results_detail
      WHERE horse_name = (SELECT name FROM horses WHERE id = ?)
      ORDER BY race_date DESC
      LIMIT ?
    `);
    return stmt.all(horseId, limit) as RaceResultDetail[];
  }

  public getSireStats(sireId: number): any {
    return this.db.prepare(`
      SELECT * FROM bloodline_stats WHERE sire_id = ?
    `).all(sireId);
  }

  public getHorseCourseStats(horseId: number): any[] {
    return this.db.prepare(`
      SELECT hcs.*, v.name as venue_name
      FROM horse_course_stats hcs
      JOIN venues v ON hcs.venue_id = v.id
      WHERE hcs.horse_id = ?
    `).all(horseId);
  }

  public getHorseTrackStats(horseId: number): any[] {
    return this.db.prepare(`
      SELECT * FROM horse_track_stats WHERE horse_id = ?
    `).all(horseId);
  }

  // ============================================
  // 集計更新
  // ============================================

  public updateHorseTrackStats(horseId: number, raceType: string, trackCondition: string, finishPosition: number): void {
    const won = finishPosition === 1;
    const placed = finishPosition === 2;
    const showed = finishPosition === 3;

    const stmt = this.db.prepare(`
      INSERT INTO horse_track_stats (horse_id, race_type, track_condition, runs, wins, places, shows)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(horse_id, race_type, track_condition) DO UPDATE SET
        runs = runs + 1,
        wins = wins + ?,
        places = places + ?,
        shows = shows + ?
    `);
    stmt.run(
      horseId, raceType, trackCondition,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0
    );
  }

  public updateHorseCourseStats(
    horseId: number,
    venueId: number,
    raceType: string,
    distanceCategory: string,
    finishPosition: number
  ): void {
    const won = finishPosition === 1;
    const placed = finishPosition === 2;
    const showed = finishPosition === 3;

    const stmt = this.db.prepare(`
      INSERT INTO horse_course_stats (horse_id, venue_id, race_type, distance_category, runs, wins, places, shows)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(horse_id, venue_id, race_type, distance_category) DO UPDATE SET
        runs = runs + 1,
        wins = wins + ?,
        places = places + ?,
        shows = shows + ?
    `);
    stmt.run(
      horseId, venueId, raceType, distanceCategory,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0
    );
  }

  public updateBloodlineStats(sireId: number, raceType: string, distanceCategory: string, trackCondition: string, finishPosition: number): void {
    const won = finishPosition === 1;
    const placed = finishPosition === 2;
    const showed = finishPosition === 3;

    const stmt = this.db.prepare(`
      INSERT INTO bloodline_stats (sire_id, race_type, distance_category, track_condition, runs, wins, places, shows)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(sire_id, race_type, distance_category, track_condition) DO UPDATE SET
        runs = runs + 1,
        wins = wins + ?,
        places = places + ?,
        shows = shows + ?
    `);
    stmt.run(
      sireId, raceType, distanceCategory, trackCondition,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0
    );
  }

  // ============================================
  // スコア操作
  // ============================================

  public updateHorseScore(horseId: number, raceId: number | null, scores: {
    recent_performance_score?: number;
    course_aptitude_score?: number;
    distance_aptitude_score?: number;
    track_condition_score?: number;
    last_3f_ability_score?: number;
    bloodline_score?: number;
    jockey_score?: number;
    rotation_score?: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO horse_scores (
        horse_id, race_id, recent_performance_score, course_aptitude_score,
        distance_aptitude_score, track_condition_score, last_3f_ability_score,
        bloodline_score, jockey_score, rotation_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(horse_id, race_id) DO UPDATE SET
        recent_performance_score = COALESCE(?, recent_performance_score),
        course_aptitude_score = COALESCE(?, course_aptitude_score),
        distance_aptitude_score = COALESCE(?, distance_aptitude_score),
        track_condition_score = COALESCE(?, track_condition_score),
        last_3f_ability_score = COALESCE(?, last_3f_ability_score),
        bloodline_score = COALESCE(?, bloodline_score),
        jockey_score = COALESCE(?, jockey_score),
        rotation_score = COALESCE(?, rotation_score)
    `);
    stmt.run(
      horseId, raceId,
      scores.recent_performance_score, scores.course_aptitude_score,
      scores.distance_aptitude_score, scores.track_condition_score,
      scores.last_3f_ability_score, scores.bloodline_score,
      scores.jockey_score, scores.rotation_score,
      scores.recent_performance_score, scores.course_aptitude_score,
      scores.distance_aptitude_score, scores.track_condition_score,
      scores.last_3f_ability_score, scores.bloodline_score,
      scores.jockey_score, scores.rotation_score
    );
  }

  public getHorseScores(raceId?: number): any[] {
    if (raceId) {
      return this.db.prepare(`
        SELECT hs.*, h.name as horse_name
        FROM horse_scores hs
        JOIN horses h ON hs.horse_id = h.id
        WHERE hs.race_id = ?
        ORDER BY hs.total_score DESC
      `).all(raceId);
    }
    return this.db.prepare(`
      SELECT hs.*, h.name as horse_name
      FROM horse_scores hs
      JOIN horses h ON hs.horse_id = h.id
      ORDER BY hs.total_score DESC
    `).all();
  }

  // ============================================
  // ユーティリティ
  // ============================================

  public getAllRaces(): DBRace[] {
    return this.db.prepare(`
      SELECT r.*, v.name as venue_name
      FROM races r
      JOIN venues v ON r.venue_id = v.id
      ORDER BY r.race_date DESC
    `).all() as DBRace[];
  }

  public getRaceByIdOrName(idOrName: string): DBRace | undefined {
    // 数値の場合はIDで検索
    const numId = parseInt(idOrName, 10);
    if (!isNaN(numId)) {
      return this.db.prepare('SELECT * FROM races WHERE id = ?').get(numId) as DBRace | undefined;
    }
    // 文字列の場合はレース名で検索
    return this.db.prepare('SELECT * FROM races WHERE race_name LIKE ?').get(`%${idOrName}%`) as DBRace | undefined;
  }

  public getRaceEntries(raceId: number): { horse_id: number; horse_name: string; horse_number: number }[] {
    return this.db.prepare(`
      SELECT e.horse_id, h.name as horse_name, e.horse_number
      FROM race_entries e
      JOIN horses h ON e.horse_id = h.id
      WHERE e.race_id = ?
      ORDER BY e.horse_number
    `).all(raceId) as { horse_id: number; horse_name: string; horse_number: number }[];
  }

  public getAllVenues(): DBVenue[] {
    return this.db.prepare('SELECT * FROM venues ORDER BY name').all() as DBVenue[];
  }

  public getAllSires(): DBSire[] {
    return this.db.prepare('SELECT * FROM sires ORDER BY name').all() as DBSire[];
  }

  public getAllTrainers(): DBTrainer[] {
    return this.db.prepare('SELECT * FROM trainers ORDER BY name').all() as DBTrainer[];
  }

  public getAllJockeys(): DBJockey[] {
    return this.db.prepare('SELECT * FROM jockeys ORDER BY name').all() as DBJockey[];
  }

  // ============================================
  // 機械学習用クエリ
  // ============================================

  public getHorseById(horseId: number): DBHorse | undefined {
    return this.db.prepare('SELECT * FROM horses WHERE id = ?').get(horseId) as DBHorse | undefined;
  }

  public getHorseRaceResults(horseId: number): any[] {
    return this.db.prepare(`
      SELECT
        r.id as race_id,
        r.race_name,
        r.race_date,
        r.distance,
        r.race_type,
        r.track_condition,
        v.name as venue_name,
        e.jockey_id,
        e.popularity,
        rr.finish_position,
        rr.finish_time,
        rr.last_3f_time,
        rr.margin as time_diff_seconds
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.horse_id = ?
      ORDER BY r.race_date DESC
    `).all(horseId);
  }

  public getAllRaceResults(): any[] {
    return this.db.prepare(`
      SELECT
        e.horse_id,
        e.race_id,
        rr.finish_position
      FROM race_entries e
      JOIN race_results rr ON rr.entry_id = e.id
      WHERE rr.finish_position IS NOT NULL
    `).all();
  }

  public getJockeyStats(jockeyId: number): any {
    // 騎手の中山G1勝率を計算
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN rr.finish_position <= 3 THEN 1 ELSE 0 END) as places
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.jockey_id = ? AND v.name = '中山'
    `).get(jockeyId) as any;

    const g1Stats = this.db.prepare(`
      SELECT
        COUNT(*) as nakayama_g1_runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as nakayama_g1_wins
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.jockey_id = ?
        AND v.name = '中山'
        AND (r.race_class LIKE '%G1%' OR r.race_class LIKE '%GI%')
    `).get(jockeyId) as any;

    return { ...stats, ...g1Stats };
  }

  public close(): void {
    this.db.close();
  }
}
