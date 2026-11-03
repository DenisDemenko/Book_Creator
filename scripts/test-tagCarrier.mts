/**
 * Носій тегів: теги невидимі читачеві PDF, але повертаються при читанні
 * файла в Студії (постановка власника 03.11.2026).
 *
 * ГОЛОВНА ПЕРЕВІРКА — ПОВНИЙ КРУГ. Книга з тегами → носій → «експорт» (теги
 * знімаються, як їх знімає кожен рушій) → читання → теги повертаються, і
 * текст розділів збігається з початковим БАЙТ У БАЙТ. Окремі функції, які
 * кожна «працює», цього не доводять: круг ламається на стику, а не всередині.
 *
 * ЧОМУ PDF БУДУЄТЬСЯ ТУТ ЖЕ. Рушії й мережа потрібні для верстки, а не для
 * вкладення; тест на справжньому PDF книги зроблено разом із цим (журнал
 * #495), а тут — повторюваний, без жодної зовнішньої залежності.
 */

import { PDFDocument } from 'pdf-lib';
import {
  TAG_CARRIER_MAX_PARAGRAPHS,
  applyTagCarrier,
  buildTagCarrier,
  paragraphKey,
  parseTagCarrier,
  splitParagraphs,
  type CarrierBook,
} from '../src/utils/tagCarrier.ts';
import { CORE_ENTITIES, MAX_ENTITIES_PER_PARAGRAPH, buildEntityTag, stripEntityTags } from '../src/utils/coreEntities.ts';
import { TAG_CARRIER_FILENAME, attachTagCarrier, embedTagCarrier, readTagCarrier } from '../server/pdf/tagCarrierPdf.ts';
import type { PdfRenderRequest, PdfRenderResult } from '../server/pdf/engines/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const tagged: CarrierBook = {
  id: 'b1',
  title: 'Проба',
  chapters: [
    {
      id: 'c1',
      title: 'Глава 1',
      sections: [
        {
          id: 's1',
          title: 'Розділ 1',
          content: [
            '[/emotion:страх] [/character:Олена] Олена відчула холод у грудях.',
            'Звичайний абзац без жодних тегів.',
            '[/location:Міст] Вони дійшли до мосту.',
          ].join('\n\n'),
        },
      ],
    },
    {
      id: 'c2',
      title: 'Глава 2',
      sections: [
        { id: 's2', title: 'Розділ 2', content: ['Так.', '[/emotion:надія] Так.', 'Кінець.'].join('\n\n') },
      ],
    },
  ],
};

/** Те, що лишається в книзі після експорту й читання файла: той самий текст, але без тегів. */
const stripped = (book: CarrierBook): CarrierBook => ({
  ...book,
  chapters: (book.chapters ?? []).map((c) => ({
    ...c,
    sections: (c.sections ?? []).map((s) => ({
      ...s,
      content: splitParagraphs(s.content)
        .map((b) => stripEntityTags(b).trim())
        .join('\n\n'),
    })),
  })),
});

const contents = (book: CarrierBook) => (book.chapters ?? []).flatMap((c) => (c.sections ?? []).map((s) => s.content));

console.log('\nВідбиток абзацу:');
{
  t('теги на відбиток не впливають', paragraphKey('[/emotion:страх] Олена мовчала.') === paragraphKey('Олена мовчала.'));
  // «Сира» форма без дужок знімається лише `stripEntityTags` — чистка дужок
  // її не бачить. Без цієї перевірки відбиток міг би тихо стати чутливим до
  // тегів, і абзац після експорту перестав би впізнаватись.
  t('«сирий» тег без дужок на відбиток не впливає', paragraphKey('/emotion:страх Олена мовчала.') === paragraphKey('Олена мовчала.'));
  t('розмітка Студії не впливає', paragraphKey('[B]Олена[/B] мовчала.') === paragraphKey('Олена мовчала.'));
  t('пунктуація й пропуски не впливають', paragraphKey('Олена,  мовчала!') === paragraphKey('Олена мовчала'));
  t('регістр не впливає', paragraphKey('ОЛЕНА мовчала') === paragraphKey('олена МОВЧАЛА'));
  t('інший текст — інший відбиток', paragraphKey('Олена мовчала.') !== paragraphKey('Олена мовчить.'));
  t('лише розмітка — порожній відбиток', paragraphKey('[/emotion:страх] [B][/B]') === '');
}

console.log('\nЗбирання носія:');
{
  const c = buildTagCarrier(tagged);
  t('формат і версія', c.format === 'nova-tags' && c.version === 1);
  t('id й назва книги', c.bookId === 'b1' && c.title === 'Проба');
  t('дві глави з тегами', c.chapters.length === 2, String(c.chapters.length));
  const p0 = c.chapters[0].sections[0].paragraphs;
  t('в першому розділі лише абзаци з тегами', p0.length === 2, String(p0.length));
  t('абзац без тегів у носій не потрапив', !p0.some((p) => p.n === 1));
  t(
    'теги першого абзацу — у порядку появи',
    JSON.stringify(p0[0].tags) === JSON.stringify([{ slug: 'emotion', value: 'страх' }, { slug: 'character', value: 'Олена' }]),
    JSON.stringify(p0[0].tags)
  );
  t('місце абзацу в розділі збережене', p0[1].n === 2, String(p0[1].n));
  const dup = c.chapters[1].sections[0].paragraphs;
  t('з двох однакових «Так.» несе лише той, що з тегом', dup.length === 1 && dup[0].n === 1, JSON.stringify(dup.map((p) => p.n)));
  t('книга без тегів — порожній носій', buildTagCarrier(stripped(tagged)).chapters.length === 0);

  // Межа, а не помилка: абзац без жодної літери чи цифри (розділювач,
  // маркер ілюстрації) не має за що зачепитись у файлі, тож тег на ньому
  // носій не несе. На справжній книзі таких 59 із 1888 (42 ілюстрації,
  // 16 розділювачів, один «↑»).
  const bare = buildTagCarrier({
    chapters: [{ title: 'Г', sections: [{ title: 'Р', content: '[/emotion:страх] ***\n\n[/location:Міст] [IMG: img-1 "підпис"]\n\n[/emotion:надія] Звичайний абзац.' }] }],
  });
  const bareParas = bare.chapters[0]?.sections[0].paragraphs ?? [];
  t('тег на розділювачі й на маркері ілюстрації не несеться', bareParas.length === 1, String(bareParas.length));
  t('а на звичайному абзаці — несеться', bareParas[0]?.tags[0]?.value === 'надія', JSON.stringify(bareParas[0]?.tags));
}

console.log('\nПовний круг: теги → експорт → читання → теги:');
{
  const carrier = buildTagCarrier(tagged);
  const readBack = stripped(tagged);
  const before = contents(readBack).join('|');
  const r = applyTagCarrier(readBack, carrier);
  t('усі три абзаци знайшли свої теги', r.matched === 3, String(r.matched));
  t('поставлено чотири теги', r.tagsPlaced === 4, String(r.tagsPlaced));
  t('нічого не загублено', r.unmatched === 0 && r.skippedByLimit === 0);
  t(
    'текст розділів збігається з початковим БАЙТ У БАЙТ',
    JSON.stringify(contents(r.book)) === JSON.stringify(contents(tagged)),
    contents(r.book)[1]
  );
  t('книгу-вхід не змінено', contents(readBack).join('|') === before);
  t('абзац без тегів не зачеплено', contents(r.book)[0].includes('\n\nЗвичайний абзац без жодних тегів.\n\n'));
  const again = applyTagCarrier(r.book, carrier);
  t('повторний прохід нічого не додає', again.tagsPlaced === 0 && again.matched === 0, String(again.tagsPlaced));
}

console.log('\nПовтори: «Так.» двічі поруч, тег був на другому:');
{
  const r = applyTagCarrier(stripped(tagged), buildTagCarrier(tagged));
  const section2 = r.book.chapters![1].sections![0].content!.split('\n\n');
  t('перший «Так.» без тега', section2[0] === 'Так.', section2[0]);
  t('другий «Так.» дістав свій тег', section2[1] === '[/emotion:надія] Так.', section2[1]);
}

console.log('\nКнига після читання файла трохи інша:');
{
  const noPunct = stripped(tagged);
  noPunct.chapters![0].sections![0].content = noPunct.chapters![0].sections![0].content!.replace('грудях.', 'грудях').replace('мосту.', 'мосту');
  const r = applyTagCarrier(noPunct, buildTagCarrier(tagged));
  t('без крапок абзаци все одно впізнані', r.matched === 3 && r.unmatched === 0, `${r.matched}/${r.unmatched}`);

  const renamed = stripped(tagged);
  renamed.chapters![0].sections![0].title = 'Зовсім інша назва';
  const r2 = applyTagCarrier(renamed, buildTagCarrier(tagged));
  t('інша назва розділу не заважає знайти абзаци', r2.matched === 3, String(r2.matched));

  const missing = stripped(tagged);
  missing.chapters![0].sections![0].content = 'Тут геть інший текст.';
  const r3 = applyTagCarrier(missing, buildTagCarrier(tagged));
  t('абзаци, яких у книзі немає, полічені', r3.unmatched === 2, String(r3.unmatched));
}

console.log('\nНезачеплені розділи лишаються байт у байт:');
{
  const book = stripped(tagged);
  book.chapters![0].sections!.push({ id: 's9', title: 'Окремий', content: 'Перший.\n\n\n\nДругий після трьох порожніх рядків.\r\n\r\nТретій.' });
  const r = applyTagCarrier(book, buildTagCarrier(tagged));
  t('розділ без змін не переписано', r.book.chapters![0].sections![1].content === book.chapters![0].sections![1].content);
}

console.log('\nЛіміт на абзац:');
{
  const slugs = CORE_ENTITIES.slice(0, MAX_ENTITIES_PER_PARAGRAPH + 2).map((e) => e.slug);
  const heavy: CarrierBook = {
    chapters: [{ title: 'Г', sections: [{ title: 'Р', content: `${slugs.map((s) => buildEntityTag(s, 'x')).join(' ')} Один дуже тегований абзац.` }] }],
  };
  const plain = stripped(heavy);
  const r = applyTagCarrier(plain, buildTagCarrier(heavy));
  t(`поставлено рівно ${MAX_ENTITIES_PER_PARAGRAPH}`, r.tagsPlaced === MAX_ENTITIES_PER_PARAGRAPH, String(r.tagsPlaced));
  t('решта полічена як відкинута лімітом', r.skippedByLimit === 2, String(r.skippedByLimit));

  // Два теги вже стоять — місць лишається на два менше.
  const partly = stripped(heavy);
  partly.chapters![0].sections![0].content = `${buildEntityTag(slugs[0], 'x')} ${buildEntityTag(slugs[1], 'x')} Один дуже тегований абзац.`;
  const r2 = applyTagCarrier(partly, buildTagCarrier(heavy));
  t('наявні теги теж займають місця', r2.tagsPlaced === MAX_ENTITIES_PER_PARAGRAPH - 2, String(r2.tagsPlaced));
  t('наявні не дублюються', r2.skippedByLimit === 2, String(r2.skippedByLimit));
}

console.log('\nРозбір чужого JSON:');
{
  const good = buildTagCarrier(tagged);
  t('свій носій приймається', parseTagCarrier(good) !== null);
  t('чужий формат — ні', parseTagCarrier({ ...good, format: 'other' }) === null);
  t('інша версія — ні', parseTagCarrier({ ...good, version: 99 }) === null);
  t('без глав — ні', parseTagCarrier({ format: 'nova-tags', version: 1 }) === null);
  t('не об\'єкт — ні', parseTagCarrier('рядок') === null && parseTagCarrier(null) === null && parseTagCarrier(42) === null);
  t('межа носія задана', TAG_CARRIER_MAX_PARAGRAPHS > 0);
}

// ── Сам PDF ────────────────────────────────────────────────────────────────

async function samplePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([420, 595]).drawText(`Page ${i + 1}`, { x: 40, y: 500, size: 14 });
  return doc.save();
}

const rendered = (bytes: Uint8Array): PdfRenderResult => ({ bytes, pageCount: 2, engineId: 'nova', honoredSpec: true, notesUk: [] });
const requestWith = (pdfExport: Record<string, unknown>, book: CarrierBook = tagged): PdfRenderRequest =>
  ({ book, spec: { pdfExport }, print: false }) as unknown as PdfRenderRequest;

console.log('\nВкладення в PDF:');
{
  const src = await samplePdf();
  const carrier = buildTagCarrier(tagged);
  const out = await embedTagCarrier(src, carrier);
  const before = await PDFDocument.load(src);
  const after = await PDFDocument.load(out);
  t('кількість сторінок не змінилась', after.getPageCount() === before.getPageCount(), `${before.getPageCount()}→${after.getPageCount()}`);
  t('розмір сторінки не змінився', after.getPage(0).getWidth() === before.getPage(0).getWidth());
  const back = await readTagCarrier(out);
  t('носій читається назад', back !== null);
  t('і збігається з вкладеним', JSON.stringify(back) === JSON.stringify(carrier));
  t('ім\'я вкладення фіксоване', TAG_CARRIER_FILENAME === 'nova-tags.json');
  t('PDF без носія — null, а не помилка', (await readTagCarrier(src)) === null);
  t('сміття замість PDF — null', (await readTagCarrier(new Uint8Array([1, 2, 3, 4]))) === null);
  t('порожній буфер — null', (await readTagCarrier(new Uint8Array())) === null);
}

console.log('\nЧуже вкладення й бите JSON:');
{
  const foreign = await PDFDocument.load(await samplePdf());
  await foreign.attach(Buffer.from('просто файл'), 'notes.txt', { mimeType: 'text/plain' });
  t('чуже вкладення — не наше', (await readTagCarrier(await foreign.save())) === null);

  const broken = await PDFDocument.load(await samplePdf());
  await broken.attach(Buffer.from('{ це не json'), TAG_CARRIER_FILENAME, { mimeType: 'application/json' });
  t('вкладення з нашим іменем, але биттям — null', (await readTagCarrier(await broken.save())) === null);

  const wrong = await PDFDocument.load(await samplePdf());
  await wrong.attach(Buffer.from(JSON.stringify({ format: 'nova-tags', version: 99, chapters: [] })), TAG_CARRIER_FILENAME);
  t('вкладення іншої версії — null', (await readTagCarrier(await wrong.save())) === null);

  const mixed = await PDFDocument.load(await samplePdf());
  await mixed.attach(Buffer.from('чуже'), 'a.txt');
  await mixed.attach(Buffer.from(JSON.stringify(buildTagCarrier(tagged))), TAG_CARRIER_FILENAME);
  await mixed.attach(Buffer.from('ще чуже'), 'z.txt');
  t('наше знаходиться серед чужих', (await readTagCarrier(await mixed.save())) !== null);
}

console.log('\nКоли рушій вкладає носій (опція embedTags):');
{
  const src = await samplePdf();

  const off = rendered(src);
  t('без опції PDF не чіпається взагалі', (await attachTagCarrier(off, requestWith({ embedTags: false }))) === off);
  t('опції немає — теж', (await attachTagCarrier(off, requestWith({}))) === off);

  const x4 = await attachTagCarrier(rendered(src), requestWith({ embedTags: true, standard: 'x4' }));
  t('при PDF/X-4 байти ті самі', x4.bytes === src);
  t('і про це сказано словами', x4.notesUk.some((n) => n.includes('X-4')), x4.notesUk.join(' | '));
  const a2b = await attachTagCarrier(rendered(src), requestWith({ embedTags: true, standard: 'a2b' }));
  t('при PDF/A-2b так само', a2b.bytes === src && a2b.notesUk.some((n) => n.includes('A-2b')));

  const untagged = await attachTagCarrier(rendered(src), requestWith({ embedTags: true, standard: 'none' }, stripped(tagged)));
  t('книга без тегів — нічого не вкладено', untagged.bytes === src);
  t('і про це сказано', untagged.notesUk.some((n) => n.includes('немає розмічених')), untagged.notesUk.join(' | '));

  const ok = await attachTagCarrier(rendered(src), requestWith({ embedTags: true, standard: 'none' }));
  t('носій вкладено', ok.bytes !== src && ok.bytes.length > 0);
  t('кількість сторінок у результаті та сама', ok.pageCount === 2);
  t('нотатка називає кількість абзаців', ok.notesUk.some((n) => n.includes('3 абзаців')), ok.notesUk.join(' | '));
  t('і вкладене справді читається', JSON.stringify(await readTagCarrier(ok.bytes)) === JSON.stringify(buildTagCarrier(tagged)));

  const garbage = new Uint8Array([9, 9, 9, 9, 9]);
  let threw = false;
  const failed = await attachTagCarrier(rendered(garbage), requestWith({ embedTags: true, standard: 'none' })).catch(() => {
    threw = true;
    return null;
  });
  t('збій вкладення PDF не валить', !threw);
  t('віддається початковий PDF', failed?.bytes === garbage);
  t('і про збій сказано', !!failed?.notesUk.some((n) => n.includes('не вкладено')), failed?.notesUk.join(' | '));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
