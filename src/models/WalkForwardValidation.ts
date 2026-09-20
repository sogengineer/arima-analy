/**
 * walk-forward 検証（時系列ブロック・レース単位グルーピング）
 */

import type {
  MarketSourceCounts,
  ScoredRace,
  TrainingRace,
  TrainOptions,
  WalkForwardBlock,
  WalkForwardResult
} from './MachineLearningTypes';
import { buildCalibrationTable, maskToMarketFeatures, splitRacesIntoDateBlocks } from './MachineLearningMath';
import { trainL2Logistic } from './LogisticRegression';
import {
  buildAdoptionGate,
  collectWinProbsAndLabels,
  emptyWalkForwardResult,
  evaluateRaces
} from './RaceEvaluation';
import { scoreRace, scoreRaceByMarket, scoreRaceByMarketModel, scoreRaceByRule } from './RaceScoring';
import { MIN_TRAINING_SAMPLES, MIN_WALK_FORWARD_RACES } from './MachineLearningConstants';

/** 1ブロック分のテスト区間に付けた確率（ML と3種のベースライン） */
interface WalkForwardScores {
  ml: ScoredRace[];
  marketModel: ScoredRace[];
  market: ScoredRace[];
  rule: ScoredRace[];
}

export function runWalkForwardValidation(
  races: TrainingRace[],
  blocks: number,
  options: TrainOptions
): WalkForwardResult {
  if (races.length < MIN_WALK_FORWARD_RACES) {
    return emptyWalkForwardResult(
      `walk-forward には最低 ${MIN_WALK_FORWARD_RACES} レース必要です（現在 ${races.length} レース）`
    );
  }

  const effectiveBlocks = Math.max(2, Math.min(blocks, Math.floor(races.length / 2)));
  // 開催日単位で切る（同一日のレースは必ず同じブロックに入る）
  const blockStarts = splitRacesIntoDateBlocks(
    races.map(r => r.raceDate),
    effectiveBlocks
  );

  if (blockStarts.length < 2) {
    return emptyWalkForwardResult(
      `開催日が1日しかないため walk-forward できません（同一開催日のレースは分割できない）`
    );
  }

  const blockResults: WalkForwardBlock[] = [];
  const scoredAll: ScoredRace[] = [];
  const marketModelAll: ScoredRace[] = [];
  const marketAll: ScoredRace[] = [];
  const ruleAll: ScoredRace[] = [];
  const marketSourceCounts: MarketSourceCounts = { odds: 0, popularity: 0, uniform: 0 };

  // ブロック0は学習専用（テストしない）
  for (let b = 1; b < blockStarts.length; b++) {
    const testEnd = b + 1 < blockStarts.length ? blockStarts[b + 1] : races.length;
    const evaluated = evaluateBlock(
      races,
      { block: b, testStart: blockStarts[b], testEnd },
      options
    );
    if (!evaluated) continue;

    scoredAll.push(...evaluated.scores.ml);
    marketModelAll.push(...evaluated.scores.marketModel);
    marketAll.push(...evaluated.scores.market);
    ruleAll.push(...evaluated.scores.rule);
    for (const r of evaluated.testRaces) marketSourceCounts[r.marketProbSource]++;
    blockResults.push(evaluated.result);
  }

  if (scoredAll.length === 0) {
    return emptyWalkForwardResult(
      '各ブロックの学習データが不足しており、評価できるブロックがありません'
    );
  }

  const overall = evaluateRaces(scoredAll);
  const marketModelBaseline = evaluateRaces(marketModelAll);
  const marketBaseline = evaluateRaces(marketAll);
  const ruleBaseline = evaluateRaces(ruleAll);
  const { probs, labels } = collectWinProbsAndLabels(scoredAll);

  return {
    overall,
    marketModelBaseline,
    marketBaseline,
    marketSourceCounts,
    ruleBaseline,
    blocks: blockResults,
    calibration: buildCalibrationTable(probs, labels),
    gate: buildAdoptionGate(overall, marketModelBaseline, marketBaseline, ruleBaseline)
  };
}

/**
 * ブロック b のテスト区間を、それ以前のレースだけで学習したモデルで評価する
 *
 * @returns 学習データが足りない場合は null
 */
function evaluateBlock(
  races: TrainingRace[],
  range: { block: number; testStart: number; testEnd: number },
  options: TrainOptions
): { result: WalkForwardBlock; scores: WalkForwardScores; testRaces: TrainingRace[] } | null {
  const trainRaces = races.slice(0, range.testStart);
  const testRaces = races.slice(range.testStart, range.testEnd);
  if (trainRaces.length === 0 || testRaces.length === 0) return null;

  const trainSamples = trainRaces.flatMap(r => r.samples);
  if (trainSamples.length < MIN_TRAINING_SAMPLES) return null;

  const X = trainSamples.map(s => s.vector);
  const winModel = trainL2Logistic(X, trainSamples.map(s => s.winLabel), options);
  const showModel = trainL2Logistic(X, trainSamples.map(s => s.showLabel), options);

  // 市場特徴量のみの同型モデル（同じ学習窓・同じ手続き）
  const marketX = X.map(maskToMarketFeatures);
  const marketWinModel = trainL2Logistic(marketX, trainSamples.map(s => s.winLabel), options);
  const marketShowModel = trainL2Logistic(marketX, trainSamples.map(s => s.showLabel), options);

  const scored = testRaces.map(r => scoreRace(r.samples, winModel, showModel));
  const scores: WalkForwardScores = {
    ml: scored,
    marketModel: testRaces.map(r =>
      scoreRaceByMarketModel(r.samples, marketWinModel, marketShowModel)
    ),
    market: testRaces.map(r => scoreRaceByMarket(r.samples)),
    rule: testRaces.map(r => scoreRaceByRule(r.samples))
  };

  return {
    result: {
      block: range.block,
      trainRaces: trainRaces.length,
      testRaces: testRaces.length,
      from: testRaces[0].raceDate,
      to: testRaces[testRaces.length - 1].raceDate,
      metrics: evaluateRaces(scored)
    },
    scores,
    testRaces
  };
}
