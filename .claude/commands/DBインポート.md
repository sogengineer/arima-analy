# DBインポート

抽出済みJSONファイルをデータベースにインポートします。

## 引数

- `$ARGUMENTS`: JSONファイルのパス

## 実行コマンド

```bash
npx tsx src/index.ts import-url "$ARGUMENTS"
```

## 使用例

```
/DBインポート data/horse-extracted-data.json
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

1. `/データ取得 <URL>` でHTML取得・抽出
2. `/DBインポート data/horse-extracted-data.json` でDB保存
3. `/レース一覧` で確認
4. `/スコア計算 <ID>` で分析
