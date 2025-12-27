import { ArimaDatabase } from '../database/Database';

interface ScoreComponents {
  recentPerformanceScore: number;   // 直近成績
  venueAptitudeScore: number;       // コース適性（レースの開催場）
  distanceAptitudeScore: number;    // 距離適性
  last3FAbilityScore: number;       // 上がり3F能力
  g1AchievementScore: number;       // G1実績
  rotationAptitudeScore: number;    // ローテ適性
}

interface HorseScore extends ScoreComponents {
  horseId: number;
  horseName: string;
  horseNumber?: number;
  totalScore: number;
}

interface RaceInfo {
  id: number;
  name: string;
  venue: string;
  distance: number;
  raceType: string;
  date: string;
}

interface ScoreOptions {
  race?: string;
  list?: boolean;
}

export class ScoreCommand {
  private readonly db: ArimaDatabase;
  private raceInfo: RaceInfo | null = null;

  // スコア重み設定
  private readonly WEIGHTS = {
    recentPerformance: 0.25,    // 直近成績
    venueAptitude: 0.20,        // コース適性
    distanceAptitude: 0.15,     // 距離適性
    last3FAbility: 0.15,        // 上がり3F能力
    g1Achievement: 0.15,        // G1実績
    rotationAptitude: 0.10      // ローテ適性
  };

  constructor() {
    this.db = new ArimaDatabase();
  }

  async execute(options: ScoreOptions = {}): Promise<void> {
    try {
      // レース一覧表示
      if (options.list) {
        this.displayRaceList();
        return;
      }

      // レース指定がない場合
      if (!options.race) {
        console.log('⚠️  レースを指定してください\n');
        console.log('使い方:');
        console.log('  arima score --race <レースID>   # レースIDで指定');
        console.log('  arima score --race 有馬         # レース名で検索');
        console.log('  arima score --list              # レース一覧表示\n');
        this.displayRaceList();
        return;
      }

      // レース検索
      const race = this.db.getRaceByIdOrName(options.race);
      if (!race) {
        console.log(`❌ レース "${options.race}" が見つかりません`);
        console.log('\n📋 登録済みレース一覧:');
        this.displayRaceList();
        return;
      }

      // レース情報を設定
      const venue = this.db.getAllVenues().find(v => v.id === race.venue_id);
      this.raceInfo = {
        id: race.id,
        name: race.race_name,
        venue: venue?.name || '不明',
        distance: race.distance,
        raceType: race.race_type || '芝',
        date: race.race_date
      };

      console.log('🎯 スコアリングモデルで総合評価を算出中...\n');
      console.log(`🏁 対象レース: ${this.raceInfo.name}`);
      console.log(`   ${this.raceInfo.date} ${this.raceInfo.venue} ${this.raceInfo.raceType}${this.raceInfo.distance}m\n`);
      console.log('📊 スコア配分:');
      console.log(`  直近成績: 25% | ${this.raceInfo.venue}適性: 20% | 距離適性: 15%`);
      console.log('  上がり3F: 15% | G1実績: 15% | ローテ: 10%\n');

      // レースに出走する馬を取得
      const entries = this.db.getRaceEntries(race.id);

      if (entries.length === 0) {
        console.log('❌ このレースの出走馬が登録されていません');
        return;
      }

      console.log(`📊 ${entries.length}頭の総合スコアを算出します\n`);

      const horseScores: HorseScore[] = [];

      for (const entry of entries) {
        // 各スコア要素を計算
        const components = this.calculateScoreComponents(entry.horse_id);

        // 重み付け総合スコア
        const totalScore =
          components.recentPerformanceScore * this.WEIGHTS.recentPerformance +
          components.venueAptitudeScore * this.WEIGHTS.venueAptitude +
          components.distanceAptitudeScore * this.WEIGHTS.distanceAptitude +
          components.last3FAbilityScore * this.WEIGHTS.last3FAbility +
          components.g1AchievementScore * this.WEIGHTS.g1Achievement +
          components.rotationAptitudeScore * this.WEIGHTS.rotationAptitude;

        horseScores.push({
          horseId: entry.horse_id,
          horseName: entry.horse_name,
          horseNumber: entry.horse_number,
          totalScore,
          ...components
        });

        // DBに保存
        this.db.updateHorseScore(entry.horse_id, race.id, {
          recent_performance_score: components.recentPerformanceScore,
          course_aptitude_score: components.venueAptitudeScore,
          distance_aptitude_score: components.distanceAptitudeScore,
          last_3f_ability_score: components.last3FAbilityScore,
          bloodline_score: components.g1AchievementScore,
          rotation_score: components.rotationAptitudeScore
        });
      }

      // スコア順にソート
      horseScores.sort((a, b) => b.totalScore - a.totalScore);

      // 総合ランキング表示
      this.displayOverallRanking(horseScores);

      // 詳細分析
      this.displayDetailedAnalysis(horseScores.slice(0, 5));

      // スコア分布
      this.displayScoreDistribution(horseScores);

      console.log(`\n💾 スコアをレースID ${race.id} に保存しました`);

    } catch (error) {
      console.error('❌ スコア算出に失敗:', error);
    } finally {
      this.db.close();
    }
  }

  private displayRaceList(): void {
    const races = this.db.getAllRaces();

    if (races.length === 0) {
      console.log('登録されているレースがありません');
      return;
    }

    console.log('📋 登録済みレース一覧:');
    console.log('='.repeat(70));
    console.log('ID   日付        会場    R    レース名');
    console.log('-'.repeat(70));

    for (const race of races.slice(0, 20)) {
      const id = race.id.toString().padStart(3);
      const date = race.race_date;
      const venue = ((race as any).venue_name || '不明').padEnd(4);
      const raceNum = (race as any).race_number ? `R${(race as any).race_number}`.padEnd(3) : '-- ';
      const name = race.race_name;
      console.log(`${id}  ${date}  ${venue}  ${raceNum}  ${name}`);
    }

    if (races.length > 20) {
      console.log(`... 他 ${races.length - 20} レース`);
    }
  }

  private calculateScoreComponents(horseId: number): ScoreComponents {
    return {
      recentPerformanceScore: this.calculateRecentPerformanceScore(horseId),
      venueAptitudeScore: this.calculateVenueAptitudeScore(horseId),
      distanceAptitudeScore: this.calculateDistanceAptitudeScore(horseId),
      last3FAbilityScore: this.calculateLast3FAbilityScore(horseId),
      g1AchievementScore: this.calculateG1AchievementScore(horseId),
      rotationAptitudeScore: this.calculateRotationAptitudeScore(horseId)
    };
  }

  private calculateRecentPerformanceScore(horseId: number): number {
    const results = this.db.getHorseRaceResults(horseId);
    if (results.length === 0) return 50;

    // 直近5戦の成績を重視（新しいレースほど高い重み）
    const recent5 = results.slice(0, 5);
    const weights = [0.35, 0.25, 0.20, 0.12, 0.08];
    let score = 0;

    recent5.forEach((result, index) => {
      let raceScore = 0;
      const pos = result.finish_position ?? 10;

      // 着順による得点
      if (pos === 1) raceScore = 100;
      else if (pos === 2) raceScore = 80;
      else if (pos === 3) raceScore = 65;
      else if (pos <= 5) raceScore = 45;
      else if (pos <= 8) raceScore = 25;
      else raceScore = 10;

      // 人気と着順の乖離による補正
      if (result.popularity && pos) {
        const diff = result.popularity - pos;
        if (diff > 0) raceScore = Math.min(raceScore + diff * 3, 100);
      }

      score += raceScore * weights[index];
    });

    return Math.min(score, 100);
  }

  private calculateVenueAptitudeScore(horseId: number): number {
    if (!this.raceInfo) return 50;

    const courseStats = this.db.getHorseCourseStats(horseId);
    const venueStats = courseStats.find((s: any) => s.venue_name === this.raceInfo!.venue);

    if (!venueStats || venueStats.runs === 0) return 50; // データなしは中間値

    const winRate = venueStats.wins / venueStats.runs;
    const placeRate = (venueStats.wins + (venueStats.places || 0)) / venueStats.runs;

    let score = winRate * 60 + placeRate * 40;

    // 実績数による信頼度補正
    if (venueStats.runs >= 5) score *= 1.0;
    else if (venueStats.runs >= 3) score *= 0.9;
    else if (venueStats.runs >= 2) score *= 0.8;
    else score *= 0.6;

    return Math.min(score, 100);
  }

  private calculateDistanceAptitudeScore(horseId: number): number {
    if (!this.raceInfo) return 50;

    const results = this.db.getHorseRaceResults(horseId);
    const targetDistance = this.raceInfo.distance;

    // 目標距離±300mの範囲での成績
    const similarDistanceResults = results.filter(r =>
      Math.abs(r.distance - targetDistance) <= 300
    );

    if (similarDistanceResults.length === 0) return 50;

    const validResults = similarDistanceResults.filter(r => r.finish_position != null);
    const wins = validResults.filter(r => r.finish_position === 1).length;
    const places = validResults.filter(r => (r.finish_position ?? 99) <= 3).length;

    if (validResults.length === 0) return 50;

    const winRate = wins / validResults.length;
    const placeRate = places / validResults.length;

    let score = winRate * 60 + placeRate * 40;

    // 同距離実績はボーナス
    const exactDistance = results.filter(r =>
      Math.abs(r.distance - targetDistance) <= 100
    );
    if (exactDistance.length > 0) {
      const exactWins = exactDistance.filter(r => r.finish_position === 1).length;
      score += exactWins * 10;
    }

    return Math.min(score, 100);
  }

  private calculateLast3FAbilityScore(horseId: number): number {
    const results = this.db.getHorseRaceResults(horseId);

    if (results.length === 0) return 50;

    // 上がり3Fのデータがある場合はそれを使用
    const withLast3F = results.filter(r => r.last_3f_time != null);

    if (withLast3F.length > 0) {
      const avgTime = withLast3F.reduce((sum, r) => sum + (r.last_3f_time || 0), 0) / withLast3F.length;
      const score = Math.max(0, (37 - avgTime) / 4 * 100);
      return Math.min(score, 100);
    }

    // 上がり3Fデータがない場合は複勝率で推定
    const validResults = results.filter(r => r.finish_position != null);
    const top3Count = validResults.filter(r => (r.finish_position ?? 99) <= 3).length;
    const top3Rate = validResults.length > 0 ? top3Count / validResults.length : 0;

    return top3Rate * 80 + 20;
  }

  private calculateG1AchievementScore(horseId: number): number {
    const results = this.db.getHorseRaceResults(horseId);

    // G1/GI レースの抽出
    const g1Results = results.filter(r =>
      r.race_class?.includes('G1') ||
      r.race_class?.includes('GI') ||
      r.race_name?.includes('有馬記念') ||
      r.race_name?.includes('ダービー') ||
      r.race_name?.includes('天皇賞') ||
      r.race_name?.includes('ジャパンカップ') ||
      r.race_name?.includes('宝塚記念') ||
      r.race_name?.includes('菊花賞') ||
      r.race_name?.includes('皐月賞') ||
      r.race_name?.includes('オークス')
    );

    if (g1Results.length === 0) return 30;

    let score = 0;

    for (const result of g1Results) {
      const pos = result.finish_position ?? 99;

      if (pos === 1) score += 40;
      else if (pos === 2) score += 25;
      else if (pos === 3) score += 18;
      else if (pos <= 5) score += 10;
      else score += 3;
    }

    return Math.min(score, 100);
  }

  private calculateRotationAptitudeScore(horseId: number): number {
    const results = this.db.getHorseRaceResults(horseId);

    if (results.length < 2) return 50;

    let goodPerformances = 0;
    let totalIntervals = 0;

    for (let i = 0; i < results.length - 1; i++) {
      const currentDate = new Date(results[i].race_date);
      const prevDate = new Date(results[i + 1].race_date);
      const intervalDays = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

      // 適切な間隔（3-10週間 = 21-70日）
      if (intervalDays >= 21 && intervalDays <= 70) {
        totalIntervals++;
        const pos = results[i].finish_position ?? 99;
        if (pos <= 3) goodPerformances++;
      }
    }

    if (totalIntervals === 0) return 50;

    const score = (goodPerformances / totalIntervals) * 100;
    return Math.min(score, 100);
  }

  private displayOverallRanking(scores: HorseScore[]): void {
    const venueName = this.raceInfo?.venue || 'コース';

    console.log('🏆 総合スコアランキング:');
    console.log('='.repeat(80));
    console.log(`馬番 馬名              総合    直近  ${venueName.padEnd(4)} 距離  3F   G1   ローテ`);
    console.log('-'.repeat(80));

    scores.forEach((score, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';

      const num = score.horseNumber?.toString().padStart(2) || '--';
      const name = score.horseName.padEnd(14);
      const total = score.totalScore.toFixed(1).padStart(5);
      const recent = score.recentPerformanceScore.toFixed(0).padStart(4);
      const venue = score.venueAptitudeScore.toFixed(0).padStart(4);
      const distance = score.distanceAptitudeScore.toFixed(0).padStart(4);
      const last3f = score.last3FAbilityScore.toFixed(0).padStart(4);
      const g1 = score.g1AchievementScore.toFixed(0).padStart(4);
      const rotation = score.rotationAptitudeScore.toFixed(0).padStart(4);

      console.log(`${medal}${num} ${name} ${total}  ${recent} ${venue} ${distance} ${last3f} ${g1} ${rotation}`);
    });

    console.log('');
  }

  private displayDetailedAnalysis(topHorses: HorseScore[]): void {
    const venueName = this.raceInfo?.venue || 'コース';

    console.log('📈 上位馬の詳細分析:');
    console.log('='.repeat(60));

    topHorses.forEach((horse, index) => {
      const rank = index + 1;
      const num = horse.horseNumber ? `[${horse.horseNumber}番]` : '';
      console.log(`\n${rank}位: ${horse.horseName} ${num} (総合: ${horse.totalScore.toFixed(1)}点)`);
      console.log('-'.repeat(50));

      const components = [
        { name: '直近成績', score: horse.recentPerformanceScore, weight: 25 },
        { name: `${venueName}適性`, score: horse.venueAptitudeScore, weight: 20 },
        { name: '距離適性', score: horse.distanceAptitudeScore, weight: 15 },
        { name: '上がり3F', score: horse.last3FAbilityScore, weight: 15 },
        { name: 'G1実績  ', score: horse.g1AchievementScore, weight: 15 },
        { name: 'ローテ  ', score: horse.rotationAptitudeScore, weight: 10 }
      ];

      components.forEach(c => {
        const bar = this.createScoreBar(c.score);
        const weighted = (c.score * c.weight / 100).toFixed(1);
        console.log(`  ${c.name.padEnd(8)}: ${c.score.toFixed(0).padStart(3)}点 ${bar} (寄与: ${weighted}点)`);
      });

      const strengths = components.filter(c => c.score >= 70).sort((a, b) => b.score - a.score);
      const weaknesses = components.filter(c => c.score < 40).sort((a, b) => a.score - b.score);

      if (strengths.length > 0) {
        console.log(`  💪 強み: ${strengths.map(s => s.name.trim()).join(', ')}`);
      }
      if (weaknesses.length > 0) {
        console.log(`  ⚠️  課題: ${weaknesses.map(s => s.name.trim()).join(', ')}`);
      }
    });
  }

  private displayScoreDistribution(scores: HorseScore[]): void {
    console.log('\n📊 スコア分布:');
    console.log('='.repeat(50));

    const ranges = [
      { min: 70, max: 100, label: '有力候補 (70点以上)', emoji: '🌟🌟🌟' },
      { min: 55, max: 69.99, label: '注目馬   (55-70点)', emoji: '🌟🌟' },
      { min: 40, max: 54.99, label: '一般馬   (40-55点)', emoji: '🌟' },
      { min: 0, max: 39.99, label: '厳しい   (40点未満)', emoji: '💧' }
    ];

    ranges.forEach(range => {
      const count = scores.filter(s => s.totalScore >= range.min && s.totalScore <= range.max).length;
      const bar = '■'.repeat(count);
      console.log(`${range.emoji} ${range.label}: ${count.toString().padStart(2)}頭 ${bar}`);
    });

    if (this.raceInfo) {
      console.log(`\n💡 ${this.raceInfo.name}（${this.raceInfo.venue}${this.raceInfo.distance}m）向け評価です`);
    }
  }

  private createScoreBar(score: number): string {
    const barLength = 12;
    const filledLength = Math.floor((score / 100) * barLength);
    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(barLength - filledLength);
    return `[${filled}${empty}]`;
  }
}
