/**
 * 調教師エンティティ（リッチドメインモデル）
 *
 * @remarks
 * 調教師の基本情報とG1/重賞成績を保持し、
 * 調教師能力スコア計算のビジネスロジックを内包
 *
 * 調教師スコア構成（総合スコアの8%）:
 * - G1勝率（60%）
 * - 重賞勝率（40%）
 *
 * @example
 * ```typescript
 * const trainer = Trainer.builder(1, '藤沢和雄')
 *   .withG1Stats(10, 50)    // G1: 10勝/50走
 *   .withGradeStats(30, 100) // 重賞: 30勝/100走
 *   .build();
 *
 * const score = trainer.calculateScore();
 * ```
 */

import {
  TRAINER_SCORE_WEIGHTS,
  getJockeyG1ReliabilityFactor  // 騎手と同じ信頼度補正を使用
} from '../../constants/ScoringConstants';

/**
 * 調教師エンティティの構築データ
 */
export interface TrainerData {
  /** 調教師ID */
  id: number;
  /** 調教師名 */
  name: string;
  /** G1勝利数 */
  g1Wins: number;
  /** G1出走数 */
  g1Runs: number;
  /** 重賞勝利数 */
  gradeWins: number;
  /** 重賞出走数 */
  gradeRuns: number;
}

export class Trainer {
  constructor(private readonly data: TrainerData) {}

  // ============================================================
  // プロパティアクセサ
  // ============================================================

  /**
   * 調教師ID
   */
  get id(): number {
    return this.data.id;
  }

  /**
   * 調教師名
   */
  get name(): string {
    return this.data.name;
  }

  /**
   * G1勝利数
   */
  get g1Wins(): number {
    return this.data.g1Wins;
  }

  /**
   * G1出走数
   */
  get g1Runs(): number {
    return this.data.g1Runs;
  }

  /**
   * 重賞勝利数
   */
  get gradeWins(): number {
    return this.data.gradeWins;
  }

  /**
   * 重賞出走数
   */
  get gradeRuns(): number {
    return this.data.gradeRuns;
  }

  // ============================================================
  // スコア計算メソッド
  // ============================================================

  /**
   * 調教師能力スコアを計算
   *
   * @remarks
   * 構成: G1勝率(60%) + 重賞勝率(40%)
   * G1出走数による信頼度補正を適用:
   * - 10走以上: 100%反映
   * - 5走以上: 90%反映
   * - 5走未満: 70%反映
   *
   * @returns スコア（0-100）
   */
  calculateScore(): number {
    // G1勝率スコア（60%）
    const g1WinScore = this.calculateG1WinScore();

    // 重賞勝率スコア（40%）
    const gradeWinScore = this.calculateGradeWinScore();

    // 重み付け合計
    const totalScore =
      g1WinScore * TRAINER_SCORE_WEIGHTS.g1WinRate +
      gradeWinScore * TRAINER_SCORE_WEIGHTS.gradeWinRate;

    return Math.min(totalScore, 100);
  }

  /**
   * G1勝率スコアを計算
   *
   * @remarks
   * G1出走数による信頼度補正を適用。
   *
   * @returns スコア（0-100）
   */
  private calculateG1WinScore(): number {
    if (this.data.g1Runs === 0) return 0;

    const winRate = this.data.g1Wins / this.data.g1Runs;
    let score = winRate * 100;

    // G1出走数による信頼度補正（騎手と同じロジック）
    score *= getJockeyG1ReliabilityFactor(this.data.g1Runs);

    return score;
  }

  /**
   * 重賞勝率スコアを計算
   *
   * @remarks
   * 重賞出走数による信頼度補正を適用。
   *
   * @returns スコア（0-100）
   */
  private calculateGradeWinScore(): number {
    if (this.data.gradeRuns === 0) return 0;

    const winRate = this.data.gradeWins / this.data.gradeRuns;
    let score = winRate * 100;

    // 重賞出走数による信頼度補正（G1と同じロジック）
    score *= getJockeyG1ReliabilityFactor(this.data.gradeRuns);

    return score;
  }

  // ============================================================
  // データアクセスメソッド
  // ============================================================

  /**
   * G1勝率を取得
   *
   * @returns G1勝率（0-1）、出走なしは0
   */
  getG1WinRate(): number {
    if (this.data.g1Runs === 0) return 0;
    return this.data.g1Wins / this.data.g1Runs;
  }

  /**
   * 重賞勝率を取得
   *
   * @returns 重賞勝率（0-1）、出走なしは0
   */
  getGradeWinRate(): number {
    if (this.data.gradeRuns === 0) return 0;
    return this.data.gradeWins / this.data.gradeRuns;
  }

  /**
   * Trainer エンティティを構築するビルダー
   *
   * @param id - 調教師ID
   * @param name - 調教師名
   * @returns TrainerBuilder インスタンス
   */
  static builder(id: number, name: string): TrainerBuilder {
    return new TrainerBuilder(id, name);
  }
}

/**
 * Trainer エンティティのビルダー
 *
 * @remarks
 * Fluent API パターンで Trainer エンティティを構築する。
 *
 * @example
 * ```typescript
 * const trainer = Trainer.builder(1, '藤沢和雄')
 *   .withG1Stats(10, 50)
 *   .withGradeStats(30, 100)
 *   .build();
 * ```
 */
export class TrainerBuilder {
  private g1Wins: number = 0;
  private g1Runs: number = 0;
  private gradeWins: number = 0;
  private gradeRuns: number = 0;

  constructor(
    private readonly id: number,
    private readonly name: string
  ) {}

  /**
   * G1成績を設定
   *
   * @param wins - G1勝利数
   * @param runs - G1出走数
   * @returns this
   */
  withG1Stats(wins: number, runs: number): TrainerBuilder {
    this.g1Wins = wins;
    this.g1Runs = runs;
    return this;
  }

  /**
   * 重賞成績を設定
   *
   * @param wins - 重賞勝利数
   * @param runs - 重賞出走数
   * @returns this
   */
  withGradeStats(wins: number, runs: number): TrainerBuilder {
    this.gradeWins = wins;
    this.gradeRuns = runs;
    return this;
  }

  /**
   * Trainer エンティティを構築
   *
   * @returns Trainer インスタンス
   */
  build(): Trainer {
    return new Trainer({
      id: this.id,
      name: this.name,
      g1Wins: this.g1Wins,
      g1Runs: this.g1Runs,
      gradeWins: this.gradeWins,
      gradeRuns: this.gradeRuns
    });
  }
}
