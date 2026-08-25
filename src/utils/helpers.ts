// Text diff calculation, QR code generation, and document layout utilities
import QRCode from 'qrcode';
import { Book, Chapter, Section, Footnote, QRTag, TOCLeaderStyle, TOCNumberingStyle, PdfChapterLayout, PdfFrameObject, TOCConfig } from '../types';

export function calculateWordCount(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length;
}

export function estimateReadingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

export function estimatePageCount(
  totalWords: number,
  formatPreset: string,
  fontSizePt: number,
  lineHeight: number
): number {
  // Approximate words per page based on format and typography
  let baseWordsPerPage = 280; // Standard 6x9" paperback with 10.5pt
  if (formatPreset === 'A4') baseWordsPerPage = 550;
  else if (formatPreset === 'A5') baseWordsPerPage = 320;
  else if (formatPreset === 'A6') baseWordsPerPage = 160;
  else if (formatPreset === '5x8') baseWordsPerPage = 230;
  else if (formatPreset === '7x10') baseWordsPerPage = 380;

  // Adjust for font size and line height
  const fontRatio = 11 / (fontSizePt || 11);
  const lineHeightRatio = 1.5 / (lineHeight || 1.5);
  const wordsPerPage = Math.max(80, Math.round(baseWordsPerPage * fontRatio * lineHeightRatio));

  return Math.max(1, Math.ceil(totalWords / wordsPerPage));
}

export interface DiffPart {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

// Simple word-by-word diff algorithm
export function computeWordDiff(original: string, modified: string): DiffPart[] {
  const origWords = original.split(/(\s+)/);
  const modWords = modified.split(/(\s+)/);
  const result: DiffPart[] = [];

  let i = 0;
  let j = 0;

  while (i < origWords.length || j < modWords.length) {
    if (i < origWords.length && j < modWords.length && origWords[i] === modWords[j]) {
      result.push({ type: 'unchanged', text: origWords[i] });
      i++;
      j++;
    } else if (j < modWords.length && (!origWords.slice(i).includes(modWords[j]) || origWords.length === 0)) {
      result.push({ type: 'added', text: modWords[j] });
      j++;
    } else if (i < origWords.length && (!modWords.slice(j).includes(origWords[i]) || modWords.length === 0)) {
      result.push({ type: 'removed', text: origWords[i] });
      i++;
    } else {
      let foundSync = false;
      for (let lookAhead = 1; lookAhead < 8; lookAhead++) {
        if (j + lookAhead < modWords.length && origWords[i] === modWords[j + lookAhead]) {
          for (let k = 0; k < lookAhead; k++) {
            result.push({ type: 'added', text: modWords[j + k] });
          }
          j += lookAhead;
          foundSync = true;
          break;
        }
        if (i + lookAhead < origWords.length && origWords[i + lookAhead] === modWords[j]) {
          for (let k = 0; k < lookAhead; k++) {
            result.push({ type: 'removed', text: origWords[i + k] });
          }
          i += lookAhead;
          foundSync = true;
          break;
        }
      }

      if (!foundSync) {
        if (i < origWords.length) {
          result.push({ type: 'removed', text: origWords[i] });
          i++;
        }
        if (j < modWords.length) {
          result.push({ type: 'added', text: modWords[j] });
          j++;
        }
      }
    }
  }

  const merged: DiffPart[] = [];
  for (const part of result) {
    if (merged.length > 0 && merged[merged.length - 1].type === part.type) {
      merged[merged.length - 1].text += part.text;
    } else {
      merged.push({ ...part });
    }
  }

  return merged;
}

export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Convert numbers to Roman numerals (e.g. 1 -> I, 4 -> IV, 9 -> IX)
export function toRomanNumeral(num: number): string {
  if (num <= 0) return '';
  const romanMap: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let result = '';
  let n = num;
  for (const [val, roman] of romanMap) {
    while (n >= val) {
      result += roman;
      n -= val;
    }
  }
  return result;
}

// Ukrainian Ordinal Words for Chapters
export function toUkrainianOrdinalWords(num: number): string {
  const ordinals = [
    '', 'Перша', 'Друга', 'Третя', 'Четверта', 'Пʼята',
    'Шоста', 'Сьома', 'Восьма', 'Девʼята', 'Десята',
    'Одинадцята', 'Дванадцята', 'Тринадцята', 'Чотирнадцята', 'Пʼятнадцята'
  ];
  return ordinals[num] || `Глава ${num}`;
}

export interface ComputedTOCItem {
  id: string;
  type: 'frontmatter' | 'chapter' | 'section' | 'appendix';
  title: string;
  subtitle?: string;
  displayNumber?: string;
  pageNumber: number | null;
  chapterIndex?: number;
  sectionIndex?: number;
}

// ---------------------------------------------------------------
// Уніфікована пагінація книги. Це ЄДИНЕ джерело правди про те, як текст
// розбивається на сторінки, — використовується «Розворотом книги»,
// «Змістом» та «Версткою PDF», тож номери сторінок скрізь збігаються.
// ---------------------------------------------------------------

export interface BookPage {
  type: 'title-page' | 'copyright-page' | 'dedication-page' | 'epigraph-page' | 'toc-page' | 'chapter-title' | 'body-page';
  title?: string;
  content?: string;
  author?: string;
  chapterIndex?: number;
  chapterId?: string;
  sectionId?: string;
}

const MAX_CHARS_PER_BODY_PAGE = 850;

export function buildBookPages(
  book: Book,
  /**
   * Опційна власна пагінація розділу — якщо задана, викликається ЗАМІСТЬ
   * евристики на 850 символів нижче (використовує utils/useRealBookPages.ts
   * для «Розворот книги», де сторінки рахуються за реальною відрендереною
   * висотою тексту, а не приблизною кількістю символів). Решта структури
   * (титульні сторінки, глави) лишається спільною для обох випадків.
   */
  sectionPager?: (sec: Section, chap: Chapter, chapterIndex: number) => BookPage[]
): BookPage[] {
  const pages: BookPage[] = [];
  const layout = book.layoutConfig;
  const tocConfig = layout.tocConfig || {
    leaderStyle: 'dots',
    numberingStyle: 'arabic',
    showSectionSubitems: true,
    showFrontMatter: true,
    title: 'Зміст',
    customPrefix: 'Глава',
    pageNumberPosition: 'right',
  };

  if (layout.frontMatter.showTitlePage) {
    pages.push({ type: 'title-page', title: book.title, content: book.subtitle || '', author: book.author });
  }
  if (layout.frontMatter.showCopyright) {
    pages.push({ type: 'copyright-page', title: 'Правова інформація', content: layout.frontMatter.copyrightText });
  }
  if (layout.frontMatter.showDedication && layout.frontMatter.dedicationText) {
    pages.push({ type: 'dedication-page', title: 'Посвята', content: layout.frontMatter.dedicationText });
  }
  if (layout.frontMatter.showEpigraph && layout.frontMatter.epigraphText) {
    pages.push({ type: 'epigraph-page', title: 'Епіграф', content: layout.frontMatter.epigraphText, author: layout.frontMatter.epigraphAuthor });
  }
  if (layout.frontMatter.showTableOfContents) {
    pages.push({ type: 'toc-page', title: tocConfig.title || 'ЗМІСТ' });
  }

  book.chapters.forEach((chap, cIdx) => {
    pages.push({
      type: 'chapter-title',
      title: chap.title,
      content: chap.description,
      chapterIndex: cIdx + 1,
      chapterId: chap.id,
    });

    chap.sections.forEach((sec) => {
      if (sectionPager) {
        pages.push(...sectionPager(sec, chap, cIdx + 1));
        return;
      }

      const paragraphs = sec.content.split('\n\n');
      let currentChunk = '';
      paragraphs.forEach((p) => {
        if (currentChunk.length + p.length > MAX_CHARS_PER_BODY_PAGE) {
          pages.push({
            type: 'body-page',
            title: sec.title,
            content: currentChunk,
            chapterIndex: cIdx + 1,
            chapterId: chap.id,
            sectionId: sec.id,
          });
          currentChunk = p + '\n\n';
        } else {
          currentChunk += p + '\n\n';
        }
      });

      if (currentChunk.trim().length > 0) {
        pages.push({
          type: 'body-page',
          title: sec.title,
          content: currentChunk,
          chapterIndex: cIdx + 1,
          chapterId: chap.id,
          sectionId: sec.id,
        });
      }
    });
  });

  return pages;
}

/** Номер першої сторінки глави (1-based) за спільною пагінацією. */
export function findPageNumberByChapter(book: Book, chapterId: string): number {
  const idx = buildBookPages(book).findIndex((p) => p.chapterId === chapterId);
  return idx === -1 ? 1 : idx + 1;
}

/**
 * Який номер сторінки показати на сторінці з індексом pageIndex (0-based),
 * з урахуванням «Початку нумерації» (layoutConfig.typography.pageNumberStart).
 * Повертає null, якщо сторінка не нумерується (вступні сторінки при режимах
 * 'after-toc'/'custom').
 */
export function getDisplayPageNumber(book: Book, pageIndex: number): number | null {
  const pages = buildBookPages(book);
  if (pageIndex < 0 || pageIndex >= pages.length) return null;

  const st = book.layoutConfig.typography?.pageNumberStart;
  const mode = st?.mode || 'title';

  if (mode === 'title') return pageIndex + 1;

  const firstContentIndex = pages.findIndex((p) => p.type === 'chapter-title');
  if (firstContentIndex === -1) return pageIndex + 1;
  if (pageIndex < firstContentIndex) return null; // вступні сторінки без номера

  const start = mode === 'custom' ? (st?.startNumber ?? 1) : 1;
  return pageIndex - firstContentIndex + start;
}

/** Видимий номер першої сторінки глави (з урахуванням «Початку нумерації»). */
export function getChapterDisplayPageNumber(book: Book, chapterId: string): number {
  const idx = buildBookPages(book).findIndex((p) => p.chapterId === chapterId);
  if (idx === -1) return 1;
  return getDisplayPageNumber(book, idx) ?? idx + 1;
}

// Calculate precise page numbers and Table of Contents items
export function computeTableOfContents(book: Book): ComputedTOCItem[] {
  const items: ComputedTOCItem[] = [];
  const layout = book.layoutConfig;
  const tocConfig = layout.tocConfig || {
    leaderStyle: 'dots',
    numberingStyle: 'arabic',
    showSectionSubitems: true,
    showFrontMatter: true,
    title: 'Зміст',
    customPrefix: 'Глава',
    pageNumberPosition: 'right',
  };

  // Єдина пагінація — ті самі сторінки, що й у «Розвороті книги»;
  // номери враховують «Початок нумерації» (вступні можуть бути null).
  const pages = buildBookPages(book);
  const idxOf = (pred: (p: BookPage) => boolean): number => pages.findIndex(pred); // -1, якщо нема
  const pageNumAt = (idx: number): number | null => (idx === -1 ? null : getDisplayPageNumber(book, idx));

  if (tocConfig.showFrontMatter) {
    const frontMatter = [
      { id: 'fm-title', type: 'title-page' as const, title: 'Титульний аркуш', enabled: layout.frontMatter.showTitlePage },
      { id: 'fm-copyright', type: 'copyright-page' as const, title: 'Правова інформація та копірайт', enabled: layout.frontMatter.showCopyright },
      { id: 'fm-dedication', type: 'dedication-page' as const, title: 'Посвята', enabled: layout.frontMatter.showDedication && !!layout.frontMatter.dedicationText },
      { id: 'fm-epigraph', type: 'epigraph-page' as const, title: 'Епіграф', enabled: layout.frontMatter.showEpigraph && !!layout.frontMatter.epigraphText },
    ];
    for (const fm of frontMatter) {
      if (!fm.enabled) continue;
      const idx = idxOf((p) => p.type === fm.type);
      if (idx === -1) continue;
      items.push({ id: fm.id, type: 'frontmatter', title: fm.title, pageNumber: pageNumAt(idx) });
    }
  }

  book.chapters.forEach((chap, cIdx) => {
    const chapIdx = idxOf((p) => p.chapterId === chap.id);
    if (chapIdx === -1) return;

    let displayNumber = '';
    if (tocConfig.numberingStyle === 'arabic') {
      displayNumber = `${tocConfig.customPrefix ? tocConfig.customPrefix + ' ' : ''}${cIdx + 1}`;
    } else if (tocConfig.numberingStyle === 'roman') {
      displayNumber = `${tocConfig.customPrefix ? tocConfig.customPrefix + ' ' : ''}${toRomanNumeral(cIdx + 1)}`;
    } else if (tocConfig.numberingStyle === 'words') {
      displayNumber = `${toUkrainianOrdinalWords(cIdx + 1)} ${tocConfig.customPrefix || 'глава'}`;
    }

    items.push({
      id: chap.id,
      type: 'chapter',
      title: chap.title,
      subtitle: chap.description,
      displayNumber,
      pageNumber: pageNumAt(chapIdx),
      chapterIndex: cIdx + 1,
    });

    if (tocConfig.showSectionSubitems) {
      chap.sections.forEach((sec, sIdx) => {
        const secIdx = idxOf((p) => p.sectionId === sec.id);
        if (secIdx === -1) return;
        items.push({
          id: sec.id,
          type: 'section',
          title: sec.title,
          pageNumber: pageNumAt(secIdx),
          chapterIndex: cIdx + 1,
          sectionIndex: sIdx + 1,
        });
      });
    }
  });

  return items;
}

// Generate Leader styling string for Table of Contents
export function getLeaderSymbol(style: TOCLeaderStyle): string {
  switch (style) {
    case 'dots':
      return ' . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ';
    case 'dashes':
      return ' - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ';
    case 'line':
      return ' _______________________________________________________________________________ ';
    case 'waves':
      return ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ';
    case 'double-dots':
      return ' : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : : ';
    case 'blank':
    default:
      return ' ';
  }
}

// Generate QR Code Data URL with customizable styling
export async function generateQrDataUrl(payload: string): Promise<string> {
  try {
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 256,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  } catch (err) {
    console.error('QR code generation error', err);
    return '';
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Перетворює вручну вставлені письменником маркери виносок у стилі
 * QRFootnotesView (`[^marker]`, наприклад `[^1]` чи `[^a]`) на видиму
 * верхню цифру-посилання. Раніше ці токени просто друкувалися як є (голий
 * `[^1]` посеред тексту) — це виправляється тут, незалежно від обраної
 * дизайн-теми, оскільки це помилка коректності друку, а не питання стилю.
 */
function linkifyFootnoteMarkers(text: string, sectionFootnotes: Footnote[], allFootnotes: Footnote[]): string {
  if (!text || !text.includes('[^')) return text;
  return text.replace(/\[\^([^\]\s]+)\]/g, (full, marker) => {
    const fn =
      sectionFootnotes.find((f) => f.marker === marker) || allFootnotes.find((f) => f.marker === marker);
    if (!fn) return full;
    const label = fn.number || fn.marker;
    return `<sup id="fnref-${fn.id}" style="font-weight:700;"><a href="#fn-${fn.id}" style="color:inherit;text-decoration:none;">${label}</a></sup>`;
  });
}

/**
 * Розгортає маркери зображень `[IMG: id "підпис" wrap=режим]`, які
 * письменник вставляє з галереї в редакторі (правою кнопкою миші або з
 * панелі інструментів — див. handleInsertGalleryImage в EditorView.tsx), у
 * справжню картинку з обтіканням тексту.
 *
 * Причина та сама, що й у `linkifyFootnoteMarkers`: нерозгорнутий токен
 * надрукувався б у книзі як голий текст, а це помилка коректності друку.
 * Id відповідає джерелам галереї: ілюстрація книги, `char-<id>` —
 * портрет героя, `cover-front` — обкладинка. Невідомий id лишаємо як є,
 * щоб автор побачив проблему, а не мовчазну порожнечу.
 *
 * `wrap` — той самий вибір, що редактор показує наживо (WrappedImageNode):
 * `left`/`right` — плаваюча картинка зі звичайним прямокутним обтіканням;
 * `contour` — теж плаваюча, але `shape-outside` огинає текстом силует
 * картинки по її альфа-каналу (працює лише для зображень із прозорістю —
 * на суцільному фоні виглядає як звичайний прямокутник, без падінь); `none`
 * (або відсутній wrap — старі книги без цього параметра) — картинка на всю
 * ширину, без обтікання, як і раніше.
 */
function renderImageMarkers(text: string, book: Book): string {
  if (!text || !text.includes('[IMG:')) return text;

  return text.replace(
    /\[IMG:\s*([^\s\]"]+)\s*(?:"([^"]*)")?(?:\s+wrap=(\w+))?(?:\s+width=([\d.]+)mm)?(?:\s+height=([\d.]+)mm)?(?:\s+shape="([^"]*)")?\]/g,
    (full, id: string, caption?: string, wrap?: string, widthMm?: string, heightMm?: string, shape?: string) => {
      let url: string | undefined;

      if (id === 'cover-front') {
        url = book.coverConfig?.frontArtUrl;
      } else if (id.startsWith('char-')) {
        url = book.characters.find((c) => c.id === id.slice('char-'.length))?.avatarUrl;
      } else {
        url = (book.illustrations || []).find((i) => i.id === id)?.url;
      }

      if (!url) return full;
      const cap = (caption || '').trim();
      // Той самий літеральний mm, що й у живому редакторі (WrappedImageNode.tsx) —
      // без конвертації в px, розмір на екрані й в експорті лишається однаковим.
      const sizeCss = widthMm ? `width:${widthMm}mm;` : '';

      // Маркер без `wrap=` — книга, написана до появи режимів обтікання.
      // Дефолт узгоджений з живим редактором (WrappedImageNode.tsx та
      // manuscriptDoc.ts): такі фото обтікаються ЗЛІВА, а не стають блоком.
      const mode = wrap || 'left';

      let figureStyle = `margin:1.2em 0;text-align:center;page-break-inside:avoid;${sizeCss}`;
      if (mode === 'left' || mode === 'right' || mode === 'contour') {
        const float = mode === 'right' ? 'float:right;margin:0 0 0.8em 1em;' : 'float:left;margin:0 1em 0.8em 0;';
        figureStyle = `${float}text-align:${mode === 'right' ? 'right' : 'left'};page-break-inside:avoid;${sizeCss || 'max-width:45%;'}`;
        if (mode === 'contour') {
          // Полігон, порахований з пікселів фото ще в редакторі, — єдине,
          // що дає контур для JPG (у нього немає альфа-каналу, з якого
          // `shape-outside: url()` вирізає форму). Без нього лишається
          // прозорість самого файлу: працює для PNG/SVG.
          figureStyle += shape
            ? `shape-outside:polygon(${shape});shape-margin:0.5em;`
            : `shape-outside:url(${url});shape-image-threshold:0.5;shape-margin:0.5em;`;
        }
      }

      const imgStyle = `width:100%;height:${heightMm ? `${heightMm}mm` : 'auto'};${heightMm ? 'object-fit:cover;' : ''}display:block;margin:0 auto;`;

      return (
        `<figure style="${figureStyle}">` +
        `<img src="${url}" alt="${cap}" style="${imgStyle}" />` +
        (cap ? `<figcaption style="font-size:0.82em;opacity:0.75;margin-top:0.4em;">${cap}</figcaption>` : '') +
        `</figure>`
      );
    }
  );
}

/**
 * Розгортає жирність/курсив (`**текст**` / `*текст*`), які редактор
 * (EditorView.tsx renderFormatToolbar) вставляє в текст розділу — раніше
 * ці маркери ніде не розгорталися і друкувалися в експорті як голі
 * зірочки. Проста заміна пар маркерів, без вкладеної markdown-граматики:
 * саме так їх і вставляє редактор (симетричні пари навколо виділення).
 */
function renderBoldItalicMarkers(text: string): string {
  if (!text) return text;
  let out = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');
  return out;
}

/**
 * Розгортає маркер точкового шрифту `[FONT="Назва"]текст[/FONT]`, який
 * редактор вставляє навколо виділеного фрагмента при виборі гарнітури з
 * палітри шрифтів (renderFormatToolbar в EditorView.tsx). На відміну від
 * `layoutConfig.typography.bodyFont` (шрифт усієї книги), це заміна лише
 * для позначеного автором фрагмента — решта тексту лишається як є.
 */
function renderFontMarkers(text: string): string {
  if (!text || !text.includes('[FONT=')) return text;
  return text.replace(/\[FONT="([^"]+)"\]([\s\S]*?)\[\/FONT\]/g, (full, family: string, inner: string) => {
    if (!family.trim()) return full;
    return `<span style="font-family:'${family.replace(/'/g, '')}', Georgia, serif;">${inner}</span>`;
  });
}

/**
 * Розгортає маркер точкового кеглю `[SIZE=N]текст[/SIZE]` — точна копія
 * renderFontMarkers, лише замість гарнітури керує розміром шрифту (пт),
 * див. FontSizeMark.ts.
 */
function renderFontSizeMarkers(text: string): string {
  if (!text || !text.includes('[SIZE=')) return text;
  return text.replace(/\[SIZE=([\d.]+)\]([\s\S]*?)\[\/SIZE\]/g, (full, size: string, inner: string) => {
    return `<span style="font-size:${size}pt;">${inner}</span>`;
  });
}

/**
 * Повний ланцюжок розгортання маркерів тексту розділу (виноски, зображення,
 * шрифт, кегль, жирність/курсив) у справжній HTML — той самий, що вже
 * використовує HTML/PDF-експорт (generateBookExportHtml). Винесено окремою
 * експортованою функцією, щоб «Розворот книги» міг показувати насичений
 * текст, а не сирі маркери, — і рахувати реальну висоту відрендереного
 * HTML для точної пагінації (utils/useRealBookPages.ts).
 */
export function renderSectionContentHtml(
  content: string,
  book: Book,
  sectionFootnotes: Footnote[],
  allFootnotes: Footnote[]
): string {
  // [AI-DRAFT]/[/AI-DRAFT] (utils/manuscriptDoc.ts) — позначка «AI-чернетка»
  // лише для живого редактора; в будь-якому експорті абзаци всередині
  // виглядають як звичайний текст, тож самі обгортки просто прибираються
  // (лишаючи звичайний абзацний відступ на їхньому місці).
  const withoutAiDraftMarkers = (content || '')
    .replace(/\n*\[AI-DRAFT\]\n*/g, '\n\n')
    .replace(/\n*\[\/AI-DRAFT\]\n*/g, '\n\n');
  return renderBoldItalicMarkers(
    renderFontSizeMarkers(
      renderFontMarkers(renderImageMarkers(linkifyFootnoteMarkers(withoutAiDraftMarkers, sectionFootnotes, allFootnotes), book))
    )
  );
}

/**
 * `renderSectionContentHtml` сам по собі розгортає лише ІНЛАЙН-маркери —
 * абзаци лишаються розділеними голими `\n\n`, без жодного блокового
 * елемента (як і в `generateBookExportHtml`, де за це відповідає
 * `white-space:pre-wrap` на контейнері). Для «Розворот книги» й виміру
 * реальної висоти (utils/useRealBookPages.ts) потрібен САМЕ блоковий
 * елемент на кожен абзац — інакше немає що виміряти чи порахувати як
 * окремий блок. Ця функція ділить текст на абзаци (той самий підхід, що й
 * `renderEditorialParagraphs`: `> ` на початку абзацу — виділений блок) і
 * загортає кожен у `<p>`/`<div>`.
 */
export function renderSectionBlocksHtml(
  content: string,
  book: Book,
  sectionFootnotes: Footnote[],
  allFootnotes: Footnote[]
): string {
  // [AI-DRAFT]/[/AI-DRAFT] (utils/manuscriptDoc.ts) — позначка «AI-чернетка»
  // лише для письменника в живому редакторі; в експорті й у вимірі
  // «Розворот книги» абзаци всередині показуються як звичайний текст, тож
  // самі обгортки просто відкидаються, без жодного сліду в HTML.
  const AI_DRAFT_OPEN = '[AI-DRAFT]';
  const AI_DRAFT_CLOSE = '[/AI-DRAFT]';

  const paragraphs = (content || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p !== AI_DRAFT_OPEN && p !== AI_DRAFT_CLOSE);

  return paragraphs
    .map((para) => {
      const isCallout = /^>\s?/.test(para);
      const rawText = (isCallout ? para.replace(/^>\s?/gm, '') : para).replace(/\n+/g, ' ').trim();
      const html = renderSectionContentHtml(rawText, book, sectionFootnotes, allFootnotes);
      return isCallout
        ? `<div style="margin:0.8em 0;padding:0.5em 1em;border-left:3px solid rgba(180,130,20,0.5);font-style:italic;">${html}</div>`
        : `<p>${html}</p>`;
    })
    .join('');
}

function buildFootnotesBySection(book: Book): Record<string, Footnote[]> {
  const footnotesBySection: Record<string, Footnote[]> = {};
  (book.footnotes || []).forEach((fn) => {
    const secId = fn.sectionId || 'general';
    if (!footnotesBySection[secId]) footnotesBySection[secId] = [];
    footnotesBySection[secId].push(fn);
  });
  return footnotesBySection;
}

function buildQrTagsBySection(book: Book): Record<string, QRTag[]> {
  const qrTagsBySection: Record<string, QRTag[]> = {};
  (book.qrTags || []).forEach((qr) => {
    const secId = qr.sectionId || 'general';
    if (!qrTagsBySection[secId]) qrTagsBySection[secId] = [];
    qrTagsBySection[secId].push(qr);
  });
  return qrTagsBySection;
}

// PDF-верстка («Верстка PDF»): графічні об'єкти з обтіканням тексту та
// індивідуальні межі текстової рамки глави, задані у PdfEditorView.
function buildPdfLayoutByChapter(book: Book): Record<string, PdfChapterLayout> {
  const pdfLayoutByChapter: Record<string, PdfChapterLayout> = {};
  (book.pdfLayout?.chapters || []).forEach((cl) => {
    pdfLayoutByChapter[cl.chapterId] = cl;
  });
  return pdfLayoutByChapter;
}

function renderFlowObjectHtml(obj: PdfFrameObject): string {
  const isTopBottom = obj.wrapMode === 'top-bottom';
  const floatCss = obj.wrapMode === 'left' ? 'float: left;' : obj.wrapMode === 'right' ? 'float: right;' : 'display: block; clear: both;';
  const marginCss = isTopBottom
    ? `margin: ${obj.wrapMarginMm}mm auto;`
    : obj.wrapMode === 'left'
      ? `margin: 0 ${obj.wrapMarginMm}mm ${obj.wrapMarginMm}mm 0;`
      : `margin: 0 0 ${obj.wrapMarginMm}mm ${obj.wrapMarginMm}mm;`;
  return `
      <div style="${floatCss} ${marginCss} width: ${obj.widthMm}mm; page-break-inside: avoid;">
        <img src="${obj.imageUrl}" alt="${obj.caption || ''}" style="width: ${obj.widthMm}mm; height: ${obj.heightMm}mm; object-fit: cover; display: block;" />
        ${obj.caption ? `<div style="font-size: 8pt; color: #64748b; text-align: center; margin-top: 2px;">${obj.caption}</div>` : ''}
      </div>
    `;
}

// Об'єкти з wrapMode='none' — у екрані-редакторі це вільне (x,y) позиціювання
// на макеті однієї сторінки; у неперервному paginated HTML для друку немає
// еквівалента довільних абсолютних координат відносно конкретної надрукованої
// сторінки, тому тут вони виводяться як окремі блоки-ілюстрації в порядку
// додавання (те саме, що top-bottom, але без обтікання тексту з боків).
function renderFreeObjectHtml(obj: PdfFrameObject): string {
  return `
    <div style="display: block; clear: both; margin: 8mm auto; width: ${obj.widthMm}mm; page-break-inside: avoid;">
      <img src="${obj.imageUrl}" alt="${obj.caption || ''}" style="width: ${obj.widthMm}mm; height: ${obj.heightMm}mm; object-fit: cover; display: block; margin: 0 auto;" />
      ${obj.caption ? `<div style="font-size: 8pt; color: #64748b; text-align: center; margin-top: 2px;">${obj.caption}</div>` : ''}
    </div>
  `;
}

function chapterPageRulesCssFor(book: Book, pdfLayoutByChapter: Record<string, PdfChapterLayout>): string {
  return book.chapters
    .map((chap, idx) => {
      const cl = pdfLayoutByChapter[chap.id];
      if (!cl?.margins) return '';
      return `
    @page pdf-chapter-${idx} {
      margin-top: ${cl.margins.topMm}mm;
      margin-bottom: ${cl.margins.bottomMm}mm;
      margin-left: ${cl.margins.insideMm}mm;
      margin-right: ${cl.margins.outsideMm}mm;
      ${pageNumberMarginBoxCss(book)}
    }`;
    })
    .join('');
}

/**
 * CSS margin-box для номера сторінки (CSS Paged Media Level 3) — вставляється
 * всередину @page-правила. Рендериться рушіями, що підтримують @page-маржбокси
 * (Prince, WeasyPrint та ін.; Chromium у «Друкувати в PDF» частину ігнорує).
 * Позиція та видимість — із layoutConfig.typography (налаштування «Верстка PDF»).
 */
function pageNumberMarginBoxCss(book: Book): string {
  const typo = book.layoutConfig.typography || ({} as Book['layoutConfig']['typography']);
  if (typo.showPageNumbers === false) return '';
  const raw: string = (typo.pageNumberPosition as string) || 'bottom-center';
  // 6 позицій; сумісність зі старими значеннями 'bottom-outside'/'top-outside'
  const box =
    raw === 'bottom-center' ? '@bottom-center'
    : raw === 'bottom-left' ? '@bottom-left'
    : raw === 'bottom-right' || raw === 'bottom-outside' ? '@bottom-right'
    : raw === 'top-left' ? '@top-left'
    : raw === 'top-right' || raw === 'top-outside' ? '@top-right'
    : '@top-center';
  const font = typo.bodyFont || 'Georgia';
  return `${box} { content: counter(page); font-family: '${font}', Georgia, serif; font-size: 9pt; color: #64748b; }`;
}

/**
 * CSS `counter-reset: page N` для першої глави — щоб нумерація починалась
 * із вказаного користувачем місця («Початок нумерації» у «Верстці PDF»).
 * 'title' — нумерація природна (титул = 1), скидання не потрібне;
 * 'after-toc' — перша глава = 1 (reset 0); 'custom' — перша глава = startNumber.
 */
function pageStartResetCss(book: Book): string {
  const st = book.layoutConfig.typography?.pageNumberStart;
  if (!st || st.mode === 'title') return '';
  const offset = st.mode === 'after-toc' ? 0 : Math.max(0, (st.startNumber ?? 1) - 1);
  return `counter-reset: page ${offset}; `;
}

// Generate formatted HTML for DOCX, PDF, or Print export
export function generateBookExportHtml(book: Book): string {
  const tocItems = computeTableOfContents(book);
  const tocConfig = book.layoutConfig.tocConfig || {
    leaderStyle: 'dots',
    numberingStyle: 'arabic',
    showSectionSubitems: true,
    showFrontMatter: true,
    title: 'Зміст',
    customPrefix: 'Глава',
    pageNumberPosition: 'right',
  };

  if ((book.layoutConfig.designTheme || 'classic') === 'editorial') {
    return generateEditorialBookExportHtml(book, tocItems, tocConfig);
  }

  const tocHtml = `
    <div class="toc-page" style="page-break-before: always; page-break-after: always; padding: 40px 20px;">
      <h2 style="font-family: '${book.layoutConfig.typography.headingsFont || 'Outfit'}', sans-serif; font-size: 20pt; text-align: center; margin-bottom: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 8px;">
        ${tocConfig.title || 'ЗМІСТ'}
      </h2>
      <div style="font-family: '${book.layoutConfig.typography.bodyFont}', Georgia, serif; font-size: 11pt; line-height: 1.8;">
        ${tocItems.map(item => `
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: ${item.type === 'chapter' ? '8px' : '4px'}; padding-left: ${item.type === 'section' ? '20px' : '0px'};">
            <span style="font-weight: ${item.type === 'chapter' ? 'bold' : 'normal'};">
              ${item.displayNumber ? `<span style="color: #64748b; margin-right: 8px;">${item.displayNumber}</span>` : ''}
              ${item.title}
            </span>
            <span style="flex: 1; border-bottom: ${tocConfig.leaderStyle === 'line' ? '1px solid #94a3b8' : tocConfig.leaderStyle === 'dashes' ? '1px dashed #94a3b8' : tocConfig.leaderStyle === 'dots' ? '1px dotted #94a3b8' : 'none'}; margin: 0 8px; height: 1em;"></span>
            <span style="font-family: monospace; font-size: 10pt; font-weight: bold; color: #334155;">${item.pageNumber ?? '—'}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const footnotesBySection = buildFootnotesBySection(book);
  const qrTagsBySection = buildQrTagsBySection(book);
  const pdfLayoutByChapter = buildPdfLayoutByChapter(book);

  const chaptersHtml = book.chapters.map((chap, idx) => {
    const chapterPdfLayout = pdfLayoutByChapter[chap.id];
    const flowObjectsHtml = (chapterPdfLayout?.objects || [])
      .filter((o) => o.wrapMode !== 'none')
      .map(renderFlowObjectHtml)
      .join('');
    const freeObjectsHtml = (chapterPdfLayout?.objects || [])
      .filter((o) => o.wrapMode === 'none')
      .map(renderFreeObjectHtml)
      .join('');
    const chapterPageStyle = chapterPdfLayout?.margins
      ? `page: pdf-chapter-${idx}; padding-top: 0;`
      : '';

    const sectionsHtml = chap.sections.map((sec) => {
      const secFootnotes = footnotesBySection[sec.id] || [];
      const secQrTags = qrTagsBySection[sec.id] || [];

      return `
        <div class="book-section" style="margin-bottom: 24px;">
          <h3 style="font-family: '${book.layoutConfig.typography.headingsFont || 'Outfit'}', sans-serif; font-size: 14pt; color: #1e293b; margin-bottom: 12px;">${sec.title}</h3>
          <div style="font-family: '${book.layoutConfig.typography.bodyFont}', Georgia, serif; font-size: ${book.layoutConfig.typography.fontSizePt}pt; line-height: ${book.layoutConfig.typography.lineHeight}; text-align: ${book.layoutConfig.typography.textAlign}; white-space: pre-wrap;">
            ${renderSectionContentHtml(sec.content, book, secFootnotes, book.footnotes || [])}
          </div>

          ${secQrTags.length > 0 ? `
            <div style="margin-top: 16px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc;">
              <h4 style="font-size: 10pt; margin: 0 0 8px 0; color: #0f172a;">📱 Інтерактивні QR-матеріали сцени:</h4>
              <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                ${secQrTags.map(q => `
                  <div style="display: flex; align-items: center; gap: 8px; font-size: 9pt;">
                    ${q.svgData ? `<img src="${q.svgData}" style="width: 48px; height: 48px;" alt="${q.title}" />` : ''}
                    <div>
                      <strong>${q.title}</strong>
                      <div style="color: #64748b; font-size: 8pt;">${q.payload}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${secFootnotes.length > 0 ? `
            <div style="margin-top: 20px; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 9pt; color: #475569;">
              ${secFootnotes.map(fn => `
                <div id="fn-${fn.id}" style="margin-bottom: 4px;">
                  <sup style="font-weight: bold; color: #0f172a;">[${fn.number || fn.marker}]</sup>
                  ${fn.term ? `<strong>${fn.term}:</strong> ` : ''}${fn.text}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="book-chapter" style="page-break-before: always; ${idx === 0 ? pageStartResetCss(book) : ''}margin-top: 40px; ${chapterPageStyle}">
        <h2 style="font-family: '${book.layoutConfig.typography.headingsFont || 'Outfit'}', sans-serif; font-size: 22pt; color: #0f172a; text-align: center; margin-bottom: 16px; border-bottom: 1px solid #cbd5e1; padding-bottom: 12px;">
          ${chap.title}
        </h2>
        ${chap.description ? `<p style="font-style: italic; color: #64748b; text-align: center; margin-bottom: 28px;">${chap.description}</p>` : ''}
        <div style="overflow: hidden;">
          ${flowObjectsHtml}
          ${freeObjectsHtml}
          ${sectionsHtml}
        </div>
      </div>
    `;
  }).join('');

  // Іменовані @page-правила для глав із власною рамкою тексту, заданою у
  // «Верстці PDF» (PdfEditorView) — інакше глава друкується з типовими
  // полями книги, задними у LayoutView.
  const chapterPageRulesCss = book.chapters
    .map((chap, idx) => {
      const cl = pdfLayoutByChapter[chap.id];
      if (!cl?.margins) return '';
      return `
    @page pdf-chapter-${idx} {
      margin-top: ${cl.margins.topMm}mm;
      margin-bottom: ${cl.margins.bottomMm}mm;
      margin-left: ${cl.margins.insideMm}mm;
      margin-right: ${cl.margins.outsideMm}mm;
      ${pageNumberMarginBoxCss(book)}
    }`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <title>${book.title} — ${book.author}</title>
  <style>
    @page {
      size: ${book.layoutConfig.formatPreset === '6x9' ? '6in 9in' : book.layoutConfig.formatPreset === 'A5' ? 'A5' : 'A4'};
      margin-top: ${book.layoutConfig.margins.topMm}mm;
      margin-bottom: ${book.layoutConfig.margins.bottomMm}mm;
      margin-left: ${book.layoutConfig.margins.insideMm}mm;
      margin-right: ${book.layoutConfig.margins.outsideMm}mm;
      ${pageNumberMarginBoxCss(book)}
    }
    ${chapterPageRulesCss}
    body {
      font-family: '${book.layoutConfig.typography.bodyFont}', Georgia, serif;
      color: #0f172a;
      line-height: ${book.layoutConfig.typography.lineHeight};
      background: white;
      margin: 0;
      padding: 0;
    }
    .title-page {
      page-break-after: always;
      text-align: center;
      padding-top: 100px;
    }
    .copyright-page {
      page-break-after: always;
      font-size: 9pt;
      color: #64748b;
      padding-top: 200px;
    }
    p {
      text-indent: ${book.layoutConfig.typography.firstLineIndentMm}mm;
      margin: 0;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="title-page">
    <h1 style="font-size: 32pt; margin-bottom: 8px;">${book.title}</h1>
    <h2 style="font-size: 16pt; font-weight: normal; color: #475569; margin-bottom: 40px;">${book.subtitle || ''}</h2>
    <h3 style="font-size: 18pt; font-weight: 600;">${book.author}</h3>
    <p style="margin-top: 120px; color: #64748b; font-size: 11pt;">Цифрова Майстерня Письменника Nova Glass</p>
  </div>

  ${book.layoutConfig.frontMatter.showCopyright ? `
  <div class="copyright-page">
    <p>${book.layoutConfig.frontMatter.copyrightText}</p>
    <p style="margin-top: 12px;">ISBN: ${book.coverConfig.barcode || '978-617-0000-00-0'}</p>
    <p>Жанр: ${book.genre}</p>
  </div>
  ` : ''}

  ${book.layoutConfig.frontMatter.showDedication && book.layoutConfig.frontMatter.dedicationText ? `
  <div style="page-break-after: always; text-align: center; padding-top: 150px; font-style: italic;">
    <p style="max-width: 400px; margin: 0 auto;">${book.layoutConfig.frontMatter.dedicationText}</p>
  </div>
  ` : ''}

  ${book.layoutConfig.frontMatter.showEpigraph && book.layoutConfig.frontMatter.epigraphText ? `
  <div style="page-break-after: always; text-align: right; padding-top: 160px; padding-right: 60px;">
    <blockquote style="font-style: italic; font-size: 12pt; margin: 0;">${book.layoutConfig.frontMatter.epigraphText}</blockquote>
    <p style="font-weight: 600; margin-top: 8px;">— ${book.layoutConfig.frontMatter.epigraphAuthor}</p>
  </div>
  ` : ''}

  ${book.layoutConfig.frontMatter.showTableOfContents ? tocHtml : ''}

  ${chaptersHtml}
</body>
</html>
  `;
}

/**
 * Розбиває текст розділу на абзаци (роздільник — порожній рядок), лінкує
 * маркери виносок `[^marker]` та рендерить абзаци, що починаються з `> `,
 * як виділені інформаційні блоки (аналог «callout»-боксів на кшталт
 * прикладу Claude Design) — суто текстова конвенція, без нових полів у
 * моделі книги. Буквиця (drop cap) додається лише до першого абзацу першого
 * розділу глави, як у класичній книжковій типографіці.
 */
function renderEditorialParagraphs(
  content: string,
  sectionFootnotes: Footnote[],
  allFootnotes: Footnote[],
  applyDropCapToFirst: boolean,
  book: Book
): string {
  const paragraphs = (content || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p !== '[AI-DRAFT]' && p !== '[/AI-DRAFT]');

  return paragraphs
    .map((para, i) => {
      const isCallout = /^>\s?/.test(para);
      const rawText = (isCallout ? para.replace(/^>\s?/gm, '') : para).replace(/\n+/g, ' ').trim();
      const text = renderSectionContentHtml(rawText, book, sectionFootnotes, allFootnotes);
      if (isCallout) {
        return `<div class="ed-callout">${text}</div>`;
      }
      const dropcap = applyDropCapToFirst && i === 0 ? ' ed-dropcap' : '';
      return `<p class="ed-p${dropcap}">${text}</p>`;
    })
    .join('\n');
}

/**
 * Редакційна («editorial») дизайн-тема друкованого/PDF-експорту —
 * серифні заголовки, обкладинка й зміст із кікерами в дусі Claude Design
 * (claude.ai/design), нумеровані розділи, буквиці, виділені інформаційні
 * блоки та стилізовані виноски. Вмикається за explicit вибором письменика
 * (book.layoutConfig.designTheme === 'editorial') і повністю зберігає всі
 * властиві NOVA STUDIO особливості тексту — виноски, QR-теги сцен та
 * обтікання ілюстрацій із «Верстки PDF», яких немає у типовому
 * згенерованому Claude Design документі.
 */
function generateEditorialBookExportHtml(book: Book, tocItems: ComputedTOCItem[], tocConfig: TOCConfig): string {
  const footnotesBySection = buildFootnotesBySection(book);
  const qrTagsBySection = buildQrTagsBySection(book);
  const pdfLayoutByChapter = buildPdfLayoutByChapter(book);
  const chapterPageRulesCss = chapterPageRulesCssFor(book, pdfLayoutByChapter);

  const palette = book.visualBible?.colorPalette || [];
  const accent = palette[0] || '#9a3324';
  const paper = '#f7f2e7';
  const muted = '#6b6558';
  const hairline = '#e3dcc9';
  const ink = '#181820';

  const headingFont = book.layoutConfig.typography.headingsFont || 'Fraunces';
  const bodyFont = book.layoutConfig.typography.bodyFont || 'Literata';

  const studioLabel = 'НОВА СТУДІЯ · ЦИФРОВА МАЙСТЕРНЯ';
  const editionLabel = `${(book.genre || 'КНИГА').toUpperCase()}`;

  const coverBadges = [book.genre, book.targetAudience, book.visualBible?.styleName].filter(Boolean).slice(0, 3) as string[];

  const coverHtml = `
    <div class="ed-cover">
      <div class="ed-cover-topbar">
        <span>${studioLabel}</span>
        <span>${editionLabel}</span>
      </div>
      <div class="ed-cover-body">
        ${book.genre ? `<div class="ed-eyebrow">${book.genre.toUpperCase()}</div>` : ''}
        <h1 class="ed-cover-title">${book.title}</h1>
        ${book.subtitle ? `<p class="ed-cover-subtitle">${book.subtitle}</p>` : ''}
        ${coverBadges.length > 0 ? `
          <div class="ed-badges">
            ${coverBadges.map((b) => `<span class="ed-badge">${b}</span>`).join('')}
          </div>
        ` : ''}
        ${book.coverConfig?.frontArtUrl ? `
          <div class="ed-cover-art"><img src="${book.coverConfig.frontArtUrl}" alt="${book.title}" /></div>
        ` : ''}
      </div>
      <div class="ed-cover-footer">
        <span>${book.author}</span>
        <span>NOVA STUDIO</span>
      </div>
    </div>
  `;

  const chapterTocEntries = tocItems.filter((i) => i.type === 'chapter');
  const tocHtml = `
    <div class="ed-toc" style="page-break-before: always; page-break-after: always;">
      <div class="ed-kicker">${(tocConfig.title || 'ЗМІСТ').toUpperCase()}</div>
      <h2 class="ed-toc-heading">Що всередині</h2>
      <div class="ed-toc-list">
        ${chapterTocEntries.map((item, i) => `
          <div class="ed-toc-row">
            <span class="ed-toc-num">${String(i + 1).padStart(2, '0')}</span>
            <div class="ed-toc-titleblock">
              <div class="ed-toc-title">${item.title}</div>
              ${item.subtitle ? `<div class="ed-toc-desc">${item.subtitle}</div>` : ''}
            </div>
            <span class="ed-toc-page">${item.pageNumber ?? '—'}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const chaptersHtml = book.chapters.map((chap, idx) => {
    const chapterPdfLayout = pdfLayoutByChapter[chap.id];
    const flowObjectsHtml = (chapterPdfLayout?.objects || [])
      .filter((o) => o.wrapMode !== 'none')
      .map(renderFlowObjectHtml)
      .join('');
    const freeObjectsHtml = (chapterPdfLayout?.objects || [])
      .filter((o) => o.wrapMode === 'none')
      .map(renderFreeObjectHtml)
      .join('');
    const chapterPageStyle = chapterPdfLayout?.margins ? `page: pdf-chapter-${idx};` : '';

    const sectionsHtml = chap.sections.map((sec, sIdx) => {
      const secFootnotes = footnotesBySection[sec.id] || [];
      const secQrTags = qrTagsBySection[sec.id] || [];
      const isChapterOpening = sIdx === 0;

      return `
        <div class="ed-section">
          <h3 class="ed-section-title">${idx + 1}.${sIdx + 1} ${sec.title}</h3>
          <div class="ed-body">
            ${renderEditorialParagraphs(sec.content, secFootnotes, book.footnotes || [], isChapterOpening, book)}
          </div>

          ${secQrTags.length > 0 ? `
            <div class="ed-qr-box">
              <h4>📱 Інтерактивні QR-матеріали сцени</h4>
              <div class="ed-qr-list">
                ${secQrTags.map((q) => `
                  <div class="ed-qr-item">
                    ${q.svgData ? `<img src="${q.svgData}" alt="${q.title}" />` : ''}
                    <div>
                      <strong>${q.title}</strong>
                      <div class="ed-qr-payload">${q.payload}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${secFootnotes.length > 0 ? `
            <div class="ed-footnotes">
              <div class="ed-footnotes-heading">Примітки</div>
              ${secFootnotes.map((fn) => `
                <div class="ed-footnote-row" id="fn-${fn.id}">
                  <span class="ed-footnote-num">${fn.number || fn.marker}</span>
                  <span class="ed-footnote-text">${fn.term ? `<strong>${fn.term}:</strong> ` : ''}${fn.text}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="ed-chapter" style="page-break-before: always; ${idx === 0 ? pageStartResetCss(book) : ''}${chapterPageStyle}">
        <div class="ed-chapter-kicker">— РОЗДІЛ ${String(idx + 1).padStart(2, '0')}</div>
        <h2 class="ed-chapter-title">${chap.title}</h2>
        ${chap.description ? `<p class="ed-chapter-desc">${chap.description}</p>` : ''}
        <div class="ed-rule"></div>
        <div style="overflow: hidden;">
          ${flowObjectsHtml}
          ${freeObjectsHtml}
          ${sectionsHtml}
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <title>${book.title} — ${book.author}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,500&family=Literata:ital,wght@0,400;0,600;1,400&display=swap');

    @page {
      size: ${book.layoutConfig.formatPreset === '6x9' ? '6in 9in' : book.layoutConfig.formatPreset === 'A5' ? 'A5' : 'A4'};
      margin-top: ${book.layoutConfig.margins.topMm}mm;
      margin-bottom: ${book.layoutConfig.margins.bottomMm}mm;
      margin-left: ${book.layoutConfig.margins.insideMm}mm;
      margin-right: ${book.layoutConfig.margins.outsideMm}mm;
      ${pageNumberMarginBoxCss(book)}
    }
    ${chapterPageRulesCss}

    :root {
      --ed-accent: ${accent};
      --ed-ink: ${ink};
      --ed-paper: ${paper};
      --ed-muted: ${muted};
      --ed-hairline: ${hairline};
    }

    * { box-sizing: border-box; }
    body {
      font-family: '${bodyFont}', Georgia, serif;
      color: var(--ed-ink);
      line-height: ${book.layoutConfig.typography.lineHeight};
      background: white;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3 { font-family: '${headingFont}', Georgia, serif; }

    .ed-kicker {
      font-family: 'Courier New', monospace;
      font-size: 8.5pt;
      letter-spacing: 0.14em;
      color: var(--ed-accent);
      font-weight: 700;
      margin-bottom: 10px;
    }

    .ed-cover { page-break-after: always; min-height: 100%; display: flex; flex-direction: column; background: var(--ed-paper); padding: 14mm 12mm; }
    .ed-cover-topbar { display: flex; justify-content: space-between; font-family: 'Courier New', monospace; font-size: 7.5pt; letter-spacing: 0.12em; color: var(--ed-muted); border-bottom: 1px solid var(--ed-hairline); padding-bottom: 10px; text-transform: uppercase; }
    .ed-cover-body { flex: 1; padding-top: 26mm; }
    .ed-eyebrow { font-family: 'Courier New', monospace; font-size: 8pt; letter-spacing: 0.14em; color: var(--ed-muted); margin-bottom: 10px; }
    .ed-cover-title { font-size: 30pt; font-weight: 600; color: var(--ed-ink); line-height: 1.12; margin: 0 0 10px 0; }
    .ed-cover-subtitle { font-family: '${headingFont}', Georgia, serif; font-style: italic; font-size: 13pt; color: var(--ed-muted); margin: 0 0 16px 0; }
    .ed-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .ed-badge { font-family: 'Courier New', monospace; font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--ed-hairline); border-radius: 20px; padding: 4px 10px; color: var(--ed-ink); }
    .ed-cover-art { margin-top: 14px; border-radius: 4px; overflow: hidden; }
    .ed-cover-art img { width: 100%; display: block; }
    .ed-cover-footer { display: flex; justify-content: space-between; font-size: 9pt; color: var(--ed-muted); border-top: 1px solid var(--ed-hairline); padding-top: 10px; }

    .ed-toc { padding-top: 10mm; }
    .ed-toc-heading { font-size: 24pt; font-weight: 600; margin: 4px 0 20px 0; }
    .ed-toc-row { display: flex; align-items: baseline; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--ed-hairline); }
    .ed-toc-num { font-family: 'Courier New', monospace; font-size: 9pt; color: var(--ed-accent); font-weight: 700; }
    .ed-toc-titleblock { flex: 1; }
    .ed-toc-title { font-family: '${headingFont}', Georgia, serif; font-size: 12.5pt; font-weight: 600; }
    .ed-toc-desc { font-size: 9pt; color: var(--ed-muted); margin-top: 2px; }
    .ed-toc-page { font-family: 'Courier New', monospace; font-size: 9pt; color: var(--ed-muted); }

    .ed-chapter-kicker { font-family: 'Courier New', monospace; font-size: 8.5pt; letter-spacing: 0.1em; color: var(--ed-accent); font-weight: 700; margin-top: 10mm; }
    .ed-chapter-title { font-size: 21pt; font-weight: 600; margin: 8px 0 6px 0; }
    .ed-chapter-desc { font-family: '${headingFont}', Georgia, serif; font-style: italic; font-size: 11pt; color: var(--ed-muted); margin: 0 0 14px 0; }
    .ed-rule { height: 1px; background: var(--ed-hairline); margin-bottom: 18px; }

    .ed-section-title { font-size: 13pt; font-weight: 600; color: var(--ed-ink); margin: 22px 0 10px 0; }
    .ed-body { font-family: '${bodyFont}', Georgia, serif; font-size: ${book.layoutConfig.typography.fontSizePt}pt; line-height: ${book.layoutConfig.typography.lineHeight}; text-align: ${book.layoutConfig.typography.textAlign}; }
    .ed-p { margin: 0 0 ${book.layoutConfig.typography.paragraphSpacingMm || 3}mm 0; text-indent: ${book.layoutConfig.typography.firstLineIndentMm}mm; }
    .ed-p.ed-dropcap::first-letter {
      float: left;
      font-family: '${headingFont}', Georgia, serif;
      font-size: 3.4em;
      line-height: 0.82;
      font-weight: 600;
      color: var(--ed-accent);
      padding: 4px 8px 0 0;
    }
    .ed-callout { background: var(--ed-paper); border: 1px solid var(--ed-hairline); border-radius: 4px; padding: 12px 14px; margin: 14px 0; font-size: 9.5pt; color: var(--ed-ink); }

    .ed-qr-box { margin-top: 14px; padding: 12px; border: 1px solid var(--ed-hairline); border-radius: 6px; background: #fafaf7; }
    .ed-qr-box h4 { font-size: 9.5pt; margin: 0 0 8px 0; color: var(--ed-ink); }
    .ed-qr-list { display: flex; gap: 16px; flex-wrap: wrap; }
    .ed-qr-item { display: flex; align-items: center; gap: 8px; font-size: 9pt; }
    .ed-qr-item img { width: 40px; height: 40px; }
    .ed-qr-payload { color: var(--ed-muted); font-size: 8pt; }

    .ed-footnotes { margin-top: 18px; border-top: 1px solid var(--ed-hairline); padding-top: 10px; }
    .ed-footnotes-heading { font-family: '${headingFont}', Georgia, serif; font-style: italic; font-size: 9.5pt; color: var(--ed-accent); margin-bottom: 6px; }
    .ed-footnote-row { display: flex; gap: 8px; font-size: 8.5pt; color: var(--ed-muted); margin-bottom: 4px; }
    .ed-footnote-num { font-family: 'Courier New', monospace; font-weight: 700; color: var(--ed-ink); }

    .copyright-page { page-break-after: always; font-size: 9pt; color: var(--ed-muted); padding-top: 60mm; }
  </style>
</head>
<body>
  ${coverHtml}

  ${book.layoutConfig.frontMatter.showCopyright ? `
  <div class="copyright-page">
    <div class="ed-kicker">ВИХІДНІ ДАНІ</div>
    <div class="ed-rule"></div>
    <p>${book.layoutConfig.frontMatter.copyrightText}</p>
    <p style="margin-top: 12px;">ISBN: ${book.coverConfig.barcode || '978-617-0000-00-0'}</p>
    <p>Жанр: ${book.genre}</p>
  </div>
  ` : ''}

  ${book.layoutConfig.frontMatter.showDedication && book.layoutConfig.frontMatter.dedicationText ? `
  <div style="page-break-after: always; text-align: center; padding-top: 60mm; font-style: italic; font-family: '${headingFont}', Georgia, serif;">
    <p style="max-width: 400px; margin: 0 auto;">${book.layoutConfig.frontMatter.dedicationText}</p>
  </div>
  ` : ''}

  ${book.layoutConfig.frontMatter.showEpigraph && book.layoutConfig.frontMatter.epigraphText ? `
  <div style="page-break-after: always; text-align: right; padding-top: 64mm; padding-right: 60px; font-family: '${headingFont}', Georgia, serif;">
    <blockquote style="font-style: italic; font-size: 12pt; margin: 0;">${book.layoutConfig.frontMatter.epigraphText}</blockquote>
    <p style="font-weight: 600; margin-top: 8px;">— ${book.layoutConfig.frontMatter.epigraphAuthor}</p>
  </div>
  ` : ''}

  ${book.layoutConfig.frontMatter.showTableOfContents ? tocHtml : ''}

  ${chaptersHtml}
</body>
</html>
  `;
}

/**
 * Downloads an image in PNG or JPG format with cross-origin handling and canvas rasterization.
 */
export async function downloadImageAs(
  imageUrl: string,
  filename: string,
  format: 'png' | 'jpg' | 'jpeg' = 'png'
): Promise<void> {
  return new Promise((resolve) => {
    const cleanExt = format === 'jpg' || format === 'jpeg' ? 'jpg' : 'png';
    const cleanBaseName = filename.replace(/\.(png|jpg|jpeg|webp|svg)$/i, '').replace(/[^a-zA-Z0-9А-Яа-яЇїІіЄєҐґ_\-\s]/g, '_');
    const finalFilename = `${cleanBaseName || 'illustration'}.${cleanExt}`;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 1200;
        canvas.height = img.naturalHeight || img.height || 800;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('Canvas 2D context unavailable');
        }

        // If JPG, fill white background to avoid transparent black artifacts
        if (cleanExt === 'jpg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const mimeType = cleanExt === 'jpg' ? 'image/jpeg' : 'image/png';
        const dataUrl = canvas.toDataURL(mimeType, 0.95);

        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        resolve();
      } catch (e) {
        // Fallback for CORS restricted origins
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = finalFilename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        resolve();
      }
    };

    img.onerror = () => {
      // Fallback direct link download
      const a = document.createElement('a');
      a.href = imageUrl;
      a.download = finalFilename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      resolve();
    };

    img.src = imageUrl;
  });
}

