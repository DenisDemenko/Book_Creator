/**
 * Виконавець фонових задач ядра (Т0.7). Сховище — `JobStore` (PostgreSQL або
 * пам'ять); тут — усе, що однакове для обох: реєстр видів задач, повтори з
 * паузою, скасування, контрольні точки, облік витрат.
 *
 * ЯК ПИСАТИ ЗАДАЧУ. Обробник отримує `ctx` і між кроками викликає
 * `await ctx.checkpoint()` — там продовжується оренда й перевіряється
 * скасування. Прогрес (`ctx.setProgress`) зберігається в базі: після
 * перезапуску задача почнеться знову з тим самим `ctx.job.progress`, тож
 * обробник може продовжити, а не почати спочатку (як черга Etsy — з кроку).
 * Кожен виклик моделі — `await ctx.recordUsage({ tokens, requests: 1 })`:
 * вичерпаний бюджет зупиняє задачу одразу, без повторів.
 */

import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  JobRejectedError,
  type EnqueueInput,
  type EnqueueResult,
  type JobProgress,
  type JobRow,
  type JobStore,
  type UsageInput,
} from './types';

/** Задачу скасовано — обробник виходить через цей виняток. */
export class JobCancelledError extends Error {
  constructor() {
    super('Задачу скасовано');
    this.name = 'JobCancelledError';
  }
}

/** Помилка, яку повторювати марно (неправильні дані, вичерпаний бюджет). */
export class JobFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobFatalError';
  }
}

/** Оренду втрачено — задачу вже виконує інший воркер. */
class JobLostError extends Error {
  constructor() {
    super('Задачу перехопив інший воркер');
    this.name = 'JobLostError';
  }
}

export interface JobContext {
  readonly job: JobRow;
  /** Спрацьовує на скасування — для fetch і викликів моделей, що вміють AbortSignal. */
  readonly signal: AbortSignal;
  /** Продовжує оренду; кидає `JobCancelledError`, якщо автор скасував задачу. */
  checkpoint(): Promise<void>;
  setProgress(progress: JobProgress): Promise<void>;
  /** Списує витрату; кидає `JobFatalError`, якщо бюджет тепер перевищено. */
  recordUsage(usage: UsageInput): Promise<void>;
}

export interface JobKind {
  handler: (ctx: JobContext) => Promise<unknown>;
  maxAttempts?: number;
  /** Ліміт частоти постановки для виду в межах проєкту. */
  rateLimit?: { max: number; windowMs: number };
}

export interface JobQueueOptions {
  workerId?: string;
  now?: () => Date;
  /** Скільки heartbeat може мовчати, поки задачу вважають покинутою. */
  leaseMs?: number;
  /** Як часто продовжувати оренду, поки обробник працює без контрольних точок. */
  heartbeatMs?: number;
  /** Пауза перед повтором: base · 2^(спроба−1), не більше max. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  log?: (line: string) => void;
}

export class JobQueue {
  readonly workerId: string;
  private readonly kinds = new Map<string, JobKind>();
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly log: (line: string) => void;

  constructor(readonly store: JobStore, opts: JobQueueOptions = {}) {
    this.workerId = opts.workerId ?? `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.now = opts.now ?? (() => new Date());
    this.leaseMs = opts.leaseMs ?? 60_000;
    this.heartbeatMs = opts.heartbeatMs ?? 15_000;
    this.backoffBaseMs = opts.backoffBaseMs ?? 5_000;
    this.backoffMaxMs = opts.backoffMaxMs ?? 5 * 60_000;
    this.log = opts.log ?? ((line) => console.log(line));
  }

  register(kind: string, def: JobKind): this {
    this.kinds.set(kind, def);
    return this;
  }

  registeredKinds(): string[] {
    return [...this.kinds.keys()];
  }

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const def = this.kinds.get(input.kind);
    if (!def) throw new JobRejectedError('unknown_kind', `Невідомий вид задачі «${input.kind}»`);
    return this.store.enqueue(
      { ...input, maxAttempts: input.maxAttempts ?? def.maxAttempts },
      this.now(),
      { rateLimit: def.rateLimit },
    );
  }

  cancel(projectId: string, id: string) {
    return this.store.requestCancel(projectId, id, this.now());
  }

  private backoff(attempt: number): number {
    return Math.min(this.backoffBaseMs * 2 ** Math.max(attempt - 1, 0), this.backoffMaxMs);
  }

  /**
   * Бере й виконує одну задачу до кінця спроби. Повертає задачу (як її
   * захопили) або null, якщо робити нічого.
   */
  async runOnce(): Promise<JobRow | null> {
    const kinds = this.registeredKinds();
    const job = await this.store.claim(this.workerId, kinds, this.now(), this.leaseMs);
    if (!job) return null;
    const def = this.kinds.get(job.kind)!;
    const tag = `[core-jobs] ${job.kind} ${job.id.slice(0, 8)}`;

    // Задача, яку скасували, поки процес, що її виконував, лежав.
    if (job.cancelRequested) {
      await this.store.finish(job.id, this.workerId, { status: 'cancelled' }, this.now());
      return job;
    }
    // Спроба понад ліміт — це задача, що вже кілька разів «вбила» свій процес.
    if (job.attempts > job.maxAttempts) {
      await this.store.finish(
        job.id,
        this.workerId,
        { status: 'failed', error: `Спроби вичерпано (${job.maxAttempts}): задача переривалась без результату` },
        this.now(),
      );
      this.log(`${tag}: спроби вичерпано`);
      return job;
    }

    const controller = new AbortController();
    let lost = false;
    let cancelled = false;
    const beat = async () => {
      const hb = await this.store.heartbeat(job.id, this.workerId, this.now());
      if (hb.lost) {
        lost = true;
        controller.abort(new JobLostError());
      } else if (hb.cancelRequested && !cancelled) {
        cancelled = true;
        controller.abort(new JobCancelledError());
      }
    };
    const timer = setInterval(() => {
      beat().catch((err) => this.log(`${tag}: heartbeat не вдався — ${(err as Error).message}`));
    }, this.heartbeatMs);
    (timer as any).unref?.();

    const ctx: JobContext = {
      job,
      signal: controller.signal,
      checkpoint: async () => {
        await beat();
        if (lost) throw new JobLostError();
        if (cancelled) throw new JobCancelledError();
      },
      setProgress: async (progress) => {
        if (lost) throw new JobLostError();
        await this.store.setProgress(job.id, this.workerId, progress, this.now());
      },
      recordUsage: async (usage) => {
        const { exceeded } = await this.store.recordUsage(job.id, this.workerId, usage, this.now());
        if (exceeded) throw new JobFatalError('Бюджет ШІ проєкту вичерпано — задачу зупинено');
      },
    };

    try {
      const result = await def.handler(ctx);
      if (cancelled) {
        await this.store.finish(job.id, this.workerId, { status: 'cancelled' }, this.now());
      } else {
        await this.store.finish(job.id, this.workerId, { status: 'succeeded', result }, this.now());
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      if (lost || err instanceof JobLostError) {
        // Писати нічого не можна: задача вже чужа.
        this.log(`${tag}: оренду втрачено, результат цієї спроби відкинуто`);
      } else if (cancelled || err instanceof JobCancelledError) {
        await this.store.finish(job.id, this.workerId, { status: 'cancelled' }, this.now());
        this.log(`${tag}: скасовано`);
      } else if (err instanceof JobFatalError || job.attempts >= job.maxAttempts) {
        await this.store.finish(job.id, this.workerId, { status: 'failed', error: message }, this.now());
        this.log(`${tag}: не вдалася — ${message}`);
      } else {
        const delay = this.backoff(job.attempts);
        await this.store.finish(
          job.id,
          this.workerId,
          { status: 'retry', error: message, nextAttemptAt: new Date(this.now().getTime() + delay) },
          this.now(),
        );
        this.log(`${tag}: спроба ${job.attempts}/${job.maxAttempts} впала (${message}) — повтор через ${Math.round(delay / 1000)} с`);
      }
    } finally {
      clearInterval(timer);
    }
    return job;
  }

  /** Проганяє чергу, поки є робота (тести, ручне «дожати»). */
  async drain(maxJobs = 100): Promise<number> {
    let n = 0;
    while (n < maxJobs && (await this.runOnce())) n++;
    return n;
  }

  /**
   * Фоновий воркер: одна задача за раз на процес. Паралелізм між інстансами
   * дає SKIP LOCKED; усередині процесу послідовність простіша й не перевищує
   * ліміти провайдерів ШІ.
   */
  start(intervalMs = 2_000): { stop: () => void } {
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        // Поки є робота — без пауз між задачами.
        while (!stopped && (await this.runOnce())) {
          /* далі */
        }
      } catch (err) {
        this.log(`[core-jobs] помилка воркера: ${(err as Error).message}`);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), intervalMs);
    (timer as any).unref?.();
    return {
      stop() {
        stopped = true;
        clearInterval(timer);
      },
    };
  }
}
