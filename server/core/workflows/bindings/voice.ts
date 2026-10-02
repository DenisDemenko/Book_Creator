/**
 * Прив'язка процесу `character_voice` — хід допиту героя (Т5.4 В2; Т5.5 В3,
 * рішення власника Т5.5 §2 п.4). Процес: рішення Jev ходу (вузол «Пакет
 * рішень Jev» — рівні й кеш Т2.5; варіанти дії — з параметрів вузла), знімок
 * героя (MEMORY), історія й рішення (CONTEXT), інструкція (PROMPT), модель
 * (LLM), перевірка (VALIDATOR), відповідь і пропозиції в канон (PROPOSAL) —
 * тими самими кроками, що й старий шлях. Хід, який має вирішити автор (Jev і
 * запасний LLM не змогли), іде гілкою `review`.
 */

import type { CanonProposalRow, CharacterDecisionRow, CoreActor, CoreRepository, SimulationEventRow, WorkflowRunRow } from '../../types';
import {
  CHARACTER_VOICE_WORKFLOW,
  INTERVIEW_ACTIONS,
  addTurnEvent,
  checkVoiceOutput,
  decideTurn,
  voiceDecisionInfo,
  voiceHistory,
  voicePersist,
  voiceRender,
  voiceSnapshot,
  type EarlyTurnContext,
  type InterviewDeps,
  type TurnResult,
  type VoiceReply,
  type VoiceTurnContext,
} from '../../interview';
import { LlmFallbackJevAdapter, type JevAdapter } from '../../../ai/adapters/jev';
import { nodeOutputs, type WorkflowNode } from '../../../../src/utils/workflowGraph';
import { publishedVersion, startRun, type EngineDeps } from '../engine/runner';
import type { BindingDef, EngineServices, WfState } from '../engine/types';

export const VOICE_EXTRAS = 'voice';

type TurnDeps = Pick<InterviewDeps, 'studio' | 'loadTemplate'> & Partial<Pick<InterviewDeps, 'jev' | 'fallback'>>;
type SinkResult = { status: 'answered' | 'awaiting' | 'failed'; event: SimulationEventRow; proposals: CanonProposalRow[] };

interface VoiceExtras {
  early: EarlyTurnContext;
  deps: TurnDeps;
  sink?: (r: SinkResult) => void;
}

/** Хід допиту з входу запуску (повтор, відгалуження, продовження). */
async function rebuildEarly(repo: CoreRepository, run: WorkflowRunRow, input: Record<string, unknown>): Promise<EarlyTurnContext> {
  const projectId = run.projectId ?? '';
  const sim = await repo.getSimulation(projectId, String(input.simulationId ?? ''));
  if (!sim || !sim.characterId) throw new Error('Допит запуску не знайдено');
  const events = await repo.listSimulationEvents(projectId, sim.id);
  const q = events.find((e) => e.id === input.questionEventId);
  if (!q) throw new Error('Питання запуску не знайдено');
  const hero = await repo.getEntity(projectId, sim.characterId);
  if (!hero) throw new Error('Героя запуску не знайдено');
  return { sim, hero, q, events: events.filter((e) => e.turnIndex <= q.turnIndex), turn: q.turnIndex, question: String((q.publicPayload as { text?: unknown }).text ?? '') };
}

/** Запасний LLM рішення без викликача (повтор з Graph Studio): модуль AI-2, як у допиті. */
function fallbackFrom(services: EngineServices, run: WorkflowRunRow): JevAdapter {
  return new LlmFallbackJevAdapter(async (system, user) => {
    const out = await services.generate({ module: 'coreAi2Analysis', modelId: await services.resolveModel('coreAi2Analysis'), system, user, projectId: run.projectId ?? '', actor: run.startedBy });
    return { text: out.text, modelId: out.modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd };
  });
}

/** Варіанти дії з вузла (питання `next_action` пакета) — лише з дозволених допиту. */
function allowedFromNode(node: WorkflowNode): string[] {
  const qs = Array.isArray(node.params?.questions) ? (node.params.questions as { id?: unknown; kind?: unknown; options?: unknown }[]) : [];
  const q = qs.find((x) => x?.id === 'next_action' && x.kind === 'choice') ?? qs.find((x) => x?.kind === 'choice');
  const opts = Array.isArray(q?.options) ? (q!.options as unknown[]).map(String).filter((o) => INTERVIEW_ACTIONS.includes(o)) : [];
  return opts.length >= 2 ? opts : INTERVIEW_ACTIONS;
}

export function voiceBinding(base: TurnDeps = {}): BindingDef {
  return {
    workflowId: CHARACTER_VOICE_WORKFLOW,
    async prepare({ repo, run, input, services, extras }) {
      const given = extras?.[VOICE_EXTRAS] as VoiceExtras | undefined;
      const early = given?.early ?? (await rebuildEarly(repo, run, input));
      const deps: TurnDeps = given?.deps ?? base;
      const sink = given?.sink;
      // Рішення ходу: зі змінних запуску (після вузла рішення, відгалуження) чи зі старого входу (запуски Т5.4).
      const decisions = new Map<string, CharacterDecisionRow | null>();
      const decisionRow = async (id: unknown) => {
        const key = String(id ?? '');
        if (!key) return null;
        if (!decisions.has(key)) decisions.set(key, await repo.getCharacterDecision(early.sim.projectId, key));
        return decisions.get(key) ?? null;
      };
      const ctxOf = async (state: WfState): Promise<VoiceTurnContext> => {
        const decision = await decisionRow(state.vars.decisionId ?? input.decisionId);
        if (!decision) throw new Error('Рішення ходу ще не ухвалено — процес має починатися з вузла рішення Jev');
        return { ...early, decision, sceneDecision: await decisionRow(state.vars.sceneDecisionId ?? input.sceneDecisionId) };
      };
      let snapshot: Awaited<ReturnType<typeof voiceSnapshot>> | null = null;
      const ensureSnapshot = async (ctx: VoiceTurnContext) => (snapshot ??= await voiceSnapshot({ repo, studio: deps.studio }, ctx));
      const failed = async (state: WfState, error: string) => {
        const ctx = await ctxOf(state).catch(() => null);
        const info = ctx ? voiceDecisionInfo(ctx, String(state.vars.snapshotHash ?? '')) : {};
        const event = await addTurnEvent(repo, (ctx ?? early) as VoiceTurnContext, 'failed', { stage: ctx ? 'voice' : 'decision', error: error.slice(0, 500), ...info }, ctx?.decision.id);
        sink?.({ status: 'failed', event, proposals: [] });
        return event;
      };
      return {
        module: 'coreCharacterVoice',
        executors: {
          // Т5.5 В3: рішення Jev ходу — вузол процесу (рівні й кеш Т2.5).
          JEV_DECISION_BUNDLE: async (node, state) => {
            const allowed = allowedFromNode(node);
            const jev = deps.jev !== undefined ? deps.jev : ((await services.jev?.()) ?? null);
            const fallback = deps.fallback ?? fallbackFrom(services, run);
            const dec = await decideTurn({ repo, jev, fallback, studio: deps.studio }, early, run.startedBy, allowed);
            if (dec.status !== 'decided') {
              sink?.({ status: dec.status, event: dec.event, proposals: [] });
              const branch = dec.status === 'awaiting' && nodeOutputs(node).includes('review') ? 'review' : 'fallback';
              const payload = dec.event.publicPayload as { reason?: unknown; error?: unknown };
              return {
                branch,
                patch: { result: { status: dec.status, eventId: dec.event.id } },
                trace: { decision: dec.status === 'awaiting' ? 'чекає рішення автора' : 'рішення не ухвалено', warnings: [String(payload.reason ?? payload.error ?? '')].filter(Boolean), details: { allowed, event: dec.event.publicPayload } },
              };
            }
            const d = dec.decision;
            const r = (d.result ?? {}) as { confidence?: number | null; raw_distributions?: Record<string, Record<string, number>>; scores?: Record<string, number> };
            const usage = (d.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
            const confidence = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : null;
            return {
              branch: 'out',
              patch: {
                vars: { ...state.vars, decisionId: d.id, sceneDecisionId: dec.sceneDecision?.id ?? null, decision: d.selectedAction, [node.id]: { selected: d.selectedAction, scores: r.scores ?? {}, source: d.source, chain: dec.chain } },
                confidence,
              },
              trace: {
                model: d.modelVersion,
                tokensIn: Number(usage.input_tokens) || 0,
                tokensOut: Number(usage.output_tokens) || 0,
                decision: `дія: ${d.selectedAction}${dec.sceneDecision?.selectedAction ? ` · мотив сцени: ${dec.sceneDecision.selectedAction}` : ''}`,
                confidence,
                warnings: d.fallbackReason ? [`запасний LLM: ${d.fallbackReason}`.slice(0, 400)] : [],
                details: {
                  source: d.source,
                  ...(d.fallbackReason ? { fallbackReason: d.fallbackReason } : {}),
                  allowed,
                  chain: dec.chain,
                  answers: { next_action: { kind: 'choice', selected: d.selectedAction, distribution: r.raw_distributions?.next_action ?? {}, confidence } },
                  scores: r.scores ?? {},
                },
              },
            };
          },
          MEMORY: async (_node, state) => {
            const s = await ensureSnapshot(await ctxOf(state));
            return { patch: { vars: { ...state.vars, snapshotHash: s.hash, memoryIds: s.memoryIds } }, trace: { details: { memories: s.memoryIds.length, snapshotHash: s.hash } } };
          },
          CONTEXT: async (_node, state) => {
            const ctx = await ctxOf(state);
            const history = voiceHistory(ctx);
            return { patch: { vars: { ...state.vars, history, decision: ctx.decision.selectedAction } }, trace: { decision: ctx.decision.selectedAction, details: { turn: ctx.turn, historyChars: history.length } } };
          },
          PROMPT: async (_node, state) => {
            const ctx = await ctxOf(state);
            const s = await ensureSnapshot(ctx);
            const rendered = await voiceRender(deps, ctx, s, String(state.vars.history ?? voiceHistory(ctx)));
            return { patch: { prompt: { ...rendered, module: 'coreCharacterVoice' }, vars: { ...state.vars, snapshotHash: s.hash, memoryIds: s.memoryIds } }, trace: { details: { module: 'coreCharacterVoice' } } };
          },
          VALIDATOR: async (node, state) => {
            const schema = node.params?.output_schema && typeof node.params.output_schema === 'object' && Object.keys(node.params.output_schema as object).length ? (node.params.output_schema as object) : undefined;
            const check = checkVoiceOutput(state.llm?.text ?? '', schema);
            if (check.ok === false) {
              const error = (check as { error: string }).error;
              const event = await failed(state, error);
              return { patch: { validation: { ok: false, errors: [error] }, result: { status: 'failed', eventId: event.id } }, branch: 'invalid', trace: { validationResult: 'invalid', details: { error } } };
            }
            const v = (check as { value: VoiceReply }).value;
            return { patch: { output: v, validation: { ok: true, errors: [] } }, branch: 'valid', trace: { validationResult: 'valid', decision: v.intent ?? null } };
          },
          PROPOSAL: async (_node, state) => {
            const ctx = await ctxOf(state);
            const v = state.output as VoiceReply;
            const out = { modelId: state.llm?.model ?? '', inputTokens: state.llm?.tokensIn ?? 0, outputTokens: state.llm?.tokensOut ?? 0, costUsd: state.llm?.costUsd };
            const saved = await voicePersist(repo, ctx, v, out, voiceDecisionInfo(ctx, String(state.vars.snapshotHash ?? '')), (state.vars.memoryIds as string[] | undefined) ?? []);
            sink?.({ status: 'answered', ...saved });
            return { patch: { result: { status: 'answered', eventId: saved.event.id, proposalIds: saved.proposals.map((p) => p.id) } }, trace: { decision: `відповідь, пропозицій: ${saved.proposals.length}` } };
          },
        },
        onFailure: async (state, error) => {
          await failed(state, error.message);
        },
      };
    },
  };
}

/** Хід допиту через опублікований процес; немає опублікованої версії — null (старий шлях). */
export async function interviewTurnViaWorkflow(engine: EngineDeps, deps: InterviewDeps, early: EarlyTurnContext, actor: CoreActor): Promise<TurnResult | null> {
  if (!(await publishedVersion(engine.repo, CHARACTER_VOICE_WORKFLOW).catch(() => null))) return null;
  let captured: SinkResult | null = null;
  const out = await startRun(engine, {
    workflowId: CHARACTER_VOICE_WORKFLOW,
    input: { simulationId: early.sim.id, questionEventId: early.q.id, question: early.question },
    projectId: early.sim.projectId,
    trigger: 'interview',
    actor,
    extras: { [VOICE_EXTRAS]: { early, deps: { studio: deps.studio, loadTemplate: deps.loadTemplate, jev: deps.jev, fallback: deps.fallback }, sink: (r) => { captured = r; } } satisfies VoiceExtras },
  });
  const done = captured as SinkResult | null;
  if (done) return { status: done.status, turn: early.turn, question: early.q, event: done.event, proposals: done.proposals };
  // Призупинено з Graph Studio чи впало до власних подій: хід «не вдався», процес видно в «Запусках».
  const decisionId = typeof out.state?.vars.decisionId === 'string' ? out.state.vars.decisionId : null;
  const event = await addTurnEvent(engine.repo, early as VoiceTurnContext, 'failed', { stage: 'voice', error: out.run.status === 'paused' ? 'процес ШІ призупинено в Graph Studio' : (out.run.error ?? 'процес ШІ не завершився').slice(0, 500), workflowRunId: out.run.id, ...(decisionId ? { decisionId } : {}) }, decisionId);
  return { status: 'failed', turn: early.turn, question: early.q, event, proposals: [] };
}
