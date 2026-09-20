/**
 * 馬情報の参照リポジトリ
 *
 * @remarks
 * 馬の詳細情報、レース結果、コース別成績、馬場別成績を取得する。
 * JOINやビューを活用して効率的なデータ取得を行う。
 * バッチ取得メソッド
 */

import type { Database } from 'bun:sqlite';
import { sql, type NotNull, type Selectable } from 'kysely';
import { queryBuilder, selectRow, selectRows } from '../../database/QueryRunner';
import type { HorseDetailsView, HorsesTable } from '../../database/schema';
import type {
  HorseRaceResult,
  CourseStats,
  TrackStats
} from '../../types/RepositoryTypes';
import {
  DISTANCE_CATEGORY_THRESHOLDS,
  getDistanceCategory
} from '../../constants/DistanceConstants';

/** 馬詳細ビュー（`v_horse_details`）の 1 行 */
export type HorseDetailRow = Selectable<HorseDetailsView>;

/** 着順ごとの本数を数える CASE 式で使う着順（1着 / 2着 / 3着） */
const FINISH_POSITIONS = { wins: 1, places: 2, shows: 3 } as const;

/** 着順が確定した出走とみなす最小の着順 */
const MIN_VALID_FINISH_POSITION = 1;

/**
 * 距離カテゴリの SQL 式
 *
 * @remarks
 * ラベルは `getDistanceCategory()`（TS 側の判定）から引くので、閾値もラベルも TS 側と必ず一致する。
 * 閾値・ラベルはバインドパラメータとして渡す（SQL 本文に値を埋め込まない）。
 */
const DISTANCE_CATEGORY = sql<string>`case
  when ${sql.ref('r.distance')} < ${DISTANCE_CATEGORY_THRESHOLDS.sprint} then ${getDistanceCategory(0)}
  when ${sql.ref('r.distance')} < ${DISTANCE_CATEGORY_THRESHOLDS.mile} then ${getDistanceCategory(DISTANCE_CATEGORY_THRESHOLDS.sprint)}
  when ${sql.ref('r.distance')} < ${DISTANCE_CATEGORY_THRESHOLDS.middle} then ${getDistanceCategory(DISTANCE_CATEGORY_THRESHOLDS.mile)}
  else ${getDistanceCategory(DISTANCE_CATEGORY_THRESHOLDS.middle)}
end`;

/** 馬のレース結果として返す列 */
const RACE_RESULT_COLUMNS = [
  'r.id as race_id',
  'r.race_name',
  'r.race_date',
  'r.race_class',
  'r.distance',
  'r.race_type',
  'r.track_condition',
  'v.name as venue_name',
  'e.jockey_id',
  'e.popularity',
  'rr.finish_position',
  'rr.finish_time',
  'rr.last_3f_time',
  'rr.margin_seconds as time_diff_seconds'
] as const;

/** 馬のレース結果（レース・会場・着順）を引く共通の JOIN */
function raceResultsBaseQuery() {
  return queryBuilder
    .selectFrom('race_entries as e')
    .innerJoin('races as r', 'r.id', 'e.race_id')
    .innerJoin('venues as v', 'v.id', 'r.venue_id')
    .leftJoin('race_results as rr', 'rr.entry_id', 'e.id');
}

function horseRaceResultsQuery(horseId: number, limit?: number, beforeDate?: string) {
  let query = raceResultsBaseQuery()
    .select([...RACE_RESULT_COLUMNS])
    .where('e.horse_id', '=', horseId)
    .orderBy('r.race_date', 'desc');

  if (beforeDate) {
    query = query.where('r.race_date', '<', beforeDate);
  }
  if (limit != null) {
    query = query.limit(limit);
  }

  return query.compile();
}

function horsesRaceResultsQuery(horseIds: number[], beforeDate?: string) {
  let query = raceResultsBaseQuery()
    .select(['e.horse_id', ...RACE_RESULT_COLUMNS])
    .where('e.horse_id', 'in', horseIds)
    .orderBy('e.horse_id')
    .orderBy('r.race_date', 'desc');

  if (beforeDate) {
    query = query.where('r.race_date', '<', beforeDate);
  }

  return query.compile();
}

/** 着順が確定した出走だけを、指定日より前に絞る（同日は含めない） */
function finishedEntriesAsOf(horseIds: number[], beforeDate: string) {
  return queryBuilder
    .selectFrom('race_entries as e')
    .innerJoin('races as r', 'r.id', 'e.race_id')
    .innerJoin('race_results as rr', 'rr.entry_id', 'e.id')
    .where('e.horse_id', 'in', horseIds)
    .where('rr.finish_position', 'is not', null)
    .where('rr.finish_position', '>=', MIN_VALID_FINISH_POSITION)
    .where('r.race_date', '<', beforeDate);
}

function horsesCourseStatsAsOfQuery(horseIds: number[], beforeDate: string) {
  return finishedEntriesAsOf(horseIds, beforeDate)
    .innerJoin('venues as v', 'v.id', 'r.venue_id')
    .select(eb => [
      'e.horse_id',
      'r.venue_id',
      'v.name as venue_name',
      'r.race_type',
      DISTANCE_CATEGORY.as('distance_category'),
      eb.fn.countAll<number>().as('runs'),
      eb.fn
        .sum<number>(eb.case().when('rr.finish_position', '=', FINISH_POSITIONS.wins).then(1).else(0).end())
        .as('wins'),
      eb.fn
        .sum<number>(eb.case().when('rr.finish_position', '=', FINISH_POSITIONS.places).then(1).else(0).end())
        .as('places'),
      eb.fn
        .sum<number>(eb.case().when('rr.finish_position', '=', FINISH_POSITIONS.shows).then(1).else(0).end())
        .as('shows'),
      eb.fn.avg<number>('rr.finish_position').as('avg_finish_position')
    ])
    .groupBy(['e.horse_id', 'r.venue_id', 'v.name', 'r.race_type', DISTANCE_CATEGORY])
    .compile();
}

function horsesTrackStatsAsOfQuery(horseIds: number[], beforeDate: string) {
  return finishedEntriesAsOf(horseIds, beforeDate)
    .select(eb => [
      'e.horse_id',
      'r.race_type',
      'r.track_condition',
      eb.fn.countAll<number>().as('runs'),
      eb.fn
        .sum<number>(eb.case().when('rr.finish_position', '=', FINISH_POSITIONS.wins).then(1).else(0).end())
        .as('wins'),
      eb.fn
        .sum<number>(eb.case().when('rr.finish_position', '=', FINISH_POSITIONS.places).then(1).else(0).end())
        .as('places'),
      eb.fn
        .sum<number>(eb.case().when('rr.finish_position', '=', FINISH_POSITIONS.shows).then(1).else(0).end())
        .as('shows'),
      eb.fn.avg<number>('rr.finish_position').as('avg_finish_position')
    ])
    .groupBy(['e.horse_id', 'r.race_type', 'r.track_condition'])
    .compile();
}

function previousRacesAsOfQuery(horseIds: number[], beforeDate: string) {
  return finishedEntriesAsOf(horseIds, beforeDate)
    .select([
      'e.horse_id',
      'r.race_date',
      'r.distance',
      'r.race_type',
      'e.popularity',
      'e.horse_weight',
      'rr.finish_position',
      'rr.last_3f_time',
      'rr.margin_seconds',
      'r.total_horses'
    ])
    // 着順が NULL の行は where で除いてあるので、型の上でも NULL を外す
    .$narrowType<{ finish_position: NotNull }>()
    .orderBy('e.horse_id')
    .orderBy('r.race_date', 'desc')
    .compile();
}

export class HorseQueryRepository {
  constructor(private readonly db: Database) {}

  /**
   * 馬詳細を取得（血統・調教師・馬主含む）
   * v_horse_details ビューを使用
   *
   * @returns 該当が無ければ null
   */
  getHorseWithDetails(horseId: number): HorseDetailRow | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('v_horse_details').selectAll().where('id', '=', horseId).compile()
    );
  }

  /**
   * 全馬の詳細を取得
   */
  getAllHorsesWithDetails(): HorseDetailRow[] {
    return selectRows(
      this.db,
      queryBuilder.selectFrom('v_horse_details').selectAll().orderBy('name').compile()
    );
  }

  /**
   * 馬をIDで取得
   *
   * @returns 該当が無ければ null
   */
  getHorseById(horseId: number): Selectable<HorsesTable> | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('horses').selectAll().where('id', '=', horseId).compile()
    );
  }

  /**
   * 馬を名前で取得
   *
   * @returns 該当が無ければ null
   */
  getHorseByName(name: string): Selectable<HorsesTable> | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('horses').selectAll().where('name', '=', name).compile()
    );
  }

  /**
   * 馬名 + 父名 + 母名 で馬を検索（同姓同名馬の区別用）
   *
   * @remarks
   * 父名・母名は指定されたものだけを条件に足す（省略時はその条件を課さない）。
   *
   * @returns 該当が無ければ null
   */
  getHorseByNameAndBloodline(
    name: string,
    sireName?: string,
    mareName?: string
  ): Selectable<HorsesTable> | null {
    let query = queryBuilder
      .selectFrom('horses as h')
      .leftJoin('sires as s', 's.id', 'h.sire_id')
      .leftJoin('mares as m', 'm.id', 'h.mare_id')
      .selectAll('h')
      .where('h.name', '=', name);

    if (sireName != null) {
      query = query.where('s.name', '=', sireName);
    }
    if (mareName != null) {
      query = query.where('m.name', '=', mareName);
    }

    return selectRow(this.db, query.compile());
  }

  /**
   * 全馬を取得
   */
  getAllHorses(): Selectable<HorsesTable>[] {
    return selectRows(this.db, queryBuilder.selectFrom('horses').selectAll().orderBy('name').compile());
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
   * `limit` も `beforeDate` もバインドパラメータとして渡る（SQL文字列補間をしない）。
   */
  getHorseRaceResults(horseId: number, limit?: number, beforeDate?: string): HorseRaceResult[] {
    return selectRows(this.db, horseRaceResultsQuery(horseId, limit, beforeDate));
  }

  /**
   * 馬のコース別成績を取得
   */
  getHorseCourseStats(horseId: number): CourseStats[] {
    return selectRows(this.db, horseCourseStatsQuery([horseId]));
  }

  /**
   * 馬の馬場別成績を取得
   */
  getHorseTrackStats(horseId: number): TrackStats[] {
    return selectRows(this.db, horseTrackStatsQuery([horseId]));
  }

  // ============================================================
  // バッチ取得メソッド
  // ============================================================

  /**
   * 複数馬の詳細情報を一括取得
   *
   * @param horseIds - 馬IDの配列
   * @returns 馬詳細のMap（horseId → 馬詳細）
   *
   * @example
   * ```typescript
   * const detailsMap = repo.getHorsesWithDetailsBatch([1, 2, 3]);
   * const horse1 = detailsMap.get(1);
   * ```
   */
  getHorsesWithDetailsBatch(horseIds: number[]): Map<number, HorseDetailRow> {
    if (horseIds.length === 0) return new Map();

    const results = selectRows(
      this.db,
      queryBuilder.selectFrom('v_horse_details').selectAll().where('id', 'in', horseIds).compile()
    );

    const map = new Map<number, HorseDetailRow>();
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

    return groupByHorseId(horseIds, selectRows(this.db, horsesRaceResultsQuery(horseIds, beforeDate)));
  }

  /**
   * 複数馬のコース別成績を一括取得
   *
   * @param horseIds - 馬IDの配列
   * @returns コース別成績のMap（horseId → CourseStats[]）
   */
  getHorsesCourseStatsBatch(horseIds: number[]): Map<number, CourseStats[]> {
    if (horseIds.length === 0) return new Map();

    return groupByHorseId(horseIds, selectRows(this.db, horseCourseStatsQuery(horseIds)));
  }

  /**
   * 複数馬の馬場別成績を一括取得
   *
   * @param horseIds - 馬IDの配列
   * @returns 馬場別成績のMap（horseId → TrackStats[]）
   */
  getHorsesTrackStatsBatch(horseIds: number[]): Map<number, TrackStats[]> {
    if (horseIds.length === 0) return new Map();

    return groupByHorseId(horseIds, selectRows(this.db, horseTrackStatsQuery(horseIds)));
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

    return groupByHorseId(
      horseIds,
      selectRows(this.db, horsesCourseStatsAsOfQuery(horseIds, beforeDate))
    );
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

    return groupByHorseId(
      horseIds,
      selectRows(this.db, horsesTrackStatsAsOfQuery(horseIds, beforeDate))
    );
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

    const rows = selectRows(this.db, previousRacesAsOfQuery(horseIds, beforeDate));

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
  race_type?: string | null;
  popularity?: number | null;
  horse_weight?: number | null;
  finish_position: number;
  last_3f_time?: number | null;
  margin_seconds?: number | null;
  total_horses?: number | null;
}

/** 集計テーブルのコース別成績（会場名付き） */
function horseCourseStatsQuery(horseIds: number[]) {
  return queryBuilder
    .selectFrom('horse_course_stats as hcs')
    .innerJoin('venues as v', 'v.id', 'hcs.venue_id')
    .selectAll('hcs')
    .select('v.name as venue_name')
    .where('hcs.horse_id', 'in', horseIds)
    .compile();
}

/** 集計テーブルの馬場別成績 */
function horseTrackStatsQuery(horseIds: number[]) {
  return queryBuilder
    .selectFrom('horse_track_stats')
    .selectAll()
    .where('horse_id', 'in', horseIds)
    .compile();
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
