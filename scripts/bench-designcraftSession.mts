/**
 * Вимірювач спайку: той самий конвеєр DesignCraft двома транспортами.
 * Запуск: npm run bench:designcraft-session
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Швидкість нічого не варта, якщо шляхи верстають
 * по-різному, тож головна перевірка — НЕ час, а збіг результату: однакова
 * кількість сторінок і однаковий зміст. Час звітується другим.
 *
 * Обидва шляхи міряються в ОДНОМУ процесі Node і по два прогони кожен, щоб
 * різниця не включала прогрів V8 і кеш файлової системи. Кількість запусків
 * процесу DesignCraft рахує сам рушій (`__designcraftProcessLaunches`), а не
 * розбір логів.
 *
 * ЧОГО ЦЕ НЕ МІРЯЄ. Це Windows, де створення процесу дорожче за Linux, і
 * синтетичні книги. Production-співвідношення на Railway лишається
 * невідомим — див. «Не зроблено» в записі журналу.
 */
process.env.DATA_DIR ||= '/tmp/nova-designcraft-bench';

import { PDFDocument } from 'pdf-lib';

const {
  designcraftEngineV3,
  __renderWithSession,
  __designcraftProcessLaunches,
  __resetDesigncraftProcessLaunches,
} = await import('../server/pdf/engines/designcraftEngineV3');

const PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk5sAAAAASUVORK5CYII=';

const PARA =
  'Вечір падав на місто поволі, як сторінка, що її перегортають не дивлячись. ' +
  'Вулиці ще тримали тепло, але вже пахло дощем, і це був той самий запах, який вона пам’ятала з дитинства. ';

function chapters(count: number, parasPerSection: number, withImage: boolean) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i + 1}`,
    order: i + 1,
    title: `Розділ ${i + 1}`,
    sections: [
      {
        id: `c${i + 1}s1`,
        order: 1,
        title: `Частина ${i + 1}.1`,
        content:
          (withImage && i === 0 ? `\n\n[IMG: img-1 "Тестова ілюстрація" wrap=center]\n\n` : '') +
          Array.from({ length: parasPerSection }, () => `<p>${PARA.repeat(3)}</p>`).join('\n\n'),
      },
    ],
  }));
}

function book(id: string, title: string, chapterCount: number, paras: number, withImage: boolean) {
  return {
    id,
    title,
    subtitle: 'Вимірювання транспорту',
    author: 'Fusion Lab Studio',
    chapters: chapters(chapterCount, paras, withImage),
    ...(withImage ? { images: [{ id: 'img-1', url: PNG, captionUk: 'Тестова ілюстрація' }] } : {}),
  } as any;
}

interface Run {
  ms: number;
  launches: number;
  pageCount: number;
  bytes: number;
  pdfPages: number;
  notes: string[];
}

async function measure(label: string, render: () => Promise<any>): Promise<Run> {
  __resetDesigncraftProcessLaunches();
  const t0 = performance.now();
  const out = await render();
  const ms = performance.now() - t0;
  const pdf = await PDFDocument.load(out.bytes);
  return {
    ms,
    launches: __designcraftProcessLaunches(),
    pageCount: out.pageCount,
    bytes: out.bytes.length,
    pdfPages: pdf.getPageCount(),
    notes: out.notesUk || [],
  };
}

const CASES = [
  { name: 'коротка книга з ілюстрацією', book: book('BENCH-SHORT', 'Коротка книга', 2, 2, true) },
  { name: 'довга книга без ілюстрацій', book: book('BENCH-LONG', 'Довга книга', 12, 10, false) },
  // Ближче до справжнього обсягу: саме тут вага повторного читання документа
  // на кожну пробу має бути найбільшою, бо кожен запуск перекомпоновує все.
  { name: 'книга книжкового обсягу', book: book('BENCH-BOOK', 'Книга книжкового обсягу', 24, 14, true) },
];

const RUNS = Math.max(1, Number(process.env.BENCH_RUNS) || 3);

let mismatches = 0;

for (const kase of CASES) {
  console.log(`\n=== ${kase.name} ===`);
  const request = { book: kase.book, kind: 'book' as const, spec: {}, print: false, ownerId: null, ownerRole: 'admin' };

  const fileRuns: Run[] = [];
  const sessionRuns: Run[] = [];
  for (let i = 0; i < RUNS; i++) {
    fileRuns.push(await measure('файл', () => designcraftEngineV3.render(request)));
    sessionRuns.push(await measure('сесія', () => __renderWithSession(request)));
  }

  const f = fileRuns[fileRuns.length - 1];
  const s = sessionRuns[sessionRuns.length - 1];

  // ГОЛОВНЕ: результат мусить бути однаковий.
  const samePages = f.pageCount === s.pageCount && f.pdfPages === s.pdfPages;
  if (!samePages) mismatches += 1;
  console.log(`  сторінок: файл ${f.pageCount} (PDF ${f.pdfPages}) | сесія ${s.pageCount} (PDF ${s.pdfPages}) — ${samePages ? 'ЗБІГ' : 'РОЗБІЖНІСТЬ'}`);
  console.log(`  розмір PDF: файл ${f.bytes} Б | сесія ${s.bytes} Б (різниця ${Math.abs(f.bytes - s.bytes)} Б — метадані часу створення)`);

  const fm = Math.min(...fileRuns.map((r) => r.ms));
  const sm = Math.min(...sessionRuns.map((r) => r.ms));
  console.log(`  час (найкращий із ${RUNS}): файл ${fm.toFixed(0)} мс | сесія ${sm.toFixed(0)} мс | ${(fm / sm).toFixed(2)}×`);
  console.log(`  прогони: файл ${fileRuns.map((r) => r.ms.toFixed(0)).join(', ')} мс | сесія ${sessionRuns.map((r) => r.ms.toFixed(0)).join(', ')} мс`);
  console.log(`  запусків процесу DesignCraft: файл ${f.launches} | сесія ${s.launches}`);
}

console.log(
  `\nПідсумок: ${mismatches === 0 ? 'результат обох шляхів збігається' : `РОЗБІЖНОСТЕЙ: ${mismatches}`}.`
);
console.log('Міряно на Windows і на синтетичних книгах: production-співвідношення на Linux цим НЕ встановлено.');
if (mismatches > 0) process.exit(1);
