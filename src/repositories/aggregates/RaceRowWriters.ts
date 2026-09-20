/**
 * レース集約の行書き込み（UPDATE / INSERT）
 *
 * @remarks
 * `RaceAggregateRepository` から切り出した、列の詰め替えだけを行う関数群。
 * 取得・分岐は呼び出し側（集約リポジトリ）の責務で、ここは
 * 「渡された値をどの列に入れるか」だけを持つ。
 * UPDATE は `COALESCE(?, 列)` で、渡されなかった項目の既存値を保つ。
 * Kysely の `set()` / `values()` は列名をキーにするので、値の並びが列とずれることがない。
 *
 * UPDATE に渡す値には、型の上では必須の項目も含めて `?? null` を付ける。
 * `undefined` のままだとバインド値に載って `QueryRunner` が例外にするため、
 * 「値が無い＝既存値を保つ」を `COALESCE(NULL, 列)` として明示する。
 */

import type { Database } from 'bun:sqlite';
import { sql } from 'kysely';
import { queryBuilder, runStatement } from '@/database/QueryRunner';
import type {
  RaceImportData,
  EntryImportData,
  ResultImportData
} from '@/types/HorseData';

/**
 * `updated_at` に入れる SQLite の現在時刻
 *
 * @remarks
 * ビルダーの値としては表現できない SQL のキーワードなので `sql` タグ付きテンプレートで書く。
 */
const CURRENT_TIMESTAMP = sql<string>`CURRENT_TIMESTAMP`;

/** 既存レースを、渡された値がある項目だけ上書きする */
export function updateRaceRow(db: Database, raceId: number, data: RaceImportData): void {
  runStatement(
    db,
    queryBuilder
      .updateTable('races')
      .set(eb => ({
        race_name: eb.fn.coalesce(eb.val(data.raceName ?? null), eb.ref('race_name')),
        race_class: eb.fn.coalesce(eb.val(data.raceClass ?? null), eb.ref('race_class')),
        race_type: eb.fn.coalesce(eb.val(data.raceType ?? null), eb.ref('race_type')),
        distance: eb.fn.coalesce(eb.val(data.distance ?? null), eb.ref('distance')),
        track_condition: eb.fn.coalesce(eb.val(data.trackCondition ?? null), eb.ref('track_condition')),
        total_horses: eb.fn.coalesce(eb.val(data.totalHorses ?? null), eb.ref('total_horses')),
        grade: eb.fn.coalesce(eb.val(data.grade ?? null), eb.ref('grade')),
        course_detail: eb.fn.coalesce(eb.val(data.courseDetail ?? null), eb.ref('course_detail')),
        age_condition: eb.fn.coalesce(eb.val(data.ageCondition ?? null), eb.ref('age_condition')),
        sex_condition: eb.fn.coalesce(eb.val(data.sexCondition ?? null), eb.ref('sex_condition')),
        weight_condition: eb.fn.coalesce(eb.val(data.weightCondition ?? null), eb.ref('weight_condition')),
        weather: eb.fn.coalesce(eb.val(data.weather ?? null), eb.ref('weather')),
        start_time: eb.fn.coalesce(eb.val(data.startTime ?? null), eb.ref('start_time')),
        kaisai_label: eb.fn.coalesce(eb.val(data.kaisaiLabel ?? null), eb.ref('kaisai_label')),
        lap_times: eb.fn.coalesce(eb.val(data.lapTimes ?? null), eb.ref('lap_times')),
        updated_at: CURRENT_TIMESTAMP
      }))
      .where('id', '=', raceId)
      .compile()
  );
}

/** レースを新規登録し、採番されたIDを返す */
export function insertRaceRow(
  db: Database,
  data: RaceImportData,
  venueId: number,
  raceNumber: number
): number {
  const result = runStatement(
    db,
    queryBuilder
      .insertInto('races')
      .values({
        race_date: data.raceDate,
        venue_id: venueId,
        race_number: raceNumber,
        race_name: data.raceName,
        race_class: data.raceClass ?? null,
        race_type: data.raceType ?? null,
        distance: data.distance,
        track_condition: data.trackCondition ?? null,
        total_horses: data.totalHorses ?? null,
        grade: data.grade ?? null,
        course_detail: data.courseDetail ?? null,
        age_condition: data.ageCondition ?? null,
        sex_condition: data.sexCondition ?? null,
        weight_condition: data.weightCondition ?? null,
        weather: data.weather ?? null,
        start_time: data.startTime ?? null,
        kaisai_label: data.kaisaiLabel ?? null,
        lap_times: data.lapTimes ?? null,
        updated_at: CURRENT_TIMESTAMP
      })
      .compile()
  );
  return Number(result.lastInsertRowid);
}

/** 既存の出馬表エントリを、渡された値がある項目だけ上書きする */
export function updateEntryRow(
  db: Database,
  entryId: number,
  data: EntryImportData,
  jockeyId: number
): void {
  runStatement(
    db,
    queryBuilder
      .updateTable('race_entries')
      .set(eb => ({
        jockey_id: eb.fn.coalesce(eb.val(jockeyId ?? null), eb.ref('jockey_id')),
        frame_number: eb.fn.coalesce(eb.val(data.frameNumber ?? null), eb.ref('frame_number')),
        horse_number: eb.fn.coalesce(eb.val(data.horseNumber ?? null), eb.ref('horse_number')),
        assigned_weight: eb.fn.coalesce(eb.val(data.assignedWeight ?? null), eb.ref('assigned_weight')),
        win_odds: eb.fn.coalesce(eb.val(data.winOdds ?? null), eb.ref('win_odds')),
        popularity: eb.fn.coalesce(eb.val(data.popularity ?? null), eb.ref('popularity')),
        horse_weight: eb.fn.coalesce(eb.val(data.horseWeight ?? null), eb.ref('horse_weight')),
        weight_change: eb.fn.coalesce(eb.val(data.weightChange ?? null), eb.ref('weight_change')),
        career_wins: eb.fn.coalesce(eb.val(data.careerWins ?? null), eb.ref('career_wins')),
        career_places: eb.fn.coalesce(eb.val(data.careerPlaces ?? null), eb.ref('career_places')),
        career_shows: eb.fn.coalesce(eb.val(data.careerShows ?? null), eb.ref('career_shows')),
        career_runs: eb.fn.coalesce(eb.val(data.careerRuns ?? null), eb.ref('career_runs')),
        total_prize_money: eb.fn.coalesce(
          eb.val(data.totalPrizeMoney ?? null),
          eb.ref('total_prize_money')
        )
      }))
      .where('id', '=', entryId)
      .compile()
  );
}

/** 出馬表エントリを新規登録し、採番されたIDを返す */
export function insertEntryRow(
  db: Database,
  ids: { raceId: number; horseId: number; jockeyId: number },
  data: EntryImportData
): number {
  const result = runStatement(
    db,
    queryBuilder
      .insertInto('race_entries')
      .values({
        race_id: ids.raceId,
        horse_id: ids.horseId,
        jockey_id: ids.jockeyId,
        frame_number: data.frameNumber ?? null,
        horse_number: data.horseNumber,
        assigned_weight: data.assignedWeight ?? null,
        win_odds: data.winOdds ?? null,
        popularity: data.popularity ?? null,
        horse_weight: data.horseWeight ?? null,
        weight_change: data.weightChange ?? null,
        career_wins: data.careerWins ?? null,
        career_places: data.careerPlaces ?? null,
        career_shows: data.careerShows ?? null,
        career_runs: data.careerRuns ?? null,
        total_prize_money: data.totalPrizeMoney ?? null
      })
      .compile()
  );
  return Number(result.lastInsertRowid);
}

/** 既存のレース結果を、渡された値がある項目だけ上書きする */
export function updateResultRow(db: Database, resultId: number, data: ResultImportData): void {
  runStatement(
    db,
    queryBuilder
      .updateTable('race_results')
      .set(eb => ({
        finish_position: eb.fn.coalesce(eb.val(data.finishPosition ?? null), eb.ref('finish_position')),
        // INSERT と違い「完走」を既定値にしない（未指定の更新で既存の状態を塗り替えないため）
        finish_status: eb.fn.coalesce(eb.val(data.finishStatus ?? null), eb.ref('finish_status')),
        finish_time: eb.fn.coalesce(eb.val(data.finishTime ?? null), eb.ref('finish_time')),
        finish_time_ms: eb.fn.coalesce(eb.val(data.finishTimeMs ?? null), eb.ref('finish_time_ms')),
        margin: eb.fn.coalesce(eb.val(data.margin ?? null), eb.ref('margin')),
        margin_seconds: eb.fn.coalesce(eb.val(data.marginSeconds ?? null), eb.ref('margin_seconds')),
        last_3f_time: eb.fn.coalesce(eb.val(data.last3fTime ?? null), eb.ref('last_3f_time')),
        last_3f_rank: eb.fn.coalesce(eb.val(data.last3fRank ?? null), eb.ref('last_3f_rank')),
        corner_positions: eb.fn.coalesce(
          eb.val(data.cornerPositions ?? null),
          eb.ref('corner_positions')
        ),
        final_win_odds: eb.fn.coalesce(eb.val(data.finalWinOdds ?? null), eb.ref('final_win_odds')),
        final_place_odds: eb.fn.coalesce(
          eb.val(data.finalPlaceOdds ?? null),
          eb.ref('final_place_odds')
        ),
        rating: eb.fn.coalesce(eb.val(data.rating ?? null), eb.ref('rating'))
      }))
      .where('id', '=', resultId)
      .compile()
  );
}

/** レース結果を新規登録し、採番されたIDを返す */
export function insertResultRow(db: Database, entryId: number, data: ResultImportData): number {
  const result = runStatement(
    db,
    queryBuilder
      .insertInto('race_results')
      .values({
        entry_id: entryId,
        finish_position: data.finishPosition ?? null,
        // 新規登録だけは「完走」を既定値にする
        finish_status: data.finishStatus ?? '完走',
        finish_time: data.finishTime ?? null,
        finish_time_ms: data.finishTimeMs ?? null,
        margin: data.margin ?? null,
        margin_seconds: data.marginSeconds ?? null,
        last_3f_time: data.last3fTime ?? null,
        last_3f_rank: data.last3fRank ?? null,
        corner_positions: data.cornerPositions ?? null,
        final_win_odds: data.finalWinOdds ?? null,
        final_place_odds: data.finalPlaceOdds ?? null,
        rating: data.rating ?? null
      })
      .compile()
  );
  return Number(result.lastInsertRowid);
}
