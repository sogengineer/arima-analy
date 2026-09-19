---
name: review-fix-loop
description: "/review-fix をループ実行し、CONVERGED になるまで自動修正を繰り返す。スコープ引数は /review-all と同じ（wt / PR #N / pr:N / vs:<branch> / git range / ファイル列挙、デフォルトは比較ブランチとの差分）。最大イテレーション数を数値で指定可能。Use when user says 'レビュー収束まで繰り返して', 'review-fix-loop', '自動修正ループ', or '収束するまでレビュー'."
---

## Instructions

`/review-fix` を繰り返し実行し、`CONVERGED` になるまで自動ループする。

### 進捗の可視化（必須）

1 イテレーション 5〜20 分 × 最大 N 回かかる。沈黙厳禁:

1. **着手前**: 「review-fix-loop 開始。最大 N イテレーション」
2. **各イテレーション開始時**: 「Iter K/N 開始: /review-fix 実行中」
3. **各イテレーション完了時**: 「Iter K 完了: HIGH=x MEDIUM=y LOW=z, Status=CONVERGED/NOT_CONVERGED」
4. **完了時**: 最終レポート表

### パラメータ

| 引数 | 説明 | デフォルト |
| ---- | ---- | ---------- |
| 数値のみ | 最大イテレーション数（安全弁） | 3 |
| スコープ引数 | `/review-all` と同じ | なし（デフォルト比較ブランチ差分） |

例: `/review-fix-loop` / `/review-fix-loop 5` / `/review-fix-loop 3 wt` / `/review-fix-loop 5 PR #10`

### 各イテレーションは観点を絞らない（必須）

2回目以降のイテレーションでも、**毎回フルの `/review-fix`（= 全 8 観点のレビュー）を実行する**。「前 Iter の修正は小さい／変更ファイルはこれだけ」という理由でレビュー観点や対象を絞り込んではならない。

- 理由: 収束判定の目的は「修正が新たなデグレを生んでいないこと」の確認であり、デグレは修正ファイル外・別観点に現れうる。観点を絞ると見落とす。
- したがって Iter 2 以降で review-recovery だけ・review-test だけ、といった部分ディスパッチは禁止。`/review-fix` を素で呼び直す（`/review-fix` が内部で 8 観点を並列起動する）。
- 対象スコープも初回と同一に保つ（絞らない）。ループ内で修正した未コミット変更も評価対象に含めたい場合は、スコープに `wt`（作業ツリー = `git diff <base>` + 未追跡ファイル）を使うのは可。ただし観点は常に全件。

### 設計判断: Agent を介さず Skill を直接呼ぶ

`/review-fix` 内部で sub-Agent が並列起動するため文脈分離はそこで確保される。L1 Agent ラッパーはロードのオーバーヘッドだけなので、**main session から Skill ツールで `/review-fix` を直接呼ぶ**。

### 実行手順

#### 0. 前回結果ファイルの削除

各イテレーション開始前に Bash で実行（残存ファイルでの誤判定防止）:

```
rm -f /tmp/arima-review-all-result.md /tmp/arima-review-fix-result.md
```

#### 1. /review-fix の呼び出し

Skill ツールで `/review-fix` を呼ぶ。**args に `mode=non-interactive` を必ず付加**し、スコープ引数があれば転送する:

```
Skill(skill="review-fix", args="mode=non-interactive")
Skill(skill="review-fix", args="wt mode=non-interactive")
Skill(skill="review-fix", args="PR #10 mode=non-interactive")
```

#### 2. 結果ファイル検証

完了後 `/tmp/arima-review-fix-result.md` を Read する。ファイル不在・形式不正（「対応サマリ」テーブル・「収束判定」セクションが無い）は **NOT_CONVERGED** とみなす。

#### 3. 収束判定

「対応サマリ」テーブルをパースして判定:

| 条件 | 判定 |
| --- | --- |
| HIGH=0, MEDIUM=0, LOW=0（修正対象なし） | 収束 → 終了 |
| 指摘が 1 件でもあった（対応済み・スキップ問わず） | 未収束 → 次へ |
| ファイル不在・形式不正 | 未収束 → 次へ |

**重要**: `/review-fix` が `CONVERGED` と自己申告していても、指摘数が 0 でなければ NOT_CONVERGED とする。修正した以上、デグレの可能性があるため必ず再レビューする。

#### 4. ループ継続

未収束なら手順 0 へ戻る。最大イテレーション数に達したら終了。

### 最終レポート

```
# Review-Fix Loop 結果

| # | HIGH | MEDIUM | LOW | 結果          |
| - | ---- | ------ | --- | ------------- |
| 1 | 2    | 3      | 1   | NOT_CONVERGED |
| 2 | 0    | 0      | 0   | CONVERGED     |

**最終結果: CONVERGED / NOT_CONVERGED（上限到達）**
```

NOT_CONVERGED で終了した場合は、残存指摘（最後の `/tmp/arima-review-fix-result.md` の内容）を要約してユーザーに引き継ぐ。

### 注意事項

- スコアの重み・計算式を変える修正が入った場合、ドキュメント（`docs/MODELS.md` 等）の追随がループ内で漏れていないかを最終レポートで必ず確認する
- 検証コマンドは `bun run c` / `bun run lint` / `bun test`。**`bun c` は `bun create` と解釈されて失敗する**ため、ループ内のどの段階でも `bun run c` と書く
- 各イテレーションでテストの skip・削除によって緑にしていないか、最終レポート作成前に `grep -rE '\.(skip|only)\(' src` で確認する
- main session には各イテレーションのサマリだけが蓄積される（レビュー全文は sub-Agent 側）
