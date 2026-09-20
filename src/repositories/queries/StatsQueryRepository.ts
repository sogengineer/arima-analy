/**
 * 統計・スコアの取得リポジトリ
 */

import type { Database } from 'bun:sqlite';
import type { Selectable } from 'kysely';
import { queryBuilder, selectRow, selectRows } from '@/database/QueryRunner';
import type { BloodlineStatsTable, HorseScoresTable, SiresTable } from '@/database/schema';

/** 血統統計に種牡馬名を添えた行 */
export type BloodlineStatsWithSire = Selectable<BloodlineStatsTable> & { sire_name: string };

/** 馬スコアに馬名を添えた行 */
export type HorseScoreWithHorseName = Selectable<HorseScoresTable> & { horse_name: string };

/** 馬スコアを総合スコアの降順で取得するクエリ（レース指定は任意） */
function horseScoresQuery(raceId?: number) {
  const query = queryBuilder
    .selectFrom('horse_scores as hs')
    .innerJoin('horses as h', 'h.id', 'hs.horse_id')
    .selectAll('hs')
    .select('h.name as horse_name')
    .orderBy('hs.total_score', 'desc');

  return (raceId === undefined ? query : query.where('hs.race_id', '=', raceId)).compile();
}

export class StatsQueryRepository {
  constructor(private readonly db: Database) {}

  /**
   * 血統統計を取得
   */
  getBloodlineStats(sireId: number): BloodlineStatsWithSire[] {
    return selectRows(
      this.db,
      queryBuilder
        .selectFrom('bloodline_stats as bs')
        .innerJoin('sires as s', 's.id', 'bs.sire_id')
        .selectAll('bs')
        .select('s.name as sire_name')
        .where('bs.sire_id', '=', sireId)
        .compile()
    );
  }

  /**
   * 馬スコアを取得（レース指定）
   */
  getHorseScoresForRace(raceId: number): HorseScoreWithHorseName[] {
    return selectRows(this.db, horseScoresQuery(raceId));
  }

  /**
   * 馬スコアを取得（全件）
   */
  getAllHorseScores(): HorseScoreWithHorseName[] {
    return selectRows(this.db, horseScoresQuery());
  }

  /**
   * 馬スコアを取得（馬ID指定）
   *
   * @param raceId - レースID。省略時はレースIDが最大のスコアを 1 件返す
   * @returns 該当が無ければ null
   */
  getHorseScoreByHorseId(horseId: number, raceId?: number): Selectable<HorseScoresTable> | null {
    const base = queryBuilder.selectFrom('horse_scores').selectAll().where('horse_id', '=', horseId);

    // 旧実装互換の truthy 判定。0 は未指定扱い（レースIDに 0 は採番されない）
    if (raceId) {
      return selectRow(this.db, base.where('race_id', '=', raceId).compile());
    }
    return selectRow(this.db, base.orderBy('race_id', 'desc').limit(1).compile());
  }

  /**
   * 全種牡馬を取得
   */
  getAllSires(): Selectable<SiresTable>[] {
    return selectRows(this.db, queryBuilder.selectFrom('sires').selectAll().orderBy('name').compile());
  }

  /**
   * 種牡馬をIDで取得
   *
   * @returns 該当が無ければ null
   */
  getSireById(sireId: number): Selectable<SiresTable> | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('sires').selectAll().where('id', '=', sireId).compile()
    );
  }

  /**
   * 種牡馬を名前で取得
   *
   * @returns 該当が無ければ null
   */
  getSireByName(name: string): Selectable<SiresTable> | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('sires').selectAll().where('name', '=', name).compile()
    );
  }
}
