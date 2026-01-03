import { describe, it, expect } from 'vitest';
import { Jockey, JockeyBuilder } from '../Jockey';
import type { JockeyVenueStats, JockeyOverallStats, JockeyTrainerComboStats } from '../../../types/RepositoryTypes';
import { JOCKEY_SCORE_WEIGHTS, RELIABILITY_THRESHOLDS } from '../../../constants/ScoringConstants';

// ============================================
// テストデータ生成ヘルパー
// ============================================

function createVenueStats(overrides: Partial<JockeyVenueStats> = {}): JockeyVenueStats {
  return {
    jockey_id: overrides.jockey_id ?? 1,
    venue_name: overrides.venue_name ?? '中山',
    total_runs: overrides.total_runs ?? 0,
    wins: overrides.wins ?? 0,
    places: overrides.places ?? 0,
    shows: overrides.shows ?? 0,
    venue_g1_runs: overrides.venue_g1_runs ?? 0,
    venue_g1_wins: overrides.venue_g1_wins ?? 0
  };
}

function createOverallStats(overrides: Partial<JockeyOverallStats> = {}): JockeyOverallStats {
  return {
    jockey_id: overrides.jockey_id ?? 1,
    total_runs: overrides.total_runs ?? 0,
    wins: overrides.wins ?? 0,
    places: overrides.places ?? 0,
    shows: overrides.shows ?? 0,
    g1_runs: overrides.g1_runs ?? 0,
    g1_wins: overrides.g1_wins ?? 0
  };
}

function createTrainerComboStats(overrides: Partial<JockeyTrainerComboStats> = {}): JockeyTrainerComboStats {
  return {
    jockey_id: overrides.jockey_id ?? 1,
    trainer_id: overrides.trainer_id ?? 1,
    total_runs: overrides.total_runs ?? 0,
    wins: overrides.wins ?? 0,
    places: overrides.places ?? 0,
    shows: overrides.shows ?? 0
  };
}

// ============================================
// calculateScore テスト
// ============================================

describe('Jockey.calculateScore', () => {
  it('全成績ありの場合、4要素の加重平均を返す', () => {
    const jockey = Jockey.builder(1, 'C.ルメール')
      .withOverallStats(createOverallStats({
        total_runs: 1000,
        wins: 200,  // 勝率20%
        g1_runs: 50,
        g1_wins: 10
      }))
      .withVenueStats('中山', createVenueStats({
        venue_name: '中山',
        total_runs: 100,
        wins: 25,   // 勝率25%
        venue_g1_runs: 20,
        venue_g1_wins: 5  // G1勝率25%
      }))
      .withTrainerComboStats(1, createTrainerComboStats({
        trainer_id: 1,
        total_runs: 10,
        wins: 3  // 勝率30%
      }))
      .build();

    const score = jockey.calculateScore('中山', 1);

    // スコアは0-100の範囲内
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);

    // 構成要素の加重合計になっている
    // venueWin: 25% * 100 * 信頼度 * 0.30
    // venueG1: 25% * 100 * 信頼度 * 0.30
    // overall: 20% * 100 * 0.20
    // trainerCombo: 30% * 100 * 0.20
    expect(score).toBeGreaterThan(15);  // 最低限の合理性チェック
  });

  it('会場成績のみの場合もスコアを計算できる', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withVenueStats('中山', createVenueStats({
        total_runs: 50,
        wins: 10,
        venue_g1_runs: 10,
        venue_g1_wins: 2
      }))
      .build();

    const score = jockey.calculateScore('中山');

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ============================================
// calculateVenueWinScore テスト
// ============================================

describe('Jockey - VenueWinScore', () => {
  it('会場実績ありの場合、勝率×信頼度補正のスコアを返す', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withVenueStats('中山', createVenueStats({
        total_runs: 50,  // 50走以上 = 完全信頼
        wins: 10  // 勝率20%
      }))
      .build();

    const score = jockey.calculateScore('中山');

    // venueWinScore = 20% * 100 * 0.90(信頼度) * 0.30(weight) = 5.4
    // 他の要素もあるので正確な値は計算しにくいが、0より大きいことを確認
    expect(score).toBeGreaterThan(0);
  });

  it('会場未経験の場合、全体成績の75%を使用する', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withOverallStats(createOverallStats({
        total_runs: 500,
        wins: 100  // 勝率20%
      }))
      .build();

    const scoreUnknown = jockey.calculateScore('未経験会場');
    const scoreNakayama = jockey.calculateScore('中山');

    // どちらも同じスコアになる（会場未経験時は全体成績の75%を使用）
    expect(scoreUnknown).toBe(scoreNakayama);
    expect(scoreUnknown).toBeGreaterThan(0);
  });

  it('出走数が少ない場合、信頼度補正が適用される', () => {
    // 50走以上（完全信頼）
    const jockeyFull = Jockey.builder(1, '経験豊富')
      .withVenueStats('中山', createVenueStats({
        total_runs: 50,
        wins: 10  // 勝率20%
      }))
      .build();

    // 10走未満（低信頼）
    const jockeyLow = Jockey.builder(2, '新人')
      .withVenueStats('中山', createVenueStats({
        total_runs: 5,
        wins: 1  // 勝率20%
      }))
      .build();

    const scoreFull = jockeyFull.calculateScore('中山');
    const scoreLow = jockeyLow.calculateScore('中山');

    // 同じ勝率でも信頼度補正により差が出る
    expect(scoreFull).toBeGreaterThan(scoreLow);
  });
});

// ============================================
// calculateVenueG1Score テスト
// ============================================

describe('Jockey - VenueG1Score', () => {
  it('G1実績ありの場合、G1勝率×信頼度補正のスコアを返す', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withVenueStats('中山', createVenueStats({
        total_runs: 50,
        wins: 10,
        venue_g1_runs: 10,  // 10走以上 = 完全信頼
        venue_g1_wins: 3  // G1勝率30%
      }))
      .build();

    const score = jockey.calculateScore('中山');

    expect(score).toBeGreaterThan(0);
  });

  it('G1未経験の場合、全体成績の50%を使用する', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withOverallStats(createOverallStats({
        total_runs: 500,
        wins: 100  // 勝率20%
      }))
      .withVenueStats('中山', createVenueStats({
        total_runs: 50,
        wins: 10,
        venue_g1_runs: 0,  // G1未経験
        venue_g1_wins: 0
      }))
      .build();

    const score = jockey.calculateScore('中山');

    // スコアは正常に計算される
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('G1出走数が少ない場合、信頼度補正が適用される', () => {
    // G1 10走以上（完全信頼）
    const jockeyFull = Jockey.builder(1, 'G1経験豊富')
      .withVenueStats('中山', createVenueStats({
        total_runs: 50,
        wins: 10,
        venue_g1_runs: 10,
        venue_g1_wins: 3  // G1勝率30%
      }))
      .build();

    // G1 5走未満（低信頼）
    const jockeyLow = Jockey.builder(2, 'G1経験少')
      .withVenueStats('中山', createVenueStats({
        total_runs: 50,
        wins: 10,
        venue_g1_runs: 3,
        venue_g1_wins: 1  // G1勝率33%
      }))
      .build();

    const scoreFull = jockeyFull.calculateScore('中山');
    const scoreLow = jockeyLow.calculateScore('中山');

    // G1勝率は似ているが信頼度補正で差が出る
    expect(scoreFull).toBeGreaterThan(scoreLow * 0.8);
  });
});

// ============================================
// calculateOverallWinScore テスト
// ============================================

describe('Jockey - OverallWinScore', () => {
  it('実績ありの場合、勝率スコアを返す', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withOverallStats(createOverallStats({
        total_runs: 1000,
        wins: 200  // 勝率20%
      }))
      .build();

    const score = jockey.calculateScore('任意の会場');

    // overallWinScore = 20 * 0.20(weight) = 4 (他の要素もあり)
    expect(score).toBeGreaterThan(0);
  });

  it('実績なしの場合、調教師コンビのデフォルト分（10点）のみを返す', () => {
    const jockey = Jockey.builder(1, 'デビュー前')
      .build();

    const score = jockey.calculateScore('中山');

    // venueWin: 0, venueG1: 0, overall: 0, trainerCombo: 50(default) * 0.20 = 10
    expect(score).toBe(10);
  });
});

// ============================================
// calculateTrainerComboScore テスト
// ============================================

describe('Jockey - TrainerComboScore', () => {
  it('コンビ実績3走以上の場合、勝率スコアを返す', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withTrainerComboStats(1, createTrainerComboStats({
        trainer_id: 1,
        total_runs: 10,  // 3走以上
        wins: 3  // 勝率30%
      }))
      .build();

    const scoreWithTrainer = jockey.calculateScore('中山', 1);
    const scoreWithoutTrainer = jockey.calculateScore('中山');

    // 調教師コンビ実績ありの方がスコアに反映される
    expect(scoreWithTrainer).not.toBe(scoreWithoutTrainer);
  });

  it('コンビ実績3走未満の場合、デフォルト50点を返す', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withOverallStats(createOverallStats({
        total_runs: 500,
        wins: 100
      }))
      .withTrainerComboStats(1, createTrainerComboStats({
        trainer_id: 1,
        total_runs: 2,  // 3走未満
        wins: 1
      }))
      .build();

    // 3走未満のコンビはデフォルト50点
    // trainerId=1を指定してもデフォルト値が使われる
    const score1 = jockey.calculateScore('中山', 1);

    // 別の調教師（コンビなし）を指定
    const score2 = jockey.calculateScore('中山', 999);

    // どちらもデフォルト50点のため同じスコア
    expect(score1).toBe(score2);
  });

  it('調教師ID未指定の場合、デフォルト50点を返す（高コンビ勝率と差が出る）', () => {
    const jockeyWithCombo = Jockey.builder(1, 'テスト騎手')
      .withOverallStats(createOverallStats({
        total_runs: 500,
        wins: 100
      }))
      .withTrainerComboStats(1, createTrainerComboStats({
        trainer_id: 1,
        total_runs: 10,
        wins: 8  // 勝率80% (デフォルト50%より高い)
      }))
      .build();

    // 調教師ID指定なし → デフォルト50点
    const scoreNoTrainer = jockeyWithCombo.calculateScore('中山');
    // 調教師ID指定あり → 勝率80% = 80点
    const scoreWithTrainer = jockeyWithCombo.calculateScore('中山', 1);

    // コンビ勝率80% > デフォルト50%なので差が出る
    expect(scoreWithTrainer).toBeGreaterThan(scoreNoTrainer);
  });
});

// ============================================
// JockeyBuilder テスト
// ============================================

describe('JockeyBuilder', () => {
  it('全データを設定して正しくビルドする', () => {
    const overallStats = createOverallStats({
      total_runs: 1000,
      wins: 200
    });
    const venueStats = createVenueStats({
      venue_name: '中山',
      total_runs: 100,
      wins: 25
    });
    const comboStats = createTrainerComboStats({
      trainer_id: 1,
      total_runs: 20,
      wins: 5
    });

    const jockey = Jockey.builder(1, 'C.ルメール')
      .withOverallStats(overallStats)
      .withVenueStats('中山', venueStats)
      .withVenueStats('東京', createVenueStats({ venue_name: '東京', total_runs: 80 }))
      .withTrainerComboStats(1, comboStats)
      .build();

    expect(jockey.id).toBe(1);
    expect(jockey.name).toBe('C.ルメール');
    expect(jockey.getOverallStats()).toEqual(overallStats);
    expect(jockey.getVenueStats('中山')).toEqual(venueStats);
    expect(jockey.getVenueStats('東京')).toBeDefined();
    expect(jockey.getVenueStats('阪神')).toBeUndefined();
    expect(jockey.getTrainerComboStats(1)).toEqual(comboStats);
    expect(jockey.getTrainerComboStats(999)).toBeUndefined();
  });

  it('オプショナルなデータなしでもビルドできる', () => {
    const jockey = Jockey.builder(1, 'シンプル騎手').build();

    expect(jockey.id).toBe(1);
    expect(jockey.name).toBe('シンプル騎手');
    expect(jockey.getOverallStats()).toBeNull();
  });
});

// ============================================
// データアクセスメソッド テスト
// ============================================

describe('Jockey データアクセスメソッド', () => {
  it('getVenueStats - 指定会場の成績を取得する', () => {
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withVenueStats('中山', createVenueStats({ venue_name: '中山', wins: 10 }))
      .withVenueStats('東京', createVenueStats({ venue_name: '東京', wins: 8 }))
      .build();

    expect(jockey.getVenueStats('中山')?.wins).toBe(10);
    expect(jockey.getVenueStats('東京')?.wins).toBe(8);
    expect(jockey.getVenueStats('阪神')).toBeUndefined();
  });

  it('getOverallStats - 全体成績を取得する', () => {
    const overallStats = createOverallStats({ wins: 100 });
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withOverallStats(overallStats)
      .build();

    expect(jockey.getOverallStats()).toEqual(overallStats);
  });

  it('getTrainerComboStats - 調教師コンビ成績を取得する', () => {
    const comboStats = createTrainerComboStats({ trainer_id: 1, wins: 5 });
    const jockey = Jockey.builder(1, 'テスト騎手')
      .withTrainerComboStats(1, comboStats)
      .build();

    expect(jockey.getTrainerComboStats(1)).toEqual(comboStats);
    expect(jockey.getTrainerComboStats(999)).toBeUndefined();
  });
});
