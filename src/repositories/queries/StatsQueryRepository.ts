/**
 * 統計・スコアの取得リポジトリ
 */

import type Database from 'better-sqlite3';
import type { BloodlineStats, HorseScoreRecord } from '../../types/RepositoryTypes';
import type { DBSire } from '../../types/HorseData';

export class StatsQueryRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * 血統統計を取得
   */
  getBloodlineStats(sireId: number): BloodlineStats[] {
    return this.db.prepare(`
      SELECT bs.*, s.name as sire_name
      FROM bloodline_stats bs
      JOIN sires s ON bs.sire_id = s.id
      WHERE bs.sire_id = ?
    `).all(sireId) as BloodlineStats[];
  }

  /**
   * 馬スコアを取得（レース指定）
   */
  getHorseScoresForRace(raceId: number): (HorseScoreRecord & { horse_name: string })[] {
    return this.db.prepare(`
      SELECT hs.*, h.name as horse_name
      FROM horse_scores hs
      JOIN horses h ON hs.horse_id = h.id
      WHERE hs.race_id = ?
      ORDER BY hs.total_score DESC
    `).all(raceId) as (HorseScoreRecord & { horse_name: string })[];
  }

  /**
   * 馬スコアを取得（全件）
   */
  getAllHorseScores(): (HorseScoreRecord & { horse_name: string })[] {
    return this.db.prepare(`
      SELECT hs.*, h.name as horse_name
      FROM horse_scores hs
      JOIN horses h ON hs.horse_id = h.id
      ORDER BY hs.total_score DESC
    `).all() as (HorseScoreRecord & { horse_name: string })[];
  }

  /**
   * 馬スコアを取得（馬ID指定）
   */
  getHorseScoreByHorseId(horseId: number, raceId?: number): HorseScoreRecord | undefined {
    if (raceId) {
      return this.db.prepare(`
        SELECT * FROM horse_scores
        WHERE horse_id = ? AND race_id = ?
      `).get(horseId, raceId) as HorseScoreRecord | undefined;
    }
    return this.db.prepare(`
      SELECT * FROM horse_scores
      WHERE horse_id = ?
      ORDER BY race_id DESC
      LIMIT 1
    `).get(horseId) as HorseScoreRecord | undefined;
  }

  /**
   * 全種牡馬を取得
   */
  getAllSires(): DBSire[] {
    return this.db.prepare(
      'SELECT * FROM sires ORDER BY name'
    ).all() as DBSire[];
  }

  /**
   * 種牡馬をIDで取得
   */
  getSireById(sireId: number): DBSire | undefined {
    return this.db.prepare(
      'SELECT * FROM sires WHERE id = ?'
    ).get(sireId) as DBSire | undefined;
  }

  /**
   * 種牡馬を名前で取得
   */
  getSireByName(name: string): DBSire | undefined {
    return this.db.prepare(
      'SELECT * FROM sires WHERE name = ?'
    ).get(name) as DBSire | undefined;
  }
}
