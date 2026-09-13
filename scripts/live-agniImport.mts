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
import { htmlToManuscript, DOCX_IMAGE_SRC_PREFIX } from '../src/utils/docxManuscript.ts';
import { parseManuscriptText } from '../src/utils/manuscriptImport.ts';

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
  const collected: { contentType: string; base64: string }[] = [];
  const started = Date.now();
  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement((image: any) => {
        const index = collected.length;
        return image.read('base64').then((data: string) => {
          collected.push({ contentType: image.contentType, base64: data });
          return { src: `${DOCX_IMAGE_SRC_PREFIX}${index}` };
        });
      }),
    }
  );
  const htmlValue: string = result.value;
  const { text, images } = htmlToManuscript(htmlValue);
  const imageBytes = collected.reduce((sum, i) => sum + Math.round((i.base64.length * 3) / 4), 0);

  t(`документ прочитано (${mb(buf.length)} за ${Date.now() - started} мс)`, buf.length > 0);
  t('HTML лишився легким (плейсхолдери, не base64)', htmlValue.length < 5_000_000, `${mb(htmlValue.length)}`);
  t('зображення витягнуто', collected.length > 0, `їх ${collected.length} на ${mb(imageBytes)}`);
  t('усі зображення описані в тексті', images.length === collected.length, `${images.length} проти ${collected.length}`);

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
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
