/**
 * Пропозиції допиту в канон (Т2.7 В4, `PLAN_INTERVIEW.md` §2 «Прийняття в
 * канон», рішення власника §6 п.2; FLC 2.0 §7 критерії 1, 4, 5; П7).
 *
 * Голос героя лише ПРОПОНУЄ (`canon_proposals`, статус `pending`); автор
 * приймає кожен результат окремо або відхиляє:
 *   memory   → спогад канону героя (як записаний автором), джерело — хід
 *              допиту, доказ — абзаци сцени допиту: правка сцени його
 *              інвалідує (`refreshMemoryReview`, критерій 5);
 *   fact     → факт профілю (`profile_fact`) з позначкою «гіпотеза з
 *              допиту», статус «пропозиція», доки автор не підтвердить його
 *              в профілі (критерій 1); доказ — ті самі абзаци сцени;
 *   fragment → чистий текст (теги з тексту прибрано ще при створенні, П7) у
 *              вибраний розділ як «AI-чернетка» `[AI-DRAFT]…[/AI-DRAFT]`;
 *   tag      → тег до фрагмента (П7): приймається разом із фрагментом
 *              (дописується в кінець фрагмента) чи окремо пізніше.
 * Рукопис сервер не змінює: для фрагмента й тегу він повертає, ЩО вставити
 * й КУДИ (`insert`), а вставляє редактор книги (В5) — тим самим шляхом, що
 * решта AI-чернеток, тож текст потрапляє в книгу поміченим, а не каноном.
 *
 * Застарілий допит (критерій 5): межа знань допиту — сцена (чи глава, якщо
 * сцени немає). Її відбиток (абзаци й текст) записано на старті; змінилась
 * сцена — допит «застарів» (`stale`): нових ходів немає, а прийняти його
 * пропозицію можна лише явно («усе одно прийняти», `acknowledgeStale`).
 * Позначає і синхронізація (`refreshInterviewStaleness` у core_sync, зі
 * сповіщенням), і сам допит при зверненні (якщо синхронізація була раніше).
 */

import { createHash } from 'node:crypto';
import type { CanonProposalRow, CharacterMemoryRow, CharacterMemoryType, CoreActor, CoreRepository, FindingRow, SimulationRow } from './types';
import { CoreRuleError } from './rules';
import { scanScenes, type SceneScan } from './timeline';
import { addAuthorMemory } from './characterMemory';
import { PROFILE_FACT, PROFILE_FIELDS } from './characterProfile';
import { parseEntityTags, stripEntityTags } from '../../src/utils/coreEntities';

export const PROPOSAL_ACTOR = 'ai:character-voice';
export const MAX_MEMORY_PROPOSALS = 3;
export const MAX_FACT_PROPOSALS = 3;
export const MAX_TAG_PROPOSALS = 12;
/** Скільки абзаців сцени йде доказом спогаду чи факту (правило пам'яті — до 200). */
const MAX_EVIDENCE = 200;
const PROPOSAL_MEMORY_TYPES: CharacterMemoryType[] = ['recollection', 'belief', 'consequence'];
const FIELD_KEYS = new Set(PROFILE_FIELDS.map((f) => f.key));

export const AI_DRAFT_OPEN = '[AI-DRAFT]';
export const AI_DRAFT_CLOSE = '[/AI-DRAFT]';

// ── Межа допиту і «застарів» ────────────────────────────────────────────────

/** Абзаци межі допиту: сцени (розділу), а без сцени — глави межі знань; без обох — null (не застаріває). */
export function interviewBoundaryParagraphs(scan: SceneScan, sim: Pick<SimulationRow, 'sceneId' | 'asOfChapter'>): string[] | null {
  let sections: Set<string>;
  if (sim.sceneId) sections = new Set([sim.sceneId]);
  else if (sim.asOfChapter != null) sections = new Set(scan.scenes.filter((s) => s.chapterNumber === sim.asOfChapter).map((s) => s.sectionId));
  else return null;
  return [...scan.ix.paragraphs.values()]
    .filter((p) => !p.deletedAt && sections.has(p.documentId))
    .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.order - b.order || a.id.localeCompare(b.id))
    .map((p) => p.id);
}

/** Відбиток межі: які абзаци й з яким текстом (додали, видалили, змінили — інший відбиток). */
export function interviewBoundaryHash(scan: SceneScan, sim: Pick<SimulationRow, 'sceneId' | 'asOfChapter'>): string | null {
  const ids = interviewBoundaryParagraphs(scan, sim);
  if (ids == null) return null;
  const parts = ids.map((id) => `${id}:${scan.ix.paragraphs.get(id)!.textHash}`);
  return createHash('sha256').update(`${sim.sceneId ?? ''}|${sim.asOfChapter ?? ''}|${parts.join('|')}`).digest('hex').slice(0, 32);
}

const boundaryOf = (sim: SimulationRow): string | null => {
  const h = (sim.config as { boundaryHash?: unknown }).boundaryHash;
  return typeof h === 'string' && h ? h : null;
};

/** Чи змінилась межа допиту; змінилась — позначити «застарів». Повертає актуальний прогін. */
export async function refreshSimulationFreshness(repo: CoreRepository, sim: SimulationRow, scan?: SceneScan): Promise<SimulationRow> {
  if (sim.kind !== 'interview' || (sim.status !== 'active' && sim.status !== 'paused')) return sim;
  const saved = boundaryOf(sim);
  if (!saved) return sim;
  const s = scan ?? (await scanScenes(repo, sim.projectId, await repo.listTimePoints(sim.projectId)));
  if (interviewBoundaryHash(s, sim) === saved) return sim;
  return repo.updateSimulation(sim.projectId, sim.id, { status: 'stale' });
}

export interface StalenessResult {
  stale: number;
  notifications: number;
}

/** Після синхронізації (core_sync): допити, чию сцену змінено, — «застарів», по сповіщенню на героя. */
export async function refreshInterviewStaleness(repo: CoreRepository, projectId: string, opts: { revision?: number } = {}): Promise<StalenessResult> {
  const out: StalenessResult = { stale: 0, notifications: 0 };
  const live = [
    ...(await repo.listSimulations(projectId, { kind: 'interview', status: 'active', limit: 500 })),
    ...(await repo.listSimulations(projectId, { kind: 'interview', status: 'paused', limit: 500 })),
  ].filter((s) => boundaryOf(s));
  if (!live.length) return out;
  const scan = await scanScenes(repo, projectId, await repo.listTimePoints(projectId));
  const byHero = new Map<string, SimulationRow[]>();
  for (const sim of live) {
    const next = await refreshSimulationFreshness(repo, sim, scan);
    if (next.status !== 'stale') continue;
    out.stale++;
    byHero.set(sim.characterId!, [...(byHero.get(sim.characterId!) ?? []), sim]);
  }
  for (const [heroId, list] of byHero) {
    const name = scan.entities.get(heroId)?.name ?? '?';
    const pending = (await repo.listCanonProposals(projectId, { characterId: heroId, status: 'pending', limit: 1000 })).filter((p) => list.some((s) => s.id === p.simulationId)).length;
    await repo.addNotification({
      projectId,
      kind: 'interviews_stale',
      message: `Сцену змінено — допити героя «${name}» застаріли: ${list.length}${pending ? ` (неприйнятих пропозицій: ${pending})` : ''}`,
      paragraphIds: [],
      payload: { characterId: heroId, simulationIds: list.map((s) => s.id), sceneIds: [...new Set(list.map((s) => s.sceneId).filter(Boolean))], pending, revision: opts.revision ?? null },
    });
    out.notifications++;
  }
  return out;
}

// ── Створення пропозицій з відповіді голосу ─────────────────────────────────

export interface VoiceProposals {
  memories?: { type?: string; content: string }[];
  facts?: { statement: string; field?: string }[];
  fragment?: { text?: string; tags?: string[] };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Тег П7: рівно один тег книги з реєстру, без нічого довкола. */
export function validProposalTag(raw: unknown): string | null {
  const tag = String(raw ?? '').trim();
  if (!tag || tag.length > 300) return null;
  const found = parseEntityTags(tag);
  if (found.length !== 1 || found[0].start !== 0 || found[0].end !== tag.length || !found[0].entity || !found[0].value) return null;
  return tag;
}

/** Чистий текст фрагмента (П7): без тегів, абзаци через порожній рядок. */
export function cleanFragmentText(raw: unknown): string {
  return String(raw ?? '')
    .split(/\n\s*\n/)
    .map((p) => stripEntityTags(p).replace(/\[\/?AI-DRAFT\]/g, '').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 6000);
}

export interface CreatedProposals {
  proposals: CanonProposalRow[];
  /** Що відкинуто (повтор у цьому допиті, тег не з реєстру тощо) — для журналу ходу. */
  dropped: number;
}

/**
 * Пропозиції з відповіді голосу (хід `turn`, джерела — питання й відповідь):
 * до 3 спогадів і 3 фактів, фрагмент і до 12 тегів до нього. Те, що вже
 * пропонувалось у цьому допиті (і не відхилено), — не дублюється.
 */
export async function createProposals(
  repo: CoreRepository,
  sim: SimulationRow,
  input: { turn: number; sourceEventIds: string[]; proposals: VoiceProposals | undefined },
): Promise<CreatedProposals> {
  const out: CreatedProposals = { proposals: [], dropped: 0 };
  const p = input.proposals ?? {};
  const heroId = sim.characterId!;
  const prior = (await repo.listCanonProposals(sim.projectId, { simulationId: sim.id, limit: 1000 })).filter((x) => x.status !== 'rejected');
  const seen = new Set(prior.map((x) => `${x.kind}:${norm(String((x.proposedChange as { content?: unknown; statement?: unknown; text?: unknown; tag?: unknown }).content ?? (x.proposedChange as any).statement ?? (x.proposedChange as any).text ?? (x.proposedChange as any).tag ?? ''))}`));
  const add = async (kind: CanonProposalRow['kind'], key: string, change: Record<string, unknown>, parentId?: string) => {
    const k = `${kind}:${norm(key)}`;
    if (seen.has(k) && kind !== 'tag') {
      out.dropped++;
      return null;
    }
    seen.add(k);
    const row = await repo.addCanonProposal({
      projectId: sim.projectId,
      simulationId: sim.id,
      characterId: heroId,
      kind,
      proposedChange: { ...change, turn: input.turn },
      sourceEventIds: input.sourceEventIds,
      parentId: parentId ?? null,
      createdBy: PROPOSAL_ACTOR,
    });
    out.proposals.push(row);
    return row;
  };

  const memories = Array.isArray(p.memories) ? p.memories : [];
  for (const m of memories.slice(0, MAX_MEMORY_PROPOSALS)) {
    const content = String(m?.content ?? '').trim().slice(0, 2000);
    if (!content) {
      out.dropped++;
      continue;
    }
    const memoryType = PROPOSAL_MEMORY_TYPES.includes(m.type as CharacterMemoryType) ? (m.type as CharacterMemoryType) : 'recollection';
    await add('memory', content, { memoryType, content });
  }
  out.dropped += Math.max(0, memories.length - MAX_MEMORY_PROPOSALS);

  const facts = Array.isArray(p.facts) ? p.facts : [];
  for (const f of facts.slice(0, MAX_FACT_PROPOSALS)) {
    const statement = String(f?.statement ?? '').trim().slice(0, 1000);
    if (!statement) {
      out.dropped++;
      continue;
    }
    const field = typeof f.field === 'string' && FIELD_KEYS.has(f.field) ? f.field : 'other';
    await add('fact', statement, { statement, field });
  }
  out.dropped += Math.max(0, facts.length - MAX_FACT_PROPOSALS);

  const text = cleanFragmentText(p.fragment?.text);
  if (text) {
    const frag = await add('fragment', text, { text });
    if (frag) {
      const tags = [...new Set((Array.isArray(p.fragment?.tags) ? p.fragment!.tags! : []).map(validProposalTag))];
      const rawCount = Array.isArray(p.fragment?.tags) ? p.fragment!.tags!.length : 0;
      const ok = tags.filter((x): x is string => !!x).slice(0, MAX_TAG_PROPOSALS);
      for (const tag of ok) await add('tag', `${frag.id}:${tag}`, { tag }, frag.id);
      out.dropped += rawCount - ok.length;
    }
  } else if (p.fragment?.text) out.dropped++;
  return out;
}

// ── Рішення автора ──────────────────────────────────────────────────────────

export interface AcceptInput {
  projectId: string;
  proposalId: string;
  actor: CoreActor;
  /** Фрагмент: розділ книги, куди вставити «AI-чернетку». */
  sectionId?: string | null;
  /** Фрагмент: які теги (П7) прийняти разом із ним; решта лишається пропозиціями. */
  tagIds?: string[];
  /** Автор виправив зміст перед прийняттям (спогад, факт, фрагмент). */
  content?: string | null;
  /** Факт: поле профілю (типово — з пропозиції). */
  field?: string | null;
  /** Спогад: вид (спогад / переконання / наслідок). */
  memoryType?: string | null;
  /** Допит застарів — прийняти все одно (автор знає, що сцену змінено). */
  acknowledgeStale?: boolean;
}

export interface ProposalInsert {
  sectionId: string;
  /** Що вставити: фрагмент — блоком «AI-чернетка»; тег — дописати до вставленого фрагмента. */
  mode: 'ai_draft' | 'append_tag';
  snippet: string;
}

export interface AcceptOutcome {
  proposal: CanonProposalRow;
  /** Теги, прийняті разом із фрагментом. */
  tags: CanonProposalRow[];
  memory?: CharacterMemoryRow;
  fact?: FindingRow;
  insert?: ProposalInsert;
}

async function proposalOrThrow(repo: CoreRepository, projectId: string, id: string): Promise<CanonProposalRow> {
  const p = await repo.getCanonProposal(projectId, id);
  if (!p) throw new CoreRuleError('not_found', 'Пропозицію не знайдено');
  return p;
}

function authorOnly(actor: CoreActor) {
  if (!actor.startsWith('user:')) throw new CoreRuleError('confirmed_is_author_only', 'Приймає й відхиляє пропозиції допиту лише автор');
}

/** Абзаци сцени допиту — доказ прийнятого спогаду й факту (без сцени — без доказу). */
function sceneEvidence(scan: SceneScan, sim: SimulationRow): string[] {
  if (!sim.sceneId) return [];
  return (interviewBoundaryParagraphs(scan, { sceneId: sim.sceneId, asOfChapter: null }) ?? []).slice(0, MAX_EVIDENCE);
}

export async function acceptProposal(repo: CoreRepository, input: AcceptInput): Promise<AcceptOutcome> {
  authorOnly(input.actor);
  const p = await proposalOrThrow(repo, input.projectId, input.proposalId);
  if (p.status !== 'pending') throw new CoreRuleError('conflict', p.status === 'accepted' ? 'Пропозицію вже прийнято' : 'Пропозицію вже відхилено');
  let sim = await repo.getSimulation(input.projectId, p.simulationId);
  if (!sim) throw new CoreRuleError('not_found', 'Допит пропозиції не знайдено');
  const scan = await scanScenes(repo, input.projectId, await repo.listTimePoints(input.projectId));
  sim = await refreshSimulationFreshness(repo, sim, scan);
  if (sim.status === 'stale' && !input.acknowledgeStale) {
    throw new CoreRuleError('conflict', 'Сцену допиту змінено — допит застарів. Прийняти все одно? (acknowledgeStale)');
  }
  const change = p.proposedChange as Record<string, unknown>;
  const edited = input.content != null && String(input.content).trim() !== '';
  const base = { simulationId: sim.id, proposalId: p.id, stale: sim.status === 'stale', edited };
  const event = p.sourceEventIds.at(-1) ?? null;

  if (p.kind === 'memory') {
    const content = (edited ? String(input.content) : String(change.content ?? '')).trim();
    if (!content || content.length > 2000) throw new CoreRuleError('bad_input', 'Спогад — від 1 до 2000 символів');
    const t = String(input.memoryType ?? change.memoryType ?? 'recollection');
    if (!PROPOSAL_MEMORY_TYPES.includes(t as CharacterMemoryType)) throw new CoreRuleError('bad_input', `Вид спогаду — один із: ${PROPOSAL_MEMORY_TYPES.join(', ')}`);
    const memory = await addAuthorMemory(repo, {
      projectId: input.projectId,
      characterId: p.characterId,
      memoryType: t as CharacterMemoryType,
      content,
      sceneId: sim.sceneId && scan.bySection.has(sim.sceneId) ? sim.sceneId : null,
      sourceParagraphIds: sceneEvidence(scan, sim),
      source: event ? { kind: 'simulation_event', id: event } : undefined,
      actor: input.actor,
    });
    const proposal = await repo.resolveCanonProposal(input.projectId, p.id, { status: 'accepted', actor: input.actor, result: { ...base, memoryId: memory.id } });
    return { proposal, tags: [], memory };
  }

  if (p.kind === 'fact') {
    const statement = (edited ? String(input.content) : String(change.statement ?? '')).trim();
    if (!statement || statement.length > 1000) throw new CoreRuleError('bad_input', 'Факт — від 1 до 1000 символів');
    const field = String(input.field ?? change.field ?? 'other');
    if (!FIELD_KEYS.has(field)) throw new CoreRuleError('bad_input', `Поле профілю — одне з: ${[...FIELD_KEYS].join(', ')}`);
    const project = await repo.getProject(input.projectId);
    const fact = await repo.addFinding({
      projectId: input.projectId,
      entityId: p.characterId,
      kind: PROFILE_FACT,
      payload: {
        field,
        statement,
        assessment: 'hypothesis',
        hypothesis: true,
        origin: 'interview',
        simulationId: sim.id,
        proposalId: p.id,
        eventIds: p.sourceEventIds,
        quote: '',
      },
      sourceParagraphIds: sceneEvidence(scan, sim),
      sourceRevision: project?.revision ?? null,
      status: 'suggested',
      createdBy: input.actor,
    });
    const proposal = await repo.resolveCanonProposal(input.projectId, p.id, { status: 'accepted', actor: input.actor, result: { ...base, findingId: fact.id } });
    return { proposal, tags: [], fact };
  }

  const children = (await repo.listCanonProposals(input.projectId, { simulationId: sim.id, kind: 'tag', limit: 1000 })).filter((x) => x.parentId === p.id);

  if (p.kind === 'fragment') {
    const sectionId = String(input.sectionId ?? '').trim();
    if (!sectionId) throw new CoreRuleError('bad_input', 'Фрагмент: оберіть розділ книги, куди вставити');
    if (!scan.bySection.has(sectionId)) throw new CoreRuleError('not_found', `Розділ «${sectionId}» не знайдено`);
    const text = edited ? String(input.content).trim() : String(change.text ?? '').trim();
    if (!text || text.length > 6000) throw new CoreRuleError('bad_input', 'Фрагмент — від 1 до 6000 символів');
    const wanted = [...new Set(input.tagIds ?? [])];
    const chosen: CanonProposalRow[] = [];
    for (const id of wanted) {
      const c = children.find((x) => x.id === id);
      if (!c) throw new CoreRuleError('not_found', `Тег «${id}» — не цього фрагмента`);
      if (c.status !== 'pending') throw new CoreRuleError('conflict', `Тег «${String((c.proposedChange as { tag?: unknown }).tag ?? id)}» уже вирішено`);
      chosen.push(c);
    }
    const tagText = chosen.map((c) => String((c.proposedChange as { tag?: unknown }).tag ?? '')).filter(Boolean);
    const body = tagText.length ? `${text} ${tagText.join(' ')}` : text;
    const snippet = `${AI_DRAFT_OPEN}\n\n${body}\n\n${AI_DRAFT_CLOSE}`;
    const proposal = await repo.resolveCanonProposal(input.projectId, p.id, {
      status: 'accepted',
      actor: input.actor,
      result: { ...base, sectionId, text, tagIds: chosen.map((c) => c.id) },
    });
    const tags: CanonProposalRow[] = [];
    for (const c of chosen) tags.push(await repo.resolveCanonProposal(input.projectId, c.id, { status: 'accepted', actor: input.actor, result: { ...base, proposalId: c.id, sectionId, withFragment: true } }));
    return { proposal, tags, insert: { sectionId, mode: 'ai_draft', snippet } };
  }

  // tag — окремо, після фрагмента.
  const parent = p.parentId ? await repo.getCanonProposal(input.projectId, p.parentId) : null;
  if (!parent) throw new CoreRuleError('not_found', 'Фрагмент цього тегу не знайдено');
  if (parent.status !== 'accepted') throw new CoreRuleError('conflict', parent.status === 'pending' ? 'Спершу прийміть фрагмент (тег можна прийняти разом із ним)' : 'Фрагмент відхилено — тег нікуди дописати');
  const sectionId = String((parent.result as { sectionId?: unknown }).sectionId ?? '');
  const tag = String((p.proposedChange as { tag?: unknown }).tag ?? '');
  const proposal = await repo.resolveCanonProposal(input.projectId, p.id, { status: 'accepted', actor: input.actor, result: { ...base, sectionId, withFragment: false } });
  return { proposal, tags: [], insert: { sectionId, mode: 'append_tag', snippet: tag } };
}

/** Відхилити пропозицію; відхилений фрагмент забирає з собою ще не вирішені теги. */
export async function rejectProposal(repo: CoreRepository, input: { projectId: string; proposalId: string; actor: CoreActor; reason?: string | null }): Promise<{ proposal: CanonProposalRow; tags: CanonProposalRow[] }> {
  authorOnly(input.actor);
  const p = await proposalOrThrow(repo, input.projectId, input.proposalId);
  if (p.status !== 'pending') throw new CoreRuleError('conflict', p.status === 'accepted' ? 'Пропозицію вже прийнято' : 'Пропозицію вже відхилено');
  const reason = String(input.reason ?? '').trim().slice(0, 500);
  const result = reason ? { reason } : {};
  const proposal = await repo.resolveCanonProposal(input.projectId, p.id, { status: 'rejected', actor: input.actor, result });
  const tags: CanonProposalRow[] = [];
  if (p.kind === 'fragment') {
    const children = (await repo.listCanonProposals(input.projectId, { simulationId: p.simulationId, kind: 'tag', status: 'pending', limit: 1000 })).filter((x) => x.parentId === p.id);
    for (const c of children) tags.push(await repo.resolveCanonProposal(input.projectId, c.id, { status: 'rejected', actor: input.actor, result: { withFragment: true } }));
  }
  return { proposal, tags };
}

// ── Показ ───────────────────────────────────────────────────────────────────

export interface ProposalView {
  id: string;
  simulationId: string;
  kind: CanonProposalRow['kind'];
  status: CanonProposalRow['status'];
  turn: number | null;
  change: Record<string, unknown>;
  result: Record<string, unknown>;
  sourceEventIds: string[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** Для фрагмента — його теги (П7). */
  tags?: ProposalView[];
}

/** Пропозиції для показу: теги — всередині свого фрагмента, у порядку створення (як віддає сховище). */
export function proposalViews(rows: CanonProposalRow[]): ProposalView[] {
  const view = (p: CanonProposalRow): ProposalView => {
    const { turn, ...change } = p.proposedChange as Record<string, unknown>;
    return {
      id: p.id,
      simulationId: p.simulationId,
      kind: p.kind,
      status: p.status,
      turn: typeof turn === 'number' ? turn : null,
      change,
      result: p.result,
      sourceEventIds: p.sourceEventIds,
      reviewedBy: p.reviewedBy,
      reviewedAt: p.reviewedAt,
      createdAt: p.createdAt,
    };
  };
  const sorted = rows; // сховища віддають у порядку створення
  const out: ProposalView[] = [];
  const frags = new Map<string, ProposalView>();
  for (const p of sorted) {
    if (p.kind === 'tag') continue;
    const v = view(p);
    if (p.kind === 'fragment') {
      v.tags = [];
      frags.set(p.id, v);
    }
    out.push(v);
  }
  for (const p of sorted) if (p.kind === 'tag') frags.get(p.parentId ?? '')?.tags!.push(view(p));
  return out;
}
