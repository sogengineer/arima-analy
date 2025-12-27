import { ArimaDatabase } from '../database/Database';

export class TrackAnalysisCommand {
  private readonly db: ArimaDatabase;

  constructor() {
    this.db = new ArimaDatabase();
  }

  async execute(): Promise<void> {
    try {
      console.log('🏁 馬場状態別成績分析を実行中...');

      const horses = this.db.getAllHorsesWithBloodline();

      if (horses.length === 0) {
        console.log('分析対象の馬がいません');
        console.log('\n📥 データ入力方法:');
        console.log('arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`📊 ${horses.length}頭の馬場適性を分析します\n`);

      const trackConditions = ['良', '稍重', '重', '不良'];
      const analysisResults: { name: string; trackStats: Record<string, any> }[] = [];

      for (const horse of horses) {
        if (!horse.id) continue;

        const horseAnalysis = {
          name: horse.name,
          trackStats: {} as Record<string, any>
        };

        console.log(`🐎 ${horse.name} の馬場適性分析:`);

        // 馬場適性データ取得
        const trackStats = this.db.getHorseTrackStats(horse.id);

        for (const condition of trackConditions) {
          const stats = trackStats.find((s: any) => s.track_condition === condition);
          horseAnalysis.trackStats[condition] = stats || { wins: 0, runs: 0 };

          if (stats && stats.runs > 0) {
            const winRate = (stats.wins / stats.runs * 100).toFixed(1);
            const grade = this.getPerformanceGrade(stats.wins / stats.runs);
            console.log(`  ${condition}: ${stats.wins}勝/${stats.runs}走 (${winRate}%) ${grade}`);
          } else {
            console.log(`  ${condition}: 実績なし`);
          }
        }

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
      this.db.close();
    }
  }

  private getPerformanceGrade(winRate: number): string {
    if (winRate >= 0.5) return '🌟🌟🌟 (優秀)';
    if (winRate >= 0.3) return '🌟🌟 (良好)';
    if (winRate >= 0.15) return '🌟 (普通)';
    return '💧 (要注意)';
  }

  private getBestTrackCondition(trackStats: Record<string, any>): { condition: string; win_rate: number } | null {
    let bestCondition = null;
    let maxWinRate = 0;
    let maxRuns = 0;

    for (const [condition, stats] of Object.entries(trackStats)) {
      const runs = stats.runs || 0;
      const wins = stats.wins || 0;
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

  private displayTrackConditionSummary(analysisResults: { name: string; trackStats: Record<string, any> }[]): void {
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

      horsesWithStats.forEach((horse, index) => {
        const winRate = (horse.win_rate * 100).toFixed(1);
        const rank = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
        console.log(`  ${rank} ${horse.name}: ${horse.wins}勝/${horse.runs}走 (${winRate}%)`);
      });
    }
  }
}
