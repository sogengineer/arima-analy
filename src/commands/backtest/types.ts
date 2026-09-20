/**
 * バックテストの結果・サマリーの型
 *
 * @remarks
 * Backtest コマンドと、その集計・表示モジュールで共有する。
 */

import type { MarketProbSource } from '../../features/MarketProbability';

export interface BacktestResult {
  raceId: number;
  raceName: string;
  raceDate: string;
  venue: string;
  predictions: PredictionResult[];
  actuals: ActualResult[];
  metrics: RaceMetrics;
  /** 市場暗黙確率をオッズ / 人気順位 / 一様 のどれから作ったか */
  marketProbSource: MarketProbSource;
}

export interface PredictionResult {
  horseId: number;
  horseName: string;
  predictedRank: number;
  totalScore: number;
  components: Record<string, number>;
  /** 控除率補正済みの市場暗黙勝率 */
  marketImpliedProb: number;
  /** 払戻計算用の確定オッズ（無ければ null） */
  payoutWinOdds: number | null;
}

export interface ActualResult {
  horseId: number;
  horseName: string;
  actualPosition: number;
}

export interface RaceMetrics {
  top1Hit: boolean;      // 1位的中
  top3Hit: number;       // 上位3頭中何頭が3着内
  top5Hit: number;       // 上位5頭中何頭が5着内
  rankCorrelation: number; // 順位相関
}

export interface BacktestSummary {
  totalRaces: number;
  top1Accuracy: number;    // 1位的中率
  top3Accuracy: number;    // 上位3頭の3着内率
  top5Accuracy: number;    // 上位5頭の5着内率
  avgRankCorrelation: number; // 平均順位相関
  elementContribution: { name: string; correlation: number }[];
  simulatedROI: SimulatedROI;
  /** 市場オッズのみのベースライン */
  marketBaseline: MarketBaselineSummary;
  /** ルールベースの勝ち馬 log loss（総合スコアの softmax 射影） */
  ruleLogLoss: number;
}

export interface SimulatedROI {
  /**
   * 実オッズで算出できたレース数（= 全馬に事前オッズが揃っているレース数）
   *
   * @remarks
   * 0 のときは回収率が **算出不能**。`roi: 0` は「回収率0%」ではない。
   */
  oddsAvailableRaces: number;
  winBet: { bets: number; hits: number; roi: number };
}

export interface BacktestOptions {
  limit?: number;
  gradeOnly?: boolean;
  verbose?: boolean;
  /** ML の walk-forward 検証と採用ゲート判定も実行する */
  ml?: boolean;
  /** walk-forward の分割数 */
  blocks?: number;
  /** 外部からDB接続を渡す場合（接続をcloseしない） */
  externalConnection?: boolean;
}

/** 市場オッズのみのベースライン指標 */
export interface MarketBaselineSummary {
  races: number;
  /** 1番人気（最低オッズ）が1着だった割合 */
  top1Accuracy: number;
  /** 勝ち馬の log loss（暗黙確率ベース） */
  logLoss: number;
  /** 暗黙確率を単勝オッズから算出したレース数 */
  oddsSourcedRaces: number;
  /** 暗黙確率を人気順位から算出したレース数 */
  popularitySourcedRaces: number;
  /** オッズも人気も無く一様分布にしたレース数 */
  uniformSourcedRaces: number;
}
