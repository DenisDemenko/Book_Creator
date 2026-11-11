/**
 * Перевірка токена доступу браузера до локального сервера (журнал #549).
 *
 * Токен видає Studio (`POST /api/private-store/:id/token`) і підписує ключем Ed25519. Формат: `v1.<payload>.<підпис>`,
 * де payload — base64url(JSON), а підписано рядок `nova-private-store-v1\n<payload>` (префікс не дає використати підпис
 * Studio для чогось іншого). Тут лише перевірка: приватного ключа Studio сервер не має.
 *
 * Правила: видавець `nova-studio`; аудиторія (`aud`) — id цього сервера; час життя не більший за 15 хв; годинник може
 * розходитись не більше ніж на 2 хв; токен, виданий до «відкликання» (`revokeTokensBefore`), недійсний.
 */
import { verify } from 'node:crypto';
import { publicKeyFromSpki } from './crypto.mjs';

export const TOKEN_PREFIX = 'nova-private-store-v1\n';
export const MAX_TOKEN_LIFETIME_SEC = 15 * 60;
const SKEW_SEC = 120;
export const KINDS = ['book', 'course', 'instruction'];

/**
 * @param {string} token
 * @param {{ studioPublicKey: string, vaultId: string, revokeTokensBefore?: string|null, nowSec?: number }} opts
 * @returns {{ ok: true, claims: { sub: string, kinds: string[], jti: string|null, exp: number, iat: number } } | { ok: false, reason: string }}
 */
export function verifyToken(token, opts) {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'format' };
  const [, payloadB64, sigB64] = parts;
  let claims;
  try {
    const valid = verify(null, Buffer.from(TOKEN_PREFIX + payloadB64, 'utf8'), publicKeyFromSpki(opts.studioPublicKey), Buffer.from(sigB64, 'base64url'));
    if (!valid) return { ok: false, reason: 'signature' };
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'signature' };
  }
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'format' };
  if (claims.iss !== 'nova-studio') return { ok: false, reason: 'issuer' };
  if (claims.aud !== opts.vaultId) return { ok: false, reason: 'audience' };
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) return { ok: false, reason: 'subject' };
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return { ok: false, reason: 'format' };
  if (claims.exp <= nowSec - SKEW_SEC) return { ok: false, reason: 'expired' };
  if (claims.iat > nowSec + SKEW_SEC) return { ok: false, reason: 'not_yet_valid' };
  if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SEC) return { ok: false, reason: 'lifetime' };
  if (opts.revokeTokensBefore) {
    const cutoff = Math.floor(Date.parse(opts.revokeTokensBefore) / 1000);
    if (Number.isFinite(cutoff) && claims.iat < cutoff) return { ok: false, reason: 'revoked' };
  }
  const kinds = Array.isArray(claims.kinds) ? claims.kinds.filter((k) => KINDS.includes(k)) : [];
  return { ok: true, claims: { sub: claims.sub, kinds, jti: typeof claims.jti === 'string' ? claims.jti : null, exp: claims.exp, iat: claims.iat } };
}
