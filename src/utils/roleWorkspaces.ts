/**
 * Простори Студії за роллю в проєкті (Т6.4 В3, `PLAN_ROLE_STUDIO.md`; ТЗ Role
 * Onboarding §15). Для кожного простору реєстру ролей — розділи Студії в
 * порядку важливості й те, що з'явиться пізніше (Т7: завдання, результати,
 * маркетинг, інтеграції).
 *
 * Інтерфейс — НЕ механізм безпеки: простір лише впорядковує меню й стартову
 * сторінку; що відкрити й змінити, перевіряє сервер (наданий доступ Т6.2).
 * Розділи додатково фільтруються правами облікового запису (`canAccessTab`).
 */
import type { NavigationTab } from '../types';
import { canAccessTab } from './rbac';

export type L10n = { en: string; uk: string };

export interface RoleWorkspaceDef {
  id: string;
  name: L10n;
  about: L10n;
  /** Розділи простору; перший доступний — головний. */
  tabs: NavigationTab[];
  /** Розділи з ТЗ §15, яких ще немає (Т7). */
  later: L10n[];
}

const n = (en: string, uk: string): L10n => ({ en, uk });

export const ROLE_WORKSPACES: RoleWorkspaceDef[] = [
  {
    id: 'author',
    name: n('Author workspace', 'Простір автора'),
    about: n('Text, story board, characters, illustrations and AI analysis.', 'Текст, дошка історії, персонажі, ілюстрації та аналіз ШІ.'),
    tabs: ['editor', 'scenario', 'mindboard', 'characters', 'media', 'core-story-graph', 'ai-studio', 'core-continuity'],
    later: [],
  },
  {
    id: 'editor',
    name: n('Editor workspace', 'Простір редактора'),
    about: n('Text, editing suggestions, continuity and change history.', 'Текст, редакторські пропозиції, безперервність і журнал змін.'),
    tabs: ['editor', 'ai-studio', 'core-continuity', 'changelog', 'preview'],
    later: [n('Editorial tasks', 'Редакторські завдання')],
  },
  {
    id: 'reviewer',
    name: n('Reviewer workspace', 'Простір рецензента'),
    about: n('Reading the book and leaving feedback for the author.', 'Читання книги й відгуки для автора.'),
    tabs: ['preview', 'editor', 'core-continuity'],
    later: [],
  },
  {
    id: 'illustrator',
    name: n('Illustrator workspace', 'Простір ілюстратора'),
    about: n('Scene and character references, visual bible, creative workspace and deliverables.', 'Референси сцен і персонажів, візуальна біблія, творчий простір і результати.'),
    tabs: ['illustrations', 'core-visual', 'characters', 'media'],
    later: [n('Assigned tasks', 'Призначені завдання'), n('Deliverables', 'Результати')],
  },
  {
    id: 'designer',
    name: n('Designer workspace', 'Простір дизайнера'),
    about: n('Cover, book layout, assets and visual bible.', 'Обкладинка, макет книги, матеріали й візуальна біблія.'),
    tabs: ['cover', 'layout', 'pdf-editor', 'media', 'core-visual', 'illustrations'],
    later: [n('Design tasks', 'Дизайнерські завдання')],
  },
  {
    id: 'translator',
    name: n('Translator workspace', 'Простір перекладача'),
    about: n('Contextual translation with the book glossary.', 'Контекстний переклад із глосарієм книги.'),
    tabs: ['core-translation', 'editor', 'characters', 'preview'],
    later: [],
  },
  {
    id: 'manager',
    name: n('Manager workspace', 'Простір менеджера'),
    about: n('Project status, publication, storefront listings and the team.', 'Стан проєкту, публікація, картки вітрини й команда.'),
    tabs: ['dashboard', 'publishing', 'export', 'kdp-format', 'core-collaboration'],
    later: [n('Marketing', 'Маркетинг'), n('Tasks', 'Завдання')],
  },
  {
    id: 'developer',
    name: n('Developer workspace', 'Простір розробника'),
    about: n('Technical tasks, assigned resources, integrations, files and specifications.', 'Технічні завдання, призначені ресурси, інтеграції, файли й специфікації.'),
    tabs: ['core-collaboration', 'core-search', 'export'],
    later: [n('Technical tasks', 'Технічні завдання'), n('Integrations', 'Інтеграції'), n('Files / specifications', 'Файли / специфікації')],
  },
];

export const workspaceById = (id: string | null | undefined): RoleWorkspaceDef | undefined => ROLE_WORKSPACES.find((w) => w.id === id);

/** Розділи простору, доступні обліковому запису (і відкриті участю — `extraTabs`). */
export function workspaceTabs(workspace: string | null | undefined, role: string | null | undefined, extraTabs: NavigationTab[] = []): NavigationTab[] {
  const def = workspaceById(workspace);
  if (!def) return [];
  return def.tabs.filter((t) => canAccessTab(role, t) || extraTabs.includes(t));
}

/** Головний розділ простору (перший доступний) — або null. */
export function workspaceMainTab(workspace: string | null | undefined, role: string | null | undefined): NavigationTab | null {
  return workspaceTabs(workspace, role)[0] ?? null;
}
