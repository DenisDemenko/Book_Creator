/**
 * `npm run test:seller-gate` — правило «продавцем стає лише той, хто придбав
 * платну підписку» (рішення власника 28.09.2026).
 *
 * Перевіряються чисті функції `server/sellerGate.ts`: саме вони вирішують, чи
 * можна схвалювати заявку, і саме вони стоять між кнопкою «Схвалити» та
 * грошима платформи на генерації зображень і тексти ШІ.
 *
 * Нічого не запускає й нікуди не пише: ані бази, ані мережі.
 */

import {
  MIN_SELLER_PLAN,
  isPaidPlan,
  planLabel,
  sellerGateRefusal,
} from '../server/sellerGate';

let pass = 0;
let fail = 0;

function t(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nПорогом узято найдешевший платний тариф:');
t('мінімальний тариф — start', MIN_SELLER_PLAN === 'start', MIN_SELLER_PLAN);
t('безкоштовний тариф не куплений і не рахується', isPaidPlan('free') === false);
t('Start рахується платним', isPaidPlan('start'));
t('Pro і Ultra теж (вони включають мінімум)', isPaidPlan('pro') && isPaidPlan('ultra'));

console.log('\nСміття не проходить як підписка:');
t('невідомий тариф не платний', isPaidPlan('enterprise') === false);
t('null — не платний', isPaidPlan(null) === false);
t('undefined — не платний', isPaidPlan(undefined) === false);
t('порожній рядок — не платний', isPaidPlan('') === false);

console.log('\nНазви тарифів читаються, а невідоме читається як безкоштовний:');
t('free → «Безкоштовний»', planLabel('free') === 'Безкоштовний', planLabel('free'));
t('pro → «Pro»', planLabel('pro') === 'Pro', planLabel('pro'));
t('сміття → «Безкоштовний»', planLabel('nonsense') === 'Безкоштовний', planLabel('nonsense'));
t('null → «Безкоштовний»', planLabel(null) === 'Безкоштовний', planLabel(null));

console.log('\nРішення про заявку:');
t('з Pro — заперечень немає', sellerGateRefusal('pro', 'a@b.c') === null);
t('із Start теж', sellerGateRefusal('start', 'a@b.c') === null);

const onFree = sellerGateRefusal('free', 'd@example.com');
t('на безкоштовному — відмова', typeof onFree === 'string');
t('відмова називає пошту', String(onFree).includes('d@example.com'), String(onFree));
t('відмова називає вимогу й мінімум', String(onFree).includes('Start'), String(onFree));
t('відмова називає поточний тариф', String(onFree).includes('Безкоштовний'), String(onFree));

const noAccount = sellerGateRefusal(null, 'n@example.com');
t('без облікового запису в Студії — відмова', typeof noAccount === 'string');
t('і причина саме така: акаунта немає, отже й підписки',
  String(noAccount).includes('облікового запису'), String(noAccount));

const anonym = sellerGateRefusal('free', null);
t('без пошти відмова теж є', typeof anonym === 'string', String(anonym));
t('і не мовчить про причину', String(anonym).includes('Start'), String(anonym));

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
