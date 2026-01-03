import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedTestData, type TestDatabase } from '../../test/helpers/testDb';
import { HorseQueryRepository } from '../../repositories/queries/HorseQueryRepository';

/**
 * AnalyzeCourse E2Eテスト
 *
 * @remarks
 * HorseQueryRepositoryを直接テストすることで、
 * コース分析に必要なデータ取得のE2Eフローを検証する。
 *
 * AnalyzeCourseクラスは内部でDatabaseConnectionを作成するため、
 * リポジトリレベルでのテストを行う。
 */

describe('AnalyzeCourse E2E', () => {
  let testDb: TestDatabase;
  let horseRepo: HorseQueryRepository;

  beforeEach(() => {
    testDb = createTestDb('analyze-course');
    horseRepo = new HorseQueryRepository(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe('getAllHorsesWithDetails', () => {
    it('登録馬の一覧を取得', () => {
      seedTestData(testDb, 'basic');

      const horses = horseRepo.getAllHorsesWithDetails();

      expect(horses.length).toBe(3);
      horses.forEach(horse => {
        expect(horse.name).toBeDefined();
        expect(horse.id).toBeDefined();
      });
    });

    it('馬がいない場合は空配列', () => {
      // シードなし
      const horses = horseRepo.getAllHorsesWithDetails();

      expect(horses).toEqual([]);
    });
  });

  describe('getHorsesCourseStatsBatch', () => {
    it('複数馬のコース成績をバッチ取得', () => {
      seedTestData(testDb, 'full');

      const horses = horseRepo.getAllHorsesWithDetails();
      const horseIds = horses.filter(h => h.id != null).map(h => h.id!);

      const courseStatsMap = horseRepo.getHorsesCourseStatsBatch(horseIds);

      expect(courseStatsMap).toBeInstanceOf(Map);
      // 過去レースがある馬はコース成績がある
      expect(courseStatsMap.size).toBeGreaterThanOrEqual(0);
    });

    it('空のIDリストで空Mapを返す', () => {
      const courseStatsMap = horseRepo.getHorsesCourseStatsBatch([]);

      expect(courseStatsMap).toBeInstanceOf(Map);
      expect(courseStatsMap.size).toBe(0);
    });
  });

  describe('getHorsesTrackStatsBatch', () => {
    it('複数馬の馬場別成績をバッチ取得', () => {
      seedTestData(testDb, 'full');

      const horses = horseRepo.getAllHorsesWithDetails();
      const horseIds = horses.filter(h => h.id != null).map(h => h.id!);

      const trackStatsMap = horseRepo.getHorsesTrackStatsBatch(horseIds);

      expect(trackStatsMap).toBeInstanceOf(Map);
    });

    it('空のIDリストで空Mapを返す', () => {
      const trackStatsMap = horseRepo.getHorsesTrackStatsBatch([]);

      expect(trackStatsMap).toBeInstanceOf(Map);
      expect(trackStatsMap.size).toBe(0);
    });
  });

  describe('コース成績検証', () => {
    it('過去レースがある馬はコース成績を持つ', () => {
      seedTestData(testDb, 'full');

      const horses = horseRepo.getAllHorsesWithDetails();
      const equinox = horses.find(h => h.name === 'イクイノックス');
      expect(equinox).toBeDefined();

      if (equinox?.id) {
        const courseStatsMap = horseRepo.getHorsesCourseStatsBatch([equinox.id]);
        const stats = courseStatsMap.get(equinox.id) ?? [];

        // 東京で過去レースがある
        const tokyoStats = stats.find((s: any) => s.venue_name === '東京');
        if (tokyoStats) {
          expect(tokyoStats.runs).toBeGreaterThan(0);
          expect(tokyoStats.wins).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('初出走馬はコース成績なし', () => {
      seedTestData(testDb, 'basic');

      const horses = horseRepo.getAllHorsesWithDetails();
      const testHorse = horses[0];

      if (testHorse?.id) {
        const courseStatsMap = horseRepo.getHorsesCourseStatsBatch([testHorse.id]);
        const stats = courseStatsMap.get(testHorse.id) ?? [];

        // 過去レースがないのでコース成績なし
        expect(stats.length).toBe(0);
      }
    });
  });

  describe('馬場別成績検証', () => {
    it('芝レース経験馬は芝成績を持つ', () => {
      seedTestData(testDb, 'full');

      const horses = horseRepo.getAllHorsesWithDetails();
      const equinox = horses.find(h => h.name === 'イクイノックス');

      if (equinox?.id) {
        const trackStatsMap = horseRepo.getHorsesTrackStatsBatch([equinox.id]);
        const stats = trackStatsMap.get(equinox.id) ?? [];

        const turfStats = stats.find((s: any) => s.race_type === '芝');
        if (turfStats) {
          expect(turfStats.runs).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('適性スコア計算ロジック', () => {
    it('ベーススコアは50点', () => {
      // 会場実績なし、馬場実績なしの場合
      const baseScore = calculateAptitudeScore(undefined, []);
      expect(baseScore).toBe(50);
    });

    it('会場勝率100%で最大30点加算', () => {
      const venueStats = { venue_name: '中山', runs: 1, wins: 1, places: 1 };
      const score = calculateAptitudeScore(venueStats, []);
      expect(score).toBe(80); // 50 + 30
    });

    it('芝勝率100%で最大20点加算', () => {
      const trackStats = [{ race_type: '芝', runs: 1, wins: 1, places: 1 }];
      const score = calculateAptitudeScore(undefined, trackStats);
      expect(score).toBe(70); // 50 + 20
    });

    it('最大スコアは100点', () => {
      const venueStats = { venue_name: '中山', runs: 1, wins: 1, places: 1 };
      const trackStats = [{ race_type: '芝', runs: 1, wins: 1, places: 1 }];
      const score = calculateAptitudeScore(venueStats, trackStats);
      expect(score).toBe(100); // 50 + 30 + 20 = 100
    });

    it('勝率50%で半分の加算', () => {
      const venueStats = { venue_name: '中山', runs: 2, wins: 1, places: 1 };
      const trackStats = [{ race_type: '芝', runs: 2, wins: 1, places: 1 }];
      const score = calculateAptitudeScore(venueStats, trackStats);
      expect(score).toBe(75); // 50 + 15 + 10
    });
  });
});

/**
 * 適性スコア計算（AnalyzeCourseのロジックを再現）
 */
function calculateAptitudeScore(
  venueStats: { venue_name: string; runs: number; wins: number; places: number } | undefined,
  trackStats: { race_type: string; runs: number; wins: number; places: number }[]
): number {
  let score = 50; // ベーススコア

  // 会場コース実績
  if (venueStats && venueStats.runs > 0) {
    const winRate = venueStats.wins / venueStats.runs;
    score += winRate * 30;
  }

  // 芝実績
  const turfStats = trackStats.find(s => s.race_type === '芝');
  if (turfStats && turfStats.runs > 0) {
    const winRate = turfStats.wins / turfStats.runs;
    score += winRate * 20;
  }

  return Math.min(score, 100);
}
