/**
 * 騎手統計の取得リポジトリ
 */

import type { Database } from 'bun:sqlite';
import type {
  JockeyVenueStats,
  JockeyOverallStats,
  JockeyTrainerComboStats
} from '../../types/RepositoryTypes';
import type { DBJockey, DBTrainer } from '../../types/HorseData';

/**
 * 成績集計の共通条件
 *
 * @remarks
 * - 着順が確定した出走だけを分母にする（出走登録だけの行を数えない）。
 *   これは as-of の有無に関わらず常に付ける。付けたり付けなかったりすると
 *   同じ「勝率」が呼び出し経路によって別物になる。
 * - `beforeDate` を指定した場合はさらに、指定日より前のレースだけを対象にする
 *   （未来のレース＝リーク源を除外）。as-of 版と通常版は完全な SQL 文字列として
 *   別々に持ち、`prepare` には実行時の値を混ぜない。
 */

const JOCKEY_VENUE_STATS_SQL = `
  SELECT
    COUNT(*) as total_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) as places,
    SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) as shows
  FROM race_entries e
  JOIN races r ON e.race_id = r.id
  JOIN venues v ON r.venue_id = v.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ? AND v.name = ?
  AND rr.finish_position IS NOT NULL
`;

const JOCKEY_VENUE_STATS_AS_OF_SQL = `
  SELECT
    COUNT(*) as total_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) as places,
    SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) as shows
  FROM race_entries e
  JOIN races r ON e.race_id = r.id
  JOIN venues v ON r.venue_id = v.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ? AND v.name = ?
  AND rr.finish_position IS NOT NULL AND r.race_date < ?
`;

const JOCKEY_VENUE_G1_STATS_SQL = `
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
  AND rr.finish_position IS NOT NULL
`;

const JOCKEY_VENUE_G1_STATS_AS_OF_SQL = `
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
  AND rr.finish_position IS NOT NULL AND r.race_date < ?
`;

const JOCKEY_OVERALL_STATS_SQL = `
  SELECT
    COUNT(*) as total_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) as places,
    SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) as shows
  FROM race_entries e
  JOIN races r ON e.race_id = r.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ?
  AND rr.finish_position IS NOT NULL
`;

const JOCKEY_OVERALL_STATS_AS_OF_SQL = `
  SELECT
    COUNT(*) as total_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) as places,
    SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) as shows
  FROM race_entries e
  JOIN races r ON e.race_id = r.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ?
  AND rr.finish_position IS NOT NULL AND r.race_date < ?
`;

const JOCKEY_OVERALL_G1_STATS_SQL = `
  SELECT
    COUNT(*) as g1_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as g1_wins
  FROM race_entries e
  JOIN races r ON e.race_id = r.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ?
    AND (r.race_class LIKE '%G1%' OR r.race_class LIKE '%GI%')
  AND rr.finish_position IS NOT NULL
`;

const JOCKEY_OVERALL_G1_STATS_AS_OF_SQL = `
  SELECT
    COUNT(*) as g1_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as g1_wins
  FROM race_entries e
  JOIN races r ON e.race_id = r.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ?
    AND (r.race_class LIKE '%G1%' OR r.race_class LIKE '%GI%')
  AND rr.finish_position IS NOT NULL AND r.race_date < ?
`;

const JOCKEY_TRAINER_STATS_SQL = `
  SELECT
    COUNT(*) as total_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) as places,
    SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) as shows
  FROM race_entries e
  JOIN horses h ON e.horse_id = h.id
  JOIN races r ON e.race_id = r.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ? AND h.trainer_id = ?
  AND rr.finish_position IS NOT NULL
`;

const JOCKEY_TRAINER_STATS_AS_OF_SQL = `
  SELECT
    COUNT(*) as total_runs,
    SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN rr.finish_position = 2 THEN 1 ELSE 0 END) as places,
    SUM(CASE WHEN rr.finish_position = 3 THEN 1 ELSE 0 END) as shows
  FROM race_entries e
  JOIN horses h ON e.horse_id = h.id
  JOIN races r ON e.race_id = r.id
  LEFT JOIN race_results rr ON rr.entry_id = e.id
  WHERE e.jockey_id = ? AND h.trainer_id = ?
  AND rr.finish_position IS NOT NULL AND r.race_date < ?
`;

export class JockeyQueryRepository {
  constructor(private readonly db: Database) {}

  /**
   * 騎手の指定コース成績を取得（G1成績も含む）
   *
   * @param jockeyId - 騎手ID
   * @param venueName - 会場名（例: '中山', '東京'）
   * @param beforeDate - as-of カットオフ日（省略時は全期間）
   * @returns 会場成績、見つからない場合は null
   */
  getJockeyVenueStats(
    jockeyId: number,
    venueName: string,
    beforeDate?: string
  ): JockeyVenueStats | null {
    const params: (number | string)[] = beforeDate
      ? [jockeyId, venueName, beforeDate]
      : [jockeyId, venueName];

    // 基本成績
    const statsSql = beforeDate ? JOCKEY_VENUE_STATS_AS_OF_SQL : JOCKEY_VENUE_STATS_SQL;
    const stats = this.db.prepare(statsSql).get(...params) as {
      total_runs: number;
      wins: number;
      places: number;
      shows: number;
    } | undefined;

    if (!stats) return null;

    // G1成績
    const g1Sql = beforeDate ? JOCKEY_VENUE_G1_STATS_AS_OF_SQL : JOCKEY_VENUE_G1_STATS_SQL;
    const g1Stats = this.db.prepare(g1Sql).get(...params) as {
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
   *
   * @param jockeyId - 騎手ID
   * @param beforeDate - as-of カットオフ日（省略時は全期間）
   */
  getJockeyOverallStats(jockeyId: number, beforeDate?: string): JockeyOverallStats | null {
    const params: (number | string)[] = beforeDate ? [jockeyId, beforeDate] : [jockeyId];

    const statsSql = beforeDate ? JOCKEY_OVERALL_STATS_AS_OF_SQL : JOCKEY_OVERALL_STATS_SQL;
    const stats = this.db.prepare(statsSql).get(...params) as {
      total_runs: number;
      wins: number;
      places: number;
      shows: number;
    } | undefined;

    if (!stats) return null;

    // G1成績
    const g1Sql = beforeDate ? JOCKEY_OVERALL_G1_STATS_AS_OF_SQL : JOCKEY_OVERALL_G1_STATS_SQL;
    const g1Stats = this.db.prepare(g1Sql).get(...params) as {
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
   *
   * @param jockeyId - 騎手ID
   * @param trainerId - 調教師ID
   * @param beforeDate - as-of カットオフ日（省略時は全期間）
   */
  getJockeyTrainerStats(
    jockeyId: number,
    trainerId: number,
    beforeDate?: string
  ): JockeyTrainerComboStats | null {
    const params: (number | string)[] = beforeDate
      ? [jockeyId, trainerId, beforeDate]
      : [jockeyId, trainerId];

    const sql = beforeDate ? JOCKEY_TRAINER_STATS_AS_OF_SQL : JOCKEY_TRAINER_STATS_SQL;
    const stats = this.db.prepare(sql).get(...params) as {
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
