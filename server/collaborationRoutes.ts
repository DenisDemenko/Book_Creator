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
  // Публічна адреса студії (напр. https://www.fusionlab.in.ua/studio) —
  // саме сюди має вести лист-запрошення, а не на localhost сервера.
  const studioUrl = process.env.STUDIO_PUBLIC_URL?.replace(/\/$/, '');
  if (studioUrl) return studioUrl;
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  if (appUrl) {
    // НЕлокальна APP_URL — продакшн за маркетплейсом, студія живе під /studio.
    if (!/(localhost|127\.0\.0\.1)/.test(appUrl)) return `${appUrl}/studio`;
    return appUrl;
  }
  return `${req.protocol}://${req.get('host')}`;
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
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:32px 16px;color:#0f172a">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <!-- Шапка -->
        <div style="padding:30px 32px 0;text-align:center">
          <span style="display:inline-block;border:1px solid #93c5fd;color:#2563eb;border-radius:999px;padding:6px 16px;font-size:10px;font-weight:bold;letter-spacing:2px">FUSION LAB STUDIO · PUBLISHING MARKETPLACE</span>
          <h1 style="margin:18px 0 8px;font-size:26px;line-height:1.3;color:#0f172a">Запрошення до співпраці</h1>
          <p style="margin:0 0 22px;font-size:14px;color:#475569">
            Письменник «<b>${inviterName}</b>» · Книга «<b>${bookTitle}</b>»
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0">
        </div>

        <div style="padding:22px 32px 30px">
          <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#334155">
            Це не масова розсилка. Автор особисто обрав вас — людину з потрібними
            навичками — щоб разом довести цю книгу до читача.
          </p>

          <!-- Роль -->
          <div style="background:#eef2ff;border:1px solid #e0e7ff;border-radius:12px;padding:16px 18px;margin:0 0 20px">
            <div style="font-size:10px;font-weight:bold;letter-spacing:2px;color:#6366f1;margin-bottom:6px">🔒 ВАША РОЛЬ У ПРОЄКТІ</div>
            <div style="font-size:14px;line-height:1.6;color:#1e293b">
              <b>${roleUk}</b> — ${roleBlurb}
            </div>
          </div>

          <p style="margin:0 0 12px;font-size:15px;font-weight:bold;color:#0f172a">Як приєднатися:</p>

          <!-- Кроки -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">
            <tr>
              <td width="33%" valign="top" style="padding:0 8px 0 0">
                <div style="font-size:11px;font-weight:bold;color:#2563eb;margin-bottom:4px">01</div>
                <div style="font-size:13px;font-weight:bold;color:#0f172a;margin-bottom:4px">Натисніть кнопку нижче</div>
                <div style="font-size:12px;line-height:1.6;color:#64748b">Перейдіть до сторінки приєднання до команди книги.</div>
              </td>
              <td width="34%" valign="top" style="padding:0 8px">
                <div style="font-size:11px;font-weight:bold;color:#2563eb;margin-bottom:4px">02</div>
                <div style="font-size:13px;font-weight:bold;color:#0f172a;margin-bottom:4px">Увійдіть або зареєструйтесь</div>
                <div style="font-size:12px;line-height:1.6;color:#64748b">Використайте пошту <b>${inviteeEmail}</b>, на яку надійшло це запрошення.</div>
              </td>
              <td width="33%" valign="top" style="padding:0 0 0 8px">
                <div style="font-size:11px;font-weight:bold;color:#2563eb;margin-bottom:4px">03</div>
                <div style="font-size:13px;font-weight:bold;color:#0f172a;margin-bottom:4px">Оберіть роль у вікні «Вибір ролі»</div>
                <div style="font-size:12px;line-height:1.6;color:#64748b">Оберіть роль <b>${roleUk}</b> — її зафіксовано в цьому листі.</div>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 22px;text-align:center">
            <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:14px">Приєднатися до команди книги</a>
          </p>

          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;font-size:12px;line-height:1.6;color:#1e40af">
            🔒 Цей лист адресований <b>${inviteeEmail}</b> і дійсний лише для ролі «<b>${roleUk}</b>». Пересилати його іншим не можна — посилання прив'язане до адреси.
          </div>
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
    'FUSION LAB STUDIO · PUBLISHING MARKETPLACE',
    '',
    'Запрошення до співпраці',
    '',
    `Письменник «${inviterName}» · Книга «${bookTitle}»`,
    '',
    '----------------------------------------',
    '',
    'Це не масова розсилка. Автор особисто обрав вас — людину з потрібними навичками — щоб разом довести цю книгу до читача.',
    '',
    'ВАША РОЛЬ У ПРОЄКТІ',
    `${roleUk} — ${roleBlurb}`,
    '',
    'Як приєднатися:',
    '',
    '01 Натисніть кнопку нижче',
    '   Перейдіть до сторінки приєднання до команди книги.',
    '',
    '02 Увійдіть або зареєструйтесь',
    `   Використайте пошту ${inviteeEmail}, на яку надійшло це запрошення.`,
    '',
    '03 Оберіть роль у вікні «Вибір ролі»',
    `   Оберіть роль ${roleUk} — її зафіксовано в цьому листі.`,
    '',
    `Посилання: ${link}`,
    '',
    `🔒 Цей лист адресований ${inviteeEmail} і дійсний лише для ролі «${roleUk}». Пересилати його іншим не можна — посилання прив'язане до адреси.`,
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
