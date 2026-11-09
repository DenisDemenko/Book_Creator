/**
 * Маркери ШІ не друкуються в PDF і їдуть прихованим носієм (запис #534). Запуск: npm run test:ai-markers-hidden
 *
 * Правило власника (09.11.2026, знімок PDF інструкції зі словами [AI-DRAFT] у тексті): сама мітка не повинна бути
 * видна в документі, лише як прихований текст, який прочитає скрипт чи інший ШІ.
 *
 * Перевірка йде по справжньому PDF: те, що текст «не містить маркера» в даних, ще не означає, що рушій його не
 * надрукував, — тому беремо текст зі сторінок готового файла (pdfjs), а не з рядка, який ми склали самі.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aiBlockFlags, applyTagCarrier, buildTagCarrier, parseTagCarrier, type CarrierBook } from '../src/utils/tagCarrier.ts';
import { withoutAiMarkers } from '../server/pdf/visibleBook.ts';
import { toParagraphs } from '../server/pdf/pdfRenderer.ts';
import { renderWithEngine } from '../server/pdf/engines/registry.ts';
import { readTagCarrier } from '../server/pdf/tagCarrierPdf.ts';
import { buildDesigncraftRtf } from '../server/pdf/designcraft/rtf.ts';
import { bookToPdfInput, specFromBook } from '../server/pdf/pdfFromBook.ts';
import type { PdfRenderRequest } from '../server/pdf/engines/types.ts';
import { buildBookFromInstructionPayload } from '../src/utils/instructionBook.ts';
import { buildInstructionBookSections, buildInstructionBookTitle } from '../src/utils/instructionBookDraft.ts';
import { createEmptyInstruction, createEmptyStep } from '../src/utils/instructionDraft.ts';
import { findInstructionType } from '../src/data/instructionTypes.ts';
import { aiDraftText } from '../shared/aiTextOrigin.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`); };
const MARKER = /\[\/?AI-(?:DRAFT|GENERATED)/;

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
/** Весь видимий текст готового PDF одним рядком. */
async function textOf(bytes: Uint8Array): Promise<string> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    standardFontDataUrl: `${pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href}/`,
  } as never);
  const doc = (await task.promise) as { numPages: number; getPage(n: number): Promise<any> };
  let all = '';
  for (let p = 1; p <= doc.numPages; p += 1) {
    const content = await (await doc.getPage(p)).getTextContent();
    all += content.items.map((i: { str: string }) => i.str).join(' ') + '\n';
  }
  return all;
}

console.log('\nПозначка ШІ по абзацах (aiBlockFlags):');
{
  const blocks = ['Звичайний.', '[AI-DRAFT]', 'Від ШІ один.', 'Від ШІ два.', '[/AI-DRAFT]', 'Знову звичайний.'];
  t('усередині [AI-DRAFT]…[/AI-DRAFT] — так, поза — ні', aiBlockFlags(blocks).join() === 'false,true,true,true,true,false');
  t('вкладені й підряд: глибина не «залипає»', aiBlockFlags(['[AI-DRAFT]', 'a', '[AI-DRAFT]', 'b', '[/AI-DRAFT]', 'c', '[/AI-DRAFT]', 'd']).join() === 'true,true,true,true,true,true,true,false');
  t('маркер і текст в одному абзаці', aiBlockFlags(['[AI-DRAFT] текст [/AI-DRAFT]', 'поза']).join() === 'true,false');
  t('закритий без відкритого не робить далі «ШІ»', aiBlockFlags(['[/AI-DRAFT]', 'поза']).join() === 'false,false');
  t('[AI-GENERATED:…] теж', aiBlockFlags(['[AI-GENERATED:%7B%7D]', 'текст', '[/AI-GENERATED]', 'поза']).join() === 'true,true,true,false');
}

console.log('\nНосій тегів: ознака ШІ — приховане поле:');
{
  const book: CarrierBook = {
    id: 'b1', title: 'Проба',
    chapters: [{ title: 'Г', sections: [{ title: 'Р', content: ['Людський абзац. [/step:Один]', '[AI-DRAFT]', 'Абзац від ШІ без тега.', 'Абзац від ШІ з тегом. [/step:Два]', '[/AI-DRAFT]', 'Ще людський.'].join('\n\n') }] }],
  };
  const carrier = buildTagCarrier(book);
  const paras = carrier.chapters[0].sections[0].paragraphs;
  t('абзац від ШІ без тега потрапляє в носій як {ai:true, tags:[]}', paras.some((p) => p.ai === true && p.tags.length === 0));
  t('абзац від ШІ з тегом: і теги, і ai', paras.some((p) => p.ai === true && p.tags.length === 1 && p.tags[0].value === 'Два'));
  t('людський абзац з тегом — без ai', paras.some((p) => p.ai === undefined && p.tags[0]?.value === 'Один'));
  t('людський абзац без тегів у носій не йде', !paras.some((p) => p.tags.length === 0 && p.ai !== true));
  t('самі маркери (порожній відбиток) у носій не йдуть', paras.length === 3, String(paras.length));
  t('JSON носія маркерів ШІ не містить', !MARKER.test(JSON.stringify(carrier)));
  t('формат лишився версії 1 — старі читачі носій приймають', parseTagCarrier(JSON.parse(JSON.stringify(carrier))) !== null);
  const applied = applyTagCarrier(book, carrier);
  t('імпорт: абзаци лише з ознакою ШІ не рахуються «незнайденими»', applied.unmatched === 0, `unmatched=${applied.unmatched}`);
}

console.log('\nvisibleBook: видимий текст без маркерів:');
{
  const draft = aiDraftText('Текст від ШІ.');
  const req = { kind: 'book', book: { title: 'К', chapters: [{ title: 'Г', sections: [{ title: 'Р', content: `Перший.\n\n${draft}\n\nОстанній.` }, { title: 'Чистий', content: 'Без маркерів.' }] }] } } as PdfRenderRequest;
  const before = JSON.stringify(req);
  const visible = withoutAiMarkers(req);
  const secs = visible.book.chapters[0].sections;
  t('маркерів у розділі немає, текст автора лишився', !MARKER.test(secs[0].content) && secs[0].content.includes('Текст від ШІ.') && secs[0].content.startsWith('Перший.') && secs[0].content.endsWith('Останній.'));
  t('абзаци не злипаються: між ними рівно порожній рядок', secs[0].content === 'Перший.\n\nТекст від ШІ.\n\nОстанній.');
  t('вхідний запит не змінено', JSON.stringify(req) === before);
  t('розділ без маркерів — той самий обʼєкт', secs[1] === req.book.chapters[0].sections[1]);
  const clean = { kind: 'book', book: { title: 'К', chapters: [{ title: 'Г', sections: [{ title: 'Р', content: 'Чисто.' }] }] } } as PdfRenderRequest;
  t('нічого знімати — повертається сам запит', withoutAiMarkers(clean) === clean);
  t('Nova toParagraphs (прямі виклики) теж без маркерів', toParagraphs(`А\n\n${draft}\n\nБ`).join('|') === 'А|Текст від ШІ.|Б' && !MARKER.test(toParagraphs('[AI-GENERATED:%7B%7D]\n\nтекст\n\n[/AI-GENERATED]').join()));
}

console.log('\nСправжній PDF інструкції (Nova): маркерів на сторінках немає, носій їх зберігає:');
{
  const type = findInstructionType('assembly');
  const doc = createEmptyInstruction('assembly');
  doc.title = 'Стіл письмовий';
  doc.description = 'Компактний письмовий стіл.';
  doc.tools = ['Шуруповерт', 'Рулетка'];
  doc.warnings = ['Не переносити в одиночку'];
  doc.steps = [
    { ...createEmptyStep(), id: 's1', title: 'Розпакування', description: 'Дістати деталі з коробки.', aiGenerated: true, components: 'Коробка', toolsResources: 'Ніж', warning: 'Ріжте від себе', successCriterion: 'Усі деталі на місці' } as never,
    { ...createEmptyStep(), id: 's2', title: 'Монтаж ніжок', description: 'Прикрутити ніжки до стільниці.' },
  ];
  const sections = buildInstructionBookSections(doc, type, ['Розкладіть деталі за списком.', 'Затягніть гвинти рівномірно.']);
  const raw = sections.map((s) => s.content).join('\n\n');
  t('вихідний текст книги справді містить маркери ШІ (інакше тест порожній)', /\[AI-DRAFT\]/.test(raw) && /\[\/AI-DRAFT\]/.test(raw));
  const { book } = buildBookFromInstructionPayload({ title: buildInstructionBookTitle(doc, type), sections }, { now: Date.UTC(2026, 10, 9), author: 'Автор', authorRole: 'writer' });
  t('книга з інструкції вмикає прихований носій (embedTags)', (book.layoutConfig as { embedTags?: boolean }).embedTags === true);

  const request: PdfRenderRequest = { book: bookToPdfInput(book as never), kind: 'book', spec: specFromBook(book as never) };
  const rendered = await renderWithEngine('nova', request);
  const text = await textOf(rendered.bytes);
  t('PDF зверстано', rendered.pageCount >= 1 && rendered.bytes.length > 1000);
  t('на сторінках немає жодного AI-DRAFT / AI-GENERATED', !MARKER.test(text), (text.match(/.{20}\[\/?AI-[^\]]*\].{20}/) ?? [''])[0]);
  t('текст кроків на сторінках є', text.includes('Розкладіть деталі за списком') && text.includes('Дістати деталі з коробки') && text.includes('Затягніть гвинти'));

  const carrier = await readTagCarrier(rendered.bytes);
  t('у файлі є прихований носій nova-tags.json', carrier !== null);
  const paras = carrier?.chapters.flatMap((c) => c.sections.flatMap((s) => s.paragraphs)) ?? [];
  t('носій несе ознаку ШІ для абзаців від ШІ', paras.filter((p) => p.ai === true).length >= 3, String(paras.filter((p) => p.ai).length));
  t('і теги кроків, як раніше', paras.some((p) => p.tags.some((tg) => tg.slug === 'step')));
  t('у носії теж немає тексту маркерів', !MARKER.test(JSON.stringify(carrier)));
  t('оригінал запиту не мутовано: маркери в книзі лишились', MARKER.test(JSON.stringify(request.book)));

  // DesignCraft будує Tagged Text з Markdown книги: `### 1. Крок` не мусить дійти до сторінки решітками.
  const dc = buildDesigncraftRtf(withoutAiMarkers(request).book, request.spec ?? {});
  // Tagged Text кодує не-ASCII як <0xHHHH>: спершу розкодовуємо в літери, потім знімаємо решту службових тегів.
  const dcText = dc.rtf.replace(/<0x([0-9A-Fa-f]{4})>/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/<[A-Za-z][^<>]*>/g, '');
  t('DesignCraft: у тексті немає решіток підзаголовка «### »', !/#{3,6}\s/.test(dcText), (dcText.match(/.{10}#{3,6}\s.{10}/) ?? [''])[0]);
  t('DesignCraft: назва кроку на місці, а маркерів ШІ немає', dcText.includes('1. Розпакування') && !MARKER.test(dcText));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
