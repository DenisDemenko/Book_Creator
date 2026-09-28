/**
 * AI-2 тлумачить подію очима кожного учасника (Т2.6 В4,
 * `PLAN_CHARACTER_MEMORY.md` §2 п.(б), рішення власника §6 п.2; FLC 2.0 §2).
 *
 * Лише за командою автора, фоновою задачею `ai_memory` з бюджетом проєкту.
 * Один розділ — **окремий виклик на кожного героя-учасника**: у запиті лише
 * абзаци цього розділу й пам'ять САМЕ ЦЬОГО героя станом на сцену (його
 * підтверджене, зокрема приватне). Спільного запиту на двох немає — секрет
 * одного героя не потрапляє в тлумачення іншого (ТЗ-H §5.1 «Не розкривати
 * персонажу секрет іншого героя через спільний prompt»).
 *
 * Що повертає модель (лише пропозиції, `suggested`, з абзацами-доказами
 * цього розділу — `runAiRole` відкидає решту):
 *   memory_recollection — як герой запам'ятав і витлумачив подію (може бути
 *                          хибно — це його правда, не світова);
 *   memory_belief       — переконання, що з'явилось чи змінилось (`truth`:
 *                          false — текст прямо показує, що це неправда);
 *   memory_consequence  — як подія змінила героя: довіра щодо кого, страх,
 *                          нові цілі.
 * Висновок моделі лишається в `analysis_findings` (аудит), спогад —
 * окремий рядок `character_memories` (origin ai, suggested). Підтверджує чи
 * відхиляє автор; до того в пам'ять героя він не йде (В1). Повторний прогін
 * того самого не дублює (ключ повтору за змістом, і відхилене — теж).
 */

import { createHash } from 'node:crypto';
import type { AiRoleDeps, ModelFinding, PreparedFinding } from './ai/roles';
import type { CharacterMemoryRow, CharacterMemoryType, CoreRepository, EntityRow, MemoryEffects } from './types';
import { EVENT_TYPES } from './characterProfile';
import { scanScenes, type TimelineScene } from './timeline';
import { memoriesAt, memoryEvidenceHash } from './characterMemory';

export const AI_MEMORY_JOB_KIND = 'ai_memory';
export const MEMORY_PROPOSAL_FINDING = 'memory_proposal';
export const MEMORY_AI_ACTOR = 'ai:AI-2';
/** Скільки абзаців розділу йде в прогін. */
export const MEMORY_SECTION_MAX = 80;
/** Скільки спогадів героя показати моделі (найсвіжіші). */
export const MEMORY_CONTEXT_MAX = 30;
/** Скільки героїв одного розділу за одну команду. */
export const MEMORY_HEROES_MAX = 6;

const MODEL_KINDS: Record<string, CharacterMemoryType> = {
  memory_recollection: 'recollection',
  memory_belief: 'belief',
  memory_consequence: 'consequence',
};
const norm = (s: string) => s.toLocaleLowerCase('uk').replace(/[\s.,;:!?«»"'()—–-]+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const clampDelta = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-3, Math.min(3, Math.round(n))) : null;
};
export const aiMemoryKey = (sceneId: string, content: string) => `ai:${sceneId}:${createHash('sha256').update(norm(content)).digest('hex').slice(0, 16)}`;

export interface HeroMemoryContext {
  scene: TimelineScene;
  hero: EntityRow;
  current: { id: string; text: string }[];
  truncated: boolean;
  /** Пам'ять героя станом на сцену (його підтверджене) — лише цього героя. */
  memories: CharacterMemoryRow[];
  /** Сутності розділу (для «про кого»). */
  entities: EntityRow[];
  /** Подія розділу, до якої прив'язати спогади (перша з тегів подій). */
  eventId: string | null;
  /** Уже є в цьому розділі в пам'яті героя (будь-який статус, крім замінених) — не повторювати. */
  existing: CharacterMemoryRow[];
}

/** Що бачить AI-2 для одного героя в одному розділі. null — розділу чи героя-учасника немає. */
export async function heroMemoryContext(repo: CoreRepository, projectId: string, sectionId: string, heroId: string): Promise<HeroMemoryContext | null> {
  const scan = await scanScenes(repo, projectId, await repo.listTimePoints(projectId));
  const scene = scan.bySection.get(sectionId);
  const hero = scan.entities.get(heroId);
  if (!scene || !hero || hero.type !== 'character' || !scene.characters.some((c) => c.id === heroId)) return null;
  const own = [...scan.ix.paragraphs.values()]
    .filter((p) => !p.deletedAt && p.documentId === sectionId && p.text.trim())
    .sort((a, b) => a.order - b.order);
  const current = own.slice(0, MEMORY_SECTION_MAX).map((p) => ({ id: p.id, text: p.text }));
  const entityIds = new Set<string>();
  let eventId: string | null = null;
  for (const m of scan.mentions) {
    if (scan.sectionOfParagraph.get(m.paragraphId) !== sectionId) continue;
    entityIds.add(m.entityId);
    if (m.subjectEntityId) entityIds.add(m.subjectEntityId);
    const e = scan.entities.get(m.entityId);
    if (!eventId && e && EVENT_TYPES.has(e.type)) eventId = e.id;
  }
  const entities = [...entityIds].map((id) => scan.entities.get(id)).filter((e): e is EntityRow => !!e);
  const { memories } = await memoriesAt(repo, projectId, heroId, { sceneId: sectionId, scan });
  const existing = (await repo.listCharacterMemories(projectId, { characterId: heroId, simulationId: null, limit: 1000 }))
    .filter((m) => m.sceneId === sectionId && m.status !== 'superseded');
  return { scene, hero, current, truncated: own.length > current.length, memories: memories.slice(0, MEMORY_CONTEXT_MAX), entities, eventId, existing };
}

const TYPE_UK: Record<CharacterMemoryType, string> = { world_fact: 'факт', knowledge: 'знає', belief: 'вірить', recollection: 'пам\'ятає', consequence: 'наслідок' };

/** Завдання AI-2: подія очима одного героя. */
export function heroMemoryTask(c: HeroMemoryContext): string {
  const name = c.hero.name;
  const when = c.scene.time ? `, час світу: ${c.scene.time.label || c.scene.time.start}` : '';
  const others = c.entities.filter((e) => e.type === 'character' && e.id !== c.hero.id).map((e) => e.name);
  const mem = c.memories.map((m) => `- [${TYPE_UK[m.memoryType]}] ${clip(m.content, 240)}`).join('\n');
  const done = c.existing.map((m) => `- ${clip(m.content, 200)} (${m.status})`).join('\n');
  return [
    `Витлумач події розділу «${c.scene.title}» (гл. ${c.scene.chapterNumber ?? '?'}${when}) ОЧИМА героя «${name}» — лише те, що ${name} тут бачив, чув, пережив чи зробив.`,
    `Абзаци ЦЬОГО розділу: ${c.current.map((p) => p.id).join(', ') || '(немає)'}${c.truncated ? ' (розділ довший — дано лише початок)' : ''}.`,
    others.length ? `Інші герої в розділі: ${others.join(', ')}. Їхніх думок ${name} не знає — лише те, що вони сказали чи зробили при ньому.` : '',
    `Тлумачення суб'єктивне: ${name} може помилятися, підозрювати, перебільшувати — це його правда, не світова. Не приписуй йому знань, яких немає ні в абзацах, ні в його пам'яті нижче.`,
    `1) kind "memory_recollection" — як ${name} запам'ятав і витлумачив подію; summary — одним-двома реченнями від третьої особи («${name} вважає, що …»); "about" — імена тих, про кого спогад.`,
    `2) kind "memory_belief" — переконання ${name}, що з'явилось чи змінилось тут (зокрема хибне): summary; "certainty" — "believes" або "doubts"; "truth" — "false", якщо абзаци прямо показують, що це неправда, "true" — якщо прямо підтверджують, інакше "unknown"; "about".`,
    `3) kind "memory_consequence" — як подія змінила ${name}: summary; "trust" — [{"towards": "ім'я", "delta": від -3 до 3}]; "fear_delta" — від -3 до 3; "goals" — нові чи змінені цілі (коротко).`,
    `paragraph_ids — лише абзаци ЦЬОГО розділу, на яких тримається тлумачення; quote — дослівно з них. Не більше 5 висновків. Не вигадуй подій, яких немає в тексті.`,
    mem ? `Що ${name} уже пам'ятає станом на цю сцену (лише його пам'ять):\n${mem}` : `Підтвердженої пам'яті ${name} станом на цю сцену ще немає.`,
    done ? `Уже записано для ${name} у цьому розділі (не повторювати):\n${done}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface MemoryProposalPayload {
  memoryType: CharacterMemoryType;
  aboutEntityIds: string[];
  effects: MemoryEffects;
  truth: 'true' | 'false' | 'unknown';
  beliefStatus: 'believes' | 'doubts';
}

/** Обробка висновків: три види, доказ — абзац цього розділу, без повторів (і без відхиленого раніше). */
export function createMemoryPreparer(c: HeroMemoryContext) {
  const currentIds = new Set(c.current.map((p) => p.id));
  const seen = new Set(c.existing.map((m) => norm(m.content)));
  const byName = new Map(c.entities.map((e) => [e.name.toLocaleLowerCase('uk'), e]));
  const resolve = (names: unknown): string[] =>
    (Array.isArray(names) ? names : typeof names === 'string' ? [names] : [])
      .map((n) => byName.get(String(n).trim().toLocaleLowerCase('uk'))?.id)
      .filter((x): x is string => !!x && x !== c.hero.id);
  return async (f: ModelFinding, evidence: { paragraphIds: string[] }): Promise<PreparedFinding[]> => {
    const memoryType = MODEL_KINDS[f.kind];
    if (!memoryType) return [];
    const own = evidence.paragraphIds.filter((id) => currentIds.has(id));
    const summary = String(f.summary ?? '').trim();
    if (!own.length || !summary || seen.has(norm(summary))) return [];
    seen.add(norm(summary));
    const effects: MemoryEffects = {};
    if (memoryType === 'consequence') {
      const trust = (Array.isArray(f.trust) ? f.trust : [])
        .map((x: any) => ({ towards: resolve([x?.towards])[0], delta: clampDelta(x?.delta) }))
        .filter((x): x is { towards: string; delta: number } => !!x.towards && x.delta !== null && x.delta !== 0);
      if (trust.length) effects.trust = trust;
      const fear = clampDelta(f.fear_delta);
      if (fear) effects.fear = fear;
      const goals = (Array.isArray(f.goals) ? f.goals : []).map((g) => clip(String(g).trim(), 200)).filter(Boolean).slice(0, 5);
      if (goals.length) effects.goals = goals;
    }
    const truth = f.truth === 'false' || f.truth === 'true' ? f.truth : 'unknown';
    const payload: MemoryProposalPayload = {
      memoryType,
      aboutEntityIds: [...new Set([...resolve(f.about), ...(effects.trust ?? []).map((t) => t.towards)])],
      effects,
      truth: memoryType === 'belief' ? truth : 'unknown',
      beliefStatus: f.certainty === 'doubts' ? 'doubts' : 'believes',
    };
    return [{ kind: MEMORY_PROPOSAL_FINDING, entityId: c.hero.id, payload: payload as unknown as Record<string, unknown>, paragraphIds: own }];
  };
}

export interface AiMemoryJobDeps {
  repo: () => CoreRepository | null;
  generate: AiRoleDeps['generate'];
  resolveModel: AiRoleDeps['resolveModel'];
  loadTemplate?: AiRoleDeps['loadTemplate'];
}

export function aiMemoryJobKind(deps: AiMemoryJobDeps) {
  return {
    maxAttempts: 2,
    rateLimit: { max: 20, windowMs: 60_000 },
    handler: async (ctx: {
      job: { projectId: string; payload: Record<string, unknown>; createdBy: string };
      signal: AbortSignal;
      checkpoint(): Promise<void>;
      setProgress(p: Record<string, unknown>): Promise<void>;
      recordUsage(u: { tokens?: number; requests?: number }): Promise<void>;
    }) => {
      const { runAiRole } = await import('./ai/roles');
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const projectId = ctx.job.projectId;
      const sectionId = String(ctx.job.payload.sectionId ?? '');
      const scan = await scanScenes(repo, projectId, await repo.listTimePoints(projectId));
      const scene = scan.bySection.get(sectionId);
      if (!scene) return { status: 'no_section', sectionId };
      const wanted = Array.isArray(ctx.job.payload.characterIds) ? new Set((ctx.job.payload.characterIds as unknown[]).map(String)) : null;
      const heroes = scene.characters.filter((h) => !wanted || wanted.has(h.id)).slice(0, MEMORY_HEROES_MAX);
      if (!heroes.length) return { status: 'no_heroes', sectionId };
      const project = await repo.getProject(projectId);
      const out: { characterId: string; name: string; proposals: number; rejected: number; runId: string | null; status: string }[] = [];
      for (const h of heroes) {
        const c = await heroMemoryContext(repo, projectId, sectionId, h.id);
        if (!c || !c.current.length) {
          out.push({ characterId: h.id, name: h.name, proposals: 0, rejected: 0, runId: null, status: 'nothing' });
          continue;
        }
        await ctx.setProgress({ step: 'model', sectionId, hero: h.name, done: out.length, total: heroes.length });
        await ctx.checkpoint();
        const res = await runAiRole(
          { repo, generate: deps.generate, resolveModel: deps.resolveModel, loadTemplate: deps.loadTemplate, recordUsage: (u) => ctx.recordUsage(u) },
          {
            projectId,
            role: 'AI-2',
            task: heroMemoryTask(c),
            paragraphs: c.current,
            entityId: h.id,
            sourceRevision: project?.revision ?? null,
            createdBy: ctx.job.createdBy,
            signal: ctx.signal,
            prepare: createMemoryPreparer(c),
          },
        );
        if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');
        const hashOf = (id: string) => scan.ix.paragraphs.get(id)?.textHash;
        let proposals = 0;
        for (const f of res.findings) {
          const p = f.payload as unknown as MemoryProposalPayload & { summary?: string };
          const content = clip(String(p.summary ?? '').trim(), 2000);
          if (!content || !p.memoryType) continue;
          const key = aiMemoryKey(sectionId, content);
          if ((await repo.listCharacterMemories(projectId, { characterId: h.id, dedupeKey: key, limit: 5 })).some((m) => m.status !== 'superseded')) continue;
          await repo.addCharacterMemory({
            projectId,
            characterId: h.id,
            memoryType: p.memoryType,
            content,
            aboutEntityIds: p.aboutEntityIds ?? [],
            effects: p.effects ?? {},
            beliefStatus: p.beliefStatus ?? 'believes',
            truth: p.truth ?? 'unknown',
            sourceEventKind: c.eventId ? 'entity' : 'paragraph',
            sourceEventId: c.eventId ?? f.sourceParagraphIds[0] ?? null,
            sourceParagraphIds: f.sourceParagraphIds,
            evidenceHash: memoryEvidenceHash(hashOf, f.sourceParagraphIds),
            sceneId: sectionId,
            storyTime: { label: scene.time?.label ?? null, key: scene.time?.key ?? null, chapter: scene.chapterNumber, narrativeIndex: scene.narrativeIndex },
            canonRevision: project?.revision ?? 0,
            origin: 'ai',
            status: 'suggested',
            dedupeKey: key,
            createdBy: MEMORY_AI_ACTOR,
          });
          proposals++;
        }
        out.push({ characterId: h.id, name: h.name, proposals, rejected: res.rejected.length, runId: res.run.id, status: res.status });
      }
      return { status: 'done', sectionId, heroes: out, proposals: out.reduce((a, h) => a + h.proposals, 0) };
    },
  };
}
