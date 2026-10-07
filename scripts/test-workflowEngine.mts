/**
 * Рушій процесів ШІ на LangGraph.js (Т5.4 В1, `PLAN_WORKFLOW_ENGINE.md`; ТЗ
 * Graph Studio §5.3, §16, §27, §30, §31, §39 №8, 11, 24): виконання
 * опублікованої версії, параметри моделі, гілки, умова-поріг, трасування,
 * повтори й резервна модель, ліміт витрат, пауза й продовження (і після
 * «перезапуску»), повтор на зафіксованій версії, відгалуження від кроку.
 * Запуск: npm run test:workflow-engine (з CORE_TEST_DATABASE_URL — ще й на
 * PostgreSQL; схема ядра в цій базі видаляється — лише тестова база!).
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { bootstrapOntology, resetActiveRegistry } from '../server/core/ontology/lifecycle.ts';
import { createWorkflow, saveDraft, validateVersion, promoteToTest, publishVersion } from '../server/core/workflows/lifecycle.ts';
import { startRun, resumeRun, replayRun, forkRun, requestPause, cancelRun, type EngineDeps } from '../server/core/workflows/engine/runner.ts';
import { AiTimeoutError } from '../server/aiCore.ts';
import { buildOpenAiBody, DEFAULT_QUIRKS } from '../server/modelQuirks.ts';
import { evalCondition, exprError } from '../src/utils/workflowExpr.ts';
import { validateWorkflow, samplePipeline, type WorkflowDefinition } from '../src/utils/workflowGraph.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const errOf = async (f: () => Promise<unknown>): Promise<any> => {
  try { await f(); return null; } catch (e) { return e; }
};

console.log('\nПараметри моделі до постачальника (§5.3):');
{
  const b = buildOpenAiBody({ modelId: 'm', messages: [], quirks: DEFAULT_QUIRKS, temperature: 0.2, maxOutputTokens: 50 });
  const d = buildOpenAiBody({ modelId: 'm', messages: [], quirks: DEFAULT_QUIRKS });
  t('температура й ліміт вузла — у тілі запиту; без них — як раніше (0,7 і 4096)', b.temperature === 0.2 && b.max_tokens === 50 && d.temperature === 0.7 && d.max_tokens === 4096);
}

console.log('\nУмови CONDITION (№11, без eval):');
t('поріг впевненості', evalCondition('state.confidence >= 0.7', { confidence: 0.8 }) && !evalCondition('state.confidence >= 0.7', { confidence: 0.5 }));
t('&&, ||, !, дужки, довжина', evalCondition('state.ok && (state.items.length > 1 || !state.flag)', { ok: true, items: [1], flag: false }));
t('рядки й null', evalCondition('state.kind == "scene" && state.x == null', { kind: 'scene' }));
t('невідоме ім\'я, прототип, зайве — помилка', !!exprError('process.exit()') && !!exprError('state.__proto__') && !!exprError('state.a >') && exprError('state.a > 1') === null);
const badCond: WorkflowDefinition = { format: 'fusion-workflow/1', id: 'bad_cond', name: { en: 'B', uk: 'Б' }, description: '', nodes: [{ id: 's', type: 'START', params: {} }, { id: 'c', type: 'CONDITION', params: { expression: 'eval(1)' } }, { id: 'e', type: 'END', params: {} }], edges: [{ id: 'a', from: 's', fromPort: 'out', to: 'c' }, { id: 'b', from: 'c', fromPort: 'true', to: 'e' }, { id: 'd', from: 'c', fromPort: 'false', to: 'e' }] };
t('неправильна умова — помилка перевірки процесу', validateWorkflow(badCond).errors.some((e) => e.code === 'bad_expression'));

const e = (from: string, port: string, to: string) => ({ id: `e-${from}-${port}-${to}`, from, fromPort: port, to });
function demo(id: string, llm: Record<string, unknown> = {}): WorkflowDefinition {
  return {
    format: 'fusion-workflow/1', id, name: { en: 'Demo', uk: 'Демо' }, description: '',
    nodes: [
      { id: 'start', type: 'START', params: { input_schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } } },
      { id: 'prompt', type: 'PROMPT', params: { template: 'Оціни текст і поверни JSON {score, confidence}.' } },
      { id: 'llm', type: 'LLM', params: { model_provider: 'core_module', temperature: 0.1, max_tokens: 100, timeout: 5, retry_count: 1, backoff: 'none', on_provider_error: 'alternate_model', alternate_model: 'alt-model', cost_limit: 0.5, ...llm } },
      { id: 'check', type: 'VALIDATOR', params: { output_schema: { type: 'object', required: ['score'], properties: { score: { type: 'number' } } } } },
      { id: 'gate', type: 'CONDITION', params: { expression: 'state.output.score >= 0.7' } },
      { id: 'propose', type: 'PROPOSAL', params: { target: 'fact', min_confidence: 0.5 } },
      { id: 'end', type: 'END', params: {} },
      { id: 'low', type: 'END', params: {} },
      { id: 'bad', type: 'END', params: {} },
    ],
    edges: [e('start', 'out', 'prompt'), e('prompt', 'out', 'llm'), e('llm', 'out', 'check'), e('check', 'valid', 'gate'), e('check', 'invalid', 'bad'), e('gate', 'true', 'propose'), e('gate', 'false', 'low'), e('propose', 'out', 'end')],
  };
}

async function publish(repo: CoreRepository, def: WorkflowDefinition, existing = false) {
  const actor = 'user:u-admin' as const;
  let draftId: string;
  if (!existing) draftId = (await createWorkflow(repo, { id: def.id, name: def.name, actor })).draft.id;
  else draftId = (await (await import('../server/core/workflows/lifecycle.ts')).ensureDraft(repo, def.id, actor)).id;
  await saveDraft(repo, { workflowId: def.id, versionId: draftId, definition: def, actor });
  const v = await validateVersion(repo, def.id, draftId, actor);
  if (!v.validation.ok) throw new Error(`invalid: ${JSON.stringify(v.validation.errors)}`);
  await promoteToTest(repo, def.id, draftId, actor);
  return publishVersion(repo, def.id, draftId, actor);
}

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<any>) {
  resetActiveRegistry();
  await bootstrapOntology(repo);
  const calls: any[] = [];
  let reply = (text: string) => JSON.stringify({ score: text.includes('добре') ? 0.9 : 0.3, confidence: 0.8 });
  let failures: Array<'provider' | 'timeout'> = [];
  let onCall: (() => Promise<void>) | null = null;
  const deps: EngineDeps = {
    repo,
    services: {
      async generate(input) {
        calls.push(input);
        if (onCall) await onCall();
        const f = failures.shift();
        if (f === 'timeout') throw new AiTimeoutError(5000);
        if (f === 'provider') throw new Error('503 overloaded');
        return { text: reply(String(input.user)), modelId: input.modelId ?? 'm-default', engine: 'gemini', inputTokens: 100, outputTokens: 20, costUsd: 0.001 };
      },
      resolveModel: async () => 'm-module',
      sleep: async () => {},
    },
  };
  const v1 = await publish(repo, demo('demo_flow'));
  const actor = 'user:u-admin' as const;

  console.log(`\n${name} — виконання опублікованої версії (№8, №24):`);
  t('без опублікованої версії — не запускається', (await errOf(() => startRun(deps, { workflowId: 'nope_flow', input: {}, trigger: 'manual', actor })))?.code === 'not_found');
  let r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'це добре' }, trigger: 'manual', actor, projectId: 'book-1' });
  t('запуск успішний, версія й хеш зафіксовані', r.run.status === 'succeeded' && r.run.versionId === v1.id && r.run.version === v1.version && r.run.definitionHash === v1.definitionHash && /^[0-9a-f]{64}$/.test(r.run.inputHash));
  let steps = await repo.listWorkflowSteps(r.run.id);
  t('трасування: вузли по порядку', steps.map((s) => s.nodeId).join() === 'start,prompt,llm,check,gate,propose,end', steps.map((s) => s.nodeId).join());
  const llmStep = steps.find((s) => s.nodeId === 'llm')!;
  t('крок LLM: модель, токени, вартість, затримка', llmStep.model === 'm-module' && llmStep.tokensIn === 100 && llmStep.tokensOut === 20 && llmStep.costUsd === 0.001 && llmStep.latencyMs >= 0);
  t('крок VALIDATOR і CONDITION: перевірка, гілка, рішення', steps.find((s) => s.nodeId === 'check')!.validationResult === 'valid' && steps.find((s) => s.nodeId === 'gate')!.decision === 'true' && steps.find((s) => s.nodeId === 'gate')!.branch === 'true');
  t('підсумок запуску: токени й вартість', r.run.tokensIn === 100 && r.run.tokensOut === 20 && Math.abs(r.run.costUsd - 0.001) < 1e-9);
  t('параметри §5.3 доходять до моделі: температура, ліміт, тайм-аут', calls[0].generation.temperature === 0.1 && calls[0].generation.maxTokens === 100 && calls[0].generation.timeoutMs === 5000 && calls[0].modelId === 'm-module');
  t('вихід — пропозиція', (r.run.output as any)?.proposed === true);

  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'так собі' }, trigger: 'manual', actor });
  steps = await repo.listWorkflowSteps(r.run.id);
  t('умова-поріг: false — інша гілка (№11)', r.run.status === 'succeeded' && steps.map((s) => s.nodeId).at(-1) === 'low');
  reply = () => 'не json';
  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  steps = await repo.listWorkflowSteps(r.run.id);
  t('невалідна відповідь — гілка invalid', r.run.status === 'succeeded' && steps.find((s) => s.nodeId === 'check')!.validationResult === 'invalid' && steps.at(-1)!.nodeId === 'bad');
  reply = (text) => JSON.stringify({ score: text.includes('добре') ? 0.9 : 0.3, confidence: 0.8 });
  r = await startRun(deps, { workflowId: 'demo_flow', input: { nope: 1 }, trigger: 'manual', actor });
  t('вхід не за схемою START — запуск падає на START', r.run.status === 'failed' && /схемі START/.test(r.run.error ?? ''));

  console.log(`\n${name} — повтор і відновлення (§30):`);
  calls.length = 0;
  failures = ['provider'];
  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  steps = await repo.listWorkflowSteps(r.run.id);
  t('збій — повтор: успіх, retry_count 1, попередження', r.run.status === 'succeeded' && steps.find((s) => s.nodeId === 'llm')!.retryCount === 1 && steps.find((s) => s.nodeId === 'llm')!.warnings.length === 1 && calls.length === 2);
  calls.length = 0;
  failures = ['provider', 'provider'];
  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  t('повтор вичерпано — резервна модель', r.run.status === 'succeeded' && calls.at(-1).modelId === 'alt-model' && (await repo.listWorkflowSteps(r.run.id)).find((s) => s.nodeId === 'llm')!.model === 'alt-model');
  await publish(repo, demo('slow_flow', { retry_count: 0, on_timeout: 'alternate_model', on_provider_error: 'fail' }));
  calls.length = 0;
  failures = ['timeout'];
  r = await startRun(deps, { workflowId: 'slow_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  t('тайм-аут — резервна модель за політикою on_timeout', r.run.status === 'succeeded' && calls.length === 2 && calls[1].modelId === 'alt-model');
  failures = ['provider'];
  r = await startRun(deps, { workflowId: 'slow_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  t('збій постачальника з on_provider_error = fail — без резервної', r.run.status === 'failed');
  failures = ['provider', 'provider', 'provider'];
  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  steps = await repo.listWorkflowSteps(r.run.id);
  t('усе впало — запуск failed, крок із помилкою', r.run.status === 'failed' && steps.at(-1)!.status === 'failed' && /503/.test(steps.at(-1)!.error ?? '') && !!r.run.finishedAt);
  failures = [];
  await publish(repo, demo('cheap_flow', { cost_limit: 0.0005 }));
  r = await startRun(deps, { workflowId: 'cheap_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  t('ліміт витрат — запуск зупинено, витрату враховано', r.run.status === 'failed' && /Ліміт витрат/.test(r.run.error ?? '') && r.run.costUsd > 0);

  console.log(`\n${name} — пауза, продовження, повтор, відгалуження (§31):`);
  let target = '';
  onCall = async () => {
    const runs = await repo.listWorkflowRuns({ workflowId: 'demo_flow', status: 'running', limit: 1 });
    target = runs[0].id;
    await requestPause(repo, target);
  };
  calls.length = 0;
  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  onCall = null;
  t('пауза під час моделі — зупинка перед наступним вузлом', r.run.status === 'paused' && r.run.currentNode === 'check' && r.run.id === target);
  steps = await repo.listWorkflowSteps(r.run.id);
  t('крок паузи в трасуванні', steps.at(-1)!.status === 'paused' && steps.at(-1)!.nodeId === 'check');
  t('контрольна точка збережена в ядрі', !!(await repo.getWorkflowCheckpoint(r.run.id)));
  const doneRun = (await repo.listWorkflowRuns({ status: 'succeeded', limit: 1 }))[0];
  t('продовжити можна лише призупинений', (await errOf(() => resumeRun(deps, doneRun.id, actor)))?.code === 'conflict');
  // «Перезапуск»: нові залежності — стан лише з бази.
  const deps2: EngineDeps = { ...deps, services: { ...deps.services } };
  const resumed = await resumeRun(deps2, r.run.id, actor);
  steps = await repo.listWorkflowSteps(r.run.id);
  t('продовження — з контрольної точки, без повторного виклику моделі', resumed.run.status === 'succeeded' && calls.length === 1 && steps.filter((s) => s.nodeId === 'llm').length === 1 && steps.at(-1)!.nodeId === 'end');
  const v2 = await publish(repo, demo('demo_flow', { temperature: 0.9 }), true);
  calls.length = 0;
  const rep = await replayRun(deps, resumed.run.id, actor);
  t('повтор — на тій самій (уже не робочій) версії й з тим самим входом', rep.run.status === 'succeeded' && rep.run.mode === 'replay' && rep.run.parentRunId === resumed.run.id && rep.run.versionId === v1.id && rep.run.inputHash === resumed.run.inputHash && calls[0].generation.temperature === 0.1);
  calls.length = 0;
  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  t('новий запуск — нова опублікована версія', r.run.versionId === v2.id && calls[0].generation.temperature === 0.9);
  calls.length = 0;
  const fork = await forkRun(deps, r.run.id, 3, actor);
  steps = await repo.listWorkflowSteps(fork.run.id);
  t('відгалуження від кроку 3 (після моделі) — без нового виклику, далі з перевірки', fork.run.status === 'succeeded' && fork.run.mode === 'fork' && fork.run.forkStep === 3 && calls.length === 0 && steps[0].nodeId === 'check');
  t('відгалуження від неіснуючого кроку — конфлікт', (await errOf(() => forkRun(deps, r.run.id, 99, actor)))?.code === 'conflict');
  onCall = async () => { await requestPause(repo, (await repo.listWorkflowRuns({ workflowId: 'demo_flow', status: 'running', limit: 1 }))[0].id); };
  r = await startRun(deps, { workflowId: 'demo_flow', input: { text: 'добре' }, trigger: 'manual', actor });
  onCall = null;
  const cancelled = await cancelRun(repo, r.run.id);
  t('скасування призупиненого', cancelled.status === 'cancelled' && !!cancelled.finishedAt);
  t('завершений запуск не оживає', (await errOf(() => repo.updateWorkflowRun(cancelled.id, { status: 'running' })))?.code === 'conflict');

  console.log(`\n${name} — вузли, яких рушій ще не виконує:`);
  // HUMAN_REVIEW виконується, але потребує збереженої пропозиції.
  const human: WorkflowDefinition = { format: 'fusion-workflow/1', id: 'human_flow', name: { en: 'H', uk: 'Л' }, description: '', nodes: [{ id: 's', type: 'START', params: {} }, { id: 'h', type: 'HUMAN_REVIEW', params: { reviewer: 'author' } }, { id: 'e', type: 'END', params: {} }], edges: [e('s', 'out', 'h'), e('h', 'accept', 'e'), e('h', 'edit', 'e'), e('h', 'reject', 'e')] };
  await publish(repo, human);
  r = await startRun(deps, { workflowId: 'human_flow', input: {}, trigger: 'manual', actor });
  t('перевірка людиною без пропозиції — зрозуміла помилка', r.run.status === 'failed' && /пропозиції/.test(r.run.error ?? ''));
  const sample = { ...samplePipeline(), id: 'sample_flow' };
  await publish(repo, sample);
  r = await startRun(deps, { workflowId: 'sample_flow', input: {}, trigger: 'manual', actor });
  t('CONTEXT без прив\'язки — зрозуміла помилка', r.run.status === 'failed' && /прив'язкою/.test(r.run.error ?? ''));

  if (raw) {
    console.log(`\n${name} — обмеження бази:`);
    const any = (await repo.listWorkflowRuns({ limit: 1 }))[0];
    t('невідоме джерело запуску — CHECK', await raw(`UPDATE ${CORE_SCHEMA}.workflow_runs SET trigger = 'hack' WHERE id = $1`, [any.id]).then(() => false, () => true));
    t('завершений без часу — CHECK', await raw(`UPDATE ${CORE_SCHEMA}.workflow_runs SET status = 'succeeded', finished_at = NULL WHERE id = $1`, [any.id]).then(() => false, () => true));
    t('крок із впевненістю > 1 — CHECK', await raw(`UPDATE ${CORE_SCHEMA}.workflow_run_steps SET confidence = 2 WHERE run_id = $1`, [any.id]).then((x: any) => x.rowCount === 0, () => true));
  }
}

await suite('Пам\'ять', new MemoryCoreRepository());
const pgUrl = process.env.CORE_TEST_DATABASE_URL?.trim();
if (pgUrl) {
  const pool = createCorePool(pgUrl);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — v26 (запуски процесів)', Number(rows[0].v) >= 26, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('рушій на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}
resetActiveRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
