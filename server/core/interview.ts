/**
 * Допит живого персонажа (Т2.7, `PLAN_INTERVIEW.md`; FLC 2.0 §7; ТЗ-H §8,
 * §11).
 *
 * В2: «AI-персонаж» і рівні автономності (рішення власника §6 п.3):
 *   off       — вимкнено: героя не допитують і в сценах він не діє сам;
 *   interview — відповідає на допиті автора (Т2.7);
 *   scene     — ще й учасник сцени (Magic Scene, Т3): поки лише
 *               записується; допитувати такого героя теж можна — вищий
 *               рівень включає нижчий.
 * Налаштування агента — лише відомі поля (межа знань за замовчуванням,
 * сцена за замовчуванням, нотатка автора, ліміт ходів допиту); решта
 * відкидається, щоб у налаштування не потрапило довільне.
 *
 * В3: хід допиту (ТЗ-H §8 кроки 3–7 для одного героя). Допит — дослідницький
 * прогін (`scene_simulations`, вид interview) з ревізією книги на старті й
 * межею знань (сцена чи глава). Хід: питання автора → рішення Jev (через
 * `JevDecisionAdapter`: стратегічний і сценічний — з кешу, тактичний — на
 * цей хід, `simulation_id` = допит) → знімок героя станом на сцену (лише його
 * пам'ять, зокрема цього допиту) → модуль «Голос героя (допит)» з історією
 * допиту → відповідь. Канон, рукопис і пам'ять канону допит не змінює —
 * лише ходи прогону (і, далі, пропозиції, В4).
 * В4: відповідь голосу дає пропозиції в канон (`interviewProposals.ts`):
 * спогад, факт-гіпотеза, фрагмент і теги П7 — автор приймає кожну окремо.
 * На старті записано відбиток межі допиту (сцена чи глава); змінилась
 * сцена — допит «застарів», нових ходів немає.
 * Запасні шляхи (ТЗ-H №9): Jev недоступний — запасний LLM (у `decide`);
 * рішення чекає автора — хід «чекає» з варіантами, відповіді немає;
 * модель голосу недоступна чи відповіла не за схемою — хід «не вдалося»,
 * питання збережене, «повторити» відповідає на те саме питання.
 */

import type { AutonomyLevel, CanonProposalRow, CharacterAgentRow, CoreActor, CoreRepository, EntityRow, SimulationEventRow, SimulationRow } from './types';
import { AUTONOMY_LEVELS } from './types';
import { CoreRuleError } from './rules';
import { scanScenes } from './timeline';
import { JevDecisionAdapter } from './jevLevels';
import { buildCharacterSnapshot } from './characterSnapshot';
import { parseModelJson, validateAgainstSchema } from './ai/schema';
import { jevState, type JevAdapter } from '../ai/adapters/jev';
import type { StudioCharacterLike } from './characterProfile';
import { CHARACTER_VOICE_SCHEMA, factoryCharacterVoiceTemplate, renderCharacterVoiceTemplate } from './interviewPrompt';
import { createProposals, interviewBoundaryHash, refreshSimulationFreshness, type VoiceProposals } from './interviewProposals';

export type { VoiceProposals };

export const AUTONOMY_LABELS: Record<AutonomyLevel, { title: string; hint: string; available: boolean }> = {
  off: { title: 'Вимкнено', hint: 'героя не допитують і в сценах він не діє сам', available: true },
  interview: { title: 'Допит', hint: 'відповідає на запитання автора від першої особи — дослідницька симуляція, не канон', available: true },
  scene: { title: 'Учасник сцени', hint: 'діє сам у сцені з іншими героями (Magic Scene) — з\'явиться на етапі 3; поки герой доступний для допиту', available: false },
};

/** Ліміт ходів одного допиту за замовчуванням (критерій FLC 2.0 §7 — щонайменше 10 відповідей поспіль). */
export const DEFAULT_MAX_TURNS = 30;
export const MAX_TURNS_LIMIT = 100;

export interface AgentConfig {
  /** Межа знань героя за замовчуванням для нового допиту. */
  asOfChapter?: number | null;
  /** Сцена (розділ) за замовчуванням. */
  sceneId?: string | null;
  /** Нотатка автора для голосу героя (як говорить, чого уникає). */
  note?: string;
  /** Скільки ходів в одному допиті. */
  maxTurns?: number;
}

/** Лише відомі поля; неправильне значення — відмова, невідоме поле — відкинуто. */
export function normalizeAgentConfig(raw: unknown): AgentConfig {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new CoreRuleError('bad_input', 'Налаштування агента — обʼєкт');
  const r = raw as Record<string, unknown>;
  const out: AgentConfig = {};
  if (r.asOfChapter !== undefined && r.asOfChapter !== null && r.asOfChapter !== '') {
    const n = Number(r.asOfChapter);
    if (!Number.isInteger(n) || n < 1) throw new CoreRuleError('bad_input', 'Межа знань — глава ≥ 1');
    out.asOfChapter = n;
  } else if (r.asOfChapter === null) out.asOfChapter = null;
  if (r.sceneId !== undefined) {
    const s = r.sceneId == null ? null : String(r.sceneId).trim();
    if (s && s.length > 200) throw new CoreRuleError('bad_input', 'Сцена — до 200 символів');
    out.sceneId = s || null;
  }
  if (r.note !== undefined) {
    const s = String(r.note ?? '').trim();
    if (s.length > 1000) throw new CoreRuleError('bad_input', 'Нотатка — до 1000 символів');
    out.note = s;
  }
  if (r.maxTurns !== undefined) {
    const n = Number(r.maxTurns);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TURNS_LIMIT) throw new CoreRuleError('bad_input', `Ходів у допиті — від 1 до ${MAX_TURNS_LIMIT}`);
    out.maxTurns = n;
  }
  return out;
}

async function heroOrThrow(repo: CoreRepository, projectId: string, characterId: string): Promise<EntityRow> {
  const e = await repo.getEntity(projectId, characterId);
  if (!e || e.status === 'rejected' || e.type !== 'character') throw new CoreRuleError('not_found', 'Героя не знайдено в ядрі книги');
  return e;
}

export interface AgentView {
  characterId: string;
  enabled: boolean;
  autonomyLevel: AutonomyLevel;
  config: AgentConfig;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const agentView = (characterId: string, a: CharacterAgentRow | null): AgentView => ({
  characterId,
  enabled: a?.enabled ?? false,
  autonomyLevel: a?.autonomyLevel ?? 'off',
  config: (a?.agentConfig ?? {}) as AgentConfig,
  updatedBy: a?.updatedBy ?? null,
  updatedAt: a?.updatedAt ?? null,
});

export async function getAgent(repo: CoreRepository, projectId: string, characterId: string): Promise<AgentView> {
  await heroOrThrow(repo, projectId, characterId);
  return agentView(characterId, await repo.getCharacterAgent(projectId, characterId));
}

/** Увімкнути / вимкнути «AI-персонажа», змінити рівень чи налаштування (налаштування зливаються з наявними). */
export async function setAgent(
  repo: CoreRepository,
  projectId: string,
  characterId: string,
  input: { autonomyLevel?: unknown; config?: unknown },
  actor: CoreActor,
): Promise<AgentView> {
  await heroOrThrow(repo, projectId, characterId);
  const prev = await repo.getCharacterAgent(projectId, characterId);
  const level = (input.autonomyLevel ?? prev?.autonomyLevel ?? 'off') as AutonomyLevel;
  if (!(AUTONOMY_LEVELS as readonly string[]).includes(level)) throw new CoreRuleError('bad_input', `Рівень автономності — один із: ${AUTONOMY_LEVELS.join(', ')}`);
  const patch = normalizeAgentConfig(input.config);
  const config = { ...((prev?.agentConfig ?? {}) as AgentConfig), ...patch };
  const row = await repo.upsertCharacterAgent({ projectId, characterId, autonomyLevel: level, agentConfig: config as Record<string, unknown>, actor });
  return agentView(characterId, row);
}

/** Допит можливий лише для увімкненого героя (рівень «допит» чи вищий). */
export async function requireInterviewAgent(repo: CoreRepository, projectId: string, characterId: string): Promise<{ hero: EntityRow; agent: CharacterAgentRow }> {
  const hero = await heroOrThrow(repo, projectId, characterId);
  const agent = await repo.getCharacterAgent(projectId, characterId);
  if (!agent || !agent.enabled || agent.autonomyLevel === 'off') {
    throw new CoreRuleError('conflict', `«${hero.name}» — не AI-персонаж: увімкніть «AI-персонаж» (рівень «Допит») на сторінці героя`);
  }
  return { hero, agent };
}

// ── В3: допит — прогін і хід ────────────────────────────────────────────────

/** Дії героя на допиті (тактичний рівень Jev). */
export const INTERVIEW_ACTIONS = ['answer', 'deflect', 'lie', 'silence', 'ask', 'confess'];
/** Скільки попередніх ходів іде в запит голосу (контекст допиту). */
export const INTERVIEW_HISTORY_TURNS = 12;
export const INTERVIEW_ACTOR = 'ai:character-voice';

export type VoiceGenerate = (system: string, user: string) => Promise<{ text: string; modelId: string; inputTokens: number; outputTokens: number }>;

export interface InterviewDeps {
  repo: CoreRepository;
  jev: JevAdapter | null;
  fallback: JevAdapter;
  voice: VoiceGenerate;
  loadTemplate?: () => Promise<{ system: string; user: string } | undefined>;
  studio?: (projectId: string, entity: EntityRow) => Promise<{ character: StudioCharacterLike | null; all: StudioCharacterLike[] } | undefined>;
}

/** Почати допит героя: прогін з ревізією книги й межею знань (сцена чи глава; типово — з налаштувань агента). */
export async function startInterview(
  repo: CoreRepository,
  input: { projectId: string; characterId: string; sceneId?: string | null; asOfChapter?: number | null; title?: string; actor: CoreActor },
): Promise<SimulationRow> {
  const { hero, agent } = await requireInterviewAgent(repo, input.projectId, input.characterId);
  const cfg = (agent.agentConfig ?? {}) as AgentConfig;
  const project = await repo.getProject(input.projectId);
  if (!project) throw new CoreRuleError('not_found', `Проєкт «${input.projectId}»`);
  const sceneId = input.sceneId !== undefined ? input.sceneId : cfg.sceneId ?? null;
  const asOfChapter = input.asOfChapter !== undefined ? input.asOfChapter : cfg.asOfChapter ?? null;
  const scan = await scanScenes(repo, input.projectId, await repo.listTimePoints(input.projectId));
  if (sceneId && !scan.bySection.has(sceneId)) throw new CoreRuleError('not_found', `Сцену «${sceneId}» не знайдено`);
  if (asOfChapter != null && (!Number.isInteger(asOfChapter) || asOfChapter < 1)) throw new CoreRuleError('bad_input', 'Межа знань — глава ≥ 1');
  // В4: відбиток межі допиту — змінилась сцена (глава) — допит «застарів».
  const boundaryHash = interviewBoundaryHash(scan, { sceneId, asOfChapter });
  return repo.addSimulation({
    projectId: input.projectId,
    kind: 'interview',
    characterId: hero.id,
    sceneId,
    asOfChapter,
    baseBookRevision: project.revision,
    title: (input.title ?? '').trim().slice(0, 200) || `Допит: ${hero.name}`,
    config: { maxTurns: cfg.maxTurns ?? DEFAULT_MAX_TURNS, note: cfg.note ?? '', ...(boundaryHash ? { boundaryHash } : {}) },
    createdBy: input.actor,
  });
}

export interface TurnResult {
  status: 'answered' | 'awaiting' | 'failed';
  turn: number;
  question: SimulationEventRow;
  event: SimulationEventRow;
  /** В4: пропозиції в канон з цієї відповіді (лише для «answered»). */
  proposals: CanonProposalRow[];
}

const lastByTurn = (events: SimulationEventRow[], turn: number) => events.filter((e) => e.turnIndex === turn).at(-1) ?? null;

/** Хід допиту: питання автора → Jev → голос героя. */
export async function askQuestion(deps: InterviewDeps, input: { projectId: string; simulationId: string; question: string; actor: CoreActor }): Promise<TurnResult> {
  const { repo } = deps;
  const sim = await activeInterview(repo, input.projectId, input.simulationId);
  const question = String(input.question ?? '').trim();
  if (!question || question.length > 2000) throw new CoreRuleError('bad_input', 'Питання — від 1 до 2000 символів');
  const events = await repo.listSimulationEvents(input.projectId, sim.id);
  if (sim.currentTurn > 0) {
    const last = lastByTurn(events, sim.currentTurn);
    if (last && last.eventType !== 'answer') throw new CoreRuleError('conflict', 'Попереднє питання ще без відповіді — повторіть його чи вирішіть за героя');
  }
  const max = Number((sim.config as { maxTurns?: unknown }).maxTurns) || DEFAULT_MAX_TURNS;
  if (sim.currentTurn >= max) throw new CoreRuleError('conflict', `Допит досяг ліміту ходів (${max}) — почніть новий`);
  const turn = sim.currentTurn + 1;
  const q = await repo.addSimulationEvent({ projectId: input.projectId, simulationId: sim.id, turnIndex: turn, actor: 'author', eventType: 'question', publicPayload: { text: question }, createdBy: input.actor });
  await repo.updateSimulation(input.projectId, sim.id, { currentTurn: turn });
  return answerTurn(deps, { ...sim, currentTurn: turn }, q, [...events, q], input.actor);
}

/** «Повторити» останній хід, що «чекає» чи «не вдався» (питання те саме, стан не губиться). */
export async function retryTurn(deps: InterviewDeps, input: { projectId: string; simulationId: string; actor: CoreActor }): Promise<TurnResult> {
  const { repo } = deps;
  const sim = await activeInterview(repo, input.projectId, input.simulationId);
  const events = await repo.listSimulationEvents(input.projectId, sim.id);
  const last = lastByTurn(events, sim.currentTurn);
  if (!last || last.eventType === 'answer') throw new CoreRuleError('conflict', 'Повторювати нічого — останнє питання вже з відповіддю');
  const q = events.find((e) => e.turnIndex === sim.currentTurn && e.eventType === 'question');
  if (!q) throw new CoreRuleError('conflict', 'Питання цього ходу не знайдено');
  return answerTurn(deps, sim, q, events, input.actor);
}

async function activeInterview(repo: CoreRepository, projectId: string, simulationId: string): Promise<SimulationRow> {
  const found = await repo.getSimulation(projectId, simulationId);
  if (!found || found.kind !== 'interview' || !found.characterId) throw new CoreRuleError('not_found', 'Допит не знайдено');
  const sim = await refreshSimulationFreshness(repo, found);
  if (sim.status !== 'active') throw new CoreRuleError('conflict', sim.status === 'stale' ? 'Сцену допиту змінено — допит застарів, почніть новий' : 'Допит не активний');
  await requireInterviewAgent(repo, projectId, sim.characterId);
  return sim;
}

async function answerTurn(deps: InterviewDeps, sim: SimulationRow, q: SimulationEventRow, events: SimulationEventRow[], actor: CoreActor): Promise<TurnResult> {
  const { repo } = deps;
  const heroId = sim.characterId!;
  const hero = (await repo.getEntity(sim.projectId, heroId))!;
  const question = String((q.publicPayload as { text?: unknown }).text ?? '');
  const turn = q.turnIndex;
  const addEvent = (eventType: 'answer' | 'awaiting' | 'failed', publicPayload: Record<string, unknown>, sourceDecisionId?: string | null) =>
    repo.addSimulationEvent({
      projectId: sim.projectId,
      simulationId: sim.id,
      turnIndex: turn,
      actor: eventType === 'answer' ? 'character' : 'system',
      actorCharacterId: eventType === 'answer' ? heroId : null,
      eventType,
      publicPayload,
      sourceDecisionId: sourceDecisionId ?? null,
      createdBy: eventType === 'answer' ? INTERVIEW_ACTOR : 'system:interview',
    });

  // 1. Рішення Jev на цей хід (стратегічне й сценічне — з кешу).
  const engine = new JevDecisionAdapter({ repo, jev: deps.jev, fallback: deps.fallback, studio: deps.studio });
  let decided;
  try {
    decided = await engine.decide({
      projectId: sim.projectId,
      characterId: heroId,
      level: 'tactical',
      actor,
      asOfChapter: sim.asOfChapter,
      sceneId: sim.sceneId,
      situation: `Автор питає: «${question}»`,
      allowedActions: INTERVIEW_ACTIONS,
      simulationId: sim.id,
      turnIndex: turn,
    });
  } catch (err) {
    const event = await addEvent('failed', { stage: 'decision', error: (err as Error).message.slice(0, 500) });
    return { status: 'failed', turn, question: q, event, proposals: [] };
  }
  if (decided.awaitingAuthor) {
    const d = decided.decision;
    const primary = (d.options.primary ?? {}) as { allowed?: string[]; forbidden?: string[] };
    const event = await addEvent('awaiting', {
      level: decided.blockedAt,
      decisionId: d.id,
      reason: d.fallbackReason ?? (d.validation as { authorReason?: unknown }).authorReason ?? null,
      options: (primary.allowed ?? []).filter((a) => !(primary.forbidden ?? []).includes(a)),
    }, d.id);
    return { status: 'awaiting', turn, question: q, event, proposals: [] };
  }
  const d = decided.decision;
  const r = (d.result ?? {}) as { scores?: Record<string, number>; confidence?: number | null };
  const scene = decided.chain.find((c) => c.level === 'scene');
  const sceneRow = scene ? await repo.getCharacterDecision(sim.projectId, scene.id) : null;
  const sceneScores = ((sceneRow?.result ?? {}) as { scores?: Record<string, number> }).scores ?? {};

  // 2. Знімок героя станом на сцену (його пам'ять, зокрема цього допиту).
  const studio = deps.studio ? await deps.studio(sim.projectId, hero).catch(() => undefined) : undefined;
  const built = await buildCharacterSnapshot(repo, {
    projectId: sim.projectId,
    characterId: heroId,
    sceneId: sim.sceneId,
    asOfChapter: sim.asOfChapter,
    simulationId: sim.id,
    situation: question.slice(0, 2000),
    allowedActions: INTERVIEW_ACTIONS,
    studio,
    lenientScene: true,
  });

  // 3. Голос героя.
  const history = events
    .filter((e) => e.turnIndex < turn && (e.eventType === 'question' || e.eventType === 'answer'))
    .filter((e) => e.turnIndex > turn - 1 - INTERVIEW_HISTORY_TURNS)
    .map((e) => `${e.eventType === 'question' ? 'Автор' : hero.name}: ${String((e.publicPayload as { text?: unknown }).text ?? '')}`)
    .join('\n');
  const decisionText = [
    `дія: ${d.selectedAction}`,
    sceneRow?.selectedAction ? `мотив у сцені: ${sceneRow.selectedAction}` : '',
    Object.keys(sceneScores).length ? `сцена: ${Object.entries(sceneScores).map(([k, v]) => `${k} ${v}/10`).join(', ')}` : '',
    r.scores ? `хід: ${Object.entries(r.scores).map(([k, v]) => `${k} ${v}/10`).join(', ')}` : '',
  ].filter(Boolean).join('; ');
  const template = (await deps.loadTemplate?.().catch(() => undefined)) ?? factoryCharacterVoiceTemplate();
  const rendered = renderCharacterVoiceTemplate(template, {
    hero: hero.name,
    snapshot: JSON.stringify({ as_of_chapter: built.snapshot.as_of_chapter, ...jevState(built.snapshot) }, null, 1),
    decision: decisionText,
    history,
    question,
    note: String((sim.config as { note?: unknown }).note ?? ''),
  });
  const decisionInfo = { decisionId: d.id, action: d.selectedAction, source: d.source, fallbackReason: d.fallbackReason, snapshotHash: built.hash, confidence: r.confidence ?? null };
  let out;
  try {
    out = await deps.voice(rendered.system, rendered.user);
  } catch (err) {
    const event = await addEvent('failed', { stage: 'voice', error: (err as Error).message.slice(0, 500), ...decisionInfo }, d.id);
    return { status: 'failed', turn, question: q, event, proposals: [] };
  }
  let parsed: unknown;
  try {
    parsed = parseModelJson(out.text);
  } catch (err) {
    const event = await addEvent('failed', { stage: 'voice', error: `відповідь не JSON: ${(err as Error).message}`.slice(0, 500), ...decisionInfo }, d.id);
    return { status: 'failed', turn, question: q, event, proposals: [] };
  }
  const check = validateAgainstSchema<{ reply: string; intent?: string; proposals?: VoiceProposals }>(CHARACTER_VOICE_SCHEMA, parsed);
  if (!check.ok) {
    const event = await addEvent('failed', { stage: 'voice', error: `відповідь не за схемою: ${check.errors.join('; ')}`.slice(0, 500), ...decisionInfo }, d.id);
    return { status: 'failed', turn, question: q, event, proposals: [] };
  }
  const v = check.value!;
  const event = await addEvent('answer', {
    text: v.reply.trim(),
    intent: (v.intent ?? '').trim(),
    ...decisionInfo,
    model: out.modelId,
    usage: { inputTokens: out.inputTokens, outputTokens: out.outputTokens },
    proposals: v.proposals ?? {},
    memoryIds: built.memoryIds,
  }, d.id);
  // В4: пропозиції в канон — окремими записами; вирішує автор.
  const created = await createProposals(repo, sim, { turn, sourceEventIds: [q.id, event.id], proposals: v.proposals });
  return { status: 'answered', turn, question: q, event, proposals: created.proposals };
}
