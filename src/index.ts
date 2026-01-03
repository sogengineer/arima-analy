#!/usr/bin/env node

import { Command } from 'commander';
import { ListHorses } from './commands/ListHorses';
import { ListJockeys } from './commands/ListJockeys';
import { AnalyzePerformance } from './commands/AnalyzePerformance';
import { AnalyzeTrack } from './commands/AnalyzeTrack';
import { AnalyzeCourse } from './commands/AnalyzeCourse';
import { CalculateScore } from './commands/CalculateScore';
import { Predict } from './commands/Predict';
import { Backtest } from './commands/Backtest';
import { ImportData } from './commands/ImportData';
import { ExtractData } from './commands/ExtractData';

const program = new Command();

program
  .name('arima')
  .description('有馬記念分析システム（手動データ入力対応版）')
  .version('1.0.0');

program
  .command('horses')
  .description('登録済み出走馬一覧表示と手動入力ガイド')
  .action(async () => {
    const command = new ListHorses();
    await command.execute();
  });

program
  .command('jockeys')
  .description('登録済み騎手一覧表示と手動入力ガイド')
  .action(async () => {
    const command = new ListJockeys();
    await command.execute();
  });

program
  .command('performance')
  .description('登録済み戦績の分析表示')
  .argument('[horse_name]', '特定の馬の戦績のみ分析する場合の馬名')
  .action(async (horseName?: string) => {
    const command = new AnalyzePerformance();
    await command.execute(horseName);
  });

program
  .command('track-analysis')
  .description('馬場状態別成績分析')
  .action(async () => {
    const command = new AnalyzeTrack();
    await command.execute();
  });

program
  .command('course-analysis')
  .description('会場別コース適性分析（省略時は全会場）')
  .argument('[venue]', '会場名（例: 中山, 東京, 阪神）')
  .action(async (venue?: string) => {
    const command = new AnalyzeCourse();
    await command.execute(venue);
  });

program
  .command('score')
  .description('スコアリングモデルで総合評価を算出')
  .option('-r, --race <id>', '対象レースID（数値またはレース名）')
  .option('-l, --list', '登録済みレース一覧を表示')
  .action(async (options: { race?: string; list?: boolean }) => {
    const command = new CalculateScore();
    await command.execute(options);
  });

program
  .command('predict')
  .description('機械学習で連帯・3着内確率を予測（旧版）')
  .action(async () => {
    const command = new Predict();
    await command.execute();
  });

program
  .command('ml')
  .description('機械学習予測（ロジスティック回帰 + ランダムフォレスト）')
  .option('-r, --race <id>', '対象レースID')
  .option('-t, --train', 'モデルを訓練のみ実行')
  .option('-c, --cross-check', 'スコアリング結果とクロスチェック')
  .action(async (options: { race?: string; train?: boolean; crossCheck?: boolean }) => {
    const { MachineLearningModel } = await import('./models/MachineLearningModel.js');
    const ml = new MachineLearningModel();

    try {
      // モデル訓練
      await ml.trainModels();

      if (options.train) {
        console.log('✅ モデル訓練完了');
        return;
      }

      if (!options.race) {
        console.log('\n⚠️  レースIDを指定してください: --race <id>');
        console.log('   レース一覧: arima score --list');
        return;
      }

      const raceId = parseInt(options.race, 10);
      if (isNaN(raceId)) {
        console.log('❌ 無効なレースID');
        return;
      }

      // 予測実行
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🤖 機械学習予測結果');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const predictions = await ml.predict(raceId);

      console.log('馬番 馬名              確率    LR確率  RF確率  直近  会場');
      console.log('-'.repeat(70));

      predictions.forEach((p, i) => {
        const rank = i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
        const num = p.horseNumber?.toString().padStart(2) || '--';
        const name = p.horseName.padEnd(14);
        const prob = (p.probability * 100).toFixed(1).padStart(5);
        const lr = (p.logisticProb * 100).toFixed(0).padStart(4);
        const rf = (p.rfProb * 100).toFixed(0).padStart(4);
        const recent = p.features.recentPerformanceScore.toFixed(0).padStart(4);
        const venue = p.features.venueAptitudeScore.toFixed(0).padStart(4);

        console.log(`${medal}${num} ${name} ${prob}%  ${lr}%  ${rf}%  ${recent}点  ${venue}点`);
      });

      // クロスチェック
      if (options.crossCheck) {
        const { CalculateScore } = await import('./commands/CalculateScore.js');
        const scoreCmd = new CalculateScore();
        // スコアリング結果を取得してクロスチェック
        // 注: CalculateScoreを実行せず、DBから直接取得する方が良い
      }

    } finally {
      ml.close();
    }
  });

program
  .command('import-json')
  .description('JSONファイルからデータをインポート')
  .argument('<file>', 'JSONファイルのパス')
  .action(async (file: string) => {
    const command = new ImportData();
    await command.importFromJSON(file);
  });

program
  .command('add-horse')
  .description('馬を手動で追加')
  .argument('<data>', 'JSON形式の馬データ')
  .action(async (data: string) => {
    const command = new ImportData();
    await command.addSingleHorse(data);
  });

program
  .command('import-url')
  .description('抽出されたJSONファイルをデータベースにインポート')
  .argument('<file>', '抽出されたJSONファイルのパス')
  .action(async (file: string) => {
    const command = new ImportData();
    await command.importExtractedJSON(file);
  });

program
  .command('show-horses')
  .description('登録馬一覧を血統情報付きで表示')
  .action(async () => {
    const command = new ImportData();
    await command.showHorses();
  });

program
  .command('show-sires')
  .description('種牡馬一覧と統計を表示')
  .action(async () => {
    const command = new ImportData();
    await command.showBloodlineStats();
  });

program
  .command('extract-html')
  .description('HTMLファイルから馬データを抽出して表示')
  .argument('<file>', 'HTMLファイルのパス')
  .action(async (file: string) => {
    const command = new ImportData();
    await command.extractHorseDataFromHTML(file);
  });

program
  .command('extract-html-only')
  .description('HTMLファイルから馬データを抽出（データベース不使用）')
  .argument('<file>', 'HTMLファイルのパス')
  .option('-f, --format <format>', '出力形式 (detailed|summary|csv)', 'detailed')
  .action(async (file: string, options: { format: 'detailed' | 'summary' | 'csv' }) => {
    const command = new ExtractData();
    await command.extractFromHTML(file, options.format);
  });

program
  .command('fetch-jra')
  .description('JRA URLからHTMLを取得')
  .argument('<url>', 'JRA URL')
  .option('-o, --output <file>', '出力ファイル', 'data/jra-page.html')
  .action(async (url: string, options: { output: string }) => {
    const { JRAFetcher } = await import('./utils/JRAFetcher.js');
    const result = await JRAFetcher.fetchAndSave(url, options.output);
    if (!result.success) {
      console.error('❌ 取得失敗:', result.error);
      process.exit(1);
    }
  });

program
  .command('fetch-and-extract')
  .description('JRA URLから取得して馬データを抽出（完全自動化）')
  .argument('<url>', 'JRA URL')
  .option('-f, --format <format>', '出力形式 (detailed|summary|csv)', 'detailed')
  .option('-o, --html-output <file>', 'HTML出力ファイル', 'data/jra-page.html')
  .action(async (url: string, options: { format: 'detailed' | 'summary' | 'csv'; htmlOutput: string }) => {
    const command = new ExtractData();
    await command.fetchAndExtract(url, options.format, options.htmlOutput);
  });

program
  .command('backtest')
  .description('過去レースでスコアリングの予測精度を検証')
  .option('-l, --limit <number>', '検証レース数の上限', parseInt)
  .option('-a, --all', '全レースを対象（デフォルトは重賞のみ）')
  .option('-v, --verbose', '各レースの詳細を表示')
  .action(async (options: { limit?: number; all?: boolean; verbose?: boolean }) => {
    const command = new Backtest();
    await command.execute({
      limit: options.limit,
      gradeOnly: !options.all,
      verbose: options.verbose
    });
  });

program
  .command('optimize-weights')
  .description('過去データから最適な重みを学習')
  .option('-l, --lambda <number>', '正則化パラメータ（デフォルト0.1）', parseFloat, 0.1)
  .option('-o, --output', '最適化重みをコード形式で出力')
  .action(async (options: { lambda: number; output?: boolean }) => {
    const { MachineLearningModel } = await import('./models/MachineLearningModel.js');
    const ml = new MachineLearningModel();

    try {
      const result = await ml.optimizeWeights(options.lambda);

      if (options.output && result.improvement > 0) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📝 最適化重み（ScoringConstants.ts用）');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(ml.getOptimizedWeightsAsConstants());
      }
    } finally {
      ml.close();
    }
  });

program.parse(process.argv);