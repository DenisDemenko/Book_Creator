/**
 * Криптографія локального сервера: шифрування записів у спокої (AES-256-GCM), ключ із файлу-секрету, ключова пара
 * Ed25519 сервера для підписів до Studio. Лише `node:crypto`, жодних залежностей.
 *
 * Запис у базі — рядок `nps1.<base64url(nonce12 ‖ шифротекст ‖ тег16)>`. Додаткові дані (AAD) привʼязують шифротекст до
 * місця (`doc:<id>:payload`), тож підміна запису в іншому рядку чи стовпці не розшифрується.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const PREFIX = 'nps1.';

/** Читає головний ключ (32 байти) з файлу: 64 шістнадцяткових символи або base64. Немає ключа чи він слабкий — помилка, сервер не стартує. */
export function loadMasterKey(file) {
  let raw;
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
    raw = readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(`Немає файлу головного ключа (${file}). Створіть його скриптом scripts/init-secrets і змонтуйте як Docker-секрет.`);
  }
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) key = decoded;
  }
  if (!key || key.length !== 32) throw new Error('Головний ключ має бути 32 байти: 64 шістнадцяткових символи або base64.');
  if (key.every((b) => b === key[0])) throw new Error('Головний ключ слабкий (однакові байти). Створіть новий скриптом init-secrets.');
  return key;
}

/** Підключ шифрування записів — з головного ключа через HKDF, щоб сам головний ключ ніде не шифрував даних напряму. */
export function deriveDataKey(master) {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'nova-private-store/data/v1', 32));
}

export function seal(key, plaintext, aad) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext), cipher.final()]);
  return PREFIX + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url');
}

/** Повертає Buffer. Підроблений чи переставлений запис кидає помилку (тег не збігається). */
export function open(key, sealed, aad) {
  if (typeof sealed !== 'string' || !sealed.startsWith(PREFIX)) throw new Error('Запис не зашифровано або пошкоджено.');
  const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64url');
  if (raw.length < 12 + 16) throw new Error('Запис пошкоджено.');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}

/** Нова ключова пара Ed25519 сервера: публічний ключ — SPKI base64 (його бачить Studio), приватний — PKCS8 base64 (лишається лише тут). */
export function generateIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export function signBytes(privateKeyB64, bytes) {
  const key = createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
  return sign(null, bytes, key).toString('base64url');
}

export function publicKeyFromSpki(spkiB64) {
  return createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' });
}

export const sha256Hex = (input) => createHash('sha256').update(input).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
