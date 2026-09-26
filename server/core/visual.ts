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

import type { AssetLinkRow, AssetRole, CoreRepository, EntityRow } from './types';
import { isLinkableAssetUrl } from './rules';
import { bookIndex, placeOf } from './characterProfile';

export const LEGACY_ACTOR = 'system:core_sync';

/** Які типи сутностей пропонувати для ролі (у вибирачі Медіатеки). */
export const ROLE_ENTITY_TYPES: Record<Exclude<AssetRole, 'scene'>, string[] | null> = {
  portrait: ['character'],
  full_body: ['character'],
  reference: null,
  depicts: null,
  location: ['location'],
  object: ['object', 'item', 'artifact', 'weapon', 'vehicle'],
};

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

/**
 * Портрет героя: підтверджений зв'язок «портрет» (автор → AI → з книги,
 * новіший — вище); немає — запасний URL із картки героя.
 */
export async function heroPortrait(
  repo: CoreRepository,
  projectId: string,
  entityId: string,
  fallbackUrl?: string | null,
): Promise<{ url: string; source: 'link' | 'card'; linkId: string | null; linkSource: AssetLinkRow['source'] | null } | null> {
  const links = (await repo.listAssetLinks(projectId, { entityId }))
    .filter((l) => l.role === 'portrait' && l.status === 'confirmed')
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || b.updatedAt.localeCompare(a.updatedAt));
  if (links[0]) return { url: links[0].assetUrl, source: 'link', linkId: links[0].id, linkSource: links[0].source };
  return fallbackUrl ? { url: fallbackUrl, source: 'card', linkId: null, linkSource: null } : null;
}

export interface SceneVisuals {
  sectionId: string;
  title: string;
  /** Герої, згадані в розділі (тегом або як «чий» стан), з портретами. */
  cast: { entityId: string; name: string; portraitUrl: string | null; portraitSource: 'link' | 'card' | null }[];
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
  const cast: SceneVisuals['cast'] = [];
  for (const id of order) {
    const e = entities.get(id)!;
    const p = await heroPortrait(repo, projectId, id, (await cardPortrait?.(e)) ?? null);
    cast.push({ entityId: id, name: e.name, portraitUrl: p?.url ?? null, portraitSource: p?.source ?? null });
  }
  const illustrations = (await repo.listAssetLinks(projectId, { sectionId }))
    .filter((l) => l.role === 'scene' && l.status === 'confirmed')
    .map((l) => ({ linkId: l.id, url: l.assetUrl, source: l.source }));
  return { sectionId, title: section.title, cast, illustrations };
}

/** Зв'язки з назвами цілей — для Медіатеки. */
export async function describeLinks(repo: CoreRepository, projectId: string, links: AssetLinkRow[]) {
  const [entities, docs] = await Promise.all([repo.listEntities(projectId), repo.listDocuments(projectId)]);
  const eById = new Map(entities.map((e) => [e.id, e]));
  const dById = new Map(docs.map((d) => [d.id, d]));
  return links.map((l) => ({
    ...l,
    targetName: l.entityId ? eById.get(l.entityId)?.name ?? '' : dById.get(l.sectionId ?? '')?.title ?? '',
    targetType: l.entityId ? eById.get(l.entityId)?.type ?? '' : 'scene',
  }));
}
