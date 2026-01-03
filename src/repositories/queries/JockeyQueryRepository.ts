/**
 * 騎手統計の取得リポジトリ
 */

import type Database from 'better-sqlite3';
import type {
  JockeyVenueStats,
  JockeyOverallStats,
  JockeyTrainerComboStats
} from '../../types/RepositoryTypes';
import type { DBJockey, DBTrainer } from '../../types/HorseData';

export class JockeyQueryRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * 騎手の指定コース成績を取得（G1成績も含む）
   *
   * @param jockeyId - 騎手ID
   * @param venueName - 会場名（例: '中山', '東京'）
   * @returns 会場成績、見つからない場合は null
   */
  getJockeyVenueStats(jockeyId: number, venueName: string): JockeyVenueStats | null {
    // 基本成績
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN rr.finish_position <= 2 THEN 1 ELSE 0 END) as places,
        SUM(CASE WHEN rr.finish_position <= 3 THEN 1 ELSE 0 END) as shows
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.jockey_id = ? AND v.name = ?
    `).get(jockeyId, venueName) as {
      total_runs: number;
      wins: number;
      places: number;
      shows: number;
    } | undefined;

    if (!stats) return null;

    // G1成績
    const g1Stats = this.db.prepare(`
      SELECT
        COUNT(*) as venue_g1_runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as venue_g1_wins
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      JOIN venues v ON r.venue_id = v.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.jockey_id = ?
        AND v.name = ?
        AND (r.race_class LIKE '%G1%' OR r.race_class LIKE '%GI%')
    `).get(jockeyId, venueName) as {
      venue_g1_runs: number;
      venue_g1_wins: number;
    } | undefined;

    return {
      jockey_id: jockeyId,
      venue_name: venueName,
      total_runs: stats.total_runs,
      wins: stats.wins,
      places: stats.places,
      shows: stats.shows,
      venue_g1_runs: g1Stats?.venue_g1_runs ?? 0,
      venue_g1_wins: g1Stats?.venue_g1_wins ?? 0
    };
  }

  /**
   * 騎手の全体成績を取得
   */
  getJockeyOverallStats(jockeyId: number): JockeyOverallStats | null {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN rr.finish_position <= 2 THEN 1 ELSE 0 END) as places,
        SUM(CASE WHEN rr.finish_position <= 3 THEN 1 ELSE 0 END) as shows
      FROM race_entries e
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.jockey_id = ?
    `).get(jockeyId) as {
      total_runs: number;
      wins: number;
      places: number;
      shows: number;
    } | undefined;

    if (!stats) return null;

    // G1成績
    const g1Stats = this.db.prepare(`
      SELECT
        COUNT(*) as g1_runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as g1_wins
      FROM race_entries e
      JOIN races r ON e.race_id = r.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.jockey_id = ?
        AND (r.race_class LIKE '%G1%' OR r.race_class LIKE '%GI%')
    `).get(jockeyId) as {
      g1_runs: number;
      g1_wins: number;
    } | undefined;

    return {
      jockey_id: jockeyId,
      total_runs: stats.total_runs,
      wins: stats.wins,
      places: stats.places,
      shows: stats.shows,
      g1_runs: g1Stats?.g1_runs ?? 0,
      g1_wins: g1Stats?.g1_wins ?? 0
    };
  }

  /**
   * 騎手・調教師コンビ成績を取得
   */
  getJockeyTrainerStats(jockeyId: number, trainerId: number): JockeyTrainerComboStats | null {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_runs,
        SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN rr.finish_position <= 2 THEN 1 ELSE 0 END) as places,
        SUM(CASE WHEN rr.finish_position <= 3 THEN 1 ELSE 0 END) as shows
      FROM race_entries e
      JOIN horses h ON e.horse_id = h.id
      LEFT JOIN race_results rr ON rr.entry_id = e.id
      WHERE e.jockey_id = ? AND h.trainer_id = ?
    `).get(jockeyId, trainerId) as {
      total_runs: number;
      wins: number;
      places: number;
      shows: number;
    } | undefined;

    if (!stats) return null;

    return {
      jockey_id: jockeyId,
      trainer_id: trainerId,
      total_runs: stats.total_runs,
      wins: stats.wins,
      places: stats.places,
      shows: stats.shows
    };
  }

  /**
   * 全騎手を取得
   */
  getAllJockeys(): DBJockey[] {
    return this.db.prepare(
      'SELECT * FROM jockeys ORDER BY name'
    ).all() as DBJockey[];
  }

  /**
   * 騎手をIDで取得
   */
  getJockeyById(jockeyId: number): DBJockey | undefined {
    return this.db.prepare(
      'SELECT * FROM jockeys WHERE id = ?'
    ).get(jockeyId) as DBJockey | undefined;
  }

  /**
   * 全調教師を取得
   */
  getAllTrainers(): DBTrainer[] {
    return this.db.prepare(
      'SELECT * FROM trainers ORDER BY name'
    ).all() as DBTrainer[];
  }

  /**
   * 調教師をIDで取得
   */
  getTrainerById(trainerId: number): DBTrainer | undefined {
    return this.db.prepare(
      'SELECT * FROM trainers WHERE id = ?'
    ).get(trainerId) as DBTrainer | undefined;
  }
}
