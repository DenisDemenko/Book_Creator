/**
 * Рушій верстки PDF. Єдиний на обидва варіанти (макет від коду й макет від
 * моделі) — див. коментар у pdfTypes.ts.
 *
 * ЩО ТУТ ДОВОДИТЬСЯ РОБИТИ РУКАМИ І ЧОМУ. `pdf-lib` — не рушій верстки, а
 * бібліотека для складання PDF: вона вміє покласти рядок у координату й
 * порахувати його ширину, і на цьому все. Тому перенос слів, вирівнювання
 * по ширині, розриви сторінок і колонтитули написані тут явно. Це не
 * винахід велосипеда: браузерного рушія на Railway немає, а тягнути
 * headless Chromium заради PDF — це +300 МБ образу.
 *
 * Кирилиця: стандартні шрифти PDF покривають лише латиницю (WinAnsi), тож
 * шрифт вбудовується з файлу через fontkit. Файли лежать поруч, у fonts/,
 * разом із ліцензією — DejaVu вільний, зміни в ньому в суспільному надбанні.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAYOUT_SPEC,
  PAGE_SIZES,
  type Align,
  type FontChoice,
  type HeadingStyle,
  type PdfBookInput,
  type PdfLayoutSpec,
} from './pdfTypes';
import { loadImageBytes } from '../media/imageBytes';

export const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');

export const FONT_FILES = {
  serif: 'DejaVuSerif.ttf',
  serifBold: 'DejaVuSerif-Bold.ttf',
  sansBold: 'DejaVuSans-Bold.ttf',
} as const;

export function fontsAvailable(): boolean {
  return Object.values(FONT_FILES).every((f) => fs.existsSync(path.join(FONT_DIR, f)));
}

/**
 * Текст розділу приходить як «rich text or markdown» (types.ts). Рендерер
 * не претендує на повний markdown: він знімає розмітку, яка інакше
 * надрукувалась би як символи, і ділить на абзаци. Свідомо просто —
 * напівпідтримка markdown гірша за її відсутність, бо виглядає як помилка
 * верстки, а не як межа можливостей.
 */
export function toParagraphs(content: string): string[] {
  const plain = String(content ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n?/g, '\n');
  return plain
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

interface Measurable {
  widthOfTextAtSize(text: string, size: number): number;
}

/**
 * Перенос по словах. Слово, довше за рядок (посилання, довгий термін),
 * ріжеться посимвольно — інакше воно вилізло б за поле і мовчки обрізалось
 * при друці.
 */
export function wrapText(
  text: string,
  font: Measurable,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  const pushLongWord = (word: string) => {
    let chunk = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      pushLongWord(word);
    } else {
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface RenderResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Скільки сторінок пронумеровано — для звіту в інтерфейсі. */
  numberedPages: number;
  /**
   * Що рушій зробив інакше, ніж просив автор — конкретно ілюстрація, яку не
   * вдалося вставити (формат, який `pdf-lib` не вміє, або файл, якого не
   * знайшлося). Порожньо — значить, усе вставлено як є. Той самий принцип
   * чесності, що й у `notesUk` зовнішніх рушіїв (#101, #109): мовчазний
   * відкіт заборонений, автор бачить причину до того, як відкриє готовий PDF.
   */
  notesUk: string[];
}

export interface RenderContext {
  /** Власник книги — потрібен лише для посилань на медіатеку (#100). */
  ownerId?: string | null;
  /**
   * Кеш байтів зображення за посиланням. Друкована редакція (`pdfKdp.ts`)
   * верстає книгу до трьох разів поспіль, шукаючи корінець під фактичний
   * обсяг, — без кешу той самий файл читався б (а посилання `http(s)` —
   * запитувалося мережею) стільки ж разів.
   */
  imageCache?: Map<string, { mimeType: string; bytes: Buffer }>;
}

async function loadImageCached(
  url: string,
  ownerId: string | null | undefined,
  cache?: Map<string, { mimeType: string; bytes: Buffer }>
): Promise<{ mimeType: string; bytes: Buffer }> {
  if (cache?.has(url)) return cache.get(url)!;
  const result = await loadImageBytes(url, ownerId);
  cache?.set(url, result);
  return result;
}

export async function renderBookPdf(
  book: PdfBookInput,
  specInput?: Partial<PdfLayoutSpec>,
  context?: RenderContext
): Promise<RenderResult> {
  if (!fontsAvailable()) {
    throw new Error(
      `Шрифти для PDF не знайдено в ${FONT_DIR}. Без вбудованого шрифту кирилиця в PDF неможлива.`
    );
  }

  const spec: PdfLayoutSpec = { ...DEFAULT_LAYOUT_SPEC, ...specInput } as PdfLayoutSpec;
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(book.title);
  if (book.author) doc.setAuthor(book.author);
  doc.setProducer('NOVA STUDIO');

  const serif = await doc.embedFont(fs.readFileSync(path.join(FONT_DIR, FONT_FILES.serif)), {
    subset: true,
  });
  const serifBold = await doc.embedFont(
    fs.readFileSync(path.join(FONT_DIR, FONT_FILES.serifBold)),
    { subset: true }
  );
  const sansBold = await doc.embedFont(fs.readFileSync(path.join(FONT_DIR, FONT_FILES.sansBold)), {
    subset: true,
  });

  const pick = (choice: FontChoice, bold: boolean) =>
    bold ? (choice === 'sans' ? sansBold : serifBold) : serif;

  const size =
    spec.pageWidthPt && spec.pageHeightPt
      ? { width: spec.pageWidthPt, height: spec.pageHeightPt }
      : PAGE_SIZES[spec.pageSize] || PAGE_SIZES.A5;
  const contentWidth = size.width - spec.margins.left - spec.margins.right;
  const contentHeight = size.height - spec.margins.top - spec.margins.bottom;
  const black = rgb(0.1, 0.09, 0.08);
  const grey = rgb(0.45, 0.43, 0.4);
  const ownerId = context?.ownerId ?? null;
  const notesUk: string[] = [];

  /**
   * Ліве поле поточної сторінки. При дзеркальних полях перша сторінка —
   * права (recto), корінець у неї зліва; на звороті все навпаки.
   */
  const leftOfPage = (index: number) =>
    spec.mirrorMargins && index % 2 === 1 ? spec.margins.right : spec.margins.left;

  let page = doc.addPage([size.width, size.height]);
  let pageIndex = 0;
  let curLeft = leftOfPage(0);
  let y = size.height - spec.margins.top;
  let bodyStarted = false;
  let currentChapter = '';

  /**
   * Індекс сторінки, з якої починається тіло книги. Усе до неї — титул і
   * передмова — нумерації не отримує.
   *
   * Рахується як позиція сторінки в момент початку першої глави, а НЕ
   * лічильником у newPage(): лічильник помилявся рівно на одиницю, бо
   * сторінка, створена ПІСЛЯ титулу, — це вже перша сторінка тіла, а не
   * друга сторінка передмови. Через це в книзі з титулом нумерація
   * починалася з другої сторінки тіла, і номер «1» не з'являвся ніде.
   */
  let bodyStartPage = spec.titlePage.show ? 1 : 0;

  const newPage = () => {
    page = doc.addPage([size.width, size.height]);
    pageIndex += 1;
    curLeft = leftOfPage(pageIndex);
    y = size.height - spec.margins.top;
  };

  const ensure = (needed: number) => {
    if (y - needed < spec.margins.bottom) newPage();
  };

  const drawLine = (
    text: string,
    font: typeof serif,
    fontSize: number,
    align: Align,
    color = black,
    justifyWidth?: number,
    /** Ліва межа рядка. Задається явно: при дзеркальних полях і при
     *  червоному рядку вона відрізняється від поля сторінки. */
    x0 = curLeft,
    boxWidth = contentWidth
  ) => {
    const width = font.widthOfTextAtSize(text, fontSize);
    let x = x0;
    if (align === 'center') x = x0 + (boxWidth - width) / 2;

    // Вирівнювання по ширині: розсуваємо міжслівні проміжки, а не літери —
    // розрідження літер у книжковому наборі читається як дефект.
    if (align === 'justify' && justifyWidth && justifyWidth > width) {
      const words = text.split(' ');
      if (words.length > 1) {
        const extra = (justifyWidth - width) / (words.length - 1);
        let cursor = x;
        for (const word of words) {
          page.drawText(word, { x: cursor, y, size: fontSize, font, color });
          cursor += font.widthOfTextAtSize(word, fontSize) + font.widthOfTextAtSize(' ', fontSize) + extra;
        }
        return;
      }
    }
    page.drawText(text, { x, y, size: fontSize, font, color });
  };

  const drawParagraph = (text: string, indentFirst: boolean) => {
    const font = pick(spec.bodyFont, false);
    const step = spec.baseFontSize * spec.lineHeight;
    const indent = indentFirst ? spec.paragraphIndent : 0;
    const firstWidth = contentWidth - indent;

    const firstLines = wrapText(text, font, spec.baseFontSize, firstWidth);
    if (firstLines.length === 0) return;

    // Перший рядок із червоним рядком міряється вужчим, решта — на повну.
    const rest = firstLines.slice(1).join(' ');
    const restLines = rest ? wrapText(rest, font, spec.baseFontSize, contentWidth) : [];
    const lines = [firstLines[0], ...restLines];

    lines.forEach((line, i) => {
      ensure(step);
      const isLast = i === lines.length - 1;
      // Червоний рядок зсуває ЛИШЕ перший рядок абзацу; решта йде від поля
      // сторінки, яке при дзеркальних полях залежить від її парності.
      const x = i === 0 ? curLeft + indent : curLeft;
      const width = i === 0 ? firstWidth : contentWidth;
      const align: Align = spec.bodyAlign === 'justify' && !isLast ? 'justify' : 'left';
      drawLine(line, font, spec.baseFontSize, align, black, width, x, width);
      y -= step;
    });
    y -= spec.paragraphSpacing;
  };

  /**
   * Ілюстрація книги: зображення, вписане в смугу набору за шириною й у
   * висоту сторінки — не розтягнуте понад оригінал (та сама межа, що й
   * `img { max-width: 100% }` у `bookHtml.ts`), — і підпис під ним.
   *
   * `pdf-lib` уміє вбудувати лише PNG і JPEG: інший формат чи файл, якого
   * не прочитати (медіатека іншого власника, видалений запис, недоступна
   * мережа), — не привід тихо пропустити ілюстрацію. Причина йде одразу в
   * двох місцях: підписом просто в тексті книги (автор бачить її й без
   * інтерфейсу) і рядком у `notesUk` (автор бачить її ДО завантаження файлу).
   */
  const drawIllustration = async (ill: { url: string; caption?: string }) => {
    const captionText = String(ill.caption || '').trim();
    const label = captionText || ill.url;
    let embedded: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
    let failureUk = '';

    try {
      const { mimeType, bytes } = await loadImageCached(ill.url, ownerId, context?.imageCache);
      if (/png/i.test(mimeType)) {
        embedded = await doc.embedPng(bytes);
      } else if (/jpe?g/i.test(mimeType)) {
        embedded = await doc.embedJpg(bytes);
      } else {
        failureUk =
          `формат ${mimeType} не підтримується власною версткою (лише PNG і JPEG) — ` +
          'зверстайте книгу рушієм «Chromium» або «pandoc + Eisvogel»';
      }
    } catch (err) {
      // `pdf-lib` кидає на биті PNG-байти не `Error`, а РЯДОК (перевірено
      // живим прогоном) — `(err as Error).message` на ньому мовчки дало б
      // `undefined`, і автор побачив би причину без причини.
      failureUk = err instanceof Error ? err.message : String(err);
    }

    if (!embedded) {
      notesUk.push(`Ілюстрація «${label}» не вставлена: ${failureUk}.`);
      // Підпис лишається текстом — читач бачить, що тут малась бути
      // ілюстрація, а не порожнє місце без пояснення.
      if (captionText) {
        ensure(spec.baseFontSize * spec.lineHeight + spec.paragraphSpacing);
        drawLine(`Ілюстрація: ${captionText}`, serif, spec.baseFontSize, 'center', grey);
        y -= spec.baseFontSize * spec.lineHeight + spec.paragraphSpacing;
      }
      return;
    }

    const dims = embedded.size();
    // Висота обмежена часткою смуги набору (як `0.8\textheight` у
    // pandocEngine.ts) — на всю висоту сторінки ілюстрація налізла б на
    // колонтитул і номер; маленька картинка не розтягується понад оригінал.
    const maxHeight = contentHeight * 0.6;
    const scale = Math.min(contentWidth / dims.width, maxHeight / dims.height, 1);
    const w = dims.width * scale;
    const h = dims.height * scale;

    const captionSize = Math.max(7, Math.round(spec.baseFontSize * 0.85));
    const captionLines = captionText ? wrapText(captionText, serif, captionSize, contentWidth) : [];
    const captionStep = captionSize * 1.3;
    const gap = 8;
    const needed = h + gap + captionLines.length * captionStep + spec.paragraphSpacing;
    ensure(needed);

    const x = curLeft + (contentWidth - w) / 2;
    page.drawImage(embedded, { x, y: y - h, width: w, height: h });
    y -= h + gap;
    for (const line of captionLines) {
      drawLine(line, serif, captionSize, 'center', grey);
      y -= captionStep;
    }
    y -= spec.paragraphSpacing;
  };

  /**
   * Скільки рядків тексту мусить лишитись під заголовком на тій самій
   * сторінці. Два — мінімум, за яким заголовок перестає бути «висячим»:
   * заголовок в останньому рядку сторінки, а текст під ним — на наступній,
   * це класичний дефект набору, і жодне число сторінок його не викриє.
   */
  const WIDOW_LINES = 2;

  const drawHeading = (text: string, style: HeadingStyle) => {
    const font = pick(style.font, true);
    const label = style.uppercase ? text.toUpperCase() : text;
    const step = style.fontSize * 1.25;
    const lines = wrapText(label, font, style.fontSize, contentWidth);

    // Місце рахуємо ЗАЗДАЛЕГІДЬ на весь заголовок разом із хвостом тексту
    // під ним — і переносимо на нову сторінку цілком, а не рядок за рядком.
    const needed =
      style.spaceBefore +
      lines.length * step +
      style.spaceAfter +
      WIDOW_LINES * spec.baseFontSize * spec.lineHeight;
    if (y - needed < spec.margins.bottom) newPage();

    y -= style.spaceBefore;
    for (const line of lines) {
      ensure(step);
      drawLine(line, font, style.fontSize, style.align === 'justify' ? 'left' : style.align);
      y -= step;
    }
    y -= style.spaceAfter;
  };

  // --- титул -------------------------------------------------------------
  if (spec.titlePage.show) {
    const titleFont = pick('serif', true);
    const centerY = size.height * 0.62;
    y = centerY;
    for (const line of wrapText(book.title, titleFont, spec.titlePage.titleSize, contentWidth)) {
      drawLine(line, titleFont, spec.titlePage.titleSize, 'center');
      y -= spec.titlePage.titleSize * 1.3;
    }
    if (book.subtitle) {
      y -= 10;
      for (const line of wrapText(book.subtitle, serif, spec.titlePage.subtitleSize, contentWidth)) {
        drawLine(line, serif, spec.titlePage.subtitleSize, 'center', grey);
        y -= spec.titlePage.subtitleSize * 1.35;
      }
    }
    if (book.author) {
      y = spec.margins.bottom + 60;
      drawLine(book.author, serif, spec.titlePage.authorSize, 'center', grey);
    }
    newPage();
  }

  // --- тіло --------------------------------------------------------------
  for (const chapter of book.chapters) {
    if (spec.chapterStartsNewPage && (bodyStarted || !spec.titlePage.show)) {
      if (bodyStarted) newPage();
    }
    if (!bodyStarted) {
      bodyStartPage = doc.getPageCount() - 1;
    }
    bodyStarted = true;
    currentChapter = chapter.title;
    drawHeading(chapter.title, spec.chapterTitle);

    for (const section of chapter.sections) {
      if (section.title) drawHeading(section.title, spec.sectionTitle);
      const paragraphs = toParagraphs(section.content);
      paragraphs.forEach((paragraph, index) => {
        drawParagraph(paragraph, spec.paragraphIndent > 0 && index > 0);
      });
    }

    // Ілюстрації глави — у кінці, після всіх розділів. Книга не зберігає
    // точнішого місця вставки (пояснено в `bookToMarkdown.ts` і в
    // `PdfBookInput.illustrations`); той самий порядок, що й у Chromium і
    // pandoc, тож три рушії дають ту саму книгу з тими самими картинками на
    // тому самому місці, а не три різні.
    for (const ill of book.illustrations || []) {
      if (!chapter.id || ill.chapterId !== chapter.id) continue;
      await drawIllustration(ill);
    }
  }

  // --- колонтитули й нумерація -------------------------------------------
  const pages = doc.getPages();
  let numbered = 0;
  pages.forEach((p, index) => {
    const isFront = spec.pageNumber.skipFrontMatter && index < bodyStartPage;
    if (spec.runningHead.show && !isFront) {
      const head =
        spec.runningHead.content === 'author'
          ? book.author || book.title
          : spec.runningHead.content === 'chapter'
            ? currentChapter || book.title
            : book.title;
      const w = serif.widthOfTextAtSize(head, spec.runningHead.fontSize);
      p.drawText(head, {
        x: (size.width - w) / 2,
        y: size.height - spec.margins.top / 2,
        size: spec.runningHead.fontSize,
        font: serif,
        color: grey,
      });
    }
    if (!spec.pageNumber.show || isFront) return;
    numbered += 1;
    const label = String(spec.pageNumber.startAt + numbered - 1);
    const w = serif.widthOfTextAtSize(label, spec.pageNumber.fontSize);
    const pos = spec.pageNumber.position;
    // Номер теж мусить рахуватися від поля ЦІЄЇ сторінки, інакше на
    // дзеркальному розвороті він з'їжджає до згину.
    const pageLeft = leftOfPage(index);
    const pageRight = spec.margins.left + spec.margins.right - pageLeft;
    const x = pos.endsWith('left')
      ? pageLeft
      : pos.endsWith('right')
        ? size.width - pageRight - w
        : (size.width - w) / 2;
    const yy = pos.startsWith('top')
      ? size.height - spec.margins.top / 2
      : spec.margins.bottom / 2;
    p.drawText(label, { x, y: yy, size: spec.pageNumber.fontSize, font: serif, color: grey });
  });

  return { bytes: await doc.save(), pageCount: pages.length, numberedPages: numbered, notesUk };
}
