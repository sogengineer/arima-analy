/**
 * レースエンティティ
 */

import type { RaceWithVenue } from '../../types/RepositoryTypes';
import { getDistanceCategory } from '../../constants/DistanceConstants';

export interface RaceData {
  id: number;
  name: string;
  venue: string;
  distance: number;
  raceType: string;
  date: string;
  raceClass?: string;
  trackCondition?: string;
  totalHorses?: number;
}

export class Race {
  constructor(private readonly data: RaceData) {}

  get id(): number {
    return this.data.id;
  }

  get name(): string {
    return this.data.name;
  }

  get venue(): string {
    return this.data.venue;
  }

  get distance(): number {
    return this.data.distance;
  }

  get raceType(): string {
    return this.data.raceType;
  }

  get date(): string {
    return this.data.date;
  }

  get raceClass(): string | undefined {
    return this.data.raceClass;
  }

  get trackCondition(): string | undefined {
    return this.data.trackCondition;
  }

  get totalHorses(): number | undefined {
    return this.data.totalHorses;
  }

  /**
   * G1レースか
   */
  isG1(): boolean {
    return (
      this.data.raceClass?.includes('G1') === true ||
      this.data.raceClass?.includes('GI') === true
    );
  }

  /**
   * 芝レースか
   */
  isTurf(): boolean {
    return this.data.raceType === '芝';
  }

  /**
   * ダートレースか
   */
  isDirt(): boolean {
    return this.data.raceType === 'ダート';
  }

  /**
   * 距離カテゴリを取得
   */
  getDistanceCategory(): string {
    return getDistanceCategory(this.data.distance);
  }

  /**
   * DBレコードから Race を生成
   */
  static fromDbRecord(record: RaceWithVenue): Race {
    return new Race({
      id: record.id,
      name: record.race_name,
      venue: record.venue_name,
      distance: record.distance,
      raceType: record.race_type ?? '芝',
      date: record.race_date,
      raceClass: record.race_class,
      trackCondition: record.track_condition,
      totalHorses: record.total_horses
    });
  }

  /**
   * プレーンオブジェクトに変換
   */
  toPlainObject(): RaceData {
    return { ...this.data };
  }
}
