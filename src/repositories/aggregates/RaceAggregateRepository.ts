/**
 * レース集約のリポジトリ
 * トランザクション単位でレース＋出馬表＋結果を処理
 */

import type { Database } from 'bun:sqlite';
import { queryBuilder, runStatement, selectRow } from '@/database/QueryRunner';
import type {
  RaceImportData,
  EntryImportData,
  ResultImportData
} from '@/types/HorseData';
import type {
  TransactionResult,
  RaceInsertResult,
  EntryInsertResult,
  BatchInsertResult
} from '@/types/RepositoryTypes';
import {
  updateRaceRow,
  insertRaceRow,
  updateEntryRow,
  insertEntryRow,
  updateResultRow,
  insertResultRow
} from './RaceRowWriters';

export class RaceAggregateRepository {
  constructor(private readonly db: Database) {}

  /**
   * レースを登録（トランザクション）
   * 内部で会場を自動登録
   * @param matchByName 前走データなどレース番号が不明な場合、レース名でマッチング
   */
  insertRace(data: RaceImportData, matchByName: boolean = false): RaceInsertResult {
    return this.db.transaction(() => {
      const venueId = this.getOrCreateVenue(data.venue);
      const existing = this.findExistingRace(data, venueId, matchByName);

      if (existing) {
        updateRaceRow(this.db, existing.id, data);
        return { id: existing.id, updated: true, venueId };
      }

      const raceNumber = this.resolveNewRaceNumber(data, venueId, matchByName);
      return { id: insertRaceRow(this.db, data, venueId, raceNumber), updated: false, venueId };
    })();
  }

  /**
   * 同一レースの既存行を突合する
   *
   * @param matchByName - 前走データのようにレース番号が不明な場合、レース名で突合する
   */
  private findExistingRace(
    data: RaceImportData,
    venueId: number,
    matchByName: boolean
  ): { id: number } | null {
    const base = queryBuilder
      .selectFrom('races')
      .select('id')
      .where('race_date', '=', data.raceDate)
      .where('venue_id', '=', venueId);

    if (matchByName) {
      // 前走データ: レース名＋日付＋会場でマッチング
      return selectRow(this.db, base.where('race_name', '=', data.raceName).compile());
    }
    // 通常: 日付＋会場＋レース番号でマッチング
    return selectRow(this.db, base.where('race_number', '=', data.raceNumber ?? 1).compile());
  }

  /** 新規レースのレース番号を決める（前走データでレース番号不明なら自動採番） */
  private resolveNewRaceNumber(
    data: RaceImportData,
    venueId: number,
    matchByName: boolean
  ): number {
    if (matchByName && data.raceNumber == null) {
      // 同じ日・同じ会場の最大race_number + 1 を使用
      const maxRow = selectRow(
        this.db,
        queryBuilder
          .selectFrom('races')
          .select(eb => eb.fn.coalesce(eb.fn.max('race_number'), eb.val(0)).as('max_num'))
          .where('race_date', '=', data.raceDate)
          .where('venue_id', '=', venueId)
          .compile()
      );
      return (maxRow?.max_num ?? 0) + 1;
    }
    return data.raceNumber ?? 1;
  }

  /**
   * 出馬表エントリを登録
   */
  insertRaceEntry(raceId: number, data: EntryImportData): EntryInsertResult {
    return this.db.transaction(() => {
      // 馬を名前+血統で検索
      const horse = this.getHorseByNameAndBloodline(
        data.horseName,
        data.sireName,
        data.mareName,
        data.jraHorseId
      );
      if (!horse) {
        throw new Error(
          `Horse not found: ${data.horseName} (sire: ${data.sireName}, mare: ${data.mareName})`
        );
      }

      const jockeyId = this.getOrCreateJockey(data.jockeyName, data.assignedWeight);

      // 既存チェック
      const existing = selectRow(
        this.db,
        queryBuilder
          .selectFrom('race_entries')
          .select('id')
          .where('race_id', '=', raceId)
          .where('horse_id', '=', horse.id)
          .compile()
      );

      if (existing) {
        updateEntryRow(this.db, existing.id, data, jockeyId);
        return { id: existing.id, updated: true, horseId: horse.id, jockeyId };
      }

      const insertedId = insertEntryRow(this.db, { raceId, horseId: horse.id, jockeyId }, data);
      return { id: insertedId, updated: false, horseId: horse.id, jockeyId };
    })();
  }

  /**
   * レース結果を登録
   */
  insertRaceResult(entryId: number, data: ResultImportData): TransactionResult {
    return this.db.transaction(() => {
      // 既存チェック
      const existing = selectRow(
        this.db,
        queryBuilder.selectFrom('race_results').select('id').where('entry_id', '=', entryId).compile()
      );

      if (existing) {
        updateResultRow(this.db, existing.id, data);
        return { id: existing.id, updated: true };
      }

      return { id: insertResultRow(this.db, entryId, data), updated: false };
    })();
  }

  /**
   * レース＋出馬表を一括登録（トランザクション）
   */
  insertRaceWithEntries(
    raceData: RaceImportData,
    entries: EntryImportData[]
  ): { race: RaceInsertResult; entries: BatchInsertResult } {
    return this.db.transaction(() => {
      const raceResult = this.insertRace(raceData);

      const entryResults: BatchInsertResult = {
        insertCount: 0,
        updateCount: 0,
        errors: []
      };

      for (const entry of entries) {
        try {
          const result = this.insertRaceEntry(raceResult.id, entry);
          if (result.updated) {
            entryResults.updateCount++;
          } else {
            entryResults.insertCount++;
          }
        } catch (error) {
          entryResults.errors.push(
            `${entry.horseName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return { race: raceResult, entries: entryResults };
    })();
  }

  // ============================================
  // マスタ操作（private）
  // ============================================

  private getOrCreateVenue(name: string): number {
    const existing = selectRow(
      this.db,
      queryBuilder.selectFrom('venues').select('id').where('name', '=', name).compile()
    );
    if (existing) return existing.id;

    const result = runStatement(this.db, queryBuilder.insertInto('venues').values({ name }).compile());
    return Number(result.lastInsertRowid);
  }

  private getOrCreateJockey(name: string, weight?: number): number {
    // 騎手名が不明な場合は「未定」として登録（外部キー制約対応）
    const jockeyName = name?.trim() || '未定';

    const existing = selectRow(
      this.db,
      queryBuilder.selectFrom('jockeys').select('id').where('name', '=', jockeyName).compile()
    );
    if (existing) return existing.id;

    const result = runStatement(
      this.db,
      queryBuilder
        .insertInto('jockeys')
        .values({ name: jockeyName, default_weight: weight ?? null })
        .compile()
    );
    return Number(result.lastInsertRowid);
  }

  private getHorseByNameAndBloodline(
    name: string,
    sireName?: string,
    mareName?: string,
    jraHorseId?: string
  ): { id: number } | null {
    // 血統登録番号があれば最優先。同名馬を確実に区別できる
    if (jraHorseId) {
      const byId = selectRow(
        this.db,
        queryBuilder.selectFrom('horses').select('id').where('jra_horse_id', '=', jraHorseId).compile()
      );
      if (byId) return byId;
    }

    if (sireName || mareName) {
      // 片方しか渡されない経路があるため、渡された名前だけを条件にする
      // （渡されなかった側は突合条件から外す）
      const sire = sireName ?? null;
      const mare = mareName ?? null;
      return selectRow(
        this.db,
        queryBuilder
          .selectFrom('horses')
          .leftJoin('sires', 'sires.id', 'horses.sire_id')
          .leftJoin('mares', 'mares.id', 'horses.mare_id')
          .select('horses.id')
          .where('horses.name', '=', name)
          .where(eb => eb.or([eb(eb.val(sire), 'is', null), eb('sires.name', '=', sire)]))
          .where(eb => eb.or([eb(eb.val(mare), 'is', null), eb('mares.name', '=', mare)]))
          .compile()
      );
    }
    return selectRow(
      this.db,
      queryBuilder.selectFrom('horses').select('id').where('name', '=', name).compile()
    );
  }
}
