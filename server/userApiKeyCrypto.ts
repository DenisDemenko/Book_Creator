/**
 * Шифрування власних ключів API користувача «у спокої».
 *
 * Той самий підхід, що в server/etsy/tokenCrypto.ts (AES-256-GCM,
 * scrypt-похідний ключ, формат `v1:<iv>:<tag>:<ciphertext>`), але окремий
 * модуль зі своїм секретом — ключ автора до чужого провайдера ШІ не має
 * залежати від секрету Etsy-інтеграції (різні домени, різний блаcт-радіус
 * витоку).
 *
 * Секрет: USER_API_KEY_SECRET з .env, а якщо не заданий — SESSION_SECRET
 * (він і так секретний і вже є в середовищі для будь-якого робочого сервера).
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const SCRYPT_SALT = 'nova-studio.user-api-key.v1';

export class ApiKeyCryptoError extends Error {}

function secretMaterial(): string {
  return process.env.USER_API_KEY_SECRET || process.env.SESSION_SECRET || '';
}

export function isApiKeyCryptoConfigured(): boolean {
  return secretMaterial().length >= 8;
}

let cachedKey: Buffer | null = null;
let cachedFrom = '';

function deriveKey(): Buffer {
  const material = secretMaterial();
  if (material.length < 8) {
    throw new ApiKeyCryptoError(
      'Не задано USER_API_KEY_SECRET (або SESSION_SECRET) — нема чим зашифрувати ключ API користувача.'
    );
  }
  if (cachedKey && cachedFrom === material) return cachedKey;
  cachedKey = crypto.scryptSync(material, SCRYPT_SALT, 32);
  cachedFrom = material;
  return cachedKey;
}

export function encryptApiKey(plain: string): string {
  if (typeof plain !== 'string' || !plain.trim()) {
    throw new ApiKeyCryptoError('Порожній ключ шифрувати нема сенсу.');
  }
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain.trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptApiKey(stored: string): string {
  if (typeof stored !== 'string' || !stored) {
    throw new ApiKeyCryptoError('Порожнє значення замість зашифрованого ключа.');
  }
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new ApiKeyCryptoError('Невідомий формат зашифрованого ключа API.');
  }
  const key = deriveKey();
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new ApiKeyCryptoError(
      'Не вдалося розшифрувати ключ API. Найімовірніше змінився USER_API_KEY_SECRET — задайте ключ ще раз.'
    );
  }
}

/** Короткий «відбиток» ключа для UI — за ним видно, що ключ той самий, але відновити його неможливо. */
export function apiKeyFingerprint(plain: string): string {
  if (!plain) return '—';
  const hash = crypto.createHash('sha256').update(plain.trim()).digest('hex');
  return hash.slice(0, 8);
}
