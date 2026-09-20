---
name: db-import
description: 抽出済みJSONファイル（馬・血統・レース出走データ）をSQLiteデータベースにインポートする。「DBインポート」「データベースに保存」「JSONをDBに登録」といった依頼で発動する。
---

# DBインポート

抽出済みJSONファイルをデータベースにインポートします。

## 引数

- ユーザーが指定したJSONファイルのパス（未指定の場合はデフォルトで `data/horse-extracted-data.json` を使用、または確認する）

## 実行コマンド

```bash
bun start import-url "<JSONファイルのパス>"
```

## 使用例

```
DBインポートして data/horse-extracted-data.json
```

## 処理内容

1. JSONファイルを読み込み
2. 血統情報（父・母・母父）を登録
3. 馬情報をUPSERT（既存なら更新、なければ新規）
4. レース・出走情報を登録
5. 前走データから過去レース結果を登録

## 出力例

```
🏁 レース登録: 有馬記念
🐎 馬: 新規10頭, 更新6頭
📊 エントリー: 16件
```

## ワークフロー

1. fetch-data スキルでURLからHTML取得・抽出
2. db-import スキルで `data/horse-extracted-data.json` をDB保存
3. race-list スキルで確認
4. score-calc スキルでレースIDを指定して分析

## 学習データの一括投入は `collect` を使う

このスキルは**1レースぶんの抽出JSON**を取り込むためのものです。
一般レースを含む過去レースをまとめて貯める場合は JSON を経由せず、
fetch-data スキル（または直接 `bun start collect`）を使ってください。

```bash
bun start collect --month 2024-12   # JRA公式から直接SQLiteへ
bun start data-status               # 蓄積状況の確認
```

`collect` は `races` / `race_entries` / `race_results` を一意制約に従って
UPSERTするため、同じ期間を繰り返し実行しても行は増えません。
