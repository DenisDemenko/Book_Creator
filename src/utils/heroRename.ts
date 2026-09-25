/**
 * Перейменування героя (рішення П6, Т1.5): старе ім'я лишається псевдонімом
 * у ядрі (так уже робить синхронізація, Т0.6), а сторінка героя показує, де
 * старе ім'я ще трапляється в книзі, і пропонує пакетну заміну ОКРЕМО в тегах
 * і в тексті — теми «Знайти й замінити з урахуванням тегів» (Т0.11).
 *
 * Шукається ціле слово (не «Олена» всередині «Олененко») і лише в українському
 * тексті: переклад має власні теги й імена (П5). Відмінки не підбираються —
 * «Олени» автор бачить у пошуку й править сам: автоматична заміна відмінків
 * зіпсувала б більше, ніж виправила.
 */

import type { Book } from '../types';
import { entityTagSpans } from './coreEntities';
import { filterRangesByScope, replaceRanges } from './searchScope';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Входження імені цілим словом (з урахуванням регістру — ім'я пишеться з великої). */
export function findNameRanges(text: string, name: string): [number, number][] {
  const n = name.trim();
  if (!n || !text) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_'’])${escapeRe(n)}(?![\\p{L}\\p{N}_])`, 'gu');
  const out: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

export interface NameOccurrences {
  tags: number;
  text: number;
  sections: number;
}

export function countNameInBook(book: Book, name: string): NameOccurrences {
  let tags = 0;
  let text = 0;
  let sections = 0;
  for (const ch of book.chapters) {
    for (const sec of ch.sections) {
      const content = sec.content || '';
      const ranges = findNameRanges(content, name);
      if (!ranges.length) continue;
      const spans = entityTagSpans(content);
      const inTags = filterRangesByScope(content, ranges, 'tags', spans).length;
      tags += inTags;
      text += ranges.length - inTags;
      sections++;
    }
  }
  return { tags, text, sections };
}

/** Замінює ім'я лише в тегах або лише в тексті; повертає нову книгу (або ту саму, якщо змін немає). */
export function replaceNameInBook(
  book: Book,
  from: string,
  to: string,
  scope: 'tags' | 'text',
  countWords: (text: string) => number = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0),
): { book: Book; replaced: number; sections: number } {
  let replaced = 0;
  let sections = 0;
  const chapters = book.chapters.map((ch) => ({
    ...ch,
    sections: ch.sections.map((sec) => {
      const content = sec.content || '';
      const ranges = filterRangesByScope(content, findNameRanges(content, from), scope);
      if (!ranges.length) return sec;
      replaced += ranges.length;
      sections++;
      const next = replaceRanges(content, ranges, to);
      return { ...sec, content: next, wordCount: countWords(next), lastModified: new Date().toISOString() };
    }),
  }));
  if (!replaced) return { book, replaced: 0, sections: 0 };
  return { book: { ...book, chapters, updatedAt: new Date().toISOString() }, replaced, sections };
}
