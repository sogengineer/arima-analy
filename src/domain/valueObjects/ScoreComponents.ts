/**
 * スコア構成要素（値オブジェクト）
 */

import { SCORE_WEIGHTS } from '../../constants/ScoringConstants';

/** 7要素のスコア構成 */
export interface ScoreComponentsData {
  recentPerformanceScore: number;
  venueAptitudeScore: number;
  distanceAptitudeScore: number;
  last3FAbilityScore: number;
  g1AchievementScore: number;
  rotationAptitudeScore: number;
  jockeyScore: number;
}

/** スコア構成要素（値オブジェクト） */
export class ScoreComponents {
  constructor(private readonly data: ScoreComponentsData) {}

  get recentPerformanceScore(): number {
    return this.data.recentPerformanceScore;
  }

  get venueAptitudeScore(): number {
    return this.data.venueAptitudeScore;
  }

  get distanceAptitudeScore(): number {
    return this.data.distanceAptitudeScore;
  }

  get last3FAbilityScore(): number {
    return this.data.last3FAbilityScore;
  }

  get g1AchievementScore(): number {
    return this.data.g1AchievementScore;
  }

  get rotationAptitudeScore(): number {
    return this.data.rotationAptitudeScore;
  }

  get jockeyScore(): number {
    return this.data.jockeyScore;
  }

  /**
   * 重み付け総合スコアを計算
   */
  calculateTotalScore(): number {
    return (
      this.data.recentPerformanceScore * SCORE_WEIGHTS.recentPerformance +
      this.data.venueAptitudeScore * SCORE_WEIGHTS.venueAptitude +
      this.data.distanceAptitudeScore * SCORE_WEIGHTS.distanceAptitude +
      this.data.last3FAbilityScore * SCORE_WEIGHTS.last3FAbility +
      this.data.g1AchievementScore * SCORE_WEIGHTS.g1Achievement +
      this.data.rotationAptitudeScore * SCORE_WEIGHTS.rotationAptitude +
      this.data.jockeyScore * SCORE_WEIGHTS.jockey
    );
  }

  /**
   * プレーンオブジェクトに変換
   */
  toPlainObject(): ScoreComponentsData & { totalScore: number } {
    return {
      ...this.data,
      totalScore: this.calculateTotalScore()
    };
  }
}
