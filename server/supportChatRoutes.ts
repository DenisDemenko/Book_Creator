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
import { decodeImagePayload } from './mediaRoutes';
import { readAsset, saveAsset } from './media/mediaLibraryStore';
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

/** Скільки картинок можна причепити до однієї репліки. */
export const MAX_SUPPORT_ATTACHMENTS = 4;

/** Межа на одну картинку. Знімок екрана 4K у PNG — приблизно 5-8 МБ. */
export const MAX_SUPPORT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Довжина прев'ю останньої репліки в списку тредів (CRM-таблиця). */
const PREVIEW_MAX_CHARS = 140;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Валідація вхідної репліки. Повертає помилку або null.
 *
 * `attachmentCount` — бо репліка з самим лише знімком екрана й без тексту
 * цілком осмислена («ось що я бачу»), і забороняти її було б штучно. Без
 * тексту І без картинок — порожнеча, яку слати нікуди.
 */
export function validateSupportMessage(content: unknown, attachmentCount = 0): string | null {
  const text = typeof content === 'string' ? content : '';
  if (!text.trim() && attachmentCount === 0) return 'Повідомлення не може бути порожнім.';
  if (text.length > MAX_SUPPORT_MESSAGE_CHARS) {
    return `Повідомлення задовге (максимум ${MAX_SUPPORT_MESSAGE_CHARS} символів).`;
  }
  if (attachmentCount > MAX_SUPPORT_ATTACHMENTS) {
    return `Забагато вкладень (максимум ${MAX_SUPPORT_ATTACHMENTS} за одну репліку).`;
  }
  return null;
}

/**
 * Зберігає картинки репліки у медіасховищі й повертає їхні id.
 *
 * Свідомо НЕ кладемо байти в базу: медіасховище вже вміє зберігати файли
 * на диск, а в базі лишається тільки список id. Власником стає той, хто
 * надіслав, а доступ другій стороні розмови дає окремий маршрут
 * `/api/support/attachment/:id` нижче — звичайний `/api/media/file/:id`
 * віддає файл лише власникові, тож користувач не побачив би картинку
 * адміністратора, і навпаки.
 *
 * Ліміт сховища тарифу тут навмисно не списується: підтримка — це
 * службове листування, а не матеріали книги автора.
 */
async function saveSupportAttachments(raw: unknown, ownerId: string): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const ids: string[] = [];
  for (const item of raw.slice(0, MAX_SUPPORT_ATTACHMENTS)) {
    const payload = decodeImagePayload(item);
    if (!payload) throw new Error('Вкладення має бути зображенням у форматі data:URL.');
    if (payload.bytes.length > MAX_SUPPORT_ATTACHMENT_BYTES) {
      throw new Error(
        `Зображення завелике (максимум ${(MAX_SUPPORT_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)} МБ).`
      );
    }
    const asset = await saveAsset({
      ownerId,
      bookId: null,
      kind: 'upload',
      filename: 'support-attachment',
      mimeType: payload.mimeType,
      bytes: payload.bytes,
    });
    ids.push(asset.id);
  }
  return ids;
}

export function supportMessagePreview(content: string, attachmentCount = 0): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  // Репліка може бути самим лише знімком екрана — тоді в списку тредів
  // CRM порожній рядок виглядав би як збій, а не як «надіслали картинку».
  if (!flat) return attachmentCount > 0 ? `📎 Зображення (${attachmentCount})` : '';
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
      const incoming = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
      const validationError = validateSupportMessage(req.body?.content, incoming.length);
      if (validationError) return res.status(400).json({ error: validationError });

      const userId = req.principal!.id as string;
      const thread = await getOrCreateThread(userId);
      const now = new Date().toISOString();
      const content = String(req.body?.content ?? '').trim();
      const attachments = await saveSupportAttachments(incoming, userId);
      const message: StoredSupportMessage = {
        id: newId('supportmsg'),
        threadId: thread.id,
        senderRole: 'user',
        senderId: userId,
        content,
        attachments,
        createdAt: now,
      };
      await addSupportMessage(message);
      const updated: StoredSupportThread = {
        ...thread,
        status: 'open',
        lastMessageAt: now,
        lastMessagePreview: supportMessagePreview(content, attachments.length),
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

  /**
   * Байти вкладення. Окремий маршрут, а не `/api/media/file/:id`, бо той
   * віддає файл ЛИШЕ власникові — тобто користувач не побачив би знімок
   * адміністратора, а адміністратор знімок користувача, хоча обидва в
   * одній розмові. Тут право доступу визначає участь у треді:
   * адміністратор бачить будь-яке вкладення, користувач — лише те, що
   * згадане в повідомленнях ЙОГО треда.
   *
   * Чужий файл — 404, а не 403: інакше перебором id можна дізнатися, що
   * саме є в іншого автора (та сама логіка, що в mediaRoutes.ts).
   */
  app.get('/api/support/attachment/:id', requireAuth, async (req, res) => {
    try {
      const assetId = String(req.params.id || '');
      const principal = req.principal!;

      if (principal.role !== 'admin') {
        const thread = await getSupportThreadByUser(principal.id as string);
        if (!thread) return res.status(404).json({ error: 'Файл не знайдено.' });
        const messages = await listSupportMessages(thread.id);
        const allowed = messages.some((m) => (m.attachments || []).includes(assetId));
        if (!allowed) return res.status(404).json({ error: 'Файл не знайдено.' });
      }

      const found = await readAsset(assetId);
      if (!found) return res.status(404).json({ error: 'Файл не знайдено.' });

      res.setHeader('Content-Type', found.record.mimeType);
      res.setHeader('Content-Length', String(found.bytes.length));
      // Тип не вгадувати: SVG зі скриптом усередині виконався б у нашому ж
      // origin — тому й забороняємо йому будь-які джерела.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (found.record.mimeType === 'image/svg+xml') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      }
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.end(Buffer.from(found.bytes));
    } catch (err) {
      console.error('[support] attachment:', err);
      res.status(500).json({ error: 'Не вдалося прочитати файл.' });
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
      const incoming = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
      const validationError = validateSupportMessage(req.body?.content, incoming.length);
      if (validationError) return res.status(400).json({ error: validationError });

      const thread = await getSupportThread(req.params.id);
      if (!thread) return res.status(404).json({ error: 'Звернення не знайдено.' });

      const adminId = req.principal!.id as string;
      const now = new Date().toISOString();
      const content = String(req.body?.content ?? '').trim();
      const attachments = await saveSupportAttachments(incoming, adminId);
      const message: StoredSupportMessage = {
        id: newId('supportmsg'),
        threadId: thread.id,
        senderRole: 'admin',
        senderId: adminId,
        content,
        attachments,
        createdAt: now,
      };
      await addSupportMessage(message);
      const updated: StoredSupportThread = {
        ...thread,
        lastMessageAt: now,
        lastMessagePreview: supportMessagePreview(content, attachments.length),
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
