/**
 * Trainer エンティティのビルダー
 *
 * @remarks
 * `Trainer.ts` から切り出したファイル。公開経路は `Trainer.builder()`。
 */

import { Trainer } from './Trainer';

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
