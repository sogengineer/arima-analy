---
name: review-security
description: "外部データ取得と取り込み経路のセキュリティレビュー。JRA 以外のホストへ取りに行かせない URL 検証（SSRF）、スクレイピングの作法（User-Agent・リクエスト間隔・タイムアウト）、外部由来 HTML/JSON を無検証で DB に入れない、クエリを Kysely で組み立て生の SQL 文字列を増やさないこと、CLI 由来のファイルパスの扱い、生成物（*.db / data/extracted-*.json / data/jra-page.html）と .env をコミットさせないことを検証。Use when user says 'セキュリティレビュー', 'review security', 'セキュリティチェック', 'SSRF確認', or 'SQLインジェクション確認'."
---

## Instructions

外部（JRA サイト・ローカル JSON ファイル・CLI 引数）から入ってくるデータの経路を探索し、危険な取り扱いが無いかレビューする。

### 対象スコープと指摘範囲

起動時に「対象スコープ」と「対象ファイル一覧」が渡される場合がある（review-all 等からの dispatch 時）。その扱いは次の通り:

- **探索は広く、指摘は狭く**: 文脈把握のための Glob/Grep/Read はプロジェクト全体に対して行ってよい。ただしテーブルに載せる WARN/FAIL は対象ファイル一覧内の事象に限定する
- **該当ファイル不在の項目**: 評価対象が無い項目は OK として計上しない（テーブルにステータス `N-A` で残し、備考に根拠を書く。行を省かない）
- **自観点の評価対象が皆無**: 判断根拠 1 行 + `Summary: SKIPPED` の最小出力でよい（テーブル骨格は不要）
- **スコープ未指定時**: プロジェクト全体（`node_modules/` は除外）を対象にする
- **一覧に実在しないファイルがある場合**: 除外して続行し、詳細所見に 1 行明記する
- 既存コードの違反（差分外・本変更で未変更の行）は**既存債務**として扱い、FAIL に上げず WARN 以下で備考に「既存債務(本変更非起因)」と明記する

### 対象ファイルの探索

1. `src/utils/JRAFetcher.ts`（唯一のネットワーク出口。URL 検証・User-Agent・タイムアウト・保存先）
2. `src/utils/HorseDataExtractor.ts` / `src/commands/ExtractData.ts`（外部 HTML の正規表現パース・JSON 出力）
3. `src/commands/ImportData.ts`（外部 JSON の読み込みと DB 投入）/ `src/index.ts`（CLI 引数の受け口）
4. `src/repositories/` 全体（SQL の組み立て）/ `src/database/DatabaseConnection.ts`
5. Grep: `db.prepare` / `db.exec` / `db.run` / `db.query`・`readFileSync` / `writeFileSync` / `mkdirSync`・`process.env`・`child_process` / `Bun.spawn` / `eval(` / `new Function`
6. `.gitignore` と `git ls-files` の突き合わせ（生成物がトラックされていないか）

### チェックリスト

#### 4.1 取得先の制限（SSRF）

- [ ] ネットワーク取得が `JRAFetcher` に一本化され、別経路で `http.get` / `https.get` / `fetch` を直に書いていないか
- [ ] 取得 URL がスキーム（http/https のみ）とホスト（`ALLOWED_HOST_SUFFIXES`）で検証され、**リクエスト前に**弾かれているか
- [ ] 許可ホストを増やす変更に理由があるか。ワイルドカード的な緩和（`endsWith('go.jp')` 等）になっていないか
- [ ] リダイレクトの扱いが明示されているか（現実装は `http.get` / `https.get` で自動追従しない。非 200 はエラー扱い。リダイレクト追従を足すなら追従先も再検証が要る）

**NG例**: CLI 引数の URL をそのまま `https.get(url)` に渡す（`file://` やイントラネットのホストを踏ませられる）
**OK例**: `JRAFetcher.validateUrl()` が `ALLOWED_HOST_SUFFIXES`（`['jra.go.jp']`）でスキームとホストを検証し、`fetchHTML` の冒頭で失敗を即返す

#### 4.2 スクレイピングの作法

- [ ] タイムアウトが設定され、超過時に接続が破棄されるか（`JRAFetcher` の `defaultOptions.timeout` = 30000ms と `request.setTimeout(...)` → `request.destroy()`）
- [ ] 複数 URL をループで取る経路（`src/utils/JRAFetcher.ts` を使う新規コマンド等）に、リクエスト間隔（sleep / レートリミット）が入っているか。間隔制御なしのループ取得・一括取得を新設・拡張する変更は WARN 以上
- [ ] User-Agent の扱いが妥当か（`JRAFetcher.defaultOptions.userAgent` はデスクトップ Chrome を騙る固定値。相手サイトの規約・robots の観点で、これを新たに増やす・偽装を強める変更は理由が要る）
- [ ] レスポンスのエンコーディング判定が壊れていないか（`JRAFetcher.convertEncoding` はオプション既定の Shift_JIS で decode し、未知指定時は Shift_JIS → UTF-8 のフォールバック。HTTP ヘッダの charset は見ていない点を踏まえた変更か）

**NG例**: 出馬表の全レースを for ループで連続取得し、sleep もタイムアウトも入れない（相手サイトへの負荷・アクセス遮断のリスク）
**OK例**: `JRAFetcher.fetchHTML` — `request.setTimeout(opts.timeout, ...)` で待ち続けずに `destroy()` する

#### 4.3 外部由来データを無検証で DB に入れていないか

- [ ] 外部 HTML のパース結果（`HorseDataExtractor`）と外部 JSON（`ImportData.importExtractedJSON`）が、DB 投入前に必須項目・型・値域を確認されているか
- [ ] `JSON.parse(...)` の結果に付けた型注釈を**検証済みの根拠にしていない**か（`ImportData.importExtractedJSON` の `const jsonData: ExtractedRaceData = JSON.parse(...)` はコンパイル時の断言にすぎず、実行時は何も保証しない）
- [ ] 数値変換（`Number` / `parseInt` / `parseFloat`）に NaN・範囲の防御があるか。欠損が `undefined` に落ちる設計なら、その `undefined` が DB 制約と整合するか
- [ ] パース失敗・欠損が警告として可視化されるか（`HorseDataExtractor.generateWarnings` は馬名欠落とオッズ0のみ。新しい必須項目を足すならここも増やす）
- [ ] 外部文字列をそのまま識別子・パス・SQL 断片として使っていないか（値としてバインドするのは可）

**NG例（現状 — 既存債務）**: `ImportData.importExtractedJSON` が `JSON.parse` の結果を型注釈だけで信用し、`jsonData.raceInfo` / `jsonData.horses` の存在も型も確認せずトランザクションに入れる
**OK例**: `src/index.ts` の `score` コマンド — `const raceId = parseInt(options.race, 10); if (isNaN(raceId)) { ... return; }` と、外部入力を使う前に明示的に弾いている

#### 4.4 SQL の組み立て

新規・変更クエリは **Kysely で組み立てる**（`src/database/QueryRunner.ts` の `queryBuilder`）。
値はビルダーがバインドパラメータにするため、SQL 本文に値が混ざらない。

- [ ] 新規・変更のクエリが Kysely で組み立てられているか。生の SQL 文字列を新たに増やしていないか（未移行のリポジトリの踏襲は既存債務として WARN 以下）
- [ ] テーブル名・カラム名・SQL 断片を変数で差し込む書き方を新規に増やしていないか（本番・テストとも）
- [ ] `db.exec(...)` に渡す SQL が静的文字列か（外部由来の値が混ざっていないか）
- [ ] 識別子をバインドできない場面（PRAGMA・DDL）で、差し込む値がそのファイルの定数に限られているか。バインドできる代替（`pragma_table_xinfo(?)` のようなテーブル値関数）が無いか検討したか

**NG例**: テーブル名や値を SQL 本文に補間する（`SELECT ... FROM ${table}` / `LIMIT ${limit}`）
**OK例**: `JockeyQueryRepository` — as-of の日付を `.where('races.race_date', '<', beforeDate)` で渡し、値は Kysely がバインドする

※ `sql.raw(` / `sql.lit(`・`db.prepare` 等への補間つきテンプレート・Kysely ビルダーの `.execute()` 系は
lint（error）が機械検出するため本項では見ない（一覧は review-code 2.1）。直接の `prepare` / `exec` / `query`
は移行途中のため warn。lint の通過確認は review-code 2.1。

#### 4.5 ファイルパスの扱い

- [ ] CLI 引数由来のパスで読み書きする箇所を新設していないか。新設するなら許可ディレクトリ配下に限定しているか（`..` や絶対パスを弾いているか）
- [ ] 書き込み先ディレクトリの自動生成（`mkdirSync(..., { recursive: true })`）が、検証していないパスに対して行われていないか
- [ ] 出力ファイル名が固定値で足りる場面で、わざわざ外部から受け取る形にしていないか
- [ ] DB ファイルパスがテスト差し替え用の任意引数にとどまり、CLI から任意パスを本番 DB として開けるようになっていないか（`DatabaseConnection` の既定 `./arima.db`）

**NG例（現状 — 既存債務）**: `fetch-jra` の `-o/--output`（`src/index.ts`）が検証なしで `JRAFetcher.saveToFile` の `writeFileSync` / `mkdirSync` まで届き、`../` を含むパスや絶対パスもそのまま書き込める
**OK例**: `src/commands/ExtractData.ts` — 出力先を `'data/horse-extracted-data.json'` の固定値にして、外部からパスを受け取らない

#### 4.6 生成物・秘密情報をリポジトリに入れていないか

- [ ] 生成物（`*.db` / `*.sqlite` / `data/extracted-*.json` / `data/horse-extracted-data.json` / `data/jra-page.html`）が `.gitignore` に残っており、差分に混ざっていないか
- [ ] 出力先のファイル名を変える変更は `.gitignore` も同時に更新しているか（無視パターンと実際の出力パスがズレると生成物がコミットされる）
- [ ] `.env` を読み書きするコード・スクリプトを追加していないか（このリポジトリでは hook でブロックされる運用。確認は Read ツールで行う）
- [ ] 認証情報・トークン・API キーをコードに直書きしていないか（**新たに持ち込む変更は必ず指摘対象**）
- [ ] テスト用の一時 DB ファイルが後片付けされ、コミット対象に残らないか

**NG例**: 抽出 JSON の出力先を `data/extracted-2025.json` から `output/race.json` に変えたが `.gitignore` を更新せず、取得データがそのままコミットされる
**OK例**: `.gitignore` の `data/extracted-*.json` / `data/horse-extracted-data.json` / `data/jra-page.html` が、`ExtractData` と `JRAFetcher.fetchAndSave` の実際の既定出力パスと一致している

#### 4.7 実行系・動的評価の非導入

- [ ] `child_process` / `Bun.spawn` を新たに導入していないか（`eval()` / `new Function` / 文字列を渡す `setTimeout` は lint（`security/noGlobalEval`・`nursery/noImpliedEval` = error）が落とすため本項では見ない。lint の通過確認は review-code 2.1）
- [ ] 動的 `import()` のパスが静的なリテラルのままか（外部入力・CLI 引数から組み立てていないか）
- [ ] 外部由来の文字列をシェルコマンド・正規表現の組み立てに使っていないか（外部入力から作る正規表現は ReDoS の入口にもなる）

**NG例**: 取り込み元の指定を `await import(userSuppliedPath)` で解決する（任意コード実行に直結する）
**OK例**: `ImportData` の `await import('@/utils/HorseDataExtractor')` のように、遅延読み込みでもパスは静的リテラル

### 判定基準

- **OK**: 当該項目が判定する経路が差分にあり、防御が保たれている（適合の積極的根拠がある）。「違反が無いから OK」ではなく「該当する経路があって適合している」ときに OK を付ける
- **WARN**: 直ちに悪用はされないが防御が単層・将来の変更で破れる（検証の無いパス受け取り、間隔制御の無い取得、警告出力の欠落、既存債務の踏襲）
- **FAIL**: URL 検証の削除・骨抜き、SQL への値の直接補間の新設、外部由来値でのパス・識別子・コマンド組み立て、秘密情報の直書き、生成物や `.env` の差分混入
- **N-A**: 該当する経路が差分スコープに存在せず評価不能（備考に根拠を記載）。差分外の既存実装は「OK(既存)」とせず N-A にして Summary から除外する。「違反が無い」だけで OK にせず、判定対象そのものが無ければ N-A にする。複数サブチェックを持つ項目（例 4.3・4.4）は、いずれかのサブチェックに該当する対象が差分にあればその適否で OK/WARN/FAIL を付け、どのサブチェックの対象も差分に無ければ N-A とする

### SKIPPED 条件

- 外部データ取得・取り込み・SQL・ファイル入出力・依存パッケージのいずれにも関わらない変更（ドキュメントのみ、スコア計算式のみ等）の場合 `Summary: SKIPPED`

### 本スキルの責務境界

- 層配置・依存方向は **review-arch**、エラーハンドリングの書き方やコード品質は **review-code**、スコア計算の正しさは **review-scoring**、検証の回帰テストの有無は **review-test**、再実行時の一貫性は **review-recovery**
- `eval` / `new Function` / 文字列 `setTimeout` の非導入、`sql.raw` / `sql.lit` の不使用、SQL への補間つきテンプレートの不使用は lint（error）が担保するため本スキルでは見ない。lint の通過確認は review-code 2.1
- チェック表の行は SKILL.md のチェックリスト項目のみで構成する。**チェックリストに無い独自の行を表に追加しない**（チェック項目外の気づきは「他観点への申し送り」へ。自観点に関連するが項目化されていない所見は「詳細所見」に書き、Summary には数えない）
- 表には**全チェックリスト項目（4.1〜4.7）を採番項目単位で列挙する**（チェックボックスごとに a/b/c へ分割しない）。該当変更が無い項目も N-A 行として残し省略しない（レビュー網羅性の担保）。Summary には OK/WARN/FAIL の行のみ計上し N-A は除外する
- 同一の行・欠陥でも、**自観点のチェックリスト項目に明示的に該当する側面**だけを自分の表・Summary に計上する（多面評価は可）。チェックリストの項目名から読めない拡大解釈（docs や一般原則からの引き込み）で FAIL を増やさない
- 自観点の項目に該当しない問題は計上せず、レポート末尾の「### 他観点への申し送り」節に「対象スキル名: 1行説明」で記載するだけにする（FAIL/WARN を付けない）
- 同一事象が自観点の複数チェック項目に該当する場合は、最も特異的な 1 項目だけで計上し、他項目は備考で相互参照する（Summary で重複カウントしない）。**特異性の判定**: 違反の根本原因を最も具体的に名指す項目を選ぶ（例: 未検証の CLI パスで外部 HTML を書き出す事象は『ファイルパスの扱い』4.5 が根本で、取得側 4.1 は備考）。優劣が付けにくいときは**チェックリスト番号の小さい方**で計上する（決定論的に揃える）
- 差分内コードが依存する差分外の既存実装は、確認してよいが新たな指摘対象にはしない（当該チェック項目を OK とし、備考に「依存先は差分外・確認済み」と書く）

### レポート形式

```
## セキュリティ レビュー結果

| # | チェック項目 | ステータス   | 該当箇所  | 備考 |
| - | ------------ | ------------ | --------- | ---- |

### 詳細所見
### 推奨アクション
- HIGH / MEDIUM / LOW（該当が無い優先度は「なし」と明示）
```

### Summary 行（必須・review-all 集計用）

レポート末尾に必ず以下の 1 行を出力する:

```
Summary: OK=<n> WARN=<n> FAIL=<n>
```

- カウントは N-A を除いたチェック項目テーブルの行数と一致させる。レビュー対象不在時のみ `Summary: SKIPPED`
