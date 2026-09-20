/**
 * 1頭分の特徴量の組み立て
 *
 * @remarks
 * `FeatureBuilder.ts` から切り出したファイル。レース単位で先に計算した
 * {@link RaceFeatureContext}（市場・馬体重・ルールスコアのレース内相対値）を受け取り、
 * 出走1頭ぶんの {@link MLFeatures} を領域ごとに組み立てる。
 * 取得（SQL）は行わない。
 */

import type { EntryWithDetailsRow } from '../repositories/queries/RaceQueryRepository';
import type { PreviousRaceRow } from '../repositories/queries/HorseQueryRepository';
import type { ScoreComponents } from '../domain/valueObjects/ScoreComponents';
import { MS_PER_DAY } from '../constants/DistanceConstants';
import type { MarketProbSource } from './MarketProbability';
import {
  ASSIGNED_WEIGHT_BASE,
  LAST_3F_BASE_SECONDS,
  emptyRuleScores,
  toVector,
  type HorseFeatureRow,
  type MLFeatures
} from './featureSpec';

/** 前走なしの馬に使う前走頭数の既定値 */
const DEFAULT_PREV_FIELD_SIZE = 16;

/**
 * レース単位で先に計算しておく、各馬の特徴量に共通の材料
 *
 * @remarks
 * 配列はいずれも出走エントリと同じ並び・同じ長さ。添字で引く。
 */
export interface RaceFeatureContext {
  ruleMap: Map<number, ScoreComponents>;
  prevMap: Map<number, PreviousRaceRow>;
  payoutOddsMap: Map<number, number>;
  /** 特徴量に使う単勝オッズ（レース内に欠損があれば全馬 null） */
  oddsList: (number | null)[];
  popularities: (number | null)[];
  impliedProbs: number[];
  oddsRanks: number[];
  oddsUsable: boolean;
  marketProbSource: MarketProbSource;
  weightMean: number;
  weightSd: number;
  assignedZ: number[];
  ruleTotals: number[];
  ruleZ: number[];
  ruleRanks: number[];
  fieldSize: number;
  fieldSizeLog: number;
  /** as-of 基準日のエポックミリ秒 */
  cutoffTime: number;
}

/** 市場系（オッズ・人気） */
function marketFeatures(
  index: number,
  context: RaceFeatureContext
): Pick<
  MLFeatures,
  | 'winOdds'
  | 'logWinOdds'
  | 'marketImpliedProb'
  | 'oddsRankNorm'
  | 'popularityNorm'
  | 'hasPopularity'
  | 'hasMarketOdds'
  | 'marketProbSource'
> {
  const winOdds = context.oddsList[index];
  const popularity = context.popularities[index];
  const usablePopularity = popularity != null && context.fieldSize > 1;

  return {
    winOdds,
    logWinOdds: winOdds == null ? 0 : Math.log(winOdds),
    marketImpliedProb: context.impliedProbs[index],
    oddsRankNorm: context.oddsRanks[index],
    popularityNorm: usablePopularity
      ? Math.min(1, Math.max(0, (popularity - 1) / (context.fieldSize - 1)))
      : 0.5,
    hasPopularity: popularity == null ? 0 : 1,
    hasMarketOdds: context.oddsUsable ? 1 : 0,
    marketProbSource: context.marketProbSource
  };
}

/** 馬体・斤量 */
function physicalFeatures(
  entry: EntryWithDetailsRow,
  index: number,
  context: RaceFeatureContext
): Pick<
  MLFeatures,
  'horseWeightZ' | 'weightChange' | 'assignedWeightRel' | 'assignedWeightZ' | 'hasHorseWeight'
> {
  const horseWeight = entry.horse_weight;
  const hasWeight = horseWeight != null && context.weightSd > 0;

  return {
    horseWeightZ: hasWeight ? (horseWeight - context.weightMean) / context.weightSd : 0,
    weightChange: entry.weight_change ?? 0,
    assignedWeightRel: (entry.assigned_weight ?? ASSIGNED_WEIGHT_BASE) - ASSIGNED_WEIGHT_BASE,
    assignedWeightZ: context.assignedZ[index],
    hasHorseWeight: entry.horse_weight == null ? 0 : 1
  };
}

/** 通算成績（そのレースより前に確定した値） */
function careerFeatures(
  entry: EntryWithDetailsRow
): Pick<MLFeatures, 'careerRunsLog' | 'careerWinRate' | 'careerShowRate'> {
  const careerRuns = entry.career_runs ?? 0;
  const careerWins = entry.career_wins ?? 0;
  const careerShows =
    (entry.career_wins ?? 0) + (entry.career_places ?? 0) + (entry.career_shows ?? 0);

  return {
    careerRunsLog: Math.log1p(careerRuns),
    careerWinRate: careerRuns > 0 ? careerWins / careerRuns : 0,
    careerShowRate: careerRuns > 0 ? careerShows / careerRuns : 0
  };
}

/** 前走系（as-of） */
function previousRaceFeatures(
  prev: PreviousRaceRow | undefined,
  cutoffTime: number
): Pick<
  MLFeatures,
  | 'hasPrevRace'
  | 'prevFinishInv'
  | 'prevFinishRel'
  | 'prevLast3fRel'
  | 'prevMarginSeconds'
  | 'daysSincePrevLog'
> {
  if (!prev) {
    return {
      hasPrevRace: 0,
      prevFinishInv: 0,
      prevFinishRel: 0.5,
      prevLast3fRel: 0,
      prevMarginSeconds: 0,
      daysSincePrevLog: 0
    };
  }

  const prevFieldSize = prev.total_horses ?? DEFAULT_PREV_FIELD_SIZE;
  const daysSincePrev = Math.max(
    0,
    Math.floor((cutoffTime - new Date(prev.race_date).getTime()) / MS_PER_DAY)
  );

  return {
    hasPrevRace: 1,
    prevFinishInv: 1 / prev.finish_position,
    prevFinishRel: Math.min(
      1,
      Math.max(0, (prev.finish_position - 1) / Math.max(1, prevFieldSize - 1))
    ),
    prevLast3fRel: prev.last_3f_time == null ? 0 : prev.last_3f_time - LAST_3F_BASE_SECONDS,
    prevMarginSeconds: prev.margin_seconds ?? 0,
    daysSincePrevLog: Math.log1p(daysSincePrev)
  };
}

/** レース内相対化（頭数・ルールベース総合スコア） */
function relativeFeatures(
  index: number,
  context: RaceFeatureContext
): Pick<MLFeatures, 'fieldSizeLog' | 'ruleTotalScore' | 'ruleTotalZ' | 'ruleTotalRankNorm'> {
  return {
    fieldSizeLog: context.fieldSizeLog,
    ruleTotalScore: context.ruleTotals[index] / 100,
    ruleTotalZ: context.ruleZ[index],
    ruleTotalRankNorm: context.ruleRanks[index]
  };
}

/**
 * 出走1頭ぶんの特徴量行を組み立てる
 *
 * @param entry - 出走エントリ
 * @param index - レース内での添字（context の各配列と対応）
 * @param context - レース単位で先に計算した材料
 */
export function buildHorseFeatureRow(
  entry: EntryWithDetailsRow,
  index: number,
  context: RaceFeatureContext
): HorseFeatureRow {
  const scores = context.ruleMap.get(entry.horse_id);

  const features: MLFeatures = {
    ...marketFeatures(index, context),
    ...physicalFeatures(entry, index, context),
    ...careerFeatures(entry),
    ...previousRaceFeatures(context.prevMap.get(entry.horse_id), context.cutoffTime),
    ...relativeFeatures(index, context),
    ruleScores: scores ? scores.toPlainObject() : emptyRuleScores()
  };

  return {
    horseId: entry.horse_id,
    horseName: entry.horse_name,
    horseNumber: entry.horse_number,
    features,
    vector: toVector(features),
    payoutWinOdds: context.payoutOddsMap.get(entry.horse_id) ?? features.winOdds
  };
}
