/**
 * 騎手エンティティ（リッチドメインモデル）
 * 騎手能力スコア計算ロジックを内包
 */

import type {
  JockeyVenueStats,
  JockeyOverallStats,
  JockeyTrainerComboStats
} from '../../types/RepositoryTypes';
import {
  JOCKEY_SCORE_WEIGHTS,
  RELIABILITY_THRESHOLDS,
  getJockeyReliabilityFactor,
  getJockeyG1ReliabilityFactor
} from '../../constants/ScoringConstants';

export interface JockeyData {
  id: number;
  name: string;
  venueStats: Map<string, JockeyVenueStats>;
  overallStats: JockeyOverallStats | null;
  trainerCombos: Map<number, JockeyTrainerComboStats>;
}

export class Jockey {
  constructor(private readonly data: JockeyData) {}

  get id(): number {
    return this.data.id;
  }

  get name(): string {
    return this.data.name;
  }

  /**
   * 騎手能力スコアを計算
   * 構成: コース勝率(30%) + コースG1勝率(30%) + 全体勝率(20%) + 調教師コンビ勝率(20%)
   */
  calculateScore(venue: string, trainerId?: number): number {
    // コース勝率スコア（30%）
    const venueWinScore = this.calculateVenueWinScore(venue);

    // コースG1勝率スコア（30%）
    const venueG1Score = this.calculateVenueG1Score(venue);

    // 全体勝率スコア（20%）
    const overallWinScore = this.calculateOverallWinScore();

    // 調教師コンビ勝率スコア（20%）
    const trainerComboScore = this.calculateTrainerComboScore(trainerId);

    // 重み付け合計
    const totalScore =
      venueWinScore * JOCKEY_SCORE_WEIGHTS.venueWinRate +
      venueG1Score * JOCKEY_SCORE_WEIGHTS.venueG1WinRate +
      overallWinScore * JOCKEY_SCORE_WEIGHTS.overallWinRate +
      trainerComboScore * JOCKEY_SCORE_WEIGHTS.trainerCombo;

    return Math.min(totalScore, 100);
  }

  /**
   * コース勝率スコアを計算
   */
  private calculateVenueWinScore(venue: string): number {
    const stats = this.data.venueStats.get(venue);
    if (!stats || stats.total_runs === 0) return 0;

    const winRate = stats.wins / stats.total_runs;
    let score = winRate * 100;

    // 出走数による信頼度補正
    score *= getJockeyReliabilityFactor(stats.total_runs);

    return score;
  }

  /**
   * コースG1勝率スコアを計算
   */
  private calculateVenueG1Score(venue: string): number {
    const stats = this.data.venueStats.get(venue);
    if (!stats || stats.venue_g1_runs === 0) return 0;

    const g1WinRate = stats.venue_g1_wins / stats.venue_g1_runs;
    let score = g1WinRate * 100;

    // G1出走数による補正
    score *= getJockeyG1ReliabilityFactor(stats.venue_g1_runs);

    return score;
  }

  /**
   * 全体勝率スコアを計算
   */
  private calculateOverallWinScore(): number {
    const stats = this.data.overallStats;
    if (!stats || stats.total_runs === 0) return 0;

    const winRate = stats.wins / stats.total_runs;
    return winRate * 100;
  }

  /**
   * 調教師コンビ勝率スコアを計算
   */
  private calculateTrainerComboScore(trainerId?: number): number {
    if (!trainerId) return 50; // デフォルト

    const stats = this.data.trainerCombos.get(trainerId);
    if (!stats || stats.total_runs < RELIABILITY_THRESHOLDS.trainerComboMinRuns) {
      return 50; // データ不足はデフォルト
    }

    const winRate = stats.wins / stats.total_runs;
    return winRate * 100;
  }

  /**
   * 指定会場の成績を取得
   */
  getVenueStats(venue: string): JockeyVenueStats | undefined {
    return this.data.venueStats.get(venue);
  }

  /**
   * 全体成績を取得
   */
  getOverallStats(): JockeyOverallStats | null {
    return this.data.overallStats;
  }

  /**
   * 調教師コンビ成績を取得
   */
  getTrainerComboStats(trainerId: number): JockeyTrainerComboStats | undefined {
    return this.data.trainerCombos.get(trainerId);
  }

  /**
   * Jockey エンティティを構築するビルダー
   */
  static builder(id: number, name: string): JockeyBuilder {
    return new JockeyBuilder(id, name);
  }
}

/**
 * Jockey ビルダー
 */
export class JockeyBuilder {
  private venueStats = new Map<string, JockeyVenueStats>();
  private overallStats: JockeyOverallStats | null = null;
  private trainerCombos = new Map<number, JockeyTrainerComboStats>();

  constructor(
    private readonly id: number,
    private readonly name: string
  ) {}

  withVenueStats(venue: string, stats: JockeyVenueStats): JockeyBuilder {
    this.venueStats.set(venue, stats);
    return this;
  }

  withOverallStats(stats: JockeyOverallStats): JockeyBuilder {
    this.overallStats = stats;
    return this;
  }

  withTrainerComboStats(trainerId: number, stats: JockeyTrainerComboStats): JockeyBuilder {
    this.trainerCombos.set(trainerId, stats);
    return this;
  }

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
