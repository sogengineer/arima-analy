/**
 * バックテスト結果の集計
 *
 * @remarks
 * Backtest から切り出した集計処理。DB には触れず、レース結果の配列だけを見る。
 */

import * as ss from 'simple-statistics';
import type { MarketProbSource } from '@/features/MarketProbability';
import type {
  BacktestResult,
  BacktestSummary,
  MarketBaselineSummary,
  PredictionResult,
  SimulatedROI
} from './types';

export function calculateSummary(results: BacktestResult[]): BacktestSummary {
  const totalRaces = results.length;

  // 的中率計算
  const top1Hits = results.filter(r => r.metrics.top1Hit).length;
  let top3HitsTotal = 0;
  let top5HitsTotal = 0;
  for (const r of results) {
    top3HitsTotal += r.metrics.top3Hit;
  }
  for (const r of results) {
    top5HitsTotal += r.metrics.top5Hit;
  }

  const top1Accuracy = totalRaces > 0 ? top1Hits / totalRaces : 0;
  const top3Accuracy = totalRaces > 0 ? top3HitsTotal / (totalRaces * 3) : 0;
  const top5Accuracy = totalRaces > 0 ? top5HitsTotal / (totalRaces * 5) : 0;

  // 平均順位相関
  const correlations = results.map(r => r.metrics.rankCorrelation).filter(c => !Number.isNaN(c));
  const avgRankCorrelation = correlations.length > 0 ? ss.mean(correlations) : 0;

  // 要素別寄与度
  const elementContribution = calculateElementContribution(results);

  // ROIシミュレーション（実オッズ）
  const simulatedROI = simulateROI(results);

  return {
    totalRaces,
    top1Accuracy,
    top3Accuracy,
    top5Accuracy,
    avgRankCorrelation,
    elementContribution,
    simulatedROI,
    marketBaseline: calculateMarketBaseline(results),
    ruleLogLoss: calculateRuleLogLoss(results)
  };
}

export function calculateElementContribution(
  results: BacktestResult[]
): { name: string; correlation: number }[] {
  const elementNames = [
    { key: 'recentPerformance', name: '直近成績' },
    { key: 'venueAptitude', name: 'コース適性' },
    { key: 'distanceAptitude', name: '距離適性' },
    { key: 'last3FAbility', name: '上がり3F' },
    { key: 'g1Achievement', name: 'G1実績' },
    { key: 'rotationAptitude', name: 'ローテ適性' },
    { key: 'jockey', name: '騎手能力' },
    { key: 'trackCondition', name: '馬場適性' },
    { key: 'postPosition', name: '枠順効果' },
    { key: 'trainer', name: '調教師' }
  ];

  const contributions: { name: string; correlation: number }[] = [];

  for (const { key, name } of elementNames) {
    const pairs = collectElementScorePositions(results, key);
    contributions.push({ name, correlation: elementCorrelation(pairs.scores, pairs.positions) });
  }

  return contributions.sort((a, b) => b.correlation - a.correlation);
}

/**
 * 要素スコアと実着順の対を、予測と実結果が揃った馬だけ集める
 */
function collectElementScorePositions(
  results: BacktestResult[],
  key: string
): { scores: number[]; positions: number[] } {
  const scores: number[] = [];
  const positions: number[] = [];

  for (const result of results) {
    for (const pred of result.predictions) {
      const actual = result.actuals.find(a => a.horseId === pred.horseId);
      if (actual) {
        scores.push(pred.components[key] || 0);
        positions.push(actual.actualPosition);
      }
    }
  }

  return { scores, positions };
}

/**
 * 要素スコアと実着順の相関を返す（標本が少ない場合・算出不能な場合は 0）
 */
function elementCorrelation(scores: number[], positions: number[]): number {
  if (scores.length <= 10) return 0;

  try {
    // 高スコア = 良い順位（小さい値）なので、負の相関が良い
    const corr = -ss.sampleCorrelation(scores, positions);
    return Number.isNaN(corr) ? 0 : corr;
  } catch {
    return 0;
  }
}

/**
 * 回収率シミュレーション（実オッズのみ）
 *
 * @remarks
 * 対象は **全出走馬に事前オッズが揃っているレース**（`marketProbSource === 'odds'`
 * ⇔ `hasCompleteOdds`）だけ。固定オッズの仮定（旧実装の単勝5倍など）は使わない。
 *
 * 「賭けた馬にオッズがあるレース」を条件にしてはいけない。
 * レース結果ページから復元できる確定オッズは1着馬ぶんしか無いため、
 * その条件では「予測1位＝実際の勝ち馬」だったレースしか賭け対象にならず、
 * 回収率が的中レースの平均配当（＝100%的中を仮定した値）に化ける。
 */
function simulateROI(results: BacktestResult[]): SimulatedROI {
  let bets = 0;
  let hits = 0;
  let stake = 0;
  let payout = 0;

  for (const result of results) {
    // 全馬に事前オッズが揃っているレースのみ（選択バイアスの遮断）
    if (result.marketProbSource !== 'odds') continue;

    const top1 = result.predictions[0];
    if (!top1 || top1.payoutWinOdds == null || top1.payoutWinOdds <= 0) continue;

    bets++;
    stake += 100;
    const actual = result.actuals.find(a => a.horseId === top1.horseId);
    if (actual?.actualPosition === 1) {
      hits++;
      payout += top1.payoutWinOdds * 100;
    }
  }

  return {
    oddsAvailableRaces: bets,
    winBet: {
      bets,
      hits,
      roi: stake > 0 ? payout / stake : 0
    }
  };
}

/**
 * 市場オッズのみのベースラインを計算
 *
 * @remarks
 * 暗黙確率 = (1/オッズ) をレース内で合計1に正規化したもの。
 * JRA の控除率（単勝で約20〜25%）はこの正規化で除去される。
 */
function calculateMarketBaseline(results: BacktestResult[]): MarketBaselineSummary {
  let races = 0;
  let top1Hits = 0;
  let logLossSum = 0;
  let logLossRaces = 0;
  const bySource: Record<MarketProbSource, number> = { odds: 0, popularity: 0, uniform: 0 };

  for (const result of results) {
    const withOdds = result.predictions.filter(p => p.marketImpliedProb > 0);
    if (withOdds.length < 2) continue;
    races++;
    bySource[result.marketProbSource]++;

    const winner = result.actuals.find(a => a.actualPosition === 1);
    if (!winner) continue;

    const favorite = mostBackedHorse(withOdds);
    if (favorite.horseId === winner.horseId) top1Hits++;

    const winnerPred = withOdds.find(p => p.horseId === winner.horseId);
    if (winnerPred) {
      logLossSum += -Math.log(Math.max(1e-12, winnerPred.marketImpliedProb));
      logLossRaces++;
    }
  }

  return {
    races,
    top1Accuracy: races > 0 ? top1Hits / races : 0,
    logLoss: logLossRaces > 0 ? logLossSum / logLossRaces : 0,
    oddsSourcedRaces: bySource.odds,
    popularitySourcedRaces: bySource.popularity,
    uniformSourcedRaces: bySource.uniform
  };
}

/**
 * 市場の暗黙確率が最も高い馬を返す（同値なら先に現れた馬）
 */
function mostBackedHorse(predictions: PredictionResult[]): PredictionResult {
  let favorite = predictions[0];
  for (const p of predictions) {
    if (p.marketImpliedProb > favorite.marketImpliedProb) {
      favorite = p;
    }
  }
  return favorite;
}

/**
 * ルールベースの勝ち馬 log loss
 *
 * @remarks
 * 総合スコアのレース内 z-score を softmax に通して確率に射影したもの。
 * 順位は総合スコアと一致するため、市場ベースラインと同じ土俵で比較できる。
 */
function calculateRuleLogLoss(results: BacktestResult[]): number {
  let sum = 0;
  let count = 0;

  for (const result of results) {
    const winner = result.actuals.find(a => a.actualPosition === 1);
    if (!winner || result.predictions.length < 2) continue;

    const scores = result.predictions.map(p => p.totalScore);
    let scoreSum = 0;
    for (const v of scores) {
      scoreSum += v;
    }
    const mean = scoreSum / scores.length;
    let squaredDiffSum = 0;
    for (const v of scores) {
      squaredDiffSum += (v - mean) ** 2;
    }
    const variance = squaredDiffSum / scores.length;
    const sd = Math.sqrt(variance);
    const logits = scores.map(v => (sd > 0 ? (v - mean) / sd : 0));
    const max = Math.max(...logits);
    const exps = logits.map(v => Math.exp(v - max));
    let total = 0;
    for (const v of exps) {
      total += v;
    }

    const winnerIdx = result.predictions.findIndex(p => p.horseId === winner.horseId);
    if (winnerIdx < 0 || total <= 0) continue;

    sum += -Math.log(Math.max(1e-12, exps[winnerIdx] / total));
    count++;
  }

  return count > 0 ? sum / count : 0;
}
