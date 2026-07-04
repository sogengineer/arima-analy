import { DatabaseConnection } from '../database/DatabaseConnection';
import { ScoringOrchestrator } from '../domain/services/ScoringOrchestrator';
import { ScoreAggregateRepository } from '../repositories/aggregates/ScoreAggregateRepository';
import { SCORE_WEIGHTS } from '../constants/ScoringConstants';

interface HorseScore {
  horseId: number;
  horseName: string;
  horseNumber?: number;
  totalScore: number;
  recentPerformanceScore: number;
  venueAptitudeScore: number;
  distanceAptitudeScore: number;
  last3FAbilityScore: number;
  g1AchievementScore: number;
  rotationAptitudeScore: number;
  jockeyScore: number;
  trackConditionScore: number;
  postPositionScore: number;
  trainerScore: number;
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

export class CalculateScore {
  private readonly connection: DatabaseConnection;
  private readonly orchestrator: ScoringOrchestrator;
  private readonly scoreRepo: ScoreAggregateRepository;
  private raceInfo: RaceInfo | null = null;

  constructor() {
    this.connection = new DatabaseConnection();
    const db = this.connection.getConnection();
    this.orchestrator = new ScoringOrchestrator(db);
    this.scoreRepo = new ScoreAggregateRepository(db);
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
      const race = this.orchestrator.getRaceByIdOrName(options.race);
      if (!race) {
        console.log(`❌ レース "${options.race}" が見つかりません`);
        console.log('\n📋 登録済みレース一覧:');
        this.displayRaceList();
        return;
      }

      // レース情報を設定
      this.raceInfo = {
        id: race.id,
        name: race.race_name,
        venue: race.venue_name,
        distance: race.distance,
        raceType: race.race_type || '芝',
        date: race.race_date
      };

      console.log('🎯 スコアリングモデルで総合評価を算出中...\n');
      console.log(`🏁 対象レース: ${this.raceInfo.name}`);
      console.log(`   ${this.raceInfo.date} ${this.raceInfo.venue} ${this.raceInfo.raceType}${this.raceInfo.distance}m\n`);
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      console.log('📊 スコア配分（10要素）:');
      console.log(`  直近成績: ${pct(SCORE_WEIGHTS.recentPerformance)} | ${this.raceInfo.venue}適性: ${pct(SCORE_WEIGHTS.venueAptitude)} | 距離適性: ${pct(SCORE_WEIGHTS.distanceAptitude)} | 上がり3F: ${pct(SCORE_WEIGHTS.last3FAbility)} | G1実績: ${pct(SCORE_WEIGHTS.g1Achievement)}`);
      console.log(`  ローテ: ${pct(SCORE_WEIGHTS.rotationAptitude)} | 騎手能力: ${pct(SCORE_WEIGHTS.jockey)} | 馬場適性: ${pct(SCORE_WEIGHTS.trackCondition)} | 枠順: ${pct(SCORE_WEIGHTS.postPosition)} | 調教師: ${pct(SCORE_WEIGHTS.trainer)}\n`);

      // ScoringOrchestrator でスコア計算
      const scoreResults = this.orchestrator.calculateScoresForRace(race.id);

      if (scoreResults.length === 0) {
        console.log('❌ このレースの出走馬が登録されていません');
        return;
      }

      console.log(`📊 ${scoreResults.length}頭の総合スコアを算出します\n`);

      const horseScores: HorseScore[] = [];

      for (const result of scoreResults) {
        const components = result.scores.toPlainObject();

        horseScores.push({
          horseId: result.horseId,
          horseName: result.horseName,
          horseNumber: result.horseNumber,
          totalScore: components.totalScore,
          recentPerformanceScore: components.recentPerformanceScore,
          venueAptitudeScore: components.venueAptitudeScore,
          distanceAptitudeScore: components.distanceAptitudeScore,
          last3FAbilityScore: components.last3FAbilityScore,
          g1AchievementScore: components.g1AchievementScore,
          rotationAptitudeScore: components.rotationAptitudeScore,
          jockeyScore: components.jockeyScore,
          trackConditionScore: components.trackConditionScore,
          postPositionScore: components.postPositionScore,
          trainerScore: components.trainerScore
        });

        // DBに保存（10要素構成 + total_score）
        this.scoreRepo.updateHorseScore(result.horseId, race.id, {
          recent_performance_score: components.recentPerformanceScore,
          course_aptitude_score: components.venueAptitudeScore,
          distance_aptitude_score: components.distanceAptitudeScore,
          last_3f_ability_score: components.last3FAbilityScore,
          g1_achievement_score: components.g1AchievementScore,
          rotation_score: components.rotationAptitudeScore,
          track_condition_score: components.trackConditionScore,
          jockey_score: components.jockeyScore,
          trainer_score: components.trainerScore,
          post_position_score: components.postPositionScore,
          total_score: components.totalScore
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
      this.connection.close();
    }
  }

  private displayRaceList(): void {
    const races = this.orchestrator.getAllRaces();

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

  private displayOverallRanking(scores: HorseScore[]): void {
    const venueName = this.raceInfo?.venue || 'コース';

    console.log('🏆 総合スコアランキング:');
    console.log('='.repeat(90));
    console.log(`馬番 馬名              総合    直近  ${venueName.padEnd(4)} 距離  3F   G1   ローテ 騎手`);
    console.log('-'.repeat(90));

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
      const jockey = score.jockeyScore.toFixed(0).padStart(4);

      console.log(`${medal}${num} ${name} ${total}  ${recent} ${venue} ${distance} ${last3f} ${g1} ${rotation} ${jockey}`);
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
        { name: '直近成績', score: horse.recentPerformanceScore, weight: SCORE_WEIGHTS.recentPerformance * 100 },
        { name: `${venueName}適性`, score: horse.venueAptitudeScore, weight: SCORE_WEIGHTS.venueAptitude * 100 },
        { name: '騎手能力', score: horse.jockeyScore, weight: SCORE_WEIGHTS.jockey * 100 },
        { name: 'G1実績  ', score: horse.g1AchievementScore, weight: SCORE_WEIGHTS.g1Achievement * 100 },
        { name: '距離適性', score: horse.distanceAptitudeScore, weight: SCORE_WEIGHTS.distanceAptitude * 100 },
        { name: '上がり3F', score: horse.last3FAbilityScore, weight: SCORE_WEIGHTS.last3FAbility * 100 },
        { name: 'ローテ  ', score: horse.rotationAptitudeScore, weight: SCORE_WEIGHTS.rotationAptitude * 100 },
        { name: '馬場適性', score: horse.trackConditionScore, weight: SCORE_WEIGHTS.trackCondition * 100 },
        { name: '枠順効果', score: horse.postPositionScore, weight: SCORE_WEIGHTS.postPosition * 100 },
        { name: '調教師  ', score: horse.trainerScore, weight: SCORE_WEIGHTS.trainer * 100 }
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
