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

import { isTrackRunnable, type ExpressTrackId } from '../data/expressTracks';
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
  track?: ExpressTrackId;
  tab: NavigationTab;
  /**
   * Чернетка майстра інструкцій, що приїхала з GrabFusion (`/express/<id>`). Майстер бере чернетку
   * лише зі сховища браузера, тож вхід кладе туди цей id (`TECHNICAL_DRAFT_STORAGE_KEY`).
   */
  draftId?: string;
  /** Курс, що приїхав із GrabFusion (`/courses/<id>`): відкриваємо саме його, а не перелік. */
  courseId?: string;
  /**
   * Задум книги з маркетплейсу — лише для експрес-майстра: у нього поле
   * «Зерно» і є тим одним реченням, з якого починається план.
   */
  idea?: string;
}

/** Параметри наміру: після розбору їх прибирають з адреси (як `invite`). */
export const STUDIO_ENTRY_PARAMS: readonly string[] = ['open', 'idea', 'create', 'project', 'order', 'wizard'];

/**
 * Т6.3 (Role Onboarding §14): «Відкрити у Студії» конкретний проєкт — книгу
 * (`?project=<id книги>`) чи курс (`?project=course-<id>`), за бажанням із
 * фріланс-замовленням (`&order=<order_id>`). Студія визначає учасника й, якщо
 * роль у проєкті невідома, запускає опитувальник; замовлення поки не
 * перевіряється маркетплейсом — це запит доступу з його контекстом.
 */
export interface ProjectEntry {
  projectId: string;
  orderId?: string;
}

const ENTRY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function parseProjectEntry(search: string): ProjectEntry | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const projectId = (params.get('project') ?? '').trim();
  if (!ENTRY_ID_RE.test(projectId)) return null;
  const orderId = (params.get('order') ?? '').trim();
  return ENTRY_ID_RE.test(orderId) ? { projectId, orderId } : { projectId };
}

/**
 * Ключ сховища, з якого майстер «Інструкція з фото й техдокументації» бере чернетку
 * (`TechnicalInstructionWizard` → `useWizardDraft`). Тест порівнює обидва місця: розходження дало б
 * посилання, що відкриває порожній майстер.
 */
export const TECHNICAL_DRAFT_STORAGE_KEY = 'nova_technical_instruction_draft';

/**
 * Адреса `/express/<id>` (із префіксом `/studio` чи без): так GrabFusion посилає викладача на експрес-чернетку
 * інструкції (`photo-drafts` → `submit` → `studioUrl`, контракт 1.3.0). До 04.11.2026 такого маршруту в
 * застосунку не було: перехід вів на дашборд книги, і автор не бачив надісланого. Чернетки живуть 24 години,
 * id — UUID чи схожий рядок із літер, цифр і дефісів.
 */
export function parseExpressDraftPath(pathname: string): { draftId: string } | null {
  const m = /^(?:\/studio)?\/express\/([A-Za-z0-9][A-Za-z0-9-]{7,63})\/?$/.exec(pathname || '');
  return m ? { draftId: m[1] } : null;
}

/**
 * Адреса, з якою відкрили сторінку, фіксується тут, на імпорті модуля: до того, як маршрутизатор Студії
 * встигне замінити невідомий шлях на сторінку книги.
 */
export const INITIAL_EXPRESS_DRAFT: { draftId: string } | null =
  typeof window !== 'undefined' ? parseExpressDraftPath(window.location.pathname) : null;

/**
 * Адреса `/courses/<id>` (із префіксом `/studio` чи без): так GrabFusion посилає викладача на курс,
 * створений із чернетки за фото (`photo-drafts` → `submit` → `studioUrl`). Це та сама пастка, що була
 * з `/express/<id>` до 04.11.2026: маршрутизатор Студії таких шляхів не знає (`parseAppPath` розбирає
 * лише `/projects/...`), тож перехід мовчки відкривав дашборд книг — автор бачив свої книги й шукав
 * надісланий курс унизу сторінки. Id курсу Studio видає у вигляді літер, цифр, дефісів і підкреслень.
 */
export function parseCourseLinkPath(pathname: string): { courseId: string } | null {
  const m = /^(?:\/studio)?\/courses\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/?$/.exec(pathname || '');
  return m ? { courseId: m[1] } : null;
}

/** Як і з експрес-чернеткою: адресу читаємо на імпорті модуля, до роботи маршрутизатора. */
export const INITIAL_COURSE_LINK: { courseId: string } | null =
  typeof window !== 'undefined' ? parseCourseLinkPath(window.location.pathname) : null;

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
  const wizard = params.get('wizard');
  return { tab: section.tab, ...(section.tab === 'express' && idea ? { idea } : {}),
    ...(section.tab === 'express' && isTrackRunnable(wizard) ? { track: wizard as ExpressTrackId } : {}) };
}
