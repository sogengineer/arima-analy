/**
 * 馬集約のリポジトリ
 * トランザクション単位で馬＋血統関連を処理
 */

import type Database from 'better-sqlite3';
import type { HorseImportData } from '../../types/HorseData';
import type { TransactionResult, HorseInsertResult } from '../../types/RepositoryTypes';

export class HorseAggregateRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * 馬を血統情報と共に登録（トランザクション）
   * 内部で種牡馬、繁殖牝馬、調教師、馬主、生産者を自動登録
   */
  insertHorseWithBloodline(data: HorseImportData): HorseInsertResult {
    return this.db.transaction(() => {
      const sireId = data.sire ? this.getOrCreateSire(data.sire) : null;
      const mareId = data.mare ? this.getOrCreateMare(data.mare, data.maresSire) : null;
      const trainerId = data.trainer ? this.getOrCreateTrainer(data.trainer, data.trainerStable) : null;
      const ownerId = data.owner ? this.getOrCreateOwner(data.owner) : null;
      const breederId = data.breeder ? this.getOrCreateBreeder(data.breeder) : null;

      // 既存チェック: 馬名 + 父 + 母 で一意判定
      const existing = this.db.prepare(`
        SELECT id FROM horses
        WHERE name = ?
          AND (sire_id = ? OR (sire_id IS NULL AND ? IS NULL))
          AND (mare_id = ? OR (mare_id IS NULL AND ? IS NULL))
      `).get(data.name, sireId, sireId, mareId, mareId) as { id: number } | undefined;

      if (existing) {
        // 既存の馬を更新
        this.db.prepare(`
          UPDATE horses SET
            birth_year = COALESCE(?, birth_year),
            sex = COALESCE(?, sex),
            sire_id = COALESCE(?, sire_id),
            mare_id = COALESCE(?, mare_id),
            trainer_id = COALESCE(?, trainer_id),
            owner_id = COALESCE(?, owner_id),
            breeder_id = COALESCE(?, breeder_id),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          data.birthYear ?? null,
          data.sex ?? null,
          sireId,
          mareId,
          trainerId,
          ownerId,
          breederId,
          existing.id
        );
        return {
          id: existing.id,
          updated: true,
          sireId: sireId ?? undefined,
          mareId: mareId ?? undefined,
          trainerId: trainerId ?? undefined,
          ownerId: ownerId ?? undefined,
          breederId: breederId ?? undefined
        };
      }

      // 新規作成
      const result = this.db.prepare(`
        INSERT INTO horses (name, birth_year, sex, sire_id, mare_id, trainer_id, owner_id, breeder_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.name,
        data.birthYear ?? null,
        data.sex ?? null,
        sireId,
        mareId,
        trainerId,
        ownerId,
        breederId
      );

      return {
        id: result.lastInsertRowid as number,
        updated: false,
        sireId: sireId ?? undefined,
        mareId: mareId ?? undefined,
        trainerId: trainerId ?? undefined,
        ownerId: ownerId ?? undefined,
        breederId: breederId ?? undefined
      };
    })();
  }

  // ============================================
  // マスタ操作（private）
  // ============================================

  private getOrCreateSire(name: string): number | null {
    if (!name || name.trim() === '') return null;
    const existing = this.db.prepare(
      'SELECT id FROM sires WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare(
      'INSERT INTO sires (name) VALUES (?)'
    ).run(name);
    return result.lastInsertRowid as number;
  }

  private getOrCreateMare(name: string, maresSireName?: string): number | null {
    if (!name || name.trim() === '') return null;
    const existing = this.db.prepare(
      'SELECT id FROM mares WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    if (existing) return existing.id;

    const maresSireId = maresSireName ? this.getOrCreateSire(maresSireName) : null;
    const result = this.db.prepare(
      'INSERT INTO mares (name, sire_id) VALUES (?, ?)'
    ).run(name, maresSireId);
    return result.lastInsertRowid as number;
  }

  private getOrCreateTrainer(name: string, stable?: '美浦' | '栗東'): number | null {
    if (!name) return null;
    const existing = this.db.prepare(
      'SELECT id FROM trainers WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare(
      'INSERT INTO trainers (name, stable) VALUES (?, ?)'
    ).run(name, stable ?? null);
    return result.lastInsertRowid as number;
  }

  private getOrCreateOwner(name: string): number | null {
    if (!name) return null;
    const existing = this.db.prepare(
      'SELECT id FROM owners WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare(
      'INSERT INTO owners (name) VALUES (?)'
    ).run(name);
    return result.lastInsertRowid as number;
  }

  private getOrCreateBreeder(name: string): number | null {
    if (!name) return null;
    const existing = this.db.prepare(
      'SELECT id FROM breeders WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    if (existing) return existing.id;

    const result = this.db.prepare(
      'INSERT INTO breeders (name) VALUES (?)'
    ).run(name);
    return result.lastInsertRowid as number;
  }
}
