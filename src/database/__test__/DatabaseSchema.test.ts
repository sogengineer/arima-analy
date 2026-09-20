/**
 * Kysely の型定義（`src/database/schema/`）と実スキーマのズレを検出するテスト
 *
 * @remarks
 * 型定義は `schema.sql` / `migrations.ts` を正とした手書きなので、DDL だけを直して
 * 型定義を直し忘れると、組み立てた SQL が実行時に落ちる。ここで実 SQLite の
 * `pragma_table_xinfo` と `TABLE_COLUMNS` を突き合わせ、片方だけの変更を落とす。
 *
 * 見るのは列名だけではなく、列ごとの **NULL 可否・DEFAULT・生成列** まで。
 * `TABLE_COLUMNS` の記述子は行型（`| null` / `Generated<>` / `GeneratedAlways<>`）から
 * 型レベルで強制されるので、ここが一致していれば行型も実スキーマと一致している。
 * ビューは DDL 側に制約情報が無いため、列名の集合だけを比べる。
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '@/database/migrations';
import { TABLE_COLUMNS, TABLE_NAMES, VIEW_COLUMNS, VIEW_NAMES, type ColumnDescriptor } from '@/database/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** `pragma_table_xinfo` の 1 行 */
interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  /** 2 = GENERATED ALWAYS ... VIRTUAL、3 = ... STORED */
  hidden: number;
}

/** GENERATED ALWAYS 列を表す `hidden` の値 */
const HIDDEN_VIRTUAL = 2;
const HIDDEN_STORED = 3;

let db: Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(__dirname, '../schema.sql'), 'utf-8'));
  runMigrations(db);
});

afterAll(() => {
  db.close();
});

/** 実 SQLite が報告する列（`pragma_table_xinfo` は GENERATED 列とビューの列も返す） */
function columnInfos(name: string): ColumnInfo[] {
  return db
    .prepare<ColumnInfo, [string]>(
      'SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)'
    )
    .all(name);
}

function actualColumnNames(name: string): string[] {
  return columnInfos(name)
    .map(row => row.name)
    .sort();
}

/**
 * DDL の列定義を記述子に落とす
 *
 * @remarks
 * - GENERATED ALWAYS は書き込めない列（`hidden` が 2 か 3）
 * - `INTEGER PRIMARY KEY` は rowid の別名。`notnull` は 0 と報告されるが
 *   実質 NOT NULL で、省略すれば自動採番される（= DEFAULT 相当）
 * - DEFAULT を持つ列は省略でき、省略時に NULL にはならない
 * - それ以外は `notnull` がそのまま NULL 可否になる
 */
function toDescriptor(column: ColumnInfo): ColumnDescriptor {
  if (column.hidden === HIDDEN_VIRTUAL || column.hidden === HIDDEN_STORED) {
    return { nullable: false, generated: 'always' };
  }
  if (column.pk === 1 && column.type.toUpperCase() === 'INTEGER') {
    return { nullable: false, generated: 'default' };
  }
  if (column.dflt_value !== null) {
    return { nullable: false, generated: 'default' };
  }
  return { nullable: column.notnull === 0, generated: 'no' };
}

describe('Kysely の型定義とスキーマの一致', () => {
  test('TABLE_NAMES と VIEW_NAMES が列定義のキーを漏れなく覆う', () => {
    expect([...TABLE_NAMES].sort()).toEqual(Object.keys(TABLE_COLUMNS).sort());
    expect([...VIEW_NAMES].sort()).toEqual(Object.keys(VIEW_COLUMNS).sort());
  });

  test.each([...TABLE_NAMES])('テーブル %s の列が型定義と一致する', name => {
    const expected = Object.keys(TABLE_COLUMNS[name]).sort();
    expect(actualColumnNames(name)).toEqual(expected);
  });

  test.each([...TABLE_NAMES])(
    'テーブル %s の NULL 可否・DEFAULT・生成列が型定義と一致する',
    name => {
      const columns: Record<string, ColumnDescriptor> = TABLE_COLUMNS[name];
      for (const info of columnInfos(name)) {
        expect({ column: info.name, ...toDescriptor(info) }).toEqual({
          column: info.name,
          ...columns[info.name]
        });
      }
    }
  );

  test.each([...VIEW_NAMES])('ビュー %s の列が型定義と一致する', name => {
    const expected = Object.keys(VIEW_COLUMNS[name]).sort();
    expect(actualColumnNames(name)).toEqual(expected);
  });

  test('型定義に無いテーブル・ビューが DDL 側に増えていない', () => {
    const rows = db
      .prepare<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'"
      )
      .all();
    const defined = [...Object.keys(TABLE_COLUMNS), ...Object.keys(VIEW_COLUMNS)].sort();
    expect(rows.map(row => row.name).sort()).toEqual(defined);
  });
});
