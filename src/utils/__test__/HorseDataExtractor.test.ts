import { describe, it, expect } from 'bun:test';
import { HorseDataExtractor } from '../HorseDataExtractor';

/**
 * HorseDataExtractor テスト
 *
 * ## 枠番の割当規則（JRA・8枠制）
 *
 * | 総頭数 | 割当 |
 * |-------|------|
 * | 〜8頭 | 馬番＝枠番 |
 * | 9〜16頭 | 大きい枠番から順に (総頭数−8) 枠が2頭、残りは1頭 |
 * | 17頭 | 8枠のみ3頭、1〜7枠は2頭 |
 * | 18頭 | 7・8枠が3頭、1〜6枠は2頭 |
 */

describe('HorseDataExtractor', () => {
  describe('calculateFrameNumber', () => {
    /** 馬番1〜総頭数の枠番リストが期待値と一致することを検証 */
    function expectFrames(totalHorses: number, expected: number[]): void {
      const actual = Array.from(
        { length: totalHorses },
        (_, i) => HorseDataExtractor.calculateFrameNumber(i + 1, totalHorses)
      );
      expect(actual).toEqual(expected);
    }

    it('8頭以下は馬番＝枠番', () => {
      expectFrames(8, [1, 2, 3, 4, 5, 6, 7, 8]);
      expectFrames(7, [1, 2, 3, 4, 5, 6, 7]);
      expectFrames(5, [1, 2, 3, 4, 5]);
      expectFrames(1, [1]);
    });

    it('9頭は8枠のみ2頭', () => {
      expectFrames(9, [1, 2, 3, 4, 5, 6, 7, 8, 8]);
    });

    it('12頭は5〜8枠が2頭', () => {
      expectFrames(12, [1, 2, 3, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
    });

    it('14頭は3〜8枠が2頭', () => {
      expectFrames(14, [1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
    });

    it('16頭は全枠2頭', () => {
      expectFrames(16, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
    });

    it('17頭は8枠のみ3頭', () => {
      expectFrames(17, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8]);
    });

    it('18頭は7・8枠が3頭', () => {
      expectFrames(18, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8]);
    });
  });

  describe('extractAll（HTMLからの抽出）', () => {
    /** JRA出馬表のマークアップを模した馬1頭ぶんの行を生成 */
    function horseRow(num: number, name: string, sexAge: string): string {
      return `<tr>
        <td class="waku"><img src="/waku/waku${num}.png" alt="枠"></td>
        <td class="num">${num}</td>
        <td class="horse">
          <div class="name"><a href="/horse/${num}">${name}</a></div>
          <p class="age">${sexAge}</p>
          <div class="odds"><span class="num"><strong>${num + 1}.5</strong></span>(${num}<span>番人気</span>)</div>
        </td>
        <td class="jockey">
          <p class="jockey"><a href="/jockey/${num}">騎手${num}</a></p>
          <p class="weight">57.0<span>kg</span></p>
        </td>
        <td class="past p1"></td>
      </tr>`;
    }

    function buildHtml(rows: string[]): string {
      return `<html><head><title>テストレース</title></head><body><table>${rows.join('\n')}</table></body></html>`;
    }

    it('18頭立ての枠番が割当規則どおりに計算される', () => {
      const rows = Array.from({ length: 18 }, (_, i) => horseRow(i + 1, `馬${i + 1}`, '牡3'));
      const extractor = new HorseDataExtractor(buildHtml(rows));

      const result = extractor.extractAll({ sortBy: 'horseNumber', includePreviousRaces: false });

      expect(result.success).toBe(true);
      const horses = result.data!.horses;
      expect(horses).toHaveLength(18);
      expect(horses.map(h => h.raceInfo.frameNumber)).toEqual(
        [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8]
      );
    });

    it('性別・年齢・斤量が抽出される', () => {
      const rows = [
        horseRow(1, 'テスト馬A', '牝4'),
        horseRow(2, 'テスト馬B', 'セ6'),
        horseRow(3, 'テスト馬C', '牡3'),
      ];
      const extractor = new HorseDataExtractor(buildHtml(rows));

      const result = extractor.extractAll({ sortBy: 'horseNumber', includePreviousRaces: false });

      expect(result.success).toBe(true);
      const horses = result.data!.horses;
      expect(horses.map(h => h.basicInfo.sex)).toEqual(['牝', '騸', '牡']);
      expect(horses.map(h => h.basicInfo.age)).toEqual([4, 6, 3]);
      expect(horses.map(h => h.raceInfo.assignedWeight)).toEqual([57, 57, 57]);
      // 8頭以下なので枠番＝馬番
      expect(horses.map(h => h.raceInfo.frameNumber)).toEqual([1, 2, 3]);
    });

    describe('欠損の表現（M4）', () => {
      /** オッズ・人気ブロックを持たない行 */
      function horseRowWithoutOdds(num: number, name: string): string {
        return `<tr>
          <td class="waku"><img src="/waku/waku${num}.png" alt="枠"></td>
          <td class="num">${num}</td>
          <td class="horse">
            <div class="name"><a href="/horse/${num}">${name}</a></div>
            <p class="age">牡4</p>
          </td>
          <td class="jockey">
            <p class="jockey"><a href="/jockey/${num}">騎手${num}</a></p>
            <p class="weight">57.0<span>kg</span></p>
          </td>
        </tr>`;
      }

      it('人気・オッズが取れないときは 0 ではなく undefined を返す', () => {
        const rows = [horseRowWithoutOdds(1, '欠損馬A'), horseRowWithoutOdds(2, '欠損馬B')];
        const extractor = new HorseDataExtractor(buildHtml(rows));

        const result = extractor.extractAll({ sortBy: 'horseNumber', includePreviousRaces: false });

        const horses = result.data!.horses;
        // 0 だと popularityNorm が「1番人気」相当に正規化され、
        // hasPopularity=1 のまま欠損が特徴量に紛れ込む
        expect(horses.map(h => h.raceInfo.popularity)).toEqual([undefined, undefined]);
        expect(horses.map(h => h.raceInfo.winOdds)).toEqual([undefined, undefined]);
      });

      it('人気・オッズが取れる行では数値が入る', () => {
        const extractor = new HorseDataExtractor(buildHtml([horseRow(1, '通常馬', '牡4')]));

        const result = extractor.extractAll({ sortBy: 'horseNumber', includePreviousRaces: false });

        const horse = result.data!.horses[0];
        expect(horse.raceInfo.popularity).toBe(1);
        expect(horse.raceInfo.winOdds).toBe(2.5);
      });
    });

    describe('通算成績の解析（M5）', () => {
      /** `(1着.2着.3着.着外)` の成績欄つきの行 */
      function horseRowWithRecord(num: number, name: string, record: string): string {
        return `<tr>
          <td class="waku"><img src="/waku/waku${num}.png" alt="枠"></td>
          <td class="num">${num}</td>
          <td class="horse">
            <div class="name"><a href="/horse/${num}">${name}</a></div>
            <p class="age">牡4</p>
            <div class="odds"><span class="num"><strong>3.5</strong></span>(1<span>番人気</span>)</div>
            <div class="cell result">(${record})</div>
          </td>
          <td class="jockey">
            <p class="jockey"><a href="/jockey/${num}">騎手${num}</a></p>
            <p class="weight">57.0<span>kg</span></p>
          </td>
        </tr>`;
      }

      it('runs は4項目の合計（出走数）。4項目めの着外回数をそのまま使わない', () => {
        // (3.2.1.6) = 1着3回 / 2着2回 / 3着1回 / 着外6回 → 出走12回
        const extractor = new HorseDataExtractor(
          buildHtml([horseRowWithRecord(1, '成績馬', '3.2.1.6')])
        );

        const result = extractor.extractAll({ sortBy: 'horseNumber', includePreviousRaces: false });

        const record = result.data!.horses[0].record;
        expect(record.wins).toBe(3);
        expect(record.places).toBe(2);
        expect(record.shows).toBe(1);
        // career_* 列と同じ意味（runs = 出走数）
        expect(record.runs).toBe(12);
        // 勝率の分母として整合する（wins <= runs）
        expect(record.wins).toBeLessThanOrEqual(record.runs);
      });

      it('未出走 (0.0.0.0) は全て0', () => {
        const extractor = new HorseDataExtractor(
          buildHtml([horseRowWithRecord(1, '新馬', '0.0.0.0')])
        );

        const record = extractor.extractAll({
          sortBy: 'horseNumber',
          includePreviousRaces: false
        }).data!.horses[0].record;

        expect(record).toMatchObject({ wins: 0, places: 0, shows: 0, runs: 0 });
      });

      it('成績欄が無ければ全て0（出走数を捏造しない）', () => {
        const extractor = new HorseDataExtractor(buildHtml([horseRow(1, '成績欄なし', '牡4')]));

        const record = extractor.extractAll({
          sortBy: 'horseNumber',
          includePreviousRaces: false
        }).data!.horses[0].record;

        expect(record).toMatchObject({ wins: 0, places: 0, shows: 0, runs: 0 });
      });
    });
  });
});
