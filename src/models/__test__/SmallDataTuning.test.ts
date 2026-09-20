/**
 * 少データ向け調整のテスト（λ の nested 選択・最小学習件数・小モデル）
 *
 * @remarks
 * DB を経由せず `TrainingRace` を直接組み立てる。検証したいのは
 * 「どこのデータを見て λ を決めているか」「どのブロックを評価から外すか」という
 * **手続きの正しさ** であって、合成データ上の性能ではない。
 *
 * 中でも最重要なのが
 * 「λ 選択が検証ブロックのデータを使わない」ことの固定テスト。
 * ここが崩れると walk-forward の数値は汎化性能ではなくなる。
 */

import { describe, it, expect } from 'bun:test';
import type { MLFeatures, TrainingRace, TrainingSample } from '@/models/MachineLearningTypes';
import { emptyRuleScores, FEATURE_DIMENSION } from '@/features/featureSpec';
import {
  buildInnerFolds,
  DEFAULT_L2_CANDIDATES,
  tuneOnTrainWindow
} from '@/models/HyperparameterSelection';
import { runWalkForwardValidation } from '@/models/WalkForwardValidation';

/** 指定フィールドの合計（加算は先頭から順に行う） */
function sumBy<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

/** 決定論的PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 日付を n 日進める */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 最小限の MLFeatures（ベースライン計算に必要な項目だけ実値を入れる） */
function featuresFor(marketProb: number, ruleZ: number): MLFeatures {
  return {
    winOdds: null,
    logWinOdds: 0,
    marketImpliedProb: marketProb,
    oddsRankNorm: 0.5,
    popularityNorm: 0.5,
    hasPopularity: 1,
    hasMarketOdds: 0,
    marketProbSource: 'popularity',
    horseWeightZ: 0,
    weightChange: 0,
    assignedWeightRel: 0,
    assignedWeightZ: 0,
    hasHorseWeight: 0,
    careerRunsLog: 0,
    careerWinRate: 0,
    careerShowRate: 0,
    hasPrevRace: 1,
    prevFinishInv: 0,
    prevFinishRel: 0.5,
    prevLast3fRel: 0,
    prevMarginSeconds: 0,
    daysSincePrevLog: 0,
    fieldSizeLog: 0,
    ruleTotalScore: 0.5,
    ruleTotalZ: ruleZ,
    ruleTotalRankNorm: 0.5,
    ruleScores: emptyRuleScores()
  };
}

/**
 * 合成 `TrainingRace` 列を作る
 *
 * @remarks
 * 各馬に潜在能力を割り当て、特徴量0列にその能力（+ノイズ）を入れる。
 * 着順は能力順なので、モデルが学習できる信号が存在する。
 */
function buildRaces(count: number, horses = 8, seed = 7): TrainingRace[] {
  const rand = mulberry32(seed);
  const races: TrainingRace[] = [];

  for (let r = 0; r < count; r++) {
    const raceDate = addDays('2024-01-06', r * 7);
    const field = Array.from({ length: horses }, (_, i) => ({
      horseId: r * 100 + i,
      ability: rand()
    }));
    const ordered = [...field].sort((a, b) => b.ability + rand() * 0.4 - (a.ability + rand() * 0.4));
    const position = new Map(ordered.map((h, i) => [h.horseId, i + 1]));

    const samples: TrainingSample[] = field.map(h => {
      const pos = position.get(h.horseId) ?? horses;
      const vector = new Array<number>(FEATURE_DIMENSION).fill(0);
      vector[0] = h.ability;
      vector[1] = rand();
      vector[2] = 1 / horses;
      return {
        raceId: r,
        raceDate,
        horseId: h.horseId,
        horseName: `馬${h.horseId}`,
        vector,
        features: featuresFor(1 / horses, h.ability - 0.5),
        winLabel: pos === 1 ? 1 : 0,
        showLabel: pos <= 3 ? 1 : 0,
        finishPosition: pos,
        payoutWinOdds: null
      };
    });

    races.push({
      raceId: r,
      raceDate,
      raceName: `合成${r}`,
      marketProbSource: 'popularity',
      samples
    });
  }
  return races;
}

/** 検証ブロック（index >= from）のラベルを壊す（1着を最下位の馬に付け替える） */
function corruptLabelsFrom(races: TrainingRace[], from: number): TrainingRace[] {
  return races.map((race, i) => {
    if (i < from) return race;
    const last = race.samples.length - 1;
    return {
      ...race,
      samples: race.samples.map((s, j) => ({
        ...s,
        winLabel: j === last ? 1 : 0,
        showLabel: j >= last - 2 ? 1 : 0,
        finishPosition: race.samples.length - j
      }))
    };
  });
}

describe('buildInnerFolds', () => {
  it('内側 fold の学習区間は必ず検証区間より前にある', () => {
    const folds = buildInnerFolds(buildRaces(60), 3);

    expect(folds.length).toBeGreaterThan(0);
    for (const fold of folds) {
      // 学習は [0, validStart)、検証は [validStart, validEnd)
      expect(fold.validStart).toBeGreaterThan(0);
      expect(fold.validEnd).toBeGreaterThan(fold.validStart);
    }
    // fold は時系列順に拡大していく（rolling / expanding window）
    for (let i = 1; i < folds.length; i++) {
      expect(folds[i].validStart).toBeGreaterThanOrEqual(folds[i - 1].validEnd);
    }
  });

  it('学習サンプルが足りない学習窓では fold を作らない', () => {
    expect(buildInnerFolds(buildRaces(2), 3)).toHaveLength(0);
  });
});

describe('tuneOnTrainWindow', () => {
  it('候補の中から λ を選び、使った内側 fold 数を返す', () => {
    const result = tuneOnTrainWindow(buildRaces(60));

    expect(DEFAULT_L2_CANDIDATES).toContain(result.lambda);
    expect(result.innerFolds).toBeGreaterThan(0);
    expect(result.scores).toHaveLength(DEFAULT_L2_CANDIDATES.length);
    expect(result.scores.every(s => s.logLoss == null || Number.isFinite(s.logLoss))).toBe(true);
  });

  it('内側分割が作れないときは既定値へフォールバックし、それを innerFolds=0 で伝える', () => {
    const result = tuneOnTrainWindow(buildRaces(2));

    expect(result.innerFolds).toBe(0);
    expect(DEFAULT_L2_CANDIDATES).toContain(result.lambda);
    expect(result.scores.every(s => s.logLoss === null)).toBe(true);
  });

  it('学習窓より後ろのレースを足しても、同じ前半だけを渡せば選択は変わらない', () => {
    const races = buildRaces(80);
    const a = tuneOnTrainWindow(races.slice(0, 40));
    const b = tuneOnTrainWindow(corruptLabelsFrom(races, 40).slice(0, 40));

    expect(b.lambda).toBe(a.lambda);
  });
});

describe('runWalkForwardValidation（少データ調整）', () => {
  it('λ 選択は検証ブロックのデータを一切使わない（検証ブロックを壊しても λ が変わらない）', () => {
    const races = buildRaces(90, 8, 3);
    const options = { blocks: 4, minTrainRaces: 0 };

    const base = runWalkForwardValidation(races, options);
    expect(base.blocks.length).toBeGreaterThan(1);

    // 最終ブロックの検証区間だけを壊す。
    // walk-forward は拡大窓なので、先行ブロックの検証レースは後続ブロックの
    // **学習**データでもある。純粋に「どのブロックの学習窓にも入っていない区間」は
    // 最終ブロックの検証区間だけなので、そこを壊す。
    // λ 選択が学習窓しか見ていないなら、全ブロックの λ は1つも変わらないはず。
    const lastTestStart = base.blocks[base.blocks.length - 1].trainRaces;
    const corrupted = runWalkForwardValidation(corruptLabelsFrom(races, lastTestStart), options);

    expect(corrupted.blocks.map(b => b.lambda)).toEqual(base.blocks.map(b => b.lambda));
    // 壊したのは確かに評価へ効いている（＝テストが空振りしていない）
    expect(corrupted.overall.logLoss).not.toBe(base.overall.logLoss);
  });

  it('同じブロックの λ は tuneOnTrainWindow(学習窓) の結果と一致する', () => {
    const races = buildRaces(90, 8, 5);
    const result = runWalkForwardValidation(races, { blocks: 4, minTrainRaces: 0 });

    for (const block of result.blocks) {
      const expected = tuneOnTrainWindow(races.slice(0, block.trainRaces));
      expect(block.lambda).toBe(expected.lambda);
      expect(block.innerFolds).toBe(expected.innerFolds);
    }
  });

  it('最小学習レース数に満たないブロックはスキップし、総合指標から除外する', () => {
    const races = buildRaces(90, 8, 8);
    const all = runWalkForwardValidation(races, { blocks: 4, minTrainRaces: 0 });
    const limited = runWalkForwardValidation(races, { blocks: 4, minTrainRaces: 45 });

    expect(limited.minTrainRaces).toBe(45);
    expect(limited.skippedBlocks.length).toBeGreaterThan(0);
    expect(limited.blocks.length).toBe(all.blocks.length - limited.skippedBlocks.length);
    // スキップしたブロックの学習レース数は必ず下限未満
    expect(limited.skippedBlocks.every(b => b.trainRaces < 45)).toBe(true);
    // 総合指標はスキップ分を含まない
    expect(limited.overall.races).toBeLessThan(all.overall.races);
    expect(limited.overall.races).toBe(sumBy(limited.blocks, b => b.testRaces));
    // 較正テーブルも残ったブロックだけで作る
    expect(sumBy(limited.calibration, b => b.count)).toBe(limited.overall.runners);
  });

  it('全ブロックがスキップされたら理由つきで検証不成立にする', () => {
    const result = runWalkForwardValidation(buildRaces(30), { blocks: 3, minTrainRaces: 1000 });

    expect(result.insufficientReason).toContain('1000');
    expect(result.blocks).toHaveLength(0);
    expect(result.skippedBlocks.length).toBeGreaterThan(0);
    expect(result.gate.passed).toBe(false);
  });

  it('小モデルのベースラインを本体と同じレース数で並走させる', () => {
    const result = runWalkForwardValidation(buildRaces(90), { blocks: 4, minTrainRaces: 0 });

    expect(result.smallModelBaseline.races).toBe(result.overall.races);
    expect(result.smallModelBaseline.runners).toBe(result.overall.runners);
    expect(Number.isFinite(result.smallModelBaseline.logLoss)).toBe(true);
  });

  it('採用ゲートの2条件はどちらも市場のみモデルを基準にする', () => {
    const result = runWalkForwardValidation(buildRaces(90), { blocks: 4, minTrainRaces: 0 });
    const gate = result.gate;

    expect(gate.beatsMarketLogLoss).toBe(gate.mlLogLoss < gate.marketLogLoss);
    expect(gate.beatsMarketRanking).toBe(
      gate.mlTop1 >= gate.marketTop1 || gate.mlBrier <= gate.marketBrier
    );
    expect(gate.passed).toBe(gate.beatsMarketLogLoss && gate.beatsMarketRanking);
    // ルールベース top-1 は残るが判定には入らない
    expect(gate).toHaveProperty('ruleTop1');
  });
});
