/**
 * マスタテーブルの Kysely 行型（venues / sires / mares / trainers / owners / breeders / jockeys）
 *
 * @remarks
 * `src/database/schema.sql` を正として手書きする。列名は SQLite のまま snake_case で保つ
 * （CamelCasePlugin は使わない。既存の行型・SQL の結果を変えないため）。
 * AUTOINCREMENT の主キーと DEFAULT 付きの列は、INSERT 時に省略できるので `Generated<>` にする。
 */

import type { Generated } from 'kysely';
import type { ColumnNames } from './ColumnNames';

/** 競馬場マスタ */
export interface VenuesTable {
  id: Generated<number>;
  name: string;
  region: string | null;
  created_at: Generated<string>;
}

/** 種牡馬マスタ（父馬） */
export interface SiresTable {
  id: Generated<number>;
  name: string;
  country: string | null;
  created_at: Generated<string>;
}

/** 繁殖牝馬マスタ（母馬） */
export interface MaresTable {
  id: Generated<number>;
  name: string;
  sire_id: number | null;
  created_at: Generated<string>;
}

/** 調教師マスタ */
export interface TrainersTable {
  id: Generated<number>;
  name: string;
  stable: '美浦' | '栗東' | null;
  created_at: Generated<string>;
}

/** 馬主マスタ */
export interface OwnersTable {
  id: Generated<number>;
  name: string;
  created_at: Generated<string>;
}

/** 生産者マスタ */
export interface BreedersTable {
  id: Generated<number>;
  name: string;
  created_at: Generated<string>;
}

/** 騎手マスタ */
export interface JockeysTable {
  id: Generated<number>;
  name: string;
  default_weight: number | null;
  apprentice_status: string | null;
  created_at: Generated<string>;
}

export const VENUES_COLUMNS: ColumnNames<VenuesTable> = {
  id: true,
  name: true,
  region: true,
  created_at: true
};

export const SIRES_COLUMNS: ColumnNames<SiresTable> = {
  id: true,
  name: true,
  country: true,
  created_at: true
};

export const MARES_COLUMNS: ColumnNames<MaresTable> = {
  id: true,
  name: true,
  sire_id: true,
  created_at: true
};

export const TRAINERS_COLUMNS: ColumnNames<TrainersTable> = {
  id: true,
  name: true,
  stable: true,
  created_at: true
};

export const OWNERS_COLUMNS: ColumnNames<OwnersTable> = {
  id: true,
  name: true,
  created_at: true
};

export const BREEDERS_COLUMNS: ColumnNames<BreedersTable> = {
  id: true,
  name: true,
  created_at: true
};

export const JOCKEYS_COLUMNS: ColumnNames<JockeysTable> = {
  id: true,
  name: true,
  default_weight: true,
  apprentice_status: true,
  created_at: true
};
