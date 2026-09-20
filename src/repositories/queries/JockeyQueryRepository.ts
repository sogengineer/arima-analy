/**
 * 騎手統計の取得リポジトリ
 */

import type { Database } from 'bun:sqlite';
import type { Selectable } from 'kysely';
import { queryBuilder, selectRow, selectRows } from '../../database/QueryRunner';
import type { JockeysTable, TrainersTable } from '../../database/schema';
import type {
  JockeyVenueStats,
  JockeyOverallStats,
  JockeyTrainerComboStats
} from '../../types/RepositoryTypes';

/**
 * 成績集計の共通条件
 *
 * @remarks
 * - 着順が確定した出走だけを分母にする（出走登録だけの行を数えない）。
 *   これは as-of の有無に関わらず常に付ける。付けたり付けなかったりすると
 *   同じ「勝率」が呼び出し経路によって別物になる。
 * - `beforeDate` を指定した場合はさらに、**指定日より前**のレースだけを対象にする
 *   （同日は含めない。未来のレース＝リーク源を除外する）。条件はビルダーの再代入で足し、
 *   値は Kysely がバインドパラメータとして渡すので、SQL 本文に日付が混ざることはない。
 * - `SUM(CASE ...)` は対象行が 0 件のとき SQLite の仕様で NULL を返す（COUNT の 0 と揃わない）。
 *   既存の呼び出し側がこの戻り方に依存しているため、型上は `number` のまま変えていない。
 */

/** 着順ごとの本数を数える CASE 式（1着 / 2着 / 3着） */
const FINISH_POSITIONS = { wins: 1, places: 2, shows: 3 } as const;

function jockeyVenueStatsQuery(jockeyId: number, venueName: string, beforeDate?: string) {
  let query = queryBuilder
    .selectFrom('race_entries')
    .innerJoin('races', 'races.id', 'race_entries.race_id')
    .innerJoin('venues', 'venues.id', 'races.venue_id')
    .leftJoin('race_results', 'race_results.entry_id', 'race_entries.id')
    .select(eb => [
      eb.fn.countAll<number>().as('total_runs'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.wins).then(1).else(0).end())
        .as('wins'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.places).then(1).else(0).end())
        .as('places'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.shows).then(1).else(0).end())
        .as('shows')
    ])
    .where('race_entries.jockey_id', '=', jockeyId)
    .where('venues.name', '=', venueName)
    .where('race_results.finish_position', 'is not', null);

  if (beforeDate !== undefined) {
    query = query.where('races.race_date', '<', beforeDate);
  }

  return query.compile();
}

function jockeyVenueG1StatsQuery(jockeyId: number, venueName: string, beforeDate?: string) {
  let query = queryBuilder
    .selectFrom('race_entries')
    .innerJoin('races', 'races.id', 'race_entries.race_id')
    .innerJoin('venues', 'venues.id', 'races.venue_id')
    .leftJoin('race_results', 'race_results.entry_id', 'race_entries.id')
    .select(eb => [
      eb.fn.countAll<number>().as('venue_g1_runs'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.wins).then(1).else(0).end())
        .as('venue_g1_wins')
    ])
    .where('race_entries.jockey_id', '=', jockeyId)
    .where('venues.name', '=', venueName)
    .where(eb => eb.or([eb('races.race_class', 'like', '%G1%'), eb('races.race_class', 'like', '%GI%')]))
    .where('race_results.finish_position', 'is not', null);

  if (beforeDate !== undefined) {
    query = query.where('races.race_date', '<', beforeDate);
  }

  return query.compile();
}

function jockeyOverallStatsQuery(jockeyId: number, beforeDate?: string) {
  let query = queryBuilder
    .selectFrom('race_entries')
    .innerJoin('races', 'races.id', 'race_entries.race_id')
    .leftJoin('race_results', 'race_results.entry_id', 'race_entries.id')
    .select(eb => [
      eb.fn.countAll<number>().as('total_runs'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.wins).then(1).else(0).end())
        .as('wins'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.places).then(1).else(0).end())
        .as('places'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.shows).then(1).else(0).end())
        .as('shows')
    ])
    .where('race_entries.jockey_id', '=', jockeyId)
    .where('race_results.finish_position', 'is not', null);

  if (beforeDate !== undefined) {
    query = query.where('races.race_date', '<', beforeDate);
  }

  return query.compile();
}

function jockeyOverallG1StatsQuery(jockeyId: number, beforeDate?: string) {
  let query = queryBuilder
    .selectFrom('race_entries')
    .innerJoin('races', 'races.id', 'race_entries.race_id')
    .leftJoin('race_results', 'race_results.entry_id', 'race_entries.id')
    .select(eb => [
      eb.fn.countAll<number>().as('g1_runs'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.wins).then(1).else(0).end())
        .as('g1_wins')
    ])
    .where('race_entries.jockey_id', '=', jockeyId)
    .where(eb => eb.or([eb('races.race_class', 'like', '%G1%'), eb('races.race_class', 'like', '%GI%')]))
    .where('race_results.finish_position', 'is not', null);

  if (beforeDate !== undefined) {
    query = query.where('races.race_date', '<', beforeDate);
  }

  return query.compile();
}

function jockeyTrainerStatsQuery(jockeyId: number, trainerId: number, beforeDate?: string) {
  let query = queryBuilder
    .selectFrom('race_entries')
    .innerJoin('horses', 'horses.id', 'race_entries.horse_id')
    .innerJoin('races', 'races.id', 'race_entries.race_id')
    .leftJoin('race_results', 'race_results.entry_id', 'race_entries.id')
    .select(eb => [
      eb.fn.countAll<number>().as('total_runs'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.wins).then(1).else(0).end())
        .as('wins'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.places).then(1).else(0).end())
        .as('places'),
      eb.fn
        .sum<number>(eb.case().when('race_results.finish_position', '=', FINISH_POSITIONS.shows).then(1).else(0).end())
        .as('shows')
    ])
    .where('race_entries.jockey_id', '=', jockeyId)
    .where('horses.trainer_id', '=', trainerId)
    .where('race_results.finish_position', 'is not', null);

  if (beforeDate !== undefined) {
    query = query.where('races.race_date', '<', beforeDate);
  }

  return query.compile();
}

export class JockeyQueryRepository {
  constructor(private readonly db: Database) {}

  /**
   * 騎手の指定コース成績を取得（G1成績も含む）
   *
   * @param jockeyId - 騎手ID
   * @param venueName - 会場名（例: '中山', '東京'）
   * @param beforeDate - as-of カットオフ日（省略時は全期間）
   * @returns 会場成績、見つからない場合は null
   */
  getJockeyVenueStats(
    jockeyId: number,
    venueName: string,
    beforeDate?: string
  ): JockeyVenueStats | null {
    const stats = selectRow(this.db, jockeyVenueStatsQuery(jockeyId, venueName, beforeDate));
    if (!stats) return null;

    const g1Stats = selectRow(this.db, jockeyVenueG1StatsQuery(jockeyId, venueName, beforeDate));

    return {
      jockey_id: jockeyId,
      venue_name: venueName,
      total_runs: stats.total_runs,
      wins: stats.wins,
      places: stats.places,
      shows: stats.shows,
      venue_g1_runs: g1Stats?.venue_g1_runs ?? 0,
      venue_g1_wins: g1Stats?.venue_g1_wins ?? 0
    };
  }

  /**
   * 騎手の全体成績を取得
   *
   * @param jockeyId - 騎手ID
   * @param beforeDate - as-of カットオフ日（省略時は全期間）
   */
  getJockeyOverallStats(jockeyId: number, beforeDate?: string): JockeyOverallStats | null {
    const stats = selectRow(this.db, jockeyOverallStatsQuery(jockeyId, beforeDate));
    if (!stats) return null;

    const g1Stats = selectRow(this.db, jockeyOverallG1StatsQuery(jockeyId, beforeDate));

    return {
      jockey_id: jockeyId,
      total_runs: stats.total_runs,
      wins: stats.wins,
      places: stats.places,
      shows: stats.shows,
      g1_runs: g1Stats?.g1_runs ?? 0,
      g1_wins: g1Stats?.g1_wins ?? 0
    };
  }

  /**
   * 騎手・調教師コンビ成績を取得
   *
   * @param jockeyId - 騎手ID
   * @param trainerId - 調教師ID
   * @param beforeDate - as-of カットオフ日（省略時は全期間）
   */
  getJockeyTrainerStats(
    jockeyId: number,
    trainerId: number,
    beforeDate?: string
  ): JockeyTrainerComboStats | null {
    const stats = selectRow(this.db, jockeyTrainerStatsQuery(jockeyId, trainerId, beforeDate));
    if (!stats) return null;

    return {
      jockey_id: jockeyId,
      trainer_id: trainerId,
      total_runs: stats.total_runs,
      wins: stats.wins,
      places: stats.places,
      shows: stats.shows
    };
  }

  /**
   * 全騎手を取得
   */
  getAllJockeys(): Selectable<JockeysTable>[] {
    return selectRows(this.db, queryBuilder.selectFrom('jockeys').selectAll().orderBy('name').compile());
  }

  /**
   * 騎手をIDで取得
   *
   * @returns 該当が無ければ null
   */
  getJockeyById(jockeyId: number): Selectable<JockeysTable> | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('jockeys').selectAll().where('id', '=', jockeyId).compile()
    );
  }

  /**
   * 全調教師を取得
   */
  getAllTrainers(): Selectable<TrainersTable>[] {
    return selectRows(this.db, queryBuilder.selectFrom('trainers').selectAll().orderBy('name').compile());
  }

  /**
   * 調教師をIDで取得
   *
   * @returns 該当が無ければ null
   */
  getTrainerById(trainerId: number): Selectable<TrainersTable> | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('trainers').selectAll().where('id', '=', trainerId).compile()
    );
  }
}
