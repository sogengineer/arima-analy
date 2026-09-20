/**
 * 行型から「列の仕様表」を作るための型
 *
 * @remarks
 * 列名を素の文字列配列で持つと、行型に列を足したときに表の更新漏れが起きても気づけない。
 * 行型のキーをそのまま写した Record にしておくと、**過不足の両方**をコンパイラが検出する
 * （列を足して表に書かなければ「プロパティが足りない」、表だけに書けば「余分なプロパティ」）。
 *
 * 値は `true` ではなく **記述子**（NULL 可否と生成列の種別）にしてある。
 * 記述子の型は行型から機械的に導くので、型定義と食い違う記述子を書くとコンパイルエラーになる。
 * 実行時には `src/database/__test__/DatabaseSchema.test.ts` が実 SQLite の
 * `pragma_table_xinfo`（`notnull` / `dflt_value` / `hidden`）と突き合わせ、
 * 列名だけでなく NULL 可否・DEFAULT・生成列のズレも落とす。
 *
 * ビューは読み取り専用で DDL 側に制約情報が無いため、列名の集合だけを見る（`ViewColumnNames`）。
 */

/**
 * 列の生成種別
 *
 * - `no`: 書き込み時に値が要る通常の列
 * - `default`: DEFAULT 付き、または INTEGER PRIMARY KEY（省略すると DB 側が値を決める）
 * - `always`: GENERATED ALWAYS（書き込めない）
 */
export type GeneratedKind = 'no' | 'default' | 'always';

/** 列の仕様（NULL 可否と生成種別） */
export interface ColumnDescriptor {
  readonly nullable: boolean;
  readonly generated: GeneratedKind;
}

/** `ColumnType<S, ...>` から SELECT 時の型を取り出す（素の型はそのまま） */
type SelectTypeOf<TColumn> = TColumn extends { readonly __select__: infer TSelect }
  ? TSelect
  : TColumn;

/**
 * 列型から生成種別を導く
 *
 * @remarks
 * `Generated<S>` は INSERT 型が `S | undefined`、`GeneratedAlways<S>` は `never`。
 * この違いで DEFAULT 付きの列と GENERATED ALWAYS の列を区別する。
 */
type GeneratedKindOf<TColumn> = TColumn extends { readonly __insert__: infer TInsert }
  ? [TInsert] extends [never]
    ? 'always'
    : 'default'
  : 'no';

/** SELECT 時に NULL を取りうるか */
type IsNullableColumn<TColumn> = null extends SelectTypeOf<TColumn> ? true : false;

/** 列型から導かれる記述子（これと違う値は書けない） */
type ColumnDescriptorOf<TColumn> = {
  readonly nullable: IsNullableColumn<TColumn>;
  readonly generated: GeneratedKindOf<TColumn>;
};

/** テーブル行型 → 列ごとの記述子の表 */
export type ColumnNames<TTable> = { readonly [K in keyof TTable]: ColumnDescriptorOf<TTable[K]> };

/** ビュー行型 → 列名の集合（ビューは列名だけを突き合わせる） */
export type ViewColumnNames<TView> = { readonly [K in keyof TView]: true };
