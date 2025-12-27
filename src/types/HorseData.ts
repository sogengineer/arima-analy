export interface HorseBasicInfo {
  name: string;
  age: number;
  sex: '牡' | '牝' | '騸';
  color: string;
  ownerName: string;
  breederName: string;
  trainerName: string;
  trainerDivision?: '美浦' | '栗東';
}

export interface BloodlineInfo {
  sire: string;
  mare: string;
  maresSire?: string;
}

export interface JockeyInfo {
  name: string;
  weight: number; // kg
}

export interface RaceInfo {
  frameNumber: number;  // 枠番
  horseNumber: number;  // 馬番
  assignedWeight: number; // 負担重量 (kg)
  winOdds: number;      // 単勝オッズ
  popularity: number;   // 人気順位
}

export interface RaceRecord {
  wins: number;    // 勝利数
  places: number;  // 2着回数
  shows: number;   // 3着回数
  runs: number;    // 出走回数
  prizeMoney?: string; // 総賞金
}

export interface PreviousRaceResult {
  position: 'front' | 'second' | 'third' | 'fourth'; // 前走、前々走、3走前、4走前
  date: string;
  track: string;         // 競馬場
  raceName: string;
  raceClass?: string;    // クラス
  place: string;         // 着順
  totalHorses: number;   // 出走頭数
  gateNumber: number;    // 枠番
  popularity: number;    // 人気
  jockey: string;
  weight: number;
  distance: string;      // 距離・馬場
  time?: string;         // タイム
  trackCondition: string; // 馬場状態
  horseWeight?: number;   // 馬体重
  corners?: string[];     // コーナー通過順
  lastFurlong?: string;   // ラスト3F
  margin?: string;        // 着差
  winner?: string;        // 勝ち馬
}

export interface HorseData {
  basicInfo: HorseBasicInfo;
  bloodline: BloodlineInfo;
  jockey: JockeyInfo;
  raceInfo: RaceInfo;
  record: RaceRecord;
  previousRaces: PreviousRaceResult[];
}

export interface RaceOverview {
  date: string;
  venue: string;
  raceNumber: number;
  raceName: string;
  distance: number;
  trackCondition: string;
  courseType: '芝' | 'ダート' | '障害';
  startTime?: string;
  prizeMoney?: string;
  raceClass?: string;
}

export interface ExtractedRaceData {
  url: string;
  extractedAt: string;
  raceInfo: RaceOverview;
  horseCount: number;
  horses: HorseData[];
}

export interface ExtractionOptions {
  includeBloodline?: boolean;
  includePreviousRaces?: boolean;
  maxPreviousRaces?: number;
  sortBy?: 'popularity' | 'horseNumber' | 'odds';
  outputFormat?: 'detailed' | 'summary' | 'csv';
}

export interface ExtractionResult {
  success: boolean;
  data?: ExtractedRaceData;
  error?: string;
  warnings?: string[];
}

// ============================================
// DB用型定義
// ============================================

// マスタテーブル型
export interface DBVenue {
  id: number;
  name: string;
  region?: string;
}

export interface DBSire {
  id: number;
  name: string;
  country?: string;
}

export interface DBMare {
  id: number;
  name: string;
  sire_id?: number;
}

export interface DBTrainer {
  id: number;
  name: string;
  stable?: '美浦' | '栗東';
}

export interface DBOwner {
  id: number;
  name: string;
}

export interface DBBreeder {
  id: number;
  name: string;
}

export interface DBJockey {
  id: number;
  name: string;
  default_weight?: number;
  apprentice_status?: string;
}

// コアテーブル型
export interface DBHorse {
  id: number;
  name: string;
  birth_year?: number;
  sex?: '牡' | '牝' | '騸';
  coat_color?: string;
  sire_id?: number;
  mare_id?: number;
  trainer_id?: number;
  owner_id?: number;
  breeder_id?: number;
  jra_horse_id?: string;
}

export interface DBRace {
  id: number;
  race_date: string;
  venue_id: number;
  race_number?: number;
  race_name: string;
  race_class?: string;
  race_type?: '芝' | 'ダート' | '障害';
  distance: number;
  track_condition?: '良' | '稍重' | '重' | '不良';
  age_condition?: string;
  sex_condition?: string;
  weight_condition?: string;
  total_horses?: number;
  prize_money?: string;
  jra_race_id?: string;
}

export interface DBRaceEntry {
  id: number;
  race_id: number;
  horse_id: number;
  jockey_id: number;
  frame_number?: number;
  horse_number: number;
  assigned_weight?: number;
  win_odds?: number;
  place_odds_min?: number;
  place_odds_max?: number;
  popularity?: number;
  horse_weight?: number;
  weight_change?: number;
  career_wins?: number;
  career_places?: number;
  career_shows?: number;
  career_runs?: number;
  total_prize_money?: string;
}

export interface DBRaceResult {
  id: number;
  entry_id: number;
  finish_position?: number;
  finish_status?: '完走' | '取消' | '除外' | '中止' | '失格' | '降着';
  finish_time?: string;
  finish_time_ms?: number;
  margin?: string;
  margin_seconds?: number;
  last_3f_time?: number;
  last_3f_rank?: number;
  corner_positions?: string;
  final_win_odds?: number;
  final_place_odds?: number;
}

// ビュー型
export interface HorseDetail {
  id: number;
  name: string;
  birth_year?: number;
  sex?: string;
  sire_name?: string;
  mare_name?: string;
  mares_sire_name?: string;
  trainer_name?: string;
  stable?: string;
  owner_name?: string;
  breeder_name?: string;
}

export interface RaceResultDetail {
  race_date: string;
  venue: string;
  race_number?: number;
  race_name: string;
  race_class?: string;
  race_type?: string;
  distance: number;
  track_condition?: string;
  frame_number?: number;
  horse_number: number;
  horse_name: string;
  jockey_name: string;
  assigned_weight?: number;
  horse_weight?: number;
  popularity?: number;
  finish_position?: number;
  finish_time?: string;
  last_3f_time?: number;
  corner_positions?: string;
  margin?: string;
  win_odds?: number;
}

// インポート用データ型
export interface HorseImportData {
  name: string;
  birthYear?: number;
  sex?: '牡' | '牝' | '騸';
  sire?: string;
  mare?: string;
  maresSire?: string;
  trainer?: string;
  trainerStable?: '美浦' | '栗東';
  owner?: string;
  breeder?: string;
}

export interface RaceImportData {
  raceDate: string;
  venue: string;
  raceNumber?: number;
  raceName: string;
  raceClass?: string;
  raceType?: '芝' | 'ダート' | '障害';
  distance: number;
  trackCondition?: '良' | '稍重' | '重' | '不良';
  totalHorses?: number;
}

export interface EntryImportData {
  horseName: string;
  jockeyName: string;
  frameNumber?: number;
  horseNumber: number;
  assignedWeight?: number;
  winOdds?: number;
  popularity?: number;
  horseWeight?: number;
  careerWins?: number;
  careerPlaces?: number;
  careerShows?: number;
  careerRuns?: number;
  totalPrizeMoney?: string;
}

export interface ResultImportData {
  finishPosition?: number;
  finishStatus?: '完走' | '取消' | '除外' | '中止' | '失格' | '降着';
  finishTime?: string;
  margin?: string;
  last3fTime?: number;
  cornerPositions?: string;
}