/**
 * 市場（オッズ・人気）から勝率を見積もるユーティリティ
 *
 * @remarks
 * ## なぜオッズと人気を分けるのか
 *
 * JRA公式の**過去レース結果ページには全馬の事前単勝オッズが載っていない**。
 * 払戻金から復元できるのは1着馬の確定単勝オッズだけで、
 * それを `race_entries.win_odds` に書いてしまうと
 * 「win_odds が非null ⇔ 勝ち馬」という致命的な look-ahead リークになる。
 *
 * そこで:
 *
 * 1. オッズは **同一レースの全出走馬に揃っている場合のみ** 使う
 *    （`hasCompleteOdds`）。1頭でも欠けていれば、そのレースは
 *    「オッズ情報なし」として全馬同一に扱う。部分的な存在自体が
 *    情報（=結果）になるのを防ぐため。
 * 2. 人気順位（`popularity`）はレース結果ページから**全馬ぶん**取れるので、
 *    市場系特徴量の主軸はこちらにする。
 *
 * 人気順位から確率への変換には、JRAの人気別勝率のおおよその分布
 * （`POPULARITY_WIN_RATES`）を単調変換テーブルとして使い、
 * レース内で合計1に正規化する。
 */

/**
 * 人気順位別の単勝的中率（JRA平均のおおよその分布）
 *
 * @remarks
 * インデックス0が1番人気。18番人気まで。
 * レース内で合計1に正規化して使うため、絶対値そのものの精度は要求されない
 * （必要なのは「人気順に単調減少する」という形）。
 */
export const POPULARITY_WIN_RATES: readonly number[] = [
  0.325, 0.190, 0.130, 0.095, 0.070, 0.052, 0.039, 0.029, 0.022,
  0.016, 0.012, 0.009, 0.007, 0.005, 0.004, 0.003, 0.002, 0.002
];

/** テーブル範囲外の人気に使う下限値 */
const POPULARITY_TAIL_RATE = 0.002;

/**
 * 有効な単勝オッズの下限（倍）
 *
 * @remarks
 * JRAの単勝オッズは 1.0 倍が最低値。0 や負値は「取得できなかった」の意味なので無効扱いにする。
 */
export const MIN_VALID_WIN_ODDS = 1.0;

/** 市場暗黙確率の算出元 */
export type MarketProbSource = 'odds' | 'popularity' | 'uniform';

/** 市場暗黙確率の算出結果 */
export interface MarketProbabilityResult {
  /** 合計1の暗黙勝率（入力と同じ順序・同じ長さ） */
  probabilities: number[];
  /** 何から算出したか */
  source: MarketProbSource;
}

/**
 * レース内の全出走馬に有効な単勝オッズが揃っているか
 *
 * @remarks
 * **これが false のレースではオッズ由来の特徴量を一切使ってはいけない。**
 * 結果ページ由来の確定オッズ（勝ち馬のみ）が混ざっている可能性があり、
 * 「オッズがある馬＝勝ち馬」というリークになるため。
 *
 * @param oddsList - 各馬の単勝オッズ（欠損は null）
 * @returns 2頭以上いて全馬のオッズが有効（>= 1.0）なら true
 *
 * @remarks
 * JRAの単勝オッズの下限は 1.0 倍なので、有効判定は `>= 1.0` にする
 * （`> 1` にすると 1.0 倍の馬が1頭いるだけでレース全体のオッズ特徴が落ちる）。
 */
export function hasCompleteOdds(oddsList: (number | null | undefined)[]): boolean {
  if (oddsList.length < 2) return false;
  return oddsList.every(o => o != null && o >= MIN_VALID_WIN_ODDS);
}

/**
 * 市場の暗黙勝率を計算（控除率補正込み）
 *
 * @remarks
 * 生の暗黙確率 1/オッズ はJRAの控除率（単勝で約20〜25%）ぶんだけ合計が1を超える。
 * レース内で合計1になるよう正規化することで控除率を除去する。
 * オッズ欠損馬は「既知馬の平均」で補完する。
 *
 * 呼び出し側は原則 {@link raceMarketProbabilities} を使うこと。
 * この関数は「全馬にオッズが揃っている」前提の低レベル関数で、
 * 欠損補完はあくまで保険である。
 *
 * @param oddsList - 各馬の単勝オッズ（欠損は null）
 * @returns 合計1の暗黙勝率。全馬欠損なら一様分布
 */
export function marketImpliedProbabilities(oddsList: (number | null | undefined)[]): number[] {
  const n = oddsList.length;
  if (n === 0) return [];

  const raw = oddsList.map(o => (o != null && o >= MIN_VALID_WIN_ODDS ? 1 / o : null));
  const known = raw.filter((v): v is number => v != null);

  if (known.length === 0) {
    return new Array(n).fill(1 / n);
  }

  // 欠損馬には既知馬の平均を割り当ててから全体を正規化する
  const fallback = sum(known) / known.length;
  const filled = raw.map(v => v ?? fallback);
  const total = sum(filled);
  if (total <= 0) return new Array(n).fill(1 / n);
  return filled.map(v => v / total);
}

/** 配列の総和（加算順は配列順のまま） */
function sum(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

/**
 * 人気順位から暗黙勝率を計算
 *
 * @remarks
 * 人気順位 → 勝率の固定テーブル（{@link POPULARITY_WIN_RATES}）を引き、
 * レース内で合計1に正規化する。人気が欠損している馬には
 * 「既知馬に使われなかった順位の平均」ではなく最下位相当の値を割り当てる。
 *
 * @param popularities - 各馬の人気順位（1が1番人気。欠損は null）
 * @returns 合計1の暗黙勝率。全馬欠損なら一様分布
 */
export function popularityImpliedProbabilities(
  popularities: (number | null | undefined)[]
): number[] {
  const n = popularities.length;
  if (n === 0) return [];

  const raw = popularities.map(p =>
    p != null && p >= 1 ? popularityWinRate(Math.round(p)) : null
  );
  if (raw.every(v => v == null)) return new Array(n).fill(1 / n);

  const filled = raw.map(v => v ?? POPULARITY_TAIL_RATE);
  const total = sum(filled);
  if (total <= 0) return new Array(n).fill(1 / n);
  return filled.map(v => v / total);
}

/** 人気順位に対応する勝率（テーブル外は下限値） */
export function popularityWinRate(popularity: number): number {
  if (popularity < 1) return POPULARITY_TAIL_RATE;
  return POPULARITY_WIN_RATES[popularity - 1] ?? POPULARITY_TAIL_RATE;
}

/**
 * レース単位の市場暗黙勝率を、使える情報に応じて算出する
 *
 * @remarks
 * 優先順位:
 * 1. **全馬にオッズが揃っている** → オッズから（控除率は正規化で除去）
 * 2. 人気順位がある → 人気別勝率テーブルから
 * 3. どちらも無い → 一様分布
 *
 * 1頭でもオッズが欠けているレースでオッズを使わないのが要点。
 * 結果ページ由来の確定オッズ（勝ち馬のみ）が混ざったDBでは、
 * それを使った時点でリークになる。
 *
 * @param oddsList - 各馬の単勝オッズ（欠損は null）
 * @param popularities - 各馬の人気順位（欠損は null）
 */
export function raceMarketProbabilities(
  oddsList: (number | null | undefined)[],
  popularities: (number | null | undefined)[]
): MarketProbabilityResult {
  const n = oddsList.length;
  if (n === 0) return { probabilities: [], source: 'uniform' };

  if (hasCompleteOdds(oddsList)) {
    return { probabilities: marketImpliedProbabilities(oddsList), source: 'odds' };
  }

  if (popularities.some(p => p != null && p >= 1)) {
    return { probabilities: popularityImpliedProbabilities(popularities), source: 'popularity' };
  }

  return { probabilities: new Array(n).fill(1 / n), source: 'uniform' };
}
