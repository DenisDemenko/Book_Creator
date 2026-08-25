/**
 * Шифрування Etsy-токенів «у спокої» (ТЗ 4.2.3 і розділ 8).
 *
 * Access/refresh токен — це фактично ключ від крамниці автора: маючи його,
 * можна створювати й видаляти лістинги від його імені. Тому в базі він не
 * лежить відкритим текстом навіть у dev-середовищі.
 *
 * Рішення:
 *  • AES-256-GCM, а не CBC — GCM дає автентифікацію: підмінений або
 *    пошкоджений шифротекст не розшифрується, а чесно кине помилку;
 *  • ключ береться з ETSY_TOKEN_SECRET і проганяється через scrypt, тож
 *    придатною є будь-яка парольна фраза, не обов'язково рівно 32 байти;
 *  • формат зберігання — `v1:<iv>:<tag>:<ciphertext>` у base64url. Префікс
 *    версії залишає місце для зміни алгоритму без міграції всієї таблиці:
 *    старі рядки читатимуться старим кодом, нові писатимуться новим.
 *
 * Якщо ETSY_TOKEN_SECRET не заданий, ключ виводиться з ETSY_SHARED_SECRET —
 * він і так секретний і вже є в середовищі. Якщо немає жодного, шифрування
 * недоступне: `isCryptoConfigured()` поверне false, і роут підключення
 * акаунта відмовиться зберігати токен, а не покладе його відкритим.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
/** Фіксована сіль: секрет уже високоентропійний, сіль тут — розділювач домену. */
const SCRYPT_SALT = 'nova-studio.etsy.token.v1';

export class TokenCryptoError extends Error {}

function secretMaterial(): string {
  return process.env.ETSY_TOKEN_SECRET || process.env.ETSY_SHARED_SECRET || '';
}

export function isCryptoConfigured(): boolean {
  return secretMaterial().length >= 8;
}

let cachedKey: Buffer | null = null;
let cachedFrom = '';

function deriveKey(): Buffer {
  const material = secretMaterial();
  if (material.length < 8) {
    throw new TokenCryptoError(
      'Не задано ETSY_TOKEN_SECRET (або ETSY_SHARED_SECRET) — нема чим зашифрувати токен Etsy.'
    );
  }
  // scrypt — свідомо повільна функція; кешуємо результат, щоб не платити
  // за неї на кожен виклик API.
  if (cachedKey && cachedFrom === material) return cachedKey;
  cachedKey = crypto.scryptSync(material, SCRYPT_SALT, 32);
  cachedFrom = material;
  return cachedKey;
}

export function encryptToken(plain: string): string {
  if (typeof plain !== 'string' || !plain) {
    throw new TokenCryptoError('Порожній токен шифрувати нема сенсу.');
  }
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptToken(stored: string): string {
  if (typeof stored !== 'string' || !stored) {
    throw new TokenCryptoError('Порожнє значення замість зашифрованого токена.');
  }
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenCryptoError('Невідомий формат зашифрованого токена Etsy.');
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
    // Найчастіша причина — змінили ETSY_TOKEN_SECRET уже після підключення
    // акаунта. Повідомлення має підказати саме це, а не «bad decrypt».
    throw new TokenCryptoError(
      'Не вдалося розшифрувати токен Etsy. Найімовірніше змінився ETSY_TOKEN_SECRET — підключіть крамницю ще раз.'
    );
  }
}

/**
 * Безпечний «хвіст» токена для журналів і UI: за ним видно, що це той самий
 * токен, але відновити його неможливо. У логи не має потрапляти більше.
 */
export function tokenFingerprint(plain: string): string {
  if (!plain) return '—';
  const hash = crypto.createHash('sha256').update(plain).digest('hex');
  return `sha256:${hash.slice(0, 8)}`;
}
