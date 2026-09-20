/**
 * L2正則化ロジスティック回帰（学習と推論）
 */

import type { LogisticModel, TrainOptions } from './MachineLearningTypes';
import {
  clampProbability,
  computeStandardization,
  sigmoid,
  standardize,
  sumOf
} from './MachineLearningMath';
import { DEFAULT_L2 } from './MachineLearningConstants';

/** 標準化済み1行分のロジット（バイアス込み） */
function logitOf(row: number[], weights: number[], bias: number): number {
  let z = bias;
  for (let j = 0; j < weights.length; j++) z += weights[j] * row[j];
  return z;
}

/** L2正則化つき平均対数損失 */
function l2LogisticLoss(
  Z: number[][],
  y: number[],
  weights: number[],
  bias: number,
  l2: number
): number {
  const n = Z.length;
  let loss = 0;
  for (let i = 0; i < n; i++) {
    const p = clampProbability(sigmoid(logitOf(Z[i], weights, bias)));
    loss += y[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  loss /= n;
  let weightNormSq = 0;
  for (const v of weights) weightNormSq += v * v;
  loss += (l2 / (2 * n)) * weightNormSq;
  return loss;
}

/** L2正則化つき勾配（正則化は係数のみ、バイアスには掛けない） */
function l2LogisticGradient(
  Z: number[][],
  y: number[],
  weights: number[],
  bias: number,
  l2: number
): { gradW: number[]; gradB: number } {
  const n = Z.length;
  const d = weights.length;
  const gradW = new Array<number>(d).fill(0);
  let gradB = 0;
  for (let i = 0; i < n; i++) {
    const error = sigmoid(logitOf(Z[i], weights, bias)) - y[i];
    gradB += error / n;
    for (let j = 0; j < d; j++) gradW[j] += (error * Z[i][j]) / n;
  }
  for (let j = 0; j < d; j++) gradW[j] += (l2 / n) * weights[j];
  return { gradW, gradB };
}

/**
 * L2正則化ロジスティック回帰を学習（フルバッチ勾配降下 + 収束判定）
 *
 * @remarks
 * - 特徴量は学習データの平均・標準偏差で標準化する（スケール差による発散を防ぐ）
 * - 正則化は係数のみに掛け、バイアスには掛けない
 * - 損失の変化が `tolerance` を下回ったら収束として打ち切る
 * - 損失が増えた反復では学習率を半分にする（発散防止）
 */
export function trainL2Logistic(
  X: number[][],
  y: number[],
  options: TrainOptions = {}
): LogisticModel {
  const l2 = options.l2 ?? DEFAULT_L2;
  const d = X[0]?.length ?? 0;
  const n = X.length;
  const { mean, std } = computeStandardization(X);

  const empty: LogisticModel = {
    weights: new Array<number>(d).fill(0),
    bias: 0,
    mean,
    std,
    iterations: 0,
    converged: true,
    finalLoss: 0
  };
  if (n === 0 || d === 0) return empty;

  const Z = X.map(row => standardize(row, mean, std));
  // バイアスは基準率のロジットで初期化（収束が速い）
  const positiveRate = clampProbability(sumOf(y) / n, 1e-6);

  const descent = runGradientDescent(
    Z,
    y,
    {
      weights: new Array<number>(d).fill(0),
      bias: Math.log(positiveRate / (1 - positiveRate)),
      learningRate: options.learningRate ?? 0.5
    },
    {
      l2,
      maxIterations: options.maxIterations ?? 500,
      tolerance: options.tolerance ?? 1e-7
    }
  );

  return { ...descent, mean, std };
}

/** 勾配降下の初期値 */
interface DescentStart {
  weights: number[];
  bias: number;
  learningRate: number;
}

/** 勾配降下のハイパーパラメータ */
interface DescentHyperParams {
  l2: number;
  maxIterations: number;
  tolerance: number;
}

/**
 * フルバッチ勾配降下（損失が増えた反復では学習率を半分にする）
 */
function runGradientDescent(
  Z: number[][],
  y: number[],
  start: DescentStart,
  hyper: DescentHyperParams
): Omit<LogisticModel, 'mean' | 'std'> {
  const { l2, maxIterations, tolerance } = hyper;
  let weights = start.weights;
  let bias = start.bias;
  let lr = start.learningRate;

  let loss = l2LogisticLoss(Z, y, weights, bias, l2);
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    const { gradW, gradB } = l2LogisticGradient(Z, y, weights, bias, l2);

    const nextWeights = weights.map((w, j) => w - lr * gradW[j]);
    const nextBias = bias - lr * gradB;
    const nextLoss = l2LogisticLoss(Z, y, nextWeights, nextBias, l2);

    if (!Number.isFinite(nextLoss) || nextLoss > loss) {
      // 発散気味なので学習率を下げてやり直す
      lr /= 2;
      if (lr < 1e-8) {
        converged = true;
        break;
      }
      continue;
    }

    const improvement = loss - nextLoss;
    weights = nextWeights;
    bias = nextBias;
    loss = nextLoss;

    if (improvement < tolerance) {
      converged = true;
      break;
    }
  }

  return { weights, bias, iterations, converged, finalLoss: loss };
}

/** 標準化空間での線形スコア（conditional logit の効用） */
export function linearScore(model: LogisticModel, x: number[]): number {
  const z = standardize(x, model.mean, model.std);
  let sum = model.bias;
  for (let j = 0; j < model.weights.length; j++) sum += model.weights[j] * (z[j] ?? 0);
  return Number.isFinite(sum) ? sum : 0;
}

/** 二値確率を予測 */
export function predictProbability(model: LogisticModel, x: number[]): number {
  return sigmoid(linearScore(model, x));
}
