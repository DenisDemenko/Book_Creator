/**
 * Шар рішень Jev у процесах ШІ (Т5.5 В1, `PLAN_JEV_NODES.md`; ТЗ Graph
 * Studio §6–§10, §16, §17, §20–§22, §36, §39 №9–12).
 *
 *   JEV_CHOICE / JEV_SCORE / JEV_NOUL — примітиви Jev як вузли (№9);
 *   JEV_GATE — питання + поріг + маршрут (§20);
 *   JEV_ROUTER — гілки на канві або реєстр напрямків → підпроцес (№10);
 *   JEV_EVALUATOR — оцінка за критеріями, не факт канону (§21);
 *   JEV_DECISION_BUNDLE — кілька незалежних питань одним запитом (§22);
 *   SUBGRAPH — інший опублікований процес дочірнім запуском.
 *
 * Хто відповідає (рішення власника §2 п.1): справжній Jev, а при збої чи
 * без ключа — ті самі питання запасному LLM (модуль AI-2 «Ядра AI»).
 * Поріг (№11), маршрутизація за впевненістю (§16, №12) і узгодження моделей
 * (§17) — параметри вузла, редагуються в Graph Studio без зміни коду.
 *
 * Значення Jev — модельні евристики, не доказ істини у світі книги (ТЗ-H §2):
 * вузли пишуть лише в змінні запуску, канон не чіпають.
 */

import {
  JEV_USD_PER_MTOK,
  LlmFallbackJevAdapter,
  enforceAllowed,
  noulProbability,
  type JevAdapter,
  type JevQuestion,
  type JevRawAnswer,
} from '../../../ai/adapters/jev';
import type { LlmJson } from '../../../ai/adapters/llm';
import { DESTINATION_ID_RE, routerRegistry, type BundleQuestion, type WorkflowNode } from '../../../../src/utils/workflowGraph';
import type { CoreAiModule } from '../../ai/rolePrompts';
import { renderPlaceholders } from './executors';
import { NodeError, type ExecEnv, type NodeExecutor, type NodeOutcome, type StepTrace, type WfState } from './types';

const num = (v: unknown, d?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const round = (x: number, k = 1000) => Math.round(x * k) / k;
const listOf = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

/** Ліміт Jev на стан — 32k токенів; ріжемо грубо за символами з запасом. */
const STATE_CHAR_LIMIT = 60_000;
const STRING_LIMIT = 4_000;

// ── Нормалізована відповідь ────────────────────────────────────────────────

export interface JevAnswerN {
  kind: 'choice' | 'score' | 'noul';
  /** choice: обраний варіант (лише з дозволених). */
  selected?: string;
  /** choice / score: розподіл, як його дала модель (score — за рівнями). */
  distribution?: Record<string, number>;
  /** score: позиція 0…N-1, кількість рівнів, значення в межах шкали вузла. */
  position?: number;
  levels?: number;
  value?: number;
  /** noul: імовірність «так» 0–1. */
  probability?: number;
  confidence: number | null;
  /** choice: модель обрала недозволене — взято найімовірніший дозволений. */
  corrected?: boolean;
}

export interface JevOutcome {
  source: 'jev' | 'mock' | 'llm_fallback';
  model: string;
  answers: Record<string, JevAnswerN>;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  fallbackReason: string | null;
}

/** Шкала вузла JEV_SCORE: рівні й межі. */
interface ScaleSpec {
  min: number;
  max: number;
}

export function normalizeAnswer(q: JevQuestion, a: any, source: JevOutcome['source'], scale?: ScaleSpec): JevAnswerN | null {
  if (!a || typeof a !== 'object') return null;
  const conf = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? round(Math.max(0, Math.min(1, a.confidence))) : null;
  const dist = a.probabilities && typeof a.probabilities === 'object'
    ? Object.fromEntries(Object.entries(a.probabilities as Record<string, unknown>).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, round(v as number)]))
    : undefined;
  if (q.kind === 'choice') {
    const opts = Object.keys(q.options);
    const raw = String(a.choice ?? '');
    if (!raw && !dist) return null;
    const { action, corrected } = enforceAllowed(raw, dist, opts);
    const top = dist && Object.keys(dist).length ? Math.max(...Object.values(dist)) : null;
    return { kind: 'choice', selected: action, distribution: dist ?? {}, confidence: conf ?? (top !== null ? round(top) : null), ...(corrected ? { corrected } : {}) };
  }
  if (q.kind === 'score') {
    const n = q.levels.length;
    const s = Number(a.score);
    if (!Number.isFinite(s)) return null;
    const position = round(Math.max(0, Math.min(n - 1, s)), 100);
    const lo = scale?.min ?? 0;
    const hi = scale?.max ?? 10;
    const value = round(lo + (position / Math.max(1, n - 1)) * (hi - lo), 100);
    const top = dist && Object.keys(dist).length ? Math.max(...Object.values(dist)) : null;
    return { kind: 'score', position, levels: n, value, distribution: dist ?? {}, confidence: conf ?? (top !== null ? round(top) : null) };
  }
  const p = noulProbability(a);
  if (p === null) return null;
  // Запасний LLM впевненості чесно не дає; у Jev без поля — наскільки відповідь далека від «не знаю».
  return { kind: 'noul', probability: p, confidence: conf ?? (source === 'llm_fallback' ? null : round(Math.abs(2 * p - 1))) };
}

// ── Хто відповідає ─────────────────────────────────────────────────────────

/** LLM запасного шляху: модуль AI-2 (чи вказана модель), облік — як у вузла LLM. */
function llmJson(env: ExecEnv, model?: string, module: CoreAiModule = 'coreAi2Analysis'): LlmJson {
  return async (system, user) => {
    const modelId = model?.trim() || (await env.services.resolveModel(module));
    const out = await env.services.generate({ module, modelId, system, user, projectId: env.run.projectId ?? '', actor: env.actor, signal: env.signal, generation: { temperature: 0 } });
    if (env.recordUsage) await env.recordUsage({ tokens: out.inputTokens + out.outputTokens, requests: 1 });
    return { text: out.text, modelId: out.modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd };
  };
}

interface AskOpts {
  scale?: ScaleSpec;
  /** Лише LLM (друга перевірка, моделі узгодження). */
  llmOnly?: { model?: string; module?: CoreAiModule };
}

class JevUnavailable extends Error {}

function toOutcome(raw: JevRawAnswer & { costUsd?: number }, source: JevOutcome['source'], questions: JevQuestion[], opts: AskOpts, fallbackReason: string | null): JevOutcome {
  const answers: Record<string, JevAnswerN> = {};
  const missing: string[] = [];
  for (const q of questions) {
    const n = normalizeAnswer(q, raw.answers?.[q.id], source, opts.scale);
    if (n) answers[q.id] = n;
    else missing.push(q.id);
  }
  if (missing.length) throw new JevUnavailable(`${source === 'llm_fallback' ? 'Запасний LLM' : 'Jev'} не відповів на: ${missing.join(', ')}`);
  const costUsd = source === 'jev' ? round((raw.usage.input_tokens / 1_000_000) * JEV_USD_PER_MTOK, 1_000_000) : round(raw.costUsd ?? 0, 1_000_000);
  return { source, model: raw.model, answers, tokensIn: raw.usage.input_tokens, tokensOut: raw.usage.output_tokens, costUsd, fallbackReason };
}

/** Jev, а при збої чи без ключа — запасний LLM (§2 п.1). Ніхто не відповів — `JevUnavailable`. */
export async function askJev(env: ExecEnv, jevState: Record<string, unknown>, questions: JevQuestion[], opts: AskOpts = {}): Promise<JevOutcome> {
  const fallback = new LlmFallbackJevAdapter(llmJson(env, opts.llmOnly?.model, opts.llmOnly?.module));
  let reason: string | null = null;
  if (!opts.llmOnly) {
    let primary: JevAdapter | null = null;
    try {
      primary = (await env.services.jev?.()) ?? null;
    } catch (err) {
      reason = `ключ Jev недоступний: ${(err as Error).message}`;
    }
    if (primary?.askState) {
      try {
        const raw = await primary.askState(jevState, questions, { signal: env.signal });
        return toOutcome(raw, primary.name === 'mock' ? 'mock' : primary.name === 'llm_fallback' ? 'llm_fallback' : 'jev', questions, opts, null);
      } catch (err) {
        reason = (err as Error).message;
      }
    } else if (!reason) reason = 'Jev не налаштовано (немає ключа TypeSafe)';
  }
  try {
    const raw = await fallback.askState(jevState, questions);
    return toOutcome(raw, 'llm_fallback', questions, opts, reason);
  } catch (err) {
    throw new JevUnavailable(reason ? `${reason}; запасний LLM: ${(err as Error).message}` : (err as Error).message);
  }
}

// ── Стан і питання ─────────────────────────────────────────────────────────

const clip = (v: unknown, depth = 0): unknown => {
  if (typeof v === 'string') return v.length > STRING_LIMIT ? `${v.slice(0, STRING_LIMIT)}…` : v;
  if (Array.isArray(v)) return depth > 5 ? `[${v.length}]` : v.slice(0, 50).map((x) => clip(x, depth + 1));
  if (v && typeof v === 'object') return depth > 5 ? '{…}' : Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 80).map(([k, x]) => [k, clip(x, depth + 1)]));
  return v;
};

function pick(state: WfState, key: string): unknown {
  const [root, ...path] = key.split('.');
  let cur: unknown =
    root === 'input' ? state.input : root === 'vars' ? state.vars : root === 'output' ? state.output : root === 'confidence' ? state.confidence : root === 'result' ? state.result : root === 'llm' ? state.llm?.text : state.vars[root];
  for (const k of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
  return cur;
}

/** Вхідний стан для Jev (§36): ключі вузла; без них — вхід, змінні й вихід. */
export function jevStateFor(node: WorkflowNode, state: WfState): Record<string, unknown> {
  const keys = listOf(node.params?.input_state);
  const base: Record<string, unknown> = keys.length
    ? Object.fromEntries(keys.map((k) => [k, pick(state, k)]).filter(([, v]) => v !== undefined))
    : { input: state.input, vars: state.vars, ...(state.output !== undefined ? { output: state.output } : {}) };
  let out = clip(base) as Record<string, unknown>;
  // Ліміт Jev: найбільші поля — геть, доки не вміститься.
  while (JSON.stringify(out).length > STATE_CHAR_LIMIT && Object.keys(out).length > 1) {
    const biggest = Object.entries(out).sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0][0];
    out = { ...out, [biggest]: `(обрізано: понад ліміт стану Jev)` };
    if (JSON.stringify(out).length <= STATE_CHAR_LIMIT) break;
  }
  return out;
}

const questionText = (node: WorkflowNode, state: WfState) => renderPlaceholders(str(node.params?.question), state).trim();

/** Рівні шкали JEV_SCORE: свої (2–10) або 6 рівномірних між «від» і «до». */
export function scoreLevels(node: WorkflowNode): { levels: string[]; scale: ScaleSpec } {
  const min = num(node.params?.scale_min, 0)!;
  const max = num(node.params?.scale_max, 10)!;
  const own = listOf(node.params?.levels);
  if (own.length >= 2) return { levels: own.slice(0, 10), scale: { min, max } };
  const n = 6;
  const levels = Array.from({ length: n }, (_, i) => String(round(min + (i / (n - 1)) * (max - min), 100)));
  return { levels, scale: { min, max } };
}

/** Питання пакета (§22) → питання Jev. */
export function bundleJevQuestions(raw: unknown): JevQuestion[] {
  const list = (Array.isArray(raw) ? raw : []) as BundleQuestion[];
  return list.map((q) =>
    q.kind === 'choice'
      ? { id: q.id, kind: 'choice', instructions: q.question, options: Object.fromEntries(listOf(q.options).map((o) => [o, null])) }
      : q.kind === 'score'
        ? { id: q.id, kind: 'score', instructions: q.question, levels: listOf(q.levels) }
        : { id: q.id, kind: 'noul', instructions: q.question },
  );
}

// ── Згода двох відповідей (друга перевірка, узгодження) ────────────────────

function agrees(a: JevAnswerN, b: JevAnswerN, threshold: number): boolean {
  if (a.kind === 'choice') return a.selected === b.selected;
  if (a.kind === 'score') return Math.abs((a.position ?? 0) - (b.position ?? 0)) <= 1;
  return (a.probability ?? 0) >= threshold === (b.probability ?? 0) >= threshold;
}
const allAgree = (x: JevOutcome, y: JevOutcome, threshold: number) => Object.keys(x.answers).every((k) => !!y.answers[k] && agrees(x.answers[k], y.answers[k], threshold));

const brief = (o: JevOutcome) =>
  Object.fromEntries(Object.entries(o.answers).map(([k, a]) => [k, a.kind === 'choice' ? a.selected : a.kind === 'score' ? a.value : a.probability]));

// ── Маршрутизація за впевненістю (§16) і узгодження (§17) ─────────────────

const IMPORTANCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Чи вмикати узгодження за політикою вузла (важливість, ризик, бюджет). */
export function consensusPolicy(node: WorkflowNode, state: WfState): { on: boolean; reason: string } {
  const p = node.params ?? {};
  const imp = IMPORTANCE_RANK[str(p.importance) || 'medium'] ?? 1;
  const risk = RISK_RANK[str(p.risk) || 'low'] ?? 0;
  const fromImp = str(p.consensus_from_importance) || 'never';
  const fromRisk = str(p.consensus_from_risk) || 'never';
  const byImp = fromImp !== 'never' && imp >= (IMPORTANCE_RANK[fromImp] ?? 99);
  const byRisk = fromRisk !== 'never' && risk >= (RISK_RANK[fromRisk] ?? 99);
  if (!byImp && !byRisk) return { on: false, reason: fromImp === 'never' && fromRisk === 'never' ? 'вимкнено' : 'важливість і ризик нижчі за політику' };
  const budget = num(p.consensus_budget, 0.05)!;
  if (state.cost >= budget) return { on: false, reason: `бюджет узгодження $${budget} вичерпано (запуск: $${state.cost.toFixed(4)})` };
  return { on: true, reason: byImp ? `важливість «${p.importance ?? 'medium'}»` : `ризик «${p.risk ?? 'low'}»` };
}

type Tier = 'high' | 'medium' | 'low';
export function confidenceTier(node: WorkflowNode, confidence: number | null): Tier {
  if (confidence === null) return 'medium';
  const hi = num(node.params?.confidence_high, 0.9)!;
  const mid = num(node.params?.confidence_medium, 0.6)!;
  return confidence >= hi ? 'high' : confidence >= mid ? 'medium' : 'low';
}

const nodeConfidence = (o: JevOutcome): number | null => {
  const c = Object.values(o.answers).map((a) => a.confidence).filter((x): x is number => x !== null);
  return c.length ? round(Math.min(...c)) : null;
};

// ── Спільний перебіг вузла Jev ─────────────────────────────────────────────

interface Interpretation {
  /** Гілка, якщо рішення приймається (AUTO_ROUTE чи згода). */
  branch: string;
  /** Короткий підсумок для трасування. */
  decision: string;
  /** Результат вузла — у `vars.<id вузла>` і для відображення виходу. */
  result: Record<string, unknown>;
  /** Поріг на впевненість (не для NOUL / GATE). */
  confidenceGate?: boolean;
}

interface JevSpec {
  questions: JevQuestion[];
  scale?: ScaleSpec;
  /** Поріг для згоди NOUL / GATE. */
  agreeThreshold?: number;
  interpret: (o: JevOutcome, state: WfState) => Promise<Interpretation> | Interpretation;
  /** Після рішення, коли гілка — далі (маршрутизатор із реєстром: підпроцес). */
  proceed?: (r: Interpretation, state: WfState) => Promise<{ result: Record<string, unknown>; trace?: StepTrace; cost?: number }>;
}

/** Відображення виходу (§36): `{"змінна": "поле.шлях"}` з результату вузла. */
function mapOutput(node: WorkflowNode, result: Record<string, unknown>): Record<string, unknown> {
  const m = node.params?.output_mapping;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(m as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || typeof field !== 'string') continue;
    let cur: unknown = result;
    for (const k of field.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    if (cur !== undefined) out[name] = cur;
  }
  return out;
}

async function runJevNode(node: WorkflowNode, state: WfState, env: ExecEnv, spec: JevSpec): Promise<NodeOutcome> {
  const p = node.params ?? {};
  const logging = p.logging !== false;
  const question = questionText(node, state);
  if (spec.questions.some((q) => !q.instructions.trim())) throw new NodeError(`Вузол «${node.label || node.id}»: питання порожнє`, 'bad_input');
  const jevState = jevStateFor(node, state);
  const warnings: string[] = [];
  const details: Record<string, unknown> = {};
  const threshold = num(p.threshold, 0)!;
  let cost = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const models: string[] = [];
  const spend = (o: JevOutcome) => {
    cost += o.costUsd;
    tokensIn += o.tokensIn;
    tokensOut += o.tokensOut;
    models.push(o.model);
  };
  const finish = (branch: string, decision: string, confidence: number | null, result: Record<string, unknown>, extra: Partial<StepTrace> = {}): NodeOutcome => {
    const full = { ...result, branch };
    const vars = { ...state.vars, [node.id]: full, ...mapOutput(node, full) };
    return {
      branch,
      patch: { vars, confidence, cost: state.cost + cost },
      trace: {
        model: models.join(' + ') || null, tokensIn, tokensOut, costUsd: round(cost, 1_000_000), decision: decision.slice(0, 400), confidence, warnings,
        details: logging ? { question, questions: spec.questions, jevState, ...details } : { questions: spec.questions.map((q) => q.id), ...details },
        ...extra,
      },
    };
  };

  // 1. Рішення: Jev → запасний LLM; ніхто — резервний маршрут.
  let o: JevOutcome;
  try {
    o = await askJev(env, jevState, spec.questions, { scale: spec.scale });
  } catch (err) {
    if (!(err instanceof JevUnavailable)) throw err;
    warnings.push(err.message.slice(0, 400));
    details.unavailable = err.message;
    return finish('fallback', 'Jev і запасний LLM не відповіли', null, { source: null, reason: 'unavailable' });
  }
  spend(o);
  if (o.fallbackReason) warnings.push(`запасний LLM: ${o.fallbackReason}`.slice(0, 400));
  details.source = o.source;
  details.answers = o.answers;
  if (o.fallbackReason) details.fallbackReason = o.fallbackReason;
  const confidence = nodeConfidence(o);
  const r = await spec.interpret(o, state);
  const result = { ...r.result, source: o.source, model: o.model, confidence };
  const agreeAt = spec.agreeThreshold ?? 0.5;

  // 2. Узгодження кількох моделей (§17) — лише за політикою.
  const policy = consensusPolicy(node, state);
  details.consensus = { policy: policy.reason };
  let agreed = false;
  if (policy.on) {
    const a = await askJev(env, jevState, spec.questions, { scale: spec.scale, llmOnly: { model: str(p.consensus_model_a), module: 'coreAi2Analysis' } }).catch((e) => e as Error);
    const b = await askJev(env, jevState, spec.questions, { scale: spec.scale, llmOnly: { model: str(p.consensus_model_b), module: 'coreAi1Classify' } }).catch((e) => e as Error);
    if (!(a instanceof Error)) spend(a);
    if (!(b instanceof Error)) spend(b);
    const ok = !(a instanceof Error) && !(b instanceof Error) && allAgree(o, a, agreeAt) && allAgree(o, b, agreeAt);
    details.consensus = {
      policy: policy.reason,
      jev: brief(o),
      a: a instanceof Error ? { error: a.message.slice(0, 200) } : { model: a.model, answers: brief(a) },
      b: b instanceof Error ? { error: b.message.slice(0, 200) } : { model: b.model, answers: brief(b) },
      agree: ok,
    };
    if (!ok) return finish('review', 'розбіжність моделей — на перевірку', confidence, { ...result, consensus: 'disagree' });
    agreed = true;
  } else if (policy.reason.startsWith('бюджет')) warnings.push(`узгодження пропущено: ${policy.reason}`);

  // 3. Маршрутизація за впевненістю (§16).
  const tier: Tier = agreed ? 'high' : confidenceTier(node, confidence);
  const action = str(p[`on_${tier}`]) || 'AUTO_ROUTE';
  details.routing = { tier, action, ...(agreed ? { by: 'consensus' } : {}) };
  if (action === 'FALLBACK') return finish('fallback', `впевненість ${tier === 'low' ? 'низька' : tier === 'medium' ? 'середня' : 'висока'} → резервний маршрут`, confidence, { ...result, routing: action });
  if (action === 'HUMAN_REVIEW') return finish('review', 'на перевірку людиною (§16)', confidence, { ...result, routing: action });
  if (action === 'SECOND_OPINION') {
    const second = await askJev(env, jevState, spec.questions, { scale: spec.scale, llmOnly: { model: str(p.second_opinion_model), module: 'coreAi2Analysis' } }).catch((e) => e as Error);
    if (!(second instanceof Error)) spend(second);
    const ok = !(second instanceof Error) && allAgree(o, second, agreeAt);
    details.secondOpinion = second instanceof Error ? { error: second.message.slice(0, 200) } : { model: second.model, answers: brief(second), agree: ok };
    if (!ok) return finish('review', 'друга перевірка не збіглась — на перевірку', confidence, { ...result, routing: action });
  }

  // 4. Поріг впевненості (№11) — для рішень, що не мають порогу імовірності.
  if (r.confidenceGate !== false && threshold > 0 && confidence !== null && confidence < threshold) {
    return finish('fallback', `впевненість ${confidence} нижча за поріг ${threshold}`, confidence, { ...result, belowThreshold: true });
  }

  // 5. Далі: гілка рішення (маршрутизатор із реєстром — ще й підпроцес).
  if (spec.proceed) {
    const more = await spec.proceed(r, state);
    if (more.trace?.warnings) warnings.push(...more.trace.warnings);
    cost += more.cost ?? 0;
    tokensIn += more.trace?.tokensIn ?? 0;
    tokensOut += more.trace?.tokensOut ?? 0;
    Object.assign(details, more.trace?.details ?? {});
    return finish(r.branch, r.decision, confidence, { ...result, ...more.result });
  }
  return finish(r.branch, r.decision, confidence, result);
}

// ── Підпроцес (SUBGRAPH; маршрутизатор із реєстром) ────────────────────────

const MAX_SUBGRAPH_DEPTH = 3;

export async function runSubgraph(env: ExecEnv, workflowId: string, state: WfState, nodeId: string): Promise<{ result: Record<string, unknown>; trace: StepTrace; cost: number }> {
  if (!env.engine) throw new NodeError('Підпроцес: рушій недоступний', 'binding');
  // Глибина й самовиклик — за ланцюжком батьків.
  const chain: string[] = [env.run.workflowId];
  let cur = env.run;
  while (cur.mode === 'subgraph' && cur.parentRunId) {
    const parent = await env.repo.getWorkflowRun(cur.parentRunId);
    if (!parent) break;
    chain.push(parent.workflowId);
    cur = parent;
  }
  if (chain.includes(workflowId)) throw new NodeError(`Підпроцес «${workflowId}» уже виконується вище в ланцюжку (${chain.reverse().join(' → ')}) — цикл`, 'bad_input');
  if (chain.length > MAX_SUBGRAPH_DEPTH) throw new NodeError(`Підпроцеси вкладені глибше за ${MAX_SUBGRAPH_DEPTH}`, 'bad_input');
  const { startRun } = await import('./runner');
  const input = { ...state.input, parent: { runId: env.run.id, workflowId: env.run.workflowId, node: nodeId, vars: clip(state.vars), ...(state.output !== undefined ? { output: clip(state.output) } : {}) } };
  let out;
  try {
    out = await startRun(env.engine, { workflowId, input, projectId: env.run.projectId, trigger: 'subgraph', actor: env.actor, parentRunId: env.run.id, recordUsage: env.recordUsage, signal: env.signal });
  } catch (err) {
    throw new NodeError(`Підпроцес «${workflowId}»: ${(err as Error).message}`, 'bad_input');
  }
  const child = out.run;
  const trace: StepTrace = { tokensIn: child.tokensIn, tokensOut: child.tokensOut, costUsd: child.costUsd, details: { subgraph: { runId: child.id, workflowId, version: child.version, status: child.status } } };
  if (child.status !== 'succeeded') {
    throw new NodeError(`Підпроцес «${workflowId}» ${child.status === 'paused' ? 'призупинено' : `не вдався: ${child.error ?? child.status}`}`, 'bad_input', trace);
  }
  return { result: { runId: child.id, workflowId, version: child.version, status: child.status, output: child.output ?? {} }, trace, cost: child.costUsd };
}

const SUBGRAPH: NodeExecutor = async (node, state, env) => {
  const workflowId = str(node.params?.workflow_id).trim();
  if (!workflowId) throw new NodeError('Підпроцес: оберіть процес', 'bad_input');
  const sub = await runSubgraph(env, workflowId, state, node.id);
  return { patch: { vars: { ...state.vars, [node.id]: sub.result }, cost: state.cost + sub.cost }, trace: { ...sub.trace, decision: `підпроцес ${workflowId} v${sub.result.version}` } };
};

// ── Вузли ──────────────────────────────────────────────────────────────────

const choiceQuestion = (node: WorkflowNode, state: WfState, options: Record<string, string | null>): JevQuestion => ({ id: 'choice', kind: 'choice', instructions: questionText(node, state), options });

const JEV_CHOICE: NodeExecutor = (node, state, env) => {
  const options = listOf(node.params?.options);
  if (options.length < 2) throw new NodeError('Jev-вибір: потрібні щонайменше два варіанти', 'bad_input');
  return runJevNode(node, state, env, {
    questions: [choiceQuestion(node, state, Object.fromEntries(options.map((o) => [o, null])))],
    interpret: (o) => {
      const a = o.answers.choice;
      return { branch: a.selected!, decision: `вибір: ${a.selected}`, result: { selected: a.selected, distribution: a.distribution ?? {}, ...(a.corrected ? { corrected: true } : {}) } };
    },
  });
};

const JEV_SCORE: NodeExecutor = (node, state, env) => {
  const { levels, scale } = scoreLevels(node);
  return runJevNode(node, state, env, {
    questions: [{ id: 'score', kind: 'score', instructions: questionText(node, state), levels }],
    scale,
    interpret: (o) => {
      const a = o.answers.score;
      return { branch: 'out', decision: `оцінка: ${a.value} (${scale.min}…${scale.max})`, result: { value: a.value, position: a.position, levels: a.levels, level: levels[Math.round(a.position ?? 0)], scale, distribution: a.distribution ?? {} } };
    },
  });
};

const noulQuestion = (node: WorkflowNode, state: WfState): JevQuestion => ({ id: 'noul', kind: 'noul', instructions: questionText(node, state) });

const JEV_NOUL: NodeExecutor = (node, state, env) => {
  const threshold = num(node.params?.threshold, 0.6)!;
  return runJevNode(node, state, env, {
    questions: [noulQuestion(node, state)],
    agreeThreshold: threshold,
    interpret: (o) => {
      const p = o.answers.noul.probability!;
      const yes = p >= threshold;
      return { branch: yes ? 'true' : 'false', decision: `${yes ? 'так' : 'ні'}: ${p} проти порогу ${threshold}`, result: { probability: p, answer: yes, threshold }, confidenceGate: false };
    },
  });
};

const JEV_GATE: NodeExecutor = (node, state, env) => {
  const threshold = num(node.params?.threshold, 0.6)!;
  const passWhen = str(node.params?.pass_when) === 'false' ? false : true;
  return runJevNode(node, state, env, {
    questions: [noulQuestion(node, state)],
    agreeThreshold: threshold,
    interpret: (o) => {
      const p = o.answers.noul.probability!;
      const yes = p >= threshold;
      const pass = yes === passWhen;
      return { branch: pass ? 'pass' : 'block', decision: `${pass ? 'пропущено' : 'зупинено'}: «${yes ? 'так' : 'ні'}» (${p}, поріг ${threshold})`, result: { probability: p, answer: yes, threshold, pass }, confidenceGate: false };
    },
  });
};

const JEV_ROUTER: NodeExecutor = async (node, state, env) => {
  const registry = routerRegistry(node);
  if (!registry) {
    const routes = listOf(node.params?.routes);
    if (routes.length < 2) throw new NodeError('Jev-маршрутизатор: потрібні щонайменше дві гілки або реєстр напрямків', 'bad_input');
    return runJevNode(node, state, env, {
      questions: [choiceQuestion(node, state, Object.fromEntries(routes.map((o) => [o, null])))],
      interpret: (o) => {
        const a = o.answers.choice;
        return { branch: a.selected!, decision: `маршрут: ${a.selected}`, result: { selected: a.selected, distribution: a.distribution ?? {} } };
      },
    });
  }
  if (!DESTINATION_ID_RE.test(registry)) throw new NodeError(`Реєстр «${registry}»: невідомий id`, 'bad_input');
  // Реєстр напрямків (§10): увімкнені напрямки з опублікованим процесом.
  const { publishedVersion } = await import('./runner');
  const all = await env.repo.listWorkflowDestinations({ registry, enabledOnly: true });
  const live = [];
  for (const d of all) if (await publishedVersion(env.repo, d.workflowId).catch(() => null)) live.push(d);
  if (live.length === 0) {
    return {
      branch: 'fallback',
      patch: { vars: { ...state.vars, [node.id]: { registry, selected: null, reason: 'no_destinations', branch: 'fallback' } } },
      trace: { decision: `у реєстрі «${registry}» немає увімкнених напрямків з опублікованим процесом`, warnings: [`реєстр «${registry}» порожній`], details: { registry } },
    };
  }
  const byOption = new Map(live.map((d) => [d.option, d]));
  const options = Object.fromEntries(live.map((d) => [d.option, (d.description || d.label.uk).slice(0, 255)]));
  return runJevNode(node, state, env, {
    questions: [choiceQuestion(node, state, options)],
    interpret: (o) => {
      const a = o.answers.choice;
      const d = byOption.get(a.selected!)!;
      return { branch: 'out', decision: `напрямок: ${a.selected} → ${d.workflowId}`, result: { registry, selected: a.selected, distribution: a.distribution ?? {}, destination: { option: d.option, label: d.label, workflowId: d.workflowId } } };
    },
    proceed: async (r) => {
      const d = byOption.get(String(r.result.selected))!;
      const sub = await runSubgraph(env, d.workflowId, state, node.id);
      return { result: { subgraph: sub.result }, trace: sub.trace, cost: sub.cost };
    },
  });
};

/** Оцінювач (§21): шкала 0…4 за кожним критерієм → 0–10; не стає фактом канону. */
const EVAL_LEVELS = ['зовсім ні', 'слабко', 'почасти', 'здебільшого', 'повністю'];
const JEV_EVALUATOR: NodeExecutor = (node, state, env) => {
  const criteria = listOf(node.params?.criteria);
  if (!criteria.length) throw new NodeError('Jev-оцінювач: потрібен щонайменше один критерій', 'bad_input');
  const base = questionText(node, state);
  const ids = criteria.map((_, i) => `c${i + 1}`);
  return runJevNode(node, state, env, {
    questions: criteria.map((c, i) => ({ id: ids[i], kind: 'score', instructions: `${base}\nКритерій: ${c}`, levels: EVAL_LEVELS })),
    scale: { min: 0, max: 10 },
    interpret: (o) => {
      const scores = Object.fromEntries(criteria.map((c, i) => [c, { value: o.answers[ids[i]].value, confidence: o.answers[ids[i]].confidence }]));
      const overall = round(criteria.reduce((s, _c, i) => s + (o.answers[ids[i]].value ?? 0), 0) / criteria.length, 100);
      return { branch: 'out', decision: `оцінка: ${overall}/10 (${criteria.length} крит.)`, result: { criteria: scores, overall, canonical: false } };
    },
  });
};

const JEV_DECISION_BUNDLE: NodeExecutor = (node, state, env) => {
  const questions = bundleJevQuestions(node.params?.questions).map((q) => ({ ...q, instructions: renderPlaceholders(q.instructions, state) }));
  if (!questions.length) throw new NodeError('Пакет рішень Jev: немає питань', 'bad_input');
  return runJevNode(node, state, env, {
    questions,
    interpret: (o) => {
      const answers = Object.fromEntries(Object.entries(o.answers).map(([k, a]) => [k, a.kind === 'choice' ? { selected: a.selected, distribution: a.distribution, confidence: a.confidence } : a.kind === 'score' ? { value: a.value, position: a.position, confidence: a.confidence } : { probability: a.probability, confidence: a.confidence }]));
      return { branch: 'out', decision: `пакет: ${Object.entries(brief(o)).map(([k, v]) => `${k}=${v}`).join(', ')}`.slice(0, 400), result: { answers } };
    },
  });
};

export const JEV_EXECUTORS: Record<string, NodeExecutor> = {
  JEV_CHOICE,
  JEV_SCORE,
  JEV_NOUL,
  JEV_GATE,
  JEV_ROUTER,
  JEV_EVALUATOR,
  JEV_DECISION_BUNDLE,
  SUBGRAPH,
};
