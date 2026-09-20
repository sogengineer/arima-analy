import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestDb, type TestDatabase } from '../../../test/helpers/testDb';
import { ScoringOrchestrator } from '../ScoringOrchestrator';
import { FeatureBuilder } from '../../../features/FeatureBuilder';

describe('枠番の補完（一括・単体・ML）', () => {
  let testDb: TestDatabase;
  beforeEach(() => { testDb = createTestDb('frame-fallback'); });
  afterEach(() => { testDb.cleanup(); });

  it.each([
    { totalHorses: 16, frameNumber: undefined, expected: 90 },
    { totalHorses: undefined, frameNumber: undefined, expected: 65 },
    { totalHorses: 16, frameNumber: 8, expected: 55 }
  ])('総頭数$totalHorses・登録枠$frameNumberでは枠順スコア$expected', ({ totalHorses, frameNumber, expected }) => {
    const horse = testDb.horseRepo.insertHorseWithBloodline({ name: '対象馬', sire: '父', mare: '母' });
    const race = testDb.raceRepo.insertRace({
      raceDate: '2025-12-01', venue: '中山', raceName: '前走',
      raceType: '芝', distance: 2000, totalHorses
    });
    testDb.raceRepo.insertRaceEntry(race.id, {
      horseName: '対象馬', sireName: '父', mareName: '母', jockeyName: '騎手', horseNumber: 6, frameNumber
    });
    const orchestrator = new ScoringOrchestrator(testDb.db);
    const raceEntity = orchestrator.buildRaceEntity(race.id)!;
    const entry = orchestrator.getRaceEntries(race.id)[0];
    expect(orchestrator.calculateScoresForRace(race.id)[0].scores.toPlainObject().postPositionScore).toBe(expected);
    expect(orchestrator.calculateScoreForEntry(entry, raceEntity).toPlainObject().postPositionScore).toBe(expected);
    // ML 特徴量では10要素は ruleScores に派生特徴として入る
    expect(
      new FeatureBuilder(testDb.db)
        .buildForRace(race.id)
        ?.rows.find(r => r.horseId === horse.id)?.features.ruleScores.postPositionScore
    ).toBe(expected);
  });
});
