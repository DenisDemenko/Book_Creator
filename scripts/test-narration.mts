/**
 * Тести озвучення (server/narration.ts, server/narrationStore.ts,
 * server/pricing.ts). Без мережі й без SQLite — лише чисті функції:
 * валідація перед викликом ElevenLabs і хешування кешу.
 * Запуск: npm run test:narration
 */
import { synthesizeNarration, NarrationError, NARRATION_MAX_CHARS, NARRATION_LANGS } from '../server/narration.ts';
import { narrationCacheKey } from '../server/narrationStore.ts';
import { priceForNarration, NARRATION_PRICING } from '../server/pricing.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

async function expectError(label: string, fn: () => Promise<unknown>, kind: string) {
  try {
    await fn();
    t(label, false, 'не кинуло помилку');
  } catch (err) {
    t(label, err instanceof NarrationError && err.kind === kind, err instanceof Error ? err.message : String(err));
  }
}

console.log('\nВалідація перед мережевим викликом:');
{
  await expectError('порожній текст → empty', () => synthesizeNarration('   ', 'uk', 'fake-key'), 'empty');
  await expectError('немає ключа → no_key', () => synthesizeNarration('Текст', 'uk', ''), 'no_key');
  await expectError(
    'задовгий фрагмент → too_long',
    () => synthesizeNarration('а'.repeat(NARRATION_MAX_CHARS + 1), 'uk', 'fake-key'),
    'too_long'
  );
  t('мови рівно дві — укр і англ', NARRATION_LANGS.length === 2 && NARRATION_LANGS.includes('uk') && NARRATION_LANGS.includes('en'));
}

console.log('\nХеш кешу (narrationCacheKey):');
{
  const a = narrationCacheKey('Привіт, світе.', 'uk', 'voice-1');
  const b = narrationCacheKey('Привіт, світе.', 'uk', 'voice-1');
  t('однаковий текст+мова+голос → однаковий ключ', a === b);

  const diffLang = narrationCacheKey('Привіт, світе.', 'en', 'voice-1');
  t('інша мова → інший ключ', a !== diffLang);

  const diffVoice = narrationCacheKey('Привіт, світе.', 'uk', 'voice-2');
  t('інший голос → інший ключ', a !== diffVoice);

  const diffText = narrationCacheKey('Привіт, світе!', 'uk', 'voice-1');
  t('інший текст (навіть на один символ) → інший ключ', a !== diffText);

  const trimmed = narrationCacheKey('  Привіт, світе.  ', 'uk', 'voice-1');
  t('пробіли з країв не впливають на ключ (той самий текст після редагування форматування)', a === trimmed);

  t('ключ — це sha256 у hex (64 символи)', /^[0-9a-f]{64}$/.test(a));
}

console.log('\nТариф (priceForNarration):');
{
  t('1000 символів коштують рівно тариф за 1000', priceForNarration(1000) === NARRATION_PRICING.perThousandCharsUsd);
  t('0 символів — 0 вартості', priceForNarration(0) === 0);
  t(
    '500 символів — половина тарифу',
    Math.abs(priceForNarration(500) - NARRATION_PRICING.perThousandCharsUsd / 2) < 1e-9
  );
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
