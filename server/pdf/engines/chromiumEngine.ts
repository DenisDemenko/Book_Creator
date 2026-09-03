/**
 * Рушій «Chromium» — HTML + CSS через справжній браузер.
 *
 * ЗВІДКИ ВІН УЗЯВСЯ. Власник запропонував `alanshaw/markdown-pdf`. Той пакет
 * бере markdown, робить HTML і друкує його PhantomJS-ом. Модель правильна:
 * виглядом керує таблиця стилів, а не код рендера. Але PhantomJS
 * депрекейтнуто у 2017-му, він не збирається на Alpine й не має arm64, а
 * його движок — WebKit 2016 року, без сучасних `@page`-правил. Тому взято
 * ту саму модель на живому браузері (рішення власника, log.md #101).
 *
 * ЩО ТУТ РОБИТЬ БРАУЗЕР І ЧОГО НЕ РОБИТЬ. Сторінка відкривається без
 * мережі: HTML передається рядком, зображення вже вбудовані як `data:`.
 * Це не оптимізація, а вимога — інакше рендер книги залежав би від того, чи
 * доступний у цю секунду чужий сервер, і два запуски давали б різні файли.
 */

import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
import { buildBookHtml, type BookHtmlTheme } from '../html/bookHtml';
import { bookToMarkdown } from '../bookToMarkdown';
import { loadImageBytes } from '../../media/imageBytes';
import { PAGE_SIZES } from '../pdfTypes';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

/**
 * Шлях до бінарника. `puppeteer-core` навмисно замість `puppeteer`: другий
 * тягне власну копію браузера при кожному `npm ci` (близько 300 МБ у шар
 * збірки), тоді як у образі браузер уже стоїть системним пакетом.
 */
const CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium', // Debian/Ubuntu — так називається пакет у нашому образі
  '/usr/bin/chromium-browser', // Alpine і старіші Debian
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium',
];

/**
 * Шлях шукається, а не задається жорстко: назва бінарника відрізняється між
 * дистрибутивами, і жорсткий шлях означав би, що зміна базового образу тихо
 * вимикає рушій. Змінна оточення лишається головнішою за пошук — щоб
 * локальний запуск можна було направити куди завгодно.
 */
export const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p)) ||
  CHROMIUM_CANDIDATES[0];

/** Скільки чекати на рендер. Книга на 300 сторінок друкується довше за лист. */
const RENDER_TIMEOUT_MS = Number(process.env.CHROMIUM_TIMEOUT_MS) || 120_000;

/** Скільки зображень вбудовувати. Далі HTML стає завеликим для одного рядка. */
const MAX_EMBEDDED_IMAGES = 120;

function pageFormatFor(sizeName: string | undefined): { width: string; height: string } {
  const size = PAGE_SIZES[(sizeName || 'A5') as keyof typeof PAGE_SIZES] || PAGE_SIZES.A5;
  // Chromium приймає розміри рядком з одиницями; наш PAGE_SIZES — у пунктах.
  return { width: `${size.width}pt`, height: `${size.height}pt` };
}

export function chromiumAvailableAt(execPath: string): PdfEngineAvailability {
  if (!execPath) {
    return {
      ok: false,
      reasonUk: 'Не вказано шлях до Chromium.',
      fixUk: 'Задайте CHROMIUM_PATH або встановіть браузер у образ.',
    };
  }
  if (!fs.existsSync(execPath)) {
    return {
      ok: false,
      reasonUk: `Chromium не знайдено за шляхом ${execPath}.`,
      fixUk: 'Браузер ставиться в образ (apk add chromium). Локально задайте CHROMIUM_PATH.',
    };
  }
  return { ok: true };
}

/**
 * Ілюстрації → `data:`-URI просто в HTML.
 *
 * Зображення, яке не прочиталось, НЕ підставляється порожньою картинкою:
 * плейсхолдер лишається текстом підпису, і автор бачить, що саме випало.
 * Битий значок у книзі, яку вже купили, — гірше за відсутню ілюстрацію.
 */
async function embedImages(
  markdown: string,
  images: Array<{ placeholder: string; url: string; captionUk: string }>,
  ownerId: string | null | undefined,
  notesUk: string[]
): Promise<string> {
  let out = markdown;
  let embedded = 0;

  for (const image of images) {
    if (embedded >= MAX_EMBEDDED_IMAGES) {
      notesUk.push(
        `Вставлено перші ${MAX_EMBEDDED_IMAGES} ілюстрацій; решту пропущено — інакше файл сторінки став би завеликим.`
      );
      break;
    }
    try {
      const { mimeType, bytes } = await loadImageBytes(image.url, ownerId);
      const dataUri = `data:${mimeType};base64,${bytes.toString('base64')}`;
      out = out.split(`(${image.placeholder})`).join(`(${dataUri})`);
      embedded += 1;
    } catch (err) {
      notesUk.push(
        `Ілюстрація «${image.captionUk || image.url}» не вставлена: ${(err as Error).message}`
      );
      // Прибираємо саме рядок з картинкою, лишаючи підпис видимим текстом.
      out = out
        .split(`![${image.captionUk}](${image.placeholder})`)
        .join(`*Ілюстрація: ${image.captionUk}*`);
    }
  }

  return out;
}

/** Запуск браузера винесено, щоб тест міг перевірити все, крім самого запуску. */
export type BrowserLauncher = (execPath: string) => Promise<{
  pdf(html: string, opts: Record<string, unknown>): Promise<Uint8Array>;
  close(): Promise<void>;
}>;

export const defaultLauncher: BrowserLauncher = async (execPath) => {
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: execPath,
    // Пісочниця вимкнена свідомо: у контейнері немає user namespaces, і без
    // цього Chromium не стартує взагалі. Сторінка при цьому наша власна й
    // без мережі — див. коментар у шапці файлу.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  return {
    async pdf(html: string, opts: Record<string, unknown>) {
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
        return await page.pdf(opts as never);
      } finally {
        await page.close();
      }
    },
    async close() {
      await browser.close();
    },
  };
};

let launcher: BrowserLauncher = defaultLauncher;

/** Лише для тестів: підміняє запуск браузера. */
export function __setBrowserLauncherForTests(next: BrowserLauncher): void {
  launcher = next;
}

export const chromiumEngine: PdfEngine = {
  id: 'chromium',
  label: 'Chromium (HTML + CSS)',
  strengthUk:
    'Виглядом керує таблиця стилів: переноси, обтікання, складні заголовки — ' +
    'усе, чого власна верстка не вміє. Три теми оформлення на вибір.',
  limitUk:
    'Полів під KDP не гарантує: браузер верстає стрічкою, без дзеркальних ' +
    'відступів і корінця за обсягом.',
  supportsPrint: false,

  async available(): Promise<PdfEngineAvailability> {
    return chromiumAvailableAt(CHROMIUM_PATH);
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const state = await this.available();
    if (!state.ok) {
      throw new PdfEngineError('chromium', 'unavailable', state.reasonUk || 'Chromium недоступний.');
    }

    const notesUk: string[] = [];
    const doc = bookToMarkdown(request.book as never, { frontmatter: false });
    const markdown = await embedImages(doc.markdown, doc.images, request.ownerId, notesUk);

    const spec = request.spec || {};
    const size = pageFormatFor((spec as { pageSize?: string }).pageSize);
    const html = buildBookHtml(markdown, {
      title: doc.meta.title,
      subtitle: doc.meta.subtitle,
      author: doc.meta.author,
      lang: doc.meta.lang,
      theme: (request.theme as BookHtmlTheme) || 'book',
      fontSizePt: (spec as { fontSizePt?: number }).fontSizePt,
      lineHeight: (spec as { lineHeight?: number }).lineHeight,
    });

    let browser: Awaited<ReturnType<BrowserLauncher>> | null = null;
    try {
      browser = await launcher(CHROMIUM_PATH);
      const bytes = await browser.pdf(html, {
        width: size.width,
        height: size.height,
        printBackground: true,
        preferCSSPageSize: false,
        margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;font-size:8pt;color:#6b7280;text-align:center;">' +
          '<span class="pageNumber"></span></div>',
        timeout: RENDER_TIMEOUT_MS,
      });

      const pageCount = (await PDFDocument.load(bytes)).getPageCount();

      notesUk.push(
        'Макет виконано браузером: формат сторінки й кегль узято з налаштувань, ' +
          'решта — з таблиці стилів рушія.'
      );

      return {
        bytes: new Uint8Array(bytes),
        pageCount,
        engineId: 'chromium',
        // Макет книги виконано ЧАСТКОВО, і це сказано прямо: поля, позиція
        // номера й початок нумерації в цьому рушії задає CSS, а не «Верстка PDF».
        honoredSpec: false,
        notesUk,
      };
    } catch (err) {
      const message = (err as Error).message || '';
      throw new PdfEngineError(
        'chromium',
        /timeout|Timed out/i.test(message) ? 'timeout' : 'engine',
        message
      );
    } finally {
      await browser?.close().catch(() => undefined);
    }
  },
};
