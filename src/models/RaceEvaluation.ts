/**
 * レース群の評価指標と採用ゲートの判定
 */

import type {
  AdoptionGate,
  SkippedBlock,
  EvaluationMetrics,
  ScoredRace,
  TrainingSample,
  WalkForwardResult
} from './MachineLearningTypes';
import {
  binaryLogLoss,
  brierScore,
  clampProbability,
  spearmanCorrelation,
  sumOf
} from './MachineLearningMath';

/** 空の指標 */
export function emptyMetrics(): EvaluationMetrics {
  return {
    races: 0,
    runners: 0,
    logLoss: 0,
    brier: 0,
    showLogLoss: 0,
    top1Accuracy: 0,
    top3Recall: 0,
    spearman: 0,
    winRoi: 0,
    roiRaces: 0
  };
}

/**
 * レース群の評価指標を計算
 *
 * @remarks
 * log loss は **レース単位の勝ち馬 log loss**（-mean log p(実際の勝ち馬)）。
 * 市場の暗黙確率と直接比較できる定式化で、採用ゲートの主指標に使う。
 */
export function evaluateRaces(scored: ScoredRace[]): EvaluationMetrics {
  if (scored.length === 0) return emptyMetrics();

  const acc = newMetricsAccumulator();
  for (const race of scored) {
    if (race.samples.length === 0) continue;
    accumulateRace(acc, race);
  }

  return finalizeMetrics(scored.length, acc);
}

/** evaluateRaces の途中集計 */
interface MetricsAccumulator {
  winnerLogLossSum: number;
  winnerLogLossRaces: number;
  top1Hits: number;
  top1Races: number;
  top3HitCount: number;
  top3Slots: number;
  roiStake: number;
  roiReturn: number;
  roiRaces: number;
  runners: number;
  allWinProbs: number[];
  allWinLabels: number[];
  allShowProbs: number[];
  allShowLabels: number[];
  spearmanValues: number[];
}

function newMetricsAccumulator(): MetricsAccumulator {
  return {
    winnerLogLossSum: 0,
    winnerLogLossRaces: 0,
    top1Hits: 0,
    top1Races: 0,
    top3HitCount: 0,
    top3Slots: 0,
    roiStake: 0,
    roiReturn: 0,
    roiRaces: 0,
    runners: 0,
    allWinProbs: [],
    allWinLabels: [],
    allShowProbs: [],
    allShowLabels: [],
    spearmanValues: []
  };
}

/** 最大値の添字（同値なら先に現れた方） */
function argMax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

/** 予測確率の降順に並べた添字 */
function descendingOrder(winProbs: number[], count: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < count; i++) order.push(i);
  return order.sort((a, b) => winProbs[b] - winProbs[a]);
}

/** 予測順位（1始まり）を元の並び順で返す */
function predictedRanks(order: number[], size: number): number[] {
  const predRank = new Array<number>(size).fill(0);
  for (let rank = 0; rank < order.length; rank++) {
    predRank[order[rank]] = rank + 1;
  }
  return predRank;
}

/** 1レース分の指標を集計へ加える */
function accumulateRace(acc: MetricsAccumulator, race: ScoredRace): void {
  const { samples, winProbs, showProbs } = race;
  acc.runners += samples.length;

  for (let i = 0; i < samples.length; i++) {
    acc.allWinProbs.push(winProbs[i]);
    acc.allWinLabels.push(samples[i].winLabel);
    acc.allShowProbs.push(showProbs[i]);
    acc.allShowLabels.push(samples[i].showLabel);
  }

  // 勝ち馬 log loss
  const winnerIdx = samples.findIndex(s => s.winLabel === 1);
  if (winnerIdx >= 0) {
    acc.winnerLogLossSum += -Math.log(clampProbability(winProbs[winnerIdx]));
    acc.winnerLogLossRaces++;
  }

  // top-1 的中
  const bestIdx = argMax(winProbs);
  if (winnerIdx >= 0) {
    acc.top1Races++;
    if (bestIdx === winnerIdx) acc.top1Hits++;
  }

  // top-3 再現率（予測上位3頭のうち実際に3着以内だった数 / 3）
  const order = descendingOrder(winProbs, samples.length);
  const top3 = order.slice(0, Math.min(3, order.length));
  acc.top3HitCount += top3.filter(i => samples[i].showLabel === 1).length;
  acc.top3Slots += top3.length;

  // Spearman（予測順位 vs 実着順）
  acc.spearmanValues.push(
    spearmanCorrelation(
      predictedRanks(order, samples.length),
      samples.map(s => s.finishPosition)
    )
  );

  accumulateWinRoi(acc, samples, bestIdx);
}

/**
 * 実オッズ回収率（予測1位に単勝100円）を集計へ加える
 *
 * @remarks
 * 対象は「全出走馬に事前オッズが揃っているレース」に限る。
 * 賭けた馬にオッズがあるかで判定すると、結果ページ由来の確定オッズは1着馬にしか
 * 無いため「予測1位＝勝ち馬」のレースだけが賭け対象になり、回収率が
 * 的中レースの平均配当に化ける（= 常に100%的中を仮定したのと同じ）。
 */
function accumulateWinRoi(
  acc: MetricsAccumulator,
  samples: TrainingSample[],
  bestIdx: number
): void {
  const oddsComplete = samples.every(s => s.features.hasMarketOdds === 1);
  const betOdds = samples[bestIdx].payoutWinOdds;
  if (!oddsComplete || betOdds == null || !(betOdds > 0)) return;

  acc.roiRaces++;
  acc.roiStake += 100;
  if (samples[bestIdx].winLabel === 1) acc.roiReturn += betOdds * 100;
}

/** 集計値を評価指標へまとめる */
function finalizeMetrics(races: number, acc: MetricsAccumulator): EvaluationMetrics {
  return {
    races,
    runners: acc.runners,
    logLoss: acc.winnerLogLossRaces > 0 ? acc.winnerLogLossSum / acc.winnerLogLossRaces : 0,
    brier: brierScore(acc.allWinProbs, acc.allWinLabels),
    showLogLoss: binaryLogLoss(acc.allShowProbs, acc.allShowLabels),
    top1Accuracy: acc.top1Races > 0 ? acc.top1Hits / acc.top1Races : 0,
    top3Recall: acc.top3Slots > 0 ? acc.top3HitCount / acc.top3Slots : 0,
    spearman:
      acc.spearmanValues.length > 0 ? sumOf(acc.spearmanValues) / acc.spearmanValues.length : 0,
    winRoi: acc.roiStake > 0 ? acc.roiReturn / acc.roiStake : 0,
    roiRaces: acc.roiRaces
  };
}

/** 検証が成立しなかったときの結果 */
export function emptyWalkForwardResult(
  reason: string,
  minTrainRaces = 0,
  skippedBlocks: SkippedBlock[] = []
): WalkForwardResult {
  return {
    overall: emptyMetrics(),
    marketModelBaseline: emptyMetrics(),
    marketBaseline: emptyMetrics(),
    smallModelBaseline: emptyMetrics(),
    marketSourceCounts: { odds: 0, popularity: 0, uniform: 0 },
    ruleBaseline: emptyMetrics(),
    blocks: [],
    skippedBlocks,
    minTrainRaces,
    calibration: [],
    gate: {
      beatsMarketLogLoss: false,
      beatsMarketRanking: false,
      passed: false,
      mlLogLoss: 0,
      marketLogLoss: 0,
      popularityTableLogLoss: 0,
      mlTop1: 0,
      marketTop1: 0,
      mlBrier: 0,
      marketBrier: 0,
      ruleTop1: 0
    },
    insufficientReason: reason
  };
}

/** 較正テーブル用に、単勝確率と実績ラベルを平坦化する */
export function collectWinProbsAndLabels(scored: ScoredRace[]): { probs: number[]; labels: number[] } {
  const probs: number[] = [];
  const labels: number[] = [];
  for (const race of scored) {
    for (let i = 0; i < race.winProbs.length; i++) {
      probs.push(race.winProbs[i]);
      labels.push(race.samples[i].winLabel);
    }
  }
  return { probs, labels };
}

/**
 * 採用ゲートの判定
 *
 * @remarks
 * 2条件とも **市場のみモデル** を基準にする。
 *
 * - ① 勝ち馬 log loss が市場のみモデルより小さい（確率としての良さ）
 * - ② top-1 が市場のみモデル以上 **または** Brier が市場のみモデル以下（順位づけ・二乗誤差）
 *
 * 旧ゲート②「top-1 > ルールベース」は、実データでルールベースの top-1 が
 * 9.9%（16頭立てのランダム相当）しか出ず、どんなモデルでも通ってしまうため廃止した。
 * ルールベースの top-1 は参考値として残す（`ruleTop1`）。
 */
export function buildAdoptionGate(
  overall: EvaluationMetrics,
  marketModelBaseline: EvaluationMetrics,
  marketBaseline: EvaluationMetrics,
  ruleBaseline: EvaluationMetrics
): AdoptionGate {
  const beatsMarketLogLoss = overall.logLoss < marketModelBaseline.logLoss;
  const beatsMarketRanking =
    overall.top1Accuracy >= marketModelBaseline.top1Accuracy ||
    overall.brier <= marketModelBaseline.brier;
  return {
    beatsMarketLogLoss,
    beatsMarketRanking,
    passed: beatsMarketLogLoss && beatsMarketRanking,
    mlLogLoss: overall.logLoss,
    marketLogLoss: marketModelBaseline.logLoss,
    popularityTableLogLoss: marketBaseline.logLoss,
    mlTop1: overall.top1Accuracy,
    marketTop1: marketModelBaseline.top1Accuracy,
    mlBrier: overall.brier,
    marketBrier: marketModelBaseline.brier,
    ruleTop1: ruleBaseline.top1Accuracy
  };
}
