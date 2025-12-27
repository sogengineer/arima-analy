import { ArimaDatabase } from '../database/Database';

export class PerformanceCommand {
  private readonly db: ArimaDatabase;

  constructor() {
    this.db = new ArimaDatabase();
  }

  async execute(horseName?: string): Promise<void> {
    try {
      console.log('🏁 登録済み過去戦績の分析:');

      let horses: { id: number; name: string }[];

      if (horseName) {
        const horse = this.db.getHorseByName(horseName);
        if (!horse) {
          console.log(`❌ 馬 "${horseName}" が見つかりません`);
          console.log('\n📥 まず馬を登録してください:');
          console.log('arima fetch-and-extract <JRA URL>');
          return;
        }
        horses = [horse];
      } else {
        horses = this.db.getAllHorses();
      }

      if (horses.length === 0) {
        console.log('\n❗ まだ馬が登録されていません。');
        console.log('\n📥 データ入力方法:');
        console.log('arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`\n📊 ${horses.length}頭の戦績分析結果:\n`);

      let totalHorsesWithData = 0;
      let totalRaces = 0;

      for (const horse of horses) {
        try {
          const raceResults = this.db.getHorseRaceResults(horse.id);

          if (raceResults.length === 0) {
            console.log(`🐎 ${horse.name}: レース結果なし`);
            continue;
          }

          totalHorsesWithData++;
          totalRaces += raceResults.length;

          console.log(`🐎 ${horse.name}: ${raceResults.length}戦`);

          // 直近5戦の成績表示
          console.log('   直近5戦:');
          raceResults.slice(0, 5).forEach((result, index) => {
            const date = result.race_date;
            const raceName = result.race_name || 'レース名不明';
            const position = result.finish_position ?? '-';
            const venue = result.venue || '';
            const distance = result.distance || '';

            console.log(`     ${index + 1}. ${date} ${raceName} ${position}着 ${venue}${distance}m`);
          });

          // 成績サマリー
          const validResults = raceResults.filter(r => r.finish_position != null);
          const wins = validResults.filter(r => r.finish_position === 1).length;
          const places = validResults.filter(r => (r.finish_position ?? 99) <= 2).length;
          const shows = validResults.filter(r => (r.finish_position ?? 99) <= 3).length;

          if (validResults.length > 0) {
            const winRate = (wins / validResults.length * 100).toFixed(1);
            const placeRate = (places / validResults.length * 100).toFixed(1);
            const showRate = (shows / validResults.length * 100).toFixed(1);

            console.log(`   成績: ${wins}勝${places}連対${shows}複勝 (勝率${winRate}% 連対率${placeRate}% 複勝率${showRate}%)`);
          }

          // 馬場適性
          const trackPerf = this.db.getTrackPerformance(horse.id);

          if (trackPerf.length > 0) {
            console.log('   馬場適性:');
            for (const tp of trackPerf) {
              const runs = tp.runs || 0;
              const wins_count = tp.wins || 0;
              const rate = runs > 0 ? (wins_count / runs * 100).toFixed(1) : '0';
              console.log(`     ${tp.track_condition}: ${wins_count}/${runs}走 勝率${rate}%`);
            }
          }

          console.log('');

        } catch (error) {
          console.error(`❌ ${horse.name} の戦績分析に失敗:`, error);
        }
      }

      console.log(`\n📊 分析結果サマリー:`);
      console.log(`登録馬: ${horses.length}頭`);
      console.log(`戦績データあり: ${totalHorsesWithData}頭`);
      console.log(`総レース数: ${totalRaces}戦`);

    } catch (error) {
      console.error('❌ 戦績分析に失敗:', error);
    } finally {
      this.db.close();
    }
  }
}
