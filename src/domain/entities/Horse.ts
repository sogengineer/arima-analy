/**
 * 馬エンティティ（リッチドメインモデル）
 * スコア計算ロジックを内包
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
  DISTANCE_APTITUDE_WEIGHTS
} from '../../constants/ScoringConstants';
import {
  DISTANCE_THRESHOLDS,
  ROTATION_PERIOD,
  calculateIntervalDays,
  isOptimalRotation
} from '../../constants/DistanceConstants';

export interface HorseData {
  id: number;
  name: string;
  detail?: HorseDetail;
  raceResults: RaceResult[];
  courseStats: CourseStats[];
  trackStats: TrackStats[];
}

export class Horse {
  constructor(private readonly data: HorseData) {}

  get id(): number {
    return this.data.id;
  }

  get name(): string {
    return this.data.name;
  }

  get detail(): HorseDetail | undefined {
    return this.data.detail;
  }

  get raceResults(): RaceResult[] {
    return this.data.raceResults;
  }

  get courseStats(): CourseStats[] {
    return this.data.courseStats;
  }

  get trackStats(): TrackStats[] {
    return this.data.trackStats;
  }

  /**
   * 総合スコアを計算
   */
  calculateTotalScore(jockey: Jockey | null, race: Race): ScoreComponents {
    const trainerId = this.data.detail?.trainer_name ? undefined : undefined; // trainer_id がdetailにない場合

    const componentsData: ScoreComponentsData = {
      recentPerformanceScore: this.calculateRecentPerformanceScore(),
      venueAptitudeScore: this.calculateVenueAptitudeScore(race.venue),
      distanceAptitudeScore: this.calculateDistanceAptitudeScore(race.distance),
      last3FAbilityScore: this.calculateLast3FAbilityScore(),
      g1AchievementScore: this.calculateG1AchievementScore(),
      rotationAptitudeScore: this.calculateRotationAptitudeScore(),
      jockeyScore: jockey?.calculateScore(race.venue) ?? 0
    };

    return new ScoreComponents(componentsData);
  }

  /**
   * 直近成績スコアを計算
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

      // 人気と着順の乖離による補正
      const popularityDiff = result.getPopularityDiff();
      if (popularityDiff > 0) {
        raceScore = Math.min(
          raceScore + popularityDiff * POPULARITY_DIFF_FACTOR,
          POPULARITY_DIFF_MAX
        );
      }

      const weight = RECENT_RACE_WEIGHTS[index] ?? 0;
      score += raceScore * weight;
    });

    return Math.min(score, 100);
  }

  /**
   * コース適性スコアを計算
   */
  calculateVenueAptitudeScore(venue: string): number {
    const venueStats = this.data.courseStats.find(s => s.venue_name === venue);

    if (!venueStats || venueStats.runs === 0) return 0;

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
   * 距離適性スコアを計算
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
   * 上がり3F能力スコアを計算
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
   * G1実績スコアを計算
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
   * ローテーション適性スコアを計算
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
   * Horse エンティティを構築するビルダー
   */
  static builder(id: number, name: string): HorseBuilder {
    return new HorseBuilder(id, name);
  }
}

/**
 * Horse ビルダー
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

  withDetail(detail: HorseDetail): HorseBuilder {
    this.detail = detail;
    return this;
  }

  withRaceResults(results: RaceResult[]): HorseBuilder {
    this.raceResults = results;
    return this;
  }

  withCourseStats(stats: CourseStats[]): HorseBuilder {
    this.courseStats = stats;
    return this;
  }

  withTrackStats(stats: TrackStats[]): HorseBuilder {
    this.trackStats = stats;
    return this;
  }

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
