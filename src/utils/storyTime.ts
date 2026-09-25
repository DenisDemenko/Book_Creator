/**
 * Час у світі книги (Т2.1, сторінка 6 «Хронологія») — спільне для сервера й
 * клієнта.
 *
 * Автор пише час так, як йому зручно, а система перетворює його на число
 * для впорядкування (`key`). Підтримано:
 *   • дата: `1998`, `1998-05`, `1998-05-14`, з мінусом для років до н. е.;
 *   • відносний день: `день 3`, `day 3`, `д3` — для світів без календаря;
 *   • просто число: `12.5` — власна шкала автора.
 * Порівнюються ключі лише в межах однієї книги: автор має вести один спосіб
 * запису часу — змішувати дати з «днями» система не заборонить, але порядок
 * тоді на совісті автора (підказка в інтерфейсі).
 *
 * Види точки часу: точна, приблизна, інтервал (початок і кінець), невизначена.
 */

export type StoryTimeKind = 'exact' | 'approximate' | 'interval' | 'unknown';
export const STORY_TIME_KINDS: StoryTimeKind[] = ['exact', 'approximate', 'interval', 'unknown'];

export const STORY_TIME_KIND_UK: Record<StoryTimeKind, string> = {
  exact: 'точна',
  approximate: 'приблизна',
  interval: 'інтервал',
  unknown: 'невизначена',
};

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Рядок часу → число для впорядкування; null — не розпізнано. */
export function storyTimeKey(input: string | null | undefined): number | null {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  const date = /^(-?\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s);
  if (date) {
    const y = Number(date[1]);
    const m = date[2] ? Number(date[2]) : null;
    const d = date[3] ? Number(date[3]) : null;
    if (m !== null && (m < 1 || m > 12)) return null;
    if (d !== null && (d < 1 || d > 31)) return null;
    // Рік без місяця — його початок; ключ у роках із часткою.
    const dayOfYear = m ? DAYS_BEFORE_MONTH[m - 1] + (d ? d - 1 : 0) : 0;
    // Рік довжиною 4 цифри і більше — календар; коротке число — власна шкала автора.
    return date[1].replace('-', '').length >= 3 || m !== null ? Math.round((y + dayOfYear / 365) * 1e6) / 1e6 : y;
  }
  const day = /^(?:день|day|д)\s*(-?\d+(?:[.,]\d+)?)$/.exec(s);
  if (day) return Number(day[1].replace(',', '.'));
  const num = /^-?\d+(?:[.,]\d+)?$/.exec(s);
  if (num) return Number(s.replace(',', '.'));
  return null;
}

export interface StoryTimeInput {
  kind: StoryTimeKind;
  start?: string | null;
  end?: string | null;
  label?: string | null;
}

export interface StoryTimeValue {
  kind: StoryTimeKind;
  start: string | null;
  end: string | null;
  label: string;
  key: number | null;
  endKey: number | null;
}

/** Перевірка й нормалізація точки часу; рядок — причина відмови. */
export function normalizeStoryTime(input: StoryTimeInput): StoryTimeValue | string {
  const kind = input.kind;
  if (!STORY_TIME_KINDS.includes(kind)) return 'Невідомий вид часу';
  const start = String(input.start ?? '').trim() || null;
  const end = String(input.end ?? '').trim() || null;
  const label = String(input.label ?? '').trim().slice(0, 120);
  if (kind === 'unknown') return { kind, start: null, end: null, label, key: null, endKey: null };
  const key = storyTimeKey(start);
  if (key === null) return `Не вдалося розпізнати час «${start ?? ''}»: пишіть 1998, 1998-05-14, «день 3» або число`;
  if (kind !== 'interval') return { kind, start, end: null, label, key, endKey: null };
  const endKey = storyTimeKey(end);
  if (endKey === null) return `Інтервалу потрібен кінець: «${end ?? ''}» не розпізнано`;
  if (endKey < key) return 'Кінець інтервалу раніше за початок';
  return { kind, start, end, label, key, endKey };
}

/** Людський підпис точки часу. */
export function describeStoryTime(v: { kind: StoryTimeKind; start: string | null; end: string | null; label?: string | null }): string {
  if (v.label) return v.label;
  if (v.kind === 'unknown') return 'час невідомий';
  if (v.kind === 'interval') return `${v.start} — ${v.end}`;
  return v.kind === 'approximate' ? `≈ ${v.start}` : String(v.start);
}
