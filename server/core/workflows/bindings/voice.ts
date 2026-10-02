/**
 * Прив'язка процесу `character_voice` — голос героя на допиті (Т5.4 В2;
 * рішення власника §2 п.1). Рішення Jev ходу ухвалюється до процесу (вузли
 * Jev — Т5.5); процес — знімок героя (MEMORY), історія й рішення (CONTEXT),
 * інструкція (PROMPT), модель (LLM), перевірка (VALIDATOR), відповідь і
 * пропозиції в канон (PROPOSAL) — тими самими кроками, що й старий шлях.
 */

import type { CanonProposalRow, CoreActor, CoreRepository, SimulationEventRow, WorkflowRunRow } from '../../types';
import {
  CHARACTER_VOICE_WORKFLOW,
  addTurnEvent,
  checkVoiceOutput,
  voiceDecisionInfo,
  voiceHistory,
  voicePersist,
  voiceRender,
  voiceSnapshot,
  type InterviewDeps,
  type TurnResult,
  type VoiceReply,
  type VoiceTurnContext,
} from '../../interview';
import { publishedVersion, startRun, type EngineDeps } from '../engine/runner';
import type { BindingDef, WfState } from '../engine/types';

export const VOICE_EXTRAS = 'voice';

interface VoiceExtras {
  ctx: VoiceTurnContext;
  deps: Pick<InterviewDeps, 'studio' | 'loadTemplate'>;
  sink?: (r: { status: 'answered' | 'failed'; event: SimulationEventRow; proposals: CanonProposalRow[] }) => void;
}

/** Контекст ходу з входу запуску (повтор, відгалуження, продовження). */
async function rebuildContext(repo: CoreRepository, run: WorkflowRunRow, input: Record<string, unknown>): Promise<VoiceTurnContext> {
  const projectId = run.projectId ?? '';
  const sim = await repo.getSimulation(projectId, String(input.simulationId ?? ''));
  if (!sim || !sim.characterId) throw new Error('Допит запуску не знайдено');
  const events = await repo.listSimulationEvents(projectId, sim.id);
  const q = events.find((e) => e.id === input.questionEventId);
  if (!q) throw new Error('Питання запуску не знайдено');
  const hero = await repo.getEntity(projectId, sim.characterId);
  const decision = await repo.getCharacterDecision(projectId, String(input.decisionId ?? ''));
  if (!hero || !decision) throw new Error('Героя чи рішення ходу не знайдено');
  const sceneDecision = input.sceneDecisionId ? await repo.getCharacterDecision(projectId, String(input.sceneDecisionId)) : null;
  return { sim, hero, q, events: events.filter((e) => e.turnIndex <= q.turnIndex), turn: q.turnIndex, question: String((q.publicPayload as { text?: unknown }).text ?? ''), decision, sceneDecision };
}

export function voiceBinding(base: Pick<InterviewDeps, 'studio' | 'loadTemplate'> = {}): BindingDef {
  return {
    workflowId: CHARACTER_VOICE_WORKFLOW,
    async prepare({ repo, run, input, extras }) {
      const given = extras?.[VOICE_EXTRAS] as VoiceExtras | undefined;
      const ctx = given?.ctx ?? (await rebuildContext(repo, run, input));
      const deps = given?.deps ?? base;
      const sink = given?.sink;
      let snapshot: Awaited<ReturnType<typeof voiceSnapshot>> | null = null;
      const info = (state: WfState) => voiceDecisionInfo(ctx, String(state.vars.snapshotHash ?? ''));
      const failed = async (state: WfState, error: string) => {
        const event = await addTurnEvent(repo, ctx, 'failed', { stage: 'voice', error: error.slice(0, 500), ...info(state) }, ctx.decision.id);
        sink?.({ status: 'failed', event, proposals: [] });
        return event;
      };
      const ensureSnapshot = async () => (snapshot ??= await voiceSnapshot({ repo, studio: deps.studio }, ctx));
      return {
        module: 'coreCharacterVoice',
        executors: {
          MEMORY: async (_node, state) => {
            const s = await ensureSnapshot();
            return { patch: { vars: { ...state.vars, snapshotHash: s.hash, memoryIds: s.memoryIds } }, trace: { details: { memories: s.memoryIds.length, snapshotHash: s.hash } } };
          },
          CONTEXT: async (_node, state) => {
            const history = voiceHistory(ctx);
            return { patch: { vars: { ...state.vars, history, decision: ctx.decision.selectedAction } }, trace: { decision: ctx.decision.selectedAction, details: { turn: ctx.turn, historyChars: history.length } } };
          },
          PROMPT: async (_node, state) => {
            const s = await ensureSnapshot();
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
            const v = state.output as VoiceReply;
            const out = { modelId: state.llm?.model ?? '', inputTokens: state.llm?.tokensIn ?? 0, outputTokens: state.llm?.tokensOut ?? 0, costUsd: state.llm?.costUsd };
            const saved = await voicePersist(repo, ctx, v, out, info(state), (state.vars.memoryIds as string[] | undefined) ?? []);
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

/** Голос через опублікований процес; немає опублікованої версії — null (старий шлях). */
export async function voiceTurnViaWorkflow(engine: EngineDeps, deps: InterviewDeps, ctx: VoiceTurnContext, actor: CoreActor): Promise<TurnResult | null> {
  if (!(await publishedVersion(engine.repo, CHARACTER_VOICE_WORKFLOW).catch(() => null))) return null;
  let captured: Parameters<NonNullable<VoiceExtras['sink']>>[0] | null = null;
  const out = await startRun(engine, {
    workflowId: CHARACTER_VOICE_WORKFLOW,
    input: { simulationId: ctx.sim.id, questionEventId: ctx.q.id, decisionId: ctx.decision.id, ...(ctx.sceneDecision ? { sceneDecisionId: ctx.sceneDecision.id } : {}) },
    projectId: ctx.sim.projectId,
    trigger: 'interview',
    actor,
    extras: { [VOICE_EXTRAS]: { ctx, deps: { studio: deps.studio, loadTemplate: deps.loadTemplate }, sink: (r) => { captured = r; } } satisfies VoiceExtras },
  });
  const done = captured as Parameters<NonNullable<VoiceExtras['sink']>>[0] | null;
  if (done) return { status: done.status, turn: ctx.turn, question: ctx.q, event: done.event, proposals: done.proposals };
  // Призупинено з Graph Studio чи впало до власних подій: хід «не вдався», процес видно в «Запусках».
  const event = await addTurnEvent(engine.repo, ctx, 'failed', { stage: 'voice', error: out.run.status === 'paused' ? 'процес ШІ призупинено в Graph Studio' : (out.run.error ?? 'процес ШІ не завершився').slice(0, 500), workflowRunId: out.run.id, decisionId: ctx.decision.id }, ctx.decision.id);
  return { status: 'failed', turn: ctx.turn, question: ctx.q, event, proposals: [] };
}
