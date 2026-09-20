/**
 * Kysely の型定義（`src/database/schema/`）と実スキーマのズレを検出するテスト
 *
 * @remarks
 * 型定義は `schema.sql` / `migrations.ts` を正とした手書きなので、DDL だけを直して
 * 型定義を直し忘れると、組み立てた SQL が実行時に落ちる。ここで実 SQLite の
 * `pragma_table_xinfo` と `TABLE_COLUMNS` の列名集合を突き合わせ、片方だけの変更を落とす。
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../migrations';
import { TABLE_COLUMNS, TABLE_NAMES, VIEW_NAMES } from '../schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

/** 実 SQLite が報告する列名（`pragma_table_xinfo` は GENERATED 列とビューの列も返す） */
function actualColumns(name: string): string[] {
  const rows = db.prepare<{ name: string }, [string]>('SELECT name FROM pragma_table_xinfo(?)').all(name);
  return rows.map(row => row.name).sort();
}

describe('Kysely の型定義とスキーマの一致', () => {
  test('TABLE_NAMES と VIEW_NAMES が TABLE_COLUMNS のキーを漏れなく覆う', () => {
    const listed = [...TABLE_NAMES, ...VIEW_NAMES].sort();
    expect(listed).toEqual(Object.keys(TABLE_COLUMNS).sort());
  });

  test.each([...TABLE_NAMES])('テーブル %s の列が型定義と一致する', name => {
    const expected = Object.keys(TABLE_COLUMNS[name]).sort();
    expect(actualColumns(name)).toEqual(expected);
  });

  test.each([...VIEW_NAMES])('ビュー %s の列が型定義と一致する', name => {
    const expected = Object.keys(TABLE_COLUMNS[name]).sort();
    expect(actualColumns(name)).toEqual(expected);
  });

  test('型定義に無いテーブル・ビューが DDL 側に増えていない', () => {
    const rows = db
      .prepare<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'"
      )
      .all();
    expect(rows.map(row => row.name).sort()).toEqual(Object.keys(TABLE_COLUMNS).sort());
  });
});
