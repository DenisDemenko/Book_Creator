/**
 * Розпізнавання формату й розмірів зображення за заголовком, БЕЗ декодування (журнал #550).
 *
 * Знімки приходять від телефона через Studio, тож це чужі дані: перш ніж віддати їх декодеру (canvas, Tesseract),
 * перевіряємо, що це справді JPEG/PNG/WEBP і що пікселів не більше за межу — проти «бомб розпакування» (малий файл → гігапікселі).
 */

export const MAX_PIXELS = 60_000_000;
export const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** @returns {{ mime: string, width: number, height: number } | null} */
export function sniffImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) return null;
  // PNG: сигнатура + IHDR
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.subarray(12, 16).toString('ascii') === 'IHDR' && bytes.length >= 24) {
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // JPEG: SOI, далі шукаємо маркер кадру (SOFn)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = bytes.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { mime: 'image/jpeg', height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  // WEBP: RIFF....WEBP, далі VP8 / VP8L / VP8X
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' && bytes.length >= 30) {
    const kind = bytes.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X') return { mime: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const b = bytes.readUInt32LE(21);
      return { mime: 'image/webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    if (kind === 'VP8 ') return { mime: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** Придатне для розпізнавання: відомий формат, розміри в розумних межах. Повертає причину відмови або null. */
export function imageProblem(info) {
  if (!info) return 'Це не JPEG, PNG чи WEBP.';
  if (!info.width || !info.height) return 'Не вдалося прочитати розміри зображення.';
  if (info.width * info.height > MAX_PIXELS) return 'Зображення завелике за кількістю пікселів.';
  if (Math.min(info.width, info.height) < 16) return 'Зображення замале.';
  return null;
}
