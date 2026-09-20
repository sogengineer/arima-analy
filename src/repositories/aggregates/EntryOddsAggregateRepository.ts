/**
 * 出走行のオッズ列を整えるリポジトリ
 */

import type { Database } from 'bun:sqlite';
import { sql } from 'kysely';
import { queryBuilder, runStatement } from '../../database/QueryRunner';

/** 確定オッズと出走前オッズを「同じ値」とみなす許容差 */
const ODDS_MATCH_TOLERANCE = 0.0001;

/**
 * 結果由来の確定オッズが混入した出走行を選ぶサブクエリ
 *
 * @remarks
 * 判定条件は次の 2 つを両方満たすこと。
 * 1. 同一レースで `win_odds` が入っている馬がその 1 頭だけ（かつ出走は 2 頭以上）
 * 2. その値が同じ出走行の `race_results.final_win_odds` と一致する
 *
 * `ABS(...)` の比較はビルダーの演算子では書けないため `sql` タグ付きテンプレートで組む。
 * レース単位の集計は派生テーブル（`agg`）として join する。
 */
function resultDerivedEntryIds() {
  return queryBuilder
    .selectFrom('race_entries as e')
    .innerJoin('race_results as rr', 'rr.entry_id', 'e.id')
    .innerJoin(
      eb =>
        eb
          .selectFrom('race_entries')
          .select(eb2 => [
            'race_id',
            eb2.fn.countAll<number>().as('total'),
            eb2.fn
              .sum<number>(eb2.case().when('win_odds', 'is not', null).then(1).else(0).end())
              .as('with_odds')
          ])
          .groupBy('race_id')
          .as('agg'),
      join => join.onRef('agg.race_id', '=', 'e.race_id')
    )
    .select('e.id')
    .where('e.win_odds', 'is not', null)
    .where('rr.final_win_odds', 'is not', null)
    .where(
      sql<number>`abs(${sql.ref('e.win_odds')} - ${sql.ref('rr.final_win_odds')})`,
      '<',
      ODDS_MATCH_TOLERANCE
    )
    .where('agg.with_odds', '=', 1)
    .where('agg.total', '>', 1);
}

export class EntryOddsAggregateRepository {
  constructor(private readonly db: Database) {}

  /**
   * 結果由来の確定オッズが混入した `race_entries.win_odds` をクリアする
   *
   * @remarks
   * `race_entries.win_odds` は「出走前の表示オッズ」を入れる列。
   * 払戻金から復元した確定オッズ（1着馬ぶんしか取れない）がここに入ると
   * 「win_odds が非null ⇔ そのレースの勝ち馬」という look-ahead リークになる。
   *
   * 列の値そのものからは「出走前オッズ」か「結果由来」かを区別できないため、
   * 根拠のある保守的な条件（`resultDerivedEntryIds`）を満たす行だけを対象にする。
   * 出走前の出馬表から取り込んだレースは全馬に `win_odds` が入るため確実に除外される。
   *
   * @returns クリアした出走行数
   */
  clearResultDerivedWinOdds(): number {
    return runStatement(
      this.db,
      queryBuilder
        .updateTable('race_entries')
        .set({ win_odds: null })
        .where('id', 'in', resultDerivedEntryIds())
        .compile()
    ).changes;
  }
}
