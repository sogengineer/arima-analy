import { HorseDataExtractor } from '../utils/HorseDataExtractor.js';
import { writeFileSync } from 'node:fs';

export class ExtractData {
  async extractFromHTML(htmlFilePath: string, outputFormat: 'detailed' | 'summary' | 'csv' = 'detailed', sourceUrl: string = ''): Promise<void> {
    try {
      console.log(`🔍 HTMLファイルから馬データを抽出中: ${htmlFilePath}`);

      const extractor = HorseDataExtractor.fromFile(htmlFilePath, sourceUrl);
      const result = extractor.extractAll({
        includeBloodline: true,
        includePreviousRaces: true,
        sortBy: 'popularity'
      });

      if (!result.success || !result.data) {
        console.error('❌ データ抽出に失敗:', result.error);
        return;
      }

      // 指定フォーマットで出力
      const output = extractor.formatOutput(result.data, outputFormat);
      console.log(output);

      // 警告表示
      if (result.warnings && result.warnings.length > 0) {
        console.log('\n⚠️  警告:');
        result.warnings.forEach(warning => console.log(`  - ${warning}`));
      }

      // JSONファイルにも保存（詳細フォーマットの場合）
      if (outputFormat === 'detailed') {
        const outputFile = 'data/horse-extracted-data.json';
        writeFileSync(outputFile, JSON.stringify(result.data, null, 2), 'utf-8');
        console.log(`\n📄 詳細データを ${outputFile} に保存しました。`);
      }
      
    } catch (error) {
      console.error('❌ スタンドアロン抽出に失敗:', error);
    }
  }

  async fetchAndExtract(url: string, outputFormat: 'detailed' | 'summary' | 'csv' = 'detailed', htmlOutput: string = 'data/jra-page.html'): Promise<void> {
    try {
      console.log('🚀 自動化処理を開始...\n');
      
      // Step 1: HTML取得
      const { JRAFetcher } = await import('../utils/JRAFetcher.js');
      console.log('📥 ステップ1: HTML取得');
      const fetchResult = await JRAFetcher.fetchAndSave(url, htmlOutput);
      
      if (!fetchResult.success) {
        console.error('❌ HTML取得失敗:', fetchResult.error);
        return;
      }
      
      console.log('✅ ステップ1完了\n');

      // Step 2: データ抽出
      console.log('🔍 ステップ2: データ抽出');
      await this.extractFromHTML(htmlOutput, outputFormat, url);

      console.log('\n🎉 データ取得・抽出完了！');
    } catch (error) {
      console.error('❌ 自動化処理に失敗:', error);
    }
  }
}