/**
 * Jockey エンティティのビルダー
 *
 * @remarks
 * `Jockey.ts` から切り出したファイル。公開経路は `Jockey.builder()`。
 */

import type {
  JockeyVenueStats,
  JockeyOverallStats,
  JockeyTrainerComboStats
} from '@/types/RepositoryTypes';
import { Jockey } from './Jockey';

/**
 * Jockey エンティティのビルダー
 *
 * @remarks
 * Fluent API パターンで Jockey エンティティを構築する。
 *
 * @example
 * ```typescript
 * const jockey = Jockey.builder(1, 'C.ルメール')
 *   .withVenueStats('中山', venueStats)
 *   .withOverallStats(overallStats)
 *   .withTrainerComboStats(trainerId, comboStats)
 *   .build();
 * ```
 */
export class JockeyBuilder {
  private venueStats = new Map<string, JockeyVenueStats>();
  private overallStats: JockeyOverallStats | null = null;
  private trainerCombos = new Map<number, JockeyTrainerComboStats>();

  constructor(
    private readonly id: number,
    private readonly name: string
  ) {}

  /**
   * 会場別成績を追加
   *
   * @param venue - 会場名
   * @param stats - 会場成績
   * @returns this
   */
  withVenueStats(venue: string, stats: JockeyVenueStats): JockeyBuilder {
    this.venueStats.set(venue, stats);
    return this;
  }

  /**
   * 全体成績を設定
   *
   * @param stats - 全体成績
   * @returns this
   */
  withOverallStats(stats: JockeyOverallStats): JockeyBuilder {
    this.overallStats = stats;
    return this;
  }

  /**
   * 調教師コンビ成績を追加
   *
   * @param trainerId - 調教師ID
   * @param stats - 調教師コンビ成績
   * @returns this
   */
  withTrainerComboStats(trainerId: number, stats: JockeyTrainerComboStats): JockeyBuilder {
    this.trainerCombos.set(trainerId, stats);
    return this;
  }

  /**
   * Jockey エンティティを構築
   *
   * @returns Jockey インスタンス
   */
  build(): Jockey {
    return new Jockey({
      id: this.id,
      name: this.name,
      venueStats: this.venueStats,
      overallStats: this.overallStats,
      trainerCombos: this.trainerCombos
    });
  }
}
