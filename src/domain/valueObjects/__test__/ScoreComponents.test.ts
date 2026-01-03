import { describe, it, expect } from 'vitest';
import { ScoreComponents, ScoreComponentsData } from '../ScoreComponents';
import { SCORE_WEIGHTS } from '../../../constants/ScoringConstants';

// ============================================
// テストデータ生成ヘルパー
// ============================================

function createScoreComponentsData(overrides: Partial<ScoreComponentsData> = {}): ScoreComponentsData {
  return {
    recentPerformanceScore: overrides.recentPerformanceScore ?? 50,
    venueAptitudeScore: overrides.venueAptitudeScore ?? 50,
    distanceAptitudeScore: overrides.distanceAptitudeScore ?? 50,
    last3FAbilityScore: overrides.last3FAbilityScore ?? 50,
    g1AchievementScore: overrides.g1AchievementScore ?? 30,
    rotationAptitudeScore: overrides.rotationAptitudeScore ?? 50,
    jockeyScore: overrides.jockeyScore ?? 50,
    trackConditionScore: overrides.trackConditionScore ?? 50,
    postPositionScore: overrides.postPositionScore ?? 50,
    trainerScore: overrides.trainerScore ?? 50
  };
}

// ============================================
// calculateTotalScore テスト
// ============================================

describe('ScoreComponents.calculateTotalScore', () => {
  it('10要素の重み付き合計を計算する', () => {
    const data = createScoreComponentsData();
    const scoreComponents = new ScoreComponents(data);

    const totalScore = scoreComponents.calculateTotalScore();

    // 各要素 × 重みの合計を検証
    const expectedScore =
      data.recentPerformanceScore * SCORE_WEIGHTS.recentPerformance +
      data.venueAptitudeScore * SCORE_WEIGHTS.venueAptitude +
      data.distanceAptitudeScore * SCORE_WEIGHTS.distanceAptitude +
      data.last3FAbilityScore * SCORE_WEIGHTS.last3FAbility +
      data.g1AchievementScore * SCORE_WEIGHTS.g1Achievement +
      data.rotationAptitudeScore * SCORE_WEIGHTS.rotationAptitude +
      data.jockeyScore * SCORE_WEIGHTS.jockey +
      data.trackConditionScore * SCORE_WEIGHTS.trackCondition +
      data.postPositionScore * SCORE_WEIGHTS.postPosition +
      data.trainerScore * SCORE_WEIGHTS.trainer;

    expect(totalScore).toBeCloseTo(expectedScore, 5);
  });

  it('全要素100点の場合、100点を返す', () => {
    const data: ScoreComponentsData = {
      recentPerformanceScore: 100,
      venueAptitudeScore: 100,
      distanceAptitudeScore: 100,
      last3FAbilityScore: 100,
      g1AchievementScore: 100,
      rotationAptitudeScore: 100,
      jockeyScore: 100,
      trackConditionScore: 100,
      postPositionScore: 100,
      trainerScore: 100
    };
    const scoreComponents = new ScoreComponents(data);

    const totalScore = scoreComponents.calculateTotalScore();

    expect(totalScore).toBe(100);
  });

  it('全要素0点の場合、0点を返す', () => {
    const data: ScoreComponentsData = {
      recentPerformanceScore: 0,
      venueAptitudeScore: 0,
      distanceAptitudeScore: 0,
      last3FAbilityScore: 0,
      g1AchievementScore: 0,
      rotationAptitudeScore: 0,
      jockeyScore: 0,
      trackConditionScore: 0,
      postPositionScore: 0,
      trainerScore: 0
    };
    const scoreComponents = new ScoreComponents(data);

    const totalScore = scoreComponents.calculateTotalScore();

    expect(totalScore).toBe(0);
  });

  it('直近成績が最も影響力が大きい（22%）', () => {
    // 直近成績のみ高い
    const dataRecentHigh = createScoreComponentsData({
      recentPerformanceScore: 100,
      venueAptitudeScore: 0,
      distanceAptitudeScore: 0,
      last3FAbilityScore: 0,
      g1AchievementScore: 0,
      rotationAptitudeScore: 0,
      jockeyScore: 0,
      trackConditionScore: 0,
      postPositionScore: 0,
      trainerScore: 0
    });

    // コース適性のみ高い（15%）
    const dataVenueHigh = createScoreComponentsData({
      recentPerformanceScore: 0,
      venueAptitudeScore: 100,
      distanceAptitudeScore: 0,
      last3FAbilityScore: 0,
      g1AchievementScore: 0,
      rotationAptitudeScore: 0,
      jockeyScore: 0,
      trackConditionScore: 0,
      postPositionScore: 0,
      trainerScore: 0
    });

    const scoreRecent = new ScoreComponents(dataRecentHigh).calculateTotalScore();
    const scoreVenue = new ScoreComponents(dataVenueHigh).calculateTotalScore();

    expect(scoreRecent).toBeCloseTo(22, 0);
    expect(scoreVenue).toBeCloseTo(15, 0);
    expect(scoreRecent).toBeGreaterThan(scoreVenue);
  });
});

// ============================================
// 重みの合計検証テスト
// ============================================

describe('SCORE_WEIGHTS', () => {
  it('10要素の重み合計が100%になる', () => {
    const totalWeight =
      SCORE_WEIGHTS.recentPerformance +
      SCORE_WEIGHTS.venueAptitude +
      SCORE_WEIGHTS.distanceAptitude +
      SCORE_WEIGHTS.last3FAbility +
      SCORE_WEIGHTS.g1Achievement +
      SCORE_WEIGHTS.rotationAptitude +
      SCORE_WEIGHTS.jockey +
      SCORE_WEIGHTS.trackCondition +
      SCORE_WEIGHTS.postPosition +
      SCORE_WEIGHTS.trainer;

    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it('各重みが0より大きい', () => {
    expect(SCORE_WEIGHTS.recentPerformance).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.venueAptitude).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.distanceAptitude).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.last3FAbility).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.g1Achievement).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.rotationAptitude).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.jockey).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.trackCondition).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.postPosition).toBeGreaterThan(0);
    expect(SCORE_WEIGHTS.trainer).toBeGreaterThan(0);
  });
});

// ============================================
// プロパティアクセサ テスト
// ============================================

describe('ScoreComponents プロパティアクセサ', () => {
  it('全プロパティにアクセスできる', () => {
    const data: ScoreComponentsData = {
      recentPerformanceScore: 80,
      venueAptitudeScore: 70,
      distanceAptitudeScore: 60,
      last3FAbilityScore: 75,
      g1AchievementScore: 40,
      rotationAptitudeScore: 65,
      jockeyScore: 55,
      trackConditionScore: 50,
      postPositionScore: 90,
      trainerScore: 45
    };
    const scoreComponents = new ScoreComponents(data);

    expect(scoreComponents.recentPerformanceScore).toBe(80);
    expect(scoreComponents.venueAptitudeScore).toBe(70);
    expect(scoreComponents.distanceAptitudeScore).toBe(60);
    expect(scoreComponents.last3FAbilityScore).toBe(75);
    expect(scoreComponents.g1AchievementScore).toBe(40);
    expect(scoreComponents.rotationAptitudeScore).toBe(65);
    expect(scoreComponents.jockeyScore).toBe(55);
    expect(scoreComponents.trackConditionScore).toBe(50);
    expect(scoreComponents.postPositionScore).toBe(90);
    expect(scoreComponents.trainerScore).toBe(45);
  });
});

// ============================================
// toPlainObject テスト
// ============================================

describe('ScoreComponents.toPlainObject', () => {
  it('プレーンオブジェクトにtotalScoreを含めて返す', () => {
    const data = createScoreComponentsData();
    const scoreComponents = new ScoreComponents(data);

    const plain = scoreComponents.toPlainObject();

    expect(plain.recentPerformanceScore).toBe(data.recentPerformanceScore);
    expect(plain.venueAptitudeScore).toBe(data.venueAptitudeScore);
    expect(plain.totalScore).toBe(scoreComponents.calculateTotalScore());
  });
});
