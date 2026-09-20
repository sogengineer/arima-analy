/**
 * 出走行のオッズ整理リポジトリのテスト
 *
 * @remarks
 * 期待値は `RebuildStats` が直接発行していた UPDATE を同じフィクスチャで実行して確かめたもの。
 * クリア対象は「同一レースで win_odds を持つのが 1 頭だけ」かつ「出走が 2 頭以上」かつ
 * 「その値が確定オッズと一致」の 3 条件をすべて満たす行だけで、保守的な判定を弱めない。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDb, type TestDatabase } from '@/test/helpers/testDb';
import { EntryOddsAggregateRepository } from '@/repositories/aggregates/EntryOddsAggregateRepository';

let testDb: TestDatabase;
let repository: EntryOddsAggregateRepository;
let horseSeq = 0;

function addRace(monthNumber: number, raceName: string): number {
  return testDb.raceRepo.insertRace({
    raceDate: `2024-0${monthNumber}-01`,
    venue: '中山',
    raceName,
    raceNumber: monthNumber,
    raceClass: 'オープン',
    raceType: '芝',
    distance: 2000,
    trackCondition: '良'
  }).id;
}

function addEntry(
  raceId: number,
  horseNumber: number,
  winOdds?: number,
  finalWinOdds?: number
): void {
  horseSeq += 1;
  const name = `馬${horseSeq}`;
  testDb.horseRepo.insertHorseWithBloodline({
    name,
    sire: `父${name}`,
    mare: `母${name}`,
    trainer: '調教師'
  });
  const entry = testDb.raceRepo.insertRaceEntry(raceId, {
    horseName: name,
    sireName: `父${name}`,
    mareName: `母${name}`,
    jockeyName: '騎手甲',
    horseNumber,
    winOdds
  });
  testDb.raceRepo.insertRaceResult(entry.id, { finishPosition: horseNumber, finalWinOdds });
}

function winOddsByRace(): { race_id: number; horse_number: number; win_odds: number | null }[] {
  return testDb.db
    .prepare<{ race_id: number; horse_number: number; win_odds: number | null }, []>(
      'SELECT race_id, horse_number, win_odds FROM race_entries ORDER BY race_id, horse_number'
    )
    .all();
}

let mixedRaceId: number;
let allOddsRaceId: number;
let soloRaceId: number;
let mismatchRaceId: number;

beforeAll(() => {
  testDb = createTestDb('entry-odds-aggregate');
  repository = new EntryOddsAggregateRepository(testDb.db);

  // 1頭だけオッズがあり、その値が確定オッズと一致する（＝結果由来。クリア対象）
  mixedRaceId = addRace(1, '混入レース');
  addEntry(mixedRaceId, 1, 3.6, 3.6);
  addEntry(mixedRaceId, 2, undefined, 5);
  addEntry(mixedRaceId, 3, undefined, undefined);

  // 全馬にオッズがある（出馬表由来。クリアしない）
  allOddsRaceId = addRace(2, '全馬オッズあり');
  addEntry(allOddsRaceId, 1, 5, 5);
  addEntry(allOddsRaceId, 2, 7, 9);

  // 出走が1頭だけ（「1頭だけオッズあり」の根拠が成立しない。クリアしない）
  soloRaceId = addRace(3, '単走');
  addEntry(soloRaceId, 1, 4, 4);

  // 値が確定オッズと一致しない（クリアしない）
  mismatchRaceId = addRace(4, '不一致');
  addEntry(mismatchRaceId, 1, 9.9, 3);
  addEntry(mismatchRaceId, 2, undefined, 4);
});

afterAll(() => {
  testDb.cleanup();
});

describe('EntryOddsAggregateRepository.clearResultDerivedWinOdds', () => {
  it('結果由来と判定できる行だけをクリアし、その件数を返す', () => {
    expect(repository.clearResultDerivedWinOdds()).toBe(1);

    expect(winOddsByRace()).toEqual([
      { race_id: mixedRaceId, horse_number: 1, win_odds: null },
      { race_id: mixedRaceId, horse_number: 2, win_odds: null },
      { race_id: mixedRaceId, horse_number: 3, win_odds: null },
      { race_id: allOddsRaceId, horse_number: 1, win_odds: 5 },
      { race_id: allOddsRaceId, horse_number: 2, win_odds: 7 },
      { race_id: soloRaceId, horse_number: 1, win_odds: 4 },
      { race_id: mismatchRaceId, horse_number: 1, win_odds: 9.9 },
      { race_id: mismatchRaceId, horse_number: 2, win_odds: null }
    ]);
  });

  it('クリアするものが無ければ 0 を返す', () => {
    expect(repository.clearResultDerivedWinOdds()).toBe(0);
  });
});
