/**
 * 集計テーブルの再構築コマンド
 *
 * @remarks
 * 馬場別・コース別成績の全件置換に加えて、
 * `race_entries.win_odds` に混入した**結果由来の確定オッズ**
 * （1着馬のみに値が入る＝look-aheadリーク）をクリアする。
 * DBに入っているデータだけで完結する処理で、外部取得は行わない。
 */

import type { Database } from 'bun:sqlite';
import { DatabaseConnection } from '../database/DatabaseConnection';
import { ScoreAggregateRepository } from '../repositories/aggregates/ScoreAggregateRepository';

/**
 * 結果由来の確定オッズが混入した `race_entries.win_odds` をクリアする
 *
 * @remarks
 * `race_entries.win_odds` は「出走前の表示オッズ」を入れる列。
 * 払戻金から復元した確定オッズ（1着馬ぶんしか取れない）がここに入ると
 * 「win_odds が非null ⇔ そのレースの勝ち馬」という look-ahead リークになる。
 *
 * 列の値そのものからは「出走前オッズ」か「結果由来」かを区別できないため、
 * 次の両方を満たす行だけを結果由来と判定する（根拠のある保守的な条件）:
 *
 * 1. 同一レースで `win_odds` が入っている馬が **その1頭だけ**（他馬は全て NULL）
 * 2. その値が同じ出走行の `race_results.final_win_odds` と一致する
 *
 * 出走前の出馬表から取り込んだレースは全馬に `win_odds` が入るため、
 * 条件1で確実に除外される。
 *
 * @returns クリアした出走行数
 */
function clearResultDerivedWinOdds(db: Database): number {
  const result = db.prepare(`
    UPDATE race_entries
    SET win_odds = NULL
    WHERE id IN (
      SELECT e.id
      FROM race_entries e
      JOIN race_results rr ON rr.entry_id = e.id
      JOIN (
        SELECT race_id,
               COUNT(*) AS total,
               SUM(CASE WHEN win_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_odds
        FROM race_entries
        GROUP BY race_id
      ) agg ON agg.race_id = e.race_id
      WHERE e.win_odds IS NOT NULL
        AND rr.final_win_odds IS NOT NULL
        AND ABS(e.win_odds - rr.final_win_odds) < 0.0001
        AND agg.with_odds = 1
        AND agg.total > 1
    )
  `).run();
  return result.changes;
}

export class RebuildStats {
  constructor(private readonly dbPath?: string) {}

  execute(): void {
    const connection = new DatabaseConnection(this.dbPath);
    try {
      const db = connection.getConnection();

      const repository = new ScoreAggregateRepository(db);
      const count = repository.rebuildHorseStats();
      console.log(`✅ 馬場別・コース別成績を再構築しました（有効着順${count}件）`);

      const cleared = clearResultDerivedWinOdds(db);
      if (cleared > 0) {
        console.log(`🧹 結果由来の単勝オッズを ${cleared} 行クリアしました`);
        console.log('   （race_entries.win_odds は出走前の出馬表から埋める列です）');
      } else {
        console.log('✅ 結果由来の単勝オッズ混入はありません');
      }
    } finally {
      connection.close();
    }
  }
}
