import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // better-sqlite3のネイティブモジュールとの互換性のため
    // threadsではなくforksを使用（SIGSEGVを回避）
    pool: 'forks',
    // テスト間でDBが干渉しないようにシーケンシャル実行
    fileParallelism: false,
  },
});
