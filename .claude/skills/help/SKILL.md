---
name: help
description: 有馬記念分析システムで利用可能なスキル一覧と使い方、スコア配分、基本ワークフローを表示する。「ヘルプ」「使い方を教えて」「何ができるの」といった依頼で発動する。
---

# 有馬記念分析システム ヘルプ

利用可能なスキル一覧を表示します。

## データ管理スキル

| スキル | 説明 |
|----------|------|
| fetch-data | JRA URLからデータ取得・抽出 |
| db-import | JSONをDBにインポート |

## 一覧表示スキル

| スキル | 説明 |
|----------|------|
| race-list | 登録済みレース一覧 |
| horse-list | 登録済み馬一覧（血統付き） |
| pedigree-analysis | 種牡馬統計 |

## 分析スキル

| スキル | 説明 |
|----------|------|
| score-calc | 10要素スコアリング（レースIDを指定） |
| course-analysis | 会場別コース適性分析（省略時は全会場） |

## スコア配分

```
総合スコア =
  直近成績 × 22% +
  コース適性 × 15% +
  距離適性 × 12% +
  上がり3F × 10% +
  G1実績 × 5% +
  ローテ × 10% +
  騎手能力 × 8% +
  馬場適性 × 5% +
  枠順効果 × 5% +
  調教師 × 8%
```

※ 重みの正は `src/constants/ScoringConstants.ts` の `SCORE_WEIGHTS`。

## 主なCLIコマンド（スキル外）

| コマンド | 説明 |
|----------|------|
| `bun start ml --race <id>` | 機械学習予測（LR＋RF） |
| `bun start backtest` | 過去レースで予測精度を検証 |
| `bun start optimize-weights` | 過去データから最適な重みを学習 |

## 基本ワークフロー

1. fetch-data スキルでデータ抽出（JRA URLを指定）
2. db-import スキルでDBインポート（抽出したJSONを指定）
3. race-list スキルでレースID確認
4. score-calc スキルでスコアリング（レースIDを指定）

## 開発用スキル

コード変更・レビューを行うときに使うスキル。分析の運用フローでは使いません。

### 進め方・設計

| スキル | 説明 |
|----------|------|
| orchestrate | 調査・設計・実装・レビューをサブエージェントに分解して進行（「調べて」「設計して」「実装して」） |
| design-principles | 実装前後に読む設計原則（理解容易性の7観点・失敗4パターン） |
| empirical-prompt-tuning | スキル・プロンプトを別エージェントに実行させて反復改善する手法 |

### レビュー

| スキル | 説明 |
|----------|------|
| review-all | 8観点の一括レビュー（指摘のみ） |
| review-fix | レビュー + 指摘の反映 |
| review-fix-loop | 収束するまで自動反復 |
| review-arch / review-code / review-comments / review-naming | 層構成・コードスタイル・コメント・命名の個別観点 |
| review-test / review-recovery / review-security | テスト・エラー回復・セキュリティの個別観点 |
| review-scoring | スコアリング/MLのドメイン正しさ（重み合計・特徴量統一・未来情報リーク・学習・予測の再現性） |

スコープ引数を省略した場合は main との差分が対象です。

### 開発時の検証コマンド

| コマンド | 説明 |
|----------|------|
| `bun run c` | 型チェック（`bun c` は `bun create` と解釈されて失敗するので不可） |
| `bun run lint` | Biome 2.5.14（linter のみ。formatter は無効）。`biome-plugins/*.grit` の自作ルールを含む。**error は 0 が基準**、warning はベースラインから増やさない |
| `bun test` | テスト（`__test__/` 併置） |

規約の正は `docs/ARCHITECTURE.md`（層構成・パイプライン）と `docs/DEVELOPMENT.md`（技術スタック・命名・コーディング規約）です。
