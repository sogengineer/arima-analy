/**
 * レース情報の取得リポジトリのテスト
 *
 * @remarks
 * 直接発行の SQL を Kysely のクエリビルダへ組み替えても結果が変わらないことを固定する。
 * 特に次の 3 点を明示的に押さえる。
 * - `getRacesWithResults` の重賞フィルタ（`race_class` の G1/G2/G3 か `race_name` の「記念」）
 * - `getRaceResults` の `COALESCE(finish_position, 999)` 順（結果の無い出走は末尾）
 * - 着順が NULL の結果行は「結果あり」として扱わない
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';
import { RaceQueryRepository } from '../RaceQueryRepository';

let testDb: TestDatabase;
let repository: RaceQueryRepository;

/** レース ID（挿入順に採番される） */
const raceIds: Record<string, number> = {};
/** 馬 ID */
const horseIds: Record<string, number> = {};

function addHorse(name: string): void {
  testDb.horseRepo.insertHorseWithBloodline({
    name,
    birthYear: 2020,
    sex: '牡',
    sire: `父${name}`,
    mare: `母${name}`,
    trainer: `調教師${name}`
  });
  const row = testDb.db
    .prepare<{ id: number }, [string]>('SELECT id FROM horses WHERE name = ?')
    .get(name);
  if (!row) throw new Error(`horse not found: ${name}`);
  horseIds[name] = row.id;
}

beforeAll(() => {
  testDb = createTestDb('race-query');
  repository = new RaceQueryRepository(testDb.db);

  for (const name of ['馬A', '馬B', '馬C', '馬D', '馬E', '馬F']) {
    addHorse(name);
  }

  // R1: 重賞（race_class が G1）。結果あり／結果行の無い出走を混ぜる
  raceIds.r1 = testDb.raceRepo.insertRace({
    raceDate: '2024-01-01',
    venue: '中山',
    raceName: '有馬記念',
    raceNumber: 11,
    raceClass: 'G1',
    raceType: '芝',
    distance: 2500,
    trackCondition: '良',
    totalHorses: 3
  }).id;
  const e1 = testDb.raceRepo.insertRaceEntry(raceIds.r1, {
    horseName: '馬A',
    sireName: '父馬A',
    mareName: '母馬A',
    jockeyName: '騎手甲',
    frameNumber: 1,
    horseNumber: 1,
    assignedWeight: 57,
    winOdds: 3.5,
    popularity: 1
  });
  testDb.raceRepo.insertRaceResult(e1.id, {
    finishPosition: 2,
    finishStatus: '完走',
    finishTime: '2:31.0',
    last3fTime: 34.5,
    finalWinOdds: 3.6
  });
  const e2 = testDb.raceRepo.insertRaceEntry(raceIds.r1, {
    horseName: '馬B',
    sireName: '父馬B',
    mareName: '母馬B',
    jockeyName: '騎手乙',
    frameNumber: 2,
    horseNumber: 2,
    assignedWeight: 55,
    popularity: 2
  });
  testDb.raceRepo.insertRaceResult(e2.id, {
    finishPosition: 1,
    finishStatus: '完走',
    finishTime: '2:30.8',
    last3fTime: 34.0,
    finalWinOdds: 5
  });
  // 結果行そのものが無い出走（COALESCE 順の末尾、払戻オッズからも外れる）
  testDb.raceRepo.insertRaceEntry(raceIds.r1, {
    horseName: '馬C',
    sireName: '父馬C',
    mareName: '母馬C',
    jockeyName: '騎手甲',
    frameNumber: 3,
    horseNumber: 3,
    assignedWeight: 57,
    popularity: 3
  });

  // R2: 平場。結果あり（日付が最も新しい）
  raceIds.r2 = testDb.raceRepo.insertRace({
    raceDate: '2024-06-01',
    venue: '東京',
    raceName: 'テスト特別',
    raceNumber: 10,
    raceClass: '3勝クラス',
    raceType: 'ダート',
    distance: 1600,
    trackCondition: '稍重'
  }).id;
  const e3 = testDb.raceRepo.insertRaceEntry(raceIds.r2, {
    horseName: '馬D',
    sireName: '父馬D',
    mareName: '母馬D',
    jockeyName: '騎手甲',
    horseNumber: 1
  });
  testDb.raceRepo.insertRaceResult(e3.id, { finishPosition: 1, finishStatus: '完走' });

  // R3: 結果行はあるが着順が NULL（「結果あり」には数えない）
  raceIds.r3 = testDb.raceRepo.insertRace({
    raceDate: '2024-03-01',
    venue: '中山',
    raceName: '未結果戦',
    raceNumber: 9,
    raceClass: 'オープン',
    raceType: '芝',
    distance: 2000,
    trackCondition: '良'
  }).id;
  const e4 = testDb.raceRepo.insertRaceEntry(raceIds.r3, {
    horseName: '馬E',
    sireName: '父馬E',
    mareName: '母馬E',
    jockeyName: '騎手乙',
    horseNumber: 1
  });
  testDb.raceRepo.insertRaceResult(e4.id, { finishStatus: '取消' });

  // R4: race_class は重賞ではないが race_name が「記念」を含む（重賞フィルタに入る）
  raceIds.r4 = testDb.raceRepo.insertRace({
    raceDate: '2024-05-01',
    venue: '東京',
    raceName: '記念テスト',
    raceNumber: 8,
    raceClass: 'オープン',
    raceType: '芝',
    distance: 1800,
    trackCondition: '良'
  }).id;
  const e5 = testDb.raceRepo.insertRaceEntry(raceIds.r4, {
    horseName: '馬F',
    sireName: '父馬F',
    mareName: '母馬F',
    jockeyName: '騎手甲',
    horseNumber: 1
  });
  testDb.raceRepo.insertRaceResult(e5.id, { finishPosition: 1, finishStatus: '完走' });
});

afterAll(() => {
  testDb.cleanup();
});

describe('RaceQueryRepository のレース取得', () => {
  it('会場名付きでレースを取得する', () => {
    const race = repository.getRaceWithVenue(raceIds.r1);
    expect(race?.id).toBe(raceIds.r1);
    expect(race?.race_name).toBe('有馬記念');
    expect(race?.venue_name).toBe('中山');
    expect(race?.distance).toBe(2500);
  });

  it('存在しないレース ID では値を返さない', () => {
    expect(repository.getRaceWithVenue(9999) ?? null).toBeNull();
    expect(repository.getRaceById(9999) ?? null).toBeNull();
    expect(repository.getRaceByIdOrName('該当なし') ?? null).toBeNull();
  });

  it('ID でレースを取得する', () => {
    expect(repository.getRaceById(raceIds.r2)?.race_name).toBe('テスト特別');
  });

  it('数値文字列は ID、それ以外はレース名の部分一致で取得する', () => {
    expect(repository.getRaceByIdOrName(String(raceIds.r4))?.race_name).toBe('記念テスト');
    expect(repository.getRaceByIdOrName('有馬')?.id).toBe(raceIds.r1);
  });

  it('LIKE のワイルドカードはエスケープせず、そのまま部分一致に使われる', () => {
    // 旧実装も `LIKE '%' || 入力 || '%'` をバインドしていた（エスケープなし）。
    // `%` / `_` を渡すと全レースに一致するため、先頭の 1 件が返る
    const all = repository.getAllRaces();
    const anyId = all.map(race => race.id);
    expect(anyId).toContain(repository.getRaceByIdOrName('%')?.id);
    expect(anyId).toContain(repository.getRaceByIdOrName('_')?.id);
    // 1 文字の `_` でも「レース名が 1 文字以上」であれば一致する（名前の一部である必要はない）
    expect(repository.getRaceByIdOrName('_')).not.toBeNull();
  });

  it('全レースを日付降順で返す', () => {
    expect(repository.getAllRaces().map(race => [race.id, race.venue_name])).toEqual([
      [raceIds.r2, '東京'],
      [raceIds.r4, '東京'],
      [raceIds.r3, '中山'],
      [raceIds.r1, '中山']
    ]);
  });

  it('全会場を名前順で返す（スキーマ初期投入の 10 場）', () => {
    expect(repository.getAllVenues().map(venue => venue.name)).toEqual([
      '中京',
      '中山',
      '京都',
      '函館',
      '小倉',
      '新潟',
      '札幌',
      '東京',
      '福島',
      '阪神'
    ]);
  });
});

describe('RaceQueryRepository.getRaceEntries', () => {
  it('馬番順に馬・騎手・調教師の情報を添えて返す', () => {
    const entries = repository.getRaceEntries(raceIds.r1);
    expect(entries.map(entry => entry.horse_number)).toEqual([1, 2, 3]);
    expect(entries.map(entry => entry.horse_name)).toEqual(['馬A', '馬B', '馬C']);
    expect(entries.map(entry => entry.jockey_name)).toEqual(['騎手甲', '騎手乙', '騎手甲']);
    expect(entries[0].sire_name).toBe('父馬A');
    expect(entries[0].mare_name).toBe('母馬A');
    expect(entries[0].trainer_name).toBe('調教師馬A');
    expect(entries[0].horse_id).toBe(horseIds.馬A);
    expect(entries[0].assigned_weight).toBe(57);
  });

  it('簡易取得も馬番順で必要な列だけを返す', () => {
    const entries = repository.getRaceEntriesSimple(raceIds.r1);
    expect(entries.map(entry => entry.horse_name)).toEqual(['馬A', '馬B', '馬C']);
    expect(entries.map(entry => entry.horse_number)).toEqual([1, 2, 3]);
    expect(entries[0].horse_id).toBe(horseIds.馬A);
    expect(entries.every(entry => entry.trainer_id != null)).toBe(true);
  });
});

describe('RaceQueryRepository.getRacesWithResults', () => {
  it('着順が確定したレースだけを日付降順で返す', () => {
    expect(repository.getRacesWithResults(false).map(race => race.id)).toEqual([
      raceIds.r2,
      raceIds.r4,
      raceIds.r1
    ]);
  });

  it('重賞限定では race_class の G1/G2/G3 か race_name の「記念」だけを残す', () => {
    expect(repository.getRacesWithResults(true).map(race => race.id)).toEqual([
      raceIds.r4,
      raceIds.r1
    ]);
  });

  it('引数を省略すると重賞限定にならない', () => {
    expect(repository.getRacesWithResults().map(race => race.id)).toEqual([
      raceIds.r2,
      raceIds.r4,
      raceIds.r1
    ]);
  });
});

describe('RaceQueryRepository.getRaceResults', () => {
  it('着順順に返し、結果の無い出走を末尾に置く', () => {
    expect(repository.getRaceResults(raceIds.r1)).toEqual([
      {
        horse_id: horseIds.馬B,
        horse_name: '馬B',
        horse_number: 2,
        finish_position: 1,
        finish_time: '2:30.8',
        last_3f_time: 34
      },
      {
        horse_id: horseIds.馬A,
        horse_name: '馬A',
        horse_number: 1,
        finish_position: 2,
        finish_time: '2:31.0',
        last_3f_time: 34.5
      },
      {
        horse_id: horseIds.馬C,
        horse_name: '馬C',
        horse_number: 3,
        finish_position: null,
        finish_time: null,
        last_3f_time: null
      }
    ]);
  });
});

describe('RaceQueryRepository の市場データ・払戻オッズ', () => {
  it('市場データは馬番順で全出走を返し、結果の無い出走の確定オッズは NULL になる', () => {
    expect(repository.getRaceMarketData(raceIds.r1)).toEqual([
      { horse_id: horseIds.馬A, win_odds: 3.5, popularity: 1, final_win_odds: 3.6 },
      { horse_id: horseIds.馬B, win_odds: null, popularity: 2, final_win_odds: 5 },
      { horse_id: horseIds.馬C, win_odds: null, popularity: 3, final_win_odds: null }
    ]);
  });

  it('払戻オッズは確定単勝オッズが入っている出走だけを返す', () => {
    expect(repository.getRacePayoutOdds(raceIds.r1)).toEqual([
      { horse_id: horseIds.馬A, final_win_odds: 3.6 },
      { horse_id: horseIds.馬B, final_win_odds: 5 }
    ]);
  });
});
