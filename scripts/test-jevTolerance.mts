/**
 * Толерантність Jev у панелі: що пропонується для повтору й що написано про гроші
 * (постановка власника 03.11.2026).
 *
 * ЧОМУ ТУТ ПЕРЕВІРЯЄТЬСЯ ТЕКСТ ПРО ВАРТІСТЬ. Він каже авторові, що з його гаманця
 * не знімається і скільки коштує прогін. Вигадане число або «знімається 100 балів»,
 * якого система не робить, гірше за відсутність пояснення.
 *
 * Запуск: npm run test:jev-tolerance
 */
import {
  JEV_TOLERANCE_DEFAULT,
  JEV_TOLERANCE_MAX,
  JEV_TOLERANCE_MIN,
  addableAt,
  clampTolerance,
  jevTariffNote,
  suggestRetryTolerance,
} from '../src/utils/jevTolerance.ts';
import { JEV_TAG_MAX_THRESHOLD, JEV_TAG_MIN_THRESHOLD, JEV_TAG_THRESHOLD } from '../server/core/ai/jevTags.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

console.log('\nМежі збігаються із сервером:');
{
  t('мінімум 70% = серверний 0,70', JEV_TOLERANCE_MIN / 100 === JEV_TAG_MIN_THRESHOLD);
  t('максимум 100% = серверний 1,00', JEV_TOLERANCE_MAX / 100 === JEV_TAG_MAX_THRESHOLD);
  t('типове 95% = серверне', JEV_TOLERANCE_DEFAULT / 100 === JEV_TAG_THRESHOLD);
  t('clamp підтискає 40 → 70 і 150 → 100', clampTolerance(40) === 70 && clampTolerance(150) === 100 && clampTolerance(88.4) === 88);
}

console.log('\nЩо дасть нижча толерантність:');
{
  const below = [0.94, 0.91, 0.9, 0.86, 0.72];
  t('за 90% — три (0,90 «не менше»)', addableAt(below, 90) === 3);
  t('за 85% — чотири', addableAt(below, 85) === 4);
  t('за 70% — усі п’ять', addableAt(below, 70) === 5);
  t('за 95% — жодної', addableAt(below, 95) === 0);
  t('порожній список — нуль', addableAt([], 70) === 0);
}

console.log('\nЗ якого відсотка почати повтор:');
{
  t('найпевніша непроставлена 0,94 → пропонується 94', suggestRetryTolerance([0.94, 0.8], 95) === 94);
  t('0,949 → 94, а не 95 (95 уже було)', suggestRetryTolerance([0.949], 95) === 94);
  t('завжди нижче за поточний поріг', suggestRetryTolerance([0.99], 95) === 94);
  t('не нижче за 70', suggestRetryTolerance([0.5], 80) === 70);
  t('із 71% — 70', suggestRetryTolerance([0.705], 71) === 70);
  t('без даних — на 5 нижче', suggestRetryTolerance([], 90) === 85);
}

console.log('\nТекст про вартість:');
{
  const usage = { inputTokens: 24000, usd: 0.001008, usdPerMTok: 0.042, creditsEquivalent: 2, charged: false };
  const note = nbsp(jevTariffNote(usage, 30, 0));
  t('називає ставку 0,042 $ за 1 млн токенів', note.includes('$0,042 за 1 млн вхідних токенів'), note.slice(0, 120));
  t('називає «мінімальною ставкою»', note.includes('мінімальною ставкою'));
  t('показує токени й суму в доларах', note.includes('24 000 токенів') && note.includes('$0,0010'));
  t('бали — лише еквівалент, і сказано, що з гаманця не знімаються', note.includes('≈ 2 бал. в еквіваленті') && note.includes('З вашого гаманця бали за Jev не знімаються'));
  t('сказано, що бали діють лише для зображень', note.includes('лише для зображень'));
  t('питання до Jev названо', note.includes('30 питань до Jev'));
  t('без відповідей із пам’яті — не вигадуємо їх', !note.includes('із пам'));

  const cached = nbsp(jevTariffNote({ ...usage, inputTokens: 0, usd: 0, creditsEquivalent: 0 }, 0, 12));
  t('повтор: 0 нових питань і 12 із пам’яті', cached.includes("0 нових питань до Jev і 12 відповідей із пам'яті"));
  t('повтор: витрачено 0 токенів', cached.includes('витрачено 0 токенів'));
  t('пояснення, що повтор для тих самих абзаців нових звернень не потребує', cached.includes('нових звернень не потребує'));

  const noCredits = nbsp(jevTariffNote({ ...usage, creditsEquivalent: null }, 5, 0));
  t('без курсу балів еквівалент не вигадується', !noCredits.includes('бал. в еквіваленті'));
  const charged = nbsp(jevTariffNote({ ...usage, charged: true }, 5, 0));
  t('якщо колись списуватимуть — фраза «не знімаються» зникає', !charged.includes('не знімаються'));
  t('без даних про використання — лише ставка', jevTariffNote(null, 0, 0).startsWith('Jev тарифікується за мінімальною ставкою') && !jevTariffNote(null, 0, 0).includes('токенів ≈'));
  t('жодного обіцяного «100 балів за книгу»', !note.includes('100 бал'));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
