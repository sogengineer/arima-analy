import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import iconv from 'iconv-lite';

export function convertEncoding(buffer: Buffer, encoding: string): string {
  try {
    switch (encoding.toLowerCase()) {
      case 'shift_jis':
      case 'shift-jis':
        return iconv.decode(buffer, 'shift_jis');
      case 'utf-8':
      case 'utf8':
        return buffer.toString('utf8');
      case 'euc-jp':
        return iconv.decode(buffer, 'euc-jp');
      default:
        // Shift_JISで試行してから、失敗したらUTF-8
        try {
          return iconv.decode(buffer, 'shift_jis');
        } catch {
          return buffer.toString('utf8');
        }
    }
  } catch (error) {
    console.warn(`エンコーディング変換エラー (${encoding}):`, error);
    return buffer.toString('utf8');
  }
}

export function saveToFile(
  data: string,
  outputFile: string,
  createDirectory: boolean
): { success: boolean; outputFile?: string; error?: string } {
  try {
    // ディレクトリの作成
    if (createDirectory) {
      const outputDir = outputFile.substring(0, outputFile.lastIndexOf('/'));
      if (outputDir && !existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
    }

    writeFileSync(outputFile, data, 'utf8');
    console.log(`✅ HTMLファイルを保存: ${outputFile}`);

    return {
      success: true,
      outputFile
    };
  } catch (error) {
    return {
      success: false,
      error: `ファイル保存エラー: ${error}`
    };
  }
}

export function displayBasicInfo(data: string): void {
  // 基本情報の抽出表示
  const titleMatch = data.match(/<title>(.*?)<\/title>/i);
  if (titleMatch) {
    console.log(`🏇 ページタイトル: ${titleMatch[1]}`);
  }

  // テーブル数の確認
  const tableCount = (data.match(/<table[^>]*>/gi) || []).length;
  console.log(`📊 テーブル数: ${tableCount}`);
}
