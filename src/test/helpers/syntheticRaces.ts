/**
 * 合成レースデータ生成ヘルパー（テスト用）
 *
 * @remarks
 * 実データがほぼ無い状況でも、ML の学習・walk-forward 検証・リーク遮断を
 * 決定論的に検証できるようにするための合成データ生成器。
 *
 * 生成モデル:
 * 1. 各馬に潜在能力 `ability ∈ [0,1)` を割り当てる
 * 2. レースごとに `効用 = ability * STRENGTH + ノイズ` を計算し、降順に着順を付ける
 * 3. 単勝オッズは「潜在能力から作った真の勝率をノイズで歪めたもの」に
 *    控除率20%を掛けて算出する（＝市場は有能だが完璧ではない）
 *
 * 乱数は seed 固定の mulberry32 なので、同じ引数なら毎回同じデータになる。
 */

import type { TestDatabase } from './testDb';

/** 能力が着順に効く強さ */
const ABILITY_STRENGTH = 3.0;

/** 単勝の控除率（払戻率80%） */
const PAYOUT_RATE = 0.8;

export interface SyntheticOptions {
  /** 生成するレース数 */
  races: number;
  /** 1レースの出走頭数 */
  horsesPerRace: number;
  /** 馬プールのサイズ */
  horsePool?: number;
  /** 乱数シード */
  seed?: number;
  /** 初回レースの日付（YYYY-MM-DD） */
  startDate?: string;
  /** 開催日の間隔（日） */
  intervalDays?: number;
  /** 1開催日あたりのレース数（既定1）。JRAの実データは1日24〜36レース */
  racesPerDay?: number;
  /**
   * 市場データの形
   *
   * - `preRaceOdds`（既定）: 全馬に事前オッズ + 人気、確定オッズも全馬ぶん
   * - `resultPageOnly`: **実データの形**。結果ページからしか取れないレースでは
   *   `race_entries.win_odds` は全馬 NULL（事前オッズ無し）、人気順位のみ全馬あり、
   *   `race_results.final_win_odds` は払戻から復元するため **1着馬にしか入らない**
   */
  marketShape?: 'preRaceOdds' | 'resultPageOnly';
  /** 結果を登録するレース数（既定: 全レース）。残りは未確定レースになる */
  resultRaces?: number;
}

export interface SyntheticResult {
  /** 生成したレースID（日付昇順） */
  raceIds: number[];
  /** 馬ID → 潜在能力 */
  abilities: Map<number, number>;
}

/** mulberry32（決定論的PRNG） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 日付を n 日進める */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 合成レースを生成してテストDBへ投入する
 */
export function seedSyntheticRaces(
  testDb: TestDatabase,
  options: SyntheticOptions
): SyntheticResult {
  const {
    races,
    horsesPerRace,
    horsePool = Math.max(horsesPerRace * 2, 24),
    seed = 42,
    startDate = '2022-01-09',
    intervalDays = 7,
    racesPerDay = 1,
    marketShape = 'preRaceOdds',
    resultRaces = options.races
  } = options;

  const rand = mulberry32(seed);
  const { horseRepo, raceRepo } = testDb;

  // ---- 馬プール ----
  const abilities = new Map<number, number>();
  const horses: { id: number; name: string; sire: string; mare: string }[] = [];

  for (let i = 0; i < horsePool; i++) {
    const name = `合成馬${String(i + 1).padStart(3, '0')}`;
    const sire = `合成父${(i % 5) + 1}`;
    const mare = `合成母${i + 1}`;
    const result = horseRepo.insertHorseWithBloodline({
      name,
      birthYear: 2018,
      sex: i % 2 === 0 ? '牡' : '牝',
      sire,
      mare,
      trainer: `合成調教師${(i % 4) + 1}`
    });
    horses.push({ id: result.id, name, sire, mare });
    abilities.set(result.id, rand());
  }

  const venues = ['中山', '東京', '阪神'];
  const distances = [1600, 2000, 2500];

  /** 馬ID → これまでの通算成績 */
  const career = new Map<number, { runs: number; wins: number; places: number; shows: number }>();
  const raceIds: number[] = [];

  for (let r = 0; r < races; r++) {
    // 同一開催日に racesPerDay 本のレースを置く（walk-forward の日付単位分割の検証用）
    const dayIndex = Math.floor(r / racesPerDay);
    const indexInDay = r % racesPerDay;
    const raceDate = addDays(startDate, dayIndex * intervalDays);
    const venue = venues[r % venues.length];
    const distance = distances[r % distances.length];

    const race = raceRepo.insertRace({
      raceDate,
      venue,
      // 同一日内でレース番号を変えて UNIQUE(race_date, venue_id, race_number) を満たす
      // （競馬場も r ごとに変わるので racesPerDay <= 12 なら必ず一意）
      raceNumber: (indexInDay % 12) + 1,
      raceName: `合成レース${r + 1}`,
      raceClass: r % 5 === 0 ? 'G1' : 'オープン',
      raceType: '芝',
      distance,
      trackCondition: '良',
      totalHorses: horsesPerRace
    });
    raceIds.push(race.id);

    // 出走馬を選ぶ（決定論的なローテーション + シャッフル）
    const field = pickField(horses, horsesPerRace, r, rand);

    // 真の効用と着順
    const utilities = field.map(h => ({
      horse: h,
      utility: (abilities.get(h.id) ?? 0.5) * ABILITY_STRENGTH + (rand() - 0.5) * 2
    }));
    const ordered = [...utilities].sort((a, b) => b.utility - a.utility);
    const positionByHorse = new Map<number, number>();
    ordered.forEach((u, i) => {
      positionByHorse.set(u.horse.id, i + 1);
    });

    // 市場オッズ: 能力ベースの真確率をノイズで歪める
    const marketScores = field.map(
      h => (abilities.get(h.id) ?? 0.5) * ABILITY_STRENGTH + (rand() - 0.5) * 1.2
    );
    const maxScore = Math.max(...marketScores);
    const exps = marketScores.map(s => Math.exp(s - maxScore));
    let expSum = 0;
    for (const e of exps) expSum += e;
    const marketProbs = exps.map(e => e / expSum);

    // 人気順（オッズ昇順）
    const oddsList = marketProbs.map(p => Math.max(1.1, PAYOUT_RATE / p));
    const popularity = rankAscending(oddsList);

    const withResult = r < resultRaces;

    field.forEach((h, i) => {
      const stats = career.get(h.id) ?? { runs: 0, wins: 0, places: 0, shows: 0 };
      const entry = raceRepo.insertRaceEntry(race.id, {
        horseName: h.name,
        sireName: h.sire,
        mareName: h.mare,
        jockeyName: `合成騎手${(i % 6) + 1}`,
        frameNumber: Math.min(8, Math.ceil(((i + 1) / horsesPerRace) * 8)),
        horseNumber: i + 1,
        assignedWeight: 54 + (i % 5),
        // 結果ページ由来の実データ形では事前オッズが取れない（全馬 NULL）
        winOdds: marketShape === 'resultPageOnly' ? undefined : Math.round(oddsList[i] * 10) / 10,
        popularity: popularity[i],
        horseWeight: 440 + Math.round(rand() * 60),
        weightChange: Math.round((rand() - 0.5) * 12),
        careerRuns: stats.runs,
        careerWins: stats.wins,
        careerPlaces: stats.places,
        careerShows: stats.shows
      });

      if (!withResult) return;

      const position = positionByHorse.get(h.id) ?? field.length;
      raceRepo.insertRaceResult(entry.id, {
        finishPosition: position,
        finishStatus: '完走',
        finishTime: '2:00.0',
        margin: '0',
        marginSeconds: (position - 1) * 0.2,
        last3fTime: Math.round((34 + (position / field.length) * 2) * 10) / 10,
        // 確定オッズは払戻金から復元するため、実データでは1着馬にしか入らない
        finalWinOdds:
          marketShape === 'resultPageOnly' && position !== 1
            ? undefined
            : Math.round(oddsList[i] * 10) / 10
      });

      // 通算成績を更新（次レース以降の出走表に反映される）
      career.set(h.id, {
        runs: stats.runs + 1,
        wins: stats.wins + (position === 1 ? 1 : 0),
        places: stats.places + (position === 2 ? 1 : 0),
        shows: stats.shows + (position === 3 ? 1 : 0)
      });
    });
  }

  return { raceIds, abilities };
}

/** 出走馬を決定論的に選ぶ */
function pickField<T>(pool: T[], size: number, raceIndex: number, rand: () => number): T[] {
  const start = (raceIndex * 3) % pool.length;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  const field = rotated.slice(0, Math.min(size, pool.length));
  // Fisher-Yates（seed 固定なので決定論的）
  for (let i = field.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [field[i], field[j]] = [field[j], field[i]];
  }
  return field;
}

/** 昇順の順位（1始まり） */
function rankAscending(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(1);
  indexed.forEach((item, rank) => {
    ranks[item.i] = rank + 1;
  });
  return ranks;
}
