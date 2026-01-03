/**
 * E2Eテスト用データベースヘルパー
 *
 * @remarks
 * テスト用の一時的なSQLiteデータベースを管理する。
 * 各テストスイートで独立したDBを使用することで、テスト間の干渉を防ぐ。
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HorseAggregateRepository } from '../../repositories/aggregates/HorseAggregateRepository';
import { RaceAggregateRepository } from '../../repositories/aggregates/RaceAggregateRepository';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TestDatabase {
  db: Database.Database;
  horseRepo: HorseAggregateRepository;
  raceRepo: RaceAggregateRepository;
  close: () => void;
  cleanup: () => void;
}

/**
 * テスト用データベースを作成
 *
 * @param name - テスト名（ファイル名に使用）
 * @returns テストDB管理オブジェクト
 */
export function createTestDb(name: string): TestDatabase {
  const dbPath = `./test-${name}-${Date.now()}.db`;

  // 既存ファイルがあれば削除
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  const db = new Database(dbPath);

  // 外部キー制約を有効化
  db.pragma('foreign_keys = ON');

  // スキーマを読み込んで初期化
  const schemaPath = join(__dirname, '../../database/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  const horseRepo = new HorseAggregateRepository(db);
  const raceRepo = new RaceAggregateRepository(db);

  return {
    db,
    horseRepo,
    raceRepo,
    close: () => db.close(),
    cleanup: () => {
      db.close();
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
      }
    }
  };
}

/**
 * テストデータをシード
 *
 * @param testDb - テストDB管理オブジェクト
 * @param scenario - シナリオ名
 */
export function seedTestData(testDb: TestDatabase, scenario: 'basic' | 'g1' | 'full'): void {
  const { horseRepo, raceRepo } = testDb;

  switch (scenario) {
    case 'basic':
      seedBasicData(horseRepo, raceRepo);
      break;
    case 'g1':
      seedG1Data(horseRepo, raceRepo);
      break;
    case 'full':
      seedFullData(horseRepo, raceRepo);
      break;
  }
}

/**
 * 基本的なテストデータをシード
 */
function seedBasicData(
  horseRepo: HorseAggregateRepository,
  raceRepo: RaceAggregateRepository
): void {
  // 馬を3頭登録
  const horse1 = horseRepo.insertHorseWithBloodline({
    name: 'テスト馬A',
    birthYear: 2020,
    sex: '牡',
    sire: 'テスト父A',
    mare: 'テスト母A',
    trainer: 'テスト調教師'
  });

  const horse2 = horseRepo.insertHorseWithBloodline({
    name: 'テスト馬B',
    birthYear: 2020,
    sex: '牝',
    sire: 'テスト父B',
    mare: 'テスト母B',
    trainer: 'テスト調教師'
  });

  const horse3 = horseRepo.insertHorseWithBloodline({
    name: 'テスト馬C',
    birthYear: 2020,
    sex: '牡',
    sire: 'テスト父C',
    mare: 'テスト母C',
    trainer: 'テスト調教師2'
  });

  // レースを登録
  const race = raceRepo.insertRace({
    raceDate: '2024-12-22',
    venue: '中山',
    raceNumber: 11,
    raceName: 'テストレース',
    raceClass: 'オープン',
    raceType: '芝',
    distance: 2000,
    trackCondition: '良'
  });

  // 出馬表を登録
  raceRepo.insertRaceEntry(race.id, {
    horseName: 'テスト馬A',
    sireName: 'テスト父A',
    mareName: 'テスト母A',
    jockeyName: 'テスト騎手1',
    frameNumber: 1,
    horseNumber: 1,
    assignedWeight: 57,
    winOdds: 3.5,
    popularity: 1
  });

  raceRepo.insertRaceEntry(race.id, {
    horseName: 'テスト馬B',
    sireName: 'テスト父B',
    mareName: 'テスト母B',
    jockeyName: 'テスト騎手2',
    frameNumber: 2,
    horseNumber: 2,
    assignedWeight: 55,
    winOdds: 5.0,
    popularity: 2
  });

  raceRepo.insertRaceEntry(race.id, {
    horseName: 'テスト馬C',
    sireName: 'テスト父C',
    mareName: 'テスト母C',
    jockeyName: 'テスト騎手3',
    frameNumber: 3,
    horseNumber: 3,
    assignedWeight: 57,
    winOdds: 10.0,
    popularity: 3
  });
}

/**
 * G1レースのテストデータをシード
 */
function seedG1Data(
  horseRepo: HorseAggregateRepository,
  raceRepo: RaceAggregateRepository
): void {
  // G1級の馬を登録
  const horses = [
    { name: 'イクイノックス', sire: 'キタサンブラック', mare: 'シャトーブランシュ' },
    { name: 'ドウデュース', sire: 'ハーツクライ', mare: 'ダストアンドダイヤモンズ' },
    { name: 'リバティアイランド', sire: 'ドゥラメンテ', mare: 'ヤンキーローズ' }
  ];

  for (const h of horses) {
    horseRepo.insertHorseWithBloodline({
      name: h.name,
      birthYear: 2019,
      sex: '牡',
      sire: h.sire,
      mare: h.mare,
      trainer: 'テスト調教師'
    });
  }

  // G1レースを登録
  const race = raceRepo.insertRace({
    raceDate: '2024-12-22',
    venue: '中山',
    raceNumber: 11,
    raceName: '有馬記念',
    raceClass: 'G1',
    raceType: '芝',
    distance: 2500,
    trackCondition: '良',
    totalHorses: 16
  });

  // 出馬表を登録
  horses.forEach((h, i) => {
    raceRepo.insertRaceEntry(race.id, {
      horseName: h.name,
      sireName: h.sire,
      mareName: h.mare,
      jockeyName: `騎手${i + 1}`,
      frameNumber: i + 1,
      horseNumber: i + 1,
      assignedWeight: 57,
      winOdds: (i + 1) * 2.5,
      popularity: i + 1
    });
  });
}

/**
 * 完全なテストデータをシード（過去レース・結果含む）
 */
function seedFullData(
  horseRepo: HorseAggregateRepository,
  raceRepo: RaceAggregateRepository
): void {
  // まず基本データをシード
  seedG1Data(horseRepo, raceRepo);

  // 過去レースを追加
  const pastRace = raceRepo.insertRace({
    raceDate: '2024-11-01',
    venue: '東京',
    raceNumber: 11,
    raceName: '天皇賞（秋）',
    raceClass: 'G1',
    raceType: '芝',
    distance: 2000,
    trackCondition: '良'
  });

  // 過去レースの出馬表と結果
  const entry1 = raceRepo.insertRaceEntry(pastRace.id, {
    horseName: 'イクイノックス',
    sireName: 'キタサンブラック',
    mareName: 'シャトーブランシュ',
    jockeyName: '騎手1',
    frameNumber: 1,
    horseNumber: 1,
    assignedWeight: 58,
    winOdds: 1.5,
    popularity: 1
  });

  raceRepo.insertRaceResult(entry1.id, {
    finishPosition: 1,
    finishStatus: '完走',
    finishTime: '1:56.0',
    margin: '0',
    last3fTime: 33.5
  });

  const entry2 = raceRepo.insertRaceEntry(pastRace.id, {
    horseName: 'ドウデュース',
    sireName: 'ハーツクライ',
    mareName: 'ダストアンドダイヤモンズ',
    jockeyName: '騎手2',
    frameNumber: 2,
    horseNumber: 2,
    assignedWeight: 58,
    winOdds: 3.0,
    popularity: 2
  });

  raceRepo.insertRaceResult(entry2.id, {
    finishPosition: 2,
    finishStatus: '完走',
    finishTime: '1:56.2',
    margin: 'クビ',
    last3fTime: 33.8
  });
}

/**
 * テスト用のダミーDBパス
 */
export function getTestDbPath(name: string): string {
  return `./test-${name}-${Date.now()}.db`;
}
