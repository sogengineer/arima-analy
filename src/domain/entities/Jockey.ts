/**
 * 騎手エンティティ（リッチドメインモデル）
 *
 * @remarks
 * 騎手の基本情報、会場別成績、全体成績、調教師コンビ成績を保持し、
 * 騎手能力スコア計算のビジネスロジックを内包
 *
 * 騎手スコア構成（総合スコアの15%）:
 * - コース勝率（30%）
 * - コースG1勝率（30%）
 * - 全体勝率（20%）
 * - 調教師コンビ勝率（20%）
 *
 * @example
 * ```typescript
 * const jockey = Jockey.builder(1, 'C.ルメール')
 *   .withVenueStats('中山', venueStats)
 *   .withOverallStats(overallStats)
 *   .build();
 *
 * const score = jockey.calculateScore('中山');
 * ```
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

/**
 * 騎手エンティティの構築データ
 */
export interface JockeyData {
  /** 騎手ID */
  id: number;
  /** 騎手名 */
  name: string;
  /** 会場別成績（会場名 → 成績） */
  venueStats: Map<string, JockeyVenueStats>;
  /** 全体成績 */
  overallStats: JockeyOverallStats | null;
  /** 調教師コンビ成績（調教師ID → 成績） */
  trainerCombos: Map<number, JockeyTrainerComboStats>;
}

export class Jockey {
  constructor(private readonly data: JockeyData) {}

  // ============================================================
  // プロパティアクセサ
  // ============================================================

  /**
   * 騎手ID
   */
  get id(): number {
    return this.data.id;
  }

  /**
   * 騎手名
   */
  get name(): string {
    return this.data.name;
  }

  // ============================================================
  // スコア計算メソッド
  // ============================================================

  /**
   * 騎手能力スコアを計算
   *
   * @remarks
   * 構成: コース勝率(30%) + コースG1勝率(30%) + 全体勝率(20%) + 調教師コンビ勝率(20%)
   *
   * @param venue - 会場名（例: '中山', '東京'）
   * @param trainerId - 調教師ID（省略可）
   * @returns スコア（0-100）
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
   *
   * @remarks
   * 指定会場での勝率をスコア化。出走数による信頼度補正を適用。
   * - 50走以上: 100%反映
   * - 20走以上: 90%反映
   * - 10走以上: 80%反映
   * - 10走未満: 60%反映
   *
   * @param venue - 会場名
   * @returns スコア（0-100）
   */
  private calculateVenueWinScore(venue: string): number {
    const stats = this.data.venueStats.get(venue);

    // 会場未経験の場合は全体成績の75%を使用
    if (!stats || stats.total_runs === 0) {
      return this.calculateOverallWinScore() * 0.75;
    }

    const winRate = stats.wins / stats.total_runs;
    let score = winRate * 100;

    // 出走数による信頼度補正
    score *= getJockeyReliabilityFactor(stats.total_runs);

    return score;
  }

  /**
   * コースG1勝率スコアを計算
   *
   * @remarks
   * 指定会場でのG1勝率をスコア化。G1出走数による信頼度補正を適用。
   * - 10走以上: 100%反映
   * - 5走以上: 90%反映
   * - 5走未満: 70%反映
   *
   * @param venue - 会場名
   * @returns スコア（0-100）
   */
  private calculateVenueG1Score(venue: string): number {
    const stats = this.data.venueStats.get(venue);

    // 会場G1未経験の場合は全体成績の50%を使用（G1経験は希少なため低めに設定）
    if (!stats || stats.venue_g1_runs === 0) {
      return this.calculateOverallWinScore() * 0.5;
    }

    const g1WinRate = stats.venue_g1_wins / stats.venue_g1_runs;
    let score = g1WinRate * 100;

    // G1出走数による補正
    score *= getJockeyG1ReliabilityFactor(stats.venue_g1_runs);

    return score;
  }

  /**
   * 全体勝率スコアを計算
   *
   * @remarks
   * 全レースでの勝率をスコア化。
   * 信頼度補正なし（十分なサンプル数が期待される）。
   *
   * @returns スコア（0-100）
   */
  private calculateOverallWinScore(): number {
    const stats = this.data.overallStats;
    if (!stats || stats.total_runs === 0) return 0;

    const winRate = stats.wins / stats.total_runs;
    return winRate * 100;
  }

  /**
   * 調教師コンビ勝率スコアを計算
   *
   * @remarks
   * 特定調教師との相性をスコア化。
   * データ不足（3走未満）の場合はデフォルト50点を返す。
   *
   * @param trainerId - 調教師ID
   * @returns スコア（0-100）、データ不足時は50
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

  // ============================================================
  // データアクセスメソッド
  // ============================================================

  /**
   * 指定会場の成績を取得
   *
   * @param venue - 会場名（例: '中山', '東京'）
   * @returns 会場成績、存在しない場合は undefined
   */
  getVenueStats(venue: string): JockeyVenueStats | undefined {
    return this.data.venueStats.get(venue);
  }

  /**
   * 全体成績を取得
   *
   * @returns 全体成績、存在しない場合は null
   */
  getOverallStats(): JockeyOverallStats | null {
    return this.data.overallStats;
  }

  /**
   * 調教師コンビ成績を取得
   *
   * @param trainerId - 調教師ID
   * @returns 調教師コンビ成績、存在しない場合は undefined
   */
  getTrainerComboStats(trainerId: number): JockeyTrainerComboStats | undefined {
    return this.data.trainerCombos.get(trainerId);
  }

  /**
   * Jockey エンティティを構築するビルダー
   *
   * @param id - 騎手ID
   * @param name - 騎手名
   * @returns JockeyBuilder インスタンス
   */
  static builder(id: number, name: string): JockeyBuilder {
    return new JockeyBuilder(id, name);
  }
}

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
