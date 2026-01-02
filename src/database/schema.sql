-- ============================================
-- 競馬データ分析システム スキーマ
-- ============================================

-- ============================================
-- マスタテーブル群
-- ============================================

-- 競馬場マスタ
CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    region TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 種牡馬マスタ（父馬）
CREATE TABLE IF NOT EXISTS sires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    country TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 繁殖牝馬マスタ（母馬）
CREATE TABLE IF NOT EXISTS mares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sire_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sire_id) REFERENCES sires(id)
);

-- 調教師マスタ
CREATE TABLE IF NOT EXISTS trainers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    stable TEXT CHECK(stable IN ('美浦', '栗東')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 馬主マスタ
CREATE TABLE IF NOT EXISTS owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 生産者マスタ
CREATE TABLE IF NOT EXISTS breeders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 騎手マスタ
CREATE TABLE IF NOT EXISTS jockeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    default_weight REAL,
    apprentice_status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- コアテーブル群
-- ============================================

-- 競走馬テーブル（血統情報含む）
CREATE TABLE IF NOT EXISTS horses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    birth_year INTEGER,
    sex TEXT CHECK(sex IN ('牡', '牝', '騸')),
    coat_color TEXT,
    sire_id INTEGER,
    mare_id INTEGER,
    trainer_id INTEGER,
    owner_id INTEGER,
    breeder_id INTEGER,
    jra_horse_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sire_id) REFERENCES sires(id),
    FOREIGN KEY (mare_id) REFERENCES mares(id),
    FOREIGN KEY (trainer_id) REFERENCES trainers(id),
    FOREIGN KEY (owner_id) REFERENCES owners(id),
    FOREIGN KEY (breeder_id) REFERENCES breeders(id),
    UNIQUE(name, sire_id, mare_id)
);

-- レースマスタ
CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_date DATE NOT NULL,
    venue_id INTEGER NOT NULL,
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
    FOREIGN KEY (venue_id) REFERENCES venues(id),
    UNIQUE(race_date, venue_id, race_number)
);

-- 出馬表（レースエントリー）
-- 一意制約: レースID + 馬ID（同じ馬は同じレースに1回のみ出走）
CREATE TABLE IF NOT EXISTS race_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id INTEGER NOT NULL,
    horse_id INTEGER NOT NULL,
    jockey_id INTEGER NOT NULL,
    frame_number INTEGER,
    horse_number INTEGER NOT NULL,
    assigned_weight REAL,
    win_odds REAL,
    place_odds_min REAL,
    place_odds_max REAL,
    popularity INTEGER,
    horse_weight INTEGER,
    weight_change INTEGER,
    career_wins INTEGER,
    career_places INTEGER,
    career_shows INTEGER,
    career_runs INTEGER,
    total_prize_money TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (race_id) REFERENCES races(id),
    FOREIGN KEY (horse_id) REFERENCES horses(id),
    FOREIGN KEY (jockey_id) REFERENCES jockeys(id),
    UNIQUE(race_id, horse_id)
);

-- レース結果
CREATE TABLE IF NOT EXISTS race_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL UNIQUE,
    finish_position INTEGER,
    finish_status TEXT CHECK(finish_status IN ('完走', '取消', '除外', '中止', '失格', '降着')),
    finish_time TEXT,
    finish_time_ms INTEGER,
    margin TEXT,
    margin_seconds REAL,
    last_3f_time REAL,
    last_3f_rank INTEGER,
    corner_positions TEXT,
    final_win_odds REAL,
    final_place_odds REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES race_entries(id)
);

-- ============================================
-- 集計・分析用テーブル
-- ============================================

-- 血統傾向集計
CREATE TABLE IF NOT EXISTS bloodline_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sire_id INTEGER NOT NULL,
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
    FOREIGN KEY (sire_id) REFERENCES sires(id),
    UNIQUE(sire_id, race_type, distance_category, track_condition)
);

-- 馬別コース適性集計
CREATE TABLE IF NOT EXISTS horse_course_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    horse_id INTEGER NOT NULL,
    venue_id INTEGER NOT NULL,
    race_type TEXT,
    distance_category TEXT,
    runs INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    places INTEGER DEFAULT 0,
    shows INTEGER DEFAULT 0,
    avg_finish_position REAL,
    avg_last_3f_time REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (horse_id) REFERENCES horses(id),
    FOREIGN KEY (venue_id) REFERENCES venues(id),
    UNIQUE(horse_id, venue_id, race_type, distance_category)
);

-- 馬別馬場適性集計
CREATE TABLE IF NOT EXISTS horse_track_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    horse_id INTEGER NOT NULL,
    race_type TEXT,
    track_condition TEXT,
    runs INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    places INTEGER DEFAULT 0,
    shows INTEGER DEFAULT 0,
    avg_finish_position REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (horse_id) REFERENCES horses(id),
    UNIQUE(horse_id, race_type, track_condition)
);

-- 騎手・調教師コンビ成績
CREATE TABLE IF NOT EXISTS jockey_trainer_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jockey_id INTEGER NOT NULL,
    trainer_id INTEGER NOT NULL,
    runs INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    places INTEGER DEFAULT 0,
    shows INTEGER DEFAULT 0,
    win_rate REAL GENERATED ALWAYS AS (
        CASE WHEN runs > 0 THEN CAST(wins AS REAL) / runs ELSE 0 END
    ) STORED,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (jockey_id) REFERENCES jockeys(id),
    FOREIGN KEY (trainer_id) REFERENCES trainers(id),
    UNIQUE(jockey_id, trainer_id)
);

-- 馬スコア
CREATE TABLE IF NOT EXISTS horse_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    horse_id INTEGER NOT NULL,
    race_id INTEGER,
    recent_performance_score REAL DEFAULT 0,
    course_aptitude_score REAL DEFAULT 0,
    distance_aptitude_score REAL DEFAULT 0,
    track_condition_score REAL DEFAULT 0,
    last_3f_ability_score REAL DEFAULT 0,
    bloodline_score REAL DEFAULT 0,
    jockey_score REAL DEFAULT 0,
    rotation_score REAL DEFAULT 0,
    total_score REAL GENERATED ALWAYS AS (
        (recent_performance_score * 0.20) +
        (course_aptitude_score * 0.15) +
        (distance_aptitude_score * 0.15) +
        (track_condition_score * 0.10) +
        (last_3f_ability_score * 0.15) +
        (bloodline_score * 0.10) +
        (jockey_score * 0.10) +
        (rotation_score * 0.05)
    ) STORED,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (horse_id) REFERENCES horses(id),
    FOREIGN KEY (race_id) REFERENCES races(id),
    UNIQUE(horse_id, race_id)
);

-- ============================================
-- インデックス
-- ============================================

-- 馬検索
CREATE INDEX IF NOT EXISTS idx_horses_sire ON horses(sire_id);
CREATE INDEX IF NOT EXISTS idx_horses_trainer ON horses(trainer_id);
CREATE INDEX IF NOT EXISTS idx_horses_name ON horses(name);

-- レース検索
CREATE INDEX IF NOT EXISTS idx_races_date ON races(race_date);
CREATE INDEX IF NOT EXISTS idx_races_venue ON races(venue_id);
CREATE INDEX IF NOT EXISTS idx_races_class ON races(race_class);
CREATE INDEX IF NOT EXISTS idx_races_date_venue ON races(race_date, venue_id);

-- エントリー検索
CREATE INDEX IF NOT EXISTS idx_entries_race ON race_entries(race_id);
CREATE INDEX IF NOT EXISTS idx_entries_horse ON race_entries(horse_id);
CREATE INDEX IF NOT EXISTS idx_entries_jockey ON race_entries(jockey_id);

-- 結果検索
CREATE INDEX IF NOT EXISTS idx_results_entry ON race_results(entry_id);
CREATE INDEX IF NOT EXISTS idx_results_position ON race_results(finish_position);
CREATE INDEX IF NOT EXISTS idx_results_last3f ON race_results(last_3f_time);

-- 血統分析用
CREATE INDEX IF NOT EXISTS idx_bloodline_stats_sire ON bloodline_stats(sire_id);
CREATE INDEX IF NOT EXISTS idx_bloodline_stats_conditions ON bloodline_stats(race_type, distance_category);

-- 馬スコア
CREATE INDEX IF NOT EXISTS idx_scores_horse ON horse_scores(horse_id);
CREATE INDEX IF NOT EXISTS idx_scores_race ON horse_scores(race_id);
CREATE INDEX IF NOT EXISTS idx_scores_total ON horse_scores(total_score DESC);

-- ============================================
-- ビュー
-- ============================================

-- 馬詳細ビュー（血統込み）
CREATE VIEW IF NOT EXISTS v_horse_details AS
SELECT
    h.id,
    h.name,
    h.birth_year,
    h.sex,
    s.name AS sire_name,
    m.name AS mare_name,
    ms.name AS mares_sire_name,
    t.name AS trainer_name,
    t.stable,
    o.name AS owner_name,
    b.name AS breeder_name
FROM horses h
LEFT JOIN sires s ON h.sire_id = s.id
LEFT JOIN mares m ON h.mare_id = m.id
LEFT JOIN sires ms ON m.sire_id = ms.id
LEFT JOIN trainers t ON h.trainer_id = t.id
LEFT JOIN owners o ON h.owner_id = o.id
LEFT JOIN breeders b ON h.breeder_id = b.id;

-- レース結果詳細ビュー
CREATE VIEW IF NOT EXISTS v_race_results_detail AS
SELECT
    r.race_date,
    v.name AS venue,
    r.race_number,
    r.race_name,
    r.race_class,
    r.race_type,
    r.distance,
    r.track_condition,
    e.frame_number,
    e.horse_number,
    h.name AS horse_name,
    j.name AS jockey_name,
    e.assigned_weight,
    e.horse_weight,
    e.popularity,
    rr.finish_position,
    rr.finish_time,
    rr.last_3f_time,
    rr.corner_positions,
    rr.margin,
    e.win_odds
FROM race_results rr
JOIN race_entries e ON rr.entry_id = e.id
JOIN races r ON e.race_id = r.id
JOIN venues v ON r.venue_id = v.id
JOIN horses h ON e.horse_id = h.id
JOIN jockeys j ON e.jockey_id = j.id;

-- 初期データ: 競馬場マスタ
INSERT OR IGNORE INTO venues (name, region) VALUES
('中山', '関東'),
('東京', '関東'),
('阪神', '関西'),
('京都', '関西'),
('中京', '中部'),
('小倉', '九州'),
('新潟', '北信越'),
('福島', '東北'),
('札幌', '北海道'),
('函館', '北海道');
