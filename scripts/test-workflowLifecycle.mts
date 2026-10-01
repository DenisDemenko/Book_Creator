/**
 * Процеси ШІ: версії, середовища, право публікації (Т5.2 В2,
 * `PLAN_GRAPH_STUDIO.md`; ТЗ Graph Studio §34, §37, §38, №7, 27, 28).
 * Запуск: npm run test:workflow-lifecycle (з CORE_TEST_DATABASE_URL — ще й
 * на PostgreSQL; схема ядра в цій базі видаляється — лише тестова база!).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = path.join(os.tmpdir(), 'nova-workflow-lifecycle');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;

const { createCorePool } = await import('../server/core/index.ts');
const { PgCoreRepository } = await import('../server/core/pgRepository.ts');
const { MemoryCoreRepository } = await import('../server/core/memoryRepository.ts');
const { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } = await import('../server/core/migrate.ts');
const L = await import('../server/core/workflows/lifecycle.ts');
const { registerWorkflowRoutes } = await import('../server/core/workflows/routes.ts');
const { registerOntologyRoutes } = await import('../server/core/ontology/routes.ts');
const { resetActiveRegistry, bootstrapOntology } = await import('../server/core/ontology/lifecycle.ts');
const { requireAdmin, requireGraphStudio, requireSchemaPublisher, requireAuth } = await import('../server/auth.ts');
const { initStore, setRoleOverride } = await import('../server/store.ts');
const { samplePipeline, defaultParams } = await import('../src/utils/workflowGraph.ts');
type CoreRepository = import('../server/core/types.ts').CoreRepository;

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const rejects = async (p: Promise<unknown>, code?: string) => {
  try { await p; return false; } catch (e: any) { return !code || e?.code === code; }
};
const ADMIN = 'user:u-admin' as const;

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<any>) {
  console.log(`\n${name} — версії й середовища:`);
  const { workflow, draft } = await L.createWorkflow(repo, { id: 'canon_pipeline', name: { en: 'Canon pipeline', uk: 'Конвеєр канону' }, template: 'sample', actor: ADMIN });
  t('новий процес — чернетка v1 зі зразка §5.1', workflow.id === 'canon_pipeline' && draft.environment === 'draft' && draft.version === 1 && (draft.definition as any).nodes.length === samplePipeline().nodes.length);
  t('повторний id — 409', await rejects(L.createWorkflow(repo, { id: 'canon_pipeline', name: { en: 'X', uk: 'Х' }, actor: ADMIN }), 'conflict'));
  t('назва лише англійською — 422', await rejects(L.createWorkflow(repo, { id: 'only_en', name: { en: 'X', uk: '' }, actor: ADMIN }), 'bad_input'));
  t('AI не створює процесів', await rejects(L.createWorkflow(repo, { id: 'ai_made', name: { en: 'X', uk: 'Х' }, actor: 'ai:AI-1' as any }), 'bad_actor'));

  t('у тест без перевірки — 409', await rejects(L.promoteToTest(repo, 'canon_pipeline', draft.id, ADMIN), 'conflict'));
  const val = await L.validateVersion(repo, 'canon_pipeline', draft.id, ADMIN);
  t('перевірка зразка — без помилок, з хешем', val.validation.ok && val.validation.hash === draft.definitionHash);
  const tested = await L.promoteToTest(repo, 'canon_pipeline', draft.id, ADMIN);
  t('чернетка → тест (заморожена)', tested.environment === 'test' && !!tested.testedAt);
  t('тестову версію правити не можна (§38)', await rejects(L.saveDraft(repo, { workflowId: 'canon_pipeline', versionId: draft.id, definition: samplePipeline(), actor: ADMIN }), 'conflict'));
  const prod1 = await L.publishVersion(repo, 'canon_pipeline', draft.id, ADMIN);
  t('тест → робоче (PUBLISH TO PRODUCTION)', prod1.environment === 'production' && !!prod1.publishedAt);

  // Нова чернетка з робочої: правка не змінює робочого.
  const d2 = await L.ensureDraft(repo, 'canon_pipeline', ADMIN);
  t('нова чернетка — v2 на основі робочої', d2.version === 2 && d2.basedOn === prod1.id && d2.environment === 'draft');
  t('друга чернетка не відкривається — та сама', (await L.ensureDraft(repo, 'canon_pipeline', ADMIN)).id === d2.id);
  const def2: any = JSON.parse(JSON.stringify(d2.definition));
  def2.nodes.find((n: any) => n.id === 'extract').params.temperature = 0.1;
  const saved = await L.saveDraft(repo, { workflowId: 'canon_pipeline', versionId: d2.id, definition: def2, layout: { start: { x: 10, y: 20 }, extract: { x: 300, y: 20 } }, expectedRevision: d2.revision, actor: ADMIN });
  t('збережено: інший хеш, перевірка скинута', saved.definitionHash !== prod1.definitionHash && saved.validation === null);
  const prodNow = await repo.getWorkflowVersion(prod1.id);
  t('робоча версія не змінилась (§38)', (prodNow!.definition as any).nodes.find((n: any) => n.id === 'extract').params.temperature === 0.4 && prodNow!.environment === 'production');
  const def3: any = JSON.parse(JSON.stringify(def2)); def3.nodes.find((n: any) => n.id === 'extract').params.temperature = 0.3;
  t('стара ревізія при зміні — 409', await rejects(L.saveDraft(repo, { workflowId: 'canon_pipeline', versionId: d2.id, definition: def3, expectedRevision: d2.revision, actor: ADMIN }), 'conflict'));

  // №28: розкладка не змінює семантики.
  const hashBefore = (await repo.getWorkflowVersion(d2.id))!.definitionHash;
  await L.saveDraft(repo, { workflowId: 'canon_pipeline', versionId: d2.id, definition: def2, layout: { start: { x: 999, y: 999 } }, actor: ADMIN });
  const after = (await repo.getWorkflowVersion(d2.id))!;
  t('лише нова розкладка — хеш і ревізія ті самі (№28)', after.definitionHash === hashBefore && after.revision === saved.revision);
  t('розкладка збережена окремо', (await L.getLayout(repo, 'workflow', 'canon_pipeline', d2.id)).start?.x === 999);
  await L.saveVersionLayout(repo, 'canon_pipeline', prod1.id, { start: { x: 5, y: 5 } }, ADMIN);
  t('розкладку можна змінити й робочій версії — визначення недоторкане', (await L.getLayout(repo, 'workflow', 'canon_pipeline', prod1.id)).start?.x === 5 && (await repo.getWorkflowVersion(prod1.id))!.definitionHash === prod1.definitionHash);

  // Невалідна чернетка не йде в тест.
  const bad: any = JSON.parse(JSON.stringify(def2)); bad.nodes.find((n: any) => n.id === 'extract').params.temperature = 9;
  const savedBad = await L.saveDraft(repo, { workflowId: 'canon_pipeline', versionId: d2.id, definition: bad, actor: ADMIN });
  const vb = await L.validateVersion(repo, 'canon_pipeline', d2.id, ADMIN);
  t('невалідна чернетка: перевірка з помилкою на вузлі', !vb.validation.ok && vb.validation.errors.some((e) => e.nodeId === 'extract'));
  t('…у тест не йде', await rejects(L.promoteToTest(repo, 'canon_pipeline', savedBad.id, ADMIN), 'conflict'));
  await L.saveDraft(repo, { workflowId: 'canon_pipeline', versionId: d2.id, definition: def2, actor: ADMIN });
  await L.validateVersion(repo, 'canon_pipeline', d2.id, ADMIN);
  await L.promoteToTest(repo, 'canon_pipeline', d2.id, ADMIN);
  const prod2 = await L.publishVersion(repo, 'canon_pipeline', d2.id, ADMIN);
  const v1 = await repo.getWorkflowVersion(prod1.id);
  t('публікація v2: v1 — в архів, робоча одна', prod2.environment === 'production' && v1!.environment === 'archived');

  // №27: відкат.
  const rb = await L.rollbackTo(repo, 'canon_pipeline', prod1.id, ADMIN);
  t('відкат до v1 — нова версія v3, робоча, з визначенням v1', rb.version === 3 && rb.environment === 'production' && rb.definitionHash === prod1.definitionHash && rb.basedOn === prod1.id);
  t('…v2 — в архів', (await repo.getWorkflowVersion(prod2.id))!.environment === 'archived');
  t('…розкладка v1 перенесена', (await L.getLayout(repo, 'workflow', 'canon_pipeline', rb.id)).start?.x === 5);
  t('відкат до версії, що не була робочою, — 409', await rejects(L.rollbackTo(repo, 'canon_pipeline', (await L.ensureDraft(repo, 'canon_pipeline', ADMIN)).id, ADMIN), 'conflict'));
  t('до чинної робочої — 409', await rejects(L.rollbackTo(repo, 'canon_pipeline', rb.id, ADMIN), 'conflict'));
  const d4 = await L.ensureDraft(repo, 'canon_pipeline', ADMIN);
  const disc = await L.archiveVersion(repo, 'canon_pipeline', d4.id, ADMIN);
  t('чернетку можна відкинути (в архів)', disc.environment === 'archived');
  t('робочу не можна архівувати напряму', await rejects(L.archiveVersion(repo, 'canon_pipeline', rb.id, ADMIN), 'conflict'));

  // Підграфи — лише опубліковані процеси.
  const { draft: sd } = await L.createWorkflow(repo, { id: 'with_sub', name: { en: 'With subgraph', uk: 'З підграфом' }, actor: ADMIN });
  const subDef: any = JSON.parse(JSON.stringify(sd.definition));
  subDef.nodes.splice(1, 0, { id: 'sub', type: 'SUBGRAPH', params: { workflow_id: 'missing_flow' } });
  subDef.edges = [{ id: 'e1', from: 'start', fromPort: 'out', to: 'sub' }, { id: 'e2', from: 'sub', fromPort: 'out', to: 'end' }];
  await L.saveDraft(repo, { workflowId: 'with_sub', versionId: sd.id, definition: subDef, actor: ADMIN });
  t('підграф неіснуючого процесу — помилка перевірки', (await L.validateVersion(repo, 'with_sub', sd.id, ADMIN)).validation.errors.some((e) => e.code === 'unknown_subgraph'));
  subDef.nodes[1].params.workflow_id = 'canon_pipeline';
  await L.saveDraft(repo, { workflowId: 'with_sub', versionId: sd.id, definition: subDef, actor: ADMIN });
  t('підграф опублікованого процесу — без помилок', (await L.validateVersion(repo, 'with_sub', sd.id, ADMIN)).validation.ok);

  const list = await L.listWorkflowSummaries(repo);
  const cp = list.find((x) => x.workflow.id === 'canon_pipeline')!;
  t('перелік: робоча v3, без тестової й чернетки, 4 версії', cp.production?.version === 3 && !cp.test && !cp.draft && cp.versions === 4, JSON.stringify({ p: cp.production?.version, v: cp.versions }));
  const ev = (await repo.listWorkflowEvents({ workflowId: 'canon_pipeline' })).map((e) => e.action);
  t('журнал: створення, правки, перевірки, тест, публікації, відкат, відкинута чернетка', ['create', 'edit', 'validate', 'to_test', 'publish', 'rollback', 'create_draft', 'discard'].every((a) => ev.includes(a as any)));

  if (raw) {
    console.log(`\n${name} — обмеження бази:`);
    const prodId = rb.id;
    t('визначення робочої версії SQL-ем не змінити (тригер)', await raw(`UPDATE fusion_core.workflow_versions SET definition = '{"x":1}' WHERE id = $1`, [prodId]).then(() => false, () => true));
    t('дві робочі версії — унікальний індекс', await raw(`UPDATE fusion_core.workflow_versions SET environment = 'production', tested_at = now(), published_at = now() WHERE workflow_id = 'canon_pipeline' AND id <> $1 AND environment = 'archived'`, [prodId]).then(() => false, () => true));
    t('архівна не повертається', await raw(`UPDATE fusion_core.workflow_versions SET environment = 'test' WHERE id = $1`, [prod1.id]).then(() => false, () => true));
    t('процес від AI — CHECK', await raw(`INSERT INTO fusion_core.workflows (id, name, created_by) VALUES ('ai_flow', '{"en":"a","uk":"а"}', 'ai:AI-1')`).then(() => false, () => true));
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
    t('схема ядра — v22 (процеси ШІ)', Number(rows[0].v) >= 22, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('процеси на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}

// ── API і право PUBLISH_SCHEMA ───────────────────────────────────────────────
console.log('\nAPI і право публікації (PUBLISH_SCHEMA):');
await initStore();
await setRoleOverride('publisher', { canPublishSchema: true });
const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
const app = express();
app.use(express.json());
const ROLES: Record<string, string> = { 'u-admin': 'admin', 'u-writer': 'writer', 'u-pub': 'publisher' };
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = ROLES[id] ? { id, role: ROLES[id], isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
registerWorkflowRoutes(app, { repo: () => repo, requireStudio: requireGraphStudio as any, requireAdmin, requirePublish: requireSchemaPublisher as any });
registerOntologyRoutes(app, { repo: () => repo, requireAuth, requireAdmin, requirePublish: requireSchemaPublisher as any, requireStudio: requireGraphStudio as any });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
{
  t('гість — 401', (await call('GET', '/api/core/workflows', '')).status === 401);
  t('автор без права — 403', (await call('GET', '/api/core/workflows', 'u-writer')).status === 403);
  t('видавець із правом публікації (перевизначення ролі) — бачить Graph Studio', (await call('GET', '/api/core/workflows', 'u-pub')).status === 200);
  const created = await call('POST', '/api/core/workflows', 'u-admin', { id: 'ai1_mentions', name: { en: 'AI-1 mentions', uk: 'AI-1 згадки' }, template: 'empty' });
  t('адмін створює процес — 201', created.status === 201 && created.body.draft.environment === 'draft');
  t('видавець не править чернетки — 403', (await call('POST', '/api/core/workflows', 'u-pub', { id: 'x_flow', name: { en: 'X', uk: 'Х' } })).status === 403);
  const vid = created.body.draft.id;
  const def = created.body.draft.definition;
  def.nodes.splice(1, 0, { id: 'llm', type: 'LLM', label: 'Mentions (Згадки)', params: defaultParams('LLM') });
  def.edges = [{ id: 'e1', from: 'start', fromPort: 'out', to: 'llm' }, { id: 'e2', from: 'llm', fromPort: 'out', to: 'end' }];
  const put = await call('PUT', `/api/core/workflows/ai1_mentions/versions/${vid}`, 'u-admin', { definition: { ...def, id: 'hijack' }, layout: { llm: { x: 200, y: 0 }, ghost: { x: 1, y: 1 } } });
  t('збереження: id процесу береться з адреси, розкладка — лише наявні вузли', put.status === 200 && put.body.version.definition.id === 'ai1_mentions' && put.body.layout.llm?.x === 200 && !put.body.layout.ghost);
  t('перевірка через API', (await call('POST', `/api/core/workflows/ai1_mentions/versions/${vid}/validate`, 'u-admin')).body.validation?.ok === true);
  t('у тест', (await call('POST', `/api/core/workflows/ai1_mentions/versions/${vid}/test`, 'u-admin')).body.version?.environment === 'test');
  t('автор не публікує — 403', (await call('POST', `/api/core/workflows/ai1_mentions/versions/${vid}/publish`, 'u-writer')).status === 403);
  const pub = await call('POST', `/api/core/workflows/ai1_mentions/versions/${vid}/publish`, 'u-pub');
  t('видавець із правом публікує (не будучи адміном)', pub.status === 200 && pub.body.version.environment === 'production' && pub.body.version.publishedBy === 'user:u-pub');
  const ev = await call('GET', '/api/core/workflows/ai1_mentions/events', 'u-pub');
  t('журнал: хто опублікував', ev.body.events.some((e: any) => e.action === 'publish' && e.actor === 'user:u-pub'));
  await setRoleOverride('publisher', { canPublishSchema: false });
  t('право забрано — видавець більше не бачить Graph Studio', (await call('GET', '/api/core/workflows', 'u-pub')).status === 403);

  // Онтологія: публікація — за тим самим правом.
  const dr = await call('POST', '/api/core/ontology/drafts', 'u-admin', {});
  const ovid = dr.body.version?.id;
  await call('PATCH', `/api/core/ontology/drafts/${ovid}`, 'u-admin', { ops: [{ op: 'set_name', name: { en: 'Fusion Story Ontology (T5.2)', uk: 'Онтологія твору Fusion (Т5.2)' } }] });
  await call('POST', `/api/core/ontology/drafts/${ovid}/validate`, 'u-admin');
  await call('POST', `/api/core/ontology/drafts/${ovid}/impact`, 'u-admin');
  t('онтологію без права не опублікувати — 403', (await call('POST', `/api/core/ontology/drafts/${ovid}/publish`, 'u-pub')).status === 403);
  await setRoleOverride('publisher', { canPublishSchema: true });
  const op = await call('POST', `/api/core/ontology/drafts/${ovid}/publish`, 'u-pub');
  t('онтологію публікує роль із правом PUBLISH_SCHEMA', op.status === 200 && op.body.version?.status === 'active', `${op.status} ${op.body.error ?? ''}`);
  t('…але чернетку онтології править лише адмін', (await call('POST', '/api/core/ontology/drafts', 'u-pub', {})).status === 403);
  const lay = await call('PUT', '/api/core/ontology/layout', 'u-admin', { layout: { character: { x: 10.6, y: -4 }, bad: { x: 'a' } } });
  t('розкладка онтології — окремо, чиста', lay.status === 200 && lay.body.layout.character?.x === 11 && !lay.body.layout.bad && (await call('GET', '/api/core/ontology/layout', 'u-pub')).body.layout.character?.y === -4);
}
server.close();

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
