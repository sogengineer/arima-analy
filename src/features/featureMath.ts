/**
 * 特徴量のレース内相対化に使う統計ヘルパー
 *
 * @remarks
 * `FeatureBuilder.ts` から切り出したファイル。加算は配列順のまま行う
 * （順序を変えると浮動小数の結果が変わるため）。
 */

/** 平均 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

/** 母標準偏差 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let squaredSum = 0;
  for (const value of values) {
    squaredSum += (value - m) ** 2;
  }
  const variance = squaredSum / values.length;
  return Math.sqrt(variance);
}

/** z-score（標準偏差0のときは0） */
export function zScores(values: number[]): number[] {
  const m = mean(values);
  const sd = stdDev(values);
  if (sd === 0) return values.map(() => 0);
  return values.map(v => (v - m) / sd);
}

/**
 * 昇順順位を 0..1 に正規化した配列を返す
 *
 * @param values - 値の配列
 * @param descending - true なら大きい値ほど 0 に近い（上位）
 */
export function normalizedRanks(values: number[], descending: boolean): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => 0);

  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => (descending ? b.v - a.v : a.v - b.v));

  const ranks = new Array<number>(n).fill(0);
  indexed.forEach((item, rank) => {
    ranks[item.i] = rank / (n - 1);
  });
  return ranks;
}
