/**
 * コース適性分析コマンド
 *
 * @remarks
 * 登録済みの馬の指定会場コース適性を分析する。
 * 会場を指定しない場合は全会場の成績を表示する。
 */

import { DatabaseConnection } from '../database/DatabaseConnection';
import { HorseQueryRepository } from '../repositories/queries/HorseQueryRepository';
import type { CourseStats, TrackStats } from '../types/RepositoryTypes';

interface AptitudeAnalysisResult {
  name: string;
  aptitudeScore: number;
  stats: { venue: CourseStats | undefined; track: TrackStats[] };
}

export class AnalyzeCourse {
  private readonly connection: DatabaseConnection;
  private readonly horseRepo: HorseQueryRepository;

  constructor() {
    this.connection = new DatabaseConnection();
    this.horseRepo = new HorseQueryRepository(this.connection.getConnection());
  }

  /**
   * コース適性分析を実行
   *
   * @param venue - 会場名（例: '中山', '東京'）。省略時は全会場の成績を表示
   */
  async execute(venue?: string): Promise<void> {
    try {
      const venueLabel = venue ?? '全会場';
      console.log(`🏇 ${venueLabel}コース適性分析を実行中...`);

      const horses = this.horseRepo.getAllHorsesWithDetails();

      if (horses.length === 0) {
        console.log('分析対象の馬がいません');
        console.log('\n📥 データ入力方法:');
        console.log('arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`📊 ${horses.length}頭の${venueLabel}コース適性を分析します\n`);

      // バッチ取得
      const horseIds = this.collectHorseIds(horses);
      const courseStatsMap = this.horseRepo.getHorsesCourseStatsBatch(horseIds);
      const trackStatsMap = this.horseRepo.getHorsesTrackStatsBatch(horseIds);

      const analysisResults: AptitudeAnalysisResult[] = [];

      for (const horse of horses) {
        if (!horse.id) continue;

        console.log(`🐎 ${horse.name} のコース適性分析:`);

        // キャッシュから取得
        const courseStats = courseStatsMap.get(horse.id) ?? [];
        const trackStats = trackStatsMap.get(horse.id) ?? [];

        // 指定会場のコース実績
        const venueStats = venue
          ? courseStats.find((s: CourseStats) => s.venue_name === venue)
          : undefined;

        this.displayCourseRecord(venue, venueStats, courseStats);
        this.displayTurfRecord(trackStats);

        // 適性スコア算出
        const aptitudeScore = this.calculateAptitudeScore(venueStats, trackStats);
        console.log(`  🎯 ${venueLabel}適性スコア: ${aptitudeScore.toFixed(2)}点\n`);

        analysisResults.push({
          name: horse.name,
          aptitudeScore,
          stats: { venue: venueStats, track: trackStats }
        });
      }

      // 適性ランキングを表示
      this.displayAptitudeRanking(analysisResults, venueLabel);

    } catch (error) {
      console.error('❌ コース適性分析に失敗:', error);
    } finally {
      this.connection.close();
    }
  }

  /**
   * 詳細付きの馬一覧から、ID を持つ馬の ID だけを取り出す
   */
  private collectHorseIds(horses: { id?: number | null }[]): number[] {
    const horseIds: number[] = [];
    for (const horse of horses) {
      if (horse.id != null) {
        horseIds.push(horse.id);
      }
    }
    return horseIds;
  }

  /**
   * コース実績を表示する（会場指定時はその会場、未指定時は全会場）
   */
  private displayCourseRecord(
    venue: string | undefined,
    venueStats: CourseStats | undefined,
    courseStats: CourseStats[]
  ): void {
    if (!venue) {
      this.displayAllVenueRecords(courseStats);
      return;
    }

    if (venueStats && venueStats.runs > 0) {
      const winRate = (venueStats.wins / venueStats.runs * 100).toFixed(1);
      console.log(`  ${venue}コース: ${venueStats.wins}勝/${venueStats.runs}走 (勝率${winRate}%)`);
      return;
    }

    console.log(`  ${venue}コース: 実績なし`);
  }

  /**
   * 全会場のコース実績を表示する
   */
  private displayAllVenueRecords(courseStats: CourseStats[]): void {
    if (courseStats.length === 0) {
      console.log(`  コース実績なし`);
      return;
    }

    for (const cs of courseStats) {
      if (cs.runs > 0) {
        const winRate = (cs.wins / cs.runs * 100).toFixed(1);
        console.log(`  ${cs.venue_name}コース: ${cs.wins}勝/${cs.runs}走 (勝率${winRate}%)`);
      }
    }
  }

  /**
   * 芝の実績を表示する（出走実績がある場合のみ）
   */
  private displayTurfRecord(trackStats: TrackStats[]): void {
    const turfStats = trackStats.find((s: TrackStats) => s.race_type === '芝');
    if (turfStats && turfStats.runs > 0) {
      const winRate = (turfStats.wins / turfStats.runs * 100).toFixed(1);
      console.log(`  芝適性: ${turfStats.wins}勝/${turfStats.runs}走 (勝率${winRate}%)`);
    }
  }

  /**
   * 適性スコアを計算
   *
   * @param venueStats - 会場コース成績
   * @param trackStats - 馬場別成績
   * @returns 適性スコア（0-100）
   */
  private calculateAptitudeScore(venueStats: CourseStats | undefined, trackStats: TrackStats[]): number {
    let score = 50; // ベーススコア

    // 会場コース実績
    if (venueStats && venueStats.runs > 0) {
      const winRate = venueStats.wins / venueStats.runs;
      score += winRate * 30;
    }

    // 芝実績
    const turfStats = trackStats.find((s: TrackStats) => s.race_type === '芝');
    if (turfStats && turfStats.runs > 0) {
      const winRate = turfStats.wins / turfStats.runs;
      score += winRate * 20;
    }

    return Math.min(score, 100);
  }

  /**
   * 適性ランキングを表示
   *
   * @param analysisResults - 分析結果の配列
   * @param venueLabel - 会場ラベル（例: '中山', '全会場'）
   */
  private displayAptitudeRanking(analysisResults: { name: string; aptitudeScore: number }[], venueLabel: string): void {
    console.log(`🏆 ${venueLabel}適性ランキング:`);
    console.log('='.repeat(60));

    const rankedResults = analysisResults
      .sort((a, b) => b.aptitudeScore - a.aptitudeScore)
      .slice(0, 10);

    for (let index = 0; index < rankedResults.length; index++) {
      const horse = rankedResults[index];
      console.log(`${this.rankMedal(index)} ${horse.name} (${horse.aptitudeScore.toFixed(1)}点)`);
    }

    console.log('\n💡 適性スコア算出方法:');
    console.log('  - ベーススコア: 50点');
    console.log(`  - ${venueLabel}コース実績: 最大30点`);
    console.log('  - 芝実績: 最大20点');
  }

  /**
   * 順位に対応するメダル表記を返す（4位以降は「N位」）
   */
  private rankMedal(index: number): string {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}位`;
  }
}