/**
 * 馬情報の参照リポジトリのテスト
 *
 * @remarks
 * 直接発行していた SQL を Kysely のクエリビルダへ組み替えても結果が変わらないことを固定する。
 * 特に as-of 系（`getHorseRaceResults` / `getHorsesRaceResultsBatch` /
 * `getHorsesCourseStatsAsOf` / `getHorsesTrackStatsAsOf` / `getPreviousRacesAsOf`）は
 * **基準日より前だけ・同日は除外・着順が確定していない行は除外**という条件を、
 * 基準日ちょうどのレースと着順なしのエントリーを混ぜた固定データで確認する。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';
import { HorseQueryRepository } from '../HorseQueryRepository';
import { ScoreAggregateRepository } from '../../aggregates/ScoreAggregateRepository';

/** 基準日。この日のレースは as-of の対象外になる（同日は除外） */
const AS_OF = '2024-12-31';

let testDb: TestDatabase;
let repository: HorseQueryRepository;
let horseAId: number;
let horseBId: number;
let horseCId: number;
let nakayamaId: number;
let tokyoId: number;

interface RunParams {
  horseName: string;
  raceDate: string;
  venue: string;
  raceNumber: number;
  raceClass: string;
  raceType: '芝' | 'ダート';
  distance: number;
  trackCondition: '良' | '重';
  finishPosition?: number;
  popularity?: number;
  last3fTime?: number;
  marginSeconds?: number;
  horseWeight?: number;
}

/** レース・出走・（指定があれば）着順を 1 件ずつ登録する */
function addRun(params: RunParams): void {
  const race = testDb.raceRepo.insertRace({
    raceDate: params.raceDate,
    venue: params.venue,
    raceName: `${params.venue}${params.raceNumber}R`,
    raceNumber: params.raceNumber,
    raceClass: params.raceClass,
    raceType: params.raceType,
    distance: params.distance,
    trackCondition: params.trackCondition,
    totalHorses: 16
  });
  const entry = testDb.raceRepo.insertRaceEntry(race.id, {
    horseName: params.horseName,
    sireName: '父1',
    mareName: `母${params.horseName}`,
    jockeyName: '騎手甲',
    horseNumber: 1,
    popularity: params.popularity,
    horseWeight: params.horseWeight
  });
  if (params.finishPosition !== undefined) {
    testDb.raceRepo.insertRaceResult(entry.id, {
      finishPosition: params.finishPosition,
      finishTime: '2:00.0',
      last3fTime: params.last3fTime,
      marginSeconds: params.marginSeconds
    });
  }
}

function venueIdOf(name: string): number {
  const row = testDb.db
    .prepare<{ id: number }, [string]>('SELECT id FROM venues WHERE name = ?')
    .get(name);
  if (!row) throw new Error(`venue not found: ${name}`);
  return row.id;
}

beforeAll(() => {
  testDb = createTestDb('horse-query');
  repository = new HorseQueryRepository(testDb.db);

  horseAId = testDb.horseRepo.insertHorseWithBloodline({
    name: '馬A',
    birthYear: 2020,
    sex: '牡',
    sire: '父1',
    mare: '母馬A',
    trainer: '調教師A',
    owner: '馬主A',
    breeder: '生産者A'
  }).id;
  horseBId = testDb.horseRepo.insertHorseWithBloodline({
    name: '馬B',
    birthYear: 2021,
    sex: '牝',
    sire: '父1',
    mare: '母馬B',
    trainer: '調教師B'
  }).id;
  // 出走の無い馬（バッチ取得で空配列になること）
  horseCId = testDb.horseRepo.insertHorseWithBloodline({
    name: '馬C',
    sire: '父2',
    mare: '母馬C'
  }).id;
  // 同名・別血統の馬（血統での絞り込み用）
  testDb.horseRepo.insertHorseWithBloodline({
    name: '同名馬',
    sire: '父1',
    mare: '母甲'
  });
  testDb.horseRepo.insertHorseWithBloodline({
    name: '同名馬',
    sire: '父2',
    mare: '母乙'
  });

  // 馬A: 基準日より前（着順あり）
  addRun({ horseName: '馬A', raceDate: '2024-01-01', venue: '中山', raceNumber: 11, raceClass: 'G1', raceType: '芝', distance: 2000, trackCondition: '良', finishPosition: 1, popularity: 1, last3fTime: 34.0, marginSeconds: -0.2, horseWeight: 480 });
  addRun({ horseName: '馬A', raceDate: '2024-04-01', venue: '東京', raceNumber: 10, raceClass: '3勝クラス', raceType: 'ダート', distance: 1200, trackCondition: '重', finishPosition: 3, popularity: 2, last3fTime: 36.0, marginSeconds: 0.5, horseWeight: 484 });
  addRun({ horseName: '馬A', raceDate: '2024-09-01', venue: '中山', raceNumber: 9, raceClass: 'オープン', raceType: '芝', distance: 1600, trackCondition: '良', finishPosition: 2, popularity: 1, last3fTime: 33.8, marginSeconds: 0.1, horseWeight: 482 });
  // 馬A: 着順なし（as-of の有無に関わらず集計から除外される）
  addRun({ horseName: '馬A', raceDate: '2024-11-01', venue: '中山', raceNumber: 8, raceClass: 'オープン', raceType: '芝', distance: 2000, trackCondition: '良', popularity: 3 });
  // 馬A: 基準日ちょうど（同日は as-of の対象外）
  addRun({ horseName: '馬A', raceDate: AS_OF, venue: '中山', raceNumber: 11, raceClass: 'G1', raceType: '芝', distance: 2500, trackCondition: '良', finishPosition: 1, popularity: 1, last3fTime: 35.0, marginSeconds: -0.1, horseWeight: 486 });
  // 馬A: 基準日より後
  addRun({ horseName: '馬A', raceDate: '2025-03-01', venue: '東京', raceNumber: 11, raceClass: 'G1', raceType: '芝', distance: 2000, trackCondition: '良', finishPosition: 2, popularity: 2, last3fTime: 34.5, marginSeconds: 0.2, horseWeight: 488 });
  // 馬B: 基準日より前に 1 走だけ
  addRun({ horseName: '馬B', raceDate: '2024-05-05', venue: '中山', raceNumber: 7, raceClass: '1勝クラス', raceType: '芝', distance: 2000, trackCondition: '良', finishPosition: 5, popularity: 4, last3fTime: 35.5, marginSeconds: 1.2, horseWeight: 450 });

  nakayamaId = venueIdOf('中山');
  tokyoId = venueIdOf('東京');

  // 集計テーブル（as-of ではない既存の集計）を用意する
  const scoreRepo = new ScoreAggregateRepository(testDb.db);
  scoreRepo.updateHorseCourseStats(horseAId, nakayamaId, '芝', '中距離', 1);
  scoreRepo.updateHorseCourseStats(horseAId, tokyoId, 'ダート', '短距離', 3);
  scoreRepo.updateHorseCourseStats(horseBId, nakayamaId, '芝', '中距離', 5);
  scoreRepo.updateHorseTrackStats(horseAId, '芝', '良', 1);
  scoreRepo.updateHorseTrackStats(horseAId, 'ダート', '重', 3);
  scoreRepo.updateHorseTrackStats(horseBId, '芝', '良', 5);
});

afterAll(() => {
  testDb.cleanup();
});

describe('HorseQueryRepository の馬マスタ取得', () => {
  it('馬詳細をビューから取得する', () => {
    const detail = repository.getHorseWithDetails(horseAId);
    expect(detail).toMatchObject({
      id: horseAId,
      name: '馬A',
      birth_year: 2020,
      sex: '牡',
      sire_name: '父1',
      mare_name: '母馬A',
      trainer_name: '調教師A',
      owner_name: '馬主A',
      breeder_name: '生産者A'
    });
  });

  it('存在しない馬の詳細は取得できない', () => {
    expect(repository.getHorseWithDetails(9999)).toBeFalsy();
  });

  it('全馬の詳細を名前順で返す', () => {
    expect(repository.getAllHorsesWithDetails().map(detail => detail.name)).toEqual([
      '同名馬',
      '同名馬',
      '馬A',
      '馬B',
      '馬C'
    ]);
  });

  it('馬を ID で取得する', () => {
    expect(repository.getHorseById(horseAId)?.name).toBe('馬A');
    expect(repository.getHorseById(9999)).toBeFalsy();
  });

  it('馬を名前で取得する', () => {
    expect(repository.getHorseByName('馬B')?.id).toBe(horseBId);
    expect(repository.getHorseByName('居ない馬')).toBeFalsy();
  });

  it('馬名だけでも取得でき、父名・母名で同名馬を絞り込める', () => {
    const byNameOnly = repository.getHorseByNameAndBloodline('同名馬');
    expect(byNameOnly?.name).toBe('同名馬');

    const bySire = repository.getHorseByNameAndBloodline('同名馬', '父2');
    const byMare = repository.getHorseByNameAndBloodline('同名馬', undefined, '母甲');
    expect(bySire?.id).not.toBe(byMare?.id);
    expect(repository.getHorseByNameAndBloodline('同名馬', '父1', '母甲')?.id).toBe(byMare?.id);
    expect(repository.getHorseByNameAndBloodline('同名馬', '父1', '母乙')).toBeFalsy();
  });

  it('全馬を名前順で返す', () => {
    expect(repository.getAllHorses().map(horse => horse.name)).toEqual([
      '同名馬',
      '同名馬',
      '馬A',
      '馬B',
      '馬C'
    ]);
  });

  it('複数馬の詳細を ID をキーにしたマップで返す', () => {
    const map = repository.getHorsesWithDetailsBatch([horseAId, horseBId]);
    expect(map.size).toBe(2);
    expect(map.get(horseAId)?.name).toBe('馬A');
    expect(map.get(horseBId)?.name).toBe('馬B');
    expect(repository.getHorsesWithDetailsBatch([]).size).toBe(0);
  });
});

describe('HorseQueryRepository.getHorseRaceResults', () => {
  it('着順の無い出走も含め、日付降順で全件返す', () => {
    const results = repository.getHorseRaceResults(horseAId);
    expect(results.map(result => result.race_date)).toEqual([
      '2025-03-01',
      AS_OF,
      '2024-11-01',
      '2024-09-01',
      '2024-04-01',
      '2024-01-01'
    ]);
    expect(results[2]).toMatchObject({
      race_name: '中山8R',
      venue_name: '中山',
      race_class: 'オープン',
      distance: 2000,
      race_type: '芝',
      track_condition: '良',
      popularity: 3
    });
    expect(results[2]?.finish_position).toBeFalsy();
  });

  it('レース情報・着順・上がり・着差を返す', () => {
    const latest = repository.getHorseRaceResults(horseAId, 1)[0];
    expect(latest).toMatchObject({
      race_name: '東京11R',
      race_date: '2025-03-01',
      venue_name: '東京',
      race_class: 'G1',
      distance: 2000,
      race_type: '芝',
      track_condition: '良',
      popularity: 2,
      finish_position: 2,
      finish_time: '2:00.0',
      last_3f_time: 34.5,
      time_diff_seconds: 0.2
    });
  });

  it('limit で件数を絞る', () => {
    expect(repository.getHorseRaceResults(horseAId, 2).map(result => result.race_date)).toEqual([
      '2025-03-01',
      AS_OF
    ]);
    expect(repository.getHorseRaceResults(horseAId, 0)).toEqual([]);
  });

  it('as-of では基準日より前だけを返し、同日のレースを含めない', () => {
    expect(
      repository.getHorseRaceResults(horseAId, undefined, AS_OF).map(result => result.race_date)
    ).toEqual(['2024-11-01', '2024-09-01', '2024-04-01', '2024-01-01']);
  });

  it('as-of と limit を同時に指定できる', () => {
    expect(
      repository.getHorseRaceResults(horseAId, 2, AS_OF).map(result => result.race_date)
    ).toEqual(['2024-11-01', '2024-09-01']);
  });

  it('出走の無い馬では空配列を返す', () => {
    expect(repository.getHorseRaceResults(horseCId)).toEqual([]);
  });
});

describe('HorseQueryRepository.getHorsesRaceResultsBatch', () => {
  it('馬ごとに日付降順でまとめ、出走の無い馬には空配列を割り当てる', () => {
    const map = repository.getHorsesRaceResultsBatch([horseAId, horseBId, horseCId]);
    expect(map.size).toBe(3);
    expect(map.get(horseAId)?.map(result => result.race_date)).toEqual([
      '2025-03-01',
      AS_OF,
      '2024-11-01',
      '2024-09-01',
      '2024-04-01',
      '2024-01-01'
    ]);
    expect(map.get(horseBId)?.map(result => result.race_date)).toEqual(['2024-05-05']);
    expect(map.get(horseCId)).toEqual([]);
  });

  it('as-of では基準日より前だけを返す', () => {
    const map = repository.getHorsesRaceResultsBatch([horseAId, horseBId], AS_OF);
    expect(map.get(horseAId)?.map(result => result.race_date)).toEqual([
      '2024-11-01',
      '2024-09-01',
      '2024-04-01',
      '2024-01-01'
    ]);
    expect(map.get(horseBId)?.map(result => result.race_date)).toEqual(['2024-05-05']);
  });

  it('馬IDが空なら空のマップを返す', () => {
    expect(repository.getHorsesRaceResultsBatch([]).size).toBe(0);
  });
});

describe('HorseQueryRepository の集計テーブル取得', () => {
  it('コース別成績を会場名付きで返す', () => {
    const stats = repository.getHorseCourseStats(horseAId);
    expect(stats).toHaveLength(2);
    expect(stats.map(stat => stat.venue_name).sort()).toEqual(['中山', '東京']);
    expect(stats.find(stat => stat.venue_name === '中山')).toMatchObject({
      horse_id: horseAId,
      venue_id: nakayamaId,
      race_type: '芝',
      distance_category: '中距離',
      runs: 1,
      wins: 1,
      places: 0,
      shows: 0
    });
  });

  it('馬場別成績を返す', () => {
    const stats = repository.getHorseTrackStats(horseAId);
    expect(stats).toHaveLength(2);
    expect(stats.find(stat => stat.race_type === 'ダート')).toMatchObject({
      horse_id: horseAId,
      track_condition: '重',
      runs: 1,
      wins: 0,
      places: 0,
      shows: 1
    });
  });

  it('コース別成績を馬ごとにまとめて返す', () => {
    const map = repository.getHorsesCourseStatsBatch([horseAId, horseBId, horseCId]);
    expect(map.get(horseAId)).toHaveLength(2);
    expect(map.get(horseBId)).toHaveLength(1);
    expect(map.get(horseCId)).toEqual([]);
    expect(repository.getHorsesCourseStatsBatch([]).size).toBe(0);
  });

  it('馬場別成績を馬ごとにまとめて返す', () => {
    const map = repository.getHorsesTrackStatsBatch([horseAId, horseBId, horseCId]);
    expect(map.get(horseAId)).toHaveLength(2);
    expect(map.get(horseBId)).toHaveLength(1);
    expect(map.get(horseCId)).toEqual([]);
    expect(repository.getHorsesTrackStatsBatch([]).size).toBe(0);
  });
});

describe('HorseQueryRepository.getHorsesCourseStatsAsOf', () => {
  it('基準日より前の着順確定分だけを会場・芝ダ・距離カテゴリで集計する', () => {
    const stats = repository.getHorsesCourseStatsAsOf([horseAId], AS_OF).get(horseAId) ?? [];
    const sorted = [...stats].sort((a, b) =>
      `${a.venue_name}${a.distance_category}`.localeCompare(`${b.venue_name}${b.distance_category}`)
    );
    expect(sorted).toEqual([
      {
        horse_id: horseAId,
        venue_id: nakayamaId,
        venue_name: '中山',
        race_type: '芝',
        distance_category: 'マイル',
        runs: 1,
        wins: 0,
        places: 1,
        shows: 0,
        avg_finish_position: 2
      },
      {
        horse_id: horseAId,
        venue_id: nakayamaId,
        venue_name: '中山',
        race_type: '芝',
        distance_category: '中距離',
        runs: 1,
        wins: 1,
        places: 0,
        shows: 0,
        avg_finish_position: 1
      },
      {
        horse_id: horseAId,
        venue_id: tokyoId,
        venue_name: '東京',
        race_type: 'ダート',
        distance_category: '短距離',
        runs: 1,
        wins: 0,
        places: 0,
        shows: 1,
        avg_finish_position: 3
      }
    ]);
  });

  it('基準日を後ろにずらすと、同日を除いた分まで集計対象が増える', () => {
    const stats = repository.getHorsesCourseStatsAsOf([horseAId], '2025-01-01').get(horseAId) ?? [];
    const longDistance = stats.find(stat => stat.distance_category === '長距離');
    expect(longDistance).toMatchObject({
      venue_name: '中山',
      race_type: '芝',
      runs: 1,
      wins: 1
    });
  });

  it('基準日より前に着順確定の出走が無ければ空配列を返す', () => {
    const map = repository.getHorsesCourseStatsAsOf([horseAId, horseCId], '2024-01-01');
    expect(map.get(horseAId)).toEqual([]);
    expect(map.get(horseCId)).toEqual([]);
    expect(repository.getHorsesCourseStatsAsOf([], AS_OF).size).toBe(0);
  });
});

describe('HorseQueryRepository.getHorsesTrackStatsAsOf', () => {
  it('基準日より前の着順確定分だけを芝ダ・馬場状態で集計する', () => {
    const stats = repository.getHorsesTrackStatsAsOf([horseAId], AS_OF).get(horseAId) ?? [];
    const sorted = [...stats].sort((a, b) => a.race_type.localeCompare(b.race_type));
    expect(sorted).toEqual([
      {
        horse_id: horseAId,
        race_type: 'ダート',
        track_condition: '重',
        runs: 1,
        wins: 0,
        places: 0,
        shows: 1,
        avg_finish_position: 3
      },
      {
        horse_id: horseAId,
        race_type: '芝',
        track_condition: '良',
        runs: 2,
        wins: 1,
        places: 1,
        shows: 0,
        avg_finish_position: 1.5
      }
    ]);
  });

  it('基準日ちょうどのレースを含めない', () => {
    const before = repository.getHorsesTrackStatsAsOf([horseAId], AS_OF).get(horseAId) ?? [];
    const after = repository.getHorsesTrackStatsAsOf([horseAId], '2025-01-01').get(horseAId) ?? [];
    const turfBefore = before.find(stat => stat.race_type === '芝');
    const turfAfter = after.find(stat => stat.race_type === '芝');
    expect(turfBefore?.runs).toBe(2);
    expect(turfAfter?.runs).toBe(3);
  });

  it('馬IDが空なら空のマップを返す', () => {
    expect(repository.getHorsesTrackStatsAsOf([], AS_OF).size).toBe(0);
  });
});

describe('HorseQueryRepository.getPreviousRacesAsOf', () => {
  it('基準日より前で最も新しい着順確定レースを 1 件返す', () => {
    const map = repository.getPreviousRacesAsOf([horseAId, horseBId], AS_OF);
    expect(map.get(horseAId)).toMatchObject({
      horse_id: horseAId,
      race_date: '2024-09-01',
      distance: 1600,
      race_type: '芝',
      popularity: 1,
      horse_weight: 482,
      finish_position: 2,
      last_3f_time: 33.8,
      margin_seconds: 0.1,
      total_horses: 16
    });
    expect(map.get(horseBId)?.race_date).toBe('2024-05-05');
  });

  it('着順の無いレースは前走にしない', () => {
    // 2024-11-01 の出走は着順が無いので、その後の基準日でも 2024-09-01 が前走になる
    expect(repository.getPreviousRacesAsOf([horseAId], '2024-12-01').get(horseAId)?.race_date).toBe(
      '2024-09-01'
    );
  });

  it('基準日ちょうどのレースは前走にしない', () => {
    expect(repository.getPreviousRacesAsOf([horseAId], AS_OF).get(horseAId)?.race_date).toBe(
      '2024-09-01'
    );
    expect(repository.getPreviousRacesAsOf([horseAId], '2025-01-01').get(horseAId)?.race_date).toBe(
      AS_OF
    );
  });

  it('前走が無い馬はキーを持たない', () => {
    const map = repository.getPreviousRacesAsOf([horseAId, horseCId], '2024-01-01');
    expect(map.has(horseAId)).toBe(false);
    expect(map.has(horseCId)).toBe(false);
    expect(repository.getPreviousRacesAsOf([], AS_OF).size).toBe(0);
  });
});
