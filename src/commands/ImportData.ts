import { ArimaDatabase } from '../database/Database.js';
import { readFileSync } from 'node:fs';
import { ExtractedRaceData, HorseData, PreviousRaceResult } from '../types/HorseData.js';

export class ImportData {
  private readonly db: ArimaDatabase;

  constructor() {
    this.db = new ArimaDatabase();
  }

  /**
   * 抽出されたJSONファイルをデータベースにインポートする
   *
   * @description
   * JRA出馬表から抽出したJSONデータをDBに登録する。
   * 新規データはINSERT、既存データはUPDATE（UPSERT処理）。
   *
   * @param jsonFilePath - 抽出済みJSONファイルのパス（ExtractedRaceData形式）
   *
   * @example
   * ```typescript
   * const command = new ManualDataCommand();
   * await command.importExtractedJSON('data/horse-extracted-data.json');
   * ```
   *
   * @remarks
   * 処理順序:
   * 1. レース情報の登録（races テーブル）
   * 2. 馬データの登録（horses テーブル + 血統マスタ）
   * 3. 出馬表エントリの登録（race_entries テーブル）
   * 4. 前走データのインポート（過去レース + 結果）
   */
  async importExtractedJSON(jsonFilePath: string): Promise<void> {
    try {
      console.log(`📥 抽出されたJSONファイルからDBにインポート中: ${jsonFilePath}`);

      // JSONファイルをExtractedRaceData型にパース
      const jsonData: ExtractedRaceData = JSON.parse(readFileSync(jsonFilePath, 'utf-8'));

      // ========================================
      // トランザクション内で全データをインポート
      // エラー時は自動ロールバック
      // ========================================
      const result = this.db.runInTransaction(() => {
        // ========================================
        // 1. レース情報の登録（races テーブル）
        // ========================================
        const raceInfo = jsonData.raceInfo;
        const raceType = this.parseRaceType(raceInfo.courseType);
        const { id: raceId, updated: raceUpdated } = this.db.insertRace({
          raceDate: raceInfo.date,           // 開催日 (YYYY-MM-DD)
          venue: raceInfo.venue,             // 競馬場名（中山, 東京, etc.）
          raceNumber: raceInfo.raceNumber,   // レース番号（1-12）
          raceName: raceInfo.raceName,       // レース名（有馬記念, etc.）
          raceClass: raceInfo.raceClass,     // クラス（G1, G2, etc.）
          raceType: raceType,                // 馬場（芝, ダート, 障害）
          distance: raceInfo.distance,       // 距離（メートル）
          trackCondition: this.parseTrackCondition(raceInfo.trackCondition), // 馬場状態（良, 稍重, 重, 不良）
          totalHorses: jsonData.horseCount   // 出走頭数
        });
        console.log(`🏁 レース${raceUpdated ? '更新' : '登録'}: ${raceInfo.raceName} (ID: ${raceId})`);

        // ========================================
        // 2. 馬データのインポート（ループ処理）
        // ========================================
        let horseInsertCount = 0;
        let horseUpdateCount = 0;
        let entryCount = 0;

        for (const horse of jsonData.horses) {
          // ----------------------------------------
          // 2-1. 馬を登録（horses テーブル + 血統マスタ）
          // UPSERT: 馬名+父+母で既存チェック → 存在時UPDATE/不在時INSERT
          // ----------------------------------------
          const { id: horseId, updated } = this.db.insertHorseWithBloodline({
            name: horse.basicInfo.name,                           // 馬名
            birthYear: this.calculateBirthYear(horse.basicInfo.age), // 生年（現在年 - 馬齢）
            sex: horse.basicInfo.sex,                             // 性別（牡, 牝, 騸）
            sire: horse.bloodline.sire,                           // 父馬名 → sires テーブルに自動登録
            mare: horse.bloodline.mare,                           // 母馬名 → mares テーブルに自動登録
            maresSire: horse.bloodline.maresSire,                 // 母父馬名 → sires テーブルに自動登録
            trainer: horse.basicInfo.trainerName,                 // 調教師名 → trainers テーブルに自動登録
            trainerStable: horse.basicInfo.trainerDivision,       // 厩舎（美浦, 栗東）
            owner: horse.basicInfo.ownerName,                     // 馬主名 → owners テーブルに自動登録
            breeder: horse.basicInfo.breederName                  // 生産者名 → breeders テーブルに自動登録
          });
          if (updated) {
            horseUpdateCount++;
          } else {
            horseInsertCount++;
          }

          // ----------------------------------------
          // 2-2. 出馬表エントリの登録（race_entries テーブル）
          // UPSERT: race_id + horse_id で既存チェック（同じ馬は1レースに1回のみ）
          // ----------------------------------------
          this.db.insertRaceEntry(raceId, {
            horseName: horse.basicInfo.name,            // 馬名（horses テーブルとの紐付け用）
            sireName: horse.bloodline.sire,             // 父名（馬の一意特定用）
            mareName: horse.bloodline.mare,             // 母名（馬の一意特定用）
            jockeyName: horse.jockey.name,              // 騎手名 → jockeys テーブルに自動登録
            frameNumber: horse.raceInfo.frameNumber,    // 枠番（1-8）
            horseNumber: horse.raceInfo.horseNumber,    // 馬番（1-18）
            assignedWeight: horse.jockey.weight,        // 斤量（kg）
            winOdds: horse.raceInfo.winOdds,            // 単勝オッズ
            popularity: horse.raceInfo.popularity,      // 人気順位
            careerWins: horse.record.wins,              // 通算勝利数
            careerPlaces: horse.record.places,          // 通算2着数
            careerShows: horse.record.shows,            // 通算3着数
            careerRuns: horse.record.runs,              // 通算出走数
            totalPrizeMoney: horse.record.prizeMoney    // 通算獲得賞金
          });
          entryCount++;

          // ----------------------------------------
          // 2-3. 前走データのインポート
          // 過去レース情報 + 結果 + 馬場適性を登録
          // ----------------------------------------
          this.importPreviousRaces(horse, horseId);
        }

        return { horseInsertCount, horseUpdateCount, entryCount };
      });

      console.log('✅ 抽出JSONからのDBインポート完了');
      console.log(`🐎 馬: 新規${result.horseInsertCount}頭, 更新${result.horseUpdateCount}頭`);
      console.log(`📋 出馬表: ${result.entryCount}件`);

    } catch (error) {
      console.error('❌ 抽出JSONからのインポートに失敗:', error);
    } finally {
      this.db.close();
    }
  }

  private importPreviousRaces(horse: HorseData, horseId: number): void {
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

        // 前走のエントリを登録（血統情報で馬を一意特定）
        const { id: entryId } = this.db.insertRaceEntry(prevRaceId, {
          horseName: horse.basicInfo.name,
          sireName: horse.bloodline.sire,      // 父名（馬の一意特定用）
          mareName: horse.bloodline.mare,      // 母名（馬の一意特定用）
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
}
