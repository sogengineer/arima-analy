export interface HorseBasicInfo {
  name: string;
  /** 血統登録番号（JRA公式の10桁）。取得できた場合のみ */
  jraHorseId?: string;
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
  /** 単勝オッズ。取得できなければ undefined（0 は入れない） */
  winOdds?: number;
  /** 人気順位（1が1番人気）。取得できなければ undefined（0 は入れない） */
  popularity?: number;
  horseWeight?: number;   // 馬体重 (kg)
  weightChange?: number;  // 前走からの増減 (kg)
}

/**
 * 通算成績
 *
 * @remarks
 * JRAの成績表記 `(1着.2着.3着.着外)` に対応する。
 * `runs` は表記の4項目の **合計（出走数）** であり、着外回数ではない。
 * DB の `race_entries.career_*` と同じ意味に揃えてある。
 */
export interface RaceRecord {
  wins: number;    // 1着回数
  places: number;  // 2着回数
  shows: number;   // 3着回数
  runs: number;    // 出走回数（1着+2着+3着+着外）
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
// DB由来の形を受け取る構造型
// ============================================

/**
 * `v_horse_details` ビューの行を受け取る構造
 *
 * @remarks
 * domain の entities は repositories / database / kysely に依存できないため、
 * ビューの行型（`Selectable<HorseDetailsView>`）を import せずに構造で受ける。
 * 省略可（`?: T`）と NULL 可（`T | null`）のどちらの表現の行でも受け取れるようにしている。
 * ビューそのものの正は `src/database/schema/Views.ts`。
 */
export interface HorseDetail {
  id: number;
  name: string;
  birth_year?: number | null;
  sex?: string | null;
  sire_name?: string | null;
  mare_name?: string | null;
  mares_sire_name?: string | null;
  trainer_name?: string | null;
  stable?: string | null;
  owner_name?: string | null;
  breeder_name?: string | null;
}

// インポート用データ型
export interface HorseImportData {
  name: string;
  /** 血統登録番号（JRA公式の10桁）。同名馬を区別する唯一のキー */
  jraHorseId?: string;
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
  /** G1 / G2 / G3 / J.G1（重賞のみ） */
  grade?: string;
  /** 「芝・右 外」等のコース詳細 */
  courseDetail?: string;
  /** 3歳以上 など */
  ageCondition?: string;
  sexCondition?: string;
  /** 定量 / 別定 / ハンデ / 馬齢 */
  weightCondition?: string;
  weather?: string;
  startTime?: string;
  /** 「4回中山5日」 */
  kaisaiLabel?: string;
  /** ハロンタイム */
  lapTimes?: string;
}

export interface EntryImportData {
  horseName: string;
  jraHorseId?: string;  // 血統登録番号（最優先の馬特定キー）
  sireName?: string;    // 父名（馬の一意特定用）
  mareName?: string;    // 母名（馬の一意特定用）
  jockeyName: string;
  frameNumber?: number;
  horseNumber: number;
  assignedWeight?: number;
  winOdds?: number;
  popularity?: number;
  horseWeight?: number;
  weightChange?: number;
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
  finishTimeMs?: number;
  margin?: string;
  marginSeconds?: number;
  last3fTime?: number;
  last3fRank?: number;
  cornerPositions?: string;
  /** 確定単勝オッズ（単勝払戻金/100） */
  finalWinOdds?: number;
  /** 確定複勝オッズ（複勝払戻金/100） */
  finalPlaceOdds?: number;
  /** JRA公式レーティング */
  rating?: number;
}