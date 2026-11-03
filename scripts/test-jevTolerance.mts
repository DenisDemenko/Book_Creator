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
  jevRateLine,
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

console.log('\nТариф до прогону:');
{
  const line = nbsp(jevRateLine({ creditsPerMillionTokens: 4000, unlimited: false, balance: 2000 }));
  t('називає тариф 4 000 балів за 1 млн токенів', line.includes('4 000 балів за 1 млн токенів'), line);
  t('типовий абзац: ≈ 2 600 токенів ≈ 11 балів (ceil 10,4)', line.includes('до ≈ 2 600 токенів ≈ 11 балів'));
  t('показує баланс', line.includes('На балансі: 2 000 балів'));
  t('повтор для тих самих абзаців безкоштовний — сказано', line.includes('Повтор для тих самих абзаців балів не коштує'));
  const adm = nbsp(jevRateLine({ creditsPerMillionTokens: 4000, unlimited: true, balance: null }));
  t('для адміністратора — «без списання», без балансу', adm.includes('Для вас без списання') && !adm.includes('На балансі'));
  t('нульовий тариф — прямо сказано', jevRateLine({ creditsPerMillionTokens: 0, unlimited: false, balance: 10 }).includes('без списання балів'));
  t('тарифу ще нема (не завантажено) — порожньо', jevRateLine(null) === '');
  const bal = (n: number) => nbsp(jevRateLine({ creditsPerMillionTokens: 4000, unlimited: false, balance: n }));
  t('1 і 21 — «бал», 11 — «балів»', bal(1).includes('1 бал.') && bal(21).includes('21 бал.') && bal(11).includes('11 балів.'));
  t('2–4 і 22–24 — «бали», 12–14 і 25 — «балів»', bal(2).includes('2 бали.') && bal(23).includes('23 бали.') && bal(12).includes('12 балів.') && bal(14).includes('14 балів.') && bal(25).includes('25 балів.'));
}

console.log('\nТекст після прогону:');
{
  const usage = { inputTokens: 24000, usd: 0.001008, usdPerMTok: 0.042, creditsPerMTok: 4000, creditsAtRate: 96, credits: 96, charged: true, capped: false };
  const note = nbsp(jevTariffNote(usage, 30, 0));
  t('називає тариф і собівартість', note.includes('Тариф Jev: 4 000 балів за 1 млн токенів') && note.includes('собівартість $0,042'), note.slice(0, 140));
  t('токени й гроші: 24 000 ≈ $0,0010', note.includes('24 000 токенів') && note.includes('$0,0010'));
  t('списано 96 балів', note.includes('Списано 96 балів з вашого гаманця'));
  t('питання до Jev названо, пам’яті нема', note.includes('30 питань до Jev') && !note.includes('із пам'));
  t('повтор не коштує балів — сказано', note.includes('не коштує балів'));
  t('не обіцяє «100 балів за книгу»', !note.includes('100 бал'));

  const cached = nbsp(jevTariffNote({ ...usage, inputTokens: 0, usd: 0, creditsAtRate: 0, credits: 0, charged: false }, 0, 12));
  t("повтор: 0 нових питань і 12 з пам'яті", cached.includes("0 нових питань до Jev і 12 відповідей із пам'яті"));
  t('повтор: балів не списано, бо звернень не було', cached.includes('Балів не списано: нових звернень до Jev не було'));
  t('повтор: витрачено 0 токенів', cached.includes('витрачено 0 токенів'));

  const admin = nbsp(jevTariffNote({ ...usage, credits: 0, charged: false }, 5, 0));
  t('адміністратор: без списання, а за тарифом було б 96', admin.includes('Для вас без списання') && admin.includes('за тарифом це було б 96 балів'));
  const capped = nbsp(jevTariffNote({ ...usage, capped: true }, 5, 0));
  t('витрата понад резерв названа', capped.includes('перевищила резерв'));
  const free = nbsp(jevTariffNote({ ...usage, creditsPerMTok: 0, creditsAtRate: 0, credits: 0, charged: false }, 5, 0));
  t('нульовий тариф: «без списання балів», без рядків про списання', free.startsWith('Jev зараз без списання балів') && !free.includes('Списано') && !free.includes('за тарифом'));
  t('без даних про використання — лише тариф', jevTariffNote(null, 0, 0).startsWith('Тариф Jev:') && !jevTariffNote(null, 0, 0).includes('токенів ≈'));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
