/**
 * クエリの組み立て（Kysely）と実行（bun:sqlite）をつなぐ層
 *
 * @remarks
 * Kysely は **クエリビルダとしてだけ**使う。実行は従来どおり bun:sqlite の同期 API で行うため、
 * ドライバを持たない "cold" な Kysely インスタンス（`DummyDriver`）を用意し、`.compile()` で
 * `{ sql, parameters }` を取り出してから `prepare(sql).all(...parameters)` に渡す。
 * この構成は Kysely 公式の「Splitting query building and execution」レシピに沿う。
 *
 * この形にする理由:
 * - 実行系は bun:sqlite のままなので、同期性とトランザクション（`DatabaseConnection.runInTransaction`）が変わらない
 * - コミュニティ製の bun:sqlite 用 dialect を依存に増やさずに済む
 *
 * ビルダーの `.execute()` 系は DummyDriver 越しでは**エラーにならず空の結果を返す**ため、
 * 実行は必ずこのファイルのヘルパー経由にする（`biome-plugins/no-kysely-builder-execution.grit` が error で検出する）。
 */

import type { Database as SqliteDatabase, SQLQueryBindings, Changes } from 'bun:sqlite';
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery
} from 'kysely';
import type { Database } from './schema';

/**
 * SQL の組み立て専用の Kysely インスタンス
 *
 * @remarks
 * `DummyDriver` を使うため、このインスタンス自身は DB に接続しない。接続は呼び出し側が持つ
 * bun:sqlite の `Database` で、実行は下のヘルパーが行う。
 */
export const queryBuilder = new Kysely<Database>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: db => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler()
  }
});

/**
 * コンパイル済みクエリのパラメータを bun:sqlite のバインド値に変換する
 *
 * @remarks
 * Kysely の `parameters` は `ReadonlyArray<unknown>` なので、型で押し通さず実際に値を確認する。
 * ここで弾かれるのは「値ではない何か（オブジェクト・関数など）が SQL に混ざった」場合で、
 * そのまま bun:sqlite に渡すと実行時の分かりにくいエラーになる。
 */
function toBindings(parameters: ReadonlyArray<unknown>): SQLQueryBindings[] {
  const bindings: SQLQueryBindings[] = [];

  for (const value of parameters) {
    if (value === null) {
      bindings.push(null);
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      bindings.push(value);
    } else if (value instanceof Uint8Array) {
      bindings.push(value);
    } else {
      throw new Error(`SQL のバインド値として扱えない値が含まれています: ${typeof value}`);
    }
  }

  return bindings;
}

/**
 * SELECT を実行して全行を返す
 *
 * @param db - bun:sqlite の接続
 * @param compiled - `queryBuilder` で組み立てて `.compile()` したクエリ
 * @returns Kysely が推論した行型の配列
 */
export function selectRows<TRow>(db: SqliteDatabase, compiled: CompiledQuery<TRow>): TRow[] {
  return db.prepare<TRow, SQLQueryBindings[]>(compiled.sql).all(...toBindings(compiled.parameters));
}

/**
 * SELECT を実行して先頭の 1 行を返す
 *
 * @returns 行が無い場合は null
 */
export function selectRow<TRow>(db: SqliteDatabase, compiled: CompiledQuery<TRow>): TRow | null {
  return db.prepare<TRow, SQLQueryBindings[]>(compiled.sql).get(...toBindings(compiled.parameters));
}

/**
 * INSERT / UPDATE / DELETE を実行する
 *
 * @remarks
 * トランザクションはこのヘルパーでは扱わない。従来どおり `DatabaseConnection.runInTransaction`
 * （bun:sqlite の `db.transaction`）で囲むこと。
 *
 * @returns 変更行数と最後の rowid
 */
export function runStatement(db: SqliteDatabase, compiled: CompiledQuery<unknown>): Changes {
  return db.prepare<unknown, SQLQueryBindings[]>(compiled.sql).run(...toBindings(compiled.parameters));
}
