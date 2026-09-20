/**
 * HorseAggregateRepository の馬レコード突合テスト
 *
 * @remarks
 * 収集経路によって持っている情報が違う:
 * - `ImportData`（出馬表）: 馬名 + 血統あり / `jra_horse_id` なし
 * - 結果ページ由来の取り込み: 馬名 + `jra_horse_id` あり / 血統なし
 *
 * この2経路を混ぜたときに同じ馬が2行に分裂しないこと、
 * かつ別馬（同名・別 `jra_horse_id`）を誤ってマージして
 * `idx_horses_jra_id` の UNIQUE 違反を起こさないことを固定する。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';

describe('HorseAggregateRepository の馬レコード突合', () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDb('horse-aggregate');
  });

  afterEach(() => {
    testDb.cleanup();
  });

  /** 馬テーブルの行を名前で取る */
  function rowsByName(name: string) {
    return testDb.db
      .prepare('SELECT id, name, jra_horse_id, sire_id, mare_id FROM horses WHERE name = ? ORDER BY id')
      .all(name) as Array<{
      id: number;
      name: string;
      jra_horse_id: string | null;
      sire_id: number | null;
      mare_id: number | null;
    }>;
  }

  it('血統つき登録済み（jra_horse_id なし）の馬に、結果ページ由来の登録をマージする', () => {
    // 1) 出馬表インポート: 血統あり / jra_horse_id なし
    const first = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テストマージ馬',
      birthYear: 2020,
      sex: '牡',
      sire: 'テスト父',
      mare: 'テスト母'
    });

    // 2) 結果ページ由来: jra_horse_id あり / 血統なし
    const second = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テストマージ馬',
      jraHorseId: '2020104123'
    });

    expect(second.updated).toBe(true);
    expect(second.id).toBe(first.id);

    const rows = rowsByName('テストマージ馬');
    // 行が分裂していない
    expect(rows).toHaveLength(1);
    // jra_horse_id が埋まる
    expect(rows[0].jra_horse_id).toBe('2020104123');
    // 既存の血統は消えない（COALESCE 更新）
    expect(rows[0].sire_id).not.toBeNull();
    expect(rows[0].mare_id).not.toBeNull();
  });

  it('マージ後は jra_horse_id で再突合できる（以後も分裂しない）', () => {
    const first = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト再突合馬',
      sire: 'テスト父',
      mare: 'テスト母'
    });
    testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト再突合馬',
      jraHorseId: '2019104999'
    });
    const third = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト再突合馬',
      jraHorseId: '2019104999'
    });

    expect(third.id).toBe(first.id);
    expect(rowsByName('テスト再突合馬')).toHaveLength(1);
  });

  it('同名だが別の jra_horse_id を持つ行がある場合は新規作成する（UNIQUE違反にしない）', () => {
    const a = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト同名馬',
      jraHorseId: '2018104001'
    });

    // 別馬（同名・別の血統登録番号）。既存行を UPDATE すると UNIQUE 違反になる
    const b = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト同名馬',
      jraHorseId: '2021104002'
    });

    expect(b.updated).toBe(false);
    expect(b.id).not.toBe(a.id);

    const rows = rowsByName('テスト同名馬');
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.jra_horse_id).sort()).toEqual(['2018104001', '2021104002']);
  });

  it('同名・別血統（同姓同名馬）は血統で区別して新規作成する', () => {
    const a = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト血統違い馬',
      sire: '父A',
      mare: '母A'
    });
    const b = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト血統違い馬',
      sire: '父B',
      mare: '母B'
    });

    expect(b.id).not.toBe(a.id);
    expect(rowsByName('テスト血統違い馬')).toHaveLength(2);
  });

  it('血統なし同士（結果ページ由来の再取り込み）は1行に収まる', () => {
    const a = testDb.horseRepo.insertHorseWithBloodline({ name: 'テスト結果由来馬' });
    const b = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト結果由来馬',
      jraHorseId: '2022104777'
    });

    expect(b.id).toBe(a.id);
    expect(rowsByName('テスト結果由来馬')).toHaveLength(1);
  });
});
