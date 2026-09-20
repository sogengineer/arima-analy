/**
 * コアテーブルの Kysely 行型（horses / races / race_entries / race_results）
 *
 * @remarks
 * `src/database/schema.sql` を正として手書きする。列名は SQLite のまま snake_case で保つ。
 * `races.updated_at` だけは DEFAULT を持たない（追加型マイグレーションで後から足した列）ため
 * `Generated<>` にせず `string | null` にしている。
 */

import type { Generated } from 'kysely';
import type { ColumnNames } from './ColumnNames';

/** 競走馬（血統情報含む） */
export interface HorsesTable {
  id: Generated<number>;
  name: string;
  birth_year: number | null;
  sex: '牡' | '牝' | '騸' | null;
  coat_color: string | null;
  sire_id: number | null;
  mare_id: number | null;
  trainer_id: number | null;
  owner_id: number | null;
  breeder_id: number | null;
  /** 血統登録番号。同名馬を区別する唯一のキー（NULL 可の部分ユニークインデックス） */
  jra_horse_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

/** レースマスタ */
export interface RacesTable {
  id: Generated<number>;
  race_date: string;
  venue_id: number;
  race_number: number | null;
  race_name: string;
  race_class: string | null;
  race_type: '芝' | 'ダート' | '障害' | null;
  distance: number;
  track_condition: '良' | '稍重' | '重' | '不良' | null;
  age_condition: string | null;
  sex_condition: string | null;
  weight_condition: string | null;
  total_horses: number | null;
  prize_money: string | null;
  jra_race_id: string | null;
  grade: string | null;
  course_detail: string | null;
  weather: string | null;
  start_time: string | null;
  kaisai_label: string | null;
  lap_times: string | null;
  updated_at: string | null;
  created_at: Generated<string>;
}

/** 出馬表（レースエントリー） */
export interface RaceEntriesTable {
  id: Generated<number>;
  race_id: number;
  horse_id: number;
  jockey_id: number;
  frame_number: number | null;
  horse_number: number;
  assigned_weight: number | null;
  win_odds: number | null;
  place_odds_min: number | null;
  place_odds_max: number | null;
  popularity: number | null;
  horse_weight: number | null;
  weight_change: number | null;
  career_wins: number | null;
  career_places: number | null;
  career_shows: number | null;
  career_runs: number | null;
  total_prize_money: string | null;
  created_at: Generated<string>;
}

/** レース結果 */
export interface RaceResultsTable {
  id: Generated<number>;
  entry_id: number;
  finish_position: number | null;
  finish_status: '完走' | '取消' | '除外' | '中止' | '失格' | '降着' | null;
  finish_time: string | null;
  finish_time_ms: number | null;
  margin: string | null;
  margin_seconds: number | null;
  last_3f_time: number | null;
  last_3f_rank: number | null;
  corner_positions: string | null;
  final_win_odds: number | null;
  final_place_odds: number | null;
  /** JRA公式レーティング */
  rating: number | null;
  created_at: Generated<string>;
}

export const HORSES_COLUMNS: ColumnNames<HorsesTable> = {
  id: { nullable: false, generated: 'default' },
  name: { nullable: false, generated: 'no' },
  birth_year: { nullable: true, generated: 'no' },
  sex: { nullable: true, generated: 'no' },
  coat_color: { nullable: true, generated: 'no' },
  sire_id: { nullable: true, generated: 'no' },
  mare_id: { nullable: true, generated: 'no' },
  trainer_id: { nullable: true, generated: 'no' },
  owner_id: { nullable: true, generated: 'no' },
  breeder_id: { nullable: true, generated: 'no' },
  jra_horse_id: { nullable: true, generated: 'no' },
  created_at: { nullable: false, generated: 'default' },
  updated_at: { nullable: false, generated: 'default' }
};

export const RACES_COLUMNS: ColumnNames<RacesTable> = {
  id: { nullable: false, generated: 'default' },
  race_date: { nullable: false, generated: 'no' },
  venue_id: { nullable: false, generated: 'no' },
  race_number: { nullable: true, generated: 'no' },
  race_name: { nullable: false, generated: 'no' },
  race_class: { nullable: true, generated: 'no' },
  race_type: { nullable: true, generated: 'no' },
  distance: { nullable: false, generated: 'no' },
  track_condition: { nullable: true, generated: 'no' },
  age_condition: { nullable: true, generated: 'no' },
  sex_condition: { nullable: true, generated: 'no' },
  weight_condition: { nullable: true, generated: 'no' },
  total_horses: { nullable: true, generated: 'no' },
  prize_money: { nullable: true, generated: 'no' },
  jra_race_id: { nullable: true, generated: 'no' },
  grade: { nullable: true, generated: 'no' },
  course_detail: { nullable: true, generated: 'no' },
  weather: { nullable: true, generated: 'no' },
  start_time: { nullable: true, generated: 'no' },
  kaisai_label: { nullable: true, generated: 'no' },
  lap_times: { nullable: true, generated: 'no' },
  updated_at: { nullable: true, generated: 'no' },
  created_at: { nullable: false, generated: 'default' }
};

export const RACE_ENTRIES_COLUMNS: ColumnNames<RaceEntriesTable> = {
  id: { nullable: false, generated: 'default' },
  race_id: { nullable: false, generated: 'no' },
  horse_id: { nullable: false, generated: 'no' },
  jockey_id: { nullable: false, generated: 'no' },
  frame_number: { nullable: true, generated: 'no' },
  horse_number: { nullable: false, generated: 'no' },
  assigned_weight: { nullable: true, generated: 'no' },
  win_odds: { nullable: true, generated: 'no' },
  place_odds_min: { nullable: true, generated: 'no' },
  place_odds_max: { nullable: true, generated: 'no' },
  popularity: { nullable: true, generated: 'no' },
  horse_weight: { nullable: true, generated: 'no' },
  weight_change: { nullable: true, generated: 'no' },
  career_wins: { nullable: true, generated: 'no' },
  career_places: { nullable: true, generated: 'no' },
  career_shows: { nullable: true, generated: 'no' },
  career_runs: { nullable: true, generated: 'no' },
  total_prize_money: { nullable: true, generated: 'no' },
  created_at: { nullable: false, generated: 'default' }
};

export const RACE_RESULTS_COLUMNS: ColumnNames<RaceResultsTable> = {
  id: { nullable: false, generated: 'default' },
  entry_id: { nullable: false, generated: 'no' },
  finish_position: { nullable: true, generated: 'no' },
  finish_status: { nullable: true, generated: 'no' },
  finish_time: { nullable: true, generated: 'no' },
  finish_time_ms: { nullable: true, generated: 'no' },
  margin: { nullable: true, generated: 'no' },
  margin_seconds: { nullable: true, generated: 'no' },
  last_3f_time: { nullable: true, generated: 'no' },
  last_3f_rank: { nullable: true, generated: 'no' },
  corner_positions: { nullable: true, generated: 'no' },
  final_win_odds: { nullable: true, generated: 'no' },
  final_place_odds: { nullable: true, generated: 'no' },
  rating: { nullable: true, generated: 'no' },
  created_at: { nullable: false, generated: 'default' }
};
