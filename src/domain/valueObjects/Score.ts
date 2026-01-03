/**
 * スコア値オブジェクト
 */

import { SCORE_RANGES } from '../../constants/ScoringConstants';

export class Score {
  constructor(private readonly value: number) {
    if (value < 0 || value > 100) {
      throw new Error(`Score must be between 0 and 100, got: ${value}`);
    }
  }

  get rawValue(): number {
    return this.value;
  }

  /**
   * スコアのカテゴリを取得
   */
  getCategory(): 'strong' | 'notable' | 'normal' | 'weak' {
    if (this.value >= SCORE_RANGES.strong.min) return 'strong';
    if (this.value >= SCORE_RANGES.notable.min) return 'notable';
    if (this.value >= SCORE_RANGES.normal.min) return 'normal';
    return 'weak';
  }

  /**
   * カテゴリラベルを取得
   */
  getCategoryLabel(): string {
    const category = this.getCategory();
    return SCORE_RANGES[category].label;
  }

  /**
   * 強みか（70点以上）
   */
  isStrength(): boolean {
    return this.value >= SCORE_RANGES.strong.min;
  }

  /**
   * 弱みか（40点未満）
   */
  isWeakness(): boolean {
    return this.value < SCORE_RANGES.normal.min;
  }

  /**
   * スコアバーを生成
   */
  toBar(length: number = 12): string {
    const filledLength = Math.floor((this.value / 100) * length);
    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(length - filledLength);
    return `[${filled}${empty}]`;
  }

  /**
   * フォーマット済み文字列を取得
   */
  toFormattedString(digits: number = 1): string {
    return this.value.toFixed(digits);
  }

  /**
   * 比較
   */
  compareTo(other: Score): number {
    return this.value - other.value;
  }

  /**
   * 等価判定
   */
  equals(other: Score): boolean {
    return this.value === other.value;
  }

  /**
   * 数値から Score を生成（0-100 にクランプ）
   */
  static of(value: number): Score {
    const clamped = Math.max(0, Math.min(100, value));
    return new Score(clamped);
  }

  /**
   * デフォルトスコア（0点）
   */
  static zero(): Score {
    return new Score(0);
  }
}
