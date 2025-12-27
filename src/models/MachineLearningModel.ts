import { ArimaDatabase } from '../database/Database';
import { RandomForestClassifier } from 'ml-random-forest';
import { Matrix } from 'ml-matrix';
import * as ss from 'simple-statistics';

// 特徴量インターフェース
export interface MLFeatures {
  // 過去3走の偏差値
  last3RacesDeviation: number;
  // 前走着順
  lastRacePosition: number;
  // 前走タイム差（勝ち馬との差、秒）
  lastRaceTimeDiff: number;
  // 中山での複勝率
  nakayamaPlaceRate: number;
  // 騎手の中山G1勝率
  jockeyNakayamaG1WinRate: number;
  // 馬齢
  age: number;
  // 性別（牡=1, 牝=0, 騸=0.5）
  sexNumeric: number;
  // 追加特徴量
  totalRuns: number;
  winRate: number;
  avgFinishPosition: number;
}

export interface TrainingData {
  features: number[][];
  labels: number[];  // 1=複勝圏内, 0=圏外
  horseIds: number[];
}

export interface PredictionResult {
  horseId: number;
  horseName: string;
  horseNumber?: number;
  probability: number;
  logisticProb: number;
  rfProb: number;
  features: MLFeatures;
  featureImportance: { name: string; value: number }[];
}

export interface CrossValidationResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  foldResults: { fold: number; accuracy: number }[];
}

export interface ModelStats {
  logistic: { accuracy: number; coefficients: number[] };
  randomForest: { accuracy: number; featureImportance: number[] };
  crossValidation: CrossValidationResult;
}

export class MachineLearningModel {
  private readonly db: ArimaDatabase;
  private logisticWeights: number[] | null = null;
  private rfModel: RandomForestClassifier | null = null;
  private trained = false;
  private readonly featureNames = [
    '過去3走偏差値',
    '前走着順',
    '前走タイム差',
    '中山複勝率',
    '騎手中山G1勝率',
    '馬齢',
    '性別',
    '出走回数',
    '勝率',
    '平均着順'
  ];
  private modelStats: ModelStats | null = null;

  constructor() {
    this.db = new ArimaDatabase();
  }

  // 特徴量抽出
  extractFeatures(horseId: number, raceId?: number): MLFeatures {
    const horse = this.db.getHorseById(horseId);
    const results = this.db.getHorseRaceResults(horseId);
    const validResults = results.filter(r => r.finish_position != null);

    // 過去3走の偏差値計算
    const last3 = validResults.slice(0, 3);
    const last3Positions = last3.map(r => r.finish_position ?? 10);
    const last3RacesDeviation = this.calculateDeviation(last3Positions);

    // 前走情報
    const lastRace = validResults[0];
    const lastRacePosition = lastRace?.finish_position ?? 10;
    const lastRaceTimeDiff = lastRace?.time_diff_seconds ?? 2.0;

    // 中山での複勝率
    const nakayamaResults = validResults.filter(r =>
      r.venue_name === '中山' || r.race_name?.includes('中山')
    );
    const nakayamaPlaces = nakayamaResults.filter(r => (r.finish_position ?? 99) <= 3).length;
    const nakayamaPlaceRate = nakayamaResults.length > 0
      ? nakayamaPlaces / nakayamaResults.length
      : 0.3; // デフォルト

    // 騎手の中山G1勝率（簡易版：データがあれば計算）
    const jockeyNakayamaG1WinRate = this.getJockeyNakayamaG1WinRate(lastRace?.jockey_id);

    // 馬齢・性別（birth_yearから計算）
    const currentYear = new Date().getFullYear();
    const age = horse?.birth_year ? currentYear - horse.birth_year : 4;
    const sexNumeric = horse?.sex === '牡' ? 1 : horse?.sex === '牝' ? 0 : 0.5;

    // 追加特徴量
    const totalRuns = validResults.length;
    const wins = validResults.filter(r => r.finish_position === 1).length;
    const winRate = totalRuns > 0 ? wins / totalRuns : 0;
    const avgFinishPosition = totalRuns > 0
      ? validResults.reduce((sum, r) => sum + (r.finish_position ?? 10), 0) / totalRuns
      : 8;

    return {
      last3RacesDeviation,
      lastRacePosition,
      lastRaceTimeDiff,
      nakayamaPlaceRate,
      jockeyNakayamaG1WinRate,
      age,
      sexNumeric,
      totalRuns,
      winRate,
      avgFinishPosition
    };
  }

  // 偏差値計算（着順ベース、低いほど良い→高い偏差値）
  private calculateDeviation(positions: number[]): number {
    if (positions.length === 0) return 50;

    // 着順を逆転させてスコア化（1着=18点, 18着=1点）
    const scores = positions.map(p => Math.max(19 - p, 1));
    const avgScore = ss.mean(scores);

    // 偏差値に変換（平均10、標準偏差3を仮定）
    const deviation = 50 + (avgScore - 10) * 10 / 3;
    return Math.max(20, Math.min(80, deviation));
  }

  // 騎手の中山G1勝率取得
  private getJockeyNakayamaG1WinRate(jockeyId?: number): number {
    if (!jockeyId) return 0.05; // デフォルト5%

    try {
      const jockeyStats = this.db.getJockeyStats(jockeyId);
      if (jockeyStats && jockeyStats.nakayama_g1_wins !== undefined) {
        const totalG1 = jockeyStats.nakayama_g1_runs || 1;
        return jockeyStats.nakayama_g1_wins / totalG1;
      }
    } catch {
      // データがない場合
    }
    return 0.05;
  }

  // 訓練データの準備（過去の重賞データから）
  prepareTrainingData(): TrainingData {
    const features: number[][] = [];
    const labels: number[] = [];
    const horseIds: number[] = [];

    // 過去のレース結果を取得
    const allResults = this.db.getAllRaceResults();

    for (const result of allResults) {
      if (result.finish_position == null) continue;

      const feat = this.extractFeatures(result.horse_id, result.race_id);
      const featureVector = this.featuresToVector(feat);

      features.push(featureVector);
      labels.push(result.finish_position <= 3 ? 1 : 0); // 複勝圏内かどうか
      horseIds.push(result.horse_id);
    }

    return { features, labels, horseIds };
  }

  // シンプルなロジスティック回帰の訓練
  private trainLogisticRegression(features: number[][], labels: number[], iterations: number, lr: number): number[] {
    const numFeatures = features[0]?.length ?? 0;
    const weights = new Array(numFeatures + 1).fill(0); // +1 for bias

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < features.length; i++) {
        const x = [1, ...features[i]]; // bias項を追加
        const y = labels[i];
        const pred = this.sigmoid(this.dotProduct(weights, x));
        const error = y - pred;

        // 勾配降下
        for (let j = 0; j < weights.length; j++) {
          weights[j] += lr * error * x[j];
        }
      }
    }

    return weights;
  }

  // シグモイド関数
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }

  // 内積
  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
  }

  // ロジスティック回帰で予測
  private predictLogistic(features: number[]): number {
    if (!this.logisticWeights) return 0.5;
    const x = [1, ...features];
    return this.sigmoid(this.dotProduct(this.logisticWeights, x));
  }

  // 特徴量をベクトルに変換
  private featuresToVector(feat: MLFeatures): number[] {
    return [
      feat.last3RacesDeviation / 100,    // 正規化
      feat.lastRacePosition / 18,         // 正規化
      Math.min(feat.lastRaceTimeDiff, 5) / 5, // 正規化
      feat.nakayamaPlaceRate,
      feat.jockeyNakayamaG1WinRate,
      feat.age / 10,                      // 正規化
      feat.sexNumeric,
      Math.min(feat.totalRuns, 30) / 30,  // 正規化
      feat.winRate,
      feat.avgFinishPosition / 18         // 正規化
    ];
  }

  // モデル訓練
  async trainModels(): Promise<ModelStats> {
    console.log('📊 機械学習モデルを訓練中...\n');

    const { features, labels } = this.prepareTrainingData();

    if (features.length < 10) {
      console.log('⚠️  訓練データが不足しています（最低10件必要）');
      console.log(`   現在のデータ数: ${features.length}件`);

      // ダミーモデルを作成
      this.trained = true;
      this.modelStats = {
        logistic: { accuracy: 0, coefficients: [] },
        randomForest: { accuracy: 0, featureImportance: [] },
        crossValidation: {
          accuracy: 0, precision: 0, recall: 0, f1Score: 0, auc: 0,
          foldResults: []
        }
      };
      return this.modelStats;
    }

    console.log(`   訓練データ: ${features.length}件`);
    console.log(`   複勝圏内: ${labels.filter(l => l === 1).length}件`);
    console.log(`   複勝圏外: ${labels.filter(l => l === 0).length}件\n`);

    // ロジスティック回帰（シンプル実装）
    console.log('🔄 ロジスティック回帰を訓練中...');
    this.logisticWeights = this.trainLogisticRegression(features, labels, 1000, 0.1);

    // ランダムフォレスト（LightGBM代替）
    console.log('🌲 ランダムフォレスト（LightGBM代替）を訓練中...');
    this.rfModel = new RandomForestClassifier({
      nEstimators: 100,
      seed: 42
    });
    this.rfModel.train(features, labels);

    // クロスバリデーション
    console.log('✅ クロスバリデーション実行中...\n');
    const cvResult = this.crossValidate(features, labels, 5);

    // モデル評価
    const logisticPreds = features.map(f => this.predictLogistic(f) > 0.5 ? 1 : 0);
    const rfPreds = this.rfModel.predict(features);

    const logisticAcc = this.calculateAccuracy(logisticPreds, labels);
    const rfAcc = this.calculateAccuracy(rfPreds, labels);

    this.trained = true;
    this.modelStats = {
      logistic: {
        accuracy: logisticAcc,
        coefficients: [] // ロジスティック回帰の係数
      },
      randomForest: {
        accuracy: rfAcc,
        featureImportance: this.calculateFeatureImportance(features, labels)
      },
      crossValidation: cvResult
    };

    this.displayTrainingResults();

    return this.modelStats;
  }

  // クロスバリデーション
  private crossValidate(features: number[][], labels: number[], k: number): CrossValidationResult {
    const foldSize = Math.floor(features.length / k);
    const foldResults: { fold: number; accuracy: number }[] = [];
    let allPreds: number[] = [];
    let allLabels: number[] = [];

    for (let i = 0; i < k; i++) {
      const testStart = i * foldSize;
      const testEnd = (i === k - 1) ? features.length : (i + 1) * foldSize;

      const testFeatures = features.slice(testStart, testEnd);
      const testLabels = labels.slice(testStart, testEnd);
      const trainFeatures = [...features.slice(0, testStart), ...features.slice(testEnd)];
      const trainLabels = [...labels.slice(0, testStart), ...labels.slice(testEnd)];

      if (trainFeatures.length < 5) continue;

      const rf = new RandomForestClassifier({
        nEstimators: 50,
        seed: 42 + i
      });
      rf.train(trainFeatures, trainLabels);
      const preds = rf.predict(testFeatures);

      const accuracy = this.calculateAccuracy(preds, testLabels);
      foldResults.push({ fold: i + 1, accuracy });

      allPreds = [...allPreds, ...preds];
      allLabels = [...allLabels, ...testLabels];
    }

    const avgAccuracy = foldResults.length > 0
      ? ss.mean(foldResults.map(f => f.accuracy))
      : 0;

    const { precision, recall, f1Score } = this.calculateMetrics(allPreds, allLabels);
    const auc = this.calculateAUC(allPreds, allLabels);

    return {
      accuracy: avgAccuracy,
      precision,
      recall,
      f1Score,
      auc,
      foldResults
    };
  }

  // 精度計算
  private calculateAccuracy(preds: number[], labels: number[]): number {
    if (preds.length === 0) return 0;
    const correct = preds.filter((p, i) => p === labels[i]).length;
    return correct / preds.length;
  }

  // 評価指標計算
  private calculateMetrics(preds: number[], labels: number[]): { precision: number; recall: number; f1Score: number } {
    const tp = preds.filter((p, i) => p === 1 && labels[i] === 1).length;
    const fp = preds.filter((p, i) => p === 1 && labels[i] === 0).length;
    const fn = preds.filter((p, i) => p === 0 && labels[i] === 1).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1Score = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

    return { precision, recall, f1Score };
  }

  // AUC計算（簡易版）
  private calculateAUC(preds: number[], labels: number[]): number {
    // 簡易的なAUC計算
    const positives = labels.filter(l => l === 1).length;
    const negatives = labels.filter(l => l === 0).length;

    if (positives === 0 || negatives === 0) return 0.5;

    let concordant = 0;
    for (let i = 0; i < preds.length; i++) {
      for (let j = 0; j < preds.length; j++) {
        if (labels[i] === 1 && labels[j] === 0) {
          if (preds[i] > preds[j]) concordant++;
          else if (preds[i] === preds[j]) concordant += 0.5;
        }
      }
    }

    return concordant / (positives * negatives);
  }

  // 特徴量重要度計算
  private calculateFeatureImportance(features: number[][], labels: number[]): number[] {
    // 各特徴量の相関係数で重要度を近似
    const importance: number[] = [];
    const numFeatures = features[0]?.length ?? 0;

    for (let i = 0; i < numFeatures; i++) {
      const featureValues = features.map(f => f[i]);
      try {
        const corr = Math.abs(ss.sampleCorrelation(featureValues, labels));
        importance.push(isNaN(corr) ? 0 : corr);
      } catch {
        importance.push(0);
      }
    }

    // 正規化
    const sum = importance.reduce((a, b) => a + b, 0) || 1;
    return importance.map(v => v / sum);
  }

  // 訓練結果表示
  private displayTrainingResults(): void {
    if (!this.modelStats) return;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 モデル訓練結果');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('【モデル精度】');
    console.log(`  ロジスティック回帰: ${(this.modelStats.logistic.accuracy * 100).toFixed(1)}%`);
    console.log(`  ランダムフォレスト: ${(this.modelStats.randomForest.accuracy * 100).toFixed(1)}%\n`);

    console.log('【クロスバリデーション（5-fold）】');
    const cv = this.modelStats.crossValidation;
    console.log(`  平均精度:   ${(cv.accuracy * 100).toFixed(1)}%`);
    console.log(`  適合率:     ${(cv.precision * 100).toFixed(1)}%`);
    console.log(`  再現率:     ${(cv.recall * 100).toFixed(1)}%`);
    console.log(`  F1スコア:   ${(cv.f1Score * 100).toFixed(1)}%`);
    console.log(`  AUC:        ${cv.auc.toFixed(3)}\n`);

    console.log('【特徴量重要度】');
    const importance = this.modelStats.randomForest.featureImportance;
    const sortedFeatures = this.featureNames
      .map((name, i) => ({ name, value: importance[i] || 0 }))
      .sort((a, b) => b.value - a.value);

    sortedFeatures.forEach((f, i) => {
      const bar = '█'.repeat(Math.round(f.value * 30));
      console.log(`  ${(i + 1).toString().padStart(2)}. ${f.name.padEnd(14)} ${bar} ${(f.value * 100).toFixed(1)}%`);
    });
    console.log('');
  }

  // 予測実行（レース指定）
  async predict(raceId: number): Promise<PredictionResult[]> {
    if (!this.trained) {
      await this.trainModels();
    }

    const entries = this.db.getRaceEntries(raceId);
    const predictions: PredictionResult[] = [];

    for (const entry of entries) {
      const features = this.extractFeatures(entry.horse_id, raceId);
      const featureVector = this.featuresToVector(features);

      // 両モデルで予測
      const logisticProb = this.predictLogistic(featureVector);

      let rfProb = 0.3;
      if (this.rfModel) {
        try {
          const rfPred = this.rfModel.predict([featureVector]);
          // 確率を推定（クラス予測を確率に変換）
          rfProb = rfPred[0] === 1 ? 0.65 : 0.25;
        } catch {
          // フォールバック
        }
      }

      // アンサンブル（加重平均）
      const probability = logisticProb * 0.3 + rfProb * 0.7;

      // 特徴量重要度
      const importance = this.modelStats?.randomForest.featureImportance || [];
      const featureImportance = this.featureNames.map((name, i) => ({
        name,
        value: importance[i] || 0
      })).sort((a, b) => b.value - a.value);

      predictions.push({
        horseId: entry.horse_id,
        horseName: entry.horse_name,
        horseNumber: entry.horse_number,
        probability,
        logisticProb,
        rfProb,
        features,
        featureImportance
      });
    }

    return predictions.sort((a, b) => b.probability - a.probability);
  }

  // スコアリング結果とのクロスチェック
  async crossCheckWithScoring(raceId: number, scoringResults: { horseId: number; totalScore: number }[]): Promise<void> {
    const mlPredictions = await this.predict(raceId);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 スコアリング × 機械学習 クロスチェック');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('馬名              スコア順  ML順位  ML確率  判定');
    console.log('-'.repeat(60));

    const scoreRanking = scoringResults
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((s, i) => ({ ...s, scoreRank: i + 1 }));

    const mlRanking = mlPredictions.map((p, i) => ({ ...p, mlRank: i + 1 }));

    for (const score of scoreRanking) {
      const ml = mlRanking.find(m => m.horseId === score.horseId);
      if (!ml) continue;

      const name = ml.horseName.padEnd(14);
      const scoreRank = score.scoreRank.toString().padStart(2);
      const mlRank = ml.mlRank.toString().padStart(2);
      const prob = (ml.probability * 100).toFixed(1).padStart(5);

      // 判定
      let judgment = '';
      const rankDiff = Math.abs(score.scoreRank - ml.mlRank);
      if (rankDiff <= 1) {
        judgment = '✅ 一致';
      } else if (score.scoreRank <= 3 && ml.mlRank <= 3) {
        judgment = '⭕ 上位一致';
      } else if (rankDiff >= 5) {
        judgment = '⚠️  乖離大';
      } else {
        judgment = '△ やや乖離';
      }

      console.log(`${name} ${scoreRank}位     ${mlRank}位    ${prob}%  ${judgment}`);
    }

    // 乖離分析
    console.log('\n【乖離馬の分析】');
    const divergent = scoreRanking.filter(s => {
      const ml = mlRanking.find(m => m.horseId === s.horseId);
      return ml && Math.abs(s.scoreRank - ml.mlRank) >= 4;
    });

    if (divergent.length === 0) {
      console.log('  大きな乖離はありません。両モデルの評価は概ね一致しています。');
    } else {
      for (const s of divergent) {
        const ml = mlRanking.find(m => m.horseId === s.horseId)!;
        console.log(`\n  ${ml.horseName}:`);
        console.log(`    スコア順位: ${s.scoreRank}位 / ML順位: ${ml.mlRank}位`);

        if (s.scoreRank < ml.mlRank) {
          console.log('    → スコアが過大評価の可能性。ML特徴量を確認。');
          console.log(`       前走着順: ${ml.features.lastRacePosition}着`);
          console.log(`       過去3走偏差値: ${ml.features.last3RacesDeviation.toFixed(1)}`);
        } else {
          console.log('    → MLが過大評価の可能性。直近の調子を確認。');
          console.log(`       中山複勝率: ${(ml.features.nakayamaPlaceRate * 100).toFixed(1)}%`);
        }
      }
    }
  }

  getModelStats(): ModelStats | null {
    return this.modelStats;
  }

  close(): void {
    this.db.close();
  }
}
