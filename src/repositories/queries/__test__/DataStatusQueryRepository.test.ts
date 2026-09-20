/**
 * 蓄積データの棚卸しリポジトリのテスト
 *
 * @remarks
 * 期待値は `DataStatus` コマンドが直接発行していた SQL を同じフィクスチャで実行して確かめたもの。
 * 移設で表示される数値が変わらないことを、次の境界で固定する。
 * - 「結果あり行数」は着順が確定した結果行だけを数える（結果行があっても着順 NULL は数えない）
 * - 「競馬場」は開催のあった会場数（`COUNT(DISTINCT venue_id)`）であり、会場マスタの件数ではない
 * - 内訳は NULL を 1 グループにまとめ、件数の多い順に並べる
 * - `race_results` の null 率だけは着順が確定した行を母数にする
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDb, type TestDatabase } from '@/test/helpers/testDb';
import { DataStatusQueryRepository } from '@/repositories/queries/DataStatusQueryRepository';

let testDb: TestDatabase;
let repository: DataStatusQueryRepository;

beforeAll(() => {
  testDb = createTestDb('data-status-query');
  repository = new DataStatusQueryRepository(testDb.db);

  const { db, horseRepo, raceRepo } = testDb;
  for (const name of ['馬A', '馬B', '馬C', '馬D', '馬E', '馬F']) {
    horseRepo.insertHorseWithBloodline({
      name,
      sire: `父${name}`,
      mare: `母${name}`,
      trainer: `調教師${name}`
    });
  }

  const r1 = raceRepo.insertRace({
    raceDate: '2024-01-01', venue: '中山', raceName: '有馬記念', raceNumber: 11,
    raceClass: 'G1', raceType: '芝', distance: 2500, trackCondition: '良'
  });
  const r2 = raceRepo.insertRace({
    raceDate: '2024-06-01', venue: '東京', raceName: 'テスト特別', raceNumber: 10,
    raceClass: '3勝クラス', raceType: 'ダート', distance: 1600, trackCondition: '稍重'
  });
  const r3 = raceRepo.insertRace({
    raceDate: '2024-03-01', venue: '中山', raceName: '未結果戦', raceNumber: 9,
    raceClass: 'オープン', raceType: '芝', distance: 2000, trackCondition: '良'
  });
  const r4 = raceRepo.insertRace({
    raceDate: '2024-05-01', venue: '東京', raceName: '記念テスト', raceNumber: 8,
    raceClass: 'オープン', raceType: '芝', distance: 1800, trackCondition: '良'
  });
  raceRepo.insertRace({
    raceDate: '2024-02-01', venue: '中山', raceName: '平場戦', raceNumber: 7,
    raceClass: '1勝クラス', raceType: 'ダート', distance: 1400, trackCondition: '良'
  });
  // 芝ダ別が「(未設定)」になるレース
  raceRepo.insertRace({
    raceDate: '2024-04-01', venue: '東京', raceName: '種別なし戦', raceNumber: 6,
    raceClass: 'オープン', distance: 1600, trackCondition: '良'
  });

  // grade は取り込み経路が別のため、ここでは直接埋める
  db.prepare('UPDATE races SET grade = ? WHERE id IN (?, ?)').run('G1', r1.id, r4.id);

  const e1 = raceRepo.insertRaceEntry(r1.id, {
    horseName: '馬A', sireName: '父馬A', mareName: '母馬A',
    jockeyName: '騎手甲', horseNumber: 1, winOdds: 3.5, popularity: 1
  });
  testDb.raceRepo.insertRaceResult(e1.id, { finishPosition: 2, last3fTime: 34.5, finalWinOdds: 3.6 });
  const e2 = raceRepo.insertRaceEntry(r1.id, {
    horseName: '馬B', sireName: '父馬B', mareName: '母馬B',
    jockeyName: '騎手乙', horseNumber: 2, popularity: 2
  });
  raceRepo.insertRaceResult(e2.id, { finishPosition: 1, last3fTime: 34, finalWinOdds: 5 });
  raceRepo.insertRaceEntry(r1.id, {
    horseName: '馬C', sireName: '父馬C', mareName: '母馬C',
    jockeyName: '騎手甲', horseNumber: 3, popularity: 3
  });
  const e3 = raceRepo.insertRaceEntry(r2.id, {
    horseName: '馬D', sireName: '父馬D', mareName: '母馬D', jockeyName: '騎手甲', horseNumber: 1
  });
  raceRepo.insertRaceResult(e3.id, { finishPosition: 1 });
  // 結果行はあるが着順が NULL
  const e4 = raceRepo.insertRaceEntry(r3.id, {
    horseName: '馬E', sireName: '父馬E', mareName: '母馬E', jockeyName: '騎手乙', horseNumber: 1
  });
  raceRepo.insertRaceResult(e4.id, { finishStatus: '取消' });
  const e5 = raceRepo.insertRaceEntry(r4.id, {
    horseName: '馬F', sireName: '父馬F', mareName: '母馬F', jockeyName: '騎手甲', horseNumber: 1
  });
  raceRepo.insertRaceResult(e5.id, { finishPosition: 1 });
});

afterAll(() => {
  testDb.cleanup();
});

describe('DataStatusQueryRepository.getTotals', () => {
  it('着順が確定した結果行と、開催のあった会場だけを数える', () => {
    expect(repository.getTotals()).toEqual({
      races: 6,
      entries: 6,
      results: 4,
      horses: 6,
      jockeys: 2,
      venues: 2
    });
  });
});

describe('DataStatusQueryRepository.getRaceDatePeriod', () => {
  it('開催日の最初と最後を返す', () => {
    expect(repository.getRaceDatePeriod()).toEqual({
      first_date: '2024-01-01',
      last_date: '2024-06-01'
    });
  });

  it('レースが 1 件も無ければ両方 null を返す', () => {
    const empty = createTestDb('data-status-query-empty');
    try {
      expect(new DataStatusQueryRepository(empty.db).getRaceDatePeriod()).toEqual({
        first_date: null,
        last_date: null
      });
    } finally {
      empty.cleanup();
    }
  });
});

describe('DataStatusQueryRepository.countNullValues', () => {
  it('出走行・レースの列はテーブル全件を母数にする', () => {
    expect(repository.countNullValues({ table: 'race_entries', column: 'win_odds' })).toBe(5);
    expect(repository.countNullValues({ table: 'races', column: 'race_type' })).toBe(1);
  });

  it('結果行の列は着順が確定した行だけを見る', () => {
    // 着順 NULL の結果行（馬E）は上がり3F も NULL だが、母数から外れるので数に入らない
    expect(repository.countNullValues({ table: 'race_results', column: 'last_3f_time' })).toBe(2);
    expect(repository.countNullValues({ table: 'race_results', column: 'finish_position' })).toBe(0);
  });
});

describe('DataStatusQueryRepository のレース内訳', () => {
  it('芝ダ別は NULL を「(未設定)」にまとめて件数降順で返す', () => {
    expect(repository.countRacesByType()).toEqual([
      { label: '芝', count: 3 },
      { label: 'ダート', count: 2 },
      { label: '(未設定)', count: 1 }
    ]);
  });

  it('格付別は NULL を「(平場・特別)」にまとめて件数降順で返す', () => {
    expect(repository.countRacesByGrade()).toEqual([
      { label: '(平場・特別)', count: 4 },
      { label: 'G1', count: 2 }
    ]);
  });

  it('距離の種類数を返す', () => {
    expect(repository.countDistinctDistances()).toBe(5);
  });
});
