/**
 * データベース接続管理クラス
 * 接続の初期化・取得・クローズのみを担当
 * 実際のデータ操作はリポジトリ層で行う
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export type { DatabaseType };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DatabaseConnection {
  private db: Database.Database;

  constructor(dbPath: string = './arima.db') {
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  /**
   * スキーマを初期化
   */
  private initializeDatabase(): void {
    try {
      const schemaPath = join(__dirname, 'schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * データベース接続オブジェクトを取得
   * リポジトリで使用
   */
  getConnection(): Database.Database {
    return this.db;
  }

  /**
   * トランザクション内で処理を実行
   * エラー時は自動ロールバック
   */
  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * 接続をクローズ
   */
  close(): void {
    this.db.close();
  }
}

// ============================================
// ファクトリ関数
// ============================================

/**
 * DatabaseConnection と全リポジトリを初期化して返す
 */
export function createDatabaseWithRepositories(dbPath: string = './arima.db'): {
  connection: DatabaseConnection;
  db: DatabaseType;
} {
  const connection = new DatabaseConnection(dbPath);
  const db = connection.getConnection();

  // 遅延インポートを避けるため、ここではリポジトリのインスタンス化は行わない
  // 呼び出し側でリポジトリを作成する
  return {
    connection,
    db
  };
}
