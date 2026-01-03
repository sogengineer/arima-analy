import { ArimaDatabase } from '../database/Database';

interface PredictionResult {
  horseName: string;
  winProbability: number;
  placeProbability: number;
  showProbability: number;
}

export class Predict {
  private readonly db: ArimaDatabase;

  constructor() {
    this.db = new ArimaDatabase();
  }

  async execute(): Promise<void> {
    try {
      console.log('🤖 統計ベースで連帯・3着内確率を予測中...');

      const horses = this.db.getAllHorsesWithBloodline();

      if (horses.length === 0) {
        console.log('予測対象の馬がいません');
        console.log('\n📥 データ入力方法:');
        console.log('arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`📊 ${horses.length}頭の予測結果\n`);

      const predictions: PredictionResult[] = [];

      for (const horse of horses) {
        if (!horse.id) continue;

        const result = this.calculateProbabilities(horse.id, horse.name);
        predictions.push(result);
      }

      // 勝率順にソート
      predictions.sort((a, b) => b.winProbability - a.winProbability);

      // 予測結果表示
      this.displayPredictions(predictions);

      // 投資戦略提案
      this.suggestBettingStrategy(predictions);

    } catch (error) {
      console.error('❌ 予測に失敗:', error);
    } finally {
      this.db.close();
    }
  }

  private calculateProbabilities(horseId: number, horseName: string): PredictionResult {
    const results = this.db.getHorseRaceResults(horseId);

    if (results.length === 0) {
      return {
        horseName,
        winProbability: 0.05,
        placeProbability: 0.1,
        showProbability: 0.15
      };
    }

    const totalRaces = results.length;
    const validResults = results.filter(r => r.finish_position != null);

    const wins = validResults.filter(r => r.finish_position === 1).length;
    const places = validResults.filter(r => (r.finish_position ?? 99) <= 2).length;
    const shows = validResults.filter(r => (r.finish_position ?? 99) <= 3).length;

    // 基本確率（実績ベース）
    let winProb = validResults.length > 0 ? wins / validResults.length : 0.05;
    let placeProb = validResults.length > 0 ? places / validResults.length : 0.1;
    let showProb = validResults.length > 0 ? shows / validResults.length : 0.15;

    // 実績が少ない場合は控えめに調整
    if (validResults.length < 5) {
      winProb = winProb * 0.7 + 0.05 * 0.3;
      placeProb = placeProb * 0.7 + 0.1 * 0.3;
      showProb = showProb * 0.7 + 0.15 * 0.3;
    }

    return {
      horseName,
      winProbability: Math.min(winProb, 0.5),
      placeProbability: Math.min(placeProb, 0.7),
      showProbability: Math.min(showProb, 0.85)
    };
  }

  private displayPredictions(predictions: PredictionResult[]): void {
    console.log('🎯 統計ベース予測結果:');
    console.log('='.repeat(80));
    console.log('順位  馬名           勝率    連対率   3着内率');
    console.log('-'.repeat(80));

    predictions.forEach((pred, index) => {
      const rank = (index + 1).toString().padStart(2);
      const name = pred.horseName.padEnd(12);
      const winProb = (pred.winProbability * 100).toFixed(1).padStart(5) + '%';
      const placeProb = (pred.placeProbability * 100).toFixed(1).padStart(6) + '%';
      const showProb = (pred.showProbability * 100).toFixed(1).padStart(7) + '%';

      console.log(`${rank}位 ${name} ${winProb} ${placeProb} ${showProb}`);
    });

    console.log('');
  }

  private suggestBettingStrategy(predictions: PredictionResult[]): void {
    console.log('💡 投資戦略提案:');
    console.log('='.repeat(50));

    // 本命候補（勝率上位）
    const favorites = predictions.slice(0, 3);
    console.log('🥇 本命候補:');
    favorites.forEach((pred, index) => {
      const rank = index + 1;
      const winRate = (pred.winProbability * 100).toFixed(1);
      console.log(`  ${rank}. ${pred.horseName} (勝率${winRate}%)`);
    });

    // 穴馬候補（勝率と連対率の差が大きい）
    const darkHorses = predictions
      .filter(pred => pred.winProbability < 0.15 && pred.placeProbability > 0.25)
      .sort((a, b) => (b.placeProbability - b.winProbability) - (a.placeProbability - a.winProbability))
      .slice(0, 2);

    if (darkHorses.length > 0) {
      console.log('\n🎲 穴馬候補:');
      darkHorses.forEach((pred, index) => {
        const placeRate = (pred.placeProbability * 100).toFixed(1);
        console.log(`  ${index + 1}. ${pred.horseName} (連対率${placeRate}%)`);
      });
    }

    // 推奨馬券
    this.recommendTickets(predictions);
  }

  private recommendTickets(predictions: PredictionResult[]): void {
    console.log('\n🎫 推奨馬券:');

    const top5 = predictions.slice(0, 5);
    const topHorse = predictions[0];

    // 単勝
    if (topHorse.winProbability > 0.2) {
      console.log(`単勝: ${topHorse.horseName} (勝率${(topHorse.winProbability * 100).toFixed(1)}%)`);
    }

    // 馬連
    if (top5.length >= 2) {
      const secondHorse = predictions[1];
      const combinedProb = topHorse.placeProbability + secondHorse.placeProbability;
      if (combinedProb > 0.4) {
        console.log(`馬連: ${topHorse.horseName} - ${secondHorse.horseName}`);
      }
    }

    // 3連複
    if (top5.length >= 3) {
      const thirdHorse = predictions[2];
      console.log(`3連複: ${topHorse.horseName} - ${predictions[1].horseName} - ${thirdHorse.horseName}`);
    }
  }
}
