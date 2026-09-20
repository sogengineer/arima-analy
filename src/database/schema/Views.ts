/**
 * ビューの Kysely 行型（v_horse_details / v_race_results_detail）
 *
 * @remarks
 * ビューは読み取り専用なので `Generated<>` は使わず、SELECT 結果の型だけを書く。
 * 元テーブルを LEFT JOIN している列は NULL になりうる（`v_horse_details` の血統・厩舎系）。
 * `v_race_results_detail` は内部 JOIN のみなので、元テーブルで NOT NULL の列は NULL にならない。
 */

import type { ColumnNames } from './ColumnNames';

/** 馬詳細ビュー（血統込み） */
export interface HorseDetailsView {
  id: number;
  name: string;
  birth_year: number | null;
  sex: '牡' | '牝' | '騸' | null;
  sire_name: string | null;
  mare_name: string | null;
  mares_sire_name: string | null;
  trainer_name: string | null;
  stable: '美浦' | '栗東' | null;
  owner_name: string | null;
  breeder_name: string | null;
}

/** レース結果詳細ビュー */
export interface RaceResultsDetailView {
  race_date: string;
  venue: string;
  race_number: number | null;
  race_name: string;
  race_class: string | null;
  race_type: '芝' | 'ダート' | '障害' | null;
  distance: number;
  track_condition: '良' | '稍重' | '重' | '不良' | null;
  frame_number: number | null;
  horse_number: number;
  horse_name: string;
  jockey_name: string;
  assigned_weight: number | null;
  horse_weight: number | null;
  popularity: number | null;
  finish_position: number | null;
  finish_time: string | null;
  last_3f_time: number | null;
  corner_positions: string | null;
  margin: string | null;
  win_odds: number | null;
}

export const V_HORSE_DETAILS_COLUMNS: ColumnNames<HorseDetailsView> = {
  id: true,
  name: true,
  birth_year: true,
  sex: true,
  sire_name: true,
  mare_name: true,
  mares_sire_name: true,
  trainer_name: true,
  stable: true,
  owner_name: true,
  breeder_name: true
};

export const V_RACE_RESULTS_DETAIL_COLUMNS: ColumnNames<RaceResultsDetailView> = {
  race_date: true,
  venue: true,
  race_number: true,
  race_name: true,
  race_class: true,
  race_type: true,
  distance: true,
  track_condition: true,
  frame_number: true,
  horse_number: true,
  horse_name: true,
  jockey_name: true,
  assigned_weight: true,
  horse_weight: true,
  popularity: true,
  finish_position: true,
  finish_time: true,
  last_3f_time: true,
  corner_positions: true,
  margin: true,
  win_odds: true
};
