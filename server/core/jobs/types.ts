/**
 * Фонова черга задач ядра (Т0.7): типи й договір сховища `JobStore`.
 *
 * Як і сховище ядра, договір має дві реалізації — PostgreSQL
 * (`pgJobStore.ts`) і пам'ять (`memoryJobStore.ts`) — з одним набором
 * тестів (`scripts/test-coreJobs.mts`). Логіка виконання (повтори,
 * скасування, контрольні точки) — окремо, у `queue.ts`, і однакова для обох.
 *
 * ЧАС ПЕРЕДАЄТЬСЯ ЯВНО (`now`). Не для краси: перевірити «задача пережила
 * перезапуск», «оренда минула», «бюджет нового місяця» без очікування
 * хвилинами можна лише тоді, коли годинник у руках тесту.
 */

import type { CoreActor } from '../types';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export const JOB_TERMINAL: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled'];

export interface JobProgress {
  done?: number;
  total?: number;
  step?: string;
  note?: string;
  [key: string]: unknown;
}

export interface JobRow {
  id: string;
  projectId: string;
  kind: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  progress: JobProgress;
  result: unknown;
  error: string | null;
  idempotencyKey: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  cancelRequested: boolean;
  lockedBy: string | null;
  heartbeatAt: string | null;
  budgetScope: string;
  estimatedTokens: number;
  usedTokens: number;
  usedRequests: number;
  createdBy: CoreActor;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EnqueueInput {
  projectId: string;
  kind: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  maxAttempts?: number;
  /** Скільки токенів задача, імовірно, витратить — резерв у бюджеті. */
  estimatedTokens?: number;
  /** Кошик бюджету, крім загального проєктного: 'simulation:<id>'. */
  budgetScope?: string;
  /**
   * Не раніше ніж через стільки мс. Для задач, що йдуть за частими подіями
   * (синхронізація після автозбереження): кілька збережень поспіль
   * встигають злитися в одну задачу, поки вона чекає.
   */
  delayMs?: number;
  createdBy: CoreActor;
}

export interface EnqueueLimits {
  /** Не більше `max` нових задач цього виду в проєкті за `windowMs`. */
  rateLimit?: { max: number; windowMs: number };
}

export interface EnqueueResult {
  job: JobRow;
  /** false — повернуто наявну задачу з тим самим ключем ідемпотентності. */
  created: boolean;
}

export type BudgetPeriod = 'day' | 'month' | 'total';

export interface BudgetRow {
  projectId: string;
  scope: string;
  period: BudgetPeriod;
  limitTokens: number | null;
  limitRequests: number | null;
  usedTokens: number;
  usedRequests: number;
  windowStart: string;
}

export interface BudgetInput {
  period?: BudgetPeriod;
  limitTokens?: number | null;
  limitRequests?: number | null;
}

export interface UsageInput {
  tokens?: number;
  requests?: number;
}

export type FinishOutcome =
  | { status: 'succeeded'; result?: unknown }
  | { status: 'failed'; error: string }
  | { status: 'cancelled'; error?: string }
  | { status: 'retry'; error: string; nextAttemptAt: Date };

export type JobRejectCode = 'rate_limited' | 'budget_exhausted' | 'unknown_kind' | 'bad_input' | 'not_found';

/** Задачу не поставлено в чергу: ліміт частоти, бюджет, невідомий вид. */
export class JobRejectedError extends Error {
  constructor(
    readonly code: JobRejectCode,
    message: string,
    /** Для `rate_limited` — коли можна спробувати знову. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'JobRejectedError';
  }
}

export interface JobStore {
  readonly kind: 'postgres' | 'memory';

  /**
   * Ставить задачу. Той самий ключ ідемпотентності повертає наявну задачу
   * (активну або успішну); невдалу чи скасовану — ставить знову тим самим
   * рядком. Відмовляє (`JobRejectedError`), якщо перевищено ліміт частоти або
   * бюджет проєкту вичерпано з урахуванням резерву активних задач.
   */
  enqueue(input: EnqueueInput, now: Date, limits?: EnqueueLimits): Promise<EnqueueResult>;

  /**
   * Захоплює наступну задачу одного з видів `kinds`: чергову, час якої
   * настав, або «завислу» — `running`, чий heartbeat старший за `leaseMs`
   * (процес, що її виконував, помер). Лічильник спроб зростає.
   */
  claim(workerId: string, kinds: string[], now: Date, leaseMs: number): Promise<JobRow | null>;

  /**
   * Продовжує оренду. `lost` — задачу вже забрав інший воркер (наша оренда
   * минула); тоді продовжувати й писати результат не можна.
   */
  heartbeat(id: string, workerId: string, now: Date): Promise<{ cancelRequested: boolean; lost: boolean }>;

  setProgress(id: string, workerId: string, progress: JobProgress, now: Date): Promise<void>;

  /** Списує витрату з задачі й з бюджетів; `exceeded` — ліміт тепер перевищено. */
  recordUsage(id: string, workerId: string, usage: UsageInput, now: Date): Promise<{ exceeded: boolean }>;

  /** Завершує спробу. Нічого не робить, якщо задача вже не наша (`false`). */
  finish(id: string, workerId: string, outcome: FinishOutcome, now: Date): Promise<boolean>;

  /** Чергову задачу скасовує одразу; ту, що виконується, — позначає. */
  requestCancel(projectId: string, id: string, now: Date): Promise<JobRow | null>;

  get(projectId: string, id: string): Promise<JobRow | null>;
  list(projectId: string, filter?: { kind?: string; status?: JobStatus; limit?: number }): Promise<JobRow[]>;

  setBudget(projectId: string, scope: string, input: BudgetInput, now: Date): Promise<BudgetRow>;
  /** Бюджет з урахуванням нового періоду (день/місяць скидають витрату). */
  getBudget(projectId: string, scope: string, now: Date): Promise<BudgetRow | null>;

  close(): Promise<void>;
}

// ── Спільні дрібниці для обох сховищ ──────────────────────────────────────

/** Початок поточного періоду бюджету (UTC). */
export function periodStart(period: BudgetPeriod, now: Date, prev: Date): Date {
  if (period === 'total') return prev;
  if (period === 'day') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Кошики бюджету, які зачіпає задача: завжди проєктний і, можливо, свій. */
export function budgetScopes(scope: string | undefined): string[] {
  return scope && scope !== 'project' ? ['project', scope] : ['project'];
}

export function checkEnqueueInput(input: EnqueueInput): void {
  if (!input.projectId || !input.kind) throw new JobRejectedError('bad_input', 'Задачі потрібні проєкт і вид');
  if (!/^(user|ai|system):.+/.test(input.createdBy ?? '')) {
    throw new JobRejectedError('bad_input', 'Автор задачі має бути «user:…», «ai:…» або «system:…»');
  }
  if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1)) {
    throw new JobRejectedError('bad_input', 'Кількість спроб має бути цілим числом від 1');
  }
  if (input.delayMs !== undefined && (!Number.isFinite(input.delayMs) || input.delayMs < 0)) {
    throw new JobRejectedError('bad_input', 'Відкладення задачі не може бути від\'ємним');
  }
  if (input.estimatedTokens !== undefined && (!Number.isFinite(input.estimatedTokens) || input.estimatedTokens < 0)) {
    throw new JobRejectedError('bad_input', 'Оцінка токенів не може бути від\'ємною');
  }
}

export function budgetExhaustedMessage(b: BudgetRow): string {
  const where = b.scope === 'project' ? 'проєкту' : `«${b.scope}»`;
  const per = b.period === 'day' ? ' на сьогодні' : b.period === 'month' ? ' на цей місяць' : '';
  return `Бюджет ШІ ${where}${per} вичерпано (токени ${b.usedTokens}/${b.limitTokens ?? '∞'}, запити ${b.usedRequests}/${b.limitRequests ?? '∞'})`;
}
