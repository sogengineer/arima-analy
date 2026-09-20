/**
 * 蓄積データの棚卸し（ML設計書 Step 0）
 *
 * @remarks
 * 学習データが成立する量に達しているかを一目で判断するためのコマンド。
 * レース数・出走行数・結果あり行数・主要特徴量のnull率・期間を表示する。
 */

import { DatabaseConnection } from '../database/DatabaseConnection';
import {
  DataStatusQueryRepository,
  type MonitoredColumn,
  type MonitoredTable
} from '../repositories/queries/DataStatusQueryRepository';

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

/**
 * null率を監視する列の 1 件
 *
 * @remarks
 * テーブルと列名を組で持つ（`table` ごとに実在する列名しか書けない）。
 * テーブルの union をそのまま展開したユニオンにしておくことで、
 * `races` に `horse_weight` のような別テーブルの列を書くとコンパイルエラーになる。
 */
type NullRateOf<TTable extends MonitoredTable> = {
  label: string;
  table: TTable;
  column: MonitoredColumn<TTable>;
  /** null率が高くても異常ではない列に付ける注記 */
  note?: string;
};

type NullRate =
  | NullRateOf<'race_entries'>
  | NullRateOf<'race_results'>
  | NullRateOf<'races'>;

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
  private readonly repository: DataStatusQueryRepository;

  constructor(dbPath?: string) {
    this.connection = dbPath ? new DatabaseConnection(dbPath) : new DatabaseConnection();
    this.repository = new DataStatusQueryRepository(this.connection.getConnection());
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
        const nulls = this.countNulls(target);
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
    const counts = this.repository.getTotals();
    const period = this.repository.getRaceDatePeriod();

    return {
      ...counts,
      firstDate: period.first_date ?? undefined,
      lastDate: period.last_date ?? undefined
    };
  }

  /**
   * 指定列のNULL件数を数える
   *
   * @remarks
   * `table` と `column` は組のまま渡す（リポジトリ側がテーブルごとの列名に型で絞っている）。
   */
  private countNulls(target: NullRate): number {
    return this.repository.countNullValues(target);
  }

  /** 芝ダ別・クラス別の内訳（一般レースが入っているかの確認用） */
  private printRaceBreakdown(): void {
    const byType = this.repository.countRacesByType();
    const byGrade = this.repository.countRacesByGrade();
    const distanceKinds = this.repository.countDistinctDistances();

    if (byType.length > 0) {
      console.log('\n── レース内訳 ──');
      console.log(`  芝ダ別:   ${byType.map(r => `${r.label} ${r.count}`).join(' / ')}`);
      console.log(`  格付別:   ${byGrade.map(r => `${r.label} ${r.count}`).join(' / ')}`);
      console.log(`  距離種類: ${distanceKinds}種`);
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
