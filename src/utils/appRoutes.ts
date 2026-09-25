/**
 * Адреси вкладок Студії (Т0.8, рішення К3 — History API).
 *
 * Досі вкладка жила лише в стані React: адресу не можна було надіслати
 * співавтору, закладка вела на дашборд, а «назад» у браузері виходив зі
 * Студії. Тепер кожна вкладка має адресу
 *
 *     <префікс>/projects/<id книги>/<сторінка>
 *
 * (К6: проєкт = книга). Сторінки семантичного ядра — одинадцять сторінок ТЗ
 * «11 окремих сторінок» — мають адреси з ТЗ (`/search`, `/story-graph`,
 * `/characters/:characterId`…); решта вкладок — свою назву (`/editor`).
 *
 * Модуль чистий (без window): розбір і побудова адреси перевіряються
 * тестом `test:app-routes`, а App.tsx лише застосовує результат.
 */

import type { NavigationTab } from '../types';

export interface CorePageDef {
  tab: NavigationTab;
  /**
   * Сегмент адреси з ТЗ. Профіль персонажа: з героєм — `characters/<id>` (як у
   * ТЗ), без героя (вибір зі списку) — `character-profile`, бо `characters`
   * уже зайнята вкладкою «Персонажі».
   */
  segment: string;
  titleUk: string;
  titleEn: string;
  /** Що сторінка робитиме — з ТЗ, коротко (показ на заглушці). */
  purposeUk: string;
  /** Етап дорожньої карти, на якому сторінка оживе. */
  stage: 1 | 2 | 3;
}

/** Одинадцять сторінок ТЗ-11 у порядку документа. */
export const CORE_PAGES: CorePageDef[] = [
  { tab: 'core-search', segment: 'search', titleUk: 'Розумний пошук', titleEn: 'Smart search', stage: 1,
    purposeUk: 'Пошук за змістом і за сутностями: «де Олена боїться води» — з абзацами-доказами.' },
  { tab: 'core-story-graph', segment: 'story-graph', titleUk: 'Граф історії', titleEn: 'Story graph', stage: 1,
    purposeUk: 'Сутності книги й зв\'язки між ними: хто з ким, що з чого випливає — з підтвердженням автора.' },
  { tab: 'core-character', segment: 'character-profile', titleUk: 'Профіль персонажа', titleEn: 'Character profile', stage: 1,
    purposeUk: 'Усе про героя з тексту: згадки, риси, стосунки, емоції — кожен висновок із доказом.' },
  { tab: 'core-emotions', segment: 'emotions', titleUk: 'Емоційна аналітика', titleEn: 'Emotion analytics', stage: 2,
    purposeUk: 'Емоційні криві героїв і сцен за тегами й аналізом тексту.' },
  { tab: 'core-branches', segment: 'scenario-branches', titleUk: 'Гілки сценарію', titleEn: 'Scenario branches', stage: 3,
    purposeUk: 'Альтернативні гілки сюжету від точки розгалуження — без зміни основного тексту.' },
  { tab: 'core-timeline', segment: 'timeline', titleUk: 'Хронологія історії', titleEn: 'Story timeline', stage: 2,
    purposeUk: 'Події в часі історії, а не в порядку розділів: що було раніше, що перекривається.' },
  { tab: 'core-visual', segment: 'visual-library', titleUk: 'Візуальна бібліотека', titleEn: 'Visual library', stage: 2,
    purposeUk: 'Ілюстрації, пов\'язані з сутностями: зовнішність, місця, предмети — з ліцензією й версіями.' },
  { tab: 'core-continuity', segment: 'continuity', titleUk: 'Перевірка безперервності', titleEn: 'Continuity checker', stage: 2,
    purposeUk: 'Суперечності в часі, фактах і знанні героїв — з доказами й статусом «навмисно».' },
  { tab: 'core-mastery', segment: 'writer-mastery', titleUk: 'Майстерність письменника', titleEn: 'Writer mastery', stage: 3,
    purposeUk: 'Вправи на матеріалі власної книги, прив\'язані до сутностей і абзаців.' },
  { tab: 'core-collaboration', segment: 'collaboration', titleUk: 'Спільна робота', titleEn: 'Collaboration', stage: 3,
    purposeUk: 'Учасники проєкту, ролі й доступ до глав, редакторські задачі й коментарі.' },
  { tab: 'core-translation', segment: 'translation', titleUk: 'Контекстний переклад', titleEn: 'Contextual translation', stage: 3,
    purposeUk: 'Переклад абзаців із глосарієм сутностей і статусами «чернетка / затверджено».' },
];

export const CORE_PAGE_TABS: NavigationTab[] = CORE_PAGES.map((p) => p.tab);

export function isCorePageTab(tab: NavigationTab): boolean {
  return CORE_PAGE_TABS.includes(tab);
}

export function corePageByTab(tab: NavigationTab): CorePageDef | undefined {
  return CORE_PAGES.find((p) => p.tab === tab);
}

/**
 * Вкладки, що мають власну адресу. `market` — не вкладка, а вікно поверх
 * поточної (App.tsx: handleSelectTab), тож адреси не має.
 */
const ROUTABLE_TABS: NavigationTab[] = [
  'express', 'dashboard', 'start', 'editor', 'mastery', 'scenario', 'characters', 'mindboard', 'toc',
  'qr-footnotes', 'ai-studio', 'illustrations', 'layout', 'preview', 'cover', 'media', 'changelog', 'export',
  'admin', 'subscription', 'api-keys', 'kdp-format', 'courses', 'course-studio', 'narration', 'pdf-editor',
  'knowledge', 'trainers', 'diagn', 'structure', 'portfolio', 'publishing',
];

export interface AppRoute {
  projectId: string;
  tab: NavigationTab;
  /** Лише для профілю персонажа: id сутності ядра. */
  characterId?: string;
}

/** Id книги в адресі: той самий набір символів, що приймає сервер (isValidBookId). */
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function stripBase(pathname: string, base: string): string | null {
  const b = base.replace(/\/$/, '');
  if (!b) return pathname;
  if (pathname === b) return '/';
  return pathname.startsWith(`${b}/`) ? pathname.slice(b.length) : null;
}

/** Адреса → вкладка й книга. `null` — адреса не наша (корінь, лендінг, чуже). */
export function parseAppPath(pathname: string, base = ''): AppRoute | null {
  const rest = stripBase(pathname, base);
  if (rest === null) return null;
  const parts = rest.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts[0] !== 'projects' || !parts[1] || !ID_RE.test(parts[1])) return null;
  const projectId = parts[1];
  const page = parts[2];
  if (!page) return { projectId, tab: 'dashboard' };
  // Профіль персонажа (ТЗ: /characters/:characterId) — інакше «characters»
  // лишається звичною вкладкою «Персонажі».
  if (page === 'characters' && parts[3]) return { projectId, tab: 'core-character', characterId: parts[3] };
  const core = CORE_PAGES.find((p) => p.segment === page);
  if (core) return { projectId, tab: core.tab };
  if ((ROUTABLE_TABS as string[]).includes(page)) return { projectId, tab: page as NavigationTab };
  return null;
}

/** Вкладка й книга → адреса. `null` — у вкладки немає адреси (market). */
export function buildAppPath(route: AppRoute, base = ''): string | null {
  const b = base.replace(/\/$/, '');
  const id = encodeURIComponent(route.projectId);
  if (route.tab === 'core-character') {
    return route.characterId
      ? `${b}/projects/${id}/characters/${encodeURIComponent(route.characterId)}`
      : `${b}/projects/${id}/character-profile`;
  }
  const core = corePageByTab(route.tab);
  if (core) return `${b}/projects/${id}/${core.segment}`;
  if ((ROUTABLE_TABS as string[]).includes(route.tab)) return `${b}/projects/${id}/${route.tab}`;
  return null;
}
