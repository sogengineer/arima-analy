/**
 * as-of 評価（look-ahead リーク遮断）の回帰テスト
 *
 * @remarks
 * 「同じレースを、結果を入れる前と後で評価しても特徴量・スコアが完全に一致すること」
 * を固定する。これが崩れるとバックテストの数字が未来情報で水増しされる。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestDb, type TestDatabase } from '@/test/helpers/testDb';
import { seedSyntheticRaces } from '@/test/helpers/syntheticRaces';
import { ScoringOrchestrator } from '@/domain/services/ScoringOrchestrator';
import { FeatureBuilder } from '@/features/FeatureBuilder';
import { HorseQueryRepository } from '@/repositories/queries/HorseQueryRepository';

/** 配列の総和（加算順は配列順のまま） */
function sumOf(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

/** 対象レースの出走エントリ（entry_id と horse_id）を取得 */
function getEntries(testDb: TestDatabase, raceId: number): { id: number; horse_id: number }[] {
  return testDb.db
    .prepare('SELECT id, horse_id FROM race_entries WHERE race_id = ? ORDER BY horse_number')
    .all(raceId) as { id: number; horse_id: number }[];
}

/** レースのスコアを「馬ID → 10要素」の素朴な形にする */
function scoreSnapshot(orchestrator: ScoringOrchestrator, raceId: number) {
  return orchestrator
    .calculateScoresForRace(raceId)
    .map(r => ({ horseId: r.horseId, scores: r.scores.toPlainObject() }))
    .sort((a, b) => a.horseId - b.horseId);
}

describe('as-of 評価によるリーク遮断', () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDb('asof-leakage');
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it('対象レースの結果を投入しても、そのレースのスコアは変わらない', () => {
    // 最後の1レースだけ結果を入れずに生成する
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 8,
      horsesPerRace: 8,
      resultRaces: 7,
      seed: 7
    });
    const targetRaceId = raceIds[raceIds.length - 1];

    const orchestrator = new ScoringOrchestrator(testDb.db);
    const before = scoreSnapshot(orchestrator, targetRaceId);
    expect(before.length).toBeGreaterThan(0);

    // 対象レースの結果を後から投入する
    const entries = getEntries(testDb, targetRaceId);
    for (let i = 0; i < entries.length; i++) {
      testDb.raceRepo.insertRaceResult(entries[i].id, {
        finishPosition: i + 1,
        finishStatus: '完走',
        finishTime: '2:00.0',
        last3fTime: 33.0,
        finalWinOdds: 2.0
      });
    }

    const after = scoreSnapshot(orchestrator, targetRaceId);
    expect(after).toEqual(before);
  });

  it('対象レースより後のレース結果を追加しても、対象レースのスコアは変わらない', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 10,
      horsesPerRace: 8,
      seed: 11
    });
    // 3番目のレースを評価対象にする（後ろに結果つきレースが7件ある状態）
    const targetRaceId = raceIds[2];

    const orchestrator = new ScoringOrchestrator(testDb.db);
    const withFutureRaces = scoreSnapshot(orchestrator, targetRaceId);

    // 後続レースの結果をすべて削除しても同じスコアになるはず
    const laterRaceIds = raceIds.slice(3);
    const placeholders = laterRaceIds.map(() => '?').join(',');
    testDb.db
      .prepare(
        `DELETE FROM race_results WHERE entry_id IN (
           SELECT id FROM race_entries WHERE race_id IN (${placeholders})
         )`
      )
      .run(...laterRaceIds);

    const withoutFutureRaces = scoreSnapshot(orchestrator, targetRaceId);
    expect(withoutFutureRaces).toEqual(withFutureRaces);
  });

  it('ML 特徴量ベクトルも結果投入の前後で一致する', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 8,
      horsesPerRace: 8,
      resultRaces: 7,
      seed: 21
    });
    const targetRaceId = raceIds[raceIds.length - 1];

    const builder = new FeatureBuilder(testDb.db);
    const before = builder.buildForRace(targetRaceId);
    expect(before).not.toBeNull();
    const beforeVectors = new Map(before!.rows.map(r => [r.horseId, r.vector]));

    const entries = getEntries(testDb, targetRaceId);
    for (let i = 0; i < entries.length; i++) {
      testDb.raceRepo.insertRaceResult(entries[i].id, {
        finishPosition: i + 1,
        finishStatus: '完走',
        finishTime: '2:00.0',
        last3fTime: 33.0,
        finalWinOdds: 2.0
      });
    }

    const after = builder.buildForRace(targetRaceId);
    expect(after).not.toBeNull();
    for (const row of after!.rows) {
      expect(row.vector).toEqual(beforeVectors.get(row.horseId)!);
    }
  });

  it('確定オッズ（払戻用）は特徴量には入らないが、結果投入後に取得できる', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 6,
      resultRaces: 5,
      seed: 5
    });
    const targetRaceId = raceIds[raceIds.length - 1];
    const builder = new FeatureBuilder(testDb.db);

    const before = builder.buildForRace(targetRaceId)!;
    // 全馬に事前オッズ（race_entries.win_odds）が揃っているので市場オッズ特徴が使えている
    expect(before.rows.every(r => r.features.hasMarketOdds === 1)).toBe(true);
    expect(before.marketProbSource).toBe('odds');

    for (const entry of getEntries(testDb, targetRaceId)) {
      testDb.raceRepo.insertRaceResult(entry.id, {
        finishPosition: 1,
        finishStatus: '完走',
        finalWinOdds: 99.9
      });
    }

    const after = builder.buildForRace(targetRaceId)!;
    // 確定オッズは払戻用フィールドにだけ反映される
    expect(after.rows.every(r => r.payoutWinOdds === 99.9)).toBe(true);
    // 特徴量ベクトルは変わらない
    const beforeVectors = new Map(before.rows.map(r => [r.horseId, r.vector]));
    for (const row of after.rows) {
      expect(row.vector).toEqual(beforeVectors.get(row.horseId)!);
    }
  });
});

describe('HorseQueryRepository の as-of カット', () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDb('asof-repo');
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it('beforeDate より前のレースだけを返す（同日は除外）', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 6,
      horsePool: 6,
      seed: 3
    });
    const repo = new HorseQueryRepository(testDb.db);

    const horseId = (
      testDb.db.prepare('SELECT horse_id FROM race_entries LIMIT 1').get() as {
        horse_id: number;
      }
    ).horse_id;

    const targetDate = (
      testDb.db.prepare('SELECT race_date FROM races WHERE id = ?').get(raceIds[3]) as {
        race_date: string;
      }
    ).race_date;

    const all = repo.getHorseRaceResults(horseId);
    const asOf = repo.getHorseRaceResults(horseId, undefined, targetDate);

    expect(all.length).toBeGreaterThan(asOf.length);
    expect(asOf.every(r => r.race_date < targetDate)).toBe(true);
  });

  it('limit はプレースホルダでバインドされ、件数を制限する', () => {
    seedSyntheticRaces(testDb, { races: 6, horsesPerRace: 6, horsePool: 6, seed: 4 });
    const repo = new HorseQueryRepository(testDb.db);
    const horseId = (
      testDb.db.prepare('SELECT horse_id FROM race_entries LIMIT 1').get() as {
        horse_id: number;
      }
    ).horse_id;

    expect(repo.getHorseRaceResults(horseId, 2).length).toBe(2);
    expect(repo.getHorseRaceResults(horseId).length).toBeGreaterThan(2);
  });

  it('as-of 集計は集計テーブルを参照せず race_results から都度集計する', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 6,
      horsePool: 6,
      seed: 9
    });
    const repo = new HorseQueryRepository(testDb.db);
    const horseId = (
      testDb.db.prepare('SELECT horse_id FROM race_entries LIMIT 1').get() as {
        horse_id: number;
      }
    ).horse_id;

    // 集計テーブルは一切更新していないので空
    expect(repo.getHorseCourseStats(horseId).length).toBe(0);
    expect(repo.getHorseTrackStats(horseId).length).toBe(0);

    const lastDate = (
      testDb.db.prepare('SELECT race_date FROM races WHERE id = ?').get(
        raceIds[raceIds.length - 1]
      ) as { race_date: string }
    ).race_date;

    // as-of 集計は結果から組み立てられる
    const course = repo.getHorsesCourseStatsAsOf([horseId], lastDate).get(horseId) ?? [];
    const track = repo.getHorsesTrackStatsAsOf([horseId], lastDate).get(horseId) ?? [];
    expect(course.length).toBeGreaterThan(0);
    expect(track.length).toBeGreaterThan(0);
    expect(course.every(c => c.runs > 0)).toBe(true);

    // 早い時点で切ると出走数が減る
    const earlyDate = (
      testDb.db.prepare('SELECT race_date FROM races WHERE id = ?').get(raceIds[1]) as {
        race_date: string;
      }
    ).race_date;
    const earlyStats = repo.getHorsesCourseStatsAsOf([horseId], earlyDate).get(horseId) ?? [];
    const earlyRuns = sumOf(earlyStats.map(c => c.runs));
    const lateRuns = sumOf(course.map(c => c.runs));
    expect(earlyRuns).toBeLessThan(lateRuns);
  });

  it('前走取得は基準日より前で最も新しい結果を返す', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 6,
      horsePool: 6,
      seed: 13
    });
    const repo = new HorseQueryRepository(testDb.db);
    const horseId = (
      testDb.db.prepare('SELECT horse_id FROM race_entries LIMIT 1').get() as {
        horse_id: number;
      }
    ).horse_id;

    const targetDate = (
      testDb.db.prepare('SELECT race_date FROM races WHERE id = ?').get(raceIds[4]) as {
        race_date: string;
      }
    ).race_date;

    const prev = repo.getPreviousRacesAsOf([horseId], targetDate).get(horseId);
    expect(prev).toBeDefined();
    expect(prev!.race_date < targetDate).toBe(true);

    // 基準日より前の全結果のうち最新であること
    const results = repo
      .getHorseRaceResults(horseId, undefined, targetDate)
      .filter(r => r.finish_position != null);
    expect(prev!.race_date).toBe(results[0].race_date);
  });
});
