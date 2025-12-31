#!/usr/bin/env node

import { Command } from 'commander';
import { HorsesCommand } from './commands/HorsesCommand';
import { JockeysCommand } from './commands/JockeysCommand';
import { PerformanceCommand } from './commands/PerformanceCommand';
import { TrackAnalysisCommand } from './commands/TrackAnalysisCommand';
import { CourseAnalysisCommand } from './commands/CourseAnalysisCommand';
import { ScoreCommand } from './commands/ScoreCommand';
import { PredictCommand } from './commands/PredictCommand';
import { ManualDataCommand } from './commands/ManualDataCommand';
import { StandaloneExtractCommand } from './commands/StandaloneExtractCommand.js';

const program = new Command();

program
  .name('arima')
  .description('有馬記念分析システム（手動データ入力対応版）')
  .version('1.0.0');

program
  .command('horses')
  .description('登録済み出走馬一覧表示と手動入力ガイド')
  .action(async () => {
    const command = new HorsesCommand();
    await command.execute();
  });

program
  .command('jockeys')
  .description('登録済み騎手一覧表示と手動入力ガイド')
  .action(async () => {
    const command = new JockeysCommand();
    await command.execute();
  });

program
  .command('performance')
  .description('登録済み戦績の分析表示')
  .argument('[horse_name]', '特定の馬の戦績のみ分析する場合の馬名')
  .action(async (horseName?: string) => {
    const command = new PerformanceCommand();
    await command.execute(horseName);
  });

program
  .command('track-analysis')
  .description('馬場状態別成績分析')
  .action(async () => {
    const command = new TrackAnalysisCommand();
    await command.execute();
  });

program
  .command('course-analysis')
  .description('中山2500m適性分析')
  .action(async () => {
    const command = new CourseAnalysisCommand();
    await command.execute();
  });

program
  .command('score')
  .description('スコアリングモデルで総合評価を算出')
  .option('-r, --race <id>', '対象レースID（数値またはレース名）')
  .option('-l, --list', '登録済みレース一覧を表示')
  .action(async (options: { race?: string; list?: boolean }) => {
    const command = new ScoreCommand();
    await command.execute(options);
  });

program
  .command('predict')
  .description('機械学習で連帯・3着内確率を予測（旧版）')
  .action(async () => {
    const command = new PredictCommand();
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

      console.log('馬番 馬名              確率    LR確率  RF確率  過去3走  前走順');
      console.log('-'.repeat(70));

      predictions.forEach((p, i) => {
        const rank = i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
        const num = p.horseNumber?.toString().padStart(2) || '--';
        const name = p.horseName.padEnd(14);
        const prob = (p.probability * 100).toFixed(1).padStart(5);
        const lr = (p.logisticProb * 100).toFixed(0).padStart(4);
        const rf = (p.rfProb * 100).toFixed(0).padStart(4);
        const dev = p.features.last3RacesDeviation.toFixed(1).padStart(5);
        const lastPos = p.features.lastRacePosition.toString().padStart(4);

        console.log(`${medal}${num} ${name} ${prob}%  ${lr}%  ${rf}%  ${dev}  ${lastPos}着`);
      });

      // クロスチェック
      if (options.crossCheck) {
        const { ScoreCommand } = await import('./commands/ScoreCommand.js');
        const scoreCmd = new ScoreCommand();
        // スコアリング結果を取得してクロスチェック
        // 注: ScoreCommandを実行せず、DBから直接取得する方が良い
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
    const command = new ManualDataCommand();
    await command.importFromJSON(file);
  });

program
  .command('add-horse')
  .description('馬を手動で追加')
  .argument('<data>', 'JSON形式の馬データ')
  .action(async (data: string) => {
    const command = new ManualDataCommand();
    await command.addSingleHorse(data);
  });

program
  .command('import-url')
  .description('抽出されたJSONファイルをデータベースにインポート')
  .argument('<file>', '抽出されたJSONファイルのパス')
  .action(async (file: string) => {
    const command = new ManualDataCommand();
    await command.importExtractedJSON(file);
  });

program
  .command('show-horses')
  .description('登録馬一覧を血統情報付きで表示')
  .action(async () => {
    const command = new ManualDataCommand();
    await command.showHorses();
  });

program
  .command('show-sires')
  .description('種牡馬一覧と統計を表示')
  .action(async () => {
    const command = new ManualDataCommand();
    await command.showBloodlineStats();
  });

program
  .command('extract-html')
  .description('HTMLファイルから馬データを抽出して表示')
  .argument('<file>', 'HTMLファイルのパス')
  .action(async (file: string) => {
    const command = new ManualDataCommand();
    await command.extractHorseDataFromHTML(file);
  });

program
  .command('extract-html-only')
  .description('HTMLファイルから馬データを抽出（データベース不使用）')
  .argument('<file>', 'HTMLファイルのパス')
  .option('-f, --format <format>', '出力形式 (detailed|summary|csv)', 'detailed')
  .action(async (file: string, options: { format: 'detailed' | 'summary' | 'csv' }) => {
    const command = new StandaloneExtractCommand();
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
    const command = new StandaloneExtractCommand();
    await command.fetchAndExtract(url, options.format, options.htmlOutput);
  });

program.parse(process.argv);