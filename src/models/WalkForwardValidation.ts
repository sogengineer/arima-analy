/**
 * walk-forward 検証（時系列ブロック・レース単位グルーピング）
 *
 * @remarks
 * 少データ向けの調整として、各ブロックで
 *
 * 1. **最小学習レース数**（既定 {@link DEFAULT_MIN_TRAIN_RACES}）に満たないブロックはスキップ
 * 2. **λ（L2強度）を学習窓の内側分割だけで選ぶ**（検証ブロックのデータは使わない）
 * 3. 選んだ λ で学習し、検証ブロックを評価
 *
 * を行う。市場のみモデル・小モデルも同じ手続き（同じ内側分割・同じ候補）で学習するので、
 * 比較表の各列は「同じ条件で最善を尽くしたモデル同士」の比較になる。
 */

import type {
  EvaluationMetrics,
  LogisticModel,
  MarketSourceCounts,
  ScoredRace,
  SkippedBlock,
  TrainingRace,
  TrainOptions,
  WalkForwardBlock,
  WalkForwardOptions,
  WalkForwardResult
} from './MachineLearningTypes';
import {
  buildCalibrationTable,
  maskToMarketFeatures,
  maskToSmallModelFeatures,
  splitRacesIntoDateBlocks
} from './MachineLearningMath';
import { trainL2Logistic } from './LogisticRegression';
import {
  buildAdoptionGate,
  collectWinProbsAndLabels,
  emptyWalkForwardResult,
  evaluateRaces
} from './RaceEvaluation';
import { scoreRace, scoreRaceByMarket, scoreRaceByRule, scoreRaceWithMask } from './RaceScoring';
import {
  DEFAULT_L2_CANDIDATES,
  tuneOnTrainWindow,
  type FeatureMask,
  type TuningResult
} from './HyperparameterSelection';
import {
  DEFAULT_MIN_TRAIN_RACES,
  MIN_TRAINING_SAMPLES,
  MIN_WALK_FORWARD_RACES
} from './MachineLearningConstants';

/** 1ブロック分のテスト区間に付けた確率（ML と4種のベースライン） */
interface WalkForwardScores {
  ml: ScoredRace[];
  marketModel: ScoredRace[];
  smallModel: ScoredRace[];
  market: ScoredRace[];
  rule: ScoredRace[];
}

/** 全ブロックぶんの確率を貯める箱 */
interface ScoreAccumulator {
  ml: ScoredRace[];
  marketModel: ScoredRace[];
  smallModel: ScoredRace[];
  market: ScoredRace[];
  rule: ScoredRace[];
}

export function runWalkForwardValidation(
  races: TrainingRace[],
  options: WalkForwardOptions = {}
): WalkForwardResult {
  const minTrainRaces = options.minTrainRaces ?? DEFAULT_MIN_TRAIN_RACES;

  if (races.length < MIN_WALK_FORWARD_RACES) {
    return emptyWalkForwardResult(
      `walk-forward には最低 ${MIN_WALK_FORWARD_RACES} レース必要です（現在 ${races.length} レース）`,
      minTrainRaces
    );
  }

  const blockStarts = planBlockStarts(races, options.blocks ?? 5);
  if (blockStarts.length < 2) {
    return emptyWalkForwardResult(
      `開催日が1日しかないため walk-forward できません（同一開催日のレースは分割できない）`,
      minTrainRaces
    );
  }

  const acc: ScoreAccumulator = { ml: [], marketModel: [], smallModel: [], market: [], rule: [] };
  const blockResults: WalkForwardBlock[] = [];
  const skippedBlocks: SkippedBlock[] = [];
  const marketSourceCounts: MarketSourceCounts = { odds: 0, popularity: 0, uniform: 0 };

  // ブロック0は学習専用（テストしない）
  for (let b = 1; b < blockStarts.length; b++) {
    const testEnd = b + 1 < blockStarts.length ? blockStarts[b + 1] : races.length;
    const range = { block: b, testStart: blockStarts[b], testEnd };

    const skip = skipReasonFor(races, range, minTrainRaces);
    if (skip) {
      skippedBlocks.push(skip);
      continue;
    }

    const evaluated = evaluateBlock(races, range, options);
    if (!evaluated) continue;

    acc.ml.push(...evaluated.scores.ml);
    acc.marketModel.push(...evaluated.scores.marketModel);
    acc.smallModel.push(...evaluated.scores.smallModel);
    acc.market.push(...evaluated.scores.market);
    acc.rule.push(...evaluated.scores.rule);
    for (const r of evaluated.testRaces) marketSourceCounts[r.marketProbSource]++;
    blockResults.push(evaluated.result);
  }

  if (acc.ml.length === 0) {
    return emptyWalkForwardResult(
      buildNoBlockReason(skippedBlocks, minTrainRaces),
      minTrainRaces,
      skippedBlocks
    );
  }

  return summarize(acc, {
    blocks: blockResults,
    skippedBlocks,
    marketSourceCounts,
    minTrainRaces
  });
}

/** 開催日単位のブロック開始位置 */
function planBlockStarts(races: TrainingRace[], blocks: number): number[] {
  const effectiveBlocks = Math.max(2, Math.min(blocks, Math.floor(races.length / 2)));
  return splitRacesIntoDateBlocks(
    races.map(r => r.raceDate),
    effectiveBlocks
  );
}

/** ブロック範囲 */
interface BlockRange {
  block: number;
  testStart: number;
  testEnd: number;
}

/**
 * 学習データ不足でスキップすべきか判定する
 *
 * @returns スキップするなら理由つきの記録、しないなら null
 */
function skipReasonFor(
  races: TrainingRace[],
  range: BlockRange,
  minTrainRaces: number
): SkippedBlock | null {
  const trainRaces = range.testStart;
  const testRaces = range.testEnd - range.testStart;
  if (trainRaces >= minTrainRaces || testRaces <= 0) return null;

  return {
    block: range.block,
    trainRaces,
    testRaces,
    from: races[range.testStart].raceDate,
    to: races[range.testEnd - 1].raceDate,
    reason: `学習 ${trainRaces} レース < 最小 ${minTrainRaces} レース`
  };
}

/** 評価できるブロックが1つも無かったときの理由文 */
function buildNoBlockReason(skipped: SkippedBlock[], minTrainRaces: number): string {
  if (skipped.length > 0) {
    return `学習データが最小 ${minTrainRaces} レースに満たず、全 ${skipped.length} ブロックをスキップしました`
      + `（--min-train で引き下げられます）`;
  }
  return '各ブロックの学習データが不足しており、評価できるブロックがありません';
}

/** 集計まわりの付随情報 */
interface SummaryContext {
  blocks: WalkForwardBlock[];
  skippedBlocks: SkippedBlock[];
  marketSourceCounts: MarketSourceCounts;
  minTrainRaces: number;
}

/** 貯めた確率を指標へまとめる */
function summarize(acc: ScoreAccumulator, ctx: SummaryContext): WalkForwardResult {
  const overall = evaluateRaces(acc.ml);
  const marketModelBaseline = evaluateRaces(acc.marketModel);
  const { probs, labels } = collectWinProbsAndLabels(acc.ml);

  return {
    overall,
    marketModelBaseline,
    marketBaseline: evaluateRaces(acc.market),
    smallModelBaseline: evaluateRaces(acc.smallModel),
    marketSourceCounts: ctx.marketSourceCounts,
    ruleBaseline: evaluateRaces(acc.rule),
    blocks: ctx.blocks,
    skippedBlocks: ctx.skippedBlocks,
    minTrainRaces: ctx.minTrainRaces,
    calibration: buildCalibrationTable(probs, labels),
    gate: buildAdoptionGate(
      overall,
      marketModelBaseline,
      evaluateRaces(acc.market),
      evaluateRaces(acc.rule)
    )
  };
}

/** 学習済みの単勝・複勝モデルと、そのとき選ばれたハイパーパラメータ */
interface FittedModels {
  win: LogisticModel;
  show: LogisticModel;
  tuning: TuningResult;
}

/**
 * 学習窓だけで λ を選び、その λ で単勝・複勝モデルを学習する
 *
 * @param trainRaces - **学習窓のレースのみ**。検証ブロックのレースは渡さない
 */
function fitWithTunedLambda(
  trainRaces: TrainingRace[],
  mask: FeatureMask,
  options: WalkForwardOptions
): FittedModels {
  const tuning = tuneOnTrainWindow(trainRaces, {
    candidates: options.l2Candidates ?? DEFAULT_L2_CANDIDATES,
    train: options.train,
    mask
  });

  const samples = trainRaces.flatMap(r => r.samples);
  const X = samples.map(s => mask(s.vector));
  const train: TrainOptions = { ...options.train, l2: tuning.lambda };

  return {
    win: trainL2Logistic(X, samples.map(s => s.winLabel), train),
    show: trainL2Logistic(X, samples.map(s => s.showLabel), train),
    tuning
  };
}

/**
 * ブロック b のテスト区間を、それ以前のレースだけで学習したモデルで評価する
 *
 * @returns 学習データが足りない場合は null
 */
function evaluateBlock(
  races: TrainingRace[],
  range: BlockRange,
  options: WalkForwardOptions
): { result: WalkForwardBlock; scores: WalkForwardScores; testRaces: TrainingRace[] } | null {
  const trainRaces = races.slice(0, range.testStart);
  const testRaces = races.slice(range.testStart, range.testEnd);
  if (trainRaces.length === 0 || testRaces.length === 0) return null;
  if (trainRaces.flatMap(r => r.samples).length < MIN_TRAINING_SAMPLES) return null;

  const identity: FeatureMask = v => v;
  const full = fitWithTunedLambda(trainRaces, identity, options);
  const marketOnly = fitWithTunedLambda(trainRaces, maskToMarketFeatures, options);
  const small = fitWithTunedLambda(trainRaces, maskToSmallModelFeatures, options);

  const scored = testRaces.map(r => scoreRace(r.samples, full.win, full.show));

  return {
    result: buildBlockResult(range, trainRaces.length, testRaces, full.tuning, evaluateRaces(scored)),
    scores: {
      ml: scored,
      marketModel: testRaces.map(r =>
        scoreRaceWithMask(r.samples, marketOnly, maskToMarketFeatures)
      ),
      smallModel: testRaces.map(r =>
        scoreRaceWithMask(r.samples, small, maskToSmallModelFeatures)
      ),
      market: testRaces.map(r => scoreRaceByMarket(r.samples)),
      rule: testRaces.map(r => scoreRaceByRule(r.samples))
    },
    testRaces
  };
}

/** ブロックの表示用レコードを組む */
function buildBlockResult(
  range: BlockRange,
  trainRaceCount: number,
  testRaces: TrainingRace[],
  tuning: TuningResult,
  metrics: EvaluationMetrics
): WalkForwardBlock {
  return {
    block: range.block,
    trainRaces: trainRaceCount,
    testRaces: testRaces.length,
    from: testRaces[0].raceDate,
    to: testRaces[testRaces.length - 1].raceDate,
    metrics,
    lambda: tuning.lambda,
    innerFolds: tuning.innerFolds
  };
}
