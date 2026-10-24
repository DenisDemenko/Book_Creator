/**
 * Як файловий транспорт DesignCraft РОЗБИРАЄ вивід CLI.
 * Запуск: npm run test:designcraft-decoding
 *
 * ЧОМУ ЦЕЙ ТЕСТ ІСНУЄ. Книга «Самоучитель для Архата» (16 глав, 42
 * ілюстрації, ~1 МБ кирилиці) верстався з 11 главами у змісті замість 16, і
 * то щоразу тими самими п'ятьма. Сесійний транспорт ту саму книгу складав
 * правильно. Причина виявилась не у верстці: `runCli` читав stdout без
 * `setEncoding`, тобто декодував КОЖЕН Buffer окремо. Чанк рветься на
 * довільному байті, і двобайтова кирилиця на межі ставала двома U+FFFD по
 * 3 байти. Текст лишався читним — тому це й не впадало в око, — але кожен
 * розрив додавав +4 байти до всіх наступних зсувів, а `story.replaceRange`
 * бере межі В БАЙТАХ. Вирізання маркера ілюстрації починало прихоплювати
 * абзацний розрив після нього; де далі стояв заголовок глави, той злипався
 * з абзацом ілюстрації, втрачав `Heading 1` і зникав зі змісту.
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Не «текст прочитався», а що БАЙТОВІ ЗСУВИ, обчислені з
 * прочитаного, збігаються з документом. Перевірка на U+FFFD — лише симптом;
 * тест порівнює саме зсуви, бо це те, чим користується рушій.
 *
 * ЧОГО ЦЕ НЕ ПОКРИВАЄ: що верстка з правильними зсувами дає правильний
 * зміст. Це доводить лише прогін справжньої книги справжнім бінарником
 * (`test-designcraftGateB.mts`).
 */
process.env.DATA_DIR ||= '/tmp/nova-designcraft-decoding-test';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function t(name: string, condition: boolean, details = ''): void {
  if (condition) pass += 1;
  else fail += 1;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${details ? ` — ${details}` : ''}`);
}

const { __runCliForTest } = await import('../server/pdf/engines/designcraftEngineV3');

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-designcraft-split-utf8.mjs');
const byteOffset = (text: string, chars: number) => Buffer.byteLength(text.slice(0, chars), 'utf8');

for (const splits of [1, 4]) {
  console.log(`\nВивід розірвано ${splits === 1 ? 'раз' : `${splits} рази`} посеред символу`);
  const out = await __runCliForTest(process.execPath, [FAKE, String(splits)]);
  t('CLI завершився успішно', out.code === 0, `код ${out.code}${out.stderr ? `, stderr: ${out.stderr.slice(0, 120)}` : ''}`);

  let report: any = null;
  try { report = JSON.parse(out.stdout); } catch (err) { /* нижче */ }
  t('звіт розібрався як JSON', report !== null, report ? '' : `${out.stdout.length} символів`);
  if (!report) continue;

  const text = String(report.results?.[0]?.text || '');
  t('жодного зіпсованого символу', !text.includes('\uFFFD'), `U+FFFD: ${(text.match(/\uFFFD/g) || []).length}`);

  // Те, чим користується рушій: зсув маркера ілюстрації в БАЙТАХ.
  const marker = '[[FLIMG:img1:BEGIN]]';
  const at = text.indexOf(marker);
  t('маркер ілюстрації знайдено', at >= 0);
  if (at < 0) continue;

  // Еталон: той самий текст, зібраний так само, як його будує підставний CLI.
  const expected = `Глава 1. Проба\n${'Земли и ее суеты, я нашел покой. '.repeat(400)}`;
  t(
    'байтовий зсув маркера збігається з документом',
    byteOffset(text, at) === Buffer.byteLength(expected, 'utf8'),
    `прочитано ${byteOffset(text, at)}, у документі ${Buffer.byteLength(expected, 'utf8')}`
  );
  t(
    'текст збігається з документом символ у символ',
    text === `${expected}[[FLIMG:img1:BEGIN]]
[[FLIMG:img1:END]]
Глава 2. Проба
`,
    `прочитано ${text.length} симв / ${Buffer.byteLength(text, 'utf8')} байт`
  );
  t('обидва заголовки на місці', text.includes('Глава 1. Проба') && text.includes('Глава 2. Проба'));
}

console.log(`\nПройдено ${pass}, провалено ${fail}`);
process.exit(fail ? 1 : 0);
