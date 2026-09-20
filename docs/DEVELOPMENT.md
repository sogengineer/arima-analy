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
| ランタイム | Bun (TypeScript直接実行) |
| パッケージマネージャ | bun |
| データベース | SQLite (bun:sqlite) |
| CLIフレームワーク | Commander.js |
| 機械学習 | 自前実装のロジスティック回帰（src/models/LogisticRegression.ts） |
| 統計計算 | simple-statistics, ml-matrix |
| テスト | bun test |
| 静的解析 | Biome, TypeScript |

---

## プロジェクト構造

```
arima/
├── src/
│   ├── index.ts                    # メインエントリーポイント（CLI定義）
│   ├── commands/                   # コマンド実装（動詞ベース命名）
│   │   ├── ListHorses.ts           # 馬一覧表示
│   │   ├── ListJockeys.ts          # 騎手一覧表示
│   │   ├── AnalyzePerformance.ts   # 戦績分析
│   │   ├── AnalyzeTrack.ts         # 馬場分析
│   │   ├── AnalyzeCourse.ts        # コース分析
│   │   ├── CalculateScore.ts       # スコアリング
│   │   ├── Predict.ts              # 統計予測
│   │   ├── ImportData.ts           # データインポート
│   │   └── ExtractData.ts          # データ抽出
│   ├── constants/                  # 定数定義
│   │   ├── ScoringConstants.ts     # スコア重み・着順スコア
│   │   ├── DistanceConstants.ts    # 距離・期間閾値
│   │   └── MLConstants.ts          # 機械学習パラメータ
│   ├── database/
│   │   ├── Database.ts             # レガシーDB（後方互換）
│   │   ├── DatabaseConnection.ts   # 接続管理
│   │   └── schema.sql              # スキーマ定義
│   ├── domain/                     # ドメイン層（リッチドメインモデル）
│   │   ├── entities/
│   │   │   ├── Horse.ts            # 馬エンティティ（スコア計算内包）
│   │   │   ├── Jockey.ts           # 騎手エンティティ
│   │   │   ├── Race.ts             # レースエンティティ
│   │   │   └── RaceResult.ts       # レース結果
│   │   ├── valueObjects/
│   │   │   ├── Score.ts            # スコア値オブジェクト
│   │   │   └── ScoreComponents.ts  # 10要素スコア構成
│   │   └── services/
│   │       └── ScoringOrchestrator.ts # スコアリングオーケストレーター
│   ├── repositories/               # リポジトリ層
│   │   ├── queries/                # 取得系（JOIN）
│   │   │   ├── HorseQueryRepository.ts
│   │   │   ├── RaceQueryRepository.ts
│   │   │   ├── JockeyQueryRepository.ts
│   │   │   └── StatsQueryRepository.ts
│   │   └── aggregates/             # 更新系（集約単位）
│   │       ├── HorseAggregateRepository.ts
│   │       ├── RaceAggregateRepository.ts
│   │       └── ScoreAggregateRepository.ts
│   ├── models/
│   │   └── MachineLearningModel.ts # 機械学習モデル
│   ├── types/
│   │   ├── HorseData.ts            # データ型定義
│   │   ├── RepositoryTypes.ts      # リポジトリ型定義
│   │   └── ml-modules.d.ts         # ML関連型定義
│   └── utils/
│       ├── HorseDataExtractor.ts   # HTMLデータ抽出
│       └── JRAFetcher.ts           # JRAデータ取得
├── data/                           # データディレクトリ
├── docs/                           # ドキュメント
├── dist/                           # ビルド出力
├── .claude/
│   └── skills/                     # Claude Codeスキル定義
├── arima.db                        # SQLiteデータベース
├── package.json
├── tsconfig.json
└── README.md
```

---

## セットアップ

### 前提条件

- Bun 1.1以上

### インストール

```bash
# リポジトリをクローン
git clone <repository-url>
cd arima

# 依存パッケージをインストール
bun install
```

### データベース初期化

ビルド時にスキーマが自動的にコピーされます。データベースは初回実行時に自動作成されます。

```bash
# 手動でスキーマを適用する場合
sqlite3 arima.db < dist/database/schema.sql
```

---

## スクリプト

| スクリプト | 説明 |
|-----------|------|
| `bun run c` | 型チェックのみ（noEmit）。`bun c` は `bun create` と解釈されて失敗する |
| `bun start` | src/index.ts を実行 |
| `bun dev` | ホットリロード付きで開発実行 |
| `bun run lint` | Biome で静的解析（linter のみ。formatter と import 整理は無効） |
| `bun test` | bun test でテスト実行 |
| `bun fetch-jra` | JRA URLからHTMLを取得 |
| `bun extract-html` | HTMLから馬データを抽出 |
| `bun fetch-and-extract` | JRAから取得して自動抽出 |

### 使用例

```bash
# 開発モードで実行
bun dev horses

# スコアリングを実行
bun start score

# JRAからデータを取得して抽出
bun fetch-and-extract https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01sde1012024122206
```

---

## 依存ライブラリ

### 本番依存関係（dependencies）

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| commander | ^11.1.0 | CLIフレームワーク |
| iconv-lite | ^0.7.1 | 文字コード変換（Shift_JIS対応） |
| ml-matrix | ^6.10.0 | 行列演算 |
| simple-statistics | ^7.8.8 | 統計計算 |

### 開発依存関係（devDependencies）

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| typescript | ^5.9.3 | TypeScriptコンパイラ |
| @types/bun | ^1.3.14 | Bun型定義（bun:sqlite含む） |
| @types/node | ^20.10.0 | 型定義 |
| @biomejs/biome | ^2.5.14 | 静的解析（linter のみ使用。設定は `biome.json` と `biome-plugins/*.grit`） |

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

// スコア構成要素（10要素）
interface ScoreComponents {
  recentPerformanceScore: number;   // 直近成績 22%
  venueAptitudeScore: number;       // コース適性 15%
  distanceAptitudeScore: number;    // 距離適性 12%
  last3FAbilityScore: number;       // 上がり3F 10%
  g1AchievementScore: number;       // G1実績 5%
  rotationAptitudeScore: number;    // ローテ 10%
  jockeyScore: number;              // 騎手能力 8%
  trackConditionScore: number;      // 馬場適性 5%
  postPositionScore: number;        // 枠順効果 5%
  trainerScore: number;             // 調教師 8%
}
```

---

## コーディング規約

### TypeScript

- strict モードを使用
- 明示的な型アノテーションを推奨
- `any` の使用は避ける

### ファイル命名

- コマンド: 動詞ベースPascalCase（例: `CalculateScore.ts`, `ListHorses.ts`）
- エンティティ: 名詞PascalCase（例: `Horse.ts`, `Jockey.ts`）
- リポジトリ: 〇〇Repository.ts（例: `HorseQueryRepository.ts`）
- ユーティリティ: PascalCase（例: `HorseDataExtractor.ts`）
- 型定義: PascalCase（例: `HorseData.ts`）

### インポート順序

1. Node.js 標準モジュール・Bun組み込みモジュール
2. サードパーティパッケージ
3. 内部モジュール（相対パス）

```typescript
import path from 'path';
import { Database } from 'bun:sqlite';
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
bun test

# ウォッチモードで実行
bun test --watch

# カバレッジレポート
bun test --coverage
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
Error: Cannot find module 'ml-matrix'
```

→ `bun install` を再実行してください。
