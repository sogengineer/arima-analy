/**
 * 馬集約のリポジトリ
 * トランザクション単位で馬＋血統関連を処理
 */

import type { Database } from 'bun:sqlite';
import type { HorseImportData } from '../../types/HorseData';
import type { HorseInsertResult } from '../../types/RepositoryTypes';

/** 血統・関係者のID（未指定・未登録なら null） */
interface RelatedIds {
  sireId: number | null;
  mareId: number | null;
  trainerId: number | null;
  ownerId: number | null;
  breederId: number | null;
}

/** null のIDを undefined に落として登録結果に詰め替える */
function buildInsertResult(id: number, updated: boolean, related: RelatedIds): HorseInsertResult {
  return {
    id,
    updated,
    sireId: related.sireId ?? undefined,
    mareId: related.mareId ?? undefined,
    trainerId: related.trainerId ?? undefined,
    ownerId: related.ownerId ?? undefined,
    breederId: related.breederId ?? undefined
  };
}

export class HorseAggregateRepository {
  constructor(private readonly db: Database) {}

  /**
   * 馬を血統情報と共に登録（トランザクション）
   * 内部で種牡馬、繁殖牝馬、調教師、馬主、生産者を自動登録
   */
  insertHorseWithBloodline(data: HorseImportData): HorseInsertResult {
    return this.db.transaction(() => {
      const related = this.resolveRelatedIds(data);
      const existing = this.findExistingHorse(
        data.name,
        data.jraHorseId,
        related.sireId,
        related.mareId
      );

      if (existing) {
        this.updateHorseRow(existing.id, data, related);
        return buildInsertResult(existing.id, true, related);
      }

      return buildInsertResult(this.insertHorseRow(data, related), false, related);
    })();
  }

  /** 血統・関係者を必要に応じて登録し、そのIDをまとめて返す */
  private resolveRelatedIds(data: HorseImportData): RelatedIds {
    return {
      sireId: data.sire ? this.getOrCreateSire(data.sire) : null,
      mareId: data.mare ? this.getOrCreateMare(data.mare, data.maresSire) : null,
      trainerId: data.trainer ? this.getOrCreateTrainer(data.trainer, data.trainerStable) : null,
      ownerId: data.owner ? this.getOrCreateOwner(data.owner) : null,
      breederId: data.breeder ? this.getOrCreateBreeder(data.breeder) : null
    };
  }

  /** 既存の馬レコードを、渡された値がある項目だけ上書きする */
  private updateHorseRow(horseId: number, data: HorseImportData, related: RelatedIds): void {
    this.db.prepare(`
      UPDATE horses SET
        name = COALESCE(?, name),
        jra_horse_id = COALESCE(?, jra_horse_id),
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
      data.name || null,
      data.jraHorseId ?? null,
      data.birthYear ?? null,
      data.sex ?? null,
      related.sireId,
      related.mareId,
      related.trainerId,
      related.ownerId,
      related.breederId,
      horseId
    );
  }

  /** 馬を新規登録し、採番されたIDを返す */
  private insertHorseRow(data: HorseImportData, related: RelatedIds): number {
    const result = this.db.prepare(`
      INSERT INTO horses (name, jra_horse_id, birth_year, sex, sire_id, mare_id, trainer_id, owner_id, breeder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name,
      data.jraHorseId ?? null,
      data.birthYear ?? null,
      data.sex ?? null,
      related.sireId,
      related.mareId,
      related.trainerId,
      related.ownerId,
      related.breederId
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 既存の馬レコードを突合する
   *
   * @remarks
   * 収集経路によって持っている情報が違うため、段階的に突合する。
   *
   * 1. **血統登録番号**（`jra_horse_id`）— 同名馬を確実に区別できる唯一のキー
   * 2. **馬名 + 父 + 母** — 出馬表由来（血統あり）どうしの突合
   * 3. **馬名一致かつ `jra_horse_id IS NULL`** — レース結果ページ由来のインポートは
   *    血統を取れないため 2 の条件が `sire_id IS NULL AND mare_id IS NULL` に退化し、
   *    「出馬表で血統つきに登録済みだが jra_horse_id がまだ入っていない馬」に
   *    マッチせず同名の重複行を作ってしまう。3 でその行に**マージ**し、
   *    `jra_horse_id` を埋める（出走履歴が2つの horse_id に分裂するのを防ぐ）。
   *
   * 逆方向（名前一致だが **別の** `jra_horse_id` を持つ行）は 2・3 のどちらでも
   * 別馬とみなしてマージしない。マージすると他馬の血統登録番号を上書きするか、
   * `idx_horses_jra_id` の UNIQUE 違反になる。
   *
   * @param name - 馬名
   * @param jraHorseId - 血統登録番号（取得できていなければ undefined）
   * @param sireId - 父ID（血統が渡されなければ null）
   * @param mareId - 母ID（血統が渡されなければ null）
   */
  private findExistingHorse(
    name: string,
    jraHorseId: string | undefined,
    sireId: number | null,
    mareId: number | null
  ): { id: number } | undefined {
    if (jraHorseId) {
      const byJraId = this.db
        .prepare('SELECT id FROM horses WHERE jra_horse_id = ?')
        .get(jraHorseId) as { id: number } | undefined;
      if (byJraId) return byJraId;
    }

    // COALESCEでNULLを-1に変換して確実にマッチング。
    // ただし jra_horse_id を持ち込んでいるときは、**別の** jra_horse_id を持つ行は
    // 別馬なのでマッチさせない（UPDATE すると他馬の血統登録番号を上書きしてしまう）
    const byBloodline = this.db.prepare(`
      SELECT id FROM horses
      WHERE name = ?
        AND COALESCE(sire_id, -1) = COALESCE(?, -1)
        AND COALESCE(mare_id, -1) = COALESCE(?, -1)
        AND (? IS NULL OR jra_horse_id IS NULL OR jra_horse_id = ?)
      ORDER BY id
      LIMIT 1
    `).get(
      name,
      sireId,
      mareId,
      jraHorseId ?? null,
      jraHorseId ?? null
    ) as { id: number } | undefined;
    if (byBloodline) return byBloodline;

    // 血統が渡されないケース（結果ページ由来）のフォールバック。
    // jra_horse_id が未設定の行だけを対象にすることで、別馬への誤マージと
    // UNIQUE 違反の両方を避ける
    if (sireId == null && mareId == null) {
      return this.db.prepare(`
        SELECT id FROM horses
        WHERE name = ? AND jra_horse_id IS NULL
        ORDER BY id
        LIMIT 1
      `).get(name) as { id: number } | undefined;
    }

    return undefined;
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
