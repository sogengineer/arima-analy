/**
 * JRA公式サイト（www.jra.go.jp / JRADB）のHTMLパーサ
 *
 * @remarks
 * 取得済みHTML（`fetch-jra` で保存したページ）から、
 * 出馬表・レース結果に共通の `race_header` ブロックを解析する。
 * ここではファイルの読み込み・外部取得は行わない（純粋な文字列処理）。
 */

import type { RaceType, TrackCondition, JRARaceHeader } from '@/types/JRAPage';

export type { RaceType, TrackCondition, JRARaceHeader } from '@/types/JRAPage';

// ============================================
// 共通ユーティリティ
// ============================================

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
};

/** 数値文字参照と主要な実体参照をデコードする */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m);
}

/** HTMLタグを除去して前後の空白を詰める */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

const RACE_TYPE_BY_KEYWORD: ReadonlyArray<[string, RaceType]> = [
  ['障', '障害'],
  ['ダート', 'ダート'],
  ['ダ', 'ダート'],
  ['芝', '芝']
];

/** 「芝・右 外」「ダート・左」「障害・芝 → ダート」などからトラック種別を判定 */
export function parseCourseType(detail: string): RaceType {
  for (const [keyword, type] of RACE_TYPE_BY_KEYWORD) {
    if (detail.includes(keyword)) return type;
  }
  return '芝';
}

const TRACK_CONDITIONS: readonly TrackCondition[] = ['良', '稍重', '重', '不良'];

export function parseTrackCondition(text: string | undefined): TrackCondition | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  return TRACK_CONDITIONS.find(c => c === trimmed);
}

// ============================================
// レースヘッダ
// ============================================

/**
 * 出馬表・レース結果に共通の `race_header` ブロックからレース条件を抽出する
 *
 * @remarks
 * 旧実装（HorseDataExtractor.parseRaceInfo）は距離1200m・ダート・良を
 * ハードコードしていたため、取り込んだ全レースの条件が壊れていた。
 * 本関数は出馬表・レース結果ページの `race_header` ブロックの構造に基づいて抽出する。
 */
export function parseRaceHeader(html: string): JRARaceHeader | null {
  const dateMatch = html.match(
    /<div class="cell date">\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:（[^）]*）)?\s*([^<]*?)\s*<\/div>/
  );
  if (!dateMatch) return null;

  const [, year, month, day, kaisaiRaw] = dateMatch;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const kaisaiLabel = kaisaiRaw ? decodeEntities(kaisaiRaw).trim() : undefined;

  // 「4回中山5日」から競馬場名を取る。取れない場合はページ内の他の表記を探す
  const venue = kaisaiLabel?.match(/\d+回(.+?)\d+日/)?.[1]?.trim()
    ?? html.match(/<span class="kaisai">([^<]+)<\/span>/)?.[1]?.trim()
    ?? '';

  const raceNumber = Number(
    html.match(/<div class="race_number"><img[^>]*alt="(\d+)\s*レース"/)?.[1]
    ?? html.match(/alt="(\d+)レース選択"/)?.[1]
    ?? '0'
  );

  const raceNameRaw = html.match(/<span class="race_name">([\s\S]*?)<\/span>\s*<\/span>/)?.[1]
    ?? html.match(/<span class="race_name">([\s\S]*?)<\/span>/)?.[1]
    ?? '';
  const raceName = stripTags(raceNameRaw.replace(/<span class="grade_icon[\s\S]*$/, ''));

  const grade = parseGrade(raceNameRaw);

  // レース条件ブロック（<div class="type"> ... </div>）に限定して抽出する。
  // `cell weight` は馬体重セルでも使われるため、スコープを絞らないと誤取得する。
  const typeBlock = sliceTypeBlock(html);
  const pickCell = (name: string): string | undefined => {
    const m = typeBlock.match(new RegExp(`<div class="cell ${name}">([\\s\\S]*?)</div>`));
    const value = m ? stripTags(m[1]) : '';
    return value === '' ? undefined : value;
  };

  const courseCell = typeBlock.match(/<div class="cell course">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const distance = Number((courseCell.match(/コース：<\/span>\s*([\d,]+)/)?.[1] ?? '0').replace(/,/g, ''));
  const courseDetail = courseCell.match(/<span class="detail">（([^）]*)）<\/span>/)?.[1];

  if (!distance) return null;

  const courseType = parseCourseType(courseDetail ?? '');
  const baba = parseBaba(html, courseType);

  return {
    date,
    venue,
    raceNumber,
    raceName,
    grade,
    raceClass: pickCell('class'),
    ageCondition: pickCell('category'),
    sexCondition: pickCell('rule')?.includes('牝') ? '牝' : undefined,
    weightCondition: pickCell('weight'),
    distance,
    courseType,
    courseDetail,
    trackCondition: baba.trackCondition,
    weather: baba.weather,
    startTime: html.match(/発走時刻：<strong>([^<]+)<\/strong>/)?.[1]?.trim(),
    kaisaiLabel
  };
}

/**
 * レース条件ブロック（`<div class="type">`）を切り出す
 *
 * @remarks
 * 入れ子の `</div>` があるため正規表現の非貪欲マッチでは
 * 末尾のコース欄が欠ける。開始位置から賞金欄の直前までを切り出す。
 */
function sliceTypeBlock(html: string): string {
  const start = html.indexOf('<div class="type">');
  if (start < 0) return '';
  const rest = html.slice(start);
  const end = rest.indexOf('<ul class="prize"');
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 2000);
}

/** グレードアイコン画像からG1/G2/G3・J.G1などを判定 */
function parseGrade(raceNameHtml: string): string | undefined {
  const m = raceNameHtml.match(/icon_grade_(?:s_)?(j?g)(\d)\.png/i);
  if (!m) return undefined;
  const prefix = m[1].toLowerCase() === 'jg' ? 'J.G' : 'G';
  return `${prefix}${m[2]}`;
}

/** 天候・馬場状態ブロックを抽出（レース結果ページのみ存在。出馬表には無い） */
function parseBaba(html: string, courseType: RaceType): { weather?: string; trackCondition?: TrackCondition } {
  const block = html.match(/<div class="cell baba">([\s\S]*?)<\/div>/)?.[1];
  if (!block) return {};

  // クラス名に依存せず見出し（天候 / 芝 / ダート）で引く。
  // JRAのHTMLではダートのクラス名が "durt" になっている箇所があるため。
  const labels = new Map<string, string>();
  for (const item of block.matchAll(
    /<span class="cap">([^<]*)<\/span>\s*<span class="txt">([^<]*)<\/span>/g
  )) {
    labels.set(item[1].trim(), item[2].trim());
  }

  const weather = labels.get('天候');
  const turf = labels.get('芝');
  const dirt = labels.get('ダート');

  // 障害は芝・ダートの両方が載るため、芝を代表値とする
  const preferred = courseType === 'ダート' ? (dirt ?? turf) : (turf ?? dirt);

  return { weather, trackCondition: parseTrackCondition(preferred) };
}
