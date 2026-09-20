/**
 * スコア・統計集約のリポジトリ
 * トランザクション単位でスコア＋統計を更新
 *
 * @remarks
 * 専門家会議（2026/01/03）で合意した10要素構成に対応。
 */

import type { Database } from 'bun:sqlite';
import type { ScoreUpdateData } from '../../types/RepositoryTypes';
import { getDistanceCategory } from '../../constants/DistanceConstants';

/** 統計更新の対象となるコース条件（会場・芝ダ・距離カテゴリ・馬場状態） */
export interface RaceCourseContext {
  venueId: number;
  raceType: string;
  distanceCategory: string;
  trackCondition: string;
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
      const results = this.db.prepare(`
        SELECT re.horse_id, r.venue_id, r.race_type, r.distance,
               r.track_condition, rr.finish_position
        FROM race_results rr
        JOIN race_entries re ON re.id = rr.entry_id
        JOIN races r ON r.id = re.race_id
        WHERE rr.finish_position > 0
      `).all() as {
        horse_id: number;
        venue_id: number;
        race_type: string | null;
        distance: number;
        track_condition: string | null;
        finish_position: number;
      }[];

      this.db.exec('DELETE FROM horse_track_stats');
      this.db.exec('DELETE FROM horse_course_stats');
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
   */
  updateHorseScore(
    horseId: number,
    raceId: number | null,
    scores: ScoreUpdateData
  ): void {
    this.db.prepare(`
      INSERT INTO horse_scores (
        horse_id, race_id,
        recent_performance_score, course_aptitude_score, distance_aptitude_score,
        last_3f_ability_score, g1_achievement_score, rotation_score,
        track_condition_score, jockey_score, trainer_score, post_position_score,
        total_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(horse_id, race_id) DO UPDATE SET
        recent_performance_score = COALESCE(?, recent_performance_score),
        course_aptitude_score = COALESCE(?, course_aptitude_score),
        distance_aptitude_score = COALESCE(?, distance_aptitude_score),
        last_3f_ability_score = COALESCE(?, last_3f_ability_score),
        g1_achievement_score = COALESCE(?, g1_achievement_score),
        rotation_score = COALESCE(?, rotation_score),
        track_condition_score = COALESCE(?, track_condition_score),
        jockey_score = COALESCE(?, jockey_score),
        trainer_score = COALESCE(?, trainer_score),
        post_position_score = COALESCE(?, post_position_score),
        total_score = COALESCE(?, total_score)
    `).run(
      horseId, raceId,
      scores.recent_performance_score, scores.course_aptitude_score,
      scores.distance_aptitude_score, scores.last_3f_ability_score,
      scores.g1_achievement_score, scores.rotation_score,
      scores.track_condition_score, scores.jockey_score,
      scores.trainer_score, scores.post_position_score,
      scores.total_score,
      // ON CONFLICT用の値
      scores.recent_performance_score, scores.course_aptitude_score,
      scores.distance_aptitude_score, scores.last_3f_ability_score,
      scores.g1_achievement_score, scores.rotation_score,
      scores.track_condition_score, scores.jockey_score,
      scores.trainer_score, scores.post_position_score,
      scores.total_score
    );
  }

  /**
   * レース後の統計を一括更新（トランザクション）
   */
  updateStatsAfterRace(
    horseId: number,
    sireId: number | null,
    course: RaceCourseContext,
    finishPosition: number
  ): void {
    const { venueId, raceType, distanceCategory, trackCondition } = course;

    this.db.transaction(() => {
      // 馬場別成績を更新
      this.updateHorseTrackStats(horseId, raceType, trackCondition, finishPosition);

      // コース別成績を更新
      this.updateHorseCourseStats(horseId, venueId, raceType, distanceCategory, finishPosition);

      // 血統統計を更新
      if (sireId) {
        this.updateBloodlineStats(sireId, raceType, distanceCategory, trackCondition, finishPosition);
      }
    })();
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
    const won = finishPosition === 1;
    const placed = finishPosition === 2;
    const showed = finishPosition === 3;

    this.db.prepare(`
      INSERT INTO horse_track_stats (horse_id, race_type, track_condition, runs, wins, places, shows)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(horse_id, race_type, track_condition) DO UPDATE SET
        runs = runs + 1,
        wins = wins + ?,
        places = places + ?,
        shows = shows + ?
    `).run(
      horseId, raceType, trackCondition,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0
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
    const won = finishPosition === 1;
    const placed = finishPosition === 2;
    const showed = finishPosition === 3;

    this.db.prepare(`
      INSERT INTO horse_course_stats (horse_id, venue_id, race_type, distance_category, runs, wins, places, shows)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(horse_id, venue_id, race_type, distance_category) DO UPDATE SET
        runs = runs + 1,
        wins = wins + ?,
        places = places + ?,
        shows = shows + ?
    `).run(
      horseId, venueId, raceType, distanceCategory,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0
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
    const won = finishPosition === 1;
    const placed = finishPosition === 2;
    const showed = finishPosition === 3;

    this.db.prepare(`
      INSERT INTO bloodline_stats (sire_id, race_type, distance_category, track_condition, runs, wins, places, shows)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(sire_id, race_type, distance_category, track_condition) DO UPDATE SET
        runs = runs + 1,
        wins = wins + ?,
        places = places + ?,
        shows = shows + ?
    `).run(
      sireId, raceType, distanceCategory, trackCondition,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0,
      won ? 1 : 0, placed ? 1 : 0, showed ? 1 : 0
    );
  }
}
