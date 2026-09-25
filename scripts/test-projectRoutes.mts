/**
 * API проєкту семантичного ядра — задача Т0.8 (журнал #251).
 *
 * `/api/projects/:id/*`: гість — 401, чужа книга — 403, власник, прийняте
 * запрошення й адміністратор — доступ; без ядра — 503; сутність іншої книги —
 * 404; таємні висновки (`hidden`) не віддаються нікому, авторські (`author`)
 * — лише власнику й адміністратору.
 *
 * Запуск: npm run test:project-routes
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerProjectRoutes, resolveProjectAccess } from '../server/core/projectRoutes.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// Книга B1 — власник u-owner, запрошені: u-editor (designer) і u-reader (reader).
// Книга B2 — власник u-other.
const access = {
  async getBookOwnerId(id: string) { return ({ B1: 'u-owner', B2: 'u-other' } as Record<string, string>)[id] ?? null; },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites(id: string) {
    return id === 'B1' ? [{ acceptedUserId: 'u-editor', role: 'designer' }, { acceptedUserId: 'u-reader', role: 'reader' }] : [];
  },
};
const PRINCIPALS: Record<string, { id: string | null; role: string; isGuest: boolean }> = {
  owner: { id: 'u-owner', role: 'writer', isGuest: false },
  editor: { id: 'u-editor', role: 'designer', isGuest: false },
  reader: { id: 'u-reader', role: 'reader', isGuest: false },
  stranger: { id: 'u-stranger', role: 'writer', isGuest: false },
  admin: { id: 'u-admin', role: 'admin', isGuest: false },
  guest: { id: null, role: 'guest', isGuest: true },
};

console.log('\nПраво на проєкт:');
t('власник', (await resolveProjectAccess(PRINCIPALS.owner, 'B1', access))?.role === 'owner');
t('запрошений дизайнер може писати, читач — ні',
  (await resolveProjectAccess(PRINCIPALS.editor, 'B1', access))?.canWrite === true && (await resolveProjectAccess(PRINCIPALS.reader, 'B1', access))?.canWrite === false);
t('чужий — без доступу', (await resolveProjectAccess(PRINCIPALS.stranger, 'B1', access)) === null);
t('власник однієї книги не має доступу до іншої', (await resolveProjectAccess(PRINCIPALS.owner, 'B2', access)) === null);
t('адміністратор — до будь-якої', (await resolveProjectAccess(PRINCIPALS.admin, 'B2', access))?.role === 'admin');
t('книга без власника — лише адміністратору', (await resolveProjectAccess(PRINCIPALS.stranger, 'B9', access)) === null);
t('некоректний id — без доступу', (await resolveProjectAccess(PRINCIPALS.owner, 'a b', access)) === null);

// Дані ядра
const repo = new MemoryCoreRepository();
await repo.upsertProject({ id: 'B1', ownerId: 'u-owner', title: 'Книга' });
await repo.upsertProject({ id: 'B2', ownerId: 'u-other', title: 'Чужа' });
await repo.upsertDocument({ projectId: 'B1', id: 's1', kind: 'section', order: 0 });
await repo.upsertParagraph({ projectId: 'B1', id: 'p1', documentId: 's1', order: 0, kind: 'paragraph', text: '[/character:Олена] мовчала.' }, 'system:core_sync');
await repo.upsertParagraph({ projectId: 'B1', id: 'p2', documentId: 's1', order: 1, kind: 'paragraph', text: 'Марко пішов.' }, 'system:core_sync');
const olena = await repo.createEntity({ projectId: 'B1', type: 'character', name: 'Олена', createdBy: 'system:core_sync' });
const marko = await repo.createEntity({ projectId: 'B1', type: 'character', name: 'Марко', createdBy: 'system:core_sync' });
const fear = await repo.createEntity({ projectId: 'B1', type: 'emotion', name: 'страх', createdBy: 'system:core_sync' });
await repo.createEntity({ projectId: 'B1', type: 'location', name: 'Відхилене', status: 'rejected', createdBy: 'user:u-owner' });
await repo.addAlias('B1', olena.id, 'Лена', 'alias');
await repo.replaceParagraphMentions('B1', 'p1', [{ entityId: olena.id, spanStart: 0, spanEnd: 19, source: 'tag' }]);
await repo.replaceParagraphMentions('B1', 'p2', [{ entityId: olena.id, spanStart: 0, spanEnd: 5, source: 'tag' }]);
await repo.markParagraphDeleted('B1', 'p2');
await repo.createRelation({ projectId: 'B1', type: 'follows', fromId: olena.id, toId: marko.id, evidence: ['p1'], createdBy: 'user:u-owner' });
await repo.addFinding({ projectId: 'B1', entityId: olena.id, kind: 'trait', payload: { summary: 'для всіх' }, sourceParagraphIds: ['p1'], createdBy: 'ai:AI-2' });
await repo.addFinding({ projectId: 'B1', entityId: olena.id, kind: 'trait', payload: { summary: 'лише автору' }, sourceParagraphIds: ['p1'], visibility: 'author', createdBy: 'ai:AI-2' });
await repo.addFinding({ projectId: 'B1', entityId: olena.id, kind: 'secret', payload: { summary: 'таємниця' }, sourceParagraphIds: ['p1'], visibility: 'hidden', createdBy: 'ai:AI-2' });
const foreign = await repo.createEntity({ projectId: 'B2', type: 'character', name: 'Чужий', createdBy: 'system:core_sync' });

let coreRepo: CoreRepository | null = repo;
const app = express();
app.use((req, _res, next) => {
  (req as any).principal = PRINCIPALS[String(req.headers['x-test-user'] || 'guest')];
  next();
});
registerProjectRoutes(app, {
  access,
  repo: () => coreRepo,
  coreState: () => (coreRepo ? 'ready' : 'disabled'),
  lastSync: async () => ({ status: 'succeeded', finishedAt: '2026-09-25T10:00:00.000Z' }),
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const get = async (path: string, who: string) => {
  const res = await fetch(`${base}${path}`, { headers: { 'x-test-user': who } });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

console.log('\nМаршрути /api/projects/:id/*:');
t('гість — 401', (await get('/api/projects/B1/summary', 'guest')).status === 401);
const strangerRes = await get('/api/projects/B1/entities', 'stranger');
t('чужий проєкт — 403 (Т0.8)', strangerRes.status === 403 && strangerRes.body.kind === 'forbidden');
t('403 на кожному маршруті проєкту, навіть невідомому', (await get('/api/projects/B2/relations', 'owner')).status === 403 && (await get('/api/projects/B2/whatever', 'owner')).status === 403);
const acc = await get('/api/projects/B1/access', 'editor');
t('хто я в проєкті', acc.status === 200 && acc.body.access.role === 'designer' && acc.body.core === 'ready');

const sum = await get('/api/projects/B1/summary', 'owner');
t('підсумок: абзаци (живі), сутності за типами без відхилених, зв\'язки, висновки',
  sum.status === 200 && sum.body.paragraphs === 1 && sum.body.entities.character === 2 && sum.body.entities.emotion === 1 && !sum.body.entities.location &&
  sum.body.relations === 1 && sum.body.findings.suggested === 2 && sum.body.lastSync?.status === 'succeeded', JSON.stringify(sum.body));
t('читач не бачить авторський висновок у підсумку', (await get('/api/projects/B1/summary', 'reader')).body.findings.suggested === 1);

const ents = await get('/api/projects/B1/entities?type=character', 'reader');
t('сутності за типом з кількістю згадок (у видаленому абзаці — не рахуються)',
  ents.status === 200 && ents.body.entities.length === 2 && ents.body.entities.find((e: any) => e.name === 'Олена')?.mentions === 1, JSON.stringify(ents.body.entities.map((e: any) => [e.name, e.mentions])));
t('відхилені — лише на прохання', (await get('/api/projects/B1/entities', 'owner')).body.entities.length === 3 && (await get('/api/projects/B1/entities?includeRejected=1', 'owner')).body.entities.length === 4);

const one = await get(`/api/projects/B1/entities/${olena.id}`, 'owner');
t('сутність: псевдоніми, згадки, зв\'язки', one.status === 200 && one.body.aliases.some((a: any) => a.alias === 'Лена') && one.body.mentions.length === 2 && one.body.relations.length === 1);
t('власник бачить загальний і авторський висновок, таємниці — ні',
  one.body.findings.length === 2 && !one.body.findings.some((f: any) => f.visibility === 'hidden'));
const oneReader = await get(`/api/projects/B1/entities/${olena.id}`, 'reader');
t('учасник бачить лише загальні висновки', oneReader.body.findings.length === 1 && oneReader.body.findings[0].payload.summary === 'для всіх');
t('сутність іншої книги через свій проєкт — 404', (await get(`/api/projects/B1/entities/${foreign.id}`, 'owner')).status === 404);
t('неіснуюча сутність — 404', (await get('/api/projects/B1/entities/not-a-uuid', 'owner')).status === 404);
t('адміністратор читає будь-який проєкт', (await get(`/api/projects/B2/entities/${foreign.id}`, 'admin')).status === 200);

const rels = await get(`/api/projects/B1/relations?entityId=${marko.id}`, 'editor');
t('зв\'язки сутності', rels.status === 200 && rels.body.relations.length === 1 && rels.body.relations[0].type === 'follows');
t('зв\'язки сутності без збігів — порожньо', (await get(`/api/projects/B1/relations?entityId=${fear.id}`, 'editor')).body.relations.length === 0);

coreRepo = null;
const off = await get('/api/projects/B1/entities', 'owner');
t('ядро вимкнене — 503 з поясненням', off.status === 503 && off.body.kind === 'core_unavailable' && off.body.core === 'disabled');
t('але без права — все одно 403, а не 503', (await get('/api/projects/B1/entities', 'stranger')).status === 403);

server.close();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
