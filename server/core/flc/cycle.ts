/**
 * Один повний цикл FLC етапу 0 (Т1.6): retrieval → профіль → Jev Choice/Score
 * → LLM → чернетка. Дані — з ядра (теги, профіль Т1.5, пошук Т1.2), без
 * очікування нових сторінок. Результат — дослідницька чернетка: канон,
 * рукопис і висновки ядра цикл не змінює (ТЗ-H №3).
 *
 * Кроки йдуть через `AgentRuntime` (агенти бачать лише свої серверні tools),
 * рішення — через адаптер Jev із запасним шляхом на LLM (ТЗ-H №9).
 *
 * Т2.5 В5 — режим `levels`: рішення героя — через три рівні Jev
 * (`JevDecisionAdapter`: стратегічний → сценічний → тактичний, кеш кожного,
 * валідатор, ланцюжок Jev → LLM → автор). Рівень «чекає автора» — цикл
 * зупиняється без чернетки (LLM замість автора не вирішує). Режим `single`
 * — один виклик Jev, як у звіті Т1.6 (для відтворення його замірів).
 */

import { randomUUID } from 'node:crypto';
import type { CoreRepository } from '../types';
import { buildCharacterProfile, type StudioCharacterLike, type CharacterProfile } from '../characterProfile';
import { hybridSearch } from '../search/service';
import { parseModelJson } from '../ai/schema';
import { validateDecision, validateSnapshot, type CharacterSnapshot, type DecisionResult, type SnapshotEvidence } from './contracts';
import { evaluateWithFallback, interrogationQuestions, JEV_USD_PER_MTOK, type JevAdapter, type LlmJson } from './jev';
import { InProcessAgentRuntime, type AgentTool, type TraceEvent } from './runtime';
import { JevDecisionAdapter, type DecideResult } from '../jevLevels';
import type { CharacterDecisionLevel, CharacterDecisionRow } from '../types';

export const DEFAULT_ACTIONS = ['answer', 'lie', 'silence', 'deflect'];

export interface FlcCycleDeps {
  repo: CoreRepository;
  jev: JevAdapter | null;
  fallback: JevAdapter;
  llm: LlmJson;
  studio?: { character: StudioCharacterLike | null; all: StudioCharacterLike[] };
}

export interface FlcCycleRequest {
  projectId: string;
  entityId: string;
  /** Запитання автора на допиті / ситуація сцени. */
  question: string;
  /** Межа знань героя: глави 1…N (без — уся книга). */
  asOfChapter?: number | null;
  allowedActions?: string[];
  actorId: string;
  /** `single` (типово) — один виклик Jev, як у Т1.6; `levels` — три рівні (Т2.5 В5). */
  mode?: 'single' | 'levels';
  /** Сцена для сценічного рівня (режим `levels`). */
  sceneId?: string | null;
}

/** Рівні, з яких складено рішення (режим `levels`). */
export interface FlcLevelStep {
  level: CharacterDecisionLevel;
  id: string;
  action: string | null;
  reused: boolean;
  source: string;
  scores: Record<string, number>;
}

export interface FlcCycleResult {
  simulationId: string;
  /** Запис у журналі рішень героя (`character_decisions`, Т2.5 В2). */
  decisionId: string;
  snapshot: CharacterSnapshot;
  decision: DecisionResult;
  fallbackReason: string | null;
  /** null — рівень чекає автора, чернетки немає (режим `levels`). */
  draft: { reply: string; intent: string; action: string; model: string } | null;
  mode: 'single' | 'levels';
  levels: FlcLevelStep[];
  awaitingAuthor: boolean;
  blockedAt: CharacterDecisionLevel | null;
  timings: { retrieval: number; profile: number; decision: number; llm: number; total: number };
  cost: { jevInputTokens: number; jevUsd: number; llmInputTokens: number; llmOutputTokens: number };
  trace: readonly TraceEvent[];
  /** Цикл нічого не записує в канон: завжди false (перевіряється тестом). */
  canonChanged: false;
}

const ev = (p: { paragraphId: string; chapterNumber: number | null; excerpt: string }): SnapshotEvidence => ({
  paragraph_id: p.paragraphId,
  chapter: p.chapterNumber,
  excerpt: p.excerpt,
});

/** Профіль (Т1.5) + знайдене пошуком → знімок у межах знань героя. */
export function snapshotFromProfile(profile: CharacterProfile, found: SnapshotEvidence[], question: string, allowed: string[]): CharacterSnapshot {
  const states = profile.arc.current.length ? profile.arc.current : profile.arc.intermediate.length ? profile.arc.intermediate : profile.arc.initial;
  const recent = [...profile.appearances.items.slice(-6).map(ev), ...found];
  const seen = new Set<string>();
  return {
    character_id: profile.entity.id,
    name: profile.entity.name,
    as_of_chapter: profile.upto,
    canon: profile.canon.fields.map((f) => ({ label: f.label, value: f.value })),
    confirmed_facts: profile.facts.confirmed
      .filter((f) => f.sources.length)
      .map((f) => ({ statement: f.statement, evidence: f.sources.map(ev) })),
    current_states: states.map((s) => ({ type: s.type, name: s.name, chapter: s.place?.chapterNumber ?? null })),
    relations: profile.relations.map((r) => ({ label: r.label, other: r.otherName, direction: r.direction })),
    recent_appearances: recent.filter((r) => (seen.has(r.paragraph_id) ? false : (seen.add(r.paragraph_id), true))).slice(-12),
    situation: question.trim().slice(0, 2000),
    allowed_actions: allowed,
  };
}

export async function runFlcCycle(deps: FlcCycleDeps, req: FlcCycleRequest): Promise<FlcCycleResult> {
  const t0 = Date.now();
  const simulationId = randomUUID();
  const allowed = (req.allowedActions?.length ? req.allowedActions : DEFAULT_ACTIONS).filter((a) => /^[a-z_]{2,40}$/.test(a));
  const upto = req.asOfChapter && req.asOfChapter >= 1 ? Math.floor(req.asOfChapter) : null;

  // Серверні tools — єдине, що бачать агенти (ТЗ-H §7.2 tools/).
  const tools: AgentTool[] = [
    {
      name: 'search-character-mentions',
      description: 'Абзаци книги про героя за запитом, у межах знань героя.',
      run: async (args: { query: string }, scope) => {
        const res = await hybridSearch({ repo: deps.repo }, scope.projectId, {
          query: args.query,
          hintEntityIds: [[scope.characterId]],
          chapterRange: upto ? { from: 1, to: upto } : undefined,
          limit: 6,
        });
        return res.results.map((r) => ({ paragraphId: r.paragraphId, chapterNumber: r.chapterNumber, excerpt: r.excerpt }));
      },
    },
    {
      name: 'get-character-snapshot',
      description: 'Доказовий профіль героя на главі N (Profile Builder, Т1.5).',
      run: async (_args, scope) => buildCharacterProfile(deps.repo, scope.projectId, scope.characterId, { upto, studio: deps.studio }),
    },
    {
      name: 'evaluate-character-options',
      description: 'Jev Choice/Score над знімком (із запасним шляхом).',
      run: async (args: { snapshot: CharacterSnapshot }) => evaluateWithFallback(deps.jev, deps.fallback, args.snapshot, interrogationQuestions(args.snapshot.allowed_actions)),
    },
    {
      name: 'decide-character-levels',
      description: 'Три рівні Jev (стратегічний → сценічний → тактичний) з кешем, валідатором і рішенням автора.',
      run: async (args: { situation: string }, scope) =>
        new JevDecisionAdapter({ repo: deps.repo, jev: deps.jev, fallback: deps.fallback, studio: async () => deps.studio }).decide({
          projectId: scope.projectId,
          characterId: scope.characterId,
          level: 'tactical',
          actor: req.actorId as CharacterDecisionRow['createdBy'],
          asOfChapter: upto,
          sceneId: req.sceneId ?? null,
          situation: args.situation,
          allowedActions: allowed,
          simulationId,
          turnIndex: 0,
        }),
    },
    {
      name: 'draft-reply',
      description: 'LLM пише репліку героя за рішенням — чернетка, не канон.',
      run: async (args: { snapshot: CharacterSnapshot; decision: DecisionResult; context?: string }) => {
        const system = [
          `Ти — ${args.snapshot.name}, персонаж книги. Відповідай від першої особи, українською, 1–4 речення.`,
          `Дія, яку обрано для героя: «${args.decision.selected_action}»; сила страху (0–10): ${args.decision.scores.fear_intensity ?? args.decision.scores.fear ?? 'невідомо'}.`,
          ...(args.context ? [args.context] : []),
          'Використовуй лише факти зі знімка; не розкривай того, чого герой не знає. Це дослідницька чернетка, не канон.',
          'Поверни ЛИШЕ JSON: {"reply": "репліка героя", "intent": "намір одним реченням"}.',
        ].join('\n');
        const user = `Знімок героя:\n${JSON.stringify(args.snapshot, null, 1)}\n\nЗапитання автора: ${args.snapshot.situation}`;
        const out = await deps.llm(system, user);
        const parsed: any = parseModelJson(out.text);
        const reply = String(parsed?.reply ?? '').trim();
        if (!reply) throw new Error('LLM не повернула репліку');
        return { reply, intent: String(parsed?.intent ?? '').trim(), model: out.modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
      },
    },
  ];
  const runtime = new InProcessAgentRuntime({ projectId: req.projectId, actorId: req.actorId, characterId: req.entityId, simulationId }, tools);

  const tr = Date.now();
  const found = await runtime.step('character-profile-agent', ['search-character-mentions'], (ctx) =>
    ctx.tool<{ paragraphId: string; chapterNumber: number | null; excerpt: string }[]>('search-character-mentions', { query: req.question }),
  );
  const retrieval = Date.now() - tr;

  const tp = Date.now();
  const profile = await runtime.step('character-profile-agent', ['get-character-snapshot'], (ctx) => ctx.tool<CharacterProfile | null>('get-character-snapshot'));
  if (!profile) throw new Error('Героя не знайдено в ядрі книги');
  const snapshot = snapshotFromProfile(profile, found.map(ev), req.question, allowed);
  const snapCheck = validateSnapshot(snapshot);
  if (!snapCheck.ok) throw new Error(`Знімок героя не відповідає контракту: ${snapCheck.errors.join('; ')}`);
  const profileMs = Date.now() - tp;

  if (req.mode === 'levels') return levelsTail(deps, req, { runtime, simulationId, snapshot, t0, retrieval, profileMs });

  const td = Date.now();
  const { decision, fallbackReason } = await runtime.step('character-agent', ['evaluate-character-options'], (ctx) =>
    ctx.tool<{ decision: DecisionResult; fallbackReason: string | null }>('evaluate-character-options', { snapshot }),
  );
  const decCheck = validateDecision(decision);
  if (!decCheck.ok) throw new Error(`Рішення не відповідає контракту: ${decCheck.errors.join('; ')}`);
  const decisionMs = Date.now() - td;
  // Т2.5 В2: кожне рішення — у журнал рішень героя (відбиток знімка, модель, підстави-посилання; не канон).
  const logged = await deps.repo.addCharacterDecision({
    projectId: req.projectId,
    characterId: req.entityId,
    level: 'tactical',
    simulationId,
    cacheKey: decision.snapshot_hash,
    questions: interrogationQuestions(snapshot.allowed_actions),
    options: { allowed: snapshot.allowed_actions },
    result: decision as unknown as Record<string, unknown>,
    selectedAction: decision.selected_action,
    validation: { corrected: decision.corrected },
    snapshotHash: decision.snapshot_hash,
    modelVersion: decision.model_version,
    source: decision.source,
    fallbackReason,
    basis: {
      paragraphIds: [...new Set([...snapshot.confirmed_facts.flatMap((f) => f.evidence.map((e) => e.paragraph_id)), ...snapshot.recent_appearances.map((e) => e.paragraph_id)])],
      note: 'прототип FLC 0: допит',
    },
    usage: decision.usage,
    latencyMs: decision.latency_ms,
    createdBy: req.actorId,
  });

  const tl = Date.now();
  const draft = await runtime.step('character-agent', ['draft-reply'], (ctx) =>
    ctx.tool<{ reply: string; intent: string; model: string; inputTokens: number; outputTokens: number }>('draft-reply', { snapshot, decision }),
  );
  const llmMs = Date.now() - tl;

  const jevTokens = decision.source === 'jev' ? decision.usage.input_tokens : 0;
  const fbTokens = decision.source === 'llm_fallback' ? decision.usage : { input_tokens: 0, output_tokens: 0 };
  return {
    simulationId,
    decisionId: logged.id,
    snapshot,
    decision,
    fallbackReason,
    draft: { reply: draft.reply, intent: draft.intent, action: decision.selected_action, model: draft.model },
    timings: { retrieval, profile: profileMs, decision: decisionMs, llm: llmMs, total: Date.now() - t0 },
    cost: {
      jevInputTokens: jevTokens,
      jevUsd: Math.round((jevTokens / 1_000_000) * JEV_USD_PER_MTOK * 1e8) / 1e8,
      llmInputTokens: draft.inputTokens + fbTokens.input_tokens,
      llmOutputTokens: draft.outputTokens + fbTokens.output_tokens,
    },
    trace: runtime.trace,
    canonChanged: false,
    mode: 'single',
    levels: [],
    awaitingAuthor: false,
    blockedAt: null,
  };
}

type Draft = { reply: string; intent: string; model: string; inputTokens: number; outputTokens: number };

/** Режим `levels`: рішення — трьома рівнями; чернетка — лише коли жоден рівень не чекає автора. */
async function levelsTail(
  deps: FlcCycleDeps,
  req: FlcCycleRequest,
  c: { runtime: InProcessAgentRuntime; simulationId: string; snapshot: CharacterSnapshot; t0: number; retrieval: number; profileMs: number },
): Promise<FlcCycleResult> {
  const { runtime, snapshot } = c;
  const td = Date.now();
  const r = await runtime.step('character-agent', ['decide-character-levels'], (ctx) => ctx.tool<DecideResult>('decide-character-levels', { situation: req.question }));
  const rows = new Map<string, CharacterDecisionRow>();
  for (const s of r.chain) {
    const row = await deps.repo.getCharacterDecision(req.projectId, s.id);
    if (row) rows.set(row.id, row);
  }
  rows.set(r.decision.id, r.decision);
  const steps: FlcLevelStep[] = [...r.chain, { level: r.decision.level, id: r.decision.id, reused: r.reused }].map((s) => {
    const row = rows.get(s.id)!;
    const res = (row.result ?? {}) as Partial<DecisionResult>;
    return { level: s.level, id: s.id, action: row.selectedAction, reused: s.reused, source: row.source, scores: { ...(res.scores ?? {}) } };
  });
  const decisionMs = Date.now() - td;
  // Вартість — лише рівнів, порахованих у цьому циклі (з кешу — безкоштовно).
  let jevTokens = 0;
  let fbIn = 0;
  let fbOut = 0;
  for (const s of steps) {
    if (s.reused) continue;
    const row = rows.get(s.id)!;
    const u = row.usage as { input_tokens?: number; output_tokens?: number };
    if (row.modelVersion.startsWith('llm:')) {
      fbIn += Number(u.input_tokens) || 0;
      fbOut += Number(u.output_tokens) || 0;
    } else if (row.source === 'jev') jevTokens += Number(u.input_tokens) || 0;
  }
  const decision = (r.decision.result ?? null) as unknown as DecisionResult | null;
  let draft: Draft | null = null;
  let llmMs = 0;
  if (!r.awaitingAuthor && decision) {
    const [strategic, scene] = steps;
    const context = [
      strategic?.action ? `Траєкторія героя: ${strategic.action}.` : '',
      scene?.action ? `Мотив у сцені: ${scene.action}; ${Object.entries(scene.scores).map(([k, v]) => `${k} ${v}/10`).join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    const withFear: DecisionResult = { ...decision, scores: { ...decision.scores, ...(scene?.scores.fear != null && decision.scores.fear == null ? { fear: scene.scores.fear } : {}) } };
    const tl = Date.now();
    draft = await runtime.step('character-agent', ['draft-reply'], (ctx) => ctx.tool<Draft>('draft-reply', { snapshot, decision: withFear, context }));
    llmMs = Date.now() - tl;
  }
  const empty: DecisionResult = {
    selected_action: '',
    scores: {},
    raw_distributions: {},
    confidence: null,
    model_version: r.decision.modelVersion,
    snapshot_hash: r.decision.snapshotHash,
    decision_trace_id: r.decision.id,
    source: 'llm_fallback',
    corrected: false,
    usage: { input_tokens: 0, output_tokens: 0 },
    latency_ms: 0,
  };
  return {
    simulationId: c.simulationId,
    decisionId: r.decision.id,
    snapshot,
    decision: decision ?? empty,
    fallbackReason: r.decision.fallbackReason,
    draft: draft && decision ? { reply: draft.reply, intent: draft.intent, action: decision.selected_action, model: draft.model } : null,
    timings: { retrieval: c.retrieval, profile: c.profileMs, decision: decisionMs, llm: llmMs, total: Date.now() - c.t0 },
    cost: {
      jevInputTokens: jevTokens,
      jevUsd: Math.round((jevTokens / 1_000_000) * JEV_USD_PER_MTOK * 1e8) / 1e8,
      llmInputTokens: (draft?.inputTokens ?? 0) + fbIn,
      llmOutputTokens: (draft?.outputTokens ?? 0) + fbOut,
    },
    trace: runtime.trace,
    canonChanged: false,
    mode: 'levels',
    levels: steps,
    awaitingAuthor: r.awaitingAuthor,
    blockedAt: r.blockedAt,
  };
}
