/**
 * 馬情報の取得リポジトリ
 * JOINでまとめて取得
 */

import type Database from 'better-sqlite3';
import type {
  HorseDetail,
  HorseRaceResult,
  CourseStats,
  TrackStats
} from '../../types/RepositoryTypes';
import type { DBHorse } from '../../types/HorseData';

export class HorseQueryRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * 馬詳細を取得（血統・調教師・馬主含む）
   * v_horse_details ビューを使用
   */
  getHorseWithDetails(horseId: number): HorseDetail | undefined {
    return this.db.prepare(
      'SELECT * FROM v_horse_details WHERE id = ?'
    ).get(horseId) as HorseDetail | undefined;
  }

  /**
   * 全馬の詳細を取得
   */
  getAllHorsesWithDetails(): HorseDetail[] {
    return this.db.prepare(
      'SELECT * FROM v_horse_details ORDER BY name'
    ).all() as HorseDetail[];
  }

  /**
   * 馬をIDで取得
   */
  getHorseById(horseId: number): DBHorse | undefined {
    return this.db.prepare(
      'SELECT * FROM horses WHERE id = ?'
    ).get(horseId) as DBHorse | undefined;
  }

  /**
   * 馬を名前で取得
   */
  getHorseByName(name: string): DBHorse | undefined {
    return this.db.prepare(
      'SELECT * FROM horses WHERE name = ?'
    ).get(name) as DBHorse | undefined;
  }

  /**
   * 馬名 + 父名 + 母名 で馬を検索（同姓同名馬の区別用）
   */
  getHorseByNameAndBloodline(
    name: string,
    sireName?: string,
    mareName?: string
  ): DBHorse | undefined {
    return this.db.prepare(`
      SELECT h.* FROM horses h
      LEFT JOIN sires s ON h.sire_id = s.id
      LEFT JOIN mares m ON h.mare_id = m.id
      WHERE h.name = ?
        AND (? IS NULL OR s.name = ?)
        AND (? IS NULL OR m.name = ?)
    `).get(
      name,
      sireName ?? null, sireName ?? null,
      mareName ?? null, mareName ?? null
    ) as DBHorse | undefined;
  }

  /**
   * 全馬を取得
   */
  getAllHorses(): DBHorse[] {
    return this.db.prepare(
      'SELECT * FROM horses ORDER BY name'
    ).all() as DBHorse[];
  }

  /**
   * 馬のレース結果を取得（レース情報・騎手情報含む）
   * 日付降順でソート
   */
  getHorseRaceResults(horseId: number, limit?: number): HorseRaceResult[] {
    const sql = `
      SELECT
        r.id as race_id,
        r.race_name,
        r.race_date,
        r.race_class,
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
      ${limit ? `LIMIT ${limit}` : ''}
    `;
    return this.db.prepare(sql).all(horseId) as HorseRaceResult[];
  }

  /**
   * 馬のコース別成績を取得
   */
  getHorseCourseStats(horseId: number): CourseStats[] {
    return this.db.prepare(`
      SELECT hcs.*, v.name as venue_name
      FROM horse_course_stats hcs
      JOIN venues v ON hcs.venue_id = v.id
      WHERE hcs.horse_id = ?
    `).all(horseId) as CourseStats[];
  }

  /**
   * 馬の馬場別成績を取得
   */
  getHorseTrackStats(horseId: number): TrackStats[] {
    return this.db.prepare(`
      SELECT * FROM horse_track_stats WHERE horse_id = ?
    `).all(horseId) as TrackStats[];
  }

  /**
   * 馬のレース履歴を取得（詳細ビュー使用）
   */
  getHorseRaceHistory(horseId: number, limit: number = 10): any[] {
    return this.db.prepare(`
      SELECT * FROM v_race_results_detail
      WHERE horse_name = (SELECT name FROM horses WHERE id = ?)
      ORDER BY race_date DESC
      LIMIT ?
    `).all(horseId, limit);
  }

  /**
   * 馬の直近の騎手IDを取得
   */
  getRecentJockeyForHorse(horseId: number): number | null {
    const result = this.db.prepare(`
      SELECT e.jockey_id
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      WHERE e.horse_id = ? AND e.jockey_id IS NOT NULL
      ORDER BY r.race_date DESC
      LIMIT 1
    `).get(horseId) as { jockey_id: number } | undefined;
    return result?.jockey_id ?? null;
  }
}
