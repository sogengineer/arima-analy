# アーキテクチャ

有馬記念分析システムの技術アーキテクチャとデータフローを説明します。

## 目次

- [システム概要](#システム概要)
- [処理フロー](#処理フロー)
- [スコアリングパイプライン](#スコアリングパイプライン)
- [ML予測パイプライン](#ml予測パイプライン)
- [バックテスト・重み最適化](#バックテスト・重み最適化)
- [レイヤー構成](#レイヤー構成)

---

## システム概要

```mermaid
flowchart LR
    subgraph fetch["データ取得"]
        JRA[JRA Web<br/>HTML] --> Extractor[データ抽出]
    end

    subgraph persist["データ永続化"]
        Extractor --> DB[(SQLite DB)]
    end

    subgraph predict["分析・予測"]
        DB --> Scoring[スコアリング<br/>10要素]
        DB --> ML[ML予測<br/>RF+LR]
        Scoring --> Final[最終予想]
        ML --> Final
    end
```

---

## 処理フロー

### 1. データ取得・登録フロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant CLI as CLI (index.ts)
    participant Fetcher as JRAFetcher
    participant Extractor as HorseDataExtractor
    participant ImportData as ImportData
    participant DB as SQLite DB

    User->>CLI: arima fetch-and-extract <URL>
    CLI->>Fetcher: fetchAndSave(url)
    Fetcher->>Fetcher: HTTP GET (JRA HTML)
    Fetcher-->>CLI: data/jra-page.html

    CLI->>Extractor: extractFromHTML(file)
    Extractor->>Extractor: DOM解析
    Extractor->>Extractor: 馬情報・血統・前走抽出
    Extractor-->>CLI: horse-extracted-data.json

    User->>CLI: arima import-url <json>
    CLI->>ImportData: importExtractedJSON(file)
    ImportData->>DB: INSERT horses
    ImportData->>DB: INSERT sires, mares
    ImportData->>DB: INSERT race_entries
    ImportData->>DB: INSERT race_results
    ImportData-->>User: インポート完了
```

### 2. スコアリング予測フロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant CLI as CLI
    participant Cmd as CalculateScore
    participant Orch as ScoringOrchestrator
    participant Horse as Horse Entity
    participant Jockey as Jockey Entity
    participant Repo as Repositories
    participant DB as SQLite DB

    User->>CLI: arima score --race 有馬
    CLI->>Cmd: execute({race: "有馬"})
    Cmd->>Orch: getRaceByIdOrName("有馬")
    Orch->>Repo: getRaceWithVenue()
    Repo->>DB: SELECT races JOIN venues
    DB-->>Repo: RaceWithVenue
    Repo-->>Orch: race

    Cmd->>Orch: calculateScoresForRace(raceId)

    loop 各出走馬
        Orch->>Repo: バッチ取得 (4クエリ)
        Note over Repo,DB: getHorsesWithDetailsBatch<br/>getHorsesRaceResultsBatch<br/>getHorsesCourseStatsBatch<br/>getHorsesTrackStatsBatch
        Repo->>DB: SELECT (バッチ)
        DB-->>Repo: 馬データ一括

        Orch->>Horse: builder().withDetail().withRaceResults()...build()
        Orch->>Jockey: builder().withVenueStats().withOverallStats()...build()

        Orch->>Horse: calculateTotalScore(jockey, race, trainer, postPosition)
        Note over Horse: 10要素スコア計算<br/>・直近成績 22%<br/>・コース適性 15%<br/>・距離適性 12%<br/>・上がり3F 10%<br/>・G1実績 5%<br/>・ローテ 10%<br/>・騎手 8%<br/>・馬場適性 5%<br/>・枠順 5%<br/>・調教師 8%
        Horse-->>Orch: ScoreComponents
    end

    Orch-->>Cmd: HorseScoreResult[]
    Cmd->>Repo: updateHorseScore() (DB保存)
    Cmd-->>User: ランキング表示
```

### 3. ML予測フロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant CLI as CLI
    participant ML as MachineLearningModel
    participant Orch as ScoringOrchestrator
    participant RF as RandomForest
    participant LR as LogisticRegression
    participant DB as SQLite DB

    User->>CLI: arima ml --race <raceId>
    CLI->>ML: new MachineLearningModel()
    CLI->>ML: predict(raceId)

    alt 未訓練
        ML->>ML: trainModels()
        ML->>DB: getAllRaceResults()
        DB-->>ML: 過去レース結果

        loop 各結果
            ML->>Orch: extractFeaturesForRace(horseId, raceId)
            Note over Orch: スコアリングと同じ<br/>10要素を特徴量として使用
            Orch-->>ML: MLFeatures (10要素)
        end

        ML->>LR: train(features, labels)
        ML->>RF: train(features, labels)
    end

    ML->>DB: getRaceEntries(raceId)
    DB-->>ML: 出走馬一覧

    loop 各出走馬
        ML->>Orch: extractFeaturesForRace()
        Orch-->>ML: features[]
        ML->>LR: predict(features)
        LR-->>ML: logisticProb
        ML->>RF: predict(features)
        RF-->>ML: rfProb
        ML->>ML: ensemble (0.3*LR + 0.7*RF)
    end

    ML-->>User: PredictionResult[] (確率順)
```

---

## スコアリングパイプライン

### 10要素スコア計算

```mermaid
flowchart TB
    subgraph ability["馬の能力・実績 (59%)"]
        recent["直近成績 22%<br/>calculateRecentPerformanceScore()"]
        venue["コース適性 15%<br/>calculateVenueAptitudeScore()"]
        distance["距離適性 12%<br/>calculateDistanceAptitudeScore()"]
        last3f["上がり3F 10%<br/>calculateLast3FAbilityScore()"]
    end

    subgraph experience["実績・経験 (5%)"]
        g1["G1実績 5%<br/>calculateG1AchievementScore()"]
    end

    subgraph condition["コンディション (15%)"]
        rotation["ローテ適性 10%<br/>calculateRotationAptitudeScore()"]
        track["馬場適性 5%<br/>calculateTrackConditionScore()"]
    end

    subgraph human["人的要因 (16%)"]
        jockey["騎手能力 8%<br/>Jockey.calculateScore()"]
        trainer["調教師 8%<br/>Trainer.calculateScore()"]
    end

    subgraph post["枠順要因 (5%)"]
        postPos["枠順効果 5%<br/>getPostPositionScore()"]
    end

    recent --> total["総合スコア<br/>Σ(各要素 × 重み) = 100%"]
    venue --> total
    distance --> total
    last3f --> total
    g1 --> total
    rotation --> total
    track --> total
    jockey --> total
    trainer --> total
    postPos --> total
```

### エンティティ間の関係

```mermaid
classDiagram
    class Horse {
        +id: number
        +name: string
        +raceResults: RaceResult[]
        +courseStats: CourseStats[]
        +trackStats: TrackStats[]
        +calculateTotalScore(jockey, race, trainer, postPosition): ScoreComponents
        +calculateRecentPerformanceScore(): number
        +calculateVenueAptitudeScore(venue): number
        +calculateDistanceAptitudeScore(distance): number
    }

    class Jockey {
        +id: number
        +name: string
        +venueStats: Map~string, VenueStats~
        +overallStats: OverallStats
        +calculateScore(venue): number
    }

    class Trainer {
        +id: number
        +name: string
        +g1Wins: number
        +gradeWins: number
        +calculateScore(): number
    }

    class Race {
        +id: number
        +venue: string
        +distance: number
        +trackCondition: string
        +fromDbRecord(record): Race
    }

    class ScoreComponents {
        +recentPerformanceScore: number
        +venueAptitudeScore: number
        +distanceAptitudeScore: number
        +last3FAbilityScore: number
        +g1AchievementScore: number
        +rotationAptitudeScore: number
        +jockeyScore: number
        +trackConditionScore: number
        +postPositionScore: number
        +trainerScore: number
        +calculateTotalScore(): number
    }

    Horse --> ScoreComponents : creates
    Horse ..> Jockey : uses
    Horse ..> Trainer : uses
    Horse ..> Race : uses
```

---

## ML予測パイプライン

### 特徴量統一アーキテクチャ

```mermaid
flowchart TB
    subgraph features["共通特徴量 (10要素)"]
        direction LR
        f1["直近成績 22%"]
        f2["コース 15%"]
        f3["距離 12%"]
        f4["上がり3F 10%"]
        f5["G1実績 5%"]
        f6["ローテ 10%"]
        f7["馬場 5%"]
        f8["騎手 8%"]
        f9["調教師 8%"]
        f10["枠順 5%"]
    end

    features --> scoring["スコアリング<br/>・重み付け合計<br/>・SCORE_WEIGHTS参照"]
    features --> ml["ML予測<br/>・RF (70%)<br/>・LR (30%)<br/>・アンサンブル"]

    scoring --> scoreResult["総合スコア<br/>(0-100点)"]
    ml --> mlResult["複勝確率<br/>(0-100%)"]
```

---

## バックテスト・重み最適化

### バックテストフロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant CLI as CLI
    participant BT as Backtest
    participant Orch as ScoringOrchestrator
    participant Repo as RaceQueryRepository
    participant DB as SQLite DB

    User->>CLI: arima backtest
    CLI->>BT: execute({gradeOnly: true})

    BT->>Repo: getRacesWithResults(gradeOnly)
    Repo->>DB: SELECT races WITH results
    DB-->>Repo: RaceWithVenue[]
    Repo-->>BT: 過去レース一覧

    loop 各レース
        BT->>BT: evaluateRace(raceId)
        BT->>Orch: calculateScoresForRace(raceId)
        Orch-->>BT: predictions (スコア順)
        BT->>Repo: getRaceResults(raceId)
        Repo-->>BT: actuals (実際の着順)
        BT->>BT: calculateMetrics(predictions, actuals)
        Note over BT: ・1位的中率<br/>・上位3頭精度<br/>・順位相関
    end

    BT->>BT: calculateSummary(results)
    BT->>BT: calculateElementContribution()
    BT->>BT: simulateROI()
    BT->>BT: suggestWeightImprovements()
    BT-->>User: サマリー表示
```

### 重み最適化フロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant CLI as CLI
    participant ML as MachineLearningModel
    participant Orch as ScoringOrchestrator
    participant DB as SQLite DB

    User->>CLI: arima optimize-weights
    CLI->>ML: optimizeWeights(lambda=0.1)

    ML->>ML: prepareTrainingDataForRegression()
    ML->>DB: getAllRaceResults()
    DB-->>ML: 過去レース結果

    loop 各結果
        ML->>Orch: extractFeaturesForRace()
        Orch-->>ML: 10要素スコア
        ML->>ML: labels.push(1 - (着順-1)/17)
        Note over ML: 1着=1.0, 18着=0.0
    end

    ML->>ML: ridgeRegression(features, labels, lambda)
    Note over ML: (X^T X + λI)^-1 X^T y
    ML->>ML: normalizeWeights()
    Note over ML: 負の重みを0に<br/>合計1.0に正規化

    ML->>ML: evaluateWeightImprovement()
    ML->>ML: displayOptimizationResults()

    alt --output オプション
        ML->>ML: getOptimizedWeightsAsConstants()
        ML-->>User: ScoringConstants.ts形式で出力
    end

    ML-->>User: 最適化結果表示
```

---

## レイヤー構成

```
src/
├── commands/                    # CLIコマンド層
│   ├── CalculateScore.ts       # スコアリング実行
│   ├── Backtest.ts             # バックテスト実行
│   ├── ImportData.ts           # データインポート
│   └── ...
│
├── domain/                      # ドメイン層 (DDD)
│   ├── entities/               # エンティティ
│   │   ├── Horse.ts           # 馬 (スコア計算ロジック内包)
│   │   ├── Jockey.ts          # 騎手
│   │   ├── Trainer.ts         # 調教師
│   │   ├── Race.ts            # レース
│   │   └── RaceResult.ts      # レース結果
│   │
│   ├── valueObjects/           # 値オブジェクト
│   │   ├── ScoreComponents.ts # 10要素スコア
│   │   └── Score.ts           # スコア値
│   │
│   └── services/               # ドメインサービス
│       └── ScoringOrchestrator.ts  # スコアリング統合
│
├── repositories/                # リポジトリ層
│   ├── queries/                # 参照系
│   │   ├── HorseQueryRepository.ts
│   │   ├── RaceQueryRepository.ts
│   │   └── JockeyQueryRepository.ts
│   │
│   └── aggregates/             # 更新系
│       ├── HorseAggregateRepository.ts
│       ├── RaceAggregateRepository.ts
│       └── ScoreAggregateRepository.ts
│
├── models/                      # 機械学習モデル
│   └── MachineLearningModel.ts # RF + LR アンサンブル
│
├── constants/                   # 定数
│   ├── ScoringConstants.ts     # 重み配分 (唯一の定義箇所)
│   ├── MLConstants.ts          # MLパラメータ
│   └── DistanceConstants.ts    # 距離カテゴリ
│
├── database/                    # DB関連
│   ├── DatabaseConnection.ts   # DB接続
│   └── schema.sql              # スキーマ定義
│
├── utils/                       # ユーティリティ
│   ├── JRAFetcher.ts           # JRA HTML取得
│   └── HorseDataExtractor.ts   # データ抽出
│
├── types/                       # 型定義
│   ├── HorseData.ts            # 馬データ型
│   └── RepositoryTypes.ts      # リポジトリ型
│
└── index.ts                     # CLIエントリポイント
```

---

## 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [コマンドリファレンス](COMMANDS.md) | CLIコマンド・スキル完全リファレンス |
| [データベース構造](DATABASE.md) | テーブル定義、ER図、スキーマ詳細 |
| [分析モデル詳細](MODELS.md) | スコアリング・機械学習モデルの詳細 |
| [開発者向け情報](DEVELOPMENT.md) | 技術スタック、型定義、コーディング規約 |
