/**
 * レース情報の取得リポジトリ
 * JOINでまとめて取得
 */

import type { Database } from 'bun:sqlite';
import { sql, type Selectable } from 'kysely';
import { queryBuilder, selectRow, selectRows } from '@/database/QueryRunner';
import type { RaceEntriesTable, RacesTable, VenuesTable } from '@/database/schema';

/** レース1行＋会場名（`races.*` に `venues.name` を足した形） */
export type RaceWithVenueRow = Selectable<RacesTable> & { venue_name: string };

/** 出走1行＋馬・血統・調教師・騎手の名前 */
export type EntryWithDetailsRow = Selectable<RaceEntriesTable> & {
  horse_name: string;
  sire_name: string | null;
  mare_name: string | null;
  trainer_id: number | null;
  trainer_name: string | null;
  jockey_name: string | null;
};

/** 会場名付きでレースを引く共通の組み立て */
function racesWithVenue() {
  return queryBuilder
    .selectFrom('races')
    .innerJoin('venues', 'venues.id', 'races.venue_id')
    .selectAll('races')
    .select('venues.name as venue_name');
}

/**
 * 結果があるレースの取得クエリ
 *
 * @remarks
 * 重賞限定かどうかは条件付き `where` で切り替える（SQL 本文は 1 本）。
 * 重賞の判定は「`race_class` が G1/G2/G3 を含む」または「`race_name` が『記念』を含む」。
 * 記念名のレースを拾うのは、格付が `race_class` に入っていない開催があるため。
 */
function racesWithResultsQuery(gradeOnly: boolean) {
  let query = racesWithVenue()
    .distinct()
    .innerJoin('race_entries', 'race_entries.race_id', 'races.id')
    .innerJoin('race_results', 'race_results.entry_id', 'race_entries.id')
    .where('race_results.finish_position', 'is not', null);

  if (gradeOnly) {
    query = query.where(eb =>
      eb.or([
        eb('races.race_class', 'like', '%G1%'),
        eb('races.race_class', 'like', '%G2%'),
        eb('races.race_class', 'like', '%G3%'),
        eb('races.race_name', 'like', '%記念%')
      ])
    );
  }

  return query.orderBy('races.race_date', 'desc').compile();
}

export class RaceQueryRepository {
  constructor(private readonly db: Database) {}

  /**
   * レースを取得（会場名付き）
   *
   * @returns 該当が無ければ null
   */
  getRaceWithVenue(raceId: number): RaceWithVenueRow | null {
    return selectRow(this.db, racesWithVenue().where('races.id', '=', raceId).compile());
  }

  /**
   * レースをIDで取得
   *
   * @returns 該当が無ければ null
   */
  getRaceById(raceId: number): Selectable<RacesTable> | null {
    return selectRow(
      this.db,
      queryBuilder.selectFrom('races').selectAll().where('id', '=', raceId).compile()
    );
  }

  /**
   * レースをIDまたは名前で取得
   *
   * @returns 該当が無ければ null
   */
  getRaceByIdOrName(idOrName: string): Selectable<RacesTable> | null {
    // 数値の場合はIDで検索
    const numId = parseInt(idOrName, 10);
    if (!Number.isNaN(numId)) {
      return this.getRaceById(numId);
    }
    // 文字列の場合はレース名で検索
    return selectRow(
      this.db,
      queryBuilder
        .selectFrom('races')
        .selectAll()
        .where('race_name', 'like', `%${idOrName}%`)
        .compile()
    );
  }

  /**
   * 全レースを取得（会場名付き、日付降順）
   */
  getAllRaces(): RaceWithVenueRow[] {
    return selectRows(this.db, racesWithVenue().orderBy('races.race_date', 'desc').compile());
  }

  /**
   * レースの出走馬を取得（馬情報・騎手情報付き）
   */
  getRaceEntries(raceId: number): EntryWithDetailsRow[] {
    return selectRows(
      this.db,
      queryBuilder
        .selectFrom('race_entries')
        .innerJoin('horses', 'horses.id', 'race_entries.horse_id')
        .leftJoin('sires', 'sires.id', 'horses.sire_id')
        .leftJoin('mares', 'mares.id', 'horses.mare_id')
        .leftJoin('trainers', 'trainers.id', 'horses.trainer_id')
        .leftJoin('jockeys', 'jockeys.id', 'race_entries.jockey_id')
        .selectAll('race_entries')
        .select([
          'horses.name as horse_name',
          'sires.name as sire_name',
          'mares.name as mare_name',
          'horses.trainer_id',
          'trainers.name as trainer_name',
          'jockeys.name as jockey_name'
        ])
        .where('race_entries.race_id', '=', raceId)
        .orderBy('race_entries.horse_number')
        .compile()
    );
  }

  /**
   * レースの出走馬を簡易取得
   */
  getRaceEntriesSimple(raceId: number): {
    horse_id: number;
    horse_name: string;
    horse_number: number;
    jockey_id: number;
    trainer_id: number | null;
  }[] {
    return selectRows(
      this.db,
      queryBuilder
        .selectFrom('race_entries')
        .innerJoin('horses', 'horses.id', 'race_entries.horse_id')
        .select([
          'race_entries.horse_id',
          'horses.name as horse_name',
          'race_entries.horse_number',
          'race_entries.jockey_id',
          'horses.trainer_id'
        ])
        .where('race_entries.race_id', '=', raceId)
        .orderBy('race_entries.horse_number')
        .compile()
    );
  }

  /**
   * 全会場を取得
   */
  getAllVenues(): Selectable<VenuesTable>[] {
    return selectRows(this.db, queryBuilder.selectFrom('venues').selectAll().orderBy('name').compile());
  }

  /**
   * 結果があるレースを取得（バックテスト用）
   *
   * @param gradeOnly - 重賞のみに限定するか
   */
  getRacesWithResults(gradeOnly: boolean = false): RaceWithVenueRow[] {
    return selectRows(this.db, racesWithResultsQuery(gradeOnly));
  }

  /**
   * レースの結果を取得
   *
   * @remarks
   * 着順が未確定（結果行が無い・着順が NULL）の出走は末尾に回す。
   * `COALESCE(finish_position, 999)` はビルダーの `orderBy` に直接渡せないため `sql` で書く。
   */
  getRaceResults(raceId: number): {
    horse_id: number;
    horse_name: string;
    horse_number: number;
    finish_position: number | null;
    finish_time: string | null;
    last_3f_time: number | null;
  }[] {
    return selectRows(
      this.db,
      queryBuilder
        .selectFrom('race_entries')
        .innerJoin('horses', 'horses.id', 'race_entries.horse_id')
        .leftJoin('race_results', 'race_results.entry_id', 'race_entries.id')
        .select([
          'race_entries.horse_id',
          'horses.name as horse_name',
          'race_entries.horse_number',
          'race_results.finish_position',
          'race_results.finish_time',
          'race_results.last_3f_time'
        ])
        .where('race_entries.race_id', '=', raceId)
        .orderBy(sql<number>`coalesce(${sql.ref('race_results.finish_position')}, ${999})`)
        .compile()
    );
  }

  /**
   * レースの市場データ（事前オッズ・人気順位・確定オッズ）を取得
   *
   * @remarks
   * `win_odds` は結果ページからは取れないため大半のレースで NULL になる。
   * 暗黙確率の算出では全馬に揃っている場合のみ使い、
   * それ以外は全馬ぶん取得できる `popularity` を使う。
   */
  getRaceMarketData(raceId: number): {
    horse_id: number;
    win_odds: number | null;
    popularity: number | null;
    final_win_odds: number | null;
  }[] {
    return selectRows(
      this.db,
      queryBuilder
        .selectFrom('race_entries')
        .leftJoin('race_results', 'race_results.entry_id', 'race_entries.id')
        .select([
          'race_entries.horse_id',
          'race_entries.win_odds',
          'race_entries.popularity',
          'race_results.final_win_odds'
        ])
        .where('race_entries.race_id', '=', raceId)
        .orderBy('race_entries.horse_number')
        .compile()
    );
  }

  /**
   * レースの確定単勝オッズを取得（払戻計算用）
   *
   * @remarks
   * レース後にしか分からない値なので **特徴量には絶対に使わない**。
   * バックテストの回収率シミュレーションでのみ使用する。
   * 確定オッズが入っていない出走行は返さない。
   */
  getRacePayoutOdds(raceId: number): { horse_id: number; final_win_odds: number | null }[] {
    return selectRows(
      this.db,
      queryBuilder
        .selectFrom('race_entries')
        .innerJoin('race_results', 'race_results.entry_id', 'race_entries.id')
        .select(['race_entries.horse_id', 'race_results.final_win_odds'])
        .where('race_entries.race_id', '=', raceId)
        .where('race_results.final_win_odds', 'is not', null)
        .compile()
    );
  }
}
