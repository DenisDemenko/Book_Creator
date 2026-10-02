/**
 * Прив'язка процесів ШІ до ролей AI-1 / AI-2 (Т5.4 В2, `PLAN_WORKFLOW_ENGINE.md`;
 * рішення власника §2 п.1): вузли процесу викликають ті самі кроки, що й
 * `runAiRole` — контекст (абзаци й завдання), інструкція (шаблон «Ядра AI»),
 * модель (загальний вузол LLM з параметрами версії), перевірка (схема ролі й
 * доказ), пропозиція (`analysis_findings`, поріг `min_confidence`).
 *
 * Перший запуск отримує готовий запит із задачі (`extras.aiRole`); повтор,
 * відгалуження й продовження після перезапуску відновлюють його з входу
 * запуску (`rebuild`).
 */

import type { CoreActor, CoreRepository, RunRow, WorkflowRunRow } from '../../types';
import {
  beginRoleRun,
  checkRoleOutput,
  persistRoleFindings,
  prepareRolePrompt,
  runAiRole,
  type AiRoleDeps,
  type AiRoleRequest,
  type AiRoleResult,
  type CheckedFinding,
  type RejectedFinding,
  type RoleOutputCheck,
} from '../../ai/roles';
import { CORE_AI_ROLE_MODULE } from '../../ai/rolePrompts';
import { coreTemplateModule } from '../engine/executors';
import { publishedVersion, startRun, type EngineDeps } from '../engine/runner';
import type { BindingDef, EngineServices, WfState } from '../engine/types';

export const AI_ROLE_EXTRAS = 'aiRole';

export interface AiRoleExtras {
  req: AiRoleRequest;
  /** Повний результат (з рядками висновків) — для задачі, що запустила процес. */
  sink?: (res: AiRoleResult) => void;
}

export interface AiRoleBindingSpec {
  workflowId: string;
  role: 'AI-1' | 'AI-2';
  /** Запит із серіалізовного входу запуску (повтор, відгалуження, продовження). */
  rebuild(ctx: { repo: CoreRepository; run: WorkflowRunRow; input: Record<string, unknown> }): Promise<AiRoleRequest | null>;
  /** Після збереження висновків (пам'ять героя — свої записи). Повертає підсумок для результату. */
  afterPersist?(ctx: { repo: CoreRepository; run: WorkflowRunRow; input: Record<string, unknown>; req: AiRoleRequest }, res: AiRoleResult): Promise<Record<string, unknown>>;
}

const costOf = (s: WfState) => ({
  engine: s.llm?.engine ?? '',
  model: s.llm?.model ?? '',
  inputTokens: s.llm?.tokensIn ?? 0,
  outputTokens: s.llm?.tokensOut ?? 0,
  costUsd: s.llm?.costUsd ?? 0,
});

export function aiRoleBinding(spec: AiRoleBindingSpec): BindingDef {
  return {
    workflowId: spec.workflowId,
    async prepare({ repo, run, input, services, extras }) {
      const given = extras?.[AI_ROLE_EXTRAS] as AiRoleExtras | undefined;
      const req = given?.req ?? (await spec.rebuild({ repo, run, input }));
      if (!req) throw new Error('Запит процесу не відновлюється з входу (немає абзаців, героя чи сцени)');
      const sink = given?.sink;
      const module = CORE_AI_ROLE_MODULE[spec.role];
      let finished = false;
      const finishFailed = async (state: WfState, message: string) => {
        const id = state.vars.analysisRunId as string | undefined;
        if (!id || finished) return;
        finished = true;
        await repo.finishRun(req.projectId, id, { status: 'failed', ...(state.llm ? { cost: costOf(state) } : {}), error: message.slice(0, 2000) }).catch(() => {});
      };
      return {
        module,
        executors: {
          CONTEXT: async (node, state) => ({
            patch: { vars: { ...state.vars, paragraphIds: req.paragraphs.map((p) => p.id), entityId: req.entityId ?? null } },
            trace: { details: { paragraphs: req.paragraphs.length, images: (req.images ?? []).length, contextPolicy: node.params?.context_policy ?? null } },
          }),
          // Пам'ять героя вже в завданні AI-2 (контекст героя в сцені) — вузол фіксує її в трасуванні.
          MEMORY: async (node, state) => ({
            patch: {},
            trace: { details: { scope: node.params?.scope ?? 'character', entityId: req.entityId ?? null, inTask: true } },
          }),
          PROMPT: async (node, state, env) => {
            const fromCore = coreTemplateModule(node.params?.template);
            const own = !fromCore && typeof node.params?.template === 'string' && node.params.template.trim() ? String(node.params.template) : undefined;
            const prompt = await prepareRolePrompt({ loadTemplate: services.loadTemplate }, req, own ? { system: own } : undefined);
            const llmNode = env.definition.nodes.find((n) => n.type === 'LLM');
            const pinned = typeof llmNode?.params?.model === 'string' && llmNode.params.model.trim() ? String(llmNode.params.model) : undefined;
            const modelId = pinned ?? (await services.resolveModel(prompt.module));
            const analysis = await beginRoleRun({ repo }, req, modelId, prompt);
            return {
              patch: { prompt: { ...prompt.rendered, module: prompt.module, promptVersion: prompt.promptVersion }, vars: { ...state.vars, analysisRunId: analysis.id } },
              trace: { details: { module: prompt.module, promptVersion: prompt.promptVersion, analysisRunId: analysis.id, template: fromCore ? `core:${fromCore}` : own ? 'own' : 'core' } },
            };
          },
          VALIDATOR: async (_node, state) => {
            const check: RoleOutputCheck = checkRoleOutput(state.llm?.text ?? '', req);
            if (check.ok === false) {
              const bad = check as Extract<RoleOutputCheck, { ok: false }>;
              await finishFailed(state, bad.message);
              const id = String(state.vars.analysisRunId ?? '');
              sink?.({ run: { id } as RunRow, status: 'invalid', findings: [], rejected: [], errors: bad.errors });
              return {
                patch: { validation: { ok: false, errors: bad.errors }, result: { status: 'invalid', runId: id, errors: bad.errors } },
                branch: 'invalid',
                trace: { validationResult: 'invalid', details: { errors: bad.errors.slice(0, 10) } },
              };
            }
            const good = check as Extract<RoleOutputCheck, { ok: true }>;
            const confs = good.checked.map((c) => c.finding.confidence).filter((x): x is number => typeof x === 'number');
            const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
            return {
              patch: { validation: { ok: true, errors: [] }, confidence, vars: { ...state.vars, checked: good.checked, preRejected: good.rejected } },
              branch: 'valid',
              trace: { validationResult: 'valid', confidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)), details: { findings: good.checked.length, noEvidence: good.rejected.length } },
            };
          },
          PROPOSAL: async (node, state) => {
            const id = String(state.vars.analysisRunId ?? '');
            const checked = (state.vars.checked as CheckedFinding[] | undefined) ?? [];
            const pre = (state.vars.preRejected as RejectedFinding[] | undefined) ?? [];
            const min = typeof node.params?.min_confidence === 'number' ? (node.params.min_confidence as number) : 0;
            const res = await persistRoleFindings({ repo }, req, { id } as RunRow, { checked, rejected: pre }, costOf(state), { minConfidence: min });
            finished = true;
            const extra = spec.afterPersist ? await spec.afterPersist({ repo, run, input, req }, res) : {};
            sink?.(Object.assign(res, { extra }));
            const kinds: Record<string, number> = {};
            for (const f of res.findings) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
            return {
              patch: { result: { status: 'done', runId: id, findingIds: res.findings.map((f) => f.id), kinds, rejected: res.rejected.length, ...extra } },
              trace: { decision: `${res.findings.length} пропозицій`, details: { kinds, rejected: res.rejected.length, minConfidence: min } },
            };
          },
        },
        onFailure: async (state, error) => {
          await finishFailed(state, error.message);
          sink?.({ run: { id: String(state.vars.analysisRunId ?? '') } as RunRow, status: 'failed', findings: [], rejected: [], errors: [error.message] });
        },
      };
    },
  };
}

export type AiRoleWorkflowResult = AiRoleResult & { workflowRunId?: string; paused?: boolean; extra?: Record<string, unknown> };

/**
 * Виконати роль через опублікований процес (є — LangGraph, немає — як раніше,
 * `runAiRole`). Задача отримує той самий результат, що й досі.
 */
export async function runAiRoleWorkflow(
  engine: EngineDeps | null | undefined,
  run: { workflowId: string; trigger: string; jobId?: string | null; input: Record<string, unknown> },
  legacy: AiRoleDeps,
  req: AiRoleRequest,
  opts: { afterLegacy?: (res: AiRoleResult) => Promise<Record<string, unknown>> } = {},
): Promise<AiRoleWorkflowResult> {
  const published = engine ? await publishedVersion(engine.repo, run.workflowId).catch(() => null) : null;
  if (!engine || !published) {
    const res = await runAiRole(legacy, req);
    const extra = res.status === 'done' && opts.afterLegacy ? await opts.afterLegacy(res) : {};
    return Object.assign(res, { extra });
  }
  let captured: AiRoleWorkflowResult | null = null;
  const out = await startRun(engine, {
    workflowId: run.workflowId,
    input: run.input,
    projectId: req.projectId,
    trigger: run.trigger,
    jobId: run.jobId ?? null,
    actor: req.createdBy as CoreActor,
    recordUsage: legacy.recordUsage,
    signal: req.signal,
    extras: { [AI_ROLE_EXTRAS]: { req, sink: (r: AiRoleResult) => { captured = r as AiRoleWorkflowResult; } } satisfies AiRoleExtras },
  });
  if (out.error && /JobFatalError|JobCancelledError/.test(out.error.name)) throw out.error;
  const done = captured as AiRoleWorkflowResult | null;
  if (out.run.status === 'paused') return { run: { id: String(out.state?.vars?.analysisRunId ?? '') } as RunRow, status: 'done', findings: [], rejected: [], errors: [], workflowRunId: out.run.id, paused: true, extra: {} };
  if (done) return Object.assign(done, { workflowRunId: out.run.id });
  return { run: { id: String(out.state?.vars?.analysisRunId ?? '') } as RunRow, status: 'failed', findings: [], rejected: [], errors: [out.run.error ?? 'Процес ШІ не завершився'], workflowRunId: out.run.id, extra: {} };
}

export type { EngineServices };
