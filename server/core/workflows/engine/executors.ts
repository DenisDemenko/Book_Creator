/**
 * Загальні виконавці вузлів (Т5.4 В1; ТЗ Graph Studio §5.2–5.3, §16, §30).
 *
 * Прив'язка процесу (AI-1, AI-2, голос героя) може підмінити будь-який із
 * них своїм кроком — тим самим кодом, що й старий шлях; загальні працюють
 * для будь-якого процесу з Graph Studio.
 */

import { createHash } from 'node:crypto';
import type { WorkflowNode } from '../../../../src/utils/workflowGraph';
import { isExecutableNode, nodeTypeById } from '../../../../src/utils/workflowGraph';
import { evalCondition } from '../../../../src/utils/workflowExpr';
import { parseModelJson, validateAgainstSchema } from '../../ai/schema';
import type { CoreAiModule } from '../../ai/rolePrompts';
import { callStoryCore } from '../../storyCore/api';
import { NodeError, type ExecEnv, type NodeExecutor, type NodeOutcome, type WfState } from './types';
import { JEV_EXECUTORS } from './jev';

const CORE_MODULES: CoreAiModule[] = ['coreAi1Classify', 'coreAi2Analysis', 'coreAi3Visual', 'coreSearchInterpret', 'coreCharacterVoice'];
export const DEFAULT_WORKFLOW_MODULE: CoreAiModule = 'coreAi2Analysis';

const num = (v: unknown, d?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** `core:<модуль>` → модуль «Ядра AI»; інакше null (власний текст). */
export function coreTemplateModule(template: unknown): CoreAiModule | null {
  const m = /^core:([A-Za-z0-9]+)$/.exec(str(template).trim());
  return m && (CORE_MODULES as string[]).includes(m[1]) ? (m[1] as CoreAiModule) : null;
}

/** `{{ключ}}` → значення з `vars` чи `input` (рядок або JSON). */
export function renderPlaceholders(text: string, state: WfState): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    const root = key.startsWith('input.') ? state.input : state.vars;
    const path = key.startsWith('input.') ? key.slice(6).split('.') : key.split('.');
    let cur: unknown = root;
    for (const k of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    return cur == null ? '' : typeof cur === 'string' ? cur : JSON.stringify(cur);
  });
}

export const promptVersionOf = (system: string, user: string) => createHash('sha256').update(`${system}\u0000${user}`).digest('hex').slice(0, 12);

const START: NodeExecutor = async (node, state) => {
  const schema = node.params?.input_schema;
  if (schema && typeof schema === 'object' && Object.keys(schema).length) {
    const check = validateAgainstSchema(schema as object, state.input);
    if (!check.ok) throw new NodeError(`Вхід не відповідає схемі START: ${check.errors.join('; ')}`, 'bad_input', { validationResult: 'invalid' });
  }
  return { trace: { details: { inputKeys: Object.keys(state.input) } } };
};

const END: NodeExecutor = async () => ({});

/** PROMPT: шаблон «Ядра AI» (`core:<модуль>`, з правками адміна) чи власний текст із `{{змінними}}`. */
const PROMPT: NodeExecutor = async (node, state, env) => {
  const module = coreTemplateModule(node.params?.template);
  let system: string;
  let user: string;
  if (module) {
    const t = (await env.services.loadTemplate?.(module)) ?? { system: '', user: '' };
    system = renderPlaceholders(t.system, state);
    user = renderPlaceholders(t.user, state);
  } else {
    system = renderPlaceholders(str(node.params?.template), state);
    user = renderPlaceholders(str(state.vars.user_prompt ?? state.input.text ?? ''), state);
  }
  const promptVersion = str(node.params?.prompt_version) || promptVersionOf(system, user);
  return { patch: { prompt: { system, user, module: module ?? undefined, promptVersion } }, trace: { details: { module, promptVersion } } };
};

/**
 * LLM (§5.3, §30): модель і постачальник, температура, ліміт токенів,
 * тайм-аут, повтори з паузою, резервна модель, ліміт витрат.
 */
const LLM: NodeExecutor = async (node, state, env) => {
  const p = node.params ?? {};
  if (!state.prompt) throw new NodeError('Перед моделлю потрібна інструкція (PROMPT)', 'bad_input');
  const module = (state.prompt.module as CoreAiModule | undefined) ?? env.binding?.module ?? DEFAULT_WORKFLOW_MODULE;
  const provider = str(p.model_provider) || 'core_module';
  let model = str(p.model).trim() || undefined;
  if (!model && provider === 'core_module') model = await env.services.resolveModel(module);
  if (!model && provider !== 'core_module') throw new NodeError(`Для постачальника «${provider}» вкажіть модель`, 'bad_input');
  const costLimit = num(p.cost_limit);
  if (costLimit !== undefined && costLimit > 0 && state.cost >= costLimit) throw new NodeError(`Ліміт витрат $${costLimit} вичерпано до виклику моделі`, 'cost_limit');
  const system = [state.prompt.system, str(p.system_prompt).trim()].filter(Boolean).join('\n\n');
  const generation = {
    temperature: num(p.temperature),
    maxTokens: num(p.max_tokens),
    timeoutMs: num(p.timeout) !== undefined ? num(p.timeout)! * 1000 : undefined,
  };
  const retries = Math.max(0, Math.min(5, num(p.retry_count, 0)!));
  const sleep = env.services.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const warnings: string[] = [];
  let attempt = 0;
  let current = model;
  let switched = false;
  let out: Awaited<ReturnType<ExecEnv['services']['generate']>> | null = null;
  while (!out) {
    try {
      out = await env.services.generate({ module, modelId: current, system, user: state.prompt.user, projectId: env.run.projectId ?? '', actor: env.actor, signal: env.signal, generation });
    } catch (err) {
      const e = err as Error;
      const timeout = e.name === 'AiTimeoutError';
      const policy = str(timeout ? p.on_timeout : p.on_provider_error) || 'fail';
      if (attempt < retries) {
        attempt++;
        warnings.push(`${timeout ? 'тайм-аут' : 'збій'}: ${e.message.slice(0, 200)} — повтор ${attempt}/${retries}`);
        if (str(p.backoff) !== 'none') await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      const alt = str(p.alternate_model).trim();
      if (!switched && policy === 'alternate_model' && alt) {
        switched = true;
        current = alt;
        warnings.push(`${timeout ? 'тайм-аут' : 'збій'}: ${e.message.slice(0, 200)} — резервна модель ${alt}`);
        continue;
      }
      throw new NodeError(e.message, timeout ? 'timeout' : 'provider', { model: current ?? null, retryCount: attempt, warnings });
    }
  }
  const trace = { model: out.modelId, tokensIn: out.inputTokens, tokensOut: out.outputTokens, costUsd: out.costUsd, retryCount: attempt, warnings, details: { provider, module, switchedToAlternate: switched } };
  const llm = { text: out.text, model: out.modelId, engine: out.engine, tokensIn: out.inputTokens, tokensOut: out.outputTokens, costUsd: out.costUsd };
  // Бюджет задачі — поза повторами: вичерпаний бюджет не повторюють (помилка задачі як є).
  if (env.recordUsage) {
    try {
      await env.recordUsage({ tokens: out.inputTokens + out.outputTokens, requests: 1 });
    } catch (err) {
      throw Object.assign(err as Error, { trace, llm });
    }
  }
  const cost = state.cost + out.costUsd;
  if (costLimit !== undefined && costLimit > 0 && cost > costLimit) {
    throw Object.assign(new NodeError(`Ліміт витрат вузла $${costLimit} перевищено ($${cost.toFixed(4)})`, 'cost_limit', trace), { llm });
  }
  return { patch: { llm, cost }, trace };
};

/** VALIDATOR: JSON зі звіркою схеми вузла; гілки valid / invalid. */
const VALIDATOR: NodeExecutor = async (node, state) => {
  const raw = state.llm?.text ?? (typeof state.output === 'string' ? state.output : JSON.stringify(state.output ?? null));
  let parsed: unknown;
  try {
    parsed = parseModelJson(String(raw ?? ''));
  } catch (err) {
    const errors = [`відповідь не JSON: ${(err as Error).message}`];
    return { patch: { validation: { ok: false, errors } }, branch: 'invalid', trace: { validationResult: 'invalid', details: { errors } } };
  }
  const schema = node.params?.output_schema;
  if (schema && typeof schema === 'object' && Object.keys(schema).length) {
    const check = validateAgainstSchema(schema as object, parsed);
    if (!check.ok) return { patch: { output: parsed, validation: { ok: false, errors: check.errors } }, branch: 'invalid', trace: { validationResult: 'invalid', details: { errors: check.errors } } };
  }
  const conf = parsed && typeof parsed === 'object' ? num((parsed as Record<string, unknown>).confidence) : undefined;
  return { patch: { output: parsed, validation: { ok: true, errors: [] }, ...(conf !== undefined ? { confidence: conf } : {}) }, branch: 'valid', trace: { validationResult: 'valid', confidence: conf ?? null } };
};

/** CONDITION: безпечний вираз над станом (§16; №11 — поріг без коду). */
const CONDITION: NodeExecutor = async (node, state) => {
  const expr = str(node.params?.expression);
  let ok: boolean;
  try {
    ok = evalCondition(expr, state);
  } catch (err) {
    throw new NodeError(`Умова «${expr}»: ${(err as Error).message}`, 'bad_input');
  }
  return { branch: ok ? 'true' : 'false', trace: { decision: ok ? 'true' : 'false', details: { expression: expr } } };
};

/** QUERY: читання Story Core API (§33) — лише операції читання, від імені процесу. */
const QUERY: NodeExecutor = async (node, state, env) => {
  const op = str(node.params?.operation) || 'search_entities';
  const args: Record<string, unknown> = { ...(state.vars[`query_args_${node.id}`] as Record<string, unknown> | undefined) };
  if (Array.isArray(node.params?.entity_scope) && (node.params!.entity_scope as unknown[]).length) args.types = node.params!.entity_scope;
  if (num(node.params?.limit)) args.limit = num(node.params?.limit);
  const data = await callStoryCore(op, { repo: env.repo, actor: 'system:workflow', projectId: env.run.projectId, rights: { read: true, propose: false, approve: false, publishSchema: false } }, args);
  return { patch: { vars: { ...state.vars, [`query_${node.id}`]: data } }, trace: { details: { operation: op } } };
};

/** TOOL: інструмент прив'язки чи платформи. */
const TOOL: NodeExecutor = async (node, state, env) => {
  const id = str(node.params?.tool);
  const fn = env.binding?.tools?.[id];
  if (!fn) throw new NodeError(`Інструмента «${id}» немає в реєстрі`, 'bad_input');
  return fn(node, state, env);
};

/** Без прив'язки CONTEXT / MEMORY / PROPOSAL нічого не знають про книгу — кажемо прямо. */
const needsBinding = (what: string): NodeExecutor => async () => {
  throw new NodeError(`${what}: цей вузол виконується лише в процесі з прив'язкою до конвеєра (AI-1, AI-2, голос героя)`, 'binding');
};

/** PROPOSAL без прив'язки: результат — вихід моделі (пропозицію створює прив'язка). */
const PROPOSAL: NodeExecutor = async (node, state) => {
  const min = num(node.params?.min_confidence, 0)!;
  if (state.confidence != null && state.confidence < min) {
    return { patch: { result: { proposed: false, reason: 'low_confidence', confidence: state.confidence } }, trace: { decision: 'below_threshold', confidence: state.confidence } };
  }
  return { patch: { result: { proposed: true, target: node.params?.target, output: state.output ?? null } }, trace: { decision: 'proposed', confidence: state.confidence ?? null } };
};

export const GENERIC_EXECUTORS: Record<string, NodeExecutor> = {
  START,
  END,
  PROMPT,
  LLM,
  VALIDATOR,
  CONDITION,
  QUERY,
  TOOL,
  PROPOSAL,
  CONTEXT: needsBinding('Контекст'),
  MEMORY: needsBinding('Пам\'ять'),
};

/** Виконавець вузла: прив'язки, інакше загальний; невиконуваний тип — зрозуміла помилка. */
export function executorFor(node: WorkflowNode, env: ExecEnv): NodeExecutor {
  const own = env.binding?.executors[node.type];
  if (own) return own;
  if (!isExecutableNode(node.type)) {
    const name = nodeTypeById(node.type)?.name.uk ?? node.type;
    const when = ['HUMAN_REVIEW', 'CANON_WRITE'].includes(node.type) ? 'Т5.6' : node.type === 'CONTINUITY_GATE' ? 'Т5.7' : 'пізніших етапах';
    return async () => {
      throw new NodeError(`Вузол «${name}» (${node.type}) рушій виконуватиме з ${when}`, 'not_executable');
    };
  }
  // Т5.5: вузли Jev і підпроцес — у `jev.ts` (бере звідси `renderPlaceholders`; тому — лише під час виклику).
  return GENERIC_EXECUTORS[node.type] ?? JEV_EXECUTORS[node.type];
}

export type { NodeOutcome };
