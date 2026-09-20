/**
 * RaceAggregateRepository / RaceRowWriters の書き込み内容を固定するテスト
 *
 * @remarks
 * 直接 SQL から Kysely のクエリビルダへ組み替えても **書き込まれる行が 1 列も変わらない**ことを
 * 担保する。そのため INSERT / UPDATE のあとに対象行を全列 SELECT して値を固定する。
 * あわせて次の分岐を固定する:
 * - 既存レースの同定（レース番号での突合 / レース名での突合）
 * - `matchByName` 時の `race_number` 自動採番
 * - 会場・騎手の find-or-create（騎手名が空なら「未定」）
 * - 馬の突合（血統登録番号優先 → 父母名 → 馬名のみ）
 * - UPDATE は COALESCE で既存値を保ち、`finish_status` は INSERT のみ「完走」を既定値にする
 * - 同じレースを 2 回登録しても行が増えない（再インポートの冪等性）
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type {
  RaceImportData,
  EntryImportData,
  ResultImportData
} from '@/types/HorseData';
import { createTestDb, type TestDatabase } from '@/test/helpers/testDb';

/** 全列に値が入るレース */
const FULL_RACE: RaceImportData = {
  raceDate: '2024-12-22',
  venue: 'テスト中山',
  raceNumber: 11,
  raceName: 'テスト有馬記念',
  raceClass: 'G1',
  raceType: '芝',
  distance: 2500,
  trackCondition: '良',
  totalHorses: 16,
  grade: 'G1',
  courseDetail: '芝・右 内',
  ageCondition: '3歳以上',
  sexCondition: '牡・牝',
  weightCondition: '定量',
  weather: '晴',
  startTime: '15:25',
  kaisaiLabel: '5回中山8日',
  lapTimes: '12.5-11.9-11.8'
};

/** 全列に値が入る出馬表エントリ */
const FULL_ENTRY: EntryImportData = {
  horseName: 'テスト出走馬',
  sireName: 'テスト父',
  mareName: 'テスト母',
  jockeyName: 'テスト騎手',
  frameNumber: 4,
  horseNumber: 7,
  assignedWeight: 57.5,
  winOdds: 3.2,
  popularity: 2,
  horseWeight: 480,
  weightChange: -4,
  careerWins: 5,
  careerPlaces: 3,
  careerShows: 2,
  careerRuns: 15,
  totalPrizeMoney: '123456.7'
};

/** 全列に値が入るレース結果 */
const FULL_RESULT: ResultImportData = {
  finishPosition: 1,
  finishStatus: '完走',
  finishTime: '2:30.5',
  finishTimeMs: 150500,
  margin: 'クビ',
  marginSeconds: 0.1,
  last3fTime: 34.8,
  last3fRank: 1,
  cornerPositions: '5-5-4-2',
  finalWinOdds: 3.4,
  finalPlaceOdds: 1.5,
  rating: 118
};

let testDb: TestDatabase;

/**
 * 検証用の SQL
 *
 * @remarks
 * テーブル名を埋め込まず、テーブルごとに定数の SQL を持つ（SQL の組み立てを文字列補間でしない）。
 */
const SELECT_BY_ID = {
  races: 'SELECT * FROM races WHERE id = ?',
  race_entries: 'SELECT * FROM race_entries WHERE id = ?',
  race_results: 'SELECT * FROM race_results WHERE id = ?',
  venues: 'SELECT * FROM venues WHERE id = ?',
  jockeys: 'SELECT * FROM jockeys WHERE id = ?',
  horses: 'SELECT * FROM horses WHERE id = ?'
} as const;

const COUNT_ALL = {
  races: 'SELECT COUNT(*) as c FROM races',
  race_entries: 'SELECT COUNT(*) as c FROM race_entries',
  race_results: 'SELECT COUNT(*) as c FROM race_results',
  jockeys: 'SELECT COUNT(*) as c FROM jockeys'
} as const;

/** 1 行を全列で取る */
function row(table: keyof typeof SELECT_BY_ID, id: number): Record<string, unknown> {
  return testDb.db.prepare(SELECT_BY_ID[table]).get(id) as Record<string, unknown>;
}

function count(table: keyof typeof COUNT_ALL): number {
  return (testDb.db.prepare(COUNT_ALL[table]).get() as { c: number }).c;
}

/** 会場を名前で数える（schema.sql が初期投入する会場と区別する） */
function countVenuesNamed(name: string): number {
  return (
    testDb.db.prepare('SELECT COUNT(*) as c FROM venues WHERE name = ?').get(name) as { c: number }
  ).c;
}

/** エントリ登録に必要な馬を用意する */
function seedHorse(params: { name: string; sire?: string; mare?: string; jraHorseId?: string }): number {
  return testDb.horseRepo.insertHorseWithBloodline({
    name: params.name,
    sire: params.sire,
    mare: params.mare,
    jraHorseId: params.jraHorseId
  }).id;
}

beforeEach(() => {
  testDb = createTestDb('race-aggregate');
});

afterEach(() => {
  testDb.cleanup();
});

describe('insertRace', () => {
  it('新規レースを全列そのまま登録する', () => {
    const result = testDb.raceRepo.insertRace(FULL_RACE);

    expect(result.updated).toBe(false);
    const race = row('races', result.id);
    expect(race).toMatchObject({
      id: result.id,
      race_date: '2024-12-22',
      venue_id: result.venueId,
      race_number: 11,
      race_name: 'テスト有馬記念',
      race_class: 'G1',
      race_type: '芝',
      distance: 2500,
      track_condition: '良',
      age_condition: '3歳以上',
      sex_condition: '牡・牝',
      weight_condition: '定量',
      total_horses: 16,
      prize_money: null,
      jra_race_id: null,
      grade: 'G1',
      course_detail: '芝・右 内',
      weather: '晴',
      start_time: '15:25',
      kaisai_label: '5回中山8日',
      lap_times: '12.5-11.9-11.8'
    });
    expect(race.updated_at).not.toBeNull();
    expect(race.created_at).not.toBeNull();
  });

  it('任意項目を省くと NULL のまま入り、race_number は 1 になる', () => {
    const result = testDb.raceRepo.insertRace({
      raceDate: '2024-01-05',
      venue: 'テスト東京',
      raceName: 'テスト最小レース',
      distance: 1600
    });

    expect(row('races', result.id)).toMatchObject({
      race_number: 1,
      race_name: 'テスト最小レース',
      race_class: null,
      race_type: null,
      distance: 1600,
      track_condition: null,
      total_horses: null,
      grade: null,
      course_detail: null,
      age_condition: null,
      sex_condition: null,
      weight_condition: null,
      weather: null,
      start_time: null,
      kaisai_label: null,
      lap_times: null
    });
  });

  it('日付＋会場＋レース番号が同じなら既存行を更新し、行は増えない（冪等）', () => {
    const first = testDb.raceRepo.insertRace(FULL_RACE);
    const second = testDb.raceRepo.insertRace(FULL_RACE);

    expect(second.updated).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.venueId).toBe(first.venueId);
    expect(count('races')).toBe(1);
    expect(countVenuesNamed('テスト中山')).toBe(1);
  });

  it('更新では渡されなかった項目の既存値を保つ（COALESCE）', () => {
    const first = testDb.raceRepo.insertRace(FULL_RACE);

    testDb.raceRepo.insertRace({
      raceDate: FULL_RACE.raceDate,
      venue: FULL_RACE.venue,
      raceNumber: FULL_RACE.raceNumber,
      raceName: 'テスト改名後',
      distance: 2600,
      weather: '曇'
    });

    expect(row('races', first.id)).toMatchObject({
      race_name: 'テスト改名後',
      distance: 2600,
      weather: '曇',
      // 渡されなかった項目は既存値のまま
      race_class: 'G1',
      race_type: '芝',
      track_condition: '良',
      total_horses: 16,
      grade: 'G1',
      course_detail: '芝・右 内',
      age_condition: '3歳以上',
      sex_condition: '牡・牝',
      weight_condition: '定量',
      start_time: '15:25',
      kaisai_label: '5回中山8日',
      lap_times: '12.5-11.9-11.8'
    });
  });

  it('更新では race_date / venue_id / race_number を書き換えない', () => {
    const first = testDb.raceRepo.insertRace(FULL_RACE);
    testDb.raceRepo.insertRace(FULL_RACE);

    expect(row('races', first.id)).toMatchObject({
      race_date: '2024-12-22',
      venue_id: first.venueId,
      race_number: 11
    });
  });

  it('matchByName ではレース名で突合する（レース番号が違っても同じ行）', () => {
    const first = testDb.raceRepo.insertRace(FULL_RACE);

    const second = testDb.raceRepo.insertRace(
      { ...FULL_RACE, raceNumber: undefined, weather: '雨' },
      true
    );

    expect(second.updated).toBe(true);
    expect(second.id).toBe(first.id);
    expect(count('races')).toBe(1);
    expect(row('races', first.id)).toMatchObject({ race_number: 11, weather: '雨' });
  });

  it('matchByName かつレース番号なしの新規は、同日同会場の最大 race_number + 1 を採番する', () => {
    testDb.raceRepo.insertRace({ ...FULL_RACE, raceNumber: 7, raceName: 'テスト7R' });
    testDb.raceRepo.insertRace({ ...FULL_RACE, raceNumber: 9, raceName: 'テスト9R' });

    const added = testDb.raceRepo.insertRace(
      { ...FULL_RACE, raceNumber: undefined, raceName: 'テスト前走' },
      true
    );

    expect(added.updated).toBe(false);
    expect(row('races', added.id).race_number).toBe(10);
  });

  it('同日同会場にレースが無ければ採番は 1 から始まる', () => {
    const added = testDb.raceRepo.insertRace(
      { ...FULL_RACE, raceNumber: undefined, raceName: 'テスト初戦' },
      true
    );

    expect(row('races', added.id).race_number).toBe(1);
  });

  it('採番は会場ごと・日付ごとに独立している', () => {
    testDb.raceRepo.insertRace({ ...FULL_RACE, raceNumber: 12, raceName: 'テスト12R' });

    const otherVenue = testDb.raceRepo.insertRace(
      { ...FULL_RACE, venue: 'テスト阪神', raceNumber: undefined, raceName: 'テスト別会場' },
      true
    );
    const otherDate = testDb.raceRepo.insertRace(
      { ...FULL_RACE, raceDate: '2024-12-23', raceNumber: undefined, raceName: 'テスト別日' },
      true
    );

    expect(row('races', otherVenue.id).race_number).toBe(1);
    expect(row('races', otherDate.id).race_number).toBe(1);
  });

  it('matchByName でもレース番号が渡されていればそれを使う', () => {
    const added = testDb.raceRepo.insertRace(
      { ...FULL_RACE, raceNumber: 3, raceName: 'テスト番号あり' },
      true
    );

    expect(row('races', added.id).race_number).toBe(3);
  });

  it('会場は名前で find-or-create し、同名なら同じ id を返す', () => {
    const first = testDb.raceRepo.insertRace(FULL_RACE);
    const second = testDb.raceRepo.insertRace({
      ...FULL_RACE,
      raceNumber: 12,
      raceName: 'テスト別レース'
    });

    expect(second.venueId).toBe(first.venueId);
    expect(countVenuesNamed('テスト中山')).toBe(1);
    const venue = row('venues', first.venueId);
    expect(venue).toMatchObject({ name: 'テスト中山', region: null });
  });
});

describe('insertRaceEntry', () => {
  let raceId: number;

  beforeEach(() => {
    raceId = testDb.raceRepo.insertRace(FULL_RACE).id;
    seedHorse({ name: 'テスト出走馬', sire: 'テスト父', mare: 'テスト母' });
  });

  it('新規エントリを全列そのまま登録する', () => {
    const result = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);

    expect(result.updated).toBe(false);
    expect(row('race_entries', result.id)).toMatchObject({
      id: result.id,
      race_id: raceId,
      horse_id: result.horseId,
      jockey_id: result.jockeyId,
      frame_number: 4,
      horse_number: 7,
      assigned_weight: 57.5,
      win_odds: 3.2,
      place_odds_min: null,
      place_odds_max: null,
      popularity: 2,
      horse_weight: 480,
      weight_change: -4,
      career_wins: 5,
      career_places: 3,
      career_shows: 2,
      career_runs: 15,
      total_prize_money: '123456.7'
    });
  });

  it('任意項目を省くと NULL のまま入る', () => {
    const result = testDb.raceRepo.insertRaceEntry(raceId, {
      horseName: 'テスト出走馬',
      sireName: 'テスト父',
      mareName: 'テスト母',
      jockeyName: 'テスト騎手',
      horseNumber: 3
    });

    expect(row('race_entries', result.id)).toMatchObject({
      frame_number: null,
      horse_number: 3,
      assigned_weight: null,
      win_odds: null,
      popularity: null,
      horse_weight: null,
      weight_change: null,
      career_wins: null,
      career_places: null,
      career_shows: null,
      career_runs: null,
      total_prize_money: null
    });
  });

  it('同じレース・同じ馬なら更新し、行は増えない（冪等）', () => {
    const first = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);
    const second = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);

    expect(second.updated).toBe(true);
    expect(second.id).toBe(first.id);
    expect(count('race_entries')).toBe(1);
  });

  it('更新では渡されなかった項目の既存値を保ち、騎手は常に上書きする', () => {
    const first = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);

    const second = testDb.raceRepo.insertRaceEntry(raceId, {
      horseName: FULL_ENTRY.horseName,
      sireName: FULL_ENTRY.sireName,
      mareName: FULL_ENTRY.mareName,
      jockeyName: 'テスト乗替騎手',
      horseNumber: 7,
      winOdds: 9.9
    });

    expect(second.jockeyId).not.toBe(first.jockeyId);
    expect(row('race_entries', first.id)).toMatchObject({
      jockey_id: second.jockeyId,
      win_odds: 9.9,
      // 渡されなかった項目は既存値のまま
      frame_number: 4,
      horse_number: 7,
      assigned_weight: 57.5,
      popularity: 2,
      horse_weight: 480,
      weight_change: -4,
      career_wins: 5,
      career_places: 3,
      career_shows: 2,
      career_runs: 15,
      total_prize_money: '123456.7'
    });
  });

  it('更新で馬番が undefined なら既存の馬番を保つ（旧実装と同じ挙動）', () => {
    const first = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);

    // horseNumber は型の上では必須だが、取り込み経路によっては undefined が来る。
    // 旧実装は undefined を NULL としてバインドしており、COALESCE で既存値が残っていた
    const partial = {
      horseName: FULL_ENTRY.horseName,
      sireName: FULL_ENTRY.sireName,
      mareName: FULL_ENTRY.mareName,
      jockeyName: FULL_ENTRY.jockeyName,
      horseNumber: undefined,
      winOdds: 9.9
    } as unknown as typeof FULL_ENTRY;

    expect(() => testDb.raceRepo.insertRaceEntry(raceId, partial)).not.toThrow();
    expect(row('race_entries', first.id)).toMatchObject({
      horse_number: FULL_ENTRY.horseNumber,
      win_odds: 9.9
    });
  });

  it('更新では race_id / horse_id を書き換えない', () => {
    const first = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);
    testDb.raceRepo.insertRaceEntry(raceId, { ...FULL_ENTRY, horseNumber: 8 });

    expect(row('race_entries', first.id)).toMatchObject({
      race_id: raceId,
      horse_id: first.horseId
    });
  });

  it('騎手は名前で find-or-create し、斤量を default_weight に入れる', () => {
    const result = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);

    expect(row('jockeys', result.jockeyId)).toMatchObject({
      name: 'テスト騎手',
      default_weight: 57.5,
      apprentice_status: null
    });
    expect(count('jockeys')).toBe(1);
  });

  it('騎手名が空白なら「未定」として登録する', () => {
    const result = testDb.raceRepo.insertRaceEntry(raceId, {
      ...FULL_ENTRY,
      jockeyName: '   ',
      assignedWeight: undefined
    });

    expect(row('jockeys', result.jockeyId)).toMatchObject({
      name: '未定',
      default_weight: null
    });
  });

  it('既存騎手の default_weight は上書きしない', () => {
    const first = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY);
    const second = testDb.raceRepo.insertRaceEntry(raceId, {
      ...FULL_ENTRY,
      assignedWeight: 55
    });

    expect(second.jockeyId).toBe(first.jockeyId);
    expect(row('jockeys', first.jockeyId).default_weight).toBe(57.5);
  });

  it('血統登録番号が一致する馬を最優先で突合する', () => {
    const targetId = seedHorse({ name: 'テスト別名馬', jraHorseId: '2020104123' });

    const result = testDb.raceRepo.insertRaceEntry(raceId, {
      ...FULL_ENTRY,
      horseName: 'テスト出走馬',
      jraHorseId: '2020104123',
      horseNumber: 5
    });

    expect(result.horseId).toBe(targetId);
  });

  it('血統登録番号が未一致なら父母名で突合する', () => {
    seedHorse({ name: 'テスト出走馬', sire: 'テスト別父', mare: 'テスト別母' });
    const expected = testDb.db
      .prepare(
        `SELECT h.id FROM horses h
           LEFT JOIN sires s ON h.sire_id = s.id
           LEFT JOIN mares m ON h.mare_id = m.id
          WHERE h.name = ? AND s.name = ? AND m.name = ?`
      )
      .get('テスト出走馬', 'テスト父', 'テスト母') as { id: number };

    const result = testDb.raceRepo.insertRaceEntry(raceId, {
      ...FULL_ENTRY,
      jraHorseId: '9999999999',
      horseNumber: 6
    });

    expect(result.horseId).toBe(expected.id);
  });

  it('父名だけが渡された場合は父名のみで突合する', () => {
    const result = testDb.raceRepo.insertRaceEntry(raceId, {
      ...FULL_ENTRY,
      mareName: undefined,
      horseNumber: 9
    });

    expect(row('horses', result.horseId).name).toBe('テスト出走馬');
  });

  it('父母名がなければ馬名だけで突合する', () => {
    const result = testDb.raceRepo.insertRaceEntry(raceId, {
      ...FULL_ENTRY,
      sireName: undefined,
      mareName: undefined,
      horseNumber: 10
    });

    expect(row('horses', result.horseId).name).toBe('テスト出走馬');
  });

  it('馬が見つからなければ例外を投げ、行を残さない', () => {
    expect(() =>
      testDb.raceRepo.insertRaceEntry(raceId, { ...FULL_ENTRY, horseName: 'テスト未登録馬' })
    ).toThrow(/Horse not found/);
    expect(count('race_entries')).toBe(0);
  });
});

describe('insertRaceResult', () => {
  let entryId: number;

  beforeEach(() => {
    const raceId = testDb.raceRepo.insertRace(FULL_RACE).id;
    seedHorse({ name: 'テスト出走馬', sire: 'テスト父', mare: 'テスト母' });
    entryId = testDb.raceRepo.insertRaceEntry(raceId, FULL_ENTRY).id;
  });

  it('新規結果を全列そのまま登録する', () => {
    const result = testDb.raceRepo.insertRaceResult(entryId, FULL_RESULT);

    expect(result.updated).toBe(false);
    expect(row('race_results', result.id)).toMatchObject({
      id: result.id,
      entry_id: entryId,
      finish_position: 1,
      finish_status: '完走',
      finish_time: '2:30.5',
      finish_time_ms: 150500,
      margin: 'クビ',
      margin_seconds: 0.1,
      last_3f_time: 34.8,
      last_3f_rank: 1,
      corner_positions: '5-5-4-2',
      final_win_odds: 3.4,
      final_place_odds: 1.5,
      rating: 118
    });
  });

  it('新規登録では finish_status の既定値が「完走」になる', () => {
    const result = testDb.raceRepo.insertRaceResult(entryId, { finishPosition: 3 });

    expect(row('race_results', result.id)).toMatchObject({
      finish_position: 3,
      finish_status: '完走',
      finish_time: null,
      finish_time_ms: null,
      margin: null,
      margin_seconds: null,
      last_3f_time: null,
      last_3f_rank: null,
      corner_positions: null,
      final_win_odds: null,
      final_place_odds: null,
      rating: null
    });
  });

  it('新規登録で finish_status が渡されればそれを使う', () => {
    const result = testDb.raceRepo.insertRaceResult(entryId, { finishStatus: '除外' });

    expect(row('race_results', result.id)).toMatchObject({
      finish_position: null,
      finish_status: '除外'
    });
  });

  it('同じエントリなら更新し、行は増えない（冪等）', () => {
    const first = testDb.raceRepo.insertRaceResult(entryId, FULL_RESULT);
    const second = testDb.raceRepo.insertRaceResult(entryId, FULL_RESULT);

    expect(second.updated).toBe(true);
    expect(second.id).toBe(first.id);
    expect(count('race_results')).toBe(1);
  });

  it('更新では渡されなかった項目の既存値を保つ（finish_status に既定値を入れない）', () => {
    const first = testDb.raceRepo.insertRaceResult(entryId, { ...FULL_RESULT, finishStatus: '降着' });

    testDb.raceRepo.insertRaceResult(entryId, { finishPosition: 2 });

    expect(row('race_results', first.id)).toMatchObject({
      finish_position: 2,
      // 渡されなかった finish_status は「完走」で上書きされない
      finish_status: '降着',
      finish_time: '2:30.5',
      finish_time_ms: 150500,
      margin: 'クビ',
      margin_seconds: 0.1,
      last_3f_time: 34.8,
      last_3f_rank: 1,
      corner_positions: '5-5-4-2',
      final_win_odds: 3.4,
      final_place_odds: 1.5,
      rating: 118
    });
  });

  it('更新では entry_id を書き換えない', () => {
    const first = testDb.raceRepo.insertRaceResult(entryId, FULL_RESULT);
    testDb.raceRepo.insertRaceResult(entryId, { finishPosition: 5 });

    expect(row('race_results', first.id).entry_id).toBe(entryId);
  });
});

describe('insertRaceWithEntries', () => {
  beforeEach(() => {
    seedHorse({ name: 'テスト出走馬', sire: 'テスト父', mare: 'テスト母' });
    seedHorse({ name: 'テスト出走馬2', sire: 'テスト父', mare: 'テスト母2' });
  });

  it('レースと出馬表をまとめて登録し、2 回目は更新になる', () => {
    const entries: EntryImportData[] = [
      FULL_ENTRY,
      { ...FULL_ENTRY, horseName: 'テスト出走馬2', mareName: 'テスト母2', horseNumber: 8 }
    ];

    const first = testDb.raceRepo.insertRaceWithEntries(FULL_RACE, entries);
    expect(first.race.updated).toBe(false);
    expect(first.entries).toMatchObject({ insertCount: 2, updateCount: 0, errors: [] });

    const second = testDb.raceRepo.insertRaceWithEntries(FULL_RACE, entries);
    expect(second.race.updated).toBe(true);
    expect(second.entries).toMatchObject({ insertCount: 0, updateCount: 2, errors: [] });

    expect(count('races')).toBe(1);
    expect(count('race_entries')).toBe(2);
  });

  it('馬が見つからないエントリはエラーとして集約し、他のエントリは登録する', () => {
    const result = testDb.raceRepo.insertRaceWithEntries(FULL_RACE, [
      FULL_ENTRY,
      { ...FULL_ENTRY, horseName: 'テスト未登録馬', horseNumber: 8 }
    ]);

    expect(result.entries.insertCount).toBe(1);
    expect(result.entries.errors).toHaveLength(1);
    expect(result.entries.errors[0]).toContain('テスト未登録馬');
    expect(count('race_entries')).toBe(1);
  });
});
