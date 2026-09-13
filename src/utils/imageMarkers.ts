/**
 * Маркери зображень `[IMG: id "підпис" wrap=режим width=Nmm height=Nmm shape="…"]`.
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ, А НЕ РЯДОК У ДВОХ МІСЦЯХ. Маркер — це конвенція
 * МІЖ редактором, експортом у браузері й серверною версткою PDF. Доти
 * розбирався він лише на клієнті (`utils/helpers.ts#renderImageMarkers`),
 * а серверні рушії вважали його звичайним текстом — і друкували в книзі
 * голий рядок `[IMG: docx-img-3 "Санскрит7" wrap=left]` там, де автор
 * поставив картинку. Знайдено живим прогоном книги, зібраної з .docx
 * (запис #169): у надрукованому PDF маркер стояв на 39 сторінках із 373, а
 * самі 42 картинки лежали купою в кінці першого розділу.
 *
 * Два списки правил розійшлися б знову за першої ж правки, тож розбір і
 * розвʼязання id → посилання живуть тут, а споживачі беруть їх звідси:
 * клієнтський HTML-експорт, `server/pdf/bookToMarkdown.ts` (рушії Chromium
 * і pandoc) і `server/pdf/pdfRenderer.ts` (власна верстка Nova, pdf-lib).
 *
 * Файл навмисно чистий: жодних імпортів, ні DOM, ні Node — щоб його могли
 * тягнути і браузер, і сервер.
 */

/** Поля маркера, як вони записані в тексті книги. */
export interface ImageMarker {
  /** id ілюстрації (`docx-img-3`, `ill-…`), портрета (`char-…`) або обкладинки (`cover-front`). */
  id: string;
  /** Підпис під картинкою; у книгах із Word тут імʼя файлу. */
  caption: string;
  /** `left` | `right` | `contour` | `none`. Відсутній — книга до появи обтікання. */
  wrap?: string;
  widthMm?: string;
  heightMm?: string;
  /** Полігон обтікання, порахований у редакторі: `"0.0% 0.0%, 100.0% 50.0%"`. */
  shape?: string;
}

/** Джерело шаблону маркера — одне для всіх споживачів. */
const MARKER_SOURCE =
  '\\[IMG:\\s*([^\\s\\]"]+)\\s*(?:"([^"]*)")?(?:\\s+wrap=(\\w+))?(?:\\s+width=([\\d.]+)mm)?(?:\\s+height=([\\d.]+)mm)?(?:\\s+shape="([^"]*)")?\\]';

/**
 * Свіжий регулярний вираз із прапорцем `g`.
 *
 * Саме фабрика, а не спільний обʼєкт: у `/g`-виразів є `lastIndex`, і два
 * проходи по черзі (напр. підрахунок id і сама заміна) починали б другий
 * прохід із середини рядка. Це та помилка, яку видно лише на другій книзі
 * за сеанс, тож краще прибрати її самою формою API.
 */
export function imageMarkerRegexp(): RegExp {
  return new RegExp(MARKER_SOURCE, 'g');
}

/** Чи взагалі є маркери в тексті — дешева перевірка перед розбором. */
export function hasImageMarkers(text: string): boolean {
  return String(text ?? '').includes('[IMG:');
}

/** Розібрати рядок, що складається РІВНО з маркера. Інакше — `null`. */
export function parseImageMarker(raw: string): ImageMarker | null {
  const match = new RegExp(`^${MARKER_SOURCE}$`).exec(String(raw ?? '').trim());
  if (!match) return null;
  return {
    id: match[1],
    caption: match[2] || '',
    wrap: match[3] || undefined,
    widthMm: match[4] || undefined,
    heightMm: match[5] || undefined,
    shape: match[6] || undefined,
  };
}

export type ImageMarkerSegment = { kind: 'text'; text: string } | { kind: 'image'; marker: ImageMarker };

/**
 * Порізати текст на «звичайний текст» і «маркери» зі збереженням порядку.
 * Порожні текстові шматки відкидаються: після маркера, що стояв окремим
 * абзацом, лишається сам `\n\n`.
 */
export function splitImageMarkers(text: string): ImageMarkerSegment[] {
  const source = String(text ?? '');
  if (!hasImageMarkers(source)) {
    return source ? [{ kind: 'text', text: source }] : [];
  }

  const re = imageMarkerRegexp();
  const out: ImageMarkerSegment[] = [];
  let last = 0;
  let match = re.exec(source);
  while (match) {
    const before = source.slice(last, match.index);
    if (before.trim()) out.push({ kind: 'text', text: before });
    out.push({
      kind: 'image',
      marker: {
        id: match[1],
        caption: match[2] || '',
        wrap: match[3] || undefined,
        widthMm: match[4] || undefined,
        heightMm: match[5] || undefined,
        shape: match[6] || undefined,
      },
    });
    last = match.index + match[0].length;
    match = re.exec(source);
  }
  const tail = source.slice(last);
  if (tail.trim()) out.push({ kind: 'text', text: tail });
  return out;
}

/**
 * id усіх картинок, на які в тексті Є маркер.
 *
 * Потрібно, щоб не надрукувати ту саму картинку двічі: у місці маркера і
 * наприкінці розділу (там її малює сумісний шлях для книг без маркерів).
 */
export function collectImageMarkerIds(text: string): string[] {
  const source = String(text ?? '');
  if (!hasImageMarkers(source)) return [];
  const re = imageMarkerRegexp();
  const ids: string[] = [];
  let match = re.exec(source);
  while (match) {
    ids.push(match[1]);
    match = re.exec(source);
  }
  return ids;
}

/** Мінімум книги, потрібний для розвʼязання маркера. Сама книга підходить структурно. */
export interface MarkerResolvableBook {
  illustrations?: Array<{ id: string; url?: string; caption?: string }>;
  characters?: Array<{ id: string; avatarUrl?: string }>;
  coverConfig?: { frontArtUrl?: string };
}

/**
 * id маркера → посилання на картинку. Три родини id, і всі три реальні:
 *   • `cover-front` — обкладинка книги (`coverConfig.frontArtUrl`);
 *   • `char-<id>`   — портрет героя (`characters[].avatarUrl`);
 *   • решта        — ілюстрація книги (`illustrations[].id`).
 * Невідомий id лишаємо нерозвʼязаним: мовчазна порожнеча гірша за видиму
 * проблему в тексті.
 */
export function resolveImageMarker(
  id: string,
  book: MarkerResolvableBook
): { url: string; caption?: string } | null {
  if (id === 'cover-front') {
    const url = book.coverConfig?.frontArtUrl;
    return url ? { url } : null;
  }
  if (id.startsWith('char-')) {
    const url = book.characters?.find((c) => c.id === id.slice('char-'.length))?.avatarUrl;
    return url ? { url } : null;
  }
  const found = book.illustrations?.find((i) => i.id === id);
  return found?.url ? { url: found.url, caption: found.caption } : null;
}

/**
 * Уся карта «id маркера → картинка» для книги.
 *
 * Верстка PDF отримує книгу вже «плоскою» (`PdfBookInput`), без героїв і
 * обкладинки — тож карту складає той, хто книгу читає, і передає готовою.
 */
export function buildMarkerImageMap(
  book: MarkerResolvableBook
): Record<string, { url: string; caption?: string }> {
  const map: Record<string, { url: string; caption?: string }> = {};
  for (const ill of book.illustrations || []) {
    if (ill?.id && ill.url) map[ill.id] = { url: ill.url, caption: ill.caption };
  }
  for (const ch of book.characters || []) {
    if (ch?.id && ch.avatarUrl) map[`char-${ch.id}`] = { url: ch.avatarUrl };
  }
  const cover = book.coverConfig?.frontArtUrl;
  if (cover) map['cover-front'] = { url: cover };
  return map;
}
