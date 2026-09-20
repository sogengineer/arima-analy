/**
 * 統計・スコアの取得リポジトリのテスト
 *
 * @remarks
 * 直接発行していた SQL を Kysely のクエリビルダへ組み替えても、行の内容・件数・
 * 並び順（スコアの降順、種牡馬の名前順）が変わらないことを固定する。
 * `getHorseScoreByHorseId` はレース指定の有無で SQL が分岐するので、両方を確認する。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';
import { StatsQueryRepository } from '../StatsQueryRepository';
import { ScoreAggregateRepository } from '../../aggregates/ScoreAggregateRepository';
import type { ScoreUpdateData } from '../../../types/RepositoryTypes';

let testDb: TestDatabase;
let repository: StatsQueryRepository;
let sireAId: number;
let horseAId: number;
let horseBId: number;
let raceOneId: number;
let raceTwoId: number;

/** 10 要素すべてを同じ値で埋めたスコア（合計だけを引数で変える） */
function scores(totalScore: number): ScoreUpdateData {
  return {
    recent_performance_score: 50,
    course_aptitude_score: 50,
    distance_aptitude_score: 50,
    last_3f_ability_score: 50,
    g1_achievement_score: 50,
    rotation_score: 50,
    track_condition_score: 50,
    jockey_score: 50,
    trainer_score: 50,
    post_position_score: 50,
    total_score: totalScore
  };
}

function sireIdOf(name: string): number {
  const row = testDb.db
    .prepare<{ id: number }, [string]>('SELECT id FROM sires WHERE name = ?')
    .get(name);
  if (!row) throw new Error(`sire not found: ${name}`);
  return row.id;
}

beforeAll(() => {
  testDb = createTestDb('stats-query');
  repository = new StatsQueryRepository(testDb.db);

  horseAId = testDb.horseRepo.insertHorseWithBloodline({
    name: '馬A',
    sire: '父1',
    mare: '母馬A'
  }).id;
  horseBId = testDb.horseRepo.insertHorseWithBloodline({
    name: '馬B',
    sire: '父2',
    mare: '母馬B'
  }).id;
  sireAId = sireIdOf('父1');

  raceOneId = testDb.raceRepo.insertRace({
    raceDate: '2024-01-01',
    venue: '中山',
    raceName: '中山11R',
    raceNumber: 11,
    raceClass: 'G1',
    raceType: '芝',
    distance: 2000,
    trackCondition: '良'
  }).id;
  raceTwoId = testDb.raceRepo.insertRace({
    raceDate: '2024-06-01',
    venue: '東京',
    raceName: '東京11R',
    raceNumber: 11,
    raceClass: 'G1',
    raceType: '芝',
    distance: 2400,
    trackCondition: '良'
  }).id;

  const scoreRepo = new ScoreAggregateRepository(testDb.db);
  scoreRepo.updateBloodlineStats(sireAId, '芝', '中距離', '良', 1);
  scoreRepo.updateBloodlineStats(sireAId, '芝', '中距離', '良', 3);
  scoreRepo.updateBloodlineStats(sireAId, 'ダート', '短距離', '重', 2);
  scoreRepo.updateBloodlineStats(sireIdOf('父2'), '芝', '中距離', '良', 1);

  scoreRepo.updateHorseScore(horseAId, raceOneId, scores(70));
  scoreRepo.updateHorseScore(horseBId, raceOneId, scores(85));
  scoreRepo.updateHorseScore(horseAId, raceTwoId, scores(60));
});

afterAll(() => {
  testDb.cleanup();
});

describe('StatsQueryRepository.getBloodlineStats', () => {
  it('指定した種牡馬の血統統計を種牡馬名付きで返す', () => {
    const stats = repository.getBloodlineStats(sireAId);
    expect(stats).toHaveLength(2);
    expect(stats.every(stat => stat.sire_name === '父1')).toBe(true);
    expect(stats.find(stat => stat.race_type === '芝')).toMatchObject({
      sire_id: sireAId,
      distance_category: '中距離',
      track_condition: '良',
      runs: 2,
      wins: 1,
      places: 0,
      shows: 1,
      win_rate: 0.5
    });
  });

  it('統計の無い種牡馬では空配列を返す', () => {
    expect(repository.getBloodlineStats(9999)).toEqual([]);
  });
});

describe('StatsQueryRepository の馬スコア取得', () => {
  it('レース指定ではそのレースのスコアを総合スコア降順で返す', () => {
    const rows = repository.getHorseScoresForRace(raceOneId);
    expect(rows.map(row => row.horse_name)).toEqual(['馬B', '馬A']);
    expect(rows[0]).toMatchObject({
      horse_id: horseBId,
      race_id: raceOneId,
      total_score: 85,
      recent_performance_score: 50,
      post_position_score: 50
    });
  });

  it('スコアの無いレースでは空配列を返す', () => {
    expect(repository.getHorseScoresForRace(9999)).toEqual([]);
  });

  it('全スコアを総合スコア降順で返す', () => {
    expect(repository.getAllHorseScores().map(row => row.total_score)).toEqual([85, 70, 60]);
  });

  it('馬ID・レースID指定でそのレースのスコアを返す', () => {
    expect(repository.getHorseScoreByHorseId(horseAId, raceTwoId)).toMatchObject({
      horse_id: horseAId,
      race_id: raceTwoId,
      total_score: 60
    });
    expect(repository.getHorseScoreByHorseId(horseAId, 9999)).toBeFalsy();
  });

  it('レースID省略時はレースIDが最大のスコアを 1 件返す', () => {
    expect(repository.getHorseScoreByHorseId(horseAId)).toMatchObject({
      race_id: raceTwoId,
      total_score: 60
    });
  });

  it('スコアの無い馬では取得できない', () => {
    expect(repository.getHorseScoreByHorseId(9999)).toBeFalsy();
  });
});

describe('StatsQueryRepository の種牡馬取得', () => {
  it('全種牡馬を名前順で返す', () => {
    expect(repository.getAllSires().map(sire => sire.name)).toEqual(['父1', '父2']);
  });

  it('種牡馬を ID で取得する', () => {
    expect(repository.getSireById(sireAId)?.name).toBe('父1');
    expect(repository.getSireById(9999)).toBeFalsy();
  });

  it('種牡馬を名前で取得する', () => {
    expect(repository.getSireByName('父2')?.id).toBe(sireIdOf('父2'));
    expect(repository.getSireByName('居ない父')).toBeFalsy();
  });
});
