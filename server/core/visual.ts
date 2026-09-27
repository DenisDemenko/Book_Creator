/**
 * Бібліотека ілюстрацій — прив'язка зображень до сутностей книги (Т2.3 В2,
 * ТЗ-11 сторінка 7, PLAN_VISUAL_LIBRARY.md).
 *
 * Зображення живуть у Медіатеці Студії; ядро знає лише зв'язки: портрет
 * героя, повний зріст, референс, «зображено», локація, предмет — до сутності;
 * ілюстрація сцени — до розділу книги.
 *
 * Джерела зв'язків:
 *   • legacy — перенесено з книги (рішення власника 25.09: «переносити всі»):
 *     `Character.avatarUrl` → портрет героя, `BookIllustration.sectionId` →
 *     ілюстрація сцени. Їх веде синхронізація ядра: нове в книзі —
 *     з'являється, прибране з книги — зникає; відхилене автором лишається
 *     відхиленим і не повертається;
 *   • author — прив'язав автор у Медіатеці;
 *   • ai — пропозиції AI-3 (етап В4), лише `suggested`.
 *
 * Критерій сторінки 7: портрет, прив'язаний до героя, видно в його профілі
 * (`heroPortrait` → `buildCharacterProfile`) і в пов'язаних розділах
 * (`sceneVisuals` — «Хто в сцені» в редакторі).
 */

import type { AppearanceVersionRow, AssetLinkRow, AssetRole, CoreRepository, EntityRow } from './types';
import { VERSIONED_ROLES, appearanceHash, isLinkableAssetUrl } from './rules';
import { bookIndex, placeOf } from './characterProfile';

export const LEGACY_ACTOR = 'system:core_sync';

/**
 * Кого AI-3 і генерація можуть впізнати чи намалювати: сутність із виглядом
 * (не подія, емоція чи тема). Визначено тут, а не в `visualAi.ts` — інакше
 * цей файл залежав би від нього (`visualAi.ts` уже імпортує з `visual.ts`,
 * цикл імпортів зламав би збірку); `visualAi.ts` і `visualGeneration.ts`
 * перевикористовують цей самий перелік.
 */
export const VISUAL_ENTITY_TYPES = ['character', 'group', 'location', 'world', 'object', 'item', 'artifact', 'weapon', 'vehicle', 'symbol', 'tool'];

/** Які типи сутностей пропонувати для ролі (у вибирачі Медіатеки). */
export const ROLE_ENTITY_TYPES: Record<Exclude<AssetRole, 'scene'>, string[] | null> = {
  portrait: ['character'],
  full_body: ['character'],
  reference: null,
  depicts: null,
  location: ['location'],
  object: ['object', 'item', 'artifact', 'weapon', 'vehicle'],
};

/**
 * Роль, яка означає «в сутності вже є головне зображення» (Т2.3 В7,
 * позначка «без портрета»): герой — портрет, локація (і світ) — «локація»,
 * предмет — «предмет», решта («зображено») — група, символ, інструмент.
 */
export function primaryVisualRole(type: string): AssetRole {
  if (type === 'character') return 'portrait';
  if ((ROLE_ENTITY_TYPES.location ?? []).includes(type) || type === 'world') return 'location';
  if ((ROLE_ENTITY_TYPES.object ?? []).includes(type)) return 'object';
  return 'depicts';
}

/** Порядок довіри до портрета: те, що прив'язав автор, важить більше за перенесене з книги. */
const SOURCE_RANK: Record<AssetLinkRow['source'], number> = { author: 0, ai: 1, legacy: 2 };

export interface LegacyImage {
  assetUrl: string;
  role: AssetRole;
  entityId?: string | null;
  sectionId?: string | null;
}

/** Ключ зв'язку: той самий, що UNIQUE у базі. */
export const linkKey = (l: { assetUrl: string; role: string; entityId?: string | null; sectionId?: string | null }) =>
  `${l.assetUrl}\u0000${l.entityId ? `e:${l.entityId}` : `s:${l.sectionId}`}\u0000${l.role}`;

/**
 * Звести перенесені з книги зв'язки до того, що зараз у книзі. Зв'язки автора
 * й AI не чіпає; відхилені автором перенесені — не повертає.
 */
export async function reconcileLegacyAssetLinks(
  repo: CoreRepository,
  projectId: string,
  wanted: LegacyImage[],
): Promise<{ linked: number; unlinked: number }> {
  const clean = wanted.filter((w) => isLinkableAssetUrl(w.assetUrl) && (w.entityId || w.sectionId));
  const want = new Map(clean.map((w) => [linkKey(w), w]));
  const all = await repo.listAssetLinks(projectId);
  const byKey = new Map(all.map((l) => [linkKey(l), l]));
  let linked = 0;
  let unlinked = 0;
  for (const [k, w] of want) {
    if (byKey.has(k)) continue; // уже є — від автора, AI чи перенесений (зокрема відхилений)
    await repo.upsertAssetLink({
      projectId,
      assetUrl: w.assetUrl,
      role: w.role,
      entityId: w.entityId ?? null,
      sectionId: w.sectionId ?? null,
      status: 'confirmed',
      source: 'legacy',
      createdBy: LEGACY_ACTOR,
    });
    linked++;
  }
  for (const l of all) {
    if (l.source !== 'legacy' || want.has(linkKey(l)) || l.status === 'rejected') continue;
    await repo.deleteAssetLink(projectId, l.id);
    unlinked++;
  }
  return { linked, unlinked };
}

/** Чи діє версія зовнішності в главі N (межі — включно; порожні — з початку / до кінця). */
export const versionCovers = (v: Pick<AppearanceVersionRow, 'fromChapter' | 'toChapter'>, chapter: number) =>
  (v.fromChapter == null || v.fromChapter <= chapter) && (v.toChapter == null || v.toChapter >= chapter);

/**
 * Версія зовнішності, що діє в главі N (Т2.3 В3): із затверджених, що
 * покривають главу, — найпізніша за початком («з гл. 4» важить більше за
 * «з початку»), далі вужча, далі новіша.
 */
export function activeAppearanceVersion<T extends Pick<AppearanceVersionRow, 'fromChapter' | 'toChapter' | 'approved' | 'updatedAt' | 'id'>>(
  versions: T[],
  chapter: number | null | undefined,
): T | null {
  if (chapter == null) return null;
  const span = (v: T) => (v.toChapter ?? 1e9) - (v.fromChapter ?? 0);
  return (
    versions
      .filter((v) => v.approved && versionCovers(v, chapter))
      .sort((a, b) => (b.fromChapter ?? 0) - (a.fromChapter ?? 0) || span(a) - span(b) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0] ?? null
  );
}

const byTrust = (a: AssetLinkRow, b: AssetLinkRow) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || b.updatedAt.localeCompare(a.updatedAt);

export interface HeroPortrait {
  url: string;
  source: 'link' | 'card';
  linkId: string | null;
  linkSource: AssetLinkRow['source'] | null;
  /** Версія зовнішності, чий це портрет (Т2.3 В3), — якщо портрет версії. */
  version: { id: string; label: string } | null;
}

/**
 * Портрет героя. Без глави: загальний підтверджений портрет (автор → AI → з
 * книги, новіший — вище), далі картка героя, далі будь-який портрет версії.
 * З главою N (Т2.3 В3): спершу портрет версії зовнішності, що діє в главі N;
 * немає — як без глави, але портрети інших версій не підставляються (це
 * інший вік героя).
 */
export async function heroPortrait(
  repo: CoreRepository,
  projectId: string,
  entityId: string,
  fallbackUrl?: string | null,
  opts: { chapter?: number | null; versions?: AppearanceVersionRow[] } = {},
): Promise<HeroPortrait | null> {
  const links = (await repo.listAssetLinks(projectId, { entityId })).filter((l) => l.role === 'portrait' && l.status === 'confirmed').sort(byTrust);
  const out = (l: AssetLinkRow, version: HeroPortrait['version'] = null): HeroPortrait => ({ url: l.assetUrl, source: 'link', linkId: l.id, linkSource: l.source, version });
  const chapter = opts.chapter ?? null;
  if (chapter != null) {
    const versions = opts.versions ?? (await repo.listAppearanceVersions(projectId, entityId));
    const v = activeAppearanceVersion(versions, chapter);
    const own = v ? links.find((l) => l.appearanceVersionId === v.id) : undefined;
    if (v && own) return out(own, { id: v.id, label: v.label });
  }
  const general = links.find((l) => !l.appearanceVersionId);
  if (general) return out(general);
  if (fallbackUrl) return { url: fallbackUrl, source: 'card', linkId: null, linkSource: null, version: null };
  if (chapter == null && links[0]) {
    const versions = opts.versions ?? (await repo.listAppearanceVersions(projectId, entityId));
    const v = versions.find((x) => x.id === links[0].appearanceVersionId);
    return out(links[0], v ? { id: v.id, label: v.label } : null);
  }
  return null;
}

export interface SceneVisuals {
  sectionId: string;
  title: string;
  /** Герої, згадані в розділі (тегом або як «чий» стан), з портретами. */
  cast: { entityId: string; name: string; portraitUrl: string | null; portraitSource: 'link' | 'card' | null; versionLabel: string | null }[];
  /** Номер глави розділу — за ним обирається версія зовнішності героїв. */
  chapterNumber: number | null;
  /** Зображення, прив'язані до цієї сцени. */
  illustrations: { linkId: string; url: string; source: AssetLinkRow['source'] }[];
}

/** «Хто в сцені» для розділу: герої з портретами й ілюстрації сцени. */
export async function sceneVisuals(
  repo: CoreRepository,
  projectId: string,
  sectionId: string,
  cardPortrait?: (entity: EntityRow) => Promise<string | null> | string | null,
): Promise<SceneVisuals | null> {
  const ix = await bookIndex(repo, projectId);
  const section = ix.docs.get(sectionId);
  if (!section || section.deletedAt || section.kind !== 'section') return null;
  const paragraphIds = [...ix.paragraphs.values()].filter((p) => p.documentId === sectionId && placeOf(ix, p.id)).map((p) => p.id);
  // У порядку тексту: абзац за абзацом, у абзаці — за місцем тега.
  const pos = new Map(paragraphIds.map((id) => [id, placeOf(ix, id)!.position]));
  const mentions = (await repo.listMentionsByParagraphs(projectId, paragraphIds))
    .filter((m) => m.status !== 'rejected')
    .sort((a, b) => pos.get(a.paragraphId)! - pos.get(b.paragraphId)! || a.spanStart - b.spanStart);
  const entities = new Map((await repo.listEntities(projectId, 'character')).map((e) => [e.id, e]));
  const order: string[] = [];
  for (const m of mentions) {
    for (const id of [m.entityId, m.subjectEntityId]) {
      if (id && entities.has(id) && entities.get(id)!.status !== 'rejected' && !order.includes(id)) order.push(id);
    }
  }
  const parent = section.parentId ? ix.docs.get(section.parentId) : undefined;
  const chapterNumber = parent && !parent.deletedAt ? ix.chapterNo.get(parent.id) ?? null : null;
  const versions = await repo.listAppearanceVersions(projectId);
  const cast: SceneVisuals['cast'] = [];
  for (const id of order) {
    const e = entities.get(id)!;
    const mine = versions.filter((v) => v.entityId === id);
    const p = await heroPortrait(repo, projectId, id, (await cardPortrait?.(e)) ?? null, { chapter: chapterNumber, versions: mine });
    // Підпис версії — і тоді, коли в неї ще немає свого портрета: автор бачить, який вік героя в цій главі.
    const active = activeAppearanceVersion(mine, chapterNumber);
    cast.push({ entityId: id, name: e.name, portraitUrl: p?.url ?? null, portraitSource: p?.source ?? null, versionLabel: active?.label ?? null });
  }
  const illustrations = (await repo.listAssetLinks(projectId, { sectionId }))
    .filter((l) => l.role === 'scene' && l.status === 'confirmed')
    .map((l) => ({ linkId: l.id, url: l.assetUrl, source: l.source }));
  return { sectionId, title: section.title, chapterNumber, cast, illustrations };
}

/** Зв'язки з назвами цілей — для Медіатеки. */
export async function describeLinks(repo: CoreRepository, projectId: string, links: AssetLinkRow[]) {
  const [entities, docs, versions] = await Promise.all([repo.listEntities(projectId), repo.listDocuments(projectId), repo.listAppearanceVersions(projectId)]);
  const eById = new Map(entities.map((e) => [e.id, e]));
  const dById = new Map(docs.map((d) => [d.id, d]));
  const vById = new Map(versions.map((v) => [v.id, v]));
  return links.map((l) => ({
    ...l,
    versionLabel: l.appearanceVersionId ? vById.get(l.appearanceVersionId)?.label ?? null : null,
    targetName: l.entityId ? eById.get(l.entityId)?.name ?? '' : dById.get(l.sectionId ?? '')?.title ?? '',
    targetType: l.entityId ? eById.get(l.entityId)?.type ?? '' : 'scene',
  }));
}

// ── Версії зовнішності (Т2.3 В3) ─────────────────────────────────────────────

export interface AppearanceVersionView extends AppearanceVersionRow {
  /** Портрет цієї версії (підтверджений зв'язок «портрет» з її позначкою). */
  portraitUrl: string | null;
  portraitLinkId: string | null;
  /** Опис версії змінився після звірки портрета (Т2.3 В5). */
  portraitNeedsReview: boolean;
  /** Інші затверджені версії, чиї глави перетинаються з цією. */
  overlapsWith: string[];
  /** Діє в обраній главі (режим «стан на главі N»). */
  active: boolean;
}

export interface AppearanceOverview {
  /** Основа — картка героя в Студії: канон автора, редагується в картці. */
  base: { description: string; portraitUrl: string | null; portraitSource: 'link' | 'card' | null; portraitLinkId: string | null; portraitNeedsReview: boolean };
  versions: AppearanceVersionView[];
  /** Зображення героя (будь-якої ролі), що чекають звірки з новим описом. */
  needsReview: { linkId: string; assetUrl: string; role: string; versionLabel: string | null }[];
  /** Версія, що діє в главі `upto`; null — немає або глава не обрана. */
  activeId: string | null;
  upto: number | null;
  history: { versionId: string; action: string; label: string; actor: string; at: string }[];
}

const overlaps = (a: AppearanceVersionRow, b: AppearanceVersionRow) =>
  (a.fromChapter ?? 0) <= (b.toChapter ?? 1e9) && (b.fromChapter ?? 0) <= (a.toChapter ?? 1e9);

/**
 * Стрічка версій зовнішності героя. `upto` — «стан на главі N»: версії, що
 * починаються пізніше, не показуються (спойлер), діюча позначена.
 */
export async function appearanceOverview(
  repo: CoreRepository,
  projectId: string,
  entityId: string,
  card: { description: string; portraitUrl: string | null },
  upto: number | null = null,
): Promise<AppearanceOverview> {
  const [all, links, history] = await Promise.all([
    repo.listAppearanceVersions(projectId, entityId),
    repo.listAssetLinks(projectId, { entityId }),
    repo.listAppearanceHistory(projectId, entityId, 30),
  ]);
  const portraits = links.filter((l) => l.role === 'portrait' && l.status === 'confirmed').sort(byTrust);
  const active = activeAppearanceVersion(all, upto);
  const visible = upto == null ? all : all.filter((v) => (v.fromChapter ?? 0) <= upto);
  const versions = visible.map((v) => {
    const p = portraits.find((l) => l.appearanceVersionId === v.id);
    return {
      ...v,
      portraitUrl: p?.assetUrl ?? null,
      portraitLinkId: p?.id ?? null,
      portraitNeedsReview: !!p?.needsReview,
      overlapsWith: v.approved ? all.filter((o) => o.id !== v.id && o.approved && overlaps(o, v)).map((o) => o.id) : [],
      active: !!active && active.id === v.id,
    };
  });
  const basePortrait = await heroPortrait(repo, projectId, entityId, card.portraitUrl);
  const visibleIds = new Set(visible.map((v) => v.id));
  return {
    base: {
      description: upto == null ? card.description : '',
      portraitUrl: basePortrait && !basePortrait.version ? basePortrait.url : null,
      portraitSource: basePortrait && !basePortrait.version ? basePortrait.source : null,
      portraitLinkId: basePortrait && !basePortrait.version ? basePortrait.linkId : null,
      portraitNeedsReview: !!(basePortrait?.linkId && !basePortrait.version && portraits.find((l) => l.id === basePortrait.linkId)?.needsReview),
    },
    versions,
    needsReview: links
      .filter((l) => l.status === 'confirmed' && l.needsReview && (!l.appearanceVersionId || visibleIds.has(l.appearanceVersionId)))
      .map((l) => ({ linkId: l.id, assetUrl: l.assetUrl, role: l.role, versionLabel: l.appearanceVersionId ? all.find((v) => v.id === l.appearanceVersionId)?.label ?? null : null })),
    activeId: active?.id ?? null,
    upto,
    history: history
      .filter((h) => upto == null || visibleIds.has(h.versionId))
      .map((h) => ({ versionId: h.versionId, action: h.action, label: String((h.snapshot as any)?.label ?? ''), actor: h.actor, at: h.at })),
  };
}

// ── «Перевірити» після зміни опису (Т2.3 В5) ─────────────────────────────────

/**
 * Відбиток опису, з яким має збігатися зображення героя: портрет (повний
 * зріст, референс) версії зовнішності — опис цієї версії, решта — опис
 * зовнішності з картки героя. undefined — опису не знаємо (героя немає в
 * книзі), такий зв'язок не чіпаємо.
 */
export function expectedLinkHash(
  link: Pick<AssetLinkRow, 'entityId' | 'role' | 'appearanceVersionId'>,
  versions: Map<string, Pick<AppearanceVersionRow, 'descriptionHash'>>,
  cardHash: (entityId: string) => string | undefined,
): string | undefined {
  if (!link.entityId || !VERSIONED_ROLES.includes(link.role)) return undefined;
  if (link.appearanceVersionId) return versions.get(link.appearanceVersionId)?.descriptionHash;
  return cardHash(link.entityId);
}

/** Відбиток опису з картки героя (порожній опис — теж опис: заповнили — перевірити). */
export const cardAppearanceHash = (text: string | null | undefined) => appearanceHash(text ?? '');

export interface VisualReviewResult {
  /** Щойно позначені «перевірити». */
  flagged: number;
  /** Позначку знято: опис повернувся до того, з яким звіряли. */
  cleared: number;
  /** Старі зв'язки без відбитка — звірені з поточним описом (без позначки). */
  baselined: number;
  notifications: number;
}

/**
 * Звести позначки «перевірити» з поточними описами. Зображення, звірене зі
 * старим описом (`checked_hash` ≠ поточного), позначається `needs_review`, і
 * ядро пише сповіщення — одне на героя. Зв'язок без відбитка (з В2 або
 * щойно перенесений з книги) приймає поточний опис як звірений. Лише
 * підтверджені зв'язки героїв; `cardHash` — відбитки карток тих героїв, чиї
 * картки відомі (інших не чіпаємо); `entityIds` — обмежити героями.
 */
export async function refreshVisualReview(
  repo: CoreRepository,
  projectId: string,
  cardHash: (entityId: string) => string | undefined,
  opts: { entityIds?: string[]; reason?: string } = {},
): Promise<VisualReviewResult> {
  const out: VisualReviewResult = { flagged: 0, cleared: 0, baselined: 0, notifications: 0 };
  const scope = opts.entityIds ? new Set(opts.entityIds) : null;
  const [links, versions] = await Promise.all([repo.listAssetLinks(projectId), repo.listAppearanceVersions(projectId)]);
  const vById = new Map(versions.map((v) => [v.id, v]));
  const flaggedBy = new Map<string, AssetLinkRow[]>();
  for (const l of links) {
    if (l.status !== 'confirmed' || !l.entityId || (scope && !scope.has(l.entityId))) continue;
    const want = expectedLinkHash(l, vById, cardHash);
    if (want === undefined) continue;
    if (l.checkedHash == null) {
      await repo.setAssetLinkReview(projectId, l.id, { needsReview: false, checkedHash: want });
      out.baselined++;
    } else if (l.checkedHash !== want && !l.needsReview) {
      await repo.setAssetLinkReview(projectId, l.id, { needsReview: true });
      out.flagged++;
      flaggedBy.set(l.entityId, [...(flaggedBy.get(l.entityId) ?? []), l]);
    } else if (l.checkedHash === want && l.needsReview) {
      await repo.setAssetLinkReview(projectId, l.id, { needsReview: false });
      out.cleared++;
    }
  }
  if (flaggedBy.size) {
    const names = new Map((await repo.listEntities(projectId, 'character')).map((e) => [e.id, e.name]));
    for (const [entityId, list] of flaggedBy) {
      const labels = [...new Set(list.map((l) => (l.appearanceVersionId ? vById.get(l.appearanceVersionId)?.label : null)).filter(Boolean))];
      await repo.addNotification({
        projectId,
        kind: 'visual_needs_review',
        message: `Опис зовнішності «${names.get(entityId) ?? '?'}»${labels.length ? ` (${labels.join(', ')})` : ''} змінився — перевірте зображення: ${list.length}`,
        payload: { entityId, linkIds: list.map((l) => l.id), assetUrls: list.map((l) => l.assetUrl), reason: opts.reason ?? '' },
      });
      out.notifications++;
    }
  }
  return out;
}

// ── Вкладка «За сутностями» (Т2.3 В7) ────────────────────────────────────────

export interface VisualEntitySummary {
  id: string;
  type: string;
  name: string;
  /** Підтверджені зображення (унікальні файли, будь-яка роль). */
  images: number;
  /** Пропозиції AI-3, що чекають рішення автора (В4). */
  suggested: number;
  /** Підтверджені зображення з позначкою «перевірити» (В5). */
  needsReview: number;
  /** Є підтверджений зв'язок головної ролі типу (портрет / локація / предмет / «зображено»). */
  hasPortrait: boolean;
}

export interface VisualSceneSummary {
  sectionId: string;
  title: string;
  chapterNumber: number | null;
  images: number;
}

export interface VisualEntitiesOverview {
  characters: VisualEntitySummary[];
  locations: VisualEntitySummary[];
  objects: VisualEntitySummary[];
  /** Група, світ, символ, інструмент — має вигляд, але не входить у три головні розділи. */
  other: VisualEntitySummary[];
  scenes: VisualSceneSummary[];
}

const BUCKET_TYPES = {
  characters: ['character'],
  locations: ['location', 'world'],
  objects: ['object', 'item', 'artifact', 'weapon', 'vehicle'],
} as const;

/**
 * Огляд для лівої колонки вкладки «За сутністю» (Т2.3 В7): герої, локації,
 * предмети (і решта видів із виглядом), сцени — з кількістю зображень і
 * позначками «перевірити» / «без портрета». Права колонка (обрана сутність)
 * бере дані з наявних `heroPortrait` / `appearanceOverview` / `/visual/links`
 * — тут лише перелік і лічильники.
 */
export async function visualEntitiesOverview(repo: CoreRepository, projectId: string): Promise<VisualEntitiesOverview> {
  const [entities, links, docs] = await Promise.all([repo.listEntities(projectId), repo.listAssetLinks(projectId), repo.listDocuments(projectId)]);
  const visible = entities.filter((e) => e.status !== 'rejected' && VISUAL_ENTITY_TYPES.includes(e.type));
  const byEntity = new Map<string, AssetLinkRow[]>();
  for (const l of links) {
    if (!l.entityId) continue;
    const list = byEntity.get(l.entityId);
    if (list) list.push(l);
    else byEntity.set(l.entityId, [l]);
  }
  const summarize = (e: EntityRow): VisualEntitySummary => {
    const ls = byEntity.get(e.id) ?? [];
    const confirmed = ls.filter((l) => l.status === 'confirmed');
    const primaryRole = primaryVisualRole(e.type);
    return {
      id: e.id,
      type: e.type,
      name: e.name,
      images: new Set(confirmed.map((l) => l.assetUrl)).size,
      suggested: ls.filter((l) => l.status === 'suggested').length,
      needsReview: confirmed.filter((l) => l.needsReview).length,
      hasPortrait: confirmed.some((l) => l.role === primaryRole),
    };
  };
  const bucket = (types: readonly string[]) =>
    visible
      .filter((e) => types.includes(e.type))
      .map(summarize)
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const known = new Set<string>([...BUCKET_TYPES.characters, ...BUCKET_TYPES.locations, ...BUCKET_TYPES.objects]);

  const chapters = docs.filter((d) => d.kind === 'chapter' && !d.deletedAt).sort((a, b) => a.order - b.order);
  const chapterNo = new Map(chapters.map((c, i) => [c.id, i + 1]));
  const sceneLinksBySection = new Map<string, AssetLinkRow[]>();
  for (const l of links) {
    if (l.role !== 'scene' || !l.sectionId || l.status !== 'confirmed') continue;
    const list = sceneLinksBySection.get(l.sectionId);
    if (list) list.push(l);
    else sceneLinksBySection.set(l.sectionId, [l]);
  }
  const scenes = docs
    .filter((d) => d.kind === 'section' && !d.deletedAt && sceneLinksBySection.has(d.id))
    .map((d) => ({
      sectionId: d.id,
      title: d.title,
      chapterNumber: d.parentId ? chapterNo.get(d.parentId) ?? null : null,
      images: new Set(sceneLinksBySection.get(d.id)!.map((l) => l.assetUrl)).size,
    }))
    .sort((a, b) => (a.chapterNumber ?? 1e9) - (b.chapterNumber ?? 1e9) || a.title.localeCompare(b.title, 'uk'));

  return {
    characters: bucket(BUCKET_TYPES.characters),
    locations: bucket(BUCKET_TYPES.locations),
    objects: bucket(BUCKET_TYPES.objects),
    other: visible.filter((e) => !known.has(e.type)).map(summarize).sort((a, b) => a.name.localeCompare(b.name, 'uk')),
    scenes,
  };
}
