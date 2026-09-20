/**
 * 確定済みレースから学習サンプルを組む補助
 */

import type { RaceQueryRepository } from '../repositories/queries/RaceQueryRepository';
import type { RaceFeatureSet } from '../features/FeatureBuilder';
import type { TrainingSample } from './MachineLearningTypes';

/** 結果が確定しているレース行 */
export type RaceWithResultsRow = ReturnType<RaceQueryRepository['getRacesWithResults']>[number];

/** 日付昇順（同日はレースID昇順）に並べ替える */
export function orderRacesByDateAscending(races: RaceWithResultsRow[]): RaceWithResultsRow[] {
  return [...races].sort((a, b) => {
    if (a.race_date === b.race_date) return a.id - b.id;
    return a.race_date < b.race_date ? -1 : 1;
  });
}

/** 馬ID → 確定着順（1着以上のものだけ） */
export function buildFinishPositionMap(
  results: ReturnType<RaceQueryRepository['getRaceResults']>
): Map<number, number> {
  const positionMap = new Map<number, number>();
  for (const r of results) {
    if (r.finish_position != null && r.finish_position >= 1) {
      positionMap.set(r.horse_id, r.finish_position);
    }
  }
  return positionMap;
}

/** 特徴量行と確定着順から、1レース分の学習サンプルを組む */
export function buildTrainingSamples(
  raceId: number,
  raceDate: string,
  featureSet: RaceFeatureSet,
  positionMap: Map<number, number>
): TrainingSample[] {
  const samples: TrainingSample[] = [];
  for (const row of featureSet.rows) {
    const position = positionMap.get(row.horseId);
    if (position == null) continue;
    samples.push({
      raceId,
      raceDate,
      horseId: row.horseId,
      horseName: row.horseName,
      vector: row.vector,
      features: row.features,
      winLabel: position === 1 ? 1 : 0,
      showLabel: position <= 3 ? 1 : 0,
      finishPosition: position,
      payoutWinOdds: row.payoutWinOdds
    });
  }
  return samples;
}
