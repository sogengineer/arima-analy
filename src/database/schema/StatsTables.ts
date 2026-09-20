/**
 * 集計・分析用テーブルの Kysely 行型
 * （bloodline_stats / horse_course_stats / horse_track_stats / jockey_trainer_stats / horse_scores）
 *
 * @remarks
 * `src/database/schema.sql` を正として手書きする。
 * `win_rate` / `place_rate` / `show_rate` は SQLite の GENERATED ALWAYS ... STORED 列なので、
 * INSERT / UPDATE では一切指定できない。これを型で示すために `GeneratedAlways<>` を使う
 * （`Generated<>` にすると「省略できる書き込み可能列」の意味になり、実際には失敗する INSERT が通ってしまう）。
 */

import type { Generated, GeneratedAlways } from 'kysely';
import type { ColumnNames } from './ColumnNames';

/** 血統傾向集計 */
export interface BloodlineStatsTable {
  id: Generated<number>;
  sire_id: number;
  race_type: string | null;
  distance_category: string | null;
  track_condition: string | null;
  runs: Generated<number>;
  wins: Generated<number>;
  places: Generated<number>;
  shows: Generated<number>;
  win_rate: GeneratedAlways<number>;
  place_rate: GeneratedAlways<number>;
  show_rate: GeneratedAlways<number>;
  updated_at: Generated<string>;
}

/** 馬別コース適性集計 */
export interface HorseCourseStatsTable {
  id: Generated<number>;
  horse_id: number;
  venue_id: number;
  race_type: string | null;
  distance_category: string | null;
  runs: Generated<number>;
  wins: Generated<number>;
  places: Generated<number>;
  shows: Generated<number>;
  avg_finish_position: number | null;
  avg_last_3f_time: number | null;
  updated_at: Generated<string>;
}

/** 馬別馬場適性集計 */
export interface HorseTrackStatsTable {
  id: Generated<number>;
  horse_id: number;
  race_type: string | null;
  track_condition: string | null;
  runs: Generated<number>;
  wins: Generated<number>;
  places: Generated<number>;
  shows: Generated<number>;
  avg_finish_position: number | null;
  updated_at: Generated<string>;
}

/** 騎手・調教師コンビ成績 */
export interface JockeyTrainerStatsTable {
  id: Generated<number>;
  jockey_id: number;
  trainer_id: number;
  runs: Generated<number>;
  wins: Generated<number>;
  places: Generated<number>;
  shows: Generated<number>;
  win_rate: GeneratedAlways<number>;
  updated_at: Generated<string>;
}

/**
 * 馬スコア（10要素構成）
 *
 * @remarks
 * 重み配分の正は `src/constants/ScoringConstants.ts`。この表は保存先の形だけを表す。
 */
export interface HorseScoresTable {
  id: Generated<number>;
  horse_id: number;
  race_id: number | null;
  recent_performance_score: Generated<number>;
  course_aptitude_score: Generated<number>;
  distance_aptitude_score: Generated<number>;
  last_3f_ability_score: Generated<number>;
  g1_achievement_score: Generated<number>;
  rotation_score: Generated<number>;
  track_condition_score: Generated<number>;
  jockey_score: Generated<number>;
  trainer_score: Generated<number>;
  post_position_score: Generated<number>;
  total_score: Generated<number>;
  created_at: Generated<string>;
}

export const BLOODLINE_STATS_COLUMNS: ColumnNames<BloodlineStatsTable> = {
  id: true,
  sire_id: true,
  race_type: true,
  distance_category: true,
  track_condition: true,
  runs: true,
  wins: true,
  places: true,
  shows: true,
  win_rate: true,
  place_rate: true,
  show_rate: true,
  updated_at: true
};

export const HORSE_COURSE_STATS_COLUMNS: ColumnNames<HorseCourseStatsTable> = {
  id: true,
  horse_id: true,
  venue_id: true,
  race_type: true,
  distance_category: true,
  runs: true,
  wins: true,
  places: true,
  shows: true,
  avg_finish_position: true,
  avg_last_3f_time: true,
  updated_at: true
};

export const HORSE_TRACK_STATS_COLUMNS: ColumnNames<HorseTrackStatsTable> = {
  id: true,
  horse_id: true,
  race_type: true,
  track_condition: true,
  runs: true,
  wins: true,
  places: true,
  shows: true,
  avg_finish_position: true,
  updated_at: true
};

export const JOCKEY_TRAINER_STATS_COLUMNS: ColumnNames<JockeyTrainerStatsTable> = {
  id: true,
  jockey_id: true,
  trainer_id: true,
  runs: true,
  wins: true,
  places: true,
  shows: true,
  win_rate: true,
  updated_at: true
};

export const HORSE_SCORES_COLUMNS: ColumnNames<HorseScoresTable> = {
  id: true,
  horse_id: true,
  race_id: true,
  recent_performance_score: true,
  course_aptitude_score: true,
  distance_aptitude_score: true,
  last_3f_ability_score: true,
  g1_achievement_score: true,
  rotation_score: true,
  track_condition_score: true,
  jockey_score: true,
  trainer_score: true,
  post_position_score: true,
  total_score: true,
  created_at: true
};
