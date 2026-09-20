/**
 * `JRAPageParser` の抽出テスト
 *
 * @remarks
 * フィクスチャはJRAのページ構造（クラス名・マークアップの入れ子）だけを再現した
 * **合成HTML**。実ページの内容は含まず、テスト実行時に外部へのアクセスも行わない。
 */

import { describe, expect, test } from 'bun:test';
import {
  parseRaceHeader,
  parseCourseType,
  parseTrackCondition,
  stripTags,
  decodeEntities
} from '../JRAPageParser';

interface HeaderFixtureOptions {
  /** 「3回中山8日」相当の開催表記 */
  kaisai?: string;
  gradeIcon?: string;
  /** 天候・馬場状態ブロック（発走前のページには存在しない） */
  baba?: string;
  courseDetail?: string;
  distance?: string;
  rule?: string;
}

/**
 * レース共通ヘッダの合成HTMLを組み立てる
 *
 * @remarks
 * 再現しているのは構造上の癖だけ:
 * - `<div class="type">` に入れ子の `</div>` があること
 * - 馬体重セルにも `cell weight` が使われること（スコープを絞らないと誤取得する）
 * - 馬場状態のダートのクラス名が `durt`（JRA側の綴り誤り）であること
 */
function buildHeaderHtml(options: HeaderFixtureOptions = {}): string {
  const {
    kaisai = '3回架空場8日',
    gradeIcon = '',
    baba = '',
    courseDetail = '芝・左',
    distance = '2,000',
    rule = ''
  } = options;

  return `<html><body>
  <div class="race_header">
    <div class="cell date">2025年4月6日（日曜）${kaisai}</div>
    <div class="race_number"><img src="/JRADB/img/num/11.png" alt="11 レース"></div>
    <h1 class="race_title">
      <span class="race_name">テストステークス${gradeIcon}</span>
    </h1>
    <div class="type">
      <div class="cell class">オープン</div>
      <div class="cell category">3歳以上</div>
      <div class="cell rule">${rule}</div>
      <div class="cell weight">別定</div>
      ${baba}
      <div class="cell course">
        <span class="cap">コース：</span>${distance}メートル
        <span class="detail">（${courseDetail}）</span>
      </div>
      <div class="cell time">発走時刻：<strong>15時45分</strong></div>
    </div>
    <ul class="prize"><li>本賞金</li></ul>
  </div>
  <table><tbody><tr>
    <td class="weight">470<span>(+4)</span></td>
  </tr></tbody></table>
</body></html>`;
}

const BABA_TURF =
  '<div class="cell baba">' +
  '<span class="cap">天候</span><span class="txt">曇</span>' +
  '<span class="cap">芝</span><span class="txt">稍重</span>' +
  '</div>';

// JRAのHTMLではダートのクラス名が "durt"（綴り誤り）になっている
const BABA_DIRT =
  '<div class="cell baba">' +
  '<span class="cap">天候</span><span class="txt">晴</span>' +
  '<span class="durt"><span class="cap">ダート</span><span class="txt">重</span></span>' +
  '</div>';

describe('parseRaceHeader（レース結果ページ相当）', () => {
  const header = parseRaceHeader(buildHeaderHtml({ baba: BABA_TURF }))!;

  test('日付・会場・レース番号を抽出する', () => {
    expect(header.date).toBe('2025-04-06');
    expect(header.venue).toBe('架空場');
    expect(header.raceNumber).toBe(11);
    expect(header.kaisaiLabel).toBe('3回架空場8日');
  });

  test('距離・芝ダをHTMLから抽出する（ハードコードしない）', () => {
    expect(header.distance).toBe(2000);
    expect(header.courseType).toBe('芝');
    expect(header.courseDetail).toBe('芝・左');
  });

  test('馬場状態と天候を抽出する', () => {
    expect(header.trackCondition).toBe('稍重');
    expect(header.weather).toBe('曇');
  });

  test('レース名・クラス・条件を抽出する', () => {
    expect(header.raceName).toBe('テストステークス');
    expect(header.raceClass).toBe('オープン');
    expect(header.ageCondition).toBe('3歳以上');
    expect(header.startTime).toBe('15時45分');
  });

  test('負担重量条件は馬体重セルではなくレース条件ブロックから取る', () => {
    expect(header.weightCondition).toBe('別定');
  });

  test('重賞でないレースにはグレードが付かない', () => {
    expect(header.grade).toBeUndefined();
  });
});

describe('parseRaceHeader（発走前の出馬表相当）', () => {
  const header = parseRaceHeader(
    buildHeaderHtml({ courseDetail: 'ダート・右', distance: '1,800' })
  )!;

  test('ダート戦の距離とコース種別を抽出する', () => {
    expect(header.distance).toBe(1800);
    expect(header.courseType).toBe('ダート');
  });

  test('発走前は馬場状態が無いので undefined になる（"良" を捏造しない）', () => {
    expect(header.trackCondition).toBeUndefined();
    expect(header.weather).toBeUndefined();
  });
});

describe('parseRaceHeader（個別条件）', () => {
  test('グレードアイコンからG1/G2/G3を判定する', () => {
    const html = buildHeaderHtml({
      gradeIcon: '<span class="grade_icon"><img src="/JRADB/img/icon_grade_s_g2.png" alt="GII"></span>'
    });
    const header = parseRaceHeader(html)!;
    expect(header.grade).toBe('G2');
    // グレードアイコンの中身はレース名に混ぜない
    expect(header.raceName).toBe('テストステークス');
  });

  test('障害競走のグレードは J.G 表記になる', () => {
    const html = buildHeaderHtml({
      gradeIcon: '<span class="grade_icon"><img src="/JRADB/img/icon_grade_s_jg1.png" alt="J・GI"></span>',
      courseDetail: '障害・芝 → ダート'
    });
    const header = parseRaceHeader(html)!;
    expect(header.grade).toBe('J.G1');
    expect(header.courseType).toBe('障害');
  });

  test('ダートの馬場状態はクラス名ではなく見出しで引く（durt 表記対策）', () => {
    const html = buildHeaderHtml({ baba: BABA_DIRT, courseDetail: 'ダート・右' });
    const header = parseRaceHeader(html)!;
    expect(header.trackCondition).toBe('重');
    expect(header.weather).toBe('晴');
  });

  test('牝馬限定戦を判定する', () => {
    const header = parseRaceHeader(buildHeaderHtml({ rule: '（牝）' }))!;
    expect(header.sexCondition).toBe('牝');
  });

  test('距離が読めないHTMLでは null を返す（0mを作らない）', () => {
    const html = buildHeaderHtml().replace(/<span class="cap">コース：<\/span>[^<]*/, '');
    expect(parseRaceHeader(html)).toBeNull();
  });
});

describe('ユーティリティ', () => {
  test('parseCourseType はコース詳細から芝ダ障を判定する', () => {
    expect(parseCourseType('芝・右 外')).toBe('芝');
    expect(parseCourseType('ダート・左')).toBe('ダート');
    expect(parseCourseType('障害・芝')).toBe('障害');
  });

  test('parseTrackCondition は既定の4区分だけを受け付ける', () => {
    expect(parseTrackCondition(' 不良 ')).toBe('不良');
    expect(parseTrackCondition('やや重')).toBeUndefined();
    expect(parseTrackCondition(undefined)).toBeUndefined();
  });

  test('stripTags / decodeEntities は実体参照を戻す', () => {
    expect(decodeEntities('G&#8545;')).toBe('GⅡ');
    expect(stripTags('<span class="x">  あ  </span><b>い</b>')).toBe('あ い');
  });

  test('解析できないHTMLでは null を返す', () => {
    expect(parseRaceHeader('<html><body>no race here</body></html>')).toBeNull();
  });
});
