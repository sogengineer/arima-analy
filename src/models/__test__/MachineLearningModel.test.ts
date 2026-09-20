/**
 * MachineLearningModel の純粋関数テスト
 *
 * @remarks
 * 旧テストは「本体と同じ実装をテストファイル内にコピーする」形だったため、
 * 本体を壊してもテストが通ってしまった。本体から export した関数を直接検証する。
 */

import { describe, it, expect } from 'bun:test';
import {
  sigmoid,
  softmax,
  clampProbability,
  binaryLogLoss,
  brierScore,
  spearmanCorrelation,
  computeStandardization,
  standardize,
  trainL2Logistic,
  linearScore,
  predictProbability,
  calibrateShowProbabilities,
  buildCalibrationTable,
  evaluateRaces,
  splitRacesIntoDateBlocks
} from '../MachineLearningModel';
import { FEATURE_NAMES, FEATURE_DIMENSION, toVector } from '../../features/FeatureBuilder';

/** 合計（加算は先頭から順に行う） */
function sumOf(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

describe('sigmoid', () => {
  it('x=0 のとき 0.5', () => {
    expect(sigmoid(0)).toBe(0.5);
  });

  it('大きな入力でもオーバーフローしない', () => {
    expect(sigmoid(1e6)).toBeCloseTo(1, 10);
    expect(sigmoid(-1e6)).toBeCloseTo(0, 10);
  });
});

describe('softmax', () => {
  it('合計が1になる', () => {
    const probs = softmax([1, 2, 3, 4]);
    expect(sumOf(probs)).toBeCloseTo(1, 12);
  });

  it('大きな値でも数値的に安定する（NaNを出さない）', () => {
    const probs = softmax([1000, 1001, 999]);
    expect(probs.every(p => Number.isFinite(p))).toBe(true);
    expect(sumOf(probs)).toBeCloseTo(1, 12);
  });

  it('同じ値なら一様分布', () => {
    const probs = softmax([5, 5, 5, 5]);
    for (const p of probs) expect(p).toBeCloseTo(0.25, 12);
  });

  it('大きい効用ほど確率が高い', () => {
    const probs = softmax([0, 1, 2]);
    expect(probs[2]).toBeGreaterThan(probs[1]);
    expect(probs[1]).toBeGreaterThan(probs[0]);
  });

  it('空配列は空配列', () => {
    expect(softmax([])).toEqual([]);
  });
});

describe('clampProbability', () => {
  it('0 と 1 を内側に寄せる（log が -Infinity にならない）', () => {
    expect(clampProbability(0)).toBeGreaterThan(0);
    expect(clampProbability(1)).toBeLessThan(1);
    expect(Number.isFinite(Math.log(clampProbability(0)))).toBe(true);
  });

  it('NaN は 0.5 にする', () => {
    expect(clampProbability(NaN)).toBe(0.5);
  });
});

describe('binaryLogLoss', () => {
  it('完全予測に近いほど小さい', () => {
    const good = binaryLogLoss([0.99, 0.01], [1, 0]);
    const bad = binaryLogLoss([0.5, 0.5], [1, 0]);
    expect(good).toBeLessThan(bad);
  });

  it('p=0.5 の一定予測は log2 になる', () => {
    expect(binaryLogLoss([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBeCloseTo(Math.log(2), 10);
  });

  it('外した確信予測でも無限大にならない', () => {
    expect(Number.isFinite(binaryLogLoss([1], [0]))).toBe(true);
  });
});

describe('brierScore', () => {
  it('完全予測で0', () => {
    expect(brierScore([1, 0], [1, 0])).toBe(0);
  });

  it('完全に外すと1', () => {
    expect(brierScore([0, 1], [1, 0])).toBe(1);
  });
});

describe('spearmanCorrelation', () => {
  it('完全一致で +1', () => {
    expect(spearmanCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 10);
  });

  it('完全逆順で -1', () => {
    expect(spearmanCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it('単調変換に対して不変（順位相関なので）', () => {
    const a = spearmanCorrelation([1, 2, 3, 4], [10, 20, 30, 40]);
    const b = spearmanCorrelation([1, 2, 3, 4], [1, 4, 9, 16]);
    expect(a).toBeCloseTo(b, 10);
  });

  it('全て同値なら0（0除算しない）', () => {
    expect(spearmanCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });

  it('3件未満は0', () => {
    expect(spearmanCorrelation([1, 2], [2, 1])).toBe(0);
  });
});

describe('標準化', () => {
  it('学習データの平均0・分散1になる', () => {
    const X = [[1, 10], [2, 20], [3, 30], [4, 40]];
    const { mean, std } = computeStandardization(X);
    expect(mean[0]).toBeCloseTo(2.5, 10);
    expect(mean[1]).toBeCloseTo(25, 10);

    const Z = X.map(x => standardize(x, mean, std));
    const col0 = Z.map(z => z[0]);
    expect(sumOf(col0)).toBeCloseTo(0, 10);
  });

  it('分散0の列は標準偏差1として扱い、NaNを出さない', () => {
    const X = [[5, 1], [5, 2], [5, 3]];
    const { mean, std } = computeStandardization(X);
    expect(std[0]).toBe(1);
    const z = standardize([5, 2], mean, std);
    expect(z.every(v => Number.isFinite(v))).toBe(true);
    expect(z[0]).toBe(0);
  });

  it('推論時は学習時の平均・分散を再利用する（テスト統計を使わない）', () => {
    const train = [[0], [1], [2], [3]];
    const { mean, std } = computeStandardization(train);
    // 学習データに無い値でも同じ変換が適用される
    expect(standardize([mean[0]], mean, std)[0]).toBe(0);
    expect(standardize([mean[0] + std[0]], mean, std)[0]).toBeCloseTo(1, 10);
  });
});

describe('trainL2Logistic', () => {
  /** 線形分離できるデータ */
  const makeSeparable = () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 60; i++) {
      const x = i / 60;
      X.push([x, Math.sin(i)]);
      y.push(x > 0.5 ? 1 : 0);
    }
    return { X, y };
  };

  it('学習して収束する', () => {
    const { X, y } = makeSeparable();
    const model = trainL2Logistic(X, y, { l2: 0.1, maxIterations: 2000 });
    expect(model.converged).toBe(true);
    expect(model.iterations).toBeGreaterThan(0);
    expect(model.weights.every(w => Number.isFinite(w))).toBe(true);
  });

  it('シグナルのある特徴量を正しく分離する', () => {
    const { X, y } = makeSeparable();
    const model = trainL2Logistic(X, y, { l2: 0.01, maxIterations: 3000 });
    expect(predictProbability(model, [0.9, 0])).toBeGreaterThan(
      predictProbability(model, [0.1, 0])
    );
  });

  it('正則化を強くすると係数が小さくなる', () => {
    const { X, y } = makeSeparable();
    const weak = trainL2Logistic(X, y, { l2: 0.001, maxIterations: 3000 });
    const strong = trainL2Logistic(X, y, { l2: 1000, maxIterations: 3000 });
    const norm = (w: number[]) => Math.sqrt(sumOf(w.map(v => v * v)));
    expect(norm(strong.weights)).toBeLessThan(norm(weak.weights));
  });

  it('標準化パラメータをモデルに保存する', () => {
    const { X, y } = makeSeparable();
    const model = trainL2Logistic(X, y);
    expect(model.mean).toHaveLength(2);
    expect(model.std).toHaveLength(2);
    expect(model.std.every(s => s > 0)).toBe(true);
  });

  it('バイアスは基準率のロジットに近づく（特徴量が無情報なとき）', () => {
    const X = Array.from({ length: 100 }, () => [0]);
    const y = Array.from({ length: 100 }, (_, i) => (i < 20 ? 1 : 0));
    const model = trainL2Logistic(X, y, { maxIterations: 2000 });
    // 基準率0.2 → sigmoid(bias) ≈ 0.2
    expect(sigmoid(model.bias)).toBeCloseTo(0.2, 2);
  });

  it('空データでも例外を投げない', () => {
    const model = trainL2Logistic([], []);
    expect(model.weights).toEqual([]);
    expect(model.converged).toBe(true);
  });

  it('linearScore と predictProbability が整合する', () => {
    const { X, y } = makeSeparable();
    const model = trainL2Logistic(X, y);
    const x = [0.7, 0.1];
    expect(predictProbability(model, x)).toBeCloseTo(sigmoid(linearScore(model, x)), 12);
  });
});

describe('calibrateShowProbabilities', () => {
  it('合計が3になる（3着以内は3頭）', () => {
    const probs = calibrateShowProbabilities([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    expect(sumOf(probs)).toBeCloseTo(3, 6);
  });

  it('頭数が3未満なら合計は頭数に一致する', () => {
    const probs = calibrateShowProbabilities([0.2, 0.3]);
    expect(sumOf(probs)).toBeCloseTo(2, 6);
  });

  it('確率は1を超えない', () => {
    const probs = calibrateShowProbabilities([0.95, 0.95, 0.95, 0.01, 0.01]);
    expect(probs.every(p => p <= 1)).toBe(true);
  });

  it('大小関係を保つ', () => {
    const probs = calibrateShowProbabilities([0.1, 0.5, 0.3, 0.2, 0.4, 0.05]);
    expect(probs[1]).toBeGreaterThan(probs[2]);
    expect(probs[2]).toBeGreaterThan(probs[3]);
  });

  it('空配列は空配列', () => {
    expect(calibrateShowProbabilities([])).toEqual([]);
  });
});

describe('buildCalibrationTable', () => {
  it('ビンごとの件数・平均予測・実績率を出す', () => {
    const probs = [0.05, 0.15, 0.15, 0.95];
    const labels = [0, 0, 1, 1];
    const table = buildCalibrationTable(probs, labels, 10);

    expect(table).toHaveLength(10);
    expect(table[0].count).toBe(1);
    expect(table[1].count).toBe(2);
    expect(table[1].actualRate).toBeCloseTo(0.5, 10);
    expect(table[9].count).toBe(1);
    expect(table[9].actualRate).toBe(1);
  });

  it('よく較正されたモデルでは平均予測と実績率が近い', () => {
    const probs: number[] = [];
    const labels: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const p = 0.35;
      probs.push(p);
      labels.push(i % 100 < 35 ? 1 : 0);
    }
    const bin = buildCalibrationTable(probs, labels).find(b => b.count > 0)!;
    expect(Math.abs(bin.avgPredicted - bin.actualRate)).toBeLessThan(0.02);
  });
});

describe('evaluateRaces', () => {
  /**
   * @param hasMarketOdds - 全馬に事前オッズが揃っているレースか（1なら揃っている）
   */
  const makeRace = (winProbs: number[], winnerIndex: number, hasMarketOdds = 1) => ({
    samples: winProbs.map((_, i) => ({
      raceId: 1,
      raceDate: '2024-01-01',
      horseId: i + 1,
      horseName: `H${i}`,
      vector: [],
      features: { hasMarketOdds } as never,
      winLabel: i === winnerIndex ? 1 : 0,
      showLabel: i < 3 ? 1 : 0,
      finishPosition: i === winnerIndex ? 1 : i + 2,
      payoutWinOdds: 3.0
    })),
    winProbs,
    showProbs: winProbs.map(p => Math.min(1, p * 3))
  });

  it('完全予測なら top-1 的中率100%、log loss はほぼ0', () => {
    const metrics = evaluateRaces([makeRace([0.98, 0.01, 0.01], 0)]);
    expect(metrics.top1Accuracy).toBe(1);
    expect(metrics.logLoss).toBeLessThan(0.05);
  });

  it('外した予測は top-1 0%、log loss が大きい', () => {
    const metrics = evaluateRaces([makeRace([0.98, 0.01, 0.01], 2)]);
    expect(metrics.top1Accuracy).toBe(0);
    expect(metrics.logLoss).toBeGreaterThan(1);
  });

  it('実オッズで回収率を計算する（固定オッズ仮定を使わない）', () => {
    // 1レース：予測1位が的中、オッズ3.0倍 → 回収率300%
    const metrics = evaluateRaces([makeRace([0.98, 0.01, 0.01], 0)]);
    expect(metrics.winRoi).toBeCloseTo(3.0, 10);
    expect(metrics.roiRaces).toBe(1);
  });

  it('全馬にオッズが揃っていないレースは回収率の対象外（選択バイアスの遮断）', () => {
    // 払戻オッズは入っているが hasMarketOdds=0（事前オッズが全馬に無い）
    const metrics = evaluateRaces([
      makeRace([0.98, 0.01, 0.01], 0, 0),
      makeRace([0.98, 0.01, 0.01], 2, 0)
    ]);
    expect(metrics.roiRaces).toBe(0);
    // roiRaces=0 のとき winRoi は「算出不能」を表す0であり、回収率0%ではない
    expect(metrics.winRoi).toBe(0);
  });

  it('外したレースも賭け対象に数える（的中レースだけの平均配当にならない）', () => {
    const metrics = evaluateRaces([
      makeRace([0.98, 0.01, 0.01], 0), // 的中（3.0倍）
      makeRace([0.98, 0.01, 0.01], 2)  // 外れ
    ]);
    expect(metrics.roiRaces).toBe(2);
    expect(metrics.winRoi).toBeCloseTo(1.5, 10); // 300円 / 200円
  });

  it('空入力でゼロ値を返す', () => {
    const metrics = evaluateRaces([]);
    expect(metrics.races).toBe(0);
    expect(metrics.logLoss).toBe(0);
  });
});

describe('splitRacesIntoDateBlocks', () => {
  /** 1日 perDay レース × days 日ぶんの日付列 */
  function dates(days: number, perDay: number): string[] {
    const out: string[] = [];
    for (let d = 0; d < days; d++) {
      const day = `2024-01-${String(d + 1).padStart(2, '0')}`;
      for (let i = 0; i < perDay; i++) out.push(day);
    }
    return out;
  }

  it('切れ目は必ず日付の変わり目に来る（同一開催日は同じブロック）', () => {
    const d = dates(12, 4); // 48レース / 12開催日
    const starts = splitRacesIntoDateBlocks(d, 4);

    expect(starts[0]).toBe(0);
    for (const s of starts.slice(1)) {
      // s は「前のレースと日付が違う」位置
      expect(d[s]).not.toBe(d[s - 1]);
    }
  });

  it('ブロック数の上限を超えない / 昇順', () => {
    const starts = splitRacesIntoDateBlocks(dates(20, 3), 5);
    expect(starts.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    }
  });

  it('全レースが同一開催日なら分割できない（ブロック1個）', () => {
    expect(splitRacesIntoDateBlocks(dates(1, 30), 5)).toEqual([0]);
  });

  it('空入力・不正なブロック数は空配列', () => {
    expect(splitRacesIntoDateBlocks([], 5)).toEqual([]);
    expect(splitRacesIntoDateBlocks(dates(5, 2), 0)).toEqual([]);
  });
});

describe('特徴量の定義整合性', () => {
  it('FEATURE_NAMES と FEATURE_DIMENSION が一致する', () => {
    expect(FEATURE_NAMES).toHaveLength(FEATURE_DIMENSION);
  });

  it('特徴量名は重複しない', () => {
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length);
  });

  it('toVector の長さは FEATURE_DIMENSION と一致する', () => {
    const features = {
      winOdds: 5,
      logWinOdds: Math.log(5),
      marketImpliedProb: 0.2,
      oddsRankNorm: 0.5,
      popularityNorm: 0.3,
      hasMarket: 1,
      horseWeightZ: 0.5,
      weightChange: -2,
      assignedWeightRel: 2,
      assignedWeightZ: 0.1,
      hasHorseWeight: 1,
      careerRunsLog: Math.log1p(10),
      careerWinRate: 0.2,
      careerShowRate: 0.5,
      hasPrevRace: 1,
      prevFinishInv: 0.5,
      prevFinishRel: 0.1,
      prevLast3fRel: -1.2,
      prevMarginSeconds: 0.3,
      daysSincePrevLog: Math.log1p(35),
      fieldSizeLog: Math.log(16),
      ruleTotalScore: 0.6,
      ruleTotalZ: 1.1,
      ruleTotalRankNorm: 0,
      ruleScores: {
        recentPerformanceScore: 70,
        venueAptitudeScore: 60,
        distanceAptitudeScore: 50,
        last3FAbilityScore: 40,
        g1AchievementScore: 30,
        rotationAptitudeScore: 20,
        jockeyScore: 10,
        trackConditionScore: 5,
        postPositionScore: 55,
        trainerScore: 0
      }
    };

    const vector = toVector(features);
    expect(vector).toHaveLength(FEATURE_DIMENSION);
    expect(vector.every(v => Number.isFinite(v))).toBe(true);
  });

  it('NaN/Infinity の特徴量は 0 に落とす', () => {
    const features = {
      winOdds: null,
      logWinOdds: NaN,
      marketImpliedProb: Infinity,
      oddsRankNorm: 0,
      popularityNorm: 0,
      hasMarket: 0,
      horseWeightZ: 0,
      weightChange: 0,
      assignedWeightRel: 0,
      assignedWeightZ: 0,
      hasHorseWeight: 0,
      careerRunsLog: 0,
      careerWinRate: 0,
      careerShowRate: 0,
      hasPrevRace: 0,
      prevFinishInv: 0,
      prevFinishRel: 0,
      prevLast3fRel: 0,
      prevMarginSeconds: 0,
      daysSincePrevLog: 0,
      fieldSizeLog: 0,
      ruleTotalScore: 0,
      ruleTotalZ: 0,
      ruleTotalRankNorm: 0,
      ruleScores: {
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
      }
    };

    expect(toVector(features).every(v => Number.isFinite(v))).toBe(true);
  });
});
