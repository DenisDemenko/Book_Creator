/**
 * Життєвий цикл підключеної крамниці Etsy: зберегти токени, віддати робочий
 * клієнт, оновити токен, коли він протух, відключити крамницю.
 *
 * Тут зібрано все, що працює з розшифрованим токеном, — і рівно тому цей
 * файл маленький: чим менше місць бачать токен у відкритому вигляді, тим
 * менше шансів, що він колись потрапить у лог або у відповідь API.
 *
 * Правило, яке дотримується без винятків: назовні (в роут, у клієнт, у
 * журнал) ніколи не йде сам токен — лише його відбиток `tokenFingerprint`.
 */

import {
  getEtsyAccount,
  upsertEtsyAccount,
  deleteEtsyAccount,
  type StoredEtsyAccount,
} from '../publishingStore';
import { decryptToken, encryptToken, isCryptoConfigured, tokenFingerprint } from './tokenCrypto';
import { needsRefresh, refreshAccessToken, type EtsyTokenSet, type FetchLike } from './etsyOAuth';
import { createEtsyClient, getMyShop, type EtsyClient } from './etsyClient';
import type { TokenBucket } from './rateLimiter';

export interface EtsyAccountDeps {
  apiKey: string;
  fetchImpl: FetchLike;
  bucket: TokenBucket;
  now?: () => number;
}

export interface PublicEtsyAccount {
  connected: true;
  shopId?: string;
  shopName?: string;
  etsyUserId?: string;
  scopes: string[];
  connectedAt: string;
  expiresAt: string;
  tokenFingerprint: string;
}

/** Те, що можна показати автору й покласти в JSON. Токенів тут немає. */
export function toPublicAccount(account: StoredEtsyAccount): PublicEtsyAccount {
  return {
    connected: true,
    shopId: account.shopId,
    shopName: account.shopName,
    etsyUserId: account.etsyUserId,
    scopes: account.scopes ? account.scopes.split(' ').filter(Boolean) : [],
    connectedAt: account.connectedAt,
    expiresAt: account.expiresAt,
    tokenFingerprint: account.accessTokenEnc ? `enc:${account.accessTokenEnc.slice(-8)}` : '—',
  };
}

export async function saveConnection(params: {
  userId: string;
  tokens: EtsyTokenSet;
  scopes: string[];
  shopId?: string;
  shopName?: string;
  now?: Date;
}): Promise<StoredEtsyAccount> {
  if (!isCryptoConfigured()) {
    // Свідомо відмовляємось зберігати токен відкритим текстом: краще не
    // підключити крамницю, ніж покласти ключ від неї в базу як є.
    throw new Error(
      'Не налаштовано ETSY_TOKEN_SECRET — зберігати токен Etsy незашифрованим модуль відмовляється.'
    );
  }
  const nowIso = (params.now || new Date()).toISOString();
  const existing = await getEtsyAccount(params.userId);
  const account: StoredEtsyAccount = {
    userId: params.userId,
    etsyUserId: params.tokens.etsyUserId || existing?.etsyUserId,
    shopId: params.shopId ?? existing?.shopId,
    shopName: params.shopName ?? existing?.shopName,
    accessTokenEnc: encryptToken(params.tokens.accessToken),
    refreshTokenEnc: encryptToken(params.tokens.refreshToken),
    expiresAt: params.tokens.expiresAt,
    scopes: params.scopes.join(' '),
    connectedAt: existing?.connectedAt || nowIso,
    updatedAt: nowIso,
  };
  await upsertEtsyAccount(account);
  console.log(
    `[etsy] Крамницю підключено для користувача ${params.userId} (токен ${tokenFingerprint(params.tokens.accessToken)})`
  );
  return account;
}

export async function disconnect(userId: string): Promise<boolean> {
  return deleteEtsyAccount(userId);
}

/**
 * Повертає чинний access-токен, за потреби оновивши його по refresh_token
 * (ТЗ 4.2.4). Оновлений набір одразу лягає в базу — інакше наступний запит
 * оновлював би токен ще раз і швидко вичерпав ліміт Etsy на оновлення.
 */
export async function ensureAccessToken(
  userId: string,
  deps: EtsyAccountDeps
): Promise<{ token: string; account: StoredEtsyAccount } | null> {
  const account = await getEtsyAccount(userId);
  if (!account) return null;

  const nowMs = deps.now ? deps.now() : Date.now();
  if (!needsRefresh(account.expiresAt, nowMs)) {
    return { token: decryptToken(account.accessTokenEnc), account };
  }

  const refreshToken = decryptToken(account.refreshTokenEnc);
  const tokens = await refreshAccessToken(deps.fetchImpl, {
    apiKey: deps.apiKey,
    refreshToken,
    nowMs,
  });
  const updated: StoredEtsyAccount = {
    ...account,
    accessTokenEnc: encryptToken(tokens.accessToken),
    refreshTokenEnc: encryptToken(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    updatedAt: new Date(nowMs).toISOString(),
  };
  await upsertEtsyAccount(updated);
  console.log(`[etsy] Токен оновлено для користувача ${userId}`);
  return { token: tokens.accessToken, account: updated };
}

/**
 * Готовий клієнт Etsy для конкретного автора. null — крамниця не підключена.
 *
 * `getAccessToken` навмисно не кешує токен у замиканні: між створенням
 * клієнта й останнім із двадцяти викликів публікації може минути кілька
 * хвилин, і токен за цей час має право протухнути.
 */
export async function clientForUser(
  userId: string,
  deps: EtsyAccountDeps
): Promise<EtsyClient | null> {
  const account = await getEtsyAccount(userId);
  if (!account) return null;

  return createEtsyClient({
    apiKey: deps.apiKey,
    fetchImpl: deps.fetchImpl,
    bucket: deps.bucket,
    getAccessToken: async () => {
      const resolved = await ensureAccessToken(userId, deps);
      if (!resolved) throw new Error('Крамницю Etsy відключено.');
      return resolved.token;
    },
    refreshToken: async () => {
      try {
        const current = await getEtsyAccount(userId);
        if (!current) return null;
        const tokens = await refreshAccessToken(deps.fetchImpl, {
          apiKey: deps.apiKey,
          refreshToken: decryptToken(current.refreshTokenEnc),
          nowMs: deps.now ? deps.now() : Date.now(),
        });
        await upsertEtsyAccount({
          ...current,
          accessTokenEnc: encryptToken(tokens.accessToken),
          refreshTokenEnc: encryptToken(tokens.refreshToken),
          expiresAt: tokens.expiresAt,
          updatedAt: new Date().toISOString(),
        });
        return tokens.accessToken;
      } catch (err) {
        console.error('[etsy] Не вдалося оновити токен після 401:', (err as Error)?.message);
        return null;
      }
    },
  });
}

/**
 * Дізнається id крамниці автора. Викликається один раз під час підключення:
 * без shop_id усі подальші виклики публікації неможливі, тож краще з'ясувати
 * це одразу й показати зрозумілу помилку, ніж через тиждень посеред першої
 * публікації.
 */
export async function resolveShop(
  client: EtsyClient,
  etsyUserId: string
): Promise<{ shopId?: string; shopName?: string }> {
  try {
    const shop = await getMyShop(client, etsyUserId);
    return shop ? { shopId: String(shop.shop_id), shopName: shop.shop_name } : {};
  } catch (err) {
    console.warn('[etsy] Не вдалося визначити крамницю автора:', (err as Error)?.message);
    return {};
  }
}
