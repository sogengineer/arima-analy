/**
 * レース結果エンティティ
 */

import type { HorseRaceResult } from '../../types/RepositoryTypes';

export class RaceResult {
  constructor(private readonly data: HorseRaceResult) {}

  get raceId(): number {
    return this.data.race_id;
  }

  get raceName(): string {
    return this.data.race_name;
  }

  get raceDate(): string {
    return this.data.race_date;
  }

  get raceClass(): string | undefined {
    return this.data.race_class;
  }

  get distance(): number {
    return this.data.distance;
  }

  get raceType(): string | undefined {
    return this.data.race_type;
  }

  get trackCondition(): string | undefined {
    return this.data.track_condition;
  }

  get venueName(): string {
    return this.data.venue_name;
  }

  get jockeyId(): number | undefined {
    return this.data.jockey_id;
  }

  get popularity(): number | undefined {
    return this.data.popularity;
  }

  get finishPosition(): number | undefined {
    return this.data.finish_position;
  }

  get finishTime(): string | undefined {
    return this.data.finish_time;
  }

  get last3FTime(): number | undefined {
    return this.data.last_3f_time;
  }

  get timeDiffSeconds(): number | undefined {
    return this.data.time_diff_seconds;
  }

  /**
   * 勝利か
   */
  isWin(): boolean {
    return this.data.finish_position === 1;
  }

  /**
   * 連対（2着以内）か
   */
  isPlace(): boolean {
    return this.data.finish_position !== undefined && this.data.finish_position <= 2;
  }

  /**
   * 複勝圏内（3着以内）か
   */
  isShow(): boolean {
    return this.data.finish_position !== undefined && this.data.finish_position <= 3;
  }

  /**
   * G1レースか
   */
  isG1(): boolean {
    return (
      this.data.race_class?.includes('G1') === true ||
      this.data.race_class?.includes('GI') === true ||
      this.data.race_name?.includes('有馬記念') === true ||
      this.data.race_name?.includes('ダービー') === true ||
      this.data.race_name?.includes('天皇賞') === true ||
      this.data.race_name?.includes('ジャパンカップ') === true ||
      this.data.race_name?.includes('宝塚記念') === true ||
      this.data.race_name?.includes('菊花賞') === true ||
      this.data.race_name?.includes('皐月賞') === true ||
      this.data.race_name?.includes('オークス') === true
    );
  }

  /**
   * 指定距離との差を計算
   */
  getDistanceDiff(targetDistance: number): number {
    return Math.abs(this.data.distance - targetDistance);
  }

  /**
   * 人気との着順差を計算（プラス = 人気以上の好走）
   */
  getPopularityDiff(): number {
    if (!this.data.popularity || !this.data.finish_position) return 0;
    return this.data.popularity - this.data.finish_position;
  }

  /**
   * プレーンオブジェクトを取得
   */
  toPlainObject(): HorseRaceResult {
    return { ...this.data };
  }
}
