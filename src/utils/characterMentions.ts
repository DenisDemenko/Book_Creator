import type { Book } from '../types';

/**
 * Спільна утиліта пошуку згадувань персонажа в тексті книги — за
 * іменем/прізвищем/псевдонімом, з тими самими правилами, що й
 * `CharacterMentionPlugin.ts` (ProseMirror-декорація в тексті розділу):
 * мінімум 3 символи на варіант, найдовші варіанти першими в альтернації
 * регулярки («Оксана Петренко» ловиться раніше за просто «Оксана» в
 * тому самому місці), межі слова через `\p{L}\p{N}_` (юнікод-клас, бо
 * звичайний `\w` не охоплює кирилицю).
 *
 * Раніше ця логіка жила лише всередині `CharacterMentionPlugin.ts` і
 * працювала виключно з ProseMirror-документом (`doc.descendants`). Тут —
 * та сама логіка збігу, але над СИРИМ рядком маркерів (`section.content`/
 * `.contentEn`), потрібна для функцій, що не мають живого редактора під
 * рукою: «Хранитель цілісності персонажа» (аналіз AI по всій книзі) і,
 * далі, детектор дрейфу поведінки та автоматичний кодекс персонажа —
 * усі троє потребують «знайти кожну згадку цього персонажа в тексті
 * книги», тож логіка збігу винесена сюди ОДИН РАЗ, а не продубльована
 * тричі.
 */

export interface CharacterMentionEntry {
  id: string;
  name: string;
  surname?: string;
  alias?: string;
}

/** Екранує спецсимволи регулярного виразу — імена персонажів можуть містити будь-що (лапки, дефіси). */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ім'я/прізвище/псевдонім/«Ім'я Прізвище» — кожен варіант мінімум 3
 * символи (коротші дають забагато випадкових збігів усередині звичайних
 * слів). Найдовші варіанти йдуть першими в альтернації регулярного виразу.
 */
export function buildNameEntries(characters: CharacterMentionEntry[]): { text: string; id: string }[] {
  const entries: { text: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const c of characters) {
    const candidates = [c.name, c.surname, c.alias, c.name && c.surname ? `${c.name} ${c.surname}` : undefined].filter(
      (v): v is string => Boolean(v && v.trim().length >= 3)
    );
    for (const raw of candidates) {
      const text = raw.trim();
      // Той самий рядок від двох різних персонажів (тезки) — залишаємо
      // ПЕРШОГО в списку книги, а не мовчки переписуємо.
      if (seen.has(text)) continue;
      seen.add(text);
      entries.push({ text, id: c.id });
    }
  }
  entries.sort((a, b) => b.text.length - a.text.length);
  return entries;
}

/** Компілює регулярку зі списку варіантів імені — межі слова через юнікод-класи. `null`, якщо варіантів нема. */
export function buildMentionRegex(entries: { text: string }[]): RegExp | null {
  if (entries.length === 0) return null;
  const pattern = entries.map((e) => escapeRegExp(e.text)).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, 'gu');
}

export interface TextMentionRange {
  start: number;
  end: number;
  id: string;
  matchedText: string;
}

/** Той самий пошук, що й у ProseMirror-декорації, але над звичайним рядком (не документом). */
export function findMentionsInText(text: string, entries: { text: string; id: string }[]): TextMentionRange[] {
  const regex = buildMentionRegex(entries);
  if (!regex) return [];
  const idByText = new Map(entries.map((e) => [e.text, e.id]));
  const out: TextMentionRange[] = [];
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(text))) {
    const id = idByText.get(m[0]);
    if (id) out.push({ start: m.index, end: m.index + m[0].length, id, matchedText: m[0] });
    // Захист від зациклення на нульовій довжині збігу — теоретично
    // неможливо з нашим патерном (мінімум 3 символи), але дешева страховка.
    if (m[0].length === 0) regex.lastIndex += 1;
  }
  return out;
}

export interface CollectedCharacterMention {
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  field: 'content' | 'contentEn';
  start: number;
  end: number;
  quote: string;
  before: string;
  after: string;
}

const DEFAULT_CONTEXT_CHARS = 120;
const DEFAULT_MAX_MENTIONS = 60;

/**
 * Рівномірно розсіює вибірку по всій довжині списку замість того, щоб
 * узяти просто "перші N" — інакше на книзі з десятками згадувань стеля
 * майже завжди відрізала б усе, крім ранніх розділів, тобто саме там,
 * де НАЙМЕНШЕ шансів побачити суперечність із тим, що написано пізніше.
 */
function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(items[Math.floor(i * step)]);
  }
  return out;
}

/**
 * Проходить `book.chapters[].sections[]` цілком (обидва мовних поля) і
 * повертає кожну згадку ЦЬОГО персонажа з контекстом навколо. Стеля
 * `maxMentions` рахується ПІСЛЯ повного проходу (щоб `totalFound` і
 * `truncated` були чесними), а не як рання зупинка проходу.
 */
export function collectCharacterMentions(
  book: Book,
  character: CharacterMentionEntry,
  opts?: { contextChars?: number; maxMentions?: number }
): { mentions: CollectedCharacterMention[]; totalFound: number; truncated: boolean } {
  const entries = buildNameEntries([character]);
  const contextChars = opts?.contextChars ?? DEFAULT_CONTEXT_CHARS;
  const maxMentions = opts?.maxMentions ?? DEFAULT_MAX_MENTIONS;

  const all: CollectedCharacterMention[] = [];
  if (entries.length > 0) {
    for (const chapter of book.chapters) {
      for (const section of chapter.sections) {
        const fields: Array<['content' | 'contentEn', string]> = [
          ['content', section.content || ''],
          ['contentEn', section.contentEn || ''],
        ];
        for (const [field, text] of fields) {
          if (!text) continue;
          for (const range of findMentionsInText(text, entries)) {
            const beforeStart = Math.max(0, range.start - contextChars);
            const afterEnd = Math.min(text.length, range.end + contextChars);
            all.push({
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              sectionId: section.id,
              sectionTitle: section.title,
              field,
              start: range.start,
              end: range.end,
              quote: text.slice(range.start, range.end),
              before: (beforeStart > 0 ? '…' : '') + text.slice(beforeStart, range.start),
              after: text.slice(range.end, afterEnd) + (afterEnd < text.length ? '…' : ''),
            });
          }
        }
      }
    }
  }

  const truncated = all.length > maxMentions;
  const mentions = truncated ? sampleEvenly(all, maxMentions) : all;
  return { mentions, totalFound: all.length, truncated };
}

/**
 * Форматує зібрані згадування в один текстовий блок для AI-промту —
 * з позначкою розділу перед кожним фрагментом, щоб модель могла
 * посилатись на конкретне місце в книзі. Жорсткий `maxChars` — останній
 * рубіж захисту (сама вибірка вже обмежена `maxMentions`, тож на практиці
 * рідко спрацьовує), а не основний механізм обрізання.
 */
export function formatMentionsForPrompt(mentions: CollectedCharacterMention[], maxChars = 40_000): string {
  if (mentions.length === 0) return '(персонаж ще не згадується в тексті книги)';
  const parts = mentions.map((m) => {
    const langTag = m.field === 'contentEn' ? ', EN' : '';
    return `[${m.chapterTitle} → ${m.sectionTitle}${langTag}]\n…${m.before}${m.quote}${m.after}…`;
  });
  const joined = parts.join('\n\n');
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}\n…(обрізано — забагато згадувань)` : joined;
}
