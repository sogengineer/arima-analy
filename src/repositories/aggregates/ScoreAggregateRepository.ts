/**
 * スコア・統計集約のリポジトリ
 * トランザクション単位でスコア＋統計を更新
 *
 * @remarks
 * 専門家会議（2026/01/03）で合意した10要素構成に対応。
 */

import type { Database } from 'bun:sqlite';
import { queryBuilder, runStatement, selectRows } from '@/database/QueryRunner';
import type { ScoreUpdateData } from '@/types/RepositoryTypes';
import { getDistanceCategory } from '@/constants/DistanceConstants';

/** 集計表の勝敗カウント（1着 / 2着 / 3着をそれぞれ 1 か 0 で表す） */
interface FinishCounts {
  wins: number;
  places: number;
  shows: number;
}

/** 着順を集計表の加算値に落とす */
function toFinishCounts(finishPosition: number): FinishCounts {
  return {
    wins: finishPosition === 1 ? 1 : 0,
    places: finishPosition === 2 ? 1 : 0,
    shows: finishPosition === 3 ? 1 : 0
  };
}

export class ScoreAggregateRepository {
  constructor(private readonly db: Database) {}

  /**
   * 保存済みの有効着順から馬場別・コース別成績を全件再構築する。
   * 結果訂正や旧データの集計漏れにも対応し、繰り返し実行しても二重計上しない。
   * 結果のない手入力集計も置き換える。2表の置き換えは同一トランザクションで行う。
   */
  rebuildHorseStats(): number {
    return this.db.transaction(() => {
      const results = selectRows(
        this.db,
        queryBuilder
          .selectFrom('race_results as rr')
          .innerJoin('race_entries as re', 're.id', 'rr.entry_id')
          .innerJoin('races as r', 'r.id', 're.race_id')
          .select(eb => [
            're.horse_id',
            'r.venue_id',
            'r.race_type',
            'r.distance',
            'r.track_condition',
            // 着順は下の where で 0 より大きい行だけに絞っているので NULL は来ない
            eb.ref('rr.finish_position').$notNull().as('finish_position')
          ])
          .where('rr.finish_position', '>', 0)
          .compile()
      );

      runStatement(this.db, queryBuilder.deleteFrom('horse_track_stats').compile());
      runStatement(this.db, queryBuilder.deleteFrom('horse_course_stats').compile());
      for (const result of results) {
        this.updateHorseTrackStats(
          result.horse_id, result.race_type ?? 'ダート',
          result.track_condition ?? '良', result.finish_position
        );
        this.updateHorseCourseStats(
          result.horse_id, result.venue_id, result.race_type ?? 'ダート',
          getDistanceCategory(result.distance), result.finish_position
        );
      }
      return results.length;
    })();
  }

  /**
   * 馬スコアを更新（10要素構成 + total_score）
   *
   * @remarks
   * 同じ（馬, レース）の組が既にあれば UPDATE する。各要素は `COALESCE(新しい値, 既存値)` なので、
   * 値が渡されなかった要素は既存のスコアを残す。
   *
   * 各要素に付けた `?? null` は型の上では不要に見えるが、実行時に `undefined` が入った
   * `ScoreUpdateData` が渡される経路があるため必要になる。
   * - `doUpdateSet` 側: `undefined` のままだとバインド値に載り `QueryRunner` が例外にする。
   *   `null` にすることで `COALESCE(NULL, 既存値)` となり、既存値が保たれる。
   * - `values()` 側: Kysely は `undefined` の列を INSERT 文から**省く**ため、
   *   DEFAULT 0 を持つスコア列では「0 が入る」ことになり、NULL を入れる挙動と結果が変わる。
   */
  updateHorseScore(
    horseId: number,
    raceId: number | null,
    scores: ScoreUpdateData
  ): void {
    runStatement(
      this.db,
      queryBuilder
        .insertInto('horse_scores')
        .values({
          horse_id: horseId,
          race_id: raceId,
          recent_performance_score: scores.recent_performance_score ?? null,
          course_aptitude_score: scores.course_aptitude_score ?? null,
          distance_aptitude_score: scores.distance_aptitude_score ?? null,
          last_3f_ability_score: scores.last_3f_ability_score ?? null,
          g1_achievement_score: scores.g1_achievement_score ?? null,
          rotation_score: scores.rotation_score ?? null,
          track_condition_score: scores.track_condition_score ?? null,
          jockey_score: scores.jockey_score ?? null,
          trainer_score: scores.trainer_score ?? null,
          post_position_score: scores.post_position_score ?? null,
          total_score: scores.total_score ?? null
        })
        .onConflict(oc =>
          oc.columns(['horse_id', 'race_id']).doUpdateSet(eb => ({
            recent_performance_score: eb.fn.coalesce(
              eb.val(scores.recent_performance_score ?? null),
              eb.ref('recent_performance_score')
            ),
            course_aptitude_score: eb.fn.coalesce(
              eb.val(scores.course_aptitude_score ?? null),
              eb.ref('course_aptitude_score')
            ),
            distance_aptitude_score: eb.fn.coalesce(
              eb.val(scores.distance_aptitude_score ?? null),
              eb.ref('distance_aptitude_score')
            ),
            last_3f_ability_score: eb.fn.coalesce(
              eb.val(scores.last_3f_ability_score ?? null),
              eb.ref('last_3f_ability_score')
            ),
            g1_achievement_score: eb.fn.coalesce(
              eb.val(scores.g1_achievement_score ?? null),
              eb.ref('g1_achievement_score')
            ),
            rotation_score: eb.fn.coalesce(eb.val(scores.rotation_score ?? null), eb.ref('rotation_score')),
            track_condition_score: eb.fn.coalesce(
              eb.val(scores.track_condition_score ?? null),
              eb.ref('track_condition_score')
            ),
            jockey_score: eb.fn.coalesce(eb.val(scores.jockey_score ?? null), eb.ref('jockey_score')),
            trainer_score: eb.fn.coalesce(eb.val(scores.trainer_score ?? null), eb.ref('trainer_score')),
            post_position_score: eb.fn.coalesce(
              eb.val(scores.post_position_score ?? null),
              eb.ref('post_position_score')
            ),
            total_score: eb.fn.coalesce(eb.val(scores.total_score ?? null), eb.ref('total_score'))
          }))
        )
        .compile()
    );
  }

  /**
   * 馬場別成績を更新
   */
  updateHorseTrackStats(
    horseId: number,
    raceType: string,
    trackCondition: string,
    finishPosition: number
  ): void {
    const counts = toFinishCounts(finishPosition);

    runStatement(
      this.db,
      queryBuilder
        .insertInto('horse_track_stats')
        .values({
          horse_id: horseId,
          race_type: raceType,
          track_condition: trackCondition,
          runs: 1,
          ...counts
        })
        .onConflict(oc =>
          oc
            .columns(['horse_id', 'race_type', 'track_condition'])
            .doUpdateSet(eb => ({
              runs: eb('runs', '+', 1),
              wins: eb('wins', '+', counts.wins),
              places: eb('places', '+', counts.places),
              shows: eb('shows', '+', counts.shows)
            }))
        )
        .compile()
    );
  }

  /**
   * コース別成績を更新
   */
  updateHorseCourseStats(
    horseId: number,
    venueId: number,
    raceType: string,
    distanceCategory: string,
    finishPosition: number
  ): void {
    const counts = toFinishCounts(finishPosition);

    runStatement(
      this.db,
      queryBuilder
        .insertInto('horse_course_stats')
        .values({
          horse_id: horseId,
          venue_id: venueId,
          race_type: raceType,
          distance_category: distanceCategory,
          runs: 1,
          ...counts
        })
        .onConflict(oc =>
          oc
            .columns(['horse_id', 'venue_id', 'race_type', 'distance_category'])
            .doUpdateSet(eb => ({
              runs: eb('runs', '+', 1),
              wins: eb('wins', '+', counts.wins),
              places: eb('places', '+', counts.places),
              shows: eb('shows', '+', counts.shows)
            }))
        )
        .compile()
    );
  }

  /**
   * 血統統計を更新
   */
  updateBloodlineStats(
    sireId: number,
    raceType: string,
    distanceCategory: string,
    trackCondition: string,
    finishPosition: number
  ): void {
    const counts = toFinishCounts(finishPosition);

    runStatement(
      this.db,
      queryBuilder
        .insertInto('bloodline_stats')
        .values({
          sire_id: sireId,
          race_type: raceType,
          distance_category: distanceCategory,
          track_condition: trackCondition,
          runs: 1,
          ...counts
        })
        .onConflict(oc =>
          oc
            .columns(['sire_id', 'race_type', 'distance_category', 'track_condition'])
            .doUpdateSet(eb => ({
              runs: eb('runs', '+', 1),
              wins: eb('wins', '+', counts.wins),
              places: eb('places', '+', counts.places),
              shows: eb('shows', '+', counts.shows)
            }))
        )
        .compile()
    );
  }
}
