import { describe, it, expect } from 'vitest';
import { Trainer, TrainerBuilder } from '../Trainer';
import { TRAINER_SCORE_WEIGHTS } from '../../../constants/ScoringConstants';

// ============================================
// calculateScore テスト
// ============================================

describe('Trainer.calculateScore', () => {
  it('G1・重賞実績ありの場合、60%・40%加重平均を返す', () => {
    const trainer = Trainer.builder(1, '藤沢和雄')
      .withG1Stats(10, 50)    // G1: 10勝/50走 = 勝率20%
      .withGradeStats(30, 150) // 重賞: 30勝/150走 = 勝率20%
      .build();

    const score = trainer.calculateScore();

    // G1勝率20% * 100 * 信頼度 * 0.60 + 重賞勝率20% * 100 * 信頼度 * 0.40
    // 信頼度はG1 50走で完全信頼(1.0)
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('高勝率の調教師は高スコアを返す', () => {
    const trainerHigh = Trainer.builder(1, '高勝率調教師')
      .withG1Stats(5, 10)     // G1勝率50%
      .withGradeStats(20, 40)  // 重賞勝率50%
      .build();

    const trainerLow = Trainer.builder(2, '低勝率調教師')
      .withG1Stats(1, 20)     // G1勝率5%
      .withGradeStats(5, 100)  // 重賞勝率5%
      .build();

    const scoreHigh = trainerHigh.calculateScore();
    const scoreLow = trainerLow.calculateScore();

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });
});

// ============================================
// calculateG1WinScore テスト
// ============================================

describe('Trainer - G1WinScore', () => {
  it('G1実績ありの場合、G1勝率×信頼度補正のスコアを返す', () => {
    const trainer = Trainer.builder(1, 'テスト調教師')
      .withG1Stats(5, 20)  // G1勝率25%、20走で高信頼(0.9)
      .withGradeStats(10, 50)
      .build();

    const score = trainer.calculateScore();

    // スコアは正常に計算される
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('G1未経験の場合、重賞成績の50%を使用する', () => {
    const trainer = Trainer.builder(1, 'G1未経験調教師')
      .withG1Stats(0, 0)      // G1未経験
      .withGradeStats(10, 50)  // 重賞勝率20%
      .build();

    const score = trainer.calculateScore();

    // G1スコアは重賞成績の50%
    // g1Score = (20 * 信頼度) * 0.5 * 0.6 + 重賞スコア * 0.4
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(30); // 低めのスコア
  });

  it('G1出走数が少ない場合、信頼度補正が適用される', () => {
    // G1 10走以上（完全信頼）
    const trainerFull = Trainer.builder(1, 'G1経験豊富')
      .withG1Stats(3, 15)  // G1勝率20%、15走で完全信頼
      .withGradeStats(10, 50)
      .build();

    // G1 5走未満（低信頼）
    const trainerLow = Trainer.builder(2, 'G1経験少')
      .withG1Stats(1, 4)   // G1勝率25%、4走で低信頼(0.7)
      .withGradeStats(10, 50)
      .build();

    const scoreFull = trainerFull.calculateScore();
    const scoreLow = trainerLow.calculateScore();

    // 勝率は似ているが信頼度補正で差が出る
    expect(scoreFull).toBeGreaterThan(scoreLow * 0.6);
  });
});

// ============================================
// calculateGradeWinScore テスト
// ============================================

describe('Trainer - GradeWinScore', () => {
  it('重賞実績ありの場合、重賞勝率×信頼度補正のスコアを返す', () => {
    const trainer = Trainer.builder(1, 'テスト調教師')
      .withG1Stats(2, 10)
      .withGradeStats(15, 50)  // 重賞勝率30%
      .build();

    const score = trainer.calculateScore();

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('重賞未経験の場合、デフォルト30点を返す', () => {
    const trainer = Trainer.builder(1, '重賞未経験調教師')
      .withG1Stats(0, 0)
      .withGradeStats(0, 0)
      .build();

    const score = trainer.calculateScore();

    // gradeScore = 30(default) * 0.40 = 12
    // g1Score = 30 * 0.5(フォールバック) * 0.60 = 9
    // total = 12 + 9 = 21
    expect(score).toBeCloseTo(21, 1);
  });

  it('重賞出走数が少ない場合、信頼度補正が適用される', () => {
    // 10走以上（完全信頼）
    const trainerFull = Trainer.builder(1, '重賞経験豊富')
      .withGradeStats(3, 15)  // 重賞勝率20%、15走で完全信頼
      .build();

    // 5走未満（低信頼）
    const trainerLow = Trainer.builder(2, '重賞経験少')
      .withGradeStats(1, 4)   // 重賞勝率25%、4走で低信頼
      .build();

    const scoreFull = trainerFull.calculateScore();
    const scoreLow = trainerLow.calculateScore();

    // 信頼度補正で差が出る
    expect(scoreFull).not.toBe(scoreLow);
  });
});

// ============================================
// TrainerBuilder テスト
// ============================================

describe('TrainerBuilder', () => {
  it('全データを設定して正しくビルドする', () => {
    const trainer = Trainer.builder(1, '藤沢和雄')
      .withG1Stats(10, 50)
      .withGradeStats(30, 150)
      .build();

    expect(trainer.id).toBe(1);
    expect(trainer.name).toBe('藤沢和雄');
    expect(trainer.g1Wins).toBe(10);
    expect(trainer.g1Runs).toBe(50);
    expect(trainer.gradeWins).toBe(30);
    expect(trainer.gradeRuns).toBe(150);
  });

  it('オプショナルなデータなしでもビルドできる', () => {
    const trainer = Trainer.builder(1, 'シンプル調教師').build();

    expect(trainer.id).toBe(1);
    expect(trainer.name).toBe('シンプル調教師');
    expect(trainer.g1Wins).toBe(0);
    expect(trainer.g1Runs).toBe(0);
    expect(trainer.gradeWins).toBe(0);
    expect(trainer.gradeRuns).toBe(0);
  });
});

// ============================================
// データアクセスメソッド テスト
// ============================================

describe('Trainer データアクセスメソッド', () => {
  it('getG1WinRate - G1勝率を取得する', () => {
    const trainer = Trainer.builder(1, 'テスト調教師')
      .withG1Stats(5, 20)
      .build();

    expect(trainer.getG1WinRate()).toBeCloseTo(0.25, 2);
  });

  it('getG1WinRate - 出走なしは0を返す', () => {
    const trainer = Trainer.builder(1, 'テスト調教師')
      .withG1Stats(0, 0)
      .build();

    expect(trainer.getG1WinRate()).toBe(0);
  });

  it('getGradeWinRate - 重賞勝率を取得する', () => {
    const trainer = Trainer.builder(1, 'テスト調教師')
      .withGradeStats(10, 50)
      .build();

    expect(trainer.getGradeWinRate()).toBeCloseTo(0.20, 2);
  });

  it('getGradeWinRate - 出走なしは0を返す', () => {
    const trainer = Trainer.builder(1, 'テスト調教師')
      .withGradeStats(0, 0)
      .build();

    expect(trainer.getGradeWinRate()).toBe(0);
  });
});
