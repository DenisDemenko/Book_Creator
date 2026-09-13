/**
 * Визначення кодування текстового файлу (.txt/.md) і його декодування.
 *
 * Потрібно для майстра «Перенесення книги з іншого сервісу»: рукописи,
 * збережені як «звичайний текст», приходять у найрізноманітніших
 * кодуваннях — UTF-8 (з/без BOM), Windows-1251 («ANSI кирилиця»),
 * KOI8-U/KOI8-R, Windows-1252 (латиниця), CP866. `FileReader.readAsText`
 * без параметра читає все як UTF-8, тому такий файл перетворюється на
 * «@@@@@...» (байти, недопустимі для UTF-8, стають символами заміни).
 *
 * Підхід:
 *  1. BOM (UTF-8 / UTF-16LE / UTF-16BE) — однозначно визначає кодування.
 *  2. Строгий UTF-8: якщо байти декодуються без помилок і без NUL-байтів,
 *     це майже напевно UTF-8 (Windows-1251-кирилиця НЕ є коректним UTF-8).
 *  3. Однобайтові кодування (Windows-1251, KOI8-U, KOI8-R, Windows-1252,
 *     ISO-8859-1, CP866, ISO-8859-5): кожне декодується, і якість тексту
 *     оцінюється частотним профілем літер російської, української та
 *     англійської мов. Правильне декодування дає «природний» розподіл
 *     літер, неправильне — або mojibake з латиниці з наголосами, або
 *     кириличну «абракадабру», що відхиляється від частотного профілю.
 *
 * Це евристика, а не повноцінний розпізнавач мови: для коротких або сильно
 * змішаних текстів вона може помилитися, але для книжкового тексту (який
 * зазвичай мономовний і довгий) вибирає правильне кодування.
 */

const LOG_FLOOR = Math.log(0.0005); // штраф для літери, якої немає у профілі мови

/** Частотність літер російської мови (частка серед усіх літер). */
const RU_FREQ: Record<string, number> = {
  о: 0.1097, е: 0.0845, а: 0.0801, и: 0.0735, н: 0.0670, т: 0.0626,
  с: 0.0547, р: 0.0473, в: 0.0454, л: 0.0440, к: 0.0349, м: 0.0321,
  д: 0.0298, п: 0.0281, у: 0.0262, я: 0.0201, ы: 0.0190, ь: 0.0174,
  г: 0.0170, з: 0.0165, б: 0.0159, ч: 0.0144, й: 0.0121, х: 0.0097,
  ж: 0.0094, ш: 0.0073, ю: 0.0064, ц: 0.0048, щ: 0.0036, э: 0.0032,
  ф: 0.0026, ъ: 0.0004, ё: 0.0004,
};

/** Частотність літер української мови. */
const UA_FREQ: Record<string, number> = {
  о: 0.0942, а: 0.0722, н: 0.0670, і: 0.0576, и: 0.0568, в: 0.0526,
  т: 0.0508, е: 0.0456, р: 0.0450, с: 0.0402, к: 0.0350, л: 0.0345,
  у: 0.0331, д: 0.0269, м: 0.0254, п: 0.0248, з: 0.0228, я: 0.0209,
  ь: 0.0189, б: 0.0156, г: 0.0127, ч: 0.0113, й: 0.0112, х: 0.0109,
  ж: 0.0091, ц: 0.0085, ш: 0.0073, ю: 0.0055, є: 0.0047, ї: 0.0033,
  щ: 0.0027, ф: 0.0023, ґ: 0.0002,
};

/** Частотність літер англійської мови (топ + рідкісні). */
const EN_FREQ: Record<string, number> = {
  e: 0.127, t: 0.091, a: 0.082, o: 0.075, i: 0.070, n: 0.067,
  s: 0.063, h: 0.061, r: 0.060, d: 0.043, l: 0.040, c: 0.028,
  u: 0.028, m: 0.024, w: 0.024, f: 0.022, g: 0.020, y: 0.020,
  p: 0.019, b: 0.015, v: 0.010, k: 0.008, j: 0.002, x: 0.002,
  q: 0.001, z: 0.001,
};

const SINGLE_BYTE_CANDIDATES: { label: string; decoder: string }[] = [
  { label: 'Windows-1251 (ANSI кирилиця)', decoder: 'windows-1251' },
  { label: 'KOI8-R (російська)', decoder: 'koi8-r' },
  { label: 'KOI8-U (українська)', decoder: 'koi8-u' },
  { label: 'Windows-1252 (латиниця)', decoder: 'windows-1252' },
  { label: 'ISO-8859-1 (латиниця)', decoder: 'iso-8859-1' },
  { label: 'CP866 (DOS)', decoder: 'cp866' },
  { label: 'ISO-8859-5 (кирилиця)', decoder: 'iso-8859-5' },
];

/** Штраф за змішування кирилиці й латиниці в одному декодуванні. */
const MIX_PENALTY = Math.log(0.25);

/** Штраф за «підозрілий» символ (рамкові символи, приватні знаки тощо). */
const SUSPICIOUS_PENALTY = 4;

/** Звичайна пунктуація та символи, які не вважаються підозрілими. */
const COMMON_PUNCT = new Set([
  '.', ',', '!', '?', ';', ':', '"', "'", '(', ')', '[', ']', '{', '}', '<', '>',
  '-', '—', '–', '―', '«', '»', '„', '“', '”', '‘', '’', '…', '№', '%', '/', '\\',
  '|', '+', '*', '@', '#', '$', '&', '_', '=', '~', '`', '^', '§', '°', '±', '·',
  '•', '©', '®', '™', '€', '£', '¥', '‰', '′', '″', '†', '‡', '¤', '¦', '¬',
]);

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\u00A0';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export interface DecodedTextFile {
  text: string;
  /** Людська назва визначеного кодування (для діагностики/журналу). */
  encoding: string;
}

function isCyrillic(ch: string): boolean {
  return ch >= '\u0400' && ch <= '\u04FF';
}

function isLatin(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '\u00C0' && ch <= '\u00FF') ||
    (ch >= '\u0100' && ch <= '\u017F')
  );
}

/**
 * Якість декодованого тексту: середній логарифм частотності літер за
 * найімовірнішою мовою (рос/укр/англ) мінус штрафи за символи заміни,
 * керувальні символи та змішані алфавіти.
 */
function scoreDecodedText(text: string): number {
  let ruSum = 0, ruN = 0;
  let uaSum = 0, uaN = 0;
  let enSum = 0, enN = 0;
  let replacement = 0;
  let control = 0;
  let cyrUpper = 0;
  let suspicious = 0;

  for (const ch of text) {
    if (ch === '\uFFFD') {
      replacement++;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if (cp === 0 || (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d)) {
      control++;
      continue;
    }
    const lower = ch.toLowerCase();
    if (isCyrillic(lower)) {
      const ruF = RU_FREQ[lower];
      const uaF = UA_FREQ[lower];
      ruSum += ruF !== undefined ? Math.log(ruF) : LOG_FLOOR;
      ruN++;
      uaSum += uaF !== undefined ? Math.log(uaF) : LOG_FLOOR;
      uaN++;
      if (ch !== lower) cyrUpper++;
    } else if (isLatin(lower)) {
      const enF = EN_FREQ[lower];
      enSum += enF !== undefined ? Math.log(enF) : LOG_FLOOR;
      enN++;
    } else if (!isWhitespace(ch) && !isDigit(ch) && !COMMON_PUNCT.has(ch)) {
      suspicious++;
    }
  }

  const ruAvg = ruN > 0 ? ruSum / ruN : -Infinity;
  const uaAvg = uaN > 0 ? uaSum / uaN : -Infinity;
  const enAvg = enN > 0 ? enSum / enN : -Infinity;

  const best = Math.max(ruAvg, uaAvg, enAvg);
  const mixed = ruN > 0 && enN > 0;

  if (best === -Infinity) {
    return -(replacement * 30 + control * 30 + suspicious * SUSPICIOUS_PENALTY);
  }

  // Природний прозовий текст — переважно малі літери. Неправильне
  // декодування KOI8 як Windows-1251 (і навпаки) «перевертає» регістр:
  // майже весь текст стає ВЕЛИКИМИ літерами. Штраф за надмір капіталізації.
  let casePenalty = 0;
  if (ruN >= 10) {
    const upperRatio = cyrUpper / ruN;
    if (upperRatio > 0.4) casePenalty = (upperRatio - 0.4) * 30;
  }

  return best
    + (mixed ? MIX_PENALTY : 0)
    - replacement * 30
    - control * 30
    - suspicious * SUSPICIOUS_PENALTY
    - casePenalty;
}

/**
 * Декодує байти текстового файлу, визначаючи кодування. Повертає текст
 * і назву кодування. Ніколи не кидає: у найгіршому випадку повертає
 * текст у UTF-8.
 */
export function decodeTextBuffer(input: ArrayBuffer | Uint8Array): DecodedTextFile {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  // 1. BOM визначає кодування однозначно.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      encoding: 'UTF-8 (з BOM)',
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'UTF-16 LE',
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'UTF-16 BE',
    };
  }

  // 2. Строгий UTF-8 (без символів заміни і без NUL-байтів).
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!utf8.includes('\u0000')) {
      return { text: utf8, encoding: 'UTF-8' };
    }
  } catch {
    /* не UTF-8 — пробуємо однобайтові кодування */
  }

  // 3. Однобайтові кодування за якістю декодування.
  let best: { text: string; encoding: string; score: number } | null = null;
  for (const candidate of SINGLE_BYTE_CANDIDATES) {
    const text = new TextDecoder(candidate.decoder).decode(bytes);
    const score = scoreDecodedText(text);
    if (!best || score > best.score) {
      best = { text, encoding: candidate.label, score };
    }
  }

  if (best) {
    return { text: best.text, encoding: best.encoding };
  }

  // Останній рубіж: звичайний UTF-8, хай навіть із символами заміни.
  return {
    text: new TextDecoder('utf-8').decode(bytes),
    encoding: 'невідомо (спроба UTF-8)',
  };
}
