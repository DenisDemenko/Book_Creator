/**
 * Фонова черга задач ядра — задача Т0.7 (журнал #248).
 *
 * Критерії з дорожньої карти: задача переживає перезапуск сервера;
 * скасування зупиняє її; вичерпаний бюджет не пускає нову. Плюс повтори,
 * ідемпотентність, ліміт частоти, прогрес. Один набір — для черги в пам'яті
 * і (з `CORE_TEST_DATABASE_URL`) у PostgreSQL; годинник — у руках тесту.
 *
 * УВАГА: з CORE_TEST_DATABASE_URL тест видаляє схему `fusion_core` — лише
 * окрема тестова база.
 *
 * Запуск: npm run test:core-jobs
 */
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue, JobFatalError } from '../server/core/jobs/queue.ts';
import { JobRejectedError, type JobStore } from '../server/core/jobs/types.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
async function rejects(name: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    t(name, false, 'пройшло, а мало бути відхилене');
  } catch (err) {
    const got = err instanceof JobRejectedError ? err.code : `${(err as Error).name}: ${(err as Error).message}`;
    t(name, got === code, got === code ? '' : `очікували ${code}, отримали ${got}`);
  }
}

const USER = 'user:author-1';
const MIN = 60_000;

/** `afterRestart` — сховище «нового процесу» (для PostgreSQL — інший пул з'єднань). */
async function suite(label: string, makeStore: () => JobStore, P: string, OTHER: string, afterRestart?: () => JobStore) {
  console.log(`\nЧерга задач (${label}):`);
  let clock = Date.parse('2026-09-24T10:00:00Z');
  const now = () => new Date(clock);
  const store = makeStore();
  const quiet = () => {};
  const q = new JobQueue(store, { workerId: 'w-A', now, leaseMs: MIN, heartbeatMs: 3_600_000, backoffBaseMs: 1_000, log: quiet });

  // Види задач для тесту
  let failTimes = 0;
  q.register('echo', { handler: async (ctx) => { await ctx.setProgress({ done: 1, total: 1 }); return { echoed: ctx.job.payload.text }; } });
  q.register('flaky', {
    maxAttempts: 3,
    handler: async () => {
      if (failTimes > 0) { failTimes--; throw new Error('мережа впала'); }
      return 'ok';
    },
  });
  q.register('broken', { maxAttempts: 2, handler: async () => { throw new Error('завжди падає'); } });
  q.register('fatal', { handler: async () => { throw new JobFatalError('неправильні дані'); } });
  q.register('limited', { rateLimit: { max: 2, windowMs: MIN }, handler: async () => 'ok' });
  let cancelTarget: { projectId: string; id: string } | null = null;
  q.register('long', {
    handler: async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.setProgress({ done: i, total: 5 });
        if (i === 2 && cancelTarget) await q.cancel(cancelTarget.projectId, cancelTarget.id);
        await ctx.checkpoint();
      }
      return 'дійшла до кінця';
    },
  });
  q.register('spend', {
    handler: async (ctx) => {
      await ctx.recordUsage({ tokens: Number(ctx.job.payload.tokens ?? 0), requests: 1 });
      return 'витрачено';
    },
  });

  // Постановка й ідемпотентність
  const a = await q.enqueue({ projectId: P, kind: 'echo', payload: { text: 'привіт' }, idempotencyKey: 'rev-1', createdBy: USER });
  t('задачу поставлено в чергу', a.created && a.job.status === 'queued' && a.job.attempts === 0);
  const a2 = await q.enqueue({ projectId: P, kind: 'echo', payload: { text: 'інше' }, idempotencyKey: 'rev-1', createdBy: USER });
  t('той самий ключ — та сама задача, без другої', !a2.created && a2.job.id === a.job.id && a2.job.payload.text === 'привіт');
  await rejects('невідомий вид задачі відхиляється', () => q.enqueue({ projectId: P, kind: 'nope', createdBy: USER }), 'unknown_kind');
  await rejects('автор без префікса відхиляється', () => q.enqueue({ projectId: P, kind: 'echo', createdBy: 'robot' }), 'bad_input');

  const r1 = await q.runOnce();
  const done = await store.get(P, a.job.id);
  t('задачу виконано: результат і прогрес збережено',
    r1?.id === a.job.id && done?.status === 'succeeded' && (done.result as any)?.echoed === 'привіт' && done.progress.done === 1 && !!done.finishedAt);
  t('успішна задача з тим самим ключем не виконується вдруге',
    !(await q.enqueue({ projectId: P, kind: 'echo', idempotencyKey: 'rev-1', createdBy: USER })).created);
  t('порожня черга — нічого не робимо', (await q.runOnce()) === null);

  // Повтори
  failTimes = 1;
  const f = (await q.enqueue({ projectId: P, kind: 'flaky', createdBy: USER })).job;
  await q.runOnce();
  const f1 = await store.get(P, f.id);
  t('збій — задача знову в черзі з паузою', f1?.status === 'queued' && f1.attempts === 1 && f1.error === 'мережа впала' && Date.parse(f1.nextAttemptAt) > clock);
  t('до кінця паузи задачу не беруть', (await q.runOnce()) === null);
  clock += 2_000;
  await q.runOnce();
  const f2 = await store.get(P, f.id);
  t('після паузи — друга спроба вдалась', f2?.status === 'succeeded' && f2.attempts === 2 && f2.error === null);

  const b = (await q.enqueue({ projectId: P, kind: 'broken', createdBy: USER })).job;
  await q.runOnce();
  clock += 5_000;
  await q.runOnce();
  const b2 = await store.get(P, b.id);
  t('спроби вичерпано — задача не вдалась', b2?.status === 'failed' && b2.attempts === 2 && b2.error === 'завжди падає');
  const bAgain = await q.enqueue({ projectId: P, kind: 'broken', idempotencyKey: 'x', createdBy: USER });
  await q.runOnce(); clock += 5_000; await q.runOnce();
  const bRe = await q.enqueue({ projectId: P, kind: 'broken', idempotencyKey: 'x', createdBy: USER });
  t('невдалу задачу з тим самим ключем можна поставити знову (той самий рядок, спроби з нуля)',
    bRe.created && bRe.job.id === bAgain.job.id && bRe.job.status === 'queued' && bRe.job.attempts === 0);
  await q.cancel(P, bRe.job.id);

  const fe = (await q.enqueue({ projectId: P, kind: 'fatal', createdBy: USER })).job;
  await q.runOnce();
  const fe2 = await store.get(P, fe.id);
  t('помилка без сенсу повтору — одразу failed', fe2?.status === 'failed' && fe2.attempts === 1);

  // Ліміт частоти
  await q.enqueue({ projectId: P, kind: 'limited', createdBy: USER });
  clock += 1_000;
  await q.enqueue({ projectId: P, kind: 'limited', createdBy: USER });
  let retryAfter = 0;
  try {
    await q.enqueue({ projectId: P, kind: 'limited', createdBy: USER });
  } catch (e) {
    if (e instanceof JobRejectedError && e.code === 'rate_limited') retryAfter = e.retryAfterMs ?? 0;
  }
  t('ліміт частоти: третя задача за хвилину — відмова з часом очікування', retryAfter > 0 && retryAfter <= MIN, `${retryAfter} мс`);
  t('ліміт частоти — у межах проєкту', (await q.enqueue({ projectId: OTHER, kind: 'limited', createdBy: USER })).created);
  clock += MIN;
  t('через хвилину — знову можна', (await q.enqueue({ projectId: P, kind: 'limited', createdBy: USER })).created);
  await q.drain();

  // Скасування
  const c1 = (await q.enqueue({ projectId: P, kind: 'echo', createdBy: USER })).job;
  const c1c = await q.cancel(P, c1.id);
  t('скасування задачі в черзі — одразу cancelled', c1c?.status === 'cancelled');
  t('скасовану задачу воркер не бере', (await q.runOnce()) === null && (await store.get(P, c1.id))?.status === 'cancelled');
  const long = (await q.enqueue({ projectId: P, kind: 'long', createdBy: USER })).job;
  cancelTarget = { projectId: P, id: long.id };
  await q.runOnce();
  const longDone = await store.get(P, long.id);
  t('скасування задачі, що виконується, зупиняє її на контрольній точці',
    longDone?.status === 'cancelled' && longDone.progress.done === 2 && longDone.result === null, `прогрес ${longDone?.progress.done}`);
  cancelTarget = null;
  t('скасувати задачу чужого проєкту не можна', (await q.cancel(OTHER, long.id)) === null && (await store.get(OTHER, long.id)) === null);

  // Перезапуск сервера
  clock += 1_000;
  const survivor = (await q.enqueue({ projectId: P, kind: 'long', payload: { resume: true }, createdBy: USER })).job;
  const claimed = await store.claim('w-A', ['long'], now(), MIN);
  await store.setProgress(survivor.id, 'w-A', { done: 3, total: 5 }, now());
  // …і процес «помер»: finish не викликано.
  const storeB = afterRestart ? afterRestart() : store;
  const qB = new JobQueue(storeB, { workerId: 'w-B', now, leaseMs: MIN, heartbeatMs: 3_600_000, log: quiet });
  let resumedFrom: unknown = null;
  qB.register('long', {
    handler: async (ctx) => {
      resumedFrom = ctx.job.progress.done;
      for (let i = Number(ctx.job.progress.done ?? 0); i < 5; i++) {
        await ctx.setProgress({ done: i + 1, total: 5 });
        await ctx.checkpoint();
      }
      return 'продовжено після перезапуску';
    },
  });
  t('захоплена задача поки що належить старому воркеру', claimed?.id === survivor.id && (await qB.runOnce()) === null);
  clock += MIN + 1_000;
  const resumed = await qB.runOnce();
  const sv = await store.get(P, survivor.id);
  t('після оренди задачу підхоплює новий воркер і продовжує з прогресу',
    resumed?.id === survivor.id && resumedFrom === 3 && sv?.status === 'succeeded' && sv.progress.done === 5 && sv.attempts === 2,
    `з ${resumedFrom}, ${sv?.status}`);
  t('старий воркер уже не може записати результат',
    (await store.finish(survivor.id, 'w-A', { status: 'failed', error: 'пізно' }, now())) === false && (await store.get(P, survivor.id))?.status === 'succeeded');

  // Бюджет
  await store.setBudget(P, 'project', { period: 'month', limitTokens: 1000, limitRequests: null }, now());
  const s1 = (await q.enqueue({ projectId: P, kind: 'spend', payload: { tokens: 300 }, estimatedTokens: 600, createdBy: USER })).job;
  await rejects('резерв активних задач враховується: друга на 600 з 1000 не влазить',
    () => q.enqueue({ projectId: P, kind: 'spend', payload: { tokens: 300 }, estimatedTokens: 600, createdBy: USER }), 'budget_exhausted');
  await q.runOnce();
  const bud1 = await store.getBudget(P, 'project', now());
  t('витрата задачі списана з бюджету', bud1?.usedTokens === 300 && bud1.usedRequests === 1 && (await store.get(P, s1.id))?.usedTokens === 300);
  const s2 = (await q.enqueue({ projectId: P, kind: 'spend', payload: { tokens: 800 }, estimatedTokens: 600, createdBy: USER })).job;
  t('після завершення резерв звільнився — задача на 600 влазить', s2.status === 'queued');
  await q.runOnce();
  const s2d = await store.get(P, s2.id);
  t('перевищення бюджету зупиняє задачу без повторів', s2d?.status === 'failed' && s2d.attempts === 1 && /Бюджет/.test(s2d.error ?? ''), s2d?.error ?? '');
  await rejects('вичерпаний бюджет не пускає нову задачу (Т0.7)',
    () => q.enqueue({ projectId: P, kind: 'echo', createdBy: USER }), 'budget_exhausted');
  t('бюджет одного проєкту не зачіпає інший', (await q.enqueue({ projectId: OTHER, kind: 'echo', createdBy: USER })).created);
  clock = Date.parse('2026-10-01T00:00:05Z');
  const bud2 = await store.getBudget(P, 'project', now());
  t('новий місяць — витрата з нуля', bud2?.usedTokens === 0 && bud2.windowStart === '2026-10-01T00:00:00.000Z', bud2?.windowStart);
  t('і задачі знову приймаються', (await q.enqueue({ projectId: P, kind: 'echo', createdBy: USER })).created);
  await q.drain();

  await store.setBudget(P, 'simulation:s1', { period: 'total', limitRequests: 1 }, now());
  await q.enqueue({ projectId: P, kind: 'spend', payload: { tokens: 10 }, budgetScope: 'simulation:s1', createdBy: USER });
  await q.drain();
  await rejects('бюджет симуляції: ліміт запитів вичерпано',
    () => q.enqueue({ projectId: P, kind: 'spend', budgetScope: 'simulation:s1', createdBy: USER }), 'budget_exhausted');
  t('задачі проєкту поза симуляцією йдуть далі', (await q.enqueue({ projectId: P, kind: 'echo', createdBy: USER })).created);
  t('витрата симуляції списана й з проєктного бюджету', (await store.getBudget(P, 'project', now()))?.usedTokens === 10);
  await store.setBudget(P, 'project', { limitTokens: null }, now());
  t('ліміт можна зняти', (await store.getBudget(P, 'project', now()))?.limitTokens === null);
  await q.drain();

  const listed = await store.list(P, { kind: 'long' });
  t('список задач проєкту — від нових до старих', listed.length === 2 && listed[0].id === survivor.id && listed[1].id === long.id, listed.map((j) => j.status).join());
  return store;
}

await suite('memory', () => new MemoryJobStore(), 'book-1', 'book-2');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — поведінку перевірено на черзі в пам\'яті');
} else {
  const pool = createCorePool(url);
  const pool2 = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    const mig = await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    console.log('\nPostgreSQL — міграції:');
    t('міграції разом із 0003 накотились на порожню базу', mig.applied.includes(3), mig.applied.join());
    const repo = new PgCoreRepository(pool);
    await repo.upsertProject({ id: 'pg-1', ownerId: 'a' });
    await repo.upsertProject({ id: 'pg-2', ownerId: 'b' });
    await suite('postgres', () => new PgJobStore(pool), 'pg-1', 'pg-2', () => new PgJobStore(pool2));

    console.log('\nPostgreSQL — кілька процесів:');
    const sA = new PgJobStore(pool);
    const sB = new PgJobStore(pool2);
    const now = new Date('2026-11-01T10:00:00Z');
    await sA.enqueue({ projectId: 'pg-1', kind: 'race', createdBy: USER }, now);
    await sA.enqueue({ projectId: 'pg-1', kind: 'race', createdBy: USER }, now);
    const [x, y] = await Promise.all([sA.claim('p1', ['race'], now, MIN), sB.claim('p2', ['race'], now, MIN)]);
    t('два процеси одночасно беруть різні задачі (SKIP LOCKED)', !!x && !!y && x.id !== y.id);
    const same = await Promise.all(
      Array.from({ length: 6 }, (_, i) => (i % 2 ? sA : sB).enqueue({ projectId: 'pg-1', kind: 'race', idempotencyKey: 'dup', createdBy: USER }, now)),
    );
    t('одночасна постановка з одним ключем — одна задача', new Set(same.map((r) => r.job.id)).size === 1 && same.filter((r) => r.created).length === 1);
    const n = await pool.query(`SELECT count(*)::int AS n FROM core_jobs WHERE kind = 'race' AND created_by = $1 AND idempotency_key = 'dup'`, [USER]);
    t('у базі справді один рядок', n.rows[0].n === 1);
    await rejects('задача для проєкту, якого немає в ядрі, відхиляється',
      () => sA.enqueue({ projectId: 'ghost', kind: 'race', createdBy: USER }, now), 'not_found');
    const aiRaw = await pool.query(`SELECT count(*)::int AS n FROM core_jobs`);
    t('видалення проєкту прибирає його задачі й бюджети',
      await (async () => { await pool.query(`DELETE FROM projects WHERE id = 'pg-2'`); const r = await pool.query(`SELECT (SELECT count(*) FROM core_jobs WHERE project_id='pg-2') + (SELECT count(*) FROM core_budgets WHERE project_id='pg-2') AS n`); return Number(r.rows[0].n) === 0 && aiRaw.rows[0].n > 0; })());
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
    await pool2.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
