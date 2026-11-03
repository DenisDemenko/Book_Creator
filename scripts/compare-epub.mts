/**
 * Порівняння двох EPUB поруч — пункт 0.4 плану.
 *
 * ЧОМУ НЕ «подивитися в читалці». Подивитися все одно треба, і цей скрипт
 * того не заміняє: він відповідає на інше питання — чи однаковий ВМІСТ і чи
 * обидва файли взагалі валідні як EPUB. Читалка показує вигляд; тут видно
 * те, чого в ній не видно: скільком главам не дісталося запису в змісті,
 * скільки тексту втрачено між моделлю книги й архівом, чи лежить `mimetype`
 * першим і без стиснення (без цього частина читалок відмовляє), чи є
 * унікальний ідентифікатор і NCX для старих читалок.
 *
 * Третім аргументом можна дати `book.json` — тоді кожен файл перевіряється на
 * повноту: чи є в ньому ВСІ заголовки глав із самої книги і чи кожен дістав
 * рядок у змісті. Саме це питання коштувало найдорожче в записах #472–#476:
 * текст на місці, а заголовок зник зі змісту — і глави в читалці нема.
 *
 * Запуск: npx tsx scripts/compare-epub.mts <a.epub> <b.epub> [book.json]
 */
import fs from 'node:fs/promises';
import JSZip from 'jszip';

/*
 * Порівнюються НОРМАЛІЗОВАНІ назви, а не рядки як є.
 *
 * Перший прогін цього інструменту звітував, що в верстковому EPUB немає
 * глави 7 — а вона там була. Назва в книзі містить зірочки
 * («Глава 7. *Ариэль … *Гости.»), верстка їх прибирає, і точне порівняння
 * підрядка оголосило главу втраченою. Хибна тривога тут дорожча за
 * пропущену: саме через неї попередня сесія могла б піти шукати
 * неіснуючу поломку.
 */
function normalizeTitle(value: string): string {
  return value
    .replace(/[*_`~#]+/g, '')
    .replace(/[“”«»„"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textOf(xml: string): string {
  return xml
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const bookPath = process.argv[4];
let chapterTitles: string[] = [];
if (bookPath) {
  const parsed = JSON.parse(await fs.readFile(bookPath, 'utf8'));
  const book = parsed.book || parsed;
  chapterTitles = (Array.isArray(book.chapters) ? book.chapters : [])
    .map((c: any) => String(c?.title || '').trim())
    .filter(Boolean);
}

async function describe(file: string) {
  const bytes = await fs.readFile(file);
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  // `mimetype` мусить бути ПЕРШИМ записом і БЕЗ стиснення — вимога EPUB,
  // і саме її порушення робить архів нечитним для частини читалок.
  const firstEntry = names[0];
  const mimetype = zip.file('mimetype') ? (await zip.file('mimetype')!.async('string')).trim() : null;

  const opfName = names.find((n) => n.endsWith('.opf'));
  const opf = opfName ? await zip.file(opfName)!.async('string') : '';
  const version = /<package[^>]*version="([^"]+)"/.exec(opf)?.[1] ?? null;
  const identifier = /<dc:identifier[^>]*>([^<]+)</.exec(opf)?.[1] ?? null;
  const language = /<dc:language[^>]*>([^<]+)</.exec(opf)?.[1] ?? null;
  const title = /<dc:title[^>]*>([^<]+)</.exec(opf)?.[1] ?? null;
  const manifestItems = (opf.match(/<item\b[^>]*\/>/g) || []).length;
  const spine = (opf.match(/<itemref\b[^>]*\/>/g) || []).length;

  const navName = names.find((n) => /nav\.x?html?$/i.test(n));
  const nav = navName ? await zip.file(navName)!.async('string') : '';
  const navLinks = (nav.match(/<a\b[^>]*href=/g) || []).length;
  const ncxName = names.find((n) => n.endsWith('.ncx'));
  const ncx = ncxName ? await zip.file(ncxName)!.async('string') : '';
  const navPoints = (ncx.match(/<navPoint\b/g) || []).length;

  const docs = names.filter((n) => /\.x?html$/i.test(n) && n !== navName).sort();
  let chars = 0;
  const perDoc: Array<{ name: string; chars: number }> = [];
  for (const name of docs) {
    const body = await zip.file(name)!.async('string');
    const t = textOf(body);
    chars += t.length;
    perDoc.push({ name, chars: t.length });
  }

  // Заголовки шукаються у ВСЬОМУ тексті документів, а записи змісту — окремо:
  // це два різні провали, і розрізняти їх обов'язково.
  let allText = '';
  for (const name of names.filter((n) => /\.x?html$/i.test(n))) {
    allText += ' ' + textOf(await zip.file(name)!.async('string'));
  }
  const navLabels = [...nav.matchAll(/<a\s[^>]*>([^<]*)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  const normalizedText = normalizeTitle(allText);
  const normalizedNav = navLabels.map(normalizeTitle);
  const missingInText = chapterTitles.filter((t) => !normalizedText.includes(normalizeTitle(t)));
  const missingInNav = chapterTitles.filter((t) => {
    const n = normalizeTitle(t);
    return !normalizedNav.some((l) => l.includes(n) || (n.length > 3 && n.includes(l)));
  });

  const images = names.filter((n) => /\.(png|jpe?g|webp|gif|svg)$/i.test(n));
  const css = names.filter((n) => /\.css$/i.test(n));

  return {
    file,
    bytes: bytes.length,
    entries: names.length,
    firstEntry,
    mimetypeOk: firstEntry === 'mimetype' && mimetype === 'application/epub+zip',
    mimetype,
    version,
    title,
    language,
    hasIdentifier: !!identifier,
    manifestItems,
    spine,
    contentDocs: docs.length,
    textChars: chars,
    navLinks,
    hasNcx: !!ncxName,
    navPoints,
    images: images.length,
    css: css.length,
    chaptersChecked: chapterTitles.length,
    chaptersMissingInText: missingInText.length,
    chaptersMissingInNav: missingInNav.length,
    missingInText,
    missingInNav,
    navLabels,
    perDoc,
  };
}

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('Треба два файли: npx tsx scripts/compare-epub.mts <a.epub> <b.epub>');

const left = await describe(a);
const right = await describe(b);

for (const side of [left, right]) {
  const { perDoc, navLabels, missingInText, missingInNav, ...rest } = side;
  console.log('---', side.file);
  console.log(rest);
  console.log('документи:', perDoc.map((d) => `${d.name.replace(/^.*\//, '')}:${d.chars}`).join(' '));
  console.log('зміст:', JSON.stringify(navLabels));
  if (missingInText.length) console.log('НЕМА В ТЕКСТІ:', missingInText.join(' | '));
  if (missingInNav.length) console.log('НЕМА В ЗМІСТІ:', missingInNav.join(' | '));
}

console.log('=== різниця ===');
console.log({
  bytes: `${left.bytes} vs ${right.bytes}`,
  contentDocs: `${left.contentDocs} vs ${right.contentDocs}`,
  textChars: `${left.textChars} vs ${right.textChars}`,
  textCharsDelta: left.textChars - right.textChars,
  navLinks: `${left.navLinks} vs ${right.navLinks}`,
  images: `${left.images} vs ${right.images}`,
  version: `${left.version} vs ${right.version}`,
  mimetypeOk: `${left.mimetypeOk} vs ${right.mimetypeOk}`,
  hasNcx: `${left.hasNcx} vs ${right.hasNcx}`,
  chaptersMissingInText: `${left.chaptersMissingInText} vs ${right.chaptersMissingInText}`,
  chaptersMissingInNav: `${left.chaptersMissingInNav} vs ${right.chaptersMissingInNav}`,
});
