/**
 * Kysely のデータベース型定義（テーブル名・ビュー名 → 行型の対応）
 *
 * @remarks
 * `src/database/schema.sql` と `src/database/migrations.ts` を正として手書きする。
 * ここは Kysely の型を import するため `src/types/` には置けない（constants / types は他層を
 * import しない規約）。スキーマを変更したら **schema.sql → この型定義 → docs/DATABASE.md** の順で追随させる。
 * ズレの検出は `src/database/__test__/DatabaseSchema.test.ts` が実 SQLite の `PRAGMA table_info` と
 * `TABLE_COLUMNS` を突き合わせて行う。
 */

import {
  BREEDERS_COLUMNS,
  JOCKEYS_COLUMNS,
  MARES_COLUMNS,
  OWNERS_COLUMNS,
  SIRES_COLUMNS,
  TRAINERS_COLUMNS,
  VENUES_COLUMNS
} from './MasterTables';
import { HORSES_COLUMNS, RACES_COLUMNS, RACE_ENTRIES_COLUMNS, RACE_RESULTS_COLUMNS } from './CoreTables';
import {
  BLOODLINE_STATS_COLUMNS,
  HORSE_COURSE_STATS_COLUMNS,
  HORSE_SCORES_COLUMNS,
  HORSE_TRACK_STATS_COLUMNS,
  JOCKEY_TRAINER_STATS_COLUMNS
} from './StatsTables';
import { V_HORSE_DETAILS_COLUMNS, V_RACE_RESULTS_DETAIL_COLUMNS } from './Views';

import type { ColumnNames } from './ColumnNames';
import type {
  BreedersTable,
  JockeysTable,
  MaresTable,
  OwnersTable,
  SiresTable,
  TrainersTable,
  VenuesTable
} from './MasterTables';
import type { HorsesTable, RaceEntriesTable, RaceResultsTable, RacesTable } from './CoreTables';
import type {
  BloodlineStatsTable,
  HorseCourseStatsTable,
  HorseScoresTable,
  HorseTrackStatsTable,
  JockeyTrainerStatsTable
} from './StatsTables';
import type { HorseDetailsView, RaceResultsDetailView } from './Views';

export type { ColumnNames } from './ColumnNames';
export * from './MasterTables';
export * from './CoreTables';
export * from './StatsTables';
export * from './Views';

/**
 * Kysely に渡すデータベース型
 *
 * @remarks
 * キーは SQLite の実テーブル名・ビュー名と一致させる（Kysely はこのキーで SQL の識別子を出す）。
 */
export interface Database {
  venues: VenuesTable;
  sires: SiresTable;
  mares: MaresTable;
  trainers: TrainersTable;
  owners: OwnersTable;
  breeders: BreedersTable;
  jockeys: JockeysTable;
  horses: HorsesTable;
  races: RacesTable;
  race_entries: RaceEntriesTable;
  race_results: RaceResultsTable;
  bloodline_stats: BloodlineStatsTable;
  horse_course_stats: HorseCourseStatsTable;
  horse_track_stats: HorseTrackStatsTable;
  jockey_trainer_stats: JockeyTrainerStatsTable;
  horse_scores: HorseScoresTable;
  v_horse_details: HorseDetailsView;
  v_race_results_detail: RaceResultsDetailView;
}

/**
 * テーブル名・ビュー名 → 列名表
 *
 * @remarks
 * 型が `{ [K in keyof Database]: ColumnNames<Database[K]> }` なので、
 * `Database` にテーブルを足してここに書き忘れるとコンパイルエラーになる。
 */
export const TABLE_COLUMNS: { [K in keyof Database]: ColumnNames<Database[K]> } = {
  venues: VENUES_COLUMNS,
  sires: SIRES_COLUMNS,
  mares: MARES_COLUMNS,
  trainers: TRAINERS_COLUMNS,
  owners: OWNERS_COLUMNS,
  breeders: BREEDERS_COLUMNS,
  jockeys: JOCKEYS_COLUMNS,
  horses: HORSES_COLUMNS,
  races: RACES_COLUMNS,
  race_entries: RACE_ENTRIES_COLUMNS,
  race_results: RACE_RESULTS_COLUMNS,
  bloodline_stats: BLOODLINE_STATS_COLUMNS,
  horse_course_stats: HORSE_COURSE_STATS_COLUMNS,
  horse_track_stats: HORSE_TRACK_STATS_COLUMNS,
  jockey_trainer_stats: JOCKEY_TRAINER_STATS_COLUMNS,
  horse_scores: HORSE_SCORES_COLUMNS,
  v_horse_details: V_HORSE_DETAILS_COLUMNS,
  v_race_results_detail: V_RACE_RESULTS_DETAIL_COLUMNS
};

/** 実テーブル名（ビューを除く）。DDL と突き合わせる側の走査に使う */
export const TABLE_NAMES: readonly (keyof Database)[] = [
  'venues',
  'sires',
  'mares',
  'trainers',
  'owners',
  'breeders',
  'jockeys',
  'horses',
  'races',
  'race_entries',
  'race_results',
  'bloodline_stats',
  'horse_course_stats',
  'horse_track_stats',
  'jockey_trainer_stats',
  'horse_scores'
];

/** ビュー名。`PRAGMA table_info` は実テーブルと同じく列を返す */
export const VIEW_NAMES: readonly (keyof Database)[] = ['v_horse_details', 'v_race_results_detail'];
