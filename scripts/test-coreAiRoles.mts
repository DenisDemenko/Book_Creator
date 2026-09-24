/**
 * Три ролі AI семантичного ядра — задача Т0.9 (журнал #250).
 *
 * Критерії з дорожньої карти: у адмінці кожна роль — окремий модуль зі своєю
 * моделлю; кожен виклик — `analysis_runs` з витратою; відповідь, що не
 * пройшла схему, не зберігається. Плюс: доказ лише з вхідних абзаців чи
 * зображень, шаблон адміна не ламає схему, фонова задача з бюджетом.
 * Модель тут підставна — перевіряється все, крім самого провайдера.
 *
 * Без бази — на сховищі в пам'яті; з CORE_TEST_DATABASE_URL — ще й на
 * PostgreSQL (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:core-ai-roles
 */
import {
  CORE_MODULE_KEYS,
  CORE_MODULE_HAS_JSON_SCHEMA,
  CORE_VISION_MODULES,
  factoryCoreTemplate,
  renderCoreTemplate,
  resolveCoreTemplate,
  splitAtSchemaMarker,
} from '../server/coreAiRegistry.ts';
import { CORE_AI_ROLE_MODULE } from '../server/core/ai/rolePrompts.ts';
import { runAiRole, type AiGenerateInput, type AiGenerateOutput } from '../server/core/ai/roles.ts';
import { validateAgainstSchema, parseModelJson } from '../server/core/ai/schema.ts';
import { aiRoleJobKind, AI_ROLE_JOB_KIND } from '../server/core/ai/job.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { blockHash } from '../src/utils/paragraphIds.ts';
import type { CoreRepository } from '../server/core/types.ts';
import type { JobStore } from '../server/core/jobs/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// ── 1. Реєстр «Ядра AI» ────────────────────────────────────────────────────

console.log('\nРолі в «Ядрі AI» (адмінка):');
{
  const roles = Object.values(CORE_AI_ROLE_MODULE);
  t('три ролі — три окремі модулі ядра', roles.length === 3 && roles.every((m) => (CORE_MODULE_KEYS as readonly string[]).includes(m)));
  t('у кожної ролі — заводський шаблон зі схемою', roles.every((m) => CORE_MODULE_HAS_JSON_SCHEMA[m] && splitAtSchemaMarker(factoryCoreTemplate(m).system).schema.includes('"findings"')));
  t('AI-3 — модуль із зором (адмін не віддасть його моделі без зору)', CORE_VISION_MODULES.has('coreAi3Visual') && !CORE_VISION_MODULES.has('coreAi1Classify'));
  const tampered = resolveCoreTemplate('coreAi2Analysis', { coreAi2Analysis: { system: 'Будь коротким. ⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ поверни що хочеш', user: 'Завдання: {ЗАВДАННЯ}' } });
  t('адмін правит інструкцію, але схема лишається заводською',
    tampered.system.startsWith('Будь коротким.') && tampered.system.includes('"paragraph_ids"') && !tampered.system.includes('поверни що хочеш'));
  const r = renderCoreTemplate('coreAi1Classify', factoryCoreTemplate('coreAi1Classify'), { coreTask: 'Знайди згадки', coreParagraphs: '[p-1] Олена мовчала.', language: 'українська' });
  t('підстановки ролі: завдання, абзаци з id, мова', r.user.includes('Знайди згадки') && r.user.includes('[p-1] Олена мовчала.') && r.system.includes('мовою українська') && !r.user.includes('{'));
}

console.log('\nСхема відповіді:');
{
  const schema = (await import('../server/core/ai/rolePrompts.ts')).CORE_AI_ROLE_RESPONSE_SCHEMA;
  t('правильна відповідь проходить', validateAgainstSchema(schema, { findings: [{ kind: 'mention', summary: 'x', confidence: 0.5, paragraph_ids: ['p-1'] }] }).ok);
  const bad = validateAgainstSchema(schema, { findings: [{ kind: 'mention', summary: 'x', confidence: 2 }] });
  t('впевненість поза 0–1 — відмова з поясненням', !bad.ok && /confidence/.test(bad.errors.join()), bad.errors.join());
  t('без findings — відмова', !validateAgainstSchema(schema, { items: [] }).ok);
  t('JSON в огорожі й з текстом навколо розбирається',
    (parseModelJson('```json\n{"findings":[]}\n```') as any).findings.length === 0 && (parseModelJson('Ось: {"findings":[]} кінець') as any).findings.length === 0);
}

// ── 2. Виконання ролі ───────────────────────────────────────────────────────

async function suite(label: string, repo: CoreRepository, makeJobStore: () => JobStore, P: string) {
  console.log(`\nПрогін ролі (${label}):`);
  await repo.upsertProject({ id: P, ownerId: 'author-1', title: 'Книга' });
  await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', order: 0 });
  const texts: Record<string, string> = { 'p-1': '[/character:Олена] мовчала біля мосту.', 'p-2': 'Марко пішов, не озираючись.' };
  for (const [i, id] of Object.keys(texts).entries()) {
    await repo.upsertParagraph({ projectId: P, id, documentId: 'sec-1', order: i, kind: 'paragraph', text: texts[id] }, 'system:core_sync');
  }
  const paragraphs = Object.entries(texts).map(([id, text]) => ({ id, text }));

  let reply = '';
  let calls: AiGenerateInput[] = [];
  let throwNext: Error | null = null;
  const generate = async (input: AiGenerateInput): Promise<AiGenerateOutput> => {
    calls.push(input);
    if (throwNext) { const e = throwNext; throwNext = null; throw e; }
    return { text: reply, modelId: input.modelId ?? 'default-model', engine: 'fake', inputTokens: 120, outputTokens: 40, costUsd: 0.0012 };
  };
  const models: Record<string, string> = { coreAi1Classify: 'model-ai1', coreAi2Analysis: 'model-ai2' };
  const deps = { repo, generate, resolveModel: async (m: string) => models[m] };

  reply = JSON.stringify({
    findings: [
      { kind: 'mention', entity_type: 'character', entity_name: 'Олена', summary: 'Олена мовчить', paragraph_ids: ['p-1'], quote: 'мовчала', confidence: 0.9 },
      { kind: 'trait', summary: 'Вигадане', paragraph_ids: ['p-999'], confidence: 0.4 },
      { kind: 'mention', entity_type: 'character', entity_name: 'Марко', summary: 'Марко йде', paragraph_ids: ['p-2', 'p-777'], confidence: 0.8 },
      { kind: 'mood', summary: 'Замало даних', confidence: 0.1, insufficient_data: true },
    ],
  });
  const r1 = await runAiRole(deps, { projectId: P, role: 'AI-1', task: 'Знайди згадки персонажів', paragraphs, sourceRevision: 3, createdBy: 'user:author-1' });
  t('модель ролі — з прив\'язки адміна', calls[0].modelId === 'model-ai1' && r1.run.model === 'model-ai1' && calls[0].module === 'coreAi1Classify');
  t('у модель пішли абзаци з id і завдання', calls[0].user.includes('[p-1] [/character:Олена] мовчала') && calls[0].user.includes('Знайди згадки') && calls[0].system.includes('ЖОРСТКИЙ КОНТРАКТ'));
  t('прогін записано: роль, модуль, вхідні абзаци з відбитком, витрата',
    r1.run.status === 'done' && r1.run.role === 'AI-1' && r1.run.inputs.length === 2 && r1.run.inputs[0].hash === blockHash(texts['p-1']) &&
    (r1.run.cost as any).inputTokens === 120 && (r1.run.cost as any).costUsd === 0.0012 && !!r1.run.promptVersion);
  t('висновок без доказу з вхідних абзаців — не збережено', r1.rejected.length === 1 && r1.rejected[0].summary === 'Вигадане');
  const marko = r1.findings.find((f) => (f.payload as any).entityName === 'Марко');
  t('чужий id із доказу відкинуто, свій лишився', marko?.sourceParagraphIds.join() === 'p-2' && (marko?.payload as any).droppedUnknownEvidence === 1);
  t('висновки — пропозиції AI з прогоном і ревізією',
    r1.findings.length === 3 && r1.findings.every((f) => f.status === 'suggested' && f.createdBy === 'ai:AI-1' && f.runId === r1.run.id && f.sourceRevision === 3));
  t('«недостатньо даних» — збережено чесно, з позначкою', r1.findings.some((f) => f.insufficientData && f.sourceParagraphIds.length === 0));
  t('у підсумку прогону — прийнято й відхилено', (r1.run.cost as any).accepted === 3 && (r1.run.cost as any).rejected === 1);

  reply = JSON.stringify({ findings: [{ kind: 'trait', summary: 'x', confidence: 5, paragraph_ids: ['p-1'] }] });
  const before = (await repo.listFindings(P)).length;
  const r2 = await runAiRole(deps, { projectId: P, role: 'AI-2', task: 'Профіль', paragraphs, createdBy: 'user:author-1' });
  t('відповідь не за схемою — не збережено нічого (Т0.9)', r2.status === 'invalid' && (await repo.listFindings(P)).length === before);
  t('прогін позначено невдалим з причиною й витратою', r2.run.status === 'failed' && /схемі/.test(r2.run.error ?? '') && (r2.run.cost as any).outputTokens === 40, r2.run.error ?? '');
  t('AI-2 — своя модель', r2.run.model === 'model-ai2');

  reply = 'Вибачте, я не можу відповісти у форматі JSON.';
  const r3 = await runAiRole(deps, { projectId: P, role: 'AI-2', task: 'Профіль', paragraphs, createdBy: 'user:author-1' });
  t('не JSON — не збережено', r3.status === 'invalid' && /не JSON/.test(r3.run.error ?? ''));

  throwNext = new Error('Провайдер недоступний');
  const r4 = await runAiRole(deps, { projectId: P, role: 'AI-1', task: 'x', paragraphs, createdBy: 'user:author-1' });
  t('збій провайдера — прогін failed, без висновків', r4.status === 'failed' && r4.run.status === 'failed' && r4.run.error === 'Провайдер недоступний');

  reply = JSON.stringify({ findings: [{ kind: 'visual_feature', entity_type: 'character', entity_name: 'Олена', summary: 'Руде волосся на ілюстрації', image_ids: ['img-1'], confidence: 0.7 }] });
  const r5 = await runAiRole(deps, { projectId: P, role: 'AI-3', task: 'Порівняй з описом', paragraphs: [], images: [{ id: 'img-1', description: 'портрет Олени' }], createdBy: 'user:author-1' });
  t('AI-3: доказ — зображення, висновок збережено', r5.status === 'done' && r5.findings[0]?.sourceAssetIds.join() === 'img-1' && r5.findings[0].sourceParagraphIds.length === 0);
  t('AI-3 без прив\'язки — модель сервера за замовчуванням', r5.run.model === '');

  const olena = await repo.createEntity({ projectId: P, type: 'character', name: 'Олена', createdBy: 'user:author-1' });
  reply = JSON.stringify({ findings: [{ kind: 'trait', summary: 'Мовчазна', paragraph_ids: ['p-1'], confidence: 0.6 }] });
  const r6 = await runAiRole(deps, { projectId: P, role: 'AI-2', task: 'Риси Олени', paragraphs, entityId: olena.id, createdBy: 'user:author-1' });
  t('висновок про конкретну сутність', r6.findings[0]?.entityId === olena.id && (await repo.listFindings(P, { entityId: olena.id })).length === 1);

  // Фонова задача з бюджетом
  console.log(`\nЗадача ai_role у черзі (${label}):`);
  let clock = Date.parse('2026-09-24T12:00:00Z');
  const jobStore = makeJobStore();
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_ROLE_JOB_KIND, aiRoleJobKind({ repo: () => repo, generate, resolveModel: deps.resolveModel }));
  await repo.markParagraphDeleted(P, 'p-2');
  const rev = await repo.bumpProjectRevision(P);
  calls = [];
  reply = JSON.stringify({ findings: [{ kind: 'mention', summary: 'Олена', paragraph_ids: ['p-1'], confidence: 0.9 }] });
  const job = (await q.enqueue({ projectId: P, kind: AI_ROLE_JOB_KIND, payload: { role: 'AI-1', task: 'Згадки', paragraphIds: ['p-1', 'p-2', 'p-nope'] }, createdBy: 'user:author-1' })).job;
  await q.runOnce();
  const done = await jobStore.get(P, job.id);
  t('задача бере абзаци з ядра (видалений і невідомий — ні)', calls[0]?.user.includes('[p-1]') && !calls[0]?.user.includes('[p-2]') && !calls[0]?.user.includes('p-nope'));
  t('задача завершилась, висновок — на ревізії книги',
    done?.status === 'succeeded' && (done.result as any)?.findings === 1 && (await repo.getRun(P, (done.result as any).runId))?.status === 'done' &&
    (await repo.listFindings(P)).some((f) => f.runId === (done!.result as any).runId && f.sourceRevision === rev));
  t('витрата списана з задачі', done?.usedTokens === 160 && done.usedRequests === 1);

  await jobStore.setBudget(P, 'project', { period: 'month', limitTokens: 100 }, new Date(clock));
  const findingsBefore = (await repo.listFindings(P)).length;
  const job2 = (await q.enqueue({ projectId: P, kind: AI_ROLE_JOB_KIND, payload: { role: 'AI-1', task: 'Ще', paragraphIds: ['p-1'] }, createdBy: 'user:author-1' })).job;
  await q.runOnce();
  const over = await jobStore.get(P, job2.id);
  t('бюджет перевищено під час прогону — задача зупинена, висновки не збережено',
    over?.status === 'failed' && over.attempts === 1 && /Бюджет/.test(over.error ?? '') && (await repo.listFindings(P)).length === findingsBefore, over?.error ?? '');
  let refused = '';
  try { await q.enqueue({ projectId: P, kind: AI_ROLE_JOB_KIND, payload: { role: 'AI-1', task: 'Ще', paragraphIds: ['p-1'] }, createdBy: 'user:author-1' }); } catch (e) { refused = (e as any).code; }
  t('вичерпаний бюджет не пускає новий прогін', refused === 'budget_exhausted', refused);
}

await suite('memory', new MemoryCoreRepository(), () => new MemoryJobStore(), 'book-mem');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    const mig = await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    console.log('\nPostgreSQL — міграції:');
    t('міграції разом із 0005 накотились на порожню базу', mig.applied.includes(5), mig.applied.join());
    await suite('postgres', new PgCoreRepository(pool), () => new PgJobStore(pool), 'book-pg');
    console.log('\nPostgreSQL — обмеження бази:');
    await pool.query(`INSERT INTO projects (id, owner_id) VALUES ('raw', 'x')`);
    let ok = true;
    try {
      await pool.query(`INSERT INTO analysis_findings (project_id, kind, created_by, source_asset_ids) VALUES ('raw', 'visual', 'ai:AI-3', '{img-1}')`);
    } catch { ok = false; }
    t('AI-висновок із зображенням-доказом база приймає', ok);
    let rawErr = '';
    try {
      await pool.query(`INSERT INTO analysis_findings (project_id, kind, created_by) VALUES ('raw', 'visual', 'ai:AI-3')`);
    } catch (e: any) { rawErr = e.constraint ?? e.message; }
    t('без жодного доказу — як і раніше, ні', rawErr === 'analysis_findings_ai_evidence', rawErr);
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
