---
name: review-scoring
description: "スコアリング / ML のドメイン正しさのレビュー。SCORE_WEIGHTS の単一定義と合計1.0・ドキュメント追随、スコアリングと ML の10要素の一致（手書きで並ぶ全箇所の同時更新）、未来情報リーク（as-of カットオフを通していない取得経路の新設）、値域0〜100とゼロ除算、データ欠損時の既定値、学習・予測の決定性と再現性、JRA 枠番割当規則、バックテスト指標（1位的中率・上位3頭精度・順位相関・ROI）の計算を検証。Use when user says 'スコアリングレビュー', 'review scoring', 'ML レビュー', 'スコア計算チェック', '特徴量チェック', or 'バックテスト検証'."
---

## Instructions

`src/domain/` `src/constants/` `src/models/` `src/commands/`（Backtest / CalculateScore / Predict）を探索し、スコアリングと機械学習の**ドメインとしての正しさ**をレビューする。規約の正は `docs/MODELS.md` と `docs/ARCHITECTURE.md`。

### 対象スコープと指摘範囲

起動時に「対象スコープ」と「対象ファイル一覧」が渡される場合がある（review-all 等からの dispatch 時）。その扱いは次の通り:

- **探索は広く、指摘は狭く**: 文脈把握のための Glob/Grep/Read はプロジェクト全体に対して行ってよい。ただしテーブルに載せる WARN/FAIL は対象ファイル一覧内の事象に限定する
- **該当ファイル不在の項目**: 評価対象が無い項目は OK として計上しない（テーブルにステータス `N-A` で残し、備考に根拠を書く。行を省かない）
- **自観点の評価対象が皆無**: 判断根拠 1 行 + `Summary: SKIPPED` の最小出力でよい（テーブル骨格は不要）
- **スコープ未指定時**: プロジェクト全体（`node_modules/` は除外）を対象にする
- **一覧に実在しないファイルがある場合**: 除外して続行し、詳細所見に 1 行明記する
- 既存コードの違反（差分外・本変更で未変更の行）は**既存債務**として扱い、FAIL に上げず WARN 以下で備考に「既存債務(本変更非起因)」と明記する

### 対象ファイルの探索

1. `src/constants/ScoringConstants.ts` / `src/constants/MLConstants.ts`（重み・閾値・既定値の唯一の置き場）
2. `src/domain/entities/Horse.ts` `Jockey.ts` `Trainer.ts` / `src/domain/valueObjects/ScoreComponents.ts` `Score.ts`
3. `src/domain/services/ScoringOrchestrator.ts`（エンティティ組み立て・枠番算出）
4. `src/features/FeatureBuilder.ts`（ML 特徴量の組み立て・`FEATURE_SPECS`）と `src/models/MachineLearningModel.ts`（L2正則化ロジスティック回帰・学習/予測・walk-forward 検証）
5. `src/commands/Backtest.ts` `CalculateScore.ts` `Predict.ts`
6. `src/repositories/queries/HorseQueryRepository.ts` / `JockeyQueryRepository.ts` / `src/repositories/aggregates/ScoreAggregateRepository.ts`（特徴量の供給元。**リーク判定はここを読まないとできない**）
7. `docs/MODELS.md`（配分表・計算式）と `README.md` / `docs/ARCHITECTURE.md` / `.claude/skills/help` / `.claude/skills/score-calc` の配分記述

### チェックリスト

#### 3.1 重みの単一定義とドキュメント追随

- [ ] スコアの重みが `SCORE_WEIGHTS`（`src/constants/ScoringConstants.ts`）だけで定義され、エンティティ・コマンド・ML 側に数値が直書きされていないか
- [ ] `SCORE_WEIGHTS` の合計が 1.0 のままか（要素の追加・削除・変更で合計が崩れていないか）
- [ ] 重みを変更したなら、配分を書いているドキュメント（`docs/MODELS.md` の配分表と計算式、`docs/ARCHITECTURE.md`、`README.md`、`.claude/skills/help/SKILL.md`、`.claude/skills/score-calc/SKILL.md`）が同じ変更で追随しているか
- [ ] `ScoreComponentsData`（`src/domain/valueObjects/ScoreComponents.ts`）のコメントに書かれたパーセンテージが実際の `SCORE_WEIGHTS` と一致しているか

**NG例**: `calculateTotalScore()` 内で `recentPerformance * 0.22` と直書きする（定数と二重管理になり、片方だけ動いてズレる）
**OK例**: `ScoreComponents.calculateTotalScore()` — 全要素が `SCORE_WEIGHTS.<key>` を参照して加重和を取る

#### 3.2 スコアリングと ML の10要素が一致しているか

10 要素（直近成績 / コース適性 / 距離適性 / 上がり3F / G1実績 / ローテ適性 / 騎手能力 / 馬場適性 / 枠順効果 / 調教師）は、**同じ並びが複数ファイルに独立して手書きされている**。要素の追加・削除・改名は、以下を**すべて**同時に更新しないと片側だけズレる:

- [ ] `src/constants/ScoringConstants.ts` の `SCORE_WEIGHTS`（正本。重みキー）
- [ ] `src/domain/valueObjects/ScoreComponents.ts` の `ScoreComponentsData` のフィールドと `calculateTotalScore()` の加重和
- [ ] `src/types/RepositoryTypes.ts` の `interface ScoreComponents`（`ScoreComponentsData` と別に手書きされている重複定義）
- [ ] `src/domain/entities/Horse.ts` の `calculateTotalScore()` が組み立てる `componentsData`
- [ ] `src/features/FeatureBuilder.ts` の `FEATURE_SPECS` の `R:*` エントリと `emptyRuleScores()`
- [ ] `src/models/MachineLearningModel.ts` の `ruleFeatureNames`（表示用の日本語名）・`getCurrentWeights()`・`getOptimizedWeightsAsConstants()` の `keys`・`prepareRuleScoreRegressionData()`
- [ ] `src/commands/CalculateScore.ts` の `interface HorseScore`・スコア詰め替え・`updateHorseScore` の DB カラム名マッピング（`course_aptitude_score` / `rotation_score` など**別名になっている**点に注意）・表示用の要素一覧
- [ ] `src/commands/Backtest.ts` の `components` 組み立てと `calculateElementContribution` の `elementNames`
- [ ] 上記の配列・オブジェクトの**並び順**が一致しているか（`FEATURE_SPECS` の並びと重み側の並びがズレると、重要度表示や重みの射影が別要素に割り当たる）

**NG例**: スコア要素を1つ足して `SCORE_WEIGHTS` と `ScoreComponentsData` だけ更新し、`FEATURE_SPECS` の `R:*` が10個のまま → 特徴量ベクトルの次元と要素名の対応がズレる
**OK例**: `FeatureBuilder.FEATURE_SPECS` の `R:*` 10 行が `ScoreComponentsData` の 10 フィールドを同じ順で列挙している

#### 3.3 未来情報リーク（最重要）

過去レースを評価・学習に使うとき、**そのレース当日以降の成績（当該レース自身の着順・上がり3F・人気を含む）が特徴量に混入していないか**。混入していれば的中率・改善率の数字は実力より高く出る。

as-of カットオフは既に実装されている: `ScoringOrchestrator.calculateScoresForRace(raceId, asOf?)` / `calculateScoreForEntry(entry, race, asOf?)` が `asOf ?? レース日` を `cutoff` として下流へ流し、`HorseQueryRepository.getHorseRaceResults(horseId, limit?, beforeDate?)` / `getHorsesRaceResultsBatch(horseIds, beforeDate?)` / `getHorsesCourseStatsAsOf` / `getHorsesTrackStatsAsOf` / `getPreviousRacesAsOf` と `JockeyQueryRepository` の `beforeDate` 付きメソッドが `r.race_date < ?` で絞る。`FeatureBuilder.buildForRace(raceId, asOf?)` も同じ経路を使う。**本項は「この規律から外れる経路を新設していないか」を見る**。

- [ ] **新しい取得メソッド・集計に `beforeDate` / `asOf` 引数を通しているか**。値を返す前に「この値は対象レースの発走前に確定しているか」を答えられる形（日付引数を取る／日付で絞った集計を使う）になっているか
- [ ] 既存の as-of 付きメソッドを、**`beforeDate` を渡さずに**新しい経路から呼んでいないか（`getHorseRaceResults` / `getHorsesRaceResultsBatch` / `JockeyQueryRepository` の各メソッドは `beforeDate` が**省略可能**なので、渡し忘れても型エラーにならない）
- [ ] 集計テーブル由来の特徴量（`horse_course_stats` / `horse_track_stats`）を評価・学習経路で使っていないか。これらは全期間で集計されるため、as-of 経路では `getHorsesCourseStatsAsOf` / `getHorsesTrackStatsAsOf`（`race_results` から都度集計する版）を使う
- [ ] `Backtest.evaluateRace` が、そのレース時点で入手可能な情報だけでスコアを組み立てているか（確定オッズのような発走後に確定する値を特徴量側に入れていないか。払戻オッズは ROI 計算にだけ使う）
- [ ] ML の訓練データ生成が、ラベルに使うレース自身の結果を特徴量側にも渡していないか。予測対象レース自身を学習から除外しているか
- [ ] 検証の分割（walk-forward）がレース単位・時系列順を壊していないか（同一レースの出走馬が train と test に分かれると、同レース内の相関で精度が水増しされる）
- [ ] **as-of の直接テストが無い経路**（`getHorsesRaceResultsBatch` のバッチ版、`JockeyQueryRepository` の `beforeDate` 系）に変更を入れるなら、リーク遮断のテストを同じ変更で足したか（review-test 5.7 と一体）

**NG例**: 新しい集計メソッドを `getHorseCourseStats(horseId)` のように基準日を取らない形で追加し、評価・学習経路から呼ぶ／既存の `getHorseRaceResults(horseId, 5)` を `beforeDate` 省略のまま新経路から呼ぶ（全戦績が返り、対象レース自身とそれ以降の着順が「直近5戦」に入る）
**OK例**: `ScoringOrchestrator.buildHorseEntity(horseId, asOf)` — `asOf` があれば `getHorsesCourseStatsAsOf` / `getHorsesTrackStatsAsOf` を使い、集計テーブル版へは as-of 無しのときだけフォールバックする。遮断は `src/domain/services/__test__/AsOfLeakage.test.ts`（対象レース／後続レースの結果を投入してもスコア・特徴量が変わらない）と `src/models/__test__/MachineLearningModel.e2e.test.ts`（未来レースを削除しても学習サンプルが変わらない）で固定されている

#### 3.4 値域とゼロ除算

- [ ] 各要素スコアが 0〜100 に収まるか（上限は `Math.min(score, 100)`、ボーナス加算後も超えないか。下限は負にならないか）
- [ ] 出走数・母数での除算の前に 0 判定があるか（`runs === 0` / `length === 0` / `totalIntervals === 0`）
- [ ] 比率の分母が「有効な結果のみ」で揃っているか（`validResults.length` で割るべき所を全件数で割っていないか）
- [ ] 合計スコアが 0〜100 に収まる構造か（重み合計が 1.0 で各要素が 0〜100 なら自動的に成立する。3.1 と合わせて確認）

**NG例**: `const winRate = stats.wins / stats.runs;` を 0 判定なしで書く（`runs=0` で `NaN` が伝播し、以降の比較がすべて false になってスコアが静かに壊れる）
**OK例**: `Horse.calculateTrackConditionScore` — `if (!stats || stats.runs === 0) return TRACK_CONDITION_DEFAULT_SCORE;` の後に除算し、最後に `Math.min(score, 100)` で上限を締める

#### 3.5 データ欠損時の既定値

- [ ] 戦績ゼロの馬・騎手統計なし・調教師なしのときの既定値が `src/constants/` の定数（`*_DEFAULT_SCORE` の形）に置かれ、直書きされていないか
- [ ] 既定値の方針が要素間で説明可能か（「データなし＝0点」と「データなし＝中間50点」が混在すると、欠損の多い馬のスコアが要素構成だけで上下する）
- [ ] 新しい要素を足すとき、欠損時の値と理由が JSDoc に書かれているか
- [ ] ML 側の欠損時フォールバックがスコアリング側の既定値と矛盾していないか（取得失敗は既定値で埋めず `null` を返して除外する、が現在の方針）
- [ ] 既定値を `src/constants/MLConstants.ts` から引こうとしていないか。**このファイルは現在どのエクスポートも参照されていない死にコード**なので、新規参照を足す前に「この定数が実装の正なのか」を確認する（実装側の値と二重管理になる）

**NG例（現状 — 既存債務）**: 欠損時の既定値が要素ごとに不統一。コース適性は `Horse.calculateVenueAptitudeScore` で裸の `return 50`、馬場適性は `TRACK_CONDITION_DEFAULT_SCORE`（50）、一方で距離適性とローテ適性は `return 0`、G1実績は `G1_DEFAULT_SCORE`（30）
**OK例**: 既定値をすべて定数化し（`TRACK_CONDITION_DEFAULT_SCORE` / `G1_DEFAULT_SCORE` の形）、「実績なしを 0 とするか中間値とするか」の判断理由を JSDoc に残す

#### 3.6 決定性・再現性

現在の ML はランダムフォレストではなく、**L2正則化ロジスティック回帰**（`trainL2Logistic`。特徴量標準化 + full-batch 勾配降下 + 収束判定。単勝はレース内 softmax）。アンサンブルは無い。本番コードに乱数は無く、学習・予測は入力だけで決まる。

- [ ] **同じ入力（同じ DB・同じ特徴量）に対して学習・予測が再現するか**。乱数・現在時刻・`Map`/`Set` の反復順に依存する処理を持ち込んでいないか
- [ ] 乱数を新たに導入する場合、シードを引数か定数で固定し、テストから同じ結果を再現できるか（テスト側の `src/test/helpers/syntheticRaces.ts` の `mulberry32(seed)` が前例）
- [ ] 正則化パラメータ（L2 の係数）・分類閾値・正規化係数・ラベル定義が、コードに直書きされず名前の付いた定数かオプション引数になっているか
- [ ] 同じ DB に対して同じコマンドを2回流したとき、スコア・検証指標が同じ値になるか（`src/models/__test__/MachineLearningModel.e2e.test.ts` の「検証結果は決定論的（同じDBなら同じ数値）」が前例）

**NG例（現状 — 既存債務）**: 正則化パラメータが `optimizeWeights(lambda: number = 0.1)` のデフォルト引数に直書きされている／ラベル定義の除数がマジックナンバーで置かれている
**OK例**: `trainL2Logistic(X, y, options)` が `options.l2 ?? 1.0` として受け取り、呼び出し側が値を明示できる形になっている

#### 3.7 枠番の JRA 割当規則

- [ ] 枠番は `calculateFrameNumber`（`src/constants/ScoringConstants.ts`）に一元化され、各所で `Math.ceil(horseNumber / 2)` のような自前計算をしていないか
- [ ] 取り込み済みの `frame_number` を優先し、無いときだけ算出しているか（`entry.frame_number ?? calculateFrameNumber(...)`。`ScoringOrchestrator.calculateScoresForRace` と `calculateScoreForEntry` の両経路）
- [ ] 総頭数の取り方が両経路で同じか（`race.totalHorses ?? entries.length`）
- [ ] 規則（8枠制・余りは大きい枠番側から1頭ずつ多く）を変える場合、境界頭数（8頭以下 / 14頭 / 17頭 / 18頭）のテストが同じ変更で更新されているか

**NG例**: 枠番を `Math.ceil(horseNumber / 2)` で算出する（16頭立てでしか合わず、14頭立てでは1〜2枠が1頭である規則に反する）
**OK例**: `ScoringOrchestrator` — `entry.frame_number ?? calculateFrameNumber(entry.horse_number, race.totalHorses ?? entries.length)`

#### 3.8 バックテスト指標の計算

- [ ] 1位的中（`top1Hit`）が「スコア1位の馬の実着順が1着」で判定されているか（`Backtest.calculateMetrics`）
- [ ] 上位3頭精度・上位5頭精度の分母が「レース数 × 頭数」で、率として 0〜1 に収まるか（`Backtest.calculateSummary`）
- [ ] 順位相関が予測順位と実着順のペアで計算され、ペア数不足（3未満）のときに 0 として扱われるか（`calculateSpearmanCorrelation`）。相関の符号の向き（高スコア＝小さい着順＝負の相関が良い）が `calculateElementContribution` で正しく反転されているか
- [ ] ROI（`simulateROI`）が使うオッズの出どころが表示・コメントで明示されているか。現在は DB の払戻オッズ（`payoutWinOdds`）を使い、オッズが無いレースは `continue` で母数から外れるので、**除外された件数が出力から分かるか**
- [ ] 市場ベースライン（`calculateMarketBaseline`）との比較が、同じレース集合・同じ母数で行われているか
- [ ] 評価対象レースの絞り込み（`getRacesWithResults` / `slice`）が結果の解釈と一致しているか（「最新10レース」「重賞のみ」といった前提が出力に表示されているか）
- [ ] 指標が例外を握り潰して 0 や null を返す経路（`Backtest` の `catch { return null; }`）で、評価対象が黙って減っていないか（件数が表示されるか）

**NG例**: オッズが無いレースを黙って母数から外したまま「回収率」とだけ表示する（対象レース数が分からず、実測と誤読される）
**OK例**: 仮定や母数（対象レース数・オッズの出どころ）を出力に明示する

### 判定基準

- **OK**: 当該項目が判定する計算・定数が差分にあり、期待通りに実装されている（適合の積極的根拠がある）。「違反が無いから OK」ではなく「該当する計算があって適合している」ときに OK を付ける
- **WARN**: 動作するが根拠が弱い（既定値が定数化されていない、仮定がコメントにしか無い、ドキュメント追随が別コミット予定、既存債務の踏襲）
- **FAIL**: 未来情報リークの新規作り込み（as-of を通さない取得経路の新設・`beforeDate` の渡し忘れ）、重み合計が 1.0 でない、10要素の片側だけ更新、ゼロ除算で NaN が伝播する経路、学習・予測の非決定化、枠番規則の誤実装、指標の分母・符号の誤り
- **N-A**: 該当する計算が差分スコープに存在せず評価不能（備考に根拠を記載）。差分外の既存実装は「OK(既存)」とせず N-A にして Summary から除外する。「違反が無い」だけで OK にせず、判定対象そのものが無ければ N-A にする。複数サブチェックを持つ項目（例 3.2・3.3）は、いずれかのサブチェックに該当する対象が差分にあればその適否で OK/WARN/FAIL を付け、どのサブチェックの対象も差分に無ければ N-A とする

### SKIPPED 条件

- `src/domain/entities/` `src/domain/valueObjects/` `src/domain/services/`・`src/constants/`・`src/models/`・`src/commands/Backtest.ts` `src/commands/CalculateScore.ts` `src/commands/Predict.ts` のいずれにも変更が無い場合 `Summary: SKIPPED`

### 本スキルの責務境界

- 層構造・依存方向・ファイル配置は **review-arch**、TypeScript のコード品質・型・死にコードは **review-code**、スコアリングのテストの有無と質は **review-test**、外部由来データの検証は **review-security**、時刻依存・再実行の決定性は **review-recovery**、命名語彙は **review-naming**、コメントの過不足は **review-comments**。本スキルは「スコアリング / ML の計算がドメインとして正しいか」のみ
- 重みが 1 箇所で定義されているかという**配置**は review-arch 1.5。本スキルは合計 1.0 や 10 要素の整合という**ドメイン上の正しさ**を見る
- チェック表の行は SKILL.md のチェックリスト項目のみで構成する。**チェックリストに無い独自の行を表に追加しない**（チェック項目外の気づきは「他観点への申し送り」へ。自観点に関連するが項目化されていない所見は「詳細所見」に書き、Summary には数えない）
- 表には**全チェックリスト項目（3.1〜3.8）を採番項目単位で列挙する**（チェックボックスごとに a/b/c へ分割しない）。該当変更が無い項目も N-A 行として残し省略しない（レビュー網羅性の担保）。Summary には OK/WARN/FAIL の行のみ計上し N-A は除外する
- 同一の行・欠陥でも、**自観点のチェックリスト項目に明示的に該当する側面**だけを自分の表・Summary に計上する（多面評価は可）。チェックリストの項目名から読めない拡大解釈（docs や一般原則からの引き込み）で FAIL を増やさない
- 自観点の項目に該当しない問題は計上せず、レポート末尾の「### 他観点への申し送り」節に「対象スキル名: 1行説明」で記載するだけにする（FAIL/WARN を付けない）
- 同一事象が自観点の複数チェック項目に該当する場合は、最も特異的な 1 項目だけで計上し、他項目は備考で相互参照する（Summary で重複カウントしない）。**特異性の判定**: 違反の根本原因を最も具体的に名指す項目を選ぶ（例: 対象レース自身の着順が特徴量に入る事象は『未来情報リーク』3.3 が根本で、結果として指標が高く出る 3.8 は備考）。優劣が付けにくいときは**チェックリスト番号の小さい方**で計上する（決定論的に揃える）
- 差分内コードが依存する差分外の既存実装は、確認してよいが新たな指摘対象にはしない（当該チェック項目を OK とし、備考に「依存先は差分外・確認済み」と書く）

### レポート形式

```
## スコアリング / ML レビュー結果

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
