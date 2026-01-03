import { DatabaseConnection } from '../database/DatabaseConnection';
import { RaceQueryRepository } from '../repositories/queries/RaceQueryRepository';
import { ScoringOrchestrator } from '../domain/services/ScoringOrchestrator';
import type { ScoreComponentsData } from '../domain/valueObjects/ScoreComponents';
import { SCORE_WEIGHTS } from '../constants/ScoringConstants';
import { RandomForestClassifier } from 'ml-random-forest';
import { Matrix, solve } from 'ml-matrix';
import * as ss from 'simple-statistics';

/**
 * ML特徴量（スコアリング10要素と統一）
 *
 * @remarks
 * スコアリングシステムと同じ10要素を使用することで:
 * - 説明可能性を確保
 * - 重み最適化が可能
 * - 予測結果の整合性を担保
 */
export interface MLFeatures extends ScoreComponentsData {
  // ScoreComponentsDataの10要素をそのまま継承
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
  private readonly connection: DatabaseConnection;
  private readonly raceRepo: RaceQueryRepository;
  private readonly orchestrator: ScoringOrchestrator;
  private logisticWeights: number[] | null = null;
  private rfModel: RandomForestClassifier | null = null;
  private trained = false;

  /** スコアリング10要素に統一した特徴量名 */
  private readonly featureNames = [
    '直近成績',
    'コース適性',
    '距離適性',
    '上がり3F',
    'G1実績',
    'ローテ適性',
    '騎手能力',
    '馬場適性',
    '枠順効果',
    '調教師'
  ];

  /** 学習済み最適重み（Phase3で使用） */
  private learnedWeights: number[] | null = null;

  private modelStats: ModelStats | null = null;

  constructor() {
    this.connection = new DatabaseConnection();
    const db = this.connection.getConnection();
    this.raceRepo = new RaceQueryRepository(db);
    this.orchestrator = new ScoringOrchestrator(db);
  }

  /**
   * 特徴量抽出（スコアリング10要素を使用）
   *
   * @remarks
   * ScoringOrchestratorを使用して、スコアリングと同じ10要素を特徴量として抽出。
   * これにより、ML予測とルールベーススコアリングの整合性を担保。
   *
   * @param horseId - 馬ID
   * @param raceId - レースID（必須）
   * @returns 10要素の特徴量
   */
  extractFeaturesForRace(horseId: number, raceId: number): MLFeatures | null {
    try {
      const entries = this.raceRepo.getRaceEntries(raceId);
      const entry = entries.find(e => e.horse_id === horseId);
      if (!entry) return null;

      const race = this.orchestrator.buildRaceEntity(raceId);
      if (!race) return null;

      const horse = this.orchestrator.buildHorseEntity(horseId);
      const jockey = entry.jockey_id
        ? this.orchestrator.buildJockeyEntity(entry.jockey_id, race.venue, entry.trainer_id)
        : null;

      // スコアリングと同じ計算ロジックを使用
      const scores = horse.calculateTotalScore(jockey, race, null, entry.horse_number);
      const plain = scores.toPlainObject();

      return {
        recentPerformanceScore: plain.recentPerformanceScore,
        venueAptitudeScore: plain.venueAptitudeScore,
        distanceAptitudeScore: plain.distanceAptitudeScore,
        last3FAbilityScore: plain.last3FAbilityScore,
        g1AchievementScore: plain.g1AchievementScore,
        rotationAptitudeScore: plain.rotationAptitudeScore,
        jockeyScore: plain.jockeyScore,
        trackConditionScore: plain.trackConditionScore,
        postPositionScore: plain.postPositionScore,
        trainerScore: plain.trainerScore
      };
    } catch {
      return null;
    }
  }

  /**
   * 後方互換用: 旧extractFeatures（非推奨）
   * @deprecated extractFeaturesForRace を使用してください
   */
  extractFeatures(horseId: number, raceId?: number): MLFeatures {
    if (raceId) {
      const features = this.extractFeaturesForRace(horseId, raceId);
      if (features) return features;
    }
    // フォールバック: デフォルト値を返す
    return {
      recentPerformanceScore: 50,
      venueAptitudeScore: 50,
      distanceAptitudeScore: 50,
      last3FAbilityScore: 50,
      g1AchievementScore: 0,
      rotationAptitudeScore: 50,
      jockeyScore: 50,
      trackConditionScore: 50,
      postPositionScore: 50,
      trainerScore: 0
    };
  }

  /**
   * 訓練データの準備（過去のレースデータから）
   *
   * @remarks
   * スコアリング10要素を特徴量として使用。
   * 過去レースの結果から、複勝圏内（3着以内）かどうかを学習。
   */
  prepareTrainingData(): TrainingData {
    const features: number[][] = [];
    const labels: number[] = [];
    const horseIds: number[] = [];

    // 過去のレース結果を取得
    const allResults = this.raceRepo.getAllRaceResults();

    for (const result of allResults) {
      if (result.finish_position == null) continue;

      // スコアリング10要素を特徴量として抽出
      const feat = this.extractFeaturesForRace(result.horse_id, result.race_id);
      if (!feat) continue;

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

  /**
   * 特徴量をベクトルに変換（スコアリング10要素）
   *
   * @remarks
   * 各スコアは0-100の範囲なので、100で割って正規化
   */
  private featuresToVector(feat: MLFeatures): number[] {
    return [
      feat.recentPerformanceScore / 100,
      feat.venueAptitudeScore / 100,
      feat.distanceAptitudeScore / 100,
      feat.last3FAbilityScore / 100,
      feat.g1AchievementScore / 100,
      feat.rotationAptitudeScore / 100,
      feat.jockeyScore / 100,
      feat.trackConditionScore / 100,
      feat.postPositionScore / 100,
      feat.trainerScore / 100
    ];
  }

  /**
   * 現在のスコアリング重みを取得
   */
  getCurrentWeights(): number[] {
    return [
      SCORE_WEIGHTS.recentPerformance,
      SCORE_WEIGHTS.venueAptitude,
      SCORE_WEIGHTS.distanceAptitude,
      SCORE_WEIGHTS.last3FAbility,
      SCORE_WEIGHTS.g1Achievement,
      SCORE_WEIGHTS.rotationAptitude,
      SCORE_WEIGHTS.jockey,
      SCORE_WEIGHTS.trackCondition,
      SCORE_WEIGHTS.postPosition,
      SCORE_WEIGHTS.trainer
    ];
  }

  /**
   * 学習済み最適重みを取得（Phase3で使用）
   */
  getLearnedWeights(): number[] | null {
    return this.learnedWeights;
  }

  /**
   * 重みを最適化（リッジ回帰ベース）
   *
   * @remarks
   * 過去データから最適な重みを学習。
   * L2正則化を使用して過学習を防止。
   *
   * @param lambda - 正則化パラメータ（大きいほど正則化が強い）
   * @returns 最適化された重みと評価指標
   */
  async optimizeWeights(lambda: number = 0.1): Promise<{
    weights: number[];
    featureNames: string[];
    improvement: number;
    comparison: { name: string; current: number; optimized: number; diff: number }[];
  }> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 重み最適化（リッジ回帰）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 訓練データ準備
    const { features, labels } = this.prepareTrainingDataForRegression();

    if (features.length < 20) {
      console.log('⚠️  最適化に必要なデータが不足しています（最低20件必要）');
      return {
        weights: this.getCurrentWeights(),
        featureNames: this.featureNames,
        improvement: 0,
        comparison: []
      };
    }

    console.log(`📊 訓練データ: ${features.length}件`);
    console.log(`   正則化パラメータ λ = ${lambda}\n`);

    // リッジ回帰で重みを学習
    const optimizedWeights = this.ridgeRegression(features, labels, lambda);

    // 重みを正規化（合計1.0に）
    const sum = optimizedWeights.reduce((a, b) => a + Math.abs(b), 0);
    const normalizedWeights = optimizedWeights.map(w => Math.max(0, w) / sum);

    this.learnedWeights = normalizedWeights;

    // 現在の重みと比較
    const currentWeights = this.getCurrentWeights();
    const comparison = this.featureNames.map((name, i) => ({
      name,
      current: currentWeights[i],
      optimized: normalizedWeights[i],
      diff: normalizedWeights[i] - currentWeights[i]
    }));

    // 改善度を計算
    const improvement = this.evaluateWeightImprovement(features, labels, currentWeights, normalizedWeights);

    // 結果表示
    this.displayOptimizationResults(comparison, improvement);

    return {
      weights: normalizedWeights,
      featureNames: this.featureNames,
      improvement,
      comparison
    };
  }

  /**
   * 回帰用訓練データを準備（着順を連続値として使用）
   */
  private prepareTrainingDataForRegression(): { features: number[][]; labels: number[] } {
    const features: number[][] = [];
    const labels: number[] = [];

    const allResults = this.raceRepo.getAllRaceResults();

    for (const result of allResults) {
      if (result.finish_position == null) continue;

      const feat = this.extractFeaturesForRace(result.horse_id, result.race_id);
      if (!feat) continue;

      const featureVector = this.featuresToVector(feat);
      features.push(featureVector);
      // 着順を反転してスコア化（1着=1.0, 18着=0.0）
      labels.push(Math.max(0, 1 - (result.finish_position - 1) / 17));
    }

    return { features, labels };
  }

  /**
   * リッジ回帰（L2正則化線形回帰）
   *
   * @remarks
   * ml-matrixライブラリを使用してネイティブ最適化された行列演算を実行。
   * 手動ループより高速で数値的に安定。
   */
  private ridgeRegression(features: number[][], labels: number[], lambda: number): number[] {
    const n = features.length;
    const p = features[0]?.length ?? 10;

    // ml-matrixで行列計算を最適化
    const X = new Matrix(features);
    const y = Matrix.columnVector(labels);

    // X^T * X を計算
    const XtX = X.transpose().mmul(X);

    // 正則化項 λnI を追加
    const regularization = Matrix.eye(p).mul(lambda * n);
    const XtXreg = XtX.add(regularization);

    // X^T * y を計算
    const Xty = X.transpose().mmul(y);

    // (X^T X + λnI) * w = X^T y を解く
    const weights = solve(XtXreg, Xty);

    return weights.getColumn(0);
  }

  /**
   * 重み改善度を評価
   */
  private evaluateWeightImprovement(
    features: number[][],
    labels: number[],
    currentWeights: number[],
    optimizedWeights: number[]
  ): number {
    let currentError = 0;
    let optimizedError = 0;

    for (let i = 0; i < features.length; i++) {
      const currentPred = features[i].reduce((sum, f, j) => sum + f * currentWeights[j], 0);
      const optimizedPred = features[i].reduce((sum, f, j) => sum + f * optimizedWeights[j], 0);

      currentError += Math.pow(labels[i] - currentPred, 2);
      optimizedError += Math.pow(labels[i] - optimizedPred, 2);
    }

    // 改善率（%）
    return currentError > 0 ? ((currentError - optimizedError) / currentError) * 100 : 0;
  }

  /**
   * 最適化結果を表示
   */
  private displayOptimizationResults(
    comparison: { name: string; current: number; optimized: number; diff: number }[],
    improvement: number
  ): void {
    console.log('【重み比較】');
    console.log('要素          現在    最適化   変化');
    console.log('-'.repeat(45));

    for (const c of comparison) {
      const current = (c.current * 100).toFixed(1).padStart(5);
      const optimized = (c.optimized * 100).toFixed(1).padStart(5);
      const diff = c.diff >= 0 ? '+' : '';
      const diffStr = `${diff}${(c.diff * 100).toFixed(1)}%`;
      const arrow = c.diff > 0.02 ? '↑' : c.diff < -0.02 ? '↓' : ' ';

      console.log(`${c.name.padEnd(10)} ${current}%  ${optimized}%  ${arrow} ${diffStr}`);
    }

    console.log(`\n📈 予測誤差改善率: ${improvement.toFixed(1)}%`);

    if (improvement > 5) {
      console.log('💡 最適化重みの適用を推奨します');
    } else if (improvement > 0) {
      console.log('✅ 現在の重みは概ね適切です');
    } else {
      console.log('⚠️  最適化による改善が見られません。データ量が不足している可能性があります');
    }
  }

  /**
   * 最適化重みをScoringConstants形式で出力
   */
  getOptimizedWeightsAsConstants(): string {
    if (!this.learnedWeights) return '';

    const keys = [
      'recentPerformance',
      'venueAptitude',
      'distanceAptitude',
      'last3FAbility',
      'g1Achievement',
      'rotationAptitude',
      'jockey',
      'trackCondition',
      'postPosition',
      'trainer'
    ];

    const lines = keys.map((key, i) => {
      const weight = this.learnedWeights![i].toFixed(2);
      return `  ${key}: ${weight},`;
    });

    return `export const SCORE_WEIGHTS = {\n${lines.join('\n')}\n} as const;`;
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

    const entries = this.raceRepo.getRaceEntries(raceId);
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
          // RFのクラス予測と特徴量スコアを組み合わせて確率を推定
          // 特徴量の平均スコア（0-1正規化済み）を基準に調整
          const avgFeatureScore = featureVector.reduce((a, b) => a + b, 0) / featureVector.length;
          if (rfPred[0] === 1) {
            // 複勝圏内予測: 基準確率0.5 + 特徴量スコアで調整（0.5-0.85）
            rfProb = 0.5 + avgFeatureScore * 0.35;
          } else {
            // 圏外予測: 基準確率0.15 + 特徴量スコアで調整（0.15-0.45）
            rfProb = 0.15 + avgFeatureScore * 0.30;
          }
        } catch {
          // フォールバック: 特徴量スコアのみで推定
          const avgFeatureScore = featureVector.reduce((a, b) => a + b, 0) / featureVector.length;
          rfProb = avgFeatureScore * 0.5 + 0.2;
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
          console.log('    → スコアが過大評価の可能性。要素別スコアを確認。');
          console.log(`       直近成績: ${ml.features.recentPerformanceScore.toFixed(0)}点`);
          console.log(`       コース適性: ${ml.features.venueAptitudeScore.toFixed(0)}点`);
        } else {
          console.log('    → MLが過大評価の可能性。直近の調子を確認。');
          console.log(`       直近成績: ${ml.features.recentPerformanceScore.toFixed(0)}点`);
          console.log(`       G1実績: ${ml.features.g1AchievementScore.toFixed(0)}点`);
        }
      }
    }
  }

  getModelStats(): ModelStats | null {
    return this.modelStats;
  }

  close(): void {
    this.connection.close();
  }
}
