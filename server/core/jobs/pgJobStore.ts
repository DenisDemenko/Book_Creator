/**
 * Черга задач ядра в PostgreSQL (таблиці `core_jobs`, `core_budgets`,
 * міграція 0003).
 *
 * ДВА МЕХАНІЗМИ ВІД ГОНОК:
 *  - постановка йде під `pg_advisory_xact_lock` на проєкт — ліміт частоти,
 *    бюджет і ключ ідемпотентності перевіряються й записуються атомарно,
 *    навіть якщо автор двічі натиснув кнопку на двох інстансах Студії;
 *  - захоплення — `FOR UPDATE SKIP LOCKED`: два воркери ніколи не беруть
 *    одну задачу, і жоден не чекає на іншого.
 */

import type { Pool, PoolClient } from 'pg';
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

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toJob(r: any): JobRow {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    status: r.status,
    payload: r.payload ?? {},
    progress: r.progress ?? {},
    result: r.result ?? null,
    error: r.error,
    idempotencyKey: r.idempotency_key,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    nextAttemptAt: iso(r.next_attempt_at),
    cancelRequested: r.cancel_requested,
    lockedBy: r.locked_by,
    heartbeatAt: isoOrNull(r.heartbeat_at),
    budgetScope: r.budget_scope,
    estimatedTokens: r.estimated_tokens,
    usedTokens: r.used_tokens,
    usedRequests: r.used_requests,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
  };
}

function toBudget(r: any): BudgetRow {
  return {
    projectId: r.project_id,
    scope: r.scope,
    period: r.period,
    limitTokens: r.limit_tokens == null ? null : Number(r.limit_tokens),
    limitRequests: r.limit_requests,
    usedTokens: Number(r.used_tokens),
    usedRequests: r.used_requests,
    windowStart: iso(r.window_start),
  };
}

export class PgJobStore implements JobStore {
  readonly kind = 'postgres' as const;

  constructor(private readonly pool: Pool) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  /** Бюджет із перекочуванням періоду (день/місяць починаються з нуля). */
  private async rolledBudget(c: PoolClient | Pool, projectId: string, scope: string, now: Date): Promise<BudgetRow | null> {
    const { rows } = await c.query('SELECT * FROM core_budgets WHERE project_id = $1 AND scope = $2', [projectId, scope]);
    if (!rows[0]) return null;
    const b = toBudget(rows[0]);
    const start = periodStart(b.period, now, new Date(b.windowStart));
    if (start.getTime() > new Date(b.windowStart).getTime()) {
      const upd = await c.query(
        `UPDATE core_budgets SET used_tokens = 0, used_requests = 0, window_start = $3, updated_at = $4
         WHERE project_id = $1 AND scope = $2 AND window_start < $3 RETURNING *`,
        [projectId, scope, start, now],
      );
      if (upd.rows[0]) return toBudget(upd.rows[0]);
      const again = await c.query('SELECT * FROM core_budgets WHERE project_id = $1 AND scope = $2', [projectId, scope]);
      return again.rows[0] ? toBudget(again.rows[0]) : null;
    }
    return b;
  }

  async enqueue(input: EnqueueInput, now: Date, limits: EnqueueLimits = {}): Promise<EnqueueResult> {
    checkEnqueueInput(input);
    const key = input.idempotencyKey ?? null;
    try {
      return await this.tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`core_jobs:${input.projectId}`]);
        let existing: JobRow | null = null;
        if (key) {
          const { rows } = await c.query(
            'SELECT * FROM core_jobs WHERE project_id = $1 AND kind = $2 AND idempotency_key = $3',
            [input.projectId, input.kind, key],
          );
          existing = rows[0] ? toJob(rows[0]) : null;
          if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') {
            return { job: existing, created: false };
          }
        }

        if (limits.rateLimit) {
          const { rows } = await c.query(
            `SELECT created_at FROM core_jobs
             WHERE project_id = $1 AND kind = $2 AND created_at > $3
             ORDER BY created_at DESC LIMIT $4`,
            [input.projectId, input.kind, new Date(now.getTime() - limits.rateLimit.windowMs), limits.rateLimit.max],
          );
          if (rows.length >= limits.rateLimit.max) {
            const oldest = new Date(rows[rows.length - 1].created_at).getTime();
            const retryAfterMs = Math.max(oldest + limits.rateLimit.windowMs - now.getTime(), 1);
            throw new JobRejectedError(
              'rate_limited',
              `Забагато задач «${input.kind}» поспіль — спробуйте за ${Math.ceil(retryAfterMs / 1000)} с`,
              retryAfterMs,
            );
          }
        }

        const estimate = Math.round(input.estimatedTokens ?? 0);
        for (const scope of budgetScopes(input.budgetScope)) {
          const b = await this.rolledBudget(c, input.projectId, scope, now);
          if (!b) continue;
          const { rows } = await c.query(
            `SELECT COALESCE(sum(GREATEST(estimated_tokens - used_tokens, 0)), 0)::bigint AS reserved
             FROM core_jobs
             WHERE project_id = $1 AND status IN ('queued', 'running') AND id IS DISTINCT FROM $3
               AND (budget_scope = $2 OR $2 = 'project')`,
            [input.projectId, scope, existing?.id ?? null],
          );
          const reserved = Number(rows[0].reserved);
          const tokensOut = b.limitTokens !== null && (b.usedTokens >= b.limitTokens || b.usedTokens + reserved + estimate > b.limitTokens);
          const requestsOut = b.limitRequests !== null && b.usedRequests >= b.limitRequests;
          if (tokensOut || requestsOut) throw new JobRejectedError('budget_exhausted', budgetExhaustedMessage(b));
        }

        if (existing) {
          const { rows } = await c.query(
            `UPDATE core_jobs SET status = 'queued', payload = COALESCE($2::jsonb, payload), error = NULL, result = NULL,
               attempts = 0, max_attempts = COALESCE($3, max_attempts), next_attempt_at = $4, cancel_requested = false,
               locked_by = NULL, heartbeat_at = NULL, estimated_tokens = $5, updated_at = $4, finished_at = NULL
             WHERE id = $1 RETURNING *`,
            [existing.id, input.payload ? JSON.stringify(input.payload) : null, input.maxAttempts ?? null, now, estimate],
          );
          return { job: toJob(rows[0]), created: true };
        }
        const { rows } = await c.query(
          `INSERT INTO core_jobs
             (project_id, kind, payload, idempotency_key, max_attempts, next_attempt_at, budget_scope,
              estimated_tokens, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $6, $6) RETURNING *`,
          [
            input.projectId,
            input.kind,
            JSON.stringify(input.payload ?? {}),
            key,
            input.maxAttempts ?? 3,
            now,
            input.budgetScope ?? 'project',
            estimate,
            input.createdBy,
          ],
        );
        return { job: toJob(rows[0]), created: true };
      });
    } catch (err: any) {
      if (err instanceof JobRejectedError) throw err;
      if (err?.code === '23503') throw new JobRejectedError('not_found', `Проєкт «${input.projectId}» відсутній у ядрі`);
      throw err;
    }
  }

  async claim(workerId: string, kinds: string[], now: Date, leaseMs: number) {
    if (!kinds.length) return null;
    const { rows } = await this.pool.query(
      `UPDATE core_jobs SET status = 'running', locked_by = $1, heartbeat_at = $2,
         started_at = COALESCE(started_at, $2), attempts = attempts + 1, updated_at = $2
       WHERE id = (
         SELECT id FROM core_jobs
         WHERE kind = ANY($3::text[])
           AND ((status = 'queued' AND next_attempt_at <= $2) OR (status = 'running' AND heartbeat_at < $4))
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [workerId, now, kinds, new Date(now.getTime() - leaseMs)],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async heartbeat(id: string, workerId: string, now: Date) {
    const { rows } = await this.pool.query(
      `UPDATE core_jobs SET heartbeat_at = $3 WHERE id = $1 AND locked_by = $2 AND status = 'running'
       RETURNING cancel_requested`,
      [id, workerId, now],
    );
    if (rows[0]) return { cancelRequested: rows[0].cancel_requested as boolean, lost: false };
    const cur = await this.pool.query('SELECT cancel_requested FROM core_jobs WHERE id = $1', [id]);
    return { cancelRequested: !!cur.rows[0]?.cancel_requested, lost: true };
  }

  async setProgress(id: string, workerId: string, progress: JobProgress, now: Date) {
    await this.pool.query(
      `UPDATE core_jobs SET progress = $3, heartbeat_at = $4, updated_at = $4
       WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
      [id, workerId, JSON.stringify(progress), now],
    );
  }

  async recordUsage(id: string, workerId: string, usage: UsageInput, now: Date) {
    const tokens = Math.max(Math.round(usage.tokens ?? 0), 0);
    const requests = Math.max(Math.round(usage.requests ?? 0), 0);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `UPDATE core_jobs SET used_tokens = used_tokens + $3, used_requests = used_requests + $4, updated_at = $5
         WHERE id = $1 AND locked_by = $2 AND status = 'running' RETURNING project_id, budget_scope`,
        [id, workerId, tokens, requests, now],
      );
      if (!rows[0]) return { exceeded: false };
      let exceeded = false;
      for (const scope of budgetScopes(rows[0].budget_scope)) {
        const b = await this.rolledBudget(c, rows[0].project_id, scope, now);
        if (!b) continue;
        const upd = await c.query(
          `UPDATE core_budgets SET used_tokens = used_tokens + $3, used_requests = used_requests + $4, updated_at = $5
           WHERE project_id = $1 AND scope = $2 RETURNING *`,
          [rows[0].project_id, scope, tokens, requests, now],
        );
        const nb = toBudget(upd.rows[0]);
        if ((nb.limitTokens !== null && nb.usedTokens > nb.limitTokens) || (nb.limitRequests !== null && nb.usedRequests > nb.limitRequests)) {
          exceeded = true;
        }
      }
      return { exceeded };
    });
  }

  async finish(id: string, workerId: string, outcome: FinishOutcome, now: Date) {
    if (outcome.status === 'retry') {
      const { rowCount } = await this.pool.query(
        `UPDATE core_jobs SET status = 'queued', error = $3, next_attempt_at = $4, locked_by = NULL, heartbeat_at = NULL, updated_at = $5
         WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
        [id, workerId, outcome.error, outcome.nextAttemptAt, now],
      );
      return (rowCount ?? 0) > 0;
    }
    const error =
      outcome.status === 'succeeded' ? null : outcome.status === 'failed' ? outcome.error : outcome.error ?? 'Скасовано';
    const result = outcome.status === 'succeeded' ? JSON.stringify(outcome.result ?? null) : null;
    const { rowCount } = await this.pool.query(
      `UPDATE core_jobs SET status = $3, result = $4::jsonb, error = $5, locked_by = NULL, heartbeat_at = NULL,
         finished_at = $6, updated_at = $6
       WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
      [id, workerId, outcome.status, result, error, now],
    );
    return (rowCount ?? 0) > 0;
  }

  async requestCancel(projectId: string, id: string, now: Date) {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await this.pool.query(
      `UPDATE core_jobs SET
         cancel_requested = CASE WHEN status IN ('queued', 'running') THEN true ELSE cancel_requested END,
         status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
         error = CASE WHEN status = 'queued' THEN 'Скасовано' ELSE error END,
         finished_at = CASE WHEN status = 'queued' THEN $3 ELSE finished_at END,
         updated_at = CASE WHEN status IN ('queued', 'running') THEN $3 ELSE updated_at END
       WHERE project_id = $1 AND id = $2 RETURNING *`,
      [projectId, id, now],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async get(projectId: string, id: string) {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await this.pool.query('SELECT * FROM core_jobs WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] ? toJob(rows[0]) : null;
  }

  async list(projectId: string, filter: { kind?: string; status?: JobStatus; limit?: number } = {}) {
    const { rows } = await this.pool.query(
      `SELECT * FROM core_jobs WHERE project_id = $1 AND ($2::text IS NULL OR kind = $2) AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC LIMIT $4`,
      [projectId, filter.kind ?? null, filter.status ?? null, filter.limit ?? 50],
    );
    return rows.map(toJob);
  }

  async setBudget(projectId: string, scope: string, input: BudgetInput, now: Date) {
    const period = input.period ?? null;
    const start = periodStart(input.period ?? 'month', now, now);
    const { rows } = await this.pool.query(
      `INSERT INTO core_budgets (project_id, scope, period, limit_tokens, limit_requests, window_start, updated_at)
       VALUES ($1, $2, COALESCE($3, 'month'), $4, $5, $6, $7)
       ON CONFLICT (project_id, scope) DO UPDATE SET
         period = COALESCE($3, core_budgets.period),
         limit_tokens = CASE WHEN $8 THEN $4 ELSE core_budgets.limit_tokens END,
         limit_requests = CASE WHEN $9 THEN $5 ELSE core_budgets.limit_requests END,
         updated_at = $7
       RETURNING *`,
      [
        projectId,
        scope,
        period,
        input.limitTokens ?? null,
        input.limitRequests ?? null,
        start,
        now,
        input.limitTokens !== undefined,
        input.limitRequests !== undefined,
      ],
    );
    return (await this.rolledBudget(this.pool, projectId, scope, now)) ?? toBudget(rows[0]);
  }

  async getBudget(projectId: string, scope: string, now: Date) {
    return this.rolledBudget(this.pool, projectId, scope, now);
  }

  async close() {}
}
