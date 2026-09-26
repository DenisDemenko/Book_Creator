/**
 * Намір, з яким людина прийшла в Студію з маркетплейсу (Т0.9).
 *
 * Кнопки й картки блоку «напишіть книгу разом зі студією» на головній
 * маркетплейсу ведуть не просто в Студію, а в конкретний її розділ. Адресу
 * розділу маркетплейс не знає — книги, з якої вона будується
 * (`/projects/<id>/<сторінка>`), у нього немає; тож він передає **намір**
 * (`/studio/?open=<слаг>`), а рішення ухвалює вже Студія.
 *
 * Це принципово: слаг описує розділ, а не вкладку. `NavigationTab` — назва
 * стану всередині застосунку, і маркетплейс не має її знати: перейменування
 * вкладки не повинно ламати зовнішнє посилання.
 *
 * Модуль чистий (без `window`) — розбір адреси перевіряється тестом
 * `test:studio-entry`, і саме тому список слагів можна звірити з адресами
 * сторінок (`appRoutes.ts`) під час тесту, а не очима.
 */

import type { NavigationTab } from '../types';

export interface StudioEntrySection {
  /** Слаг в адресі: `/studio/?open=<slug>`. */
  slug: string;
  /** Вкладка Студії, яка цим слагом відкривається. */
  tab: NavigationTab;
  /** Що це за розділ — щоб список читався без переходу в `types.ts`. */
  titleUk: string;
}

/**
 * Слаги, які Студія зобов'язується відкривати. Це контракт із маркетплейсом:
 * той самий набір продубльовано в `apps/web/src/lib/studio-sections.ts`
 * (репозиторій `marketplace`), і розходження між ними = мертве посилання.
 *
 * Розширювати можна лише тим розділом, який справді існує: тест вимагає, щоб
 * у кожної вкладки була власна адреса в `appRoutes.ts`.
 */
export const STUDIO_ENTRY_SECTIONS: readonly StudioEntrySection[] = [
  { slug: 'express', tab: 'express', titleUk: 'Майстер «книга за 5 хвилин»' },
  { slug: 'story', tab: 'scenario', titleUk: 'Сюжет і структура' },
  { slug: 'characters', tab: 'characters', titleUk: 'Персонажі та звʼязки' },
  { slug: 'editor', tab: 'editor', titleUk: 'Редактор рукопису' },
  { slug: 'visuals', tab: 'illustrations', titleUk: 'Візуальна студія' },
  { slug: 'plan', tab: 'structure', titleUk: 'Конструктор структури книги' },
];

/**
 * Стеля на задум — та сама, що в полі «Зерно» експрес-майстра (400 знаків,
 * `ExpressWizardView`). Довший текст обрізаємо тут, а не там: у майстер він
 * має приїхати готовим, інакше поле мовчки обрізало б його посеред речення.
 */
export const ENTRY_IDEA_MAX = 400;

export interface StudioEntryIntent {
  tab: NavigationTab;
  /**
   * Задум книги з маркетплейсу — лише для експрес-майстра: у нього поле
   * «Зерно» і є тим одним реченням, з якого починається план.
   */
  idea?: string;
}

/** Параметри наміру: після розбору їх прибирають з адреси (як `invite`). */
export const STUDIO_ENTRY_PARAMS: readonly string[] = ['open', 'idea', 'create'];

export function studioEntrySection(slug: string): StudioEntrySection | undefined {
  const key = slug.trim().toLowerCase();
  return STUDIO_ENTRY_SECTIONS.find((s) => s.slug === key);
}

/**
 * `?open=<слаг>` і `?idea=<задум>` → вкладка Студії. `null` — адреса не несе
 * наміру або несе невідомий слаг; це не помилка, а звичайний вхід у Студію.
 */
export function parseStudioEntry(search: string): StudioEntryIntent | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  const idea = (params.get('idea') ?? '').trim().slice(0, ENTRY_IDEA_MAX) || undefined;

  // `?create=book` — давніша адреса тієї самої кнопки («Створити книгу за
  // 5 хвилин»). Вона вже стоїть у посиланнях на проді й у шапці
  // маркетплейсу, тож лишається робочою; `?open=express` — її новий,
  // однаковий з рештою розділів запис.
  if (params.get('create') === 'book') {
    return idea ? { tab: 'express', idea } : { tab: 'express' };
  }

  const open = params.get('open') ?? '';
  if (!open.trim()) return null;

  const section = studioEntrySection(open);
  if (!section) return null;

  // Задум приймає лише майстер: решті розділів він нікуди подітися не може,
  // а тягнути його в стан — це обіцянка, якої ніхто не виконає.
  return section.tab === 'express' && idea ? { tab: section.tab, idea } : { tab: section.tab };
}
