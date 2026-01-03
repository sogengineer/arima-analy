/**
 * 馬情報の参照リポジトリ
 *
 * @remarks
 * 馬の詳細情報、レース結果、コース別成績、馬場別成績を取得する。
 * JOINやビューを活用して効率的なデータ取得を行う。
 * バッチ取得メソッド
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
   *
   * @param horseId - 馬ID
   * @returns 直近レースの騎手ID、存在しない場合はnull
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

  // ============================================================
  // バッチ取得メソッド
  // ============================================================

  /**
   * 複数馬の詳細情報を一括取得
   *
   * @param horseIds - 馬IDの配列
   * @returns 馬詳細のMap（horseId → HorseDetail）
   *
   * @example
   * ```typescript
   * const detailsMap = repo.getHorsesWithDetailsBatch([1, 2, 3]);
   * const horse1 = detailsMap.get(1);
   * ```
   */
  getHorsesWithDetailsBatch(horseIds: number[]): Map<number, HorseDetail> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const results = this.db.prepare(
      `SELECT * FROM v_horse_details WHERE id IN (${placeholders})`
    ).all(...horseIds) as HorseDetail[];

    const map = new Map<number, HorseDetail>();
    for (const detail of results) {
      if (detail.id != null) {
        map.set(detail.id, detail);
      }
    }
    return map;
  }

  /**
   * 複数馬のレース結果を一括取得
   *
   * @param horseIds - 馬IDの配列
   * @returns レース結果のMap（horseId → HorseRaceResult[]）
   *
   * @example
   * ```typescript
   * const resultsMap = repo.getHorsesRaceResultsBatch([1, 2, 3]);
   * const horse1Results = resultsMap.get(1) ?? [];
   * ```
   */
  getHorsesRaceResultsBatch(horseIds: number[]): Map<number, HorseRaceResult[]> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const sql = `
      SELECT
        e.horse_id,
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
      WHERE e.horse_id IN (${placeholders})
      ORDER BY e.horse_id, r.race_date DESC
    `;
    const results = this.db.prepare(sql).all(...horseIds) as (HorseRaceResult & { horse_id: number })[];

    const map = new Map<number, HorseRaceResult[]>();
    for (const horseId of horseIds) {
      map.set(horseId, []);
    }
    for (const result of results) {
      const list = map.get(result.horse_id);
      if (list) {
        list.push(result);
      }
    }
    return map;
  }

  /**
   * 複数馬のコース別成績を一括取得
   *
   * @param horseIds - 馬IDの配列
   * @returns コース別成績のMap（horseId → CourseStats[]）
   */
  getHorsesCourseStatsBatch(horseIds: number[]): Map<number, CourseStats[]> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const results = this.db.prepare(`
      SELECT hcs.*, v.name as venue_name
      FROM horse_course_stats hcs
      JOIN venues v ON hcs.venue_id = v.id
      WHERE hcs.horse_id IN (${placeholders})
    `).all(...horseIds) as (CourseStats & { horse_id: number })[];

    const map = new Map<number, CourseStats[]>();
    for (const horseId of horseIds) {
      map.set(horseId, []);
    }
    for (const stat of results) {
      const list = map.get(stat.horse_id);
      if (list) {
        list.push(stat);
      }
    }
    return map;
  }

  /**
   * 複数馬の馬場別成績を一括取得
   *
   * @param horseIds - 馬IDの配列
   * @returns 馬場別成績のMap（horseId → TrackStats[]）
   */
  getHorsesTrackStatsBatch(horseIds: number[]): Map<number, TrackStats[]> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const results = this.db.prepare(`
      SELECT * FROM horse_track_stats WHERE horse_id IN (${placeholders})
    `).all(...horseIds) as (TrackStats & { horse_id: number })[];

    const map = new Map<number, TrackStats[]>();
    for (const horseId of horseIds) {
      map.set(horseId, []);
    }
    for (const stat of results) {
      const list = map.get(stat.horse_id);
      if (list) {
        list.push(stat);
      }
    }
    return map;
  }
}
