/**
 * レース集約のリポジトリ
 * トランザクション単位でレース＋出馬表＋結果を処理
 */

import type Database from 'better-sqlite3';
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

export class RaceAggregateRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * レースを登録（トランザクション）
   * 内部で会場を自動登録
   * @param matchByName 前走データなどレース番号が不明な場合、レース名でマッチング
   */
  insertRace(data: RaceImportData, matchByName: boolean = false): RaceInsertResult {
    return this.db.transaction(() => {
      const venueId = this.getOrCreateVenue(data.venue);

      let existing: { id: number } | undefined;

      if (matchByName) {
        // 前走データ: レース名＋日付＋会場でマッチング
        existing = this.db.prepare(`
          SELECT id FROM races WHERE race_date = ? AND venue_id = ? AND race_name = ?
        `).get(data.raceDate, venueId, data.raceName) as { id: number } | undefined;
      } else {
        // 通常: 日付＋会場＋レース番号でマッチング
        existing = this.db.prepare(`
          SELECT id FROM races WHERE race_date = ? AND venue_id = ? AND race_number = ?
        `).get(data.raceDate, venueId, data.raceNumber ?? 1) as { id: number } | undefined;
      }

      if (existing) {
        // 既存レースを更新
        this.db.prepare(`
          UPDATE races SET
            race_name = COALESCE(?, race_name),
            race_class = COALESCE(?, race_class),
            race_type = COALESCE(?, race_type),
            distance = COALESCE(?, distance),
            track_condition = COALESCE(?, track_condition),
            total_horses = COALESCE(?, total_horses)
          WHERE id = ?
        `).run(
          data.raceName,
          data.raceClass ?? null,
          data.raceType ?? null,
          data.distance,
          data.trackCondition ?? null,
          data.totalHorses ?? null,
          existing.id
        );
        return { id: existing.id, updated: true, venueId };
      }

      // 新規作成
      // 前走データ: レース番号不明のため自動採番
      let raceNumber: number;
      if (matchByName && data.raceNumber == null) {
        // 同じ日・同じ会場の最大race_number + 1 を使用
        const maxRow = this.db.prepare(`
          SELECT COALESCE(MAX(race_number), 0) as max_num FROM races
          WHERE race_date = ? AND venue_id = ?
        `).get(data.raceDate, venueId) as { max_num: number };
        raceNumber = maxRow.max_num + 1;
      } else {
        raceNumber = data.raceNumber ?? 1;
      }

      const result = this.db.prepare(`
        INSERT INTO races (race_date, venue_id, race_number, race_name, race_class, race_type, distance, track_condition, total_horses)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.raceDate,
        venueId,
        raceNumber,
        data.raceName,
        data.raceClass ?? null,
        data.raceType ?? null,
        data.distance,
        data.trackCondition ?? null,
        data.totalHorses ?? null
      );

      return { id: result.lastInsertRowid as number, updated: false, venueId };
    })();
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
        data.mareName
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
        // 既存エントリを更新
        this.db.prepare(`
          UPDATE race_entries SET
            jockey_id = COALESCE(?, jockey_id),
            frame_number = COALESCE(?, frame_number),
            horse_number = COALESCE(?, horse_number),
            assigned_weight = COALESCE(?, assigned_weight),
            win_odds = COALESCE(?, win_odds),
            popularity = COALESCE(?, popularity),
            horse_weight = COALESCE(?, horse_weight),
            career_wins = COALESCE(?, career_wins),
            career_places = COALESCE(?, career_places),
            career_shows = COALESCE(?, career_shows),
            career_runs = COALESCE(?, career_runs),
            total_prize_money = COALESCE(?, total_prize_money)
          WHERE id = ?
        `).run(
          jockeyId,
          data.frameNumber ?? null,
          data.horseNumber ?? null,
          data.assignedWeight ?? null,
          data.winOdds ?? null,
          data.popularity ?? null,
          data.horseWeight ?? null,
          data.careerWins ?? null,
          data.careerPlaces ?? null,
          data.careerShows ?? null,
          data.careerRuns ?? null,
          data.totalPrizeMoney ?? null,
          existing.id
        );
        return { id: existing.id, updated: true, horseId: horse.id, jockeyId };
      }

      // 新規作成
      const result = this.db.prepare(`
        INSERT INTO race_entries (
          race_id, horse_id, jockey_id, frame_number, horse_number, assigned_weight,
          win_odds, popularity, horse_weight, career_wins, career_places, career_shows, career_runs, total_prize_money
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        raceId,
        horse.id,
        jockeyId,
        data.frameNumber ?? null,
        data.horseNumber,
        data.assignedWeight ?? null,
        data.winOdds ?? null,
        data.popularity ?? null,
        data.horseWeight ?? null,
        data.careerWins ?? null,
        data.careerPlaces ?? null,
        data.careerShows ?? null,
        data.careerRuns ?? null,
        data.totalPrizeMoney ?? null
      );

      return {
        id: result.lastInsertRowid as number,
        updated: false,
        horseId: horse.id,
        jockeyId
      };
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
        // 既存結果を更新
        this.db.prepare(`
          UPDATE race_results SET
            finish_position = COALESCE(?, finish_position),
            finish_status = COALESCE(?, finish_status),
            finish_time = COALESCE(?, finish_time),
            margin = COALESCE(?, margin),
            last_3f_time = COALESCE(?, last_3f_time),
            corner_positions = COALESCE(?, corner_positions)
          WHERE id = ?
        `).run(
          data.finishPosition ?? null,
          data.finishStatus ?? null,
          data.finishTime ?? null,
          data.margin ?? null,
          data.last3fTime ?? null,
          data.cornerPositions ?? null,
          existing.id
        );
        return { id: existing.id, updated: true };
      }

      // 新規作成
      const result = this.db.prepare(`
        INSERT INTO race_results (entry_id, finish_position, finish_status, finish_time, margin, last_3f_time, corner_positions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        entryId,
        data.finishPosition ?? null,
        data.finishStatus ?? '完走',
        data.finishTime ?? null,
        data.margin ?? null,
        data.last3fTime ?? null,
        data.cornerPositions ?? null
      );

      return { id: result.lastInsertRowid as number, updated: false };
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
    mareName?: string
  ): { id: number } | undefined {
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
