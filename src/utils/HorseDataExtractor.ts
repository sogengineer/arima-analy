import { readFileSync } from 'node:fs';
import type {
  HorseData,
  HorseBasicInfo,
  BloodlineInfo,
  JockeyInfo,
  RaceInfo,
  RaceRecord,
  RaceOverview,
  ExtractedRaceData,
  ExtractionOptions,
  ExtractionResult
} from '../types/HorseData';
import { calculateFrameNumber } from '../constants/ScoringConstants';
import { parseRaceHeader, parseCourseType } from './JRAPageParser';
import { normalizeSex, parsePreviousRaces } from './HorseDataFields';
import { formatExtractedRaceData } from './HorseDataFormatter';

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
    const horseMatches = [...this.htmlContent.matchAll(
      /<tr>\s*<td class="waku">(.*?)<\/td>\s*<td class="num">(?:<span[^>]*>.*?<\/span>\s*)?(\d+)?.*?<\/td>\s*<td class="horse">(.*?)<\/td>\s*<td class="jockey">(.*?)<\/td>(.*?)<\/tr>/gs
    )];
    // 枠番の計算に総頭数が必要なため、先に全馬をマッチングしてから処理する
    const totalHorses = horseMatches.length;

    let index = 0;
    for (const match of horseMatches) {
      index++;
      // 馬番が空の場合は出走順（index）を使用
      const horseNumber = match[2] ? Number.parseInt(match[2], 10) : index;
      const wakuData = match[1];
      const horseData = match[3];
      const jockeyData = match[4];
      const pastRacesData = match[5]; // 前走データ部分

      try {
        const basicInfo = this.parseBasicInfo(horseData);
        const bloodline = options.includeBloodline === false ? this.getEmptyBloodline() : this.parseBloodline(horseData);
        const jockey = this.parseJockeyInfo(jockeyData);
        const raceInfo = this.parseRaceInfo_Horse(horseData, wakuData, horseNumber, jockey.weight, totalHorses);
        const record = this.parseRaceRecord(horseData);
        const previousRaces = options.includePreviousRaces === false
          ? []
          : parsePreviousRaces(pastRacesData, options.maxPreviousRaces || 4);

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

    // 血統登録番号（同名馬を区別する唯一のキー）
    const jraHorseId = horseData.match(/accessU\.html\?CNAME=pw01dud\d\d(\d{10})/)?.[1];

    const ownerMatch = horseData.match(/<p class="owner">(.*?)<\/p>/);
    const ownerName = ownerMatch ? ownerMatch[1].trim() : '';

    const breederMatch = horseData.match(/<p class="breeder">(.*?)<\/p>/);
    const breederName = breederMatch ? breederMatch[1].trim() : '';

    const trainerMatch = horseData.match(/<p class="trainer">.*?<a[^>]*>(.*?)<\/a>/);
    const trainerName = trainerMatch ? trainerMatch[1].trim() : '';

    const divisionMatch = horseData.match(/<span class="division">\((.*?)\)<\/span>/);
    const trainerDivision = divisionMatch ? divisionMatch[1].trim() as '美浦' | '栗東' : undefined;

    // 性別・年齢（例: "牡3" "牝4" "セ5"）。class="age" ブロックを優先し、
    // 見つからない場合は馬データ全体から検索。取得できなければ従来のデフォルト値
    const ageBlockMatch = horseData.match(/<p class="age">(.*?)<\/p>/);
    const ageSexMatch = (ageBlockMatch ? ageBlockMatch[1] : horseData).match(/(牡|牝|セン|セ|騸)\s*(\d{1,2})/);
    const sex = normalizeSex(ageSexMatch?.[1]);
    const age = ageSexMatch ? Number.parseInt(ageSexMatch[2], 10) : 2;

    return {
      name,
      jraHorseId,
      age,
      sex,
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

  private parseRaceInfo_Horse(
    horseData: string,
    wakuData: string,
    horseNumber: number,
    assignedWeight: number,
    totalHorses: number
  ): RaceInfo {
    // オッズ・人気は取得できなければ undefined。
    // 0 を返すと「1番人気（popularityNorm=0）」や「オッズ0倍」として扱われ、
    // 欠損が特徴量に紛れ込む（欠損は NULL として DB に入れる）。
    const oddsMatch = horseData.match(/<span class="num"><strong.*?>([\d.]+)<\/strong>/);
    const parsedOdds = oddsMatch ? Number.parseFloat(oddsMatch[1]) : Number.NaN;
    const winOdds = Number.isFinite(parsedOdds) && parsedOdds > 0 ? parsedOdds : undefined;

    const popularityMatch = horseData.match(/\((\d+)<span>番人気<\/span>\)/);
    const parsedPopularity = popularityMatch
      ? Number.parseInt(popularityMatch[1], 10)
      : Number.NaN;
    const popularity =
      Number.isFinite(parsedPopularity) && parsedPopularity >= 1 ? parsedPopularity : undefined;

    // 馬体重: <div class="cell weight">526kg<span class="transition">(+6)</span></div>
    const horseWeightMatch = horseData.match(
      /<div class="cell weight">\s*(\d+)kg(?:<span class="transition">\(([+-]?\d+)\)<\/span>)?/
    );
    const horseWeight = horseWeightMatch ? Number.parseInt(horseWeightMatch[1], 10) : undefined;
    const weightChange =
      horseWeightMatch?.[2] == null ? undefined : Number.parseInt(horseWeightMatch[2], 10);

    // 枠番は枠色画像（/JRADB/img/waku/4.png）が正。無い場合のみ馬番から算出する
    const wakuFromImage = wakuData.match(/\/img\/waku\/(\d+)\.png/);

    return {
      frameNumber: wakuFromImage
        ? Number.parseInt(wakuFromImage[1], 10)
        : HorseDataExtractor.calculateFrameNumber(horseNumber, totalHorses),
      horseNumber,
      assignedWeight,
      winOdds,
      popularity,
      horseWeight,
      weightChange
    };
  }

  /**
   * JRAの枠番割当規則に基づいて馬番から枠番を計算
   *
   * @remarks
   * 8枠制。8頭以下は馬番＝枠番。9頭以上は各枠に ⌊総頭数/8⌋ 頭を基本とし、
   * 余り（総頭数 mod 8）の頭数ぶんだけ大きい枠番の枠から順に1頭ずつ多く割り当てる。
   * 例: 14頭は1〜2枠が1頭・3〜8枠が2頭、17頭は8枠のみ3頭、18頭は7・8枠が3頭。
   */
  static calculateFrameNumber(horseNumber: number, totalHorses: number): number {
    return calculateFrameNumber(horseNumber, totalHorses);
  }

  /**
   * 通算成績 `(1着.2着.3着.着外)` を解析する
   *
   * @remarks
   * JRAの成績表記は **(1着.2着.3着.着外)** の4項目。
   * 4項目めは「着外回数」であって出走数ではないため、
   * `runs`（出走数）は4項目の合計にする。
   * これで `race_entries.career_*`
   * （runs=出走数 / wins=1着 / places=2着 / shows=3着）と意味が一致する。
   */
  private parseRaceRecord(horseData: string): RaceRecord {
    const recordMatch = horseData.match(/<div class="cell result">\((.*?)\)<\/div>/);
    if (!recordMatch) {
      return { wins: 0, places: 0, shows: 0, runs: 0 };
    }

    const record = recordMatch[1].split('.');
    const toCount = (value: string | undefined): number => {
      const n = Number.parseInt(value ?? '0', 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const wins = toCount(record[0]);
    const places = toCount(record[1]);
    const shows = toCount(record[2]);
    const unplaced = toCount(record[3]);
    const runs = wins + places + shows + unplaced;

    const prizeMatch = horseData.match(/<div class="cell win"[^>]*>(.*?)<\/div>/);
    const prizeMoney = prizeMatch ? prizeMatch[1].replace(/title="[^"]*"/, '').trim() : undefined;

    return { wins, places, shows, runs, prizeMoney };
  }

  /**
   * レース概要（日付・会場・レース番号・距離・芝ダ・馬場状態・クラス）を抽出する
   *
   * @remarks
   * 旧実装は距離1200m・ダート・良をハードコードしており、
   * 有馬記念（芝2500m）を含むどのレースを取り込んでも条件が壊れていた。
   * 現在はJRA出馬表・レース結果の共通ヘッダ（`race_header`）から実値を読む。
   * 会場を「中山」に固定していたフォールバックも撤去し、一般レースに対応する。
   */
  private parseRaceInfo(): RaceOverview {
    const header = parseRaceHeader(this.htmlContent);

    if (header) {
      return {
        date: header.date,
        venue: header.venue,
        raceNumber: header.raceNumber,
        raceName: header.raceName,
        distance: header.distance,
        // 出馬表（発走前）には馬場状態が載らないため、取れない場合は空文字にする。
        // ここで '良' を埋めると馬場適性スコアが事実と無関係に動く。
        trackCondition: header.trackCondition ?? '',
        courseType: header.courseType,
        startTime: header.startTime,
        raceClass: header.grade ?? header.raceClass
      };
    }

    // ヘッダが読めないHTML（旧レイアウト・部分保存など）向けの縮退動作
    return this.parseRaceInfoFallback();
  }

  /**
   * 共通ヘッダが見つからない場合の縮退抽出
   *
   * @remarks
   * 取得できなかった項目は**推測値で埋めない**。距離0・馬場状態空で返し、
   * 呼び出し側（警告表示・インポート）が欠損として扱えるようにする。
   */
  private parseRaceInfoFallback(): RaceOverview {
    const title = this.htmlContent.match(/<title>(.*?)<\/title>/)?.[1]?.trim() ?? '';

    // 「2025年12月28日（日曜）5回中山8日 1レース」形式
    const match = this.htmlContent.match(
      /(\d{4})年(\d{1,2})月(\d{1,2})日（[^）]+）\d+回([^\d]+)\d+日\s*(\d+)レース/
    );

    const distanceMatch = this.htmlContent.match(/([\d,]+)\s*(?:メートル|m)\s*[（(]\s*(芝|ダート|ダ|障害)/);
    const distance = distanceMatch ? Number(distanceMatch[1].replace(/,/g, '')) : 0;
    const courseType = distanceMatch ? parseCourseType(distanceMatch[2]) : '芝';

    if (match) {
      const [, year, month, day, venue, raceNum] = match;
      return {
        date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
        venue: venue.trim(),
        raceNumber: Number.parseInt(raceNum, 10),
        raceName: title,
        distance,
        trackCondition: '',
        courseType
      };
    }

    return {
      date: this.extractDateFromUrl(),
      venue: '',
      raceNumber: 0,
      raceName: title,
      distance,
      trackCondition: '',
      courseType
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
    // 欠損（undefined）は末尾に送る
    const key = (v: number | undefined): number => (v == null ? Number.POSITIVE_INFINITY : v);
    switch (sortBy) {
      case 'popularity':
        return horses.sort((a, b) => key(a.raceInfo.popularity) - key(b.raceInfo.popularity));
      case 'horseNumber':
        return horses.sort((a, b) => a.raceInfo.horseNumber - b.raceInfo.horseNumber);
      case 'odds':
        return horses.sort((a, b) => key(a.raceInfo.winOdds) - key(b.raceInfo.winOdds));
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
      if (horse.raceInfo.winOdds == null) {
        warnings.push(`${horse.basicInfo.name}: オッズが取得できませんでした`);
      }
    });

    return warnings;
  }

  private getEmptyBloodline(): BloodlineInfo {
    return { sire: '', mare: '', maresSire: undefined };
  }

  formatOutput(data: ExtractedRaceData, format: 'detailed' | 'summary' | 'csv' = 'detailed'): string {
    return formatExtractedRaceData(data, format);
  }
}
