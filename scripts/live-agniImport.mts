/**
 * Живий прогін майстра перенесення на СПРАВЖНІЙ книзі автора.
 * Запуск: npx tsx scripts/live-agniImport.mts
 *
 * Це не юніт-тест із синтетичним рядком, а перевірка на реальному рукописі
 * («Самоучитель для Архата», тека `D:\Книга первая\Книга Агни Йог _Архат_`),
 * де одночасно сходяться всі три вади, які виправлялись:
 *   • .txt збережено в KOI8-U — старе читання як UTF-8 давало «@@@@@@@@»;
 *   • .docx містить вбудовані зображення — `extractRawText` їх викидав;
 *   • картинки мусять дійти і в медіатеку, і в текст (маркери на своїх місцях).
 *
 * Скрипт нічого не змінює: він лише читає файли й перевіряє інваріанти. Якщо
 * файлів немає (інша машина), він чесно про це каже й виходить з кодом 0 —
 * щоб його можна було запускати де завгодно.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeTextBuffer } from '../src/utils/textEncoding.ts';
import { htmlToManuscript, DOCX_IMAGE_SRC_PREFIX, createDocxImageSlots } from '../src/utils/docxManuscript.ts';
import { parseManuscriptText } from '../src/utils/manuscriptImport.ts';
import { collectImageMarkerIds } from '../src/utils/imageMarkers.ts';

const DIR = 'D:/Книга первая/Книга Агни Йог _Архат_';
const TXT = path.join(DIR, 'Самоучитель для Архата или Путь Архата для чайников.txt');
const DOCX = path.join(DIR, 'Самоучитель для Архата или Путь Архата для чайников.docx');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

if (!fs.existsSync(TXT) && !fs.existsSync(DOCX)) {
  console.log(`Файлів немає (${DIR}) — живий прогін пропущено.`);
  process.exit(0);
}

// ── 1. .txt: кодування ───────────────────────────────────────────────────
if (fs.existsSync(TXT)) {
  console.log('\n1. Текстовий файл — визначення кодування:');
  const buf = fs.readFileSync(TXT);
  const decoded = decodeTextBuffer(new Uint8Array(buf));
  const firstBytes = [...buf.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

  t(`файл прочитано (${mb(buf.length)}, перші байти: ${firstBytes})`, buf.length > 0);
  t('кодування визначено', decoded.encoding.length > 0, decoded.encoding);
  const replacements = (decoded.text.match(/\uFFFD/g) || []).length;
  t('символів заміни немає', replacements === 0, `максимум ${replacements}`);
  t('текст українською/російською впізнаваний', /САМОУЧИТЕЛЬ|Самоучитель/.test(decoded.text));
  t('видно «Глава 1»', /Глава\s+1/.test(decoded.text));

  const parsedTxt = parseManuscriptText(decoded.text, 'preview-txt');
  t('розпізнано більше ніж одну главу', parsedTxt.headingsDetected && parsedTxt.chapters.length > 1, `глав: ${parsedTxt.chapters.length}`);
  t('слова пораховано', parsedTxt.totalWords > 10000, `слів: ${parsedTxt.totalWords}`);
  console.log(`     (кодування: ${decoded.encoding}, глав: ${parsedTxt.chapters.length}, слів: ${parsedTxt.totalWords})`);
}

// ── 2. .docx: текст + зображення ─────────────────────────────────────────
if (fs.existsSync(DOCX)) {
  console.log('\n2. Документ Word — текст і вбудовані зображення:');
  const buf = fs.readFileSync(DOCX);
  const mammoth: any = (await import('mammoth')).default ?? (await import('mammoth'));

  // Той самий шлях, що й у візарді: збираємо картинки окремо, у HTML — плейсхолдер.
  //
  // Місце резервуємо ДО `image.read`: на 42 картинках відповіді приходять не
  // в тому порядку, у якому їх запитали, і `push` із індексом від `length`
  // переплутував картинки (саме звідси брався «SOI not found in JPEG» у
  // першому прогоні #169).
  const slots = createDocxImageSlots();
  const started = Date.now();
  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement((image: any) => {
        const index = slots.reserve();
        return image.read('base64').then((data: string) => {
          slots.put(index, { contentType: image.contentType, base64: data });
          return { src: `${DOCX_IMAGE_SRC_PREFIX}${index}` };
        });
      }),
    }
  );
  const htmlValue: string = result.value;
  const { text, images } = htmlToManuscript(htmlValue);
  const collected = images
    .map((img) => ({ index: Number(img.id.slice('docx-img-'.length)), bytes: slots.get(Number(img.id.slice('docx-img-'.length))) }))
    .filter((entry) => entry.bytes) as { index: number; bytes: { contentType: string; base64: string } }[];
  const imageBytes = collected.reduce((sum, i) => sum + Math.round((i.bytes.base64.length * 3) / 4), 0);

  t(`документ прочитано (${mb(buf.length)} за ${Date.now() - started} мс)`, buf.length > 0);
  t('HTML лишився легким (плейсхолдери, не base64)', htmlValue.length < 5_000_000, `${mb(htmlValue.length)}`);
  t('зображення витягнуто', collected.length > 0, `їх ${collected.length} на ${mb(imageBytes)}`);
  t('усі зображення описані в тексті', images.length === collected.length, `${images.length} проти ${collected.length}`);
  t('місця плейсхолдерів і байти не переплутані', new Set(collected.map((c) => c.index)).size === collected.length);

  const markers = text.match(/\[IMG: [^\]]+\]/g) || [];
  t('маркерів у тексті стільки ж, скільки картинок', markers.length === collected.length, `${markers.length}`);

  const ids = new Set(markers.map((m) => /\[IMG: (\S+)/.exec(m)![1]));
  t('усі id маркерів унікальні', ids.size === markers.length, `${ids.size} унікальних`);
  t('кожен маркер має зібране зображення', [...ids].every((id) => images.some((i) => i.id === id)));

  const withCaption = images.filter((i) => i.caption).length;
  t('частина картинок має підпис із Word', withCaption > 0, `${withCaption} з ${images.length}`);
  console.log(`     (приклади: ${images.slice(0, 4).map((i) => `${i.id}="${i.caption}"`).join(', ')})`);

  // ── 3. Розкладка по главах ─────────────────────────────────────────────
  console.log('\n3. Розкладка по главах (як у книзі після імпорту):');
  const parsed = parseManuscriptText(text, 'preview-docx');
  t('глави розпізнано', parsed.chapters.length > 1, `глав: ${parsed.chapters.length}`);
  t('слова пораховано', parsed.totalWords > 1000, `слів: ${parsed.totalWords}`);

  const inChapters = parsed.chapters.reduce((sum, ch) => {
    return sum + ch.sections.reduce((s, sec) => s + (sec.content.match(/\[IMG: [^\]]+\]/g) || []).length, 0);
  }, 0);
  t('маркери дійшли до глав без втрат', inChapters === markers.length, `${inChapters} з ${markers.length}`);

  const chapterTitles = parsed.chapters.map((c) => c.title).filter(Boolean);
  t('заголовки глав — справжні, а не «Глава N»', chapterTitles.some((title) => /Глава\s+\d/.test(title)), chapterTitles.slice(0, 3).join(' | '));

  const firstImage = text.indexOf('[IMG:');
  t('перша картинка стоїть на початку (обкладинка)', firstImage >= 0 && firstImage < 400, `на позиції ${firstImage}`);
  console.log(`     (глав: ${parsed.chapters.length}, слів: ${parsed.totalWords}, маркерів: ${inChapters})`);

  // ── 4. Верстка PDF із цих самих маркерів ──────────────────────────────
  /*
    ГОЛОВНА ПЕРЕВІРКА ЗАПИСУ #169. Доти серверна верстка не бачила маркерів:
    друкувала їх голим текстом, а 42 картинки скидала купою в кінець першого
    розділу. На проді це виглядало як «книга опублікувалась без картинок».
    Тут той самий рукопис проходить справжній шлях рушія Nova з тими самими
    байтами зображень — і перевіряється МІСЦЕ картинки, а не факт «PDF є».
  */
  console.log('\n4. Верстка PDF: картинки на своїх місцях, а не купою:');
  const { bookToPdfInput } = await import('../server/pdf/pdfFromBook.ts');
  const { renderBookPdf } = await import('../server/pdf/pdfRenderer.ts');

  const dataUrl = (i: number) => `data:${slots.get(i)!.contentType};base64,${slots.get(i)!.base64}`;
  const chapters = parsed.chapters.map((ch, index) => ({
    id: `ch-${index}`,
    title: ch.title || `Розділ ${index + 1}`,
    order: index + 1,
    sections: ch.sections.map((sec, sIndex) => ({
      id: `s-${index}-${sIndex}`,
      title: sec.title || '',
      order: sIndex + 1,
      content: sec.content,
    })),
  }));

  /* Глава для ілюстрації — та, у якій стоїть її маркер: саме так це робить
     майстер перенесення (#159). */
  const chapterOfMarker = new Map<string, string>();
  for (const ch of chapters) {
    for (const sec of ch.sections) {
      for (const id of collectImageMarkerIds(sec.content)) {
        if (!chapterOfMarker.has(id)) chapterOfMarker.set(id, ch.id);
      }
    }
  }

  const bookLike = {
    id: 'live-agni',
    title: 'Самоучитель для Архата',
    author: 'Деменко Денис',
    chapters,
    illustrations: images.map((img) => {
      const order = Number(img.id.slice('docx-img-'.length));
      return {
        id: img.id,
        chapterId: chapterOfMarker.get(img.id) || chapters[0]?.id,
        url: dataUrl(order),
        caption: img.caption || '',
      };
    }),
    characters: [],
    coverConfig: {},
    layoutConfig: undefined,
  };

  const layout = { pageSize: 'A5' as const };
  const startedRender = Date.now();
  const rendered = await renderBookPdf(bookToPdfInput(bookLike as never), layout as never);
  console.log(`     (${rendered.pageCount} стор., ${mb(rendered.bytes.length)}, ${Date.now() - startedRender} мс)`);

  t('усі картинки вставлено — жодної примітки про втрату',
    rendered.notesUk.length === 0,
    JSON.stringify(rendered.notesUk).slice(0, 200));

  const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
  const parsedBytes = await PDFDocument.load(rendered.bytes);
  const pagesWithImages: number[] = [];
  parsedBytes.getPages().forEach((page, i) => {
    const res = (page as unknown as { node: { Resources(): unknown } }).node.Resources() as
      | { lookup(name: unknown, type: unknown): unknown }
      | undefined;
    const xo = res?.lookup(PDFName.of('XObject'), PDFDict) as
      | { entries?: () => Array<[unknown, unknown]> }
      | undefined;
    if (!xo?.entries) return;
    for (const [, ref] of xo.entries()) {
      const obj = (res as unknown as {
        context: { lookup(r: unknown): { dict?: { get(n: unknown): unknown } } | undefined };
      }).context.lookup(ref);
      if (String(obj?.dict?.get(PDFName.of('Subtype')) ?? '') === '/Image') {
        pagesWithImages.push(i + 1);
        return;
      }
    }
  });
  pagesWithImages.sort((a, b) => a - b);
  t('картинок у PDF не менше, ніж у книзі',
    pagesWithImages.length >= images.length,
    `${pagesWithImages.length} сторінок із картинками проти ${images.length} ілюстрацій`);

  /* Купа в кінці першого розділу виглядала б так: усі картинки на кількох
     перших сторінках. Тепер місце задає рукопис, тож картинки мусять бути
     розкидані по всій книзі. */
  const spread = pagesWithImages[pagesWithImages.length - 1] - pagesWithImages[0];
  t('картинки розкидані по книзі, а не зібрані на початку',
    spread > rendered.pageCount * 0.5,
    `від с.${pagesWithImages[0]} до с.${pagesWithImages[pagesWithImages.length - 1]} з ${rendered.pageCount}`);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { pathToFileURL } = await import('node:url');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  ).href;
  const task = pdfjs.getDocument({
    data: rendered.bytes.slice(),
    useWorkerFetch: false,
    standardFontDataUrl: `${pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href}/`,
  } as never);
  const doc = (await task.promise) as { numPages: number; getPage(n: number): Promise<any> };
  let allText = '';
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    allText += content.items.map((i: { str: string }) => i.str).join('') + '\n';
  }
  t('жодного маркера не надруковано як текст', !allText.includes('[IMG:'), allText.slice(0, 160));

  /* Останній маркер рукопису (`docx-img-41`, «Слушайте музыку») — найкраща
     перевірка місця: якщо картинки й далі йдуть купою після вступу, його
     сторінка виявиться близько до початку. */
  const lastMarkerId = images[images.length - 1].id;
  const lastCaption = images[images.length - 1].caption;
  if (lastCaption) {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      if (content.items.map((i: { str: string }) => i.str).join('').includes(lastCaption)) {
        t(`останній маркер (${lastMarkerId}) надруковано в кінці книги`,
          p > doc.numPages * 0.5,
          `підпис «${lastCaption}» на с.${p} з ${doc.numPages}`);
        break;
      }
    }
  }

  fs.writeFileSync('/tmp/nova-live-agni.pdf', rendered.bytes);
  console.log(`  -> /tmp/nova-live-agni.pdf (${rendered.pageCount} стор., ${mb(rendered.bytes.length)})`);
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
