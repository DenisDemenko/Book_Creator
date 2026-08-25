/**
 * Автентифікація та авторизація NOVA STUDIO.
 *
 * Три способи потрапити всередину:
 *   1. Гість — без облікового запису. Працює одразу, але без генерації
 *      зображень: замість неї показуються заглушки.
 *   2. Пошта + пароль — власна реєстрація. Пароль зберігається як
 *      scrypt-хеш із випадковою сіллю (жодних сторонніх залежностей).
 *   3. Google — доступний, лише якщо задано GOOGLE_CLIENT_ID і
 *      GOOGLE_CLIENT_SECRET. Без них кнопка просто не показується.
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
  saveUser,
  createSession,
  findSession,
  deleteSession,
  listUsers,
  getRoleOverrides,
} from './store';

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'tropazemli@gmail.com').toLowerCase();
export const SESSION_COOKIE = 'nova_session';
const SESSION_TTL_DAYS = 30;

/** Роль, яку отримує щойно зареєстрований користувач. */
const DEFAULT_ROLE: StoredRole = 'writer';

// ---------------------------------------------------------------------------
// Паролі
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored?: string): boolean {
  if (!stored) return false;
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;

  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  // Порівняння сталого часу — щоб не давати підказок за часом відповіді.
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Пароль має містити щонайменше 8 символів.';
  }
  if (password.length > 200) return 'Пароль задовгий.';
  return null;
}

export function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
    return 'Вкажіть коректну електронну пошту.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Сесії та cookie
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

/**
 * Базові дозволи, важливі для сервера. Повний опис ролей живе на клієнті
 * (utils/rbac.ts); тут лише те, що впливає на витрату грошей і запис даних.
 */
export const BASE_SERVER_PERMISSIONS: Record<StoredRole, { canGenerateImages: boolean; canUseAi: boolean; canEditContent: boolean }> = {
  admin:      { canGenerateImages: true,  canUseAi: true,  canEditContent: true },
  writer:     { canGenerateImages: true,  canUseAi: true,  canEditContent: true },
  designer:   { canGenerateImages: true,  canUseAi: true,  canEditContent: false },
  translator: { canGenerateImages: true,  canUseAi: true,  canEditContent: false },
  publisher:  { canGenerateImages: true,  canUseAi: true,  canEditContent: false },
  // Бета-рідер лише читає — хай не витрачає платні генерації.
  reader:     { canGenerateImages: false, canUseAi: false, canEditContent: false },
  // Гість бачить демонстраційні заглушки замість згенерованих зображень.
  guest:      { canGenerateImages: false, canUseAi: false, canEditContent: false },
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
    hasPassword: !!user.passwordHash,
    viaGoogle: !!user.googleId,
  };
}

function roleForEmail(email: string): StoredRole {
  return email.trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : DEFAULT_ROLE;
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
      'Зареєструйтеся з цією поштою — роль admin призначиться автоматично.'
  );
}

// ---------------------------------------------------------------------------
// Google OAuth (необовʼязковий)
// ---------------------------------------------------------------------------

export const googleConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  get enabled() {
    return !!(this.clientId && this.clientSecret);
  },
};

function googleRedirectUri(req: Request): string {
  const base =
    process.env.APP_URL?.replace(/\/$/, '') ||
    `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/google/callback`;
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
      googleEnabled: googleConfig.enabled,
      adminEmail: ADMIN_EMAIL,
    });
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, name } = req.body || {};

      const emailError = validateEmail(email);
      if (emailError) return res.status(400).json({ error: emailError });
      const passwordError = validatePassword(password);
      if (passwordError) return res.status(400).json({ error: passwordError });

      const normalized = String(email).trim().toLowerCase();
      if (await findUserByEmail(normalized)) {
        return res.status(409).json({ error: 'Користувач із такою поштою вже існує.' });
      }

      const user: StoredUser = {
        id: `usr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        email: normalized,
        name: (typeof name === 'string' && name.trim()) || normalized.split('@')[0],
        role: roleForEmail(normalized),
        passwordHash: hashPassword(String(password)),
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };

      await saveUser(user);
      await issueSession(res, user);
      res.json({ user: publicUser(user), permissions: await effectivePermissions(user.role) });
    } catch (err: any) {
      console.error('[auth] register:', err);
      res.status(500).json({ error: 'Не вдалося створити обліковий запис.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Вкажіть пошту та пароль.' });
      }

      const user = await findUserByEmail(email);
      // Однакова відповідь для «немає такого» і «пароль не той» —
      // щоб не давати змоги перебирати наявні адреси.
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Невірна пошта або пароль.' });
      }
      if (user.disabled) {
        return res.status(403).json({ error: 'Обліковий запис заблоковано адміністратором.' });
      }

      // Якщо адмінська пошта чомусь має іншу роль — повертаємо admin.
      const role = user.email.toLowerCase() === ADMIN_EMAIL ? 'admin' : user.role;
      const updated = { ...user, role, lastLoginAt: new Date().toISOString() };
      await saveUser(updated);
      await issueSession(res, updated);

      res.json({ user: publicUser(updated), permissions: await effectivePermissions(role) });
    } catch (err: any) {
      console.error('[auth] login:', err);
      res.status(500).json({ error: 'Не вдалося увійти.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await deleteSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --- Google OAuth ---

  app.get('/api/auth/google', (req, res) => {
    if (!googleConfig.enabled) {
      return res.status(503).json({
        error: 'Вхід через Google не налаштований. Задайте GOOGLE_CLIENT_ID і GOOGLE_CLIENT_SECRET.',
      });
    }
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      client_id: googleConfig.clientId,
      redirect_uri: googleRedirectUri(req),
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    res.setHeader('Set-Cookie', `nova_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      if (!googleConfig.enabled) return res.redirect('/?auth_error=google_disabled');

      const { code, state } = req.query as { code?: string; state?: string };
      const expectedState = parseCookies(req.headers.cookie)['nova_oauth_state'];
      if (!code || !state || state !== expectedState) {
        return res.redirect('/?auth_error=state_mismatch');
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: googleConfig.clientId,
          client_secret: googleConfig.clientSecret,
          redirect_uri: googleRedirectUri(req),
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return res.redirect('/?auth_error=token_exchange');
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) return res.redirect('/?auth_error=no_token');

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profileRes.ok) return res.redirect('/?auth_error=profile');
      const profile = (await profileRes.json()) as {
        sub: string; email?: string; name?: string; picture?: string; email_verified?: boolean;
      };

      if (!profile.email || profile.email_verified === false) {
        return res.redirect('/?auth_error=email_unverified');
      }

      const normalized = profile.email.trim().toLowerCase();
      const existing = await findUserByEmail(normalized);

      const user: StoredUser = existing
        ? {
            ...existing,
            googleId: profile.sub,
            name: existing.name || profile.name || normalized,
            avatarUrl: profile.picture || existing.avatarUrl,
            role: normalized === ADMIN_EMAIL ? 'admin' : existing.role,
            lastLoginAt: new Date().toISOString(),
          }
        : {
            id: `usr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            email: normalized,
            name: profile.name || normalized.split('@')[0],
            role: roleForEmail(normalized),
            googleId: profile.sub,
            avatarUrl: profile.picture,
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          };

      if (user.disabled) return res.redirect('/?auth_error=disabled');

      await saveUser(user);
      await issueSession(res, user);
      res.redirect('/');
    } catch (err) {
      console.error('[auth] google callback:', err);
      res.redirect('/?auth_error=unknown');
    }
  });

  /** Скільки взагалі є користувачів — щоб показати підказку на першому запуску. */
  app.get('/api/auth/status', async (_req, res) => {
    const users = await listUsers();
    res.json({
      userCount: users.length,
      hasAdmin: users.some((u) => u.role === 'admin'),
      googleEnabled: googleConfig.enabled,
      adminEmail: ADMIN_EMAIL,
    });
  });
}
