/**
 * 蓄積データの棚卸し（件数・期間・null率・内訳）の取得リポジトリ
 *
 * @remarks
 * `DataStatus` コマンドが表示する数値の取得元。表示の整形はコマンド側の責務で、
 * ここは SQL の結果をそのまま返す。
 */

import type { Database } from 'bun:sqlite';
import { sql } from 'kysely';
import { queryBuilder, selectRow, selectRows } from '@/database/QueryRunner';
import type { Database as DatabaseSchema } from '@/database/schema';

/** null 率を監視する対象テーブル */
export type MonitoredTable = 'race_entries' | 'race_results' | 'races';

/**
 * null 率を監視できる列名
 *
 * @remarks
 * テーブルごとの実在する列名だけに絞る。`sql.ref` は渡された文字列を識別子として
 * SQL 本文に埋め込むので、任意の文字列がここに届かないことを型で保証する。
 */
export type MonitoredColumn<TTable extends MonitoredTable> = keyof DatabaseSchema[TTable] & string;

/**
 * 監視する「テーブルと列」の組
 *
 * @remarks
 * テーブルごとに列名を分けた union にしてあるので、`races` に `race_entries` の列を
 * 指定するような取り違えがコンパイルエラーになる。
 */
export type MonitoredColumnRef =
  | { table: 'race_entries'; column: MonitoredColumn<'race_entries'> }
  | { table: 'race_results'; column: MonitoredColumn<'race_results'> }
  | { table: 'races'; column: MonitoredColumn<'races'> };

/** テーブルごとの総件数 */
export interface DataTotals {
  races: number;
  entries: number;
  results: number;
  horses: number;
  jockeys: number;
  venues: number;
}

/** レース内訳の 1 行（芝ダ別・格付別） */
export interface RaceBreakdownRow {
  label: string;
  count: number;
}

/** 総件数（`results` は着順が確定した結果行のみ、`venues` は開催のあった会場数） */
function totalsQuery() {
  return queryBuilder
    .selectNoFrom(eb => [
      eb.selectFrom('races').select(eb2 => eb2.fn.countAll<number>().as('c')).as('races'),
      eb.selectFrom('race_entries').select(eb2 => eb2.fn.countAll<number>().as('c')).as('entries'),
      eb
        .selectFrom('race_results')
        .select(eb2 => eb2.fn.countAll<number>().as('c'))
        .where('finish_position', 'is not', null)
        .as('results'),
      eb.selectFrom('horses').select(eb2 => eb2.fn.countAll<number>().as('c')).as('horses'),
      eb.selectFrom('jockeys').select(eb2 => eb2.fn.countAll<number>().as('c')).as('jockeys'),
      eb
        .selectFrom('races')
        .select(eb2 => eb2.fn.count<number>('venue_id').distinct().as('c'))
        .as('venues')
    ])
    .compile();
}

/** `COALESCE(列, 既定ラベル)` ごとの件数。グループ化は元の列で行う（NULL を 1 グループにまとめる） */
function breakdownQuery(column: 'race_type' | 'grade', fallbackLabel: string) {
  return queryBuilder
    .selectFrom('races')
    .select(eb => [
      eb.fn.coalesce(column, eb.val(fallbackLabel)).as('label'),
      eb.fn.countAll<number>().as('count')
    ])
    .groupBy(column)
    .orderBy('count', 'desc')
    .compile();
}

export class DataStatusQueryRepository {
  constructor(private readonly db: Database) {}

  /**
   * 主要テーブルの総件数を取得
   *
   * @remarks
   * スカラーサブクエリの戻り型は一般に NULL 可だが、中身は `COUNT` なので行が無くても 0 が返る。
   * `?? 0` は型を合わせるためのもので、実際に NULL が来ることはない。
   */
  getTotals(): DataTotals {
    const row = selectRow(this.db, totalsQuery());
    return {
      races: row?.races ?? 0,
      entries: row?.entries ?? 0,
      results: row?.results ?? 0,
      horses: row?.horses ?? 0,
      jockeys: row?.jockeys ?? 0,
      venues: row?.venues ?? 0
    };
  }

  /**
   * レース開催日の最初と最後を取得
   *
   * @returns 1 件も無い場合は両方とも null
   */
  getRaceDatePeriod(): { first_date: string | null; last_date: string | null } {
    const row = selectRow(
      this.db,
      queryBuilder
        .selectFrom('races')
        .select(eb => [
          eb.fn.min<string | null>('race_date').as('first_date'),
          eb.fn.max<string | null>('race_date').as('last_date')
        ])
        .compile()
    );
    return row ?? { first_date: null, last_date: null };
  }

  /**
   * 指定列の NULL 件数を数える
   *
   * @remarks
   * `race_results` だけは「着順が確定した行」を母数にする（未確定の行を欠損として数えない）。
   * 列名は識別子なのでバインド値にできず、`sql.ref` で参照として埋め込む。
   * 受け取れるのは `MonitoredColumn` に絞った列名だけなので、任意の文字列は流れ込まない。
   */
  countNullValues(target: MonitoredColumnRef): number {
    let query = queryBuilder
      .selectFrom(target.table)
      .select(eb => eb.fn.countAll<number>().as('c'))
      .where(sql.ref(target.column), 'is', null);

    if (target.table === 'race_results') {
      query = query.where(sql.ref('finish_position'), 'is not', null);
    }

    return selectRow(this.db, query.compile())?.c ?? 0;
  }

  /**
   * 芝ダ別のレース件数（件数の多い順）
   */
  countRacesByType(): RaceBreakdownRow[] {
    return selectRows(this.db, breakdownQuery('race_type', '(未設定)'));
  }

  /**
   * 格付別のレース件数（件数の多い順）
   */
  countRacesByGrade(): RaceBreakdownRow[] {
    return selectRows(this.db, breakdownQuery('grade', '(平場・特別)'));
  }

  /**
   * レースに登場する距離の種類数
   */
  countDistinctDistances(): number {
    const row = selectRow(
      this.db,
      queryBuilder
        .selectFrom('races')
        .select(eb => eb.fn.count<number>('distance').distinct().as('c'))
        .compile()
    );
    return row?.c ?? 0;
  }
}
