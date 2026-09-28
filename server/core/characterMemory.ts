/**
 * CharacterMemoryService — довготривала суб'єктивна пам'ять героя (Т2.6;
 * `PLAN_CHARACTER_MEMORY.md`; ТЗ-H §5.1, §10; FLC 2.0 §2, §4).
 *
 * В1: ізоляція. Що з пам'яті може бачити герой (його агент, його знімок):
 *   • лише власні записи героя — пам'ять іншого героя, зокрема приватна,
 *     до нього не потрапляє ніколи (ТЗ-H №5);
 *   • спогади канону — лише підтверджені автором (`confirmed`);
 *     «пропозиція», «перевірити», «відхилено», «замінено» — ні (fail closed);
 *   • спогади прогону — лише свого прогону (і там — ще не відхилені):
 *     незатверджене одного прогону не бачить інший (FLC 2.0 §2);
 *   • `reader_knowledge` — ніколи: це знає читач, а не герой.
 *
 * В2: пам'ять із тегів (правила, без AI) і межа знань у часі.
 *   • світовий факт — подія (`EVENT_TYPES`), де герой суб'єкт чи присутній;
 *   • знання — розкриття, де герой суб'єкт;
 *   • переконання — `/belief` героя; наслідок — `/consequence` героя.
 *   Емоції, цілі й стани арки — не пам'ять (це профіль, Т1.5). Повторний збір
 *   не дублює (ключ повтору), а відхилене автором не відроджує.
 *   Записи автора — одразу підтверджені, з відбитком доказів.
 *   `memoriesAt` — пам'ять станом на сцену: лише зі сцен, раніших за неї в
 *   часі світу (без часу — у порядку розкриття; флешбек — за часом, як у
 *   Т2.1), чи станом на главу N; спогади свого прогону — завжди.
 */

import { createHash } from 'node:crypto';
import type { CharacterMemoryInput, CharacterMemoryRow, CharacterMemoryType, CoreActor, CoreRepository, MemoryEffects, MemoryStoryTime, Visibility, MemoryTruth } from './types';
import { CoreRuleError } from './rules';
import { EVENT_TYPES } from './characterProfile';
import { scanScenes, sceneIsBefore, type SceneScan, type TimelineScene } from './timeline';
import { CORE_ENTITIES } from '../../src/utils/coreEntities';

export interface MemoryScope {
  characterId: string;
  /** Прогін, у якому діє герой; без нього — лише канон. */
  simulationId?: string | null;
}

/** Чи бачить герой цей спогад у своєму знімку / агенті (без межі часу — вона в В2). */
export function isVisibleToHero(m: Pick<CharacterMemoryRow, 'characterId' | 'layer' | 'status' | 'simulationId'>, scope: MemoryScope): boolean {
  if (m.characterId !== scope.characterId) return false;
  if (m.layer === 'reader_knowledge') return false;
  if (m.simulationId === null) return m.status === 'confirmed';
  if (!scope.simulationId || m.simulationId !== scope.simulationId) return false;
  return m.status === 'confirmed' || m.status === 'suggested';
}

/** Пам'ять, яку бачить герой: канон (підтверджене) + свій прогін. */
export async function heroMemories(repo: CoreRepository, projectId: string, scope: MemoryScope): Promise<CharacterMemoryRow[]> {
  const canon = await repo.listCharacterMemories(projectId, { characterId: scope.characterId, simulationId: null, status: 'confirmed', limit: 1000 });
  const run = scope.simulationId ? await repo.listCharacterMemories(projectId, { characterId: scope.characterId, simulationId: scope.simulationId, limit: 1000 }) : [];
  return [...canon, ...run].filter((m) => isVisibleToHero(m, scope));
}

// ── В2: відбиток доказів, пам'ять із тегів, межа знань ─────────────────────

/** Відбиток тексту абзаців-доказів: змінився хоч один (чи зник) — інший відбиток (В3). */
export function memoryEvidenceHash(textHashOf: (paragraphId: string) => string | null | undefined, paragraphIds: string[]): string | null {
  if (!paragraphIds.length) return null;
  const parts = [...new Set(paragraphIds)].sort().map((id) => `${id}:${textHashOf(id) ?? 'deleted'}`);
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

const storyTimeOf = (sc: TimelineScene | undefined): MemoryStoryTime =>
  sc ? { label: sc.time?.label ?? null, key: sc.time?.key ?? null, chapter: sc.chapterNumber, narrativeIndex: sc.narrativeIndex } : {};

const TYPE_LABEL = new Map(CORE_ENTITIES.map((e) => [e.slug, e.nameUk]));
export const TAG_MEMORY_ACTOR = 'system:memory-tags';

export interface TagMemoryResult {
  created: number;
  unchanged: number;
  /** Автор відхилив — не відроджуємо. */
  skippedRejected: number;
  byType: Record<CharacterMemoryType, number>;
}

/**
 * Зібрати пам'ять героя (чи всіх героїв) із тегів книги. Без AI; повторний
 * збір не дублює. Спогад, який автор відхилив, лишається відхиленим.
 */
export async function collectTagMemories(repo: CoreRepository, projectId: string, opts: { characterId?: string; actor?: CoreActor } = {}): Promise<TagMemoryResult> {
  const project = await repo.getProject(projectId);
  if (!project) throw new CoreRuleError('not_found', `Проєкт «${projectId}»`);
  const scan = await scanScenes(repo, projectId, await repo.listTimePoints(projectId));
  const heroes = [...scan.entities.values()].filter((e) => e.type === 'character' && (!opts.characterId || e.id === opts.characterId));
  if (opts.characterId && !heroes.length) throw new CoreRuleError('not_found', 'Героя не знайдено в ядрі книги');
  const textHash = (id: string) => scan.ix.paragraphs.get(id)?.deletedAt ? null : scan.ix.paragraphs.get(id)?.textHash;
  const out: TagMemoryResult = { created: 0, unchanged: 0, skippedRejected: 0, byType: { world_fact: 0, knowledge: 0, belief: 0, recollection: 0, consequence: 0 } };
  for (const hero of heroes) {
    const existing = new Map<string, CharacterMemoryRow>();
    for (const m of await repo.listCharacterMemories(projectId, { characterId: hero.id, limit: 1000 })) {
      if (m.dedupeKey && m.status !== 'superseded' && !existing.has(m.dedupeKey)) existing.set(m.dedupeKey, m);
    }
    const heroScenes = new Set(scan.scenes.filter((sc) => sc.characters.some((c) => c.id === hero.id)).map((sc) => sc.sectionId));
    const wanted = new Map<string, CharacterMemoryInput>();
    for (const m of scan.mentions) {
      const e = scan.entities.get(m.entityId);
      const sectionId = scan.sectionOfParagraph.get(m.paragraphId);
      if (!e || !sectionId) continue;
      const subject = m.subjectEntityId === hero.id;
      let type: CharacterMemoryType | null = null;
      if (e.type === 'revelation' && subject) type = 'knowledge';
      else if (e.type === 'belief' && subject) type = 'belief';
      else if (e.type === 'consequence' && subject) type = 'consequence';
      else if (EVENT_TYPES.has(e.type) && e.type !== 'revelation' && e.type !== 'consequence' && (subject || heroScenes.has(sectionId))) type = 'world_fact';
      else if ((e.type === 'revelation' || e.type === 'consequence') && heroScenes.has(sectionId)) type = 'world_fact';
      if (!type) continue;
      const key = `tag:${type}:${e.id}:${sectionId}`;
      const value = String((m.fields as { value?: unknown })?.value ?? '').trim();
      const label = TYPE_LABEL.get(e.type) ?? e.type;
      const prev = wanted.get(key);
      if (prev) {
        if (!prev.sourceParagraphIds!.includes(m.paragraphId)) prev.sourceParagraphIds!.push(m.paragraphId);
        continue;
      }
      wanted.set(key, {
        projectId,
        characterId: hero.id,
        memoryType: type,
        content: `${label}: ${e.name}${value && value !== e.name ? ` — ${value}` : ''}`.slice(0, 2000),
        aboutEntityIds: [e.id],
        beliefStatus: type === 'belief' || type === 'consequence' ? 'believes' : 'knows',
        truth: type === 'knowledge' || type === 'world_fact' ? 'true' : 'unknown',
        sourceEventKind: 'entity',
        sourceEventId: e.id,
        sourceParagraphIds: [m.paragraphId],
        sceneId: sectionId,
        storyTime: storyTimeOf(scan.bySection.get(sectionId)),
        canonRevision: project.revision,
        origin: 'tag',
        dedupeKey: key,
        createdBy: opts.actor ?? TAG_MEMORY_ACTOR,
      });
    }
    for (const [key, input] of wanted) {
      const prev = existing.get(key);
      if (prev) {
        if (prev.status === 'rejected') out.skippedRejected++;
        else out.unchanged++;
        continue;
      }
      input.evidenceHash = memoryEvidenceHash(textHash, input.sourceParagraphIds!);
      await repo.addCharacterMemory(input);
      out.created++;
      out.byType[input.memoryType]++;
    }
  }
  return out;
}

export interface AuthorMemoryInput {
  projectId: string;
  characterId: string;
  memoryType: CharacterMemoryType;
  content: string;
  sceneId?: string | null;
  sourceParagraphIds?: string[];
  aboutEntityIds?: string[];
  effects?: MemoryEffects;
  truth?: MemoryTruth;
  visibility?: Visibility;
  layer?: CharacterMemoryInput['layer'];
  actor: CoreActor;
}

/** Спогад, який вписав автор: одразу підтверджений, з відбитком доказів і часом сцени. */
export async function addAuthorMemory(repo: CoreRepository, input: AuthorMemoryInput): Promise<CharacterMemoryRow> {
  if (!input.actor.startsWith('user:')) throw new CoreRuleError('bad_input', 'Спогад автора — лише від користувача');
  const project = await repo.getProject(input.projectId);
  if (!project) throw new CoreRuleError('not_found', `Проєкт «${input.projectId}»`);
  const hero = await repo.getEntity(input.projectId, input.characterId);
  if (!hero || hero.status === 'rejected' || hero.type !== 'character') throw new CoreRuleError('not_found', 'Героя не знайдено в ядрі книги');
  const scan = await scanScenes(repo, input.projectId, await repo.listTimePoints(input.projectId));
  const sceneId = input.sceneId ?? null;
  if (sceneId && !scan.bySection.has(sceneId)) throw new CoreRuleError('not_found', `Сцену «${sceneId}» не знайдено`);
  const paras = [...new Set(input.sourceParagraphIds ?? [])];
  for (const id of paras) if (!scan.sectionOfParagraph.has(id)) throw new CoreRuleError('not_found', `Абзац «${id}» не знайдено`);
  const textHash = (id: string) => scan.ix.paragraphs.get(id)?.textHash;
  return repo.addCharacterMemory({
    projectId: input.projectId,
    characterId: input.characterId,
    memoryType: input.memoryType,
    layer: input.layer,
    content: input.content,
    aboutEntityIds: input.aboutEntityIds,
    effects: input.effects,
    truth: input.truth,
    visibility: input.visibility,
    sourceEventKind: paras.length ? 'paragraph' : 'author',
    sourceEventId: paras[0] ?? null,
    sourceParagraphIds: paras,
    evidenceHash: memoryEvidenceHash(textHash, paras),
    sceneId: sceneId ?? (paras.length ? scan.sectionOfParagraph.get(paras[0]) ?? null : null),
    storyTime: storyTimeOf(scan.bySection.get(sceneId ?? (paras.length ? scan.sectionOfParagraph.get(paras[0]) ?? '' : ''))),
    canonRevision: project.revision,
    origin: 'author',
    createdBy: input.actor,
  });
}

export interface MemoriesAt {
  memories: CharacterMemoryRow[];
  /** Скільки підтвердженого герой дізнається пізніше (без змісту — для автора). */
  later: number;
}

/**
 * Пам'ять героя станом на сцену (чи главу N): ізоляція В1 + межа знань у
 * часі (КРИТЕРІЙ ТЗ-H №5). Спогад без сцени (передісторія) — завжди;
 * спогад зі сцени, якої вже немає в книзі, — ні (fail closed); спогади
 * свого прогону — завжди (прогін і є «тепер»).
 */
export async function memoriesAt(
  repo: CoreRepository,
  projectId: string,
  characterId: string,
  opts: { sceneId?: string | null; asOfChapter?: number | null; simulationId?: string | null; studioOrder?: Map<string, number>; scan?: SceneScan } = {},
): Promise<MemoriesAt> {
  const all = await heroMemories(repo, projectId, { characterId, simulationId: opts.simulationId });
  if (!opts.sceneId && opts.asOfChapter == null) return { memories: all, later: 0 };
  const scan = opts.scan ?? (await scanScenes(repo, projectId, await repo.listTimePoints(projectId), opts.studioOrder));
  const target = opts.sceneId ? scan.bySection.get(opts.sceneId) : undefined;
  if (opts.sceneId && !target) throw new CoreRuleError('not_found', `Сцену «${opts.sceneId}» не знайдено`);
  const known: CharacterMemoryRow[] = [];
  let later = 0;
  for (const m of all) {
    if (m.simulationId) {
      known.push(m);
      continue;
    }
    if (!m.sceneId) {
      known.push(m);
      continue;
    }
    const sc = scan.bySection.get(m.sceneId);
    if (!sc) continue;
    const inChapter = opts.asOfChapter == null || (sc.chapterNumber ?? Infinity) <= opts.asOfChapter;
    const inTime = !target || sceneIsBefore(sc, target);
    if (inChapter && inTime) known.push(m);
    else later++;
  }
  return { memories: known, later };
}
