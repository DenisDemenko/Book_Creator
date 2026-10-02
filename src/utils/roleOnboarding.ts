/**
 * Опитувальник ролі (Role Onboarding, Т6.3, `PLAN_ROLE_ONBOARDING.md`; ТЗ
 * Role Onboarding v3.1 §5–12, §19, §24). Спільний для сервера й клієнта:
 * кроки, набори параметрів ролі й допомоги ШІ, перевірка відповідей за
 * реєстром ролей і перетворення «область + можливості» на наданий доступ
 * Т6.2. Ролі, типи проєктів, мети, області й можливості — з реєстру
 * (`fusion-collab`), тут лише те, чого в реєстрі немає (§8, §11).
 *
 * Роль ≠ дозвіл (§19): можливості — це ЗАПИТ; доступ дає лише рішення
 * власника (чи власне володіння проєктом). Допомога ШІ налаштовує профіль ШІ
 * й ніколи не розширює доступ (§11).
 */

import type { CollabOntologyDefinition, RoleDefinition } from './collabOntology';
import type { LocalizedName } from './ontology';

export const ONBOARDING_STEPS = [
  { id: 1, key: 'projectType', name: { en: 'Project type', uk: 'Тип проєкту' } },
  { id: 2, key: 'entryIntent', name: { en: 'Entry intent', uk: 'Мета входу' } },
  { id: 3, key: 'roles', name: { en: 'Role', uk: 'Роль' } },
  { id: 4, key: 'roleDetails', name: { en: 'Role details', uk: 'Параметри ролі' } },
  { id: 5, key: 'scope', name: { en: 'Work scope', uk: 'Область роботи' } },
  { id: 6, key: 'capabilities', name: { en: 'Capabilities', uk: 'Можливості' } },
  { id: 7, key: 'aiAssistance', name: { en: 'AI assistance', uk: 'Допомога ШІ' } },
  { id: 8, key: 'confirm', name: { en: 'Summary', uk: 'Підсумок' } },
] as const;

export interface OnboardingRoleChoice {
  roleId: string;
  specialization?: string | null;
}

export interface OnboardingAnswers {
  projectType?: string;
  entryIntent?: string;
  roles?: OnboardingRoleChoice[];
  /** «Інша роль» — текст людини (§26); роль із реєстру все одно потрібна. */
  otherRole?: string;
  /** Параметри ролі (§8): група → обрані пункти. */
  roleDetails?: Record<string, string[]>;
  scope?: string;
  /** Цілі області: id розділів, сцен, персонажів. */
  scopeRefs?: string[];
  capabilities?: string[];
  aiAssistance?: string[];
  /** Повідомлення власнику до запиту доступу. */
  message?: string;
}

type Opt = { id: string; name: LocalizedName };
const o = (id: string, en: string, uk: string): Opt => ({ id, name: { en, uk } });

/** Параметри ролі (§8) — за простором ролі з реєстру. */
export const ROLE_DETAIL_SETS: Record<string, { name: LocalizedName; options: Opt[] }> = {
  author: { name: { en: 'Author', uk: 'Автор' }, options: [o('whole_book', 'Whole book', 'Уся книга'), o('chapters', 'Chapters', 'Розділи'), o('scenes', 'Scenes', 'Сцени'), o('characters', 'Characters', 'Персонажі'), o('story_structure', 'Story structure', 'Структура історії')] },
  illustrator: { name: { en: 'Illustrator', uk: 'Ілюстратор' }, options: [o('character_illustrations', 'Character illustrations', 'Ілюстрації персонажів'), o('scene_illustrations', 'Scene illustrations', 'Ілюстрації сцен'), o('maps', 'Maps', 'Карти'), o('diagrams', 'Diagrams', 'Схеми'), o('cover_art', 'Cover art', 'Зображення для обкладинки')] },
  designer: { name: { en: 'Designer', uk: 'Дизайнер' }, options: [o('cover', 'Cover', 'Обкладинка'), o('book_layout', 'Book layout', 'Дизайн / верстка'), o('visual_identity', 'Visual identity', 'Візуальна айдентика'), o('promotional_materials', 'Promotional materials', 'Рекламні матеріали'), o('course_design', 'Course design', 'Дизайн курсу')] },
  manager: { name: { en: 'Manager', uk: 'Менеджер' }, options: [o('publication', 'Publication', 'Публікація'), o('sales', 'Sales', 'Продажі'), o('marketing', 'Marketing', 'Маркетинг'), o('marketplace_listings', 'Marketplace listings', 'Картки товарів'), o('team_coordination', 'Team coordination', 'Координація команди')] },
  developer: { name: { en: 'Developer', uk: 'Розробник' }, options: [o('web', 'Web', 'Веб'), o('integration', 'Integration', 'Інтеграції'), o('ai', 'AI', 'ШІ'), o('automation', 'Automation', 'Автоматизація'), o('interactive_content', 'Interactive content', 'Інтерактивний контент')] },
};
const DETAIL_BY_WORKSPACE: Record<string, string> = { author: 'author', illustrator: 'illustrator', designer: 'designer', manager: 'manager', developer: 'developer' };

/** Допомога ШІ (§11) — за простором ролі. */
export const AI_ASSIST_SETS: Record<string, { name: LocalizedName; options: Opt[] }> = {
  author: { name: { en: 'Author', uk: 'Автор' }, options: [o('story_analysis', 'Story analysis', 'Аналіз історії'), o('character_analysis', 'Character analysis', 'Аналіз персонажів'), o('continuity_check', 'Continuity check', 'Перевірка безперервності'), o('editing_suggestions', 'Editing suggestions', 'Пропозиції редагування'), o('idea_generation', 'Idea generation', 'Генерація ідей')] },
  illustrator: { name: { en: 'Illustrator', uk: 'Ілюстратор' }, options: [o('scene_context', 'Scene context', 'Контекст сцени'), o('character_references', 'Character references', 'Референси персонажів'), o('visual_bible', 'Visual bible', 'Візуальна біблія'), o('prompt_assistance', 'Prompt assistance', 'Допомога з промптами')] },
  manager: { name: { en: 'Manager', uk: 'Менеджер' }, options: [o('book_metadata', 'Book metadata', 'Метадані книги'), o('product_description', 'Product description', 'Опис товару'), o('marketing_copy', 'Marketing copy', 'Маркетинговий текст'), o('publication_checklist', 'Publication checklist', 'Чекліст публікації')] },
};
const AI_BY_WORKSPACE: Record<string, string> = { author: 'author', editor: 'author', reviewer: 'author', illustrator: 'illustrator', designer: 'illustrator', manager: 'manager' };

/** Роль на першому екрані (§27): короткий список; решта — пошуком. */
export const FIRST_SCREEN_ROLES = ['author', 'co_author', 'designer', 'illustrator', 'editor', 'translator', 'sales_manager', 'developer', 'freelancer'];

/** Мети, що означають роботу в ЧУЖОМУ проєкті (потрібен запит доступу). */
export const JOIN_INTENTS = ['join_existing_project', 'accept_invitation', 'fulfill_freelance_order', 'manage_or_sell', 'review_or_edit'];

/** Області, які вже застосовуються наданим доступом Т6.2 (решта — у моделі до Т7). */
export const SCOPE_TO_ACCESS: Record<string, { scopeType: 'book' | 'chapter' | 'scene' | 'character' | 'media_library'; refs: boolean } | null> = {
  whole_project: { scopeType: 'book', refs: false },
  selected_book: { scopeType: 'book', refs: false },
  selected_course: { scopeType: 'book', refs: false },
  selected_chapters: { scopeType: 'chapter', refs: true },
  selected_scenes: { scopeType: 'scene', refs: true },
  selected_characters: { scopeType: 'character', refs: true },
  media_library: { scopeType: 'media_library', refs: false },
  visual_bible: null,
  marketing_data: null,
  assigned_tasks_only: null,
};
/** Для курсу розділи, сцени й персонажі не мають сенсу — лише курс і медіатека. */
const COURSE_SCOPES = ['whole_project', 'selected_course', 'media_library'];
const BOOK_ONLY_SCOPES = ['selected_book', 'selected_chapters', 'selected_scenes', 'selected_characters'];

export function scopeAvailable(scope: string, projectType: string | undefined): boolean {
  if (!SCOPE_TO_ACCESS[scope]) return false;
  if (projectType === 'course') return COURSE_SCOPES.includes(scope);
  if (scope === 'selected_course') return false;
  return projectType === 'book' || !BOOK_ONLY_SCOPES.includes(scope) || projectType === undefined;
}

/** Ранги можливостей як рівнів доступу Т6.2 (upload — окремо: робочий доступ до медіатеки). */
const CAP_LEVEL: Record<string, { level: 'view' | 'comment' | 'review' | 'edit' | 'create' | 'approve' | 'manage'; rank: number }> = {
  view: { level: 'view', rank: 1 },
  comment: { level: 'comment', rank: 2 },
  review: { level: 'review', rank: 3 },
  propose: { level: 'review', rank: 3 },
  edit: { level: 'edit', rank: 4 },
  create: { level: 'create', rank: 5 },
  approve: { level: 'approve', rank: 6 },
  publish: { level: 'approve', rank: 6 },
  manage: { level: 'manage', rank: 7 },
};

export interface RequestedAccess {
  /** Рівень запиту (керування запитом не видається — найвище «схвалення»). */
  level: 'view' | 'comment' | 'review' | 'edit' | 'create' | 'approve' | 'work';
  scopeType: 'book' | 'chapter' | 'scene' | 'character' | 'media_library';
  refs: string[];
  /** Окремо — робоча медіатека, якщо попросили «завантаження». */
  mediaWork: boolean;
  /** Попросили керування — власник надає його окремо. */
  manageRequested: boolean;
}

/** Область + можливості → що саме попросити в Т6.2 (null — область ще не застосовується). */
export function requestedAccess(scope: string, refs: string[], capabilities: string[]): RequestedAccess | null {
  const target = SCOPE_TO_ACCESS[scope];
  if (!target) return null;
  let best: RequestedAccess['level'] = 'view';
  let rank = 1;
  for (const c of capabilities) {
    const m = CAP_LEVEL[c];
    if (!m) continue;
    const r = Math.min(m.rank, 6);
    if (r > rank) {
      rank = r;
      best = (m.level === 'manage' ? 'approve' : m.level) as RequestedAccess['level'];
    }
  }
  const upload = capabilities.includes('upload');
  if (target.scopeType === 'media_library') {
    return { level: upload || rank >= 4 ? 'work' : 'view', scopeType: 'media_library', refs: [], mediaWork: false, manageRequested: capabilities.includes('manage') };
  }
  return { level: best, scopeType: target.scopeType, refs: target.refs ? refs : [], mediaWork: upload, manageRequested: capabilities.includes('manage') };
}

/** Шаблон можливостей за обраними ролями (§19: пропонує, а не дозволяє). */
export function suggestedCapabilities(reg: CollabOntologyDefinition, roles: OnboardingRoleChoice[]): string[] {
  const out = new Set<string>();
  for (const c of roles) {
    const r = findRole(reg, c.roleId);
    r?.suggestedCapabilities.forEach((x) => out.add(x));
  }
  return reg.capabilities.map((c) => c.id).filter((id) => out.has(id));
}

export function findRole(reg: CollabOntologyDefinition, idOrLegacy: string): RoleDefinition | undefined {
  return reg.roles.find((r) => r.id === idOrLegacy) ?? reg.roles.find((r) => r.legacyIds.includes(idOrLegacy));
}

/** Групи параметрів ролі (§8), релевантні обраним ролям. */
export function detailGroupsFor(reg: CollabOntologyDefinition, roles: OnboardingRoleChoice[]): string[] {
  const out: string[] = [];
  for (const c of roles) {
    const r = findRole(reg, c.roleId);
    const ws = c.specialization ? findRole(reg, c.specialization)?.defaultWorkspace : r?.defaultWorkspace;
    const g = ws ? DETAIL_BY_WORKSPACE[ws] : undefined;
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/** Набори допомоги ШІ (§11), релевантні обраним ролям. */
export function aiGroupsFor(reg: CollabOntologyDefinition, roles: OnboardingRoleChoice[]): string[] {
  const out: string[] = [];
  for (const c of roles) {
    const r = findRole(reg, c.roleId);
    const ws = c.specialization ? findRole(reg, c.specialization)?.defaultWorkspace : r?.defaultWorkspace;
    const g = ws ? AI_BY_WORKSPACE[ws] : undefined;
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/** Головний простір і профіль ШІ — за першою роллю (Т6.4 використає їх для робочого простору). */
export function primaryWorkspace(reg: CollabOntologyDefinition, roles: OnboardingRoleChoice[]): { workspace: string | null; aiProfile: string | null } {
  const first = roles[0];
  if (!first) return { workspace: null, aiProfile: null };
  const r = findRole(reg, first.specialization || first.roleId) ?? findRole(reg, first.roleId);
  return { workspace: r?.defaultWorkspace ?? null, aiProfile: r?.aiProfile ?? null };
}

export interface AnswerIssue {
  step: number;
  field: string;
  code: string;
  message: LocalizedName;
}

const issue = (step: number, field: string, code: string, en: string, uk: string): AnswerIssue => ({ step, field, code, message: { en, uk } });

/**
 * Перевірити відповіді за реєстром. `upTo` — до якого кроку перевіряти
 * (збереження кроку); без нього — усе, як перед завершенням. `joining` —
 * робота в чужому проєкті: потрібні область і можливості.
 */
export function validateAnswers(reg: CollabOntologyDefinition, a: OnboardingAnswers, opts: { upTo?: number; joining?: boolean; projectType?: string } = {}): AnswerIssue[] {
  const upTo = opts.upTo ?? 8;
  const out: AnswerIssue[] = [];
  const pt = a.projectType ?? opts.projectType;
  if (upTo >= 1) {
    if (!pt) out.push(issue(1, 'projectType', 'required', 'Choose what you will work on', 'Оберіть, над чим працюватимете'));
    else if (!reg.projectTypes.some((p) => p.id === pt)) out.push(issue(1, 'projectType', 'unknown', `Unknown project type «${pt}»`, `Невідомий тип проєкту «${pt}»`));
  }
  if (upTo >= 2) {
    if (!a.entryIntent) out.push(issue(2, 'entryIntent', 'required', 'Choose how you are joining', 'Оберіть, як ви долучаєтесь'));
    else if (!reg.entryIntents.some((p) => p.id === a.entryIntent)) out.push(issue(2, 'entryIntent', 'unknown', `Unknown intent «${a.entryIntent}»`, `Невідома мета «${a.entryIntent}»`));
  }
  if (upTo >= 3) {
    const roles = a.roles ?? [];
    if (!roles.length) out.push(issue(3, 'roles', 'required', 'Choose at least one role', 'Оберіть хоча б одну роль'));
    if (roles.length > 10) out.push(issue(3, 'roles', 'too_many', 'Up to 10 roles', 'До 10 ролей'));
    const seen = new Set<string>();
    for (const c of roles) {
      const r = findRole(reg, c.roleId);
      if (!r) {
        out.push(issue(3, 'roles', 'unknown_role', `No role «${c.roleId}» in the registry`, `Ролі «${c.roleId}» немає в реєстрі`));
        continue;
      }
      if (seen.has(r.id)) out.push(issue(3, 'roles', 'duplicate', `Role «${r.label.en}» chosen twice`, `Роль «${r.label.uk}» обрано двічі`));
      seen.add(r.id);
      if (r.status !== 'active') out.push(issue(3, 'roles', 'deprecated', `Role «${r.label.en}» is deprecated`, `Роль «${r.label.uk}» застаріла`));
      if (pt && !r.projectTypes.includes(pt)) out.push(issue(3, 'roles', 'project_type', `«${r.label.en}» is not for this project type`, `«${r.label.uk}» — не для цього типу проєкту`));
      if (r.requiresSpecialization) {
        if (!c.specialization) out.push(issue(3, 'roles', 'specialization_required', `«${r.label.en}» needs a specialization`, `«${r.label.uk}» потребує спеціалізації`));
        else if (!r.specializations.includes(c.specialization)) out.push(issue(3, 'roles', 'bad_specialization', `Specialization «${c.specialization}» is not allowed`, `Спеціалізація «${c.specialization}» не дозволена`));
      } else if (c.specialization) {
        out.push(issue(3, 'roles', 'no_specialization', `«${r.label.en}» has no specializations`, `«${r.label.uk}» не має спеціалізацій`));
      }
      if (!r.combinable && roles.length > 1) out.push(issue(3, 'roles', 'not_combinable', `«${r.label.en}» cannot be combined`, `«${r.label.uk}» не поєднується з іншими ролями`));
    }
    if (a.otherRole !== undefined && String(a.otherRole).length > 200) out.push(issue(3, 'otherRole', 'too_long', 'Other role — up to 200 characters', '«Інша роль» — до 200 символів'));
  }
  if (upTo >= 4 && a.roleDetails) {
    for (const [g, items] of Object.entries(a.roleDetails)) {
      const set = ROLE_DETAIL_SETS[g];
      if (!set) out.push(issue(4, 'roleDetails', 'unknown_group', `Unknown details group «${g}»`, `Невідома група параметрів «${g}»`));
      else for (const it of items ?? []) if (!set.options.some((x) => x.id === it)) out.push(issue(4, 'roleDetails', 'unknown_option', `Unknown option «${it}»`, `Невідомий параметр «${it}»`));
    }
  }
  if (upTo >= 5 && opts.joining) {
    if (!a.scope) out.push(issue(5, 'scope', 'required', 'Choose the work scope', 'Оберіть область роботи'));
    else if (!reg.scopeTypes.some((s) => s.id === a.scope)) out.push(issue(5, 'scope', 'unknown', `Unknown scope «${a.scope}»`, `Невідома область «${a.scope}»`));
    else if (!scopeAvailable(a.scope, pt)) out.push(issue(5, 'scope', 'unavailable', 'This scope is not available yet — choose another', 'Ця область поки недоступна — оберіть іншу'));
    else if (SCOPE_TO_ACCESS[a.scope]?.refs && !(a.scopeRefs ?? []).length) out.push(issue(5, 'scopeRefs', 'required', 'Choose what exactly', 'Оберіть, що саме'));
  }
  if (upTo >= 6 && opts.joining) {
    const caps = a.capabilities ?? [];
    if (!caps.length) out.push(issue(6, 'capabilities', 'required', 'Choose at least one capability', 'Оберіть хоча б одну можливість'));
    for (const c of caps) if (!reg.capabilities.some((x) => x.id === c)) out.push(issue(6, 'capabilities', 'unknown', `Unknown capability «${c}»`, `Невідома можливість «${c}»`));
  }
  if (upTo >= 7 && a.aiAssistance) {
    const allowed = new Set(Object.values(AI_ASSIST_SETS).flatMap((s) => s.options.map((x) => x.id)));
    for (const x of a.aiAssistance) if (!allowed.has(x)) out.push(issue(7, 'aiAssistance', 'unknown', `Unknown AI option «${x}»`, `Невідомий пункт допомоги ШІ «${x}»`));
  }
  return out;
}
