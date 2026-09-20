/**
 * MachineLearningModel E2E テスト（合成データ）
 *
 * @remarks
 * 実データが無くても、学習 → walk-forward 検証 → 採用ゲート判定まで
 * 一通り動き、確率が正しい性質（合計1・合計3・非捏造）を満たすことを固定する。
 *
 * **「性能が出る」ことは検証しない**（合成データなので意味がない）。
 * 検証するのは「正しさ」だけ:
 * - 確率が確率になっているか
 * - リークが無いか（学習に未来のレースが入らないか）
 * - ブロックが時系列順か
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../test/helpers/testDb';
import { seedSyntheticRaces } from '../../test/helpers/syntheticRaces';
import { MachineLearningModel, MIN_WALK_FORWARD_RACES } from '../MachineLearningModel';

/** 指定フィールドの合計（加算は先頭から順に行う） */
function sumBy<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

/** console.log を黙らせる */
function silence() {
  return spyOn(console, 'log').mockImplementation(() => {});
}

describe('MachineLearningModel E2E（合成データ）', () => {
  let testDb: TestDatabase;
  let ml: MachineLearningModel;
  let logSpy: ReturnType<typeof silence>;

  beforeEach(() => {
    testDb = createTestDb('ml-e2e');
    logSpy = silence();
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (ml) ml.close();
    testDb.cleanup();
  });

  describe('prepareTrainingData', () => {
    it('レース単位・日付昇順で学習データを組む', () => {
      seedSyntheticRaces(testDb, { races: 12, horsesPerRace: 8, seed: 1 });
      ml = new MachineLearningModel(testDb.db);

      const data = ml.prepareTrainingData();

      expect(data.races.length).toBe(12);
      expect(data.features.length).toBe(12 * 8);
      expect(data.labels.length).toBe(data.features.length);

      // 日付昇順（シャッフルしていない）
      const dates = data.races.map(r => r.raceDate);
      expect([...dates].sort()).toEqual(dates);
    });

    it('各レースの特徴量は当該レースの結果を含まない', () => {
      seedSyntheticRaces(testDb, { races: 6, horsesPerRace: 6, seed: 2 });
      ml = new MachineLearningModel(testDb.db);

      const first = ml.prepareTrainingData().races[0];
      // 初回レースは前走が存在しないので hasPrevRace=0 のはず
      expect(first.samples.every(s => s.features.hasPrevRace === 0)).toBe(true);
      // 通算成績も0
      expect(first.samples.every(s => s.features.careerRunsLog === 0)).toBe(true);
    });
  });

  describe('trainModels', () => {
    it('十分なデータで学習し、収束情報を返す', async () => {
      seedSyntheticRaces(testDb, { races: 20, horsesPerRace: 10, seed: 3 });
      ml = new MachineLearningModel(testDb.db);

      const stats = await ml.trainModels();

      expect(stats.trained).toBe(true);
      expect(stats.trainingRaces).toBe(20);
      expect(stats.win).not.toBeNull();
      expect(stats.show).not.toBeNull();
      expect(stats.win!.weights.every(w => Number.isFinite(w))).toBe(true);
      expect(stats.featureImportance.length).toBeGreaterThan(0);
      // 寄与度は正規化されている
      expect(
        sumBy(stats.featureImportance, f => f.value)
      ).toBeCloseTo(1, 6);
    });

    it('データ不足なら学習せず、ダミーの精度も作らない', async () => {
      seedSyntheticRaces(testDb, { races: 2, horsesPerRace: 4, seed: 4 });
      ml = new MachineLearningModel(testDb.db);

      const stats = await ml.trainModels();

      expect(stats.trained).toBe(false);
      expect(stats.win).toBeNull();
      expect(stats.inSample).toBeNull();
    });
  });

  describe('predict', () => {
    it('単勝確率の合計が1、複勝確率の合計が3になる', async () => {
      seedSyntheticRaces(testDb, { races: 20, horsesPerRace: 10, seed: 5 });
      ml = new MachineLearningModel(testDb.db);
      await ml.trainModels();

      const races = testDb.db.prepare('SELECT id FROM races ORDER BY race_date').all() as {
        id: number;
      }[];
      const predictions = await ml.predict(races[races.length - 1].id);

      expect(predictions.length).toBe(10);
      expect(sumBy(predictions, p => p.winProbability)).toBeCloseTo(1, 6);
      expect(sumBy(predictions, p => p.showProbability)).toBeCloseTo(3, 5);
      expect(predictions.every(p => p.winProbability > 0 && p.winProbability < 1)).toBe(true);
    });

    it('単勝確率の降順で並ぶ', async () => {
      seedSyntheticRaces(testDb, { races: 20, horsesPerRace: 10, seed: 6 });
      ml = new MachineLearningModel(testDb.db);
      await ml.trainModels();

      const raceId = (testDb.db.prepare('SELECT id FROM races ORDER BY race_date DESC').get() as {
        id: number;
      }).id;
      const predictions = await ml.predict(raceId);

      for (let i = 1; i < predictions.length; i++) {
        expect(predictions[i - 1].winProbability).toBeGreaterThanOrEqual(
          predictions[i].winProbability
        );
      }
    });

    it('未学習なら市場の暗黙確率をそのまま返す（確率を捏造しない）', async () => {
      seedSyntheticRaces(testDb, { races: 2, horsesPerRace: 6, seed: 7 });
      ml = new MachineLearningModel(testDb.db);
      await ml.trainModels();

      const raceId = (testDb.db.prepare('SELECT id FROM races ORDER BY race_date DESC').get() as {
        id: number;
      }).id;
      const predictions = await ml.predict(raceId);

      expect(ml.isTrained()).toBe(false);
      expect(predictions.every(p => p.winProbability === p.marketImpliedProb)).toBe(true);
      expect(sumBy(predictions, p => p.winProbability)).toBeCloseTo(1, 6);
    });

    it('自動学習時は予測対象レース自身を学習から除外する（自己学習の防止）', async () => {
      seedSyntheticRaces(testDb, { races: 20, horsesPerRace: 10, seed: 16 });
      ml = new MachineLearningModel(testDb.db);

      const raceId = (testDb.db.prepare('SELECT id FROM races ORDER BY race_date DESC').get() as {
        id: number;
      }).id;

      // trainModels を呼ばずに predict → 内部で除外つき学習が走る
      await ml.predict(raceId);

      expect(ml.getModelStats()!.trainingRaces).toBe(19);
    });

    it('ルールベース10要素は予測結果に説明として同梱される', async () => {
      seedSyntheticRaces(testDb, { races: 20, horsesPerRace: 8, seed: 8 });
      ml = new MachineLearningModel(testDb.db);
      await ml.trainModels();

      const raceId = (testDb.db.prepare('SELECT id FROM races ORDER BY race_date DESC').get() as {
        id: number;
      }).id;
      const [top] = await ml.predict(raceId);

      expect(top.features.ruleScores).toBeDefined();
      expect(top.features.ruleScores.recentPerformanceScore).toBeGreaterThanOrEqual(0);
      expect(top.ruleTotalScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('walkForwardValidate', () => {
    it('時系列ブロックで検証し、指標とベースラインを返す', () => {
      seedSyntheticRaces(testDb, { races: 40, horsesPerRace: 10, seed: 9 });
      ml = new MachineLearningModel(testDb.db);

      const result = ml.walkForwardValidate({ blocks: 5, minTrainRaces: 0 });

      expect(result.insufficientReason).toBeUndefined();
      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.overall.races).toBeGreaterThan(0);

      // 指標が正常値域にある
      expect(result.overall.logLoss).toBeGreaterThan(0);
      expect(Number.isFinite(result.overall.logLoss)).toBe(true);
      expect(result.overall.brier).toBeGreaterThanOrEqual(0);
      expect(result.overall.top1Accuracy).toBeGreaterThanOrEqual(0);
      expect(result.overall.top1Accuracy).toBeLessThanOrEqual(1);
      expect(result.overall.top3Recall).toBeLessThanOrEqual(1);
      expect(result.overall.spearman).toBeGreaterThanOrEqual(-1);
      expect(result.overall.spearman).toBeLessThanOrEqual(1);

      // ベースラインも同じレース数で算出される
      expect(result.marketBaseline.races).toBe(result.overall.races);
      expect(result.ruleBaseline.races).toBe(result.overall.races);
    });

    it('ブロックは時系列順（シャッフルしない）で、学習は常に検証より前', () => {
      seedSyntheticRaces(testDb, { races: 40, horsesPerRace: 8, seed: 10 });
      ml = new MachineLearningModel(testDb.db);

      const result = ml.walkForwardValidate({ blocks: 4, minTrainRaces: 0 });

      for (let i = 1; i < result.blocks.length; i++) {
        // 後のブロックほど後の期間
        expect(result.blocks[i].from >= result.blocks[i - 1].to).toBe(true);
        // 後のブロックほど学習レースが多い（拡大窓）
        expect(result.blocks[i].trainRaces).toBeGreaterThan(result.blocks[i - 1].trainRaces);
      }
      // 最初の検証ブロックも必ず学習データを持つ
      expect(result.blocks[0].trainRaces).toBeGreaterThan(0);
    });

    it('同一開催日のレースは必ず同じブロックに入る（学習窓に評価ブロック初日以降が入らない）', () => {
      // 1日4レース × 12開催日 = 48レース（JRAの実データと同じ「1日に複数レース」の形）
      seedSyntheticRaces(testDb, {
        races: 48,
        horsesPerRace: 8,
        racesPerDay: 4,
        seed: 21
      });
      ml = new MachineLearningModel(testDb.db);

      // 前提: 実際に「1日に複数レース」になっている
      const dayCount = (
        testDb.db.prepare('SELECT COUNT(DISTINCT race_date) AS d FROM races').get() as { d: number }
      ).d;
      expect(dayCount).toBe(12);

      const result = ml.walkForwardValidate({ blocks: 4, minTrainRaces: 0 });
      expect(result.blocks.length).toBeGreaterThan(0);

      // 学習窓は「評価ブロックの開始インデックスより前のレース全部」の連続した前置きなので、
      // 直前ブロックの最終日 < 当該ブロックの初日 であれば、
      // 学習窓に評価ブロック初日以降のレースは1件も入らない（同日混在が無い）
      for (let i = 1; i < result.blocks.length; i++) {
        expect(result.blocks[i].from > result.blocks[i - 1].to).toBe(true);
      }

      // 各ブロックの初日は、その1つ前のブロックの検証期間に登場しない
      const allFrom = result.blocks.map(b => b.from);
      expect(new Set(allFrom).size).toBe(allFrom.length);
    });

    it('実データ形状（事前オッズ無し・確定オッズは1着のみ）では回収率が算出不能になる', () => {
      seedSyntheticRaces(testDb, {
        races: 40,
        horsesPerRace: 8,
        marketShape: 'resultPageOnly',
        seed: 22
      });
      ml = new MachineLearningModel(testDb.db);

      // 前提: 事前オッズは全馬 NULL、確定オッズは1着馬だけ
      const entryOdds = (
        testDb.db
          .prepare('SELECT COUNT(*) AS c FROM race_entries WHERE win_odds IS NOT NULL')
          .get() as { c: number }
      ).c;
      expect(entryOdds).toBe(0);
      const nonWinnerFinalOdds = (
        testDb.db
          .prepare(
            'SELECT COUNT(*) AS c FROM race_results WHERE final_win_odds IS NOT NULL AND finish_position != 1'
          )
          .get() as { c: number }
      ).c;
      expect(nonWinnerFinalOdds).toBe(0);

      const result = ml.walkForwardValidate({ blocks: 4, minTrainRaces: 0 });

      // 評価自体は行われる
      expect(result.overall.races).toBeGreaterThan(0);
      // 回収率は「算出不能」（的中レースだけの平均配当に化けない）
      expect(result.overall.roiRaces).toBe(0);
      expect(result.overall.winRoi).toBe(0);
      expect(result.marketBaseline.roiRaces).toBe(0);
      // 市場暗黙確率はオッズではなく人気順位から作られる
      expect(result.marketSourceCounts.odds).toBe(0);
      expect(result.marketSourceCounts.popularity).toBeGreaterThan(0);
    });

    it('採用ゲートを2条件で判定する', () => {
      seedSyntheticRaces(testDb, { races: 40, horsesPerRace: 10, seed: 11 });
      ml = new MachineLearningModel(testDb.db);

      const result = ml.walkForwardValidate({ blocks: 5, minTrainRaces: 0 });
      const gate = result.gate;

      expect(gate.beatsMarketLogLoss).toBe(gate.mlLogLoss < gate.marketLogLoss);
      // ゲート②は市場のみモデル基準（top-1 以上 または Brier 以下）
      expect(gate.beatsMarketRanking).toBe(
        gate.mlTop1 >= gate.marketTop1 || gate.mlBrier <= gate.marketBrier
      );
      expect(gate.passed).toBe(gate.beatsMarketLogLoss && gate.beatsMarketRanking);
      // ルールベース top-1 は参考表示として残るが判定には使わない
      expect(gate.ruleTop1).toBeGreaterThanOrEqual(0);
    });

    it('較正テーブルを出力する（合計件数が評価出走数と一致）', () => {
      seedSyntheticRaces(testDb, { races: 40, horsesPerRace: 10, seed: 12 });
      ml = new MachineLearningModel(testDb.db);

      const result = ml.walkForwardValidate({ blocks: 5, minTrainRaces: 0 });
      const total = sumBy(result.calibration, b => b.count);

      expect(result.calibration).toHaveLength(10);
      expect(total).toBe(result.overall.runners);
      expect(
        result.calibration.every(b => b.actualRate >= 0 && b.actualRate <= 1)
      ).toBe(true);
    });

    it('レース数が足りない場合は理由つきで検証をスキップする', () => {
      seedSyntheticRaces(testDb, {
        races: MIN_WALK_FORWARD_RACES - 1,
        horsesPerRace: 8,
        seed: 13
      });
      ml = new MachineLearningModel(testDb.db);

      const result = ml.walkForwardValidate({ blocks: 5, minTrainRaces: 0 });

      expect(result.insufficientReason).toBeDefined();
      expect(result.blocks).toHaveLength(0);
      expect(result.gate.passed).toBe(false);
    });

    it('検証結果は決定論的（同じDBなら同じ数値）', () => {
      seedSyntheticRaces(testDb, { races: 30, horsesPerRace: 8, seed: 14 });
      ml = new MachineLearningModel(testDb.db);

      const a = ml.walkForwardValidate({ blocks: 4, minTrainRaces: 0 });
      const b = ml.walkForwardValidate({ blocks: 4, minTrainRaces: 0 });

      expect(b.overall.logLoss).toBe(a.overall.logLoss);
      expect(b.overall.top1Accuracy).toBe(a.overall.top1Accuracy);
    });
  });

  describe('リーク遮断（学習経路）', () => {
    it('未来レースを丸ごと削除しても、過去レースの学習サンプルは1ビットも変わらない', () => {
      seedSyntheticRaces(testDb, { races: 30, horsesPerRace: 8, seed: 15 });
      ml = new MachineLearningModel(testDb.db);

      const keep = 10;
      const before = ml.prepareTrainingData().races.slice(0, keep);

      // 11レース目以降をまるごと削除する
      const raceIds = (
        testDb.db.prepare('SELECT id FROM races ORDER BY race_date, id').all() as {
          id: number;
        }[]
      )
        .slice(keep)
        .map(r => r.id);

      const placeholders = raceIds.map(() => '?').join(',');
      testDb.db
        .prepare(
          `DELETE FROM race_results WHERE entry_id IN (
             SELECT id FROM race_entries WHERE race_id IN (${placeholders}))`
        )
        .run(...raceIds);
      testDb.db.prepare(`DELETE FROM race_entries WHERE race_id IN (${placeholders})`).run(
        ...raceIds
      );
      testDb.db.prepare(`DELETE FROM races WHERE id IN (${placeholders})`).run(...raceIds);

      const after = ml.prepareTrainingData().races;

      expect(after.length).toBe(keep);
      for (let i = 0; i < keep; i++) {
        expect(after[i].raceId).toBe(before[i].raceId);
        expect(after[i].samples.map(s => s.vector)).toEqual(
          before[i].samples.map(s => s.vector)
        );
        expect(after[i].samples.map(s => s.winLabel)).toEqual(
          before[i].samples.map(s => s.winLabel)
        );
      }
    });
  });
});
