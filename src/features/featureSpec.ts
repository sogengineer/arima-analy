/**
 * ML 特徴量の型・ベクトル仕様
 *
 * @remarks
 * `FeatureBuilder.ts` から切り出したファイル。特徴量の名前とベクトル化の対応
 * （`FEATURE_SPECS`）を1箇所に集め、組み立て処理（`FeatureBuilder`）と分ける。
 * 公開経路は従来どおり `FeatureBuilder.ts` からの再エクスポート。
 */

import type { ScoreComponentsData } from '../domain/valueObjects/ScoreComponents';
import type { MarketProbSource } from './MarketProbability';

/** 上がり3Fの基準タイム（秒）— 相対化の原点 */
export const LAST_3F_BASE_SECONDS = 36.0;

/** 斤量の基準（kg）— 相対化の原点 */
export const ASSIGNED_WEIGHT_BASE = 55.0;

/** 馬体重の基準（kg）— 標準偏差が0のときのフォールバック用 */
export const HORSE_WEIGHT_BASE = 470;

/**
 * ML 特徴量
 *
 * @remarks
 * ルールベースの `ScoreComponentsData` からは独立した型。
 * 10要素は `ruleScores` に「派生特徴」として内包する。
 */
export interface MLFeatures {
  // ---- 市場系 ----
  /**
   * 単勝オッズ（ベクトル化はされない生値）
   *
   * @remarks
   * **レース内の全出走馬にオッズが揃っている場合のみ** 値が入る。
   * 1頭でも欠けていればレース全馬 null（リーク防止）。
   */
  winOdds: number | null;
  /** log(単勝オッズ)。オッズ不使用レースでは全馬0（定数） */
  logWinOdds: number;
  /**
   * 控除率補正済み（レース内で和が1になるよう正規化した）暗黙勝率
   *
   * @remarks
   * 全馬オッズありならオッズから、無ければ人気別勝率テーブルから算出する。
   */
  marketImpliedProb: number;
  /** レース内オッズ順位（0=最低オッズ=1番人気側, 1=最高オッズ）。オッズ不使用時は全馬0.5 */
  oddsRankNorm: number;
  /** 人気の正規化（0=1番人気, 1=最低人気）。欠損時は0.5 */
  popularityNorm: number;
  /** 人気順位が存在したか */
  hasPopularity: number;
  /** そのレースでオッズを特徴量として使ったか（レース内で定数） */
  hasMarketOdds: number;
  /** 市場暗黙勝率の算出元（ベクトル化はされない） */
  marketProbSource: MarketProbSource;

  // ---- 馬体・斤量 ----
  /** 馬体重のレース内 z-score。欠損時0 */
  horseWeightZ: number;
  /** 前走からの馬体重増減（kg）。欠損時0 */
  weightChange: number;
  /** 斤量（基準55kgからの差） */
  assignedWeightRel: number;
  /** 斤量のレース内 z-score */
  assignedWeightZ: number;
  /** 馬体重データが存在したか */
  hasHorseWeight: number;

  // ---- 通算成績（race_entries.career_*、そのレースより前の成績） ----
  //
  // 書き込み経路は出馬表インポート（`ImportData`）。JRA成績表記 (1着.2着.3着.着外) から
  // runs = 4項目の合計（出走数） / wins = 1着 / places = 2着 / shows = 3着 を書く。
  // いずれも「そのレースより前に確定した値」であることが前提（未来の結果は入れない）。
  // 値が無いレースでは NULL のままになる（欠損として扱う）。
  /** log1p(通算出走数) */
  careerRunsLog: number;
  /** 通算勝率 */
  careerWinRate: number;
  /** 通算複勝率（3着以内率） */
  careerShowRate: number;

  // ---- 前走系（as-of） ----
  /** 前走が存在したか */
  hasPrevRace: number;
  /** 1/前走着順（1着=1.0、着外ほど0に近い）。前走なしは0 */
  prevFinishInv: number;
  /** 前走着順の頭数正規化（0=1着, 1=最下位）。前走なしは0.5 */
  prevFinishRel: number;
  /** 前走上がり3F（基準36秒との差、速いほど負）。欠損時0 */
  prevLast3fRel: number;
  /** 前走の着差（秒）。欠損時0 */
  prevMarginSeconds: number;
  /** log1p(前走からの日数)。前走なしは0 */
  daysSincePrevLog: number;

  // ---- レース内相対化 ----
  /** log(出走頭数) */
  fieldSizeLog: number;
  /** ルールベース総合スコア（0-1に正規化） */
  ruleTotalScore: number;
  /** ルールベース総合スコアのレース内 z-score */
  ruleTotalZ: number;
  /** ルールベース総合スコアのレース内順位（0=最上位, 1=最下位） */
  ruleTotalRankNorm: number;

  // ---- ルールベース10要素（派生特徴・説明用） ----
  ruleScores: ScoreComponentsData;
}

/** 1頭分の特徴量行 */
export interface HorseFeatureRow {
  horseId: number;
  horseName: string;
  horseNumber?: number;
  features: MLFeatures;
  /** 数値ベクトル（`FEATURE_NAMES` と同じ順序・同じ長さ） */
  vector: number[];
  /** 払戻計算用の確定オッズ（final_win_odds ?? win_odds）。特徴量には使わない */
  payoutWinOdds: number | null;
}

/** レース単位の特徴量セット */
export interface RaceFeatureSet {
  raceId: number;
  raceName: string;
  raceDate: string;
  venue: string;
  /** 実際に使った as-of 基準日 */
  asOf: string;
  /** 市場暗黙勝率の算出元（オッズ / 人気順位 / 一様） */
  marketProbSource: MarketProbSource;
  rows: HorseFeatureRow[];
}

/** 特徴量スペック（名前とベクトル化の対応を1箇所で定義） */
interface FeatureSpec {
  name: string;
  extract: (f: MLFeatures) => number;
}

/**
 * 特徴量スペック表
 *
 * @remarks
 * `FEATURE_NAMES` と `toVector()` はどちらもこの表から導出するため、
 * 名前と値の順序がズレることが原理的に起きない。
 */
const FEATURE_SPECS: FeatureSpec[] = [
  { name: '人気', extract: f => f.popularityNorm },
  { name: '人気有無', extract: f => f.hasPopularity },
  { name: '市場暗黙勝率', extract: f => f.marketImpliedProb },
  { name: 'log単勝オッズ', extract: f => f.logWinOdds },
  { name: 'オッズ順位', extract: f => f.oddsRankNorm },
  { name: 'オッズ有無', extract: f => f.hasMarketOdds },
  { name: '馬体重z', extract: f => f.horseWeightZ },
  { name: '馬体重増減', extract: f => f.weightChange },
  { name: '斤量相対', extract: f => f.assignedWeightRel },
  { name: '斤量z', extract: f => f.assignedWeightZ },
  { name: '馬体重有無', extract: f => f.hasHorseWeight },
  { name: 'log通算出走', extract: f => f.careerRunsLog },
  { name: '通算勝率', extract: f => f.careerWinRate },
  { name: '通算複勝率', extract: f => f.careerShowRate },
  { name: '前走有無', extract: f => f.hasPrevRace },
  { name: '前走着順逆数', extract: f => f.prevFinishInv },
  { name: '前走着順相対', extract: f => f.prevFinishRel },
  { name: '前走上がり3F', extract: f => f.prevLast3fRel },
  { name: '前走着差', extract: f => f.prevMarginSeconds },
  { name: 'log前走間隔', extract: f => f.daysSincePrevLog },
  { name: 'log出走頭数', extract: f => f.fieldSizeLog },
  { name: 'ルール総合', extract: f => f.ruleTotalScore },
  { name: 'ルール総合z', extract: f => f.ruleTotalZ },
  { name: 'ルール総合順位', extract: f => f.ruleTotalRankNorm },
  // ルールベース10要素（派生特徴）
  { name: 'R:直近成績', extract: f => f.ruleScores.recentPerformanceScore / 100 },
  { name: 'R:コース適性', extract: f => f.ruleScores.venueAptitudeScore / 100 },
  { name: 'R:距離適性', extract: f => f.ruleScores.distanceAptitudeScore / 100 },
  { name: 'R:上がり3F', extract: f => f.ruleScores.last3FAbilityScore / 100 },
  { name: 'R:G1実績', extract: f => f.ruleScores.g1AchievementScore / 100 },
  { name: 'R:ローテ適性', extract: f => f.ruleScores.rotationAptitudeScore / 100 },
  { name: 'R:騎手能力', extract: f => f.ruleScores.jockeyScore / 100 },
  { name: 'R:馬場適性', extract: f => f.ruleScores.trackConditionScore / 100 },
  { name: 'R:枠順効果', extract: f => f.ruleScores.postPositionScore / 100 },
  { name: 'R:調教師', extract: f => f.ruleScores.trainerScore / 100 }
];

/** 特徴量名（ベクトルと同じ順序） */
export const FEATURE_NAMES: string[] = FEATURE_SPECS.map(s => s.name);

/**
 * 市場（人気・オッズ）由来の特徴量名
 *
 * @remarks
 * 採用ゲート①のベースライン「市場情報のみで学習した同型モデル」が使う特徴量。
 * ここに挙げたもの **以外** をゼロにしたベクトルで学習すると、
 * 「人気別勝率の固定テーブル」ではなく「同じ市場情報をデータから学習したモデル」
 * をベースラインにできる（固定テーブル相手の勝利は自明なので意味が薄い）。
 */
export const MARKET_FEATURE_NAMES: readonly string[] = [
  '人気',
  '人気有無',
  '市場暗黙勝率',
  'log単勝オッズ',
  'オッズ順位',
  'オッズ有無'
];

/** 市場由来特徴量のベクトル内インデックス */
export const MARKET_FEATURE_INDICES: readonly number[] = FEATURE_NAMES.map((n, i) =>
  MARKET_FEATURE_NAMES.includes(n) ? i : -1
).filter(i => i >= 0);

/** 特徴量の次元数 */
export const FEATURE_DIMENSION = FEATURE_SPECS.length;

/** MLFeatures を数値ベクトルへ変換 */
export function toVector(features: MLFeatures): number[] {
  return FEATURE_SPECS.map(spec => {
    const value = spec.extract(features);
    return Number.isFinite(value) ? value : 0;
  });
}

/** ルールスコアが取得できなかった場合のゼロ値 */
export function emptyRuleScores(): ScoreComponentsData {
  return {
    recentPerformanceScore: 0,
    venueAptitudeScore: 0,
    distanceAptitudeScore: 0,
    last3FAbilityScore: 0,
    g1AchievementScore: 0,
    rotationAptitudeScore: 0,
    jockeyScore: 0,
    trackConditionScore: 0,
    postPositionScore: 0,
    trainerScore: 0
  };
}
