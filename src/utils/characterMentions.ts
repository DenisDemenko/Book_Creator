import type { Book } from '../types';

/**
 * Спільна утиліта пошуку згадувань персонажа в тексті книги — за
 * іменем/прізвищем/псевдонімом, з тими самими правилами, що й
 * `CharacterMentionPlugin.ts` (ProseMirror-декорація в тексті розділу):
 * мінімум 3 символи на варіант, найдовші варіанти першими в альтернації
 * регулярки («Оксана Петренко» ловиться раніше за просто «Оксана» в
 * тому самому місці), межі слова через `\p{L}\p{N}_` (юнікод-клас — бо
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
  /**
   * Не потрібен самому пошуку згадувань, але живий `book.characters`
   * передається тим самим callback у редакторські semantic-плагіни. Там
   * bookId дозволяє без евристики завантажити whole-book Entity Registry.
   */
  bookId?: string;
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
  while ((m = regex.exec(text))) {
    const matchedText = m[0];
    const id = idByText.get(matchedText) || entries.find((e) => e.text.toLocaleLowerCase() === matchedText.toLocaleLowerCase())?.id;
    if (!id) continue;
    out.push({ start: m.index, end: m.index + matchedText.length, id, matchedText });
  }
  return out;
}

/**
 * Усі місця згадки персонажа в книзі — використовується «Хранителем
 * цілісності персонажа». Повертає вже контекстні уривки; серверу не треба
 * отримувати цілу книгу, щоб перевірити одного героя.
 */
export function collectCharacterMentions(book: Book, characterId: string, contextRadius = 360): {
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  language: 'uk' | 'en';
  matchedText: string;
  context: string;
}[] {
  const character = book.characters.find((item) => item.id === characterId);
  if (!character) return [];
  const entries = buildNameEntries([character]);
  if (!entries.length) return [];

  const out: {
    chapterId: string;
    chapterTitle: string;
    sectionId: string;
    sectionTitle: string;
    language: 'uk' | 'en';
    matchedText: string;
    context: string;
  }[] = [];

  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      const sources: Array<{ language: 'uk' | 'en'; text: string }> = [
        { language: 'uk', text: section.content || '' },
        { language: 'en', text: section.contentEn || '' },
      ];
      for (const source of sources) {
        if (!source.text) continue;
        for (const mention of findMentionsInText(source.text, entries)) {
          const start = Math.max(0, mention.start - contextRadius);
          const end = Math.min(source.text.length, mention.end + contextRadius);
          out.push({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            sectionId: section.id,
            sectionTitle: section.title,
            language: source.language,
            matchedText: mention.matchedText,
            context: source.text.slice(start, end).trim(),
          });
        }
      }
    }
  }
  return out;
}
