/**
 * OAuth 2.0 Authorization Code Grant + PKCE для Etsy (ТЗ 4.2).
 *
 * Чому саме PKCE, хоча в нас є серверний секрет: Etsy вимагає його для v3, і
 * це правильно — `code_verifier` робить перехоплений `code` марним. Верифаєр
 * ніколи не покидає сервер: у браузер іде лише `state` і `code_challenge`.
 *
 * Мережа в цьому файлі не «зашита»: `fetchImpl` передається аргументом, тож
 * обмін коду на токен тестується підставним fetch — без Etsy, без ключів і
 * без інтернету.
 */

import crypto from 'node:crypto';
import { ETSY_OAUTH_CONNECT_URL, ETSY_TOKEN_URL, ETSY_SCOPES } from './etsyConfig';

export class EtsyOAuthError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/** Верифаєр — 43–128 символів base64url; беремо 32 випадкові байти. */
export function createPkcePair(): PkcePair {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge, state: crypto.randomBytes(16).toString('base64url') };
}

export function buildAuthorizeUrl(params: {
  apiKey: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const url = new URL(ETSY_OAUTH_CONNECT_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.apiKey);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', (params.scopes ?? ETSY_SCOPES).join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface EtsyTokenSet {
  accessToken: string;
  refreshToken: string;
  /** ISO-час, коли access token стає непридатним. */
  expiresAt: string;
  /** Etsy повертає ідентифікатор користувача першою частиною access-токена. */
  etsyUserId?: string;
}

export type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json?(): Promise<any>;
  headers?: { get(name: string): string | null };
}>;

/**
 * Etsy кладе id користувача в сам токен: `12345678.abcdef...`. Це дешевше,
 * ніж окремий запит /users/me, тож дістаємо звідти — але обережно, бо формат
 * недокументований як гарантія: якщо він зміниться, просто лишимось без id,
 * а не зламаємо підключення.
 */
export function etsyUserIdFromAccessToken(accessToken: string): string | undefined {
  const head = String(accessToken).split('.')[0];
  return /^\d+$/.test(head) ? head : undefined;
}

function toTokenSet(payload: any, nowMs: number): EtsyTokenSet {
  const accessToken = String(payload?.access_token || '');
  const refreshToken = String(payload?.refresh_token || '');
  if (!accessToken || !refreshToken) {
    throw new EtsyOAuthError('Etsy повернув відповідь без токенів.');
  }
  const expiresInSec = Number(payload?.expires_in) || 3600;
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(nowMs + expiresInSec * 1000).toISOString(),
    etsyUserId: etsyUserIdFromAccessToken(accessToken),
  };
}

async function postToken(
  fetchImpl: FetchLike,
  body: Record<string, string>,
  nowMs: number
): Promise<EtsyTokenSet> {
  const res = await fetchImpl(ETSY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    // Сирої відповіді Etsy назовні не віддаємо (вона може містити частину
    // секрету) — у клієнта йде людське пояснення, деталі лишаються в лозі.
    console.error('[etsy] Помилка обміну токена:', res.status, raw.slice(0, 500));
    throw new EtsyOAuthError(
      res.status === 400
        ? 'Etsy відхилив запит на токен. Перевірте ETSY_API_KEY і Redirect URI у кабінеті розробника.'
        : 'Etsy тимчасово не відповідає на запит токена. Спробуйте ще раз за хвилину.',
      res.status === 400 ? 400 : 502
    );
  }
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new EtsyOAuthError('Etsy повернув відповідь, яку не вдалося прочитати як JSON.');
  }
  return toTokenSet(payload, nowMs);
}

export async function exchangeCodeForToken(
  fetchImpl: FetchLike,
  params: { apiKey: string; redirectUri: string; code: string; codeVerifier: string; nowMs?: number }
): Promise<EtsyTokenSet> {
  return postToken(
    fetchImpl,
    {
      grant_type: 'authorization_code',
      client_id: params.apiKey,
      redirect_uri: params.redirectUri,
      code: params.code,
      code_verifier: params.codeVerifier,
    },
    params.nowMs ?? Date.now()
  );
}

export async function refreshAccessToken(
  fetchImpl: FetchLike,
  params: { apiKey: string; refreshToken: string; nowMs?: number }
): Promise<EtsyTokenSet> {
  return postToken(
    fetchImpl,
    {
      grant_type: 'refresh_token',
      client_id: params.apiKey,
      refresh_token: params.refreshToken,
    },
    params.nowMs ?? Date.now()
  );
}

/**
 * Чи час оновлювати токен. Запас у 5 хвилин навмисний: запит на публікацію
 * може виконуватись довго (5 файлів по 20 МБ), і токен не повинен померти
 * посеред завантаження.
 */
export function needsRefresh(expiresAtIso: string, nowMs = Date.now(), skewMs = 5 * 60_000): boolean {
  const expires = Date.parse(expiresAtIso);
  if (Number.isNaN(expires)) return true;
  return expires - skewMs <= nowMs;
}
