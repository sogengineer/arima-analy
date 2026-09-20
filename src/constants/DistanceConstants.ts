/**
 * 距離・期間関連の定数
 */

/** 距離判定の閾値 */
export const DISTANCE_THRESHOLDS = {
  /** 距離適性判定の幅（メートル） */
  aptitudeRange: 300,
  /** 同距離判定の幅（メートル） */
  exactDistanceRange: 100
} as const;

/** ローテーション（出走間隔）の適正期間 */
export const ROTATION_PERIOD = {
  /** 最小日数（3週間） */
  minDays: 21,
  /** 最大日数（10週間） */
  maxDays: 70
} as const;

/** 日数計算のミリ秒変換 */
export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** ローテーション間隔を日数で計算 */
export function calculateIntervalDays(currentDate: Date, prevDate: Date): number {
  return Math.floor((currentDate.getTime() - prevDate.getTime()) / MS_PER_DAY);
}

/** 距離カテゴリの閾値（メートル） */
export const DISTANCE_CATEGORY_THRESHOLDS = {
  sprint: 1400,
  mile: 1800,
  middle: 2200
} as const;

/** 距離カテゴリを取得（短距離 / マイル / 中距離 / 長距離） */
export function getDistanceCategory(distance: number): string {
  if (distance < DISTANCE_CATEGORY_THRESHOLDS.sprint) return '短距離';
  if (distance < DISTANCE_CATEGORY_THRESHOLDS.mile) return 'マイル';
  if (distance < DISTANCE_CATEGORY_THRESHOLDS.middle) return '中距離';
  return '長距離';
}

/** ローテーション間隔が適正範囲内か判定 */
export function isOptimalRotation(intervalDays: number): boolean {
  return intervalDays >= ROTATION_PERIOD.minDays && intervalDays <= ROTATION_PERIOD.maxDays;
}
