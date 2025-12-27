import { ArimaDatabase } from '../database/Database';

export class CourseAnalysisCommand {
  private readonly db: ArimaDatabase;

  constructor() {
    this.db = new ArimaDatabase();
  }

  async execute(): Promise<void> {
    try {
      console.log('🏇 中山2500mコース適性分析を実行中...');

      const horses = this.db.getAllHorsesWithBloodline();

      if (horses.length === 0) {
        console.log('分析対象の馬がいません');
        console.log('\n📥 データ入力方法:');
        console.log('arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`📊 ${horses.length}頭の中山コース適性を分析します\n`);

      const analysisResults: { name: string; aptitudeScore: number; stats: any }[] = [];

      for (const horse of horses) {
        if (!horse.id) continue;

        console.log(`🐎 ${horse.name} のコース適性分析:`);

        // 馬場適性データ取得
        const courseStats = this.db.getHorseCourseStats(horse.id);
        const trackStats = this.db.getHorseTrackStats(horse.id);

        // 中山コースの実績
        const nakayamaStats = courseStats.find((s: any) => s.venue_name === '中山');

        if (nakayamaStats && nakayamaStats.runs > 0) {
          const winRate = nakayamaStats.runs > 0 ? (nakayamaStats.wins / nakayamaStats.runs * 100).toFixed(1) : '0';
          console.log(`  中山コース: ${nakayamaStats.wins}勝/${nakayamaStats.runs}走 (勝率${winRate}%)`);
        } else {
          console.log(`  中山コース: 実績なし`);
        }

        // 芝の実績
        const turfStats = trackStats.find((s: any) => s.race_type === '芝');
        if (turfStats && turfStats.runs > 0) {
          const winRate = (turfStats.wins / turfStats.runs * 100).toFixed(1);
          console.log(`  芝適性: ${turfStats.wins}勝/${turfStats.runs}走 (勝率${winRate}%)`);
        }

        // 適性スコア算出
        const aptitudeScore = this.calculateAptitudeScore(nakayamaStats, trackStats);
        console.log(`  🎯 中山2500m適性スコア: ${aptitudeScore.toFixed(2)}点\n`);

        analysisResults.push({
          name: horse.name,
          aptitudeScore,
          stats: { nakayama: nakayamaStats, track: trackStats }
        });
      }

      // 適性ランキングを表示
      this.displayAptitudeRanking(analysisResults);

    } catch (error) {
      console.error('❌ コース適性分析に失敗:', error);
    } finally {
      this.db.close();
    }
  }

  private calculateAptitudeScore(nakayamaStats: any, trackStats: any[]): number {
    let score = 50; // ベーススコア

    // 中山コース実績
    if (nakayamaStats && nakayamaStats.runs > 0) {
      const winRate = nakayamaStats.wins / nakayamaStats.runs;
      score += winRate * 30;
    }

    // 芝実績
    const turfStats = trackStats.find((s: any) => s.race_type === '芝');
    if (turfStats && turfStats.runs > 0) {
      const winRate = turfStats.wins / turfStats.runs;
      score += winRate * 20;
    }

    return Math.min(score, 100);
  }

  private displayAptitudeRanking(analysisResults: { name: string; aptitudeScore: number }[]): void {
    console.log('🏆 中山2500m適性ランキング:');
    console.log('='.repeat(60));

    const rankedResults = analysisResults
      .sort((a, b) => b.aptitudeScore - a.aptitudeScore)
      .slice(0, 10);

    rankedResults.forEach((horse, index) => {
      const rank = index + 1;
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${rank}位`;
      console.log(`${medal} ${horse.name} (${horse.aptitudeScore.toFixed(1)}点)`);
    });

    console.log('\n💡 適性スコア算出方法:');
    console.log('  - ベーススコア: 50点');
    console.log('  - 中山コース実績: 最大30点');
    console.log('  - 芝実績: 最大20点');
  }
}
