/**
 * Доступ до WebSocket спільного редагування (`/ws`) — задача Т0.1 дорожньої
 * карти (`PLAN_ROADMAP.md`, журнал #242).
 *
 * ЩО БУЛО НЕ ТАК. Сокет не знав, хто підключився: `bookId`, ім'я й роль
 * бралися з повідомлення клієнта, а кімната розсилала всю книгу кожному, хто
 * назвав її id. Демо-книга в усіх нових користувачів має той самий id
 * (`BK-2084-CYBER`), тож незнайомі люди потрапляли в одну кімнату й бачили
 * текст одне одного. Крім того, `book:update` / `section:patch` приймались для
 * будь-якого `bookId` у повідомленні — навіть без входу в кімнату.
 *
 * ЧОМУ КВИТОК, А НЕ COOKIE. У проді сторінка живе під `app.fusionlab.in.ua/
 * studio`, а WebSocket іде напряму на хост Nova (`VITE_NOVA_WS_URL`, Vercel не
 * проксує upgrade). Cookie сесії прив'язане до першого домену й на другий не
 * надсилається. Тому клієнт спершу бере короткий квиток звичайним запитом
 * (там cookie є), а сокет пред'являє квиток в адресі. Квиток — HMAC-підпис,
 * живе 60 секунд і приймається один раз.
 *
 * ХТО В ЯКІЙ КІМНАТІ.
 *   • Власник книги (записаний у `book_collab_owners`, а якщо там порожньо —
 *     власник серверної копії `books.ownerId`) і учасники з прийнятим
 *     запрошенням — у спільній кімнаті `book:<id>`.
 *   • Будь-хто інший з сесією — у приватній кімнаті `private:<user>:<id>`:
 *     синхронізація між власними пристроями працює, а чужого тексту він не
 *     побачить і свого нікому не покаже (саме так розводяться копії
 *     демо-книги в різних людей).
 *   • Гість без сесії — не підключається.
 * Роль і право писати визначає сервер: учасник із роллю `reader` лише читає.
 *
 * Т6.2 (`PLAN_ACCESS.md`): права учасника — з наданих доступів; частковий
 * доступ (сцена, розділ) кімната фільтрує (`scoped`), а якщо ядро недоступне —
 * учаснику закрито.
 */
import crypto from 'node:crypto';
import { hasAnyAccess, isScoped, legacyEffective, type EffectiveAccess, type EffectiveResolver } from './core/collaboration/access';

export interface RealtimeAccess {
  roomKey: string;
  bookId: string;
  userId: string;
  role: string;
  canWrite: boolean;
  shared: boolean;
  /**
   * Т6.2: частковий доступ (книгу цілком не редагує) — кімната фільтрує для
   * нього видачу й приймає лише правки дозволених сцен.
   */
  scoped?: boolean;
  /** Т6.2: на книгу немає навіть перегляду — бачить лише дозволене. */
  restricted?: boolean;
}

export interface RealtimeAccessDeps {
  /** Власник серверної копії книги (`books.ownerId`), або null/undefined. */
  getBookOwnerId(bookId: string): Promise<string | null | undefined>;
  /** Власник спільної роботи (`book_collab_owners`), або undefined. */
  getCollabOwnerId(bookId: string): Promise<string | undefined>;
  /** Прийняті запрошення книги. */
  listAcceptedInvites(bookId: string): Promise<{ id?: string; acceptedUserId?: string; role: string }[]>;
  /**
   * Т6.2: фактичні права учасника з наданих доступів (`access_grants`).
   * Немає — стара схема (запрошення = вся книга); `null` — ядра немає;
   * `'unavailable'` — ядро недоступне: учаснику закрито.
   */
  effectiveAccess?: EffectiveResolver;
}

/**
 * Фактичні права не-власника в книзі, або null — нічого. `'unavailable'` —
 * перевірити не вдалося (закрито).
 */
export async function participantAccess(
  bookId: string,
  userId: string,
  deps: RealtimeAccessDeps,
): Promise<{ eff: EffectiveAccess; inviteRole: string | null } | 'unavailable' | null> {
  const invite = (await deps.listAcceptedInvites(bookId)).find((inv) => inv.acceptedUserId === userId) ?? null;
  let eff: EffectiveAccess | null = null;
  if (deps.effectiveAccess) {
    const r = await deps.effectiveAccess({ projectId: bookId, userId, invite: invite ? { id: invite.id, role: invite.role } : null });
    if (r === 'unavailable') return invite ? 'unavailable' : null;
    eff = r;
  }
  if (!eff && invite) eff = legacyEffective(bookId, userId, invite.role);
  if (!eff || !hasAnyAccess(eff)) return null;
  return { eff, inviteRole: invite?.role ?? null };
}

export interface RealtimePrincipal {
  id: string | null;
  role: string;
  isGuest: boolean;
}

/** Найдовший допустимий id книги в кімнаті — захист від сміття в ключах. */
const MAX_BOOK_ID = 200;

export function isValidBookId(bookId: unknown): bookId is string {
  return typeof bookId === 'string' && bookId.length > 0 && bookId.length <= MAX_BOOK_ID && !/[\s:]/.test(bookId);
}

export async function resolveRealtimeAccess(
  principal: RealtimePrincipal | undefined,
  bookId: string,
  deps: RealtimeAccessDeps
): Promise<RealtimeAccess | null> {
  if (!principal || principal.isGuest || !principal.id) return null;
  if (!isValidBookId(bookId)) return null;
  const userId = principal.id;

  // Власник — однозначно: спершу той, хто закріплений за спільною роботою,
  // і лише коли його немає — власник серверної копії. Інакше дві різні людини
  // з однаковим id книги (демо) обидві вважались би власниками.
  const collabOwner = await deps.getCollabOwnerId(bookId);
  const owner = collabOwner ?? (await deps.getBookOwnerId(bookId)) ?? undefined;
  if (owner && owner === userId) {
    return { roomKey: `book:${bookId}`, bookId, userId, role: principal.role, canWrite: true, shared: true };
  }

  if (owner) {
    const found = await participantAccess(bookId, userId, deps);
    // Ядро недоступне — учаснику закрито (а не «вся книга»): Т6.2.
    if (found === 'unavailable') return null;
    if (found) {
      return {
        roomKey: `book:${bookId}`,
        bookId,
        userId,
        role: found.inviteRole ?? 'participant',
        // Пише той, кому надано редагування хоч чогось у тексті (Т6.2);
        // частковий доступ кімната ще й фільтрує.
        canWrite: found.eff.canWriteAny,
        shared: true,
        scoped: isScoped(found.eff),
        restricted: found.eff.restricted,
      };
    }
  }

  return { roomKey: `private:${userId}:${bookId}`, bookId, userId, role: principal.role, canWrite: true, shared: false };
}

// ---------------------------------------------------------------------------
// Квиток
// ---------------------------------------------------------------------------

/** Скільки живе квиток: вистачає на встановлення з'єднання, не більше. */
export const TICKET_TTL_MS = 60_000;

const SECRET: Buffer = process.env.REALTIME_TICKET_SECRET
  ? Buffer.from(process.env.REALTIME_TICKET_SECRET, 'utf8')
  : crypto.randomBytes(32);

/** Використані квитки (nonce → коли спливає), щоб квиток не спрацював двічі. */
const usedNonces = new Map<string, number>();

function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}

export function issueRealtimeTicket(access: RealtimeAccess, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({ ...access, exp: now + TICKET_TTL_MS, n: crypto.randomBytes(12).toString('base64url') }),
    'utf8'
  ).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Перевіряє підпис, строк і одноразовість. Повертає доступ або null. */
export function verifyRealtimeTicket(ticket: unknown, now = Date.now()): RealtimeAccess | null {
  if (typeof ticket !== 'string' || ticket.length > 4096) return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const mac = ticket.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data: any;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== 'number' || data.exp < now) return null;
  if (typeof data.n !== 'string' || usedNonces.has(data.n)) return null;

  for (const [nonce, exp] of usedNonces) if (exp < now) usedNonces.delete(nonce);
  usedNonces.set(data.n, data.exp);

  if (!isValidBookId(data.bookId) || typeof data.roomKey !== 'string' || typeof data.userId !== 'string') return null;
  return {
    roomKey: data.roomKey,
    bookId: data.bookId,
    userId: data.userId,
    role: String(data.role || 'writer'),
    canWrite: data.canWrite === true,
    shared: data.shared === true,
    scoped: data.scoped === true,
    restricted: data.restricted === true,
  };
}

/** Квиток з адреси підключення (`/ws?ticket=…`). */
export function ticketFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get('ticket');
}
