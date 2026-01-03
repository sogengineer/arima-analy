# データベース構造

有馬記念分析システムのデータベース構造の詳細です。SQLiteを使用しています。

## 目次

- [テーブル概要](#テーブル概要)
- [マスタテーブル](#マスタテーブル)
- [コアテーブル](#コアテーブル)
- [分析用テーブル](#分析用テーブル)
- [ビュー](#ビュー)
- [ER図](#er図)

---

## テーブル概要

| カテゴリ | テーブル名 | 説明 |
|---------|-----------|------|
| マスタ | `venues` | 競馬場 |
| マスタ | `sires` | 種牡馬（父馬） |
| マスタ | `mares` | 繁殖牝馬（母馬） |
| マスタ | `trainers` | 調教師 |
| マスタ | `owners` | 馬主 |
| マスタ | `breeders` | 生産者 |
| マスタ | `jockeys` | 騎手 |
| コア | `horses` | 競走馬 |
| コア | `races` | レース |
| コア | `race_entries` | 出馬表 |
| コア | `race_results` | レース結果 |
| 分析 | `bloodline_stats` | 血統別成績統計 |
| 分析 | `horse_course_stats` | 馬別コース適性 |
| 分析 | `horse_track_stats` | 馬別馬場適性 |
| 分析 | `jockey_trainer_stats` | 騎手・調教師コンビ成績 |
| 分析 | `horse_scores` | 馬スコア |

---

## マスタテーブル

### venues（競馬場）

```sql
CREATE TABLE venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  region TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| name | TEXT | 競馬場名（中山、東京など） |
| region | TEXT | 地域（関東、関西など） |

**初期データ:**
- 中山（関東）、東京（関東）、阪神（関西）、京都（関西）
- 中京（中部）、小倉（九州）、新潟（北信越）、福島（東北）
- 札幌（北海道）、函館（北海道）

---

### sires（種牡馬）

```sql
CREATE TABLE sires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  country TEXT DEFAULT '日本',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| name | TEXT | 種牡馬名 |
| country | TEXT | 産国 |

---

### mares（繁殖牝馬）

```sql
CREATE TABLE mares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sire_id INTEGER REFERENCES sires(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| name | TEXT | 繁殖牝馬名 |
| sire_id | INTEGER | 母の父（種牡馬ID） |

---

### trainers（調教師）

```sql
CREATE TABLE trainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  stable TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| name | TEXT | 調教師名 |
| stable | TEXT | 所属厩舎（美浦/栗東） |

---

### owners（馬主）

```sql
CREATE TABLE owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### breeders（生産者）

```sql
CREATE TABLE breeders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### jockeys（騎手）

```sql
CREATE TABLE jockeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  default_weight REAL,
  apprentice_status TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| name | TEXT | 騎手名 |
| default_weight | REAL | 斤量 |
| apprentice_status | TEXT | 見習い騎手ステータス |

---

## コアテーブル

### horses（競走馬）

```sql
CREATE TABLE horses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  birth_year INTEGER,
  sex TEXT CHECK(sex IN ('牡', '牝', '騸')),
  coat_color TEXT,
  sire_id INTEGER REFERENCES sires(id),
  mare_id INTEGER REFERENCES mares(id),
  trainer_id INTEGER REFERENCES trainers(id),
  owner_id INTEGER REFERENCES owners(id),
  breeder_id INTEGER REFERENCES breeders(id),
  jra_horse_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, sire_id, mare_id)
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| name | TEXT | 馬名 |
| birth_year | INTEGER | 生年 |
| sex | TEXT | 性別（牡/牝/騸） |
| coat_color | TEXT | 毛色 |
| sire_id | INTEGER | 父（種牡馬ID） |
| mare_id | INTEGER | 母（繁殖牝馬ID） |
| trainer_id | INTEGER | 調教師ID |
| owner_id | INTEGER | 馬主ID |
| breeder_id | INTEGER | 生産者ID |
| jra_horse_id | TEXT | JRA馬ID |

---

### races（レース）

```sql
CREATE TABLE races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_date DATE NOT NULL,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  race_number INTEGER,
  race_name TEXT NOT NULL,
  race_class TEXT,
  race_type TEXT CHECK(race_type IN ('芝', 'ダート', '障害')),
  distance INTEGER NOT NULL,
  track_condition TEXT CHECK(track_condition IN ('良', '稍重', '重', '不良')),
  age_condition TEXT,
  sex_condition TEXT,
  weight_condition TEXT,
  total_horses INTEGER,
  prize_money TEXT,
  jra_race_id TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(race_date, venue_id, race_number)
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| race_date | DATE | 開催日 |
| venue_id | INTEGER | 競馬場ID |
| race_number | INTEGER | レース番号（1〜12） |
| race_name | TEXT | レース名 |
| race_class | TEXT | クラス（G1/G2/G3等） |
| race_type | TEXT | コース種別（芝/ダート/障害） |
| distance | INTEGER | 距離（m） |
| track_condition | TEXT | 馬場状態 |
| total_horses | INTEGER | 出走頭数 |
| prize_money | TEXT | 賞金 |

---

### race_entries（出馬表）

```sql
CREATE TABLE race_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL REFERENCES races(id),
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  jockey_id INTEGER NOT NULL REFERENCES jockeys(id),
  frame_number INTEGER,
  horse_number INTEGER NOT NULL,
  assigned_weight REAL,
  horse_weight INTEGER,
  weight_change INTEGER,
  win_odds REAL,
  place_odds_min REAL,
  place_odds_max REAL,
  popularity INTEGER,
  career_wins INTEGER,
  career_places INTEGER,
  career_shows INTEGER,
  career_runs INTEGER,
  total_prize_money TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(race_id, horse_id)
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| race_id | INTEGER | レースID |
| horse_id | INTEGER | 馬ID |
| jockey_id | INTEGER | 騎手ID |
| frame_number | INTEGER | 枠番（1〜8） |
| horse_number | INTEGER | 馬番（1〜18） |
| assigned_weight | REAL | 斤量 |
| horse_weight | INTEGER | 馬体重 |
| weight_change | INTEGER | 体重増減 |
| win_odds | REAL | 単勝オッズ |
| popularity | INTEGER | 人気順位 |
| career_wins | INTEGER | 通算勝利数 |
| career_runs | INTEGER | 通算出走数 |

---

### race_results（レース結果）

```sql
CREATE TABLE race_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL UNIQUE REFERENCES race_entries(id),
  finish_position INTEGER,
  finish_status TEXT
    CHECK(finish_status IN ('完走', '取消', '除外', '中止', '失格', '降着')),
  finish_time TEXT,
  finish_time_ms INTEGER,
  margin TEXT,
  margin_seconds REAL,
  last_3f_time REAL,
  last_3f_rank INTEGER,
  corner_positions TEXT,
  final_win_odds REAL,
  final_place_odds REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| entry_id | INTEGER | 出馬表ID |
| finish_position | INTEGER | 着順 |
| finish_status | TEXT | 結果ステータス |
| finish_time | TEXT | タイム（文字列） |
| finish_time_ms | INTEGER | タイム（ミリ秒） |
| margin | TEXT | 着差（文字列） |
| last_3f_time | REAL | 上がり3Fタイム |
| last_3f_rank | INTEGER | 上がり3F順位 |
| corner_positions | TEXT | コーナー通過順 |

---

## 分析用テーブル

### bloodline_stats（血統別成績統計）

```sql
CREATE TABLE bloodline_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sire_id INTEGER NOT NULL REFERENCES sires(id),
  race_type TEXT,
  distance_category TEXT,
  track_condition TEXT,
  runs INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  places INTEGER DEFAULT 0,
  shows INTEGER DEFAULT 0,
  win_rate REAL GENERATED ALWAYS AS (
    CASE WHEN runs > 0 THEN CAST(wins AS REAL) / runs ELSE 0 END
  ) STORED,
  place_rate REAL GENERATED ALWAYS AS (
    CASE WHEN runs > 0 THEN CAST(wins + places AS REAL) / runs ELSE 0 END
  ) STORED,
  show_rate REAL GENERATED ALWAYS AS (
    CASE WHEN runs > 0 THEN CAST(wins + places + shows AS REAL) / runs ELSE 0 END
  ) STORED,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sire_id, race_type, distance_category, track_condition)
);
```

| カラム | 型 | 説明 |
|--------|-----|------|
| sire_id | INTEGER | 種牡馬ID |
| race_type | TEXT | コース種別 |
| distance_category | TEXT | 距離カテゴリ（短/中/長） |
| track_condition | TEXT | 馬場状態 |
| runs | INTEGER | 出走数 |
| wins | INTEGER | 勝利数 |
| win_rate | REAL | 勝率（自動計算） |

---

### horse_course_stats（馬別コース適性）

```sql
CREATE TABLE horse_course_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  race_type TEXT,
  distance_category TEXT,
  runs INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  places INTEGER DEFAULT 0,
  shows INTEGER DEFAULT 0,
  avg_finish_position REAL,
  avg_last_3f_time REAL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(horse_id, venue_id, race_type, distance_category)
);
```

---

### horse_track_stats（馬別馬場適性）

```sql
CREATE TABLE horse_track_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  race_type TEXT,
  track_condition TEXT,
  runs INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  places INTEGER DEFAULT 0,
  shows INTEGER DEFAULT 0,
  avg_finish_position REAL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(horse_id, race_type, track_condition)
);
```

---

### jockey_trainer_stats（騎手・調教師コンビ成績）

```sql
CREATE TABLE jockey_trainer_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jockey_id INTEGER NOT NULL REFERENCES jockeys(id),
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  runs INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  places INTEGER DEFAULT 0,
  shows INTEGER DEFAULT 0,
  win_rate REAL GENERATED ALWAYS AS (
    CASE WHEN runs > 0 THEN CAST(wins AS REAL) / runs ELSE 0 END
  ) STORED,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(jockey_id, trainer_id)
);
```

---

### horse_scores（馬スコア）

10要素構成のスコアテーブル（専門家会議2026/01/03で合意）。
重み配分は `src/constants/ScoringConstants.ts` で一元管理。

```sql
CREATE TABLE horse_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  race_id INTEGER REFERENCES races(id),
  -- 馬の能力・実績（59%）
  recent_performance_score REAL DEFAULT 0,      -- 直近成績 22%
  course_aptitude_score REAL DEFAULT 0,         -- コース適性 15%
  distance_aptitude_score REAL DEFAULT 0,       -- 距離適性 12%
  last_3f_ability_score REAL DEFAULT 0,         -- 上がり3F能力 10%
  -- 実績・経験（5%）
  g1_achievement_score REAL DEFAULT 0,          -- G1実績 5%
  -- コンディション（15%）
  rotation_score REAL DEFAULT 0,                -- ローテ適性 10%
  track_condition_score REAL DEFAULT 0,         -- 馬場適性 5%
  -- 人的要因（16%）
  jockey_score REAL DEFAULT 0,                  -- 騎手能力 8%
  trainer_score REAL DEFAULT 0,                 -- 調教師 8%
  -- 枠順要因（5%）
  post_position_score REAL DEFAULT 0,           -- 枠順効果 5%
  -- 総合スコア（アプリケーション側で計算して保存）
  total_score REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(horse_id, race_id)
);
```

| スコア項目 | 重み |
|-----------|------|
| recent_performance_score | 22% |
| course_aptitude_score | 15% |
| distance_aptitude_score | 12% |
| last_3f_ability_score | 10% |
| g1_achievement_score | 5% |
| rotation_score | 10% |
| track_condition_score | 5% |
| jockey_score | 8% |
| trainer_score | 8% |
| post_position_score | 5% |

---

## ビュー

### v_horse_details（馬詳細ビュー）

馬の基本情報と血統情報を結合したビュー。

```sql
CREATE VIEW v_horse_details AS
SELECT
  h.id, h.name, h.birth_year, h.sex, h.coat_color,
  s.name AS sire_name,
  m.name AS mare_name,
  ms.name AS mare_sire_name,
  t.name AS trainer_name, t.stable,
  o.name AS owner_name,
  b.name AS breeder_name
FROM horses h
LEFT JOIN sires s ON h.sire_id = s.id
LEFT JOIN mares m ON h.mare_id = m.id
LEFT JOIN sires ms ON m.sire_id = ms.id
LEFT JOIN trainers t ON h.trainer_id = t.id
LEFT JOIN owners o ON h.owner_id = o.id
LEFT JOIN breeders b ON h.breeder_id = b.id;
```

---

### v_race_results_detail（レース結果詳細ビュー）

レース結果と関連情報を全て結合したビュー。

```sql
CREATE VIEW v_race_results_detail AS
SELECT
  rr.*, re.*, r.*, h.name AS horse_name,
  j.name AS jockey_name, v.name AS venue_name
FROM race_results rr
JOIN race_entries re ON rr.entry_id = re.id
JOIN races r ON re.race_id = r.id
JOIN horses h ON re.horse_id = h.id
LEFT JOIN jockeys j ON re.jockey_id = j.id
LEFT JOIN venues v ON r.venue_id = v.id;
```

---

## ER図

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ sires   │────<│ horses  │>────│ mares   │
└─────────┘     └────┬────┘     └────┬────┘
                     │               │
                     │          ┌────┴────┐
                     │          │ sires   │ (母の父)
                     │          └─────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
   │trainers │  │ owners  │  │breeders │
   └─────────┘  └─────────┘  └─────────┘

┌─────────┐     ┌─────────────┐     ┌─────────┐
│ races   │────<│race_entries │>────│ horses  │
└────┬────┘     └──────┬──────┘     └─────────┘
     │                 │
     │            ┌────┴────┐
┌────┴────┐      │jockeys  │
│ venues  │      └─────────┘
└─────────┘           │
                 ┌────┴────────┐
                 │race_results │
                 └─────────────┘
```

---

## インデックス

以下のインデックスが定義されています：

```sql
-- 馬名検索
CREATE INDEX idx_horses_name ON horses(name);

-- レース日付検索
CREATE INDEX idx_races_date ON races(race_date);

-- 日付×競馬場検索
CREATE INDEX idx_races_date_venue ON races(race_date, venue_id);

-- 出馬表の馬ID検索
CREATE INDEX idx_entries_horse ON race_entries(horse_id);

-- 出馬表のレースID検索
CREATE INDEX idx_entries_race ON race_entries(race_id);
```

---

## スキーマファイル

完全なスキーマ定義は以下のファイルにあります：

```
src/database/schema.sql
```
