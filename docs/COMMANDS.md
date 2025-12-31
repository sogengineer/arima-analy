# コマンドリファレンス

有馬記念分析システムのコマンド完全リファレンスです。

## 目次

- [Claude Code スキル](#claude-code-スキル)
- [CLIコマンド](#cliコマンド)
  - [データ取得・抽出](#データ取得抽出)
  - [データインポート](#データインポート)
  - [一覧表示](#一覧表示)
  - [分析・予測](#分析予測)

---

## Claude Code スキル

Claude Code を使用すると、対話形式で簡単に操作できます。

| スキル | 説明 |
|--------|------|
| `/データ取得` | JRA出馬表URLからデータを取得・抽出 |
| `/レース一覧` | 登録済みレースを一覧表示し、予想を実行 |
| `/スコア計算` | 指定レースのスコアリングを実行 |
| `/馬一覧` | 登録済み馬の一覧を血統情報付きで表示 |
| `/血統分析` | 種牡馬別の成績統計を表示 |
| `/コース分析` | 中山2500m適性分析を実行 |
| `/DBインポート` | 抽出済みJSONをデータベースにインポート |
| `/ヘルプ` | 使い方を表示 |

### スキルの使用例

```
# JRA出馬表からデータを取得
/データ取得 https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01sde1012024122206

# 登録済みレースから予想したいレースを選択
/レース一覧

# 特定レースのスコアを計算
/スコア計算 1
```

---

## CLIコマンド

CLIから直接実行する場合は、以下のコマンドを使用します。

```bash
# ビルド後
yarn start <コマンド>

# 開発モード
yarn dev <コマンド>
```

---

### データ取得・抽出

#### `fetch-jra <url>`

JRA公式サイトの出馬表ページからHTMLを取得します。

```bash
yarn start fetch-jra https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01sde1012024122206
```

**オプション:**
| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o, --output <file>` | 出力ファイルパス | `data/jra-page.html` |

---

#### `extract-html <file>`

HTMLファイルから馬データを抽出し、データベースに登録します。

```bash
yarn start extract-html data/jra-page.html
```

---

#### `extract-html-only <file>`

HTMLファイルから馬データを抽出し、JSONファイルに保存します（DB登録なし）。

```bash
yarn start extract-html-only data/jra-page.html
```

**オプション:**
| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o, --output <file>` | 出力ファイルパス | `data/horse-extracted-data.json` |
| `-f, --format <format>` | 出力形式（detailed/summary/csv） | `detailed` |

---

#### `fetch-and-extract <url>`

JRA URLからHTMLを取得し、データを自動抽出します（一括処理）。

```bash
yarn start fetch-and-extract https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01sde1012024122206
```

**オプション:**
| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o, --output <file>` | JSON出力ファイルパス | `data/horse-extracted-data.json` |
| `-f, --format <format>` | 出力形式 | `detailed` |

---

### データインポート

#### `import-json <file>`

JSONファイルからデータをインポートします。

```bash
yarn start import-json data/sample_horses.json
```

---

#### `import-csv <file> <type>`

CSVファイルからデータをインポートします。

```bash
yarn start import-csv data/horses.csv horses
```

**type:**
- `horses` - 競走馬データ
- `jockeys` - 騎手データ
- `results` - レース結果データ

> **注意:** この機能は現在未実装です。`import-url` コマンドをお使いください。

---

#### `import-url <file>`

抽出済みJSONファイルをデータベースにインポートします。

```bash
yarn start import-url data/horse-extracted-data.json
```

---

#### `add-horse <data>`

馬を手動で登録します。

```bash
yarn start add-horse "馬名,生年,性別,父,母,母父,調教師"
```

**例:**
```bash
yarn start add-horse "テスト馬,2020,牡,ディープインパクト,母馬名,キングカメハメハ,調教師名"
```

---

#### `add-result <data>`

レース結果を手動で登録します。

```bash
yarn start add-result "馬名,レース名,日付,着順,タイム"
```

> **注意:** この機能は現在未実装です。`import-url` コマンドをお使いください。

---

### 一覧表示

#### `horses`

登録済み馬の一覧を表示します。手動入力のガイドも表示されます。

```bash
yarn start horses
```

**出力例:**
```
ID | 馬名           | 生年 | 性別 | 父            | 調教師
---+---------------+------+------+---------------+-------
1  | アーモンドアイ  | 2015 | 牝   | ロードカナロア | 国枝栄
2  | コントレイル   | 2017 | 牡   | ディープインパクト | 矢作芳人
```

---

#### `jockeys`

登録済み騎手の一覧を表示します。

```bash
yarn start jockeys
```

---

#### `show-horses`

登録済み馬の一覧を血統情報付きで表示します。

```bash
yarn start show-horses
```

---

#### `show-sires`

種牡馬別の成績統計を表示します。

```bash
yarn start show-sires
```

---

### 分析・予測

#### `performance [horse_name]`

馬の過去戦績を分析します。馬名を指定しない場合は全馬を分析します。

```bash
# 全馬の戦績
yarn start performance

# 特定の馬
yarn start performance アーモンドアイ
```

**分析内容:**
- 直近5戦の成績
- 総勝率・連対率・複勝率
- 馬場別適性

---

#### `track-analysis`

馬場状態別の成績分析を実行します。

```bash
yarn start track-analysis
```

**分析内容:**
- 良・稍重・重・不良の各馬場での成績
- パフォーマンス評価（優秀/良好/普通/要注意）
- 最適馬場の判定

---

#### `course-analysis`

中山2500mコース適性分析を実行します（有馬記念対応）。

```bash
yarn start course-analysis
```

**分析内容:**
- 中山での過去成績
- 芝レース適性
- 適性スコア（上位10頭をランキング表示）

---

#### `score`

6要素スコアリングモデルで総合評価を算出します。

```bash
yarn start score
```

**オプション:**
| オプション | 説明 |
|-----------|------|
| `-r, --race <id>` | レースIDを指定 |
| `-v, --verbose` | 詳細出力 |

**スコア構成:**
- 直近成績スコア（25%）
- コース適性（20%）
- 距離適性（15%）
- 上がり3F能力（15%）
- G1実績（15%）
- ローテ適性（10%）

---

#### `predict`

統計ベースの予測を実行します（旧版）。

```bash
yarn start predict
```

**予測内容:**
- 勝率・連対率・複勝率
- 本命候補（勝率上位3頭）
- 穴馬候補
- 馬券推奨

---

#### `ml`

機械学習モデルで予測を実行します。

```bash
yarn start ml
```

**オプション:**
| オプション | 説明 |
|-----------|------|
| `-r, --race <id>` | レースIDを指定 |
| `-v, --verbose` | 詳細出力（特徴量の値など） |

**アルゴリズム:**
- ロジスティック回帰（30%の重み）
- ランダムフォレスト（70%の重み）
- アンサンブル予測

---

## コマンド一覧表

| コマンド | 説明 | 実装状態 |
|---------|------|---------|
| `fetch-jra` | JRA URLからHTML取得 | 実装済み |
| `extract-html` | HTMLからデータ抽出（DB登録） | 実装済み |
| `extract-html-only` | HTMLからデータ抽出（JSON保存） | 実装済み |
| `fetch-and-extract` | 取得＋抽出の一括処理 | 実装済み |
| `import-json` | JSONインポート | 実装済み |
| `import-csv` | CSVインポート | **未実装** |
| `import-url` | 抽出JSONをDBにインポート | 実装済み |
| `add-horse` | 馬の手動登録 | 実装済み |
| `add-result` | レース結果の手動登録 | **未実装** |
| `horses` | 馬一覧表示 | 実装済み |
| `jockeys` | 騎手一覧表示 | 実装済み |
| `show-horses` | 馬一覧（血統付き） | 実装済み |
| `show-sires` | 種牡馬統計表示 | 実装済み |
| `performance` | 戦績分析 | 実装済み |
| `track-analysis` | 馬場分析 | 実装済み |
| `course-analysis` | コース分析 | 実装済み |
| `score` | スコアリング | 実装済み |
| `predict` | 統計予測 | 実装済み |
| `ml` | 機械学習予測 | 実装済み |
