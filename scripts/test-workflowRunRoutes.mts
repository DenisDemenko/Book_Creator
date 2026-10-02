/**
 * Запуски процесів ШІ — API Graph Studio (Т5.4 В3, `PLAN_WORKFLOW_ENGINE.md`;
 * ТЗ Graph Studio §27, §31, №24; рішення власника §2 п.3). Сховище ядра в
 * пам'яті, підставна модель, express на випадковому порту.
 * Запуск: npm run test:workflow-run-routes
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { bootstrapOntology, resetActiveRegistry } from '../server/core/ontology/lifecycle.ts';
import { createWorkflow, saveDraft, validateVersion, promoteToTest, publishVersion } from '../server/core/workflows/lifecycle.ts';
import { registerWorkflowRunRoutes } from '../server/core/workflows/runRoutes.ts';
import { requestPause, type EngineDeps } from '../server/core/workflows/engine/runner.ts';
import type { WorkflowDefinition } from '../src/utils/workflowGraph.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
const e = (from: string, port: string, to: string) => ({ id: `e-${from}-${port}-${to}`, from, fromPort: port, to });
const def: WorkflowDefinition = {
  format: 'fusion-workflow/1', id: 'score_flow', name: { en: 'Score', uk: 'Оцінка' }, description: '',
  nodes: [
    { id: 'start', type: 'START', label: 'In (Вхід)', params: {} },
    { id: 'prompt', type: 'PROMPT', label: 'Prompt (Інструкція)', params: { template: 'Оціни: {{input.text}}' } },
    { id: 'llm', type: 'LLM', label: 'Model (Модель)', params: { model_provider: 'core_module', temperature: 0.3 } },
    { id: 'check', type: 'VALIDATOR', label: 'Check (Перевірка)', params: {} },
    { id: 'end', type: 'END', params: {} },
    { id: 'bad', type: 'END', params: {} },
  ],
  edges: [e('start', 'out', 'prompt'), e('prompt', 'out', 'llm'), e('llm', 'out', 'check'), e('check', 'valid', 'end'), e('check', 'invalid', 'bad')],
};
const actor = 'user:u-admin' as const;
const { draft } = await createWorkflow(repo, { id: def.id, name: def.name, actor });
await saveDraft(repo, { workflowId: def.id, versionId: draft.id, definition: def, actor });
await validateVersion(repo, def.id, draft.id, actor);
await promoteToTest(repo, def.id, draft.id, actor);
await publishVersion(repo, def.id, draft.id, actor);

let pauseNext = false;
let calls = 0;
const engine: EngineDeps = {
  repo,
  services: {
    async generate(input) {
      calls++;
      if (pauseNext) {
        pauseNext = false;
        const r = (await repo.listWorkflowRuns({ status: 'running', limit: 1 }))[0];
        await requestPause(repo, r.id);
      }
      return { text: '{"score": 0.8, "confidence": 0.9}', modelId: input.modelId ?? 'm', engine: 'fake', inputTokens: 30, outputTokens: 10, costUsd: 0.0005 };
    },
    resolveModel: async () => 'model-x',
    sleep: async () => {},
  },
};
let coreUp = true;
const ROLE: Record<string, string> = { 'u-admin': 'admin', 'u-writer': 'writer' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLE[id] ?? 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
const guard = (req: any, res: any, next: any) => (req.principal?.isGuest ? res.status(401).json({ error: 'auth' }) : req.principal.role === 'admin' ? next() : res.status(403).json({ error: 'forbidden', kind: 'forbidden' }));
registerWorkflowRunRoutes(app, { repo: () => (coreUp ? repo : null), engine: () => (coreUp ? engine : null), requireStudio: guard, requireControl: guard });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/core/workflow-runs`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const settle = async (id: string, want: string[]) => {
  for (let i = 0; i < 100; i++) {
    const r = await call('GET', `/${id}`, 'u-admin');
    if (want.includes(r.body.run?.status)) return r.body;
    await sleep(20);
  }
  return (await call('GET', `/${id}`, 'u-admin')).body;
};

console.log('\nДоступ (§2 п.3):');
t('гість — 401, без права — 403', (await call('GET', '', '')).status === 401 && (await call('GET', '', 'u-writer')).status === 403);
coreUp = false;
t('ядро недоступне — 503', (await call('GET', '', 'u-admin')).status === 503);
coreUp = true;
t('журнал порожній', (await call('GET', '', 'u-admin')).body.runs.length === 0);

console.log('\nРучний запуск і трасування (№24):');
t('без процесу — 422', (await call('POST', '', 'u-admin', {})).status === 422);
t('процесу без опублікованої версії — 404', (await call('POST', '', 'u-admin', { workflowId: 'nope_flow' })).status === 404);
const started = await call('POST', '', 'u-admin', { workflowId: 'score_flow', input: { text: 'добре' }, projectId: 'book-1' });
t('202 — запуск створено одразу', started.status === 202 && started.body.run.status === 'running' && started.body.run.trigger === 'manual');
const d1 = await settle(started.body.run.id, ['succeeded', 'failed']);
t('завершився успішно у фоні', d1.run.status === 'succeeded', d1.run.error ?? '');
t('кроки з моделлю, токенами, вартістю й затримкою', d1.steps.map((s: any) => s.nodeId).join() === 'start,prompt,llm,check,end' && d1.steps[2].model === 'model-x' && d1.steps[2].tokensIn === 30 && d1.steps[2].costUsd === 0.0005);
t('визначення версії для назв вузлів', d1.version.definition.nodes.find((n: any) => n.id === 'llm').label === 'Model (Модель)' && d1.version.environment === 'production');
const list = await call('GET', '?workflowId=score_flow&status=succeeded', 'u-admin');
t('журнал із фільтрами процесу й стану', list.body.runs.length === 1 && list.body.runs[0].id === started.body.run.id && (await call('GET', '?status=failed', 'u-admin')).body.runs.length === 0);
t('чужий / неіснуючий запуск — 404', (await call('GET', '/00000000-0000-4000-8000-000000000000', 'u-admin')).status === 404);

console.log('\nПауза, продовження, скасування, повтор, відгалуження (§31):');
pauseNext = true;
const s2 = await call('POST', '', 'u-admin', { workflowId: 'score_flow', input: { text: 'пауза' } });
const d2 = await settle(s2.body.run.id, ['paused']);
t('пауза перед перевіркою', d2.run.status === 'paused' && d2.run.currentNode === 'check');
t('пауза запуску, що не виконується, — 409', (await call('POST', `/${s2.body.run.id}/pause`, 'u-admin')).status === 409);
t('без права — 403', (await call('POST', `/${s2.body.run.id}/resume`, 'u-writer')).status === 403);
const callsBefore = calls;
const res2 = await call('POST', `/${s2.body.run.id}/resume`, 'u-admin');
const d2b = await settle(s2.body.run.id, ['succeeded', 'failed']);
t('продовжено з контрольної точки — без нового виклику моделі', res2.status === 202 && d2b.run.status === 'succeeded' && calls === callsBefore);
pauseNext = true;
const s3 = await call('POST', '', 'u-admin', { workflowId: 'score_flow', input: { text: 'скасувати' } });
await settle(s3.body.run.id, ['paused']);
const c3 = await call('POST', `/${s3.body.run.id}/cancel`, 'u-admin');
t('скасування призупиненого', c3.status === 200 && c3.body.run.status === 'cancelled');
const rp = await call('POST', `/${started.body.run.id}/replay`, 'u-admin');
const drp = await settle(rp.body.run.id, ['succeeded', 'failed']);
t('повтор — новий запуск із батьком, той самий вхід', rp.status === 202 && drp.run.mode === 'replay' && drp.parent.id === started.body.run.id && drp.run.inputHash === d1.run.inputHash && drp.run.status === 'succeeded');
const callsFork = calls;
const fk = await call('POST', `/${started.body.run.id}/fork`, 'u-admin', { afterStep: 3 });
const dfk = await settle(fk.body.run.id, ['succeeded', 'failed']);
t('відгалуження після кроку 3 — без моделі, з перевірки', fk.status === 202 && dfk.run.mode === 'fork' && dfk.run.forkStep === 3 && dfk.steps[0].nodeId === 'check' && calls === callsFork);
t('відгалуження від неіснуючого кроку — 409', (await call('POST', `/${started.body.run.id}/fork`, 'u-admin', { afterStep: 42 })).status === 409);
const parent = await call('GET', `/${started.body.run.id}`, 'u-admin');
t('у батьківського — похідні запуски', parent.body.children.length === 2);

server.close();
resetActiveRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
