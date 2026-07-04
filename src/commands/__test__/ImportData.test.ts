import { describe, it, expect, beforeEach, afterEach, spyOn, jest } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { createTestDb, type TestDatabase } from '../../test/helpers/testDb';
import { ExtractedRaceData, HorseData } from '../../types/HorseData.js';
import { ImportData } from '../ImportData.js';

/**
 * ImportData インポートテスト
 *
 * ## 更新判定ロジック（一致条件）
 *
 * | エンティティ | 一致条件 | 一致時の動作 | 更新対象 |
 * |-------------|---------|-------------|---------|
 * | 馬 (horses) | 馬名 + 父 + 母 | UPDATE | birth_year, sex, trainer_id, owner_id, breeder_id |
 * | レース (races) | 開催日 + 会場 + レース番号 | UPDATE | race_name, race_class, race_type, distance, track_condition |
 * | 出馬表 (race_entries) | レースID + 馬ID | UPDATE | jockey_id, horse_number, win_odds, popularity, etc. |
 * | レース結果 (race_results) | エントリID | UPDATE | finish_position, finish_time, margin, last_3f_time |
 * | 騎手等マスタ | 名前 | getOrCreate | なし（既存IDを返すのみ） |
 *
 * ## ケース別動作
 *
 * 1. 同じ馬が別レースに出馬
 *    - 馬: 更新（既存IDを再利用）
 *    - 出馬表: 新規（レースIDが異なるため）
 *
 * 2. 過去レースが既に存在（別の出馬表で登録済み）
 *    - レース: 更新（日付+会場+レース番号が一致）
 *    - 他馬のエントリ: 新規（馬IDが異なるため）
 *
 * 3. 同じ馬の同じ過去レースを再登録
 *    - レース: 更新
 *    - エントリ: 更新（レースID + 馬IDが一致）
 *    - 結果: 更新（エントリIDが一致）
 */

// ============================================
// テストデータ生成ヘルパー
// ============================================

function createTestHorse(overrides: Partial<{
  name: string;
  age: number;
  sex: '牡' | '牝' | '騸';
  sire: string;
  mare: string;
  maresSire: string;
  trainer: string;
  trainerDivision: '美浦' | '栗東';
  owner: string;
  breeder: string;
  jockey: string;
  jockeyWeight: number;
  frameNumber: number;
  horseNumber: number;
  winOdds: number;
  popularity: number;
  previousRaces: HorseData['previousRaces'];
}> = {}): HorseData {
  return {
    basicInfo: {
      name: overrides.name ?? 'テスト馬',
      age: overrides.age ?? 4,
      sex: overrides.sex ?? '牡',
      color: '鹿毛',
      ownerName: overrides.owner ?? 'テスト馬主',
      breederName: overrides.breeder ?? 'テスト生産者',
      trainerName: overrides.trainer ?? 'テスト調教師',
      trainerDivision: overrides.trainerDivision ?? '栗東',
    },
    bloodline: {
      sire: overrides.sire ?? 'テスト種牡馬',
      mare: overrides.mare ?? 'テスト母馬',
      maresSire: overrides.maresSire ?? 'テスト母父',
    },
    jockey: {
      name: overrides.jockey ?? 'テスト騎手',
      weight: overrides.jockeyWeight ?? 57,
    },
    raceInfo: {
      frameNumber: overrides.frameNumber ?? 1,
      horseNumber: overrides.horseNumber ?? 1,
      assignedWeight: overrides.jockeyWeight ?? 57,
      winOdds: overrides.winOdds ?? 5.0,
      popularity: overrides.popularity ?? 1,
    },
    record: {
      wins: 3,
      places: 2,
      shows: 1,
      runs: 10,
      prizeMoney: '10000万円',
    },
    previousRaces: overrides.previousRaces ?? [],
  };
}

function createTestRaceData(overrides: Partial<{
  date: string;
  venue: string;
  raceNumber: number;
  raceName: string;
  distance: number;
  courseType: '芝' | 'ダート' | '障害';
  trackCondition: string;
  raceClass: string;
  horses: HorseData[];
}> = {}): ExtractedRaceData {
  return {
    url: 'https://www.jra.go.jp/test',
    extractedAt: new Date().toISOString(),
    raceInfo: {
      date: overrides.date ?? '2025-01-01',
      venue: overrides.venue ?? '中山',
      raceNumber: overrides.raceNumber ?? 11,
      raceName: overrides.raceName ?? 'テストレース',
      distance: overrides.distance ?? 2500,
      trackCondition: overrides.trackCondition ?? '良',
      courseType: overrides.courseType ?? '芝',
      raceClass: overrides.raceClass ?? 'G1',
    },
    horseCount: overrides.horses?.length ?? 1,
    horses: overrides.horses ?? [createTestHorse()],
  };
}

function createPreviousRace(overrides: Partial<{
  position: 'front' | 'second' | 'third' | 'fourth';
  date: string;
  track: string;
  raceName: string;
  place: string;
  totalHorses: number;
  gateNumber: number;
  popularity: number;
  jockey: string;
  weight: number;
  distance: string;
  time: string;
  trackCondition: string;
}> = {}): HorseData['previousRaces'][0] {
  return {
    position: overrides.position ?? 'front',
    date: overrides.date ?? '2024年12月1日',
    track: overrides.track ?? '中山',
    raceName: overrides.raceName ?? '前走テスト',
    place: overrides.place ?? '1',
    totalHorses: overrides.totalHorses ?? 16,
    gateNumber: overrides.gateNumber ?? 5,
    popularity: overrides.popularity ?? 1,
    jockey: overrides.jockey ?? 'テスト騎手',
    weight: overrides.weight ?? 57,
    distance: overrides.distance ?? '2000芝',
    time: overrides.time ?? '2:00.0',
    trackCondition: overrides.trackCondition ?? '良',
  };
}

// ============================================
// DB検証ヘルパー
// ============================================

function getRaceById(db: Database, id: number) {
  return db.prepare(`
    SELECT r.*, v.name AS venue_name
    FROM races r
    LEFT JOIN venues v ON r.venue_id = v.id
    WHERE r.id = ?
  `).get(id) as {
    id: number;
    race_date: string;
    race_name: string;
    race_class: string | null;
    race_type: string | null;
    distance: number;
    track_condition: string | null;
    venue_name: string;
  } | undefined;
}

function getHorseWithBloodline(db: Database, id: number) {
  return db.prepare(`
    SELECT h.*,
           s.name AS sire_name,
           m.name AS mare_name,
           t.name AS trainer_name,
           o.name AS owner_name
    FROM horses h
    LEFT JOIN sires s ON h.sire_id = s.id
    LEFT JOIN mares m ON h.mare_id = m.id
    LEFT JOIN trainers t ON h.trainer_id = t.id
    LEFT JOIN owners o ON h.owner_id = o.id
    WHERE h.id = ?
  `).get(id) as {
    id: number;
    name: string;
    birth_year: number | null;
    sex: string | null;
    sire_name: string | null;
    mare_name: string | null;
    trainer_name: string | null;
    owner_name: string | null;
  } | undefined;
}

// ============================================
// テストスイート（リポジトリ経由）
// ============================================

describe('ImportData - インポート機能', () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDb('import');
  });

  afterEach(() => {
    testDb.cleanup();
  });

  // ============================================
  // 1. 新規インポートテスト
  // ============================================

  describe('新規インポート', () => {
    it('新規レースが正しく登録される', () => {
      const result = testDb.raceRepo.insertRace({
        raceDate: '2025-01-15',
        venue: '東京',
        raceNumber: 5,
        raceName: '新規テストレース',
        raceType: '芝',
        distance: 1600,
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.updated).toBe(false);

      const race = getRaceById(testDb.db, result.id);
      expect(race).toBeDefined();
      expect(race?.race_name).toBe('新規テストレース');
      expect(race?.distance).toBe(1600);
      expect(race?.venue_name).toBe('東京');
    });

    it('新規馬が正しく登録される', () => {
      const result = testDb.horseRepo.insertHorseWithBloodline({
        name: '新馬テスト',
        birthYear: 2021,
        sex: '牡',
        sire: 'ディープインパクト',
        mare: 'テスト繁殖牝馬',
        maresSire: 'キングカメハメハ',
        trainer: '藤沢和雄',
        trainerStable: '美浦',
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.updated).toBe(false);

      const horse = getHorseWithBloodline(testDb.db, result.id);
      expect(horse).toBeDefined();
      expect(horse?.name).toBe('新馬テスト');
      expect(horse?.sire_name).toBe('ディープインパクト');
      expect(horse?.mare_name).toBe('テスト繁殖牝馬');
    });

    it('新規騎手が正しく登録される', () => {
      // 騎手はエントリ登録時に getOrCreate される
      testDb.horseRepo.insertHorseWithBloodline({ name: '騎手テスト馬', sire: '父', mare: '母' });
      const race = testDb.raceRepo.insertRace({
        raceDate: '2025-01-15',
        venue: '中山',
        raceNumber: 1,
        raceName: '騎手テストレース',
        distance: 1200,
      });

      testDb.raceRepo.insertRaceEntry(race.id, {
        horseName: '騎手テスト馬',
        sireName: '父',
        mareName: '母',
        jockeyName: '武豊',
        horseNumber: 1,
        assignedWeight: 56,
      });

      const jockey = testDb.db.prepare(
        'SELECT * FROM jockeys WHERE name = ?'
      ).get('武豊') as { id: number; default_weight: number } | undefined;
      expect(jockey).toBeDefined();
      expect(jockey?.id).toBeGreaterThan(0);
      expect(jockey?.default_weight).toBe(56);
    });
  });

  // ============================================
  // 2. 既存データ更新テスト
  // ============================================

  describe('既存データ更新', () => {
    describe('馬の更新（一致条件: 馬名 + 父 + 母）', () => {
      it('同じ馬名+父+母の場合は更新される', () => {
        // 初回登録
        const first = testDb.horseRepo.insertHorseWithBloodline({
          name: '更新テスト馬',
          birthYear: 2020,
          sex: '牡',
          sire: '父馬A',
          mare: '母馬A',
          trainer: '調教師A',
        });
        expect(first.updated).toBe(false);

        // 同じ馬名+父+母で再登録 → 更新されるはず
        const second = testDb.horseRepo.insertHorseWithBloodline({
          name: '更新テスト馬',
          birthYear: 2020, // 同じ
          sex: '牡',
          sire: '父馬A', // 同じ
          mare: '母馬A', // 同じ
          trainer: '調教師B', // 変更
        });

        expect(second.updated).toBe(true);
        expect(second.id).toBe(first.id); // 同じID

        const horse = getHorseWithBloodline(testDb.db, second.id);
        expect(horse?.trainer_name).toBe('調教師B');
      });

      it('同じ馬名でも父が異なれば新規登録（同姓同名馬の区別）', () => {
        // 初回登録
        const first = testDb.horseRepo.insertHorseWithBloodline({
          name: '同名馬',
          sire: '父馬X',
          mare: '母馬A',
        });

        // 同じ馬名だが父が異なる
        const second = testDb.horseRepo.insertHorseWithBloodline({
          name: '同名馬',
          sire: '父馬Y', // 異なる父
          mare: '母馬A',
        });

        expect(second.updated).toBe(false);
        expect(second.id).not.toBe(first.id); // 異なるID
      });

      it('同じ馬名でも母が異なれば新規登録', () => {
        const first = testDb.horseRepo.insertHorseWithBloodline({
          name: '同名馬2',
          sire: '父馬A',
          mare: '母馬X',
        });

        const second = testDb.horseRepo.insertHorseWithBloodline({
          name: '同名馬2',
          sire: '父馬A',
          mare: '母馬Y', // 異なる母
        });

        expect(second.updated).toBe(false);
        expect(second.id).not.toBe(first.id);
      });
    });

    describe('レースの更新（一致条件: 開催日 + 会場 + レース番号）', () => {
      it('同じ開催日+会場+レース番号の場合は更新される', () => {
        // 初回登録
        const first = testDb.raceRepo.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 11,
          raceName: '有馬記念',
          distance: 2500,
          raceType: '芝',
        });
        expect(first.updated).toBe(false);

        // 同じ条件で再登録 → 更新
        const second = testDb.raceRepo.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 11,
          raceName: '有馬記念（更新後）', // 変更
          distance: 2500,
          raceType: '芝',
          trackCondition: '良', // 追加
        });

        expect(second.updated).toBe(true);
        expect(second.id).toBe(first.id);

        const race = getRaceById(testDb.db, second.id);
        expect(race?.race_name).toBe('有馬記念（更新後）');
        expect(race?.track_condition).toBe('良');
      });

      it('異なるレース番号なら新規登録', () => {
        const first = testDb.raceRepo.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 10,
          raceName: '10R',
          distance: 1800,
        });

        const second = testDb.raceRepo.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 11, // 異なるレース番号
          raceName: '11R',
          distance: 2500,
        });

        expect(second.updated).toBe(false);
        expect(second.id).not.toBe(first.id);
      });

      it('異なる会場なら新規登録', () => {
        const first = testDb.raceRepo.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 11,
          raceName: '中山11R',
          distance: 2500,
        });

        const second = testDb.raceRepo.insertRace({
          raceDate: '2025-02-01',
          venue: '東京', // 異なる会場
          raceNumber: 11,
          raceName: '東京11R',
          distance: 1600,
        });

        expect(second.updated).toBe(false);
        expect(second.id).not.toBe(first.id);
      });
    });

    describe('出馬表の更新（一致条件: レースID + 馬ID）', () => {
      it('同じレース+馬の場合は更新される', () => {
        // 準備: 馬とレースを登録
        testDb.horseRepo.insertHorseWithBloodline({
          name: 'エントリテスト馬',
          sire: '父',
          mare: '母',
        });
        const race = testDb.raceRepo.insertRace({
          raceDate: '2025-03-01',
          venue: '阪神',
          raceNumber: 11,
          raceName: 'エントリテストレース',
          distance: 2000,
        });

        // 初回エントリ登録
        const first = testDb.raceRepo.insertRaceEntry(race.id, {
          horseName: 'エントリテスト馬',
          sireName: '父',
          mareName: '母',
          jockeyName: '騎手A',
          horseNumber: 1,
          popularity: 3,
        });
        expect(first.updated).toBe(false);

        // 同じレース+馬で再登録 → 更新
        const second = testDb.raceRepo.insertRaceEntry(race.id, {
          horseName: 'エントリテスト馬',
          sireName: '父',
          mareName: '母',
          jockeyName: '騎手B', // 変更
          horseNumber: 1,
          popularity: 1, // 変更
          winOdds: 2.5, // 追加
        });

        expect(second.updated).toBe(true);
        expect(second.id).toBe(first.id);
      });

      it('異なる馬なら新規登録（同じレース内）', () => {
        // 準備
        testDb.horseRepo.insertHorseWithBloodline({ name: '馬1', sire: '父1', mare: '母1' });
        testDb.horseRepo.insertHorseWithBloodline({ name: '馬2', sire: '父2', mare: '母2' });
        const race = testDb.raceRepo.insertRace({
          raceDate: '2025-03-02',
          venue: '京都',
          raceNumber: 11,
          raceName: 'マルチエントリテスト',
          distance: 3000,
        });

        const first = testDb.raceRepo.insertRaceEntry(race.id, {
          horseName: '馬1',
          sireName: '父1',
          mareName: '母1',
          jockeyName: '騎手',
          horseNumber: 1,
        });

        const second = testDb.raceRepo.insertRaceEntry(race.id, {
          horseName: '馬2',
          sireName: '父2',
          mareName: '母2',
          jockeyName: '騎手',
          horseNumber: 2,
        });

        expect(second.updated).toBe(false);
        expect(second.id).not.toBe(first.id);
      });
    });

    describe('レース結果の更新（一致条件: エントリID）', () => {
      it('同じエントリIDの場合は更新される', () => {
        // 準備
        testDb.horseRepo.insertHorseWithBloodline({ name: '結果テスト馬', sire: '父', mare: '母' });
        const race = testDb.raceRepo.insertRace({
          raceDate: '2025-04-01',
          venue: '中山',
          raceNumber: 11,
          raceName: '結果テストレース',
          distance: 2500,
        });
        const entry = testDb.raceRepo.insertRaceEntry(race.id, {
          horseName: '結果テスト馬',
          sireName: '父',
          mareName: '母',
          jockeyName: '騎手',
          horseNumber: 1,
        });

        // 初回結果登録
        const first = testDb.raceRepo.insertRaceResult(entry.id, {
          finishPosition: 3,
          finishStatus: '完走',
          finishTime: '2:32.5',
        });
        expect(first.updated).toBe(false);

        // 同じエントリIDで再登録 → 更新
        const second = testDb.raceRepo.insertRaceResult(entry.id, {
          finishPosition: 1, // 変更
          finishStatus: '完走',
          finishTime: '2:30.0', // 変更
          last3fTime: 34.5, // 追加
        });

        expect(second.updated).toBe(true);
        expect(second.id).toBe(first.id);
      });
    });

    describe('騎手の更新（getOrCreate）', () => {
      it('既存騎手はIDを返すだけで更新しない', () => {
        // 準備: 馬2頭と1レース
        testDb.horseRepo.insertHorseWithBloodline({ name: '馬1', sire: '父1', mare: '母1' });
        testDb.horseRepo.insertHorseWithBloodline({ name: '馬2', sire: '父2', mare: '母2' });
        const race = testDb.raceRepo.insertRace({
          raceDate: '2025-04-05',
          venue: '中山',
          raceNumber: 1,
          raceName: '騎手更新テスト',
          distance: 1200,
        });

        // 初回登録（斤量54）
        const entry1 = testDb.raceRepo.insertRaceEntry(race.id, {
          horseName: '馬1',
          sireName: '父1',
          mareName: '母1',
          jockeyName: 'テスト騎手',
          horseNumber: 1,
          assignedWeight: 54,
        });

        // 同じ騎手名で別エントリ登録（異なる斤量58）
        const entry2 = testDb.raceRepo.insertRaceEntry(race.id, {
          horseName: '馬2',
          sireName: '父2',
          mareName: '母2',
          jockeyName: 'テスト騎手',
          horseNumber: 2,
          assignedWeight: 58,
        });

        expect(entry2.jockeyId).toBe(entry1.jockeyId); // 同じID

        // 騎手は1件のみ、default_weightは更新されない（getOrCreateなので）
        const jockeys = testDb.db.prepare(
          'SELECT * FROM jockeys WHERE name = ?'
        ).all('テスト騎手') as { id: number; default_weight: number }[];
        expect(jockeys).toHaveLength(1);
        expect(jockeys[0].default_weight).toBe(54); // 最初の値のまま
      });
    });
  });

  // ============================================
  // 3. エッジケーステスト
  // ============================================

  describe('エッジケース', () => {
    it('空の前走データでもエラーにならない', () => {
      const horse = testDb.horseRepo.insertHorseWithBloodline({
        name: '前走なし馬',
        sire: '父',
        mare: '母',
      });
      expect(horse.id).toBeGreaterThan(0);
      // 前走データなしでも問題なし
    });

    it('NULLの血統情報でも馬を区別できる', () => {
      // 父母不明の馬
      const first = testDb.horseRepo.insertHorseWithBloodline({
        name: '血統不明馬',
        // sire, mare なし
      });

      // 同じ名前で血統不明 → 更新
      const second = testDb.horseRepo.insertHorseWithBloodline({
        name: '血統不明馬',
        sex: '牡', // 追加情報
      });

      expect(second.updated).toBe(true);
      expect(second.id).toBe(first.id);
    });

    it('調教師の厩舎情報が更新されない（getOrCreate）', () => {
      // 初回（美浦）
      const horse1 = testDb.horseRepo.insertHorseWithBloodline({
        name: '調教師テスト馬1',
        sire: '父1',
        mare: '母1',
        trainer: 'テスト調教師',
        trainerStable: '美浦',
      });

      // 同じ調教師名で異なる厩舎
      const horse2 = testDb.horseRepo.insertHorseWithBloodline({
        name: '調教師テスト馬2',
        sire: '父2',
        mare: '母2',
        trainer: 'テスト調教師',
        trainerStable: '栗東',
      });

      expect(horse2.trainerId).toBe(horse1.trainerId); // 同じ調教師ID

      // 調教師は1件のみ、厩舎は最初の値のまま
      const trainers = testDb.db.prepare(
        'SELECT * FROM trainers WHERE name = ?'
      ).all('テスト調教師') as { id: number; stable: string }[];
      expect(trainers).toHaveLength(1);
      expect(trainers[0].stable).toBe('美浦');
    });
  });

  // ============================================
  // 4. 複数レース・過去レースのテスト
  // ============================================

  describe('複数レース・過去レース', () => {
    it('一度登録した馬が別レースに出馬する場合、馬は再利用されエントリは新規', () => {
      // 馬を登録
      const horse = testDb.horseRepo.insertHorseWithBloodline({
        name: 'ディープインパクト産駒',
        sire: 'ディープインパクト',
        mare: '優秀牝馬',
        trainer: '藤沢調教師',
      });
      expect(horse.updated).toBe(false);

      // 1つ目のレースに出走
      const race1 = testDb.raceRepo.insertRace({
        raceDate: '2025-04-01',
        venue: '阪神',
        raceNumber: 11,
        raceName: '桜花賞',
        distance: 1600,
        raceType: '芝',
      });

      const entry1 = testDb.raceRepo.insertRaceEntry(race1.id, {
        horseName: 'ディープインパクト産駒',
        sireName: 'ディープインパクト',
        mareName: '優秀牝馬',
        jockeyName: '川田将雅',
        horseNumber: 1,
        popularity: 1,
      });
      expect(entry1.updated).toBe(false);

      // 2つ目のレースに同じ馬が出走
      const race2 = testDb.raceRepo.insertRace({
        raceDate: '2025-05-11',
        venue: '東京',
        raceNumber: 11,
        raceName: 'オークス',
        distance: 2400,
        raceType: '芝',
      });

      // 同じ馬を再登録 → 馬は更新（既存を使用）
      const horse2 = testDb.horseRepo.insertHorseWithBloodline({
        name: 'ディープインパクト産駒',
        sire: 'ディープインパクト',
        mare: '優秀牝馬',
        trainer: '藤沢調教師',
      });
      expect(horse2.id).toBe(horse.id); // 同じ馬ID
      expect(horse2.updated).toBe(true); // 更新扱い

      // 別レースへのエントリ → 新規
      const entry2 = testDb.raceRepo.insertRaceEntry(race2.id, {
        horseName: 'ディープインパクト産駒',
        sireName: 'ディープインパクト',
        mareName: '優秀牝馬',
        jockeyName: '川田将雅',
        horseNumber: 5,
        popularity: 2,
      });
      expect(entry2.id).not.toBe(entry1.id); // 異なるエントリID
      expect(entry2.updated).toBe(false); // 新規エントリ
    });

    it('過去レースが既に存在する場合、レースとエントリは更新される', () => {
      // シナリオ: 馬Aの出馬表を登録時に前走（皐月賞）を登録
      //          後日、馬Bの出馬表を登録時に同じ前走（皐月賞）が含まれる

      // === 馬Aの登録と前走登録 ===
      testDb.horseRepo.insertHorseWithBloodline({
        name: '馬A',
        sire: '父A',
        mare: '母A',
      });

      // 前走レース（皐月賞）を登録
      const prevRace = testDb.raceRepo.insertRace({
        raceDate: '2025-04-13',
        venue: '中山',
        raceNumber: 11,
        raceName: '皐月賞',
        distance: 2000,
        raceType: '芝',
        totalHorses: 18,
      });
      expect(prevRace.updated).toBe(false); // 新規

      // 馬Aの皐月賞エントリ
      const entryA = testDb.raceRepo.insertRaceEntry(prevRace.id, {
        horseName: '馬A',
        sireName: '父A',
        mareName: '母A',
        jockeyName: '騎手A',
        horseNumber: 1,
        popularity: 3,
      });

      // === 馬Bの登録と同じ前走登録 ===
      testDb.horseRepo.insertHorseWithBloodline({
        name: '馬B',
        sire: '父B',
        mare: '母B',
      });

      // 同じ前走レース（皐月賞）を再登録 → 更新
      const prevRace2 = testDb.raceRepo.insertRace({
        raceDate: '2025-04-13',
        venue: '中山',
        raceNumber: 11,
        raceName: '皐月賞',
        distance: 2000,
        raceType: '芝',
        trackCondition: '良', // 追加情報
      });
      expect(prevRace2.id).toBe(prevRace.id); // 同じレースID
      expect(prevRace2.updated).toBe(true); // 更新

      // 馬Bの皐月賞エントリ（新規）
      const entryB = testDb.raceRepo.insertRaceEntry(prevRace.id, {
        horseName: '馬B',
        sireName: '父B',
        mareName: '母B',
        jockeyName: '騎手B',
        horseNumber: 5,
        popularity: 1,
      });
      expect(entryB.id).not.toBe(entryA.id); // 異なるエントリ
      expect(entryB.updated).toBe(false); // 新規エントリ

      // レース情報が更新されていることを確認
      const raceDb = getRaceById(testDb.db, prevRace.id);
      expect(raceDb?.track_condition).toBe('良');
    });

    it('同じ馬の同じ過去レースエントリは更新される', () => {
      // シナリオ: 馬Aの前走を2回登録（情報追加）

      testDb.horseRepo.insertHorseWithBloodline({
        name: '再登録馬',
        sire: '父',
        mare: '母',
      });

      const race = testDb.raceRepo.insertRace({
        raceDate: '2025-03-01',
        venue: '阪神',
        raceNumber: 11,
        raceName: '大阪杯',
        distance: 2000,
        raceType: '芝',
      });

      // 初回エントリ
      const entry1 = testDb.raceRepo.insertRaceEntry(race.id, {
        horseName: '再登録馬',
        sireName: '父',
        mareName: '母',
        jockeyName: '騎手X',
        horseNumber: 3,
      });

      // 同じ馬・同じレースで再登録（情報更新）
      const entry2 = testDb.raceRepo.insertRaceEntry(race.id, {
        horseName: '再登録馬',
        sireName: '父',
        mareName: '母',
        jockeyName: '騎手Y', // 騎手変更
        horseNumber: 3,
        popularity: 2, // 追加
        winOdds: 5.5, // 追加
      });

      expect(entry2.id).toBe(entry1.id); // 同じエントリID
      expect(entry2.updated).toBe(true); // 更新
    });

    it('同じ馬が別の出馬表で共通の過去レースを持つ場合、過去レースエントリは更新される', () => {
      // シナリオ:
      // 1. ダービーの出馬表を登録 → 馬Aの前走として皐月賞を登録
      // 2. 後日、宝塚記念の出馬表を登録 → 同じ馬Aの前走として同じ皐月賞を登録
      // 期待: 皐月賞レースは更新、馬Aの皐月賞エントリも更新

      // 馬Aを登録
      testDb.horseRepo.insertHorseWithBloodline({
        name: 'サートゥルナーリア',
        sire: 'ロードカナロア',
        mare: 'シーザリオ',
      });

      // === ダービー出馬表登録時 ===
      // 前走として皐月賞を登録
      const satsukisho1 = testDb.raceRepo.insertRace({
        raceDate: '2025-04-13',
        venue: '中山',
        raceNumber: 11,
        raceName: '皐月賞',
        distance: 2000,
        raceType: '芝',
      });

      const satsukishoEntryA1 = testDb.raceRepo.insertRaceEntry(satsukisho1.id, {
        horseName: 'サートゥルナーリア',
        sireName: 'ロードカナロア',
        mareName: 'シーザリオ',
        jockeyName: 'C.ルメール',
        horseNumber: 7,
        popularity: 1,
      });

      // 結果を登録
      const result1 = testDb.raceRepo.insertRaceResult(satsukishoEntryA1.id, {
        finishPosition: 1,
        finishStatus: '完走',
      });

      // === 宝塚記念出馬表登録時 ===
      // 同じ馬Aの前走として同じ皐月賞を再登録
      const satsukisho2 = testDb.raceRepo.insertRace({
        raceDate: '2025-04-13',
        venue: '中山',
        raceNumber: 11,
        raceName: '皐月賞',
        distance: 2000,
        raceType: '芝',
        trackCondition: '良', // 追加情報
      });

      // 同じ馬の同じレースエントリを再登録
      const satsukishoEntryA2 = testDb.raceRepo.insertRaceEntry(satsukisho2.id, {
        horseName: 'サートゥルナーリア',
        sireName: 'ロードカナロア',
        mareName: 'シーザリオ',
        jockeyName: 'C.ルメール',
        horseNumber: 7,
        popularity: 1,
        winOdds: 2.1, // 追加情報
      });

      // 結果を再登録
      const result2 = testDb.raceRepo.insertRaceResult(satsukishoEntryA2.id, {
        finishPosition: 1,
        finishStatus: '完走',
        finishTime: '1:58.1', // 追加情報
        last3fTime: 34.5, // 追加情報
      });

      // === 検証 ===
      // レースは更新（同じID）
      expect(satsukisho2.id).toBe(satsukisho1.id);
      expect(satsukisho2.updated).toBe(true);

      // エントリも更新（同じID）- 同じ馬 + 同じレース
      expect(satsukishoEntryA2.id).toBe(satsukishoEntryA1.id);
      expect(satsukishoEntryA2.updated).toBe(true);

      // 結果も更新（同じID）
      expect(result2.id).toBe(result1.id);
      expect(result2.updated).toBe(true);

      // DB内の情報が更新されていることを確認
      const raceDb = getRaceById(testDb.db, satsukisho1.id);
      expect(raceDb?.track_condition).toBe('良');
    });

    it('前走データの結果も更新される', () => {
      testDb.horseRepo.insertHorseWithBloodline({
        name: '結果更新馬',
        sire: '父',
        mare: '母',
      });

      const race = testDb.raceRepo.insertRace({
        raceDate: '2025-02-15',
        venue: '東京',
        raceNumber: 11,
        raceName: 'フェブラリーS',
        distance: 1600,
        raceType: 'ダート',
      });

      const entry = testDb.raceRepo.insertRaceEntry(race.id, {
        horseName: '結果更新馬',
        sireName: '父',
        mareName: '母',
        jockeyName: '騎手',
        horseNumber: 1,
      });

      // 初回結果登録
      const result1 = testDb.raceRepo.insertRaceResult(entry.id, {
        finishPosition: 3,
        finishStatus: '完走',
      });
      expect(result1.updated).toBe(false);

      // 同じエントリで結果を再登録（詳細追加）
      const result2 = testDb.raceRepo.insertRaceResult(entry.id, {
        finishPosition: 3,
        finishStatus: '完走',
        finishTime: '1:34.5', // 追加
        last3fTime: 35.2, // 追加
      });

      expect(result2.id).toBe(result1.id);
      expect(result2.updated).toBe(true);
    });

    it('同じレース内で異なる馬が同じ馬番でも登録できる（UNIQUE(race_id, horse_id)）', () => {
      testDb.horseRepo.insertHorseWithBloodline({ name: '馬A', sire: '父A', mare: '母A' });
      testDb.horseRepo.insertHorseWithBloodline({ name: '馬B', sire: '父B', mare: '母B' });

      const race = testDb.raceRepo.insertRace({
        raceDate: '2025-06-01',
        venue: '阪神',
        raceNumber: 1,
        raceName: '馬番重複テスト',
        distance: 1600,
      });

      // 馬Aを馬番1で登録
      const entry1 = testDb.raceRepo.insertRaceEntry(race.id, {
        horseName: '馬A',
        sireName: '父A',
        mareName: '母A',
        jockeyName: '騎手1',
        horseNumber: 1,
      });

      // 馬Bを同じ馬番1で登録（異なる馬なので成功する）
      const entry2 = testDb.raceRepo.insertRaceEntry(race.id, {
        horseName: '馬B',
        sireName: '父B',
        mareName: '母B',
        jockeyName: '騎手2',
        horseNumber: 1, // 同じ馬番だが、異なる馬なのでOK
      });

      expect(entry1.id).not.toBe(entry2.id);
      expect(entry2.updated).toBe(false);
    });
  });

  // ============================================
  // 5. 統合テスト
  // ============================================

  describe('統合テスト', () => {
    it('完全なレースデータをインポートして再インポートで更新される', () => {
      // 初回インポート
      const race1 = testDb.raceRepo.insertRace({
        raceDate: '2025-12-28',
        venue: '中山',
        raceNumber: 11,
        raceName: '有馬記念',
        raceType: '芝',
        distance: 2500,
        trackCondition: '良',
        totalHorses: 16,
      });

      const horse1 = testDb.horseRepo.insertHorseWithBloodline({
        name: 'イクイノックス',
        birthYear: 2019,
        sex: '牡',
        sire: 'キタサンブラック',
        mare: 'シャトーブランシュ',
        trainer: '木村哲也',
        trainerStable: '美浦',
      });

      const entry1 = testDb.raceRepo.insertRaceEntry(race1.id, {
        horseName: 'イクイノックス',
        sireName: 'キタサンブラック',
        mareName: 'シャトーブランシュ',
        jockeyName: 'C.ルメール',
        frameNumber: 1,
        horseNumber: 1,
        assignedWeight: 58,
        popularity: 1,
        winOdds: 1.5,
      });

      // 再インポート（情報更新）
      const race2 = testDb.raceRepo.insertRace({
        raceDate: '2025-12-28',
        venue: '中山',
        raceNumber: 11,
        raceName: '有馬記念',
        raceType: '芝',
        distance: 2500,
        trackCondition: '稍重', // 変更
        totalHorses: 16,
      });

      const horse2 = testDb.horseRepo.insertHorseWithBloodline({
        name: 'イクイノックス',
        birthYear: 2019,
        sex: '牡',
        sire: 'キタサンブラック',
        mare: 'シャトーブランシュ',
        trainer: '木村哲也',
        trainerStable: '美浦',
        owner: '（有）シルクレーシング', // 追加
      });

      const entry2 = testDb.raceRepo.insertRaceEntry(race2.id, {
        horseName: 'イクイノックス',
        sireName: 'キタサンブラック',
        mareName: 'シャトーブランシュ',
        jockeyName: 'C.ルメール',
        frameNumber: 1,
        horseNumber: 1,
        assignedWeight: 58,
        popularity: 1,
        winOdds: 1.3, // 変更
      });

      // 検証
      expect(race2.id).toBe(race1.id);
      expect(race2.updated).toBe(true);
      expect(horse2.id).toBe(horse1.id);
      expect(horse2.updated).toBe(true);
      expect(entry2.id).toBe(entry1.id);
      expect(entry2.updated).toBe(true);

      // DB内容確認
      const raceDb = getRaceById(testDb.db, race1.id);
      expect(raceDb?.track_condition).toBe('稍重');

      const horseDb = getHorseWithBloodline(testDb.db, horse1.id);
      expect(horseDb?.owner_name).toBe('（有）シルクレーシング');
    });
  });
});

// ============================================
// テストスイート（ImportData経由のE2E）
// ============================================

describe('ImportData - importExtractedJSON E2E', () => {
  const E2E_DB_PATH = './test-importdata-e2e.db';
  const E2E_JSON_PATH = './test-importdata-e2e.json';

  beforeEach(() => {
    if (existsSync(E2E_DB_PATH)) {
      unlinkSync(E2E_DB_PATH);
    }
    // インポート時の大量のコンソール出力を抑制
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const path of [E2E_DB_PATH, E2E_JSON_PATH]) {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  });

  it('抽出JSONからレース・馬・出馬表・前走データが登録される', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    const raceData = createTestRaceData({
      date: '2025-12-28',
      venue: '中山',
      raceNumber: 11,
      raceName: '有馬記念',
      distance: 2500,
      courseType: '芝',
      horses: [
        createTestHorse({
          name: 'E2Eテスト馬',
          age: 4,
          sex: '牝',
          sire: 'E2E父',
          mare: 'E2E母',
          horseNumber: 1,
          previousRaces: [
            createPreviousRace({
              raceName: '皐月賞',
              date: '2025年4月13日',
              track: '中山',
              place: '2',
              distance: '2000芝',
            }),
          ],
        }),
      ],
    });
    writeFileSync(E2E_JSON_PATH, JSON.stringify(raceData));

    const command = new ImportData(E2E_DB_PATH);
    await command.importExtractedJSON(E2E_JSON_PATH);

    expect(errorSpy).not.toHaveBeenCalled();

    // importExtractedJSONは接続を閉じるので、別接続で検証
    const db = new Database(E2E_DB_PATH, { readonly: true });
    try {
      // レース
      const race = db.prepare(
        "SELECT * FROM races WHERE race_name = '有馬記念'"
      ).get() as { id: number; race_date: string; distance: number; race_type: string };
      expect(race).toBeDefined();
      expect(race.race_date).toBe('2025-12-28');
      expect(race.distance).toBe(2500);
      expect(race.race_type).toBe('芝');

      // 馬（生年 = 開催年 − 馬齢）
      const horse = db.prepare(
        "SELECT * FROM horses WHERE name = 'E2Eテスト馬'"
      ).get() as { id: number; sex: string; birth_year: number };
      expect(horse).toBeDefined();
      expect(horse.sex).toBe('牝');
      expect(horse.birth_year).toBe(2021); // 2025 - 4

      // 出馬表
      const entry = db.prepare(
        'SELECT * FROM race_entries WHERE race_id = ? AND horse_id = ?'
      ).get(race.id, horse.id) as { id: number; horse_number: number; win_odds: number };
      expect(entry).toBeDefined();
      expect(entry.horse_number).toBe(1);
      expect(entry.win_odds).toBe(5.0);

      // 前走レースと結果
      const prevRace = db.prepare(
        "SELECT * FROM races WHERE race_name = '皐月賞'"
      ).get() as { id: number; race_date: string; distance: number };
      expect(prevRace).toBeDefined();
      expect(prevRace.race_date).toBe('2025-04-13');
      expect(prevRace.distance).toBe(2000);

      const prevEntry = db.prepare(
        'SELECT * FROM race_entries WHERE race_id = ? AND horse_id = ?'
      ).get(prevRace.id, horse.id) as { id: number };
      expect(prevEntry).toBeDefined();

      const prevResult = db.prepare(
        'SELECT * FROM race_results WHERE entry_id = ?'
      ).get(prevEntry.id) as { finish_position: number };
      expect(prevResult).toBeDefined();
      expect(prevResult.finish_position).toBe(2);
    } finally {
      db.close();
    }
  });

  it('同じJSONの再インポートで重複せず更新される', async () => {
    spyOn(console, 'error').mockImplementation(() => {});

    const raceData = createTestRaceData({
      date: '2025-12-28',
      venue: '中山',
      raceNumber: 11,
      raceName: '有馬記念',
      trackCondition: '良',
      horses: [createTestHorse({ name: '再インポート馬', sire: '父R', mare: '母R', winOdds: 1.5 })],
    });
    writeFileSync(E2E_JSON_PATH, JSON.stringify(raceData));

    // 初回インポート（接続が閉じられるためインスタンスは使い捨て）
    await new ImportData(E2E_DB_PATH).importExtractedJSON(E2E_JSON_PATH);

    // 情報を変更して再インポート
    raceData.raceInfo.trackCondition = '稍重';
    raceData.horses[0].raceInfo.winOdds = 1.3;
    writeFileSync(E2E_JSON_PATH, JSON.stringify(raceData));

    await new ImportData(E2E_DB_PATH).importExtractedJSON(E2E_JSON_PATH);

    const db = new Database(E2E_DB_PATH, { readonly: true });
    try {
      // レースは1件のまま、内容は更新
      const races = db.prepare(
        "SELECT * FROM races WHERE race_name = '有馬記念'"
      ).all() as { id: number; track_condition: string }[];
      expect(races).toHaveLength(1);
      expect(races[0].track_condition).toBe('稍重');

      // 馬も1頭のまま
      const horses = db.prepare(
        "SELECT * FROM horses WHERE name = '再インポート馬'"
      ).all() as { id: number }[];
      expect(horses).toHaveLength(1);

      // エントリも1件のまま、オッズは更新
      const entries = db.prepare(
        'SELECT * FROM race_entries WHERE race_id = ? AND horse_id = ?'
      ).all(races[0].id, horses[0].id) as { win_odds: number }[];
      expect(entries).toHaveLength(1);
      expect(entries[0].win_odds).toBe(1.3);
    } finally {
      db.close();
    }
  });
});
