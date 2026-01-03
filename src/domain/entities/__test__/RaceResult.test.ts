import { describe, it, expect } from 'vitest';
import { RaceResult } from '../RaceResult';
import type { HorseRaceResult } from '../../../types/RepositoryTypes';

// ============================================
// テストデータ生成ヘルパー
// ============================================

function createRaceResult(overrides: Partial<HorseRaceResult> = {}): RaceResult {
  return new RaceResult({
    race_id: overrides.race_id ?? 1,
    race_name: overrides.race_name ?? 'テストレース',
    race_date: overrides.race_date ?? '2024-01-01',
    race_class: overrides.race_class,
    distance: overrides.distance ?? 2000,
    race_type: overrides.race_type ?? '芝',
    track_condition: overrides.track_condition ?? '良',
    venue_name: overrides.venue_name ?? '中山',
    jockey_id: overrides.jockey_id,
    popularity: overrides.popularity,
    finish_position: overrides.finish_position,
    finish_time: overrides.finish_time,
    last_3f_time: overrides.last_3f_time,
    time_diff_seconds: overrides.time_diff_seconds
  });
}

// ============================================
// isWin テスト
// ============================================

describe('RaceResult.isWin', () => {
  it('1着の場合、trueを返す', () => {
    const result = createRaceResult({ finish_position: 1 });
    expect(result.isWin()).toBe(true);
  });

  it('2着の場合、falseを返す', () => {
    const result = createRaceResult({ finish_position: 2 });
    expect(result.isWin()).toBe(false);
  });

  it('着順なしの場合、falseを返す', () => {
    const result = createRaceResult({ finish_position: undefined });
    expect(result.isWin()).toBe(false);
  });
});

// ============================================
// isPlace テスト
// ============================================

describe('RaceResult.isPlace', () => {
  it('1着の場合、trueを返す', () => {
    const result = createRaceResult({ finish_position: 1 });
    expect(result.isPlace()).toBe(true);
  });

  it('2着の場合、trueを返す', () => {
    const result = createRaceResult({ finish_position: 2 });
    expect(result.isPlace()).toBe(true);
  });

  it('3着の場合、falseを返す', () => {
    const result = createRaceResult({ finish_position: 3 });
    expect(result.isPlace()).toBe(false);
  });

  it('着順なしの場合、falseを返す', () => {
    const result = createRaceResult({ finish_position: undefined });
    expect(result.isPlace()).toBe(false);
  });
});

// ============================================
// isShow テスト
// ============================================

describe('RaceResult.isShow', () => {
  it('1着の場合、trueを返す', () => {
    const result = createRaceResult({ finish_position: 1 });
    expect(result.isShow()).toBe(true);
  });

  it('2着の場合、trueを返す', () => {
    const result = createRaceResult({ finish_position: 2 });
    expect(result.isShow()).toBe(true);
  });

  it('3着の場合、trueを返す', () => {
    const result = createRaceResult({ finish_position: 3 });
    expect(result.isShow()).toBe(true);
  });

  it('4着の場合、falseを返す', () => {
    const result = createRaceResult({ finish_position: 4 });
    expect(result.isShow()).toBe(false);
  });

  it('着順なしの場合、falseを返す', () => {
    const result = createRaceResult({ finish_position: undefined });
    expect(result.isShow()).toBe(false);
  });
});

// ============================================
// isG1 テスト
// ============================================

describe('RaceResult.isG1', () => {
  it('race_classがG1を含む場合、trueを返す', () => {
    const result = createRaceResult({ race_class: 'G1' });
    expect(result.isG1()).toBe(true);
  });

  it('race_classがGIを含む場合、trueを返す', () => {
    const result = createRaceResult({ race_class: 'GI' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名が有馬記念を含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: '第69回有馬記念' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名がダービーを含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: '日本ダービー' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名が天皇賞を含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: '天皇賞（秋）' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名がジャパンカップを含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: 'ジャパンカップ' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名が宝塚記念を含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: '宝塚記念' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名が菊花賞を含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: '菊花賞' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名が皐月賞を含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: '皐月賞' });
    expect(result.isG1()).toBe(true);
  });

  it('レース名がオークスを含む場合、trueを返す', () => {
    const result = createRaceResult({ race_name: 'オークス' });
    expect(result.isG1()).toBe(true);
  });

  it('race_classがG2の場合、falseを返す', () => {
    const result = createRaceResult({ race_class: 'G2' });
    expect(result.isG1()).toBe(false);
  });

  it('オープンレースの場合、falseを返す', () => {
    const result = createRaceResult({ race_class: 'オープン', race_name: '新馬戦' });
    expect(result.isG1()).toBe(false);
  });
});

// ============================================
// getDistanceDiff テスト
// ============================================

describe('RaceResult.getDistanceDiff', () => {
  it('同距離の場合、0を返す', () => {
    const result = createRaceResult({ distance: 2000 });
    expect(result.getDistanceDiff(2000)).toBe(0);
  });

  it('目標より短い場合、正の値を返す', () => {
    const result = createRaceResult({ distance: 1800 });
    expect(result.getDistanceDiff(2000)).toBe(200);
  });

  it('目標より長い場合、正の値を返す', () => {
    const result = createRaceResult({ distance: 2200 });
    expect(result.getDistanceDiff(2000)).toBe(200);
  });

  it('大きな差がある場合、正確に計算する', () => {
    const result = createRaceResult({ distance: 1200 });
    expect(result.getDistanceDiff(2500)).toBe(1300);
  });
});

// ============================================
// getPopularityDiff テスト
// ============================================

describe('RaceResult.getPopularityDiff', () => {
  it('1番人気で1着の場合、0を返す', () => {
    const result = createRaceResult({ popularity: 1, finish_position: 1 });
    expect(result.getPopularityDiff()).toBe(0);
  });

  it('5番人気で1着の場合、4（好走）を返す', () => {
    const result = createRaceResult({ popularity: 5, finish_position: 1 });
    expect(result.getPopularityDiff()).toBe(4);
  });

  it('1番人気で5着の場合、-4（凡走）を返す', () => {
    const result = createRaceResult({ popularity: 1, finish_position: 5 });
    expect(result.getPopularityDiff()).toBe(-4);
  });

  it('10番人気で3着の場合、7（好走）を返す', () => {
    const result = createRaceResult({ popularity: 10, finish_position: 3 });
    expect(result.getPopularityDiff()).toBe(7);
  });

  it('人気なしの場合、0を返す', () => {
    const result = createRaceResult({ popularity: undefined, finish_position: 1 });
    expect(result.getPopularityDiff()).toBe(0);
  });

  it('着順なしの場合、0を返す', () => {
    const result = createRaceResult({ popularity: 1, finish_position: undefined });
    expect(result.getPopularityDiff()).toBe(0);
  });
});

// ============================================
// プロパティアクセサ テスト
// ============================================

describe('RaceResult プロパティアクセサ', () => {
  it('全プロパティにアクセスできる', () => {
    const result = createRaceResult({
      race_id: 123,
      race_name: 'テストレース',
      race_date: '2024-12-22',
      race_class: 'G1',
      distance: 2500,
      race_type: '芝',
      track_condition: '良',
      venue_name: '中山',
      jockey_id: 1,
      popularity: 3,
      finish_position: 2,
      finish_time: '2:32.5',
      last_3f_time: 34.5,
      time_diff_seconds: 0.2
    });

    expect(result.raceId).toBe(123);
    expect(result.raceName).toBe('テストレース');
    expect(result.raceDate).toBe('2024-12-22');
    expect(result.raceClass).toBe('G1');
    expect(result.distance).toBe(2500);
    expect(result.raceType).toBe('芝');
    expect(result.trackCondition).toBe('良');
    expect(result.venueName).toBe('中山');
    expect(result.jockeyId).toBe(1);
    expect(result.popularity).toBe(3);
    expect(result.finishPosition).toBe(2);
    expect(result.finishTime).toBe('2:32.5');
    expect(result.last3FTime).toBe(34.5);
    expect(result.timeDiffSeconds).toBe(0.2);
  });
});

// ============================================
// toPlainObject テスト
// ============================================

describe('RaceResult.toPlainObject', () => {
  it('プレーンオブジェクトを返す', () => {
    const data: HorseRaceResult = {
      race_id: 1,
      race_name: 'テストレース',
      race_date: '2024-01-01',
      distance: 2000,
      venue_name: '中山',
      finish_position: 1,
      popularity: 1
    };
    const result = new RaceResult(data);

    const plain = result.toPlainObject();

    expect(plain).toEqual(data);
    expect(plain).not.toBe(data); // 新しいオブジェクトを返す
  });
});
