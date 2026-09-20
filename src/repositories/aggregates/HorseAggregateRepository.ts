/**
 * 馬集約のリポジトリ
 * トランザクション単位で馬＋血統関連を処理
 */

import type { Database } from 'bun:sqlite';
import { sql } from 'kysely';
import { queryBuilder, runStatement, selectRow } from '../../database/QueryRunner';
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

/**
 * 突合で NULL を同じ値として扱うための番兵
 *
 * @remarks
 * 元の SQL の `COALESCE(sire_id, -1) = COALESCE(?, -1)` を保つ。右辺はバインド値だけなので
 * SQL の COALESCE と同じ値を JS 側で作って渡す（結果は変わらない）。
 */
const NULL_SENTINEL = -1;

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

  /**
   * 既存の馬レコードを、渡された値がある項目だけ上書きする
   *
   * @remarks
   * 各列は `COALESCE(渡された値, 既存値)`。渡されなかった項目（null）で既存値を潰さない。
   */
  private updateHorseRow(horseId: number, data: HorseImportData, related: RelatedIds): void {
    runStatement(
      this.db,
      queryBuilder
        .updateTable('horses')
        .set(eb => ({
          name: eb.fn.coalesce(eb.val(data.name || null), eb.ref('name')),
          jra_horse_id: eb.fn.coalesce(eb.val(data.jraHorseId ?? null), eb.ref('jra_horse_id')),
          birth_year: eb.fn.coalesce(eb.val(data.birthYear ?? null), eb.ref('birth_year')),
          sex: eb.fn.coalesce(eb.val(data.sex ?? null), eb.ref('sex')),
          sire_id: eb.fn.coalesce(eb.val(related.sireId), eb.ref('sire_id')),
          mare_id: eb.fn.coalesce(eb.val(related.mareId), eb.ref('mare_id')),
          trainer_id: eb.fn.coalesce(eb.val(related.trainerId), eb.ref('trainer_id')),
          owner_id: eb.fn.coalesce(eb.val(related.ownerId), eb.ref('owner_id')),
          breeder_id: eb.fn.coalesce(eb.val(related.breederId), eb.ref('breeder_id')),
          updated_at: sql<string>`CURRENT_TIMESTAMP`
        }))
        .where('id', '=', horseId)
        .compile()
    );
  }

  /** 馬を新規登録し、採番されたIDを返す */
  private insertHorseRow(data: HorseImportData, related: RelatedIds): number {
    const result = runStatement(
      this.db,
      queryBuilder
        .insertInto('horses')
        .values({
          name: data.name,
          jra_horse_id: data.jraHorseId ?? null,
          birth_year: data.birthYear ?? null,
          sex: data.sex ?? null,
          sire_id: related.sireId,
          mare_id: related.mareId,
          trainer_id: related.trainerId,
          owner_id: related.ownerId,
          breeder_id: related.breederId
        })
        .compile()
    );
    return Number(result.lastInsertRowid);
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
  ): { id: number } | null {
    if (jraHorseId) {
      const byJraId = selectRow(
        this.db,
        queryBuilder.selectFrom('horses').select('id').where('jra_horse_id', '=', jraHorseId).compile()
      );
      if (byJraId) return byJraId;
    }

    // NULL を番兵に寄せて確実にマッチングする。
    // ただし jra_horse_id を持ち込んでいるときは、**別の** jra_horse_id を持つ行は
    // 別馬なのでマッチさせない（UPDATE すると他馬の血統登録番号を上書きしてしまう）
    let byBloodlineQuery = queryBuilder
      .selectFrom('horses')
      .select('id')
      .where('name', '=', name)
      .where(eb => eb(eb.fn.coalesce('sire_id', eb.val(NULL_SENTINEL)), '=', sireId ?? NULL_SENTINEL))
      .where(eb => eb(eb.fn.coalesce('mare_id', eb.val(NULL_SENTINEL)), '=', mareId ?? NULL_SENTINEL))
      .orderBy('id')
      .limit(1);

    if (jraHorseId !== undefined) {
      byBloodlineQuery = byBloodlineQuery.where(eb =>
        eb.or([eb('jra_horse_id', 'is', null), eb('jra_horse_id', '=', jraHorseId)])
      );
    }

    const byBloodline = selectRow(this.db, byBloodlineQuery.compile());
    if (byBloodline) return byBloodline;

    // 血統が渡されないケース（結果ページ由来）のフォールバック。
    // jra_horse_id が未設定の行だけを対象にすることで、別馬への誤マージと
    // UNIQUE 違反の両方を避ける
    if (sireId == null && mareId == null) {
      return selectRow(
        this.db,
        queryBuilder
          .selectFrom('horses')
          .select('id')
          .where('name', '=', name)
          .where('jra_horse_id', 'is', null)
          .orderBy('id')
          .limit(1)
          .compile()
      );
    }

    return null;
  }

  // ============================================
  // マスタ操作（private）
  // ============================================

  private getOrCreateSire(name: string): number | null {
    if (!name || name.trim() === '') return null;
    const existing = selectRow(
      this.db,
      queryBuilder.selectFrom('sires').select('id').where('name', '=', name).compile()
    );
    if (existing) return existing.id;

    const result = runStatement(
      this.db,
      queryBuilder.insertInto('sires').values({ name }).compile()
    );
    return Number(result.lastInsertRowid);
  }

  private getOrCreateMare(name: string, maresSireName?: string): number | null {
    if (!name || name.trim() === '') return null;
    const existing = selectRow(
      this.db,
      queryBuilder.selectFrom('mares').select('id').where('name', '=', name).compile()
    );
    if (existing) return existing.id;

    const maresSireId = maresSireName ? this.getOrCreateSire(maresSireName) : null;
    const result = runStatement(
      this.db,
      queryBuilder.insertInto('mares').values({ name, sire_id: maresSireId }).compile()
    );
    return Number(result.lastInsertRowid);
  }

  private getOrCreateTrainer(name: string, stable?: '美浦' | '栗東'): number | null {
    if (!name) return null;
    const existing = selectRow(
      this.db,
      queryBuilder.selectFrom('trainers').select('id').where('name', '=', name).compile()
    );
    if (existing) return existing.id;

    const result = runStatement(
      this.db,
      queryBuilder.insertInto('trainers').values({ name, stable: stable ?? null }).compile()
    );
    return Number(result.lastInsertRowid);
  }

  private getOrCreateOwner(name: string): number | null {
    if (!name) return null;
    const existing = selectRow(
      this.db,
      queryBuilder.selectFrom('owners').select('id').where('name', '=', name).compile()
    );
    if (existing) return existing.id;

    const result = runStatement(
      this.db,
      queryBuilder.insertInto('owners').values({ name }).compile()
    );
    return Number(result.lastInsertRowid);
  }

  private getOrCreateBreeder(name: string): number | null {
    if (!name) return null;
    const existing = selectRow(
      this.db,
      queryBuilder.selectFrom('breeders').select('id').where('name', '=', name).compile()
    );
    if (existing) return existing.id;

    const result = runStatement(
      this.db,
      queryBuilder.insertInto('breeders').values({ name }).compile()
    );
    return Number(result.lastInsertRowid);
  }
}
