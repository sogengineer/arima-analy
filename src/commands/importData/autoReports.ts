/**
 * インポート直後に自動実行する精度チェックの表示
 *
 * @remarks
 * ImportData から切り出した表示処理。ここでの失敗はインポート全体を失敗させない。
 */

import type { Database } from 'bun:sqlite';
import { Backtest } from '@/commands/Backtest';
import { MachineLearningModel } from '@/models/MachineLearningModel';

/**
 * インポート後の自動バックテスト
 * 直近の重賞レースで予測精度をサマリー表示
 */
export function runAutoBacktest(db: Database): void {
  try {
    const backtest = new Backtest(db);
    const summary = backtest.runQuickSummary();

    if (summary && summary.totalRaces > 0) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 バックテスト自動実行（直近重賞10レース）');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  対象レース:   ${summary.totalRaces}件`);
      console.log(`  1位的中率:    ${(summary.top1Accuracy * 100).toFixed(1)}%`);
      console.log(`  上位3頭精度:  ${(summary.top3Accuracy * 100).toFixed(1)}%`);
      console.log(`  順位相関:     ${summary.avgCorrelation.toFixed(3)}`);
      console.log('');
      console.log('💡 詳細は `bun start backtest --verbose` で確認できます');
    }
  } catch {
    // バックテストのエラーはインポート全体を失敗させない
    console.warn('⚠️  バックテスト自動実行をスキップしました');
  }
}

/**
 * インポート後の自動重み最適化
 * 改善がある場合のみ結果を表示
 */
export function runAutoOptimizeWeights(db: Database): void {
  try {
    const ml = new MachineLearningModel(db);
    const result = ml.runQuickOptimization();

    if (result && result.dataCount >= 20) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔧 重み最適化チェック');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  学習データ:   ${result.dataCount}件`);

      if (result.improvement > 0) {
        console.log(`  予測改善:     +${result.improvement.toFixed(1)}%`);
        console.log('');
        console.log('💡 `bun start optimize-weights --output` で詳細確認');
      } else {
        console.log('  予測改善:     なし（現行重みが最適）');
      }
    }
  } catch {
    // 最適化のエラーはインポート全体を失敗させない
    console.warn('⚠️  重み最適化チェックをスキップしました');
  }
}
