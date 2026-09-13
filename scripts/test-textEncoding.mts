/**
 * Тести визначення кодування текстового файлу (src/utils/textEncoding.ts).
 * Запуск: npm run test:text-encoding
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Майстер «Перенесення книги з іншого сервісу» раніше
 * читав .txt через FileReader.readAsText без параметра — тобто все як UTF-8.
 * Файл у Windows-1251 / KOI8-U / KOI8-R перетворювався на «@@@@@...».
 * Тут перевіряємо, що кожне поширене кодування розпізнається і декодується
 * в читабельний український / російський / англійський текст.
 */
import assert from 'node:assert/strict';
import { decodeTextBuffer } from '../src/utils/textEncoding.ts';

let passed = 0;
let failed = 0;
function t(name: string, ok: boolean, extra?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

/** Будує зворотну карту «символ → байт» для однобайтового кодування. */
function buildReverseMap(encoding: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let b = 0; b <= 255; b++) {
    const ch = new TextDecoder(encoding).decode(new Uint8Array([b]));
    if (ch.length === 1) map.set(ch, b);
  }
  return map;
}

/** Кодує рядок у задане однобайтове кодування (для побудови тестових байтів). */
function encodeWith(encoding: string, text: string): Uint8Array {
  const map = buildReverseMap(encoding);
  const out: number[] = [];
  for (const ch of text) {
    const b = map.get(ch);
    if (b === undefined) throw new Error(`Немає байта для «${ch}» у ${encoding}`);
    out.push(b);
  }
  return new Uint8Array(out);
}

const RU = 'Самоучитель для Архата. Это первая глава рукописи, проверка кодировки файла.';
const UK = 'Самоучитель для Архата. Це перший розділ рукопису, перевірка кодування файлу. І її є.';
const EN = 'The path of the Arhat for dummies. This is the first chapter of the manuscript.';

function main() {
  console.log('\nВизначення кодування — тексти з літерами та пробілами:');

  // 1. UTF-8 без BOM
  {
    const bytes = new TextEncoder().encode(UK);
    const r = decodeTextBuffer(bytes);
    t('UTF-8 без BOM розпізнається', r.encoding.startsWith('UTF-8'), r.encoding);
    t('UTF-8 текст не пошкоджено', r.text === UK, r.text.slice(0, 40));
  }

  // 2. UTF-8 з BOM
  {
    const body = new TextEncoder().encode(RU);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
    const r = decodeTextBuffer(bytes);
    t('UTF-8 з BOM розпізнається', r.encoding.includes('BOM'), r.encoding);
    t('BOM не потрапляє в текст', r.text === RU && !r.text.startsWith('\uFEFF'));
  }

  // 3. Windows-1251 (ANSI кирилиця) — російська
  {
    const bytes = encodeWith('windows-1251', RU);
    const r = decodeTextBuffer(bytes);
    t('Windows-1251 (рос.) розпізнається', r.encoding.includes('Windows-1251'), r.encoding);
    t('Windows-1251 (рос.) текст не пошкоджено', r.text === RU, r.text.slice(0, 40));
  }

  // 4. Windows-1251 (ANSI кирилиця) — українська
  {
    const bytes = encodeWith('windows-1251', UK);
    const r = decodeTextBuffer(bytes);
    t('Windows-1251 (укр.) розпізнається', r.encoding.includes('Windows-1251'), r.encoding);
    t('Windows-1251 (укр.) текст не пошкоджено', r.text === UK, r.text.slice(0, 40));
  }

  // 5. KOI8-R — російська
  {
    const bytes = encodeWith('koi8-r', RU);
    const r = decodeTextBuffer(bytes);
    t('KOI8-R (рос.) розпізнається', r.encoding.includes('KOI8-R'), r.encoding);
    t('KOI8-R (рос.) текст не пошкоджено', r.text === RU, r.text.slice(0, 40));
  }

  // 6. KOI8-U — українська
  {
    const bytes = encodeWith('koi8-u', UK);
    const r = decodeTextBuffer(bytes);
    t('KOI8-U (укр.) розпізнається', r.encoding.includes('KOI8-U'), r.encoding);
    t('KOI8-U (укр.) текст не пошкоджено', r.text === UK, r.text.slice(0, 40));
  }

  // 7. Windows-1252 — англійська з типографськими символами
  {
    const text = '“The path of the Arhat” — naïve reader’s manuscript.';
    const bytes = encodeWith('windows-1252', text);
    const r = decodeTextBuffer(bytes);
    t('Windows-1252 (англ.) текст читабельний', r.text === text, r.text.slice(0, 40));
  }

  // 8. Чистий ASCII — це і є UTF-8
  {
    const bytes = new TextEncoder().encode(EN);
    const r = decodeTextBuffer(bytes);
    t('ASCII/англ. розпізнається як UTF-8', r.encoding.startsWith('UTF-8'), r.encoding);
    t('ASCII текст не пошкоджено', r.text === EN);
  }

  // 9. UTF-16LE з BOM
  {
    const units: number[] = [];
    for (const ch of RU) {
      const cp = ch.codePointAt(0)!;
      units.push(cp & 0xff, (cp >> 8) & 0xff);
    }
    const bytes = new Uint8Array([0xff, 0xfe, ...units]);
    const r = decodeTextBuffer(bytes);
    t('UTF-16LE з BOM розпізнається', r.encoding.includes('UTF-16'), r.encoding);
    t('UTF-16LE текст не пошкоджено', r.text === RU, r.text.slice(0, 40));
  }

  // 10. Функція не кидає на порожньому масиві
  {
    const r = decodeTextBuffer(new Uint8Array(0));
    t('порожній файл декодується без помилки', typeof r.text === 'string');
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();
