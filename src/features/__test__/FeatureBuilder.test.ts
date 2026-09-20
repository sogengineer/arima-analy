/**
 * FeatureBuilder のテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../test/helpers/testDb';
import { seedSyntheticRaces } from '../../test/helpers/syntheticRaces';
import {
  FeatureBuilder,
  FEATURE_DIMENSION,
  FEATURE_NAMES,
  marketImpliedProbabilities
} from '../FeatureBuilder';

/** 配列の総和（加算順は配列順のまま） */
function sumOf(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

describe('marketImpliedProbabilities', () => {
  it('合計が1になる（控除率が除去される）', () => {
    // 生の暗黙確率は 1/2 + 1/4 + 1/5 = 0.95 ではなく控除率ぶん1を超えるケース
    const probs = marketImpliedProbabilities([2.0, 4.0, 5.0, 10.0]);
    expect(sumOf(probs)).toBeCloseTo(1, 12);
  });

  it('低いオッズほど高い確率になる', () => {
    const probs = marketImpliedProbabilities([1.5, 3.0, 20.0]);
    expect(probs[0]).toBeGreaterThan(probs[1]);
    expect(probs[1]).toBeGreaterThan(probs[2]);
  });

  it('控除率25%の市場でも正規化後は合計1', () => {
    // 真の確率 [0.5, 0.3, 0.2] に控除率25%を掛けたオッズ
    const trueProbs = [0.5, 0.3, 0.2];
    const odds = trueProbs.map(p => 0.75 / p);
    const implied = marketImpliedProbabilities(odds);
    expect(sumOf(implied)).toBeCloseTo(1, 12);
    for (let i = 0; i < implied.length; i++) {
      expect(implied[i]).toBeCloseTo(trueProbs[i], 10);
    }
  });

  it('欠損オッズは既知馬の平均で補完してから正規化する', () => {
    const probs = marketImpliedProbabilities([2.0, null, 4.0]);
    expect(sumOf(probs)).toBeCloseTo(1, 12);
    expect(probs.every(p => p > 0)).toBe(true);
  });

  it('全馬欠損なら一様分布', () => {
    const probs = marketImpliedProbabilities([null, null, null, null]);
    for (const p of probs) {
      expect(p).toBeCloseTo(0.25, 12);
    }
  });

  it('不正なオッズ（1以下）は欠損扱い', () => {
    const probs = marketImpliedProbabilities([0, -1, 3.0]);
    expect(sumOf(probs)).toBeCloseTo(1, 12);
  });

  it('空配列は空配列', () => {
    expect(marketImpliedProbabilities([])).toEqual([]);
  });
});

describe('FeatureBuilder', () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDb('feature-builder');
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it('全出走馬ぶんの特徴量ベクトルを返す', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 8,
      seed: 31
    });
    const builder = new FeatureBuilder(testDb.db);
    const set = builder.buildForRace(raceIds[5])!;

    expect(set.rows).toHaveLength(8);
    expect(set.asOf).toBe(set.raceDate);
    expect(set.rows.every(r => r.vector.length === FEATURE_DIMENSION)).toBe(true);
    expect(set.rows.every(r => r.vector.every(v => Number.isFinite(v)))).toBe(true);
  });

  it('市場暗黙確率はレース内で合計1', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 4,
      horsesPerRace: 10,
      seed: 32
    });
    const set = new FeatureBuilder(testDb.db).buildForRace(raceIds[3])!;
    const total = sumOf(set.rows.map(r => r.features.marketImpliedProb));
    expect(total).toBeCloseTo(1, 10);
  });

  it('レース内相対化: z-score の平均はほぼ0', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 10,
      seed: 33
    });
    const set = new FeatureBuilder(testDb.db).buildForRace(raceIds[5])!;

    const ruleZ = set.rows.map(r => r.features.ruleTotalZ);
    expect(sumOf(ruleZ) / ruleZ.length).toBeCloseTo(0, 8);
  });

  it('レース内順位は 0（最上位）〜1（最下位）に正規化される', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 4,
      horsesPerRace: 8,
      seed: 34
    });
    const set = new FeatureBuilder(testDb.db).buildForRace(raceIds[3])!;

    const ranks = set.rows.map(r => r.features.ruleTotalRankNorm).sort((a, b) => a - b);
    expect(ranks[0]).toBe(0);
    expect(ranks[ranks.length - 1]).toBe(1);

    // 順位が高い（0に近い）ほどルール総合スコアが高い
    const sorted = [...set.rows].sort(
      (a, b) => a.features.ruleTotalRankNorm - b.features.ruleTotalRankNorm
    );
    expect(sorted[0].features.ruleTotalScore).toBeGreaterThanOrEqual(
      sorted[sorted.length - 1].features.ruleTotalScore
    );
  });

  it('初回レースでは前走系が欠損フラグになる', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 3,
      horsesPerRace: 8,
      horsePool: 24,
      seed: 35
    });
    const set = new FeatureBuilder(testDb.db).buildForRace(raceIds[0])!;

    expect(set.rows.every(r => r.features.hasPrevRace === 0)).toBe(true);
    expect(set.rows.every(r => r.features.prevFinishInv === 0)).toBe(true);
    expect(set.rows.every(r => r.features.daysSincePrevLog === 0)).toBe(true);
    // 欠損時は中間値0.5
    expect(set.rows.every(r => r.features.prevFinishRel === 0.5)).toBe(true);
  });

  it('2回目以降の出走では前走系が埋まる', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 8,
      horsesPerRace: 6,
      horsePool: 6,
      seed: 36
    });
    const set = new FeatureBuilder(testDb.db).buildForRace(raceIds[7])!;

    expect(set.rows.every(r => r.features.hasPrevRace === 1)).toBe(true);
    expect(set.rows.every(r => r.features.daysSincePrevLog > 0)).toBe(true);
    expect(set.rows.every(r => r.features.prevFinishInv > 0)).toBe(true);
  });

  it('ルールベース10要素を派生特徴として同梱する', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 5,
      horsesPerRace: 8,
      seed: 37
    });
    const set = new FeatureBuilder(testDb.db).buildForRace(raceIds[4])!;

    for (const row of set.rows) {
      const scores = row.features.ruleScores;
      expect(Object.keys(scores)).toContain('recentPerformanceScore');
      expect(Object.keys(scores)).toContain('trainerScore');
      // 0-100 の範囲
      expect(scores.recentPerformanceScore).toBeGreaterThanOrEqual(0);
      expect(scores.recentPerformanceScore).toBeLessThanOrEqual(100);
    }
  });

  it('asOf を明示すると、その日より前のデータだけで組む', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 8,
      horsesPerRace: 6,
      horsePool: 6,
      seed: 38
    });
    const builder = new FeatureBuilder(testDb.db);
    const targetRaceId = raceIds[7];

    const natural = builder.buildForRace(targetRaceId)!;
    // 極端に古い asOf を指定すると履歴が無くなる
    const veryEarly = builder.buildForRace(targetRaceId, '2000-01-01')!;

    expect(natural.rows.every(r => r.features.hasPrevRace === 1)).toBe(true);
    expect(veryEarly.rows.every(r => r.features.hasPrevRace === 0)).toBe(true);
    expect(veryEarly.asOf).toBe('2000-01-01');
  });

  it('存在しないレースは null', () => {
    const builder = new FeatureBuilder(testDb.db);
    expect(builder.buildForRace(99999)).toBeNull();
  });

  it('通算成績は出走表の値をそのまま使う（レース前に確定済み）', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 8,
      horsesPerRace: 6,
      horsePool: 6,
      seed: 39
    });
    const builder = new FeatureBuilder(testDb.db);

    const first = builder.buildForRace(raceIds[0])!;
    const last = builder.buildForRace(raceIds[7])!;

    const firstRuns = sumOf(first.rows.map(r => r.features.careerRunsLog));
    const lastRuns = sumOf(last.rows.map(r => r.features.careerRunsLog));
    expect(firstRuns).toBe(0);
    expect(lastRuns).toBeGreaterThan(0);
  });
});

/**
 * 「勝ち馬だけ win_odds がある」状態のリーク回帰テスト
 *
 * JRAの過去レース結果ページには全馬の事前単勝オッズが無く、
 * 払戻金から復元できるのは1着馬の確定オッズだけ。
 * それが `race_entries.win_odds` に入ってしまうと
 * 「win_odds が非null ⇔ 勝ち馬」という look-ahead リークになる。
 */
describe('FeatureBuilder: 市場オッズの部分欠損（勝ち馬のみオッズあり）', () => {
  let testDb: TestDatabase;

  /** オッズ由来の特徴量のインデックス（人気由来は含めない） */
  const ODDS_FEATURE_NAMES = ['log単勝オッズ', 'オッズ順位', 'オッズ有無'];

  beforeEach(() => {
    testDb = createTestDb('feature-builder-partial-odds');
  });

  afterEach(() => {
    testDb.cleanup();
  });

  /** 勝ち馬以外の win_odds を NULL にし、勝ち馬には確定オッズを入れる */
  function leaveOnlyWinnerOdds(raceId: number): void {
    testDb.db.prepare(`
      UPDATE race_entries SET win_odds = NULL
      WHERE race_id = ?
        AND id NOT IN (
          SELECT e.id FROM race_entries e
          JOIN race_results rr ON rr.entry_id = e.id
          WHERE e.race_id = ? AND rr.finish_position = 1
        )
    `).run(raceId, raceId);

    testDb.db.prepare(`
      UPDATE race_entries SET win_odds = (
        SELECT rr.final_win_odds FROM race_results rr WHERE rr.entry_id = race_entries.id
      )
      WHERE race_id = ? AND win_odds IS NOT NULL
    `).run(raceId);
  }

  /** 全馬の win_odds を NULL にする */
  function clearAllOdds(raceId: number): void {
    testDb.db.prepare('UPDATE race_entries SET win_odds = NULL WHERE race_id = ?').run(raceId);
  }

  it('オッズ由来の特徴量が勝ち馬と他馬で一切差にならない', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 8,
      resultRaces: 6,
      seed: 71
    });
    const targetRaceId = raceIds[5];
    leaveOnlyWinnerOdds(targetRaceId);

    const set = new FeatureBuilder(testDb.db).buildForRace(targetRaceId)!;

    // オッズは「全馬揃っている場合のみ」使うので、このレースでは使わない
    expect(set.marketProbSource).toBe('popularity');
    expect(set.rows.every(r => r.features.hasMarketOdds === 0)).toBe(true);
    expect(set.rows.every(r => r.features.winOdds === null)).toBe(true);

    // オッズ由来の特徴量はレース内で定数（＝勝ち馬を特定できない）
    for (const name of ODDS_FEATURE_NAMES) {
      const index = FEATURE_NAMES.indexOf(name);
      expect(index).toBeGreaterThanOrEqual(0);
      const values = set.rows.map(r => r.vector[index]);
      expect(new Set(values).size).toBe(1);
    }
  });

  it('勝ち馬だけオッズがある場合と全馬オッズが無い場合で特徴量ベクトルが完全一致する', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 8,
      resultRaces: 6,
      seed: 72
    });
    const targetRaceId = raceIds[5];
    const builder = new FeatureBuilder(testDb.db);

    leaveOnlyWinnerOdds(targetRaceId);
    const partial = builder.buildForRace(targetRaceId)!;

    clearAllOdds(targetRaceId);
    const none = builder.buildForRace(targetRaceId)!;

    const noneVectors = new Map(none.rows.map(r => [r.horseId, r.vector]));
    for (const row of partial.rows) {
      expect(row.vector).toEqual(noneVectors.get(row.horseId)!);
    }
  });

  it('全馬にオッズが揃っているレースではオッズを使う', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 6,
      horsesPerRace: 8,
      resultRaces: 6,
      seed: 73
    });
    const set = new FeatureBuilder(testDb.db).buildForRace(raceIds[5])!;

    expect(set.marketProbSource).toBe('odds');
    expect(set.rows.every(r => r.features.hasMarketOdds === 1)).toBe(true);
    expect(new Set(set.rows.map(r => r.features.logWinOdds)).size).toBeGreaterThan(1);
  });

  it('市場暗黙確率は人気由来でもレース内で合計1', () => {
    const { raceIds } = seedSyntheticRaces(testDb, {
      races: 4,
      horsesPerRace: 10,
      resultRaces: 4,
      seed: 74
    });
    const targetRaceId = raceIds[3];
    leaveOnlyWinnerOdds(targetRaceId);

    const set = new FeatureBuilder(testDb.db).buildForRace(targetRaceId)!;
    const total = sumOf(set.rows.map(r => r.features.marketImpliedProb));
    expect(total).toBeCloseTo(1, 10);
  });
});
