/**
 * スコア構成要素（値オブジェクト）
 *
 * @remarks
 * 専門家会議（2026/01/03）の議論を経て、7要素→10要素に拡張。
 * - 馬場適性（5%）: 道悪対応
 * - 枠順効果（5%）: 中山2500m内枠有利
 * - 調教師（8%）: 厩舎力の反映
 */

import { SCORE_WEIGHTS } from '../../constants/ScoringConstants';

/** 10要素のスコア構成 */
export interface ScoreComponentsData {
  recentPerformanceScore: number;      // 直近成績（22%）
  venueAptitudeScore: number;          // コース適性（15%）
  distanceAptitudeScore: number;       // 距離適性（12%）
  last3FAbilityScore: number;          // 上がり3F能力（10%）
  g1AchievementScore: number;          // G1実績（5%）
  rotationAptitudeScore: number;       // ローテ適性（10%）
  jockeyScore: number;                 // 騎手能力（8%）
  trackConditionScore: number;         // 馬場適性（5%）- 新規
  postPositionScore: number;           // 枠順効果（5%）- 新規
  trainerScore: number;                // 調教師（8%）- 新規
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

  get trackConditionScore(): number {
    return this.data.trackConditionScore;
  }

  get postPositionScore(): number {
    return this.data.postPositionScore;
  }

  get trainerScore(): number {
    return this.data.trainerScore;
  }

  /**
   * 重み付け総合スコアを計算（10要素）
   *
   * @returns 総合スコア（0-100）
   */
  calculateTotalScore(): number {
    return (
      this.data.recentPerformanceScore * SCORE_WEIGHTS.recentPerformance +
      this.data.venueAptitudeScore * SCORE_WEIGHTS.venueAptitude +
      this.data.distanceAptitudeScore * SCORE_WEIGHTS.distanceAptitude +
      this.data.last3FAbilityScore * SCORE_WEIGHTS.last3FAbility +
      this.data.g1AchievementScore * SCORE_WEIGHTS.g1Achievement +
      this.data.rotationAptitudeScore * SCORE_WEIGHTS.rotationAptitude +
      this.data.jockeyScore * SCORE_WEIGHTS.jockey +
      this.data.trackConditionScore * SCORE_WEIGHTS.trackCondition +
      this.data.postPositionScore * SCORE_WEIGHTS.postPosition +
      this.data.trainerScore * SCORE_WEIGHTS.trainer
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
