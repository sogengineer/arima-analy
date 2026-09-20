---
name: review-all
description: "全 8 レビュースキル（arch/code/scoring/security/test/naming/recovery/comments）を並列実行し、統合レポートを出力するオーケストレーションスキル。レビュー範囲は引数で指定可能（wt=作業ツリー / PR #N / pr:N / vs:<branch> / git range / ファイル列挙、デフォルトは比較ブランチとの差分）。Use when user says '全レビュー実行', 'review all', '一括レビュー', '総合チェック', 'PR レビュー', or '<branch> との差分レビュー'."
---

## Instructions

8 のレビューを **Agent tool で並列に dispatch し、各 agent が Skill tool 経由で対応する `/review-*` skill を実行する** オーケストレーション skill。

### 進捗の可視化（必須）

並列サブエージェント実行中に親が沈黙すると「止まってる？」と見える。区切りで一文ずつ出す:

1. **着手前**: 「8件のレビューを並列起動します、目安3〜7分」
2. **dispatch 直後**: 「8件 dispatch 完了。結果を待機中」
3. **集約フェーズ前**: 「全 sub-review 完了。統合レポート作成中」
4. **完了時**: Summary 表を要約して出力

### レビュー対象スコープ

呼び出し時の引数で対象範囲が決まる。**取得は review-all 自身が起動直後に Bash で実行する**（sub-review に委ねない）。取得結果（実行コマンドとファイル一覧）は統合レポートの `## 対象スコープ` に転記する。

| 引数 | 対象 | 取得方法 |
| --- | --- | --- |
| なし（デフォルト）| デフォルト比較ブランチ vs HEAD | `git diff $(default_base)..HEAD --name-only`。`default_base` は **main → HEAD~1** の優先順で `git rev-parse --verify` が通る最初のもの |
| `wt` / `worktree` | 作業ツリーの未コミット変更（未追跡ファイル込み） | `git diff $(default_base) --name-only` と `git ls-files --others --exclude-standard` を**両方**実行して和集合を取る |
| `PR #<N>` / `pr:<N>` | GitHub PR の差分 | `gh pr diff <N> --name-only`。`gh` 未認証 / 404 は 1 行通知して中断（誤った範囲でレビューしない） |
| `vs:<branch>` / `vs <branch>` | 指定ブランチ vs HEAD | `git diff <branch>..HEAD --name-only`。無ければ `git fetch origin <branch>:<branch>` を試み、失敗ならエラー終了 |
| `<a>..<b>` / `<a>...<b>` | 任意 range | `git diff <range> --name-only` |
| ファイル列挙 | 指定ファイル群 | 引数をそのまま使用 |

引数の判定順序: ① `wt` / `worktree` → ② `PR #N`/`pr:N` → ③ `vs:` プレフィックス → ④ `..` を含む → ⑤ 単一引数が `git rev-parse --verify` に通り同名ファイルが無ければ `vs:<arg>` 扱い → ⑥ それ以外はファイル列挙。

このプロジェクトは未コミットの作業ツリーをそのままレビューしたい場面が多い。**引数なしで実行した結果が空・またはユーザーが「いま直した分を見て」と言っている場合は `wt` を使う**（使ったモードは必ずレポートに書く）。

ファイル一覧は `.ts` 以外（`docs/*.md`・`src/database/schema.sql`・`package.json`・`.gitignore` 等）も全件そのまま渡す（各 sub-review が自分の関心ファイルだけを絞る）。

**伝達方法**: 各 Agent prompt の末尾に必ず以下を付与する:

```
対象スコープ: <default(<base>) / wt / PR #N / vs:<branch> / <range> / ファイル列挙>
取得コマンド: <実行した git/gh コマンド全文>
対象ファイル一覧:
- src/...
- docs/...
```

### 8 件の実行（並列）

相互に依存しないため**必ず並列実行する**（単一メッセージ内で 8 個の Agent tool 呼び出しを並べる）:

1. `/review-arch` — 層構造 / 依存方向 / 配置
2. `/review-code` — TS / Bun のコード品質・機械検証（`bun run c` / `bun run lint`）
3. `/review-scoring` — スコアリング / ML のドメイン正しさ（対象の変更なしなら SKIPPED）
4. `/review-security` — 取得先制限 / 外部データ検証 / SQL / パス / 生成物（対象の変更なしなら SKIPPED）
5. `/review-test` — bun:test の品質・回帰テスト
6. `/review-naming` — 命名のドメイン適合性 / 語彙の一貫性
7. `/review-recovery` — 時刻の注入可能性 / 再インポートの冪等性 / トランザクション / 接続解放（対象の変更なしなら SKIPPED）
8. `/review-comments` — コメントの不要・過剰・陳腐化・増えすぎ（コメント変更なしなら SKIPPED）

Agent prompt テンプレート:

```
Skill tool で /review-<NAME> を呼び、レビューを実行してください。
完了後、レポート全文（Summary 行を含む末尾まで）をそのまま返答してください。

対象スコープ: <内容>
取得コマンド: <コマンド>
対象ファイル一覧:
- ...
```

### 検証コマンド（sub-review に共有する前提）

- 型チェックは **`bun run c`**（`tsgo --noEmit`）。**`bun c` と書くと `bun create` と解釈されて失敗する**ので必ず `bun run` を付ける
- lint は `bun run lint`（`biome lint --max-diagnostics=none`）。**レビュー開始時に 1 回流して warning 件数のベースラインをその場で取る**（件数は常に動くのでここには書かない）。error は FAIL、warning の base からの**純増**は WARN
- テストは `bun test`。同じくレビュー開始時に 1 回流して pass 件数のベースラインを取り、減っていれば FAIL
- base（比較対象リビジョン）側の件数が要るときは、base をチェックアウトせずとも「本変更で触ったファイルに紐づく warning が新規に増えていないか」を診断の file:line で判定してよい

### Summary 行の収集

各 sub-review はレポート末尾に必ず `Summary: OK=<n> WARN=<n> FAIL=<n>` または `Summary: SKIPPED` を出力する契約。review-all はこれを統合テーブルに転記する。

### FAIL の定義と帰属判定（必須・誤検出防止）

sub-review が**既存債務（比較対象由来の行）を「本変更起因の FAIL」と誤判定**することを防ぐため、各 Agent prompt の末尾に次の規律を必ず含める:

```
FAIL の定義: FAIL は「本変更が新規に作り込んだ欠陥」または「検証コマンド（bun run c / bun run lint / bun test）を実際に落とす違反」に限定する。
既存債務（比較対象由来・本変更で未変更の行）は WARN 以下に下げ、備考に「既存債務(本変更非起因)」と明記する。
帰属は推測で決めず差分で確認する: 当該行が差分に `+` 追加として含まれるかを
  `git blame -L <line>,<line> -- <file>` または取得済み diff 本文で必ず照合する。
未追跡ファイル（wt スコープの新規ファイル）は全行が本変更起因として扱ってよい。
```

**親の FAIL 照合ステップ（統合前に必須）**: 各 FAIL を最低 1 回、実コードまたは差分で照合する。誤帰属・誤検出を見つけたら `## 統合判定の訂正` セクションに「どの FAIL を何に訂正したか」を明示してから合計へ反映する。sub-review の FAIL を鵜呑みにしない。

### エラー時の挙動（必ず続行する）

| 事象 | 表記 | 合計への計上 |
| --- | --- | --- |
| Agent が異常終了 | `(agent error)` | 含めない |
| Summary 行が読み取れない | `(no summary)` | 含めない |
| `Summary: SKIPPED` | 各セル `-`、備考 `(skip)` | 含めない |
| 通常の数値 Summary | そのまま転記 | 含める |

**1 件の失敗で全体を止めない**。

### 統合レポート

```
# 有馬記念分析システム レビュー統合レポート

## 対象スコープ
- **モード**: default(<base>) / wt / PR #<N> / vs:<branch> / <range> / ファイル列挙
- **取得コマンド**: `...`
- **対象ファイル数**: N 件

## サマリ

| # | レビュー対象 | OK | WARN | FAIL |
| - | --- | --- | --- | --- |
| 1 | アーキテクチャ / 層構造 | ? | ? | ? |
| 2 | コード品質 | ? | ? | ? |
| 3 | スコアリング / ML | ? | ? | ? |
| 4 | セキュリティ | ? | ? | ? |
| 5 | テスト品質 | ? | ? | ? |
| 6 | 命名 / ドメイン適合性 | ? | ? | ? |
| 7 | リカバリー / テスタビリティ | ? | ? | ? |
| 8 | コメント / 不要・過剰・陳腐化 | ? | ? | ? |
| **合計（実施 N/8 件）** | | **?** | **?** | **?** |

## 推奨アクション（優先度順）

FAIL→HIGH / WARN→MEDIUM / OK備考の改善余地→LOW にマップし、重複は集約する:
- 同じ file:line・同じ修正内容 → 1 件に集約し最高優先度を採用、所属スキルを併記 `[review-scoring / review-security]`
- 同じ file:line でも観点が異なる → 集約しない（多面評価を保つ）
- 異なる file:line で同趣旨 → 件数を括弧で集計し代表 1 件を記載

### HIGH / MEDIUM / LOW
- ...

## 各レビュー詳細
(各レビューの返答全文を連結)
```

### 結果ファイル出力

統合レポート全文を `/tmp/arima-review-all-result.md` に Write すること（review-fix / review-fix-loop が読み取るため）。
