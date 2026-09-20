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

describe('HorseAggregateRepository のマスタ登録と更新', () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDb('horse-aggregate-master');
  });

  afterEach(() => {
    testDb.cleanup();
  });

  /** 行数を数える SQL（テーブル名を文字列結合しないよう固定文で持つ） */
  const COUNT_SQL = {
    horses: 'SELECT COUNT(*) AS c FROM horses',
    sires: 'SELECT COUNT(*) AS c FROM sires',
    mares: 'SELECT COUNT(*) AS c FROM mares',
    trainers: 'SELECT COUNT(*) AS c FROM trainers',
    owners: 'SELECT COUNT(*) AS c FROM owners',
    breeders: 'SELECT COUNT(*) AS c FROM breeders'
  } as const;

  /** テーブルの行数を数える */
  function countRows(table: keyof typeof COUNT_SQL): number {
    const row = testDb.db.prepare(COUNT_SQL[table]).get() as { c: number };
    return row.c;
  }

  it('血統・関係者を find-or-create し、同じ名前では行を増やさない', () => {
    const first = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テストマスタ馬A',
      sire: '父マスタ',
      mare: '母マスタ',
      maresSire: '母父マスタ',
      trainer: '調教師マスタ',
      trainerStable: '美浦',
      owner: '馬主マスタ',
      breeder: '生産者マスタ'
    });

    const second = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テストマスタ馬B',
      sire: '父マスタ',
      mare: '母マスタ',
      maresSire: '母父マスタ',
      trainer: '調教師マスタ',
      owner: '馬主マスタ',
      breeder: '生産者マスタ'
    });

    expect(second.sireId).toBe(first.sireId);
    expect(second.mareId).toBe(first.mareId);
    expect(second.trainerId).toBe(first.trainerId);
    expect(second.ownerId).toBe(first.ownerId);
    expect(second.breederId).toBe(first.breederId);

    // 父マスタ + 母父マスタ の 2 行だけ
    expect(countRows('sires')).toBe(2);
    expect(countRows('mares')).toBe(1);
    expect(countRows('trainers')).toBe(1);
    expect(countRows('owners')).toBe(1);
    expect(countRows('breeders')).toBe(1);
  });

  it('母の父を sires に登録して mares.sire_id に結びつける', () => {
    const result = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト母父馬',
      mare: '母父つき母',
      maresSire: '母の父'
    });

    const mare = testDb.db
      .prepare('SELECT sire_id FROM mares WHERE id = ?')
      .get(result.mareId as number) as { sire_id: number | null };
    expect(mare.sire_id).not.toBeNull();

    const sire = testDb.db
      .prepare('SELECT name FROM sires WHERE id = ?')
      .get(mare.sire_id as number) as { name: string };
    expect(sire.name).toBe('母の父');
  });

  it('調教師の厩舎を初回登録で保存し、既存名なら既存行を返す', () => {
    const first = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト厩舎馬A',
      trainer: '厩舎つき調教師',
      trainerStable: '栗東'
    });
    const row = testDb.db
      .prepare('SELECT stable FROM trainers WHERE id = ?')
      .get(first.trainerId as number) as { stable: string | null };
    expect(row.stable).toBe('栗東');

    // 既存名は stable を渡さなくても既存行にマッチする
    const second = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト厩舎馬B',
      trainer: '厩舎つき調教師'
    });
    expect(second.trainerId).toBe(first.trainerId);
    expect(countRows('trainers')).toBe(1);
  });

  it('空文字・空白だけの血統名はマスタを作らず null を返す', () => {
    const result = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト空白血統馬',
      sire: '   ',
      mare: '',
      owner: '',
      breeder: ''
    });

    expect(result.sireId).toBeUndefined();
    expect(result.mareId).toBeUndefined();
    expect(result.ownerId).toBeUndefined();
    expect(result.breederId).toBeUndefined();
    expect(countRows('sires')).toBe(0);
    expect(countRows('mares')).toBe(0);
  });

  it('新規登録では採番された id で行を引ける', () => {
    const result = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト採番馬',
      birthYear: 2021,
      sex: '牝'
    });

    expect(result.updated).toBe(false);
    const row = testDb.db
      .prepare('SELECT name, birth_year, sex FROM horses WHERE id = ?')
      .get(result.id) as { name: string; birth_year: number | null; sex: string | null };
    expect(row).toEqual({ name: 'テスト採番馬', birth_year: 2021, sex: '牝' });
  });

  it('更新では渡されなかった項目の既存値を NULL で潰さない', () => {
    const first = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト上書き馬',
      jraHorseId: '2017104555',
      birthYear: 2017,
      sex: '牡',
      sire: '上書き父',
      mare: '上書き母',
      trainer: '上書き調教師',
      owner: '上書き馬主',
      breeder: '上書き生産者'
    });

    // 名前と血統登録番号だけを持つ取り込み
    const second = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト上書き馬',
      jraHorseId: '2017104555'
    });
    expect(second.updated).toBe(true);
    expect(second.id).toBe(first.id);

    const row = testDb.db
      .prepare(
        'SELECT name, jra_horse_id, birth_year, sex, sire_id, mare_id, trainer_id, owner_id, breeder_id FROM horses WHERE id = ?'
      )
      .get(first.id) as Record<string, unknown>;
    expect(row).toEqual({
      name: 'テスト上書き馬',
      jra_horse_id: '2017104555',
      birth_year: 2017,
      sex: '牡',
      sire_id: first.sireId as number,
      mare_id: first.mareId as number,
      trainer_id: first.trainerId as number,
      owner_id: first.ownerId as number,
      breeder_id: first.breederId as number
    });
  });

  it('更新で渡された項目だけを差し替える', () => {
    const first = testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト差替馬',
      jraHorseId: '2016104555',
      birthYear: 2016
    });

    testDb.horseRepo.insertHorseWithBloodline({
      name: 'テスト差替馬',
      jraHorseId: '2016104555',
      birthYear: 2015,
      sex: '騸'
    });

    const row = testDb.db
      .prepare('SELECT birth_year, sex FROM horses WHERE id = ?')
      .get(first.id) as { birth_year: number | null; sex: string | null };
    expect(row).toEqual({ birth_year: 2015, sex: '騸' });
  });

  it('同じデータを2回取り込んでも馬もマスタも重複しない（冪等）', () => {
    const data = {
      name: 'テスト冪等馬',
      jraHorseId: '2015104555',
      birthYear: 2015,
      sex: '牡' as const,
      sire: '冪等父',
      mare: '冪等母',
      maresSire: '冪等母父',
      trainer: '冪等調教師',
      trainerStable: '美浦' as const,
      owner: '冪等馬主',
      breeder: '冪等生産者'
    };

    const first = testDb.horseRepo.insertHorseWithBloodline(data);
    const second = testDb.horseRepo.insertHorseWithBloodline(data);

    expect(second.id).toBe(first.id);
    expect(second.updated).toBe(true);
    expect(countRows('horses')).toBe(1);
    expect(countRows('sires')).toBe(2);
    expect(countRows('mares')).toBe(1);
    expect(countRows('trainers')).toBe(1);
    expect(countRows('owners')).toBe(1);
    expect(countRows('breeders')).toBe(1);
  });
});
