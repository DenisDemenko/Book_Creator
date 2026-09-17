/**
 * Тести чистих формул «Емоційна майстерність письменника»
 * (server/emotionMasteryScoring.ts) — 1:1 порт Python-специфікації
 * власника. Той самий прецедент, що й test-readerResponse.mts.
 * Запуск: npm run test:emotion-mastery-scoring
 */
import {
  MASTERY_CRITERIA,
  MASTERY_WEIGHTS,
  validateMasteryScores,
  computeMasteryScore,
  masteryLevelUk,
  clampIntensity,
  clampThresholdImpact,
  clampConfidence,
  clampProbability,
  confidenceLevelUk,
  type MasteryScores,
} from '../server/emotionMasteryScoring.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nВаги критеріїв:');
{
  const sum = MASTERY_CRITERIA.reduce((a, k) => a + MASTERY_WEIGHTS[k], 0);
  t('10 критеріїв', MASTERY_CRITERIA.length === 10);
  t('сума ваг дорівнює 1.0', Math.abs(sum - 1) < 1e-9, String(sum));
  t('кожна вага позитивна', MASTERY_CRITERIA.every((k) => MASTERY_WEIGHTS[k] > 0));
}

console.log('\nvalidateMasteryScores — затискання, а не виняток:');
{
  const v = validateMasteryScores({ trigger: 15, stakes: -3, body: 'сміття' as any });
  t('надмірне значення затискається до 10', v.trigger === 10);
  t('від\'ємне значення затискається до 0', v.stakes === 0);
  t('нечислове значення падає до 0', v.body === 0);
  t('відсутнє поле падає до 0', v.dynamics === 0);
  t('не кидає виняток на null', (() => { try { validateMasteryScores(null); return true; } catch { return false; } })());
}

console.log('\ncomputeMasteryScore:');
{
  const zero: MasteryScores = Object.fromEntries(MASTERY_CRITERIA.map((k) => [k, 0])) as MasteryScores;
  t('усі нулі дають 0', computeMasteryScore(zero) === 0);

  const max: MasteryScores = Object.fromEntries(MASTERY_CRITERIA.map((k) => [k, 10])) as MasteryScores;
  t('усі максимальні дають 100', computeMasteryScore(max) === 100);

  const half: MasteryScores = Object.fromEntries(MASTERY_CRITERIA.map((k) => [k, 5])) as MasteryScores;
  t('усі по 5 дають 50', computeMasteryScore(half) === 50);

  // Лише stakes (вага 0.12) на максимумі: 10 * 0.12 * 10 = 12.
  const onlyStakes: MasteryScores = Object.fromEntries(MASTERY_CRITERIA.map((k) => [k, k === 'stakes' ? 10 : 0])) as MasteryScores;
  t('окремий критерій дає внесок за своєю вагою', computeMasteryScore(onlyStakes) === 12, String(computeMasteryScore(onlyStakes)));
}

console.log('\nmasteryLevelUk — пороги 20/40/60/75/90:');
{
  t('0 → дуже слабко', masteryLevelUk(0) === 'дуже слабко');
  t('20 → дуже слабко (межа включно)', masteryLevelUk(20) === 'дуже слабко');
  t('21 → слабко', masteryLevelUk(21) === 'слабко');
  t('60 → базовий рівень', masteryLevelUk(60) === 'базовий рівень');
  t('75 → добре', masteryLevelUk(75) === 'добре');
  t('90 → дуже добре', masteryLevelUk(90) === 'дуже добре');
  t('91 → майстерно', masteryLevelUk(91) === 'майстерно');
  t('100 → майстерно', masteryLevelUk(100) === 'майстерно');
}

console.log('\nЗатискачі меж (п. 8 ТЗ):');
{
  t('intensity затискається 0..10', clampIntensity(15) === 10 && clampIntensity(-5) === 0);
  t('thresholdImpact затискається 0..10', clampThresholdImpact(11) === 10);
  t('confidence затискається 0..1', clampConfidence(2) === 1 && clampConfidence(-1) === 0);
  t('probability затискається 0..1', clampProbability(1.5) === 1);
}

console.log('\nconfidenceLevelUk — пороги 0.49/0.74/0.89:');
{
  t('0.3 → низька', confidenceLevelUk(0.3) === 'низька');
  t('0.49 → низька (межа включно)', confidenceLevelUk(0.49) === 'низька');
  t('0.5 → середня', confidenceLevelUk(0.5) === 'середня');
  t('0.75 → висока', confidenceLevelUk(0.75) === 'висока');
  t('0.9 → дуже висока', confidenceLevelUk(0.9) === 'дуже висока');
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
