/**
 * Чат підтримки сайту (адмін-CRM).
 *
 * Окремий канал від AI-чату письменника (chatRoutes.ts): тут зареєстрований
 * користувач пише в підтримку сайту, а адміністратор відповідає з нового
 * розділу CRM в адмінці (двостороннє листування прямо в адмінці, а не лише
 * передача в зовнішню пошту). Доступ — лише залогіненим користувачам:
 * анонімним відвідувачам кнопка чату взагалі не показується на клієнті,
 * а тут для певності те саме перевіряє requireAuth.
 *
 * Один тред на користувача (support_threads.user_id — UNIQUE): кількох
 * паралельних ліній підтримки для одного акаунта не передбачено, тому
 * getOrCreateThread() ліниво створює тред за першим зверненням, а не
 * вимагає окремого POST /threads для його ініціації.
 */

import type { Express } from 'express';
import { requireAuth, requireAdmin, publicUser } from './auth';
import {
  createSupportThread,
  getSupportThread,
  getSupportThreadByUser,
  listAllSupportThreads,
  updateSupportThread,
  addSupportMessage,
  listSupportMessages,
  listUsers,
  type StoredSupportThread,
  type StoredSupportMessage,
} from './store';

/** Обмеження довжини репліки — щоб не заливали в базу мегабайти тексту. */
export const MAX_SUPPORT_MESSAGE_CHARS = 4000;

/** Довжина прев'ю останньої репліки в списку тредів (CRM-таблиця). */
const PREVIEW_MAX_CHARS = 140;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Валідація вхідного тексту репліки. Повертає помилку або null. */
export function validateSupportMessage(content: unknown): string | null {
  if (typeof content !== 'string' || !content.trim()) return 'Повідомлення не може бути порожнім.';
  if (content.length > MAX_SUPPORT_MESSAGE_CHARS) {
    return `Повідомлення задовге (максимум ${MAX_SUPPORT_MESSAGE_CHARS} символів).`;
  }
  return null;
}

export function supportMessagePreview(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_MAX_CHARS ? flat : `${flat.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

async function getOrCreateThread(userId: string): Promise<StoredSupportThread> {
  const existing = await getSupportThreadByUser(userId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const thread: StoredSupportThread = {
    id: newId('support'),
    userId,
    status: 'open',
    lastMessageAt: now,
    lastMessagePreview: '',
    messageCount: 0,
    unreadByAdmin: 0,
    unreadByUser: 0,
    createdAt: now,
    updatedAt: now,
  };
  return createSupportThread(thread);
}

export function registerSupportChatRoutes(app: Express): void {
  // ---------------------------------------------------------------------
  // Користувацька половина — віджет підтримки в кабінеті/редакторі
  // ---------------------------------------------------------------------

  /** Власний тред користувача (створюється за першим зверненням) + історія. */
  app.get('/api/support/thread', requireAuth, async (req, res) => {
    try {
      const userId = req.principal!.id as string;
      const thread = await getOrCreateThread(userId);
      const messages = await listSupportMessages(thread.id);
      if (thread.unreadByUser > 0) {
        await updateSupportThread({ ...thread, unreadByUser: 0 });
        thread.unreadByUser = 0;
      }
      res.json({ thread, messages });
    } catch (err) {
      console.error('[support] get thread:', err);
      res.status(500).json({ error: 'Не вдалося завантажити чат підтримки.' });
    }
  });

  /** Надсилає репліку користувача; тред створюється лінькво за першим повідомленням. */
  app.post('/api/support/thread/messages', requireAuth, async (req, res) => {
    try {
      const validationError = validateSupportMessage(req.body?.content);
      if (validationError) return res.status(400).json({ error: validationError });

      const userId = req.principal!.id as string;
      const thread = await getOrCreateThread(userId);
      const now = new Date().toISOString();
      const content = String(req.body.content).trim();
      const message: StoredSupportMessage = {
        id: newId('supportmsg'),
        threadId: thread.id,
        senderRole: 'user',
        senderId: userId,
        content,
        createdAt: now,
      };
      await addSupportMessage(message);
      const updated: StoredSupportThread = {
        ...thread,
        status: 'open',
        lastMessageAt: now,
        lastMessagePreview: supportMessagePreview(content),
        messageCount: thread.messageCount + 1,
        unreadByAdmin: thread.unreadByAdmin + 1,
        updatedAt: now,
      };
      await updateSupportThread(updated);
      res.status(201).json({ thread: updated, message });
    } catch (err) {
      console.error('[support] send message:', err);
      res.status(500).json({ error: 'Не вдалося надіслати повідомлення.' });
    }
  });

  // ---------------------------------------------------------------------
  // Адмінська половина — розділ CRM в адмінці
  // ---------------------------------------------------------------------

  /** Список усіх тредів підтримки з контактами користувача — для таблиці CRM. */
  app.get('/api/admin/support/threads', requireAdmin, async (_req, res) => {
    try {
      const [threads, users] = await Promise.all([listAllSupportThreads(), listUsers()]);
      const byId = new Map(users.map((u) => [u.id, u]));
      res.json({
        threads: threads.map((t) => {
          const user = byId.get(t.userId);
          return { ...t, user: user ? publicUser(user) : null };
        }),
      });
    } catch (err) {
      console.error('[support] admin list threads:', err);
      res.status(500).json({ error: 'Не вдалося завантажити список звернень.' });
    }
  });

  /** Один тред (за id) + повна історія; позначає непрочитане адміністратором як прочитане. */
  app.get('/api/admin/support/threads/:id', requireAdmin, async (req, res) => {
    try {
      const thread = await getSupportThread(req.params.id);
      if (!thread) return res.status(404).json({ error: 'Звернення не знайдено.' });
      const messages = await listSupportMessages(thread.id);
      if (thread.unreadByAdmin > 0) {
        await updateSupportThread({ ...thread, unreadByAdmin: 0 });
        thread.unreadByAdmin = 0;
      }
      res.json({ thread, messages });
    } catch (err) {
      console.error('[support] admin get thread:', err);
      res.status(500).json({ error: 'Не вдалося завантажити звернення.' });
    }
  });

  /** Відповідь адміністратора в тред. */
  app.post('/api/admin/support/threads/:id/messages', requireAdmin, async (req, res) => {
    try {
      const validationError = validateSupportMessage(req.body?.content);
      if (validationError) return res.status(400).json({ error: validationError });

      const thread = await getSupportThread(req.params.id);
      if (!thread) return res.status(404).json({ error: 'Звернення не знайдено.' });

      const adminId = req.principal!.id as string;
      const now = new Date().toISOString();
      const content = String(req.body.content).trim();
      const message: StoredSupportMessage = {
        id: newId('supportmsg'),
        threadId: thread.id,
        senderRole: 'admin',
        senderId: adminId,
        content,
        createdAt: now,
      };
      await addSupportMessage(message);
      const updated: StoredSupportThread = {
        ...thread,
        lastMessageAt: now,
        lastMessagePreview: supportMessagePreview(content),
        messageCount: thread.messageCount + 1,
        unreadByUser: thread.unreadByUser + 1,
        updatedAt: now,
      };
      await updateSupportThread(updated);
      res.status(201).json({ thread: updated, message });
    } catch (err) {
      console.error('[support] admin reply:', err);
      res.status(500).json({ error: 'Не вдалося надіслати відповідь.' });
    }
  });
}
