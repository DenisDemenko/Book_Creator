/**
 * Текстова частина пошуку (Т1.2): що саме шукається словами, як запит
 * перетворюється на основи слів, і який текст абзацу йде в ембединг.
 *
 * Ці функції спільні для PostgreSQL і сховища в пам'яті, тож обидва
 * сховища шукають за одними правилами (див. `scripts/test-coreSearch.mts`).
 */

import { createHash } from 'node:crypto';
import { stripEntityTags } from '../../../src/utils/coreEntities';

/**
 * Текст абзацу для пошуку за словами — дзеркало SQL-функції
 * `core_search_text` (migrations/0006_core_search.sql): зі службової частини
 * тега лишається лише значення (`[/emotion:страх]` → «страх]»), маркери
 * форматування зникають.
 */
export function ftsPlainText(raw: string): string {
  return String(raw ?? '')
    .replace(/\[\/[a-z0-9Ѐ-ӿ-]+:/g, ' ')
    .replace(/\[\/?(FONT|SIZE|COLOR|HL|LINK)(=[^\]]*)?\]/g, ' ');
}

/** Слова рядка в нижньому регістрі; апостроф і дефіс ділять слово, як у парсері PostgreSQL. */
export function searchTokens(text: string): string[] {
  return (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Найбільше основ у запиті — довгий запит за словами все одно розмивається. */
export const MAX_QUERY_STEMS = 12;

/**
 * Основа слова для пошуку з префіксом. Словників української в PostgreSQL
 * немає, тож відмінки закриваємо грубо, але передбачувано: у довгого слова
 * відкидаємо закінчення («страху» → «страх», «Андрієм» → «андрі»), а далі
 * шукаємо все, що з цієї основи починається.
 */
export function wordStem(word: string): string {
  const w = word.toLowerCase();
  if (/^\p{N}+$/u.test(w)) return w;
  if (w.length >= 7) return w.slice(0, -2);
  if (w.length >= 5) return w.slice(0, -1);
  return w;
}

/**
 * Основи слів запиту: слова від трьох літер (числа — будь-які), без повторів.
 * Основа, яку вже покриває коротша (`страх` при `стра`), зайва — префікс і
 * так її знайде.
 */
export function searchStems(query: string): string[] {
  const out: string[] = [];
  for (const token of searchTokens(query)) {
    if (token.length < 3 && !/^\p{N}+$/u.test(token)) continue;
    const stem = wordStem(token);
    if (out.some((s) => stem.startsWith(s))) continue;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].startsWith(stem)) out.splice(i, 1);
    out.push(stem);
    if (out.length >= MAX_QUERY_STEMS) break;
  }
  return out;
}

/** Запит `to_tsquery('simple', …)`: будь-яка з основ, кожна — як префікс. */
export function tsQueryFromStems(stems: string[]): string {
  // Основи складаються лише з літер і цифр (searchTokens), тож екранувати нічого.
  return stems.map((s) => `${s}:*`).join(' | ');
}

/**
 * Оцінка абзацу за словами для сховища в пам'яті: скільки різних основ
 * запиту знайдено (головне) плюс невеликий внесок повторів. Порядок той
 * самий, що в PostgreSQL (`ts_rank`): абзац, де є всі слова запиту, вище за
 * абзац, де є одне.
 */
export function memoryTextScore(rawText: string, stems: string[]): number {
  if (!stems.length) return 0;
  const tokens = searchTokens(ftsPlainText(rawText));
  let matched = 0;
  let hits = 0;
  for (const stem of stems) {
    const n = tokens.filter((t) => t.startsWith(stem)).length;
    if (n) {
      matched++;
      hits += n;
    }
  }
  return matched ? matched + Math.min(hits - matched, 5) * 0.01 : 0;
}

/**
 * Текст абзацу, від якого рахується ембединг: те, що друкується, — без
 * тегів сутностей і маркерів форматування. Тег, поставлений автором, не
 * змінює змісту абзацу, тож і не має коштувати нового виклику моделі.
 */
export function embeddingText(rawText: string): string {
  return stripEntityTags(String(rawText ?? ''))
    .replace(/\[\/?(FONT|SIZE|COLOR|HL|LINK)(=[^\]]*)?\]/g, '')
    .replace(/\*\*|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Відбиток «модель + текст»: змінилось одне з двох — вектор застарів. */
export function embeddingContentHash(model: string, text: string): string {
  return createHash('sha256').update(model).update('\u0000').update(text).digest('hex').slice(0, 32);
}

/** Уривок абзацу для видачі — без тегів, обрізаний по слову. */
export function paragraphExcerpt(rawText: string, max = 280): string {
  const plain = embeddingText(rawText);
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Довжина вектора ембединга — одна для всіх моделей (колонка `vector(768)`). */
export const EMBEDDING_DIMENSIONS = 768;

/** Перевірка вектора перед записом — однакова для обох сховищ. */
export function isValidEmbedding(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** Види абзаців, у яких є що шукати (роздільник і картинка — без тексту). */
export const SEARCHABLE_KINDS = ['paragraph', 'heading', 'blockquote', 'table', 'draft'] as const;
export function isSearchableKind(kind: string): boolean {
  return (SEARCHABLE_KINDS as readonly string[]).includes(kind);
}
