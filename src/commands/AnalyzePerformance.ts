/**
 * 過去戦績分析コマンド
 *
 * @remarks
 * 登録済みの馬の過去戦績を分析し、成績サマリーと馬場適性を表示する。
 */

import { DatabaseConnection } from '@/database/DatabaseConnection';
import { HorseQueryRepository } from '@/repositories/queries/HorseQueryRepository';
import type { HorseRaceResult, TrackStats } from '@/types/RepositoryTypes';

export class AnalyzePerformance {
  private readonly connection: DatabaseConnection;
  private readonly horseRepo: HorseQueryRepository;

  constructor() {
    this.connection = new DatabaseConnection();
    this.horseRepo = new HorseQueryRepository(this.connection.getConnection());
  }

  /**
   * 戦績分析を実行
   *
   * @param horseName - 特定の馬名（省略時は全馬を分析）
   */
  async execute(horseName?: string): Promise<void> {
    try {
      console.log('🏁 登録済み過去戦績の分析:');

      const horses = this.resolveTargetHorses(horseName);
      if (horses === null) return;

      if (horses.length === 0) {
        console.log('\n❗ まだ馬が登録されていません。');
        console.log('\n📥 データ入力方法:');
        console.log('arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`\n📊 ${horses.length}頭の戦績分析結果:\n`);

      // バッチ取得
      const horseIds = horses.map(h => h.id);
      const raceResultsMap = this.horseRepo.getHorsesRaceResultsBatch(horseIds);
      const trackStatsMap = this.horseRepo.getHorsesTrackStatsBatch(horseIds);

      let totalHorsesWithData = 0;
      let totalRaces = 0;

      for (const horse of horses) {
        try {
          const raceResults = raceResultsMap.get(horse.id) ?? [];

          if (raceResults.length === 0) {
            console.log(`🐎 ${horse.name}: レース結果なし`);
            continue;
          }

          totalHorsesWithData++;
          totalRaces += raceResults.length;

          console.log(`🐎 ${horse.name}: ${raceResults.length}戦`);
          this.displayRecentRaces(raceResults);
          this.displayRecordSummary(raceResults);
          this.displayTrackAptitude(trackStatsMap.get(horse.id) ?? []);

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
      this.connection.close();
    }
  }

  /**
   * 分析対象の馬を決める
   *
   * @param horseName - 特定の馬名（省略時は全馬）
   * @returns 対象の馬。指定した馬名が見つからなかった場合は null
   */
  private resolveTargetHorses(horseName?: string): { id: number; name: string }[] | null {
    if (!horseName) {
      return this.horseRepo.getAllHorses();
    }

    const horse = this.horseRepo.getHorseByName(horseName);
    if (!horse) {
      console.log(`❌ 馬 "${horseName}" が見つかりません`);
      console.log('\n📥 まず馬を登録してください:');
      console.log('arima fetch-and-extract <JRA URL>');
      return null;
    }
    return [horse];
  }

  /**
   * 直近5戦の成績を表示する
   */
  private displayRecentRaces(raceResults: HorseRaceResult[]): void {
    console.log('   直近5戦:');

    const recent = raceResults.slice(0, 5);
    for (let index = 0; index < recent.length; index++) {
      const result = recent[index];
      const date = result.race_date;
      const raceName = result.race_name || 'レース名不明';
      const position = result.finish_position ?? '-';
      const venue = result.venue_name || '';
      const distance = result.distance || '';

      console.log(`     ${index + 1}. ${date} ${raceName} ${position}着 ${venue}${distance}m`);
    }
  }

  /**
   * 勝率・連対率・複勝率のサマリーを表示する（着順が記録された戦のみを母数にする）
   */
  private displayRecordSummary(raceResults: HorseRaceResult[]): void {
    const validResults = raceResults.filter(r => r.finish_position != null);
    if (validResults.length === 0) return;

    const wins = validResults.filter(r => r.finish_position === 1).length;
    const places = validResults.filter(r => (r.finish_position ?? 99) <= 2).length;
    const shows = validResults.filter(r => (r.finish_position ?? 99) <= 3).length;

    const winRate = (wins / validResults.length * 100).toFixed(1);
    const placeRate = (places / validResults.length * 100).toFixed(1);
    const showRate = (shows / validResults.length * 100).toFixed(1);

    console.log(`   成績: ${wins}勝${places}連対${shows}複勝 (勝率${winRate}% 連対率${placeRate}% 複勝率${showRate}%)`);
  }

  /**
   * 馬場状態別の成績を表示する
   */
  private displayTrackAptitude(trackPerf: TrackStats[]): void {
    if (trackPerf.length === 0) return;

    console.log('   馬場適性:');
    for (const tp of trackPerf) {
      const runs = tp.runs || 0;
      const wins_count = tp.wins || 0;
      const rate = runs > 0 ? (wins_count / runs * 100).toFixed(1) : '0';
      console.log(`     ${tp.track_condition}: ${wins_count}/${runs}走 勝率${rate}%`);
    }
  }
}