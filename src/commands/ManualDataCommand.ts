import { ArimaDatabase } from '../database/Database.js';
import { readFileSync } from 'node:fs';
import { ExtractedRaceData, HorseData, PreviousRaceResult } from '../types/HorseData.js';

export class ManualDataCommand {
  private readonly db: ArimaDatabase;

  constructor() {
    this.db = new ArimaDatabase();
  }

  async importExtractedJSON(jsonFilePath: string): Promise<void> {
    try {
      console.log(`📥 抽出されたJSONファイルからDBにインポート中: ${jsonFilePath}`);

      const jsonData: ExtractedRaceData = JSON.parse(readFileSync(jsonFilePath, 'utf-8'));

      // レース情報をインポート
      const raceInfo = jsonData.raceInfo;
      const raceType = this.parseRaceType(raceInfo.courseType);
      const { id: raceId, updated: raceUpdated } = this.db.insertRace({
        raceDate: raceInfo.date,
        venue: raceInfo.venue,
        raceNumber: raceInfo.raceNumber,
        raceName: raceInfo.raceName,
        raceClass: raceInfo.raceClass,
        raceType: raceType,
        distance: raceInfo.distance,
        trackCondition: this.parseTrackCondition(raceInfo.trackCondition),
        totalHorses: jsonData.horseCount
      });
      console.log(`🏁 レース${raceUpdated ? '更新' : '登録'}: ${raceInfo.raceName} (ID: ${raceId})`);

      // 馬データのインポート
      let horseInsertCount = 0;
      let horseUpdateCount = 0;
      let entryCount = 0;

      for (const horse of jsonData.horses) {
        try {
          // 馬を登録（血統情報含む）- UPSERT対応
          const { id: horseId, updated } = this.db.insertHorseWithBloodline({
            name: horse.basicInfo.name,
            birthYear: this.calculateBirthYear(horse.basicInfo.age),
            sex: horse.basicInfo.sex,
            sire: horse.bloodline.sire,
            mare: horse.bloodline.mare,
            maresSire: horse.bloodline.maresSire,
            trainer: horse.basicInfo.trainerName,
            trainerStable: horse.basicInfo.trainerDivision,
            owner: horse.basicInfo.ownerName,
            breeder: horse.basicInfo.breederName
          });
          if (updated) {
            horseUpdateCount++;
          } else {
            horseInsertCount++;
          }

          // 出馬表エントリを登録
          const { id: entryId } = this.db.insertRaceEntry(raceId, {
            horseName: horse.basicInfo.name,
            jockeyName: horse.jockey.name,
            frameNumber: horse.raceInfo.frameNumber,
            horseNumber: horse.raceInfo.horseNumber,
            assignedWeight: horse.jockey.weight,
            winOdds: horse.raceInfo.winOdds,
            popularity: horse.raceInfo.popularity,
            careerWins: horse.record.wins,
            careerPlaces: horse.record.places,
            careerShows: horse.record.shows,
            careerRuns: horse.record.runs,
            totalPrizeMoney: horse.record.prizeMoney
          });
          entryCount++;

          // 前走データをインポート
          await this.importPreviousRaces(horse, horseId);

        } catch (error) {
          console.error(`馬 ${horse.basicInfo.name} のインポートに失敗:`, error);
        }
      }

      console.log('✅ 抽出JSONからのDBインポート完了');
      console.log(`🐎 馬: 新規${horseInsertCount}頭, 更新${horseUpdateCount}頭`);
      console.log(`📋 出馬表: ${entryCount}件`);

    } catch (error) {
      console.error('❌ 抽出JSONからのインポートに失敗:', error);
    } finally {
      this.db.close();
    }
  }

  private async importPreviousRaces(horse: HorseData, horseId: number): Promise<void> {
    if (!horse.previousRaces || horse.previousRaces.length === 0) return;

    for (const prevRace of horse.previousRaces) {
      try {
        // 前走のレースを登録
        const { distance, raceType } = this.parseDistanceString(prevRace.distance);
        const raceDate = this.parseJapaneseDate(prevRace.date);

        const { id: prevRaceId } = this.db.insertRace({
          raceDate: raceDate,
          venue: prevRace.track,
          raceNumber: 1, // 不明な場合は1
          raceName: prevRace.raceName,
          raceType: raceType,
          distance: distance,
          trackCondition: this.parseTrackCondition(prevRace.trackCondition),
          totalHorses: prevRace.totalHorses
        });

        // 前走のエントリを登録
        const { id: entryId } = this.db.insertRaceEntry(prevRaceId, {
          horseName: horse.basicInfo.name,
          jockeyName: prevRace.jockey,
          horseNumber: prevRace.gateNumber,
          assignedWeight: prevRace.weight,
          popularity: prevRace.popularity,
          horseWeight: prevRace.horseWeight
        });

        // 前走の結果を登録
        this.db.insertRaceResult(entryId, {
          finishPosition: Number(prevRace.place) || undefined,
          finishStatus: '完走',
          finishTime: prevRace.time,
          margin: prevRace.margin
        });

        // 馬場適性を更新
        if (prevRace.place) {
          const finishPos = Number(prevRace.place);
          this.db.updateHorseTrackStats(
            horseId,
            raceType || 'ダート',
            prevRace.trackCondition || '良',
            finishPos
          );
        }

      } catch (error) {
        // 前走データのインポートエラーは警告のみ
        console.warn(`前走データのインポートに失敗 (${prevRace.raceName}):`, error);
      }
    }
  }

  private parseDistanceString(distanceStr: string): { distance: number; raceType: '芝' | 'ダート' | '障害' } {
    // "1200ダ" or "1600芝" のような形式をパース
    const match = distanceStr.match(/(\d+)(芝|ダ|障)/);
    if (match) {
      const distance = Number.parseInt(match[1]);
      let raceType: '芝' | 'ダート' | '障害' = 'ダート';
      if (match[2] === '芝') raceType = '芝';
      else if (match[2] === '障') raceType = '障害';
      return { distance, raceType };
    }
    return { distance: 1200, raceType: 'ダート' };
  }

  private parseJapaneseDate(dateStr: string): string {
    // "2025年11月30日" -> "2025-11-30"
    const match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return dateStr;
  }

  private parseRaceType(courseType: string): '芝' | 'ダート' | '障害' | undefined {
    if (courseType === '芝') return '芝';
    if (courseType === 'ダート') return 'ダート';
    if (courseType === '障害') return '障害';
    return undefined;
  }

  private parseTrackCondition(condition: string): '良' | '稍重' | '重' | '不良' | undefined {
    if (['良', '稍重', '重', '不良'].includes(condition)) {
      return condition as '良' | '稍重' | '重' | '不良';
    }
    return undefined;
  }

  private calculateBirthYear(age: number): number {
    const currentYear = new Date().getFullYear();
    return currentYear - age;
  }

  async extractHorseDataFromHTML(htmlFilePath: string): Promise<void> {
    try {
      console.log(`🔍 HTMLファイルから馬データを抽出中: ${htmlFilePath}`);

      const { HorseDataExtractor } = await import('../utils/HorseDataExtractor.js');

      const extractor = HorseDataExtractor.fromFile(htmlFilePath);
      const result = extractor.extractAll({
        includeBloodline: true,
        includePreviousRaces: true,
        maxPreviousRaces: 4,
        sortBy: 'popularity'
      });

      if (!result.success || !result.data) {
        console.error('❌ データ抽出に失敗:', result.error);
        return;
      }

      // 詳細出力を表示
      const detailedOutput = extractor.formatOutput(result.data, 'detailed');
      console.log(detailedOutput);

      // 警告があれば表示
      if (result.warnings && result.warnings.length > 0) {
        console.log('⚠️  警告:');
        for (const warning of result.warnings) console.log(`  - ${warning}`);
        console.log('');
      }

      // JSONファイルに保存
      const outputFile = 'data/horse-extracted-data.json';
      const fs = await import('node:fs');
      fs.writeFileSync(outputFile, JSON.stringify(result.data, null, 2), 'utf-8');
      console.log(`📄 詳細データを ${outputFile} に保存しました。`);

    } catch (error) {
      console.error('❌ HTML馬データ抽出に失敗:', error);
    }
  }

  async extractHorseDataStandalone(htmlFilePath: string, outputFormat: 'detailed' | 'summary' | 'csv' = 'detailed'): Promise<void> {
    try {
      const { HorseDataExtractor } = await import('../utils/HorseDataExtractor.js');

      const extractor = HorseDataExtractor.fromFile(htmlFilePath);
      const result = extractor.extractAll({
        includeBloodline: true,
        includePreviousRaces: true,
        sortBy: 'popularity'
      });

      if (!result.success || !result.data) {
        console.error('❌ データ抽出に失敗:', result.error);
        return;
      }

      // 指定フォーマットで出力
      const output = extractor.formatOutput(result.data, outputFormat);
      console.log(output);

      // 警告表示
      if (result.warnings && result.warnings.length > 0) {
        console.log('\n⚠️  警告:');
        for (const warning of result.warnings) console.log(`  - ${warning}`);
      }

    } catch (error) {
      console.error('❌ スタンドアロン抽出に失敗:', error);
    }
  }

  async showHorses(): Promise<void> {
    try {
      const horses = this.db.getAllHorsesWithBloodline();
      console.log('\n=== 登録馬一覧（血統情報付き）===\n');

      if (horses.length === 0) {
        console.log('登録されている馬はありません。');
        return;
      }

      for (const horse of horses) {
        console.log(`${horse.name}`);
        console.log(`  血統: ${horse.sire_name || '不明'} × ${horse.mare_name || '不明'}`);
        if (horse.mares_sire_name) {
          console.log(`  母父: ${horse.mares_sire_name}`);
        }
        console.log(`  調教師: ${horse.trainer_name || '不明'} (${horse.stable || '不明'})`);
        console.log(`  馬主: ${horse.owner_name || '不明'}`);
        console.log('');
      }

      console.log(`合計: ${horses.length}頭`);

    } catch (error) {
      console.error('❌ 馬一覧の取得に失敗:', error);
    } finally {
      this.db.close();
    }
  }

  async showBloodlineStats(): Promise<void> {
    try {
      const sires = this.db.getAllSires();
      console.log('\n=== 種牡馬一覧 ===\n');

      for (const sire of sires) {
        const stats = this.db.getSireStats(sire.id);
        console.log(`${sire.name}`);
        if (stats && stats.length > 0) {
          for (const stat of stats) {
            console.log(`  ${stat.race_type || 'ALL'}/${stat.distance_category || 'ALL'}: ${stat.wins}勝/${stat.runs}走 (勝率: ${(stat.win_rate * 100).toFixed(1)}%)`);
          }
        }
        console.log('');
      }

    } catch (error) {
      console.error('❌ 血統統計の取得に失敗:', error);
    } finally {
      this.db.close();
    }
  }

  // 後方互換性メソッド
  async importFromJSON(file: string): Promise<void> {
    await this.importExtractedJSON(file);
  }

  async importFromCSV(_file: string, _type: 'horses' | 'jockeys' | 'results'): Promise<void> {
    console.log('CSV インポートは未実装です。import-url コマンドをお使いください。');
  }

  async addSingleHorse(data: string): Promise<void> {
    try {
      const horseData = JSON.parse(data);
      const { id, updated } = this.db.insertHorseWithBloodline(horseData);
      console.log(`馬を${updated ? '更新' : '登録'}しました: ID=${id}`);
    } catch (error) {
      console.error('馬の登録に失敗:', error);
    } finally {
      this.db.close();
    }
  }

  async addSingleRaceResult(_data: string): Promise<void> {
    console.log('レース結果の個別登録は未実装です。import-url コマンドをお使いください。');
  }
}
