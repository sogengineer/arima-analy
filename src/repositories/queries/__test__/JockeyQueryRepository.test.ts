/**
 * 騎手統計の取得リポジトリのテスト
 *
 * @remarks
 * as-of（基準日）の有無で結果が変わる境界を固定する。`beforeDate` は
 * **基準日より前だけ・同日は除外・着順が NULL の行は除外**が守られていることを、
 * 基準日ちょうどのレースと着順なしのエントリーを混ぜた固定データで確認する。
 * SQL 定数の出し分けから Kysely の条件付き where へ組み替えても結果が変わらないことを、
 * この期待値がそのまま担保する。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';
import { JockeyQueryRepository } from '../JockeyQueryRepository';

/** 基準日。この日のレースは as-of の対象外になる（同日は除外） */
const AS_OF = '2024-12-31';

let testDb: TestDatabase;
let repository: JockeyQueryRepository;
let jockeyId: number;
let otherJockeyId: number;
let trainerAId: number;
let trainerBId: number;

/** 馬・レース・結果を 1 件ずつ入れて、着順まで登録する */
function addRun(params: {
  horseName: string;
  trainer: string;
  raceDate: string;
  venue: string;
  raceNumber: number;
  raceClass: string;
  jockeyName: string;
  finishPosition?: number;
}): void {
  testDb.horseRepo.insertHorseWithBloodline({
    name: params.horseName,
    sire: '父',
    mare: `母${params.horseName}`,
    trainer: params.trainer
  });
  const race = testDb.raceRepo.insertRace({
    raceDate: params.raceDate,
    venue: params.venue,
    raceName: `${params.venue}${params.raceNumber}R`,
    raceNumber: params.raceNumber,
    raceClass: params.raceClass,
    raceType: '芝',
    distance: 2000,
    trackCondition: '良'
  });
  const entry = testDb.raceRepo.insertRaceEntry(race.id, {
    horseName: params.horseName,
    sireName: '父',
    mareName: `母${params.horseName}`,
    jockeyName: params.jockeyName,
    horseNumber: 1
  });
  testDb.raceRepo.insertRaceResult(entry.id, { finishPosition: params.finishPosition });
}

function idOf(table: 'jockeys' | 'trainers', name: string): number {
  const row = testDb.db.prepare<{ id: number }, [string]>(`SELECT id FROM ${table} WHERE name = ?`).get(name);
  if (!row) throw new Error(`${table} not found: ${name}`);
  return row.id;
}

beforeAll(() => {
  testDb = createTestDb('jockey-query');
  repository = new JockeyQueryRepository(testDb.db);

  // 基準日より前
  addRun({ horseName: '馬A', trainer: '調教師A', raceDate: '2024-01-01', venue: '中山', raceNumber: 11, raceClass: 'G1', jockeyName: '騎手甲', finishPosition: 1 });
  addRun({ horseName: '馬B', trainer: '調教師A', raceDate: '2024-06-01', venue: '中山', raceNumber: 10, raceClass: '3勝クラス', jockeyName: '騎手甲', finishPosition: 2 });
  addRun({ horseName: '馬F', trainer: '調教師B', raceDate: '2024-04-01', venue: '東京', raceNumber: 9, raceClass: '2勝クラス', jockeyName: '騎手甲', finishPosition: 5 });
  // 着順なし（as-of の有無に関わらず常に除外される）
  addRun({ horseName: '馬E', trainer: '調教師A', raceDate: '2024-03-01', venue: '中山', raceNumber: 8, raceClass: 'オープン', jockeyName: '騎手甲' });
  // 基準日ちょうど（同日は除外）
  addRun({ horseName: '馬C', trainer: '調教師B', raceDate: AS_OF, venue: '中山', raceNumber: 11, raceClass: 'GI', jockeyName: '騎手甲', finishPosition: 1 });
  // 基準日より後
  addRun({ horseName: '馬D', trainer: '調教師A', raceDate: '2025-03-01', venue: '東京', raceNumber: 11, raceClass: 'G1', jockeyName: '騎手甲', finishPosition: 3 });
  // 別の騎手（対象騎手の集計に混ざらないこと）
  addRun({ horseName: '馬Z', trainer: '調教師B', raceDate: '2024-02-01', venue: '中山', raceNumber: 7, raceClass: 'G1', jockeyName: '騎手乙', finishPosition: 1 });

  jockeyId = idOf('jockeys', '騎手甲');
  otherJockeyId = idOf('jockeys', '騎手乙');
  trainerAId = idOf('trainers', '調教師A');
  trainerBId = idOf('trainers', '調教師B');
});

afterAll(() => {
  testDb.cleanup();
});

describe('JockeyQueryRepository.getJockeyVenueStats', () => {
  it('as-of なしでは全期間の着順確定分を集計する', () => {
    expect(repository.getJockeyVenueStats(jockeyId, '中山')).toEqual({
      jockey_id: jockeyId,
      venue_name: '中山',
      total_runs: 3,
      wins: 2,
      places: 1,
      shows: 0,
      venue_g1_runs: 2,
      venue_g1_wins: 2
    });
  });

  it('as-of ありでは基準日より前だけを集計し、同日のレースを含めない', () => {
    expect(repository.getJockeyVenueStats(jockeyId, '中山', AS_OF)).toEqual({
      jockey_id: jockeyId,
      venue_name: '中山',
      total_runs: 2,
      wins: 1,
      places: 1,
      shows: 0,
      venue_g1_runs: 1,
      venue_g1_wins: 1
    });
  });

  it('空文字の as-of は as-of なしと同じ結果になる', () => {
    // 空文字は旧実装互換で as-of なし扱い。不正な基準日として弾くのは別件
    expect(repository.getJockeyVenueStats(jockeyId, '中山', '')).toEqual(
      repository.getJockeyVenueStats(jockeyId, '中山')
    );
  });

  it('出走の無い会場では COUNT は 0、SUM は NULL のまま返す', () => {
    // SQLite の SUM は対象行が 0 件だと NULL を返す（COUNT の 0 と揃わない）。
    // G1 側だけ `?? 0` を通るので 0 になる、という既存の非対称をそのまま固定する。
    expect(repository.getJockeyVenueStats(otherJockeyId, '阪神')).toEqual({
      jockey_id: otherJockeyId,
      venue_name: '阪神',
      total_runs: 0,
      wins: null,
      places: null,
      shows: null,
      venue_g1_runs: 0,
      venue_g1_wins: 0
    });
  });
});

describe('JockeyQueryRepository.getJockeyOverallStats', () => {
  it('as-of なしでは全会場・全期間を集計する', () => {
    expect(repository.getJockeyOverallStats(jockeyId)).toEqual({
      jockey_id: jockeyId,
      total_runs: 5,
      wins: 2,
      places: 1,
      shows: 1,
      g1_runs: 3,
      g1_wins: 2
    });
  });

  it('as-of ありでは基準日より後と同日を除く', () => {
    expect(repository.getJockeyOverallStats(jockeyId, AS_OF)).toEqual({
      jockey_id: jockeyId,
      total_runs: 3,
      wins: 1,
      places: 1,
      shows: 0,
      g1_runs: 1,
      g1_wins: 1
    });
  });
});

describe('JockeyQueryRepository.getJockeyTrainerStats', () => {
  it('as-of なしでは騎手・調教師コンビの全期間を集計する', () => {
    expect(repository.getJockeyTrainerStats(jockeyId, trainerAId)).toEqual({
      jockey_id: jockeyId,
      trainer_id: trainerAId,
      total_runs: 3,
      wins: 1,
      places: 1,
      shows: 1
    });
  });

  it('as-of ありでは基準日より前だけを集計する', () => {
    expect(repository.getJockeyTrainerStats(jockeyId, trainerAId, AS_OF)).toEqual({
      jockey_id: jockeyId,
      trainer_id: trainerAId,
      total_runs: 2,
      wins: 1,
      places: 1,
      shows: 0
    });
  });

  it('基準日ちょうどの勝利は as-of 集計に入らない', () => {
    expect(repository.getJockeyTrainerStats(jockeyId, trainerBId)).toEqual({
      jockey_id: jockeyId,
      trainer_id: trainerBId,
      total_runs: 2,
      wins: 1,
      places: 0,
      shows: 0
    });
    expect(repository.getJockeyTrainerStats(jockeyId, trainerBId, AS_OF)).toEqual({
      jockey_id: jockeyId,
      trainer_id: trainerBId,
      total_runs: 1,
      wins: 0,
      places: 0,
      shows: 0
    });
  });
});

describe('JockeyQueryRepository の as-of に空文字を渡した場合', () => {
  it('全体成績・コンビ成績も as-of なしと同じ結果になる', () => {
    // 空文字は旧実装互換で as-of なし扱い。不正な基準日として弾くのは別件
    expect(repository.getJockeyOverallStats(jockeyId, '')).toEqual(
      repository.getJockeyOverallStats(jockeyId)
    );
    expect(repository.getJockeyTrainerStats(jockeyId, trainerAId, '')).toEqual(
      repository.getJockeyTrainerStats(jockeyId, trainerAId)
    );
  });
});

describe('JockeyQueryRepository のマスタ取得', () => {
  it('全騎手を名前順で返す', () => {
    expect(repository.getAllJockeys().map(jockey => jockey.name)).toEqual(['騎手乙', '騎手甲']);
  });

  it('騎手を ID で取得し、存在しない ID では null を返す', () => {
    expect(repository.getJockeyById(jockeyId)?.name).toBe('騎手甲');
    expect(repository.getJockeyById(9999)).toBeNull();
  });

  it('全調教師を名前順で返す', () => {
    expect(repository.getAllTrainers().map(trainer => trainer.name)).toEqual(['調教師A', '調教師B']);
  });

  it('調教師を ID で取得し、存在しない ID では null を返す', () => {
    expect(repository.getTrainerById(trainerBId)?.name).toBe('調教師B');
    expect(repository.getTrainerById(9999)).toBeNull();
  });
});
