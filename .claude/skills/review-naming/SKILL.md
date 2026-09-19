---
name: review-naming
description: "有馬記念分析システムの命名ドメイン適合性レビュー。関数名・変数名・型名が競馬ドメインの意図（馬・騎手・調教師・血統・レース・出走・着順・上がり3F・馬場・会場・枠順・ローテ）を表現しているか、汎用名・技術接尾辞・命名規則の逸脱（snake_case 混入・アンダースコア付きメソッド名）・同一概念に別名が混在していないか（venue と course、同名異義の型）を検証。Use when user says '命名レビュー', 'review naming', '名前チェック', or 'ドメイン命名確認'."
---

## Instructions

`src/` 配下の TypeScript を探索し、`docs/DEVELOPMENT.md` のファイル命名規約と以下のチェックリストに基づいてレビューする。

### 本リポジトリのドメイン語彙（ユビキタス言語）

| ドメイン概念 | 英語表記 | 備考 |
|---|---|---|
| 馬 | `horse` | |
| 騎手 | `jockey` | |
| 調教師 | `trainer` | |
| 種牡馬（父） | `sire` | |
| 母 | `mare` | 母の父は `mareSire` |
| レース | `race` | |
| 出走（出走登録） | `entry` | |
| 着順 | `finishPosition` | DB は `finish_position` |
| 上がり3F | `last3F` | `last3FTime` / `last3FAbilityScore` |
| 馬場状態 | `trackCondition` | `良` / `稍重` / `重` / `不良` |
| 会場 | `venue` | `中山` / `東京` / `阪神` … |
| 枠順 | `postPosition` | 枠番は `frameNumber`、馬番は `horseNumber` |
| ローテーション | `rotation` | 出走間隔は `intervalDays` |

- **DB は snake_case、TypeScript は camelCase**。境界（リポジトリ層）で変換し、TypeScript 側のロジックに snake_case を持ち込まない
- 型名・クラス名・ファイル名は PascalCase（`docs/DEVELOPMENT.md` のファイル命名規約）

### 対象スコープと指摘範囲

起動時に「対象スコープ」と「対象ファイル一覧」が渡される場合がある（review-all 等からの dispatch 時）。その扱いは次の通り:

- **探索は広く、指摘は狭く**: 文脈把握のための Glob/Grep はプロジェクト全体に対して行ってよい。ただしテーブルに載せる WARN/FAIL は対象ファイル一覧内の事象に限定する
- **該当ファイル不在の項目**: 評価対象が無い項目は OK として計上しない（行を省くかステータス `N-A`）
- **自観点の評価対象が皆無**: `Summary: SKIPPED` を出力する
- **スコープ未指定時**: `src/` 全体を対象にする
- **一覧に実在しないファイルがある場合**: 除外して続行し、詳細所見に 1 行明記する
- **略語の計上先**: 略語そのものの読み難さは項目 2、同一概念の略語/完全綴りの揺れは項目 4 に計上する
- **既存債務**: base 時点から存在する命名（`venue` と `course` の混在、同名異義の型など）は、本変更で**範囲を広げていなければ** WARN 以下に留め、備考に「既存債務(本変更非起因)」と明記する。新規コードが既存の揺れた側に追随した場合は通常の重度で計上する

### 対象ファイルの探索

1. `src/domain/` `src/commands/` `src/repositories/` `src/models/` `src/utils/` `src/types/` `src/constants/` を Glob で探索する
2. `src/domain/` 配下は**重点的に確認**する（ドメイン語彙の発信源であり、層をまたぐ用語のブレはここを基準に判定する）

### チェックリスト

#### 1. 関数名がドメインの意図を表現しているか

- [ ] 技術的な動詞（`process`, `handle`, `do`, `exec`）だけで意図が読めない名前になっていないか（`get*` / `parse*` / `display*` は、目的語でドメインの意図が読めるなら対象外）
- [ ] 公開エントリポイント級の関数（command の `execute` から呼ばれるステップ関数）が、呼び出し側を読むだけでフローが理解できる名前か
- [ ] メソッド名が PascalCase / camelCase の規約に沿い、**アンダースコアで修飾していないか**

**NG例**: `src/utils/HorseDataExtractor.ts:164` `parseRaceInfo_Horse` — アンダースコア修飾で `parseRaceInfo`（`:267`、レース概要の解析）との違いが名前から読めない（既存債務）
**OK例**: `calculateVenueAptitudeScore` / `calculateRotationAptitudeScore`（`src/domain/entities/Horse.ts`）、`isOptimalRotation`（`src/constants/DistanceConstants.ts:45`）、`getHorseReliabilityFactor`（`src/constants/ScoringConstants.ts:136`）

#### 2. 変数名が中身のドメイン的な意味を表現しているか

- [ ] `data`, `result`, `info`, `item`, `obj`, `tmp` などの汎用名が使われていないか
- [ ] ローカル変数が camelCase か（**snake_case の混入が無いか**）
- [ ] 同じ式を何度も参照する場合、意図の名前を持つ説明変数に展開されているか

**NG例**: `src/commands/AnalyzePerformance.ts:108` `const wins_count`（snake_case 混入。`winsCount` が正）／`src/utils/JRAFetcher.ts:150` `const data = this.convertEncoding(...)` と `:263` `displayBasicInfo(data)`（`html` / `decodedHtml` 等、中身が読める名前に。いずれも既存債務）
**OK例**: `src/domain/entities/Horse.ts:228` `const venueStats`、`:263` `const similarDistanceResults`、`:307` `const withLast3F`

#### 3. 型名・インターフェース名がドメインモデルと整合しているか

- [ ] **同じ型名が別の概念に使い回されていないか**（同名異義は誤読の温床）
- [ ] DB レコード型が `DB*` 接頭辞（`DBHorse` / `DBRace` / `DBJockey`）、リポジトリ戻り値型が `src/types/RepositoryTypes.ts` という既存の役割分担に従っているか
- [ ] 技術的な接尾辞（`Manager`, `Impl`, `Helper`）を不必要に新設していないか。本リポジトリで確立している接尾辞は `*Repository` / `*Stats` / `*Score(s)` / `*Components` / `*Constants` / `*Data`（抽出・構築用のデータ形状）であり、これ以外の役割接尾辞を発明しない
- [ ] 競馬に詳しい読み手が見て意味が通じる名前か（`Score` の中身が何のスコアか、`Stats` の集計軸が何かが名前から分かるか）
- ※ 接尾辞と**配置の対応**（`*QueryRepository` は `repositories/queries/` に置く等）は **review-arch 1.6** 管轄。本スキルは語の選択のみ見る

**NG例**: `RaceInfo` が `src/types/HorseData.ts:23`（枠番・馬番・斤量・オッズ＝出走情報）と `src/commands/CalculateScore.ts:23`（ID・レース名・会場・距離＝レース基本情報）の 2 つの異なる概念に使われている／`HorseData` が `src/types/HorseData.ts:61`（抽出 JSON の馬データ）と `src/domain/entities/Horse.ts:64`（エンティティ構築データ）で別物を指す（いずれも既存債務。**新規の型名で同名異義を増やさない**）
**OK例**: 出走情報は `RaceEntryInfo`、レース基本情報は `RaceSummary` のように概念ごとに別名を与える

#### 4. 一貫性（ユビキタス言語）

- [ ] 同じ概念に異なる名前が混在していないか
- [ ] domain → repositories → DB 列名 → CLI コマンド名、と層をまたいで同じ概念が同じ語で表現されているか
- [ ] 略語の使い方が統一されているか
- [ ] DB の snake_case が TypeScript 側のロジック変数名に漏れていないか（リポジトリ層の戻り値型でレコード形状を保持するのは既存の設計であり対象外。ロジック中の新規ローカル変数が対象）

**NG例**: 会場の概念に `venue` と `course` が混在している。値オブジェクトは `venueAptitudeScore`（`src/domain/valueObjects/ScoreComponents.ts:16`）、エンティティのメソッドは `calculateVenueAptitudeScore`（`src/domain/entities/Horse.ts:226`）である一方、DB 列は `course_aptitude_score`、テーブルは `horse_course_stats`、型は `CourseStats`、リポジトリは `getHorsesCourseStatsBatch`、CLI は `course-analysis` / `AnalyzeCourse`。`src/commands/CalculateScore.ts:131` の `course_aptitude_score: components.venueAptitudeScore` が両語彙の突き当たり（既存債務。**新規コードは domain 側の `venue` に揃える**）
**OK例**: `last3F`（`last3FTime` / `last3FAbilityScore` / `LAST_3F_PARAMS`）、`trainer`（`Trainer` / `trainerScore` / `TRAINER_SCORE_WEIGHTS` / `trainer_id`）のように層をまたいで同じ語が通っている

※ テストコードの確立した慣習（ハーネス変数の局所短名等）は指摘対象外。

### 判定基準

- **FAIL**: 誤読のリスクが実害になるもの（同名異義の型、同じ概念に異なる名前が層をまたいで混在、名前と実態の乖離）
- **WARN**: 汎用的すぎる / 規約からの逸脱（snake_case 混入・アンダースコア修飾）/ 改善余地あり
- **OK**: 問題なし。**OK 行はテーブルに含めない**（FAIL / WARN のみ列挙。OK は Summary のカウントにだけ反映する）
- **N-A**: 差分スコープに当該観点の変更がない（Summary から除外）

### 本スキルの責務境界

- 接尾辞と配置の対応・層構造は **review-arch**、コメント品質・関数構成・制御フローは **review-code**、コメントの過剰・陳腐化は **review-comments**、テスト名の付け方は **review-test**
- スコア要素名がドメイン上正しい指標を指しているか（重み配分・特徴量の意味）は **review-scoring**。本スキルは語の一貫性のみ見る
- チェック表の行は本チェックリスト項目のみで構成する。項目外の気づきは「### 他観点への申し送り」へ（FAIL/WARN を付けない）
- 同一事象が複数項目に該当する場合は最も特異的な 1 項目だけで計上する。**特異性の判定**: 違反の根本原因を最も具体的に名指す項目を選ぶ（例: 同一概念に別名が混在する事象は『一貫性』項目4 が根本で、汎用名としての側面 項目2 は備考。同名異義の型は項目3）。優劣が付けにくいときは**チェックリスト番号の小さい方**で計上する（決定論的に揃える）

### レポート形式

```
## 命名 / ドメイン適合性 レビュー結果

| # | チェック項目 | ステータス | 該当箇所 | 現在の名前 | 推奨名 | 備考 |
| - | ------------ | ---------- | -------- | ---------- | ------ | ---- |

### 詳細所見
(`src/domain/` への言及を必ず含めること)

### 他観点への申し送り

### 推奨アクション
- HIGH: <FAIL 行を全列挙>
- MEDIUM: <WARN 行のうち層をまたぐもの>
- LOW: <WARN 行のうち局所的なもの>
（該当が無い優先度は「なし」と明示）
```

### Summary 行（必須・review-all 集計用）

レポート末尾に必ず以下の 1 行を出力する:

```
Summary: OK=<n> WARN=<n> FAIL=<n>
```

- **カウント単位はチェック項目（4 項目）**: 指摘の無い項目は OK として計上し（テーブルには載せない）、WARN/FAIL のある項目はその最重度ステータスで 1 カウント。N-A の項目は除外。OK + WARN + FAIL = 評価した項目数になる
- レビュー対象不在時のみ `Summary: SKIPPED`。その場合もレポート骨格（空テーブル + 推奨アクション各「なし」）を維持し、SKIPPED の根拠を詳細所見に 1 行書く（`src/domain/` への言及要求は通常実施時のみ）
