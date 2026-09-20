/**
 * 馬場適性分析コマンド
 *
 * @remarks
 * 登録済みの馬の馬場状態別成績を分析する。
 */

import { DatabaseConnection } from '../database/DatabaseConnection';
import { HorseQueryRepository } from '../repositories/queries/HorseQueryRepository';
import type { TrackStats } from '../types/RepositoryTypes';

export class AnalyzeTrack {
  private readonly connection: DatabaseConnection;
  private readonly horseRepo: HorseQueryRepository;

  constructor() {
    this.connection = new DatabaseConnection();
    this.horseRepo = new HorseQueryRepository(this.connection.getConnection());
  }

  /**
   * 馬場適性分析を実行
   */
  async execute(): Promise<void> {
    try {
      console.log('🏁 馬場状態別成績分析を実行中...');

      const horses = this.horseRepo.getAllHorsesWithDetails();

      if (horses.length === 0) {
        console.log('分析対象の馬がいません');
        console.log('\n📥 データ入力方法:');
        console.log('arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`📊 ${horses.length}頭の馬場適性を分析します\n`);

      // バッチ取得
      const horseIds = this.collectHorseIds(horses);
      const trackStatsMap = this.horseRepo.getHorsesTrackStatsBatch(horseIds);

      const trackConditions = ['良', '稍重', '重', '不良'];
      const analysisResults: { name: string; trackStats: Record<string, TrackStats | null> }[] = [];

      for (const horse of horses) {
        if (!horse.id) continue;

        console.log(`🐎 ${horse.name} の馬場適性分析:`);

        // キャッシュから取得
        const trackStats = trackStatsMap.get(horse.id) ?? [];
        const horseAnalysis = {
          name: horse.name,
          trackStats: this.collectConditionStats(trackStats, trackConditions)
        };

        this.displayConditionStats(horseAnalysis.trackStats, trackConditions);

        // 最も適性の高い馬場状態を判定
        const bestCondition = this.getBestTrackCondition(horseAnalysis.trackStats);
        if (bestCondition) {
          console.log(`  → 最適馬場: ${bestCondition.condition} (勝率${(bestCondition.win_rate * 100).toFixed(1)}%)`);
        }

        console.log('');
        analysisResults.push(horseAnalysis);
      }

      // 全体の馬場適性サマリーを表示
      this.displayTrackConditionSummary(analysisResults);

    } catch (error) {
      console.error('❌ 馬場適性分析に失敗:', error);
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
   * 馬場状態ごとの成績を引けるレコードに詰め替える
   */
  private collectConditionStats(
    trackStats: TrackStats[],
    trackConditions: string[]
  ): Record<string, TrackStats | null> {
    const byCondition: Record<string, TrackStats | null> = {};
    for (const condition of trackConditions) {
      const stats = trackStats.find((s: TrackStats) => s.track_condition === condition);
      byCondition[condition] = stats ?? null;
    }
    return byCondition;
  }

  /**
   * 馬場状態ごとの成績を表示する
   */
  private displayConditionStats(
    byCondition: Record<string, TrackStats | null>,
    trackConditions: string[]
  ): void {
    for (const condition of trackConditions) {
      const stats = byCondition[condition];

      if (stats && stats.runs > 0) {
        const winRate = (stats.wins / stats.runs * 100).toFixed(1);
        const grade = this.getPerformanceGrade(stats.wins / stats.runs);
        console.log(`  ${condition}: ${stats.wins}勝/${stats.runs}走 (${winRate}%) ${grade}`);
        continue;
      }

      console.log(`  ${condition}: 実績なし`);
    }
  }

  /**
   * 成績グレードを取得
   *
   * @param winRate - 勝率
   * @returns グレード文字列
   */
  private getPerformanceGrade(winRate: number): string {
    if (winRate >= 0.5) return '🌟🌟🌟 (優秀)';
    if (winRate >= 0.3) return '🌟🌟 (良好)';
    if (winRate >= 0.15) return '🌟 (普通)';
    return '💧 (要注意)';
  }

  /**
   * 最適な馬場状態を取得
   *
   * @param trackStats - 馬場別成績
   * @returns 最適な馬場状態と勝率
   */
  private getBestTrackCondition(trackStats: Record<string, TrackStats | null>): { condition: string; win_rate: number } | null {
    let bestCondition = null;
    let maxWinRate = 0;
    let maxRuns = 0;

    const conditions = Object.keys(trackStats);
    for (const condition of conditions) {
      const stats = trackStats[condition];
      const runs = stats?.runs || 0;
      const wins = stats?.wins || 0;
      const winRate = runs > 0 ? wins / runs : 0;

      if (runs >= 2 && winRate > maxWinRate) {
        bestCondition = condition;
        maxWinRate = winRate;
        maxRuns = runs;
      } else if (runs >= 2 && winRate === maxWinRate && runs > maxRuns) {
        bestCondition = condition;
        maxRuns = runs;
      }
    }

    return bestCondition ? { condition: bestCondition, win_rate: maxWinRate } : null;
  }

  /**
   * 馬場状態別サマリーを表示
   *
   * @param analysisResults - 分析結果の配列
   */
  private displayTrackConditionSummary(analysisResults: { name: string; trackStats: Record<string, TrackStats | null> }[]): void {
    console.log('📈 馬場適性サマリー:');
    console.log('='.repeat(50));

    const trackConditions = ['良', '稍重', '重', '不良'];

    for (const condition of trackConditions) {
      console.log(`\n${condition}馬場での適性上位馬:`);

      const horsesWithStats = analysisResults
        .map(horse => ({
          name: horse.name,
          wins: horse.trackStats[condition]?.wins || 0,
          runs: horse.trackStats[condition]?.runs || 0
        }))
        .filter(horse => horse.runs >= 2)
        .map(horse => ({ ...horse, win_rate: horse.wins / horse.runs }))
        .sort((a, b) => {
          if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
          return b.runs - a.runs;
        })
        .slice(0, 3);

      if (horsesWithStats.length === 0) {
        console.log('  十分な実績のある馬がいません');
        continue;
      }

      for (let index = 0; index < horsesWithStats.length; index++) {
        const horse = horsesWithStats[index];
        const winRate = (horse.win_rate * 100).toFixed(1);
        console.log(`  ${this.topThreeMedal(index)} ${horse.name}: ${horse.wins}勝/${horse.runs}走 (${winRate}%)`);
      }
    }
  }

  /**
   * 上位3頭の順位に対応するメダル表記を返す
   */
  private topThreeMedal(index: number): string {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    return '🥉';
  }
}