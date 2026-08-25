/**
 * Cowork-режим: письменник запрошує дизайнера/видавця/перекладача до
 * КОНКРЕТНОЇ книги поштою. Адміністратор сайту в жодне запрошення не
 * потребує — він і так має права письменника в будь-якій кімнаті спільної
 * роботи (див. requireBookOwner нижче та клієнтську перевірку ролі).
 *
 * Хто «власник» книги (тобто хто саме «письменник», якому дозволено
 * запрошувати): книги в цьому застосунку не мають серверного власника
 * (вони живуть у IndexedDB браузера — src/utils/storage.ts, синхронізуються
 * лише через WS-кімнату спільної роботи за bookId — server.ts). Тому
 * власника «книги» для cowork фіксуємо лениво: перший зареєстрований
 * користувач, який звернувся з запрошенням для цього bookId, стає її
 * власником назавжди (book_collab_owners); усі наступні запити на
 * запрошення для того самого bookId дозволені лише йому (або admin).
 */

import crypto from 'node:crypto';
import type { Express } from 'express';
import { requireAuth } from './auth';
import {
  createCollabInvite,
  findCollabInviteByToken,
  findCollabInviteById,
  listCollabInvitesForBook,
  updateCollabInvite,
  getBookOwner,
  setBookOwnerIfAbsent,
  type StoredCollabInvite,
} from './store';
import { sendMail } from './mail';

const INVITE_ROLES: StoredCollabInvite['role'][] = ['designer', 'publisher', 'translator'];

const ROLE_NAMES_UK: Record<StoredCollabInvite['role'], string> = {
  designer: 'Дизайнер',
  publisher: 'Видавець',
  translator: 'Перекладач',
};

function isValidRole(role: unknown): role is StoredCollabInvite['role'] {
  return typeof role === 'string' && (INVITE_ROLES as string[]).includes(role);
}

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

function appBaseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  return process.env.APP_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
}

interface ManageGuardResult {
  ok: boolean;
  status: number;
  error: string;
}

/** admin завжди проходить; інакше — лише зафіксований власник книги. */
async function assertCanManageInvites(bookId: string, principal: { id: string | null; role: string }): Promise<ManageGuardResult> {
  if (principal.role === 'admin') return { ok: true, status: 200, error: '' };
  if (!principal.id) return { ok: false, status: 401, error: 'Потрібен вхід у систему.' };

  const owner = await setBookOwnerIfAbsent(bookId, principal.id);
  if (owner.ownerUserId !== principal.id) {
    return { ok: false, status: 403, error: 'Запрошувати співавторів до цієї книги може лише її письменник (власник) або адміністратор сайту.' };
  }
  return { ok: true, status: 200, error: '' };
}

function inviteEmailHtml(bookTitle: string, roleUk: string, inviterName: string, link: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1e293b">
      <h2 style="margin:0 0 12px">Запрошення до спільної роботи над книгою</h2>
      <p>${inviterName} запрошує вас приєднатися до книги «<b>${bookTitle}</b>» на платформі NOVA STUDIO у ролі <b>${roleUk}</b>.</p>
      <p style="margin:20px 0">
        <a href="${link}" style="background:#f59e0b;color:#0f172a;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Прийняти запрошення</a>
      </p>
      <p style="font-size:12px;color:#64748b">Якщо кнопка не працює, скопіюйте це посилання у браузер:<br>${link}</p>
    </div>`;
}

function inviteEmailText(bookTitle: string, roleUk: string, inviterName: string, link: string): string {
  return `${inviterName} запрошує вас приєднатися до книги «${bookTitle}» на платформі NOVA STUDIO у ролі ${roleUk}.\n\nПосилання для приєднання: ${link}`;
}

export function registerCollaborationRoutes(app: Express): void {
  /** Письменник (або адмін) надсилає запрошення дизайнеру/видавцю/перекладачу. */
  app.post('/api/collaboration/invite', requireAuth, async (req, res) => {
    try {
      const { bookId, bookTitle, email, role } = req.body || {};
      if (typeof bookId !== 'string' || !bookId.trim()) {
        return res.status(400).json({ error: 'Відсутній ідентифікатор книги.' });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Вкажіть коректну електронну пошту запрошуваного.' });
      }
      if (!isValidRole(role)) {
        return res.status(400).json({ error: 'Роль запрошення має бути designer, publisher або translator.' });
      }

      const principal = req.principal!;
      const guard = await assertCanManageInvites(bookId, principal);
      if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

      const token = crypto.randomBytes(24).toString('hex');
      const invite: StoredCollabInvite = {
        id: `inv-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        bookId,
        bookTitle: typeof bookTitle === 'string' && bookTitle.trim() ? bookTitle.trim() : 'Без назви',
        inviterUserId: principal.id || 'admin',
        inviteeEmail: String(email).trim().toLowerCase(),
        role,
        token,
        status: 'pending',
        emailSent: false,
        createdAt: new Date().toISOString(),
      };

      const inviteLink = `${appBaseUrl(req)}/?invite=${token}`;
      const emailSent = await sendMail({
        to: invite.inviteeEmail,
        subject: `Запрошення до книги «${invite.bookTitle}» — NOVA STUDIO`,
        html: inviteEmailHtml(invite.bookTitle, ROLE_NAMES_UK[role], principal.name || 'Автор', inviteLink),
        text: inviteEmailText(invite.bookTitle, ROLE_NAMES_UK[role], principal.name || 'Автор', inviteLink),
      });
      invite.emailSent = emailSent;

      await createCollabInvite(invite);
      res.json({ ok: true, invite, inviteLink, emailSent });
    } catch (err) {
      console.error('[collaboration] invite:', err);
      res.status(500).json({ error: 'Не вдалося створити запрошення.' });
    }
  });

  /** Список запрошень для книги — лише власнику/адміну (панель у CollaborationDrawer). */
  app.get('/api/collaboration/invites', requireAuth, async (req, res) => {
    try {
      const bookId = String(req.query.bookId || '');
      if (!bookId) return res.status(400).json({ error: 'Відсутній ідентифікатор книги.' });

      const principal = req.principal!;
      if (principal.role !== 'admin') {
        const owner = await getBookOwner(bookId);
        if (owner && owner.ownerUserId !== principal.id) {
          return res.status(403).json({ error: 'Перегляд запрошень доступний лише письменнику (власнику) книги або адміністратору.' });
        }
      }

      const invites = await listCollabInvitesForBook(bookId);
      res.json({ invites });
    } catch (err) {
      console.error('[collaboration] list invites:', err);
      res.status(500).json({ error: 'Не вдалося завантажити список запрошень.' });
    }
  });

  /** Публічний перегляд запрошення за токеном — для сторінки прийняття (без входу). */
  app.get('/api/collaboration/invite/:token', async (req, res) => {
    try {
      const invite = await findCollabInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ error: 'Запрошення не знайдено або воно недійсне.' });
      res.json({
        bookId: invite.bookId,
        bookTitle: invite.bookTitle,
        role: invite.role,
        inviteeEmail: invite.inviteeEmail,
        status: invite.status,
      });
    } catch (err) {
      console.error('[collaboration] get invite:', err);
      res.status(500).json({ error: 'Не вдалося завантажити запрошення.' });
    }
  });

  /** Прийняття запрошення — лише зареєстрованим користувачем з тією ж поштою. */
  app.post('/api/collaboration/invite/:token/accept', requireAuth, async (req, res) => {
    try {
      const invite = await findCollabInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ error: 'Запрошення не знайдено або воно недійсне.' });
      if (invite.status !== 'pending') {
        return res.status(409).json({ error: 'Це запрошення вже використане або скасоване.' });
      }

      const principal = req.principal!;
      if (principal.email.trim().toLowerCase() !== invite.inviteeEmail) {
        return res.status(403).json({
          error: `Це запрошення адресоване ${invite.inviteeEmail}. Увійдіть саме під цією поштою, щоб прийняти його.`,
        });
      }

      const updated = await updateCollabInvite(invite.id, {
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
        acceptedUserId: principal.id || undefined,
      });

      res.json({ ok: true, bookId: invite.bookId, bookTitle: invite.bookTitle, role: invite.role, invite: updated });
    } catch (err) {
      console.error('[collaboration] accept invite:', err);
      res.status(500).json({ error: 'Не вдалося прийняти запрошення.' });
    }
  });

  /** Скасування ще не прийнятого запрошення — власником книги або адміном. */
  app.post('/api/collaboration/invite/:id/revoke', requireAuth, async (req, res) => {
    try {
      const invite = await findCollabInviteById(req.params.id);
      if (!invite) return res.status(404).json({ error: 'Запрошення не знайдено.' });

      const principal = req.principal!;
      const guard = await assertCanManageInvites(invite.bookId, principal);
      if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

      const updated = await updateCollabInvite(invite.id, { status: 'revoked' });
      res.json({ ok: true, invite: updated });
    } catch (err) {
      console.error('[collaboration] revoke invite:', err);
      res.status(500).json({ error: 'Не вдалося скасувати запрошення.' });
    }
  });
}
