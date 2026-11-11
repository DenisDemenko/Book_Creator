/**
 * Зв'язок локального сервера зі Studio — лише ВИХІДНИМ HTTPS (відкритих портів на роутері, тунелів і сторонніх сервісів
 * не потрібно, як і в локального помічника Studio):
 *   1. Підключення: одноразовий код з адмінпанелі → `POST /api/private-store/pair` з публічним ключем сервера. Studio
 *      відповідає своїм публічним ключем і id сервера. Код більше не діє.
 *   2. Пульс: кожну хвилину `POST /api/private-store/heartbeat`, підписаний ключем сервера (Ed25519). У відповіді Studio
 *      може відкликати сервер чи токени, видані до певного часу.
 * Вміст записів до Studio НЕ надсилається ніколи: у пульсі лише версія, кількість і розмір.
 */
import { sha256Hex, signBytes } from './crypto.mjs';

export const HEARTBEAT_PREFIX = 'nova-private-store-heartbeat-v1\n';
export const REQUEST_PREFIX = 'nova-private-store-request-v1\n';

/** Заголовки підпису пульсу. Studio перевіряє той самий рядок: `<id>\n<час>\n<sha256(тіло)>` із префіксом. */
export function signedHeaders(identity, vaultId, bodyText, now = new Date()) {
  const ts = String(Math.floor(now.getTime() / 1000));
  const message = `${HEARTBEAT_PREFIX}${vaultId}\n${ts}\n${sha256Hex(bodyText)}`;
  return {
    'content-type': 'application/json',
    'x-private-store-id': vaultId,
    'x-private-store-time': ts,
    'x-private-store-signature': signBytes(identity.privateKey, Buffer.from(message, 'utf8')),
  };
}

async function postJson(fetchImpl, url, body, headers = { 'content-type': 'application/json' }) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetchImpl(url, { method: 'POST', headers: typeof headers === 'function' ? headers(bodyText) : headers, body: bodyText, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* не JSON */
  }
  return { status: res.status, data };
}

/** Обмін одноразового коду на повʼязаність із Studio. Повертає стан звʼязку, який сервер зберігає зашифрованим. */
export async function pairWithStudio({ studioUrl, code, identity, config, fetchImpl = fetch }) {
  const { status, data } = await postJson(fetchImpl, `${studioUrl}/api/private-store/pair`, {
    code,
    publicKey: identity.publicKey,
    name: config.name,
    version: config.version,
    endpoint: config.publicUrl,
  });
  if (status !== 201 || !data || typeof data.vaultId !== 'string' || typeof data.studioPublicKey !== 'string') {
    const reason = data && data.error ? String(data.error).slice(0, 200) : `HTTP ${status}`;
    throw new Error(`Studio не прийняла код підключення: ${reason}`);
  }
  return {
    vaultId: data.vaultId,
    studioUrl,
    studioPublicKey: data.studioPublicKey,
    studioOrigins: Array.isArray(data.studioOrigins) ? data.studioOrigins.filter((o) => typeof o === 'string') : [],
    heartbeatSeconds: Number.isInteger(data.heartbeatSeconds) ? data.heartbeatSeconds : 60,
    revokeTokensBefore: null,
    status: 'active',
    pairedAt: new Date().toISOString(),
  };
}

/** Один пульс. Повертає оновлений звʼязок (статус, час відкликання токенів, дозволені джерела). Мережева помилка не змінює стан. */
export async function sendHeartbeat({ link, identity, info, fetchImpl = fetch, now = new Date() }) {
  const body = JSON.stringify(info);
  const { status, data } = await postJson(fetchImpl, `${link.studioUrl}/api/private-store/heartbeat`, body, (text) => signedHeaders(identity, link.vaultId, text, now));
  if (status === 401 || status === 403 || status === 404) {
    // Studio не знає цього сервера чи підпис відхилено: далі не працюємо, доки адмін не підключить сервер заново.
    return { ...link, status: 'revoked' };
  }
  if (status !== 200 || !data || typeof data.status !== 'string') throw new Error(`Пульс не прийнято (HTTP ${status}).`);
  return {
    ...link,
    status: data.status === 'revoked' ? 'revoked' : 'active',
    revokeTokensBefore: typeof data.revokeTokensBefore === 'string' ? data.revokeTokensBefore : link.revokeTokensBefore,
    studioOrigins: Array.isArray(data.studioOrigins) ? data.studioOrigins.filter((o) => typeof o === 'string') : link.studioOrigins,
    heartbeatSeconds: Number.isInteger(data.heartbeatSeconds) ? data.heartbeatSeconds : link.heartbeatSeconds,
  };
}

// ---------------------------------------------------------------------------
// Черга запечатаних знімків із телефона (журнал #550): сервер сам забирає їх вихідними запитами
// ---------------------------------------------------------------------------

const EMPTY_SHA = sha256Hex('');

/** Підпис запиту до черги: `<префікс><id>\n<метод>\n<шлях API>\n<час>\n<sha256 тіла>` — шлях без префікса проксі й без запиту. */
export function signedRequestHeaders(identity, vaultId, method, apiPath, now = new Date()) {
  const ts = String(Math.floor(now.getTime() / 1000));
  const message = `${REQUEST_PREFIX}${vaultId}\n${method.toUpperCase()}\n${apiPath}\n${ts}\n${EMPTY_SHA}`;
  return {
    'x-private-store-id': vaultId,
    'x-private-store-time': ts,
    'x-private-store-signature': signBytes(identity.privateKey, Buffer.from(message, 'utf8')),
  };
}

async function inboxRequest({ link, identity, fetchImpl, method, apiPath, now }) {
  return fetchImpl(`${link.studioUrl}${apiPath}`, { method, headers: signedRequestHeaders(identity, link.vaultId, method, apiPath, now), signal: AbortSignal.timeout(60_000), redirect: 'error' });
}

/** Що чекає цей сервер. Повертає масив { id, userId, size, createdAt }. */
export async function inboxList({ link, identity, fetchImpl = fetch, now = new Date() }) {
  const res = await inboxRequest({ link, identity, fetchImpl, method: 'GET', apiPath: '/api/private-store/inbox', now });
  if (res.status === 401 || res.status === 403) return { revoked: true, items: [] };
  if (!res.ok) throw new Error(`Черга Studio відповіла HTTP ${res.status}.`);
  const data = await res.json();
  return { revoked: false, items: Array.isArray(data?.items) ? data.items.filter((i) => i && typeof i.id === 'string' && typeof i.userId === 'string') : [] };
}

/** Байти конверта; `null`, якщо його вже немає (доставлено, прострочено). */
export async function inboxFetch({ link, identity, fetchImpl = fetch, itemId, now = new Date() }) {
  const res = await inboxRequest({ link, identity, fetchImpl, method: 'GET', apiPath: `/api/private-store/inbox/${encodeURIComponent(itemId)}`, now });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Конверт ${itemId}: Studio відповіла HTTP ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

/** Підтвердження: Studio видаляє байти. 404 (вже підтверджено) — не помилка. */
export async function inboxAck({ link, identity, fetchImpl = fetch, itemId, now = new Date() }) {
  const res = await inboxRequest({ link, identity, fetchImpl, method: 'POST', apiPath: `/api/private-store/inbox/${encodeURIComponent(itemId)}/ack`, now });
  if (!res.ok && res.status !== 404) throw new Error(`Підтвердження ${itemId}: Studio відповіла HTTP ${res.status}.`);
}
