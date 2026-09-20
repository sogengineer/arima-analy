/**
 * JRA公式サイト（JRADB）のページから抽出するデータの型
 */

export type RaceType = '芝' | 'ダート' | '障害';
export type TrackCondition = '良' | '稍重' | '重' | '不良';

/** レース条件（出馬表・レース結果の共通ヘッダ） */
export interface JRARaceHeader {
  /** YYYY-MM-DD */
  date: string;
  /** 競馬場名（中山・東京 等） */
  venue: string;
  raceNumber: number;
  raceName: string;
  /** G1 / G2 / G3 / J.G1 ... （重賞のみ） */
  grade?: string;
  /** オープン / 3勝クラス / 未勝利 など */
  raceClass?: string;
  /** 3歳以上 など */
  ageCondition?: string;
  /** 牝馬限定など（（牝）表記がある場合） */
  sexCondition?: string;
  /** 定量 / 別定 / ハンデ / 馬齢 */
  weightCondition?: string;
  distance: number;
  courseType: RaceType;
  /** （芝・右 外）の中身 */
  courseDetail?: string;
  trackCondition?: TrackCondition;
  weather?: string;
  /** 15時45分 */
  startTime?: string;
  /** 4回中山5日 */
  kaisaiLabel?: string;
}
