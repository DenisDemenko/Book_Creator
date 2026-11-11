/**
 * Запечатаний конверт «телефон → локальний сервер» (журнал #550).
 *
 * Телефон шифрує знімок ВІДКРИТИМ ключем сервера, тож Studio, що лише переносить байти, прочитати їх не може. Розшифровує
 * лише сервер своїм приватним ключем (він ніколи не покидає комп'ютер автора). Схема — ECIES на P-256, бо саме її вміє
 * WebCrypto на будь-якому телефоні:
 *
 *   байти = "NSE1" | ефемерний публічний ключ (65, несжатий P-256) | сіль (16) | nonce (12) | шифротекст + тег (AES-256-GCM)
 *   ключ  = HKDF-SHA256(ECDH(ефемерний приватний, публічний сервера), сіль, "nova-private-inbox-v1")
 *   AAD   = "nse1|<id сервера>|<id елемента>" — конверт не можна повторно віддати іншому серверу чи під іншим номером.
 *
 * Те саме робить браузерна сторона (services/grabfusion/grabfusion/static/sealed.js); їх звіряє scripts/test-privateInbox.mts.
 * Корисне навантаження: [4 байти довжини заголовка][JSON-заголовок][байти зображення].
 */
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('NSE1', 'ascii');
const INFO = Buffer.from('nova-private-inbox-v1', 'utf8');
const PUB_LEN = 65;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

export const MAX_HEADER_BYTES = 8 * 1024;

/** Нова ключова пара «скриньки»: публічний ключ іде у Studio (його бере телефон), приватний лишається на сервері. Усе — base64url. */
export function generateInboxKey() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
}

export const envelopeAad = (vaultId, itemId) => `nse1|${vaultId}|${itemId}`;

function deriveKey(sharedSecret, salt) {
  return Buffer.from(hkdfSync('sha256', sharedSecret, salt, INFO, 32));
}

/** Запечатати для сервера. Використовують тести й будь-який Node-клієнт; телефон робить те саме через WebCrypto. */
export function sealEnvelope(vaultPublicKeyB64, plaintext, aad) {
  const eph = createECDH('prime256v1');
  eph.generateKeys();
  const shared = eph.computeSecret(Buffer.from(vaultPublicKeyB64, 'base64url'));
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(shared, salt), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, eph.getPublicKey(), salt, iv, body, cipher.getAuthTag()]);
}

/** Розпечатати. Підроблений, пошкоджений чи призначений іншому серверу/елементу конверт кидає помилку. */
export function openEnvelope(vaultPrivateKeyB64, bytes, aad) {
  if (!Buffer.isBuffer(bytes) || bytes.length < MAGIC.length + PUB_LEN + SALT_LEN + IV_LEN + TAG_LEN || !bytes.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Це не запечатаний конверт.');
  }
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(vaultPrivateKeyB64, 'base64url'));
  let shared;
  try {
    shared = ecdh.computeSecret(bytes.subarray(4, 4 + PUB_LEN));
  } catch {
    throw new Error('Конверт має хибний ключ відправника.');
  }
  let offset = 4 + PUB_LEN;
  const salt = bytes.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = bytes.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(shared, salt), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_LEN));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(offset, bytes.length - TAG_LEN)), decipher.final()]);
  } catch {
    throw new Error('Конверт не розшифровується: підроблений, пошкоджений або призначений іншому серверу.');
  }
}

/** [4 байти довжини заголовка][JSON-заголовок][байти зображення]. */
export function encodePayload(header, imageBytes) {
  const head = Buffer.from(JSON.stringify(header), 'utf8');
  if (head.length > MAX_HEADER_BYTES) throw new Error('Заголовок конверта завеликий.');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length, 0);
  return Buffer.concat([len, head, imageBytes]);
}

export function decodePayload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new Error('Порожнє корисне навантаження.');
  const headLen = buffer.readUInt32BE(0);
  if (headLen < 2 || headLen > MAX_HEADER_BYTES || 4 + headLen > buffer.length) throw new Error('Хибний заголовок корисного навантаження.');
  let header;
  try {
    header = JSON.parse(buffer.subarray(4, 4 + headLen).toString('utf8'));
  } catch {
    throw new Error('Заголовок конверта не є JSON.');
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('Заголовок конверта не є обʼєктом.');
  return { header, image: buffer.subarray(4 + headLen) };
}
