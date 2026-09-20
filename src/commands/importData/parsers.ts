/**
 * 抽出JSONの表記をドメインの語彙に変換するパーサ群
 *
 * @remarks
 * ImportData から切り出した純粋関数。DB・I/O には触れない。
 */

/**
 * 「1600芝」のような距離表記を距離とレース種別に分解する
 *
 * @param distanceStr - 距離表記
 * @returns 距離とレース種別（解釈できない場合はダート1200m）
 */
export function parseDistanceString(distanceStr: string): { distance: number; raceType: '芝' | 'ダート' | '障害' } {
  const match = distanceStr.match(/(\d+)(芝|ダ|障)/);
  if (match) {
    const distance = Number.parseInt(match[1], 10);
    let raceType: '芝' | 'ダート' | '障害' = 'ダート';
    if (match[2] === '芝') raceType = '芝';
    else if (match[2] === '障') raceType = '障害';
    return { distance, raceType };
  }
  return { distance: 1200, raceType: 'ダート' };
}

/**
 * 「2024年12月22日」形式の日付を ISO 形式（YYYY-MM-DD）に変換する
 *
 * @param dateStr - 和暦表記ではない西暦の日本語日付
 * @returns ISO 形式の日付。解釈できない場合は入力をそのまま返す
 */
export function parseJapaneseDate(dateStr: string): string {
  const match = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

/**
 * コース種別の表記をレース種別に変換する
 *
 * @param courseType - コース種別の表記
 * @returns レース種別。語彙に無い表記は undefined
 */
export function parseRaceType(courseType: string): '芝' | 'ダート' | '障害' | undefined {
  if (courseType === '芝') return '芝';
  if (courseType === 'ダート') return 'ダート';
  if (courseType === '障害') return '障害';
  return undefined;
}

/**
 * 馬場状態の表記を検証する
 *
 * @param condition - 馬場状態の表記
 * @returns 馬場状態。語彙に無い表記は undefined
 */
export function parseTrackCondition(condition: string): '良' | '稍重' | '重' | '不良' | undefined {
  if (['良', '稍重', '重', '不良'].includes(condition)) {
    return condition as '良' | '稍重' | '重' | '不良';
  }
  return undefined;
}

/**
 * 馬齢から生年を計算
 *
 * @remarks
 * 馬齢はレース開催時点の年齢なので、開催年を基準に計算する。
 * （現在年基準だと過去レースのインポートで生年がずれる）
 */
export function calculateBirthYear(age: number, raceDate?: string): number {
  const raceYear = raceDate?.match(/^(\d{4})/);
  const baseYear = raceYear ? Number(raceYear[1]) : new Date().getFullYear();
  return baseYear - age;
}
