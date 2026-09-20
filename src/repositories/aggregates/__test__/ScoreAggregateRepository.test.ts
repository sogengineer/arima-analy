import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';
import { ScoreAggregateRepository } from '../ScoreAggregateRepository';

describe('ScoreAggregateRepository.rebuildHorseStats', () => {
  let testDb: TestDatabase;
  let repository: ScoreAggregateRepository;
  beforeEach(() => {
    testDb = createTestDb('rebuild-stats');
    repository = new ScoreAggregateRepository(testDb.db);
  });
  afterEach(() => { testDb.cleanup(); });

  function addResult(name: string, finishPosition?: number) {
    const horse = testDb.horseRepo.insertHorseWithBloodline({ name, sire: '父', mare: '母' });
    const race = testDb.raceRepo.insertRace({
      raceDate: '2025-12-01', venue: '中山', raceName: '対象レース',
      raceNumber: 1, raceType: '芝', distance: 2000, trackCondition: '良'
    });
    const entry = testDb.raceRepo.insertRaceEntry(race.id, { horseName: name, sireName: '父', mareName: '母', jockeyName: '騎手', horseNumber: 1 });
    testDb.raceRepo.insertRaceResult(entry.id, { finishPosition });
    return { horse, race, entry };
  }

  it('有効な結果のみを集計し、レース条件訂正時には旧カテゴリを除く', () => {
    const { race } = addResult('勝馬', 1);
    addResult('不明馬');
    addResult('ゼロ着馬', 0);
    addResult('負数着馬', -1);
    expect(repository.rebuildHorseStats()).toBe(1);
    expect(testDb.db.query('SELECT race_type, distance_category, runs, wins FROM horse_course_stats').all())
      .toEqual([{ race_type: '芝', distance_category: '中距離', runs: 1, wins: 1 }]);

    testDb.db.query("UPDATE races SET race_type = 'ダート', distance = 1200, track_condition = '重' WHERE id = ?").run(race.id);
    expect(repository.rebuildHorseStats()).toBe(1);
    expect(testDb.db.query('SELECT race_type, distance_category, runs, wins FROM horse_course_stats').all())
      .toEqual([{ race_type: 'ダート', distance_category: '短距離', runs: 1, wins: 1 }]);
    expect(testDb.db.query('SELECT race_type, track_condition, runs, wins FROM horse_track_stats').all())
      .toEqual([{ race_type: 'ダート', track_condition: '重', runs: 1, wins: 1 }]);
  });

  it('再構築が失敗したら両方の集計表を元に戻す', () => {
    const { entry } = addResult('対象馬', 2);
    repository.rebuildHorseStats();
    const beforeTrack = testDb.db.query('SELECT * FROM horse_track_stats').all();
    const beforeCourse = testDb.db.query('SELECT * FROM horse_course_stats').all();
    testDb.raceRepo.insertRaceResult(entry.id, { finishPosition: 1 });
    testDb.db.exec(`
      CREATE TRIGGER fail_course_insert BEFORE INSERT ON horse_course_stats
      BEGIN SELECT RAISE(ABORT, 'test failure'); END
    `);
    expect(() => repository.rebuildHorseStats()).toThrow('test failure');
    expect(testDb.db.query('SELECT * FROM horse_track_stats').all()).toEqual(beforeTrack);
    expect(testDb.db.query('SELECT * FROM horse_course_stats').all()).toEqual(beforeCourse);
  });

  it('有効な結果がなくなった場合も残存集計を削除する', () => {
    addResult('対象馬', 1);
    repository.rebuildHorseStats();
    testDb.db.exec('UPDATE race_results SET finish_position = NULL');
    expect(repository.rebuildHorseStats()).toBe(0);
    expect(testDb.db.query('SELECT * FROM horse_track_stats').all()).toEqual([]);
    expect(testDb.db.query('SELECT * FROM horse_course_stats').all()).toEqual([]);
  });
});
