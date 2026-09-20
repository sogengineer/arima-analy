/**
 * 市場暗黙確率（オッズ / 人気順位）のテスト
 */

import { describe, it, expect } from 'bun:test';
import {
  hasCompleteOdds,
  popularityImpliedProbabilities,
  popularityWinRate,
  raceMarketProbabilities,
  POPULARITY_WIN_RATES
} from '../MarketProbability';

/** 配列の総和（加算順は配列順のまま） */
function sumOf(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

describe('hasCompleteOdds', () => {
  it('全馬に有効なオッズがあれば true', () => {
    expect(hasCompleteOdds([1.5, 3.0, 12.4])).toBe(true);
  });

  it('1頭でも欠けていれば false（勝ち馬だけオッズがある状態を弾く）', () => {
    expect(hasCompleteOdds([null, null, 50.6, null])).toBe(false);
    expect(hasCompleteOdds([1.5, 3.0, null])).toBe(false);
  });

  it('1.0倍は有効（JRAの単勝最低オッズ）、1未満は無効として扱う', () => {
    expect(hasCompleteOdds([1.0, 3.0])).toBe(true);
    expect(hasCompleteOdds([0.9, 3.0])).toBe(false);
    expect(hasCompleteOdds([0, 3.0])).toBe(false);
  });

  it('1頭以下は false', () => {
    expect(hasCompleteOdds([2.0])).toBe(false);
    expect(hasCompleteOdds([])).toBe(false);
  });
});

describe('popularityWinRate', () => {
  it('人気順に単調減少する', () => {
    for (let p = 1; p < POPULARITY_WIN_RATES.length; p++) {
      expect(popularityWinRate(p)).toBeGreaterThanOrEqual(popularityWinRate(p + 1));
    }
  });

  it('テーブル範囲外でも有限の正値を返す', () => {
    expect(popularityWinRate(30)).toBeGreaterThan(0);
    expect(popularityWinRate(0)).toBeGreaterThan(0);
  });
});

describe('popularityImpliedProbabilities', () => {
  it('合計1で、人気順に単調減少する', () => {
    const probs = popularityImpliedProbabilities([3, 1, 2, 4]);
    expect(sumOf(probs)).toBeCloseTo(1, 12);
    // index1 が1番人気
    expect(probs[1]).toBeGreaterThan(probs[2]);
    expect(probs[2]).toBeGreaterThan(probs[0]);
    expect(probs[0]).toBeGreaterThan(probs[3]);
  });

  it('全馬欠損なら一様分布', () => {
    const probs = popularityImpliedProbabilities([null, null, null, null]);
    for (const p of probs) {
      expect(p).toBeCloseTo(0.25, 12);
    }
  });

  it('空配列は空配列', () => {
    expect(popularityImpliedProbabilities([])).toEqual([]);
  });
});

describe('raceMarketProbabilities', () => {
  it('全馬にオッズがあればオッズから算出する', () => {
    const result = raceMarketProbabilities([2.0, 4.0, 8.0], [1, 2, 3]);
    expect(result.source).toBe('odds');
    expect(sumOf(result.probabilities)).toBeCloseTo(1, 12);
    expect(result.probabilities[0]).toBeGreaterThan(result.probabilities[1]);
  });

  it('勝ち馬だけオッズがあるレースではオッズを使わず人気順位から算出する', () => {
    // 結果ページ由来の確定オッズ（1着馬のみ）が混入した状態
    const odds = [null, null, 50.6, null];
    const popularity = [1, 2, 12, 3];
    const result = raceMarketProbabilities(odds, popularity);

    expect(result.source).toBe('popularity');
    expect(sumOf(result.probabilities)).toBeCloseTo(1, 12);
    // 12番人気（＝実際の勝ち馬）が最上位確率にならないこと
    const maxIndex = result.probabilities.indexOf(Math.max(...result.probabilities));
    expect(maxIndex).toBe(0);
    expect(result.probabilities[2]).toBeLessThan(result.probabilities[0]);
  });

  it('オッズも人気も無ければ一様分布', () => {
    const result = raceMarketProbabilities([null, null], [null, null]);
    expect(result.source).toBe('uniform');
    for (const p of result.probabilities) {
      expect(p).toBeCloseTo(0.5, 12);
    }
  });

  it('空レースは空配列', () => {
    expect(raceMarketProbabilities([], []).probabilities).toEqual([]);
  });
});
