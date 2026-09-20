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
import { RebuildStats } from './commands/RebuildStats';

/**
 * 順位に対応するメダル表記を返す（4位以降は空白）
 */
function rankMedal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '  ';
}

const program = new Command();

program
  .name('arima')
  .description('有馬記念分析システム（手動データ入力対応版）')
  .version('1.0.0');

program
  .command('rebuild-stats')
  .description('保存済みレース結果から馬場別・コース別成績を全件置換し、結果由来の単勝オッズ混入をクリア')
  .action(() => {
    new RebuildStats().execute();
  });

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
  .description('ML確率（単勝・複勝）と市場との妙味を表示')
  .option('-r, --race <id>', '対象レースID（数値またはレース名）')
  .action(async (options: { race?: string }) => {
    const command = new Predict();
    await command.execute(options);
  });

program
  .command('ml')
  .description('機械学習予測（L2ロジスティック回帰 + レース内softmax）')
  .option('-r, --race <id>', '対象レースID')
  .option('-t, --train', 'モデルを訓練のみ実行')
  .option('-c, --cross-check', 'スコアリング結果とクロスチェック')
  .option('-V, --validate', 'walk-forward 検証と採用ゲート判定を実行')
  .option('-b, --blocks <number>', 'walk-forward の分割数', parseInt, 5)
  .option(
    '-m, --min-train <number>',
    '検証ブロックを開始するのに必要な最小学習レース数（少データでの不安定なブロックを除外）',
    parseInt
  )
  .action(async (options: {
    race?: string;
    train?: boolean;
    crossCheck?: boolean;
    validate?: boolean;
    blocks?: number;
    minTrain?: number;
  }) => {
    const { MachineLearningModel } = await import('./models/MachineLearningModel');
    const { DatabaseConnection } = await import('./database/DatabaseConnection');
    const { StatsQueryRepository } = await import('./repositories/queries/StatsQueryRepository');

    const connection = new DatabaseConnection();
    const db = connection.getConnection();
    const ml = new MachineLearningModel(db);

    try {
      // walk-forward 検証（採用ゲート判定）
      if (options.validate) {
        const result = ml.walkForwardValidate({
          blocks: options.blocks ?? 5,
          minTrainRaces: options.minTrain
        });
        ml.displayWalkForward(result);
        return;
      }

      if (options.train) {
        await ml.trainModels();
        console.log('✅ モデル訓練完了');
        return;
      }

      if (!options.race) {
        console.log('⚠️  レースIDを指定してください: --race <id>');
        console.log('   レース一覧: arima score --list');
        return;
      }

      const raceId = parseInt(options.race, 10);
      if (Number.isNaN(raceId)) {
        console.log('❌ 無効なレースID');
        return;
      }

      // 予測実行
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🤖 機械学習予測結果');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const predictions = await ml.predict(raceId);

      if (predictions.length === 0) {
        console.log('⚠️  予測対象の出走馬が見つかりません');
        return;
      }

      if (!ml.isTrained()) {
        console.log('⚠️  モデル未学習のため、市場オッズの暗黙確率をそのまま表示します\n');
      }

      console.log('馬番 馬名              単勝    複勝    市場    ルール');
      console.log('-'.repeat(62));

      predictions.forEach((p, i) => {
        const medal = rankMedal(i + 1);
        const num = p.horseNumber?.toString().padStart(2) || '--';
        const name = p.horseName.padEnd(14);
        const win = (p.winProbability * 100).toFixed(1).padStart(5);
        const show = (p.showProbability * 100).toFixed(1).padStart(5);
        const market = (p.marketImpliedProb * 100).toFixed(1).padStart(5);
        const rule = p.ruleTotalScore.toFixed(0).padStart(4);

        console.log(`${medal}${num} ${name} ${win}%  ${show}%  ${market}%  ${rule}点`);
      });

      console.log('\n※ 単勝はレース内合計100%、複勝は合計300%（3着以内が3頭）に較正済み');
      console.log('※ 予測時点は「発売締切直前」（人気・オッズを特徴量に使うため）。');
      console.log('   ML と市場の差は独立な評価差ではなく、モデルが推定した市場の誤差');
      console.log('※ ML を主軸にしてよいかは `arima ml --validate` の採用ゲートで確認すること');

      // クロスチェック（保存済みスコアリング結果とML予測を比較）
      if (options.crossCheck) {
        const statsRepo = new StatsQueryRepository(db);
        const savedScores = statsRepo.getHorseScoresForRace(raceId);

        if (savedScores.length === 0) {
          console.log('\n⚠️  スコアリング結果が未保存です。先に `arima score --race <id>` を実行してください');
        } else {
          await ml.crossCheckWithScoring(
            raceId,
            savedScores.map(s => ({ horseId: s.horse_id, totalScore: s.total_score ?? 0 }))
          );
        }
      }

    } finally {
      ml.close();
      connection.close();
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
    const { JRAFetcher } = await import('./utils/JRAFetcher');
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
  .description('過去レースで予測精度を検証（as-of評価・実オッズ回収率・市場ベースライン）')
  .option('-l, --limit <number>', '検証レース数の上限', parseInt)
  .option('-a, --all', '全レースを対象（デフォルトは重賞のみ）')
  .option('-v, --verbose', '各レースの詳細を表示')
  .option('-m, --ml', 'MLのwalk-forward検証と採用ゲート判定も実行')
  .option('-b, --blocks <number>', 'walk-forward の分割数', parseInt, 5)
  .action(async (options: {
    limit?: number;
    all?: boolean;
    verbose?: boolean;
    ml?: boolean;
    blocks?: number;
  }) => {
    const command = new Backtest();
    await command.execute({
      limit: options.limit,
      gradeOnly: !options.all,
      verbose: options.verbose,
      ml: options.ml,
      blocks: options.blocks
    });
  });

program
  .command('optimize-weights')
  .description('【非推奨】ルールベース重みの説明用射影（予測には使わない。ml --validate を参照）')
  .option('-l, --lambda <number>', '正則化パラメータ（デフォルト0.1）', parseFloat, 0.1)
  .option('-o, --output', '射影した重みをコード形式で出力')
  .action(async (options: { lambda: number; output?: boolean }) => {
    const { MachineLearningModel } = await import('./models/MachineLearningModel');
    const ml = new MachineLearningModel();

    try {
      const result = await ml.optimizeWeights(options.lambda);

      if (options.output && result.improvement > 0) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📝 射影した重み（参考値・そのまま採用しないこと）');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(ml.getOptimizedWeightsAsConstants());
      }
    } finally {
      ml.close();
    }
  });

program
  .command('data-status')
  .description('蓄積データの棚卸し（レース数・出走行数・結果件数・主要特徴量のnull率・期間）')
  .action(async () => {
    const { DataStatus } = await import('./commands/DataStatus');
    const command = new DataStatus();
    await command.execute();
  });

program.parse(process.argv);
