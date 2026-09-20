import https from 'node:https';
import http from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import zlib from 'node:zlib';
import { convertEncoding, displayBasicInfo, saveToFile } from './JRAFetcherIO';

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

/** 1リクエストぶんの取得コンテキスト（レスポンス処理に持ち回る） */
interface FetchContext {
  encoding: string;
  createDirectory: boolean;
  outputFile?: string;
}

export class JRAFetcher {
  private readonly defaultOptions: Required<Omit<FetchOptions, 'outputFile'>> = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    timeout: 30000,
    encoding: 'shift_jis',
    createDirectory: true
  };

  /** 取得を許可するホスト（JRA公式サイトのみ） */
  private static readonly ALLOWED_HOST_SUFFIXES = ['jra.go.jp'];

  /**
   * 連続リクエストの最小間隔（ミリ秒）
   *
   * @remarks
   * 公式サイトへの負荷を避けるため、プロセス全体で直列に2秒以上空ける。
   */
  private static readonly MIN_INTERVAL_MS = 2000;
  private static lastRequestAt = 0;

  /** 直前のリクエストから最小間隔が経過するまで待つ */
  private static async throttle(): Promise<void> {
    const wait = JRAFetcher.lastRequestAt + JRAFetcher.MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    JRAFetcher.lastRequestAt = Date.now();
  }

  /**
   * 取得対象URLを検証する
   *
   * @remarks
   * 未検証のURLをそのまま fetch すると、file:// や社内ネットワーク等の
   * 意図しない宛先へのリクエスト（SSRF）につながるため、
   * スキームを http/https に限定し、ホストをJRA公式ドメインに限定する。
   *
   * @param url - 検証対象URL
   * @returns エラーメッセージ（問題なければ null）
   */
  static validateUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `URLの形式が不正です: ${url}`;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `サポートされていないスキームです: ${parsed.protocol}（http/httpsのみ）`;
    }

    const host = parsed.hostname.toLowerCase();
    const allowed = JRAFetcher.ALLOWED_HOST_SUFFIXES.some(
      suffix => host === suffix || host.endsWith(`.${suffix}`)
    );
    if (!allowed) {
      return `許可されていないホストです: ${parsed.hostname}（${JRAFetcher.ALLOWED_HOST_SUFFIXES.join(', ')} のみ）`;
    }

    return null;
  }

  async fetchHTML(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const opts = { ...this.defaultOptions, ...options };

    const validationError = JRAFetcher.validateUrl(url);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // 公式サイトへの負荷を避けるため、全リクエストを最小間隔で直列化する
    await JRAFetcher.throttle();

    const context: FetchContext = {
      encoding: opts.encoding,
      createDirectory: opts.createDirectory,
      outputFile: options.outputFile
    };

    return new Promise((resolve) => {
      const client = url.startsWith('https:') ? https : http;
      const requestOptions = JRAFetcher.buildRequestOptions(opts.userAgent);

      console.log(`🌐 JRAページを取得中: ${url}`);

      const request = client.request(url, requestOptions, (response) => {
        this.receiveResponse(response, context, resolve);
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
        request.destroy();
        resolve({
          success: false,
          error: `タイムアウト: ${opts.timeout / 1000}秒`
        });
      });

      request.end();

      console.log('⏳ HTML取得中...');
    });
  }

  private static buildRequestOptions(userAgent: string): RequestOptions {
    return {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
    };
  }

  /** Content-Encoding に応じて解凍ストリームを被せる */
  private static decompress(
    response: IncomingMessage,
    contentEncoding: string | undefined
  ): NodeJS.ReadableStream {
    if (contentEncoding === 'gzip') return response.pipe(zlib.createGunzip());
    if (contentEncoding === 'deflate') return response.pipe(zlib.createInflate());
    if (contentEncoding === 'br') return response.pipe(zlib.createBrotliDecompress());
    return response;
  }

  /** レスポンスを受け取り、本文を読み切って結果を resolve する */
  private receiveResponse(
    response: IncomingMessage,
    context: FetchContext,
    resolve: (result: FetchResult) => void
  ): void {
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

    const contentEncoding = response.headers['content-encoding'];
    let stream: NodeJS.ReadableStream;
    try {
      stream = JRAFetcher.decompress(response, contentEncoding);
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
        resolve(this.buildResult(chunks, response, contentEncoding, context));
      } catch (error) {
        resolve({
          success: false,
          error: `データ処理エラー: ${error}`
        });
      }
    });
  }

  /** 受信バッファをデコードし、必要ならファイルに保存して結果を組み立てる */
  private buildResult(
    chunks: Buffer[],
    response: IncomingMessage,
    contentEncoding: string | undefined,
    context: FetchContext
  ): FetchResult {
    const buffer = Buffer.concat(chunks);
    const data = convertEncoding(buffer, context.encoding);

    console.log(`📄 HTMLサイズ: ${data.length} 文字`);

    let outputFile = context.outputFile;
    if (outputFile) {
      const saved = saveToFile(data, outputFile, context.createDirectory);
      if (!saved.success) {
        return { success: false, error: saved.error };
      }
      outputFile = saved.outputFile;
    }

    // 基本情報の表示
    displayBasicInfo(data);

    return {
      success: true,
      data,
      outputFile,
      size: data.length,
      contentType: response.headers['content-type'] as string,
      encoding: contentEncoding as string
    };
  }

  displayNextSteps(outputFile?: string): void {
    console.log('\n🔍 次のステップ:');
    if (outputFile) {
      console.log('1. データを抽出してJSON保存（DB不使用）:');
      console.log(`   bun start extract-html-only "${outputFile}"`);
      console.log('2. 抽出してDBにも登録:');
      console.log(`   bun start extract-html "${outputFile}"`);
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