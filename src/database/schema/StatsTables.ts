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
  id: { nullable: false, generated: 'default' },
  sire_id: { nullable: false, generated: 'no' },
  race_type: { nullable: true, generated: 'no' },
  distance_category: { nullable: true, generated: 'no' },
  track_condition: { nullable: true, generated: 'no' },
  runs: { nullable: false, generated: 'default' },
  wins: { nullable: false, generated: 'default' },
  places: { nullable: false, generated: 'default' },
  shows: { nullable: false, generated: 'default' },
  win_rate: { nullable: false, generated: 'always' },
  place_rate: { nullable: false, generated: 'always' },
  show_rate: { nullable: false, generated: 'always' },
  updated_at: { nullable: false, generated: 'default' }
};

export const HORSE_COURSE_STATS_COLUMNS: ColumnNames<HorseCourseStatsTable> = {
  id: { nullable: false, generated: 'default' },
  horse_id: { nullable: false, generated: 'no' },
  venue_id: { nullable: false, generated: 'no' },
  race_type: { nullable: true, generated: 'no' },
  distance_category: { nullable: true, generated: 'no' },
  runs: { nullable: false, generated: 'default' },
  wins: { nullable: false, generated: 'default' },
  places: { nullable: false, generated: 'default' },
  shows: { nullable: false, generated: 'default' },
  avg_finish_position: { nullable: true, generated: 'no' },
  avg_last_3f_time: { nullable: true, generated: 'no' },
  updated_at: { nullable: false, generated: 'default' }
};

export const HORSE_TRACK_STATS_COLUMNS: ColumnNames<HorseTrackStatsTable> = {
  id: { nullable: false, generated: 'default' },
  horse_id: { nullable: false, generated: 'no' },
  race_type: { nullable: true, generated: 'no' },
  track_condition: { nullable: true, generated: 'no' },
  runs: { nullable: false, generated: 'default' },
  wins: { nullable: false, generated: 'default' },
  places: { nullable: false, generated: 'default' },
  shows: { nullable: false, generated: 'default' },
  avg_finish_position: { nullable: true, generated: 'no' },
  updated_at: { nullable: false, generated: 'default' }
};

export const JOCKEY_TRAINER_STATS_COLUMNS: ColumnNames<JockeyTrainerStatsTable> = {
  id: { nullable: false, generated: 'default' },
  jockey_id: { nullable: false, generated: 'no' },
  trainer_id: { nullable: false, generated: 'no' },
  runs: { nullable: false, generated: 'default' },
  wins: { nullable: false, generated: 'default' },
  places: { nullable: false, generated: 'default' },
  shows: { nullable: false, generated: 'default' },
  win_rate: { nullable: false, generated: 'always' },
  updated_at: { nullable: false, generated: 'default' }
};

export const HORSE_SCORES_COLUMNS: ColumnNames<HorseScoresTable> = {
  id: { nullable: false, generated: 'default' },
  horse_id: { nullable: false, generated: 'no' },
  race_id: { nullable: true, generated: 'no' },
  recent_performance_score: { nullable: false, generated: 'default' },
  course_aptitude_score: { nullable: false, generated: 'default' },
  distance_aptitude_score: { nullable: false, generated: 'default' },
  last_3f_ability_score: { nullable: false, generated: 'default' },
  g1_achievement_score: { nullable: false, generated: 'default' },
  rotation_score: { nullable: false, generated: 'default' },
  track_condition_score: { nullable: false, generated: 'default' },
  jockey_score: { nullable: false, generated: 'default' },
  trainer_score: { nullable: false, generated: 'default' },
  post_position_score: { nullable: false, generated: 'default' },
  total_score: { nullable: false, generated: 'default' },
  created_at: { nullable: false, generated: 'default' }
};
