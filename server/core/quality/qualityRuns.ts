/**
 * Прогони набору якості з журналом (Т2.8 В3, `PLAN_QUALITY.md`).
 *
 * Прогін — рівня платформи: набір має власну тестову книгу й іде в окремому
 * сховищі в пам'яті, тож у ядро книг не пише нічого; у базу йде лише запис
 * `quality_runs` зі звітом. Запускає адміністратор (розділ «Якість
 * персонажів», В4) або `npm run quality:living-characters`.
 *
 * **Ліміт витрат.** Кожен платний виклик (голос, запасний LLM, Jev, суддя)
 * спершу перевіряє, чи бюджет ще не вичерпано; вичерпано — виклик не
 * робиться, хід позначається збоєм, прогін завершується статусом `failed` з
 * частковим звітом і причиною. Перевищення можливе хіба на один виклик.
 *
 * **Що зберігається.** Звіт без перехоплених запитів до моделі й станів Jev
 * (у них — приватна пам'ять героїв тестової книги й текст промптів): лише
 * відповіді, дії, оцінки, витоки (фрагмент і місце) і числа.
 */

import type { CoreRepository, QualityRunRow } from '../types';
import { JEV_USD_PER_MTOK, type JevAdapter } from '../../ai/adapters/jev';
import type { ControlSet } from './controlSet';
import { runLivingCharacters, type QualityMode, type QualityReport, type QualityRunDeps, QUALITY_MODES } from './livingCharacters';

export class BudgetExceededError extends Error {
  constructor(spent: number, budget: number) {
    super(`Бюджет прогону вичерпано: витрачено $${spent.toFixed(4)} з $${budget.toFixed(4)}`);
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetMeter {
  spent(): number;
  exceeded(): boolean;
}

/** Обгортає всі платні виклики прогону лічильником витрат і стелею. */
export function withBudget(deps: QualityRunDeps, budgetUsd: number | null): { deps: QualityRunDeps; meter: BudgetMeter } {
  let spent = 0;
  const guard = () => {
    if (budgetUsd != null && spent >= budgetUsd) throw new BudgetExceededError(spent, budgetUsd);
  };
  const jevCost = (inputTokens: number) => (inputTokens / 1_000_000) * JEV_USD_PER_MTOK;
  const wrapJev = (a: JevAdapter | null | undefined): JevAdapter | null | undefined =>
    a
      ? {
          name: a.name,
          evaluate: async (s, q, o) => {
            guard();
            const r = await a.evaluate(s, q, o);
            if (r.source === 'jev') spent += jevCost(Number(r.usage?.input_tokens ?? 0) || 0);
            return r;
          },
        }
      : a;
  const wrapped: QualityRunDeps = {
    ...deps,
    voice: async (system, user) => {
      guard();
      const out = await deps.voice(system, user);
      spent += out.costUsd ?? 0;
      return out;
    },
    fallbackLlm: async (system, user) => {
      guard();
      const out = await deps.fallbackLlm(system, user);
      spent += deps.priceLlm ? deps.priceLlm(out.modelId, out.inputTokens, out.outputTokens) : 0;
      return out;
    },
    jev: wrapJev(deps.jev) ?? null,
    judge: deps.judge === undefined ? undefined : wrapJev(deps.judge) ?? null,
  };
  // Суддя за замовчуванням — той самий Jev (уже обгорнутий).
  if (deps.judge === undefined) wrapped.judge = wrapped.jev;
  return { deps: wrapped, meter: { spent: () => spent, exceeded: () => budgetUsd != null && spent >= budgetUsd } };
}

/** Звіт для бази: без перехоплених промптів і станів Jev. */
export function reportForStorage(r: QualityReport): Record<string, unknown> {
  return {
    ...r,
    modes: r.modes.map((m) => ({
      ...m,
      turns: m.turns.map(({ seen, ...t }) => ({ ...t, seen: { prompts: seen.prompts.length, jevStates: seen.jevStates.length } })),
    })),
  };
}

/** Короткий підсумок (для переліку прогонів): виміри й ворота кожного режиму. */
export function reportSummary(r: QualityReport): Record<string, unknown> {
  return {
    passed: r.passed,
    modes: r.modes.map((m) => ({ mode: m.mode, passed: m.passed, metrics: m.metrics, gates: m.gates, decisions: m.decisions, durationMs: m.durationMs })),
  };
}

export interface StartQualityRunInput {
  set: ControlSet;
  deps: QualityRunDeps;
  actor: string;
  budgetUsd: number | null;
  modes?: QualityMode[];
  models?: Record<string, unknown>;
  label?: string;
}

/** Виконати прогін і записати результат (статуси running → succeeded / failed). */
export async function executeQualityRun(repo: CoreRepository, runId: string, input: StartQualityRunInput): Promise<QualityRunRow> {
  await repo.updateQualityRun(runId, { status: 'running' });
  const { deps, meter } = withBudget(input.deps, input.budgetUsd);
  try {
    const report = await runLivingCharacters(input.set, { ...deps, label: input.label ?? deps.label }, input.modes ?? QUALITY_MODES);
    const over = meter.exceeded();
    return await repo.updateQualityRun(runId, {
      status: over ? 'failed' : 'succeeded',
      passed: over ? false : report.passed,
      summary: reportSummary(report),
      report: reportForStorage(report),
      costUsd: Math.round(meter.spent() * 1e6) / 1e6,
      error: over ? `Бюджет прогону вичерпано ($${meter.spent().toFixed(4)} з $${input.budgetUsd?.toFixed(4)}) — частина ходів без відповіді, звіт неповний` : null,
    });
  } catch (err) {
    return repo.updateQualityRun(runId, { status: 'failed', passed: false, costUsd: Math.round(meter.spent() * 1e6) / 1e6, error: (err as Error).message.slice(0, 2000) });
  }
}

/** Почати прогін у тлі: запис створено одразу, виконання не чекаємо. Одночасно — лише один прогін. */
export async function startQualityRun(repo: CoreRepository, input: StartQualityRunInput): Promise<{ run: QualityRunRow; done: Promise<QualityRunRow> }> {
  const busy = (await repo.listQualityRuns({ limit: 20 })).find((r) => r.status === 'queued' || r.status === 'running');
  if (busy) {
    const err = new Error('Прогін якості вже йде — дочекайтесь його завершення') as Error & { code?: string };
    err.code = 'conflict';
    throw err;
  }
  const run = await repo.addQualityRun({ setId: input.set.id, setVersion: input.set.version, createdBy: input.actor as any, budgetUsd: input.budgetUsd, models: input.models ?? {}, label: input.label ?? '' });
  const done = executeQualityRun(repo, run.id, input);
  return { run, done };
}

/** Після перезапуску сервера: прогони, що лишились «у черзі» чи «йде», — перервано. */
export async function failInterruptedRuns(repo: CoreRepository): Promise<number> {
  let n = 0;
  for (const r of await repo.listQualityRuns({ limit: 200 })) {
    if (r.status !== 'queued' && r.status !== 'running') continue;
    await repo.updateQualityRun(r.id, { status: 'failed', passed: false, error: 'Прогін перервано перезапуском сервера' });
    n++;
  }
  return n;
}
