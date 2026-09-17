/**
 * Тести чистих формул «Поріг» (server/thresholdScoring.ts) — 1:1 порт
 * Python-специфікації власника (RiskProfile, Threshold.score()/
 * strength()/is_real_threshold()/feedback()). Той самий прецедент, що й
 * test-emotionMasteryScoring.mts.
 * Запуск: npm run test:threshold-scoring
 */
import {
  THRESHOLD_TYPES,
  validateRiskProfile,
  riskMaximum,
  riskAverage,
  riskStrongest,
  validateThresholdNumbers,
  thresholdScore,
  thresholdStrength,
  isRealThreshold,
  thresholdFeedback,
  thresholdEvidenceOutcome,
  validateAvoidedThreshold,
  AVOIDED_THRESHOLD_AREAS,
  type ThresholdCandidate,
} from '../server/thresholdScoring.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

function baseCandidate(overrides: Partial<ThresholdCandidate> = {}): ThresholdCandidate {
  return {
    title: 'Стрибок з даху',
    description: 'Герой стрибає, щоб врятувати друга.',
    types: ['physical'],
    beforeState: 'боїться висоти',
    choice: 'стрибнути попри страх',
    crossingAction: 'стрибає',
    afterState: 'подолав страх висоти',
    risks: { physical: 8, emotional: 6, social: 2, material: 1, existential: 3 },
    cost: 6,
    irreversibility: 7,
    transformation: 8,
    awareness: 8,
    agency: 9,
    ...overrides,
  };
}

console.log('\nRiskProfile:');
{
  const r = validateRiskProfile({ physical: 15, emotional: -3, social: 5 });
  t('надмірне значення затискається до 10', r.physical === 10);
  t('від\'ємне значення затискається до 1', r.emotional === 1);
  t('відсутнє поле падає до 1', r.material === 1);

  const risks = { physical: 3, emotional: 9, social: 2, material: 1, existential: 4 };
  t('riskMaximum знаходить найбільше', riskMaximum(risks) === 9);
  t('riskAverage рахує середнє', riskAverage(risks) === (3 + 9 + 2 + 1 + 4) / 5);
  t('riskStrongest повертає вісь із найбільшим значенням', riskStrongest(risks).name === 'emotional');
}

console.log('\nvalidateThresholdNumbers:');
{
  const v = validateThresholdNumbers({ cost: 15, irreversibility: -2 });
  t('cost затиснуто до 10', v.cost === 10);
  t('irreversibility затиснуто до 1', v.irreversibility === 1);
  t('awareness без значення падає до 5', v.awareness === 5);
  t('agency без значення падає до 5', v.agency === 5);
}

console.log('\nthresholdScore — формула 30/15/15/20/15/5:');
{
  const allTen: ThresholdCandidate = baseCandidate({
    risks: { physical: 10, emotional: 10, social: 10, material: 10, existential: 10 },
    cost: 10,
    irreversibility: 10,
    transformation: 10,
    agency: 10,
  });
  t('усі складові на максимумі дають рівно 10', thresholdScore(allTen) === 10, String(thresholdScore(allTen)));

  const allOne: ThresholdCandidate = baseCandidate({
    risks: { physical: 1, emotional: 1, social: 1, material: 1, existential: 1 },
    cost: 1,
    irreversibility: 1,
    transformation: 1,
    agency: 1,
  });
  t('усі складові на мінімумі дають рівно 1', thresholdScore(allOne) === 1, String(thresholdScore(allOne)));

  const s = thresholdScore(baseCandidate());
  t('проміжний кандидат дає число в межах 1..10', s >= 1 && s <= 10, String(s));
}

console.log('\nthresholdStrength — пороги 3/5/7/9:');
{
  t('score < 3 → слабкий', thresholdStrength(baseCandidate({
    risks: { physical: 1, emotional: 1, social: 1, material: 1, existential: 1 }, cost: 1, irreversibility: 1, transformation: 1, agency: 1,
  })) === 'слабкий');
  t('score рівно 10 → критичний / трансформаційний', thresholdStrength(baseCandidate({
    risks: { physical: 10, emotional: 10, social: 10, material: 10, existential: 10 }, cost: 10, irreversibility: 10, transformation: 10, agency: 10,
  })) === 'критичний / трансформаційний');
}

console.log('\nisRealThreshold — чотири незалежні умови:');
{
  t('повний кандидат — справжній поріг', isRealThreshold(baseCandidate()));
  t('без вибору (choice) — не поріг', !isRealThreshold(baseCandidate({ choice: '' })));
  t('однаковий стан до/після — не поріг', !isRealThreshold(baseCandidate({ beforeState: 'X', afterState: 'x' })));
  t('низька ціна й ризик — немає ставок, не поріг', !isRealThreshold(baseCandidate({
    cost: 1, risks: { physical: 1, emotional: 1, social: 1, material: 1, existential: 1 },
  })));
  t('низька незворотність — не поріг', !isRealThreshold(baseCandidate({ irreversibility: 2 })));
  t('високий cost компенсує низький ризик (hasStakes через cost)', isRealThreshold(baseCandidate({
    cost: 5, risks: { physical: 1, emotional: 1, social: 1, material: 1, existential: 1 },
  })));
}

console.log('\nthresholdFeedback:');
{
  const weak = baseCandidate({
    risks: { physical: 1, emotional: 1, social: 1, material: 1, existential: 1 },
    cost: 1, irreversibility: 1, transformation: 1, agency: 1, beforeState: 'X', afterState: 'X',
  });
  const fb = thresholdFeedback(weak);
  t('слабкий кандидат отримує кілька зауважень', fb.length > 1, String(fb.length));

  const strong = baseCandidate({
    risks: { physical: 10, emotional: 10, social: 10, material: 10, existential: 10 },
    cost: 10, irreversibility: 10, transformation: 10, agency: 10,
  });
  const fbStrong = thresholdFeedback(strong);
  t('сильний кандидат отримує єдине підтверджувальне зауваження', fbStrong.length === 1 && fbStrong[0].includes('чіткий вибір'));
}

console.log('\nthresholdEvidenceOutcome — розділ 6.4 архітектури:');
{
  const notReal = baseCandidate({ choice: '' });
  t('не справжній поріг — null (доказ не пишемо)', thresholdEvidenceOutcome(notReal) === null);

  const strong = baseCandidate({
    risks: { physical: 10, emotional: 10, social: 10, material: 10, existential: 10 },
    cost: 10, irreversibility: 10, transformation: 10, agency: 10,
  });
  const outcome = thresholdEvidenceOutcome(strong);
  t('справжній повний поріг дає позитивний outcome', outcome !== null && outcome! > 0, String(outcome));
  t('outcome у межах -1..1', outcome !== null && outcome! >= -1 && outcome! <= 1);

  const barelyReal = baseCandidate({ cost: 3, risks: { physical: 4, emotional: 1, social: 1, material: 1, existential: 1 }, irreversibility: 4, transformation: 1, agency: 1 });
  const outcomeBarely = thresholdEvidenceOutcome(barelyReal);
  t('ледь справжній поріг з багатьма зауваженнями дає слабший outcome', outcomeBarely !== null && outcomeBarely! < outcome!, `${outcomeBarely} vs ${outcome}`);
}

console.log('\nТипи порогу й область уникнення:');
{
  t('9 типів порогу', THRESHOLD_TYPES.length === 9);
  t('14 областей уникнення', AVOIDED_THRESHOLD_AREAS.length === 14);

  const av = validateAvoidedThreshold({ severity: 15, repetitions: 0 });
  t('severity затискається до 10', av.severity === 10);
  t('repetitions не може бути менше 1', av.repetitions === 1);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
