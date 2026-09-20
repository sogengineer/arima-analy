import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';
import { ScoreAggregateRepository } from '../ScoreAggregateRepository';
import type { ScoreUpdateData } from '../../../types/RepositoryTypes';

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

describe('ScoreAggregateRepository の集計更新', () => {
  let testDb: TestDatabase;
  let repository: ScoreAggregateRepository;

  beforeEach(() => {
    testDb = createTestDb('score-aggregate');
    repository = new ScoreAggregateRepository(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  /** 馬を1頭作って id を返す */
  function createHorse(name: string): number {
    return testDb.horseRepo.insertHorseWithBloodline({ name, sire: `${name}父`, mare: `${name}母` }).id;
  }

  /** 会場 id を取る（レース登録の副作用で作られる） */
  function createVenueId(): number {
    const race = testDb.raceRepo.insertRace({
      raceDate: '2025-11-01',
      venue: '東京',
      raceName: '会場作成用',
      raceNumber: 1,
      raceType: '芝',
      distance: 2000,
      trackCondition: '良'
    });
    return (testDb.db.prepare('SELECT venue_id FROM races WHERE id = ?').get(race.id) as { venue_id: number })
      .venue_id;
  }

  it('馬場別成績を初回は 1 走で作り、2回目以降は加算する', () => {
    const horseId = createHorse('馬場集計馬');

    repository.updateHorseTrackStats(horseId, '芝', '良', 1);
    expect(testDb.db.query('SELECT race_type, track_condition, runs, wins, places, shows FROM horse_track_stats').all())
      .toEqual([{ race_type: '芝', track_condition: '良', runs: 1, wins: 1, places: 0, shows: 0 }]);

    repository.updateHorseTrackStats(horseId, '芝', '良', 2);
    repository.updateHorseTrackStats(horseId, '芝', '良', 3);
    repository.updateHorseTrackStats(horseId, '芝', '良', 5);
    expect(testDb.db.query('SELECT runs, wins, places, shows FROM horse_track_stats').all())
      .toEqual([{ runs: 4, wins: 1, places: 1, shows: 1 }]);

    // 条件が違えば別行
    repository.updateHorseTrackStats(horseId, 'ダート', '良', 1);
    expect(testDb.db.query('SELECT COUNT(*) AS c FROM horse_track_stats').get()).toEqual({ c: 2 });
  });

  it('コース別成績を初回は 1 走で作り、2回目以降は加算する', () => {
    const horseId = createHorse('コース集計馬');
    const venueId = createVenueId();

    repository.updateHorseCourseStats(horseId, venueId, '芝', '中距離', 2);
    expect(
      testDb.db
        .query('SELECT venue_id, race_type, distance_category, runs, wins, places, shows FROM horse_course_stats')
        .all()
    ).toEqual([
      { venue_id: venueId, race_type: '芝', distance_category: '中距離', runs: 1, wins: 0, places: 1, shows: 0 }
    ]);

    repository.updateHorseCourseStats(horseId, venueId, '芝', '中距離', 1);
    expect(testDb.db.query('SELECT runs, wins, places, shows FROM horse_course_stats').all())
      .toEqual([{ runs: 2, wins: 1, places: 1, shows: 0 }]);
  });

  it('血統統計を初回は 1 走で作り、2回目以降は加算する', () => {
    const horseId = createHorse('血統集計馬');
    const sireId = (
      testDb.db.prepare('SELECT sire_id FROM horses WHERE id = ?').get(horseId) as { sire_id: number }
    ).sire_id;

    repository.updateBloodlineStats(sireId, '芝', '長距離', '重', 3);
    expect(
      testDb.db
        .query('SELECT sire_id, race_type, distance_category, track_condition, runs, wins, places, shows FROM bloodline_stats')
        .all()
    ).toEqual([
      {
        sire_id: sireId,
        race_type: '芝',
        distance_category: '長距離',
        track_condition: '重',
        runs: 1,
        wins: 0,
        places: 0,
        shows: 1
      }
    ]);

    repository.updateBloodlineStats(sireId, '芝', '長距離', '重', 1);
    expect(testDb.db.query('SELECT runs, wins, places, shows FROM bloodline_stats').all())
      .toEqual([{ runs: 2, wins: 1, places: 0, shows: 1 }]);
  });
});

describe('ScoreAggregateRepository.updateHorseScore', () => {
  let testDb: TestDatabase;
  let repository: ScoreAggregateRepository;

  beforeEach(() => {
    testDb = createTestDb('score-upsert');
    repository = new ScoreAggregateRepository(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  /** 10要素 + 総合スコアを一括で作る */
  function scores(base: number): ScoreUpdateData {
    return {
      recent_performance_score: base + 1,
      course_aptitude_score: base + 2,
      distance_aptitude_score: base + 3,
      last_3f_ability_score: base + 4,
      g1_achievement_score: base + 5,
      rotation_score: base + 6,
      track_condition_score: base + 7,
      jockey_score: base + 8,
      trainer_score: base + 9,
      post_position_score: base + 10,
      total_score: base + 11
    };
  }

  function setup() {
    const horseId = testDb.horseRepo.insertHorseWithBloodline({ name: 'スコア馬' }).id;
    const race = testDb.raceRepo.insertRace({
      raceDate: '2025-10-01',
      venue: '阪神',
      raceName: 'スコアレース',
      raceNumber: 1,
      raceType: '芝',
      distance: 1800,
      trackCondition: '良'
    });
    return { horseId, raceId: race.id };
  }

  it('馬とレースの組で1行に収まり、2回目は上書きする', () => {
    const { horseId, raceId } = setup();

    repository.updateHorseScore(horseId, raceId, scores(0));
    expect(
      testDb.db
        .query('SELECT horse_id, race_id, recent_performance_score, jockey_score, total_score FROM horse_scores')
        .all()
    ).toEqual([
      { horse_id: horseId, race_id: raceId, recent_performance_score: 1, jockey_score: 8, total_score: 11 }
    ]);

    repository.updateHorseScore(horseId, raceId, scores(100));
    expect(
      testDb.db
        .query('SELECT horse_id, race_id, recent_performance_score, jockey_score, total_score FROM horse_scores')
        .all()
    ).toEqual([
      { horse_id: horseId, race_id: raceId, recent_performance_score: 101, jockey_score: 108, total_score: 111 }
    ]);
  });

  it('更新で null を渡した要素は既存値を残す（COALESCE）', () => {
    const { horseId, raceId } = setup();
    repository.updateHorseScore(horseId, raceId, scores(0));

    const partial = { ...scores(100), jockey_score: null, total_score: null } as unknown as ScoreUpdateData;
    repository.updateHorseScore(horseId, raceId, partial);

    expect(
      testDb.db
        .query('SELECT recent_performance_score, jockey_score, total_score FROM horse_scores')
        .all()
    ).toEqual([{ recent_performance_score: 101, jockey_score: 8, total_score: 11 }]);
  });

  it('更新で undefined を渡した要素は既存値を残す（旧実装と同じ挙動）', () => {
    const { horseId, raceId } = setup();
    repository.updateHorseScore(horseId, raceId, scores(0));

    // 旧実装（bun:sqlite の直バインド）では undefined が NULL として渡り、
    // COALESCE(NULL, 列) で既存値が保たれていた。同じ結果になることを固定する
    const partial = { ...scores(100), jockey_score: undefined, total_score: undefined } as unknown as ScoreUpdateData;
    expect(() => repository.updateHorseScore(horseId, raceId, partial)).not.toThrow();

    expect(
      testDb.db
        .query('SELECT recent_performance_score, jockey_score, total_score FROM horse_scores')
        .all()
    ).toEqual([{ recent_performance_score: 101, jockey_score: 8, total_score: 11 }]);
  });

  it('新規登録で undefined を渡した要素は DEFAULT ではなく NULL になる（旧実装と同じ挙動）', () => {
    const { horseId, raceId } = setup();

    // 旧実装は全列を明示バインドしていたため、undefined の列には DEFAULT 0 ではなく NULL が入る
    const partial = { ...scores(0), jockey_score: undefined, total_score: undefined } as unknown as ScoreUpdateData;
    repository.updateHorseScore(horseId, raceId, partial);

    expect(
      testDb.db
        .query('SELECT recent_performance_score, jockey_score, total_score FROM horse_scores')
        .all()
    ).toEqual([{ recent_performance_score: 1, jockey_score: null, total_score: null }]);
  });

  it('race_id が NULL の行は UNIQUE の対象外なので毎回追加される', () => {
    const { horseId } = setup();

    repository.updateHorseScore(horseId, null, scores(0));
    repository.updateHorseScore(horseId, null, scores(100));

    expect(testDb.db.query('SELECT race_id, total_score FROM horse_scores ORDER BY id').all())
      .toEqual([
        { race_id: null, total_score: 11 },
        { race_id: null, total_score: 111 }
      ]);
  });
});
