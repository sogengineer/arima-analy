/**
 * 馬情報の参照リポジトリ
 *
 * @remarks
 * 馬の詳細情報、レース結果、コース別成績、馬場別成績を取得する。
 * JOINやビューを活用して効率的なデータ取得を行う。
 * バッチ取得メソッド
 */

import type { Database } from 'bun:sqlite';
import type {
  HorseDetail,
  HorseRaceResult,
  CourseStats,
  TrackStats
} from '../../types/RepositoryTypes';
import type { DBHorse } from '../../types/HorseData';
import { DISTANCE_CATEGORY_THRESHOLDS } from '../../constants/DistanceConstants';

export class HorseQueryRepository {
  constructor(private readonly db: Database) {}

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
   *
   * @param horseId - 馬ID
   * @param limit - 取得件数の上限（省略時は全件）
   * @param beforeDate - as-of カットオフ日（YYYY-MM-DD）。
   *   指定時はこの日付「より前」のレースのみ返す（同日レースは除外）。
   *   予測時点で知り得ない情報を混入させない（look-ahead リーク遮断）ために使う。
   *
   * @remarks
   * `limit` はプレースホルダでバインドする（SQL文字列補間をしない）。
   */
  getHorseRaceResults(horseId: number, limit?: number, beforeDate?: string): HorseRaceResult[] {
    const params: (number | string)[] = [horseId];
    let dateCondition = '';
    if (beforeDate) {
      dateCondition = 'AND r.race_date < ?';
      params.push(beforeDate);
    }
    let limitClause = '';
    if (limit != null) {
      limitClause = 'LIMIT ?';
      params.push(limit);
    }

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
        rr.margin_seconds as time_diff_seconds
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.horse_id = ?
      ${dateCondition}
      ORDER BY r.race_date DESC
      ${limitClause}
    `;
    return this.db.prepare(sql).all(...params) as HorseRaceResult[];
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
  getHorsesRaceResultsBatch(horseIds: number[], beforeDate?: string): Map<number, HorseRaceResult[]> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const params: (number | string)[] = [...horseIds];
    let dateCondition = '';
    if (beforeDate) {
      dateCondition = 'AND r.race_date < ?';
      params.push(beforeDate);
    }
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
        rr.margin_seconds as time_diff_seconds
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.horse_id IN (${placeholders})
      ${dateCondition}
      ORDER BY e.horse_id, r.race_date DESC
    `;
    const results = this.db.prepare(sql).all(...params) as (HorseRaceResult & { horse_id: number })[];

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

  // ============================================================
  // as-of 集計（リーク遮断用）
  // ============================================================

  /**
   * 複数馬のコース別成績を as-of 集計で取得
   *
   * @remarks
   * `horse_course_stats` 集計テーブルは「現時点の全結果」で作られているため、
   * 過去レースの評価に使うと未来の結果が混入する（look-ahead リーク）。
   * このメソッドは `race_results` から指定日より前の結果だけを都度集計する。
   *
   * 集計テーブルと同じ意味論:
   * - runs   = 着順が確定した出走数
   * - wins   = 1着数
   * - places = 2着数
   * - shows  = 3着数
   *
   * @param horseIds - 馬IDの配列
   * @param beforeDate - as-of カットオフ日（YYYY-MM-DD）。この日付より前の結果のみ集計
   * @returns コース別成績のMap（horseId → CourseStats[]）
   */
  getHorsesCourseStatsAsOf(horseIds: number[], beforeDate: string): Map<number, CourseStats[]> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const sql = buildHorsesCourseStatsAsOfSql(placeholders);
    const results = this.db.prepare(sql)
      .all(...horseIds, beforeDate) as (CourseStats & { horse_id: number })[];

    return groupByHorseId(horseIds, results);
  }

  /**
   * 複数馬の馬場別成績を as-of 集計で取得
   *
   * @remarks
   * `horse_track_stats` 集計テーブルの代替。指定日より前の結果だけを集計する。
   *
   * @param horseIds - 馬IDの配列
   * @param beforeDate - as-of カットオフ日（YYYY-MM-DD）
   * @returns 馬場別成績のMap（horseId → TrackStats[]）
   */
  getHorsesTrackStatsAsOf(horseIds: number[], beforeDate: string): Map<number, TrackStats[]> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const results = this.db.prepare(`
      SELECT
        e.horse_id,
        r.race_type,
        r.track_condition,
        COUNT(*) AS runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) AS places,
        SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) AS shows,
        AVG(rr.finish_position) AS avg_finish_position
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.horse_id IN (${placeholders})
        AND rr.finish_position IS NOT NULL
        AND rr.finish_position >= 1
        AND r.race_date < ?
      GROUP BY e.horse_id, r.race_type, r.track_condition
    `).all(...horseIds, beforeDate) as (TrackStats & { horse_id: number })[];

    return groupByHorseId(horseIds, results);
  }

  /**
   * 複数馬の「前走」を as-of で取得
   *
   * @remarks
   * 指定日より前で最も新しい、着順が確定したレースを1件返す。
   * ML の前走系特徴量に使用する。
   *
   * @param horseIds - 馬IDの配列
   * @param beforeDate - as-of カットオフ日（YYYY-MM-DD）
   * @returns 前走のMap（horseId → PreviousRaceRow）。前走が無い馬はキーを持たない
   */
  getPreviousRacesAsOf(horseIds: number[], beforeDate: string): Map<number, PreviousRaceRow> {
    if (horseIds.length === 0) return new Map();

    const placeholders = horseIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT
        e.horse_id,
        r.race_date,
        r.distance,
        r.race_type,
        e.popularity,
        e.horse_weight,
        rr.finish_position,
        rr.last_3f_time,
        rr.margin_seconds,
        r.total_horses
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.horse_id IN (${placeholders})
        AND rr.finish_position IS NOT NULL
        AND rr.finish_position >= 1
        AND r.race_date < ?
      ORDER BY e.horse_id, r.race_date DESC
    `).all(...horseIds, beforeDate) as PreviousRaceRow[];

    const map = new Map<number, PreviousRaceRow>();
    for (const row of rows) {
      // 日付降順なので最初に現れたものが前走
      if (!map.has(row.horse_id)) {
        map.set(row.horse_id, row);
      }
    }
    return map;
  }
}

/** as-of で取得した前走レコード */
export interface PreviousRaceRow {
  horse_id: number;
  race_date: string;
  distance: number;
  race_type?: string;
  popularity?: number;
  horse_weight?: number;
  finish_position: number;
  last_3f_time?: number;
  margin_seconds?: number;
  total_horses?: number;
}

/**
 * 距離カテゴリのSQL式
 *
 * @remarks
 * `getDistanceCategory()`（TS側の判定）と閾値を共有する。
 */
const DISTANCE_CATEGORY_SQL = `
  CASE
    WHEN r.distance < ${DISTANCE_CATEGORY_THRESHOLDS.sprint} THEN '短距離'
    WHEN r.distance < ${DISTANCE_CATEGORY_THRESHOLDS.mile} THEN 'マイル'
    WHEN r.distance < ${DISTANCE_CATEGORY_THRESHOLDS.middle} THEN '中距離'
    ELSE '長距離'
  END`;

/**
 * コース別 as-of 集計の SQL を組み立てる
 *
 * @param placeholders - 馬IDのバインドプレースホルダ（`?,?,...`）
 */
function buildHorsesCourseStatsAsOfSql(placeholders: string): string {
  return `
      SELECT
        e.horse_id,
        r.venue_id,
        v.name AS venue_name,
        r.race_type,
        ${DISTANCE_CATEGORY_SQL} AS distance_category,
        COUNT(*) AS runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) AS places,
        SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) AS shows,
        AVG(rr.finish_position) AS avg_finish_position
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.horse_id IN (${placeholders})
        AND rr.finish_position IS NOT NULL
        AND rr.finish_position >= 1
        AND r.race_date < ?
      GROUP BY e.horse_id, r.venue_id, v.name, r.race_type, distance_category
    `;
}

/** horse_id ごとに行をまとめる */
function groupByHorseId<T extends { horse_id: number }>(
  horseIds: number[],
  rows: T[]
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const horseId of horseIds) {
    map.set(horseId, []);
  }
  for (const row of rows) {
    map.get(row.horse_id)?.push(row);
  }
  return map;
}
