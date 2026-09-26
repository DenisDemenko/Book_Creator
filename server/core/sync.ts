/**
 * Синхронізація книги з ядром — `core_sync` (Т0.6, ТЗ-11 13.4).
 *
 * Після кожного збереження книги (PUT /api/books/:id) сервер ставить у чергу
 * задачу; вона читає ОСТАННЮ збережену книгу й приводить ядро до неї:
 *   1. проєкт і власник; герої зі списку книги — сутності `character`;
 *   2. глави й розділи — `documents`; абзаци — `paragraphs` з версіями;
 *   3. згадки з тегів — лише для абзаців, чий текст змінився (перерахунок
 *      тегів дешевий, але «без змін — нічого не пишемо» — вимога задачі);
 *   4. висновки AI на змінених абзацах — `needs_review` і сповіщення.
 *
 * Книга лише ЧИТАЄТЬСЯ: теги, текст, номери абзаців у рукописі не
 * змінюються ні на байт (джерело істини — редактор, К2). Усе, що ядро
 * «лагодить» (номери для старих розділів, повтори номерів у скопійованому
 * розділі), воно лагодить у себе детерміновано — однаково на кожному прогоні.
 */

import {
  entityBySlug,
  parseEntityTagsInSource,
  parseEntityValue,
  type CoreEntity,
} from '../../src/utils/coreEntities';
import { markerStringToTiptapDoc, tiptapDocToMarkerBlocks } from '../../src/utils/manuscriptDoc';
import { blockHash, deterministicParagraphId, reconcileParagraphIds } from '../../src/utils/paragraphIds';
import { CoreRuleError } from './rules';
import { cardAppearanceHash, reconcileLegacyAssetLinks, refreshVisualReview, type LegacyImage } from './visual';
import { studioAppearanceText } from './characterProfile';
import type { CoreRepository, DocumentRow, MentionInput, ParagraphKind, ParagraphRow } from './types';

export const CORE_SYNC_ACTOR = 'system:core_sync';
export const CORE_SYNC_KIND = 'core_sync';

// ── Що синхронізація читає з книги (підмножина `Book` зі `src/types.ts`) ──

export interface SyncSection {
  id: string;
  title?: string;
  order?: number;
  content?: string;
  paragraphIds?: string[];
  paragraphHashes?: string[];
  scene?: { characters?: { characterId: string }[] } | null;
}
export interface SyncChapter {
  id: string;
  title?: string;
  order?: number;
  sections?: SyncSection[];
}
export interface SyncCharacter {
  id: string;
  name?: string;
  surname?: string;
  alias?: string;
  /** Портрет героя з картки — переноситься в бібліотеку ілюстрацій (Т2.3 В2). */
  avatarUrl?: string;
  /** Зовнішність з картки — з нею звіряються портрети героя (Т2.3 В5). */
  appearance?: Record<string, string | undefined>;
}
export interface SyncIllustration {
  id?: string;
  url?: string;
  sectionId?: string;
}
export interface SyncBook {
  id: string;
  title?: string;
  chapters?: SyncChapter[];
  characters?: SyncCharacter[];
  /** Ілюстрації книги: із розділом — стають ілюстраціями сцени (Т2.3 В2). */
  illustrations?: SyncIllustration[];
}

export interface StoredBookForSync {
  id: string;
  ownerId: string | null;
  title?: string;
  book: SyncBook | Record<string, unknown>;
}

export interface CoreSyncResult {
  projectId: string;
  skipped?: 'no_owner' | 'no_book';
  revision: number;
  documents: { written: number; deleted: number };
  paragraphs: { created: number; changed: number; moved: number; unchanged: number; deleted: number; duplicateIdsRemapped: number };
  mentions: { paragraphs: number; written: number; withoutValue: number };
  entities: { created: number; updated: number };
  findingsNeedReview: number;
  notifications: number;
  /** Зображення з книги в бібліотеці ілюстрацій (Т2.3 В2): прив'язано / прибрано. */
  /** Бібліотека ілюстрацій: перенесені з книги зв'язки (В2) і позначки «перевірити» після зміни опису (В5). */
  assets: { linked: number; unlinked: number; review?: { flagged: number; cleared: number; baselined: number } };
  /** false — повторне збереження без змін: у базу не записано нічого. */
  wroteAnything: boolean;
}

export interface CoreSyncHooks {
  /** Між розділами: продовження оренди задачі й перевірка скасування. */
  checkpoint?: () => Promise<void>;
  progress?: (done: number, total: number) => Promise<void>;
}

const NODE_KIND: Record<string, ParagraphKind> = {
  paragraph: 'paragraph',
  heading: 'heading',
  blockquote: 'blockquote',
  table: 'table',
  sceneDivider: 'divider',
  wrappedImage: 'image',
  aiDraft: 'draft',
};

export const characterRef = (studioId: string) => `studio:character:${studioId}`;

/** Ім'я героя з тега: діалогова форма `/character:Ім'я:репліка` — лише до двокрапки. */
function characterNameFromValue(text: string): string {
  return text.split(':')[0].trim();
}

/** Назва сутності з тега: перше поле значення (П2) без приписки `@Ім'я` (П1). */
export function entityNameFromTag(entity: CoreEntity, value: string): { name: string; subject?: string; fields: { name: string; value: string }[]; text: string } {
  const parsed = parseEntityValue(entity, value);
  const name = entity.slug === 'character' ? characterNameFromValue(parsed.text) : (parsed.parts[0] ?? '').trim();
  return { name, subject: parsed.subject, fields: parsed.fields, text: parsed.text };
}

/** Блоки розділу: текст у маркерах і вид кожного — з того самого розбору, що в редакторі. */
function sectionBlocksWithKinds(content: string): { text: string; kind: ParagraphKind }[] {
  const doc = markerStringToTiptapDoc(content || '');
  const texts = tiptapDocToMarkerBlocks(doc);
  const nodes = doc.content || [];
  return texts.map((text, i) => ({ text, kind: NODE_KIND[nodes[i]?.type ?? 'paragraph'] ?? 'paragraph' }));
}

export async function syncBookToCore(
  repo: CoreRepository,
  stored: StoredBookForSync,
  hooks: CoreSyncHooks = {},
): Promise<CoreSyncResult> {
  const book = (stored.book || {}) as SyncBook;
  const projectId = stored.id;
  const result: CoreSyncResult = {
    projectId,
    revision: 0,
    documents: { written: 0, deleted: 0 },
    paragraphs: { created: 0, changed: 0, moved: 0, unchanged: 0, deleted: 0, duplicateIdsRemapped: 0 },
    mentions: { paragraphs: 0, written: 0, withoutValue: 0 },
    entities: { created: 0, updated: 0 },
    findingsNeedReview: 0,
    notifications: 0,
    assets: { linked: 0, unlinked: 0 },
    wroteAnything: false,
  };
  if (!stored.ownerId) return { ...result, skipped: 'no_owner' };
  const wrote = () => { result.wroteAnything = true; };

  // 1. Проєкт і власник ------------------------------------------------------
  const title = String(stored.title ?? book.title ?? '').slice(0, 300);
  let project = await repo.getProject(projectId);
  if (!project || project.ownerId !== stored.ownerId || project.title !== title) {
    project = await repo.upsertProject({ id: projectId, ownerId: stored.ownerId, title });
    wrote();
  }
  if ((await repo.getMemberRole(projectId, stored.ownerId)) !== 'owner') {
    await repo.setMember(projectId, stored.ownerId, 'owner');
    wrote();
  }

  // Сутності за псевдонімом — кеш на прогін, щоб тег, що повторюється, не
  // ходив у базу щоразу.
  const aliasCache = new Map<string, string>();
  const resolveOrCreate = async (entity: CoreEntity, name: string): Promise<string> => {
    const key = `${entity.slug}\u0000${name.toLocaleLowerCase('uk')}`;
    const cached = aliasCache.get(key);
    if (cached) return cached;
    let id = await repo.resolveAlias(projectId, entity.slug, name);
    if (!id) {
      const created = await repo.createEntity({ projectId, type: entity.slug, name, createdBy: CORE_SYNC_ACTOR });
      await repo.addAlias(projectId, created.id, name, 'name');
      id = created.id;
      result.entities.created++;
      wrote();
    }
    aliasCache.set(key, id);
    return id;
  };

  // 2. Герої зі списку книги --------------------------------------------------
  const characterEntity = entityBySlug('character')!;
  const heroByStudioId = new Map<string, string>();
  for (const ch of book.characters ?? []) {
    if (!ch?.id) continue;
    const name = String(ch.name ?? '').trim();
    const full = [name, String(ch.surname ?? '').trim()].filter(Boolean).join(' ');
    const display = full || name;
    if (!display) continue;
    const ref = characterRef(ch.id);
    let entity = await repo.findEntityByExternalRef(projectId, 'character', ref);
    if (!entity) {
      // Герой міг з'явитися раніше з тега — тоді це та сама сутність, не друга.
      const byName = (name && (await repo.resolveAlias(projectId, 'character', name))) || (await repo.resolveAlias(projectId, 'character', display));
      const candidate = byName ? await repo.getEntity(projectId, byName) : null;
      if (candidate && !candidate.externalRef) {
        entity = await repo.updateEntity(projectId, candidate.id, { externalRef: ref, name: display }, CORE_SYNC_ACTOR, 'зв\'язано з героєм книги');
        result.entities.updated++;
      } else {
        entity = await repo.createEntity({
          projectId, type: 'character', name: display, externalRef: ref, createdBy: CORE_SYNC_ACTOR,
          canonical: { studioCharacterId: ch.id },
        });
        result.entities.created++;
      }
      wrote();
    } else if (entity.name !== display) {
      // Перейменування (П6): нова назва, а старе ім'я лишається псевдонімом —
      // старі теги далі ведуть сюди.
      entity = await repo.updateEntity(projectId, entity.id, { name: display }, CORE_SYNC_ACTOR, 'перейменовано в книзі');
      result.entities.updated++;
      wrote();
    }
    heroByStudioId.set(ch.id, entity.id);
    for (const alias of [name, display, String(ch.alias ?? '').trim()]) {
      if (!alias) continue;
      const owner = await repo.resolveAlias(projectId, 'character', alias);
      if (owner === entity.id) continue;
      if (owner) continue; // ім'я вже належить іншому героєві — не відбираємо мовчки
      await repo.addAlias(projectId, entity.id, alias, alias === display ? 'name' : 'alias');
      wrote();
    }
    aliasCache.set(`character\u0000${display.toLocaleLowerCase('uk')}`, entity.id);
  }

  // 3. Документи ----------------------------------------------------------------
  const existingDocs = new Map<string, DocumentRow>((await repo.listDocuments(projectId)).map((d) => [d.id, d]));
  const seenDocs = new Set<string>();
  const upsertDoc = async (id: string, kind: 'chapter' | 'section', parentId: string | null, order: number, docTitle: string) => {
    seenDocs.add(id);
    const prev = existingDocs.get(id);
    if (prev && !prev.deletedAt && prev.kind === kind && prev.parentId === parentId && prev.order === order && prev.title === docTitle) return;
    await repo.upsertDocument({ projectId, id, kind, parentId, order, title: docTitle });
    result.documents.written++;
    wrote();
  };

  // 4. Абзаци -------------------------------------------------------------------
  const allParagraphs = await repo.listAllParagraphs(projectId);
  const paragraphById = new Map<string, ParagraphRow>(allParagraphs.map((p) => [p.id, p]));
  const liveByDocument = new Map<string, ParagraphRow[]>();
  for (const p of allParagraphs) {
    if (p.deletedAt) continue;
    const list = liveByDocument.get(p.documentId) ?? [];
    list.push(p);
    liveByDocument.set(p.documentId, list);
  }
  const seenParagraphs = new Set<string>();
  const textChanged: { id: string; text: string; sectionId: string }[] = [];
  const sectionOf = new Map<string, SyncSection>();

  const chapters = [...(book.chapters ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totalSections = chapters.reduce((n, c) => n + (c.sections?.length ?? 0), 0);
  let doneSections = 0;

  for (const [ci, chapter] of chapters.entries()) {
    if (!chapter?.id) continue;
    await upsertDoc(chapter.id, 'chapter', null, chapter.order ?? ci, String(chapter.title ?? ''));
    const sections = [...(chapter.sections ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const [si, section] of sections.entries()) {
      if (!section?.id) continue;
      await hooks.checkpoint?.();
      await upsertDoc(section.id, 'section', chapter.id, section.order ?? si, String(section.title ?? ''));
      sectionOf.set(section.id, section);

      const content = String(section.content ?? '');
      const blocks = sectionBlocksWithKinds(content);
      // Номери: з редактора, якщо вони є й відповідають тексту; інакше —
      // той самий алгоритм звірки, що в редакторі, від попереднього стану
      // (номери редактора або те, що ядро пам'ятає з минулого прогону).
      const dbPrev = (liveByDocument.get(section.id) ?? []).slice().sort((a, b) => a.order - b.order);
      const hasEditorIds = Array.isArray(section.paragraphIds) && section.paragraphIds.length > 0;
      const reconciled = reconcileParagraphIds({
        sectionId: section.id,
        content,
        prevIds: hasEditorIds ? section.paragraphIds : dbPrev.map((p) => p.editorPid ?? p.id),
        prevHashes: hasEditorIds ? section.paragraphHashes : dbPrev.map((p) => p.textHash),
      });

      for (const [i, block] of blocks.entries()) {
        const editorPid = reconciled.ids[i];
        // Номер уже зайнятий іншим абзацом книги (розділ скопійовано разом
        // із номерами) — у ядрі копія отримує свій стабільний id.
        let id = editorPid;
        if (seenParagraphs.has(id)) {
          let n = 0;
          do id = deterministicParagraphId(section.id, `dup:${editorPid}`, n++); while (seenParagraphs.has(id));
          result.paragraphs.duplicateIdsRemapped++;
        }
        seenParagraphs.add(id);
        const hash = blockHash(block.text);
        const prev = paragraphById.get(id);
        const storedEditorPid = id === editorPid ? null : editorPid;
        const same =
          prev &&
          !prev.deletedAt &&
          prev.textHash === hash &&
          prev.documentId === section.id &&
          prev.order === i &&
          prev.kind === block.kind &&
          (prev.editorPid ?? null) === storedEditorPid;
        if (same) {
          result.paragraphs.unchanged++;
          continue;
        }
        const res = await repo.upsertParagraph(
          { projectId, id, documentId: section.id, order: i, kind: block.kind, text: block.text, editorPid: storedEditorPid },
          CORE_SYNC_ACTOR,
        );
        wrote();
        if (!prev) result.paragraphs.created++;
        else if (res.changed || prev.deletedAt) result.paragraphs.changed++;
        else result.paragraphs.moved++;
        if (res.changed || !prev || prev.deletedAt) textChanged.push({ id, text: block.text, sectionId: section.id });
      }
      doneSections++;
      await hooks.progress?.(doneSections, totalSections);
    }
  }

  // Документи й абзаци, яких більше немає в книзі.
  for (const d of existingDocs.values()) {
    if (!seenDocs.has(d.id) && !d.deletedAt) {
      await repo.markDocumentDeleted(projectId, d.id);
      result.documents.deleted++;
      wrote();
    }
  }
  const deletedIds: string[] = [];
  for (const p of allParagraphs) {
    if (p.deletedAt || seenParagraphs.has(p.id)) continue;
    await repo.markParagraphDeleted(projectId, p.id);
    await repo.replaceParagraphMentions(projectId, p.id, []);
    deletedIds.push(p.id);
    result.paragraphs.deleted++;
    wrote();
  }

  // 5. Згадки з тегів у змінених абзацах -------------------------------------
  for (const para of textChanged) {
    const tags = parseEntityTagsInSource(para.text).filter((tag) => tag.entity);
    const mentions: MentionInput[] = [];
    // Герої абзацу за порядком — для правила «найближчий попередній /character» (П1).
    const heroesInOrder: { start: number; id: string }[] = [];
    const named: { tag: (typeof tags)[number]; entityId: string; info: ReturnType<typeof entityNameFromTag> }[] = [];
    for (const tag of tags) {
      const info = entityNameFromTag(tag.entity!, tag.value);
      if (!info.name) {
        result.mentions.withoutValue++;
        continue;
      }
      const entityId = await resolveOrCreate(tag.entity!, info.name);
      if (tag.entity!.slug === 'character') heroesInOrder.push({ start: tag.start, id: entityId });
      named.push({ tag, entityId, info });
    }
    const distinctHeroes = [...new Set(heroesInOrder.map((h) => h.id))];
    const sceneHeroes = (sectionOf.get(para.sectionId)?.scene?.characters ?? [])
      .map((c) => heroByStudioId.get(c.characterId))
      .filter((x): x is string => !!x);

    for (const { tag, entityId, info } of named) {
      let subject: string | null = null;
      if (tag.entity!.slug !== 'character') {
        if (info.subject) subject = await resolveOrCreate(characterEntity, info.subject);
        else {
          const before = heroesInOrder.filter((h) => h.start < tag.start).pop();
          if (before) subject = before.id;
          else if (distinctHeroes.length === 1) subject = distinctHeroes[0];
          else if (sceneHeroes.length === 1) subject = sceneHeroes[0];
        }
      }
      mentions.push({
        entityId,
        spanStart: tag.start,
        spanEnd: tag.end,
        source: 'tag',
        status: 'confirmed',
        subjectEntityId: subject,
        fields: { value: info.text, fields: info.fields },
      });
    }
    await repo.replaceParagraphMentions(projectId, para.id, mentions);
    result.mentions.paragraphs++;
    result.mentions.written += mentions.length;
    wrote();
  }

  // 5а. Зображення з книги → бібліотека ілюстрацій (Т2.3 В2) -------------------
  // Портрет героя й ілюстрація розділу — зв'язки `legacy`: нове в книзі
  // з'являється, прибране — зникає, відхилене автором не повертається.
  // `data:`-URL (старі вбудовані файли) не переносяться: їх треба спершу
  // покласти в Медіатеку.
  const legacy: LegacyImage[] = [];
  for (const ch of book.characters ?? []) {
    const entityId = ch?.id ? heroByStudioId.get(ch.id) : undefined;
    if (entityId && ch.avatarUrl) legacy.push({ assetUrl: String(ch.avatarUrl), role: 'portrait', entityId });
  }
  for (const ill of book.illustrations ?? []) {
    if (ill?.url && ill.sectionId && seenDocs.has(ill.sectionId) && sectionOf.has(ill.sectionId)) {
      legacy.push({ assetUrl: String(ill.url), role: 'scene', sectionId: ill.sectionId });
    }
  }
  result.assets = await reconcileLegacyAssetLinks(repo, projectId, legacy);
  if (result.assets.linked || result.assets.unlinked) wrote();

  // 5б. «Перевірити» після зміни опису (Т2.3 В5) --------------------------------
  // Опис зовнішності з картки героя змінився — портрети (повний зріст,
  // референси) без версії, звірені зі старим, позначаються; ядро пише
  // сповіщення. Зв'язки без відбитка приймають поточний опис як звірений.
  const cardHashes = new Map<string, string>();
  for (const ch of book.characters ?? []) {
    const entityId = ch?.id ? heroByStudioId.get(ch.id) : undefined;
    if (entityId) cardHashes.set(entityId, cardAppearanceHash(studioAppearanceText(ch)));
  }
  const review = await refreshVisualReview(repo, projectId, (id) => cardHashes.get(id), { reason: 'card' });
  result.assets.review = { flagged: review.flagged, cleared: review.cleared, baselined: review.baselined };
  result.notifications += review.notifications;
  if (review.flagged || review.cleared || review.baselined) wrote();

  // 6. Ревізія, висновки на перегляд, сповіщення -------------------------------
  const touched = [...textChanged.map((p) => p.id), ...deletedIds];
  if (touched.length) {
    result.revision = await repo.bumpProjectRevision(projectId);
    const n = await repo.markFindingsNeedReview(projectId, touched);
    result.findingsNeedReview = n;
    if (n > 0) {
      await repo.addNotification({
        projectId,
        kind: 'findings_need_review',
        message: `Після правки абзаців висновків AI на перегляд: ${n}`,
        paragraphIds: touched,
        payload: { count: n, revision: result.revision },
      });
      result.notifications++;
    }
  } else {
    result.revision = project.revision;
  }
  return result;
}

// ── Задача черги ───────────────────────────────────────────────────────────

export interface CoreSyncDeps {
  repo: () => CoreRepository | null;
  loadBook: (id: string) => Promise<StoredBookForSync | null>;
  /**
   * Після синхронізації, у якій з'явились нові чи змінені абзаци: так
   * server.ts ставить `core_embed` (Т1.2) — вектори лише цих абзаців.
   * Збій тут не робить синхронізацію невдалою.
   */
  afterTextChanged?: (projectId: string, changedParagraphs: number) => Promise<unknown> | void;
}

/** Опис виду задачі `core_sync` для `JobQueue.register`. */
export function coreSyncJobKind(deps: CoreSyncDeps) {
  return {
    maxAttempts: 5,
    handler: async (ctx: {
      job: { projectId: string };
      checkpoint(): Promise<void>;
      setProgress(p: Record<string, unknown>): Promise<void>;
    }) => {
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const stored = await deps.loadBook(ctx.job.projectId);
      if (!stored) return { projectId: ctx.job.projectId, skipped: 'no_book' };
      const result = await syncBookToCore(repo, stored, {
        checkpoint: () => ctx.checkpoint(),
        progress: (done, total) => ctx.setProgress({ done, total, step: 'sections' }),
      });
      const changed = result.paragraphs.created + result.paragraphs.changed;
      if (changed > 0 && deps.afterTextChanged) {
        try {
          await deps.afterTextChanged(ctx.job.projectId, changed);
        } catch (err) {
          console.warn(`[core] після синхронізації ${ctx.job.projectId}: ${(err as Error).message}`);
        }
      }
      return result;
    },
  };
}

/**
 * Поставити синхронізацію після збереження книги. Якщо для книги вже чекає
 * задача — нову не ставимо: та прочитає найсвіжішу книгу, коли дійде черга.
 * Пауза `delayMs` дає кільком автозбереженням поспіль злитися в одну задачу.
 *
 * Не кидає: збій ядра не має ламати збереження книги.
 */
export async function scheduleCoreSync(
  deps: {
    repo: CoreRepository | null;
    queue: {
      enqueue(input: { projectId: string; kind: string; payload?: Record<string, unknown>; delayMs?: number; createdBy: string }): Promise<unknown>;
      store: { list(projectId: string, filter?: { kind?: string; status?: 'queued'; limit?: number }): Promise<unknown[]> };
    } | null;
  },
  book: { id: string; ownerId: string | null; title?: string },
  actor: string,
  delayMs = 3_000,
): Promise<'scheduled' | 'already_queued' | 'skipped'> {
  const { repo, queue } = deps;
  if (!repo || !queue || !book.ownerId) return 'skipped';
  try {
    // Задача прив'язана до проєкту (зовнішній ключ) — проєкт мусить існувати.
    const project = await repo.getProject(book.id);
    if (!project) await repo.upsertProject({ id: book.id, ownerId: book.ownerId, title: String(book.title ?? '').slice(0, 300) });
    const waiting = await queue.store.list(book.id, { kind: CORE_SYNC_KIND, status: 'queued', limit: 1 });
    if (waiting.length) return 'already_queued';
    await queue.enqueue({ projectId: book.id, kind: CORE_SYNC_KIND, payload: {}, delayMs, createdBy: actor });
    return 'scheduled';
  } catch (err) {
    if (!(err instanceof CoreRuleError)) console.warn(`[core] синхронізацію книги ${book.id} не поставлено: ${(err as Error).message}`);
    return 'skipped';
  }
}
