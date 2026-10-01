/**
 * Collaboration Ontology (Онтологія співпраці) і Role Registry (Реєстр ролей)
 * — Т6.1 В1, `PLAN_COLLABORATION.md`; ТЗ Graph Studio v3.0 §43–48, §58–59;
 * ТЗ Role Onboarding v3.1 §5–7, §17–19.
 *
 * ОКРЕМИЙ ДОМЕН. Story Ontology (`ontology.ts`, 118+ типів) описує зміст
 * книги; ця — людей, ролі, завдання, внески й доступ. Вони живуть в одному
 * реєстрі схем (`ontology_versions`, онтологія `fusion-collab`), але не
 * змішуються: ID типів співпраці — ВЕЛИКИМИ (`PERSON`), slug-и твору —
 * малими (`character`), а в міждоменних зв'язках посилання завжди
 * кваліфіковані (`collab:PERSON`, `story:character`). Реальна людина
 * ніколи не стає персонажем, навіть з однаковим ім'ям (ТЗ §58, критерій №32).
 *
 * РОЛЬ ≠ ДОЗВІЛ (Onboarding §19). Роль пропонує шаблон можливостей і
 * робочий простір; фактичні права — Т6.2 (Access Grant). Реєстр ролей —
 * єдине джерело: запрошення, інтерфейс і ядро читають його, а не власні
 * списки (критерій Onboarding №4).
 *
 * Файл спільний для сервера й клієнта, без залежностей від Node чи DOM.
 */

import { canonicalJson, type LocalizedName, type OntologyDefinition, type OntologyIssue, type OntologyStatus, type OntologyValidation } from './ontology';

export const COLLAB_ONTOLOGY_FORMAT = 'fusion-collab/1';
export const COLLAB_ONTOLOGY_ID = 'fusion-collab';

/** Кваліфіковане посилання на тип іншого домену: `story:character`, `collab:PERSON`. */
export type DomainRef = `story:${string}` | `collab:${string}`;

export interface CollabEntityType {
  /** ВЕЛИКИМИ: `PERSON`, `BOOK_PROJECT`. */
  id: string;
  name: LocalizedName;
  status: OntologyStatus;
  /** Чи вже є в системі як дані (а не лише в моделі): Т6.1 — PERSON, PARTICIPANT, ROLE, BOOK_PROJECT. */
  implemented: boolean;
  description: string;
}

export interface CollabRelationType {
  /** ВЕЛИКИМИ: `HAS_ROLE`. */
  id: string;
  name: LocalizedName;
  from: string[];
  to: string[];
  status: OntologyStatus;
}

/** Міждоменний зв'язок (§48): від типу співпраці до типу твору. */
export interface CrossDomainRelationType {
  id: string;
  name: LocalizedName;
  from: DomainRef[];
  to: DomainRef[];
  status: OntologyStatus;
  example: string;
}

export interface CollabOption {
  id: string;
  name: LocalizedName;
}

export interface CollabWorkspace extends CollabOption {
  /**
   * Робочий простір Студії, який зараз відповідає цьому — роль облікового
   * запису з `rbac.ts` (writer / designer / publisher / translator / reader),
   * поки Т6.4 не дасть простір за роллю в проєкті.
   */
  studioRole: 'writer' | 'designer' | 'publisher' | 'translator' | 'reader';
}

/** Визначення ролі (Onboarding §18). */
export interface RoleDefinition {
  /** snake_case: `illustrator`, `co_author`. Незмінний. */
  id: string;
  label: LocalizedName;
  category: string;
  projectTypes: string[];
  defaultWorkspace: string;
  suggestedCapabilities: string[];
  aiProfile: string;
  status: OntologyStatus;
  /** Фрілансер — тип участі, а не професія: спеціалізація обов'язкова (Onboarding §7). */
  requiresSpecialization: boolean;
  /** Дозволені спеціалізації — id інших ролей. */
  specializations: string[];
  /** Лише один учасник проєкту може мати цю роль (власник проєкту). */
  singleHolder: boolean;
  /** Чи можна поєднувати з іншими ролями того самого учасника (критерій v3 №34). */
  combinable: boolean;
  /** Чи можна запросити людину в цій ролі (вікно запрошення). */
  invitable: boolean;
  /** Старі значення, що відповідають цій ролі: запрошення (`reader`), `project_members` (`coauthor`). */
  legacyIds: string[];
  order: number;
  /** Що робить людина в цій ролі — для листа-запрошення й вибору ролі. */
  description?: LocalizedName;
}

export interface CollabOntologyDefinition {
  format: typeof COLLAB_ONTOLOGY_FORMAT;
  id: string;
  name: LocalizedName;
  entityTypes: CollabEntityType[];
  relationTypes: CollabRelationType[];
  crossDomainRelations: CrossDomainRelationType[];
  roleCategories: CollabOption[];
  projectTypes: CollabOption[];
  entryIntents: CollabOption[];
  scopeTypes: CollabOption[];
  capabilities: CollabOption[];
  workspaces: CollabWorkspace[];
  roles: RoleDefinition[];
}

// ---------------------------------------------------------------------------
// Fusion Collaboration Ontology 1.0
// ---------------------------------------------------------------------------

const n = (en: string, uk: string): LocalizedName => ({ en, uk });
const opts = (rows: [string, string, string][]): CollabOption[] => rows.map(([id, en, uk]) => ({ id, name: n(en, uk) }));

/** Базові сутності співпраці (§45). `implemented` — уже мають дані в системі. */
const ENTITY_ROWS: [string, string, string, boolean, string][] = [
  ['PERSON', 'Person', 'Людина', true, 'Реальна людина — обліковий запис платформи. Не персонаж твору.'],
  ['PARTICIPANT', 'Participant', 'Учасник проєкту', true, 'Участь людини в конкретному проєкті.'],
  ['ROLE', 'Role', 'Роль', true, 'Роль із реєстру ролей; належить участі, а не людині.'],
  ['BOOK_PROJECT', 'Book Project', 'Проєкт книги', true, 'Книга чи курс у Студії.'],
  ['TASK', 'Task', 'Завдання', false, 'Робота, призначена учасникові (Т7).'],
  ['DELIVERABLE', 'Deliverable', 'Результат роботи', false, 'Те, що здає виконавець завдання.'],
  ['CONTRIBUTION', 'Contribution', 'Внесок', false, 'Фактичний внесок із походженням (Т6.5); не юридичне авторство.'],
  ['ACCESS_GRANT', 'Access Grant', 'Наданий доступ', false, 'Доступ у межах проєкту й ресурсу (Т6.2).'],
  ['APPLICATION', 'Application', 'Заявка', false, 'Заявка фахівця на замовлення (біржа).'],
  ['ORDER', 'Order', 'Замовлення', false, 'Замовлення з біржі маркетплейсу.'],
  ['CREATIVE_PROJECT', 'Creative Project', 'Творчий проєкт', false, 'Проєкт Creative Studio (Т7).'],
  ['SPECIALIST_PROFILE', 'Specialist Profile', 'Профіль спеціаліста', false, 'Профіль фахівця на біржі.'],
  ['ASSET', 'Asset', 'Ресурс', false, 'Файл чи медіаоб\'єкт проєкту.'],
  ['REVIEW', 'Review', 'Перевірка', false, 'Рецензія роботи.'],
  ['APPROVAL', 'Approval', 'Схвалення', false, 'Рішення прийняти результат.'],
  ['CONTRACT', 'Contract', 'Домовленість', false, 'Умови співпраці.'],
  ['PUBLICATION_TASK', 'Publication Task', 'Завдання публікації', false, 'Підготовка до публікації.'],
  ['LISTING', 'Listing', 'Картка продажу', false, 'Лістинг на вітрині.'],
];

const RELATION_ROWS: [string, string, string, string[], string[]][] = [
  ['IS_PARTICIPANT', 'Is participant', 'Є учасником', ['PERSON'], ['PARTICIPANT']],
  ['PARTICIPATES_IN', 'Participates in', 'Бере участь у', ['PARTICIPANT'], ['BOOK_PROJECT', 'CREATIVE_PROJECT']],
  ['HAS_ROLE', 'Has role', 'Має роль', ['PARTICIPANT'], ['ROLE']],
  ['ASSIGNED_TO', 'Assigned to', 'Призначений на', ['PARTICIPANT'], ['TASK']],
  ['CREATES', 'Creates', 'Створює', ['TASK', 'PARTICIPANT'], ['DELIVERABLE', 'ASSET']],
  ['REVIEWS', 'Reviews', 'Перевіряє', ['REVIEW'], ['DELIVERABLE']],
  ['APPROVES', 'Approves', 'Схвалює', ['APPROVAL'], ['DELIVERABLE']],
  ['GRANTS', 'Grants', 'Надає', ['ACCESS_GRANT'], ['PARTICIPANT']],
  ['FULFILLS', 'Fulfills', 'Виконує', ['PARTICIPANT'], ['ORDER']],
  ['APPLIES_TO', 'Applies to', 'Подається на', ['APPLICATION'], ['ORDER']],
  ['LISTS', 'Lists', 'Виставляє', ['LISTING'], ['BOOK_PROJECT']],
];

/** Міждоменні зв'язки (§48) — «контрольований міст» між створенням книги та її змістом. */
const CROSS_ROWS: [string, string, string, DomainRef[], DomainRef[], string][] = [
  ['WROTE', 'Wrote', 'Написав', ['collab:PERSON'], ['story:chapter', 'story:scene', 'story:section'], 'Людина → розділ'],
  ['CREATED', 'Created', 'Створив', ['collab:PERSON'], ['story:character', 'story:location', 'story:world', 'story:object'], 'Людина → персонаж'],
  ['EDITED', 'Edited', 'Редагував', ['collab:PERSON'], ['story:chapter', 'story:scene', 'story:section', 'story:paragraph'], 'Людина → сцена'],
  ['ILLUSTRATED', 'Illustrated', 'Ілюстрував', ['collab:PERSON'], ['story:scene', 'story:character', 'story:location'], 'Людина → сцена'],
  ['TRANSLATED', 'Translated', 'Переклав', ['collab:PERSON'], ['story:document', 'story:chapter'], 'Людина → документ'],
  ['DEPICTS', 'Depicts', 'Зображує', ['collab:ASSET'], ['story:character', 'story:location', 'story:object', 'story:scene'], 'Ресурс → персонаж'],
  ['BASED_ON', 'Based on', 'Базується на', ['collab:ASSET', 'collab:TASK'], ['story:scene', 'story:chapter', 'story:character'], 'Завдання → сцена'],
  ['TARGETS', 'Targets', 'Стосується', ['collab:TASK'], ['story:character', 'story:location', 'story:scene'], 'Завдання → персонаж'],
  ['FOLLOWS_STYLE', 'Follows style', 'Дотримується стилю', ['collab:TASK', 'collab:ASSET'], ['story:author-style', 'story:narrative-voice'], 'Завдання → стиль автора'],
];

const CATEGORY_ROWS: [string, string, string][] = [
  ['writing', 'Writing Roles', 'Письменницькі ролі'],
  ['editorial', 'Editorial Roles', 'Редакторські ролі'],
  ['visual_creative', 'Visual & Creative Roles', 'Візуальні та творчі ролі'],
  ['language', 'Language Roles', 'Мовні ролі'],
  ['management_commercial', 'Management & Commercial Roles', 'Управлінські та комерційні ролі'],
  ['technical', 'Technical Roles', 'Технічні ролі'],
  ['marketplace', 'Marketplace Role', 'Роль на біржі'],
];

const PROJECT_TYPE_ROWS: [string, string, string][] = [
  ['book', 'Book', 'Книга'],
  ['course', 'Course', 'Курс'],
  ['educational_program', 'Educational Program', 'Освітня програма'],
  ['illustration_project', 'Illustration Project', 'Проєкт ілюстрацій'],
  ['design_project', 'Design Project', 'Дизайн-проєкт'],
  ['other', 'Other', 'Інше'],
];

const INTENT_ROWS: [string, string, string][] = [
  ['create_own_project', 'Create own project', 'Створюю власний проєкт'],
  ['join_existing_project', 'Join existing project', 'Долучаюсь до наявного проєкту'],
  ['accept_invitation', 'Accept invitation', 'Приймаю запрошення'],
  ['fulfill_freelance_order', 'Fulfill freelance order', 'Виконую фріланс-замовлення'],
  ['manage_or_sell', 'Manage or sell', 'Керую або займаюся продажем'],
  ['review_or_edit', 'Review or edit', 'Перевіряю або редагую'],
  ['other', 'Other', 'Інше'],
];

const SCOPE_ROWS: [string, string, string][] = [
  ['whole_project', 'Whole project', 'Увесь проєкт'],
  ['selected_book', 'Selected book', 'Обрана книга'],
  ['selected_course', 'Selected course', 'Обраний курс'],
  ['selected_chapters', 'Selected chapters', 'Обрані розділи'],
  ['selected_scenes', 'Selected scenes', 'Обрані сцени'],
  ['selected_characters', 'Selected characters', 'Обрані персонажі'],
  ['media_library', 'Media library', 'Медіатека'],
  ['visual_bible', 'Visual bible', 'Візуальна біблія'],
  ['marketing_data', 'Marketing data', 'Маркетингові дані'],
  ['assigned_tasks_only', 'Assigned tasks only', 'Лише призначені завдання'],
];

const CAPABILITY_ROWS: [string, string, string][] = [
  ['view', 'View', 'Перегляд'],
  ['comment', 'Comment', 'Коментування'],
  ['create', 'Create', 'Створення'],
  ['edit', 'Edit', 'Редагування'],
  ['upload', 'Upload', 'Завантаження файлів'],
  ['review', 'Review', 'Перевірка'],
  ['propose', 'Propose', 'Пропонування змін'],
  ['approve', 'Approve', 'Схвалення'],
  ['publish', 'Publish', 'Публікація'],
  ['manage', 'Manage', 'Керування'],
];

const WORKSPACE_ROWS: [string, string, string, CollabWorkspace['studioRole']][] = [
  ['author', 'Author workspace', 'Простір автора', 'writer'],
  ['editor', 'Editor workspace', 'Простір редактора', 'writer'],
  ['illustrator', 'Illustrator workspace', 'Простір ілюстратора', 'designer'],
  ['designer', 'Designer workspace', 'Простір дизайнера', 'designer'],
  ['translator', 'Translator workspace', 'Простір перекладача', 'translator'],
  ['manager', 'Manager workspace', 'Простір менеджера', 'publisher'],
  ['developer', 'Developer workspace', 'Простір розробника', 'reader'],
  ['reviewer', 'Reviewer workspace', 'Простір рецензента', 'reader'],
];

type RoleRow = [id: string, en: string, uk: string, category: string, workspace: string, caps: string, extra?: Partial<RoleDefinition>];
const BOOKISH = ['book', 'course', 'educational_program'];
const ALL_TYPES = PROJECT_TYPE_ROWS.map((r) => r[0]);
/** Ролі Onboarding §7 + бета-рідер (рішення власника §2 п.3). Можливості — шаблон, не дозвіл. */
const ROLE_ROWS: RoleRow[] = [
  ['author', 'Author', 'Автор / письменник', 'writing', 'author', 'view comment create edit propose'],
  ['co_author', 'Co-author', 'Співавтор', 'writing', 'author', 'view comment create edit propose', { legacyIds: ['coauthor'] }],
  ['ghostwriter', 'Ghostwriter', 'Літературний автор на замовлення', 'writing', 'author', 'view comment create edit propose'],
  ['screenwriter', 'Screenwriter', 'Сценарист', 'writing', 'author', 'view comment create edit propose'],
  ['course_author', 'Course Author', 'Автор курсу', 'writing', 'author', 'view comment create edit propose', { projectTypes: ['course', 'educational_program'] }],
  ['content_author', 'Content Author', 'Автор контенту', 'writing', 'author', 'view comment create edit propose'],
  ['editor', 'Editor', 'Редактор', 'editorial', 'editor', 'view comment edit review propose'],
  ['literary_editor', 'Literary Editor', 'Літературний редактор', 'editorial', 'editor', 'view comment edit review propose'],
  ['proofreader', 'Proofreader', 'Коректор', 'editorial', 'editor', 'view comment propose'],
  ['literary_critic', 'Literary Critic', 'Літературний критик', 'editorial', 'reviewer', 'view comment review'],
  ['fact_checker', 'Fact Checker', 'Фактчекер', 'editorial', 'reviewer', 'view comment review propose'],
  ['reviewer', 'Reviewer', 'Рецензент', 'editorial', 'reviewer', 'view comment review'],
  ['beta_reader', 'Beta Reader', 'Читач (бета-рідер)', 'editorial', 'reviewer', 'view comment', { invitable: true, legacyIds: ['reader'], description: n('Reads the manuscript and gives the author feedback (beta reading), without editing rights.', 'Читання рукопису та відгуки для автора (бета-рідинг), без права редагування.') }],
  ['designer', 'Designer', 'Дизайнер', 'visual_creative', 'designer', 'view comment create upload propose', { invitable: true, projectTypes: ALL_TYPES, description: n("Book cover, illustrations, Visual Bible and the edition's media library.", 'Обкладинка книги, ілюстрації, Visual Bible та медіатека видання.') }],
  ['book_designer', 'Book Designer', 'Дизайнер книги', 'visual_creative', 'designer', 'view comment create upload propose', { invitable: true, description: n('Book design: layout look, typography and visual consistency of the edition.', 'Дизайн книги: вигляд верстки, типографіка й цілісність видання.') }],
  ['illustrator', 'Illustrator', 'Ілюстратор', 'visual_creative', 'illustrator', 'view comment create upload propose', { invitable: true, projectTypes: [...BOOKISH, 'illustration_project'], description: n('Illustrations of scenes, characters and places from the book.', 'Ілюстрації сцен, персонажів і місць книги.') }],
  ['cover_designer', 'Cover Designer', 'Дизайнер обкладинки', 'visual_creative', 'designer', 'view comment create upload propose', { invitable: true, description: n('The book cover for print and the storefront.', 'Обкладинка книги для друку й вітрини.') }],
  ['layout_designer', 'Layout Designer', 'Верстальник', 'visual_creative', 'designer', 'view comment create upload propose', { invitable: true, description: n('Layout of the print edition to printing standards.', 'Верстка друкованої редакції за поліграфічними стандартами.') }],
  ['photographer', 'Photographer', 'Фотограф', 'visual_creative', 'illustrator', 'view comment upload propose', { invitable: true, projectTypes: ALL_TYPES, description: n('Photos for the book, the cover and promotion.', 'Фото для книги, обкладинки й просування.') }],
  ['video_creator', 'Video Creator', 'Автор відео', 'visual_creative', 'illustrator', 'view comment create upload propose', { invitable: true, projectTypes: ALL_TYPES, description: n('Video about the book: trailer, reels, presentations.', 'Відео про книгу: трейлер, ролики, презентації.') }],
  ['animator', 'Animator', 'Аніматор', 'visual_creative', 'illustrator', 'view comment create upload propose', { invitable: true, projectTypes: ALL_TYPES, description: n('Animation for the book and its promotion.', 'Анімація для книги та її просування.') }],
  ['translator', 'Translator', 'Перекладач', 'language', 'translator', 'view comment create edit propose', { invitable: true, description: n('Translating the book into English (English Edition) in bilingual mode.', 'Переклад книги англійською (English Edition) у двомовному режимі.') }],
  ['localization_specialist', 'Localization Specialist', 'Спеціаліст з локалізації', 'language', 'translator', 'view comment edit propose', { invitable: true, description: n('Adapting the book for another language and market.', 'Адаптація книги до іншої мови й ринку.') }],
  ['project_owner', 'Project Owner', 'Власник проєкту', 'management_commercial', 'author', 'view comment create edit upload review propose approve publish manage', { singleHolder: true, legacyIds: ['owner'], projectTypes: ALL_TYPES }],
  ['project_manager', 'Project Manager', 'Менеджер проєкту', 'management_commercial', 'manager', 'view comment review manage', { projectTypes: ALL_TYPES }],
  ['book_manager', 'Book Manager', 'Менеджер книги', 'management_commercial', 'manager', 'view comment publish manage', { invitable: true, projectTypes: ['book'], description: n('Publication, storefront listings and coordination of the book.', 'Публікація, картки вітрини й координація книги.') }],
  ['course_manager', 'Course Manager', 'Менеджер курсу', 'management_commercial', 'manager', 'view comment publish manage', { projectTypes: ['course', 'educational_program'] }],
  ['sales_manager', 'Sales Manager', 'Менеджер з продажу', 'management_commercial', 'manager', 'view comment publish', { invitable: true, description: n('Sales of the book: prices, channels, listings.', 'Продажі книги: ціни, канали, картки товару.') }],
  ['marketing_manager', 'Marketing Manager', 'Маркетинговий менеджер', 'management_commercial', 'manager', 'view comment create upload', { invitable: true, description: n('Marketing of the book: descriptions, promo texts, materials.', 'Маркетинг книги: описи, рекламні тексти, матеріали.') }],
  ['publisher', 'Publisher', 'Видавець', 'management_commercial', 'manager', 'view comment review approve publish', { invitable: true, description: n('Layout, print standards, Amazon KDP audit and print-run export.', 'Верстка, поліграфічні стандарти, аудит Amazon KDP і експорт тиражу.') }],
  ['developer', 'Developer', 'Програміст / розробник', 'technical', 'developer', 'view comment create upload', { projectTypes: ALL_TYPES }],
  ['web_developer', 'Web Developer', 'Веброзробник', 'technical', 'developer', 'view comment create upload', { projectTypes: ALL_TYPES }],
  ['ai_specialist', 'AI Specialist', 'Спеціаліст із ШІ', 'technical', 'developer', 'view comment create', { projectTypes: ALL_TYPES }],
  ['technical_specialist', 'Technical Specialist', 'Технічний спеціаліст', 'technical', 'developer', 'view comment create upload', { projectTypes: ALL_TYPES }],
  ['freelancer', 'Freelancer', 'Фрілансер', 'marketplace', 'illustrator', 'view comment upload propose', {
    projectTypes: ALL_TYPES,
    requiresSpecialization: true,
    specializations: ['illustrator', 'designer', 'book_designer', 'cover_designer', 'layout_designer', 'photographer', 'video_creator', 'animator', 'editor', 'literary_editor', 'proofreader', 'translator', 'localization_specialist', 'developer', 'web_developer', 'ai_specialist', 'ghostwriter', 'screenwriter', 'content_author', 'marketing_manager'],
  }],
];

/** Fusion Collaboration Ontology 1.0 — §45–48, Onboarding §5–7, бета-рідер. */
export function factoryCollabOntology(): CollabOntologyDefinition {
  const workspaceAi = (w: string) => `${w}_default`;
  return {
    format: COLLAB_ONTOLOGY_FORMAT,
    id: COLLAB_ONTOLOGY_ID,
    name: n('Fusion Collaboration Ontology', 'Онтологія співпраці Fusion'),
    entityTypes: ENTITY_ROWS.map(([id, en, uk, implemented, description]) => ({ id, name: n(en, uk), status: 'active' as const, implemented, description })),
    relationTypes: RELATION_ROWS.map(([id, en, uk, from, to]) => ({ id, name: n(en, uk), from, to, status: 'active' as const })),
    crossDomainRelations: CROSS_ROWS.map(([id, en, uk, from, to, example]) => ({ id, name: n(en, uk), from, to, status: 'active' as const, example })),
    roleCategories: opts(CATEGORY_ROWS),
    projectTypes: opts(PROJECT_TYPE_ROWS),
    entryIntents: opts(INTENT_ROWS),
    scopeTypes: opts(SCOPE_ROWS),
    capabilities: opts(CAPABILITY_ROWS),
    workspaces: WORKSPACE_ROWS.map(([id, en, uk, studioRole]) => ({ id, name: n(en, uk), studioRole })),
    roles: ROLE_ROWS.map(([id, en, uk, category, workspace, caps, extra], i) => ({
      id,
      label: n(en, uk),
      category,
      projectTypes: BOOKISH,
      defaultWorkspace: workspace,
      suggestedCapabilities: caps.split(' '),
      aiProfile: workspaceAi(workspace),
      status: 'active' as const,
      requiresSpecialization: false,
      specializations: [],
      singleHolder: false,
      combinable: true,
      invitable: false,
      legacyIds: [],
      order: i,
      ...(extra ?? {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Перевірка (VALIDATE)
// ---------------------------------------------------------------------------

const UPPER_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const SNAKE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

export interface CollabValidationContext {
  /** Активна онтологія твору — для міждоменних зв'язків (критерій v3 №49). */
  story: Pick<OntologyDefinition, 'entityTypes'>;
}

export function validateCollabOntology(def: CollabOntologyDefinition, ctx: CollabValidationContext): OntologyValidation {
  const errors: OntologyIssue[] = [];
  const warnings: OntologyIssue[] = [];
  const err = (code: string, path: string, message: string) => errors.push({ code, path, message });
  const warn = (code: string, path: string, message: string) => warnings.push({ code, path, message });
  if (!def || typeof def !== 'object') return { ok: false, errors: [{ code: 'bad_definition', path: '', message: 'Визначення має бути об\'єктом' }], warnings };
  if (def.format !== COLLAB_ONTOLOGY_FORMAT) err('bad_format', 'format', `Формат має бути «${COLLAB_ONTOLOGY_FORMAT}»`);
  if (!nonEmpty(def.id)) err('bad_id', 'id', 'Немає id онтології');
  const LISTS = ['entityTypes', 'relationTypes', 'crossDomainRelations', 'roleCategories', 'projectTypes', 'entryIntents', 'scopeTypes', 'capabilities', 'workspaces', 'roles'] as const;
  for (const k of LISTS) if (!Array.isArray(def[k])) err('bad_definition', k, `«${k}» має бути масивом`);
  if (errors.length) return { ok: false, errors, warnings };

  const names = (nm: LocalizedName | undefined, path: string) => {
    if (!nm || !nonEmpty(nm.uk)) err('missing_name', `${path}.uk`, 'Немає української назви (критерій Onboarding №25)');
    if (!nm || !nonEmpty(nm.en)) err('missing_name', `${path}.en`, 'Немає англійської назви (критерій Onboarding №25)');
  };
  const ids = <T extends { id: string }>(items: T[], what: string, re: RegExp) => {
    const seen = new Set<string>();
    for (const it of items) {
      if (!nonEmpty(it?.id) || !re.test(it.id)) err('bad_id', `${what}.${it?.id ?? '?'}`, `ID «${String(it?.id)}» не відповідає ${re}`);
      else if (seen.has(it.id)) err('duplicate_id', `${what}.${it.id}`, `ID «${it.id}» повторюється`);
      seen.add(it?.id);
    }
    return seen;
  };

  const types = ids(def.entityTypes, 'entityTypes', UPPER_RE);
  for (const t of def.entityTypes) {
    names(t.name, `entityTypes.${t.id}.name`);
    if (!['active', 'deprecated'].includes(t.status)) err('bad_status', `entityTypes.${t.id}.status`, `Невідомий статус «${t.status}»`);
  }
  for (const req of ['PERSON', 'PARTICIPANT', 'ROLE', 'BOOK_PROJECT']) if (!types.has(req)) err('missing_core_type', 'entityTypes', `Немає обов'язкового типу ${req}`);

  ids(def.relationTypes, 'relationTypes', UPPER_RE);
  for (const r of def.relationTypes) {
    names(r.name, `relationTypes.${r.id}.name`);
    for (const end of ['from', 'to'] as const) {
      if (!Array.isArray(r[end]) || !r[end].length) err('bad_endpoints', `relationTypes.${r.id}.${end}`, 'Кінці — непорожній список типів співпраці');
      else for (const ty of r[end]) if (!types.has(ty)) err('unknown_collab_type', `relationTypes.${r.id}.${end}`, `Типу співпраці «${ty}» немає`);
    }
  }

  // Міждоменні зв'язки: кваліфіковані посилання, від співпраці до твору, обидва кінці існують.
  const storyTypes = new Map(ctx.story.entityTypes.map((t) => [t.id, t]));
  ids(def.crossDomainRelations, 'crossDomainRelations', UPPER_RE);
  for (const r of def.crossDomainRelations) {
    const path = `crossDomainRelations.${r.id}`;
    names(r.name, `${path}.name`);
    if (types.has(r.id)) err('id_conflict', path, `ID «${r.id}» уже є типом співпраці`);
    for (const end of ['from', 'to'] as const) {
      if (!Array.isArray(r[end]) || !r[end].length) {
        err('bad_endpoints', `${path}.${end}`, 'Кінці — непорожній список посилань');
        continue;
      }
      for (const ref of r[end]) {
        const m = /^(story|collab):(.+)$/.exec(String(ref));
        if (!m) {
          err('unqualified_ref', `${path}.${end}`, `Посилання «${ref}» без домену — лише «story:…» чи «collab:…» (критерій v3 №32)`);
          continue;
        }
        const [, domain, id] = m;
        if (end === 'from' && domain !== 'collab') err('wrong_direction', `${path}.from`, `Початок міждоменного зв'язку — тип співпраці, а не «${ref}»`);
        if (end === 'to' && domain !== 'story') err('wrong_direction', `${path}.to`, `Кінець міждоменного зв'язку — тип твору, а не «${ref}»`);
        if (domain === 'collab' && !types.has(id)) err('unknown_collab_type', `${path}.${end}`, `Типу співпраці «${id}» немає`);
        if (domain === 'story') {
          const st = storyTypes.get(id);
          if (!st) err('unknown_story_type', `${path}.${end}`, `Типу твору «${id}» немає в активній онтології твору`);
          else if (st.status === 'deprecated') warn('deprecated_story_type', `${path}.${end}`, `Тип твору «${id}» застарілий`);
        }
      }
    }
  }

  const cats = ids(def.roleCategories, 'roleCategories', SNAKE_RE);
  const pts = ids(def.projectTypes, 'projectTypes', SNAKE_RE);
  ids(def.entryIntents, 'entryIntents', SNAKE_RE);
  ids(def.scopeTypes, 'scopeTypes', SNAKE_RE);
  const caps = ids(def.capabilities, 'capabilities', SNAKE_RE);
  const wss = ids(def.workspaces, 'workspaces', SNAKE_RE);
  for (const key of ['roleCategories', 'projectTypes', 'entryIntents', 'scopeTypes', 'capabilities', 'workspaces'] as const) for (const o of def[key]) names(o.name, `${key}.${o.id}.name`);
  for (const w of def.workspaces) if (!['writer', 'designer', 'publisher', 'translator', 'reader'].includes(w.studioRole)) err('bad_workspace', `workspaces.${w.id}.studioRole`, `Невідомий простір Студії «${w.studioRole}»`);
  for (const p of ['book', 'course']) if (!pts.has(p)) err('missing_project_type', 'projectTypes', `Мінімум — книга й курс (критерій Onboarding №3): немає «${p}»`);

  const roles = ids(def.roles, 'roles', SNAKE_RE);
  const legacySeen = new Map<string, string>();
  for (const r of def.roles) {
    const path = `roles.${r.id}`;
    names(r.label, `${path}.label`);
    if (!cats.has(r.category)) err('unknown_category', `${path}.category`, `Категорії «${r.category}» немає`);
    if (!wss.has(r.defaultWorkspace)) err('unknown_workspace', `${path}.defaultWorkspace`, `Простору «${r.defaultWorkspace}» немає`);
    if (!Array.isArray(r.projectTypes) || !r.projectTypes.length) err('bad_project_types', `${path}.projectTypes`, 'Роль має хоч один тип проєкту');
    else for (const p of r.projectTypes) if (!pts.has(p)) err('unknown_project_type', `${path}.projectTypes`, `Типу проєкту «${p}» немає`);
    if (!Array.isArray(r.suggestedCapabilities)) err('bad_capabilities', `${path}.suggestedCapabilities`, 'Можливості — масив');
    else for (const c of r.suggestedCapabilities) if (!caps.has(c)) err('unknown_capability', `${path}.suggestedCapabilities`, `Можливості «${c}» немає`);
    if (!nonEmpty(r.aiProfile)) err('bad_ai_profile', `${path}.aiProfile`, 'Немає AI-профілю');
    if (r.description !== undefined) names(r.description, `${path}.description`);
    if (!['active', 'deprecated'].includes(r.status)) err('bad_status', `${path}.status`, `Невідомий статус «${r.status}»`);
    if (r.requiresSpecialization && (!Array.isArray(r.specializations) || !r.specializations.length)) err('no_specializations', `${path}.specializations`, 'Роль вимагає спеціалізації, але дозволених немає');
    for (const s of r.specializations ?? []) {
      if (!roles.has(s) && !def.roles.some((x) => x.id === s)) err('unknown_role', `${path}.specializations`, `Ролі-спеціалізації «${s}» немає`);
      const target = def.roles.find((x) => x.id === s);
      if (target?.requiresSpecialization) err('nested_specialization', `${path}.specializations`, `«${s}» сама вимагає спеціалізації`);
    }
    if (r.singleHolder && r.invitable) warn('single_holder_invitable', path, 'Роль з одним власником запрошується — новий учасник її не отримає, поки є чинний');
    for (const l of r.legacyIds ?? []) {
      if (legacySeen.has(l)) err('legacy_conflict', `${path}.legacyIds`, `Старе значення «${l}» уже веде на «${legacySeen.get(l)}»`);
      legacySeen.set(l, r.id);
      if (roles.has(l) && l !== r.id) err('legacy_conflict', `${path}.legacyIds`, `Старе значення «${l}» збігається з id іншої ролі`);
    }
  }
  if (!def.roles.some((r) => r.singleHolder && r.status === 'active')) err('no_owner_role', 'roles', 'Немає ролі власника проєкту (singleHolder)');
  if (!def.roles.some((r) => r.invitable && r.status === 'active')) warn('no_invitable_roles', 'roles', 'Жодної ролі не можна запросити');
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Різниця версій і посилання на типи твору
// ---------------------------------------------------------------------------

export interface CollabDiff {
  roles: { added: string[]; removed: string[]; changed: { id: string; fields: string[] }[]; deprecated: string[] };
  crossDomainRelations: { added: string[]; removed: string[]; changed: string[] };
  entityTypes: { added: string[]; removed: string[] };
  other: string[];
  changed: boolean;
}

const ROLE_FIELDS: (keyof RoleDefinition)[] = ['label', 'category', 'projectTypes', 'defaultWorkspace', 'suggestedCapabilities', 'aiProfile', 'status', 'requiresSpecialization', 'specializations', 'singleHolder', 'combinable', 'invitable', 'legacyIds', 'order', 'description'];

export function diffCollabOntologies(before: CollabOntologyDefinition, after: CollabOntologyDefinition): CollabDiff {
  const map = <T extends { id: string }>(l: T[]) => new Map(l.map((x) => [x.id, x]));
  const rb = map(before.roles);
  const ra = map(after.roles);
  const roles: CollabDiff['roles'] = {
    added: after.roles.filter((r) => !rb.has(r.id)).map((r) => r.id),
    removed: before.roles.filter((r) => !ra.has(r.id)).map((r) => r.id),
    changed: [],
    deprecated: [],
  };
  for (const [id, r] of ra) {
    const old = rb.get(id);
    if (!old) continue;
    const fields = ROLE_FIELDS.filter((f) => canonicalJson(old[f]) !== canonicalJson(r[f])) as string[];
    if (fields.length) roles.changed.push({ id, fields });
    if (old.status === 'active' && r.status === 'deprecated') roles.deprecated.push(id);
  }
  const cb = map(before.crossDomainRelations);
  const ca = map(after.crossDomainRelations);
  const crossDomainRelations = {
    added: after.crossDomainRelations.filter((r) => !cb.has(r.id)).map((r) => r.id),
    removed: before.crossDomainRelations.filter((r) => !ca.has(r.id)).map((r) => r.id),
    changed: after.crossDomainRelations.filter((r) => cb.has(r.id) && canonicalJson(cb.get(r.id)) !== canonicalJson(r)).map((r) => r.id),
  };
  const eb = new Set(before.entityTypes.map((t) => t.id));
  const ea = new Set(after.entityTypes.map((t) => t.id));
  const entityTypes = { added: [...ea].filter((x) => !eb.has(x)), removed: [...eb].filter((x) => !ea.has(x)) };
  const other = (['name', 'relationTypes', 'roleCategories', 'projectTypes', 'entryIntents', 'scopeTypes', 'capabilities', 'workspaces'] as const).filter((k) => canonicalJson(before[k]) !== canonicalJson(after[k]));
  const changed = other.length > 0 || roles.added.length + roles.removed.length + roles.changed.length > 0 || crossDomainRelations.added.length + crossDomainRelations.removed.length + crossDomainRelations.changed.length > 0 || entityTypes.added.length + entityTypes.removed.length > 0;
  return { roles, crossDomainRelations, entityTypes, other, changed };
}

/** Які типи твору використовують активні міждоменні зв'язки — їх не можна вилучити з онтології твору. */
export function storyTypesReferenced(def: CollabOntologyDefinition): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of def.crossDomainRelations) {
    if (r.status !== 'active') continue;
    for (const ref of r.to) {
      const m = /^story:(.+)$/.exec(ref);
      if (m) out.set(m[1], [...(out.get(m[1]) ?? []), r.id]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Реєстр ролей під час роботи
// ---------------------------------------------------------------------------

let ACTIVE: CollabOntologyDefinition = factoryCollabOntology();
let ACTIVE_LABEL = 'factory';

/** Застосувати активну версію онтології співпраці (сервер — на старті ядра й після публікації; клієнт — після завантаження). */
export function applyCollabOntology(def: CollabOntologyDefinition, label = 'custom'): void {
  ACTIVE = JSON.parse(JSON.stringify(def));
  ACTIVE_LABEL = label;
}

export function resetCollabOntology(): void {
  ACTIVE = factoryCollabOntology();
  ACTIVE_LABEL = 'factory';
}

export function activeCollabOntology(): CollabOntologyDefinition {
  return ACTIVE;
}

export function activeCollabLabel(): string {
  return ACTIVE_LABEL;
}

/** Роль за id або старим значенням (`reader` → `beta_reader`). */
export function roleById(idOrLegacy: string): RoleDefinition | undefined {
  const key = String(idOrLegacy ?? '').trim();
  return ACTIVE.roles.find((r) => r.id === key) ?? ACTIVE.roles.find((r) => r.legacyIds.includes(key));
}

/** Активні ролі, які можна запросити — у порядку реєстру. */
export function invitableRoles(): RoleDefinition[] {
  return ACTIVE.roles.filter((r) => r.invitable && r.status === 'active').sort((a, b) => a.order - b.order);
}

/** Робочий простір Студії для ролі (поки Т6.4 не дасть простір за роллю): `designer`, `reader`… */
export function studioRoleFor(idOrLegacy: string): CollabWorkspace['studioRole'] | null {
  const r = roleById(idOrLegacy);
  if (!r) return null;
  return ACTIVE.workspaces.find((w) => w.id === r.defaultWorkspace)?.studioRole ?? null;
}

/** Старе значення ролі (запрошення, project_members) → id реєстру. */
export function canonicalRoleId(idOrLegacy: string): string | null {
  return roleById(idOrLegacy)?.id ?? null;
}
