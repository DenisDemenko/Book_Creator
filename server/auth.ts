/**
 * Автентифікація та авторизація NOVA STUDIO.
 *
 * Два способи потрапити всередину (Фаза G1, docs/migration-plan.md
 * маркетплейсу — Nova втратила власні паролі й Google OAuth на користь
 * Firebase Auth, того самого проєкту, що в маркетплейсі):
 *   1. Гість — без облікового запису. Працює одразу, але без генерації
 *      зображень: замість неї показуються заглушки.
 *   2. Firebase (пошта+пароль або Google) — клієнт входить через Firebase
 *      SDK і обмінює виданий токен на сесію цього сервера через
 *      POST /api/auth/firebase-session. Сесія після обміну — той самий
 *      cookie-механізм, що й раніше: жоден інший маршрут не дізнається,
 *      що особу тепер підтверджує Firebase, а не власний scrypt-хеш.
 *
 * Адміністратор визначається поштою у ADMIN_EMAIL: цей обліковий запис
 * отримує роль admin автоматично, як тільки з'явиться в системі.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction, Express } from 'express';
import {
  StoredUser,
  StoredRole,
  findUserByEmail,
  findUserById,
  findUserByFirebaseUid,
  saveUser,
  createSession,
  findSession,
  deleteSession,
  listUsers,
  getRoleOverrides,
} from './store';
import { firebaseAuthConfigured, verifyFirebaseIdToken, type VerifiedFirebaseToken } from './firebaseAdmin';

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'tropazemli@gmail.com').toLowerCase();
export const SESSION_COOKIE = 'nova_session';
const SESSION_TTL_DAYS = 30;

/** Роль, яку отримує щойно зареєстрований користувач. */
const DEFAULT_ROLE: StoredRole = 'writer';

// ---------------------------------------------------------------------------
// Сесії та cookie — не залежить від того, чим підтверджена особа
// ---------------------------------------------------------------------------

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res: Response, token: string): void {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

async function issueSession(res: Response, user: StoredUser): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
  await createSession({ token, userId: user.id, createdAt: new Date().toISOString(), expiresAt });
  setSessionCookie(res, token);
}

// ---------------------------------------------------------------------------
// Поточний користувач
// ---------------------------------------------------------------------------

/** Гість — не запис у базі, а відсутність сесії. */
export const GUEST_PRINCIPAL = {
  id: null as string | null,
  email: 'guest@local',
  name: 'Гість',
  role: 'guest' as StoredRole,
  isGuest: true as const,
};

export type Principal =
  | typeof GUEST_PRINCIPAL
  | (StoredUser & { isGuest: false });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

/** Підставляє req.principal: або користувача сесії, або гостя. */
export async function attachPrincipal(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const session = await findSession(token);
      if (session) {
        const user = await findUserById(session.userId);
        if (user && !user.disabled) {
          req.principal = { ...user, isGuest: false };
          return next();
        }
      }
    }
  } catch (err) {
    console.warn('[auth] Не вдалося визначити користувача:', err);
  }
  req.principal = GUEST_PRINCIPAL;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.principal || req.principal.isGuest) {
    res.status(401).json({ error: 'Потрібен вхід у систему.', kind: 'unauthenticated' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.principal || req.principal.isGuest || req.principal.role !== 'admin') {
    res.status(403).json({ error: 'Доступно лише адміністратору.', kind: 'forbidden' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Дозволи з урахуванням перевизначень адміністратора
// ---------------------------------------------------------------------------

type ServerPermissions = {
  canGenerateImages: boolean;
  canUseAi: boolean;
  canEditContent: boolean;
  canPublish: boolean;
  canPublishExternal: boolean;
  canManageApiKeys: boolean;
};

/**
 * Базові дозволи, важливі для сервера. Повний опис ролей живе на клієнті
 * (utils/rbac.ts); тут лише те, що впливає на витрату грошей і запис даних.
 *
 * Ці три поля дублюють однойменні в `utils/rbac.ts` — свідомо, бо сервер не
 * має покладатись на клієнтську таблицю. Ціна дублювання: додаючи право,
 * треба правити обидва місця, інакше ґейт мовчки віддає 403 на роль, якій
 * клієнт право показує. Саме так і сталось при впровадженні публікації.
 *
 * canPublish / canPublishExternal / canManageApiKeys — Фаза H
 * (docs/migration-plan.md маркетплейсу, H4-H6). До них маршрути публікації
 * стояли за самим `requireAuth`, тобто публікувати міг будь-хто
 * автентифікований.
 */
export const BASE_SERVER_PERMISSIONS: Record<StoredRole, ServerPermissions> = {
  admin:      { canGenerateImages: true,  canUseAi: true,  canEditContent: true,  canPublish: true,  canPublishExternal: true,  canManageApiKeys: true },
  writer:     { canGenerateImages: true,  canUseAi: true,  canEditContent: true,  canPublish: true,  canPublishExternal: true,  canManageApiKeys: true },
  designer:   { canGenerateImages: true,  canUseAi: true,  canEditContent: false, canPublish: false, canPublishExternal: false, canManageApiKeys: false },
  translator: { canGenerateImages: true,  canUseAi: true,  canEditContent: false, canPublish: false, canPublishExternal: false, canManageApiKeys: false },
  // Видавець = менеджер продажів маркетплейсу (H5): публікує і всередині, і
  // назовні — аудит KDP це його робота, — але власних ключів провайдерів не
  // вводить, бо послуги йому надає Nova.
  publisher:  { canGenerateImages: true,  canUseAi: true,  canEditContent: false, canPublish: true,  canPublishExternal: true,  canManageApiKeys: false },
  // Бета-рідер лише читає — хай не витрачає платні генерації.
  reader:     { canGenerateImages: false, canUseAi: false, canEditContent: false, canPublish: false, canPublishExternal: false, canManageApiKeys: false },
  // Гість бачить демонстраційні заглушки замість згенерованих зображень.
  guest:      { canGenerateImages: false, canUseAi: false, canEditContent: false, canPublish: false, canPublishExternal: false, canManageApiKeys: false },
};

export async function effectivePermissions(role: StoredRole) {
  const overrides = await getRoleOverrides();
  return { ...BASE_SERVER_PERMISSIONS[role], ...(overrides[role] || {}) } as Record<string, boolean>;
}

export async function can(role: StoredRole, permission: string): Promise<boolean> {
  const perms = await effectivePermissions(role);
  return perms[permission] === true;
}

/** Middleware-фабрика для перевірки конкретного дозволу. */
export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = req.principal?.role || 'guest';
    if (await can(role, permission)) return next();

    const isGuest = !req.principal || req.principal.isGuest;
    res.status(403).json({
      error: isGuest
        ? 'Генерація зображень доступна зареєстрованим користувачам. Створіть обліковий запис або увійдіть.'
        : 'Ваша роль не має дозволу на цю дію. Зверніться до адміністратора.',
      kind: isGuest ? 'guest_restricted' : 'forbidden',
      permission,
    });
  };
}

// ---------------------------------------------------------------------------
// Публічне представлення користувача
// ---------------------------------------------------------------------------

export function publicUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl,
    disabled: !!user.disabled,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Відповідність ролей маркетплейсу ролям Nova (docs/migration-plan.md
 * маркетплейсу, H5.1).
 *
 * Без неї `roleForEmail` робила письменником **кожного** — тобто покупець
 * або студент, увійшовши в Nova тим самим Firebase-акаунтом, отримував
 * повні права на редагування, AI та публікацію, і матриця H обходилась на
 * самому вході.
 *
 * `instruction_engineer` і `student` свідомо ведуть на `writer`: їм потрібен
 * той самий набір дій із текстом. Розбіжність одна — за H4 їм не належить
 * право на власні ключі провайдерів, а `writer` його має. Жодна наявна роль
 * Nova не дає «писати, але без ключів», а нова роль зачепила б 12+ файлів
 * інтерфейсу зі switch по ролях, тож це винесено окремим пунктом плану.
 * Ризик обмежений: власний ключ користувач оплачує сам, тож це відхилення
 * від специфікації, а не діра в безпеці.
 */
export const MARKETPLACE_ROLE_TO_NOVA: Record<string, StoredRole> = {
  admin: 'admin',
  writer: 'writer',
  instruction_engineer: 'writer',
  student: 'writer',
  // Менеджер продажів = видавець: верстка, аудит KDP, експорт, публікація.
  sales_manager: 'publisher',
  // Ролі без стосунку до створення книг бачать Nova лише на перегляд.
  buyer: 'reader',
  seller: 'reader',
  expert: 'reader',
};

/**
 * Роль Nova за роллю маркетплейсу. Невідома роль веде на `reader`, а не на
 * `writer`: якщо маркетплейс колись заведе роль, про яку Nova не знає,
 * безпечніше дати найменше, ніж найбільше.
 */
export function novaRoleForMarketplaceRole(role: string | null | undefined): StoredRole {
  if (!role) return DEFAULT_ROLE;
  return MARKETPLACE_ROLE_TO_NOVA[role] ?? 'reader';
}

function roleForEmail(email: string, marketplaceRole?: string | null): StoredRole {
  if (email.trim().toLowerCase() === ADMIN_EMAIL) return 'admin';
  return novaRoleForMarketplaceRole(marketplaceRole);
}

/** Створює адміністратора при першому запуску, якщо його ще немає. */
export async function ensureAdminExists(): Promise<void> {
  const existing = await findUserByEmail(ADMIN_EMAIL);
  if (existing) {
    if (existing.role !== 'admin' || existing.disabled) {
      await saveUser({ ...existing, role: 'admin', disabled: false });
      console.log(`[auth] Роль admin відновлено для ${ADMIN_EMAIL}`);
    }
    return;
  }
  console.log(
    `[auth] Обліковий запис адміністратора (${ADMIN_EMAIL}) ще не створено. ` +
      'Увійдіть цією поштою через Firebase — роль admin призначиться автоматично.'
  );
}

// ---------------------------------------------------------------------------
// Firebase → локальний користувач
// ---------------------------------------------------------------------------

export const firebaseAuthStatus = {
  get enabled() {
    return firebaseAuthConfigured();
  },
};

/**
 * Знаходить або створює StoredUser для верифікованого Firebase-токена.
 *
 * Порядок навмисний і саме в цьому — питання безпеки, не стилю:
 *  1. Спочатку за firebaseUid. Це єдиний надійний ключ повторного входу:
 *     раз привʼязаний, більше нікому не належить.
 *  2. Лише якщо firebaseUid ще нема — шукаємо за поштою. Прив'язуємо
 *     Firebase-акаунт до наявного рядка (успадковуючи роль, контент,
 *     передплату) ТІЛЬКИ якщо Firebase підтверджує emailVerified. Firebase
 *     дозволяє зареєструватися на будь-яку пошту паролем без миттєвої
 *     перевірки — без цієї умови хтось міг би вписати чужу пошту й
 *     успадкувати чужий обліковий запис Nova. Google-вхід завжди дає
 *     emailVerified=true, тож для реальних власників це прозоро.
 *  3. Якщо пошта вже привʼязана до ІНШОГО firebaseUid, або не верифікована
 *     при знайденому старому акаунті — відмова, а не тихе злиття.
 *  4. Інакше — новий користувач, роль за ADMIN_EMAIL.
 */
export async function findOrCreateFromFirebase(
  token: VerifiedFirebaseToken
): Promise<{ user: StoredUser; error?: never } | { user?: never; error: string }> {
  const email = token.email.trim().toLowerCase();

  const byUid = await findUserByFirebaseUid(token.uid);
  if (byUid) {
    if (byUid.disabled) return { error: 'Обліковий запис заблоковано адміністратором.' };
    const role = email === ADMIN_EMAIL ? 'admin' : byUid.role;
    const updated: StoredUser = {
      ...byUid,
      email,
      name: byUid.name || token.name || email.split('@')[0],
      role,
      lastLoginAt: new Date().toISOString(),
    };
    await saveUser(updated);
    return { user: updated };
  }

  const byEmail = await findUserByEmail(email);
  if (byEmail) {
    if (byEmail.firebaseUid && byEmail.firebaseUid !== token.uid) {
      return { error: 'Ця пошта вже привʼязана до іншого облікового запису.' };
    }
    if (!token.emailVerified) {
      return {
        error: 'Підтвердьте цю пошту у Firebase (перейдіть за листом підтвердження), щоб увійти в наявний обліковий запис.',
      };
    }
    if (byEmail.disabled) return { error: 'Обліковий запис заблоковано адміністратором.' };

    const role = email === ADMIN_EMAIL ? 'admin' : byEmail.role;
    const updated: StoredUser = {
      ...byEmail,
      firebaseUid: token.uid,
      name: byEmail.name || token.name || email.split('@')[0],
      role,
      lastLoginAt: new Date().toISOString(),
    };
    await saveUser(updated);
    return { user: updated };
  }

  const created: StoredUser = {
    id: `usr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    email,
    name: token.name || email.split('@')[0],
    role: roleForEmail(email),
    firebaseUid: token.uid,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  await saveUser(created);
  return { user: created };
}

// ---------------------------------------------------------------------------
// Маршрути
// ---------------------------------------------------------------------------

export function registerAuthRoutes(app: Express): void {
  /** Хто я зараз. Гість теж отримує відповідь — просто з роллю guest. */
  app.get('/api/auth/me', async (req, res) => {
    const principal = req.principal || GUEST_PRINCIPAL;
    const permissions = await effectivePermissions(principal.role);
    res.json({
      user: principal.isGuest
        ? { id: null, email: null, name: 'Гість', role: 'guest', isGuest: true }
        : { ...publicUser(principal as StoredUser), isGuest: false },
      permissions,
      firebaseEnabled: firebaseAuthStatus.enabled,
      adminEmail: ADMIN_EMAIL,
    });
  });

  /**
   * Обмін Firebase ID-токена (клієнт уже увійшов через Firebase SDK — поштою
   * чи Google, сервер не розрізняє) на сесію цього застосунку.
   */
  app.post('/api/auth/firebase-session', async (req, res) => {
    try {
      const { idToken } = req.body || {};
      if (typeof idToken !== 'string' || !idToken) {
        return res.status(400).json({ error: 'Не передано idToken.' });
      }

      let verified: VerifiedFirebaseToken;
      try {
        verified = await verifyFirebaseIdToken(idToken);
      } catch (err: any) {
        const message = firebaseAuthStatus.enabled
          ? 'Не вдалося перевірити токен Firebase. Спробуйте увійти ще раз.'
          : err?.message || 'Вхід не налаштований на сервері.';
        return res.status(firebaseAuthStatus.enabled ? 401 : 503).json({ error: message });
      }

      const result = await findOrCreateFromFirebase(verified);
      if (result.error) {
        return res.status(409).json({ error: result.error });
      }

      await issueSession(res, result.user);
      res.json({ user: publicUser(result.user), permissions: await effectivePermissions(result.user.role) });
    } catch (err) {
      console.error('[auth] firebase-session:', err);
      res.status(500).json({ error: 'Не вдалося увійти.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await deleteSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  /** Скільки взагалі є користувачів — щоб показати підказку на першому запуску. */
  app.get('/api/auth/status', async (_req, res) => {
    const users = await listUsers();
    res.json({
      userCount: users.length,
      hasAdmin: users.some((u) => u.role === 'admin'),
      firebaseEnabled: firebaseAuthStatus.enabled,
      adminEmail: ADMIN_EMAIL,
    });
  });
}
