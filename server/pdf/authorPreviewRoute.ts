import type { Express, Request, Response } from 'express';
import { requireAuth } from '../auth';
import { bookToPdfInput, specFromBook } from './pdfFromBook';
import { renderWithEngine } from './engines/registry';
import { DEFAULT_PDF_ENGINE, PdfEngineError } from './engines/types';

function fail(res: Response, err: unknown) {
  if (err instanceof PdfEngineError) {
    const status = err.kind === 'timeout' ? 504 : err.kind === 'engine' ? 502 : err.kind === 'bad_input' ? 400 : 503;
    return res.status(status).json({ error: err.message, kind: err.kind, engineId: err.engineId });
  }
  const message = err instanceof Error ? err.message : 'Не вдалося створити PDF preview.';
  return res.status(500).json({ error: message, kind: 'engine' });
}

async function renderAuthorPreview(req: Request, res: Response) {
  try {
    const book = req.body?.book as Record<string, unknown> | undefined;
    if (!book || !String(book.title || '').trim()) {
      return res.status(400).json({ error: 'Потрібен об’єкт книги з назвою.', kind: 'bad_input' });
    }

    const principal = req.principal;
    const engineId = typeof req.body?.engineId === 'string' && req.body.engineId.trim()
      ? req.body.engineId.trim()
      : DEFAULT_PDF_ENGINE;
    const isPrint = req.body?.format === 'print';
    const spec = specFromBook(book as never);

    const rendered = await renderWithEngine(engineId, {
      book: bookToPdfInput(book as never),
      kind: req.body?.kind === 'course' ? 'course' : 'book',
      spec,
      print: isPrint,
      ownerId: (principal?.id as string) || null,
      ownerRole: (principal?.role as string) || null,
      theme: typeof req.body?.theme === 'string' ? req.body.theme : undefined,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="author-preview-${rendered.engineId}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Pdf-Pages', String(rendered.pageCount));
    res.setHeader('X-Pdf-Engine', rendered.engineId);
    res.setHeader('X-Pdf-Honored-Spec', rendered.honoredSpec ? '1' : '0');
    res.setHeader('X-Pdf-Mapping-Level', rendered.pagination?.mappingLevel || 'physical-only');
    res.setHeader('X-Pdf-Authoritative', rendered.pagination?.exportAuthoritative ? '1' : '0');
    res.setHeader('X-Pdf-Note', encodeURIComponent(rendered.notesUk.join(' ')));
    return res.send(Buffer.from(rendered.bytes));
  } catch (err) {
    return fail(res, err);
  }
}

/**
 * Full-book preview for an authenticated author. The returned bytes are the
 * actual export-engine PDF, so page N in this viewer is physically page N in
 * an export rendered with the same engine/spec/book snapshot.
 */
export function registerAuthorPdfPreviewRoutes(app: Express): void {
  app.post('/api/pdf/author-preview', requireAuth, renderAuthorPreview);
}
