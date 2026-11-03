/**
 * Фаза 0, пункти 0.2 і 0.4 на СПРАВЖНІЙ книзі — локально.
 *
 * ЧОМУ ОКРЕМИЙ СКРИПТ, А НЕ `gate-b-publish-arhat.mts`. Той бере книгу з
 * серверної бази (`listBooks`) і зберігає артефакти в неї ж. Локально бази з
 * цією книгою немає й бути не повинно: це чужі дані, їм не місце ні в
 * репозиторії, ні в робочій базі. Тут книга читається з файлу, нічого не
 * зберігається в базу, а на диск кладуться лише файли для розгляду.
 *
 * ЩО САМЕ МІРЯЄТЬСЯ:
 *   0.2 — PDF із `spec.pdfExport.tagged` увімкненим і вимкненим: скільки
 *         САМЕ коштує структурне дерево на книзі в 16 глав, а не на
 *         98-сторінковій (там було +64%, і це єдине число, яке є).
 *   0.4 — два EPUB поруч: верстковий (супутник рушія DesignCraft) і
 *         браузерний (`src/utils/fileExporters.ts`). Доки їх не порівняно,
 *         підстав заміняти наявний експорт немає.
 *
 * ІЛЮСТРАЦІЇ ПІДСТАВНІ, і це впливає на числа. Байти 42 картинок лежать на
 * сервері (`/api/media/file/…`) і локально недоступні; кожне посилання
 * замінено на `data:`-PNG. Для 0.2 це означає: АБСОЛЮТНИЙ приріст від
 * `tagged` справжній (дерево залежить від абзаців, не від картинок), а
 * ВІДСОТОК — завищений, бо база без справжніх картинок менша. Для 0.4
 * означає: порівнювати можна структуру й текст, не вигляд ілюстрацій.
 *
 * Запуск:
 *   npx tsx scripts/measure-arhat-phase0.mts <book.json> <out-dir>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const bookPath = process.argv[2];
const outDir = process.argv[3];
if (!bookPath || !outDir) {
  throw new Error('Треба: npx tsx scripts/measure-arhat-phase0.mts <book.json> <out-dir>');
}

/*
 * Бінарник задається ДО імпорту рушія: той читає DESIGNCRAFT_PATH на рівні
 * модуля (та сама пастка, через яку `test-designcraftExport.mts` падав із
 * «CLI не знайдено» — запис #477).
 */
if (!process.env.DESIGNCRAFT_PATH) {
  process.env.DESIGNCRAFT_PATH = 'D:/Rama/designcraft/target/release/designcraft-cli.exe';
}

const { designcraftEngineV3 } = await import('../server/pdf/engines/designcraftEngineV3');
const { specFromBook } = await import('../server/pdf/pdfFromBook');

/*
 * Підставний PNG будується КОДОМ, а не вставляється готовим base64.
 *
 * Чому. Першим прогоном тут стояв base64, набраний з голови: підпис PNG
 * правильний, а CRC чанка IDAT — ні. DesignCraft відкинув усі 42 картинки
 * («could not be decoded and was skipped»), прогін при цьому завершився
 * успішно, і PDF вийшов без жодної ілюстрації — тобто на 186 сторінок
 * замість 350, і це легко було видати за зміну верстки. Згенерований
 * чанк із порахованим CRC такої помилки не припускає.
 */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}

function placeholderPng(size = 8): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 біт на канал
  ihdr[9] = 2; // truecolor RGB
  // по рядку: байт фільтра + RGB на кожен піксель
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3, 0);
    for (let x = 0; x < size; x += 1) {
      row[1 + x * 3] = 0x99;
      row[2 + x * 3] = 0x99;
      row[3 + x * 3] = 0x99;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngBytes = placeholderPng();
const PLACEHOLDER = `data:image/png;base64,${pngBytes.toString('base64')}`;
console.log('[0.2/0.4] підставний PNG=', { bytes: pngBytes.length });

const raw = JSON.parse(await fs.readFile(bookPath, 'utf8'));
const book: any = raw.book || raw;

let swapped = 0;
const swapUrls = (node: any): void => {
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (typeof value === 'string' && /^(\/api\/media\/file\/|\/generated\/)/.test(value)) {
      node[key] = PLACEHOLDER;
      swapped += 1;
    } else swapUrls(value);
  }
};
swapUrls(book);

const chapters: any[] = Array.isArray(book.chapters) ? book.chapters : [];
const contentChars = chapters.reduce(
  (sum, c) => sum + (c.sections || []).reduce((s: number, x: any) => s + String(x?.content || '').length, 0),
  0
);
console.log('[0.2/0.4] книга=', {
  id: book.id,
  title: book.title,
  chapters: chapters.length,
  contentChars,
  illustrations: Array.isArray(book.illustrations) ? book.illustrations.length : 0,
  urlsSwapped: swapped,
});

await fs.mkdir(outDir, { recursive: true });
const baseSpec: any = specFromBook(book as never);

async function render(label: string, tagged: boolean, companions: Array<'epub' | 'html'>) {
  const spec = { ...baseSpec, pdfExport: { ...baseSpec.pdfExport, tagged, companions } };
  const started = Date.now();
  const out = await designcraftEngineV3.render({
    book,
    kind: 'book',
    spec: spec as never,
    print: false,
    ownerRole: 'admin',
  } as never);
  const ms = Date.now() - started;
  console.log(`[0.2/0.4] ${label}=`, {
    tagged,
    pages: out.pageCount,
    bytes: out.bytes.length,
    seconds: Math.round(ms / 100) / 10,
    companions: (out.companions || []).map((c: any) => ({ kind: c.kind, bytes: c.bytes.length })),
    notesUk: out.notesUk,
  });
  /*
   * Відкинута картинка НЕ є дрібницею: без ілюстрацій змінюється розбиття
   * на сторінки, і число з 0.2 стає числом про іншу книгу. Тому прогін
   * падає тут, а не віддає тихо менший файл.
   */
  const skipped = (out.notesUk || []).filter((n: string) => /could not be decoded|was skipped/.test(n));
  if (skipped.length) {
    throw new Error(`${label}: DesignCraft відкинув ${skipped.length} зображень — числа недійсні. Перше: ${skipped[0]}`);
  }
  await fs.writeFile(path.join(outDir, `${label}.pdf`), out.bytes);
  for (const extra of out.companions || []) {
    await fs.writeFile(path.join(outDir, `${label}.${extra.extension}`), extra.bytes);
  }
  return out;
}

const withTree = await render('tagged-on', true, ['epub', 'html']);
const noTree = await render('tagged-off', false, []);

const delta = withTree.bytes.length - noTree.bytes.length;
console.log('[0.2] РЕЗУЛЬТАТ=', {
  taggedOnBytes: withTree.bytes.length,
  taggedOffBytes: noTree.bytes.length,
  deltaBytes: delta,
  deltaPercent: Math.round((delta / noTree.bytes.length) * 1000) / 10,
  pagesMatch: withTree.pageCount === noTree.pageCount,
});

/*
 * Браузерний EPUB збирається тією самою функцією, що й у застосунку, тож
 * порівнюється САМЕ те, що отримує автор, а не наближення. Функція
 * закінчується завантаженням файлу через DOM — тут підставлені рівно ті
 * три речі, яких їй для цього бракує в Node, і байти перехоплюються з Blob.
 */
let captured: Blob | null = null;
(globalThis as any).URL.createObjectURL = (blob: Blob) => {
  captured = blob;
  return 'blob:captured';
};
(globalThis as any).URL.revokeObjectURL = () => {};
(globalThis as any).document = {
  createElement: () => ({ href: '', download: '', click() {} }),
  body: { appendChild() {}, removeChild() {} },
};

const { exportBookToEpub } = await import('../src/utils/fileExporters');
await exportBookToEpub(book as never);
if (!captured) throw new Error('Браузерний EPUB не перехоплено: експортер не дійшов до Blob.');
const browserEpub = Buffer.from(await (captured as Blob).arrayBuffer());
await fs.writeFile(path.join(outDir, 'browser.epub'), browserEpub);

const layoutEpub = (withTree.companions || []).find((c: any) => c.kind === 'epub');
console.log('[0.4] РЕЗУЛЬТАТ=', {
  layoutEpubBytes: layoutEpub ? layoutEpub.bytes.length : null,
  browserEpubBytes: browserEpub.length,
  outDir,
});
