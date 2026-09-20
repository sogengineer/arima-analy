/**
 * レース集約のリポジトリ
 * トランザクション単位でレース＋出馬表＋結果を処理
 */

import type { Database } from 'bun:sqlite';
import type {
  RaceImportData,
  EntryImportData,
  ResultImportData
} from '../../types/HorseData';
import type {
  TransactionResult,
  RaceInsertResult,
  EntryInsertResult,
  BatchInsertResult
} from '../../types/RepositoryTypes';
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
  ): { id: number } | undefined {
    if (matchByName) {
      // 前走データ: レース名＋日付＋会場でマッチング
      return this.db.prepare(`
        SELECT id FROM races WHERE race_date = ? AND venue_id = ? AND race_name = ?
      `).get(data.raceDate, venueId, data.raceName) as { id: number } | undefined;
    }
    // 通常: 日付＋会場＋レース番号でマッチング
    return this.db.prepare(`
      SELECT id FROM races WHERE race_date = ? AND venue_id = ? AND race_number = ?
    `).get(data.raceDate, venueId, data.raceNumber ?? 1) as { id: number } | undefined;
  }

  /** 新規レースのレース番号を決める（前走データでレース番号不明なら自動採番） */
  private resolveNewRaceNumber(
    data: RaceImportData,
    venueId: number,
    matchByName: boolean
  ): number {
    if (matchByName && data.raceNumber == null) {
      // 同じ日・同じ会場の最大race_number + 1 を使用
      const maxRow = this.db.prepare(`
        SELECT COALESCE(MAX(race_number), 0) as max_num FROM races
        WHERE race_date = ? AND venue_id = ?
      `).get(data.raceDate, venueId) as { max_num: number };
      return maxRow.max_num + 1;
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
      const existing = this.db.prepare(`
        SELECT id FROM race_entries WHERE race_id = ? AND horse_id = ?
      `).get(raceId, horse.id) as { id: number } | undefined;

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
      const existing = this.db.prepare(
        'SELECT id FROM race_results WHERE entry_id = ?'
      ).get(entryId) as { id: number } | undefined;

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
    const existing = this.db.prepare(
      'SELECT id FROM venues WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare(
      'INSERT INTO venues (name) VALUES (?)'
    ).run(name);
    return result.lastInsertRowid as number;
  }

  private getOrCreateJockey(name: string, weight?: number): number {
    // 騎手名が不明な場合は「未定」として登録（外部キー制約対応）
    const jockeyName = name?.trim() || '未定';

    const existing = this.db.prepare(
      'SELECT id FROM jockeys WHERE name = ?'
    ).get(jockeyName) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare(
      'INSERT INTO jockeys (name, default_weight) VALUES (?, ?)'
    ).run(jockeyName, weight ?? null);
    return result.lastInsertRowid as number;
  }

  private getHorseByNameAndBloodline(
    name: string,
    sireName?: string,
    mareName?: string,
    jraHorseId?: string
  ): { id: number } | undefined {
    // 血統登録番号があれば最優先。同名馬を確実に区別できる
    if (jraHorseId) {
      const byId = this.db.prepare(
        'SELECT id FROM horses WHERE jra_horse_id = ?'
      ).get(jraHorseId) as { id: number } | undefined;
      if (byId) return byId;
    }

    if (sireName || mareName) {
      return this.db.prepare(`
        SELECT h.id FROM horses h
        LEFT JOIN sires s ON h.sire_id = s.id
        LEFT JOIN mares m ON h.mare_id = m.id
        WHERE h.name = ?
          AND (? IS NULL OR s.name = ?)
          AND (? IS NULL OR m.name = ?)
      `).get(
        name,
        sireName ?? null, sireName ?? null,
        mareName ?? null, mareName ?? null
      ) as { id: number } | undefined;
    }
    return this.db.prepare(
      'SELECT id FROM horses WHERE name = ?'
    ).get(name) as { id: number } | undefined;
  }
}
