# 開発者向け情報

有馬記念分析システムの開発者向け情報です。

## 目次

- [技術スタック](#技術スタック)
- [プロジェクト構造](#プロジェクト構造)
- [セットアップ](#セットアップ)
- [npmスクリプト](#npmスクリプト)
- [依存ライブラリ](#依存ライブラリ)
- [型定義](#型定義)
- [コーディング規約](#コーディング規約)

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| 言語 | TypeScript 5.9 |
| ランタイム | Node.js (ES Modules) |
| パッケージマネージャ | yarn |
| データベース | SQLite (better-sqlite3) |
| CLIフレームワーク | Commander.js |
| 機械学習 | ml-random-forest, ml-logistic-regression |
| 統計計算 | simple-statistics, regression |
| テスト | vitest |
| 静的解析 | ESLint, TypeScript |

---

## プロジェクト構造

```
arima/
├── src/
│   ├── index.ts                    # メインエントリーポイント（CLI定義）
│   ├── commands/                   # コマンド実装
│   │   ├── HorsesCommand.ts        # 馬一覧表示
│   │   ├── JockeysCommand.ts       # 騎手一覧表示
│   │   ├── PerformanceCommand.ts   # 戦績分析
│   │   ├── TrackAnalysisCommand.ts # 馬場分析
│   │   ├── CourseAnalysisCommand.ts # コース分析
│   │   ├── ScoreCommand.ts         # スコアリング
│   │   ├── PredictCommand.ts       # 統計予測
│   │   ├── ManualDataCommand.ts    # データインポート
│   │   └── StandaloneExtractCommand.ts # データ抽出
│   ├── database/
│   │   ├── Database.ts             # データベースアクセス層
│   │   └── schema.sql              # スキーマ定義
│   ├── models/
│   │   ├── ScoringModel.ts         # スコアリングモデル
│   │   └── MachineLearningModel.ts # 機械学習モデル
│   ├── types/
│   │   ├── HorseData.ts            # データ型定義
│   │   ├── ml-modules.d.ts         # ML関連型定義
│   │   └── regression.d.ts         # 回帰分析型定義
│   └── utils/
│       ├── HorseDataExtractor.ts   # HTMLデータ抽出
│       └── JRAFetcher.ts           # JRAデータ取得
├── data/                           # データディレクトリ
│   ├── jra-page.html               # 取得したHTML
│   ├── horse-extracted-data.json   # 抽出データ
│   └── sample_horses.json          # サンプルデータ
├── docs/                           # ドキュメント
│   ├── COMMANDS.md                 # コマンドリファレンス
│   ├── DATABASE.md                 # データベース構造
│   ├── MODELS.md                   # 分析モデル詳細
│   └── DEVELOPMENT.md              # 開発者向け情報（本ファイル）
├── dist/                           # ビルド出力
├── .claude/
│   └── commands/                   # Claude Codeスキル定義
├── arima.db                        # SQLiteデータベース
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

---

## セットアップ

### 前提条件

- Node.js 18以上
- yarn

### インストール

```bash
# リポジトリをクローン
git clone <repository-url>
cd arima

# 依存パッケージをインストール
yarn install

# ビルド
yarn build
```

### データベース初期化

ビルド時にスキーマが自動的にコピーされます。データベースは初回実行時に自動作成されます。

```bash
# 手動でスキーマを適用する場合
sqlite3 arima.db < dist/database/schema.sql
```

---

## npmスクリプト

| スクリプト | 説明 |
|-----------|------|
| `yarn build` | TypeScriptをコンパイル、スキーマをコピー |
| `yarn c` | 型チェックのみ（noEmit） |
| `yarn start` | dist/index.js を実行 |
| `yarn dev` | ホットリロード付きで開発実行 |
| `yarn lint` | ESLintで静的解析 |
| `yarn test` | vitestでテスト実行 |
| `yarn fetch-jra` | JRA URLからHTMLを取得 |
| `yarn extract-html` | HTMLから馬データを抽出 |
| `yarn fetch-and-extract` | JRAから取得して自動抽出 |

### 使用例

```bash
# 開発モードで実行
yarn dev horses

# ビルド後に実行
yarn build && yarn start score

# JRAからデータを取得して抽出
yarn fetch-and-extract https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01sde1012024122206
```

---

## 依存ライブラリ

### 本番依存関係（dependencies）

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| better-sqlite3 | ^12.5.0 | SQLiteデータベース操作 |
| commander | ^11.1.0 | CLIフレームワーク |
| iconv-lite | ^0.7.1 | 文字コード変換（Shift_JIS対応） |
| ml-logistic-regression | ^2.0.0 | ロジスティック回帰 |
| ml-matrix | ^6.10.0 | 行列演算 |
| ml-random-forest | ^2.1.0 | ランダムフォレスト |
| regression | ^2.0.1 | 回帰分析 |
| simple-statistics | ^7.8.8 | 統計計算 |

### 開発依存関係（devDependencies）

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| typescript | ^5.9.3 | TypeScriptコンパイラ |
| @types/better-sqlite3 | ^7.6.13 | 型定義 |
| @types/node | ^22.15.30 | 型定義 |
| eslint | ^9.29.0 | 静的解析 |
| @typescript-eslint/eslint-plugin | ^8.33.0 | ESLintプラグイン |
| @typescript-eslint/parser | ^8.33.0 | ESLintパーサー |
| tsx | ^4.20.3 | TypeScript実行ランタイム |
| vitest | ^3.2.2 | テストフレームワーク |

---

## 型定義

### 主要な型（src/types/HorseData.ts）

#### API/抽出用型

```typescript
// 馬の基本情報
interface HorseBasicInfo {
  name: string;
  age: number;
  sex: '牡' | '牝' | '騸';
  coatColor: string;
  owner: string;
  breeder: string;
  trainer: string;
}

// 血統情報
interface BloodlineInfo {
  sire: string;      // 父
  mare: string;      // 母
  mareSire: string;  // 母の父
}

// 騎手情報
interface JockeyInfo {
  name: string;
  weight: number;
}

// レース出走情報
interface RaceInfo {
  frameNumber: number;    // 枠番
  horseNumber: number;    // 馬番
  assignedWeight: number; // 斤量
  odds: number;           // オッズ
  popularity: number;     // 人気
}
```

#### データベース用型

```typescript
// 競走馬（DB）
interface DBHorse {
  id: number;
  name: string;
  birth_year: number;
  sex: '牡' | '牝' | '騸';
  sire_id: number;
  mare_id: number;
  trainer_id: number;
  // ...
}

// レース（DB）
interface DBRace {
  id: number;
  race_date: string;
  venue_id: number;
  race_name: string;
  race_class: string;
  distance: number;
  track_condition: '良' | '稍重' | '重' | '不良';
  // ...
}
```

### 機械学習関連型

```typescript
// ML特徴量
interface MLFeatures {
  last3RacesDeviation: number;
  lastRacePosition: number;
  lastRaceTimeDiff: number;
  nakayamaPlaceRate: number;
  jockeyNakayamaG1WinRate: number;
  age: number;
  sexNumeric: number;
  totalRuns: number;
  winRate: number;
  avgFinishPosition: number;
}

// スコア構成要素
interface ScoreComponents {
  recentPerformanceScore: number;
  nakayamaAptitudeScore: number;
  distanceAptitudeScore: number;
  last3FAbilityScore: number;
  g1AchievementScore: number;
  rotationAptitudeScore: number;
}
```

---

## コーディング規約

### TypeScript

- strict モードを使用
- 明示的な型アノテーションを推奨
- `any` の使用は避ける

### ファイル命名

- クラス: PascalCase（例: `ScoringModel.ts`）
- ユーティリティ: PascalCase（例: `HorseDataExtractor.ts`）
- 型定義: PascalCase（例: `HorseData.ts`）

### インポート順序

1. Node.js 標準モジュール
2. サードパーティパッケージ
3. 内部モジュール（相対パス）

```typescript
import path from 'path';
import Database from 'better-sqlite3';
import { DBHorse } from '../types/HorseData.js';
```

### コメント

- 関数の目的が明確でない場合はJSDocコメントを追加
- 複雑なロジックにはインラインコメントを追加

```typescript
/**
 * 直近5戦の成績からスコアを計算
 * @param horseId 馬ID
 * @returns 0-100のスコア
 */
calculateRecentPerformanceScore(horseId: number): number {
  // ...
}
```

---

## テスト

```bash
# 全テストを実行
yarn test

# ウォッチモードで実行
yarn test --watch

# カバレッジレポート
yarn test --coverage
```

---

## トラブルシューティング

### データベースエラー

```
Error: SQLITE_CANTOPEN: unable to open database file
```

→ `arima.db` ファイルのパーミッションを確認してください。

### 文字化け

JRAページの文字化けが発生する場合：

→ `iconv-lite` が正しくインストールされているか確認してください。

### ML関連のエラー

```
Error: Cannot find module 'ml-random-forest'
```

→ `yarn install` を再実行してください。
