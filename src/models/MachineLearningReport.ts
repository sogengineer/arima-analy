/**
 * 機械学習モデルの CLI 表示
 *
 * @remarks
 * 数値は呼び出し側で確定済み。ここでは整形して console へ出すだけ。
 */

import type {
  AdoptionGate,
  CalibrationBin,
  ModelStats,
  PredictionResult,
  WalkForwardBlock,
  WalkForwardResult
} from './MachineLearningTypes';

/** 比較表の1行（ML / 市場のみモデル / 人気別勝率表 / ルールベース） */
type ComparisonRow = [number, number, number, number];

/** 重み差の方向を表す矢印 */
function weightDiffArrow(diff: number): string {
  if (diff > 0.02) return '↑';
  if (diff < -0.02) return '↓';
  return ' ';
}

export function printTrainingResults(stats: ModelStats | null): void {
  if (!stats?.win || !stats.show) return;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📈 モデル訓練結果');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('【収束】');
  console.log(
    `  単勝モデル: ${stats.win.iterations}反復 / ${stats.win.converged ? '収束' : '打ち切り'} / loss ${stats.win.finalLoss.toFixed(4)}`
  );
  console.log(
    `  複勝モデル: ${stats.show.iterations}反復 / ${stats.show.converged ? '収束' : '打ち切り'} / loss ${stats.show.finalLoss.toFixed(4)}\n`
  );

  if (stats.inSample) {
    console.log('【in-sample 参考値】※ 汎化性能ではない。ml --validate を参照');
    console.log(`  勝ち馬 log loss: ${stats.inSample.logLoss.toFixed(4)}`);
    console.log(`  top-1 的中率:    ${(stats.inSample.top1Accuracy * 100).toFixed(1)}%\n`);
  }

  console.log('【特徴量寄与度（標準化係数）】');
  stats.featureImportance.slice(0, 12).forEach((f, i) => {
    const bar = '█'.repeat(Math.max(0, Math.round(f.value * 60)));
    console.log(
      `  ${(i + 1).toString().padStart(2)}. ${f.name.padEnd(14)} ${bar} ${(f.value * 100).toFixed(1)}%`
    );
  });
  console.log('');
}

/** walk-forward の結果を表示 */
export function printWalkForward(result: WalkForwardResult): void {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 walk-forward 検証（時系列ブロック・シャッフルなし）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (result.insufficientReason) {
    console.log(`⚠️  ${result.insufficientReason}`);
    return;
  }

  displayBlockTable(result.blocks);
  displayBaselineComparison(result);
  displayCalibrationTable(result.calibration);
  printGate(result.gate);
}

/** ブロック別の指標を表示 */
function displayBlockTable(blocks: WalkForwardBlock[]): void {
  console.log('【ブロック別】');
  console.log('ブロック  期間                    学習  検証  logloss  top1');
  console.log('-'.repeat(66));
  for (const b of blocks) {
    console.log(
      `  ${b.block.toString().padStart(2)}    ${b.from}〜${b.to}  ${b.trainRaces
        .toString()
        .padStart(4)}  ${b.testRaces.toString().padStart(4)}  ${b.metrics.logLoss
        .toFixed(4)
        .padStart(7)}  ${(b.metrics.top1Accuracy * 100).toFixed(1).padStart(5)}%`
    );
  }
}

/** 総合指標と3種のベースラインの比較表を表示 */
function displayBaselineComparison(result: WalkForwardResult): void {
  console.log('\n【総合 vs ベースライン】');
  const src = result.marketSourceCounts;
  console.log(
    `  ※ 人気別勝率テーブルの算出元: 単勝オッズ ${src.odds} レース / 人気順位 ${src.popularity} レース`
    + (src.uniform > 0 ? ` / 一様分布 ${src.uniform} レース` : '')
  );
  console.log('指標              ML      市場のみモデル  人気別勝率表  ルールベース');
  console.log('-'.repeat(70));
  const row = (name: string, values: ComparisonRow, digits = 4) =>
    console.log(
      `${name.padEnd(16)} ${values[0].toFixed(digits).padStart(8)}  ${values[1]
        .toFixed(digits)
        .padStart(12)}  ${values[2].toFixed(digits).padStart(12)}  ${values[3]
        .toFixed(digits)
        .padStart(12)}`
    );
  const ov = result.overall;
  const mm = result.marketModelBaseline;
  const mt = result.marketBaseline;
  const rb = result.ruleBaseline;
  row('log loss(勝馬)', [ov.logLoss, mm.logLoss, mt.logLoss, rb.logLoss]);
  row('Brier', [ov.brier, mm.brier, mt.brier, rb.brier]);
  row('複勝 log loss', [ov.showLogLoss, mm.showLogLoss, mt.showLogLoss, rb.showLogLoss]);
  row('top-1 的中率', [ov.top1Accuracy, mm.top1Accuracy, mt.top1Accuracy, rb.top1Accuracy], 3);
  row('top-3 再現率', [ov.top3Recall, mm.top3Recall, mt.top3Recall, rb.top3Recall], 3);
  row('Spearman', [ov.spearman, mm.spearman, mt.spearman, rb.spearman], 3);
  row('単勝回収率', [ov.winRoi, mm.winRoi, mt.winRoi, rb.winRoi], 3);
  console.log(
    '\n  ※ 「市場のみモデル」= 人気・オッズ系特徴量だけを使って同じ手続きで学習した同型モデル'
  );
  console.log(
    '     「人気別勝率表」= 人気順位を固定テーブルで確率化したもの（全馬オッズありならオッズ）'
  );
  if (result.overall.roiRaces === 0) {
    console.log(
      '  ※ 回収率は **算出不能**（全馬に事前オッズが揃うレースが0件）。表の回収率0は「0%」ではない'
    );
    return;
  }
  console.log(
    `  ※ 回収率は全馬に事前オッズが揃う ${result.overall.roiRaces} レースのみで算出（固定オッズ仮定は使わない）`
  );
}

/** 単勝確率の較正テーブルを表示 */
function displayCalibrationTable(calibration: CalibrationBin[]): void {
  console.log('\n【較正テーブル（単勝確率）】');
  console.log('予測区間        件数   平均予測   実績勝率');
  console.log('-'.repeat(46));
  for (const bin of calibration) {
    if (bin.count === 0) continue;
    console.log(
      `${bin.from.toFixed(1)}〜${bin.to.toFixed(1)}    ${bin.count
        .toString()
        .padStart(6)}   ${(bin.avgPredicted * 100).toFixed(1).padStart(7)}%  ${(
        bin.actualRate * 100
      )
        .toFixed(1)
        .padStart(8)}%`
    );
  }
}

/** 採用ゲートの判定を表示 */
export function printGate(gate: AdoptionGate): void {
  console.log('\n【採用ゲート】');
  console.log(
    `  ① log loss < 市場特徴量のみモデル: ${gate.beatsMarketLogLoss ? '✅' : '❌'} (ML ${gate.mlLogLoss.toFixed(4)} vs 市場のみモデル ${gate.marketLogLoss.toFixed(4)})`
  );
  console.log(
    `     ※ 参考: 人気別勝率テーブル ${gate.popularityTableLogLoss.toFixed(4)}（固定表なので判定には使わない）`
  );
  console.log(
    `  ② top-1 > ルールベース:  ${gate.beatsRuleTop1 ? '✅' : '❌'} (ML ${(gate.mlTop1 * 100).toFixed(1)}% vs ルール ${(gate.ruleTop1 * 100).toFixed(1)}%)`
  );
  if (gate.passed) {
    console.log('\n  ✅ 判定: ML予測を主軸にしてよい');
  } else {
    console.log('\n  ❌ 判定: ML予測はまだ主軸にしない');
    console.log('     → race-list などの表示では **ルールベース10要素を主** とし、');
    console.log('        ML確率は参考値として併記すること');
  }
}

/** 射影結果を表示 */
export function printProjectionResults(
  comparison: { name: string; current: number; optimized: number; diff: number }[],
  improvement: number
): void {
  console.log('【重み比較（説明用）】');
  console.log('要素          現在    射影     変化');
  console.log('-'.repeat(45));

  for (const c of comparison) {
    const current = (c.current * 100).toFixed(1).padStart(5);
    const optimized = (c.optimized * 100).toFixed(1).padStart(5);
    const sign = c.diff >= 0 ? '+' : '';
    const arrow = weightDiffArrow(c.diff);
    console.log(
      `${c.name.padEnd(10)} ${current}%  ${optimized}%  ${arrow} ${sign}${(c.diff * 100).toFixed(1)}%`
    );
  }

  console.log(`\n📈 in-sample 誤差改善率: ${improvement.toFixed(1)}%`);
  console.log('※ in-sample の値なので、この数字を根拠に重みを差し替えないこと。');
}

/** スコアリング結果と ML 予測のクロスチェックを表示 */
export function printCrossCheck(
  mlPredictions: PredictionResult[],
  scoringResults: { horseId: number; totalScore: number }[]
): void {

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 スコアリング × 機械学習 クロスチェック');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('馬名              スコア順  ML順位  単勝確率  判定');
  console.log('-'.repeat(60));

  const scoreRanking = [...scoringResults]
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((s, i) => ({ ...s, scoreRank: i + 1 }));

  const mlRanking = mlPredictions.map((p, i) => ({ ...p, mlRank: i + 1 }));

  for (const score of scoreRanking) {
    const ml = mlRanking.find(m => m.horseId === score.horseId);
    if (!ml) continue;

    const name = ml.horseName.padEnd(14);
    const scoreRank = score.scoreRank.toString().padStart(2);
    const mlRank = ml.mlRank.toString().padStart(2);
    const prob = (ml.winProbability * 100).toFixed(1).padStart(5);

    const rankDiff = Math.abs(score.scoreRank - ml.mlRank);
    let judgment: string;
    if (rankDiff <= 1) {
      judgment = '✅ 一致';
    } else if (score.scoreRank <= 3 && ml.mlRank <= 3) {
      judgment = '⭕ 上位一致';
    } else if (rankDiff >= 5) {
      judgment = '⚠️  乖離大';
    } else {
      judgment = '△ やや乖離';
    }

    console.log(`${name} ${scoreRank}位     ${mlRank}位    ${prob}%  ${judgment}`);
  }

  console.log('\n【乖離馬の分析】');
  const divergent = scoreRanking.filter(s => {
    const ml = mlRanking.find(m => m.horseId === s.horseId);
    return ml && Math.abs(s.scoreRank - ml.mlRank) >= 4;
  });

  if (divergent.length === 0) {
    console.log('  大きな乖離はありません。両モデルの評価は概ね一致しています。');
    return;
  }

  for (const s of divergent) {
    const ml = mlRanking.find(m => m.horseId === s.horseId);
    if (!ml) continue;
    console.log(`\n  ${ml.horseName}:`);
    console.log(`    スコア順位: ${s.scoreRank}位 / ML順位: ${ml.mlRank}位`);
    console.log(`    市場暗黙勝率: ${(ml.marketImpliedProb * 100).toFixed(1)}%`);
    console.log(`    直近成績: ${ml.features.ruleScores.recentPerformanceScore.toFixed(0)}点`);
    console.log(`    G1実績: ${ml.features.ruleScores.g1AchievementScore.toFixed(0)}点`);
  }
}
