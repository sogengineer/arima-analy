import { describe, it, expect } from 'vitest';
import type { MLFeatures } from '../MachineLearningModel';
import { SCORE_WEIGHTS } from '../../constants/ScoringConstants';

/**
 * MachineLearningModel 単体テスト
 *
 * @remarks
 * MachineLearningModelはDB依存が強いため、純粋関数のロジックをテスト。
 * モデル訓練・予測のE2Eテストは別ファイルで実施。
 */

// ============================================
// ヘルパー関数（MachineLearningModelのロジックを模倣）
// ============================================

/**
 * シグモイド関数（MachineLearningModelと同じ実装）
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

/**
 * 内積計算（MachineLearningModelと同じ実装）
 */
function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
}

/**
 * 特徴量をベクトルに変換（MachineLearningModelと同じ実装）
 */
function featuresToVector(feat: MLFeatures): number[] {
  return [
    feat.recentPerformanceScore / 100,
    feat.venueAptitudeScore / 100,
    feat.distanceAptitudeScore / 100,
    feat.last3FAbilityScore / 100,
    feat.g1AchievementScore / 100,
    feat.rotationAptitudeScore / 100,
    feat.jockeyScore / 100,
    feat.trackConditionScore / 100,
    feat.postPositionScore / 100,
    feat.trainerScore / 100
  ];
}

/**
 * 精度計算（MachineLearningModelと同じ実装）
 */
function calculateAccuracy(preds: number[], labels: number[]): number {
  if (preds.length === 0) return 0;
  const correct = preds.filter((p, i) => p === labels[i]).length;
  return correct / preds.length;
}

/**
 * 評価指標計算（MachineLearningModelと同じ実装）
 */
function calculateMetrics(
  preds: number[],
  labels: number[]
): { precision: number; recall: number; f1Score: number } {
  const tp = preds.filter((p, i) => p === 1 && labels[i] === 1).length;
  const fp = preds.filter((p, i) => p === 1 && labels[i] === 0).length;
  const fn = preds.filter((p, i) => p === 0 && labels[i] === 1).length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1Score };
}

// ============================================
// sigmoid テスト
// ============================================

describe('sigmoid', () => {
  it('x=0のとき0.5を返す', () => {
    expect(sigmoid(0)).toBe(0.5);
  });

  it('xが大きいとき1に近づく', () => {
    expect(sigmoid(10)).toBeCloseTo(1, 4);
    expect(sigmoid(100)).toBeCloseTo(1, 10);
  });

  it('xが小さいとき0に近づく', () => {
    expect(sigmoid(-10)).toBeCloseTo(0, 4);
    expect(sigmoid(-100)).toBeCloseTo(0, 10);
  });

  it('境界値でオーバーフローしない（x > 500）', () => {
    expect(sigmoid(1000)).toBeCloseTo(1, 10);
    expect(sigmoid(-1000)).toBeCloseTo(0, 10);
  });

  it('境界付近で正しく計算する', () => {
    expect(sigmoid(500)).toBeCloseTo(1, 10);
    expect(sigmoid(-500)).toBeCloseTo(0, 10);
  });
});

// ============================================
// dotProduct テスト
// ============================================

describe('dotProduct', () => {
  it('同じ長さのベクトルの内積を計算する', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    expect(dotProduct(a, b)).toBe(32);
  });

  it('ゼロベクトルとの内積は0', () => {
    const a = [1, 2, 3];
    const b = [0, 0, 0];
    expect(dotProduct(a, b)).toBe(0);
  });

  it('空のベクトルの内積は0', () => {
    expect(dotProduct([], [])).toBe(0);
  });

  it('長さが異なる場合、短い方に合わせる', () => {
    const a = [1, 2, 3, 4];
    const b = [2, 3];
    // 1*2 + 2*3 + 3*0 + 4*0 = 8
    expect(dotProduct(a, b)).toBe(8);
  });
});

// ============================================
// featuresToVector テスト
// ============================================

describe('featuresToVector', () => {
  it('10要素を0-1に正規化する', () => {
    const features: MLFeatures = {
      recentPerformanceScore: 100,
      venueAptitudeScore: 80,
      distanceAptitudeScore: 60,
      last3FAbilityScore: 70,
      g1AchievementScore: 50,
      rotationAptitudeScore: 40,
      jockeyScore: 30,
      trackConditionScore: 20,
      postPositionScore: 10,
      trainerScore: 0
    };

    const vector = featuresToVector(features);

    expect(vector).toHaveLength(10);
    expect(vector[0]).toBe(1.0);   // 100/100
    expect(vector[1]).toBe(0.8);   // 80/100
    expect(vector[2]).toBe(0.6);   // 60/100
    expect(vector[3]).toBe(0.7);   // 70/100
    expect(vector[4]).toBe(0.5);   // 50/100
    expect(vector[5]).toBe(0.4);   // 40/100
    expect(vector[6]).toBe(0.3);   // 30/100
    expect(vector[7]).toBe(0.2);   // 20/100
    expect(vector[8]).toBe(0.1);   // 10/100
    expect(vector[9]).toBe(0);     // 0/100
  });

  it('全て0の場合、ゼロベクトルを返す', () => {
    const features: MLFeatures = {
      recentPerformanceScore: 0,
      venueAptitudeScore: 0,
      distanceAptitudeScore: 0,
      last3FAbilityScore: 0,
      g1AchievementScore: 0,
      rotationAptitudeScore: 0,
      jockeyScore: 0,
      trackConditionScore: 0,
      postPositionScore: 0,
      trainerScore: 0
    };

    const vector = featuresToVector(features);

    expect(vector.every(v => v === 0)).toBe(true);
  });

  it('全て100の場合、全て1のベクトルを返す', () => {
    const features: MLFeatures = {
      recentPerformanceScore: 100,
      venueAptitudeScore: 100,
      distanceAptitudeScore: 100,
      last3FAbilityScore: 100,
      g1AchievementScore: 100,
      rotationAptitudeScore: 100,
      jockeyScore: 100,
      trackConditionScore: 100,
      postPositionScore: 100,
      trainerScore: 100
    };

    const vector = featuresToVector(features);

    expect(vector.every(v => v === 1)).toBe(true);
  });
});

// ============================================
// calculateAccuracy テスト
// ============================================

describe('calculateAccuracy', () => {
  it('全て正解の場合、1.0を返す', () => {
    const preds = [1, 0, 1, 0, 1];
    const labels = [1, 0, 1, 0, 1];
    expect(calculateAccuracy(preds, labels)).toBe(1.0);
  });

  it('全て不正解の場合、0を返す', () => {
    const preds = [1, 1, 1, 1, 1];
    const labels = [0, 0, 0, 0, 0];
    expect(calculateAccuracy(preds, labels)).toBe(0);
  });

  it('半分正解の場合、0.5を返す', () => {
    const preds = [1, 1, 0, 0];
    const labels = [1, 0, 0, 1];
    expect(calculateAccuracy(preds, labels)).toBe(0.5);
  });

  it('空の配列の場合、0を返す', () => {
    expect(calculateAccuracy([], [])).toBe(0);
  });
});

// ============================================
// calculateMetrics テスト
// ============================================

describe('calculateMetrics', () => {
  it('完全一致の場合、precision=1, recall=1, f1=1', () => {
    const preds = [1, 1, 0, 0];
    const labels = [1, 1, 0, 0];

    const { precision, recall, f1Score } = calculateMetrics(preds, labels);

    expect(precision).toBe(1.0);
    expect(recall).toBe(1.0);
    expect(f1Score).toBe(1.0);
  });

  it('全てfalse positiveの場合、precision=0', () => {
    const preds = [1, 1, 1];
    const labels = [0, 0, 0];

    const { precision, recall, f1Score } = calculateMetrics(preds, labels);

    expect(precision).toBe(0);
    // recall = TP/(TP+FN) = 0/(0+0) = NaN → 0
    expect(recall).toBe(0);
    expect(f1Score).toBe(0);
  });

  it('全てfalse negativeの場合、recall=0', () => {
    const preds = [0, 0, 0];
    const labels = [1, 1, 1];

    const { precision, recall, f1Score } = calculateMetrics(preds, labels);

    // precision = TP/(TP+FP) = 0/(0+0) = NaN → 0
    expect(precision).toBe(0);
    expect(recall).toBe(0);
    expect(f1Score).toBe(0);
  });

  it('混合ケースで正しく計算する', () => {
    // TP=2, FP=1, FN=1, TN=1
    const preds = [1, 1, 1, 0, 0];
    const labels = [1, 1, 0, 1, 0];

    const { precision, recall, f1Score } = calculateMetrics(preds, labels);

    // precision = 2/(2+1) = 0.667
    expect(precision).toBeCloseTo(2 / 3, 3);
    // recall = 2/(2+1) = 0.667
    expect(recall).toBeCloseTo(2 / 3, 3);
    // f1 = 2 * 0.667 * 0.667 / (0.667 + 0.667) = 0.667
    expect(f1Score).toBeCloseTo(2 / 3, 3);
  });
});

// ============================================
// SCORE_WEIGHTS との整合性テスト
// ============================================

describe('SCORE_WEIGHTS 整合性', () => {
  it('MachineLearningModelで使用する10要素と一致する', () => {
    // 10要素が定義されていることを確認
    expect(SCORE_WEIGHTS.recentPerformance).toBeDefined();
    expect(SCORE_WEIGHTS.venueAptitude).toBeDefined();
    expect(SCORE_WEIGHTS.distanceAptitude).toBeDefined();
    expect(SCORE_WEIGHTS.last3FAbility).toBeDefined();
    expect(SCORE_WEIGHTS.g1Achievement).toBeDefined();
    expect(SCORE_WEIGHTS.rotationAptitude).toBeDefined();
    expect(SCORE_WEIGHTS.jockey).toBeDefined();
    expect(SCORE_WEIGHTS.trackCondition).toBeDefined();
    expect(SCORE_WEIGHTS.postPosition).toBeDefined();
    expect(SCORE_WEIGHTS.trainer).toBeDefined();
  });

  it('重みの合計が1.0になる', () => {
    const totalWeight =
      SCORE_WEIGHTS.recentPerformance +
      SCORE_WEIGHTS.venueAptitude +
      SCORE_WEIGHTS.distanceAptitude +
      SCORE_WEIGHTS.last3FAbility +
      SCORE_WEIGHTS.g1Achievement +
      SCORE_WEIGHTS.rotationAptitude +
      SCORE_WEIGHTS.jockey +
      SCORE_WEIGHTS.trackCondition +
      SCORE_WEIGHTS.postPosition +
      SCORE_WEIGHTS.trainer;

    expect(totalWeight).toBeCloseTo(1.0, 5);
  });
});
