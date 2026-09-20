/**
 * 機械学習モデル（確率予測）
 *
 * @remarks
 * ## 設計
 *
 * - **特徴量**: `FeatureBuilder` が組む as-of 特徴量（市場・馬体・通算・前走・レース内相対化 +
 *   ルールベース10要素の派生特徴）。ルールベースは廃止せず特徴量・説明・ベースラインとして使う。
 * - **モデル**: L2正則化ロジスティック回帰（特徴量標準化 + 収束判定）。
 *   - 単勝: レース内 softmax（conditional logit）で **和が1になる勝率**
 *   - 複勝: 3着以内の二値ロジスティック（レース内で和が3になるよう較正）
 * - **評価**: `walkForwardValidate()` — 時系列ブロック・レース単位グルーピング・シャッフルなし。
 *   指標は log loss（主）/ Brier / top-1的中 / top-3再現 / Spearman / 実オッズ回収率。
 * - **リーク遮断**: 学習・評価とも各レースの `race_date` を as-of に渡す。
 *
 * ## 意図的にやらないこと
 * - 確率の捏造（旧実装の `rfProb = 0.5 + avg * 0.35` のような手作り式）はすべて削除した。
 *   RandomForest を使う場合も `predictProbability()` の実値のみを使う。
 * - `optimizeWeights()` は予測器ではなく **ルールベース重みの説明用射影** として残している
 *   （docs/MODELS.md 参照）。
 */

import { DatabaseConnection } from '@/database/DatabaseConnection';
import { RaceQueryRepository } from '@/repositories/queries/RaceQueryRepository';
import {
  FeatureBuilder,
  FEATURE_NAMES,
  FEATURE_DIMENSION,
  type RaceFeatureSet
} from '@/features/FeatureBuilder';
import type {
  AdoptionGate,
  LogisticModel,
  ModelStats,
  PredictionResult,
  TrainingData,
  TrainingRace,
  TrainOptions,
  WalkForwardOptions,
  WalkForwardResult
} from './MachineLearningTypes';
import { sumOf } from './MachineLearningMath';
import { trainL2Logistic } from './LogisticRegression';
import { evaluateRaces } from './RaceEvaluation';
import {
  printCrossCheck,
  printGate,
  printProjectionResults,
  printTrainingResults,
  printWalkForward
} from './MachineLearningReport';
import { predictFromMarket, predictWithModels, scoreRace } from './RaceScoring';
import { runWalkForwardValidation } from './WalkForwardValidation';
import { MIN_TRAINING_SAMPLES } from './MachineLearningConstants';
import {
  buildFinishPositionMap,
  buildTrainingSamples,
  orderRacesByDateAscending,
  type RaceWithResultsRow
} from './TrainingDataCollection';
import {
  currentScoreWeights,
  projectRuleWeights,
  formatWeightsAsConstants,
  RULE_FEATURE_NAMES,
  type WeightComparison
} from './RuleWeightProjection';

export * from './MachineLearningTypes';
export * from './MachineLearningMath';
export * from './LogisticRegression';
export * from './RaceEvaluation';
export * from './RuleWeightProjection';
export * from './HyperparameterSelection';
// ============================================================
// モデル本体
// ============================================================

export class MachineLearningModel {
  private readonly connection: DatabaseConnection | null;
  private readonly raceRepo: RaceQueryRepository;
  private readonly featureBuilder: FeatureBuilder;
  private readonly ownsConnection: boolean;

  private winModel: LogisticModel | null = null;
  private showModel: LogisticModel | null = null;
  private trained = false;
  /** 現在のモデルが学習から除外したレースID（除外なしなら undefined） */
  private trainedExcludeRaceId: number | undefined = undefined;
  private modelStats: ModelStats | null = null;

  /** 学習済み重み（説明用射影。予測には使わない） */
  private learnedWeights: number[] | null = null;

  constructor(externalDb?: ReturnType<DatabaseConnection['getConnection']>) {
    if (externalDb) {
      this.connection = null;
      this.raceRepo = new RaceQueryRepository(externalDb);
      this.featureBuilder = new FeatureBuilder(externalDb);
      this.ownsConnection = false;
    } else {
      this.connection = new DatabaseConnection();
      const db = this.connection.getConnection();
      this.raceRepo = new RaceQueryRepository(db);
      this.featureBuilder = new FeatureBuilder(db);
      this.ownsConnection = true;
    }
  }

  // ----------------------------------------------------------
  // 特徴量
  // ----------------------------------------------------------

  /**
   * 学習データを準備（レース単位・as-of）
   *
   * @remarks
   * 各レースの特徴量は、そのレースの `race_date` **より前** のデータだけで組む。
   * 結果が1件も無いレースは学習対象外。
   */
  prepareTrainingData(): TrainingData {
    const races = this.collectTrainingRaces();

    const features: number[][] = [];
    const labels: number[] = [];
    const horseIds: number[] = [];

    for (const race of races) {
      for (const sample of race.samples) {
        features.push(sample.vector);
        labels.push(sample.showLabel);
        horseIds.push(sample.horseId);
      }
    }

    return { features, labels, horseIds, races };
  }

  /**
   * 結果が確定しているレースを日付昇順で収集し、as-of 特徴量を組む
   *
   * @param excludeRaceId - 学習から除外するレースID（予測対象レースの自己学習を防ぐ）
   */
  private collectTrainingRaces(excludeRaceId?: number): TrainingRace[] {
    // getRacesWithResults は日付降順。時系列検証のため昇順に直す
    const ordered = orderRacesByDateAscending(this.raceRepo.getRacesWithResults(false));

    const trainingRaces: TrainingRace[] = [];
    let failedRaces = 0;
    let firstError: string | null = null;

    for (const race of ordered) {
      if (excludeRaceId != null && race.id === excludeRaceId) continue;

      let featureSet: RaceFeatureSet | null = null;
      try {
        featureSet = this.featureBuilder.buildForRace(race.id, race.race_date);
      } catch (error) {
        // 1レースの失敗で学習全体を落とさないが、黙って捨てない（件数と最初の理由を出す）
        failedRaces++;
        firstError ??= error instanceof Error ? error.message : String(error);
        continue;
      }
      if (!featureSet) continue;

      const trainingRace = this.buildTrainingRace(race, featureSet);
      if (trainingRace) trainingRaces.push(trainingRace);
    }

    if (failedRaces > 0) {
      console.warn(
        `⚠️  特徴量の構築に失敗したレースが ${failedRaces} 件あります（学習から除外）: ${firstError}`
      );
    }

    return trainingRaces;
  }

  /** 着順が取れて2頭以上そろったレースだけを学習レースにする（足りなければ null） */
  private buildTrainingRace(
    race: RaceWithResultsRow,
    featureSet: RaceFeatureSet
  ): TrainingRace | null {
    const positionMap = buildFinishPositionMap(this.raceRepo.getRaceResults(race.id));
    if (positionMap.size === 0) return null;

    const samples = buildTrainingSamples(race.id, race.race_date, featureSet, positionMap);
    if (samples.length < 2) return null;

    return {
      raceId: race.id,
      raceDate: race.race_date,
      raceName: race.race_name,
      marketProbSource: featureSet.marketProbSource,
      samples
    };
  }

  // ----------------------------------------------------------
  // 学習
  // ----------------------------------------------------------

  /**
   * 単勝・複勝モデルを学習
   *
   * @param options - 学習オプション（L2係数など）
   * @param excludeRaceId - 学習から除外するレースID。
   *   結果が確定済みの過去レースを予測する際に、そのレース自身での自己学習を防ぐ。
   *
   * @remarks
   * 学習には（除外レース以外の）全期間のレースを使う。
   * そのため過去レースを個別に予測した結果は **バックテストではない**。
   * 汎化性能は `walkForwardValidate()` で測ること。
   */
  async trainModels(options: TrainOptions = {}, excludeRaceId?: number): Promise<ModelStats> {
    const races = this.collectTrainingRaces(excludeRaceId);
    const samples = races.flatMap(r => r.samples);
    this.trainedExcludeRaceId = excludeRaceId;

    if (samples.length < MIN_TRAINING_SAMPLES) {
      this.trained = false;
      this.winModel = null;
      this.showModel = null;
      this.modelStats = {
        trained: false,
        trainingRaces: races.length,
        trainingRunners: samples.length,
        win: null,
        show: null,
        featureImportance: [],
        inSample: null
      };
      console.log('⚠️  学習データが不足しています');
      console.log(`   レース数: ${races.length} / 出走行: ${samples.length}`);
      console.log(`   最低 ${MIN_TRAINING_SAMPLES} 出走行が必要です`);
      return this.modelStats;
    }

    console.log('📊 機械学習モデルを訓練中...\n');
    console.log(`   学習レース: ${races.length}件 / 出走行: ${samples.length}件`);
    console.log(`   1着: ${samples.filter(s => s.winLabel === 1).length}件`);
    console.log(`   複勝圏内: ${samples.filter(s => s.showLabel === 1).length}件`);
    console.log(`   特徴量: ${FEATURE_DIMENSION}次元\n`);

    const X = samples.map(s => s.vector);
    const winModel = trainL2Logistic(X, samples.map(s => s.winLabel), options);
    const showModel = trainL2Logistic(X, samples.map(s => s.showLabel), options);
    this.winModel = winModel;
    this.showModel = showModel;
    this.trained = true;

    const inSample = evaluateRaces(
      races.map(r => scoreRace(r.samples, winModel, showModel))
    );

    this.modelStats = {
      trained: true,
      trainingRaces: races.length,
      trainingRunners: samples.length,
      win: this.winModel,
      show: this.showModel,
      featureImportance: this.computeFeatureImportance(this.winModel),
      inSample
    };

    printTrainingResults(this.modelStats);
    return this.modelStats;
  }

  /**
   * 特徴量寄与度（標準化係数の絶対値を正規化したもの）
   *
   * @remarks
   * 旧実装の「|ピアソン相関|」ではなく、実際に予測へ効いている係数の大きさ。
   * 特徴量が標準化済みなので係数同士を比較できる。
   */
  private computeFeatureImportance(model: LogisticModel | null): { name: string; value: number }[] {
    if (!model) return [];
    const abs = model.weights.map(w => Math.abs(w));
    const sum = sumOf(abs) || 1;
    return FEATURE_NAMES.map((name, i) => ({ name, value: (abs[i] ?? 0) / sum })).sort(
      (a, b) => b.value - a.value
    );
  }


  // ----------------------------------------------------------
  // walk-forward 検証
  // ----------------------------------------------------------
  /**
   * walk-forward 検証
   *
   * @param options - ブロック数・最小学習レース数・λ候補・温度スケーリングの有無
   *
   * @remarks
   * λ は各ブロックの **学習窓の内側分割** で選ぶ（検証ブロックのデータは使わない）。
   * 学習レース数が `minTrainRaces` に満たないブロックはスキップし、総合指標から外す。
   */
  walkForwardValidate(options: WalkForwardOptions = {}): WalkForwardResult {
    return runWalkForwardValidation(this.collectTrainingRaces(), options);
  }


  // ----------------------------------------------------------
  // 予測
  // ----------------------------------------------------------

  /**
   * レースの予測を実行
   *
   * @param raceId - レースID
   * @param asOf - 評価基準日（省略時は当該レースの race_date）
   * @returns 単勝確率の降順で並べた予測結果。モデル未学習時は空配列
   */
  async predict(raceId: number, asOf?: string): Promise<PredictionResult[]> {
    // 現在のモデルが「このレースを除外して学習したもの」でなければ学習し直す。
    // `!this.trained` だけで判定すると、同じインスタンスで predict(A) → predict(B) したとき
    // B が学習データに入ったままのモデルで予測され、静かに自己学習になる。
    if (!this.trained || this.trainedExcludeRaceId !== raceId) {
      // 予測対象レース自身は学習から外す（自己学習で確率が過信になるのを防ぐ）
      await this.trainModels({}, raceId);
    }

    const set = this.featureBuilder.buildForRace(raceId, asOf);
    if (!set || set.rows.length === 0) return [];

    const importance = this.modelStats?.featureImportance ?? [];

    const winModel = this.winModel;
    const showModel = this.showModel;
    if (!winModel || !showModel) {
      // 未学習時は「市場の暗黙確率」をそのまま返す（捏造はしない）
      return predictFromMarket(set.rows, importance);
    }

    return predictWithModels(set.rows, { win: winModel, show: showModel }, importance);
  }

  /** モデルが学習済みか */
  isTrained(): boolean {
    return this.trained;
  }

  getModelStats(): ModelStats | null {
    return this.modelStats;
  }

  // ----------------------------------------------------------
  // 表示
  // ----------------------------------------------------------

  /** walk-forward の結果を表示 */
  displayWalkForward(result: WalkForwardResult): void {
    printWalkForward(result);
  }

  /** 採用ゲートの判定を表示 */
  displayGate(gate: AdoptionGate): void {
    printGate(gate);
  }

  // ----------------------------------------------------------
  // クロスチェック
  // ----------------------------------------------------------
  /** スコアリング結果とのクロスチェック */
  async crossCheckWithScoring(
    raceId: number,
    scoringResults: { horseId: number; totalScore: number }[]
  ): Promise<void> {
    printCrossCheck(await this.predict(raceId), scoringResults);
  }


  // ----------------------------------------------------------
  // ルールベース重みの説明用射影（予測器ではない）
  // ----------------------------------------------------------

  /** 現在のスコアリング重み */
  getCurrentWeights(): number[] {
    return currentScoreWeights();
  }

  /**
   * ルールベース10要素の重みを着順スコアへ射影する（**説明用**）
   *
   * @deprecated
   * 予測には使わない。ML の確率予測は `predict()` / `walkForwardValidate()` を使うこと。
   * これは「10要素のうちどれが着順と線形に結びついているか」を人間が読むための
   * in-sample な射影であり、汎化性能の指標ではない（docs/MODELS.md 参照）。
   */  async optimizeWeights(lambda: number = 0.1): Promise<{
    weights: number[];
    featureNames: string[];
    improvement: number;
    comparison: WeightComparison[];
  }> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 ルールベース重みの説明用射影（リッジ回帰・in-sample）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  これは予測モデルではありません。');
    console.log('    汎化性能は `ml --validate`（walk-forward）で確認してください。\n');

    const projection = projectRuleWeights(this.collectTrainingRaces(), lambda);
    if (!projection) {
      console.log('⚠️  射影に必要なデータが不足しています（最低20件必要）');
      return {
        weights: currentScoreWeights(),
        featureNames: [...RULE_FEATURE_NAMES],
        improvement: 0,
        comparison: []
      };
    }

    console.log(`📊 対象データ: ${projection.dataCount}件 / λ = ${lambda}\n`);
    this.learnedWeights = projection.weights;
    printProjectionResults(projection.comparison, projection.improvement);

    return {
      weights: projection.weights,
      featureNames: [...RULE_FEATURE_NAMES],
      improvement: projection.improvement,
      comparison: projection.comparison
    };
  }

  /**
   * 簡易射影（インポート後の自動実行用）
   *
   * @remarks
   * `optimizeWeights` と同じ説明用射影の数値だけを返す軽量版。
   * @returns 対象データ数と in-sample の誤差改善率
   */  runQuickOptimization(): { dataCount: number; improvement: number } | null {
    try {
      const projection = projectRuleWeights(this.collectTrainingRaces(), 0.1);
      if (!projection) return null;
      return { dataCount: projection.dataCount, improvement: projection.improvement };
    } catch (error) {
      console.warn(
        `⚠️  重み射影をスキップしました: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /** 最適化重みを ScoringConstants 形式で出力 */
  getOptimizedWeightsAsConstants(): string {
    return formatWeightsAsConstants(this.learnedWeights);
  }

  close(): void {
    if (this.ownsConnection && this.connection) {
      this.connection.close();
    }
  }
}
export {
  DEFAULT_L2,
  DEFAULT_MIN_TRAIN_RACES,
  MIN_TRAINING_SAMPLES,
  MIN_WALK_FORWARD_RACES
} from './MachineLearningConstants';
