/**
 * 機械学習モデルの数値計算（純粋関数）
 *
 * @remarks
 * 学習そのものは `LogisticRegression`、評価は `RaceEvaluation` にある。
 */

import { MARKET_FEATURE_INDICES, SMALL_MODEL_FEATURE_INDICES } from '@/features/FeatureBuilder';
import type { CalibrationBin } from './MachineLearningTypes';

/** 配列の総和（加算は先頭から順に行う） */
export function sumOf(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}


/** 重み付き線形和（加算は先頭から順に行う） */
export function weightedSum(values: number[], weights: number[]): number {
  let total = 0;
  for (let j = 0; j < values.length; j++) total += values[j] * weights[j];
  return total;
}

/** 指定した添字の要素だけを合計する（加算は添字配列の順） */
export function sumAt(values: number[], indices: number[]): number {
  let total = 0;
  for (const i of indices) total += values[i];
  return total;
}

/** シグモイド関数（オーバーフロー保護つき） */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

/** 確率を [eps, 1-eps] にクリップ */
export function clampProbability(p: number, eps = 1e-12): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - eps, Math.max(eps, p));
}

/** softmax（最大値を引いて数値安定化） */
export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const finite = logits.map(v => (Number.isFinite(v) ? v : 0));
  const max = Math.max(...finite);
  const exps = finite.map(v => Math.exp(v - max));
  const sum = sumOf(exps);
  if (!(sum > 0)) return finite.map(() => 1 / finite.length);
  return exps.map(v => v / sum);
}

/**
 * 二値 log loss
 *
 * @param probs - 予測確率
 * @param labels - 正解ラベル（0/1）
 */
export function binaryLogLoss(probs: number[], labels: number[]): number {
  if (probs.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = clampProbability(probs[i]);
    total += labels[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return total / probs.length;
}

/** Brier スコア */
export function brierScore(probs: number[], labels: number[]): number {
  if (probs.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < probs.length; i++) {
    total += (probs[i] - labels[i]) ** 2;
  }
  return total / probs.length;
}

/**
 * Spearman 順位相関
 *
 * @remarks
 * 同順位は平均順位で処理する。分散0の場合は0を返す。
 */
export function spearmanCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;

  const rank = (values: number[]): number[] => {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(values.length).fill(0);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  };

  const rx = rank(xs.slice(0, n));
  const ry = rank(ys.slice(0, n));
  const mx = sumOf(rx) / n;
  const my = sumOf(ry) / n;

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/**
 * 特徴量の標準化パラメータを計算
 *
 * @remarks
 * **学習データのみ** から平均・標準偏差を求め、推論時に再利用する。
 * テストデータの統計を使うとそれ自体がリークになる。
 */
export function computeStandardization(X: number[][]): { mean: number[]; std: number[] } {
  const d = X[0]?.length ?? 0;
  const n = X.length;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(1);
  if (n === 0) return { mean, std };

  for (const row of X) {
    for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  }
  for (let j = 0; j < d; j++) {
    let variance = 0;
    for (const row of X) variance += (row[j] - mean[j]) ** 2;
    variance /= n;
    const sd = Math.sqrt(variance);
    std[j] = sd > 1e-9 ? sd : 1;
  }
  return { mean, std };
}

/** 標準化を適用 */
export function standardize(x: number[], mean: number[], std: number[]): number[] {
  return x.map((v, j) => {
    const z = (v - (mean[j] ?? 0)) / (std[j] || 1);
    return Number.isFinite(z) ? z : 0;
  });
}

/**
 * 複勝確率をレース内で較正する
 *
 * @remarks
 * 3着以内に入る馬はちょうど3頭（出走3頭未満なら頭数ぶん）なので、
 * 確率の合計がその頭数に一致するよう比例スケール + クリップを反復する。
 *
 * @param probs - 二値モデルの生確率
 * @returns 合計が min(3, 頭数) に一致する確率
 */
export function calibrateShowProbabilities(probs: number[]): number[] {
  const n = probs.length;
  if (n === 0) return [];
  const target = Math.min(3, n);

  // 1 に張り付いた要素は固定し、残りだけを再スケールする
  // （固定しないと、クリップ済みの要素が次の反復でまた scale 倍されて縮む）
  const current = probs.map(p => clampProbability(p, 1e-6));
  const fixed = new Array<boolean>(n).fill(false);

  for (let iter = 0; iter < 50; iter++) {
    if (Math.abs(sumOf(current) - target) < 1e-9) break;

    const { fixedSum, freeSum } = splitFixedAndFreeSum(current, fixed);
    const remaining = target - fixedSum;
    if (freeSum <= 0 || remaining <= 0) break;

    const clipped = rescaleFreeProbabilities(current, fixed, remaining / freeSum);
    if (!clipped) break;
  }
  return current;
}

/** 固定済み要素と自由要素それぞれの合計 */
function splitFixedAndFreeSum(
  current: number[],
  fixed: boolean[]
): { fixedSum: number; freeSum: number } {
  let fixedSum = 0;
  let freeSum = 0;
  for (let i = 0; i < current.length; i++) {
    if (fixed[i]) fixedSum += current[i];
    else freeSum += current[i];
  }
  return { fixedSum, freeSum };
}

/**
 * 自由要素を scale 倍する（1 に達した要素は固定する）
 *
 * @returns 1 にクリップされた要素があったか
 */
function rescaleFreeProbabilities(current: number[], fixed: boolean[], scale: number): boolean {
  let clipped = false;
  for (let i = 0; i < current.length; i++) {
    if (fixed[i]) continue;
    const scaled = current[i] * scale;
    if (!(scaled >= 1)) {
      current[i] = scaled;
      continue;
    }
    current[i] = 1;
    fixed[i] = true;
    clipped = true;
  }
  return clipped;
}

/**
 * 較正テーブルを作成
 *
 * @param probs - 予測確率
 * @param labels - 実績（0/1）
 * @param bins - ビン数
 */
export function buildCalibrationTable(
  probs: number[],
  labels: number[],
  bins = 10
): CalibrationBin[] {
  const table: CalibrationBin[] = [];
  for (let b = 0; b < bins; b++) {
    const from = b / bins;
    const to = (b + 1) / bins;
    const idx: number[] = [];
    for (let i = 0; i < probs.length; i++) {
      const p = probs[i];
      if (p >= from && (p < to || (b === bins - 1 && p <= to))) idx.push(i);
    }
    table.push({
      from,
      to,
      count: idx.length,
      avgPredicted: idx.length > 0 ? sumAt(probs, idx) / idx.length : 0,
      actualRate: idx.length > 0 ? sumAt(labels, idx) / idx.length : 0
    });
  }
  return table;
}

/**
 * レース列を **開催日単位** の時系列ブロックへ分割する
 *
 * @remarks
 * 分割点をレース索引で決めると、JRAの実データ（1日24〜36レース）では
 * ブロック境界がほぼ必ず開催日の途中に落ち、
 * 「評価レースと同一開催日の別レース」が学習窓に入ってしまう。
 * そこで **同一開催日のレースは必ず同じブロック** に入るよう、
 * 目標サイズに達した直後の「日付が変わる位置」でのみ切る。
 *
 * @param dates - レースの開催日（昇順であること）
 * @param blocks - 目標ブロック数
 * @returns 各ブロックの開始インデックス（昇順・先頭は必ず0）
 */
export function splitRacesIntoDateBlocks(dates: string[], blocks: number): number[] {
  const n = dates.length;
  if (n === 0 || blocks < 1) return [];

  const target = Math.max(1, Math.floor(n / blocks));
  const starts: number[] = [0];
  let countInBlock = 0;

  for (let i = 0; i < n; i++) {
    countInBlock++;
    const isDateBoundary = i + 1 < n && dates[i + 1] !== dates[i];
    if (isDateBoundary && countInBlock >= target && starts.length < blocks) {
      starts.push(i + 1);
      countInBlock = 0;
    }
  }

  return starts;
}

/**
 * 市場（人気・オッズ）由来の特徴量だけを残し、他をゼロにしたベクトルを返す
 *
 * @remarks
 * 採用ゲート①のベースライン「市場情報のみで学習した同型モデル」用。
 * 次元数を変えずにゼロ埋めするので、標準化・学習・推論の経路を本体と共有できる
 * （ゼロ列は標準偏差0として扱われ、係数が動かない）。
 */
export function maskToMarketFeatures(vector: number[]): number[] {
  return maskToIndices(vector, MARKET_FEATURE_INDICES);
}

/**
 * 小モデル（市場系 + 少数の強い特徴）の特徴量だけを残したベクトルを返す
 *
 * @remarks
 * 少データで34次元が過剰かどうかを同じ walk-forward 手続きで比較するための
 * 並走モデル用（`SMALL_MODEL_FEATURE_NAMES` に理由を記載）。
 */
export function maskToSmallModelFeatures(vector: number[]): number[] {
  return maskToIndices(vector, SMALL_MODEL_FEATURE_INDICES);
}

/** 指定インデックス以外をゼロ埋めする（次元数は変えない） */
function maskToIndices(vector: number[], indices: readonly number[]): number[] {
  const masked = new Array<number>(vector.length).fill(0);
  for (const i of indices) {
    masked[i] = vector[i] ?? 0;
  }
  return masked;
}
