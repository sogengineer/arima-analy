/**
 * レース1件に確率を付与する（本体モデルと3種のベースライン）
 */

import type { RaceFeatureSet } from '@/features/FeatureBuilder';
import type {
  LogisticModel,
  PredictionResult,
  ScoredRace,
  TrainingSample
} from './MachineLearningTypes';
import { calibrateShowProbabilities, maskToMarketFeatures, softmax } from './MachineLearningMath';
import { linearScore, predictProbability } from './LogisticRegression';

/**
 * レース1件に確率を付与
 *
 * @remarks
 * 単勝は線形スコアのレース内 softmax（conditional logit）。
 * 複勝は二値ロジスティックの確率をレース内で合計3に較正。
 */
export function scoreRace(
  samples: TrainingSample[],
  winModel: LogisticModel,
  showModel: LogisticModel
): ScoredRace {
  const winProbs = softmax(samples.map(s => linearScore(winModel, s.vector)));
  const showProbs = calibrateShowProbabilities(
    samples.map(s => predictProbability(showModel, s.vector))
  );
  return { samples, winProbs, showProbs };
}

/**
 * 特徴量をマスクした同型モデルでレース1件に確率を付与する
 *
 * @remarks
 * 「市場のみモデル」「小モデル」のように、次元は同じまま一部の特徴量だけを
 * 使うベースラインを、本体とまったく同じ softmax / 較正経路で評価するための入口。
 */
export function scoreRaceWithMask(
  samples: TrainingSample[],
  models: { win: LogisticModel; show: LogisticModel },
  mask: (vector: number[]) => number[]
): ScoredRace {
  const masked = samples.map(s => mask(s.vector));
  const winProbs = softmax(masked.map(v => linearScore(models.win, v)));
  const showProbs = calibrateShowProbabilities(
    masked.map(v => predictProbability(models.show, v))
  );
  return { samples, winProbs, showProbs };
}

/**
 * 人気別勝率テーブル・ベースライン（控除率補正済み暗黙確率）
 *
 * @remarks
 * `marketImpliedProb` は、全馬にオッズが揃っているレースではオッズから、
 * 揃っていないレースでは **人気別勝率の固定テーブル**（`POPULARITY_WIN_RATES`）から
 * 算出済み（`FeatureBuilder` 参照）。
 *
 * つまり実データ（事前オッズが無い）では、これは「市場」そのものではなく
 * **人気順位を教科書的な固定表で確率に直しただけのもの** である。
 * ML は同じ人気順位とこの暗黙確率を特徴量に持っているので、
 * この指標を下回るのはほぼ自明であり、採用ゲートの判定には使わない
 * （ゲート①は {@link scoreRaceByMarketModel} の学習済みベースラインを使う）。
 */
export function scoreRaceByMarket(samples: TrainingSample[]): ScoredRace {
  const winProbs = samples.map(s => s.features.marketImpliedProb);
  // 複勝は「上位3頭に入る確率」を単勝確率から近似（合計3へ較正）
  const showProbs = calibrateShowProbabilities(winProbs.map(p => Math.min(0.99, p * 3)));
  return { samples, winProbs, showProbs };
}

/**
 * ルールベース（10要素）のベースライン
 *
 * @remarks
 * 総合スコアのレース内 z-score を効用とみなして softmax に通す。
 * 順位付けは総合スコアそのものと一致するので top-1 比較に使える。
 */
export function scoreRaceByRule(samples: TrainingSample[]): ScoredRace {
  const winProbs = softmax(samples.map(s => s.features.ruleTotalZ));
  const showProbs = calibrateShowProbabilities(winProbs.map(p => Math.min(0.99, p * 3)));
  return { samples, winProbs, showProbs };
}

/**
 * 市場情報のみで学習した同型モデルのベースライン（採用ゲート①の比較対象）
 *
 * @remarks
 * 人気・オッズ系特徴量（{@link MARKET_FEATURE_INDICES}）以外をゼロにした
 * ベクトルで、本体とまったく同じ L2 ロジスティック + レース内 softmax を学習する。
 *
 * 固定の人気別勝率テーブルを相手にすると「同じ情報から表を学習し直しただけ」で
 * 勝ててしまうため、**同じ市場情報を同じ方法で学習したモデル** を基準にする。
 * ML がこれを上回って初めて「市場以外の情報が効いている」と言える。
 */
export function scoreRaceByMarketModel(
  samples: TrainingSample[],
  winModel: LogisticModel,
  showModel: LogisticModel
): ScoredRace {
  return scoreRaceWithMask(samples, { win: winModel, show: showModel }, maskToMarketFeatures);
}

/** 特徴量寄与度（全頭で共有する説明用の並び） */
type FeatureImportance = { name: string; value: number }[];

/** 市場の暗黙確率をそのまま返す（モデル未学習時。確率は捏造しない） */
export function predictFromMarket(
  rows: RaceFeatureSet['rows'],
  importance: FeatureImportance
): PredictionResult[] {
  return rows
    .map(row => ({
      horseId: row.horseId,
      horseName: row.horseName,
      horseNumber: row.horseNumber,
      winProbability: row.features.marketImpliedProb,
      showProbability: Math.min(1, row.features.marketImpliedProb * 3),
      marketImpliedProb: row.features.marketImpliedProb,
      ruleTotalScore: row.features.ruleTotalScore * 100,
      features: row.features,
      featureImportance: importance
    }))
    .sort((a, b) => b.winProbability - a.winProbability);
}

/** 学習済みモデルでレース内の確率を付け、単勝確率の降順で返す */
export function predictWithModels(
  rows: RaceFeatureSet['rows'],
  models: { win: LogisticModel; show: LogisticModel },
  importance: FeatureImportance
): PredictionResult[] {
  const logits = rows.map(row => linearScore(models.win, row.vector));
  const winProbs = softmax(logits);
  const showProbs = calibrateShowProbabilities(
    rows.map(row => predictProbability(models.show, row.vector))
  );

  return rows
    .map((row, i) => ({
      horseId: row.horseId,
      horseName: row.horseName,
      horseNumber: row.horseNumber,
      winProbability: winProbs[i],
      showProbability: showProbs[i],
      marketImpliedProb: row.features.marketImpliedProb,
      ruleTotalScore: row.features.ruleTotalScore * 100,
      features: row.features,
      featureImportance: importance
    }))
    .sort((a, b) => b.winProbability - a.winProbability);
}
