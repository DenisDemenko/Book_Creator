/**
 * Перетворення HTML, який дає `mammoth.convertToHtml`, у текст рукопису з
 * маркерами зображень — для майстра «Перенесення книги з іншого сервісу».
 *
 * НАВІЩО ОКРЕМО ВІД КОМПОНЕНТА. `mammoth.extractRawText` (те, що візард
 * викликав раніше) віддає лише текст і **мовчки викидає всі картинки** — тому
 * .docx із 42 зображеннями переносився як голий текст. `convertToHtml`
 * зберігає позиції картинок у потоці, і саме цей порядок потрібен, щоб
 * поставити маркери `[IMG: id "підпис"]` там, де вони стояли в документі.
 *
 * ЧОМУ ПЛЕЙСХОЛДЕРИ, А НЕ `data:`-URL. На справжній книзі (36 МБ, 42
 * картинки) HTML із вбудованими base64 роздувся до **52 МБ** рядка — це і
 * пам'ять, і час. Тому картинки збираються в масив окремо, а в HTML
 * підставляється короткий `src="docx-image://N"`; цей файл розпізнає
 * плейсхолдер і повертає і `text`, і перелік картинок. Результат: HTML
 * лишається ~600 КБ, а байти картинок нікуди не дублюються.
 *
 * Це чиста функція без DOM — свідомо, щоб її можна було прогнати тестом у
 * Node (`tsx scripts/test-docxManuscript.mts`), як і решту утиліт проєкту.
 */

export interface DocxManuscriptImage {
  /** id майбутньої ілюстрації книги; той самий, що в маркері `[IMG: …]`. */
  id: string;
  /** `alt` із .docx (Word іноді його зберігає) або порожній рядок. */
  caption: string;
}

export interface DocxManuscript {
  text: string;
  images: DocxManuscriptImage[];
}

/** Префікс плейсхолдера, який `convertImage` ставить замість справжнього src. */
export const DOCX_IMAGE_SRC_PREFIX = 'docx-image://';

/**
 * Підпис для маркера не має містити лапок і `]` — інакше зламався б розбір
 * маркера в `utils/manuscriptDoc.ts`.
 */
function sanitizeCaption(caption: string): string {
  return caption.replace(/["\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const dq = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  if (dq) return dq[1];
  const sq = new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return sq ? sq[1] : null;
}

/**
 * HTML → текст рукопису. Зберігає:
 *   • порядок абзаців і позиції зображень (`[IMG: docx-img-N "підпис"]`);
 *   • `**жирний**` і `*курсив*` — ті самі маркери, які редактор книги вміє
 *     читати (`utils/manuscriptDoc.ts`), тож авторське виділення не губиться;
 *   • заголовки h1-h2 як `# `, h3+ як `## ` — рівно ті форми, які розуміє
 *     і розбирач глав майстра (`utils/manuscriptImport.ts`), і редактор.
 * Свідомо НЕ зберігає: посилання (лишається текст), таблиці (лишається
 * текст комірок), зноски .docx — це окремі задачі, і мовчазна підміна тут
 * гірша за чесну втрату.
 */
export function htmlToManuscript(html: string): DocxManuscript {
  const images: DocxManuscriptImage[] = [];
  let out = html || '';

  // 1. Зображення — першими, поки в теґу ще видно `alt` і `src`.
  out = out.replace(/<img\b[^>]*\/?>/gi, (tag) => {
    const src = attr(tag, 'src') || '';
    const match = new RegExp(`^${DOCX_IMAGE_SRC_PREFIX}(\\d+)$`).exec(src);
    const id = `docx-img-${match ? match[1] : images.length}`;
    const caption = sanitizeCaption(decodeEntities(attr(tag, 'alt') || ''));
    images.push({ id, caption });
    return `\n\n[IMG: ${id} "${caption}"]\n\n`;
  });

  // 2. Заголовки — до решти теґів, щоб рівень не загубився.
  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_full, level: string, body: string) => {
    const hashes = Number(level) <= 2 ? '#' : '##';
    return `\n\n${hashes} ${body.replace(/<[^>]+>/g, '').trim()}\n\n`;
  });

  // 3. Блокові межі.
  out = out.replace(/<(p|div)\b[^>]*>/gi, '\n\n');
  out = out.replace(/<\/(p|div)\s*>/gi, '\n\n');
  out = out.replace(/<li\b[^>]*>/gi, '\n- ');
  out = out.replace(/<\/(ul|ol|li)\s*>/gi, '\n\n');
  out = out.replace(/<(ul|ol)\b[^>]*>/gi, '\n\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');

  // 4. Інлайн-наголос у маркери книги.
  out = out.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  out = out.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  out = out.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  out = out.replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // 5. Посилання: лишаємо видимий текст, URL відкидаємо (маркера посилань у
  //    цьому шляху немає — див. заголовок файлу).
  out = out.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  // 6. Усе решта теґів — геть, далі сутності й пробіли.
  out = out.replace(/<[^>]+>/g, '');
  out = decodeEntities(out);
  out = out
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: out, images };
}
