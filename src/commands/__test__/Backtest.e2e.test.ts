import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, seedTestData, type TestDatabase } from '../../test/helpers/testDb';
import { Backtest } from '../Backtest';

/**
 * Backtest E2Eテスト
 *
 * @remarks
 * Backtestクラスを直接テストすることで、
 * バックテストのE2Eフローを検証する。
 */

describe('Backtest E2E', () => {
  let testDb: TestDatabase;
  let backtest: Backtest;

  beforeEach(() => {
    testDb = createTestDb('backtest');
  });

  afterEach(() => {
    if (backtest) {
      backtest.close();
    }
    testDb.cleanup();
  });

  describe('runQuickSummary', () => {
    it('結果があるレースでサマリーを返す', () => {
      // 完全データをシード（過去レースと結果含む）
      seedTestData(testDb, 'full');

      backtest = new Backtest(testDb.db);
      const summary = backtest.runQuickSummary();

      // 結果が返される（nullでない）
      expect(summary).not.toBeNull();
      if (summary) {
        expect(summary.totalRaces).toBeGreaterThan(0);
        expect(summary.top1Accuracy).toBeGreaterThanOrEqual(0);
        expect(summary.top1Accuracy).toBeLessThanOrEqual(1);
        expect(summary.top3Accuracy).toBeGreaterThanOrEqual(0);
        expect(summary.top3Accuracy).toBeLessThanOrEqual(1);
        expect(summary.avgCorrelation).toBeDefined();
      }
    });

    it('結果がないレースでnullを返す', () => {
      // 基本データのみ（レース結果なし）
      seedTestData(testDb, 'basic');

      backtest = new Backtest(testDb.db);
      const summary = backtest.runQuickSummary();

      // 結果がないのでnull
      expect(summary).toBeNull();
    });

    it('レースが存在しない場合nullを返す', () => {
      // 空のDB（シードなし）
      backtest = new Backtest(testDb.db);
      const summary = backtest.runQuickSummary();

      expect(summary).toBeNull();
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      // コンソール出力を抑制
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('重賞限定でバックテストを実行', async () => {
      // 完全データをシード
      seedTestData(testDb, 'full');

      backtest = new Backtest(testDb.db);

      // エラーなく完了すること
      await expect(backtest.execute({ gradeOnly: true })).resolves.not.toThrow();
    });

    it('全レースでバックテストを実行', async () => {
      seedTestData(testDb, 'full');

      backtest = new Backtest(testDb.db);

      await expect(backtest.execute({ gradeOnly: false })).resolves.not.toThrow();
    });

    it('limit指定でレース数を制限', async () => {
      seedTestData(testDb, 'full');

      backtest = new Backtest(testDb.db);

      await expect(backtest.execute({ limit: 5 })).resolves.not.toThrow();
    });

    it('verbose=trueで詳細表示', async () => {
      seedTestData(testDb, 'full');

      backtest = new Backtest(testDb.db);

      await expect(backtest.execute({ verbose: true })).resolves.not.toThrow();

      // 詳細ログが出力されていることを確認
      expect(console.log).toHaveBeenCalled();
    });

    it('レースなしで終了', async () => {
      // 空のDB
      backtest = new Backtest(testDb.db);

      await expect(backtest.execute()).resolves.not.toThrow();

      // 警告メッセージが出力されること
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('バックテスト対象のレースがありません')
      );
    });
  });

  describe('メトリクス検証', () => {
    it('top1Accuracy, top3Accuracyが0-1の範囲', () => {
      seedTestData(testDb, 'full');

      backtest = new Backtest(testDb.db);
      const summary = backtest.runQuickSummary();

      if (summary) {
        expect(summary.top1Accuracy).toBeGreaterThanOrEqual(0);
        expect(summary.top1Accuracy).toBeLessThanOrEqual(1);
        expect(summary.top3Accuracy).toBeGreaterThanOrEqual(0);
        expect(summary.top3Accuracy).toBeLessThanOrEqual(1);
      }
    });

    it('avgCorrelationが-1から1の範囲', () => {
      seedTestData(testDb, 'full');

      backtest = new Backtest(testDb.db);
      const summary = backtest.runQuickSummary();

      if (summary) {
        expect(summary.avgCorrelation).toBeGreaterThanOrEqual(-1);
        expect(summary.avgCorrelation).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('接続管理', () => {
    it('close後は安全に再closeできる', () => {
      backtest = new Backtest(testDb.db);

      // 複数回closeしてもエラーにならない
      expect(() => {
        backtest.close();
        backtest.close();
      }).not.toThrow();
    });

    it('外部DB接続はcloseしない', () => {
      backtest = new Backtest(testDb.db);
      backtest.close();

      // 外部接続なのでDBは閉じられていない
      // testDbはまだ使用可能
      expect(() => {
        testDb.db.prepare('SELECT 1').get();
      }).not.toThrow();
    });
  });
});
