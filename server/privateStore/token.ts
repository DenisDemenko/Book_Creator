/**
 * Підписані токени доступу браузера до локального сервера приватного сховища (журнал #549).
 *
 * Формат (повторює services/private-store/src/token.mjs, перевірка в scripts/test-privateStore.mts):
 *   `v1.<payload>.<підпис>`, payload — base64url(JSON), підписано рядок `nova-private-store-v1\n<payload>` ключем Ed25519 Studio.
 * Токен короткий (10 хв), прив'язаний до ОДНОГО сервера (`aud`) і ОДНОГО користувача (`sub`); локальний сервер перевіряє його
 * публічним ключем Studio, який отримав під час підключення, і не має приватного.
 */
import { createPrivateKey, randomUUID, sign } from 'node:crypto';

export const TOKEN_PREFIX = 'nova-private-store-v1\n';
export const HEARTBEAT_PREFIX = 'nova-private-store-heartbeat-v1\n';
export const TOKEN_TTL_SEC = 10 * 60;
export const PRIVATE_KINDS = ['book', 'course', 'instruction'] as const;
export type PrivateKind = (typeof PRIVATE_KINDS)[number];

export interface TokenRequest {
  vaultId: string;
  userId: string;
  kinds: readonly PrivateKind[];
  nowSec?: number;
  ttlSec?: number;
}

export function signAccessToken(privatePkcs8B64: string, req: TokenRequest): { token: string; expiresAt: string } {
  const iat = req.nowSec ?? Math.floor(Date.now() / 1000);
  const exp = iat + Math.min(req.ttlSec ?? TOKEN_TTL_SEC, 15 * 60);
  const payload = Buffer.from(
    JSON.stringify({ iss: 'nova-studio', aud: req.vaultId, sub: req.userId, kinds: [...req.kinds], iat, exp, jti: randomUUID() }),
    'utf8'
  ).toString('base64url');
  const key = createPrivateKey({ key: Buffer.from(privatePkcs8B64, 'base64'), format: 'der', type: 'pkcs8' });
  const signature = sign(null, Buffer.from(TOKEN_PREFIX + payload, 'utf8'), key).toString('base64url');
  return { token: `v1.${payload}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}
