import { DatabaseConnection } from '../database/DatabaseConnection';
import { HorseAggregateRepository } from '../repositories/aggregates/HorseAggregateRepository';
import { RaceAggregateRepository } from '../repositories/aggregates/RaceAggregateRepository';
import { ScoreAggregateRepository } from '../repositories/aggregates/ScoreAggregateRepository';
import { HorseQueryRepository } from '../repositories/queries/HorseQueryRepository';
import { StatsQueryRepository } from '../repositories/queries/StatsQueryRepository';
import { readFileSync } from 'node:fs';
import type { ExtractedRaceData, HorseData } from '../types/HorseData';
import { runAutoBacktest, runAutoOptimizeWeights } from './importData/autoReports';
import {
  calculateBirthYear,
  parseDistanceString,
  parseJapaneseDate,
  parseRaceType,
  parseTrackCondition
} from './importData/parsers';

interface ImportCounts {
  horseInsertCount: number;
  horseUpdateCount: number;
  entryCount: number;
  horseDataForPreviousRaces: HorseData[];
}

export class ImportData {
  private readonly connection: DatabaseConnection;
  private readonly horseAggregateRepo: HorseAggregateRepository;
  private readonly raceAggregateRepo: RaceAggregateRepository;
  private readonly scoreAggregateRepo: ScoreAggregateRepository;
  private readonly horseQueryRepo: HorseQueryRepository;
  private readonly statsQueryRepo: StatsQueryRepository;

  /**
   * @param dbPath テスト用にDBファイルパスを差し替え可能（省略時は本番DB ./arima.db）
   */
  constructor(dbPath?: string) {
    this.connection = dbPath ? new DatabaseConnection(dbPath) : new DatabaseConnection();
    const db = this.connection.getConnection();
    this.horseAggregateRepo = new HorseAggregateRepository(db);
    this.raceAggregateRepo = new RaceAggregateRepository(db);
    this.scoreAggregateRepo = new ScoreAggregateRepository(db);
    this.horseQueryRepo = new HorseQueryRepository(db);
    this.statsQueryRepo = new StatsQueryRepository(db);
  }

  /**
   * 抽出されたJSONファイルをデータベースにインポートする
   */
  async importExtractedJSON(jsonFilePath: string): Promise<void> {
    try {
      console.log(`📥 抽出されたJSONファイルからDBにインポート中: ${jsonFilePath}`);

      // JSONファイルをExtractedRaceData型にパース
      const jsonData: ExtractedRaceData = JSON.parse(readFileSync(jsonFilePath, 'utf-8'));

      // トランザクション内で全データをインポート
      const db = this.connection.getConnection();
      const result = db.transaction(() => {
        // 1. レース情報の登録
        const raceInfo = jsonData.raceInfo;
        const { id: raceId, updated: raceUpdated } = this.registerRace(jsonData);
        console.log(`🏁 レース${raceUpdated ? '更新' : '登録'}: ${raceInfo.raceName} (ID: ${raceId})`);

        // 2. 馬データのインポート
        return this.registerHorsesAndEntries(raceId, jsonData);
      })();

      // 3. 前走データのインポート（メイントランザクションとは独立）
      const previousRaceCount = this.importAllPreviousRaces(result.horseDataForPreviousRaces);

      // 保存済み結果を正として再集計し、訂正や過去の集計漏れを反映する。
      this.scoreAggregateRepo.rebuildHorseStats();

      console.log('✅ 抽出JSONからのDBインポート完了');
      console.log(`🐎 馬: 新規${result.horseInsertCount}頭, 更新${result.horseUpdateCount}頭`);
      console.log(`📋 出馬表: ${result.entryCount}件`);
      console.log(`📅 前走データ: ${previousRaceCount}頭分`);

      // バックテスト＋重み最適化を自動実行
      runAutoBacktest(db);
      runAutoOptimizeWeights(db);

    } catch (error) {
      console.error('❌ 抽出JSONからのインポートに失敗:', error);
    } finally {
      this.connection.close();
    }
  }

  /**
   * レース情報を登録する
   */
  private registerRace(jsonData: ExtractedRaceData): { id: number; updated: boolean } {
    const raceInfo = jsonData.raceInfo;
    return this.raceAggregateRepo.insertRace({
      raceDate: raceInfo.date,
      venue: raceInfo.venue,
      raceNumber: raceInfo.raceNumber,
      raceName: raceInfo.raceName,
      raceClass: raceInfo.raceClass,
      raceType: parseRaceType(raceInfo.courseType),
      distance: raceInfo.distance,
      trackCondition: parseTrackCondition(raceInfo.trackCondition),
      totalHorses: jsonData.horseCount,
      startTime: raceInfo.startTime
    });
  }

  /**
   * 馬と出馬表エントリを登録し、件数と前走インポート対象を返す
   */
  private registerHorsesAndEntries(raceId: number, jsonData: ExtractedRaceData): ImportCounts {
    let horseInsertCount = 0;
    let horseUpdateCount = 0;
    let entryCount = 0;
    const horseDataForPreviousRaces: HorseData[] = [];

    for (const horse of jsonData.horses) {
      // 2-1. 馬を登録
      const { updated } = this.horseAggregateRepo.insertHorseWithBloodline({
        name: horse.basicInfo.name,
        jraHorseId: horse.basicInfo.jraHorseId,
        birthYear: calculateBirthYear(horse.basicInfo.age, jsonData.raceInfo.date),
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

      // 2-2. 出馬表エントリの登録
      this.raceAggregateRepo.insertRaceEntry(raceId, {
        horseName: horse.basicInfo.name,
        jraHorseId: horse.basicInfo.jraHorseId,
        sireName: horse.bloodline.sire,
        mareName: horse.bloodline.mare,
        jockeyName: horse.jockey.name,
        frameNumber: horse.raceInfo.frameNumber,
        horseNumber: horse.raceInfo.horseNumber,
        assignedWeight: horse.jockey.weight,
        // 欠損は undefined のまま渡して NULL にする。
        // 0 を書くと popularity=0 が「1番人気」相当に正規化され、
        // オッズ0倍が有効値として扱われる（欠損の表現を NULL に統一する）
        winOdds: horse.raceInfo.winOdds != null && horse.raceInfo.winOdds > 0
          ? horse.raceInfo.winOdds
          : undefined,
        popularity: horse.raceInfo.popularity != null && horse.raceInfo.popularity >= 1
          ? horse.raceInfo.popularity
          : undefined,
        horseWeight: horse.raceInfo.horseWeight,
        weightChange: horse.raceInfo.weightChange,
        careerWins: horse.record.wins,
        careerPlaces: horse.record.places,
        careerShows: horse.record.shows,
        careerRuns: horse.record.runs,
        totalPrizeMoney: horse.record.prizeMoney
      });
      entryCount++;

      // 前走データは後で別トランザクションでインポート
      horseDataForPreviousRaces.push(horse);
    }

    return { horseInsertCount, horseUpdateCount, entryCount, horseDataForPreviousRaces };
  }

  /**
   * 前走データをインポートする（メイントランザクションとは独立）
   *
   * @remarks
   * 前走データのエラーがメインのインポートに影響しないように分離している。
   *
   * @returns 前走データをインポートできた頭数
   */
  private importAllPreviousRaces(horses: HorseData[]): number {
    let previousRaceCount = 0;
    for (const horse of horses) {
      try {
        this.importPreviousRaces(horse);
        previousRaceCount++;
      } catch (error) {
        console.warn(`⚠️  ${horse.basicInfo.name} の前走データインポートをスキップ:`, error);
      }
    }
    return previousRaceCount;
  }

  private importPreviousRaces(horse: HorseData): void {
    if (!horse.previousRaces || horse.previousRaces.length === 0) return;

    for (const prevRace of horse.previousRaces) {
      try {
        // 前走のレースを登録
        const { distance, raceType } = parseDistanceString(prevRace.distance);
        const raceDate = parseJapaneseDate(prevRace.date);

        // 前走データはレース番号が不明なため、レース名でマッチング
        const { id: prevRaceId } = this.raceAggregateRepo.insertRace({
          raceDate: raceDate,
          venue: prevRace.track,
          // raceNumber は省略（前走データはレース番号不明）
          raceName: prevRace.raceName,
          raceType: raceType,
          distance: distance,
          trackCondition: parseTrackCondition(prevRace.trackCondition),
          totalHorses: prevRace.totalHorses
        }, true);  // matchByName: true で既存レースをレース名でマッチング

        // 前走のエントリを登録
        const { id: entryId } = this.raceAggregateRepo.insertRaceEntry(prevRaceId, {
          horseName: horse.basicInfo.name,
          sireName: horse.bloodline.sire,
          mareName: horse.bloodline.mare,
          jockeyName: prevRace.jockey,
          horseNumber: prevRace.gateNumber,
          assignedWeight: prevRace.weight,
          popularity: prevRace.popularity,
          horseWeight: prevRace.horseWeight
        });

        // 前走の結果を登録
        this.raceAggregateRepo.insertRaceResult(entryId, {
          finishPosition: Number(prevRace.place) || undefined,
          finishStatus: '完走',
          finishTime: prevRace.time,
          margin: prevRace.margin
        });

      } catch (error) {
        // 前走データのインポートエラーは警告のみ
        console.warn(`前走データのインポートに失敗 (${prevRace.raceName}):`, error);
      }
    }
  }

  async extractHorseDataFromHTML(htmlFilePath: string): Promise<void> {
    try {
      console.log(`🔍 HTMLファイルから馬データを抽出中: ${htmlFilePath}`);

      const { HorseDataExtractor } = await import('../utils/HorseDataExtractor');

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
      const { HorseDataExtractor } = await import('../utils/HorseDataExtractor');

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
      const horses = this.horseQueryRepo.getAllHorsesWithDetails();
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
      this.connection.close();
    }
  }

  async showBloodlineStats(): Promise<void> {
    try {
      const sires = this.statsQueryRepo.getAllSires();
      console.log('\n=== 種牡馬一覧 ===\n');

      for (const sire of sires) {
        const stats = this.statsQueryRepo.getBloodlineStats(sire.id);
        console.log(`${sire.name}`);
        if (stats && stats.length > 0) {
          for (const stat of stats) {
            const winRate = stat.runs > 0 ? (stat.wins / stat.runs * 100).toFixed(1) : '0';
            console.log(`  ${stat.race_type || 'ALL'}/${stat.distance_category || 'ALL'}: ${stat.wins}勝/${stat.runs}走 (勝率: ${winRate}%)`);
          }
        }
        console.log('');
      }

    } catch (error) {
      console.error('❌ 血統統計の取得に失敗:', error);
    } finally {
      this.connection.close();
    }
  }

  // 後方互換性メソッド
  async importFromJSON(file: string): Promise<void> {
    await this.importExtractedJSON(file);
  }

  async addSingleHorse(data: string): Promise<void> {
    try {
      const horseData = JSON.parse(data);
      const { id, updated } = this.horseAggregateRepo.insertHorseWithBloodline(horseData);
      console.log(`馬を${updated ? '更新' : '登録'}しました: ID=${id}`);
    } catch (error) {
      console.error('馬の登録に失敗:', error);
    } finally {
      this.connection.close();
    }
  }
}
