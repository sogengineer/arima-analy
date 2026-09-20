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

## 蓄積状況の確認

取り込み後の蓄積量・主要特徴量の欠損率は次のコマンドで確認できます。

```bash
bun start data-status
```
