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
  id: true,
  name: true,
  birth_year: true,
  sex: true,
  coat_color: true,
  sire_id: true,
  mare_id: true,
  trainer_id: true,
  owner_id: true,
  breeder_id: true,
  jra_horse_id: true,
  created_at: true,
  updated_at: true
};

export const RACES_COLUMNS: ColumnNames<RacesTable> = {
  id: true,
  race_date: true,
  venue_id: true,
  race_number: true,
  race_name: true,
  race_class: true,
  race_type: true,
  distance: true,
  track_condition: true,
  age_condition: true,
  sex_condition: true,
  weight_condition: true,
  total_horses: true,
  prize_money: true,
  jra_race_id: true,
  grade: true,
  course_detail: true,
  weather: true,
  start_time: true,
  kaisai_label: true,
  lap_times: true,
  updated_at: true,
  created_at: true
};

export const RACE_ENTRIES_COLUMNS: ColumnNames<RaceEntriesTable> = {
  id: true,
  race_id: true,
  horse_id: true,
  jockey_id: true,
  frame_number: true,
  horse_number: true,
  assigned_weight: true,
  win_odds: true,
  place_odds_min: true,
  place_odds_max: true,
  popularity: true,
  horse_weight: true,
  weight_change: true,
  career_wins: true,
  career_places: true,
  career_shows: true,
  career_runs: true,
  total_prize_money: true,
  created_at: true
};

export const RACE_RESULTS_COLUMNS: ColumnNames<RaceResultsTable> = {
  id: true,
  entry_id: true,
  finish_position: true,
  finish_status: true,
  finish_time: true,
  finish_time_ms: true,
  margin: true,
  margin_seconds: true,
  last_3f_time: true,
  last_3f_rank: true,
  corner_positions: true,
  final_win_odds: true,
  final_place_odds: true,
  rating: true,
  created_at: true
};
