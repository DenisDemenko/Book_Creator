import type { Express, Request, Response } from 'express';
import type { Book } from '../../../src/types';
import { requireAuth } from '../../auth';
import { bookToPdfInput, specFromBook } from '../pdfFromBook';
import { extractSamplePages } from '../pdfSample';
import { renderWithEngine } from '../engines/registry';
import { PdfEngineError } from '../engines/types';
import { injectDesigncraftSceneSemantics } from './sceneSemantics';
import { isBookDesignThemeId } from './themes';
import { buildDesigncraftThemePreviewSample } from './themePreviewSample';

const DESIGNCRAFT_ENGINE_ID = 'designcraft';
const THEME_PREVIEW_PAGES = 8;

function fail(res: Response, err: unknown) {
  if (err instanceof PdfEngineError) {
    const status = err.kind === 'timeout' ? 504 : err.kind === 'engine' ? 502 : err.kind === 'bad_input' ? 400 : 503;
    return res.status(status).json({ error: err.message, kind: err.kind, engineId: err.engineId });
  }
  const message = err instanceof Error ? err.message : 'Не вдалося створити DesignCraft preview.';
  return res.status(500).json({ error: message, kind: 'engine' });
}

async function renderThemePreview(req: Request, res: Response) {
  try {
    const book = req.body?.book as Record<string, unknown> | undefined;
    const theme = typeof req.body?.theme === 'string' ? req.body.theme.trim() : '';

    if (!book || !String(book.title || '').trim()) {
      return res.status(400).json({ error: 'Потрібен об’єкт книги з назвою.', kind: 'bad_input' });
    }
    if (!isBookDesignThemeId(theme)) {
      return res.status(400).json({ error: `Невідома дизайн-система: ${theme || 'порожньо'}.`, kind: 'bad_input' });
    }

    const sample = buildDesigncraftThemePreviewSample(book);
    if (sample.sectionCount === 0 || sample.sourceChars === 0) {
      return res.status(400).json({ error: 'У книзі ще немає тексту для живого DesignCraft preview.', kind: 'bad_input' });
    }

    const principal = req.principal;
    const sampleBook = sample.book as unknown as Book;
    const spec = specFromBook(book as never);
    const neutralInput = bookToPdfInput(sampleBook);
    const input = injectDesigncraftSceneSemantics(neutralInput, sampleBook, theme);
    const rendered = await renderWithEngine(DESIGNCRAFT_ENGINE_ID, {
      book: input,
      kind: 'book',
      spec,
      print: false,
      ownerId: (principal?.id as string) || null,
      ownerRole: (principal?.role as string) || null,
      theme,
    });

    // Reduce work before DesignCraft by slicing the manuscript, then enforce
    // a stable eight-page ceiling on the finished PDF. We never fabricate
    // pages: a genuinely short book simply returns fewer than eight.
    const cropped = rendered.pageCount > THEME_PREVIEW_PAGES
      ? await extractSamplePages(rendered.bytes, THEME_PREVIEW_PAGES)
      : null;
    const bytes = cropped?.bytes || rendered.bytes;
    const pageCount = cropped?.pageCount || rendered.pageCount;

    const noteUk = [
      `Швидке preview: ${sample.chapterCount} розд., ${sample.sectionCount} секц., ${sample.sourceChars} символів реального рукопису.`,
      ...rendered.notesUk,
      cropped?.noteUk || '',
    ].filter(Boolean).join(' ');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="theme-preview-${theme}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Pdf-Pages', String(pageCount));
    res.setHeader('X-Pdf-Engine', rendered.engineId);
    res.setHeader('X-Pdf-Theme', theme);
    res.setHeader('X-Pdf-Honored-Spec', rendered.honoredSpec ? '1' : '0');
    res.setHeader('X-Pdf-Sample-Chars', String(sample.sourceChars));
    res.setHeader('X-Pdf-Sample-Sections', String(sample.sectionCount));
    res.setHeader('X-Pdf-Note', encodeURIComponent(noteUk));
    return res.send(Buffer.from(bytes));
  } catch (err) {
    return fail(res, err);
  }
}

/** Author-facing Book Design Studio preview. */
export function registerDesigncraftThemePreviewRoutes(app: Express): void {
  app.post('/api/pdf/designcraft/theme-preview', requireAuth, renderThemePreview);
}
