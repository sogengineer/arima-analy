/**
 * 追加型マイグレーション
 *
 * @remarks
 * `schema.sql` は `CREATE TABLE IF NOT EXISTS` のため、既存DBには新しい列が追加されない。
 * ここでは **既存データを壊さない追加操作のみ**（ADD COLUMN / CREATE TABLE / CREATE INDEX）を行う。
 * 列の削除・型変更・データ書き換えは行わない。
 */

import type { Database } from 'bun:sqlite';

interface ColumnMigration {
  table: string;
  column: string;
  /** ADD COLUMN に渡す定義（NOT NULL・DEFAULT付きの再計算は行わない） */
  definition: string;
}

/** 既存DBに不足しうる追加列 */
const COLUMN_MIGRATIONS: readonly ColumnMigration[] = [
  // races: 有馬記念以外のレースも識別できるようにする条件情報
  { table: 'races', column: 'grade', definition: 'TEXT' },
  { table: 'races', column: 'course_detail', definition: 'TEXT' },
  { table: 'races', column: 'weather', definition: 'TEXT' },
  { table: 'races', column: 'start_time', definition: 'TEXT' },
  { table: 'races', column: 'kaisai_label', definition: 'TEXT' },
  { table: 'races', column: 'lap_times', definition: 'TEXT' },
  { table: 'races', column: 'updated_at', definition: 'DATETIME' },
  // race_results: JRA公式のレーティング
  { table: 'race_results', column: 'rating', definition: 'INTEGER' },
  // horses: 血統登録番号（同名馬を区別する唯一のキー）。
  // schema.sql には元からあるが、それ以前に作られたDBには無いため明示的に追加する
  // （この列が無いと下の UNIQUE インデックス作成が必ず失敗する）
  { table: 'horses', column: 'jra_horse_id', definition: 'TEXT' }
];

const INDEX_MIGRATIONS: readonly string[] = [
  // 血統登録番号は同名馬を区別できる唯一のキー。NULLは重複を許す部分インデックスにする
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_horses_jra_id
     ON horses(jra_horse_id) WHERE jra_horse_id IS NOT NULL`,
  'CREATE INDEX IF NOT EXISTS idx_races_grade ON races(grade)'
];

function hasColumn(db: Database, table: string, column: string): boolean {
  // biome-ignore lint/plugin: PRAGMA はバインドできない。table は本ファイルの定数のみ
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some(row => row.name === column);
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row != null;
}

/**
 * 既存DBに不足している列・テーブル・インデックスを追加する
 *
 * @returns 実行したマイグレーションの説明（何もなければ空配列）
 */
export function runMigrations(db: Database): string[] {
  const applied: string[] = [];

  for (const migration of COLUMN_MIGRATIONS) {
    if (!tableExists(db, migration.table)) continue;
    if (hasColumn(db, migration.table, migration.column)) continue;
    // biome-ignore lint/plugin: DDLの識別子はバインドできない。値は COLUMN_MIGRATIONS の定数のみ
    db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`);
    applied.push(`ADD COLUMN ${migration.table}.${migration.column}`);
  }

  for (const sql of INDEX_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (error) {
      // 失敗の典型は「既存データに jra_horse_id の重複がある」。
      // そのまま取り込みを始めると同名馬の取り違え・重複登録が静かに起きるので、
      // 警告で流さず起動時に明示的に落とす（原因と対処を添える）。
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `マイグレーション（インデックス作成）に失敗しました: ${message}\n` +
          `  SQL: ${sql.trim().split('\n')[0]}\n` +
          '  UNIQUE インデックスの場合、既存の horses に jra_horse_id の重複があります。\n' +
          '  次のクエリで重複を確認し、統合してから再実行してください:\n' +
          '    SELECT jra_horse_id, COUNT(*) FROM horses\n' +
          '     WHERE jra_horse_id IS NOT NULL GROUP BY jra_horse_id HAVING COUNT(*) > 1;'
      );
    }
  }

  return applied;
}
