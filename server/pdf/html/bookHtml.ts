/**
 * Markdown → повна HTML-сторінка для рушія Chromium.
 *
 * ЦЕ І Є ТЕ, ЗАРАДИ ЧОГО РУШІЙ ІСНУЄ. У власному рушії вигляд книги
 * визначає код `pdfRenderer.ts`: щоб змінити відступ перед розділом, треба
 * правити арифметику координат. Тут вигляд визначає таблиця стилів нижче —
 * її можна змінити, не розуміючи, як складається PDF. Саме цю модель мав на
 * увазі `markdown-pdf`, і саме її ми зберігаємо, замінивши мертвий PhantomJS
 * на живий браузер.
 *
 * Файл лишається ЧИСТИМ: жодного запуску браузера, жодного диска. Він
 * перетворює текст на текст, і тому перевіряється тестом без образу з
 * Chromium — а зібрати HTML неправильно значно легше, ніж запустити браузер.
 */

import MarkdownIt from 'markdown-it';

export type BookHtmlTheme = 'book' | 'modern' | 'course';

export const BOOK_HTML_THEMES: readonly BookHtmlTheme[] = ['book', 'modern', 'course'];

export interface BookHtmlOptions {
  title: string;
  subtitle?: string;
  author?: string;
  lang?: string;
  theme?: BookHtmlTheme;
  /** Кегль основного тексту в пунктах. Решта розмірів — від нього. */
  fontSizePt?: number;
  /** Інтерліньяж як множник кегля. */
  lineHeight?: number;
  /** Титульна сторінка. Для уривка й чернетки вимикається. */
  titlePage?: boolean;
}

/**
 * Шрифти беруться з образу, а не з мережі: сторінка рендериться в
 * ізольованому браузері без інтернету, і `@import` з Google Fonts дав би
 * мовчазний відкат на шрифт за замовчуванням — тобто інший вигляд книги без
 * жодного попередження. DejaVu ставиться в Dockerfile і покриває кирилицю.
 */
const FONT_STACKS = {
  serif: `'DejaVu Serif', 'Liberation Serif', Georgia, serif`,
  sans: `'DejaVu Sans', 'Liberation Sans', Arial, sans-serif`,
  mono: `'DejaVu Sans Mono', 'Liberation Mono', monospace`,
};

interface ThemeVars {
  body: string;
  heading: string;
  accent: string;
  chapterBreak: boolean;
}

const THEMES: Record<BookHtmlTheme, ThemeVars> = {
  // Класична книга: засічки, розділ з нової сторінки.
  book: { body: FONT_STACKS.serif, heading: FONT_STACKS.serif, accent: '#1f2937', chapterBreak: true },
  // Сучасна: без засічок, щільніше, теж з нової сторінки.
  modern: { body: FONT_STACKS.sans, heading: FONT_STACKS.sans, accent: '#0f766e', chapterBreak: true },
  // Навчальна: розділи ідуть поспіль — у курсі урок часто на півсторінки,
  // і розрив після кожного дав би книгу з половини порожніх аркушів.
  course: { body: FONT_STACKS.sans, heading: FONT_STACKS.sans, accent: '#b45309', chapterBreak: false },
};

/** Екранування для вставки в текст HTML. */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function styles(theme: ThemeVars, fontSizePt: number, lineHeight: number): string {
  return `
    :root {
      --body-font: ${theme.body};
      --heading-font: ${theme.heading};
      --accent: ${theme.accent};
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--body-font);
      font-size: ${fontSizePt}pt;
      line-height: ${lineHeight};
      color: #111827;
      margin: 0;
      /* Переноси — головна причина, чому цей рушій виглядає краще за
         власний: браузер уміє те, чого pdf-lib не вміє взагалі. */
      hyphens: auto;
      -webkit-hyphens: auto;
      text-align: justify;
    }
    h1, h2, h3, h4 {
      font-family: var(--heading-font);
      color: var(--accent);
      text-align: left;
      /* Заголовок не має лишатись самотнім у низу сторінки. */
      break-after: avoid-page;
      page-break-after: avoid;
    }
    h1 {
      font-size: ${(fontSizePt * 1.9).toFixed(1)}pt;
      margin: 0 0 1.2em;
      ${theme.chapterBreak ? 'break-before: page; page-break-before: always;' : 'margin-top: 2em;'}
    }
    /* Перший розділ не починається з порожнього аркуша. */
    h1:first-of-type { break-before: auto; page-break-before: auto; }
    h2 { font-size: ${(fontSizePt * 1.4).toFixed(1)}pt; margin: 1.6em 0 0.6em; }
    h3 { font-size: ${(fontSizePt * 1.15).toFixed(1)}pt; margin: 1.3em 0 0.5em; }
    p { margin: 0; text-indent: 1.2em; orphans: 2; widows: 2; }
    /* Перший абзац під заголовком — без червоного рядка, як у книжці. */
    h1 + p, h2 + p, h3 + p, blockquote + p { text-indent: 0; }
    blockquote {
      margin: 1em 0 1em 1.5em;
      padding-left: 1em;
      border-left: 2px solid var(--accent);
      font-style: italic;
    }
    ul, ol { margin: 0.8em 0; padding-left: 1.6em; text-align: left; }
    li { margin: 0.25em 0; }
    code { font-family: ${FONT_STACKS.mono}; font-size: 0.92em; }
    pre {
      font-family: ${FONT_STACKS.mono};
      background: #f3f4f6;
      padding: 0.8em;
      white-space: pre-wrap;
      break-inside: avoid-page;
    }
    figure { margin: 1.4em 0; text-align: center; break-inside: avoid-page; }
    figure img { max-width: 100%; max-height: 60vh; }
    figcaption {
      font-size: 0.85em;
      color: #4b5563;
      margin-top: 0.4em;
      text-align: center;
      text-indent: 0;
    }
    .title-page {
      break-after: page;
      page-break-after: always;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 80vh;
    }
    .title-page .t { font-family: var(--heading-font); font-size: ${(fontSizePt * 2.6).toFixed(1)}pt; color: var(--accent); }
    .title-page .s { font-size: ${(fontSizePt * 1.25).toFixed(1)}pt; color: #4b5563; margin-top: 0.6em; }
    .title-page .a { font-size: ${(fontSizePt * 1.05).toFixed(1)}pt; margin-top: 2.5em; }
  `.trim();
}

/**
 * Markdown у HTML.
 *
 * `html: false` — навмисно. У `content` книги HTML уже перекладено в
 * Markdown (`bookToMarkdown.ts`); те, що лишилось схожим на тег, — це текст
 * автора, і виконувати його як розмітку означало б дозволити чужому тексту
 * керувати сторінкою, яку ми потім друкуємо.
 */
function markdownRenderer(): MarkdownIt {
  return new MarkdownIt({
    html: false,
    linkify: false,
    typographer: true,
    breaks: false,
  });
}

export function markdownToHtmlBody(markdown: string): string {
  return markdownRenderer().render(String(markdown ?? ''));
}

export function buildBookHtml(markdown: string, options: BookHtmlOptions): string {
  const theme = THEMES[options.theme && THEMES[options.theme] ? options.theme : 'book'];
  const fontSizePt = Number(options.fontSizePt) > 0 ? Number(options.fontSizePt) : 11;
  const lineHeight = Number(options.lineHeight) > 0 ? Number(options.lineHeight) : 1.5;
  const lang = options.lang || 'uk-UA';

  const titlePage =
    options.titlePage === false
      ? ''
      : `<section class="title-page">` +
        `<div class="t">${escapeHtml(options.title)}</div>` +
        (options.subtitle ? `<div class="s">${escapeHtml(options.subtitle)}</div>` : '') +
        (options.author ? `<div class="a">${escapeHtml(options.author)}</div>` : '') +
        `</section>`;

  return [
    '<!DOCTYPE html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>${styles(theme, fontSizePt, lineHeight)}</style>`,
    '</head>',
    '<body>',
    titlePage,
    markdownToHtmlBody(markdown),
    '</body>',
    '</html>',
  ].join('\n');
}
