/* Запечатаний конверт «телефон → локальний сервер» (журнал #550): шифрування на телефоні відкритим ключем сервера автора.
   Studio, що переносить байти, прочитати їх не може. Формат і причини — services/private-store/src/envelope.mjs (там розпечатування).
   байти = "NSE1" | ефемерний публічний ключ P-256 (65) | сіль (16) | nonce (12) | шифротекст + тег (AES-256-GCM);
   ключ = HKDF-SHA256(ECDH, сіль, "nova-private-inbox-v1"); AAD = "nse1|<id сервера>|<id елемента>". */
(function (root) {
  'use strict';
  var subtle = (root.crypto && root.crypto.subtle) || null;
  var enc = new TextEncoder();
  var INFO = enc.encode('nova-private-inbox-v1');

  function b64urlToBytes(s) {
    var b = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }

  /** Запечатати `plaintext` (Uint8Array) для сервера з відкритим ключем `vaultPublicKeyB64Url`. Повертає Uint8Array. */
  async function seal(vaultPublicKeyB64Url, plaintext, aad) {
    if (!subtle) throw new Error('Цей браузер не підтримує шифрування (потрібен https).');
    var pub = await subtle.importKey('raw', b64urlToBytes(vaultPublicKeyB64Url), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    var eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    var shared = await subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
    var ephPub = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
    var salt = root.crypto.getRandomValues(new Uint8Array(16));
    var iv = root.crypto.getRandomValues(new Uint8Array(12));
    var hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    var key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: INFO }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    var ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(aad) }, key, plaintext));
    return concat([enc.encode('NSE1'), ephPub, salt, iv, ct]);
  }

  /** [4 байти довжини заголовка][JSON-заголовок][байти зображення]. */
  function encodePayload(header, imageBytes) {
    var head = enc.encode(JSON.stringify(header));
    if (head.length > 8 * 1024) throw new Error('Заголовок конверта завеликий.');
    var len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, head.length, false);
    return concat([len, head, imageBytes]);
  }

  function aadFor(vaultId, itemId) { return 'nse1|' + vaultId + '|' + itemId; }

  /** Випадковий номер елемента: 16 байтів у base64url (22 символи). */
  function newItemId() {
    var b = root.crypto.getRandomValues(new Uint8Array(16)), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  var api = { seal: seal, encodePayload: encodePayload, aadFor: aadFor, newItemId: newItemId, b64urlToBytes: b64urlToBytes };
  root.NovaSealed = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
