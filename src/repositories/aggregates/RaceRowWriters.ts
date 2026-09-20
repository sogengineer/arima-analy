/**
 * レース集約の行書き込み（UPDATE / INSERT）
 *
 * @remarks
 * `RaceAggregateRepository` から切り出した、列の詰め替えだけを行う関数群。
 * 取得・分岐は呼び出し側（集約リポジトリ）の責務で、ここは
 * 「渡された値をどの列に入れるか」だけを持つ。
 * UPDATE は `COALESCE(?, 列)` で、渡されなかった項目の既存値を保つ。
 */

import type { Database } from 'bun:sqlite';
import type {
  RaceImportData,
  EntryImportData,
  ResultImportData
} from '../../types/HorseData';

/** 既存レースを、渡された値がある項目だけ上書きする */
export function updateRaceRow(db: Database, raceId: number, data: RaceImportData): void {
  db.prepare(`
    UPDATE races SET
      race_name = COALESCE(?, race_name),
      race_class = COALESCE(?, race_class),
      race_type = COALESCE(?, race_type),
      distance = COALESCE(?, distance),
      track_condition = COALESCE(?, track_condition),
      total_horses = COALESCE(?, total_horses),
      grade = COALESCE(?, grade),
      course_detail = COALESCE(?, course_detail),
      age_condition = COALESCE(?, age_condition),
      sex_condition = COALESCE(?, sex_condition),
      weight_condition = COALESCE(?, weight_condition),
      weather = COALESCE(?, weather),
      start_time = COALESCE(?, start_time),
      kaisai_label = COALESCE(?, kaisai_label),
      lap_times = COALESCE(?, lap_times),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.raceName,
    data.raceClass ?? null,
    data.raceType ?? null,
    data.distance,
    data.trackCondition ?? null,
    data.totalHorses ?? null,
    data.grade ?? null,
    data.courseDetail ?? null,
    data.ageCondition ?? null,
    data.sexCondition ?? null,
    data.weightCondition ?? null,
    data.weather ?? null,
    data.startTime ?? null,
    data.kaisaiLabel ?? null,
    data.lapTimes ?? null,
    raceId
  );
}

/** レースを新規登録し、採番されたIDを返す */
export function insertRaceRow(
  db: Database,
  data: RaceImportData,
  venueId: number,
  raceNumber: number
): number {
  const result = db.prepare(`
    INSERT INTO races (
      race_date, venue_id, race_number, race_name, race_class, race_type, distance,
      track_condition, total_horses, grade, course_detail, age_condition, sex_condition,
      weight_condition, weather, start_time, kaisai_label, lap_times, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    data.raceDate,
    venueId,
    raceNumber,
    data.raceName,
    data.raceClass ?? null,
    data.raceType ?? null,
    data.distance,
    data.trackCondition ?? null,
    data.totalHorses ?? null,
    data.grade ?? null,
    data.courseDetail ?? null,
    data.ageCondition ?? null,
    data.sexCondition ?? null,
    data.weightCondition ?? null,
    data.weather ?? null,
    data.startTime ?? null,
    data.kaisaiLabel ?? null,
    data.lapTimes ?? null
  );
  return result.lastInsertRowid as number;
}

/** 既存の出馬表エントリを、渡された値がある項目だけ上書きする */
export function updateEntryRow(
  db: Database,
  entryId: number,
  data: EntryImportData,
  jockeyId: number
): void {
  db.prepare(`
    UPDATE race_entries SET
      jockey_id = COALESCE(?, jockey_id),
      frame_number = COALESCE(?, frame_number),
      horse_number = COALESCE(?, horse_number),
      assigned_weight = COALESCE(?, assigned_weight),
      win_odds = COALESCE(?, win_odds),
      popularity = COALESCE(?, popularity),
      horse_weight = COALESCE(?, horse_weight),
      weight_change = COALESCE(?, weight_change),
      career_wins = COALESCE(?, career_wins),
      career_places = COALESCE(?, career_places),
      career_shows = COALESCE(?, career_shows),
      career_runs = COALESCE(?, career_runs),
      total_prize_money = COALESCE(?, total_prize_money)
    WHERE id = ?
  `).run(
    jockeyId,
    data.frameNumber ?? null,
    data.horseNumber ?? null,
    data.assignedWeight ?? null,
    data.winOdds ?? null,
    data.popularity ?? null,
    data.horseWeight ?? null,
    data.weightChange ?? null,
    data.careerWins ?? null,
    data.careerPlaces ?? null,
    data.careerShows ?? null,
    data.careerRuns ?? null,
    data.totalPrizeMoney ?? null,
    entryId
  );
}

/** 出馬表エントリを新規登録し、採番されたIDを返す */
export function insertEntryRow(
  db: Database,
  ids: { raceId: number; horseId: number; jockeyId: number },
  data: EntryImportData
): number {
  const result = db.prepare(`
    INSERT INTO race_entries (
      race_id, horse_id, jockey_id, frame_number, horse_number, assigned_weight,
      win_odds, popularity, horse_weight, weight_change,
      career_wins, career_places, career_shows, career_runs, total_prize_money
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ids.raceId,
    ids.horseId,
    ids.jockeyId,
    data.frameNumber ?? null,
    data.horseNumber,
    data.assignedWeight ?? null,
    data.winOdds ?? null,
    data.popularity ?? null,
    data.horseWeight ?? null,
    data.weightChange ?? null,
    data.careerWins ?? null,
    data.careerPlaces ?? null,
    data.careerShows ?? null,
    data.careerRuns ?? null,
    data.totalPrizeMoney ?? null
  );
  return result.lastInsertRowid as number;
}

/** 既存のレース結果を、渡された値がある項目だけ上書きする */
export function updateResultRow(db: Database, resultId: number, data: ResultImportData): void {
  db.prepare(`
    UPDATE race_results SET
      finish_position = COALESCE(?, finish_position),
      finish_status = COALESCE(?, finish_status),
      finish_time = COALESCE(?, finish_time),
      finish_time_ms = COALESCE(?, finish_time_ms),
      margin = COALESCE(?, margin),
      margin_seconds = COALESCE(?, margin_seconds),
      last_3f_time = COALESCE(?, last_3f_time),
      last_3f_rank = COALESCE(?, last_3f_rank),
      corner_positions = COALESCE(?, corner_positions),
      final_win_odds = COALESCE(?, final_win_odds),
      final_place_odds = COALESCE(?, final_place_odds),
      rating = COALESCE(?, rating)
    WHERE id = ?
  `).run(
    data.finishPosition ?? null,
    data.finishStatus ?? null,
    data.finishTime ?? null,
    data.finishTimeMs ?? null,
    data.margin ?? null,
    data.marginSeconds ?? null,
    data.last3fTime ?? null,
    data.last3fRank ?? null,
    data.cornerPositions ?? null,
    data.finalWinOdds ?? null,
    data.finalPlaceOdds ?? null,
    data.rating ?? null,
    resultId
  );
}

/** レース結果を新規登録し、採番されたIDを返す */
export function insertResultRow(db: Database, entryId: number, data: ResultImportData): number {
  const result = db.prepare(`
    INSERT INTO race_results (
      entry_id, finish_position, finish_status, finish_time, finish_time_ms,
      margin, margin_seconds, last_3f_time, last_3f_rank, corner_positions,
      final_win_odds, final_place_odds, rating
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entryId,
    data.finishPosition ?? null,
    data.finishStatus ?? '完走',
    data.finishTime ?? null,
    data.finishTimeMs ?? null,
    data.margin ?? null,
    data.marginSeconds ?? null,
    data.last3fTime ?? null,
    data.last3fRank ?? null,
    data.cornerPositions ?? null,
    data.finalWinOdds ?? null,
    data.finalPlaceOdds ?? null,
    data.rating ?? null
  );
  return result.lastInsertRowid as number;
}
