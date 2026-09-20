/**
 * 行型から「列名の表」を作るための型
 *
 * @remarks
 * 列名を素の文字列配列で持つと、行型に列を足したときに表の更新漏れが起きても気づけない。
 * 行型のキーをそのまま写した Record にしておくと、**過不足の両方**をコンパイラが検出する
 * （列を足して表に書かなければ「プロパティが足りない」、表だけに書けば「余分なプロパティ」）。
 * 実行時の列名一覧は `Object.keys()` で取り出し、実 SQLite の `PRAGMA table_info` と突き合わせる
 * （`src/database/__test__/DatabaseSchema.test.ts`）。
 */
export type ColumnNames<TTable> = { readonly [K in keyof TTable]: true };
