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

function requestFromAuthorPreview(req: Request) {
  const book = req.body?.book as Record<string, unknown> | undefined;
  if (!book || !String(book.title || '').trim()) {
    throw new PdfEngineError(DEFAULT_PDF_ENGINE, 'bad_input', 'Потрібен об’єкт книги з назвою.');
  }

  const principal = req.principal;
  const engineId = typeof req.body?.engineId === 'string' && req.body.engineId.trim()
    ? req.body.engineId.trim()
    : DEFAULT_PDF_ENGINE;
  const isPrint = req.body?.format === 'print';

  return {
    engineId,
    request: {
      book: bookToPdfInput(book as never),
      kind: req.body?.kind === 'course' ? 'course' as const : 'book' as const,
      spec: specFromBook(book as never),
      print: isPrint,
      ownerId: (principal?.id as string) || null,
      ownerRole: (principal?.role as string) || null,
      theme: typeof req.body?.theme === 'string' ? req.body.theme : undefined,
    },
  };
}

async function renderAuthorPreview(req: Request, res: Response) {
  try {
    const { engineId, request } = requestFromAuthorPreview(req);
    const rendered = await renderWithEngine(engineId, request);

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

async function renderAuthorPagination(req: Request, res: Response) {
  try {
    const { engineId, request } = requestFromAuthorPreview(req);
    const rendered = await renderWithEngine(engineId, request);
    if (!rendered.pagination) {
      throw new PdfEngineError(
        rendered.engineId,
        'engine',
        'PDF-рушій створив файл без PaginationResult.'
      );
    }

    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      engineId: rendered.engineId,
      pageCount: rendered.pageCount,
      honoredSpec: rendered.honoredSpec,
      notesUk: rendered.notesUk,
      pagination: rendered.pagination,
    });
  } catch (err) {
    return fail(res, err);
  }
}

/**
 * Full-book preview for an authenticated author. The returned bytes are the
 * actual export-engine PDF, so page N in this viewer is physically page N in
 * an export rendered with the same engine/spec/book snapshot.
 *
 * `/pagination` returns the same engine's PaginationResult as JSON. It is a
 * separate endpoint on purpose: a full semantic page map can be much larger
 * than a safe HTTP response header and must never be truncated there.
 */
export function registerAuthorPdfPreviewRoutes(app: Express): void {
  app.post('/api/pdf/author-preview', requireAuth, renderAuthorPreview);
  app.post('/api/pdf/author-preview/pagination', requireAuth, renderAuthorPagination);
}
