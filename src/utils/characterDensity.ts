import type { Book } from '../types';
import { buildNameEntries, findMentionsInText, type CharacterMentionEntry } from './characterMentions';

/**
 * «Густота втілення» персонажа — наскільки помітно він реально присутній
 * у тексті книги, а не лише в картці. Персонаж, заявлений на кількох
 * абзацах біографії, але який жодного разу не зʼявляється в тексті
 * далі за розділ 1, лишається радше нарисом ідеї, ніж дійовою особою:
 * автор про нього подумав, але текст його майже не «промовив». Це суто
 * обчислювана метрика (без AI-виклику — миттєва й безкоштовна), на
 * відміну від «Хранителя цілісності» (characterConsistencyPrompt.ts),
 * якому справді потрібне семантичне судження моделі.
 *
 * Два незалежні виміри:
 *  - обсяг згадувань (скільки разів персонаж узагалі зʼявляється);
 *  - широта охоплення (у якій частці розділів він хоч раз згадується) —
 *    протагоніст, що зʼявляється в кожному розділі 5 разів, «щільніше
 *    втілений», ніж другорядний герой із тими самими 5 згадуваннями,
 *    що всі стиснуті в одному розділі.
 * Обидва виміри нормалізуються до 0..1 і зважено сумуються — саме тому
 * це «густота», а не просто лічильник згадувань.
 */

export type DensityLabel = 'faint' | 'sketch' | 'present' | 'vivid';

export interface CharacterDensityStats {
  totalMentions: number;
  chaptersWithMentions: number;
  totalChapters: number;
  /** Частка розділів, де персонаж хоч раз згадується, 0..1. */
  chapterCoverage: number;
  /** Підсумкова густота, 0..100. */
  score: number;
  label: DensityLabel;
}

/**
 * Стеля насичення обсягу згадувань: понад це число додаткові згадування
 * далі не піднімають оцінку — інакше головний герой із сотнями
 * згадувань завжди «забивав» би шкалу, роблячи її марною для порівняння
 * решти персонажів між собою.
 */
const MENTION_SATURATION = 40;

const MENTIONS_WEIGHT = 0.6;
const COVERAGE_WEIGHT = 0.4;

export function densityLabelForScore(score: number): DensityLabel {
  if (score < 25) return 'faint';
  if (score < 50) return 'sketch';
  if (score < 75) return 'present';
  return 'vivid';
}

/**
 * Обчислює густоту ОДНОГО персонажа. Навмисно НЕ використовує
 * `collectCharacterMentions` (characterMentions.ts) — та функція збирає
 * контекст навколо кожної згадки (before/after) для AI-промту й ОБРІЗАЄ
 * вибірку рівномірно по всьому масиву згадувань, що спотворило б
 * `chapterCoverage` (обрізана вибірка може випадково пропустити розділ
 * з малою кількістю згадувань). Тут рахунок і охоплення по розділах
 * рахуються напряму й без обрізання.
 */
export function computeCharacterDensity(book: Book, character: CharacterMentionEntry): CharacterDensityStats {
  const entries = buildNameEntries([character]);
  const totalChapters = book.chapters.length;
  let totalMentions = 0;
  let chaptersWithMentions = 0;

  if (entries.length > 0) {
    for (const chapter of book.chapters) {
      let foundInChapter = false;
      for (const section of chapter.sections) {
        const texts = [section.content || '', section.contentEn || ''];
        for (const text of texts) {
          if (!text) continue;
          const count = findMentionsInText(text, entries).length;
          if (count > 0) {
            totalMentions += count;
            foundInChapter = true;
          }
        }
      }
      if (foundInChapter) chaptersWithMentions += 1;
    }
  }

  const chapterCoverage = totalChapters > 0 ? chaptersWithMentions / totalChapters : 0;
  const normalizedMentions = Math.min(1, totalMentions / MENTION_SATURATION);
  const score = Math.round(100 * (MENTIONS_WEIGHT * normalizedMentions + COVERAGE_WEIGHT * chapterCoverage));

  return {
    totalMentions,
    chaptersWithMentions,
    totalChapters,
    chapterCoverage,
    score,
    label: densityLabelForScore(score),
  };
}

/** Той самий розрахунок для всіх персонажів книги одразу — зручно для списку карток. */
export function computeAllCharacterDensities<T extends CharacterMentionEntry>(
  book: Book,
  characters: T[]
): Map<string, CharacterDensityStats> {
  const map = new Map<string, CharacterDensityStats>();
  for (const c of characters) {
    map.set(c.id, computeCharacterDensity(book, c));
  }
  return map;
}
