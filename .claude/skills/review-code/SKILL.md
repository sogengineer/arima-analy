---
name: review-code
description: "有馬記念分析システム（Bun + TypeScript CLI）のコード品質・コードスタイルレビュー。機械検証の通過（bun run c / bun run lint / bun test）、非推奨 API の使用、死にコード・消し残し、マジックナンバーと固定語彙の constants 集約、コメントの why 品質（足し算側）、既定値・フォールバックの規律、非同期とエラーハンドリング（握り潰し catch・await 漏れ）、関数構成とファイル構成（メイン関数先頭・400行）、制御フロー（条件連鎖・ガード節の羅列）、コレクション操作（reduce・entries・長チェーン）、否定条件 + else、オーケストレーションの平坦化、型安全（any・as）、import の一貫性、CLI 出力（console）の置き場所を検証。Use when user says 'コードレビュー', 'review code', '規約チェック', 'スタイルチェック', or '死にコード確認'."
---

## Instructions

`src/` 配下の TypeScript を探索し、`docs/DEVELOPMENT.md` のコーディング規約と以下のチェックリストに基づいてレビューする。

### 対象ファイルの探索

1. `src/`（`src/commands/__test__/` `src/domain/**/__test__/` `src/models/__test__/` `src/test/` を含む）を Glob で探索する
2. `package.json` の scripts（`c` / `lint` / `test`）と `biome.json`（および `biome-plugins/*.grit`）のルール設定を確認する
3. 型チェックは **必ず `bun run c`** で実行する（`bun c` は `bun create` と解釈されて失敗する）。lint は `bun run lint`、テストは `bun test`

### チェックリスト

#### 2.1 機械検証の通過

> **ベースラインはレビュー開始時にその場で取る**。`bun run lint` と `bun test` を 1 回流し、warning 件数とテスト pass 件数を控える。base（比較対象リビジョン）と変更後で差分を見たいときは、base 側でも同じ 2 コマンドを流して比較する。件数は日々動くので本スキルには数値を書かない。

- [ ] `bun run c`（型チェック）がエラーゼロか
- [ ] `bun run lint`（Biome）が **error ゼロ**か（error が 1 件でもあれば FAIL）
- [ ] lint の **warning が base から純増していないか**（純増は WARN。減るのは歓迎で、既存 warning の残存そのものは指摘しない）
- [ ] `bun test` が全通過し、pass 件数が base から減っていないか（減った・落ちた場合は FAIL）
- [ ] lint ルールの緩和（`biome.json` での `off` 化・severity 引き下げ・`// biome-ignore` コメントの追加・`biome-plugins/*.grit` の弱体化・`overrides` の除外追加）で警告を回避していないか

**lint（error レベル）が担保する規約** — 以下は Biome が機械検出するため、各レビュースキルのチェックリストからは外してある。本項で `bun run lint` の error ゼロを確認することが、そのまま以下の担保になる:

| ルール | 担保する規約 |
| --- | --- |
| `style/noRestrictedImports`（`src/domain/**`） | domain 層は commands を import しない |
| `style/noRestrictedImports`（`src/domain/entities/**` `src/domain/valueObjects/**`） | entities / valueObjects は `bun:sqlite`・repositories・database・commands・models・utils・node の fs / http / child_process を import しない（純粋性） |
| `suspicious/noConsole`（`src/domain/entities/**` `src/domain/valueObjects/**`） | entities / valueObjects に `console` 出力を持ち込まない |
| `style/noRestrictedImports`（`src/repositories/**`） | repositories は commands / models / domain に依存しない |
| `style/noRestrictedImports`（`src/constants/**` `src/types/**`） | constants / types は依存の末端で、他層を import しない |
| `style/noRestrictedImports`（`src/models/**` `src/utils/**` `src/features/**` `src/database/**`） | 下位層は commands を import しない（依存は `index.ts → commands → 下位層` の一方向） |
| plugin `no-database-connection-construction` | `new DatabaseConnection(...)` は commands / `src/index.ts` / models のフォールバック / `src/database` のファクトリ / テストのみ |
| `suspicious/noFocusedTests` / `suspicious/noSkippedTests` | `.only` / `.skip` をテストに残さない |
| `security/noGlobalEval` / `nursery/noImpliedEval` | `eval()` / `new Function` / 文字列を渡す `setTimeout` を導入しない |
| `nursery/noExcessiveNestedCallbacks` | コールバックのネストは 3 段まで（`__test__` / `src/test/` は除外） |
| `style/noRestrictedImports`（`kysely`） | Kysely は repositories / database 層だけで使う（domain / commands / models / features / utils / constants / types からは禁止） |
| `style/noRestrictedImports`（`src/database/QueryRunner`） | `QueryRunner`（`queryBuilder` と実行ヘルパー）は repositories / database 層とテストだけで import する |
| plugin `no-kysely-builder-execution` | Kysely ビルダーの `.execute()` / `.executeTakeFirst()` / `.executeTakeFirstOrThrow()` / `.stream()` を呼ばない（DummyDriver のため空の結果が返る。実行は `src/database/QueryRunner.ts` のヘルパー経由） |
| plugin `no-kysely-raw-sql` | `sql.raw(` / `sql.lit(` を使わない（`sql` タグ付きテンプレートの `${value}` はバインドされるので可） |
| plugin `no-sql-template-interpolation` | `db.prepare` / `db.exec` / `db.query` に補間つきテンプレートを渡さない（`?` の並びを組み立てる `placeholders` 変数は除く） |
| plugin `no-ambient-time`（`src/domain/**`） | domain 層で引数なしの `new Date()` / `Date.now()` を使わない |
| plugin `no-reduce-entries` | `reduce` / `.entries()` を使わない |
| plugin `no-js-import-extension` | 内部モジュールの import に `.js` 拡張子を付けない（`./` と `@/` の両方） |
| plugin `no-parent-relative-import` | ディレクトリをまたぐ import は `@/` で書く（`../` で親をたどらない。静的 import・再 export・動的 import が対象） |
| plugin `no-direct-statement-preparation` | `db.prepare` / `db.exec` / `db.query` を直接呼ばない（`src/database/**`・テスト・テストヘルパは対象外。クエリは Kysely で組み立て実行ヘルパーに渡す） |


**lint が見ないもの**（引き続き人手で見る）: ブロックのネスト深さ、命名規約（Biome の `useNamingConvention` は本リポジトリの日本語混在・DB カラム名由来の識別子で誤検出が大量に出るため不採用）、import の並び順（assist の `organizeImports` は書き換えを伴うため無効）。

#### 2.2 非推奨 API（deprecated）

- [ ] 使用 API に `@deprecated` が付いていないか（型定義の JSDoc / エディタの取り消し線を確認）
- [ ] リポジトリ内の `@deprecated` 付きメソッドを新規コードから呼んでいないか
- [ ] 新規ライブラリ採用時に現行安定版・後継 API を確認したか

**NG例**: `MachineLearningModel.optimizeWeights`（`@deprecated`・「予測には使わない。説明用の in-sample 射影」と明記）の戻り値を、新しい予測経路から使う
**OK例**: 予測は `MachineLearningModel.predict()` / `walkForwardValidate()`、特徴量取得は `FeatureBuilder.buildForRace(raceId, asOf)` / `extractFeaturesForRace(horseId, raceId, asOf)` を使い、`null` を呼び出し側で扱う

#### 2.3 死にコード・消し残し

- [ ] 参照ゼロの型・関数・定数・テスト補助が残っていないか（機能削除後の取り残し）。ローカル変数・import の未使用は `bun run lint` の `correctness/noUnusedVariables` / `noUnusedImports`（warn）の該当件数が本変更で純増していないかで見る。**export された未使用シンボル（未参照の定数モジュール等）は lint が検出しない**ので、こちらは Grep で確認する
- [ ] 削除した機能への参照が `docs/` 配下・`src/database/schema.sql`・CLI のコマンド定義（`src/index.ts`）に残っていないか
- [ ] コメントアウトされた旧コード・デバッグ目的の一時出力・理由の無い TODO が放置されていないか
- [ ] **重大度の目安**: 参照ゼロの死にコードは実害（参照切れ・誤動作・ビルド破壊）が無ければ **WARN**、削除機能への参照残存など実害があれば **FAIL**

**NG例**: `src/domain/services/ScoringOrchestrator.ts` の `// TODO: Trainerエンティティの構築は将来実装` — 実装保留の TODO とコメントアウトされた旧コードが同居（既存債務。**コメントの引き算そのものは review-comments 管轄**で、本項は「機能削除・実装保留に伴う消し残し」としてのみ見る）
**OK例**: 削除時に Grep で全参照（コード・`docs/`・スキーマ・CLI 定義）を洗い、同一変更で除去する

#### 2.4 マジックナンバー・固定語彙

- [ ] スコアの重み・閾値・既定スコア・補正係数が `src/constants/` の定数になっているか（`src/constants/ScoringConstants.ts` / `DistanceConstants.ts` / `MLConstants.ts`）
- [ ] ドメインの**固定語彙**（馬場状態 `良`/`稍重`/`重`/`不良`、レース種別 `芝`/`ダート`/`障害`、会場名、G1 レース名）がロジック中に配列リテラル・文字列リテラルで散らばっていないか。語彙集合は constants に置き、判定は名前の付いた述語にまとめる
- [ ] ※ 定数が**どこに 1 箇所だけ定義されるか**という配置の正しさは review-arch 1.5 管轄。本項は「ロジック中に裸の数値・語彙が残っていないか」を見る（同一事象は review-arch 1.5 を優先し、本項は備考で相互参照する）

**NG例**: `Horse.calculateVenueAptitudeScore` の `if (venueStats.runs === 0) return 50;`（初出走馬の既定スコア 50 が裸のリテラル）／`ImportData.parseTrackCondition` の `['良', '稍重', '重', '不良'].includes(condition)`（馬場状態の語彙がインラインの配列リテラル）
**OK例**: `Horse.calculateDistanceAptitudeScore` の `DISTANCE_THRESHOLDS.aptitudeRange`、`Horse.calculateLast3FAbilityScore` の `LAST_3F_PARAMS.baseTime` のように constants から名前付きで引く

#### 2.5 コメントの why 品質（省略が既定）

コメントは**省略が既定**。コードは名前と構造で語らせ、コメントは「**コードから導出できない事実**」（why・不変条件・責務の所在・戻り値の特殊な意味）を言うときだけ 1 行で足す。判定軸は「付いているか」ではなく「**その1行がコードに無い意味を持つか**」。過剰・不要・陳腐化の**引き算は review-comments の責務**（足りない why=本項 / 多すぎ・不要=review-comments で切り分ける）。

- [ ] コメントが「何をするか（what の再掲）」でなく「**なぜそうするか / コードに現れない制約 / 責務の所在**」を書いているか
- [ ] 名前・型シグネチャから自明な関数・getter・ブロックに、同義のコメントを重ねていないか（自明なら**付けないのが正**）
- [ ] 非自明な既定値・補正の**根拠**が 1 行で書かれているか（「なぜ 50 か」「なぜ信頼度補正を掛けるか」）
- [ ] 公開エントリポイント級（command の `execute`、`ScoringOrchestrator.calculateScoresForRace`）**だけ**、骨格数ステップのフローコメントや `@remarks` を許容する
- [ ] ファイルヘッダは 3〜5 行程度で「この層で何を担い、なぜこの設計か」の要点だけか

**NG例**: `src/domain/entities/Horse.ts` のプロパティアクセサ区画 — `/** 馬ID */ get id()` のように getter 名と同義の JSDoc が並ぶ
**OK例**: `Horse.calculateVenueAptitudeScore` 冒頭の `// 芝ダ・距離カテゴリ別の集計を会場単位に合算する。` と `// 会場での出走実績がない場合は中間値を返す（初出走馬対応）`（コードから読めない意図を 1 行で述べている）

#### 2.6 既定値・フォールバックの規律

- [ ] データ欠損時の既定値（未出走の中間値、上がり3F 欠損時の推定）が**欠損時のみ**発動し、正常系を上書きしていないか
- [ ] 欠損フォールバックが発動したことを、利用者または呼び出し側が区別できるか（「データが無くて 50 点」と「実力で 50 点」を取り違えない形になっているか）
- [ ] 役目を終えた後方互換の既定値・暫定値が削除されているか（残す場合は理由を備考に）

**NG例**: 特徴量取得に失敗したとき全要素を中間値（50）で埋めて返す（予測がデータ欠損由来か実力由来か判別できなくなる）
**OK例**: `MachineLearningModel.extractFeaturesForRace` / `FeatureBuilder.buildForRace` は取得に失敗した馬を `null` で返し、呼び出し側が対象から除外できる

#### 2.7 非同期・エラーハンドリング

- [ ] `async` メソッドの呼び出しに `await` が付いているか（`src/index.ts` の各 action は `await command.execute()` の形が正）。`bun run lint` の `nursery/noFloatingPromises`（warn）の該当件数が本変更で純増していないかを見る
- [ ] **例外を握り潰す `catch {}` を増やしていないか**。握り潰す場合は、原因を出力するか、縮退したことが利用者に分かる形にする
- [ ] ドメイン上の異常（レース未登録・出走馬ゼロ）と予期しない例外が区別されているか（`ScoringOrchestrator.calculateScoresForRace` の `throw new Error('Race not found: ...')` が前例）
- [ ] 外部 HTTP 取得（`src/utils/JRAFetcher.ts`）に明示的なタイムアウトと失敗時の後始末があるか
- [ ] `process.exit` を CLI エントリ（`src/index.ts` / コマンド入口）以外の深い層で呼んでいないか

**NG例**: `MachineLearningModel` / `Backtest` / `JRAFetcher` に残る `} catch { return null; }` — 失敗理由が一切残らない（既存債務。**新規に同型を増やさない**。件数は Grep `catch {` で確認する）
**OK例**: `catch (error) { console.error('スコア計算に失敗:', error); }` のように原因を残したうえで縮退する（`CalculateScore.execute` の catch が前例）

#### 2.8 関数構成・ファイル構成

- [ ] クラスの**公開メソッド（`execute` / 主要な計算）を上に、private ヘルパを下に**置いているか
- [ ] 論理ブロックごとの区切りコメント（`// ===== プロパティアクセサ =====` 等）でファイルを上から追える形になっているか（`src/domain/entities/Horse.ts` の区画コメントが前例）
- [ ] ファイル長（400 行）・関数長（80 行）・認知的複雑度（15）は `bun run lint` の `style/noExcessiveLinesPerFile` / `complexity/noExcessiveLinesPerFunction` / `complexity/noExcessiveCognitiveComplexity`（いずれも warn。`__test__` は除外）が機械検出する。**該当ルールの warning が本変更で純増していないか**を見る（既に超過しているファイルをさらに長くした場合も純増側に現れる）
- [ ] 単一クラスの凝集度が高い場合は無理な分割をしない（区切りコメントがあれば許容）

#### 2.9 制御フロー（条件の連鎖・条件の命名）

- [ ] `||` / `&&` の長い連鎖で判定を組み立てていないか。判定条件は**意図の名前が付いた述語関数か説明変数**にまとめる
- [ ] `if (...) return null` を 3 つ並べるようなガード節の羅列になっていないか（段階ごとに関数を分け、メイン関数は段の流れだけを見せる）
- [ ] 「解析 → 検証 → 表示」が 1 メソッドに同居していないか
- [ ] 早期 return のガード節そのものは推奨（if-else のネストより優先する）

**NG例**: `src/domain/entities/RaceResult.ts` の `isG1()` — 特定レース名の `includes(...)` を `||` で連ねた長い判定（既存債務）
**OK例**: 語彙を constants の集合に出し、`isG1()` は「格が G1 か、または G1 レース名の集合に含まれるか」の 2 条件に畳む

#### 2.10 コレクション操作（reduce / entries / 長チェーン）

> 集約は `let` + `for-of` の加算で書く。index が必要なループは `for (let i = 0; ...)` + 先頭で要素を取り出し undefined ガードする。

- [ ] **新規コードで `reduce` / `.entries()` / `Object.entries` を使っていないか**。合計・集約は `let sum = 0; for (const r of results) sum += ...`、キー走査は `Object.keys` + 添字 + ガードで書く。plugin `no-reduce-entries`（warn）が機械検出するので、**該当 warning が本変更で純増していないか**を見る（既存の該当箇所は既存債務）
- [ ] 3 段以上のチェーン・型を絞るためのチェーンが無いか。意図の名前が付いたヘルパ関数か、素直な for-of + push に書き換える
- [ ] 同じ抽出・集計パターンの繰り返しが共通ヘルパに切り出されているか
- [ ] 固定語彙への所属判定が配列 `.includes()` になっていないか（語彙集合は `new Set([...])` を constants に置き `.has()` で判定する。2.4 と一体で、語彙の配置は 2.4、判定手段の書き方は本項）
- ※ 1〜2 段の意図が明瞭なチェーン（`filter(...).length` で件数を数える等）はそのままでよい。機械的に全部 for 文にしない

#### 2.11 条件式の向き（否定条件 + else を書かない）

- [ ] 否定形先行の if-else（`style/noNegationElse`）と多段ネスト三項（`style/noNestedTernary`）は lint が warn で機械検出する。**該当ルールの warning が本変更で純増していないか**を見る。純増していれば、分岐を入れ替えて肯定形を先にするか、対応表・関数に出す
- [ ] else を持たないガード節（早期 return / continue）の否定条件は問題ない（lint も検出しない）

#### 2.12 オーケストレーションの平坦化・説明的な抽出

- [ ] command の `execute` / 主要メソッドが**名前付きステップの平坦な列挙**になっているか（引数解釈・取得・計算・保存・表示が上から順に読める）。try/catch の中身や手続きの詳細は専用メソッド・説明関数へ追い出す
- [ ] 条件や内部ブロックの意味を**説明変数・説明関数**で命名しているか
- [ ] **boolean の説明変数で型絞り込みを壊していないか**。絞り込みが要る判定は値の別名にする（`const detail = this.data.detail; if (!detail) return 0;` の形）
- [ ] 推論が非自明な分割代入・タプルに明示の型注釈を付けているか

**OK例**: `src/domain/services/ScoringOrchestrator.ts:68-120` — レース取得 → 出走馬取得 → バッチ取得 → エンティティ構築 → 計算委譲、が上から順に読める

#### 2.13 型安全（any・アサーション）

- [ ] `any`（`suspicious/noExplicitAny`）と非 null アサーション（`style/noNonNullAssertion`）は lint が warn で機械検出する（後者は `__test__` では off）。**該当ルールの warning が本変更で純増していないか**を見る。純増していれば、`any` は具体型へ、`!` は `??` の既定値か早期 return へ
- [ ] リポジトリの戻り値に `src/types/RepositoryTypes.ts` の型が付いているか（`db.prepare(...).all()` の結果を無検証で `as T` 確定していないか。確定させる場合は列名と型の対応をその場で確認できる形にする）。**`as T` による無検証の型確定は lint が見ないので、本項が唯一の検出手段**
- [ ] 外部由来データ（JRA HTML の抽出結果・JSON 読み込み）を `as T` で確定させず、必須フィールドの欠落を実行時にガードしているか

#### 2.14 import の一貫性

- [ ] import 順序が `docs/DEVELOPMENT.md` の規約（1. Node/Bun 組み込み → 2. サードパーティ → 3. `@/` の内部モジュール → 4. `./` の同ディレクトリ配下）に従っているか（**lint は見ない**。assist の `organizeImports` は書き換えを伴うため無効にしてある。本項が唯一の検出手段で、目視で見る）
- [ ] ディレクトリをまたぐ import が `@/`（plugin `no-parent-relative-import`）、拡張子なし（plugin `no-js-import-extension`）、型のみ import が `import type`（`style/useImportType`）になっているかは lint が error で機械検出する。**本項では同ディレクトリ配下を指す `./` が `@/` に書き換わっていないか**（自ファイルの隣を遠回りに参照していないか）を目視で見る

#### 2.15 CLI 出力（console）の置き場所とレベル

> 本システムは CLI であり、`console` 出力は `src/commands/` と `src/index.ts` の**表示責務として正当**。禁止するのではなく、置き場所と粒度を見る。

- [ ] 表示（整形・見出し・ランキング出力）が `src/commands/` と `src/index.ts` に留まっているか
- [ ] `src/utils/` `src/models/` `src/domain/services/` `src/features/` の既存 `console` は**既存債務**。新規の計算・取得ロジックでは、結果を戻り値で返し表示は呼び出し元の command に任せる形を優先したか
- ※ `src/domain/entities/` `src/domain/valueObjects/` への `console` 混入は lint（`suspicious/noConsole` = error）が落とすため本項では見ない。lint の通過確認は 2.1
- [ ] エラーは `console.error`、警告は `console.warn` と使い分けているか（成功ログと失敗ログが同じ `console.log` に混ざっていないか）
- [ ] 例外の原因（`error` オブジェクト）を握り潰さず出力しているか（2.7 と一体。原因が残らないこと自体は 2.7 で計上し、出力先・レベルの妥当性を本項で見る）

### 判定基準

- **OK**: 当該項目が判定する対象が差分にあり、規約を満たしている（適合の積極的根拠がある）。「違反が無いから OK」ではなく「該当する対象があって適合している」ときに OK を付ける
- **WARN**: 動作上問題ないが改善余地（コメント品質、マジックナンバー、放置 TODO、スタイル逸脱: 長い条件連鎖・`reduce`/`entries` の新規使用・400行超過・import 拡張子の不統一・lint warning の純増）
- **FAIL**: `bun run c` / `bun run lint`（error）/ `bun test` の不通過、非推奨 API の新規使用、消し残しによる実害（参照切れ・誤動作）、正常系を上書きするフォールバック、原因の残らない例外握り潰しの新規追加
- **N-A**: 当該項目が判定する対象が差分に無い（該当実装なし／当該観点の変更なし。備考に根拠を記載）。差分外の既存実装は「OK(既存)」とせず N-A にして Summary から除外する。「違反が無い」だけで OK にせず、判定対象そのものが無ければ N-A にする。複数サブチェックを持つ項目（例 2.1・2.8）は、いずれかのサブチェックに該当する対象が差分にあればその適否で OK/WARN/FAIL を付け、どのサブチェックの対象も差分に無ければ N-A とする
- **既存債務の扱い**: base 時点から存在する逸脱（`reduce` / `.entries()`、400 行超のファイル、`any`、`.js` 拡張子、握り潰し `catch {}` 等）は、本変更で**悪化させていなければ** FAIL にせず、備考に「既存債務(本変更非起因)」と明記して WARN 以下に留める。基準は「新規変更で悪化させない」こと（= 2.1 で取ったベースラインからの純増がないこと）

### SKIPPED 条件

- 対象 TypeScript 変更が皆無の場合 `Summary: SKIPPED`

### 本スキルの責務境界

- 層構造・配置・依存方向は **review-arch**、名前の語の選択は **review-naming**、コメントの引き算（過剰・不要・陳腐化）は **review-comments**、テスト品質は **review-test**、SQL 注入・取得先 URL 制限・パス操作は **review-security**、時刻の注入可能性・再実行の冪等性は **review-recovery**、重み合計や特徴量統一などスコアリングのドメイン正しさは **review-scoring**
- **SQL 文字列の組み立てに関する安全性は review-security へ申し送る**（本スキルでは計上しない）。plugin `no-sql-template-interpolation` が warn で機械検出する
- コードスタイル規約（2.5 / 2.8〜2.12）は本スキルが正。コードを**書く前**の参照にも本スキルを使う（設計上の判断は design-principles）

- チェック表の行は SKILL.md のチェックリスト項目のみで構成する。**チェックリストに無い独自の行を表に追加しない**（チェック項目外の気づきは「他観点への申し送り」へ。自観点に関連するが項目化されていない所見は「詳細所見」に書き、Summary には数えない）
- 表には**全チェックリスト項目（2.1〜2.15）を列挙する**。該当変更が無い項目も N-A 行として残し省略しない（レビュー網羅性の担保）。Summary には OK/WARN/FAIL のみ計上し N-A は除外する
- 同一の行・欠陥でも、**自観点のチェックリスト項目に明示的に該当する側面**だけを自分の表・Summary に計上する（多面評価は可）。チェックリストの項目名から読めない拡大解釈（ドキュメントや一般原則からの引き込み）で FAIL を増やさない
- 自観点の項目に該当しない問題は計上せず、レポート末尾の「### 他観点への申し送り」節に「対象スキル名: 1行説明」で記載するだけにする（FAIL/WARN を付けない）
- 同一事象が自観点の複数チェック項目に該当する場合は、最も特異的な 1 項目だけで計上し、他項目は備考で相互参照する（Summary で重複カウントしない）。**特異性の判定**: 違反種別を最も具体的に名指す項目を選ぶ（例: 固定語彙の配列 `.includes()` は「コレクション操作」2.10 が判定手段として具体的だが、語彙がロジック中に直書きされている点は 2.4 が根本のため 2.4 で計上する）。優劣が付けにくいときは**チェックリスト番号の小さい方**で計上する（決定論的に揃える）
- 差分内コードが依存する差分外の既存実装は、確認してよいが新たな指摘対象にはしない（当該チェック項目を OK とし、備考に「依存先は差分外・確認済み」と書く）

### レポート形式

```
## コード品質 レビュー結果

| # | チェック項目 | ステータス   | 該当箇所  | 備考 |
| - | ------------ | ------------ | --------- | ---- |

### 詳細所見
### 他観点への申し送り
### 推奨アクション
- HIGH / MEDIUM / LOW
```

### Summary 行（必須・review-all 集計用）

```
Summary: OK=<n> WARN=<n> FAIL=<n>
```
