/**
 * Пошук і заміна з урахуванням тегів сутностей — задача Т0.11 (журнал #245,
 * рішення власника П9 у `TAGS_ANALYSIS.md` §7).
 *
 * До цього «Знайти й замінити» (`BookSearchModal`) шукав по сирому рядку
 * рукопису, тож «Замінити все» «Олена» → «Олеся» мовчки переписувало й
 * `[/character:Олена]`. Тепер кожен збіг знає, де він — у тексті книги чи в
 * тезі, — і автор обирає, що замінювати.
 */
import { editorialTagSpans as entityTagSpans } from './manuscriptTagIndex';
import { aiMetadataSpans } from '../../shared/aiTextOrigin';

export type SearchScope = 'all' | 'text' | 'tags';

/** Чи перетинає збіг `[start, end)` хоч один тег. */
export function isInTag(start: number, end: number, spans: [number, number][]): boolean {
  return spans.some(([a, b]) => start < b && a < end);
}

/** Лишає лише збіги потрібної області. */
export function filterRangesByScope(
  text: string,
  ranges: [number, number][],
  scope: SearchScope,
  spans: [number, number][] = entityTagSpans(text)
): [number, number][] {
  if (scope === 'all') return ranges;
  return ranges.filter(([s, e]) => (scope === 'tags') === isInTag(s, e, spans));
}

/** Замінює вказані діапазони (непересічні, за зростанням) — повертає новий рядок. */
export function replaceRanges(text: string, ranges: [number, number][], replacement: string): string {
  let out = '';
  let cursor = 0;
  const metadata = aiMetadataSpans(text);
  for (const [s, e] of ranges) {
    if (metadata.some(([a,b]) => s < b && a < e)) continue;
    out += text.slice(cursor, s) + replacement;
    cursor = e;
  }
  return out + text.slice(cursor);
}
