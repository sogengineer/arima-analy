/**
 * 機械学習関連の定数
 */

/** ランダムフォレストのパラメータ */
export const RF_PARAMS = {
  /** 推定器の数（メイン訓練） */
  nEstimators: 100,
  /** 推定器の数（クロスバリデーション用） */
  nEstimatorsCV: 50,
  /** 乱数シード */
  seed: 42
} as const;

/** ロジスティック回帰のパラメータ */
export const LOGISTIC_PARAMS = {
  /** イテレーション数 */
  iterations: 1000,
  /** 学習率 */
  learningRate: 0.1
} as const;

/** 特徴量の正規化係数 */
export const FEATURE_NORMALIZATION = {
  /** 偏差値の最大値 */
  maxDeviation: 100,
  /** 着順の最大値 */
  maxPosition: 18,
  /** タイム差の上限（秒） */
  maxTimeDiff: 5,
  /** 年齢の正規化係数 */
  maxAge: 10,
  /** 出走数の上限 */
  maxRuns: 30
} as const;

/** アンサンブル予測の重み */
export const ENSEMBLE_WEIGHTS = {
  /** ロジスティック回帰 */
  logistic: 0.3,
  /** ランダムフォレスト */
  randomForest: 0.7
} as const;

/** 分類の閾値 */
export const CLASSIFICATION_THRESHOLDS = {
  /** ロジスティック回帰の判定閾値 */
  logisticThreshold: 0.5,
  /** RF クラス1の確率変換 */
  rfClass1Prob: 0.65,
  /** RF クラス0の確率変換 */
  rfClass0Prob: 0.25
} as const;

/** 偏差値計算のパラメータ */
export const DEVIATION_PARAMS = {
  /** 基準値 */
  baseValue: 50,
  /** 平均（着順スコアベース） */
  mean: 10,
  /** 標準偏差（仮定値） */
  stdDev: 3,
  /** 最小偏差値 */
  minDeviation: 20,
  /** 最大偏差値 */
  maxDeviation: 80
} as const;

/** デフォルト確率値 */
export const DEFAULT_PROBABILITIES = {
  /** 会場別複勝率のデフォルト */
  venuePlaceRate: 0.3,
  /** 騎手会場別G1勝率のデフォルト */
  jockeyVenueG1WinRate: 0.05,
  /** データなし馬の勝率 */
  noDataWinProb: 0.05,
  /** データなし馬の連対率 */
  noDataPlaceProb: 0.1,
  /** データなし馬の複勝率 */
  noDataShowProb: 0.15
} as const;

/** 確率の上限値 */
export const PROBABILITY_CAPS = {
  /** 勝率の最大値 */
  maxWinProb: 0.5,
  /** 連対率の最大値 */
  maxPlaceProb: 0.7,
  /** 複勝率の最大値 */
  maxShowProb: 0.85
} as const;

/** 実績数による調整 */
export const RESULTS_ADJUSTMENT = {
  /** 少ない実績の閾値 */
  minResults: 5,
  /** 実績の重み */
  resultsWeight: 0.7,
  /** デフォルトの重み */
  defaultWeight: 0.3
} as const;

/** 馬券推奨の閾値 */
export const BETTING_THRESHOLDS = {
  /** 単勝推奨の勝率閾値 */
  winRecommendation: 0.2,
  /** 馬連推奨の連対率閾値 */
  placeRecommendation: 0.4
} as const;

/** 複勝圏内の着順 */
export const TOP_3_POSITION = 3;
