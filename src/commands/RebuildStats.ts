/**
 * 集計テーブルの再構築コマンド
 *
 * @remarks
 * 馬場別・コース別成績の全件置換に加えて、
 * `race_entries.win_odds` に混入した**結果由来の確定オッズ**
 * （1着馬のみに値が入る＝look-aheadリーク）をクリアする。
 * DBに入っているデータだけで完結する処理で、外部取得は行わない。
 */

import { DatabaseConnection } from '../database/DatabaseConnection';
import { EntryOddsAggregateRepository } from '../repositories/aggregates/EntryOddsAggregateRepository';
import { ScoreAggregateRepository } from '../repositories/aggregates/ScoreAggregateRepository';

export class RebuildStats {
  constructor(private readonly dbPath?: string) {}

  execute(): void {
    const connection = new DatabaseConnection(this.dbPath);
    try {
      const db = connection.getConnection();

      const scoreRepository = new ScoreAggregateRepository(db);
      const entryOddsRepository = new EntryOddsAggregateRepository(db);

      const count = scoreRepository.rebuildHorseStats();
      console.log(`✅ 馬場別・コース別成績を再構築しました（有効着順${count}件）`);

      const cleared = entryOddsRepository.clearResultDerivedWinOdds();
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
