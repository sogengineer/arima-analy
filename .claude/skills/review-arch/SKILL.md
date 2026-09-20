---
name: review-arch
description: "有馬記念分析システムのアーキテクチャ/レイヤー境界レビュー。docs/ARCHITECTURE.md のレイヤー構成（commands / domain / repositories / models / features / constants / database / utils / types）に対し、レイヤーディレクトリの意味と配置、参照系(queries)と更新系(aggregates)の分離、DB 接続の注入可能性とテスト容易性、リッチドメインモデルの維持（commands 肥大・ドメイン貧血症）、重み・閾値の constants 単一定義、ファイル配置と命名語彙の一致、不要な抽象化、種別分岐のポリモーフィズム化、生成引数の凝集（5個以上は分割シグナル）を検証。純粋性・依存方向の逆流・DB 接続の生成箇所は lint が error で担保するため扱わない。Use when user says 'アーキテクチャレビュー', 'レイヤー境界チェック', 'review architecture', or '依存方向の確認'."
---

## Instructions

`src/` 配下の TypeScript ソースを探索し、`docs/ARCHITECTURE.md`（レイヤー構成）と `docs/DEVELOPMENT.md`（コーディング規約・ファイル命名）の規約に基づいてレビューする。本リポジトリには規約を書いた他の正本（ルートの規約ファイル等）は無く、この 2 つのドキュメントが規約の正である。

### 対象ファイルの探索

1. `src/` 配下のディレクトリ構成を把握する:
   - `src/commands/` — CLI コマンド実装（動詞ベース PascalCase。表示責務を持つ）
   - `src/domain/entities/` `src/domain/valueObjects/` — リッチドメインモデル（Horse / Jockey / Trainer / Race / RaceResult / Score / ScoreComponents）
   - `src/domain/services/` — ドメインサービス（ScoringOrchestrator）
   - `src/repositories/queries/` — 参照系（JOIN を伴う取得）／ `src/repositories/aggregates/` — 更新系（集約単位の INSERT/UPDATE/DELETE）
   - `src/models/` — 機械学習モデル（MachineLearningModel）
   - `src/constants/` — 重み・閾値の単一定義／ `src/database/` — DatabaseConnection + schema.sql
   - `src/features/` — ML 特徴量の組み立て（FeatureBuilder）
   - `src/utils/` — JRAFetcher / HorseDataExtractor／ `src/types/` — 型定義
   - `src/index.ts` — CLI エントリポイント（commander の配線）
2. `docs/ARCHITECTURE.md` と `docs/DEVELOPMENT.md` を Read し、規約の原文（レイヤー構成・ファイル命名）を把握する
3. `bun run lint` を 1 回流し、層越え import と接続生成の error がゼロであることを確認する（層の逆流は lint が担保する。本スキルは残る配置・責務の判断を見る）

### チェックリスト

#### 1.1 レイヤーディレクトリの意味と配置

- [ ] 新規ファイルが `docs/ARCHITECTURE.md` のレイヤー構成のどれか 1 つに素直に収まっているか（CLI 表示 = commands、ドメイン判定・計算 = domain、SQL = repositories、ML = models、定数 = constants、外部取得・HTML 解析 = utils、型 = types）
- [ ] ドメイン判定・計算を `src/utils/` に置いていないか（utils は JRA HTML 取得・抽出という技術関心事に限る）
- [ ] 型定義が `src/types/` に置かれ、DB レコード型（`DB*`）とリポジトリ戻り値型（`RepositoryTypes.ts`）の役割分担が保たれているか

#### 1.2 参照系(queries)と更新系(aggregates)の分離

- [ ] `src/repositories/queries/` の `*QueryRepository.ts` が SELECT のみで、INSERT / UPDATE / DELETE / `db.exec` を持っていないか
- [ ] 書き込みが `src/repositories/aggregates/` の `*AggregateRepository.ts` に集約されているか
- [ ] 新規の集計テーブル更新が aggregates 側に置かれているか（`ScoreAggregateRepository.rebuildHorseStats` が既存の前例）
- [ ] クエリの組み立てが Kysely（`src/database/QueryRunner.ts` の `queryBuilder`）で、実行が同ファイルのヘルパー経由になっているか。参照系・更新系のどちらもリポジトリ層に閉じているか（`kysely` の import 制限とビルダー実行系の禁止は lint が error で担保する。review-code 2.1）

**NG例**: `HorseQueryRepository` に `UPDATE horses SET ...` を足す
**OK例**: 参照は `src/repositories/queries/HorseQueryRepository.ts`、スコア保存は `src/repositories/aggregates/ScoreAggregateRepository.ts`

#### 1.3 DB 接続の注入可能性とテスト容易性

- [ ] リポジトリ・ドメインサービス・特徴量ビルダーが `Database` を**コンストラクタで受け取る**形になっているか（`ScoringOrchestrator` / `FeatureBuilder` は `db: Database` を受けて QueryRepository を自前で `new` する。**これは現状の許容構造**で、新規に同型を書くことは FAIL としない）
- [ ] テスト容易性が必要な新規クラスで、外部 `Database` の任意注入を検討したか（前例: `MachineLearningModel` / `Backtest` の `externalDb`）
- [ ] 各 command が constructor 内で `new DatabaseConnection()` する現状の形は**既存の合成ルート**。追随して増やすのは許容（WARN 以下）
- ※ 生成場所そのものの制限（commands / `src/index.ts` / models のフォールバック / `src/database` のファクトリ / テスト以外で `new DatabaseConnection(...)` しない）は plugin が error で機械検出する。本項は**注入可能性とテスト容易性**だけを見る

#### 1.4 リッチドメインモデルの維持（commands 肥大・ドメイン貧血症）

> 設計原則の正は design-principles 原則2。

- [ ] `src/commands/` や `src/models/` に、**ドメインの語彙で一文で言える判定・計算**（「G1 レースか」「距離適性スコア」「直近 5 戦の重み付き平均」級）が直書きされていないか。該当するものは Horse / Jockey / Trainer / RaceResult / ScoreComponents へ置く
- [ ] command 本体が段取り（引数解釈 → リポジトリ／オーケストレーター呼び出し → 保存 → 表示）に限定されているか
- [ ] entities が getter だけの器になっていないか（判定・導出が commands 側に散らばっていないか）
- **判定の目安**: そのロジックのユニットテストに SQLite の実 DB が 1 つも要らないなら domain に置くべき兆候

**NG例**: `Backtest` の中で「上位 3 頭の的中」を判定するドメイン計算をべた書きし、同じ計算が `CalculateScore` にも現れる
**OK例**: `Horse.calculateVenueAptitudeScore` のようにエンティティが計算を持ち、`ScoringOrchestrator.calculateScoresForRace` は組み立てと委譲だけを行う

#### 1.5 重み・閾値の単一定義（constants 集約）

- [ ] スコアの重み・閾値・スコアテーブルが `src/constants/` にあり、**`SCORE_WEIGHTS`（`src/constants/ScoringConstants.ts` の `SCORE_WEIGHTS`）が重みの唯一の定義**であることを崩していないか
- [ ] domain / models / commands が重みの数値を再宣言・複製していないか（参照は import で行う。`src/commands/CalculateScore.ts` が `SCORE_WEIGHTS` を import する形が正）
- [ ] 距離・期間の閾値が `src/constants/DistanceConstants.ts`、ML パラメータが `src/constants/MLConstants.ts` に置かれているか
- ※ 重み合計が 1.0 か、スコアリングと ML の特徴量が一致しているかという**ドメイン上の正しさは review-scoring 管轄**。本項は「定義が 1 箇所か」という配置だけを見る

#### 1.6 ファイル配置と命名語彙の一致

| 配置 | 命名 |
|---|---|
| `src/commands/` | 動詞ベース PascalCase（`CalculateScore.ts` / `ListHorses.ts` / `AnalyzeTrack.ts`） |
| `src/domain/entities/` | 名詞 PascalCase（`Horse.ts` / `Jockey.ts` / `Trainer.ts`） |
| `src/domain/valueObjects/` | 名詞 PascalCase（`Score.ts` / `ScoreComponents.ts`） |
| `src/domain/services/` | 役割が読める名詞（`ScoringOrchestrator.ts`） |
| `src/repositories/queries/` | `*QueryRepository.ts` |
| `src/repositories/aggregates/` | `*AggregateRepository.ts` |
| `src/utils/` | PascalCase（`JRAFetcher.ts` / `HorseDataExtractor.ts`） |
| `src/types/` | PascalCase（`HorseData.ts` / `RepositoryTypes.ts`） |

- [ ] 新規ファイルが上記の**配置と接尾辞の対応**に従っているか（参照系に `*AggregateRepository` を使う等の取り違えがないか）
- ※ 語そのものの選び方（ドメイン語彙として適切か・用語の混在）は **review-naming** 管轄。本項は配置と接尾辞の対応だけを見る

#### 1.7 不要な抽象化（YAGNI）

- [ ] 実装が 1 つで差し替え予定もないものに、interface / 基底クラス / ファクトリを足していないか
- [ ] 「将来のための」未使用オプション引数・分岐のない戦略切り替えを作っていないか

#### 1.8 種別分岐のポリモーフィズム化と共通経路の中立性

> 設計原則の正は design-principles 原則3。

- [ ] 種別（`芝` / `ダート` / `障害`、馬場状態 `良` / `稍重` / `重` / `不良`、レース格）ごとに変化し**今後増える**処理を、巨大な if / switch に溜めていないか。2 箇所目の同じ種別分岐を書く前にポリモーフィズム（基底 + 種別実装 + 対応表）を検討したか
- [ ] 種別の対応表を持つ場合、未登録の種別をコンパイラまたは網羅的な `Record` で検出できる形になっているか
- [ ] 全種別が通る共通経路（スコア合算・表示フォーマット）に、特定の会場・特定のレース名に寄った分岐や文言が紛れていないか

**NG例**: `src/domain/entities/RaceResult.ts` の `isG1()` — G1 判定が特定レース名（有馬記念 / ダービー / 天皇賞 …）の `||` 連鎖としてエンティティに直書きされている（既存債務。**新規の種別分岐をこの形で増やさない**）
**OK例**: 対象語彙を `src/constants/` の定数集合として定義し、判定は名前の付いた述語 1 つに集約する

#### 1.9 依存・生成引数の凝集（5個以上）

> 設計原則の正は design-principles 原則1。

- [ ] コンストラクタで保持する依存（リポジトリ・接続・オーケストレーター）が **5個以上**になっていないか。なっている場合、常にセットで使われる組が 1 つの協力クラスにまとまらないか（引数の個数は `complexity/useMaxParams`（warn・max 5）が機械検出するので、該当 warning が本変更で純増していないかも併せて見る）
- [ ] 「数を減らすため」だけに 1 オブジェクトへ詰め込んで逃げていないか
- 既存クラスの追随で超える場合は WARN に留め、**新規クラス設計での超過を主対象**とする

**NG例**: `src/commands/ImportData.ts` の constructor — 接続 + リポジトリ 5 本を生成（既存債務。新規コマンドで同じ形を増やさない）
**OK例**: `src/commands/CalculateScore.ts` の constructor — 接続・オーケストレーター・更新リポジトリの 3 つに絞る

### 判定基準

- **OK**: 当該項目が判定する構造が差分にあり、規約を満たしている（適合の積極的根拠がある）。「違反が無いから OK」ではなく「該当する構造があって適合している」ときに OK を付ける
- **WARN**: 動作上問題ないが規約から逸脱・改善余地あり（配置粒度、接尾辞の取り違え、既存債務への追随）
- **FAIL**: 参照系リポジトリでの書き込み、レイヤー構成のどれにも収まらない配置の新設、重みの二重定義（層越え import と `new DatabaseConnection()` の持ち込みは lint が error で落とすため、review-code 2.1 側の FAIL になる）
- **N-A**: 当該項目が判定する構造が差分に無い（該当実装なし／当該観点の変更なし。備考に根拠を記載）。差分外の既存実装は「OK(既存)」とせず N-A にして Summary から除外する。「違反が無い」だけで OK にせず、判定対象そのものが無ければ N-A にする。複数サブチェックを持つ項目（例 1.2・1.6）は、いずれかのサブチェックに該当する構造が差分にあればその適否で OK/WARN/FAIL を付け、どのサブチェックの構造も差分に無ければ N-A とする
- **既存債務の扱い**: base 時点から存在する逸脱（各 command の接続自前生成、`RaceResult.isG1` のレース名直書き等）は、本変更で**悪化させていなければ** FAIL にせず、備考に「既存債務(本変更非起因)」と明記して WARN 以下に留める。本変更で件数・範囲が増えた場合のみ計上する

### SKIPPED 条件

- `src/` 配下の TypeScript に変更が皆無の場合 `Summary: SKIPPED`

### 本スキルの責務境界

- 本スキルは**層構造・依存方向・配置・接尾辞の対応**に絞る
- **domain entities / valueObjects の純粋性**（DB・I/O・ネットワーク・他層 import・`console` の混入）と**依存方向の逆流**（domain → commands、repositories → commands/models/domain、constants/types の末端性、下位層 → commands）は lint（`style/noRestrictedImports` と `suspicious/noConsole`、いずれも error）が担保するため本スキルでは見ない。lint の通過確認は review-code 2.1
- `new DatabaseConnection(...)` の生成箇所の制限は plugin `no-database-connection-construction`（error）が担保するため本スキルでは見ない（1.3 は注入可能性・テスト容易性だけを見る）。lint の通過確認は review-code 2.1
- コード品質（非推奨 API・死にコード・マジックナンバー・制御フロー・`console` の粒度）は **review-code**、名前の語の選択は **review-naming**、SQL 注入・取得先 URL 制限・パス操作は **review-security**、時刻の注入可能性・再実行の冪等性は **review-recovery**、重み合計や特徴量統一などスコアリングのドメイン正しさは **review-scoring**、テスト品質は **review-test**

- チェック表の行は SKILL.md のチェックリスト項目のみで構成する。**チェックリストに無い独自の行を表に追加しない**（チェック項目外の気づきは「他観点への申し送り」へ。自観点に関連するが項目化されていない所見は「詳細所見」に書き、Summary には数えない）
- 表には**全チェックリスト項目（1.1〜1.9）を列挙する**。該当変更が無い項目も N-A 行として残し省略しない（レビュー網羅性の担保）。Summary には OK/WARN/FAIL のみ計上し N-A は除外する
- 同一の行・欠陥でも、**自観点のチェックリスト項目に明示的に該当する側面**だけを自分の表・Summary に計上する（多面評価は可）。チェックリストの項目名から読めない拡大解釈（ドキュメントや一般原則からの引き込み）で FAIL を増やさない
- 自観点の項目に該当しない問題は計上せず、レポート末尾の「### 他観点への申し送り」節に「対象スキル名: 1行説明」で記載するだけにする（FAIL/WARN を付けない）
- 同一事象が自観点の複数チェック項目に該当する場合は、最も特異的な 1 項目だけで計上し、他項目は備考で相互参照する（Summary で重複カウントしない）。**特異性の判定**: 違反の根本原因を最も具体的に名指す項目を選ぶ（例: 新設した集計更新を `queries/` 側に置いた事象は「参照系と更新系の分離」1.2 が根本で、「配置と命名語彙」1.6 は結果側のため 1.2 で計上し 1.6 は備考）。優劣が付けにくいときは**チェックリスト番号の小さい方**で計上する（決定論的に揃える）
- 差分内コードが依存する差分外の既存実装は、確認してよいが新たな指摘対象にはしない（当該チェック項目を OK とし、備考に「依存先は差分外・確認済み」と書く）

### レポート形式

```
## アーキテクチャ / レイヤー境界 レビュー結果

| # | チェック項目 | ステータス   | 該当箇所  | 備考 |
| - | ------------ | ------------ | --------- | ---- |
| 1 | ...          | OK/WARN/FAIL | file:line | ...  |

### 詳細所見
### 他観点への申し送り
### 推奨アクション
- HIGH / MEDIUM / LOW
```

### Summary 行（必須・review-all 集計用）

```
Summary: OK=<n> WARN=<n> FAIL=<n>
```
