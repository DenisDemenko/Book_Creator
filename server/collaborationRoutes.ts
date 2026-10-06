/**
 * Cowork-режим: письменник запрошує дизайнера/видавця/перекладача до
 * КОНКРЕТНОЇ книги поштою. Адміністратор сайту в жодне запрошення не
 * потребує — він і так має права письменника в будь-якій кімнаті спільної
 * роботи (див. requireBookOwner нижче та клієнтську перевірку ролі).
 *
 * Власник визначається book_collab_owners, а до першого запрошення —
 * серверною копією books.ownerId. Лише для старої, ще не збереженої на
 * сервері книги власність фіксується першим авторським запрошенням.
 * Знання bookId чужої серверної книги не дозволяє привласнити її.
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
import { getBook } from './bookStore';
import { sendMail } from './mail';
import { invitableRoles, roleById, studioRoleFor, activeCollabLabel, activeCollabOntology, type RoleDefinition } from '../src/utils/collabOntology';
import { getCoreRepository } from './core';
import { assignRole } from './core/collaboration/participants';

/**
 * Ролі запрошення — з реєстру ролей (онтологія співпраці, Т6.1; рішення
 * власника: наявні ролі — на реєстр). Запросити можна активну роль із
 * позначкою `invitable`; старі значення (`reader`) зводяться до id реєстру
 * (`beta_reader`). Назва й опис у листі — з реєстру, а не з коду.
 */
function inviteRole(role: unknown): RoleDefinition | null {
  const r = typeof role === 'string' ? roleById(role) : undefined;
  return r && r.invitable && r.status === 'active' ? r : null;
}

/** Як роль запрошення бачить клієнт: простір Студії (designer / publisher / translator / reader) + id і назва з реєстру. */
function inviteRoleView(role: string): { role: string; roleId: string; roleLabel: { uk: string; en: string } | null } {
  const def = roleById(role);
  return { role: studioRoleFor(role) ?? 'reader', roleId: def?.id ?? role, roleLabel: def?.label ?? null };
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

  const registered = await getBookOwner(bookId);
  const storedOwner = registered ? null : (await getBook(bookId))?.ownerId;
  if (storedOwner && storedOwner !== principal.id) return { ok: false, status: 403, error: 'Запрошувати може лише власник серверної книги.' };
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
      const roleDef = inviteRole(role);
      if (!roleDef) {
        return res.status(400).json({ error: `Цю роль не можна запросити. Доступні: ${invitableRoles().map((r) => r.label.uk).join(', ')}.` });
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
        role: roleDef.id,
        token,
        status: 'pending',
        emailSent: false,
        createdAt: new Date().toISOString(),
      };

      const inviteLink = `${appBaseUrl(req)}/?invite=${token}`;
      const mailResult = await sendMail({
        to: invite.inviteeEmail,
        subject: `Запрошення до книги «${invite.bookTitle}» — роль: ${roleDef.label.uk}`,
        html: inviteEmailHtml(invite.bookTitle, roleDef.label.uk, roleDef.description?.uk ?? '', principal.name || 'Автор', invite.inviteeEmail, inviteLink),
        text: inviteEmailText(invite.bookTitle, roleDef.label.uk, roleDef.description?.uk ?? '', principal.name || 'Автор', invite.inviteeEmail, inviteLink),
      });
      invite.emailSent = mailResult.ok;

      await createCollabInvite(invite);
      res.json({
        ok: true,
        invite,
        inviteLink,
        emailSent: mailResult.ok,
        mailError: mailResult.error ?? null,
      });
    } catch (err) {
      console.error('[collaboration] invite:', err);
      res.status(500).json({ error: 'Не вдалося створити запрошення.' });
    }
  });

  /**
   * Реєстр ролей (Т6.1): що можна запросити, усі ролі з категоріями й
   * довідники — для вікна запрошення й онбордингу (Т6.3). Без ядра —
   * вбудована версія 1.0.
   */
  app.get('/api/collaboration/roles', requireAuth, (_req, res) => {
    const def = activeCollabOntology();
    const view = (r: RoleDefinition) => ({
      id: r.id,
      label: r.label,
      description: r.description ?? null,
      category: r.category,
      projectTypes: r.projectTypes,
      workspace: r.defaultWorkspace,
      aiProfile: r.aiProfile,
      combinable: r.combinable,
      legacyIds: r.legacyIds,
      studioRole: studioRoleFor(r.id),
      suggestedCapabilities: r.suggestedCapabilities,
      requiresSpecialization: r.requiresSpecialization,
      specializations: r.specializations,
      singleHolder: r.singleHolder,
      invitable: r.invitable,
      deprecated: r.status === 'deprecated',
    });
    res.json({
      registry: activeCollabLabel(),
      invitable: invitableRoles().map(view),
      roles: [...def.roles].sort((a, b) => a.order - b.order).map(view),
      categories: def.roleCategories,
      projectTypes: def.projectTypes,
      entryIntents: def.entryIntents,
      scopeTypes: def.scopeTypes,
      capabilities: def.capabilities,
    });
  });

  /** Список запрошень для книги — лише власнику/адміну (панель у CollaborationDrawer). */
  app.get('/api/collaboration/invites', requireAuth, async (req, res) => {
    try {
      const bookId = String(req.query.bookId || '');
      if (!bookId) return res.status(400).json({ error: 'Відсутній ідентифікатор книги.' });

      const principal = req.principal!;
      if (principal.role !== 'admin') {
        const ownerId = (await getBookOwner(bookId))?.ownerUserId ?? (await getBook(bookId))?.ownerId;
        if (ownerId !== principal.id) {
          return res.status(403).json({ error: 'Перегляд запрошень доступний лише письменнику (власнику) книги або адміністратору.' });
        }
      }

      const invites = await listCollabInvitesForBook(bookId);
      res.json({ invites: invites.map((inv) => ({ ...inv, roleId: inviteRoleView(inv.role).roleId, roleLabel: inviteRoleView(inv.role).roleLabel })) });
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
        ...inviteRoleView(invite.role),
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

      // Учасник проєкту з роллю з реєстру (Т6.1). Права до книги це не змінює —
      // їх і далі дає прийняте запрошення (Т6.2 замінить). Без ядра — пропускаємо.
      let participant: { id: string; roleId: string } | null = null;
      let participantError: string | null = null;
      const repo = getCoreRepository();
      if (repo && principal.id) {
        try {
          const r = await assignRole(repo, { projectId: invite.bookId, userId: principal.id, roleId: invite.role, actor: `user:${principal.id}`, source: 'invitation', sourceRef: invite.id });
          participant = { id: r.participant.id, roleId: r.role.roleId };
        } catch (err) {
          participantError = (err as Error).message;
          console.warn('[collaboration] учасника за запрошенням не записано:', participantError);
        }
      }
      res.json({ ok: true, bookId: invite.bookId, bookTitle: invite.bookTitle, ...inviteRoleView(invite.role), invite: updated, participant, participantError });
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
