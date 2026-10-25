/**
 * Конвеєр чернетки DesignCraft: Студія → `.designcraft` → графічний редактор → назад у Студію.
 *
 *   1. ЧЕРНЕТКА. Сервер верстає книгу тим самим рушієм DesignCraft V3, що й точний PDF
 *      (той самий макет, шаблон, ілюстрації), і зберігає зверстаний документ як артефакт
 *      книги `designcraft` з ревізією, з якої його зібрано. Скрипт запуску завантажує його
 *      в `designcraft-work\<bookId>.designcraft`, і вікно DesignCraft відкриває ТУ САМУ верстку.
 *   2. РЕДАГУВАННЯ відбувається у вікні DesignCraft (автор і агент Claude Code).
 *   3. ПОВЕРНЕННЯ. Скрипт кладе змінений `.designcraft` і PDF назад як артефакти
 *      `designcraft` / `designcraft-pdf` з ревізією книги, з якої почалася робота. Якщо текст
 *      у Студії відтоді змінився, `/api/books/:id/artifacts` позначить їх `stale`.
 *
 * Текст ніколи не повертається з DesignCraft у Студію: джерело тексту — лише Студія.
 */
import express, { type Express, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getBook, getBookRevision, listArtifacts, saveArtifact, type StoredBook } from '../bookStore';
import { hashValue } from '../bookSyncPlan';
import { requireExternalToken } from '../external/externalApiRoutes';
import { bookToPdfInput, designThemeFromBook, specFromBook } from './pdfFromBook';
import { renderWithEngine } from './engines/registry';
import { PdfEngineError } from './engines/types';

/** Найбільший файл, який приймаємо назад із комп'ютера автора. */
export const MAX_RESULT_BYTES = 80 * 1024 * 1024;
const RESULT_KINDS = { designcraft: 'application/vnd.designcraft', 'designcraft-pdf': 'application/pdf' } as const;
type ResultKind = keyof typeof RESULT_KINDS;

/**
 * Відбиток того, що впливає на верстку: текст, структура, макет, шаблон, ілюстрації.
 * Ревізія книги росте на КОЖНЕ збереження (навіть без змін), тож «застаріло» рахуємо
 * за вмістом, а не за номером ревізії — інакше чернетка «старіла б» за секунди.
 */
export function layoutContentHash(book: Record<string, unknown> | null | undefined): string {
  const b = (book || {}) as Record<string, unknown>;
  return hashValue({
    title: b.title ?? null,
    subtitle: b.subtitle ?? null,
    author: b.author ?? null,
    chapters: b.chapters ?? null,
    layoutConfig: b.layoutConfig ?? null,
    illustrations: b.illustrations ?? null,
    footnotes: b.footnotes ?? null,
  });
}

/** Чи змінився вміст книги відтоді, як із ревізії `revision` зібрано файл. */
export async function contentChangedSince(stored: StoredBook, revision: number): Promise<boolean> {
  if (revision === stored.revision) return false;
  const then = await getBookRevision(stored.id, revision);
  if (!then) return true; // ревізії вже немає — чесніше сказати «могло змінитися»
  return layoutContentHash(then) !== layoutContentHash(stored.book);
}

function fail(res: Response, err: unknown) {
  if (err instanceof PdfEngineError) {
    const status = err.kind === 'timeout' ? 504 : err.kind === 'engine' ? 502 : err.kind === 'bad_input' ? 400 : 503;
    return res.status(status).json({ error: err.message, kind: err.kind });
  }
  console.error('[designcraftDraft]', err);
  return res.status(500).json({ error: (err as Error)?.message || 'Не вдалося підготувати чернетку DesignCraft.', kind: 'engine' });
}

async function ownedBook(bookId: string, principal: Request['principal']): Promise<StoredBook | null> {
  const stored = await getBook(bookId);
  if (!stored) return null;
  if (stored.ownerId && stored.ownerId !== principal?.id && principal?.role !== 'admin') return null;
  return stored;
}

/** Зверстати чернетку й зберегти її як артефакт книги. */
export async function buildDesigncraftDraft(stored: StoredBook, principal: Request['principal']) {
  const book = stored.book as any;
  const rendered = await renderWithEngine('designcraft', {
    book: bookToPdfInput(book),
    kind: 'book',
    spec: specFromBook(book),
    print: false,
    ownerId: (principal?.id as string) || null,
    ownerRole: (principal?.role as string) || null,
    theme: designThemeFromBook(book),
    keepDocument: true,
  });
  if (!rendered.document) {
    throw new PdfEngineError('designcraft', 'engine', 'DesignCraft зверстав PDF, але не повернув документ чернетки.');
  }
  const record = await saveArtifact({
    bookId: stored.id,
    kind: 'designcraft',
    filename: `${stored.id}.designcraft`,
    mimeType: RESULT_KINDS.designcraft,
    bytes: rendered.document.bytes,
    pageCount: rendered.pageCount,
    variant: designThemeFromBook(book) || null,
    bookRevision: stored.revision,
  });
  return { record, bytes: rendered.document.bytes, notesUk: rendered.notesUk };
}

function sendDraft(res: Response, out: Awaited<ReturnType<typeof buildDesigncraftDraft>>) {
  res.setHeader('Content-Type', RESULT_KINDS.designcraft);
  res.setHeader('Content-Disposition', `attachment; filename="${out.record.filename.replace(/[^\x20-\x7E]/g, '_')}"`);
  res.setHeader('X-Book-Revision', String(out.record.bookRevision));
  res.setHeader('X-Pdf-Pages', String(out.record.pageCount ?? ''));
  res.setHeader('X-Pdf-Note', encodeURIComponent(out.notesUk.join(' ')));
  return res.send(Buffer.from(out.bytes));
}

export function registerDesigncraftDraftRoutes(app: Express): void {
  const externalAuth = requireExternalToken();

  /** Автор у Студії: «Підготувати чернетку для DesignCraft». */
  app.post('/api/books/:id/designcraft-draft', requireAuth, async (req: Request, res: Response) => {
    try {
      const stored = await ownedBook(String(req.params.id), req.principal);
      if (!stored) return res.status(404).json({ error: 'Книгу не знайдено на сервері. Збережіть її в Студії.' });
      return sendDraft(res, await buildDesigncraftDraft(stored, req.principal));
    } catch (err) {
      return fail(res, err);
    }
  });

  /**
   * Чернетка й результат DesignCraft цієї книги з чесним «застаріло»: за вмістом, а не за
   * номером ревізії (див. layoutContentHash).
   */
  app.get('/api/books/:id/designcraft-status', requireAuth, async (req: Request, res: Response) => {
    try {
      const stored = await ownedBook(String(req.params.id), req.principal);
      if (!stored) return res.status(404).json({ error: 'Книгу не знайдено на сервері.' });
      const items = (await listArtifacts(stored.id)).filter((a) => a.kind === 'designcraft' || a.kind === 'designcraft-pdf');
      const artifacts = [];
      for (const a of items) artifacts.push({ ...a, stale: await contentChangedSince(stored, a.bookRevision) });
      return res.json({ revision: stored.revision, artifacts });
    } catch (err) {
      return fail(res, err);
    }
  });

  /** Скрипт запуску (токен застосунку): та сама чернетка для вікна DesignCraft. */
  app.post('/api/external/v1/books/:bookId/designcraft-draft', externalAuth, async (req: Request, res: Response) => {
    try {
      const stored = await getBook(String(req.params.bookId));
      if (!stored || stored.ownerId !== req.principal?.id) return res.status(404).json({ error: 'Книгу не знайдено.' });
      return sendDraft(res, await buildDesigncraftDraft(stored, req.principal));
    } catch (err) {
      return fail(res, err);
    }
  });

  /**
   * Повернення результату з вікна DesignCraft: `.designcraft` або PDF.
   * `X-Book-Revision` — ревізія книги, з якої почалася робота; за нею Студія скаже «застаріло».
   */
  app.put(
    '/api/external/v1/books/:bookId/designcraft-result/:kind',
    externalAuth,
    express.raw({ type: () => true, limit: MAX_RESULT_BYTES }),
    async (req: Request, res: Response) => {
      try {
        const kind = String(req.params.kind) as ResultKind;
        if (!(kind in RESULT_KINDS)) return res.status(400).json({ error: 'Вид файла: designcraft або designcraft-pdf.' });
        const stored = await getBook(String(req.params.bookId));
        if (!stored || stored.ownerId !== req.principal?.id) return res.status(404).json({ error: 'Книгу не знайдено.' });
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (bytes.length < 16) return res.status(400).json({ error: 'Порожній файл.' });
        if (kind === 'designcraft-pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
          return res.status(400).json({ error: 'Це не PDF.' });
        }
        const revision = Number(req.headers['x-book-revision']);
        if (!Number.isInteger(revision) || revision < 0 || revision > stored.revision) {
          return res.status(400).json({ error: 'Потрібен заголовок X-Book-Revision — ревізія книги, з якої почалася верстка.' });
        }
        const record = await saveArtifact({
          bookId: stored.id,
          kind,
          filename: `${stored.id}${kind === 'designcraft' ? '.designcraft' : '.pdf'}`,
          mimeType: RESULT_KINDS[kind],
          bytes: new Uint8Array(bytes),
          variant: 'designcraft-gui',
          bookRevision: revision,
        });
        return res.status(201).json({ artifact: record, stale: await contentChangedSince(stored, revision), currentRevision: stored.revision });
      } catch (err) {
        return fail(res, err);
      }
    }
  );
}
