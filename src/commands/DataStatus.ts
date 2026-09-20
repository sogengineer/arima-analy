/**
 * 蓄積データの棚卸し（ML設計書 Step 0）
 *
 * @remarks
 * 学習データが成立する量に達しているかを一目で判断するためのコマンド。
 * レース数・出走行数・結果あり行数・主要特徴量のnull率・期間を表示する。
 */

import { DatabaseConnection } from '../database/DatabaseConnection';

/** MLが成立する最低ライン（設計書「1. データ量の実態」） */
const MIN_ROWS_FOR_ML = 3000;
/** 較正済み確率の実用ライン */
const TARGET_ROWS_FOR_CALIBRATION = 10000;

interface Totals {
  races: number;
  entries: number;
  results: number;
  horses: number;
  jockeys: number;
  venues: number;
  firstDate?: string;
  lastDate?: string;
}

interface NullRate {
  label: string;
  table: 'race_entries' | 'race_results' | 'races';
  column: string;
  /** null率が高くても異常ではない列に付ける注記 */
  note?: string;
}

/** ML設計で一次特徴量として使う列（null率を監視する対象） */
const MONITORED_COLUMNS: readonly NullRate[] = [
  {
    label: '単勝オッズ',
    table: 'race_entries',
    column: 'win_odds',
    note: '出馬表（発走前）の取り込みで埋まる列。未取得のレースでは欠損する（市場系特徴量は人気順位が主軸）'
  },
  { label: '人気', table: 'race_entries', column: 'popularity' },
  { label: '馬体重', table: 'race_entries', column: 'horse_weight' },
  { label: '馬体重増減', table: 'race_entries', column: 'weight_change' },
  { label: '斤量', table: 'race_entries', column: 'assigned_weight' },
  { label: '枠番', table: 'race_entries', column: 'frame_number' },
  { label: '通算出走数', table: 'race_entries', column: 'career_runs' },
  { label: '着順', table: 'race_results', column: 'finish_position' },
  { label: '走破タイム(ms)', table: 'race_results', column: 'finish_time_ms' },
  { label: '着差(秒)', table: 'race_results', column: 'margin_seconds' },
  { label: '上がり3F', table: 'race_results', column: 'last_3f_time' },
  { label: 'コーナー通過順', table: 'race_results', column: 'corner_positions' },
  { label: '確定単勝オッズ', table: 'race_results', column: 'final_win_odds' },
  { label: 'レース種別(芝ダ)', table: 'races', column: 'race_type' },
  { label: '馬場状態', table: 'races', column: 'track_condition' },
  { label: 'クラス', table: 'races', column: 'race_class' },
  { label: '天候', table: 'races', column: 'weather' }
];

export class DataStatus {
  private readonly connection: DatabaseConnection;

  constructor(dbPath?: string) {
    this.connection = dbPath ? new DatabaseConnection(dbPath) : new DatabaseConnection();
  }

  async execute(): Promise<void> {
    try {
      const totals = this.loadTotals();

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 蓄積データの状況');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  レース数:         ${totals.races.toLocaleString()}`);
      console.log(`  出走行数:         ${totals.entries.toLocaleString()}`);
      console.log(`  結果あり行数:     ${totals.results.toLocaleString()}` +
        (totals.entries > 0 ? `（${percent(totals.results / totals.entries)}）` : ''));
      console.log(`  登録馬:           ${totals.horses.toLocaleString()}`);
      console.log(`  騎手:             ${totals.jockeys.toLocaleString()}`);
      console.log(`  競馬場:           ${totals.venues.toLocaleString()}`);
      console.log(`  期間:             ${totals.firstDate ?? '-'} 〜 ${totals.lastDate ?? '-'}`);

      this.printRaceBreakdown();

      console.log('\n── 主要特徴量のnull率 ──');
      const width = Math.max(...MONITORED_COLUMNS.map(c => visualWidth(c.label))) + 2;
      for (const target of MONITORED_COLUMNS) {
        const denominator = denominatorFor(target.table, totals);
        const nulls = this.countNulls(target.table, target.column);
        const rate = denominator > 0 ? nulls / denominator : 1;
        console.log(`  ${marker(rate, target.note)} ${pad(target.label, width)}${percent(rate).padStart(7)}  (${nulls.toLocaleString()} / ${denominator.toLocaleString()})`);
        if (target.note && rate > 0) {
          console.log(`     └ ${target.note}`);
        }
      }

      this.printReadiness(totals);

    } catch (error) {
      console.error('❌ データ状況の取得に失敗:', error);
    } finally {
      this.connection.close();
    }
  }

  private loadTotals(): Totals {
    const db = this.connection.getConnection();
    const one = <T>(sql: string): T => db.prepare(sql).get() as T;

    const counts = one<{
      races: number; entries: number; results: number;
      horses: number; jockeys: number; venues: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM races) AS races,
        (SELECT COUNT(*) FROM race_entries) AS entries,
        (SELECT COUNT(*) FROM race_results WHERE finish_position IS NOT NULL) AS results,
        (SELECT COUNT(*) FROM horses) AS horses,
        (SELECT COUNT(*) FROM jockeys) AS jockeys,
        (SELECT COUNT(DISTINCT venue_id) FROM races) AS venues
    `);

    const period = one<{ first_date?: string; last_date?: string }>(
      'SELECT MIN(race_date) AS first_date, MAX(race_date) AS last_date FROM races'
    );

    return { ...counts, firstDate: period.first_date, lastDate: period.last_date };
  }

  /**
   * 指定列のNULL件数を数える
   *
   * @remarks
   * テーブル名・列名はSQLのプレースホルダにできない。
   * 引数は `MONITORED_COLUMNS` の固定リスト由来のみで、外部入力は流れ込まない。
   */
  private countNulls(table: NullRate['table'], column: string): number {
    const db = this.connection.getConnection();
    const sql = table === 'race_results'
      ? `SELECT COUNT(*) AS c FROM race_results WHERE finish_position IS NOT NULL AND ${column} IS NULL`
      : `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} IS NULL`;
    return (db.prepare(sql).get() as { c: number }).c;
  }

  /** 芝ダ別・クラス別の内訳（一般レースが入っているかの確認用） */
  private printRaceBreakdown(): void {
    const db = this.connection.getConnection();

    const byType = db.prepare(`
      SELECT COALESCE(race_type, '(未設定)') AS label, COUNT(*) AS count
      FROM races GROUP BY race_type ORDER BY count DESC
    `).all() as Array<{ label: string; count: number }>;

    const byGrade = db.prepare(`
      SELECT COALESCE(grade, '(平場・特別)') AS label, COUNT(*) AS count
      FROM races GROUP BY grade ORDER BY count DESC
    `).all() as Array<{ label: string; count: number }>;

    const byDistance = db.prepare(`
      SELECT COUNT(DISTINCT distance) AS c FROM races
    `).get() as { c: number };

    if (byType.length > 0) {
      console.log('\n── レース内訳 ──');
      console.log(`  芝ダ別:   ${byType.map(r => `${r.label} ${r.count}`).join(' / ')}`);
      console.log(`  格付別:   ${byGrade.map(r => `${r.label} ${r.count}`).join(' / ')}`);
      console.log(`  距離種類: ${byDistance.c}種`);
    }
  }

  private printReadiness(totals: Totals): void {
    console.log('\n── ML適合度 ──');
    if (totals.results >= TARGET_ROWS_FOR_CALIBRATION) {
      console.log(`  ✅ 結果行 ${totals.results.toLocaleString()} 件。較正済み確率モデルの実用圏です`);
    } else if (totals.results >= MIN_ROWS_FOR_ML) {
      console.log(`  🟡 結果行 ${totals.results.toLocaleString()} 件。学習は可能ですが、`
        + `較正には ${TARGET_ROWS_FOR_CALIBRATION.toLocaleString()} 件以上が目安です`);
    } else {
      const short = MIN_ROWS_FOR_ML - totals.results;
      console.log(`  🔴 結果行 ${totals.results.toLocaleString()} 件。学習には最低 `
        + `${MIN_ROWS_FOR_ML.toLocaleString()} 件（あと約 ${short.toLocaleString()} 件）が必要です`);
      console.log('     データ投入: fetch-jra でHTMLを取得 → extract-html → db-import');
    }
  }
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** 日本語（全角）を2桁として数えた表示幅 */
function visualWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += ch.charCodeAt(0) > 0xff ? 2 : 1;
  }
  return width;
}

/**
 * null率に応じた記号
 *
 * @remarks
 * 注記付きの列（欠損が想定内の列）は 🔴 ではなく ℹ️ を出す。
 */
function marker(rate: number, note?: string): string {
  if (rate === 0) return '✅';
  if (note) return 'ℹ️ ';
  if (rate < 0.1) return '🟡';
  return '🔴';
}

/** null率の分母（テーブルごとの母数） */
function denominatorFor(table: NullRate['table'], totals: Totals): number {
  if (table === 'races') return totals.races;
  if (table === 'race_entries') return totals.entries;
  return totals.results;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(1, width - visualWidth(text)));
}
