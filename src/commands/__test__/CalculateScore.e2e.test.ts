import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedTestData, type TestDatabase } from '../../test/helpers/testDb';
import { ScoringOrchestrator } from '../../domain/services/ScoringOrchestrator';
import { RaceQueryRepository } from '../../repositories/queries/RaceQueryRepository';

/**
 * CalculateScore E2Eテスト
 *
 * @remarks
 * ScoringOrchestratorを直接テストすることで、
 * スコア計算のE2Eフローを検証する。
 */

describe('CalculateScore E2E', () => {
  let testDb: TestDatabase;
  let orchestrator: ScoringOrchestrator;
  let raceRepo: RaceQueryRepository;

  beforeEach(() => {
    testDb = createTestDb('calculate-score');
    orchestrator = new ScoringOrchestrator(testDb.db);
    raceRepo = new RaceQueryRepository(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe('正常系', () => {
    it('レースID指定でスコア計算が実行される', () => {
      // データをシード
      seedTestData(testDb, 'basic');

      // レースを取得
      const races = raceRepo.getAllRaces();
      expect(races.length).toBeGreaterThan(0);
      const race = races[0];

      // スコア計算を実行
      const results = orchestrator.calculateScoresForRace(race.id);

      // 結果を検証
      expect(results.length).toBe(3); // 3頭登録済み
      results.forEach(result => {
        expect(result.horseId).toBeGreaterThan(0);
        expect(result.horseName).toBeDefined();
        expect(result.scores).toBeDefined();
        expect(result.scores.calculateTotalScore()).toBeGreaterThanOrEqual(0);
        expect(result.scores.calculateTotalScore()).toBeLessThanOrEqual(100);
      });
    });

    it('G1レースでスコア計算が実行される', () => {
      // G1データをシード
      seedTestData(testDb, 'g1');

      // G1レースを取得
      const races = raceRepo.getAllRaces();
      const g1Race = races.find(r => r.race_class === 'G1');
      expect(g1Race).toBeDefined();

      // スコア計算を実行
      const results = orchestrator.calculateScoresForRace(g1Race!.id);

      // 結果を検証
      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        const scores = result.scores.toPlainObject();
        // 10要素全てが計算されている
        expect(scores.recentPerformanceScore).toBeDefined();
        expect(scores.venueAptitudeScore).toBeDefined();
        expect(scores.distanceAptitudeScore).toBeDefined();
        expect(scores.last3FAbilityScore).toBeDefined();
        expect(scores.g1AchievementScore).toBeDefined();
        expect(scores.rotationAptitudeScore).toBeDefined();
        expect(scores.jockeyScore).toBeDefined();
        expect(scores.trackConditionScore).toBeDefined();
        expect(scores.postPositionScore).toBeDefined();
        expect(scores.trainerScore).toBeDefined();
      });
    });

    it('過去レース結果がある馬はスコアに反映される', () => {
      // 完全データをシード（過去レース含む）
      seedTestData(testDb, 'full');

      // 最新のレース（有馬記念）を取得
      const races = raceRepo.getAllRaces();
      const arimaRace = races.find(r => r.race_name === '有馬記念');
      expect(arimaRace).toBeDefined();

      // スコア計算を実行
      const results = orchestrator.calculateScoresForRace(arimaRace!.id);

      // イクイノックスは過去G1勝利があるので、recentPerformanceScoreが高いはず
      const equinox = results.find(r => r.horseName === 'イクイノックス');
      expect(equinox).toBeDefined();
      const scores = equinox!.scores.toPlainObject();
      expect(scores.recentPerformanceScore).toBeGreaterThan(0);
    });
  });

  describe('異常系', () => {
    it('存在しないレースIDの場合、エラーをスローする', () => {
      seedTestData(testDb, 'basic');

      expect(() => {
        orchestrator.calculateScoresForRace(99999);
      }).toThrow('Race not found');
    });

    it('出走馬なしの場合、空配列を返す', () => {
      // 馬を登録せずにレースだけ登録
      testDb.raceRepo.insertRace({
        raceDate: '2024-12-22',
        venue: '中山',
        raceNumber: 12,
        raceName: '空のレース',
        raceType: '芝',
        distance: 2000
      });

      const races = raceRepo.getAllRaces();
      const emptyRace = races.find(r => r.race_name === '空のレース');
      expect(emptyRace).toBeDefined();

      const results = orchestrator.calculateScoresForRace(emptyRace!.id);
      expect(results).toEqual([]);
    });
  });

  describe('スコア計算ロジック', () => {
    it('スコアは0-100の範囲内', () => {
      seedTestData(testDb, 'full');

      const races = raceRepo.getAllRaces();
      const race = races[0];
      const results = orchestrator.calculateScoresForRace(race.id);

      results.forEach(result => {
        const scores = result.scores.toPlainObject();
        expect(scores.totalScore).toBeGreaterThanOrEqual(0);
        expect(scores.totalScore).toBeLessThanOrEqual(100);
        expect(scores.recentPerformanceScore).toBeGreaterThanOrEqual(0);
        expect(scores.recentPerformanceScore).toBeLessThanOrEqual(100);
        expect(scores.venueAptitudeScore).toBeGreaterThanOrEqual(0);
        expect(scores.venueAptitudeScore).toBeLessThanOrEqual(100);
      });
    });

    it('初出走馬はデフォルトスコアを持つ', () => {
      // 基本データをシード（過去レースなし）
      seedTestData(testDb, 'basic');

      const races = raceRepo.getAllRaces();
      const race = races[0];
      const results = orchestrator.calculateScoresForRace(race.id);

      results.forEach(result => {
        const scores = result.scores.toPlainObject();
        // 過去レースがないので、会場適性はフォールバック値（50点）
        expect(scores.venueAptitudeScore).toBe(50);
        // 直近成績は低スコア（レース履歴なしでもオッズから基本スコアあり）
        expect(scores.recentPerformanceScore).toBeLessThanOrEqual(10);
      });
    });

    it('馬番情報が正しく引き継がれる', () => {
      seedTestData(testDb, 'basic');

      const races = raceRepo.getAllRaces();
      const race = races[0];
      const results = orchestrator.calculateScoresForRace(race.id);

      // 馬番1,2,3が設定されている
      const horseNumbers = results.map(r => r.horseNumber).sort();
      expect(horseNumbers).toContain(1);
      expect(horseNumbers).toContain(2);
      expect(horseNumbers).toContain(3);
    });
  });
});
