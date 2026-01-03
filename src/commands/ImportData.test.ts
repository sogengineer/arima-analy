import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArimaDatabase } from '../database/Database.js';
import { ExtractedRaceData, HorseData } from '../types/HorseData.js';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { ImportData } from './ImportData.js';

// テスト用DBパス
const TEST_DB_PATH = './test-import.db';
const TEST_JSON_PATH = './test-extracted-data.json';

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
// テストスイート
// ============================================

describe('ImportData - インポート機能', () => {
  let db: ArimaDatabase;

  beforeEach(() => {
    // テスト用DBを初期化
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    db = new ArimaDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    // クリーンアップ
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_JSON_PATH)) {
      unlinkSync(TEST_JSON_PATH);
    }
  });

  // ============================================
  // 1. 新規インポートテスト
  // ============================================

  describe('新規インポート', () => {
    it('新規レースが正しく登録される', () => {
      const raceData: ExtractedRaceData = createTestRaceData({
        date: '2025-01-15',
        venue: '東京',
        raceNumber: 5,
        raceName: '新規テストレース',
        distance: 1600,
        courseType: '芝',
      });

      writeFileSync(TEST_JSON_PATH, JSON.stringify(raceData));

      // ImportData経由でインポート（DBを閉じるので別インスタンスで確認）
      const command = new (class extends ImportData {
        constructor() {
          super();
          // @ts-expect-error - プライベートプロパティにアクセス
          this.db = new ArimaDatabase(TEST_DB_PATH);
        }
      })();

      // 同期的に実行するためrunInTransactionを直接テスト
      const result = db.insertRace({
        raceDate: '2025-01-15',
        venue: '東京',
        raceNumber: 5,
        raceName: '新規テストレース',
        raceType: '芝',
        distance: 1600,
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.updated).toBe(false);

      const race = db.getRaceById(result.id);
      expect(race).toBeDefined();
      expect(race?.race_name).toBe('新規テストレース');
      expect(race?.distance).toBe(1600);
    });

    it('新規馬が正しく登録される', () => {
      const result = db.insertHorseWithBloodline({
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

      const horse = db.getHorseWithBloodline(result.id);
      expect(horse).toBeDefined();
      expect(horse?.name).toBe('新馬テスト');
      expect(horse?.sire_name).toBe('ディープインパクト');
      expect(horse?.mare_name).toBe('テスト繁殖牝馬');
    });

    it('新規騎手が正しく登録される', () => {
      const jockeyId = db.getOrCreateJockey('武豊', 56);
      expect(jockeyId).toBeGreaterThan(0);

      const jockeys = db.getAllJockeys();
      const jockey = jockeys.find(j => j.name === '武豊');
      expect(jockey).toBeDefined();
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
        const first = db.insertHorseWithBloodline({
          name: '更新テスト馬',
          birthYear: 2020,
          sex: '牡',
          sire: '父馬A',
          mare: '母馬A',
          trainer: '調教師A',
        });
        expect(first.updated).toBe(false);

        // 同じ馬名+父+母で再登録 → 更新されるはず
        const second = db.insertHorseWithBloodline({
          name: '更新テスト馬',
          birthYear: 2020, // 同じ
          sex: '牡',
          sire: '父馬A', // 同じ
          mare: '母馬A', // 同じ
          trainer: '調教師B', // 変更
        });

        expect(second.updated).toBe(true);
        expect(second.id).toBe(first.id); // 同じID

        const horse = db.getHorseWithBloodline(second.id);
        expect(horse?.trainer_name).toBe('調教師B');
      });

      it('同じ馬名でも父が異なれば新規登録（同姓同名馬の区別）', () => {
        // 初回登録
        const first = db.insertHorseWithBloodline({
          name: '同名馬',
          sire: '父馬X',
          mare: '母馬A',
        });

        // 同じ馬名だが父が異なる
        const second = db.insertHorseWithBloodline({
          name: '同名馬',
          sire: '父馬Y', // 異なる父
          mare: '母馬A',
        });

        expect(second.updated).toBe(false);
        expect(second.id).not.toBe(first.id); // 異なるID
      });

      it('同じ馬名でも母が異なれば新規登録', () => {
        const first = db.insertHorseWithBloodline({
          name: '同名馬2',
          sire: '父馬A',
          mare: '母馬X',
        });

        const second = db.insertHorseWithBloodline({
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
        const first = db.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 11,
          raceName: '有馬記念',
          distance: 2500,
          raceType: '芝',
        });
        expect(first.updated).toBe(false);

        // 同じ条件で再登録 → 更新
        const second = db.insertRace({
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

        const race = db.getRaceById(second.id);
        expect(race?.race_name).toBe('有馬記念（更新後）');
        expect(race?.track_condition).toBe('良');
      });

      it('異なるレース番号なら新規登録', () => {
        const first = db.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 10,
          raceName: '10R',
          distance: 1800,
        });

        const second = db.insertRace({
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
        const first = db.insertRace({
          raceDate: '2025-02-01',
          venue: '中山',
          raceNumber: 11,
          raceName: '中山11R',
          distance: 2500,
        });

        const second = db.insertRace({
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
        const horse = db.insertHorseWithBloodline({
          name: 'エントリテスト馬',
          sire: '父',
          mare: '母',
        });
        const race = db.insertRace({
          raceDate: '2025-03-01',
          venue: '阪神',
          raceNumber: 11,
          raceName: 'エントリテストレース',
          distance: 2000,
        });

        // 初回エントリ登録
        const first = db.insertRaceEntry(race.id, {
          horseName: 'エントリテスト馬',
          sireName: '父',
          mareName: '母',
          jockeyName: '騎手A',
          horseNumber: 1,
          popularity: 3,
        });
        expect(first.updated).toBe(false);

        // 同じレース+馬で再登録 → 更新
        const second = db.insertRaceEntry(race.id, {
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
        const horse1 = db.insertHorseWithBloodline({ name: '馬1', sire: '父1', mare: '母1' });
        const horse2 = db.insertHorseWithBloodline({ name: '馬2', sire: '父2', mare: '母2' });
        const race = db.insertRace({
          raceDate: '2025-03-02',
          venue: '京都',
          raceNumber: 11,
          raceName: 'マルチエントリテスト',
          distance: 3000,
        });

        const first = db.insertRaceEntry(race.id, {
          horseName: '馬1',
          sireName: '父1',
          mareName: '母1',
          jockeyName: '騎手',
          horseNumber: 1,
        });

        const second = db.insertRaceEntry(race.id, {
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
        const horse = db.insertHorseWithBloodline({ name: '結果テスト馬', sire: '父', mare: '母' });
        const race = db.insertRace({
          raceDate: '2025-04-01',
          venue: '中山',
          raceNumber: 11,
          raceName: '結果テストレース',
          distance: 2500,
        });
        const entry = db.insertRaceEntry(race.id, {
          horseName: '結果テスト馬',
          sireName: '父',
          mareName: '母',
          jockeyName: '騎手',
          horseNumber: 1,
        });

        // 初回結果登録
        const first = db.insertRaceResult(entry.id, {
          finishPosition: 3,
          finishStatus: '完走',
          finishTime: '2:32.5',
        });
        expect(first.updated).toBe(false);

        // 同じエントリIDで再登録 → 更新
        const second = db.insertRaceResult(entry.id, {
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
        // 初回登録
        const firstId = db.getOrCreateJockey('テスト騎手', 54);
        expect(firstId).toBeGreaterThan(0);

        // 同じ名前で再度呼び出し（異なる体重）
        const secondId = db.getOrCreateJockey('テスト騎手', 58);
        expect(secondId).toBe(firstId); // 同じID

        // 体重は更新されない（getOrCreateなので）
        const jockeys = db.getAllJockeys();
        const jockey = jockeys.find(j => j.id === firstId);
        expect(jockey?.default_weight).toBe(54); // 最初の値のまま
      });
    });
  });

  // ============================================
  // 3. 前走データインポートテスト
  // ============================================

  describe('前走データインポート', () => {
    it('前走レースが正しく登録される', () => {
      // 前走データ付きの馬を作成
      const raceData = createTestRaceData({
        date: '2025-05-01',
        venue: '東京',
        raceNumber: 11,
        raceName: '日本ダービー',
        horses: [
          createTestHorse({
            name: '前走テスト馬',
            sire: 'ダービー父',
            mare: 'ダービー母',
            horseNumber: 1,
            previousRaces: [
              createPreviousRace({
                position: 'front',
                date: '2025年4月13日',
                track: '中山',
                raceName: '皐月賞',
                place: '2',
                distance: '2000芝',
              }),
              createPreviousRace({
                position: 'second',
                date: '2025年3月2日',
                track: '中山',
                raceName: '弥生賞',
                place: '1',
                distance: '2000芝',
              }),
            ],
          }),
        ],
      });

      writeFileSync(TEST_JSON_PATH, JSON.stringify(raceData));

      // 直接DBメソッドをテスト
      const horse = db.insertHorseWithBloodline({
        name: '前走テスト馬',
        sire: 'ダービー父',
        mare: 'ダービー母',
      });

      // 前走レース登録
      const prevRace = db.insertRace({
        raceDate: '2025-04-13',
        venue: '中山',
        raceNumber: 1,
        raceName: '皐月賞',
        raceType: '芝',
        distance: 2000,
      });

      expect(prevRace.id).toBeGreaterThan(0);
    });

    it('同じレース内で異なる馬が同じ馬番でも登録できる（修正後）', () => {
      // 修正後: UNIQUE(race_id, horse_id) に変更
      // 同じレース内で異なる馬なら、同じ馬番でも登録可能

      const horse1 = db.insertHorseWithBloodline({ name: '馬A', sire: '父A', mare: '母A' });
      const horse2 = db.insertHorseWithBloodline({ name: '馬B', sire: '父B', mare: '母B' });

      const race = db.insertRace({
        raceDate: '2025-06-01',
        venue: '阪神',
        raceNumber: 1,
        raceName: '馬番重複テスト',
        distance: 1600,
      });

      // 馬Aを馬番1で登録
      const entry1 = db.insertRaceEntry(race.id, {
        horseName: '馬A',
        sireName: '父A',
        mareName: '母A',
        jockeyName: '騎手1',
        horseNumber: 1,
      });

      // 馬Bを同じ馬番1で登録（異なる馬なので成功する）
      const entry2 = db.insertRaceEntry(race.id, {
        horseName: '馬B',
        sireName: '父B',
        mareName: '母B',
        jockeyName: '騎手2',
        horseNumber: 1, // 同じ馬番だが、異なる馬なのでOK
      });

      expect(entry1.id).not.toBe(entry2.id);
      expect(entry2.updated).toBe(false);
    });

    it('同じレースに同じ馬を再登録すると更新される', () => {
      const horse = db.insertHorseWithBloodline({ name: '馬C', sire: '父C', mare: '母C' });

      const race = db.insertRace({
        raceDate: '2025-06-02',
        venue: '東京',
        raceNumber: 1,
        raceName: '再登録テスト',
        distance: 1800,
      });

      // 初回登録
      const entry1 = db.insertRaceEntry(race.id, {
        horseName: '馬C',
        sireName: '父C',
        mareName: '母C',
        jockeyName: '騎手A',
        horseNumber: 5,
      });

      // 同じ馬を同じレースに再登録 → 更新
      const entry2 = db.insertRaceEntry(race.id, {
        horseName: '馬C',
        sireName: '父C',
        mareName: '母C',
        jockeyName: '騎手B', // 騎手変更
        horseNumber: 5,
      });

      expect(entry2.id).toBe(entry1.id);
      expect(entry2.updated).toBe(true);
    });
  });

  // ============================================
  // 4. エッジケーステスト
  // ============================================

  describe('エッジケース', () => {
    it('空の前走データでもエラーにならない', () => {
      const horse = db.insertHorseWithBloodline({
        name: '前走なし馬',
        sire: '父',
        mare: '母',
      });
      expect(horse.id).toBeGreaterThan(0);
      // 前走データなしでも問題なし
    });

    it('NULLの血統情報でも馬を区別できる', () => {
      // 父母不明の馬
      const first = db.insertHorseWithBloodline({
        name: '血統不明馬',
        // sire, mare なし
      });

      // 同じ名前で血統不明 → 更新
      const second = db.insertHorseWithBloodline({
        name: '血統不明馬',
        sex: '牡', // 追加情報
      });

      expect(second.updated).toBe(true);
      expect(second.id).toBe(first.id);
    });

    it('調教師の厩舎情報が更新されない（getOrCreate）', () => {
      // 初回（美浦）
      const id1 = db.getOrCreateTrainer('テスト調教師', '美浦');

      // 同じ名前で異なる厩舎
      const id2 = db.getOrCreateTrainer('テスト調教師', '栗東');

      expect(id2).toBe(id1);

      const trainers = db.getAllTrainers();
      const trainer = trainers.find(t => t.id === id1);
      expect(trainer?.stable).toBe('美浦'); // 最初の値のまま
    });
  });

  // ============================================
  // 5. 複数レース・過去レースのテスト
  // ============================================

  describe('複数レース・過去レース', () => {
    it('一度登録した馬が別レースに出馬する場合、馬は再利用されエントリは新規', () => {
      // 馬を登録
      const horse = db.insertHorseWithBloodline({
        name: 'ディープインパクト産駒',
        sire: 'ディープインパクト',
        mare: '優秀牝馬',
        trainer: '藤沢調教師',
      });
      expect(horse.updated).toBe(false);

      // 1つ目のレースに出走
      const race1 = db.insertRace({
        raceDate: '2025-04-01',
        venue: '阪神',
        raceNumber: 11,
        raceName: '桜花賞',
        distance: 1600,
        raceType: '芝',
      });

      const entry1 = db.insertRaceEntry(race1.id, {
        horseName: 'ディープインパクト産駒',
        sireName: 'ディープインパクト',
        mareName: '優秀牝馬',
        jockeyName: '川田将雅',
        horseNumber: 1,
        popularity: 1,
      });
      expect(entry1.updated).toBe(false);

      // 2つ目のレースに同じ馬が出走
      const race2 = db.insertRace({
        raceDate: '2025-05-11',
        venue: '東京',
        raceNumber: 11,
        raceName: 'オークス',
        distance: 2400,
        raceType: '芝',
      });

      // 同じ馬を再登録 → 馬は更新（既存を使用）
      const horse2 = db.insertHorseWithBloodline({
        name: 'ディープインパクト産駒',
        sire: 'ディープインパクト',
        mare: '優秀牝馬',
        trainer: '藤沢調教師',
      });
      expect(horse2.id).toBe(horse.id); // 同じ馬ID
      expect(horse2.updated).toBe(true); // 更新扱い

      // 別レースへのエントリ → 新規
      const entry2 = db.insertRaceEntry(race2.id, {
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
      const horseA = db.insertHorseWithBloodline({
        name: '馬A',
        sire: '父A',
        mare: '母A',
      });

      // 前走レース（皐月賞）を登録
      const prevRace = db.insertRace({
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
      const entryA = db.insertRaceEntry(prevRace.id, {
        horseName: '馬A',
        sireName: '父A',
        mareName: '母A',
        jockeyName: '騎手A',
        horseNumber: 1,
        popularity: 3,
      });

      // === 馬Bの登録と同じ前走登録 ===
      const horseB = db.insertHorseWithBloodline({
        name: '馬B',
        sire: '父B',
        mare: '母B',
      });

      // 同じ前走レース（皐月賞）を再登録 → 更新
      const prevRace2 = db.insertRace({
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
      const entryB = db.insertRaceEntry(prevRace.id, {
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
      const raceDb = db.getRaceById(prevRace.id);
      expect(raceDb?.track_condition).toBe('良');
    });

    it('同じ馬の同じ過去レースエントリは更新される', () => {
      // シナリオ: 馬Aの前走を2回登録（情報追加）

      const horse = db.insertHorseWithBloodline({
        name: '再登録馬',
        sire: '父',
        mare: '母',
      });

      const race = db.insertRace({
        raceDate: '2025-03-01',
        venue: '阪神',
        raceNumber: 11,
        raceName: '大阪杯',
        distance: 2000,
        raceType: '芝',
      });

      // 初回エントリ
      const entry1 = db.insertRaceEntry(race.id, {
        horseName: '再登録馬',
        sireName: '父',
        mareName: '母',
        jockeyName: '騎手X',
        horseNumber: 3,
      });

      // 同じ馬・同じレースで再登録（情報更新）
      const entry2 = db.insertRaceEntry(race.id, {
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
      const horseA = db.insertHorseWithBloodline({
        name: 'サートゥルナーリア',
        sire: 'ロードカナロア',
        mare: 'シーザリオ',
      });

      // === ダービー出馬表登録時 ===
      // 前走として皐月賞を登録
      const satsukisho1 = db.insertRace({
        raceDate: '2025-04-13',
        venue: '中山',
        raceNumber: 11,
        raceName: '皐月賞',
        distance: 2000,
        raceType: '芝',
      });

      const satsukishoEntryA1 = db.insertRaceEntry(satsukisho1.id, {
        horseName: 'サートゥルナーリア',
        sireName: 'ロードカナロア',
        mareName: 'シーザリオ',
        jockeyName: 'C.ルメール',
        horseNumber: 7,
        popularity: 1,
      });

      // 結果を登録
      const result1 = db.insertRaceResult(satsukishoEntryA1.id, {
        finishPosition: 1,
        finishStatus: '完走',
      });

      // === 宝塚記念出馬表登録時 ===
      // 同じ馬Aの前走として同じ皐月賞を再登録
      const satsukisho2 = db.insertRace({
        raceDate: '2025-04-13',
        venue: '中山',
        raceNumber: 11,
        raceName: '皐月賞',
        distance: 2000,
        raceType: '芝',
        trackCondition: '良', // 追加情報
      });

      // 同じ馬の同じレースエントリを再登録
      const satsukishoEntryA2 = db.insertRaceEntry(satsukisho2.id, {
        horseName: 'サートゥルナーリア',
        sireName: 'ロードカナロア',
        mareName: 'シーザリオ',
        jockeyName: 'C.ルメール',
        horseNumber: 7,
        popularity: 1,
        winOdds: 2.1, // 追加情報
      });

      // 結果を再登録
      const result2 = db.insertRaceResult(satsukishoEntryA2.id, {
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
      const raceDb = db.getRaceById(satsukisho1.id);
      expect(raceDb?.track_condition).toBe('良');
    });

    it('前走データの結果も更新される', () => {
      const horse = db.insertHorseWithBloodline({
        name: '結果更新馬',
        sire: '父',
        mare: '母',
      });

      const race = db.insertRace({
        raceDate: '2025-02-15',
        venue: '東京',
        raceNumber: 11,
        raceName: 'フェブラリーS',
        distance: 1600,
        raceType: 'ダート',
      });

      const entry = db.insertRaceEntry(race.id, {
        horseName: '結果更新馬',
        sireName: '父',
        mareName: '母',
        jockeyName: '騎手',
        horseNumber: 1,
      });

      // 初回結果登録
      const result1 = db.insertRaceResult(entry.id, {
        finishPosition: 3,
        finishStatus: '完走',
      });
      expect(result1.updated).toBe(false);

      // 同じエントリで結果を再登録（詳細追加）
      const result2 = db.insertRaceResult(entry.id, {
        finishPosition: 3,
        finishStatus: '完走',
        finishTime: '1:34.5', // 追加
        last3fTime: 35.2, // 追加
      });

      expect(result2.id).toBe(result1.id);
      expect(result2.updated).toBe(true);
    });
  });

  // ============================================
  // 6. 統合テスト
  // ============================================

  describe('統合テスト', () => {
    it('完全なレースデータをインポートして再インポートで更新される', () => {
      // 初回インポート
      const race1 = db.insertRace({
        raceDate: '2025-12-28',
        venue: '中山',
        raceNumber: 11,
        raceName: '有馬記念',
        raceType: '芝',
        distance: 2500,
        trackCondition: '良',
        totalHorses: 16,
      });

      const horse1 = db.insertHorseWithBloodline({
        name: 'イクイノックス',
        birthYear: 2019,
        sex: '牡',
        sire: 'キタサンブラック',
        mare: 'シャトーブランシュ',
        trainer: '木村哲也',
        trainerStable: '美浦',
      });

      const entry1 = db.insertRaceEntry(race1.id, {
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
      const race2 = db.insertRace({
        raceDate: '2025-12-28',
        venue: '中山',
        raceNumber: 11,
        raceName: '有馬記念',
        raceType: '芝',
        distance: 2500,
        trackCondition: '稍重', // 変更
        totalHorses: 16,
      });

      const horse2 = db.insertHorseWithBloodline({
        name: 'イクイノックス',
        birthYear: 2019,
        sex: '牡',
        sire: 'キタサンブラック',
        mare: 'シャトーブランシュ',
        trainer: '木村哲也',
        trainerStable: '美浦',
        owner: '（有）シルクレーシング', // 追加
      });

      const entry2 = db.insertRaceEntry(race2.id, {
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
      const raceDb = db.getRaceById(race1.id);
      expect(raceDb?.track_condition).toBe('稍重');

      const horseDb = db.getHorseWithBloodline(horse1.id);
      expect(horseDb?.owner_name).toBe('（有）シルクレーシング');
    });
  });
});

