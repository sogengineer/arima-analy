/**
 * Horse エンティティのビルダー
 *
 * @remarks
 * `Horse.ts` から切り出したファイル。公開経路は `Horse.builder()`。
 */

import type { HorseDetail, CourseStats, TrackStats } from '../../types/RepositoryTypes';
import type { RaceResult } from './RaceResult';
import { Horse } from './Horse';

/**
 * Horse エンティティのビルダー
 *
 * @remarks
 * Fluent API パターンで Horse エンティティを構築する。
 *
 * @example
 * ```typescript
 * const horse = Horse.builder(1, 'イクイノックス')
 *   .withDetail(detail)
 *   .withRaceResults(results)
 *   .build();
 * ```
 */
export class HorseBuilder {
  private detail?: HorseDetail;
  private raceResults: RaceResult[] = [];
  private courseStats: CourseStats[] = [];
  private trackStats: TrackStats[] = [];

  constructor(
    private readonly id: number,
    private readonly name: string
  ) {}

  /**
   * 馬詳細情報を設定
   *
   * @param detail - 馬詳細情報
   * @returns this
   */
  withDetail(detail: HorseDetail): HorseBuilder {
    this.detail = detail;
    return this;
  }

  /**
   * レース結果履歴を設定
   *
   * @param results - レース結果の配列
   * @returns this
   */
  withRaceResults(results: RaceResult[]): HorseBuilder {
    this.raceResults = results;
    return this;
  }

  /**
   * コース別成績を設定
   *
   * @param stats - コース別成績の配列
   * @returns this
   */
  withCourseStats(stats: CourseStats[]): HorseBuilder {
    this.courseStats = stats;
    return this;
  }

  /**
   * 馬場別成績を設定
   *
   * @param stats - 馬場別成績の配列
   * @returns this
   */
  withTrackStats(stats: TrackStats[]): HorseBuilder {
    this.trackStats = stats;
    return this;
  }

  /**
   * Horse エンティティを構築
   *
   * @returns Horse インスタンス
   */
  build(): Horse {
    return new Horse({
      id: this.id,
      name: this.name,
      detail: this.detail,
      raceResults: this.raceResults,
      courseStats: this.courseStats,
      trackStats: this.trackStats
    });
  }
}
