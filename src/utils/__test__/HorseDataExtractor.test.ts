import { describe, it, expect } from 'bun:test';
import { HorseDataExtractor } from '../HorseDataExtractor.js';

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
  });
});
