import { ArimaDatabase } from '../database/Database';

export interface ScoreComponents {
  recentPerformanceScore: number;
  nakayamaAptitudeScore: number;
  distanceAptitudeScore: number;
  last3FAbilityScore: number;
  g1AchievementScore: number;
  rotationAptitudeScore: number;
}

export interface HorseScore extends ScoreComponents {
  horseId: number;
  horseName: string;
  totalScore: number;
}

export class ScoringModel {
  private readonly db: ArimaDatabase;
  
  // スコア重み設定
  private readonly WEIGHTS = {
    recentPerformance: 0.25,
    nakayamaAptitude: 0.20,
    distanceAptitude: 0.15,
    last3FAbility: 0.15,
    g1Achievement: 0.15,
    rotationAptitude: 0.10
  };

  constructor() {
    this.db = new ArimaDatabase();
  }

  async calculateAllHorseScores(): Promise<HorseScore[]> {
    const horses = this.db.getAllHorses();
    const scores: HorseScore[] = [];

    for (const horse of horses) {
      const components = await this.calculateScoreComponents(horse.id);
      
      const totalScore = 
        (components.recentPerformanceScore * this.WEIGHTS.recentPerformance) +
        (components.nakayamaAptitudeScore * this.WEIGHTS.nakayamaAptitude) +
        (components.distanceAptitudeScore * this.WEIGHTS.distanceAptitude) +
        (components.last3FAbilityScore * this.WEIGHTS.last3FAbility) +
        (components.g1AchievementScore * this.WEIGHTS.g1Achievement) +
        (components.rotationAptitudeScore * this.WEIGHTS.rotationAptitude);

      scores.push({
        horseId: horse.id,
        horseName: horse.name,
        totalScore,
        ...components
      });

      // データベースにスコアを保存
      this.db.updateHorseScore(horse.id, null, {
        recent_performance_score: components.recentPerformanceScore,
        course_aptitude_score: components.nakayamaAptitudeScore,
        distance_aptitude_score: components.distanceAptitudeScore,
        last_3f_ability_score: components.last3FAbilityScore,
        bloodline_score: components.g1AchievementScore,
        rotation_score: components.rotationAptitudeScore
      });
    }

    return scores.sort((a, b) => b.totalScore - a.totalScore);
  }

  private async calculateScoreComponents(horseId: number): Promise<ScoreComponents> {
    return {
      recentPerformanceScore: this.calculateRecentPerformanceScore(horseId),
      nakayamaAptitudeScore: this.calculateNakayamaAptitudeScore(horseId),
      distanceAptitudeScore: this.calculateDistanceAptitudeScore(horseId),
      last3FAbilityScore: this.calculateLast3FAbilityScore(horseId),
      g1AchievementScore: this.calculateG1AchievementScore(horseId),
      rotationAptitudeScore: this.calculateRotationAptitudeScore(horseId)
    };
  }

  private calculateRecentPerformanceScore(horseId: number): number {
    // 直近5戦の成績を重視
    const stmt = this.db['db'].prepare(`
      SELECT finish_position, popularity, odds
      FROM race_results 
      WHERE horse_id = ? 
      ORDER BY race_date DESC 
      LIMIT 5
    `);
    
    const recentRaces = stmt.all(horseId) as any[];
    
    if (recentRaces.length === 0) return 0;

    let score = 0;
    const weights = [0.4, 0.25, 0.2, 0.1, 0.05]; // 新しいレースほど高い重み

    recentRaces.forEach((race, index) => {
      let raceScore = 0;
      
      // 着順による得点
      if (race.finish_position === 1) raceScore += 100;
      else if (race.finish_position === 2) raceScore += 70;
      else if (race.finish_position === 3) raceScore += 50;
      else if (race.finish_position <= 5) raceScore += 30;
      else if (race.finish_position <= 8) raceScore += 10;

      // 人気と着順の乖離による補正
      if (race.popularity && race.finish_position) {
        const popularityDiff = race.popularity - race.finish_position;
        if (popularityDiff > 0) raceScore += Math.min(popularityDiff * 5, 20); // 人気以上の好走
      }

      score += raceScore * weights[index];
    });

    return Math.min(score, 100); // 最大100点
  }

  private calculateNakayamaAptitudeScore(horseId: number): number {
    const stmt = this.db['db'].prepare(`
      SELECT wins, runs FROM course_performance 
      WHERE horse_id = ? AND course_name = '中山'
    `);
    
    const performance = stmt.get(horseId) as any;
    
    if (!performance || performance.runs === 0) return 0;

    const winRate = performance.wins / performance.runs;
    let score = winRate * 100;

    // 実績補正
    if (performance.runs >= 3) score *= 1.0;
    else if (performance.runs === 2) score *= 0.8;
    else score *= 0.6;

    return Math.min(score, 100);
  }

  private calculateDistanceAptitudeScore(horseId: number): number {
    // 2200m以上の長距離での成績
    const stmt = this.db['db'].prepare(`
      SELECT 
        COUNT(CASE WHEN finish_position = 1 THEN 1 END) as wins,
        COUNT(*) as runs
      FROM race_results 
      WHERE horse_id = ? AND distance >= 2200
    `);
    
    const performance = stmt.get(horseId) as any;
    
    if (!performance || performance.runs === 0) return 0;

    const winRate = performance.wins / performance.runs;
    let score = winRate * 100;

    // 実績補正
    if (performance.runs >= 5) score *= 1.0;
    else if (performance.runs >= 3) score *= 0.9;
    else score *= 0.7;

    return Math.min(score, 100);
  }

  private calculateLast3FAbilityScore(horseId: number): number {
    // 上がり3F能力は推定（実際のデータがない場合の代替手法）
    // レース展開での差し・追い込み成功率で代替
    const stmt = this.db['db'].prepare(`
      SELECT 
        AVG(CASE WHEN finish_position <= 3 THEN 1.0 ELSE 0.0 END) as top3_rate,
        COUNT(*) as runs
      FROM race_results 
      WHERE horse_id = ? AND distance >= 2000
    `);
    
    const performance = stmt.get(horseId) as any;
    
    if (!performance || performance.runs === 0) return 50; // デフォルト値

    const score = performance.top3_rate * 100;
    return Math.min(score, 100);
  }

  private calculateG1AchievementScore(horseId: number): number {
    const stmt = this.db['db'].prepare(`
      SELECT 
        COUNT(CASE WHEN finish_position = 1 AND race_name LIKE '%G1%' THEN 1 END) as g1_wins,
        COUNT(CASE WHEN finish_position <= 3 AND race_name LIKE '%G1%' THEN 1 END) as g1_top3,
        COUNT(CASE WHEN race_name LIKE '%G1%' THEN 1 END) as g1_runs
      FROM race_results 
      WHERE horse_id = ?
    `);
    
    const performance = stmt.get(horseId) as any;
    
    if (!performance || performance.g1_runs === 0) return 0;

    let score = 0;
    
    // G1勝利
    score += performance.g1_wins * 50;
    
    // G1で3着以内
    score += (performance.g1_top3 - performance.g1_wins) * 25;
    
    // G1出走実績
    score += Math.min(performance.g1_runs * 5, 20);

    return Math.min(score, 100);
  }

  private calculateRotationAptitudeScore(horseId: number): number {
    // ローテーション適性（出走間隔と成績の関係）
    const stmt = this.db['db'].prepare(`
      SELECT 
        race_date,
        finish_position,
        LAG(race_date) OVER (ORDER BY race_date) as prev_race_date
      FROM race_results 
      WHERE horse_id = ? 
      ORDER BY race_date DESC 
      LIMIT 10
    `);
    
    const races = stmt.all(horseId) as any[];
    
    if (races.length < 2) return 50; // デフォルト値

    let goodPerformances = 0;
    let totalIntervals = 0;

    for (let i = 1; i < races.length; i++) {
      const currentDate = new Date(races[i-1].race_date);
      const prevDate = new Date(races[i].race_date);
      const intervalDays = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // 適切な間隔（3-12週間）での好走率
      if (intervalDays >= 21 && intervalDays <= 84) {
        totalIntervals++;
        if (races[i-1].finish_position <= 3) {
          goodPerformances++;
        }
      }
    }

    if (totalIntervals === 0) return 50;

    const score = (goodPerformances / totalIntervals) * 100;
    return Math.min(score, 100);
  }

  close(): void {
    this.db.close();
  }
}