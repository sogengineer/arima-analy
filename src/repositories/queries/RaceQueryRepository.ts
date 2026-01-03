/**
 * レース情報の取得リポジトリ
 * JOINでまとめて取得
 */

import type Database from 'better-sqlite3';
import type { RaceWithVenue, EntryWithDetails } from '../../types/RepositoryTypes';
import type { DBRace, DBVenue } from '../../types/HorseData';

export class RaceQueryRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * レースを取得（会場名付き）
   */
  getRaceWithVenue(raceId: number): RaceWithVenue | undefined {
    return this.db.prepare(`
      SELECT r.*, v.name as venue_name
      FROM races r
      JOIN venues v ON r.venue_id = v.id
      WHERE r.id = ?
    `).get(raceId) as RaceWithVenue | undefined;
  }

  /**
   * レースをIDで取得
   */
  getRaceById(raceId: number): DBRace | undefined {
    return this.db.prepare(
      'SELECT * FROM races WHERE id = ?'
    ).get(raceId) as DBRace | undefined;
  }

  /**
   * レースをIDまたは名前で取得
   */
  getRaceByIdOrName(idOrName: string): DBRace | undefined {
    // 数値の場合はIDで検索
    const numId = parseInt(idOrName, 10);
    if (!isNaN(numId)) {
      return this.db.prepare(
        'SELECT * FROM races WHERE id = ?'
      ).get(numId) as DBRace | undefined;
    }
    // 文字列の場合はレース名で検索
    return this.db.prepare(
      'SELECT * FROM races WHERE race_name LIKE ?'
    ).get(`%${idOrName}%`) as DBRace | undefined;
  }

  /**
   * 全レースを取得（会場名付き、日付降順）
   */
  getAllRaces(): RaceWithVenue[] {
    return this.db.prepare(`
      SELECT r.*, v.name as venue_name
      FROM races r
      JOIN venues v ON r.venue_id = v.id
      ORDER BY r.race_date DESC
    `).all() as RaceWithVenue[];
  }

  /**
   * レースの出走馬を取得（馬情報・騎手情報付き）
   */
  getRaceEntries(raceId: number): EntryWithDetails[] {
    return this.db.prepare(`
      SELECT
        e.*,
        h.name as horse_name,
        s.name as sire_name,
        m.name as mare_name,
        h.trainer_id,
        t.name as trainer_name,
        j.name as jockey_name
      FROM race_entries e
      JOIN horses h ON e.horse_id = h.id
      LEFT JOIN sires s ON h.sire_id = s.id
      LEFT JOIN mares m ON h.mare_id = m.id
      LEFT JOIN trainers t ON h.trainer_id = t.id
      LEFT JOIN jockeys j ON e.jockey_id = j.id
      WHERE e.race_id = ?
      ORDER BY e.horse_number
    `).all(raceId) as EntryWithDetails[];
  }

  /**
   * レースの出走馬を簡易取得
   */
  getRaceEntriesSimple(raceId: number): {
    horse_id: number;
    horse_name: string;
    horse_number: number;
    jockey_id?: number;
    trainer_id?: number;
  }[] {
    return this.db.prepare(`
      SELECT e.horse_id, h.name as horse_name, e.horse_number, e.jockey_id, h.trainer_id
      FROM race_entries e
      JOIN horses h ON e.horse_id = h.id
      WHERE e.race_id = ?
      ORDER BY e.horse_number
    `).all(raceId) as {
      horse_id: number;
      horse_name: string;
      horse_number: number;
      jockey_id?: number;
      trainer_id?: number;
    }[];
  }

  /**
   * 全会場を取得
   */
  getAllVenues(): DBVenue[] {
    return this.db.prepare(
      'SELECT * FROM venues ORDER BY name'
    ).all() as DBVenue[];
  }

  /**
   * 全レース結果を取得（機械学習用）
   */
  getAllRaceResults(): { horse_id: number; race_id: number; finish_position: number }[] {
    return this.db.prepare(`
      SELECT
        e.horse_id,
        e.race_id,
        rr.finish_position
      FROM race_entries e
      JOIN race_results rr ON rr.entry_id = e.id
      WHERE rr.finish_position IS NOT NULL
    `).all() as { horse_id: number; race_id: number; finish_position: number }[];
  }

  /**
   * 結果があるレースを取得（バックテスト用）
   *
   * @param gradeOnly - 重賞のみに限定するか
   */
  getRacesWithResults(gradeOnly: boolean = false): RaceWithVenue[] {
    const gradeCondition = gradeOnly
      ? "AND (r.race_class LIKE '%G1%' OR r.race_class LIKE '%G2%' OR r.race_class LIKE '%G3%' OR r.race_name LIKE '%記念%')"
      : '';

    return this.db.prepare(`
      SELECT DISTINCT r.*, v.name as venue_name
      FROM races r
      JOIN venues v ON r.venue_id = v.id
      JOIN race_entries e ON e.race_id = r.id
      JOIN race_results rr ON rr.entry_id = e.id
      WHERE rr.finish_position IS NOT NULL
      ${gradeCondition}
      ORDER BY r.race_date DESC
    `).all() as RaceWithVenue[];
  }

  /**
   * レースの結果を取得
   */
  getRaceResults(raceId: number): {
    horse_id: number;
    horse_name: string;
    horse_number: number;
    finish_position: number | null;
    finish_time?: string;
    last_3f_time?: number;
  }[] {
    return this.db.prepare(`
      SELECT
        e.horse_id,
        h.name as horse_name,
        e.horse_number,
        rr.finish_position,
        rr.finish_time,
        rr.last_3f_time
      FROM race_entries e
      JOIN horses h ON e.horse_id = h.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.race_id = ?
      ORDER BY COALESCE(rr.finish_position, 999)
    `).all(raceId) as {
      horse_id: number;
      horse_name: string;
      horse_number: number;
      finish_position: number | null;
      finish_time?: string;
      last_3f_time?: number;
    }[];
  }
}
