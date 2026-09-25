/**
 * Один повний цикл FLC етапу 0 (Т1.6): retrieval → профіль → Jev Choice/Score
 * → LLM → чернетка. Дані — з ядра (теги, профіль Т1.5, пошук Т1.2), без
 * очікування нових сторінок. Результат — дослідницька чернетка: канон,
 * рукопис і висновки ядра цикл не змінює (ТЗ-H №3).
 *
 * Кроки йдуть через `AgentRuntime` (агенти бачать лише свої серверні tools),
 * рішення — через адаптер Jev із запасним шляхом на LLM (ТЗ-H №9).
 */

import { randomUUID } from 'node:crypto';
import type { CoreRepository } from '../types';
import { buildCharacterProfile, type StudioCharacterLike, type CharacterProfile } from '../characterProfile';
import { hybridSearch } from '../search/service';
import { parseModelJson } from '../ai/schema';
import { validateDecision, validateSnapshot, type CharacterSnapshot, type DecisionResult, type SnapshotEvidence } from './contracts';
import { evaluateWithFallback, interrogationQuestions, JEV_USD_PER_MTOK, type JevAdapter, type LlmJson } from './jev';
import { InProcessAgentRuntime, type AgentTool, type TraceEvent } from './runtime';

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
}

export interface FlcCycleResult {
  simulationId: string;
  snapshot: CharacterSnapshot;
  decision: DecisionResult;
  fallbackReason: string | null;
  draft: { reply: string; intent: string; action: string; model: string };
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
      name: 'draft-reply',
      description: 'LLM пише репліку героя за рішенням — чернетка, не канон.',
      run: async (args: { snapshot: CharacterSnapshot; decision: DecisionResult }) => {
        const system = [
          `Ти — ${args.snapshot.name}, персонаж книги. Відповідай від першої особи, українською, 1–4 речення.`,
          `Дія, яку обрано для героя: «${args.decision.selected_action}»; сила страху (0–10): ${args.decision.scores.fear_intensity ?? 'невідомо'}.`,
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

  const td = Date.now();
  const { decision, fallbackReason } = await runtime.step('character-agent', ['evaluate-character-options'], (ctx) =>
    ctx.tool<{ decision: DecisionResult; fallbackReason: string | null }>('evaluate-character-options', { snapshot }),
  );
  const decCheck = validateDecision(decision);
  if (!decCheck.ok) throw new Error(`Рішення не відповідає контракту: ${decCheck.errors.join('; ')}`);
  const decisionMs = Date.now() - td;

  const tl = Date.now();
  const draft = await runtime.step('character-agent', ['draft-reply'], (ctx) =>
    ctx.tool<{ reply: string; intent: string; model: string; inputTokens: number; outputTokens: number }>('draft-reply', { snapshot, decision }),
  );
  const llmMs = Date.now() - tl;

  const jevTokens = decision.source === 'jev' ? decision.usage.input_tokens : 0;
  const fbTokens = decision.source === 'llm_fallback' ? decision.usage : { input_tokens: 0, output_tokens: 0 };
  return {
    simulationId,
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
  };
}
