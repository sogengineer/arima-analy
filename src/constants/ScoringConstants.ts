/**
 * スコアリング関連の定数
 * ScoreCommand.ts の値を正として採用
 */

/**
 * 総合スコアの10要素の重み配分
 *
 * @remarks
 * 専門家会議（2026/01/03）の議論を経て、7要素→10要素に拡張。
 * - 騎手: 15%→8% (G1では差がつきにくい)
 * - 上がり3F: 7%→10% (末脚勝負の重要性)
 * - 馬場適性: 新規5% (道悪対応)
 * - 枠順効果: 新規5% (中山2500m内枠有利)
 * - 調教師: 新規8% (厩舎力の反映)
 */
export const SCORE_WEIGHTS = {
  recentPerformance: 0.22,    // 直近成績 22%
  venueAptitude: 0.15,        // コース適性 15%
  distanceAptitude: 0.12,     // 距離適性 12%
  last3FAbility: 0.10,        // 上がり3F能力 10%
  g1Achievement: 0.05,        // G1実績 5%
  rotationAptitude: 0.10,     // ローテ適性 10%
  jockey: 0.08,               // 騎手能力 8%
  trackCondition: 0.05,       // 馬場適性 5%（新規）
  postPosition: 0.05,         // 枠順効果 5%（新規）
  trainer: 0.08               // 調教師 8%（新規）
} as const;

/** 直近5戦の重み（新しいレースほど高い） */
export const RECENT_RACE_WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08] as const;

/** 着順スコア */
export const POSITION_SCORES: Record<number | 'default', number> = {
  1: 100,
  2: 80,
  3: 65,
  4: 45,
  5: 45,
  6: 25,
  7: 25,
  8: 25,
  default: 10
} as const;

/** 着順スコアを取得するヘルパー */
export function getPositionScore(position: number): number {
  if (position >= 1 && position <= 8) {
    return POSITION_SCORES[position as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8];
  }
  return POSITION_SCORES.default;
}

/** 騎手スコアの内部構成重み */
export const JOCKEY_SCORE_WEIGHTS = {
  venueWinRate: 0.30,      // コース勝率 30%
  venueG1WinRate: 0.30,    // コースG1勝率 30%
  overallWinRate: 0.20,    // 全体勝率 20%
  trainerCombo: 0.20       // 調教師コンビ勝率 20%
} as const;

/** 人気差補正の係数 */
export const POPULARITY_DIFF_FACTOR = 3;
export const POPULARITY_DIFF_MAX = 100;

/** G1着順スコア */
export const G1_POSITION_SCORES: Record<number | 'default', number> = {
  1: 40,
  2: 25,
  3: 18,
  4: 10,
  5: 10,
  default: 3
} as const;

/** G1着順スコアを取得するヘルパー */
export function getG1PositionScore(position: number): number {
  if (position >= 1 && position <= 5) {
    return G1_POSITION_SCORES[position as 1 | 2 | 3 | 4 | 5];
  }
  return G1_POSITION_SCORES.default;
}

/** G1実績がない場合のデフォルトスコア */
export const G1_DEFAULT_SCORE = 30;

/** 上がり3F計算のパラメータ */
export const LAST_3F_PARAMS = {
  baseTime: 37,           // 基準時間（秒）
  divisor: 4,             // 分母
  noDataBaseScore: 20,    // 上がり3Fデータがない場合のベーススコア
  noDataMultiplier: 80    // 複勝率にかける係数
} as const;

/** スコア分布の判定基準 */
export const SCORE_RANGES = {
  strong: { min: 70, max: 100, label: '有力候補 (70点以上)' },
  notable: { min: 55, max: 69.99, label: '注目馬 (55-70点)' },
  normal: { min: 40, max: 54.99, label: '一般馬 (40-55点)' },
  weak: { min: 0, max: 39.99, label: '厳しい (40点未満)' }
} as const;

/** 信頼度補正の閾値 */
export const RELIABILITY_THRESHOLDS = {
  /** 騎手の出走数閾値 */
  jockeyRuns: {
    full: 50,     // 完全信頼
    high: 20,     // 高信頼
    medium: 10    // 中信頼
  },
  /** 騎手のG1出走数閾値 */
  jockeyG1Runs: {
    full: 10,     // 完全信頼
    high: 5       // 高信頼
  },
  /** 馬の実績数閾値 */
  horseRuns: {
    full: 5,      // 完全信頼
    high: 3,      // 高信頼
    medium: 2     // 中信頼
  },
  /** 調教師コンビの最小出走数 */
  trainerComboMinRuns: 3
} as const;

/** 信頼度補正係数 */
export const RELIABILITY_FACTORS = {
  full: 1.0,
  high: 0.9,
  medium: 0.8,
  low: 0.6,
  g1Low: 0.7
} as const;

/** 信頼度係数を取得するヘルパー（馬の実績用） */
export function getHorseReliabilityFactor(runs: number): number {
  const t = RELIABILITY_THRESHOLDS.horseRuns;
  const f = RELIABILITY_FACTORS;
  if (runs >= t.full) return f.full;
  if (runs >= t.high) return f.high;
  if (runs >= t.medium) return f.medium;
  return f.low;
}

/** 信頼度係数を取得するヘルパー（騎手の出走数用） */
export function getJockeyReliabilityFactor(runs: number): number {
  const t = RELIABILITY_THRESHOLDS.jockeyRuns;
  const f = RELIABILITY_FACTORS;
  if (runs >= t.full) return f.full;
  if (runs >= t.high) return f.high;
  if (runs >= t.medium) return f.medium;
  return f.low;
}

/** 信頼度係数を取得するヘルパー（騎手のG1出走数用） */
export function getJockeyG1ReliabilityFactor(runs: number): number {
  const t = RELIABILITY_THRESHOLDS.jockeyG1Runs;
  const f = RELIABILITY_FACTORS;
  if (runs >= t.full) return f.full;
  if (runs >= t.high) return f.high;
  return f.g1Low;
}

/** コース適性スコアの重み */
export const VENUE_APTITUDE_WEIGHTS = {
  winRate: 60,
  placeRate: 40
} as const;

/** 距離適性スコアの重み */
export const DISTANCE_APTITUDE_WEIGHTS = {
  winRate: 60,
  placeRate: 40,
  exactDistanceBonus: 10   // 同距離実績のボーナス
} as const;

/**
 * 枠順スコア（中山2500m用）
 *
 * @remarks
 * 内枠有利のコース特性を反映。
 * 過去20年のデータで内枠（1〜4枠）の勝率は外枠の約1.5倍。
 */
export const POST_POSITION_SCORES: Record<number | 'default', number> = {
  1: 100,   // 1枠：最有利
  2: 95,
  3: 90,
  4: 85,
  5: 70,    // 5枠以降は不利
  6: 65,
  7: 60,
  8: 55,    // 8枠：最不利
  default: 50  // 枠不明の場合
} as const;

/** 枠順スコアを取得するヘルパー */
export function getPostPositionScore(position: number): number {
  if (position >= 1 && position <= 8) {
    return POST_POSITION_SCORES[position as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8];
  }
  return POST_POSITION_SCORES.default;
}

/**
 * 調教師スコアの内部構成重み
 *
 * @remarks
 * G1勝率を重視しつつ、重賞全体の勝率も考慮。
 */
export const TRAINER_SCORE_WEIGHTS = {
  g1WinRate: 0.60,      // G1勝率 60%
  gradeWinRate: 0.40    // 重賞勝率 40%
} as const;

/**
 * 馬場適性スコアの重み
 *
 * @remarks
 * コース適性と同様の計算方法を採用。
 */
export const TRACK_CONDITION_WEIGHTS = {
  winRate: 60,
  placeRate: 40
} as const;

/** 馬場適性データなしの場合のデフォルトスコア */
export const TRACK_CONDITION_DEFAULT_SCORE = 50;
