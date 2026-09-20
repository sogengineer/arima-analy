/**
 * バックテスト結果の表示
 *
 * @remarks
 * Backtest から切り出した CLI 出力。集計済みの値を整形して出すだけ。
 */

import { SCORE_WEIGHTS } from '../../constants/ScoringConstants';
import { calculateElementContribution } from './summary';
import type { BacktestResult, BacktestSummary } from './types';

export function displayRaceResult(result: BacktestResult): void {
  console.log(`\n📍 ${result.raceName} (${result.raceDate} ${result.venue})`);
  console.log(`   1位的中: ${result.metrics.top1Hit ? '✅' : '❌'}`);
  console.log(`   上位3頭→3着内: ${result.metrics.top3Hit}/3`);
  console.log(`   順位相関: ${result.metrics.rankCorrelation.toFixed(2)}`);
}

export function displaySummary(summary: BacktestSummary): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📈 バックテスト結果サマリー');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`【対象レース数】${summary.totalRaces}件\n`);

  console.log('【的中率】');
  console.log(`  1位的中率:     ${(summary.top1Accuracy * 100).toFixed(1)}%`);
  console.log(`  上位3頭精度:   ${(summary.top3Accuracy * 100).toFixed(1)}%`);
  console.log(`  上位5頭精度:   ${(summary.top5Accuracy * 100).toFixed(1)}%`);
  console.log(`  平均順位相関:  ${summary.avgRankCorrelation.toFixed(3)}\n`);

  console.log('【回収率】（実オッズ。全馬に事前オッズが揃うレースのみ）');
  const win = summary.simulatedROI.winBet;
  if (win.bets === 0) {
    console.log('  ⚠️  算出不能（全馬に事前オッズが揃うレースが0件）');
    console.log('     ※ 結果ページ由来の確定オッズは1着馬ぶんしか無いため、');
    console.log('        それを使うと「的中レースだけを賭けた回収率」になる\n');
  } else {
    console.log(
      `  単勝1点（予測1位）: ${win.hits}/${win.bets}的中 → 回収率 ${(win.roi * 100).toFixed(1)}%\n`
    );
  }

  console.log('【市場ベースライン】（控除率補正済み暗黙確率）');
  const mb = summary.marketBaseline;
  if (mb.races === 0) {
    console.log('  ⚠️  市場データ（オッズ・人気）が無いため算出できません\n');
  } else {
    console.log(`  対象レース:        ${mb.races}件`);
    console.log(
      `  算出元:            単勝オッズ ${mb.oddsSourcedRaces}件 / 人気順位 ${mb.popularitySourcedRaces}件`
      + (mb.uniformSourcedRaces > 0 ? ` / 一様分布 ${mb.uniformSourcedRaces}件` : '')
    );
    if (mb.popularitySourcedRaces > 0) {
      console.log('    ※ 全馬のオッズが揃っていないレースは人気別勝率テーブルから算出');
    }
    console.log(`  最上位人気の勝率:  ${(mb.top1Accuracy * 100).toFixed(1)}%`);
    console.log(`  勝ち馬 log loss:   ${mb.logLoss.toFixed(4)}`);
    console.log(`  ルールベース log loss: ${summary.ruleLogLoss.toFixed(4)}`);
    console.log(
      `  → ルールベースは市場を ${summary.ruleLogLoss < mb.logLoss ? '上回る' : '下回る'}\n`
    );
  }

  console.log('【要素別予測寄与度】（正の相関 = 予測に有効）');
  summary.elementContribution.forEach((c, i) => {
    const bar = createCorrelationBar(c.correlation);
    const corr = c.correlation >= 0 ? '+' : '';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${c.name.padEnd(10)} ${bar} ${corr}${(c.correlation * 100).toFixed(1)}%`);
  });
}

function createCorrelationBar(correlation: number): string {
  const maxLen = 15;
  const len = Math.round(Math.abs(correlation) * maxLen);
  if (correlation >= 0) {
    return `${'░'.repeat(maxLen)}|${'█'.repeat(len)}${'░'.repeat(maxLen - len)}`;
  }
  return `${'░'.repeat(maxLen - len)}${'█'.repeat(len)}|${'░'.repeat(maxLen)}`;
}

export function suggestWeightImprovements(results: BacktestResult[]): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💡 重み改善提案');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const contributions = calculateElementContribution(results);

  // 現在の重み
  const currentWeights = [
    { name: '直近成績', weight: SCORE_WEIGHTS.recentPerformance },
    { name: 'コース適性', weight: SCORE_WEIGHTS.venueAptitude },
    { name: '距離適性', weight: SCORE_WEIGHTS.distanceAptitude },
    { name: '上がり3F', weight: SCORE_WEIGHTS.last3FAbility },
    { name: 'G1実績', weight: SCORE_WEIGHTS.g1Achievement },
    { name: 'ローテ適性', weight: SCORE_WEIGHTS.rotationAptitude },
    { name: '騎手能力', weight: SCORE_WEIGHTS.jockey },
    { name: '馬場適性', weight: SCORE_WEIGHTS.trackCondition },
    { name: '枠順効果', weight: SCORE_WEIGHTS.postPosition },
    { name: '調教師', weight: SCORE_WEIGHTS.trainer }
  ];

  console.log('要素          現在重み  寄与度   提案');
  console.log('-'.repeat(50));

  for (const cw of currentWeights) {
    const contribution = contributions.find(c => c.name === cw.name);
    const corr = contribution?.correlation ?? 0;
    const currentPct = (cw.weight * 100).toFixed(0).padStart(3);
    const corrPct = (corr * 100).toFixed(1).padStart(6);

    let suggestion = '';
    if (corr > 0.15 && cw.weight < 0.20) {
      suggestion = '↑ 増加推奨';
    } else if (corr < 0.05 && cw.weight > 0.08) {
      suggestion = '↓ 減少検討';
    } else {
      suggestion = '  適正';
    }

    console.log(`${cw.name.padEnd(10)} ${currentPct}%   ${corrPct}%  ${suggestion}`);
  }

  console.log('\n※ Phase3で自動最適化を実行できます');
}
