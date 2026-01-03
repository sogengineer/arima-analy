import { describe, it, expect } from 'vitest';
import { Horse, HorseBuilder } from '../Horse';
import { RaceResult } from '../RaceResult';
import { Race } from '../Race';
import { Jockey } from '../Jockey';
import { Trainer } from '../Trainer';
import type { CourseStats, TrackStats, HorseRaceResult } from '../../../types/RepositoryTypes';
import {
  RECENT_RACE_WEIGHTS,
  getPositionScore,
  POPULARITY_DIFF_FACTOR,
  POPULARITY_DIFF_MAX,
  G1_DEFAULT_SCORE,
  LAST_3F_PARAMS,
  TRACK_CONDITION_DEFAULT_SCORE
} from '../../../constants/ScoringConstants';

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

function createCourseStats(overrides: Partial<CourseStats> = {}): CourseStats {
  return {
    horse_id: overrides.horse_id ?? 1,
    venue_id: overrides.venue_id ?? 1,
    venue_name: overrides.venue_name ?? '中山',
    race_type: overrides.race_type ?? '芝',
    distance_category: overrides.distance_category,
    runs: overrides.runs ?? 0,
    wins: overrides.wins ?? 0,
    places: overrides.places ?? 0,
    shows: overrides.shows ?? 0,
    win_rate: overrides.win_rate
  };
}

function createTrackStats(overrides: Partial<TrackStats> = {}): TrackStats {
  return {
    horse_id: overrides.horse_id ?? 1,
    race_type: overrides.race_type ?? '芝',
    track_condition: overrides.track_condition ?? '良',
    runs: overrides.runs ?? 0,
    wins: overrides.wins ?? 0,
    places: overrides.places ?? 0,
    shows: overrides.shows ?? 0
  };
}

// ============================================
// calculateRecentPerformanceScore テスト
// ============================================

describe('Horse.calculateRecentPerformanceScore', () => {
  it('直近5戦全勝の場合、高スコア（80-100）を返す', () => {
    const results = Array.from({ length: 5 }, (_, i) =>
      createRaceResult({
        race_date: `2024-01-0${5 - i}`,
        finish_position: 1,
        popularity: 1
      })
    );
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRecentPerformanceScore();

    // 全勝（1着=100点）×重み合計
    const expectedScore = RECENT_RACE_WEIGHTS.reduce(
      (sum, weight) => sum + getPositionScore(1) * weight, 0
    );
    expect(score).toBeCloseTo(expectedScore, 1);
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('直近5戦全敗（10着以下）の場合、低スコア（0-20）を返す', () => {
    // 人気相応の着順（ペナルティなし）で検証
    const results = Array.from({ length: 5 }, (_, i) =>
      createRaceResult({
        race_date: `2024-01-0${5 - i}`,
        finish_position: 15,
        popularity: 15  // 15番人気で15着 = 人気通り
      })
    );
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRecentPerformanceScore();

    // 10着以上はdefault:10点 × 重み合計 = 10点
    const expectedScore = RECENT_RACE_WEIGHTS.reduce(
      (sum, weight) => sum + getPositionScore(15) * weight, 0
    );
    expect(score).toBeCloseTo(expectedScore, 1);
    expect(score).toBeLessThanOrEqual(20);
  });

  it('レース結果なしの場合、0点を返す', () => {
    const horse = Horse.builder(1, 'デビュー馬')
      .withRaceResults([])
      .build();

    const score = horse.calculateRecentPerformanceScore();

    expect(score).toBe(0);
  });

  it('人気以上の好走にはボーナスを加算する', () => {
    // 5番人気で1着 → popularityDiff = 5 - 1 = 4
    const results = [
      createRaceResult({
        race_date: '2024-01-01',
        finish_position: 1,
        popularity: 5
      })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRecentPerformanceScore();

    // 基本100点 + 4 * 3(係数) = 112 → 上限100
    const baseScore = getPositionScore(1);
    const bonusScore = Math.min(
      baseScore + 4 * POPULARITY_DIFF_FACTOR,
      POPULARITY_DIFF_MAX
    );
    const expectedScore = bonusScore * RECENT_RACE_WEIGHTS[0];
    expect(score).toBeCloseTo(expectedScore, 1);
  });

  it('人気以下の凡走にはペナルティを減算する', () => {
    // 1番人気で5着 → popularityDiff = 1 - 5 = -4
    const results = [
      createRaceResult({
        race_date: '2024-01-01',
        finish_position: 5,
        popularity: 1
      })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRecentPerformanceScore();

    // 基本45点 + (-4) * 3 * 0.5 = 45 - 6 = 39点
    const baseScore = getPositionScore(5);
    const penalizedScore = Math.max(
      0,
      baseScore + (-4) * (POPULARITY_DIFF_FACTOR * 0.5)
    );
    const expectedScore = penalizedScore * RECENT_RACE_WEIGHTS[0];
    expect(score).toBeCloseTo(expectedScore, 1);
  });

  it('5戦未満でも正しく計算する', () => {
    const results = [
      createRaceResult({ race_date: '2024-01-03', finish_position: 1, popularity: 1 }),
      createRaceResult({ race_date: '2024-01-02', finish_position: 2, popularity: 2 }),
      createRaceResult({ race_date: '2024-01-01', finish_position: 3, popularity: 3 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRecentPerformanceScore();

    const expectedScore =
      getPositionScore(1) * RECENT_RACE_WEIGHTS[0] +
      getPositionScore(2) * RECENT_RACE_WEIGHTS[1] +
      getPositionScore(3) * RECENT_RACE_WEIGHTS[2];
    expect(score).toBeCloseTo(expectedScore, 1);
  });
});

// ============================================
// calculateVenueAptitudeScore テスト
// ============================================

describe('Horse.calculateVenueAptitudeScore', () => {
  it('会場実績ありの場合、勝率・連対率を反映したスコアを返す', () => {
    const courseStats: CourseStats[] = [
      createCourseStats({
        venue_name: '中山',
        runs: 10,
        wins: 3,
        places: 4
      })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withCourseStats(courseStats)
      .build();

    const score = horse.calculateVenueAptitudeScore('中山');

    // 勝率: 3/10 = 0.3, 連対率: (3+4)/10 = 0.7
    // スコア: (0.3 * 60 + 0.7 * 40) * 信頼度係数
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('会場未経験の場合、50点（フォールバック）を返す', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withCourseStats([])
      .build();

    const score = horse.calculateVenueAptitudeScore('中山');

    expect(score).toBe(50);
  });

  it('別会場のstatsがあっても、指定会場がなければ50点', () => {
    const courseStats: CourseStats[] = [
      createCourseStats({ venue_name: '東京', runs: 5, wins: 2 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withCourseStats(courseStats)
      .build();

    const score = horse.calculateVenueAptitudeScore('中山');

    expect(score).toBe(50);
  });

  it('出走数0の場合、50点を返す', () => {
    const courseStats: CourseStats[] = [
      createCourseStats({ venue_name: '中山', runs: 0, wins: 0 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withCourseStats(courseStats)
      .build();

    const score = horse.calculateVenueAptitudeScore('中山');

    expect(score).toBe(50);
  });
});

// ============================================
// calculateDistanceAptitudeScore テスト
// ============================================

describe('Horse.calculateDistanceAptitudeScore', () => {
  it('適距離実績ありの場合、高スコアを返す', () => {
    const results = [
      createRaceResult({ distance: 2000, finish_position: 1, popularity: 1 }),
      createRaceResult({ distance: 2100, finish_position: 2, popularity: 2 }),
      createRaceResult({ distance: 1900, finish_position: 3, popularity: 3 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateDistanceAptitudeScore(2000);

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('適距離（±300m）実績なしの場合、0点を返す', () => {
    const results = [
      createRaceResult({ distance: 1200, finish_position: 1, popularity: 1 }),
      createRaceResult({ distance: 1400, finish_position: 1, popularity: 1 })
    ];
    const horse = Horse.builder(1, 'スプリンター')
      .withRaceResults(results)
      .build();

    const score = horse.calculateDistanceAptitudeScore(2500);

    expect(score).toBe(0);
  });

  it('同距離（±100m）での勝利にはボーナスが加算される', () => {
    // 低めの成績で検証（100点上限に到達しないようにする）
    const resultsExact = [
      createRaceResult({ distance: 2000, finish_position: 3, popularity: 3 }),  // 3着 = 複勝
      createRaceResult({ distance: 2000, finish_position: 1, popularity: 1 })   // 同距離勝利 → ボーナス
    ];
    const horseExact = Horse.builder(1, '同距離勝利あり')
      .withRaceResults(resultsExact)
      .build();

    const resultsSimilar = [
      createRaceResult({ distance: 2200, finish_position: 3, popularity: 3 }),  // 3着
      createRaceResult({ distance: 2250, finish_position: 1, popularity: 1 })   // 勝利だが同距離ではない
    ];
    const horseSimilar = Horse.builder(2, '類似距離のみ')
      .withRaceResults(resultsSimilar)
      .build();

    const scoreExact = horseExact.calculateDistanceAptitudeScore(2000);
    const scoreSimilar = horseSimilar.calculateDistanceAptitudeScore(2000);

    // 同距離勝利ボーナスがあるためExactが高い
    expect(scoreExact).toBeGreaterThan(scoreSimilar);
  });

  it('レース結果がない場合、0点を返す', () => {
    const horse = Horse.builder(1, 'デビュー馬')
      .withRaceResults([])
      .build();

    const score = horse.calculateDistanceAptitudeScore(2000);

    expect(score).toBe(0);
  });
});

// ============================================
// calculateLast3FAbilityScore テスト
// ============================================

describe('Horse.calculateLast3FAbilityScore', () => {
  it('上がり3Fデータありの場合、基準時間との差でスコア化する', () => {
    const results = [
      createRaceResult({ last_3f_time: 34.0, finish_position: 1 }),
      createRaceResult({ last_3f_time: 34.5, finish_position: 2 }),
      createRaceResult({ last_3f_time: 35.0, finish_position: 3 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateLast3FAbilityScore();

    // 平均: (34 + 34.5 + 35) / 3 = 34.5
    // スコア: ((37 - 34.5) / 4) * 100 = 62.5
    const avgTime = (34.0 + 34.5 + 35.0) / 3;
    const expectedScore = ((LAST_3F_PARAMS.baseTime - avgTime) / LAST_3F_PARAMS.divisor) * 100;
    expect(score).toBeCloseTo(expectedScore, 1);
  });

  it('上がり3Fデータなしの場合、複勝率から推定する', () => {
    const results = [
      createRaceResult({ finish_position: 1, popularity: 1 }),
      createRaceResult({ finish_position: 2, popularity: 2 }),
      createRaceResult({ finish_position: 3, popularity: 3 }),
      createRaceResult({ finish_position: 5, popularity: 4 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateLast3FAbilityScore();

    // 複勝率: 3/4 = 0.75
    // スコア: 0.75 * 80 + 20 = 80
    const top3Rate = 3 / 4;
    const expectedScore = top3Rate * LAST_3F_PARAMS.noDataMultiplier + LAST_3F_PARAMS.noDataBaseScore;
    expect(score).toBeCloseTo(expectedScore, 1);
  });

  it('レース結果がない場合、0点を返す', () => {
    const horse = Horse.builder(1, 'デビュー馬')
      .withRaceResults([])
      .build();

    const score = horse.calculateLast3FAbilityScore();

    expect(score).toBe(0);
  });

  it('上がり3Fが非常に速い場合、上限100を超えない', () => {
    const results = [
      createRaceResult({ last_3f_time: 32.0, finish_position: 1 })
    ];
    const horse = Horse.builder(1, '超末脚')
      .withRaceResults(results)
      .build();

    const score = horse.calculateLast3FAbilityScore();

    expect(score).toBeLessThanOrEqual(100);
  });
});

// ============================================
// calculateG1AchievementScore テスト
// ============================================

describe('Horse.calculateG1AchievementScore', () => {
  it('G1勝利ありの場合、高スコアを返す', () => {
    const results = [
      createRaceResult({ race_class: 'G1', finish_position: 1 })
    ];
    const horse = Horse.builder(1, 'G1馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateG1AchievementScore();

    expect(score).toBe(40); // G1-1着 = 40点
  });

  it('G1複数出走の場合、累積スコアを返す', () => {
    const results = [
      createRaceResult({ race_class: 'G1', finish_position: 1 }),
      createRaceResult({ race_class: 'G1', finish_position: 2 }),
      createRaceResult({ race_class: 'G1', finish_position: 3 })
    ];
    const horse = Horse.builder(1, '歴戦G1馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateG1AchievementScore();

    // 1着40 + 2着25 + 3着18 = 83
    expect(score).toBe(83);
  });

  it('G1未出走の場合、デフォルト30点を返す', () => {
    const results = [
      createRaceResult({ race_class: 'オープン', finish_position: 1 })
    ];
    const horse = Horse.builder(1, '未G1馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateG1AchievementScore();

    expect(score).toBe(G1_DEFAULT_SCORE);
  });

  it('レース名でG1判定する（有馬記念など）', () => {
    const results = [
      createRaceResult({ race_name: '有馬記念', finish_position: 1 })
    ];
    const horse = Horse.builder(1, 'G1馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateG1AchievementScore();

    expect(score).toBe(40);
  });

  it('G1で6着以下の場合、3点を加算する', () => {
    const results = [
      createRaceResult({ race_class: 'G1', finish_position: 10 })
    ];
    const horse = Horse.builder(1, 'G1敗退馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateG1AchievementScore();

    expect(score).toBe(3);
  });
});

// ============================================
// calculateRotationAptitudeScore テスト
// ============================================

describe('Horse.calculateRotationAptitudeScore', () => {
  it('適正間隔（3〜10週）での好走率が高い場合、高スコアを返す', () => {
    const results = [
      // 3週間（21日）間隔で連続好走
      createRaceResult({ race_date: '2024-02-01', finish_position: 1 }),
      createRaceResult({ race_date: '2024-01-10', finish_position: 2 }),
      createRaceResult({ race_date: '2023-12-20', finish_position: 3 }),
      createRaceResult({ race_date: '2023-11-29', finish_position: 1 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRotationAptitudeScore();

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('1戦のみの場合、0点を返す', () => {
    const results = [
      createRaceResult({ race_date: '2024-01-01', finish_position: 1 })
    ];
    const horse = Horse.builder(1, '1戦馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRotationAptitudeScore();

    expect(score).toBe(0);
  });

  it('レース結果がない場合、0点を返す', () => {
    const horse = Horse.builder(1, 'デビュー馬')
      .withRaceResults([])
      .build();

    const score = horse.calculateRotationAptitudeScore();

    expect(score).toBe(0);
  });

  it('間隔が長すぎる場合（10週超）はカウントしない', () => {
    const results = [
      createRaceResult({ race_date: '2024-06-01', finish_position: 1 }),
      createRaceResult({ race_date: '2024-01-01', finish_position: 1 }) // 150日以上空き
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    const score = horse.calculateRotationAptitudeScore();

    // 適正間隔ではないのでカウント0 → 0点
    expect(score).toBe(0);
  });
});

// ============================================
// calculateTrackConditionAptitudeScore テスト
// ============================================

describe('Horse.calculateTrackConditionAptitudeScore', () => {
  it('馬場成績ありの場合、勝率・連対率を反映したスコアを返す', () => {
    const trackStats: TrackStats[] = [
      createTrackStats({
        track_condition: '重',
        runs: 5,
        wins: 2,
        places: 2
      })
    ];
    const horse = Horse.builder(1, '道悪巧者')
      .withTrackStats(trackStats)
      .build();

    const score = horse.calculateTrackConditionAptitudeScore('重');

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('馬場成績なしの場合、50点を返す', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withTrackStats([])
      .build();

    const score = horse.calculateTrackConditionAptitudeScore('重');

    expect(score).toBe(TRACK_CONDITION_DEFAULT_SCORE);
  });
});

// ============================================
// calculateTotalScore テスト
// ============================================

describe('Horse.calculateTotalScore', () => {
  it('10要素のスコアを含むScoreComponentsを返す', () => {
    const results = [
      createRaceResult({ finish_position: 1, last_3f_time: 34.5, race_class: 'G1' })
    ];
    const courseStats = [createCourseStats({ venue_name: '中山', runs: 10, wins: 3 })];
    const trackStats = [createTrackStats({ track_condition: '良', runs: 5, wins: 2 })];

    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .withCourseStats(courseStats)
      .withTrackStats(trackStats)
      .build();

    const race = new Race({
      id: 1,
      date: '2024-12-22',
      venue: '中山',
      name: '有馬記念',
      raceClass: 'G1',
      raceType: '芝',
      distance: 2500,
      trackCondition: '良'
    });

    const scoreComponents = horse.calculateTotalScore(null, race, null, 3);

    expect(scoreComponents).toBeDefined();
    expect(scoreComponents.recentPerformanceScore).toBeGreaterThanOrEqual(0);
    expect(scoreComponents.venueAptitudeScore).toBeGreaterThanOrEqual(0);
    expect(scoreComponents.distanceAptitudeScore).toBeGreaterThanOrEqual(0);
    expect(scoreComponents.last3FAbilityScore).toBeGreaterThanOrEqual(0);
    expect(scoreComponents.g1AchievementScore).toBeGreaterThanOrEqual(0);
    expect(scoreComponents.rotationAptitudeScore).toBeGreaterThanOrEqual(0);
    expect(scoreComponents.trackConditionScore).toBeGreaterThanOrEqual(0);
    expect(scoreComponents.postPositionScore).toBeGreaterThanOrEqual(0);
  });

  it('騎手エンティティが渡された場合、騎手スコアを含む', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults([createRaceResult({ finish_position: 1 })])
      .build();

    const race = new Race({
      id: 1,
      date: '2024-12-22',
      venue: '中山',
      name: '有馬記念',
      raceType: '芝',
      distance: 2500
    });

    const jockey = Jockey.builder(1, 'テスト騎手')
      .withOverallStats({
        jockey_id: 1,
        wins: 100,
        total_runs: 500,
        places: 80,
        shows: 60,
        g1_runs: 20,
        g1_wins: 5
      })
      .withVenueStats('中山', {
        jockey_id: 1,
        venue_name: '中山',
        wins: 10,
        total_runs: 50,
        places: 8,
        shows: 6,
        venue_g1_wins: 2,
        venue_g1_runs: 10
      })
      .build();

    const scoreComponents = horse.calculateTotalScore(jockey, race);

    expect(scoreComponents.jockeyScore).toBeGreaterThan(0);
  });

  it('調教師エンティティが渡された場合、調教師スコアを含む', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults([createRaceResult({ finish_position: 1 })])
      .build();

    const race = new Race({
      id: 1,
      date: '2024-12-22',
      venue: '中山',
      name: '有馬記念',
      raceType: '芝',
      distance: 2500
    });

    const trainer = Trainer.builder(1, 'テスト調教師')
      .withG1Stats(5, 20)
      .withGradeStats(20, 100)
      .build();

    const scoreComponents = horse.calculateTotalScore(null, race, trainer);

    expect(scoreComponents.trainerScore).toBeGreaterThan(0);
  });
});

// ============================================
// HorseBuilder テスト
// ============================================

describe('HorseBuilder', () => {
  it('全データを設定して正しくビルドする', () => {
    const detail = {
      id: 1,
      name: 'イクイノックス',
      birth_year: 2020,
      sex: '牡' as const,
      sire_name: 'テスト父',
      mare_name: 'テスト母',
      mares_sire_name: 'テスト母父',
      trainer_name: 'テスト調教師',
      owner_name: 'テスト馬主'
    };
    const results = [createRaceResult({ finish_position: 1 })];
    const courseStats = [createCourseStats({ venue_name: '中山', runs: 5 })];
    const trackStats = [createTrackStats({ track_condition: '良', runs: 3 })];

    const horse = Horse.builder(1, 'イクイノックス')
      .withDetail(detail)
      .withRaceResults(results)
      .withCourseStats(courseStats)
      .withTrackStats(trackStats)
      .build();

    expect(horse.id).toBe(1);
    expect(horse.name).toBe('イクイノックス');
    expect(horse.detail).toEqual(detail);
    expect(horse.raceResults).toHaveLength(1);
    expect(horse.courseStats).toHaveLength(1);
    expect(horse.trackStats).toHaveLength(1);
  });

  it('オプショナルなデータなしでもビルドできる', () => {
    const horse = Horse.builder(1, 'シンプル馬').build();

    expect(horse.id).toBe(1);
    expect(horse.name).toBe('シンプル馬');
    expect(horse.detail).toBeUndefined();
    expect(horse.raceResults).toHaveLength(0);
    expect(horse.courseStats).toHaveLength(0);
    expect(horse.trackStats).toHaveLength(0);
  });
});

// ============================================
// ユーティリティメソッド テスト
// ============================================

describe('Horse ユーティリティメソッド', () => {
  it('getSireName - 父名を取得する', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withDetail({ id: 1, name: 'テスト馬', sire_name: 'ディープインパクト' })
      .build();

    expect(horse.getSireName()).toBe('ディープインパクト');
  });

  it('getMareName - 母名を取得する', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withDetail({ id: 1, name: 'テスト馬', mare_name: 'テスト母馬' })
      .build();

    expect(horse.getMareName()).toBe('テスト母馬');
  });

  it('getMaresSireName - 母父名を取得する', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withDetail({ id: 1, name: 'テスト馬', mares_sire_name: 'キングカメハメハ' })
      .build();

    expect(horse.getMaresSireName()).toBe('キングカメハメハ');
  });

  it('getTrainerName - 調教師名を取得する', () => {
    const horse = Horse.builder(1, 'テスト馬')
      .withDetail({ id: 1, name: 'テスト馬', trainer_name: '藤沢和雄' })
      .build();

    expect(horse.getTrainerName()).toBe('藤沢和雄');
  });

  it('getRecentResults - 直近N戦の結果を取得する', () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      createRaceResult({ race_date: `2024-01-${10 - i}`, finish_position: i + 1 })
    );
    const horse = Horse.builder(1, 'テスト馬')
      .withRaceResults(results)
      .build();

    expect(horse.getRecentResults(3)).toHaveLength(3);
    expect(horse.getRecentResults()).toHaveLength(5);
    expect(horse.getRecentResults(10)).toHaveLength(10);
  });

  it('getCourseStatsForVenue - 指定会場の成績を取得する', () => {
    const courseStats = [
      createCourseStats({ venue_name: '中山', runs: 5, wins: 2 }),
      createCourseStats({ venue_name: '東京', runs: 3, wins: 1 })
    ];
    const horse = Horse.builder(1, 'テスト馬')
      .withCourseStats(courseStats)
      .build();

    const stats = horse.getCourseStatsForVenue('中山');
    expect(stats).toBeDefined();
    expect(stats?.venue_name).toBe('中山');
    expect(stats?.wins).toBe(2);

    expect(horse.getCourseStatsForVenue('阪神')).toBeUndefined();
  });
});
