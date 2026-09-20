/**
 * ルールベース10要素の重みを着順スコアへ射影する（**説明用**。予測器ではない）
 */

import { Matrix, solve } from 'ml-matrix';
import { SCORE_WEIGHTS } from '../constants/ScoringConstants';
import type { TrainingRace } from './MachineLearningTypes';
import { sumOf, weightedSum } from './MachineLearningMath';

/** ルールベース10要素の名前（説明用射影で使用） */
export const RULE_FEATURE_NAMES: readonly string[] = [
  '直近成績',
  'コース適性',
  '距離適性',
  '上がり3F',
  'G1実績',
  'ローテ適性',
  '騎手能力',
  '馬場適性',
  '枠順効果',
  '調教師'
];

/** 現在の重みと射影後の重みの比較1行 */
export interface WeightComparison {
  name: string;
  current: number;
  optimized: number;
  diff: number;
}

/** 説明用射影の結果 */
export interface RuleWeightProjection {
  /** 射影に使った出走行数 */
  dataCount: number;
  weights: number[];
  improvement: number;
  comparison: WeightComparison[];
}

/** 射影に必要な最小データ数 */
const MIN_PROJECTION_SAMPLES = 20;

/** 現在のスコアリング重み */
export function currentScoreWeights(): number[] {
  return [
    SCORE_WEIGHTS.recentPerformance,
    SCORE_WEIGHTS.venueAptitude,
    SCORE_WEIGHTS.distanceAptitude,
    SCORE_WEIGHTS.last3FAbility,
    SCORE_WEIGHTS.g1Achievement,
    SCORE_WEIGHTS.rotationAptitude,
    SCORE_WEIGHTS.jockey,
    SCORE_WEIGHTS.trackCondition,
    SCORE_WEIGHTS.postPosition,
    SCORE_WEIGHTS.trainer
  ];
}

/**
 * リッジ回帰で重みを射影する
 *
 * @returns データが足りなければ null
 */
export function projectRuleWeights(
  races: TrainingRace[],
  lambda: number
): RuleWeightProjection | null {
  const { features, labels } = buildRuleScoreRegressionData(races);
  if (features.length < MIN_PROJECTION_SAMPLES) return null;

  const normalizedWeights = normalizeWeights(ridgeRegression(features, labels, lambda));
  const currentWeights = currentScoreWeights();
  const comparison = RULE_FEATURE_NAMES.map((name, i) => ({
    name,
    current: currentWeights[i],
    optimized: normalizedWeights[i],
    diff: normalizedWeights[i] - currentWeights[i]
  }));

  return {
    dataCount: features.length,
    weights: normalizedWeights,
    improvement: evaluateWeightImprovement(features, labels, currentWeights, normalizedWeights),
    comparison
  };
}

/** 説明用射影の入力（10要素スコア → 着順スコア） */
export function buildRuleScoreRegressionData(races: TrainingRace[]): {
  features: number[][];
  labels: number[];
} {
  const features: number[][] = [];
  const labels: number[] = [];

  for (const race of races) {
    for (const sample of race.samples) {
      const r = sample.features.ruleScores;
      features.push([
        r.recentPerformanceScore / 100,
        r.venueAptitudeScore / 100,
        r.distanceAptitudeScore / 100,
        r.last3FAbilityScore / 100,
        r.g1AchievementScore / 100,
        r.rotationAptitudeScore / 100,
        r.jockeyScore / 100,
        r.trackConditionScore / 100,
        r.postPositionScore / 100,
        r.trainerScore / 100
      ]);
      labels.push(Math.max(0, 1 - (sample.finishPosition - 1) / 17));
    }
  }

  return { features, labels };
}

/** 重みを正規化（負値は0にクリップし、合計1.0へ） */
function normalizeWeights(weights: number[]): number[] {
  const clipped = weights.map(w => Math.max(0, w));
  const sum = sumOf(clipped);
  if (sum <= 0) return currentScoreWeights();
  return clipped.map(w => w / sum);
}

/** リッジ回帰（L2正則化線形回帰） */
function ridgeRegression(features: number[][], labels: number[], lambda: number): number[] {
  const n = features.length;
  const p = features[0]?.length ?? 10;

  const X = new Matrix(features);
  const y = Matrix.columnVector(labels);
  const XtX = X.transpose().mmul(X);
  const XtXreg = XtX.add(Matrix.eye(p).mul(lambda * n));
  const Xty = X.transpose().mmul(y);

  return solve(XtXreg, Xty).getColumn(0);
}

/** 射影による in-sample 誤差の改善率 */
function evaluateWeightImprovement(
  features: number[][],
  labels: number[],
  currentWeights: number[],
  optimizedWeights: number[]
): number {
  let currentError = 0;
  let optimizedError = 0;

  for (let i = 0; i < features.length; i++) {
    const currentPred = weightedSum(features[i], currentWeights);
    const optimizedPred = weightedSum(features[i], optimizedWeights);
    currentError += (labels[i] - currentPred) ** 2;
    optimizedError += (labels[i] - optimizedPred) ** 2;
  }

  return currentError > 0 ? ((currentError - optimizedError) / currentError) * 100 : 0;
}

/** 射影した重みを ScoringConstants の形で出力する（未射影なら空文字） */
export function formatWeightsAsConstants(learned: number[] | null): string {
  if (!learned) return '';

  const keys = [
    'recentPerformance',
    'venueAptitude',
    'distanceAptitude',
    'last3FAbility',
    'g1Achievement',
    'rotationAptitude',
    'jockey',
    'trackCondition',
    'postPosition',
    'trainer'
  ];

  const lines = keys.map((key, i) => `  ${key}: ${learned[i].toFixed(2)},`);
  return `export const SCORE_WEIGHTS = {\n${lines.join('\n')}\n} as const;`;
}
