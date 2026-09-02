/**
 * Маршрути PDF: попередній перегляд і публікація книги у вітрину з файлом.
 *
 * ЧОМУ КНИГА ПРИХОДИТЬ У ТІЛІ ЗАПИТУ. У Nova немає серверної таблиці книг —
 * у базі лежать користувачі, підписки, сесії чату, публікації, але не текст
 * книги (server/db.ts). Книга живе в клієнті, тож сервер не може отримати її
 * «за id»: її треба надіслати. Звідси і ліміт тіла, і те, що маршрути
 * приймають повний обʼєкт книги.
 *
 * Ланцюг публікації тут замикається повністю: макет → PDF → лістинг у
 * каталозі → файл у лістингу. До цього кожна ланка існувала окремо, і саме
 * тому в них знайшлось чотири вади поспіль (записи #69, #70, #73, #74).
 */

import type { Express, Request, Response } from 'express';
import { requireAdmin } from './auth';
import {
  MarketplaceBridgeError,
  attachBookFileToMarketplace,
  publishBookToMarketplace,
  readBridgeSettings,
} from './marketplaceBridge';
import { resolveCoreTemplate, renderCoreTemplate, type CorePromptTemplateBundle } from './coreAiRegistry';
import { resolveModuleModelId } from './coreModuleModels';
import { renderBookPdf } from './pdf/pdfRenderer';
import { bookToPdfInput, specFromBook } from './pdf/pdfFromBook';
import { normalizeDesignResult, parseBookPdfDesignResponse } from './pdf/pdfDesignPrompt';
import type { PdfLayoutSpec } from './pdf/pdfTypes';

export type LayoutVariant = 'code' | 'design';

export interface PdfRoutesDeps {
  resolveEngine: (modelId: string) => string;
  defaultModelId?: string;
  loadAdminLayer: () => Promise<CorePromptTemplateBundle>;
  generateText: (args: Record<string, unknown>) => Promise<{ text: string }>;
}

/** Скільки тексту книги показати моделі. Більше не потрібно: макет — це не переказ. */
const SAMPLE_CHARS = 2500;

function countWords(book: { chapters?: Array<{ sections?: Array<{ content?: string }> }> }): number {
  let words = 0;
  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) {
      words += String(section.content || '').split(/\s+/).filter(Boolean).length;
    }
  }
  return words;
}

function sampleOf(book: { chapters?: Array<{ sections?: Array<{ content?: string }> }> }): string {
  const parts: string[] = [];
  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) {
      parts.push(String(section.content || ''));
      if (parts.join(' ').length > SAMPLE_CHARS) break;
    }
    if (parts.join(' ').length > SAMPLE_CHARS) break;
  }
  return parts.join('\n\n').slice(0, SAMPLE_CHARS);
}

export function registerPdfRoutes(app: Express, deps: PdfRoutesDeps): void {
  /**
   * Специфікація макета: або переклад налаштувань книги, або пропозиція
   * моделі. Помилка моделі НЕ валить публікацію мовчки — вона піднімається
   * викликачу, щоб автор бачив, що дизайн не вдався, і міг узяти «код».
   */
  async function buildSpec(
    book: Record<string, unknown>,
    variant: LayoutVariant,
    requestedModelId: string | undefined,
    req: Request
  ): Promise<{ spec: PdfLayoutSpec; modelId?: string }> {
    if (variant !== 'design') {
      return { spec: specFromBook(book as never) };
    }

    const modelId = (await resolveModuleModelId('bookPdfDesign', requestedModelId)) || deps.defaultModelId;
    if (!modelId) {
      throw new MarketplaceBridgeError(
        'Для дизайну макета не обрано модель — задайте її в «Ядрі AI» або оберіть варіант «макет із книги».',
        'rejected',
        503
      );
    }

    const template = resolveCoreTemplate('bookPdfDesign', await deps.loadAdminLayer());
    const rendered = renderCoreTemplate('bookPdfDesign', template, {
      title: String(book.title || ''),
      subtitle: String(book.subtitle || ''),
      genre: String(book.genre || ''),
      audience: String(book.targetAudience || ''),
      chapterCount: String(((book.chapters as unknown[]) || []).length),
      wordCount: String(countWords(book as never)),
      sample: sampleOf(book as never),
    });

    const out = await deps.generateText({
      engine: deps.resolveEngine(modelId),
      modelId,
      prompt: rendered.user,
      systemInstruction: rendered.system,
      json: true,
      req,
      label: 'Дизайн макета PDF книги',
      bookId: String(book.id || ''),
    });

    let raw: unknown;
    try {
      raw = parseBookPdfDesignResponse(out.text);
    } catch {
      throw new MarketplaceBridgeError(
        'Модель повернула не JSON — оберіть іншу модель або варіант «макет із книги».',
        'rejected',
        502
      );
    }
    return { spec: normalizeDesignResult(raw), modelId };
  }

  function fail(res: Response, err: unknown) {
    const error = err as { message?: string; kind?: string; status?: number };
    const status = err instanceof MarketplaceBridgeError ? err.status : 500;
    res.status(status).json({ error: error?.message || 'Не вдалося зібрати PDF.', kind: error?.kind });
  }

  /**
   * Перегляд: віддає сам файл. Автор має побачити верстку до того, як вона
   * стане товаром — інакше перша людина, яка подивиться на макет, буде
   * покупцем.
   */
  app.post('/api/admin/pdf/preview', requireAdmin, async (req, res) => {
    try {
      const book = req.body?.book;
      if (!book?.title) {
        return res.status(400).json({ error: 'Потрібен обʼєкт книги з назвою.', kind: 'bad_input' });
      }
      const variant: LayoutVariant = req.body?.variant === 'design' ? 'design' : 'code';
      const { spec } = await buildSpec(book, variant, req.body?.modelId, req);
      const out = await renderBookPdf(bookToPdfInput(book), spec);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
      res.setHeader('X-Pdf-Pages', String(out.pageCount));
      // Пояснення макета — заголовком, бо тіло вже зайняте файлом.
      res.setHeader('X-Pdf-Note', encodeURIComponent(spec.designerNoteUk || ''));
      res.send(Buffer.from(out.bytes));
    } catch (err) {
      fail(res, err);
    }
  });

  /** Увесь конвеєр однією дією: макет → PDF → лістинг → файл у лістингу. */
  app.post('/api/admin/pdf/publish', requireAdmin, async (req, res) => {
    try {
      const book = req.body?.book;
      if (!book?.title || !book?.id) {
        return res.status(400).json({ error: 'Потрібен обʼєкт книги з id і назвою.', kind: 'bad_input' });
      }
      const priceMinor = Number(req.body?.priceMinor);
      if (!Number.isFinite(priceMinor) || priceMinor < 0) {
        return res.status(400).json({ error: 'Некоректна ціна.', kind: 'bad_input' });
      }

      const settings = await readBridgeSettings();
      const variant: LayoutVariant = req.body?.variant === 'design' ? 'design' : 'code';
      const { spec, modelId } = await buildSpec(book, variant, req.body?.modelId, req);
      const pdf = await renderBookPdf(bookToPdfInput(book), spec);

      const published = await publishBookToMarketplace(
        {
          bookId: String(book.id),
          format: 'digital',
          title: String(book.title),
          subtitle: book.subtitle ? String(book.subtitle) : undefined,
          summary: book.logline ? String(book.logline) : undefined,
          description: book.synopsis ? String(book.synopsis) : undefined,
          priceMinor: Math.round(priceMinor),
          sellerSlug: req.body?.sellerSlug ? String(req.body.sellerSlug) : undefined,
        },
        { settings }
      );

      // Файл шлемо ПІСЛЯ публікації: приймач прикріплює його до наявного
      // лістинга, і в зворотному порядку отримав би 404.
      const attached = await attachBookFileToMarketplace(
        {
          bookId: String(book.id),
          format: 'digital',
          filename: `${String(book.title).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'book'}.pdf`,
          mimeType: 'application/pdf',
          bytes: pdf.bytes,
        },
        { settings }
      );

      res.json({
        published,
        attached,
        pdf: { pageCount: pdf.pageCount, sizeBytes: pdf.bytes.length },
        layout: {
          variant,
          modelId,
          noteUk: spec.designerNoteUk,
          pageSize: spec.pageSize,
          baseFontSize: spec.baseFontSize,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  });
}
