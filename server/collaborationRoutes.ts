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

const INVITE_ROLES: StoredCollabInvite['role'][] = ['designer', 'publisher', 'translator', 'reader'];

const ROLE_NAMES_UK: Record<StoredCollabInvite['role'], string> = {
  designer: 'Дизайнер',
  publisher: 'Видавець',
  translator: 'Перекладач',
  reader: 'Читач (бета-рідер)',
};

/** Короткий опис того, чим займатиметься запрошений у своїй ролі (лист-запрошення). */
const ROLE_BLURBS_UK: Record<StoredCollabInvite['role'], string> = {
  designer: 'Обкладинка книги, ілюстрації, Visual Bible та медіатека видання.',
  publisher: 'Верстка, поліграфічні стандарти, аудит Amazon KDP і експорт тиражу.',
  translator: 'Переклад книги англійською (English Edition) у двомовному режимі.',
  reader: 'Читання рукопису та відгуки для автора (бета-рідинг), без права редагування.',
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

export function inviteEmailHtml(
  bookTitle: string,
  roleUk: string,
  roleBlurb: string,
  inviterName: string,
  inviteeEmail: string,
  link: string
): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#0b1120;padding:36px 16px;color:#e2e8f0">
      <div style="max-width:560px;margin:0 auto;background:#0f172a;border-radius:20px;overflow:hidden;border:1px solid #1e293b">
        <!-- Шапка-герой -->
        <div style="padding:36px 32px 28px;background:radial-gradient(130% 150% at 15% 0%, #1e293b 0%, #0f172a 65%)">
          <div style="color:#f59e0b;font-size:11px;font-weight:bold;letter-spacing:3px">FUSION LAB STUDIO · ВИДАВНИЧА МАЙСТЕРНЯ</div>
          <h1 style="margin:18px 0 10px;font-size:22px;line-height:1.4;color:#f8fafc">
            Запрошення до співпраці з письменником «${inviterName}» в маркетплейсі Fusion Lab Studio
          </h1>
          <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.7">
            Вас обрано до роботи над книгою «<b style="color:#f8fafc">${bookTitle}</b>».
          </p>
        </div>

        <div style="padding:26px 32px 30px">
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#cbd5e1">
            Це не розсилка. Автор шукає людину саме з вашими навичками, щоб довести
            книгу до читача — і ваша роль тут не випадкова.
          </p>

          <!-- Картка ролі -->
          <div style="background:#1e293b;border:1px solid #334155;border-left:3px solid #f59e0b;border-radius:12px;padding:16px 18px;margin:0 0 22px">
            <div style="font-size:11px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase">Ваша роль у книзі</div>
            <div style="font-size:17px;font-weight:bold;color:#f8fafc;margin-top:5px">${roleUk}</div>
            <div style="font-size:13px;color:#cbd5e1;margin-top:6px;line-height:1.6">${roleBlurb}</div>
          </div>

          <p style="margin:0 0 10px;font-size:14px;font-weight:bold;color:#f8fafc">Щоб приєднатися:</p>
          <ol style="margin:0 0 22px;padding-left:20px;font-size:13px;line-height:1.7;color:#cbd5e1">
            <li style="margin-bottom:6px">Натисніть кнопку нижче й увійдіть (або зареєструйтесь) під поштою <b>${inviteeEmail}</b>.</li>
            <li style="margin-bottom:0">У вікні «Вибір ролі входу» оберіть роль <b>${roleUk}</b> — її зафіксовано в цьому листі.</li>
          </ol>

          <p style="margin:0 0 18px;text-align:center">
            <a href="${link}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 30px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:14px">Приєднатися до команди книги</a>
          </p>

          <p style="font-size:12px;color:#64748b;margin:0 0 22px;text-align:center">
            Якщо кнопка не працює, скопіюйте це посилання у браузер:<br>${link}
          </p>

          <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">
            З повагою,<br>
            <b style="color:#e2e8f0">команда FUSION LAB STUDIO</b>
          </p>
        </div>

        <div style="background:#0b1120;border-top:1px solid #1e293b;padding:14px 32px;font-size:11px;color:#64748b;line-height:1.6">
          Лист адресований ${inviteeEmail} і дійсний лише для ролі «${roleUk}». Пересилати його іншим не можна — посилання прив'язане до адреси.
        </div>
      </div>
    </div>`;
}

export function inviteEmailText(
  bookTitle: string,
  roleUk: string,
  roleBlurb: string,
  inviterName: string,
  inviteeEmail: string,
  link: string
): string {
  return [
    'FUSION LAB STUDIO · Видавнича майстерня',
    '',
    `Запрошення до співпраці з письменником «${inviterName}» в маркетплейсі Fusion Lab Studio.`,
    '',
    `Вас обрано до роботи над книгою «${bookTitle}».`,
    '',
    `Ваша роль: ${roleUk}`,
    roleBlurb,
    '',
    'Щоб приєднатися:',
    `1. Відкрийте посилання нижче й увійдіть (або зареєструйтесь) під поштою ${inviteeEmail}.`,
    `2. У вікні «Вибір ролі входу» оберіть роль «${roleUk}» — її зафіксовано в цьому листі.`,
    '',
    `Посилання: ${link}`,
    '',
    `Лист адресований ${inviteeEmail} і дійсний лише для ролі «${roleUk}».`,
    '',
    'З повагою,',
    'команда FUSION LAB STUDIO',
  ].join('\n');
}

export function registerCollaborationRoutes(app: Express): void {
  /** Письменник (або адмін) надсилає запрошення дизайнеру/видавцю/перекладачу/бета-читачу. */
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
        return res.status(400).json({ error: 'Роль запрошення має бути designer, publisher, translator або reader.' });
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
        subject: `Запрошення до книги «${invite.bookTitle}» — роль: ${ROLE_NAMES_UK[role]}`,
        html: inviteEmailHtml(invite.bookTitle, ROLE_NAMES_UK[role], ROLE_BLURBS_UK[role], principal.name || 'Автор', invite.inviteeEmail, inviteLink),
        text: inviteEmailText(invite.bookTitle, ROLE_NAMES_UK[role], ROLE_BLURBS_UK[role], principal.name || 'Автор', invite.inviteeEmail, inviteLink),
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
