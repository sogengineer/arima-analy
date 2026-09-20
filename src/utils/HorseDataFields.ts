import type { PreviousRaceResult } from '@/types/HorseData';

const PREVIOUS_RACE_POSITIONS: PreviousRaceResult['position'][] = [
  'front',
  'second',
  'third',
  'fourth'
];

/**
 * JRA表記の性別文字を正規化する
 *
 * @remarks
 * 「セン」「セ」「騸」はいずれも騸馬。性別が読めなかった場合は従来のデフォルト値 '牡'。
 */
export function normalizeSex(raw: string | undefined): '牡' | '牝' | '騸' {
  if (raw === '牝') return '牝';
  if (raw === 'セン' || raw === 'セ' || raw === '騸') return '騸';
  return '牡';
}

const trimmed = (match: RegExpMatchArray | null): string => (match ? match[1].trim() : '');

const toInt = (match: RegExpMatchArray | null, fallback: number): number =>
  match ? Number.parseInt(match[1], 10) : fallback;

/**
 * 前走セル1件分のHTMLを1レコードに組み立てる
 *
 * @returns 日付が読めないセルは前走として扱わないため null
 */
function parsePreviousRace(
  pastData: string,
  position: PreviousRaceResult['position']
): PreviousRaceResult | null {
  const dateMatch = pastData.match(/<div class="date">(.*?)<\/div>/);
  if (!dateMatch) return null;

  const jockeyRawMatch = pastData.match(/<div class="jockey">(.*?)<\/div>/);
  // HTMLタグを除去して騎手名のみ抽出
  const jockey = jockeyRawMatch ? jockeyRawMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  const placeMatch = pastData.match(/<div class="place">(\d+)<span>/);
  const weightMatch = pastData.match(/<div class="weight">\s*([\d.]+)<span>kg<\/span>/);
  const timeMatch = pastData.match(/<p class="time">(.*?)<\/p>/);
  const horseWeightMatch = pastData.match(/<p class="h_weight">(\d+)<span>kg<\/span>/);
  const winnerMatch = pastData.match(/<p class="fin">(.*?)<span/);

  return {
    position,
    date: dateMatch[1].trim(),
    track: trimmed(pastData.match(/<div class="rc">(.*?)<\/div>/)),
    raceName: trimmed(pastData.match(/<div class="name">.*?<a[^>]*>(.*?)<\/a>/s)),
    place: placeMatch ? placeMatch[1] : '',
    totalHorses: toInt(pastData.match(/<span class="max">(\d+)<span>頭<\/span>/), 0),
    gateNumber: toInt(pastData.match(/<span class="gate">(\d+)<span>番<\/span>/), 0),
    popularity: toInt(pastData.match(/<span class="pop">(\d+)<span>番人気<\/span>/), 0),
    jockey,
    weight: weightMatch ? Number.parseFloat(weightMatch[1]) : 0,
    distance: trimmed(pastData.match(/<span class="dist">(.*?)<\/span>/)),
    trackCondition: trimmed(pastData.match(/<span class="condition">(.*?)<\/span>/)),
    time: timeMatch ? timeMatch[1].trim() : undefined,
    horseWeight: horseWeightMatch ? Number.parseInt(horseWeightMatch[1], 10) : undefined,
    winner: winnerMatch ? winnerMatch[1].trim() : undefined
  };
}

/**
 * 出走馬行の前走セル（p1=前走, p2=前々走, p3=3走前, p4=4走前）を解析する
 */
export function parsePreviousRaces(
  pastRacesHtml: string,
  maxRaces: number
): PreviousRaceResult[] {
  const races: PreviousRaceResult[] = [];
  const pastMatches = pastRacesHtml.matchAll(/<td class="past p(\d+)[^"]*"[^>]*>([\s\S]*?)<\/td>/g);

  for (const match of pastMatches) {
    const raceIndex = Number.parseInt(match[1], 10) - 1;
    if (raceIndex >= maxRaces) continue;

    const pastData = match[2];
    if (!pastData.trim()) continue;

    const race = parsePreviousRace(pastData, PREVIOUS_RACE_POSITIONS[raceIndex] || 'fourth');
    if (race) races.push(race);
  }

  // position順にソート
  return races.sort(
    (a, b) => PREVIOUS_RACE_POSITIONS.indexOf(a.position) - PREVIOUS_RACE_POSITIONS.indexOf(b.position)
  );
}
