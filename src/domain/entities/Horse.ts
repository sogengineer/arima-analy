/**
 * 馬エンティティ（リッチドメインモデル）
 *
 * @remarks
 * 馬の基本情報、血統情報、レース履歴、コース・馬場別成績を保持し、
 * スコア計算のビジネスロジックを内包
 *
 * スコア計算項目（6項目、計85%）:
 * - 直近成績スコア（25%）
 * - コース適性スコア（18%）
 * - 距離適性スコア（15%）
 * - 上がり3F能力スコア（7%）
 * - G1実績スコア（5%）
 * - ローテーション適性スコア（15%）
 *
 * @example
 * ```typescript
 * const horse = Horse.builder(1, 'イクイノックス')
 *   .withDetail(detail)
 *   .withRaceResults(results)
 *   .withCourseStats(courseStats)
 *   .withTrackStats(trackStats)
 *   .build();
 *
 * const scores = horse.calculateTotalScore(jockey, race);
 * ```
 */

import type { HorseDetail, CourseStats, TrackStats } from '../../types/RepositoryTypes';
import { RaceResult } from './RaceResult';
import { Race } from './Race';
import { Jockey } from './Jockey';
import { ScoreComponents, type ScoreComponentsData } from '../valueObjects/ScoreComponents';
import {
  RECENT_RACE_WEIGHTS,
  getPositionScore,
  getG1PositionScore,
  getHorseReliabilityFactor,
  POPULARITY_DIFF_FACTOR,
  POPULARITY_DIFF_MAX,
  G1_DEFAULT_SCORE,
  LAST_3F_PARAMS,
  VENUE_APTITUDE_WEIGHTS,
  DISTANCE_APTITUDE_WEIGHTS,
  getPostPositionScore,
  TRACK_CONDITION_WEIGHTS,
  TRACK_CONDITION_DEFAULT_SCORE
} from '../../constants/ScoringConstants';
import { Trainer } from './Trainer';
import {
  DISTANCE_THRESHOLDS,
  calculateIntervalDays,
  isOptimalRotation
} from '../../constants/DistanceConstants';

/**
 * 馬エンティティの構築データ
 */
export interface HorseData {
  /** 馬ID */
  id: number;
  /** 馬名 */
  name: string;
  /** 馬詳細情報（血統・調教師・馬主含む） */
  detail?: HorseDetail;
  /** レース結果履歴（日付降順） */
  raceResults: RaceResult[];
  /** コース別成績 */
  courseStats: CourseStats[];
  /** 馬場別成績 */
  trackStats: TrackStats[];
}

export class Horse {
  constructor(private readonly data: HorseData) {}

  // ============================================================
  // プロパティアクセサ
  // ============================================================

  /**
   * 馬ID
   */
  get id(): number {
    return this.data.id;
  }

  /**
   * 馬名
   */
  get name(): string {
    return this.data.name;
  }

  /**
   * 馬詳細情報（血統・調教師・馬主含む）
   */
  get detail(): HorseDetail | undefined {
    return this.data.detail;
  }

  /**
   * レース結果履歴（日付降順）
   */
  get raceResults(): RaceResult[] {
    return this.data.raceResults;
  }

  /**
   * コース別成績
   */
  get courseStats(): CourseStats[] {
    return this.data.courseStats;
  }

  /**
   * 馬場別成績
   */
  get trackStats(): TrackStats[] {
    return this.data.trackStats;
  }

  // ============================================================
  // スコア計算メソッド
  // ============================================================

  /**
   * 総合スコアを計算（10要素）
   *
   * @remarks
   * 10要素のスコアを計算し、ScoreComponentsとして返す。
   * - 騎手スコア（8%）は Jockey エンティティに委譲
   * - 調教師スコア（8%）は Trainer エンティティに委譲
   * - 馬場適性（5%）と枠順効果（5%）は新規追加
   *
   * @param jockey - 騎手エンティティ（null可）
   * @param race - レースエンティティ
   * @param trainer - 調教師エンティティ（null可）
   * @param postPosition - 枠番（1-8、省略時は中間値）
   * @returns スコア構成要素
   */
  calculateTotalScore(
    jockey: Jockey | null,
    race: Race,
    trainer: Trainer | null = null,
    postPosition?: number
  ): ScoreComponents {
    const componentsData: ScoreComponentsData = {
      recentPerformanceScore: this.calculateRecentPerformanceScore(),
      venueAptitudeScore: this.calculateVenueAptitudeScore(race.venue),
      distanceAptitudeScore: this.calculateDistanceAptitudeScore(race.distance),
      last3FAbilityScore: this.calculateLast3FAbilityScore(),
      g1AchievementScore: this.calculateG1AchievementScore(),
      rotationAptitudeScore: this.calculateRotationAptitudeScore(),
      jockeyScore: jockey?.calculateScore(race.venue) ?? 0,
      trackConditionScore: this.calculateTrackConditionAptitudeScore(race.trackCondition ?? '良'),
      postPositionScore: postPosition ? getPostPositionScore(postPosition) : TRACK_CONDITION_DEFAULT_SCORE,
      trainerScore: trainer?.calculateScore() ?? 0
    };

    return new ScoreComponents(componentsData);
  }

  /**
   * 直近成績スコアを計算（25%）
   *
   * @remarks
   * 直近5戦の成績を重み付けで評価。
   * 新しいレースほど重みが大きい（35%, 25%, 20%, 12%, 8%）。
   * 人気を上回る好走にはボーナスを付与。
   *
   * @returns スコア（0-100）
   */
  calculateRecentPerformanceScore(): number {
    if (this.data.raceResults.length === 0) return 0;

    const recent5 = this.data.raceResults.slice(0, 5);
    let score = 0;

    recent5.forEach((result, index) => {
      let raceScore = 0;
      const pos = result.finishPosition ?? 10;

      // 着順による得点
      raceScore = getPositionScore(pos);

      // 人気と着順の乖離による補正（双方向）
      const popularityDiff = result.getPopularityDiff();
      if (popularityDiff > 0) {
        // 期待以上の好走: ボーナス
        raceScore = Math.min(
          raceScore + popularityDiff * POPULARITY_DIFF_FACTOR,
          POPULARITY_DIFF_MAX
        );
      } else if (popularityDiff < 0) {
        // 期待以下の凡走: ペナルティ（係数は半分）
        raceScore = Math.max(
          0,
          raceScore + popularityDiff * (POPULARITY_DIFF_FACTOR * 0.5)
        );
      }

      const weight = RECENT_RACE_WEIGHTS[index] ?? 0;
      score += raceScore * weight;
    });

    return Math.min(score, 100);
  }

  /**
   * コース適性スコアを計算（18%）
   *
   * @remarks
   * 指定会場での勝率（60%）と連対率（40%）から算出。
   * 出走数が少ない場合は信頼度補正を適用。
   *
   * @param venue - 会場名（例: '中山', '東京'）
   * @returns スコア（0-100）
   */
  calculateVenueAptitudeScore(venue: string): number {
    const venueStats = this.data.courseStats.find(s => s.venue_name === venue);

    // 会場での出走実績がない場合は中間値を返す（初出走馬対応）
    if (!venueStats || venueStats.runs === 0) return 50;

    const winRate = venueStats.wins / venueStats.runs;
    const placeRate = (venueStats.wins + (venueStats.places ?? 0)) / venueStats.runs;

    let score =
      winRate * VENUE_APTITUDE_WEIGHTS.winRate +
      placeRate * VENUE_APTITUDE_WEIGHTS.placeRate;

    // 実績数による信頼度補正
    score *= getHorseReliabilityFactor(venueStats.runs);

    return Math.min(score, 100);
  }

  /**
   * 距離適性スコアを計算（15%）
   *
   * @remarks
   * 目標距離±300mの範囲でのレース成績から算出。
   * 同距離（±100m）での勝利にはボーナスを付与。
   *
   * @param targetDistance - 目標距離（メートル）
   * @returns スコア（0-100）
   */
  calculateDistanceAptitudeScore(targetDistance: number): number {
    // 目標距離±300mの範囲での成績
    const similarDistanceResults = this.data.raceResults.filter(
      r => r.getDistanceDiff(targetDistance) <= DISTANCE_THRESHOLDS.aptitudeRange
    );

    if (similarDistanceResults.length === 0) return 0;

    const validResults = similarDistanceResults.filter(r => r.finishPosition != null);
    const wins = validResults.filter(r => r.isWin()).length;
    const places = validResults.filter(r => r.isShow()).length;

    if (validResults.length === 0) return 0;

    const winRate = wins / validResults.length;
    const placeRate = places / validResults.length;

    let score =
      winRate * DISTANCE_APTITUDE_WEIGHTS.winRate +
      placeRate * DISTANCE_APTITUDE_WEIGHTS.placeRate;

    // 同距離実績はボーナス
    const exactDistanceWins = this.data.raceResults.filter(
      r => r.getDistanceDiff(targetDistance) <= DISTANCE_THRESHOLDS.exactDistanceRange && r.isWin()
    ).length;
    score += exactDistanceWins * DISTANCE_APTITUDE_WEIGHTS.exactDistanceBonus;

    return Math.min(score, 100);
  }

  /**
   * 上がり3F能力スコアを計算（7%）
   *
   * @remarks
   * 上がり3Fタイムがある場合: 基準時間（37秒）との差から算出
   * 上がり3Fタイムがない場合: 複勝率から推定
   *
   * @returns スコア（0-100）
   */
  calculateLast3FAbilityScore(): number {
    if (this.data.raceResults.length === 0) return 0;

    // 上がり3Fのデータがある場合はそれを使用
    const withLast3F = this.data.raceResults.filter(r => r.last3FTime != null);

    if (withLast3F.length > 0) {
      const avgTime = withLast3F.reduce((sum, r) => sum + (r.last3FTime ?? 0), 0) / withLast3F.length;
      const score = Math.max(
        0,
        ((LAST_3F_PARAMS.baseTime - avgTime) / LAST_3F_PARAMS.divisor) * 100
      );
      return Math.min(score, 100);
    }

    // 上がり3Fデータがない場合は複勝率で推定
    const validResults = this.data.raceResults.filter(r => r.finishPosition != null);
    const top3Count = validResults.filter(r => r.isShow()).length;
    const top3Rate = validResults.length > 0 ? top3Count / validResults.length : 0;

    return top3Rate * LAST_3F_PARAMS.noDataMultiplier + LAST_3F_PARAMS.noDataBaseScore;
  }

  /**
   * G1実績スコアを計算（5%）
   *
   * @remarks
   * G1レースでの着順に基づくスコア。
   * 1着: 40点, 2着: 25点, 3着: 18点, 4-5着: 10点, 6着以下: 3点
   * G1出走経験がない場合はデフォルト30点。
   *
   * @returns スコア（0-100）
   */
  calculateG1AchievementScore(): number {
    const g1Results = this.data.raceResults.filter(r => r.isG1());

    if (g1Results.length === 0) return G1_DEFAULT_SCORE;

    let score = 0;

    for (const result of g1Results) {
      const pos = result.finishPosition ?? 99;
      score += getG1PositionScore(pos);
    }

    return Math.min(score, 100);
  }

  /**
   * ローテーション適性スコアを計算（15%）
   *
   * @remarks
   * 適正出走間隔（3〜10週間）での好走率を評価。
   * 間隔が適正範囲内のレースでの3着以内率をスコア化。
   *
   * @returns スコア（0-100）
   */
  calculateRotationAptitudeScore(): number {
    if (this.data.raceResults.length < 2) return 0;

    let goodPerformances = 0;
    let totalIntervals = 0;

    for (let i = 0; i < this.data.raceResults.length - 1; i++) {
      const current = this.data.raceResults[i];
      const prev = this.data.raceResults[i + 1];

      const currentDate = new Date(current.raceDate);
      const prevDate = new Date(prev.raceDate);
      const intervalDays = calculateIntervalDays(currentDate, prevDate);

      // 適切な間隔での好走率
      if (isOptimalRotation(intervalDays)) {
        totalIntervals++;
        if (current.isShow()) {
          goodPerformances++;
        }
      }
    }

    if (totalIntervals === 0) return 0;

    const score = (goodPerformances / totalIntervals) * 100;
    return Math.min(score, 100);
  }

  /**
   * 馬場適性スコアを計算（5%）
   *
   * @remarks
   * 指定馬場状態での勝率（60%）と連対率（40%）から算出。
   * データがない場合は中間値（50点）を返す。
   *
   * @param trackCondition - 馬場状態（'良', '稍重', '重', '不良'）
   * @returns スコア（0-100）
   */
  calculateTrackConditionAptitudeScore(trackCondition: string): number {
    const stats = this.data.trackStats.find(
      s => s.track_condition === trackCondition
    );

    if (!stats || stats.runs === 0) return TRACK_CONDITION_DEFAULT_SCORE;

    const winRate = stats.wins / stats.runs;
    const placeRate = (stats.wins + (stats.places ?? 0)) / stats.runs;

    const score =
      winRate * TRACK_CONDITION_WEIGHTS.winRate +
      placeRate * TRACK_CONDITION_WEIGHTS.placeRate;

    return Math.min(score, 100);
  }

  // ============================================================
  // ユーティリティメソッド
  // ============================================================

  /**
   * 父名を取得
   *
   * @returns 父名、不明の場合は undefined
   */
  getSireName(): string | undefined {
    return this.data.detail?.sire_name;
  }

  /**
   * 母名を取得
   *
   * @returns 母名、不明の場合は undefined
   */
  getMareName(): string | undefined {
    return this.data.detail?.mare_name;
  }

  /**
   * 母父名を取得
   *
   * @returns 母父名、不明の場合は undefined
   */
  getMaresSireName(): string | undefined {
    return this.data.detail?.mares_sire_name;
  }

  /**
   * 調教師名を取得
   *
   * @returns 調教師名、不明の場合は undefined
   */
  getTrainerName(): string | undefined {
    return this.data.detail?.trainer_name;
  }

  /**
   * 直近N戦の結果を取得
   *
   * @param count - 取得する件数（デフォルト5）
   * @returns レース結果の配列
   */
  getRecentResults(count: number = 5): RaceResult[] {
    return this.data.raceResults.slice(0, count);
  }

  /**
   * 指定会場でのコース成績を取得
   *
   * @param venueName - 会場名（例: '中山', '東京'）
   * @returns コース成績、存在しない場合は undefined
   */
  getCourseStatsForVenue(venueName: string): CourseStats | undefined {
    return this.data.courseStats.find(s => s.venue_name === venueName);
  }

  /**
   * Horse エンティティを構築するビルダー
   *
   * @param id - 馬ID
   * @param name - 馬名
   * @returns HorseBuilder インスタンス
   */
  static builder(id: number, name: string): HorseBuilder {
    return new HorseBuilder(id, name);
  }
}

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
