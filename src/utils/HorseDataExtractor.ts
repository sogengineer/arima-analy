import { readFileSync } from 'node:fs';
import {
  HorseData,
  HorseBasicInfo,
  BloodlineInfo,
  JockeyInfo,
  RaceInfo,
  RaceRecord,
  PreviousRaceResult,
  RaceOverview,
  ExtractedRaceData,
  ExtractionOptions,
  ExtractionResult
} from '../types/HorseData.js';

export class HorseDataExtractor {
  private htmlContent: string;
  private sourceUrl: string;

  constructor(htmlContent: string, sourceUrl: string = '') {
    this.htmlContent = htmlContent;
    this.sourceUrl = sourceUrl;
  }

  static fromFile(filePath: string, sourceUrl: string = ''): HorseDataExtractor {
    const htmlContent = readFileSync(filePath, 'utf-8');
    return new HorseDataExtractor(htmlContent, sourceUrl);
  }

  extractAll(options: ExtractionOptions = {}): ExtractionResult {
    try {
      const horses = this.parseHorseData(options);
      const raceInfo = this.parseRaceInfo();

      const data: ExtractedRaceData = {
        url: this.extractSourceUrl(),
        extractedAt: new Date().toISOString(),
        raceInfo,
        horseCount: horses.length,
        horses: this.sortHorses(horses, options.sortBy || 'popularity')
      };

      return {
        success: true,
        data,
        warnings: this.generateWarnings(horses)
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private parseHorseData(options: ExtractionOptions): HorseData[] {
    const horses: HorseData[] = [];

    // 馬データのマッチング（マルチライン対応、前走データまで含める）
    // 馬番が空の場合（枠順未確定）にも対応: (\d+)? で馬番をオプションに
    const horseMatches = this.htmlContent.matchAll(
      /<tr>\s*<td class="waku">.*?<td class="num">(?:<span[^>]*>.*?<\/span>\s*)?(\d+)?.*?<\/td>\s*<td class="horse">(.*?)<\/td>\s*<td class="jockey">(.*?)<\/td>(.*?)<\/tr>/gs
    );

    let index = 0;
    for (const match of horseMatches) {
      index++;
      // 馬番が空の場合は出走順（index）を使用
      const horseNumber = match[1] ? Number.parseInt(match[1]) : index;
      const horseData = match[2];
      const jockeyData = match[3];
      const pastRacesData = match[4]; // 前走データ部分

      try {
        const basicInfo = this.parseBasicInfo(horseData);
        const bloodline = options.includeBloodline !== false ? this.parseBloodline(horseData) : this.getEmptyBloodline();
        const jockey = this.parseJockeyInfo(jockeyData);
        const raceInfo = this.parseRaceInfo_Horse(horseData, horseNumber);
        const record = this.parseRaceRecord(horseData);
        const previousRaces = options.includePreviousRaces !== false ?
          this.parsePreviousRaces(pastRacesData, options.maxPreviousRaces || 4) : [];

        horses.push({
          basicInfo,
          bloodline,
          jockey,
          raceInfo,
          record,
          previousRaces
        });
      } catch (error) {
        console.warn(`馬番${horseNumber}のデータ解析中にエラー:`, error);
      }
    }

    return horses;
  }

  private parseBasicInfo(horseData: string): HorseBasicInfo {
    const nameMatch = horseData.match(/<div class="name">.*?<a.*?>(.*?)<\/a><\/div>/);
    const name = nameMatch ? nameMatch[1].trim() : '';

    const ownerMatch = horseData.match(/<p class="owner">(.*?)<\/p>/);
    const ownerName = ownerMatch ? ownerMatch[1].trim() : '';

    const breederMatch = horseData.match(/<p class="breeder">(.*?)<\/p>/);
    const breederName = breederMatch ? breederMatch[1].trim() : '';

    const trainerMatch = horseData.match(/<p class="trainer">.*?<a[^>]*>(.*?)<\/a>/);
    const trainerName = trainerMatch ? trainerMatch[1].trim() : '';

    const divisionMatch = horseData.match(/<span class="division">\((.*?)\)<\/span>/);
    const trainerDivision = divisionMatch ? divisionMatch[1].trim() as '美浦' | '栗東' : undefined;

    return {
      name,
      age: 2, // JRAの2歳戦と仮定
      sex: '牡', // デフォルト値、実際にはHTMLから解析
      color: '',
      ownerName,
      breederName,
      trainerName,
      trainerDivision
    };
  }

  private parseBloodline(horseData: string): BloodlineInfo {
    const sireMatch = horseData.match(/<li class="sire"><span>父：<\/span>(.*?)<\/li>/);
    const sire = sireMatch ? sireMatch[1].trim() : '';

    const mareMatch = horseData.match(/<li class="mare"><span>母：<\/span>(.*?)<span/);
    const mare = mareMatch ? mareMatch[1].trim() : '';

    const maresSireMatch = horseData.match(/\(母の父：(.*?)\)/);
    const maresSire = maresSireMatch ? maresSireMatch[1].trim() : undefined;

    return { sire, mare, maresSire };
  }

  private parseJockeyInfo(jockeyData: string): JockeyInfo {
    const jockeyMatch = jockeyData.match(/<p class="jockey">.*?<a[^>]*>(.*?)<\/a><\/p>/);
    const name = jockeyMatch ? jockeyMatch[1].trim() : '';

    const weightMatch = jockeyData.match(/<p class="weight">\s*([\d.]+)<span>kg<\/span>/);
    const weight = weightMatch ? Number.parseFloat(weightMatch[1]) : 0;

    return { name, weight };
  }

  private parseRaceInfo_Horse(horseData: string, horseNumber: number): RaceInfo {
    const oddsMatch = horseData.match(/<span class="num"><strong.*?>([\d.]+)<\/strong>/);
    const winOdds = oddsMatch ? Number.parseFloat(oddsMatch[1]) : 0;

    const popularityMatch = horseData.match(/\((\d+)<span>番人気<\/span>\)/);
    const popularity = popularityMatch ? Number.parseInt(popularityMatch[1]) : 0;

    return {
      frameNumber: Math.ceil(horseNumber / 2), // 簡易計算
      horseNumber,
      assignedWeight: 0, // jockeyDataから取得
      winOdds,
      popularity
    };
  }

  private parseRaceRecord(horseData: string): RaceRecord {
    const recordMatch = horseData.match(/<div class="cell result">\((.*?)\)<\/div>/);
    if (!recordMatch) {
      return { wins: 0, places: 0, shows: 0, runs: 0 };
    }

    const record = recordMatch[1].split('.');
    const wins = Number.parseInt(record[0] || '0');
    const places = Number.parseInt(record[1] || '0');
    const shows = Number.parseInt(record[2] || '0');
    const runs = Number.parseInt(record[3] || '0');

    const prizeMatch = horseData.match(/<div class="cell win"[^>]*>(.*?)<\/div>/);
    const prizeMoney = prizeMatch ? prizeMatch[1].replace(/title="[^"]*"/, '').trim() : undefined;

    return { wins, places, shows, runs, prizeMoney };
  }

  private parsePreviousRaces(pastRacesHtml: string, maxRaces: number): PreviousRaceResult[] {
    const races: PreviousRaceResult[] = [];
    const positions: PreviousRaceResult['position'][] = ['front', 'second', 'third', 'fourth'];

    // 前走データの抽出（p1=前走, p2=前々走, p3=3走前, p4=4走前）
    const pastMatches = pastRacesHtml.matchAll(/<td class="past p(\d+)[^"]*"[^>]*>([\s\S]*?)<\/td>/g);

    for (const match of pastMatches) {
      const raceIndex = Number.parseInt(match[1]) - 1;
      if (raceIndex >= maxRaces) continue;

      const pastData = match[2];
      if (!pastData.trim()) continue;

      // 各種データの抽出
      const dateMatch = pastData.match(/<div class="date">(.*?)<\/div>/);
      const trackMatch = pastData.match(/<div class="rc">(.*?)<\/div>/);
      const raceNameMatch = pastData.match(/<div class="name">.*?<a[^>]*>(.*?)<\/a>/s);
      const placeMatch = pastData.match(/<div class="place">(\d+)<span>/);
      const totalHorsesMatch = pastData.match(/<span class="max">(\d+)<span>頭<\/span>/);
      const gateMatch = pastData.match(/<span class="gate">(\d+)<span>番<\/span>/);
      const popMatch = pastData.match(/<span class="pop">(\d+)<span>番人気<\/span>/);
      const jockeyRawMatch = pastData.match(/<div class="jockey">(.*?)<\/div>/);
      // HTMLタグを除去して騎手名のみ抽出
      const jockeyMatch = jockeyRawMatch ? [jockeyRawMatch[0], jockeyRawMatch[1].replace(/<[^>]+>/g, '')] : null;
      const weightMatch = pastData.match(/<div class="weight">\s*([\d.]+)<span>kg<\/span>/);
      const distMatch = pastData.match(/<span class="dist">(.*?)<\/span>/);
      const conditionMatch = pastData.match(/<span class="condition">(.*?)<\/span>/);
      const timeMatch = pastData.match(/<p class="time">(.*?)<\/p>/);
      const horseWeightMatch = pastData.match(/<p class="h_weight">(\d+)<span>kg<\/span>/);
      const winnerMatch = pastData.match(/<p class="fin">(.*?)<span/);

      if (dateMatch) {
        races.push({
          position: positions[raceIndex] || 'fourth',
          date: dateMatch[1].trim(),
          track: trackMatch ? trackMatch[1].trim() : '',
          raceName: raceNameMatch ? raceNameMatch[1].trim() : '',
          place: placeMatch ? placeMatch[1] : '',
          totalHorses: totalHorsesMatch ? Number.parseInt(totalHorsesMatch[1]) : 0,
          gateNumber: gateMatch ? Number.parseInt(gateMatch[1]) : 0,
          popularity: popMatch ? Number.parseInt(popMatch[1]) : 0,
          jockey: jockeyMatch ? jockeyMatch[1].trim() : '',
          weight: weightMatch ? Number.parseFloat(weightMatch[1]) : 0,
          distance: distMatch ? distMatch[1].trim() : '',
          trackCondition: conditionMatch ? conditionMatch[1].trim() : '',
          time: timeMatch ? timeMatch[1].trim() : undefined,
          horseWeight: horseWeightMatch ? Number.parseInt(horseWeightMatch[1]) : undefined,
          winner: winnerMatch ? winnerMatch[1].trim() : undefined
        });
      }
    }

    // position順にソート
    return races.sort((a, b) => positions.indexOf(a.position) - positions.indexOf(b.position));
  }

  private parseRaceInfo(): RaceOverview {
    // レース情報の基本解析
    const titleMatch = this.htmlContent.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // HTMLから「2025年12月28日（日曜）5回中山8日 1レース」形式を抽出
    const raceHeaderInfo = this.extractRaceHeaderInfo();

    return {
      date: raceHeaderInfo.date,
      venue: raceHeaderInfo.venue,
      raceNumber: raceHeaderInfo.raceNumber,
      raceName: title,
      distance: 1200,
      trackCondition: '良',
      courseType: 'ダート'
    };
  }

  private extractRaceHeaderInfo(): { date: string; venue: string; raceNumber: number } {
    // パターン: 2025年12月28日（日曜）5回中山8日 1レース
    const match = this.htmlContent.match(/(\d{4})年(\d{1,2})月(\d{1,2})日（[^）]+）\d+回([^\d]+)\d+日\s*(\d+)レース/);

    if (match) {
      const [, year, month, day, venue, raceNum] = match;
      return {
        date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
        venue: venue.trim(),
        raceNumber: Number.parseInt(raceNum)
      };
    }

    // フォールバック: URLから日付のみ抽出
    return {
      date: this.extractDateFromUrl(),
      venue: '中山',
      raceNumber: 1
    };
  }

  private extractDateFromUrl(): string {
    // URLパターン: ...20251228/37 から日付を抽出
    const dateMatch = this.sourceUrl.match(/(\d{4})(\d{2})(\d{2})\/\d+$/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      return `${year}-${month}-${day}`;
    }
    // フォールバック: 現在日付
    return new Date().toISOString().split('T')[0];
  }

  private extractSourceUrl(): string {
    return this.sourceUrl;
  }

  private sortHorses(horses: HorseData[], sortBy: string): HorseData[] {
    switch (sortBy) {
      case 'popularity':
        return horses.sort((a, b) => a.raceInfo.popularity - b.raceInfo.popularity);
      case 'horseNumber':
        return horses.sort((a, b) => a.raceInfo.horseNumber - b.raceInfo.horseNumber);
      case 'odds':
        return horses.sort((a, b) => a.raceInfo.winOdds - b.raceInfo.winOdds);
      default:
        return horses;
    }
  }

  private generateWarnings(horses: HorseData[]): string[] {
    const warnings: string[] = [];
    
    horses.forEach(horse => {
      if (!horse.basicInfo.name) {
        warnings.push(`馬番${horse.raceInfo.horseNumber}: 馬名が取得できませんでした`);
      }
      if (horse.raceInfo.winOdds === 0) {
        warnings.push(`${horse.basicInfo.name}: オッズが取得できませんでした`);
      }
    });

    return warnings;
  }

  private getEmptyBloodline(): BloodlineInfo {
    return { sire: '', mare: '', maresSire: undefined };
  }

  formatOutput(data: ExtractedRaceData, format: 'detailed' | 'summary' | 'csv' = 'detailed'): string {
    switch (format) {
      case 'summary':
        return this.formatSummary(data);
      case 'csv':
        return this.formatCSV(data);
      default:
        return this.formatDetailed(data);
    }
  }

  private formatDetailed(data: ExtractedRaceData): string {
    let output = `\n=== JRA競走馬詳細データ ===\n`;
    output += `抽出件数: ${data.horseCount}頭\n`;
    output += `レース: ${data.raceInfo.raceName}\n`;
    output += `開催日: ${data.raceInfo.date}\n\n`;

    data.horses.forEach(horse => {
      output += `${horse.raceInfo.popularity}番人気: ${horse.basicInfo.name} (${horse.raceInfo.winOdds}倍)\n`;
      output += `  馬番: ${horse.raceInfo.horseNumber}番\n`;
      output += `  戦績: ${horse.record.wins}.${horse.record.places}.${horse.record.shows}.${horse.record.runs}\n`;
      output += `  総賞金: ${horse.record.prizeMoney || 'なし'}\n`;
      output += `  負担重量: ${horse.jockey.weight}kg\n`;
      output += `  騎手: ${horse.jockey.name || 'なし'}\n`;
      output += `  馬主: ${horse.basicInfo.ownerName || 'なし'}\n`;
      output += `  生産者: ${horse.basicInfo.breederName || 'なし'}\n`;
      output += `  調教師: ${horse.basicInfo.trainerName || 'なし'}\n`;
      output += `  血統: ${horse.bloodline.sire || 'なし'} × ${horse.bloodline.mare || 'なし'}\n`;
      
      if (horse.previousRaces.length > 0) {
        output += `  過去成績:\n`;
        horse.previousRaces.forEach((race, index) => {
          const raceType = ['前走', '前々走', '3走前', '4走前'][index];
          output += `    ${raceType}: ${race.date} ${race.raceName}\n`;
        });
      }
      output += '\n';
    });

    return output;
  }

  private formatSummary(data: ExtractedRaceData): string {
    return data.horses.map(horse => 
      `${horse.raceInfo.popularity}番人気: ${horse.basicInfo.name} (${horse.raceInfo.winOdds}倍)`
    ).join('\n');
  }

  private formatCSV(data: ExtractedRaceData): string {
    const headers = ['人気,馬名,馬番,オッズ,騎手,調教師,馬主,戦績'];
    const rows = data.horses.map(horse => 
      `${horse.raceInfo.popularity},${horse.basicInfo.name},${horse.raceInfo.horseNumber},${horse.raceInfo.winOdds},${horse.jockey.name},${horse.basicInfo.trainerName},${horse.basicInfo.ownerName},"${horse.record.wins}.${horse.record.places}.${horse.record.shows}.${horse.record.runs}"`
    );
    
    return [headers, ...rows].join('\n');
  }
}