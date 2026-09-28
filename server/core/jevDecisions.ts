/**
 * Журнал рішень героя назовні (Т2.5 В5): вигляд одного рішення для
 * маршрутів і зведення спостережуваності (ТЗ-H §13 «Observability»).
 *
 * Жодного приватного змісту: вигляд рішення — рівень, дія, оцінки,
 * розподіли, джерело, модель, відбиток знімка, підстави-посилання (id
 * абзаців і сутностей), що перевірив валідатор і чому був запасний шлях;
 * зведення — лише числа (виклики, частка запасного шляху, класи збоїв,
 * токени, вартість Jev, затримка). Знімка героя, тексту книги чи ситуації
 * тут немає — знімок у журналі й не зберігається, лише його відбиток.
 */

import type { CharacterDecisionLevel, CharacterDecisionRow, CharacterDecisionSource, CharacterDecisionStatus, CoreRepository } from './types';
import { CHARACTER_DECISION_LEVELS, CHARACTER_DECISION_SOURCES, CHARACTER_DECISION_STATUSES } from './types';
import { JEV_USD_PER_MTOK } from '../ai/adapters/jev';

export interface DecisionView {
  id: string;
  characterId: string;
  level: CharacterDecisionLevel;
  status: CharacterDecisionStatus;
  sceneId: string | null;
  simulationId: string | null;
  turnIndex: number | null;
  parentId: string | null;
  selectedAction: string | null;
  /** Підпис дії з конфігурації питань (для людини), якщо є. */
  selectedLabel: string | null;
  choices: Record<string, string>;
  scores: Record<string, number>;
  checks: Record<string, number>;
  /** Розподіл головного вибору. */
  distribution: Record<string, number>;
  confidence: number | null;
  source: CharacterDecisionSource;
  /** Хто насправді відповів: Jev, запасний LLM чи ніхто (обидва недоступні). */
  origin: DecisionOrigin;
  modelVersion: string;
  snapshotHash: string;
  fallbackReason: string | null;
  validation: { corrected: boolean; violations: { rule: string; question?: string; detail: string }[]; authorReason: string | null };
  /** Для «чекає автора» — з чого автор може обрати (дозволені без заборонених, з підписами). */
  authorOptions: { id: string; label: string | null }[];
  basis: CharacterDecisionRow['basis'];
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export type DecisionOrigin = 'jev' | 'llm' | 'none';

/** За версією моделі: `llm:…` — запасний LLM, `unavailable` — ніхто, інше — Jev (справжній чи підставний). */
export const decisionOrigin = (d: Pick<CharacterDecisionRow, 'modelVersion'>): DecisionOrigin =>
  d.modelVersion === 'unavailable' ? 'none' : d.modelVersion.startsWith('llm:') ? 'llm' : 'jev';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numMap = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).filter(([, x]) => typeof x === 'number' && Number.isFinite(x))) as Record<string, number>;

export function decisionView(d: CharacterDecisionRow): DecisionView {
  const r = (d.result ?? {}) as Record<string, any>;
  const primary = (d.options.primary ?? {}) as { id?: string; allowed?: string[]; forbidden?: string[] };
  const q = (d.questions as { id?: string; options?: Record<string, string | null> }[]).find((x) => x?.id === primary.id);
  const label = (id: string | null) => (id ? q?.options?.[id] ?? null : null);
  const v = (d.validation ?? {}) as Record<string, any>;
  const allowed = (primary.allowed ?? []).filter((a) => !(primary.forbidden ?? []).includes(a));
  return {
    id: d.id,
    characterId: d.characterId,
    level: d.level,
    status: d.status,
    sceneId: d.sceneId,
    simulationId: d.simulationId,
    turnIndex: d.turnIndex,
    parentId: d.parentId,
    selectedAction: d.selectedAction,
    selectedLabel: label(d.selectedAction),
    choices: Object.fromEntries(Object.entries((r.choices ?? {}) as Record<string, unknown>).map(([k, x]) => [k, String(x)])),
    scores: numMap(r.scores),
    checks: numMap(r.checks),
    distribution: numMap(primary.id ? r.raw_distributions?.[primary.id] : undefined),
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
    source: d.source,
    origin: decisionOrigin(d),
    modelVersion: d.modelVersion,
    snapshotHash: d.snapshotHash,
    fallbackReason: d.fallbackReason,
    validation: {
      corrected: !!v.corrected,
      violations: Array.isArray(v.violations) ? v.violations.map((x: any) => ({ rule: String(x.rule), ...(x.question ? { question: String(x.question) } : {}), detail: String(x.detail ?? '') })) : [],
      authorReason: typeof v.authorReason === 'string' ? v.authorReason : null,
    },
    authorOptions: d.status === 'awaiting_author' ? allowed.map((id) => ({ id, label: label(id) })) : [],
    basis: d.basis,
    usage: { inputTokens: num(d.usage.input_tokens), outputTokens: num(d.usage.output_tokens) },
    latencyMs: d.latencyMs,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    resolvedBy: d.resolvedBy,
    resolvedAt: d.resolvedAt,
  };
}

// ── Зведення спостережуваності ─────────────────────────────────────────────

export const JEV_FAILURE_CLASSES = ['timeout', 'rate_limited', 'overloaded', 'auth', 'network', 'invalid_answer', 'not_configured', 'other'] as const;
export type JevFailureClass = (typeof JEV_FAILURE_CLASSES)[number];

/** Клас збою Jev за причиною в журналі («Jev: …»). null — Jev не збоїв. */
export function jevFailureClass(reason: string | null): JevFailureClass | null {
  if (!reason) return null;
  if (/Jev не налаштовано/.test(reason)) return 'not_configured';
  const part = reason.split('; ').find((x) => x.startsWith('Jev: '));
  if (!part) return null;
  if (/допустимої альтернативи/.test(part)) return 'invalid_answer';
  if (/timeout|timed out|таймаут|aborted/i.test(part)) return 'timeout';
  if (/\b429\b/.test(part)) return 'rate_limited';
  if (/\b(529|503|502|500)\b|overload/i.test(part)) return 'overloaded';
  if (/\b(401|403)\b/.test(part)) return 'auth';
  if (/недоступний|fetch failed|ECONN|ENOTFOUND|network/i.test(part)) return 'network';
  return 'other';
}

export interface DecisionsSummary {
  /** Скільки останніх записів журналу враховано (не більше `limit`). */
  window: number;
  total: number;
  byLevel: Record<CharacterDecisionLevel, number>;
  byStatus: Record<CharacterDecisionStatus, number>;
  bySource: Record<CharacterDecisionSource, number>;
  /** Звернення до Jev: відповів (зокрема недопустимим) чи збоїв; «не налаштовано» — не звернення. */
  jevCalls: number;
  jevAnswered: number;
  llmFallback: number;
  /** Частка рішень від запасного LLM серед тих, що дала машина (0–1; null — рішень машини ще немає). */
  fallbackShare: number | null;
  failures: Record<JevFailureClass, number>;
  awaitingAuthor: number;
  resolvedByAuthor: number;
  authorReasons: Record<string, number>;
  tokens: { jev: { input: number; output: number }; llm: { input: number; output: number } };
  /** Вартість Jev за тарифом `JEV_USD_PER_MTOK` (вхідні токени); LLM — лише токени (тариф залежить від моделі). */
  jevUsd: number;
  latencyMs: { jev: { avg: number | null; p95: number | null }; llm: { avg: number | null; p95: number | null } };
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const stats = (xs: number[]) => {
  if (!xs.length) return { avg: null, p95: null };
  const s = [...xs].sort((a, b) => a - b);
  return { avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length), p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] };
};

export function summarizeDecisions(rows: CharacterDecisionRow[]): DecisionsSummary {
  const out: DecisionsSummary = {
    window: rows.length,
    total: rows.length,
    byLevel: zero(CHARACTER_DECISION_LEVELS),
    byStatus: zero(CHARACTER_DECISION_STATUSES),
    bySource: zero(CHARACTER_DECISION_SOURCES),
    jevCalls: 0,
    jevAnswered: 0,
    llmFallback: 0,
    fallbackShare: null,
    failures: zero(JEV_FAILURE_CLASSES),
    awaitingAuthor: 0,
    resolvedByAuthor: 0,
    authorReasons: {},
    tokens: { jev: { input: 0, output: 0 }, llm: { input: 0, output: 0 } },
    jevUsd: 0,
    latencyMs: { jev: { avg: null, p95: null }, llm: { avg: null, p95: null } },
  };
  const lat = { jev: [] as number[], llm: [] as number[] };
  for (const d of rows) {
    out.byLevel[d.level]++;
    out.byStatus[d.status]++;
    out.bySource[d.source]++;
    if (d.status === 'awaiting_author') out.awaitingAuthor++;
    if (d.source === 'author') out.resolvedByAuthor++;
    const reason = (d.validation as { authorReason?: unknown }).authorReason;
    if (typeof reason === 'string' && reason) out.authorReasons[reason] = (out.authorReasons[reason] ?? 0) + 1;
    const origin = decisionOrigin(d);
    const failure = jevFailureClass(d.fallbackReason);
    if (failure) out.failures[failure]++;
    if (origin === 'jev') out.jevAnswered++;
    if (origin === 'jev' || (failure && failure !== 'not_configured')) out.jevCalls++;
    if (origin === 'llm') out.llmFallback++;
    if (origin !== 'none') {
      out.tokens[origin].input += num(d.usage.input_tokens);
      out.tokens[origin].output += num(d.usage.output_tokens);
      if (d.source !== 'author') lat[origin].push(d.latencyMs);
    }
  }
  const machine = out.jevAnswered + out.llmFallback;
  out.fallbackShare = machine ? Math.round((out.llmFallback / machine) * 1000) / 1000 : null;
  out.jevUsd = Math.round((out.tokens.jev.input / 1_000_000) * JEV_USD_PER_MTOK * 1e8) / 1e8;
  out.latencyMs = { jev: stats(lat.jev), llm: stats(lat.llm) };
  return out;
}

export const SUMMARY_WINDOW = 500;

/** Зведення по проєкту чи одному героєві — за останні `SUMMARY_WINDOW` записів журналу. */
export async function decisionsSummary(repo: CoreRepository, projectId: string, opts: { characterId?: string } = {}): Promise<DecisionsSummary> {
  const rows = await repo.listCharacterDecisions(projectId, { ...(opts.characterId ? { characterId: opts.characterId } : {}), limit: SUMMARY_WINDOW });
  return summarizeDecisions(rows);
}
