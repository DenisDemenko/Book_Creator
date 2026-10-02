/**
 * Story Core API (Т5.3 В2, `PLAN_STORY_CORE.md`; ТЗ Graph Studio §33, §37,
 * №13, 18): реєстр операцій, права (читання, пропозиції, CANON_WRITE,
 * PUBLISH_SCHEMA), внутрішній виклик для процесів і HTTP для Graph Studio.
 * Сховище в пам'яті, express на випадковому порту. Запуск: npm run test:story-core-api
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = path.join(os.tmpdir(), 'nova-story-core-api');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;

const { MemoryCoreRepository } = await import('../server/core/memoryRepository.ts');
const { makeEffectiveResolver, grantAccess } = await import('../server/core/collaboration/access.ts');
const { assignRole } = await import('../server/core/collaboration/participants.ts');
const { resetActiveRegistry, bootstrapOntology, createDraft, editDraft, validateDraft, impactDraft } = await import('../server/core/ontology/lifecycle.ts');
const { STORY_CORE_OPS, SPEC_OPS, callStoryCore, StoryCoreForbidden } = await import('../server/core/storyCore/api.ts');
const { registerStoryCoreRoutes } = await import('../server/core/storyCore/routes.ts');
const { requireAuth, can } = await import('../server/auth.ts');
const { initStore, setRoleOverride } = await import('../server/store.ts');
type RealtimeAccessDeps = import('../server/realtimeAuth.ts').RealtimeAccessDeps;

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const errOf = async (f: () => Promise<unknown>): Promise<any> => {
  try { await f(); return null; } catch (e) { return e; }
};

const P = 'BK-STORY-CORE';
const P2 = 'BK-OTHER';
const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);
await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' });
await repo.upsertProject({ id: P2, ownerId: 'u-else', title: 'Інша книга' });
await repo.upsertDocument({ projectId: P, id: 'ch-1', kind: 'chapter', order: 0, title: 'Глава 1' });
await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', parentId: 'ch-1', order: 0, title: 'Сцена' });
await repo.upsertParagraph({ projectId: P, id: 'p1', documentId: 'sec-1', order: 0, kind: 'paragraph', text: 'Олена побачила маяк над портом.' }, 'user:u-owner');
await repo.upsertParagraph({ projectId: P, id: 'p2', documentId: 'sec-1', order: 1, kind: 'paragraph', text: 'Маяк згас, і Олена рушила до порту.' }, 'user:u-owner');
const olena = await repo.createEntity({ projectId: P, type: 'character', name: 'Олена', createdBy: 'system:core_sync' });
const port = await repo.createEntity({ projectId: P, type: 'location', name: 'Порт', createdBy: 'system:core_sync' });
const light = await repo.createEntity({ projectId: P, type: 'event', name: 'Маяк згас', createdBy: 'system:core_sync' });
await repo.createRelation({ projectId: P, type: 'participates_in', fromId: olena.id, toId: light.id, evidence: ['p2'], createdBy: 'user:u-owner' });
const aiRel = await repo.createRelation({ projectId: P, type: 'contains', fromId: port.id, toId: light.id, evidence: ['p1'], createdBy: 'ai:AI-1' });
await repo.addFinding({ projectId: P, entityId: olena.id, kind: 'relation_suggestion', payload: { relationType: 'opposes', targetEntityId: port.id, entityName: 'Олена', targetEntityName: 'Порт' }, sourceParagraphIds: ['p1'], createdBy: 'ai:AI-1' });
await repo.addFinding({ projectId: P, entityId: olena.id, kind: 'mention_suggestion', payload: { entityType: 'character', entityName: 'Олена' }, sourceParagraphIds: ['p2'], visibility: 'author', createdBy: 'ai:AI-1' });

for (const uid of ['u-editor', 'u-approver', 'u-viewer', 'u-limited']) {
  await assignRole(repo, { projectId: P, userId: uid, roleId: 'translator', actor: 'user:u-owner', source: 'manual' });
}
const owner = { userId: 'u-owner', isOwner: true, isAdmin: false };
await grantAccess(repo, { projectId: P, granter: owner, userId: 'u-editor', level: 'edit', scopeType: 'book' });
await grantAccess(repo, { projectId: P, granter: owner, userId: 'u-approver', level: 'approve', scopeType: 'book' });
await grantAccess(repo, { projectId: P, granter: owner, userId: 'u-viewer', level: 'view', scopeType: 'book' });
await grantAccess(repo, { projectId: P, granter: owner, userId: 'u-limited', level: 'view', scopeType: 'character', scopeRef: olena.id });

console.log('\nРеєстр операцій §33 (№13):');
const ids = STORY_CORE_OPS.map((o) => o.id);
t('усі 16 операцій ТЗ §33 є в реєстрі', SPEC_OPS.every((id) => ids.includes(id)), SPEC_OPS.filter((id) => !ids.includes(id)).join());
t('кожна з назвою en/uk і видом права', STORY_CORE_OPS.every((o) => o.name.en && o.name.uk && ['read', 'propose', 'decide', 'schema'].includes(o.kind)));
t('рішення — approve / reject / write_canon; схема — publish / rollback', ['approve_proposal', 'reject_proposal', 'write_canon'].every((id) => STORY_CORE_OPS.find((o) => o.id === id)?.kind === 'decide') && ['publish_schema', 'rollback_schema'].every((id) => STORY_CORE_OPS.find((o) => o.id === id)?.kind === 'schema'));

console.log('\nВнутрішній виклик (процеси ШІ, Т5.4):');
{
  const aiCtx = { repo, actor: 'ai:AI-1', projectId: P, rights: { read: true, propose: true, approve: true, publishSchema: true } };
  const g = (await callStoryCore('get_relations', aiCtx, { entityId: olena.id })) as any;
  t('вузол QUERY читає зв\'язки ядра через API', g.relations.length === 1 && g.relations[0].type === 'participates_in');
  const made = (await callStoryCore('create_relation_proposal', aiCtx, { type: 'opposes', fromId: olena.id, toId: port.id, evidence: ['p1'], confidence: 0.7, provenance: { workflowId: 'canon_pipeline', workflowVersion: 2, nodeId: 'proposal' } })) as any;
  t('AI створює пропозицію (одразу перевірену системою)', made.proposal.state === 'validated' && made.proposal.createdBy === 'ai:AI-1' && made.proposal.provenance.source === 'workflow', JSON.stringify(made.proposal.validation?.errors));
  const ap = await errOf(() => callStoryCore('approve_proposal', aiCtx, { proposalId: made.proposal.id }));
  t('AI не схвалює навіть із правом (§24)', ap instanceof StoryCoreForbidden && ap.permission === 'decide');
  t('AI не публікує схем (§37)', (await errOf(() => callStoryCore('publish_schema', aiCtx, { draftId: 'x' }))) instanceof StoryCoreForbidden);
  t('без права читання — заборонено', (await errOf(() => callStoryCore('get_entity', { ...aiCtx, rights: { read: false, propose: false, approve: false, publishSchema: false } }, { entityId: olena.id }))) instanceof StoryCoreForbidden);
  t('невідома операція — not_found (довільного SQL немає)', (await errOf(() => callStoryCore('raw_sql', aiCtx, { sql: 'DROP TABLE entities' })))?.code === 'not_found');
  t('операція над книгою без книги — bad_input', (await errOf(() => callStoryCore('get_entity', { ...aiCtx, projectId: null }, { entityId: olena.id })))?.code === 'bad_input');
  const dry = (await callStoryCore('validate_relation', aiCtx, { type: 'opposes', fromId: olena.id, toId: olena.id })) as any;
  t('суха перевірка змісту без пропозиції', dry.validation.ok === false && dry.validation.errors.some((e: any) => e.code === 'self_relation') && !dry.proposal);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
await initStore();
await setRoleOverride('publisher', { canPublishSchema: true });
const access: RealtimeAccessDeps = {
  async getBookOwnerId(id) { return id === P ? 'u-owner' : id === P2 ? 'u-else' : null; },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites() { return []; },
  effectiveAccess: makeEffectiveResolver(() => repo, () => 'ready'),
};
const ROLES: Record<string, string> = { 'u-admin': 'admin', 'u-pub': 'publisher' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLES[id] ?? 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
registerStoryCoreRoutes(app, { repo: () => repo, access, requireAuth, canPublishSchema: async (req) => can((req as any).principal?.role ?? 'guest', 'canPublishSchema') });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/core/story-core`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const op = (name: string, who: string, args: Record<string, unknown> = {}, projectId: string | undefined = P) => call('POST', `/call/${name}`, who, { projectId, args });

console.log('\nHTTP: доступ і перелік книг:');
{
  t('гість — 401', (await call('GET', '/ops', '')).status === 401 && (await call('GET', '/projects', '')).status === 401 && (await op('get_graph', '')).status === 401);
  const ops = await call('GET', '/ops', 'u-owner');
  t('реєстр операцій для Graph Studio', ops.status === 200 && ops.body.ops.length === STORY_CORE_OPS.length);
  t('автор без права — публікація схеми недоступна', ops.body.ops.find((o: any) => o.id === 'publish_schema')?.allowed === false);
  t('видавець із правом PUBLISH_SCHEMA — доступна', (await call('GET', '/ops', 'u-pub')).body.ops.find((o: any) => o.id === 'publish_schema')?.allowed === true);
  const adm = await call('GET', '/projects', 'u-admin');
  t('адмін бачить усі книги ядра', adm.body.projects.map((p: any) => p.id).sort().join() === [P, P2].sort().join());
  const own = await call('GET', '/projects', 'u-owner');
  t('власник — свою книгу з усіма правами', own.body.projects.length === 1 && own.body.projects[0].id === P && own.body.projects[0].rights.approve && own.body.projects[0].isOwner);
  t('…з лічильником відкритих пропозицій', own.body.projects[0].openProposals.validated === 1, JSON.stringify(own.body.projects[0].openProposals));
  const ed = (await call('GET', '/projects', 'u-editor')).body.projects;
  t('учасник із редагуванням — книгу, пропонує, але не схвалює', ed.length === 1 && ed[0].rights.propose && !ed[0].rights.approve);
  t('учасник із доступом «схвалення» — CANON_WRITE', (await call('GET', '/projects', 'u-approver')).body.projects[0]?.rights.approve === true);
  t('обмежений доступ (лише героїня) — книги в переліку немає', (await call('GET', '/projects', 'u-limited')).body.projects.length === 0);
  t('чужий — порожньо', (await call('GET', '/projects', 'u-stranger')).body.projects.length === 0);
}

console.log('\nHTTP: читання — граф із справжніх даних (№18):');
{
  const g = await op('get_graph', 'u-viewer');
  const nodeIds = new Set(g.body.result?.nodes.map((n: any) => n.id));
  t('граф: вузли — справжні сутності, ребра — справжні зв\'язки', g.status === 200 && [olena.id, port.id, light.id].every((id) => nodeIds.has(id)) && g.body.result.edges.some((e: any) => e.id === aiRel.id && e.status === 'suggested'));
  const lone = await repo.createEntity({ projectId: P, type: 'object', name: 'Ключ', createdBy: 'system:core_sync' });
  t('огляд — лише зв\'язні й згадувані; з isolated — і самотні сутності', !g.body.result.nodes.some((n: any) => n.id === lone.id) && (await op('get_graph', 'u-viewer', { isolated: true })).body.result.nodes.some((n: any) => n.id === lone.id));
  const only = await call('GET', `/call/get_graph?projectId=${P}&suggested=0`, 'u-viewer');
  t('фільтр: лише підтверджені (GET для читання)', only.status === 200 && only.body.result.edges.every((e: any) => e.status === 'confirmed'));
  t('GET для зміни — 405', (await call('GET', `/call/write_canon?projectId=${P}`, 'u-owner')).status === 405);
  t('обмежений учасник — 403', (await op('get_graph', 'u-limited')).status === 403);
  t('чужий — 403', (await op('get_graph', 'u-stranger')).status === 403);
  t('несинхронізована книга — 404', (await op('get_graph', 'u-admin', {}, 'BK-NOT-SYNCED')).status === 404);
  const se = await op('search_entities', 'u-viewer', { query: 'оле' });
  t('пошук сутностей', se.body.result?.entities.length === 1 && se.body.result.entities[0].id === olena.id);
  const ge = await op('get_entity', 'u-viewer', { entityId: olena.id });
  t('сутність із ревізіями', ge.status === 200 && ge.body.result.entity.name === 'Олена' && Array.isArray(ge.body.result.versions));
  const src = await op('get_sources', 'u-viewer', { paragraphIds: ['p1', 'p404'] });
  t('джерела — лише живі абзаци, з уривком', src.body.result?.sources.length === 1 && src.body.result.sources[0].excerpt.includes('маяк'));
  const sv = await op('get_schema_version', 'u-viewer', {}, undefined);
  t('версія схеми — без книги', sv.status === 200 && sv.body.result.version === 1);
  const sc = await op('get_schema', 'u-viewer', { compact: true }, undefined);
  t('схема (стисло): типи й зв\'язки активної онтології', sc.body.result?.entityTypes.length === 118 && sc.body.result.relationTypes.some((r: any) => r.id === 'opposes'));
  const lp = await op('list_proposals', 'u-viewer');
  t('пропозиції: новий реєстр + AI-1 поруч (зв\'язок і висновок)', lp.body.result?.proposals.length === 1 && lp.body.result.legacy.relations.some((r: any) => r.id === aiRel.id) && lp.body.result.legacy.suggestions.some((s: any) => s.kind === 'relation_suggestion'));
  t('висновок «лише автор» учаснику не видно', !lp.body.result.legacy.suggestions.some((s: any) => s.kind === 'mention_suggestion'));
  t('…а власнику видно', (await op('list_proposals', 'u-owner')).body.result.legacy.suggestions.some((s: any) => s.kind === 'mention_suggestion'));
}

console.log('\nHTTP: пропозиції й CANON_WRITE:');
{
  t('перегляд — не пропонує (403 propose)', (await op('create_entity_proposal', 'u-viewer', { type: 'location', name: 'Маяк' })).body.permission === 'propose');
  const cr = await op('create_entity_proposal', 'u-editor', { type: 'location', name: 'Маяк', evidence: ['p1'] });
  const pid = cr.body.result?.proposal?.id;
  t('редактор пропонує: перевірено, автор — він, джерело — author', cr.status === 200 && cr.body.result.proposal.state === 'validated' && cr.body.result.proposal.createdBy === 'user:u-editor' && cr.body.result.proposal.provenance.source === 'author');
  t('дубль — 409', (await op('create_entity_proposal', 'u-editor', { type: 'location', name: 'маяк' })).status === 409);
  t('суха перевірка: невідомий тип — помилка перевірки', (await op('validate_entity', 'u-editor', { type: 'dragon', name: 'X' })).body.result?.validation.errors[0].code === 'unknown_entity_type');
  t('редактор не схвалює (403 decide)', (await op('approve_proposal', 'u-editor', { proposalId: pid })).body.permission === 'decide');
  const ap = await op('approve_proposal', 'u-approver', { proposalId: pid, writeCanon: true, reason: 'так', edits: { payload: { canonical: { opys: 'Старий маяк над портом' } } } });
  t('схвалення з доступом «схвалення» + запис у канон', ap.status === 200 && ap.body.result.proposal.state === 'canon' && ap.body.result.canon.created === true, JSON.stringify(ap.body).slice(0, 300));
  const ent = await repo.getEntity(P, ap.body.result.canon.recordId);
  t('у каноні — підтверджена сутність від імені того, хто схвалив, з правкою', ent?.status === 'confirmed' && ent.createdBy === 'user:u-approver' && (ent.canonical as any).opys === 'Старий маяк над портом');
  const det = await op('get_proposal', 'u-viewer', { proposalId: pid });
  t('картка: журнал create → validate → edit → validate → approve → write_canon', det.body.result?.events.map((e: any) => e.action).join() === 'create,validate,edit,validate,approve,write_canon', det.body.result?.events.map((e: any) => e.action).join());
  const r2 = await op('create_relation_proposal', 'u-editor', { type: 'contains', fromId: olena.id, toId: port.id, note: 'дивна' });
  const rj = await op('reject_proposal', 'u-owner', { proposalId: r2.body.result.proposal.id, reason: 'героїня не містить порт' });
  t('власник відхиляє', rj.status === 200 && rj.body.result.proposal.state === 'rejected' && rj.body.result.proposal.decidedBy === 'user:u-owner');
  t('чужа пропозиція в іншій книзі — 404', (await op('get_proposal', 'u-admin', { proposalId: pid }, P2)).status === 404);
}

console.log('\nHTTP: PUBLISH_SCHEMA:');
{
  const d = await createDraft(repo, { actor: 'user:u-admin', label: 'Т5.3' });
  await editDraft(repo, d.id, { actor: 'user:u-admin', ops: [{ op: 'set_name', name: { en: 'Fusion Story Ontology (T5.3)', uk: 'Онтологія твору Fusion (Т5.3)' } }] });
  await validateDraft(repo, d.id, 'user:u-admin');
  await impactDraft(repo, d.id, 'user:u-admin');
  t('автор без права — 403', (await op('publish_schema', 'u-owner', { draftId: d.id }, undefined)).body.permission === 'schema');
  const pub = await op('publish_schema', 'u-pub', { draftId: d.id }, undefined);
  t('роль із PUBLISH_SCHEMA публікує через Story Core', pub.status === 200 && pub.body.result.version.status === 'active' && pub.body.result.version.version === 2);
  const v1 = (await repo.listOntologyVersions('fusion-story')).find((v) => v.version === 1)!;
  const rb = await op('rollback_schema', 'u-pub', { versionId: v1.id }, undefined);
  t('відкат — нова версія з визначенням обраної', rb.status === 200 && rb.body.result.version.version === 3 && rb.body.result.version.status === 'active');
  t('публікація незавершеної чернетки — 409 з кроком', (await op('publish_schema', 'u-admin', { draftId: (await createDraft(repo, { actor: 'user:u-admin' })).id }, undefined)).body.details?.step === 'validate');
}
server.close();
resetActiveRegistry();

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
