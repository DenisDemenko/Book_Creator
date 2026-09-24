/**
 * Черга задач у пам'яті — для тестів і для роботи без PostgreSQL. Поведінка
 * та сама, що в `pgJobStore.ts` (спільний набір тестів); перезапуск процесу
 * вона, звісно, не переживає — для цього й є PostgreSQL.
 */

import { randomUUID } from 'node:crypto';
import {
  budgetExhaustedMessage,
  budgetScopes,
  checkEnqueueInput,
  JobRejectedError,
  periodStart,
  type BudgetInput,
  type BudgetRow,
  type EnqueueInput,
  type EnqueueLimits,
  type EnqueueResult,
  type FinishOutcome,
  type JobProgress,
  type JobRow,
  type JobStatus,
  type JobStore,
  type UsageInput,
} from './types';

const clone = <T>(v: T): T => structuredClone(v);
const iso = (d: Date) => d.toISOString();
const bkey = (projectId: string, scope: string) => `${projectId}\u0000${scope}`;

export class MemoryJobStore implements JobStore {
  readonly kind = 'memory' as const;
  private jobs = new Map<string, JobRow>();
  private budgets = new Map<string, BudgetRow>();

  private rolled(b: BudgetRow, now: Date): BudgetRow {
    const start = periodStart(b.period, now, new Date(b.windowStart));
    if (start.getTime() > new Date(b.windowStart).getTime()) {
      b.windowStart = iso(start);
      b.usedTokens = 0;
      b.usedRequests = 0;
    }
    return b;
  }

  private reservedTokens(projectId: string, scope: string, exceptId?: string): number {
    let sum = 0;
    for (const j of this.jobs.values()) {
      if (j.projectId !== projectId || j.id === exceptId) continue;
      if (j.status !== 'queued' && j.status !== 'running') continue;
      if (!budgetScopes(j.budgetScope).includes(scope)) continue;
      sum += Math.max(j.estimatedTokens - j.usedTokens, 0);
    }
    return sum;
  }

  async enqueue(input: EnqueueInput, now: Date, limits: EnqueueLimits = {}): Promise<EnqueueResult> {
    checkEnqueueInput(input);
    const key = input.idempotencyKey ?? null;
    const existing = key
      ? [...this.jobs.values()].find((j) => j.projectId === input.projectId && j.kind === input.kind && j.idempotencyKey === key)
      : undefined;
    if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') {
      return { job: clone(existing), created: false };
    }

    if (limits.rateLimit) {
      const since = now.getTime() - limits.rateLimit.windowMs;
      const recent = [...this.jobs.values()]
        .filter((j) => j.projectId === input.projectId && j.kind === input.kind && new Date(j.createdAt).getTime() > since)
        .map((j) => new Date(j.createdAt).getTime())
        .sort((a, b) => a - b);
      if (recent.length >= limits.rateLimit.max) {
        const retryAfterMs = Math.max(recent[recent.length - limits.rateLimit.max] + limits.rateLimit.windowMs - now.getTime(), 1);
        throw new JobRejectedError('rate_limited', `Забагато задач «${input.kind}» поспіль — спробуйте за ${Math.ceil(retryAfterMs / 1000)} с`, retryAfterMs);
      }
    }

    const estimate = input.estimatedTokens ?? 0;
    for (const scope of budgetScopes(input.budgetScope)) {
      const b = this.budgets.get(bkey(input.projectId, scope));
      if (!b) continue;
      this.rolled(b, now);
      const reserved = this.reservedTokens(input.projectId, scope, existing?.id);
      const tokensOut = b.limitTokens !== null && (b.usedTokens >= b.limitTokens || b.usedTokens + reserved + estimate > b.limitTokens);
      const requestsOut = b.limitRequests !== null && b.usedRequests >= b.limitRequests;
      if (tokensOut || requestsOut) throw new JobRejectedError('budget_exhausted', budgetExhaustedMessage(b));
    }

    const t = iso(now);
    const runAt = iso(new Date(now.getTime() + (input.delayMs ?? 0)));
    if (existing) {
      Object.assign(existing, {
        status: 'queued' as JobStatus,
        payload: clone(input.payload ?? existing.payload),
        error: null,
        result: null,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? existing.maxAttempts,
        nextAttemptAt: runAt,
        cancelRequested: false,
        lockedBy: null,
        heartbeatAt: null,
        estimatedTokens: estimate,
        updatedAt: t,
        finishedAt: null,
      });
      return { job: clone(existing), created: true };
    }
    const job: JobRow = {
      id: randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      status: 'queued',
      payload: clone(input.payload ?? {}),
      progress: {},
      result: null,
      error: null,
      idempotencyKey: key,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextAttemptAt: runAt,
      cancelRequested: false,
      lockedBy: null,
      heartbeatAt: null,
      budgetScope: input.budgetScope ?? 'project',
      estimatedTokens: estimate,
      usedTokens: 0,
      usedRequests: 0,
      createdBy: input.createdBy,
      createdAt: t,
      updatedAt: t,
      startedAt: null,
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    return { job: clone(job), created: true };
  }

  async claim(workerId: string, kinds: string[], now: Date, leaseMs: number) {
    const staleBefore = now.getTime() - leaseMs;
    const candidates = [...this.jobs.values()]
      .filter(
        (j) =>
          kinds.includes(j.kind) &&
          ((j.status === 'queued' && new Date(j.nextAttemptAt).getTime() <= now.getTime()) ||
            (j.status === 'running' && j.heartbeatAt !== null && new Date(j.heartbeatAt).getTime() < staleBefore)),
      )
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.createdAt.localeCompare(b.createdAt));
    const j = candidates[0];
    if (!j) return null;
    const t = iso(now);
    j.status = 'running';
    j.lockedBy = workerId;
    j.heartbeatAt = t;
    j.startedAt = j.startedAt ?? t;
    j.attempts += 1;
    j.updatedAt = t;
    return clone(j);
  }

  private owned(id: string, workerId: string): JobRow | null {
    const j = this.jobs.get(id);
    return j && j.status === 'running' && j.lockedBy === workerId ? j : null;
  }

  async heartbeat(id: string, workerId: string, now: Date) {
    const j = this.owned(id, workerId);
    if (!j) return { cancelRequested: !!this.jobs.get(id)?.cancelRequested, lost: true };
    j.heartbeatAt = iso(now);
    return { cancelRequested: j.cancelRequested, lost: false };
  }

  async setProgress(id: string, workerId: string, progress: JobProgress, now: Date) {
    const j = this.owned(id, workerId);
    if (!j) return;
    j.progress = clone(progress);
    j.heartbeatAt = iso(now);
    j.updatedAt = iso(now);
  }

  async recordUsage(id: string, workerId: string, usage: UsageInput, now: Date) {
    const j = this.owned(id, workerId);
    if (!j) return { exceeded: false };
    const tokens = Math.max(Math.round(usage.tokens ?? 0), 0);
    const requests = Math.max(Math.round(usage.requests ?? 0), 0);
    j.usedTokens += tokens;
    j.usedRequests += requests;
    j.updatedAt = iso(now);
    let exceeded = false;
    for (const scope of budgetScopes(j.budgetScope)) {
      const b = this.budgets.get(bkey(j.projectId, scope));
      if (!b) continue;
      this.rolled(b, now);
      b.usedTokens += tokens;
      b.usedRequests += requests;
      if ((b.limitTokens !== null && b.usedTokens > b.limitTokens) || (b.limitRequests !== null && b.usedRequests > b.limitRequests)) {
        exceeded = true;
      }
    }
    return { exceeded };
  }

  async finish(id: string, workerId: string, outcome: FinishOutcome, now: Date) {
    const j = this.owned(id, workerId);
    if (!j) return false;
    const t = iso(now);
    j.lockedBy = null;
    j.heartbeatAt = null;
    j.updatedAt = t;
    if (outcome.status === 'retry') {
      j.status = 'queued';
      j.error = outcome.error;
      j.nextAttemptAt = iso(outcome.nextAttemptAt);
      return true;
    }
    j.status = outcome.status;
    j.finishedAt = t;
    if (outcome.status === 'succeeded') {
      j.result = clone(outcome.result ?? null);
      j.error = null;
    } else {
      j.error = outcome.error ?? (outcome.status === 'cancelled' ? 'Скасовано' : null);
    }
    return true;
  }

  async requestCancel(projectId: string, id: string, now: Date) {
    const j = this.jobs.get(id);
    if (!j || j.projectId !== projectId) return null;
    const t = iso(now);
    if (j.status === 'queued') {
      j.status = 'cancelled';
      j.cancelRequested = true;
      j.error = 'Скасовано';
      j.finishedAt = t;
      j.updatedAt = t;
    } else if (j.status === 'running') {
      j.cancelRequested = true;
      j.updatedAt = t;
    }
    return clone(j);
  }

  async get(projectId: string, id: string) {
    const j = this.jobs.get(id);
    return j && j.projectId === projectId ? clone(j) : null;
  }

  async list(projectId: string, filter: { kind?: string; status?: JobStatus; limit?: number } = {}) {
    return [...this.jobs.values()]
      .filter((j) => j.projectId === projectId && (!filter.kind || j.kind === filter.kind) && (!filter.status || j.status === filter.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit ?? 50)
      .map(clone);
  }

  async setBudget(projectId: string, scope: string, input: BudgetInput, now: Date) {
    const k = bkey(projectId, scope);
    const prev = this.budgets.get(k);
    const period = input.period ?? prev?.period ?? 'month';
    const b: BudgetRow = {
      projectId,
      scope,
      period,
      limitTokens: input.limitTokens !== undefined ? input.limitTokens : prev?.limitTokens ?? null,
      limitRequests: input.limitRequests !== undefined ? input.limitRequests : prev?.limitRequests ?? null,
      usedTokens: prev?.usedTokens ?? 0,
      usedRequests: prev?.usedRequests ?? 0,
      windowStart: prev?.windowStart ?? iso(periodStart(period, now, now)),
    };
    this.budgets.set(k, b);
    return clone(this.rolled(b, now));
  }

  async getBudget(projectId: string, scope: string, now: Date) {
    const b = this.budgets.get(bkey(projectId, scope));
    return b ? clone(this.rolled(b, now)) : null;
  }

  async close() {}
}
