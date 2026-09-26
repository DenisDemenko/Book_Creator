/**
 * Генерація зображення від сутності книги (Т2.3 В6, PLAN_VISUAL_LIBRARY.md) —
 * лише за командою автора, автоматичної генерації немає ніде.
 *
 *   • Ціль — сутність із виглядом (герой, локація, предмет…), для героя —
 *     ще й версія зовнішності (лише затверджена) і роль: портрет, повний
 *     зріст, референс.
 *   • Промпт будується із затвердженого опису: опис версії зовнішності, а
 *     без версії — опис зовнішності з картки героя (канон автора). Автор
 *     бачить промпт і може його правити перед генерацією.
 *   • Референси (для схожості) — уже прив'язані підтверджені зображення
 *     цієї сутності: портрет, повний зріст, референс тієї ж версії, далі
 *     загальні. Портрети інших версій (інший вік) і зображення з позначкою
 *     «перевірити» (не відповідають поточному опису) — ні.
 *   • Результат одразу прив'язаний до сутності: джерело зв'язку — автор
 *     (генерацію запустив він), у паспорті файлу — `ai` з моделлю й
 *     промптом. Звірено з тим описом, з якого генерували; якщо опис за
 *     час генерації змінився — одразу «перевірити» (В5).
 */

import type { AppearanceVersionRow, AssetLinkRow, AssetRole, CoreRepository, EntityRow } from './types';
import { CoreRuleError, VERSIONED_ROLES } from './rules';
import { cardAppearanceHash, ROLE_ENTITY_TYPES } from './visual';
import { VISUAL_ENTITY_TYPES } from './visualAi';

/** Ролі, в яких можна згенерувати зображення сутності (сцена — не сутність). */
export const GENERATION_ROLES: readonly AssetRole[] = ['portrait', 'full_body', 'reference', 'depicts', 'location', 'object'];
/** Скільки прив'язаних зображень іде референсами (більше рідко допомагає й не всі моделі приймають). */
export const GENERATION_MAX_REFERENCES = 4;
/** Межа довжини промпту (як у паспорті файлу Медіатеки). */
export const GENERATION_MAX_PROMPT = 4000;

const MEDIA_FILE_RE = /^\/api\/media\/file\/[A-Za-z0-9_-]+$/;
/** Референсом може бути лише файл Медіатеки: сервер сам читає його байти з перевіркою власника. */
export const isMediaFileUrl = (url: unknown): url is string => typeof url === 'string' && MEDIA_FILE_RE.test(url.trim());

/** Роль за замовчуванням: герой — портрет, локація — локація, предмет — предмет, решта — «зображено». */
export function defaultGenerationRole(type: string): AssetRole {
  if (type === 'character') return 'portrait';
  if ((ROLE_ENTITY_TYPES.location ?? []).includes(type)) return 'location';
  if ((ROLE_ENTITY_TYPES.object ?? []).includes(type)) return 'object';
  return 'depicts';
}

export interface GenerationTargetInput {
  entityId?: unknown;
  appearanceVersionId?: unknown;
  role?: unknown;
}

export interface GenerationTarget {
  projectId: string;
  entity: EntityRow;
  version: AppearanceVersionRow | null;
  role: AssetRole;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Перевірити ціль генерації: сутність книги з виглядом, роль для її типу, затверджена версія цього героя. */
export async function resolveGenerationTarget(repo: CoreRepository, projectId: string, input: GenerationTargetInput): Promise<GenerationTarget> {
  const entity = str(input.entityId) ? await repo.getEntity(projectId, str(input.entityId)) : null;
  if (!entity || entity.status === 'rejected') throw new CoreRuleError('not_found', 'Сутність не знайдено в книзі.');
  if (!VISUAL_ENTITY_TYPES.includes(entity.type)) {
    throw new CoreRuleError('bad_input', `«${entity.name}» (${entity.type}) не має вигляду — згенерувати зображення можна для героя, локації, предмета, групи чи символу.`);
  }
  const role = (str(input.role) || defaultGenerationRole(entity.type)) as AssetRole;
  if (!GENERATION_ROLES.includes(role)) throw new CoreRuleError('bad_input', `Роль «${role}» для генерації не підходить.`);
  const types = ROLE_ENTITY_TYPES[role as Exclude<AssetRole, 'scene'>];
  if (types && !types.includes(entity.type)) {
    throw new CoreRuleError('bad_input', `Роль «${role}» — для сутностей типу ${types.join(' / ')}, а «${entity.name}» — ${entity.type}.`);
  }
  let version: AppearanceVersionRow | null = null;
  if (str(input.appearanceVersionId)) {
    version = await repo.getAppearanceVersion(projectId, str(input.appearanceVersionId));
    if (!version || version.entityId !== entity.id) throw new CoreRuleError('not_found', 'Версії зовнішності цього героя немає.');
    if (!VERSIONED_ROLES.includes(role)) throw new CoreRuleError('bad_input', 'Версія зовнішності — лише для портрета, повного зросту чи референсу.');
    if (!version.approved) throw new CoreRuleError('bad_input', `Версія «${version.label}» ще не затверджена — генерувати можна лише з затвердженого опису.`);
  }
  return { projectId, entity, version, role };
}

/** Затверджений опис, з якого генерувати: версії — її опис; героя без версії — опис з картки; решти — порожньо. */
export function generationDescription(target: GenerationTarget, cardText: string | null | undefined): string {
  if (target.version) return target.version.description.trim();
  if (target.entity.type === 'character' && VERSIONED_ROLES.includes(target.role)) return String(cardText ?? '').trim();
  return '';
}

/**
 * Відбиток опису, з яким звірятиметься результат (Т2.3 В5): версія — її
 * відбиток, картка — відбиток опису картки. undefined — роль не про
 * зовнішність героя («зображено», локація, предмет).
 */
export function generationHash(target: GenerationTarget, cardText: string | null | undefined): string | undefined {
  if (target.entity.type !== 'character' || !VERSIONED_ROLES.includes(target.role)) return undefined;
  return target.version ? target.version.descriptionHash : cardAppearanceHash(cardText ?? '');
}

const ROLE_PROMPT: Record<string, string> = {
  portrait: 'Портрет персонажа',
  full_body: 'Персонаж у повний зріст',
  reference: 'Референс-аркуш персонажа: кілька ракурсів, нейтральне тло',
  depicts: 'Ілюстрація',
  location: 'Локація',
  object: 'Предмет',
};
const TYPE_PROMPT: Record<string, string> = {
  character: 'персонаж',
  group: 'група',
  location: 'локація',
  world: 'світ',
  object: 'предмет',
  item: 'предмет',
  artifact: 'артефакт',
  weapon: 'зброя',
  vehicle: 'транспорт',
  symbol: 'символ',
  tool: 'інструмент',
};

const sentence = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');

/** Промпт генерації — лише з назви, ролі, версії й затвердженого опису; автор може його правити. */
export function generationPrompt(target: GenerationTarget, description: string, withReferences: boolean): string {
  const { entity, version, role } = target;
  const who = role === 'reference' && entity.type !== 'character' ? `Референс: ${TYPE_PROMPT[entity.type] ?? entity.type}` : ROLE_PROMPT[role] ?? 'Ілюстрація';
  const lines = [
    `${who} «${entity.name}»${version ? ` — ${version.label}${version.age ? ` (вік: ${version.age})` : ''}` : ''}.`,
  ];
  if (description) lines.push(`${entity.type === 'character' ? 'Зовнішність' : 'Опис'}: ${sentence(description)}.`);
  if (withReferences) lines.push(entity.type === 'character' ? 'Той самий персонаж, що на референсних зображеннях: збережи схожість обличчя й рис.' : 'Той самий об\'єкт, що на референсних зображеннях.');
  return lines.join('\n');
}

const REF_ROLE_RANK: Record<string, number> = { portrait: 0, full_body: 1, reference: 2, location: 3, object: 3, depicts: 4 };
const SOURCE_RANK: Record<AssetLinkRow['source'], number> = { author: 0, ai: 1, legacy: 2 };

/**
 * Референси для схожості: підтверджені зображення цієї сутності з Медіатеки.
 * Для героя — портрет, повний зріст, референс (сцени «зображено» — ні); спершу
 * тієї ж версії зовнішності, далі загальні; інших версій — ні. Позначені
 * «перевірити» — ні (не відповідають затвердженому опису).
 */
export function pickGenerationReferences(links: AssetLinkRow[], target: GenerationTarget, max = GENERATION_MAX_REFERENCES): AssetLinkRow[] {
  const isHero = target.entity.type === 'character';
  const versionId = target.version?.id ?? null;
  const seen = new Set<string>();
  return links
    .filter((l) => l.entityId === target.entity.id && l.status === 'confirmed' && !l.needsReview && isMediaFileUrl(l.assetUrl))
    .filter((l) => (isHero ? VERSIONED_ROLES.includes(l.role) : l.role in REF_ROLE_RANK))
    .filter((l) => !l.appearanceVersionId || l.appearanceVersionId === versionId)
    .sort(
      (a, b) =>
        Number(b.appearanceVersionId === versionId && !!versionId) - Number(a.appearanceVersionId === versionId && !!versionId) ||
        (REF_ROLE_RANK[a.role] ?? 9) - (REF_ROLE_RANK[b.role] ?? 9) ||
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .filter((l) => (seen.has(l.assetUrl) ? false : (seen.add(l.assetUrl), true)))
    .slice(0, Math.max(0, max));
}

export interface GenerationBrief {
  entity: { id: string; name: string; type: string };
  version: { id: string; label: string; age: string } | null;
  role: AssetRole;
  /** Ролі, доступні для цієї сутності. */
  roles: AssetRole[];
  description: string;
  /** Героєві бракує опису зовнішності — промпт вийде загальним. */
  missingDescription: boolean;
  prompt: string;
  references: { linkId: string; assetUrl: string; role: AssetRole; versionLabel: string | null }[];
  maxReferences: number;
}

/** Ролі генерації, дозволені для типу сутності (версія — лише портрет, повний зріст, референс). */
export function generationRolesFor(type: string, withVersion: boolean): AssetRole[] {
  return GENERATION_ROLES.filter((r) => {
    if (withVersion && !VERSIONED_ROLES.includes(r)) return false;
    const types = ROLE_ENTITY_TYPES[r as Exclude<AssetRole, 'scene'>];
    if (types && !types.includes(type)) return false;
    return type === 'character' ? r !== 'depicts' : true;
  });
}

/** Що буде згенеровано: опис, промпт, референси — для вікна «Згенерувати» (автор може змінити промпт і референси). */
export async function generationBrief(
  repo: CoreRepository,
  target: GenerationTarget,
  cardText: string | null | undefined,
  max = GENERATION_MAX_REFERENCES,
): Promise<GenerationBrief> {
  const links = await repo.listAssetLinks(target.projectId, { entityId: target.entity.id });
  const refs = pickGenerationReferences(links, target, max);
  const labels = new Map((await repo.listAppearanceVersions(target.projectId, target.entity.id)).map((v) => [v.id, v.label]));
  const description = generationDescription(target, cardText);
  return {
    entity: { id: target.entity.id, name: target.entity.name, type: target.entity.type },
    version: target.version ? { id: target.version.id, label: target.version.label, age: target.version.age } : null,
    role: target.role,
    roles: generationRolesFor(target.entity.type, !!target.version),
    description,
    missingDescription: target.entity.type === 'character' && VERSIONED_ROLES.includes(target.role) && !description,
    prompt: generationPrompt(target, description, refs.length > 0),
    references: refs.map((l) => ({ linkId: l.id, assetUrl: l.assetUrl, role: l.role, versionLabel: l.appearanceVersionId ? labels.get(l.appearanceVersionId) ?? null : null })),
    maxReferences: max,
  };
}

/**
 * Прив'язати щойно згенероване зображення до сутності: джерело — автор
 * (генерацію запустив він), підтверджено, звірено з описом, з якого
 * генерували (`usedHash`). Опис за час генерації змінився (`currentHash`
 * інший) — одразу «перевірити». Портрет версії — ще й рядок в історії версії.
 */
export async function linkGeneratedImage(
  repo: CoreRepository,
  target: GenerationTarget,
  assetUrl: string,
  actor: string,
  hashes: { usedHash?: string; currentHash?: string } = {},
): Promise<AssetLinkRow> {
  let link = await repo.upsertAssetLink({
    projectId: target.projectId,
    assetUrl,
    role: target.role,
    entityId: target.entity.id,
    sectionId: null,
    appearanceVersionId: target.version?.id ?? null,
    checkedHash: hashes.usedHash ?? null,
    status: 'confirmed',
    source: 'author',
    note: `Згенеровано за ${target.version ? `описом версії «${target.version.label}»` : target.entity.type === 'character' ? 'описом з картки героя' : 'командою автора'}`.slice(0, 500),
    createdBy: actor,
  });
  if (hashes.usedHash && hashes.currentHash !== undefined && hashes.currentHash !== hashes.usedHash) {
    link = await repo.setAssetLinkReview(target.projectId, link.id, { needsReview: true });
  }
  if (target.version && target.role === 'portrait') {
    await repo.addAppearanceHistory({
      projectId: target.projectId,
      versionId: target.version.id,
      entityId: target.entity.id,
      action: 'portrait',
      snapshot: { label: target.version.label, assetUrl, generated: true },
      actor,
    });
  }
  return link;
}
