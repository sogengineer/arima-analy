/**
 * リポジトリ層で使用する型定義
 */

import type { HorseDetail } from './HorseData';

// ============================================
// Query リポジトリ用の戻り値型
// ============================================

/**
 * 馬のレース結果（Query用、拡張版）
 *
 * @remarks
 * DB で NULL を許す列は `null` も取りうる（未確定の着順、未設定のクラスなど）。
 * 「値が無い」を `undefined` と `null` のどちらで受けるかは取得経路によるため、両方を許す。
 */
export interface HorseRaceResult {
  race_id: number;
  race_name: string;
  race_date: string;
  race_class?: string | null;
  distance: number;
  race_type?: string | null;
  track_condition?: string | null;
  venue_name: string;
  jockey_id?: number | null;
  popularity?: number | null;
  finish_position?: number | null;
  finish_time?: string | null;
  last_3f_time?: number | null;
  time_diff_seconds?: number | null;
}

/** コース別成績統計 */
export interface CourseStats {
  horse_id: number;
  venue_id: number;
  venue_name: string;
  race_type: string | null;
  distance_category?: string | null;
  runs: number;
  wins: number;
  places: number;
  shows: number;
  win_rate?: number | null;
  place_rate?: number | null;
}

/** 馬場別成績統計 */
export interface TrackStats {
  horse_id: number;
  race_type: string | null;
  track_condition: string | null;
  runs: number;
  wins: number;
  places: number;
  shows: number;
}

/** 騎手のコース別成績 */
export interface JockeyVenueStats {
  jockey_id: number;
  venue_name: string;
  total_runs: number;
  wins: number;
  places: number;
  shows: number;
  venue_g1_runs: number;
  venue_g1_wins: number;
}

/** 騎手の全体成績 */
export interface JockeyOverallStats {
  jockey_id: number;
  total_runs: number;
  wins: number;
  places: number;
  shows: number;
  g1_runs: number;
  g1_wins: number;
}

/** 騎手・調教師コンビ成績 */
export interface JockeyTrainerComboStats {
  jockey_id: number;
  trainer_id: number;
  total_runs: number;
  wins: number;
  places: number;
  shows: number;
}

// ============================================
// Aggregate リポジトリ用の型
// ============================================

/** トランザクション結果 */
export interface TransactionResult<T = number> {
  id: T;
  updated: boolean;
}

/** 馬登録結果 */
export interface HorseInsertResult extends TransactionResult {
  sireId?: number;
  mareId?: number;
  trainerId?: number;
  ownerId?: number;
  breederId?: number;
}

/** レース登録結果 */
export interface RaceInsertResult extends TransactionResult {
  venueId: number;
}

/** 出馬表登録結果 */
export interface EntryInsertResult extends TransactionResult {
  horseId: number;
  jockeyId: number;
}

/** バッチ処理結果 */
export interface BatchInsertResult {
  insertCount: number;
  updateCount: number;
  errors: string[];
}

/**
 * スコア更新データ（10要素構成）
 *
 * @remarks
 * 専門家会議（2026/01/03）で合意した新しい重み配分に対応。
 * 7要素から10要素に拡張。
 */
export interface ScoreUpdateData {
  // 馬の能力・実績（59%）
  recent_performance_score: number;      // 直近成績
  course_aptitude_score: number;         // コース適性
  distance_aptitude_score: number;       // 距離適性
  last_3f_ability_score: number;         // 上がり3F能力
  // 実績・経験（5%）
  g1_achievement_score: number;          // G1実績
  // コンディション（15%）
  rotation_score: number;                // ローテ適性
  track_condition_score: number;         // 馬場適性
  // 人的要因（16%）
  jockey_score: number;                  // 騎手能力
  trainer_score: number;                 // 調教師
  // 枠順要因（5%）
  post_position_score: number;           // 枠順効果
  // 総合スコア（アプリケーション側で計算）
  total_score: number;
}

// ============================================
// ドメインエンティティ用の型
// ============================================

/**
 * スコアコンポーネント（10要素）
 *
 * @remarks
 * 専門家会議（2026/01/03）で合意した新しい重み配分に対応。
 */
export interface ScoreComponents {
  // 馬の能力・実績（59%）
  recentPerformanceScore: number;        // 直近成績 22%
  venueAptitudeScore: number;            // コース適性 15%
  distanceAptitudeScore: number;         // 距離適性 12%
  last3FAbilityScore: number;            // 上がり3F能力 10%
  // 実績・経験（5%）
  g1AchievementScore: number;            // G1実績 5%
  // コンディション（15%）
  rotationAptitudeScore: number;         // ローテ適性 10%
  trackConditionScore: number;           // 馬場適性 5%（新規）
  // 人的要因（16%）
  jockeyScore: number;                   // 騎手能力 8%
  trainerScore: number;                  // 調教師 8%（新規）
  // 枠順要因（5%）
  postPositionScore: number;             // 枠順効果 5%（新規）
}

/** 馬スコア（総合スコア付き） */
export interface HorseScore extends ScoreComponents {
  horseId: number;
  horseName: string;
  horseNumber?: number;
  totalScore: number;
}

/** レース情報（ドメイン用） */
export interface RaceContext {
  id: number;
  name: string;
  venue: string;
  distance: number;
  raceType: string;
  date: string;
}

// ============================================
// 型ガードとヘルパー
// ============================================

/** 型ガード: 着順が有効か */
export function isValidFinishPosition(position: unknown): position is number {
  return typeof position === 'number' && position >= 1;
}

/** 型ガード: 勝利か */
export function isWin(position: number | null | undefined): boolean {
  return position === 1;
}

/** 型ガード: 連対か */
export function isPlace(position: number | null | undefined): boolean {
  return position !== null && position !== undefined && position <= 2;
}

/** 型ガード: 複勝圏内か */
export function isShow(position: number | null | undefined): boolean {
  return position !== null && position !== undefined && position <= 3;
}

// エクスポート（既存の型を再エクスポート）
export type { HorseDetail };
