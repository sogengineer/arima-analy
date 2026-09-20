---
name: review-test
description: "テスト品質のレビュー（bun:test）。`bun test` の全通過、エンティティのビルダー直接検証と createTestDb による実 SQLite E2E の使い分け、実ネットワーク（JRA）非依存、回帰テストの存在（ImportData の一致条件・枠番の JRA 割当規則・生年計算）、回帰テストの削除/skip 化の禁止、新機能・バグ修正へのテスト追随、契約の検証 vs 実装詳細への過剰結合、console spy と一時ファイルの後始末を検証。Use when user says 'テストレビュー', 'review test', 'テスト品質チェック', or 'カバレッジ確認'."
---

## Instructions

`src/**/__test__/` と `src/test/helpers/` を探索し、テストの品質と網羅をレビューする。

### 対象スコープと指摘範囲

起動時に「対象スコープ」と「対象ファイル一覧」が渡される場合がある（review-all 等からの dispatch 時）。その扱いは次の通り:

- **探索は広く、指摘は狭く**: 文脈把握のための Glob/Grep/Read はプロジェクト全体に対して行ってよい。ただしテーブルに載せる WARN/FAIL は対象ファイル一覧内の事象（および「対象ファイルの変更に対してテストが無い」ことの指摘）に限定する
- **該当ファイル不在の項目**: 評価対象が無い項目は OK として計上しない（テーブルにステータス `N-A` で残し、備考に根拠を書く。行を省かない）
- **自観点の評価対象が皆無**: 判断根拠 1 行 + `Summary: SKIPPED` の最小出力でよい（テーブル骨格は不要）
- **スコープ未指定時**: プロジェクト全体（`node_modules/` は除外）を対象にする
- **一覧に実在しないファイルがある場合**: 除外して続行し、詳細所見に 1 行明記する
- 既存のテスト欠落（差分外・本変更で未変更のファイル）は**既存債務**として扱い、FAIL に上げず WARN 以下で備考に「既存債務(本変更非起因)」と明記する

### 対象ファイルの探索

1. `src/**/__test__/` 配下の全テストファイル（テストは実装と併置されている）
2. `src/test/helpers/testDb.ts`（`createTestDb` / `seedTestData` / `getTestDbPath`）
3. レビュー開始時に `bun test` を 1 回流し、pass 件数とテストファイル数のベースラインをその場で取る（件数は常に動くので本スキルには書かない）。base との比較が要るときは base 側でも同じコマンドを流す
4. 今回の変更差分に対応するテストファイルの有無を突き合わせる
5. Grep: `todo(` / コメントアウトされた `it(` `describe(`（`.skip` / `.only` は lint が error で落とすため Grep 不要）

### チェックリスト

#### 5.1 実行と独立性

- [ ] `bun test` が全通過し、pass 件数がベースラインから減っていないか（失敗・タイムアウトを残していないか）
- [ ] テストが実ネットワークを叩いていないか。**JRA サイトへの実アクセスは禁止**（`JRAFetcher` をテストから呼ぶ場合は、必ず取得済み HTML 文字列やローカルファイルを入力にする）
- [ ] テストごとに DB が作り直され、テスト間で状態を共有していないか（`beforeEach` で `createTestDb`、`afterEach` で `cleanup`）
- [ ] 実行順序に依存していないか（前のテストが入れたデータを前提にしていないか）
- [ ] 実時間待ち（`setTimeout` での待機）に依存していないか

**NG例**: `describe` の外や `beforeAll` で 1 個の DB を作り、全テストが同じ DB に書き込む（順序が変わると落ちる・落ちた原因が特定できない）
**OK例**: `src/commands/__test__/CalculateScore.e2e.test.ts` — `beforeEach` で `createTestDb('calculate-score')`、`afterEach` で `testDb.cleanup()`

#### 5.2 テストの組み立て方（ビルダー / 実 SQLite の使い分け）

- [ ] 純粋なエンティティ・値オブジェクト（`Horse` / `Jockey` / `Trainer` / `RaceResult` / `ScoreComponents`）のテストが、DB を使わずビルダー（`Horse.builder(...)` 等）で組んで直接検証しているか
- [ ] DB が絡むもの（リポジトリ・オーケストレーター・コマンド）は `createTestDb`（`src/test/helpers/testDb.ts`）で**実 SQLite**を使う E2E になっているか（スキーマは本番の `schema.sql` をそのまま適用する）
- [ ] 共通のシードが必要なら `seedTestData(testDb, ...)`（`src/test/helpers/testDb.ts`）や `src/test/helpers/syntheticRaces.ts` を使い、各テストで同じ INSERT を書き散らしていないか
- [ ] `mock.module` / モジュール差し替えに頼っていないか（新規に導入する変更は、実 SQLite やビルダーで代替できないか必ず検討する）
- [ ] 新しいテスト用ヘルパーを作る前に `src/test/helpers/testDb.ts` に置けないか検討しているか（各テストファイルにローカル factory が重複していないか）

**NG例**: リポジトリのテストで SQL 実行を差し替えたフェイクを注入する（スキーマ制約・JOIN・`ON CONFLICT` の挙動という検証したい対象そのものが消える）
**OK例**: `src/domain/entities/__test__/Horse.test.ts` — `Horse.builder(1, 'テスト馬').withRaceResults(results).build()` で DB 無しにスコア計算だけを検証する

#### 5.3 実害バグ由来の回帰テストが残っているか

過去に実際に起きた問題の回帰テスト。**削除・`skip` 化・弱体化は FAIL**（既存の回帰テストを消す変更は、消す理由をレビューで説明させる）:

- [ ] ImportData の一致条件（インポートの二重登録を防ぐ規則）— `src/commands/__test__/ImportData.test.ts`。馬=馬名+父+母、レース=開催日+会場+レース番号、出馬表=レースID+馬ID、レース結果=エントリID、騎手は getOrCreate で更新しない
- [ ] 枠番の JRA 割当規則 — `src/utils/__test__/HorseDataExtractor.test.ts` の境界頭数（8頭以下 / 9頭 / 12頭 / 14頭 / 16頭 / 17頭 / 18頭）と、HTML パースを通した E2E
- [ ] 枠番の補完経路が一致すること — `src/domain/services/__test__/ScoringOrchestrator.test.ts`（`calculateScoresForRace` / `calculateScoreForEntry` / 特徴量抽出の `postPositionScore` が揃う）
- [ ] 生年をレース開催年から計算すること（現在年基準だと過去レースの再インポートで生年がずれる）— `src/commands/__test__/ImportData.test.ts`
- [ ] 再インポートで統計が二重計上されないこと — `src/commands/__test__/ImportData.test.ts` の統計再構築まわりのアサーション
- [ ] as-of カットオフによる未来情報リークの遮断 — `src/domain/services/__test__/AsOfLeakage.test.ts`（対象レース／後続レースの結果を投入してもスコアと特徴量が変わらない、`getHorseRaceResults` の同日除外、as-of 集計が集計テーブルを参照しない）、`src/features/__test__/FeatureBuilder.test.ts` の `asOf` 明示、`src/models/__test__/MachineLearningModel.e2e.test.ts` のリーク遮断（学習経路）
- [ ] `todo` / コメントアウトされたテストを新たに増やしていないか（一時的に無効化するなら理由と復活条件をコメントに残す）
- ※ `.skip` / `.only` の残存は lint（`suspicious/noSkippedTests`・`noFocusedTests` = error）が落とすため本項では見ない。lint の通過確認は review-code 2.1

**NG例**: `describe.skip('ImportData - インポート機能', ...)` のようにブロックごと無効化して緑にする（過去に回帰テストが長期間この状態で死んでいた事例がある。現在は lint が error で落とす）
**OK例**: 実装の API が変わったときは無効化せずテスト側を新 API（`HorseAggregateRepository` / `RaceAggregateRepository`）に書き換えて生かす

#### 5.4 変更へのテスト追随

- [ ] 新機能に対応するテストが同一変更内で追加されているか
- [ ] バグ修正に「そのバグを再現する失敗→修正で通る」再発防止テストが**同じ変更で**付いているか（後追いコミットに回さない）
- [ ] 計算式・定数・スコア要素を変えたなら、期待値を持つテストが更新されているか（更新せずに通ってしまうなら、そのテストが計算を検証できていない可能性を疑う）
- [ ] 機能削除時に対応テストも削除されているか（消し残しテストが偽の安心を与えていないか）
- [ ] テストが無いまま修正された箇所を新たに触る場合、ついでにテストを足せないか検討したか

**NG例**: 計算バグの修正が本番ファイルだけを変更し `__test__` の変更がゼロ（過去に `JockeyQueryRepository` の複勝/連対の取り違え修正がこの形で入り、回帰テストが付かないまま残っている）
**OK例**: 枠番を JRA の割当規則から計算する変更が、実装と同時に `src/utils/__test__/HorseDataExtractor.test.ts` を新規追加し、境界頭数を全部押さえている

#### 5.5 契約の検証 vs 実装詳細への結合

- [ ] テストが外部から観測できる契約（戻り値・保存された DB の状態・スコアの値）を検証し、private な中間状態や呼び出し回数に過剰結合していないか
- [ ] 表示文字列（`console.log` の整形結果）の完全一致に依存していないか（文言変更で壊れすぎるテストは WARN。検証したいのが数値なら数値を検証する）
- [ ] スコアの検証が「0〜100 に入る」だけで終わっていないか（境界・具体値・大小関係のいずれかを押さえているか）
- [ ] テストが本番コードのロジックをテスト内に再実装して比較していないか（同じ間違いをすれば両方とも通る）
- [ ] エラー時に `catch` で握り潰される経路（`Backtest.evaluateRace` 等）を、握り潰されていないことまで検証しているか

**NG例**: テストファイル内に着順スコアの計算式を書き写し、本番の戻り値と突き合わせる（式のバグは検出できない）
**OK例**: `src/commands/__test__/ImportData.test.ts` の E2E — `spyOn(console, 'error')` を取って「エラーが 1 件も出ていないこと」を契約として検証する

#### 5.6 副作用の後始末

- [ ] `spyOn(console, ...)` が必ず `afterEach` の `jest.restoreAllMocks()` 等で復元されているか（復元漏れは後続テストの出力を黙らせ、失敗原因を隠す）
- [ ] `createTestDb` で作った DB が `cleanup()` で削除されるか（`close()` だけだとファイルが残る）
- [ ] テストが書き出す一時ファイルが、テスト終了時に必ず消えるか。**リポジトリ直下に作る一時ファイルは `.gitignore` の対象かを確認する**（`*.db` は無視されるが、`./test-*.json` のような JSON は無視されない）
- [ ] 一時ファイル名が衝突しないか（並列実行・連続実行で同名を奪い合わないか）

**NG例（現状 — 既存債務）**: `src/commands/__test__/ImportData.test.ts` の `./test-importdata-e2e.json` はリポジトリ直下に作られ `.gitignore` に該当パターンが無いため、テストが途中で落ちると未追跡ファイルが残る
**OK例**: `src/commands/__test__/Backtest.e2e.test.ts` — `beforeEach` で console を黙らせ、`afterEach` で `jest.restoreAllMocks()` して必ず戻す

#### 5.7 テストが無い領域への追随

- [ ] 今回変更したファイルに対応するテストファイルが存在するか。無い場合、新規に作れない理由があるか
- [ ] 「テストは別ファイルにある」と書いたコメントが実在するファイルを指しているか（実在しない約束はテストがあるかのように誤読される）
- [ ] 外部 I/O に依存して従来テストしづらかった箇所（`JRAFetcher` / `ExtractData` / CLI 配線）を触るなら、入力を文字列・ローカルファイルに切り出してテスト可能にできないか検討したか
- [ ] テストが無い領域（`Predict` / `RebuildStats` / `JRAFetcher` / `Score.ts` / `Race.ts` 等。対応する `__test__` の有無を Glob で確認する）を変更する場合、少なくとも変更した振る舞いの 1 本は足しているか
- [ ] **as-of の直接テストが無い経路**（`HorseQueryRepository.getHorsesRaceResultsBatch` のバッチ版 `beforeDate`、`JockeyQueryRepository.getJockeyVenueStats` / `getJockeyOverallStats` / `getJockeyTrainerStats` の `beforeDate`）に変更を入れるなら、基準日より後のデータを投入しても結果が変わらないことを確かめるテストを同じ変更で足しているか（現在は `ScoringOrchestrator` 経由の間接検証しかない）

**NG例**: 「テストは別ファイルで実施」と書きながらその別ファイルが存在せず、当該メソッドが未検証のまま残る
**OK例**: `src/domain/services/__test__/ScoringOrchestrator.test.ts` — DB を伴う経路でも `createTestDb` で複数経路の一致を検証している

### 判定基準

- **OK**: 当該項目が判定するテストが差分にあり、期待通りに揃っている（適合の積極的根拠がある）。「違反が無いから OK」ではなく「該当するテストがあって適合している」ときに OK を付ける
- **WARN**: テストはあるが弱い（表示文字列の完全一致依存、値域だけの検証、後始末が手動、既存の未カバー領域の踏襲）
- **FAIL**: `bun test` 不通過、回帰テスト（5.3）の削除・skip 化・弱体化、新機能やバグ修正にテストなし、テストからの実ネットワークアクセス、テスト間の状態共有による順序依存
- **N-A**: 該当実装なし、または差分スコープに当該観点の変更がない（備考に根拠を記載）。差分外の既存実装は「OK(既存)」とせず N-A にして Summary から除外する。「違反が無い」だけで OK にせず、判定対象そのものが無ければ N-A にする。複数サブチェックを持つ項目（例 5.1・5.3）は、いずれかのサブチェックに該当する対象が差分にあればその適否で OK/WARN/FAIL を付け、どのサブチェックの対象も差分に無ければ N-A とする

### SKIPPED 条件

- コード変更がドキュメントのみの場合 `Summary: SKIPPED`

### 本スキルの責務境界

- テスト対象のロジックの正しさ自体は各観点スキル（スコアリング / ML は **review-scoring**、取り込み経路の安全性は **review-security**、時刻依存は **review-recovery**）。本スキルは「テストが在るか・独立しているか・契約を検証しているか」のみ
- テストコードの命名は **review-naming**、テストコードのスタイル・型・lint は **review-code**、テスト内コメントの過不足は **review-comments**、テストの置き場所（`__test__/` 併置）は **review-arch**
- `.skip` / `.only` の残存は lint（`suspicious/noSkippedTests`・`noFocusedTests` = error）が担保するため本スキルでは見ない。lint の通過確認は review-code 2.1
- チェック表の行は SKILL.md のチェックリスト項目のみで構成する。**チェックリストに無い独自の行を表に追加しない**（チェック項目外の気づきは「他観点への申し送り」へ。自観点に関連するが項目化されていない所見は「詳細所見」に書き、Summary には数えない）
- 表には**全チェックリスト項目（5.1〜5.7）を採番項目単位で列挙する**（チェックボックスごとに a/b/c へ分割しない）。該当変更が無い項目も N-A 行として残し省略しない（レビュー網羅性の担保）。Summary には OK/WARN/FAIL の行のみ計上し N-A は除外する
- 同一の行・欠陥でも、**自観点のチェックリスト項目に明示的に該当する側面**だけを自分の表・Summary に計上する（多面評価は可）。チェックリストの項目名から読めない拡大解釈（docs や一般原則からの引き込み）で FAIL を増やさない
- 自観点の項目に該当しない問題は計上せず、レポート末尾の「### 他観点への申し送り」節に「対象スキル名: 1行説明」で記載するだけにする（FAIL/WARN を付けない）
- 同一事象が自観点の複数チェック項目に該当する場合は、最も特異的な 1 項目だけで計上し、他項目は備考で相互参照する（Summary で重複カウントしない）。**特異性の判定**: 違反の根本原因を最も具体的に名指す項目を選ぶ（例: 回帰テストの skip 化は『回帰テスト』5.3 が根本で、同時に変更追随が無いように見えても 5.4 は備考）。優劣が付けにくいときは**チェックリスト番号の小さい方**で計上する（決定論的に揃える）
- 差分内コードが依存する差分外の既存実装は、確認してよいが新たな指摘対象にはしない（当該チェック項目を OK とし、備考に「依存先は差分外・確認済み」と書く）

### レポート形式

```
## テスト品質 レビュー結果

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
