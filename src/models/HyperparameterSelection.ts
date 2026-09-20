/**
 * 学習窓の内側だけで λ（L2強度）を選ぶ（nested / rolling 選択）
 *
 * @remarks
 * ## なぜ必要か
 *
 * 227レース程度の少データでは、λ を固定すると過学習（自信過剰）になるか、
 * 逆に潰しすぎるかのどちらかに倒れる。かといって walk-forward の検証ブロックを見て
 * λ を選ぶと、それは検証データでのチューニングであり汎化性能ではなくなる。
 *
 * そこで **学習窓（検証ブロックより前のレース）をさらに内側で時系列分割** し、
 * その内側検証だけで λ を選ぶ。検証ブロックのレースはこのモジュールへ渡らない
 * （`WalkForwardValidation` が `races.slice(0, testStart)` だけを渡す）。
 *
 * ## 内側分割の形
 *
 * 学習窓を開催日単位で `innerBlocks` 個に割り、rolling（expanding window）で
 * fold を作る。fold i は「内側ブロック i より前の全レースで学習し、
 * 内側ブロック i で検証」する。評価は勝ち馬 log loss（本体の主指標と同じ）。
 */

import type { LogisticModel, TrainingRace, TrainOptions } from './MachineLearningTypes';
import { clampProbability, softmax, splitRacesIntoDateBlocks } from './MachineLearningMath';
import { linearScore, trainL2Logistic } from './LogisticRegression';
import { MIN_TRAINING_SAMPLES } from './MachineLearningConstants';

/** λ の既定候補（対数スケール） */
export const DEFAULT_L2_CANDIDATES: readonly number[] = [0.01, 0.1, 1, 10, 100];

/** 内側分割のブロック数 */
export const DEFAULT_INNER_BLOCKS = 3;

/** ベクトルの変換（市場のみモデル・小モデルのマスク用） */
export type FeatureMask = (vector: number[]) => number[];

export interface TuneOptions {
  /** 試す λ の候補（既定 {@link DEFAULT_L2_CANDIDATES}） */
  candidates?: readonly number[];
  /** 内側分割のブロック数（既定 {@link DEFAULT_INNER_BLOCKS}） */
  innerBlocks?: number;
  /** λ 以外の学習オプション */
  train?: TrainOptions;
  /** 特徴量マスク（省略時は素通し） */
  mask?: FeatureMask;
}

/** λ ごとの内側検証スコア */
export interface LambdaScore {
  lambda: number;
  /** 内側検証の勝ち馬 log loss。fold が作れなければ null */
  logLoss: number | null;
}

export interface TuningResult {
  /** 選ばれた λ */
  lambda: number;
  /** 実際に作れた内側 fold 数。0 なら選択できず既定値にフォールバックした */
  innerFolds: number;
  /** 表示用: 候補ごとの内側検証 log loss */
  scores: LambdaScore[];
}

/** 内側 fold（学習は [0, validStart)、検証は [validStart, validEnd)） */
interface InnerFold {
  validStart: number;
  validEnd: number;
}

/**
 * 学習窓を開催日単位で rolling 分割して内側 fold を作る
 *
 * @param races - 学習窓のレース（日付昇順）
 * @returns 学習サンプルが足りる fold のみ。1つも作れなければ空配列
 */
export function buildInnerFolds(races: TrainingRace[], innerBlocks: number): InnerFold[] {
  const starts = splitRacesIntoDateBlocks(
    races.map(r => r.raceDate),
    innerBlocks
  );
  if (starts.length < 2) return [];

  const folds: InnerFold[] = [];
  for (let b = 1; b < starts.length; b++) {
    const validStart = starts[b];
    const validEnd = b + 1 < starts.length ? starts[b + 1] : races.length;
    if (validEnd <= validStart) continue;

    const innerTrainSamples = countSamples(races, 0, validStart);
    if (innerTrainSamples < MIN_TRAINING_SAMPLES) continue;

    folds.push({ validStart, validEnd });
  }
  return folds;
}

/** 区間 [from, to) の出走行数 */
function countSamples(races: TrainingRace[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += races[i].samples.length;
  return total;
}

/** 1レース分の「勝ち馬の効用」と「全馬の効用」 */
interface RaceLogits {
  logits: number[];
  winnerIndex: number;
}

/** 学習済みモデルでレース列の効用を並べる（勝ち馬が居ないレースは捨てる） */
function collectLogits(
  races: TrainingRace[],
  from: number,
  to: number,
  model: LogisticModel,
  mask: FeatureMask
): RaceLogits[] {
  const out: RaceLogits[] = [];
  for (let i = from; i < to; i++) {
    const samples = races[i].samples;
    const winnerIndex = samples.findIndex(s => s.winLabel === 1);
    if (winnerIndex < 0) continue;
    out.push({
      logits: samples.map(s => linearScore(model, mask(s.vector))),
      winnerIndex
    });
  }
  return out;
}

/** 勝ち馬 log loss（レース内 softmax） */
function winnerLogLoss(races: RaceLogits[]): number {
  if (races.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const race of races) {
    const probs = softmax(race.logits);
    total += -Math.log(clampProbability(probs[race.winnerIndex]));
  }
  return total / races.length;
}

/** win モデルの学習対象（レース区間と特徴量の扱い方） */
interface WinModelFit {
  /** 学習に使うレース区間 [from, to) */
  range: { from: number; to: number };
  lambda: number;
  mask: FeatureMask;
  train: TrainOptions;
}

/** 指定 λ で win モデルを学習する */
function trainWinModel(races: TrainingRace[], fit: WinModelFit): LogisticModel {
  const { range, lambda, mask, train } = fit;
  const samples: { vector: number[]; winLabel: number }[] = [];
  for (let i = range.from; i < range.to; i++) {
    for (const s of races[i].samples) samples.push({ vector: mask(s.vector), winLabel: s.winLabel });
  }
  return trainL2Logistic(
    samples.map(s => s.vector),
    samples.map(s => s.winLabel),
    { ...train, l2: lambda }
  );
}

/**
 * 学習窓の内側だけで λ を選ぶ
 *
 * @param trainRaces - **学習窓のレースのみ**（検証ブロックを含めてはならない）
 * @returns 選ばれた λ と、候補ごとの内側検証スコア
 *
 * @remarks
 * 内側 fold が1つも作れない（学習窓が短すぎる）場合は、候補の中央値を λ として返し、
 * `innerFolds = 0` で「選択できなかった」ことを呼び出し側へ伝える。
 */
export function tuneOnTrainWindow(
  trainRaces: TrainingRace[],
  options: TuneOptions = {}
): TuningResult {
  const candidates = options.candidates ?? DEFAULT_L2_CANDIDATES;
  const mask: FeatureMask = options.mask ?? (v => v);
  const train = options.train ?? {};
  const folds = buildInnerFolds(trainRaces, options.innerBlocks ?? DEFAULT_INNER_BLOCKS);

  if (folds.length === 0 || candidates.length === 0) {
    return {
      lambda: fallbackLambda(candidates),
      innerFolds: 0,
      scores: candidates.map(lambda => ({ lambda, logLoss: null }))
    };
  }

  const scores: LambdaScore[] = [];

  for (const lambda of candidates) {
    const collected: RaceLogits[] = [];
    for (const fold of folds) {
      const model = trainWinModel(trainRaces, {
        range: { from: 0, to: fold.validStart },
        lambda,
        mask,
        train
      });
      collected.push(...collectLogits(trainRaces, fold.validStart, fold.validEnd, model, mask));
    }
    const logLoss = winnerLogLoss(collected);
    scores.push({ lambda, logLoss: Number.isFinite(logLoss) ? logLoss : null });
  }

  return { lambda: pickBestLambda(scores, candidates), innerFolds: folds.length, scores };
}

/** 内側検証 log loss が最小の λ（同値なら小さい λ＝弱い正則化を選ばず、先に現れた候補を採る） */
function pickBestLambda(scores: LambdaScore[], candidates: readonly number[]): number {
  let best: LambdaScore | null = null;
  for (const s of scores) {
    if (s.logLoss == null) continue;
    if (best == null || s.logLoss < (best.logLoss ?? Number.POSITIVE_INFINITY)) best = s;
  }
  return best?.lambda ?? fallbackLambda(candidates);
}

/** 内側分割が作れないときの λ（候補列の中央値） */
function fallbackLambda(candidates: readonly number[]): number {
  if (candidates.length === 0) return 1;
  const sorted = [...candidates].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

