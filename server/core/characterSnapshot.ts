/**
 * CharacterSnapshotBuilder — знімок героя станом на сцену (Т2.6 В5,
 * `PLAN_CHARACTER_MEMORY.md`; ТЗ-H §6.1, §8 п.3, §16 п.2; FLC 2.0 §2).
 *
 * Джерела: профіль героя (Т1.5) — канон автора, підтверджені факти з
 * доказами, стани, зв'язки, появи; знання в часі (Т2.1) і пам'ять героя
 * (`memoriesAt`, Т2.6 В1–В4) — лише його, лише підтверджене канону й свого
 * прогону, лише зі сцен, раніших за цю.
 *
 * Межа знань (КРИТЕРІЙ ТЗ-H №5). Профіль вміє «станом на главу», а сцена
 * тонша: усе з самої сцени й пізніших сцен (у часі світу; без часу — у
 * порядку розкриття) із профілю прибирається — появи, факти, стани,
 * зв'язки з доказами лише звідти.
 *
 * Ліміт Jev. `jevState(snapshot)` має вміститися в бюджет символів
 * (`SNAPSHOT_BUDGET_CHARS`); інакше спершу відкидаються давніші появи, потім
 * давніші спогади, потім давніші переконання — канон автора й підтверджені
 * факти ніколи. Що й скільки відкинуто — у відповіді.
 *
 * `character_states`: стан героя на сцену (цілі, емоції, переконання,
 * стосунки, взяті спогади, відбиток знімка) — кеш за героєм + сценою +
 * прогоном + ревізією книги: той самий відбиток — той самий запис.
 */

import type { CharacterMemoryRow, CharacterStateRow, CoreActor, CoreRepository, EntityRow } from './types';
import { CoreRuleError } from './rules';
import { buildCharacterProfile, type CharacterProfile, type ProfilePlace, type StudioCharacterLike } from './characterProfile';
import { snapshotFromProfile } from './flc/cycle';
import { memoriesAt } from './characterMemory';
import { scanScenes, sceneIsBefore } from './timeline';
import { snapshotHash, validateSnapshot, type CharacterSnapshot } from '../ai/contracts';
import { jevState } from '../ai/adapters/jev';

/** Бюджет компактного стану для Jev (символи JSON; ліміт стану Jev — 32k токенів, беремо з великим запасом). */
export const SNAPSHOT_BUDGET_CHARS = 12_000;
export const SNAPSHOT_ACTOR = 'system:snapshot';

export interface SnapshotRequest {
  projectId: string;
  characterId: string;
  /** Сцена (розділ книги): знімок — станом на її початок. */
  sceneId?: string | null;
  /** Межа знань за главами (разом зі сценою — діють обидві). */
  asOfChapter?: number | null;
  /** Прогін: його спогади теж у знімку (лише свого). */
  simulationId?: string | null;
  situation: string;
  allowedActions: string[];
  studio?: { character: StudioCharacterLike | null; all: StudioCharacterLike[] };
  /** Сцени немає в книзі (сцена прогону) — не помилка, а знімок без межі сцени. */
  lenientScene?: boolean;
  budgetChars?: number;
  /** Записати стан героя на сцену (`character_states`) від цього актора. */
  persist?: CoreActor | null;
}

export interface SnapshotResult {
  snapshot: CharacterSnapshot;
  hash: string;
  /** Спогади, що увійшли до знімка. */
  memoryIds: string[];
  /** Скільки герой дізнається пізніше (без змісту). */
  later: number;
  trimmed: { appearances: number; memories: number; beliefs: number };
  jevStateChars: number;
  budgetChars: number;
  state: CharacterStateRow | null;
  /** Стан узято з кешу (`character_states`) — той самий відбиток. */
  stateReused: boolean;
  sceneApplied: boolean;
}

const MEMORY_TYPES = new Set(['world_fact', 'knowledge', 'recollection', 'consequence']);

export async function buildCharacterSnapshot(repo: CoreRepository, req: SnapshotRequest): Promise<SnapshotResult> {
  const entity: EntityRow | null = await repo.getEntity(req.projectId, req.characterId);
  if (!entity || entity.status === 'rejected' || entity.type !== 'character') throw new CoreRuleError('not_found', 'Героя не знайдено в ядрі книги');
  const scan = await scanScenes(repo, req.projectId, await repo.listTimePoints(req.projectId));
  let target = req.sceneId ? scan.bySection.get(req.sceneId) : undefined;
  if (req.sceneId && !target && !req.lenientScene) throw new CoreRuleError('not_found', `Сцену «${req.sceneId}» не знайдено`);
  const upto = req.asOfChapter != null && req.asOfChapter >= 1 ? Math.floor(req.asOfChapter) : null;
  const profileUpto = target ? Math.min(target.chapterNumber ?? Infinity, upto ?? Infinity) : upto;
  const profile = await buildCharacterProfile(repo, req.projectId, req.characterId, { upto: Number.isFinite(profileUpto) ? (profileUpto as number) : null, studio: req.studio });
  if (!profile) throw new CoreRuleError('not_found', 'Героя не знайдено в ядрі книги');

  // Межа сцени: прибрати з профілю все з самої сцени й пізніших.
  const allowed = (sectionId: string | undefined | null) => {
    if (!target || !sectionId) return true;
    const sc = scan.bySection.get(sectionId);
    return !!sc && sceneIsBefore(sc, target);
  };
  const okPlace = (p: ProfilePlace | null) => !p || allowed(p.sectionId);
  const scoped: CharacterProfile = target
    ? {
        ...profile,
        appearances: { total: profile.appearances.total, items: profile.appearances.items.filter((p) => allowed(p.sectionId)) },
        arc: { initial: profile.arc.initial.filter((i) => okPlace(i.place)), intermediate: profile.arc.intermediate.filter((i) => okPlace(i.place)), current: profile.arc.current.filter((i) => okPlace(i.place)) },
        relations: profile.relations.filter((r) => !r.sources.length || r.sources.some((s) => allowed(s.sectionId))),
        facts: { ...profile.facts, confirmed: profile.facts.confirmed.filter((f) => f.sources.length && f.sources.every((s) => allowed(s.sectionId))) },
      }
    : profile;
  const base = snapshotFromProfile(scoped, [], req.situation, req.allowedActions);
  if (target) base.as_of_chapter = target.chapterNumber ?? base.as_of_chapter;

  // Пам'ять героя станом на сцену.
  const at = await memoriesAt(repo, req.projectId, req.characterId, { sceneId: target?.sectionId ?? null, asOfChapter: upto, simulationId: req.simulationId, scan });
  const order = (m: CharacterMemoryRow) => {
    const sc = m.sceneId ? scan.bySection.get(m.sceneId) : undefined;
    return sc ? (sc.time?.key ?? 0) * 1e6 + sc.narrativeIndex : -1;
  };
  const mems = [...at.memories].sort((a, b) => order(a) - order(b) || a.createdAt.localeCompare(b.createdAt));
  const beliefRows = mems.filter((m) => m.memoryType === 'belief' && m.beliefStatus !== 'abandoned');
  const memoryRows = mems.filter((m) => MEMORY_TYPES.has(m.memoryType));
  let beliefs = beliefRows.slice(-20);
  let memories = memoryRows.slice(-30);
  let appearances = base.recent_appearances;
  const trimmed = { appearances: 0, memories: beliefRows.length - beliefs.length + memoryRows.length - memories.length, beliefs: 0 };
  trimmed.beliefs = beliefRows.length - beliefs.length;
  trimmed.memories = memoryRows.length - memories.length;
  const compose = (): CharacterSnapshot => ({
    ...base,
    recent_appearances: appearances,
    ...(beliefs.length ? { beliefs: beliefs.map((b) => ({ statement: b.content, certainty: b.beliefStatus === 'doubts' ? 'doubts' as const : 'believes' as const, scene: b.sceneId })) } : {}),
    ...(memories.length
      ? { memories: memories.map((m) => ({ type: m.memoryType as 'world_fact' | 'knowledge' | 'recollection' | 'consequence', content: m.content, scene: m.sceneId, ...(Object.keys(m.effects ?? {}).length ? { effects: m.effects as Record<string, unknown> } : {}) })) }
      : {}),
  });
  const budget = req.budgetChars ?? SNAPSHOT_BUDGET_CHARS;
  let snapshot = compose();
  let size = JSON.stringify(jevState(snapshot)).length;
  while (size > budget) {
    // Давніші появи → давніші спогади → давніші переконання; канон і факти — ніколи.
    if (appearances.length > 0) {
      appearances = appearances.slice(1);
      trimmed.appearances++;
    } else if (memories.length > 0) {
      memories = memories.slice(1);
      trimmed.memories++;
    } else if (beliefs.length > 0) {
      beliefs = beliefs.slice(1);
      trimmed.beliefs++;
    } else break;
    snapshot = compose();
    size = JSON.stringify(jevState(snapshot)).length;
  }
  const check = validateSnapshot(snapshot);
  if (!check.ok) throw new Error(`Знімок героя не відповідає контракту: ${check.errors.join('; ')}`);
  const hash = snapshotHash(snapshot);
  const memoryIds = [...beliefs, ...memories].map((m) => m.id);

  let state: CharacterStateRow | null = null;
  let stateReused = false;
  if (req.persist) {
    const project = await repo.getProject(req.projectId);
    const key = { characterId: req.characterId, sceneId: target?.sectionId ?? null, simulationId: req.simulationId ?? null, canonRevision: project?.revision ?? 0 };
    const prev = await repo.getCharacterState(req.projectId, key);
    if (prev && prev.snapshotHash === hash) {
      state = prev;
      stateReused = true;
    } else {
      state = await repo.addCharacterState({
        projectId: req.projectId,
        ...key,
        goals: snapshot.current_states.filter((s) => s.type === 'goal' || s.type === 'need').map((s) => ({ type: s.type, name: s.name })),
        emotions: snapshot.current_states.filter((s) => s.type === 'emotion' || s.type === 'character-state').map((s) => ({ type: s.type, name: s.name })),
        beliefs: (snapshot.beliefs ?? []).map((b, i) => ({ id: beliefs[i].id, statement: b.statement, certainty: b.certainty })),
        relationships: snapshot.relations.map((r) => ({ label: r.label, other: r.other, direction: r.direction })),
        memoryIds,
        stateVersion: prev ? prev.stateVersion + 1 : 1,
        snapshotHash: hash,
        createdBy: req.persist,
      });
    }
  }
  return {
    snapshot,
    hash,
    memoryIds,
    later: at.later,
    trimmed,
    jevStateChars: size,
    budgetChars: budget,
    state,
    stateReused,
    sceneApplied: !!target,
  };
}
