import type { Express, Request, Response } from 'express';
import { requireAuth } from './auth';
import { bookToPdfInput, specFromBook } from './pdf/pdfFromBook';
import { resolveBookPdfEngineId } from './pdf/enginePreference';
import { renderWithEngine } from './pdf/engines/registry';
import { PdfEngineError } from './pdf/engines/types';

function safeFilename(value: unknown): string {
  const raw = String(value || 'book').trim() || 'book';
  return raw
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'book';
}

function fail(res: Response, err: unknown): void {
  if (err instanceof PdfEngineError) {
    const status = err.kind === 'timeout' ? 504 : err.kind === 'engine' ? 502 : err.kind === 'unavailable' ? 503 : 400;
    res.status(status).json({ error: err.message, kind: err.kind, engineId: err.engineId });
    return;
  }
  const error = err as { message?: string; kind?: string; status?: number };
  res.status(Number(error?.status) || 500).json({
    error: error?.message || 'Не вдалося експортувати PDF.',
    kind: error?.kind || 'export_failed',
  });
}

/**
 * Авторський PDF export без публікації й без server artifact mutation.
 *
 * Це свідомо окремий маршрут від admin preview/publish:
 * - не записує файл у marketplace;
 * - не зберігає artifact/manifest;
 * - не викликає AI design prompt;
 * - використовує той самий renderWithEngine boundary, що й preview/publish.
 *
 * Відповідно один конкретний download генерується одним конкретним engineId,
 * без silent fallback і без повторного перерахунку сторінок у браузері.
 */
export function registerPdfExportRoutes(app: Express): void {
  app.post('/api/pdf/export', requireAuth, async (req: Request, res: Response) => {
    try {
      const book = req.body?.book;
      if (!book?.id || !book?.title) {
        return res.status(400).json({
          error: 'Для PDF-експорту потрібен об’єкт книги з id і назвою.',
          kind: 'bad_input',
        });
      }

      const print = req.body?.format === 'print';
      const engineId = resolveBookPdfEngineId(book, req.body?.engineId);
      const principal = req.principal;
      const spec = specFromBook(book);
      const rendered = await renderWithEngine(engineId, {
        book: bookToPdfInput(book),
        kind: 'book',
        spec,
        print,
        trimId: typeof req.body?.trimId === 'string' ? req.body.trimId : undefined,
        hasBleed: Boolean(req.body?.hasBleed),
        ownerId: (principal?.id as string) || null,
        ownerRole: (principal?.role as string) || null,
        theme: typeof req.body?.theme === 'string' ? req.body.theme : undefined,
      });

      const suffix = print ? 'Print' : 'Digital';
      const filename = `${safeFilename(book.title)}_${suffix}_${safeFilename(rendered.engineId)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Content-Length', String(rendered.bytes.length));
      res.setHeader('X-Pdf-Pages', String(rendered.pageCount));
      res.setHeader('X-Pdf-Engine', rendered.engineId);
      res.setHeader('X-Pdf-Honored-Spec', rendered.honoredSpec ? '1' : '0');
      res.setHeader('X-Pdf-PageMap-Precision', rendered.pageMap.precision);
      res.setHeader('X-Pdf-PageMap-Source', rendered.pageMap.source);
      res.setHeader(
        'X-Pdf-Note',
        encodeURIComponent(
          [rendered.printInfo?.designerNoteUk || spec.designerNoteUk || '', ...rendered.notesUk]
            .filter(Boolean)
            .join(' ')
        )
      );
      res.send(Buffer.from(rendered.bytes));
    } catch (err) {
      fail(res, err);
    }
  });
}
