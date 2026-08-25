/**
 * Мінімальний ZIP-письменник без зовнішніх залежностей.
 *
 * Чому не jszip, який уже є в package.json: jszip писався для браузера, тягне
 * власні промісні потоки й у серверний бандл (esbuild) заходить помітно
 * важчим, ніж потрібно, щоб скласти 3–5 файлів. Тут достатньо базового
 * формату: локальний заголовок → дані → центральний каталог → EOCD.
 * Стиснення робить `node:zlib` (deflateRaw) — рідний код, без залежностей.
 *
 * Свідомі обмеження: без ZIP64 (набір Etsy обмежений 20 МБ — до 4 ГБ ще
 * далеко), без шифрування, без потокового запису. Якщо колись знадобиться
 * пакувати гігабайти, цей файл треба буде замінити на потоковий архіватор —
 * і саме тому весь інтерфейс тут — одна функція.
 */

import zlib from 'node:zlib';

export interface ZipEntry {
  /** Шлях усередині архіву; прямі скіси, без провідного «/». */
  path: string;
  data: Uint8Array;
  /** true — покласти без стиснення (для вже стиснутих jpg/mp3/zip). */
  store?: boolean;
  date?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Розширення, які вже стиснуті — пакуємо їх без deflate, це чиста економія CPU. */
const ALREADY_COMPRESSED = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4', '.mov', '.zip', '.webp', '.avif', '.docx', '.xlsx', '.pptx',
]);

function shouldStore(entry: ZipEntry): boolean {
  if (entry.store) return true;
  const dot = entry.path.lastIndexOf('.');
  if (dot < 0) return false;
  return ALREADY_COMPRESSED.has(entry.path.slice(dot).toLowerCase());
}

function dosDateTime(date: Date): { time: number; dateValue: number } {
  // ZIP успадкував формат часу від MS-DOS: секунди з кроком 2, рік від 1980.
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dateValue: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path.replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    const raw = Buffer.from(entry.data);
    const store = shouldStore(entry);
    const compressed = store ? raw : zlib.deflateRawSync(raw, { level: 9 });
    // Якщо «стиснуте» вийшло більшим за оригінал (буває на дрібних файлах),
    // чесніше покласти як є.
    const useStore = store || compressed.length >= raw.length;
    const payload = useStore ? raw : compressed;
    const method = useStore ? 0 : 8;
    const { time, dateValue } = dosDateTime(entry.date || new Date());
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // прапорець «імена в UTF-8»
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(dateValue, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    localChunks.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);     // version made by
    central.writeUInt16LE(20, 6);     // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(dateValue, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);     // extra
    central.writeUInt16LE(0, 32);     // comment
    central.writeUInt16LE(0, 34);     // disk number
    central.writeUInt16LE(0, 36);     // internal attrs
    central.writeUInt32LE(0, 38);     // external attrs
    central.writeUInt32LE(offset, 42);

    centralChunks.push(central, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}
