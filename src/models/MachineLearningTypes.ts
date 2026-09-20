/**
 * 機械学習モデルの型定義
 *
 * @remarks
 * `MachineLearningModel` から分離した型だけのモジュール。公開経路は
 * `MachineLearningModel` の再エクスポートで従来どおり。
 */

import type { MLFeatures } from '../features/FeatureBuilder';
import type { MarketProbSource } from '../features/MarketProbability';

export type { MLFeatures };

/** 1頭・1レース分の学習サンプル */
export interface TrainingSample {
  raceId: number;
  raceDate: string;
  horseId: number;
  horseName: string;
  vector: number[];
  features: MLFeatures;
  /** 1着なら1 */
  winLabel: number;
  /** 3着以内なら1 */
  showLabel: number;
  /** 確定着順 */
  finishPosition: number;
  /** 払戻用オッズ（特徴量には使わない） */
  payoutWinOdds: number | null;
}

/** レース単位にまとめた学習データ */
export interface TrainingRace {
  raceId: number;
  raceDate: string;
  raceName: string;
  /** 市場暗黙確率をオッズ / 人気順位 / 一様 のどれから作ったか */
  marketProbSource: MarketProbSource;
  samples: TrainingSample[];
}

/** 市場暗黙確率の算出元の内訳（レース数） */
export interface MarketSourceCounts {
  odds: number;
  popularity: number;
  uniform: number;
}

/** 後方互換の行列形式 */
export interface TrainingData {
  features: number[][];
  labels: number[];
  horseIds: number[];
  races: TrainingRace[];
}

/** 学習済みロジスティック回帰モデル */
export interface LogisticModel {
  /** 標準化空間での係数 */
  weights: number[];
  bias: number;
  /** 学習時の特徴量平均（推論時に再利用） */
  mean: number[];
  /** 学習時の特徴量標準偏差（0は1に置換） */
  std: number[];
  /** 実際に回った反復回数 */
  iterations: number;
  /** 収束したか */
  converged: boolean;
  /** 最終的な平均対数損失 */
  finalLoss: number;
}

/** 学習オプション */
export interface TrainOptions {
  /** L2正則化係数 */
  l2?: number;
  /** 学習率 */
  learningRate?: number;
  /** 最大反復回数 */
  maxIterations?: number;
  /** 収束判定の損失変化量 */
  tolerance?: number;
}

/** 較正テーブルの1行 */
export interface CalibrationBin {
  /** 区間下限 */
  from: number;
  /** 区間上限 */
  to: number;
  count: number;
  /** 予測確率の平均 */
  avgPredicted: number;
  /** 実際の発生率 */
  actualRate: number;
}

/** 評価指標 */
export interface EvaluationMetrics {
  /** 評価レース数 */
  races: number;
  /** 評価出走行数 */
  runners: number;
  /** レース単位の勝ち馬 log loss（主指標、低いほど良い） */
  logLoss: number;
  /** 単勝確率の Brier スコア */
  brier: number;
  /** 複勝（3着以内）の二値 log loss */
  showLogLoss: number;
  /** レース内 top-1 的中率 */
  top1Accuracy: number;
  /** 予測上位3頭のうち実際に3着以内だった割合（top-3 再現率） */
  top3Recall: number;
  /** 予測順位と実着順の Spearman 順位相関 */
  spearman: number;
  /**
   * 単勝1点買い（予測1位）の実オッズ回収率
   *
   * @remarks
   * `roiRaces === 0` のときは **算出不能**（0 は「回収率0%」ではない）。
   */
  winRoi: number;
  /**
   * 回収率の算出に使えたレース数
   *
   * @remarks
   * **全出走馬に事前オッズが揃っているレース**（`hasCompleteOdds`）だけを数える。
   * 「賭けた馬にオッズがある」を条件にすると、結果ページ由来の確定オッズは
   * 1着馬にしか無いため「予測1位＝勝ち馬だったレース」しか賭け対象にならず、
   * 回収率が的中レースだけの平均配当になってしまう（選択バイアス）。
   */
  roiRaces: number;
}

/** walk-forward の1ブロック分の結果 */
export interface WalkForwardBlock {
  block: number;
  trainRaces: number;
  testRaces: number;
  /** テストブロックの期間 */
  from: string;
  to: string;
  metrics: EvaluationMetrics;
}

/** walk-forward 検証の結果 */
export interface WalkForwardResult {
  /** 全テストブロックを合算した指標 */
  overall: EvaluationMetrics;
  /**
   * 市場特徴量のみで学習した同型モデルのベースライン（**採用ゲート①の基準**）
   *
   * @remarks
   * 人気・オッズ系の特徴量だけを残して同じ手続きで学習したモデル。
   * 「市場情報をデータから学習したモデル」が基準なので、これを上回れば
   * 市場以外の情報が効いていると言える。
   */
  marketModelBaseline: EvaluationMetrics;
  /**
   * 人気別勝率テーブルのベースライン（参考値）
   *
   * @remarks
   * 全馬にオッズが揃うレースでは市場オッズ、揃わなければ人気別勝率の**固定テーブル**。
   * ML は同じ情報を特徴量に持つため、これを上回るのはほぼ自明。採用判定には使わない。
   */
  marketBaseline: EvaluationMetrics;
  /** 市場ベースラインの算出元の内訳（テスト対象レース） */
  marketSourceCounts: MarketSourceCounts;
  /** ルールベース（10要素）のベースライン */
  ruleBaseline: EvaluationMetrics;
  blocks: WalkForwardBlock[];
  /** 単勝確率の較正テーブル */
  calibration: CalibrationBin[];
  /** 採用ゲートの判定 */
  gate: AdoptionGate;
  /** 検証が成立しなかった場合の理由 */
  insufficientReason?: string;
}

/** 採用ゲート判定 */
export interface AdoptionGate {
  /** log loss が「市場特徴量のみで学習した同型モデル」を下回ったか */
  beatsMarketLogLoss: boolean;
  /** top-1 的中率がルールベースを上回ったか */
  beatsRuleTop1: boolean;
  /** 両方を満たしたか（ML を主軸にしてよいか） */
  passed: boolean;
  mlLogLoss: number;
  /** 市場特徴量のみで学習した同型モデルの log loss（ゲート①の基準値） */
  marketLogLoss: number;
  /** 人気別勝率テーブルの log loss（参考値。判定には使わない） */
  popularityTableLogLoss: number;
  mlTop1: number;
  ruleTop1: number;
}

/** 1頭分の予測結果 */
export interface PredictionResult {
  horseId: number;
  horseName: string;
  horseNumber?: number;
  /** 単勝確率（レース内 softmax、全馬合計1） */
  winProbability: number;
  /** 複勝（3着以内）確率 */
  showProbability: number;
  /** 市場の暗黙勝率（控除率補正済み） */
  marketImpliedProb: number;
  /** ルールベース総合スコア（0-100） */
  ruleTotalScore: number;
  features: MLFeatures;
  /** 標準化係数の絶対値による特徴量寄与度 */
  featureImportance: { name: string; value: number }[];
}

/** モデル統計 */
export interface ModelStats {
  trained: boolean;
  trainingRaces: number;
  trainingRunners: number;
  win: LogisticModel | null;
  show: LogisticModel | null;
  featureImportance: { name: string; value: number }[];
  /** 学習データ内での参考指標（in-sample。汎化性能ではない） */
  inSample: EvaluationMetrics | null;
}


/** 評価対象の1レース分（確率つき） */
export interface ScoredRace {
  samples: TrainingSample[];
  /** 単勝確率（合計1） */
  winProbs: number[];
  /** 複勝確率 */
  showProbs: number[];
}
