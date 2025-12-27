import https from 'node:https';
import http from 'node:http';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import iconv from 'iconv-lite';

export interface FetchOptions {
  outputFile?: string;
  userAgent?: string;
  timeout?: number;
  encoding?: string;
  createDirectory?: boolean;
}

export interface FetchResult {
  success: boolean;
  data?: string;
  outputFile?: string;
  size?: number;
  contentType?: string;
  encoding?: string;
  error?: string;
}

export class JRAFetcher {
  private readonly defaultOptions: Required<Omit<FetchOptions, 'outputFile'>> = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    timeout: 30000,
    encoding: 'shift_jis',
    createDirectory: true
  };

  async fetchHTML(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const opts = { ...this.defaultOptions, ...options };
    
    return new Promise((resolve) => {
      const client = url.startsWith('https:') ? https : http;
      
      const requestOptions = {
        headers: {
          'User-Agent': opts.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
      };

      console.log(`🌐 JRAページを取得中: ${url}`);

      const request = client.get(url, requestOptions, (response) => {
        console.log(`📡 ステータス: ${response.statusCode}`);
        console.log(`📋 Content-Type: ${response.headers['content-type']}`);
        console.log(`🗜️ Content-Encoding: ${response.headers['content-encoding'] || 'none'}`);

        if (response.statusCode !== 200) {
          resolve({
            success: false,
            error: `HTTPエラー: ${response.statusCode} ${response.statusMessage}`
          });
          return;
        }

        // エンコーディングに応じてデコンプレッションストリームを作成
        let stream: NodeJS.ReadableStream = response;
        const encoding = response.headers['content-encoding'];
        
        try {
          if (encoding === 'gzip') {
            stream = response.pipe(zlib.createGunzip());
          } else if (encoding === 'deflate') {
            stream = response.pipe(zlib.createInflate());
          } else if (encoding === 'br') {
            stream = response.pipe(zlib.createBrotliDecompress());
          }
        } catch (error) {
          resolve({
            success: false,
            error: `圧縮解除エラー: ${error}`
          });
          return;
        }

        const chunks: Buffer[] = [];

        // データの受信（バイナリバッファとして蓄積）
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        // エラーハンドリング（デコンプレッション用）
        stream.on('error', (error) => {
          resolve({
            success: false,
            error: `ストリームエラー: ${error.message}`
          });
        });

        // 受信完了
        stream.on('end', () => {
          try {
            // バッファを結合
            const buffer = Buffer.concat(chunks);
            
            // エンコーディング変換
            const data = this.convertEncoding(buffer, opts.encoding);
            
            console.log(`📄 HTMLサイズ: ${data.length} 文字`);

            // ファイルに保存
            let outputFile = options.outputFile;
            if (outputFile) {
              const result = this.saveToFile(data, outputFile, opts.createDirectory);
              if (!result.success) {
                resolve({
                  success: false,
                  error: result.error
                });
                return;
              }
              outputFile = result.outputFile;
            }

            // 基本情報の表示
            this.displayBasicInfo(data);

            resolve({
              success: true,
              data,
              outputFile,
              size: data.length,
              contentType: response.headers['content-type'] as string,
              encoding: encoding as string
            });

          } catch (error) {
            resolve({
              success: false,
              error: `データ処理エラー: ${error}`
            });
          }
        });
      });

      // エラーハンドリング
      request.on('error', (error) => {
        resolve({
          success: false,
          error: `リクエストエラー: ${error.message}`
        });
      });

      // タイムアウト設定
      request.setTimeout(opts.timeout, () => {
        console.error(`❌ タイムアウト: ${opts.timeout / 1000}秒以内にレスポンスがありませんでした`);
        request.abort();
        resolve({
          success: false,
          error: `タイムアウト: ${opts.timeout / 1000}秒`
        });
      });

      console.log('⏳ HTML取得中...');
    });
  }

  private convertEncoding(buffer: Buffer, encoding: string): string {
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

  private saveToFile(data: string, outputFile: string, createDirectory: boolean): 
    { success: boolean; outputFile?: string; error?: string } {
    
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

  private displayBasicInfo(data: string): void {
    // 基本情報の抽出表示
    const titleMatch = data.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) {
      console.log(`🏇 ページタイトル: ${titleMatch[1]}`);
    }

    // テーブル数の確認
    const tableCount = (data.match(/<table[^>]*>/gi) || []).length;
    console.log(`📊 テーブル数: ${tableCount}`);
  }

  displayNextSteps(outputFile?: string): void {
    console.log('\n🔍 次のステップ:');
    if (outputFile) {
      console.log('1. TypeScript抽出機能で詳細解析:');
      console.log(`   npx tsx src/index.ts extract-html "${outputFile}"`);
      console.log('2. またはJavaScript版:');
      console.log(`   node scripts/extract-horse-from-html.js "${outputFile}"`);
    } else {
      console.log('1. データは変数に格納されました');
      console.log('2. HorseDataExtractor.parseJRAHorseData() で解析可能です');
    }
  }

  static async fetchAndSave(url: string, outputFile: string = 'data/jra-page.html'): Promise<FetchResult> {
    const fetcher = new JRAFetcher();
    const result = await fetcher.fetchHTML(url, { 
      outputFile,
      createDirectory: true 
    });
    
    if (result.success && result.outputFile) {
      fetcher.displayNextSteps(result.outputFile);
    }
    
    return result;
  }
}

// CLI使用のためのヘルパー関数
export async function fetchJRAPage(url: string, outputFile?: string): Promise<void> {
  if (!url) {
    console.error('使用法: fetchJRAPage <URL> [outputFile]');
    process.exit(1);
  }

  const result = await JRAFetcher.fetchAndSave(url, outputFile);
  
  if (!result.success) {
    console.error('❌', result.error);
    process.exit(1);
  }
}