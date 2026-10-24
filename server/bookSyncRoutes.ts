/**
 * HTTP-шар синхронізації версій книги між двома серверами.
 *
 * ДВІ РОЛІ, ОДИН ФАЙЛ:
 *   • ПРИЙМАЧ (`/api/sync/books/*`) — відповідає серверу, який синхронізує.
 *     Доступ за спільним секретом `BOOK_SYNC_TOKEN` і лише до книг одного
 *     власника `BOOK_SYNC_OWNER_ID`. Без обох змінних приймача немає зовсім
 *     (404), тож на сервері, де їх не задано, нічого нового не відкрито.
 *   • ІНІЦІАТОР (`/api/books/:id/sync`) — для адміністратора цієї Студії:
 *     показати різницю з віддаленим сервером і застосувати «новіша перемагає».
 *     Працює лише коли задано `BOOK_SYNC_REMOTE_URL` і `BOOK_SYNC_TOKEN`.
 *
 * Самі правила — у `bookSyncPlan.ts`, послідовність дій — у `bookSync.ts`.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import { requireAdmin } from './auth';
import { getCoreJobQueue, getCoreRepository } from './core';
import { scheduleCoreSync } from './core/sync';
import { BookRevisionConflict, getBook, saveBook } from './bookStore';
import { DATA_DIR } from './db';
import {
  RemoteSyncError,
  SyncBlockedError,
  SyncVerifyError,
  createFileSyncState,
  createRemoteSide,
  readSyncConfig,
  syncApply,
  syncStatus,
  tokenMatches,
  type BookSyncSide,
} from './bookSync';
import { summarizeBook } from './bookSyncPlan';

export function registerBookSyncRoutes(app: Express, env: Record<string, string | undefined> = process.env): void {
  const state = createFileSyncState(DATA_DIR);

  // ── Приймач ────────────────────────────────────────────────────────────────

  const receiver = (req: Request, res: Response, next: NextFunction) => {
    const cfg = readSyncConfig(env).receiver;
    if (!cfg) return res.status(404).json({ error: 'Не знайдено.' });
    if (!tokenMatches(req.headers.authorization, cfg.token)) {
      return res.status(401).json({ error: 'Невірний токен синхронізації.' });
    }
    (req as Request & { syncOwnerId?: string }).syncOwnerId = cfg.ownerId;
    next();
  };
  const ownerOf = (req: Request) => (req as Request & { syncOwnerId?: string }).syncOwnerId!;

  const readOwned = async (req: Request) => {
    const stored = await getBook(req.params.id);
    // Чужу книгу віддаємо як відсутню: токен синхронізації не відкриває інших власників.
    if (!stored || stored.ownerId !== ownerOf(req)) return null;
    return stored;
  };

  app.get('/api/sync/books/:id/summary', receiver, async (req, res) => {
    try {
      const stored = await readOwned(req);
      if (!stored) return res.status(404).json({ error: 'Книгу не знайдено.' });
      res.json(summarizeBook(stored));
    } catch (err) {
      console.error('[book-sync]', (err as Error).message);
      res.status(500).json({ error: 'Не вдалося прочитати книгу.' });
    }
  });

  app.get('/api/sync/books/:id', receiver, async (req, res) => {
    try {
      const stored = await readOwned(req);
      if (!stored) return res.status(404).json({ error: 'Книгу не знайдено.' });
      res.json({ id: stored.id, title: stored.title, revision: stored.revision, updatedAt: stored.updatedAt, book: stored.book });
    } catch (err) {
      console.error('[book-sync]', (err as Error).message);
      res.status(500).json({ error: 'Не вдалося прочитати книгу.' });
    }
  });

  app.put('/api/sync/books/:id', receiver, async (req, res) => {
    try {
      const book = req.body?.book;
      if (!book || typeof book !== 'object' || String(book.id || '') !== req.params.id) {
        return res.status(400).json({ error: 'Потрібна книга, id якої збігається з адресою.', kind: 'bad_input' });
      }
      const existing = await getBook(req.params.id);
      if (existing && existing.ownerId !== ownerOf(req)) return res.status(404).json({ error: 'Книгу не знайдено.' });
      const saved = await saveBook({
        book,
        ownerId: ownerOf(req),
        expectedRevision: req.body?.expectedRevision === undefined ? undefined : Number(req.body.expectedRevision),
      });
      void scheduleCoreSync({ repo: getCoreRepository(), queue: getCoreJobQueue() }, saved, 'sync:remote');
      res.json({ revision: saved.revision, updatedAt: saved.updatedAt });
    } catch (err) {
      if (err instanceof BookRevisionConflict) {
        return res.status(409).json({ error: err.message, kind: 'revision_conflict', current: err.current });
      }
      console.error('[book-sync]', (err as Error).message);
      res.status(500).json({ error: 'Не вдалося зберегти книгу.' });
    }
  });

  // ── Ініціатор (адміністратор цієї Студії) ──────────────────────────────────

  const localSide = (principalId: string | null): BookSyncSide => ({
    async getBook(id) {
      const stored = await getBook(id);
      return stored ? { id: stored.id, title: stored.title, revision: stored.revision, updatedAt: stored.updatedAt, book: stored.book } : null;
    },
    async putBook(book, expectedRevision) {
      const saved = await saveBook({ book, ownerId: principalId, expectedRevision });
      void scheduleCoreSync({ repo: getCoreRepository(), queue: getCoreJobQueue() }, saved, 'sync:local');
      return { revision: saved.revision, updatedAt: saved.updatedAt };
    },
  });

  const fail = (res: Response, err: unknown) => {
    if (err instanceof SyncBlockedError) return res.status(409).json({ error: err.message, kind: 'sync_blocked', plan: err.plan });
    if (err instanceof BookRevisionConflict) {
      return res.status(409).json({ error: err.message, kind: 'revision_conflict', current: err.current });
    }
    if (err instanceof RemoteSyncError) {
      return res.status(err.status === 409 ? 409 : 502).json({ error: `Віддалений сервер: ${err.message}`, kind: err.status === 409 ? 'revision_conflict' : 'remote_error' });
    }
    if (err instanceof SyncVerifyError) return res.status(502).json({ error: err.message, kind: 'verify_failed' });
    console.error('[book-sync]', (err as Error)?.message);
    return res.status(502).json({ error: 'Не вдалося зв\'язатися з віддаленим сервером.', kind: 'remote_error' });
  };

  app.get('/api/books/:id/sync', requireAdmin, async (req: Request, res: Response) => {
    const remoteCfg = readSyncConfig(env).remote;
    if (!remoteCfg) return res.json({ enabled: false });
    try {
      const status = await syncStatus(localSide(req.principal?.id ?? null), createRemoteSide(remoteCfg), req.params.id, state);
      res.json({ enabled: true, remoteHost: new URL(remoteCfg.baseUrl).host, ...status });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/books/:id/sync', requireAdmin, async (req: Request, res: Response) => {
    const remoteCfg = readSyncConfig(env).remote;
    if (!remoteCfg) return res.status(400).json({ error: 'Синхронізацію не налаштовано: задайте BOOK_SYNC_REMOTE_URL і BOOK_SYNC_TOKEN.', kind: 'disabled' });
    const direction = req.body?.direction;
    if (direction !== undefined && direction !== 'pull' && direction !== 'push') {
      return res.status(400).json({ error: 'direction — pull або push.', kind: 'bad_input' });
    }
    try {
      const result = await syncApply(localSide(req.principal?.id ?? null), createRemoteSide(remoteCfg), req.params.id, state, { direction });
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  });
}
