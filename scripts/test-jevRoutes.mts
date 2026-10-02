/**
 * Реєстр напрямків і запуски з рішеннями Jev — API Graph Studio (Т5.5 В2,
 * `PLAN_JEV_NODES.md`; ТЗ Graph Studio §10, §27, №10, 24; рішення власника
 * §2 п.2). Сховище ядра в пам'яті, підставний Jev, express на випадковому порту.
 * Запуск: npm run test:jev-routes
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { bootstrapOntology, resetActiveRegistry } from '../server/core/ontology/lifecycle.ts';
import { createWorkflow, saveDraft, validateVersion, promoteToTest, publishVersion } from '../server/core/workflows/lifecycle.ts';
import { registerDestinationRoutes } from '../server/core/workflows/destinationRoutes.ts';
import { registerWorkflowRunRoutes } from '../server/core/workflows/runRoutes.ts';
import { MockJevAdapter } from '../server/ai/adapters/jev/index.ts';
import type { EngineDeps } from '../server/core/workflows/engine/runner.ts';
import { defaultParams, type WorkflowDefinition, type WorkflowNode } from '../src/utils/workflowGraph.ts';

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
const actor = 'user:u-admin' as const;
const e = (from: string, port: string, to: string) => ({ id: `e-${from}-${port}-${to}`, from, fromPort: port, to });
const node = (id: string, type: string, params: Record<string, unknown> = {}): WorkflowNode => ({ id, type, params: { ...defaultParams(type), ...params } });
async function publish(def: WorkflowDefinition) {
  const { draft } = await createWorkflow(repo, { id: def.id, name: def.name, actor });
  await saveDraft(repo, { workflowId: def.id, versionId: draft.id, definition: def, actor });
  const v = await validateVersion(repo, def.id, draft.id, actor);
  if (!v.validation.ok) throw new Error(JSON.stringify(v.validation.errors));
  await promoteToTest(repo, def.id, draft.id, actor);
  await publishVersion(repo, def.id, draft.id, actor);
}
const wf = (id: string, nodes: WorkflowNode[], edges: ReturnType<typeof e>[]): WorkflowDefinition => ({ format: 'fusion-workflow/1', id, name: { en: id, uk: id }, description: '', nodes, edges });
const agent = (id: string) => wf(id, [node('start', 'START'), node('end', 'END')], [e('start', 'out', 'end')]);
await publish(agent('character_agent'));
await publish(agent('scene_agent'));
await createWorkflow(repo, { id: 'draft_agent', name: { en: 'D', uk: 'Ч' }, actor });
await publish(wf('router_flow', [node('start', 'START'), node('route', 'JEV_ROUTER', { question: 'Хто відповість на «{{input.q}}»?', registry: 'story_agents' }), node('end', 'END'), node('nobody', 'END')], [e('start', 'out', 'route'), e('route', 'out', 'end'), e('route', 'fallback', 'nobody')]));

const engine: EngineDeps = {
  repo,
  services: {
    generate: async () => { throw new Error('LLM не потрібна'); },
    resolveModel: async () => 'm',
    sleep: async () => {},
    jev: async () => new MockJevAdapter(),
  },
};
const ROLE: Record<string, string> = { 'u-admin': 'admin', 'u-pub': 'publisher', 'u-writer': 'writer' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLE[id] ?? 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
const studio = (req: any, res: any, next: any) => (req.principal?.isGuest ? res.status(401).json({ error: 'auth' }) : ['admin', 'publisher'].includes(req.principal.role) ? next() : res.status(403).json({ error: 'forbidden' }));
const publisher = studio;
registerDestinationRoutes(app, { repo: () => repo, requireStudio: studio, requirePublish: publisher });
registerWorkflowRunRoutes(app, { repo: () => repo, engine: () => engine, requireStudio: studio, requireControl: publisher });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const D = '/api/core/workflow-destinations';

console.log('\nДоступ (§2 п.2):');
t('гість — 401, без Graph Studio — 403', (await call('GET', D, '')).status === 401 && (await call('GET', D, 'u-writer')).status === 403);
t('порожній реєстр; маршрутизатори реєстрів — з робочих версій', await (async () => {
  const r = await call('GET', D, 'u-admin');
  return r.status === 200 && r.body.destinations.length === 0 && r.body.routers.story_agents?.[0]?.workflowId === 'router_flow' && r.body.workflows.some((w: any) => w.id === 'draft_agent' && w.published === null);
})());

console.log('\nНапрямки (§10, №10):');
const put = (who: string, option: string, body: Record<string, unknown>) => call('PUT', `${D}/story_agents/${option}`, who, body);
let r = await put('u-pub', 'character', { label: { en: 'Character agent', uk: 'Агент персонажа' }, description: 'Питання про героя', workflowId: 'character_agent' });
t('право публікації схем — додає напрямок (увімкнено типово)', r.status === 200 && r.body.destination.enabled === true && r.body.destination.published === 1 && r.body.destination.updatedBy === 'user:u-pub' && !r.body.warning);
r = await put('u-writer', 'scene', { label: { en: 'S', uk: 'С' }, workflowId: 'scene_agent' });
t('без права — 403', r.status === 403);
r = await put('u-admin', 'scene', { label: { en: 'Scene agent', uk: 'Агент сцени' }, description: 'Питання про сцену', workflowId: 'scene_agent' });
t('другий напрямок', r.status === 200);
r = await put('u-admin', 'drafty', { label: { en: 'Draft', uk: 'Чернетка' }, workflowId: 'draft_agent' });
t('процес без робочої версії — збережено з попередженням', r.status === 200 && /робочої версії/.test(r.body.warning ?? '') && r.body.destination.published === null);
t('неіснуючий процес — 404; поганий id чи без назви — 422', (await put('u-admin', 'ghost', { label: { en: 'G', uk: 'Г' }, workflowId: 'ghost_flow' })).status === 404
  && (await call('PUT', `${D}/Bad Registry/x`, 'u-admin', { label: { en: 'a', uk: 'б' }, workflowId: 'scene_agent' })).status === 422
  && (await put('u-admin', 'nolabel', { label: { en: '', uk: 'б' }, workflowId: 'scene_agent' })).status === 422);
r = await call('GET', `${D}?registry=story_agents`, 'u-pub');
t('список реєстру з позначкою робочої версії', r.body.destinations.map((d: any) => `${d.option}:${d.published ?? '-'}`).join() === 'character:1,drafty:-,scene:1');

console.log('\nМаршрутизатор у запуску й трасування (№10, №24):');
r = await call('POST', '/api/core/workflow-runs', 'u-admin', { workflowId: 'router_flow', input: { q: 'хто Марк?' } });
const settle = async (id: string) => {
  for (let i = 0; i < 100; i++) {
    const x = await call('GET', `/api/core/workflow-runs/${id}`, 'u-admin');
    if (['succeeded', 'failed'].includes(x.body.run?.status)) return x.body;
    await sleep(20);
  }
  return (await call('GET', `/api/core/workflow-runs/${id}`, 'u-admin')).body;
};
const d1 = await settle(r.body.run.id);
const step = d1.steps.find((s: any) => s.nodeId === 'route');
t('варіанти — лише напрямки з робочою версією', d1.run.status === 'succeeded' && Object.keys(step.details.questions[0].options).sort().join() === 'character,scene', d1.run.error ?? '');
t('у кроці — джерело, розподіл і підпроцес', step.details.source === 'mock' && Object.keys(step.details.answers.choice.distribution).length === 2 && ['character_agent', 'scene_agent'].includes(step.details.subgraph?.workflowId));
t('підпроцес — у похідних запусках батька, з процесом і режимом', d1.children.length === 1 && d1.children[0].mode === 'subgraph' && d1.children[0].workflowId === step.details.subgraph.workflowId);
const child = await call('GET', `/api/core/workflow-runs/${d1.children[0].id}`, 'u-admin');
t('у підпроцесу — батько з процесом', child.body.run.mode === 'subgraph' && child.body.parent.id === d1.run.id && child.body.parent.workflowId === 'router_flow');
await put('u-admin', 'scene', { label: { en: 'Scene agent', uk: 'Агент сцени' }, description: 'Питання про сцену', workflowId: 'scene_agent', enabled: false });
await put('u-admin', 'character', { label: { en: 'Character agent', uk: 'Агент персонажа' }, description: 'Питання про героя', workflowId: 'character_agent', enabled: false });
r = await call('POST', '/api/core/workflow-runs', 'u-admin', { workflowId: 'router_flow', input: { q: 'x' } });
const d2 = await settle(r.body.run.id);
t('усі напрямки вимкнено — резервний маршрут', d2.steps.find((s: any) => s.nodeId === 'route').branch === 'fallback' && d2.steps.at(-1).nodeId === 'nobody');

console.log('\nВилучення:');
t('вилучити — 200, повторно — 404, без права — 403', (await call('DELETE', `${D}/story_agents/drafty`, 'u-writer')).status === 403 && (await call('DELETE', `${D}/story_agents/drafty`, 'u-admin')).status === 200 && (await call('DELETE', `${D}/story_agents/drafty`, 'u-admin')).status === 404);

server.close();
resetActiveRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
