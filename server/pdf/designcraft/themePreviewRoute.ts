import type { Express, Request, Response } from 'express';
import type { Book } from '../../../src/types';
import type { CustomBookDesignTheme } from '../../../src/data/customBookDesignTheme';
import { requireAuth } from '../../auth';
import { bookToPdfInput, specFromBook } from '../pdfFromBook';
import { extractSamplePages } from '../pdfSample';
import { renderWithEngine } from '../engines/registry';
import { PdfEngineError } from '../engines/types';
import { applyCustomThemeBlocksToPdfInput } from './customThemeBlocks';
import { injectDesigncraftSceneSemantics } from './sceneSemantics';
import { isBookDesignThemeId, type BookDesignThemeId } from './themes';
import { buildDesigncraftThemePreviewSample } from './themePreviewSample';

const DESIGNCRAFT_ENGINE_ID = 'designcraft';
const THEME_PREVIEW_PAGES = 8;
const MAX_CUSTOM_THEME_BYTES = 96_000;
const MAX_CUSTOM_BLOCKS = 60;

function fail(res: Response, err: unknown) {
  if (err instanceof PdfEngineError) {
    const status = err.kind === 'timeout' ? 504 : err.kind === 'engine' ? 502 : err.kind === 'bad_input' ? 400 : 503;
    return res.status(status).json({ error: err.message, kind: err.kind, engineId: err.engineId });
  }
  const message = err instanceof Error ? err.message : 'Не вдалося створити DesignCraft preview.';
  return res.status(500).json({ error: message, kind: 'engine' });
}

function customThemeOf(raw: unknown): CustomBookDesignTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  } catch {
    return null;
  }
  if (bytes > MAX_CUSTOM_THEME_BYTES) return null;

  const value = raw as Partial<CustomBookDesignTheme>;
  if (typeof value.id !== 'string' || !value.id.startsWith('custom-')) return null;
  if (typeof value.name !== 'string' || !value.name.trim()) return null;
  if (!Array.isArray(value.customBlocks) || value.customBlocks.length > MAX_CUSTOM_BLOCKS) return null;

  return value as CustomBookDesignTheme;
}

function baseThemeFor(custom: CustomBookDesignTheme | null, requested: string): BookDesignThemeId | null {
  if (custom?.basedOn && isBookDesignThemeId(custom.basedOn)) return custom.basedOn;
  if (isBookDesignThemeId(requested)) return requested;
  return custom ? 'classic' : null;
}

async function renderThemePreview(req: Request, res: Response) {
  try {
    const book = req.body?.book as Record<string, unknown> | undefined;
    const requestedTheme = typeof req.body?.theme === 'string' ? req.body.theme.trim() : '';
    const customTheme = customThemeOf(req.body?.customTheme);
    const theme = baseThemeFor(customTheme, requestedTheme);

    if (!book || !String(book.title || '').trim()) {
      return res.status(400).json({ error: 'Потрібен об’єкт книги з назвою.', kind: 'bad_input' });
    }
    if (!theme) {
      return res.status(400).json({ error: `Невідома дизайн-система: ${requestedTheme || 'порожньо'}.`, kind: 'bad_input' });
    }
    if (req.body?.customTheme && !customTheme) {
      return res.status(400).json({ error: 'Некоректна або завелика власна тема.', kind: 'bad_input' });
    }

    const sample = buildDesigncraftThemePreviewSample(book);
    if (sample.sectionCount === 0 || sample.sourceChars === 0) {
      return res.status(400).json({ error: 'У книзі ще немає тексту для живого DesignCraft preview.', kind: 'bad_input' });
    }

    const principal = req.principal;
    const sampleBook = sample.book as unknown as Book;
    const baseSpec = specFromBook(book as never);
    const spec = customTheme
      ? ({
          ...baseSpec,
          customThemeVisuals: {
            fonts: customTheme.fonts || [],
            entities: customTheme.entities || {},
            page: customTheme.page,
          },
        } as typeof baseSpec)
      : baseSpec;
    const neutralInput = bookToPdfInput(sampleBook);
    const semanticInput = injectDesigncraftSceneSemantics(neutralInput, sampleBook, theme);
    const custom = customTheme
      ? applyCustomThemeBlocksToPdfInput(semanticInput, sampleBook, customTheme)
      : { input: semanticInput, applied: 0, appendix: 0 };

    const rendered = await renderWithEngine(DESIGNCRAFT_ENGINE_ID, {
      book: custom.input,
      kind: 'book',
      spec,
      print: false,
      ownerId: (principal?.id as string) || null,
      ownerRole: (principal?.role as string) || null,
      theme,
    });

    const cropped = rendered.pageCount > THEME_PREVIEW_PAGES
      ? await extractSamplePages(rendered.bytes, THEME_PREVIEW_PAGES)
      : null;
    const bytes = cropped?.bytes || rendered.bytes;
    const pageCount = cropped?.pageCount || rendered.pageCount;

    const noteUk = [
      `Швидке preview: ${sample.chapterCount} розд., ${sample.sectionCount} секц., ${sample.sourceChars} символів реального рукопису.`,
      customTheme ? `Власна тема «${customTheme.name}»: застосовано ${custom.applied} семантичних блоків${custom.appendix ? `, у додатку ${custom.appendix}` : ''}; типографіка й кольори передані в DesignCraft.` : '',
      ...rendered.notesUk,
      cropped?.noteUk || '',
    ].filter(Boolean).join(' ');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="theme-preview-${customTheme?.id || theme}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Pdf-Pages', String(pageCount));
    res.setHeader('X-Pdf-Engine', rendered.engineId);
    res.setHeader('X-Pdf-Theme', customTheme?.id || theme);
    res.setHeader('X-Pdf-Honored-Spec', rendered.honoredSpec ? '1' : '0');
    res.setHeader('X-Pdf-Sample-Chars', String(sample.sourceChars));
    res.setHeader('X-Pdf-Sample-Sections', String(sample.sectionCount));
    res.setHeader('X-Pdf-Custom-Blocks', String(custom.applied));
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
