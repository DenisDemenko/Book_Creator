/**
 * Рушій процесів ШІ на LangGraph.js (Т5.4 В1, `PLAN_WORKFLOW_ENGINE.md`;
 * ТЗ Graph Studio §5, §27, §30, §31, §39 №8, 24).
 *
 * Виконується **опублікована** версія процесу (`production`) — визначення
 * компілюється в `StateGraph`: вузол визначення → вузол графа, ребро `out` →
 * звичайне, гілки (`valid` / `invalid`, `true` / `false`) → умовні ребра за
 * гілкою, яку повернув виконавець. Кожен вузол — рядок трасування
 * (`workflow_run_steps`), стан після вузла — контрольна точка
 * (`workflow_checkpoints`).
 *
 *   PAUSE  — запит паузи; рушій зупиняється перед наступним вузлом (`interrupt`).
 *   RESUME — продовження з контрольної точки (той самий запуск).
 *   REPLAY — новий запуск із тим самим входом і тією самою версією.
 *   FORK   — новий запуск від стану після обраного кроку іншого запуску.
 */

import { createHash } from 'node:crypto';
import { Annotation, Command, END as LG_END, START as LG_START, StateGraph, interrupt, isGraphInterrupt } from '@langchain/langgraph';
import { canonicalJson } from '../../../../src/utils/ontology';
import { nodeOutputs, type WorkflowDefinition, type WorkflowNode } from '../../../../src/utils/workflowGraph';
import { CoreRuleError } from '../../rules';
import type { CoreActor, CoreRepository, WorkflowRunRow, WorkflowVersionRow } from '../../types';
import { CoreCheckpointSaver } from './checkpointer';
import { executorFor } from './executors';
import { NodeError, type BindingDef, type EngineServices, type ExecEnv, type WfState } from './types';

export interface EngineDeps {
  repo: CoreRepository;
  services: EngineServices;
  bindings?: Record<string, BindingDef>;
}

export interface StartInput {
  workflowId: string;
  input: Record<string, unknown>;
  projectId?: string | null;
  trigger: string;
  actor: CoreActor;
  jobId?: string | null;
  /** Конкретна версія (ручний запуск тестової); типово — опублікована. */
  versionId?: string;
  recordUsage?: ExecEnv['recordUsage'];
  signal?: AbortSignal;
  /** Не серіалізовне середовище прив'язки (функції підготовки тощо) — лише для першого виконання. */
  extras?: Record<string, unknown>;
}

export interface RunOutcome {
  run: WorkflowRunRow;
  state: WfState | null;
}

export const inputHashOf = (input: Record<string, unknown>) => createHash('sha256').update(canonicalJson(input)).digest('hex');
const lgName = (id: string) => `n_${id}`;
const STATE = Annotation.Root({ s: Annotation<WfState>({ reducer: (_a, b) => b, default: () => ({ input: {}, vars: {}, steps: 0, cost: 0 }) }) });

/** Опублікована (робоча) версія процесу або null. */
export async function publishedVersion(repo: CoreRepository, workflowId: string): Promise<WorkflowVersionRow | null> {
  const list = await repo.listWorkflowVersions(workflowId, { limit: 200 });
  const prod = list.find((v) => v.environment === 'production');
  return prod ? repo.getWorkflowVersion(prod.id) : null;
}

/** Визначення → граф LangGraph (без компіляції). */
function buildGraph(def: WorkflowDefinition, env: ExecEnv) {
  const g = new StateGraph(STATE) as unknown as {
    addNode: (n: string, f: (st: { s: WfState }) => Promise<{ s: WfState }>) => unknown;
    addEdge: (a: string, b: string) => unknown;
    addConditionalEdges: (a: string, f: (st: { s: WfState }) => string, m: Record<string, string>) => unknown;
    compile: (o: unknown) => any;
  };
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  for (const node of def.nodes) g.addNode(lgName(node.id), nodeRunner(node, env));
  const start = def.nodes.find((n) => n.type === 'START');
  if (!start) throw new CoreRuleError('bad_input', 'У процесі немає START');
  g.addEdge(LG_START, lgName(start.id));
  for (const node of def.nodes) {
    if (node.type === 'END') {
      g.addEdge(lgName(node.id), LG_END);
      continue;
    }
    const edges = def.edges.filter((e) => e.from === node.id);
    const ports = nodeOutputs(node);
    if (ports.length === 1 && edges.length === 1) {
      g.addEdge(lgName(node.id), lgName(edges[0].to));
    } else if (edges.length) {
      const map: Record<string, string> = {};
      for (const e of edges) if (byId.has(e.to)) map[e.fromPort] = lgName(e.to);
      g.addConditionalEdges(lgName(node.id), (st) => {
        const b = st.s.branch ?? ports[0];
        if (!map[b]) throw new NodeError(`Вузол «${node.id}» повернув гілку «${b}», якої немає на канві`, 'bad_input');
        return b;
      }, map);
    } else {
      g.addEdge(lgName(node.id), LG_END);
    }
  }
  return g;
}

/** Обгортка вузла: пауза, трасування, підсумки запуску. */
function nodeRunner(node: WorkflowNode, env: ExecEnv) {
  return async ({ s }: { s: WfState }): Promise<{ s: WfState }> => {
    const { repo } = env;
    const fresh = await repo.getWorkflowRun(env.run.id);
    if (fresh?.pauseRequested) {
      await repo.updateWorkflowRun(env.run.id, { status: 'paused', pauseRequested: false, currentNode: node.id });
      const t = new Date().toISOString();
      await repo.addWorkflowStep({ runId: env.run.id, nodeId: node.id, nodeType: node.type, status: 'paused', retryCount: 0, branch: null, startedAt: t, endedAt: t, latencyMs: 0, model: null, tokensIn: 0, tokensOut: 0, costUsd: 0, decision: 'pause', confidence: null, validationResult: null, humanResult: null, error: null, warnings: [], details: { before: node.id } });
      interrupt({ paused: node.id });
    }
    await repo.updateWorkflowRun(env.run.id, { currentNode: node.id });
    const startedAt = new Date();
    const t0 = env.services.now?.() ?? Date.now();
    const record = async (status: 'succeeded' | 'failed', trace: NonNullable<Awaited<ReturnType<ReturnType<typeof executorFor>>>['trace']>, branch: string | null, error: string | null) => {
      const latency = Math.max(0, Math.round((env.services.now?.() ?? Date.now()) - t0));
      await repo.addWorkflowStep({
        runId: env.run.id, nodeId: node.id, nodeType: node.type, status, retryCount: trace.retryCount ?? 0, branch,
        startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), latencyMs: latency,
        model: trace.model ?? null, tokensIn: trace.tokensIn ?? 0, tokensOut: trace.tokensOut ?? 0, costUsd: trace.costUsd ?? 0,
        decision: trace.decision ?? null, confidence: trace.confidence ?? null, validationResult: trace.validationResult ?? null, humanResult: trace.humanResult ?? null,
        error, warnings: (trace.warnings ?? []).slice(0, 20).map((w) => w.slice(0, 400)), details: trace.details ?? {},
      });
      const cur = (await repo.getWorkflowRun(env.run.id))!;
      await repo.updateWorkflowRun(env.run.id, {
        tokensIn: cur.tokensIn + (trace.tokensIn ?? 0),
        tokensOut: cur.tokensOut + (trace.tokensOut ?? 0),
        costUsd: Number((cur.costUsd + (trace.costUsd ?? 0)).toFixed(6)),
        latencyMs: cur.latencyMs + latency,
      });
    };
    let out;
    try {
      out = await executorFor(node, env)(node, s, env);
    } catch (err) {
      if (isGraphInterrupt(err)) throw err;
      const e = err as Error;
      await record('failed', err instanceof NodeError ? err.trace : {}, null, e.message);
      throw err;
    }
    const branch = out.branch ?? null;
    await record('succeeded', out.trace ?? {}, branch, null);
    const patch = out.patch ?? {};
    return { s: { ...s, ...patch, branch: branch ?? undefined, steps: s.steps + 1, cost: patch.cost ?? s.cost } };
  };
}

async function loadDefinition(repo: CoreRepository, run: WorkflowRunRow): Promise<WorkflowDefinition> {
  const v = await repo.getWorkflowVersion(run.versionId);
  if (!v?.definition) throw new CoreRuleError('not_found', 'Версії запуску немає');
  return v.definition as unknown as WorkflowDefinition;
}

async function envFor(deps: EngineDeps, run: WorkflowRunRow, def: WorkflowDefinition, opts: { actor: CoreActor; recordUsage?: ExecEnv['recordUsage']; signal?: AbortSignal; extras?: Record<string, unknown> }): Promise<ExecEnv> {
  const binding = deps.bindings?.[run.workflowId];
  const runtime = binding ? await binding.prepare({ repo: deps.repo, run, input: run.input, services: deps.services, extras: opts.extras }) : null;
  return { repo: deps.repo, run, definition: def, services: deps.services, binding: runtime, actor: opts.actor, recordUsage: opts.recordUsage, signal: opts.signal };
}

/** Виконати (чи продовжити) граф до кінця або паузи; підсумувати запуск. */
async function drive(deps: EngineDeps, env: ExecEnv, how: { input?: WfState; resume?: boolean; checkpointId?: string }): Promise<RunOutcome> {
  const saver = new CoreCheckpointSaver(deps.repo);
  const app = buildGraph(env.definition, env).compile({ checkpointer: saver });
  const config = { configurable: { thread_id: env.run.id, ...(how.checkpointId ? { checkpoint_id: how.checkpointId } : {}) }, recursionLimit: 200 };
  let result: { s?: WfState; __interrupt__?: unknown[] };
  try {
    result = how.resume ? await app.invoke(new Command({ resume: true }), config) : how.checkpointId ? await app.invoke(null, config) : await app.invoke({ s: how.input }, config);
  } catch (err) {
    const e = err as Error;
    const state = (await app.getState({ configurable: { thread_id: env.run.id } }).catch(() => null))?.values?.s ?? null;
    if (env.binding?.onFailure) await env.binding.onFailure(state ?? { input: env.run.input, vars: {}, steps: 0, cost: 0 }, e, env).catch(() => {});
    const run = await deps.repo.updateWorkflowRun(env.run.id, { status: 'failed', error: e.message.slice(0, 4000), currentNode: null });
    return { run, state };
  }
  if (Array.isArray(result.__interrupt__) && result.__interrupt__.length) {
    return { run: (await deps.repo.getWorkflowRun(env.run.id))!, state: result.s ?? null };
  }
  const state = result.s ?? null;
  const run = await deps.repo.updateWorkflowRun(env.run.id, { status: 'succeeded', output: state?.result ?? {}, currentNode: null, error: null });
  return { run, state };
}

const initialState = (input: Record<string, unknown>): WfState => ({ input, vars: {}, steps: 0, cost: 0 });

/** Запустити процес: опублікована версія (або вказана), новий запуск, виконання. */
export async function startRun(deps: EngineDeps, s: StartInput): Promise<RunOutcome> {
  const { repo } = deps;
  const version = s.versionId ? await repo.getWorkflowVersion(s.versionId) : await publishedVersion(repo, s.workflowId);
  if (!version || version.workflowId !== s.workflowId) throw new CoreRuleError('not_found', `У процесу «${s.workflowId}» немає опублікованої версії`);
  if (version.environment === 'draft') throw new CoreRuleError('conflict', 'Чернетку не запускають — спершу в тест');
  const run = await repo.addWorkflowRun({
    workflowId: s.workflowId, versionId: version.id, version: version.version, definitionHash: version.definitionHash,
    projectId: s.projectId ?? null, trigger: s.trigger, jobId: s.jobId ?? null, input: s.input, inputHash: inputHashOf(s.input), startedBy: s.actor,
  });
  const def = version.definition as unknown as WorkflowDefinition;
  let env: ExecEnv;
  try {
    env = await envFor(deps, run, def, { actor: s.actor, recordUsage: s.recordUsage, signal: s.signal, extras: s.extras });
  } catch (err) {
    return { run: await repo.updateWorkflowRun(run.id, { status: 'failed', error: (err as Error).message.slice(0, 4000) }), state: null };
  }
  return drive(deps, env, { input: initialState(s.input) });
}

/** PAUSE: попросити зупинитись перед наступним вузлом. */
export async function requestPause(repo: CoreRepository, runId: string): Promise<WorkflowRunRow> {
  const run = await repo.getWorkflowRun(runId);
  if (!run) throw new CoreRuleError('not_found', 'Запуск не знайдено');
  if (run.status !== 'running') throw new CoreRuleError('conflict', 'Призупинити можна лише запуск, що виконується');
  return repo.updateWorkflowRun(runId, { pauseRequested: true });
}

/** RESUME: продовжити призупинений запуск із контрольної точки. */
export async function resumeRun(deps: EngineDeps, runId: string, actor: CoreActor, opts: { recordUsage?: ExecEnv['recordUsage'] } = {}): Promise<RunOutcome> {
  const run = await deps.repo.getWorkflowRun(runId);
  if (!run) throw new CoreRuleError('not_found', 'Запуск не знайдено');
  if (run.status !== 'paused') throw new CoreRuleError('conflict', 'Продовжити можна лише призупинений запуск');
  const live = await deps.repo.updateWorkflowRun(runId, { status: 'running', pauseRequested: false });
  const def = await loadDefinition(deps.repo, live);
  const env = await envFor(deps, live, def, { actor, recordUsage: opts.recordUsage });
  return drive(deps, env, { resume: true });
}

/** Скасувати призупинений запуск. */
export async function cancelRun(repo: CoreRepository, runId: string): Promise<WorkflowRunRow> {
  const run = await repo.getWorkflowRun(runId);
  if (!run) throw new CoreRuleError('not_found', 'Запуск не знайдено');
  if (run.status !== 'paused') throw new CoreRuleError('conflict', 'Скасувати можна призупинений запуск; той, що виконується, спершу призупиніть');
  return repo.updateWorkflowRun(runId, { status: 'cancelled', currentNode: null });
}

/** REPLAY: той самий вхід і та сама версія — новий запуск від початку. */
export async function replayRun(deps: EngineDeps, runId: string, actor: CoreActor): Promise<RunOutcome> {
  const parent = await deps.repo.getWorkflowRun(runId);
  if (!parent) throw new CoreRuleError('not_found', 'Запуск не знайдено');
  const run = await deps.repo.addWorkflowRun({
    workflowId: parent.workflowId, versionId: parent.versionId, version: parent.version, definitionHash: parent.definitionHash, projectId: parent.projectId,
    trigger: 'replay', input: parent.input, inputHash: parent.inputHash, startedBy: actor, mode: 'replay', parentRunId: parent.id,
  });
  const def = await loadDefinition(deps.repo, run);
  let env: ExecEnv;
  try {
    env = await envFor(deps, run, def, { actor });
  } catch (err) {
    return { run: await deps.repo.updateWorkflowRun(run.id, { status: 'failed', error: (err as Error).message.slice(0, 4000) }), state: null };
  }
  return drive(deps, env, { input: initialState(parent.input) });
}

/** FORK: від стану після кроку `afterStep` (1…) іншого запуску — новий запуск на тій самій версії. */
export async function forkRun(deps: EngineDeps, runId: string, afterStep: number, actor: CoreActor): Promise<RunOutcome> {
  const parent = await deps.repo.getWorkflowRun(runId);
  if (!parent) throw new CoreRuleError('not_found', 'Запуск не знайдено');
  if (!Number.isInteger(afterStep) || afterStep < 1) throw new CoreRuleError('bad_input', 'Крок відгалуження — від 1');
  const saver = new CoreCheckpointSaver(deps.repo);
  const parentDef = await loadDefinition(deps.repo, parent);
  const probe = buildGraph(parentDef, { repo: deps.repo, run: parent, definition: parentDef, services: deps.services, binding: null, actor }).compile({ checkpointer: saver });
  let checkpointId: string | null = null;
  for await (const h of probe.getStateHistory({ configurable: { thread_id: parent.id } })) {
    const st = h.values?.s as WfState | undefined;
    if (st?.steps === afterStep && (h.next ?? []).length) {
      checkpointId = h.config?.configurable?.checkpoint_id ?? null;
      break;
    }
  }
  if (!checkpointId) throw new CoreRuleError('conflict', `Немає контрольної точки після кроку ${afterStep}, з якої можна продовжити (останній вузол чи запуск без збережень)`);
  const run = await deps.repo.addWorkflowRun({
    workflowId: parent.workflowId, versionId: parent.versionId, version: parent.version, definitionHash: parent.definitionHash, projectId: parent.projectId,
    trigger: 'fork', input: parent.input, inputHash: parent.inputHash, startedBy: actor, mode: 'fork', parentRunId: parent.id, forkStep: afterStep,
  });
  await saver.copyThread(parent.id, run.id);
  const env = await envFor(deps, run, parentDef, { actor });
  return drive(deps, env, { checkpointId });
}
