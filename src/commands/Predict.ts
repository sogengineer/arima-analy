/**
 * 予測コマンド
 *
 * @remarks
 * `MachineLearningModel` の確率予測をそのまま表示する。
 *
 * 旧実装は「馬の通算勝率をそのまま勝率とみなし、0.5 で頭打ちにする」という
 * レース文脈を無視した統計だったため廃止した。現在は:
 * - 単勝確率 = レース内 softmax（**合計100%**）
 * - 複勝確率 = 3着以内モデル（**合計300%** に較正）
 * となり、推奨閾値もこの定義に合わせている。
 *
 * ## 予測時点と「妙味」の意味
 *
 * モデルは人気順位・単勝オッズを特徴量に持つため、**予測時点は発売締切直前**である
 * （締切前には使えない）。
 *
 * その結果、ここで表示する「妙味 = 単勝確率 − 市場暗黙確率」は
 * **市場と独立な評価の差ではなく、「市場の誤差」をモデルが推定した量** である。
 * 市場を情報源に取り込んだうえで、その偏りを補正した結果に過ぎない点に注意すること
 * （詳細は `docs/MODELS.md` と `src/features/FeatureBuilder.ts` の冒頭）。
 */

import { DatabaseConnection } from '../database/DatabaseConnection';
import { RaceQueryRepository } from '../repositories/queries/RaceQueryRepository';
import { MachineLearningModel, type PredictionResult } from '../models/MachineLearningModel';

/** 馬券推奨の閾値（レース内正規化済み確率に対する基準） */
export const RECOMMENDATION_THRESHOLDS = {
  /** 単勝を推奨する単勝確率 */
  win: 0.25,
  /** 市場より何ポイント高ければ「妙味あり」とみなすか */
  valueEdge: 0.03,
  /** 複勝を推奨する3着以内確率 */
  show: 0.5
} as const;

export interface PredictOptions {
  /** 対象レースID */
  race?: string;
}

export class Predict {
  private readonly connection: DatabaseConnection | null;
  private readonly raceRepo: RaceQueryRepository;
  private readonly ml: MachineLearningModel;

  constructor(externalDb?: ReturnType<DatabaseConnection['getConnection']>) {
    if (externalDb) {
      this.connection = null;
      this.raceRepo = new RaceQueryRepository(externalDb);
      this.ml = new MachineLearningModel(externalDb);
    } else {
      this.connection = new DatabaseConnection();
      const db = this.connection.getConnection();
      this.raceRepo = new RaceQueryRepository(db);
      this.ml = new MachineLearningModel(db);
    }
  }

  async execute(options: PredictOptions = {}): Promise<void> {
    try {
      if (!options.race) {
        this.displayRaceList();
        return;
      }

      const race = this.raceRepo.getRaceByIdOrName(options.race);
      if (!race) {
        console.log(`❌ レースが見つかりません: ${options.race}`);
        this.displayRaceList();
        return;
      }

      console.log(`🤖 ${race.race_name}（${race.race_date}）の確率を予測中...\n`);

      const predictions = await this.ml.predict(race.id);

      if (predictions.length === 0) {
        console.log('予測対象の出走馬がいません');
        console.log('\n📥 データ入力方法:');
        console.log('  arima fetch-and-extract <JRA URL>');
        return;
      }

      if (!this.ml.isTrained()) {
        console.log('⚠️  学習データが不足しているため、市場の暗黙確率を表示します（全馬オッズありならオッズ、無ければ人気順位から算出）');
        console.log('   （確率を捏造せず、素直に市場のベースラインを出しています）\n');
      }

      this.displayPredictions(predictions);
      this.suggestBettingStrategy(predictions);
    } catch (error) {
      console.error('❌ 予測に失敗:', error);
    } finally {
      this.close();
    }
  }

  private displayRaceList(): void {
    console.log('⚠️  レースIDを指定してください: predict --race <id>');
    const races = this.raceRepo.getAllRaces().slice(0, 10);
    if (races.length === 0) {
      console.log('   登録されているレースがありません');
      return;
    }
    console.log('\n【登録済みレース（最新10件）】');
    for (const race of races) {
      console.log(`  ${race.id}: ${race.race_date} ${race.venue_name} ${race.race_name}`);
    }
  }

  private displayPredictions(predictions: PredictionResult[]): void {
    console.log('🎯 予測結果（単勝はレース内合計100%、複勝は合計300%）');
    console.log('='.repeat(76));
    console.log('順位  馬名            単勝     複勝     市場     妙味');
    console.log('-'.repeat(76));

    predictions.forEach((pred, index) => {
      const rank = (index + 1).toString().padStart(2);
      const name = pred.horseName.padEnd(14);
      const win = `${(pred.winProbability * 100).toFixed(1).padStart(5)}%`;
      const show = `${(pred.showProbability * 100).toFixed(1).padStart(6)}%`;
      const market = `${(pred.marketImpliedProb * 100).toFixed(1).padStart(6)}%`;
      const edge = pred.winProbability - pred.marketImpliedProb;
      const edgeStr = `${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}pt`.padStart(8);

      console.log(`${rank}位 ${name} ${win} ${show} ${market} ${edgeStr}`);
    });

    console.log('');
    console.log('※ 予測時点は「発売締切直前」（人気・オッズを特徴量に使うため）。');
    console.log('   「妙味」は市場と独立な差ではなく、モデルが推定した **市場の誤差** です。');
    console.log('');
  }

  private suggestBettingStrategy(predictions: PredictionResult[]): void {
    if (predictions.length === 0) return;

    console.log('💡 投資戦略提案:');
    console.log('='.repeat(50));

    const top = predictions[0];
    console.log('🥇 本命候補:');
    predictions.slice(0, 3).forEach((pred, index) => {
      console.log(
        `  ${index + 1}. ${pred.horseName}（単勝${(pred.winProbability * 100).toFixed(1)}%）`
      );
    });

    // 妙味馬: モデル確率が市場の暗黙確率を上回る馬
    const valueHorses = predictions
      .filter(p => p.winProbability - p.marketImpliedProb >= RECOMMENDATION_THRESHOLDS.valueEdge)
      .slice(0, 3);

    if (valueHorses.length > 0) {
      console.log('\n🎲 市場より高く評価している馬（＝市場の誤差が大きいとモデルが見た馬）:');
      valueHorses.forEach((pred, index) => {
        const edge = (pred.winProbability - pred.marketImpliedProb) * 100;
        console.log(`  ${index + 1}. ${pred.horseName}（市場比 +${edge.toFixed(1)}pt）`);
      });
    } else {
      console.log('\n🎲 市場を明確に上回る評価の馬はありません');
    }

    console.log('\n🎫 推奨馬券:');
    if (top.winProbability >= RECOMMENDATION_THRESHOLDS.win) {
      console.log(`  単勝: ${top.horseName}（単勝${(top.winProbability * 100).toFixed(1)}%）`);
    }
    const showCandidates = predictions.filter(
      p => p.showProbability >= RECOMMENDATION_THRESHOLDS.show
    );
    if (showCandidates.length > 0) {
      console.log(`  複勝: ${showCandidates.map(p => p.horseName).join(' / ')}`);
    }
    if (predictions.length >= 3) {
      console.log(
        `  3連複: ${predictions.slice(0, 3).map(p => p.horseName).join(' - ')}`
      );
    }

    console.log('\n※ 確率は較正済みですが、採用可否は `arima ml --validate` の');
    console.log('   採用ゲート（log loss が市場を下回るか）で判断してください。');
  }

  close(): void {
    this.ml.close();
    if (this.connection) {
      this.connection.close();
    }
  }
}
