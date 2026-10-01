/**
 * Реєстр схем — API і UI-метадані з реєстру (Т5.1 В3, `PLAN_ONTOLOGY.md`;
 * ТЗ Graph Studio §33, §37, §39 №5). Запуск: npm run test:ontology-routes
 *
 *   • `GET /api/core/ontology` — активна версія з ETag; без ядра — вбудований
 *     реєстр; ті самі дані бачить будь-хто з входом;
 *   • зміни — лише адміністратор; повний цикл через HTTP: чернетка → правки →
 *     перевірка → перегляд → вплив → публікація → відкат → архів; руйнівне
 *     видалення — 409 з блокерами; без ядра — 503;
 *   • словник `/api/core/entities` — з активної версії;
 *   • клієнт: збережена копія → сервер (304 / нова версія) → офлайн; зламане
 *     визначення не застосовується.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import type { CoreRepository } from '../server/core/types.ts';
import { registerOntologyRoutes } from '../server/core/ontology/routes.ts';
import { bootstrapOntology } from '../server/core/ontology/lifecycle.ts';
import { listCoreEntities, listCoreRelations } from '../server/coreEntityStore.ts';
import { activeRegistryLabel, entityBySlug, isRegisteredEntityType, resetRegistry } from '../src/utils/coreEntities.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

let repo: CoreRepository | null = null;
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, _res, next) => {
  (req as any).principal = req.headers['x-user'] ? { id: String(req.headers['x-user']), role: req.headers['x-admin'] ? 'admin' : 'writer', isGuest: false } : undefined;
  next();
});
const requireAuth = (req: any, res: any, next: any) => (req.principal ? next() : res.status(401).json({ error: 'потрібен вхід' }));
const requireAdmin = (req: any, res: any, next: any) => (req.principal?.role === 'admin' ? next() : res.status(403).json({ error: 'лише адміністратор' }));
registerOntologyRoutes(app, { repo: () => repo, requireAuth, requireAdmin });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, path: string, body?: unknown, who: 'admin' | 'writer' | 'guest' = 'admin', headers: Record<string, string> = {}) => {
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (who !== 'guest') h['x-user'] = who === 'admin' ? 'a1' : 'w1';
  if (who === 'admin') h['x-admin'] = '1';
  const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* 304 без тіла */
  }
  return { status: res.status, body: json, etag: res.headers.get('etag') };
};

try {
  console.log('Без ядра:');
  resetRegistry();
  const f = await call('GET', '/api/core/ontology', undefined, 'writer');
  t('читання — вбудований реєстр (версія 0, 118 типів), автор теж бачить', f.status === 200 && f.body.source === 'factory' && f.body.version === 0 && f.body.definition.entityTypes.length === 118);
  t('ETag = хеш; той самий ETag — 304', f.etag === `"${f.body.hash}"` && (await call('GET', '/api/core/ontology', undefined, 'writer', { 'if-none-match': f.etag! })).status === 304);
  t('без входу — 401', (await call('GET', '/api/core/ontology', undefined, 'guest')).status === 401);
  t('зміни без ядра — 503', (await call('POST', '/api/core/ontology/drafts', {})).status === 503);

  console.log('\nЗ ядром — читання й права:');
  repo = new MemoryCoreRepository();
  await bootstrapOntology(repo);
  const r1 = await call('GET', '/api/core/ontology', undefined, 'writer');
  t('активна версія 1 з реєстру схем, той самий хеш, що й вбудований', r1.status === 200 && r1.body.source === 'registry' && r1.body.version === 1 && r1.body.hash === f.body.hash);
  t('автор не створює чернетку (403)', (await call('POST', '/api/core/ontology/drafts', {}, 'writer')).status === 403);
  t('автор не бачить версій і журналу (403)', (await call('GET', '/api/core/ontology/versions', undefined, 'writer')).status === 403 && (await call('GET', '/api/core/ontology/events', undefined, 'writer')).status === 403);

  console.log('\nЦикл через HTTP (адмін):');
  await repo.upsertProject({ id: 'p1', ownerId: 'u1', title: 'Т' } as any);
  await repo.createEntity({ projectId: 'p1', type: 'mystery', name: 'Таємниця', createdBy: 'user:u1' } as any);
  const cd = await call('POST', '/api/core/ontology/drafts', { label: '1.1' });
  t('чернетка — 201, версія 2', cd.status === 201 && cd.body.version.version === 2 && cd.body.version.status === 'draft');
  const id = cd.body.version.id;
  t('друга чернетка — 409', (await call('POST', '/api/core/ontology/drafts', {})).status === 409);
  const def = (await call('GET', `/api/core/ontology/versions/${id}`)).body.version.definition;
  const ch = def.entityTypes.find((e: any) => e.id === 'character');
  const prophecy = { id: 'prophecy', name: { en: 'Prophecy', uk: 'Пророцтво' }, groupId: 'B', family: null, status: 'active', registry: 'custom', ui: { color: '#7C3AED', order: 118 }, ai: { description: '', hints: [] }, properties: [], aliases: [] };
  const ed = await call('PATCH', `/api/core/ontology/drafts/${id}`, {
    expectedRevision: cd.body.version.revision,
    ops: [
      { op: 'set_entity_type', value: { ...ch, name: { en: 'Character', uk: 'Герой' }, ui: { ...ch.ui, color: '#123456' } } },
      { op: 'set_entity_type', value: prophecy },
      { op: 'remove_entity_type', id: 'mystery' },
    ],
  });
  t('правки — 200, ревізія зросла', ed.status === 200 && ed.body.version.revision > cd.body.version.revision);
  t('стара ревізія — 409', (await call('PATCH', `/api/core/ontology/drafts/${id}`, { expectedRevision: 1, ops: [{ op: 'set_name', name: { en: 'X', uk: 'Х' } }] })).status === 409);
  t('без операцій — 422', (await call('PATCH', `/api/core/ontology/drafts/${id}`, { ops: [] })).status === 422);
  t('невірна ревізія (не число) — 422', (await call('PATCH', `/api/core/ontology/drafts/${id}`, { expectedRevision: 'x', ops: [{ op: 'set_name', name: { en: 'X', uk: 'Х' } }] })).status === 422);
  const va = await call('POST', `/api/core/ontology/drafts/${id}/validate`);
  t('перевірка — ok, validated', va.status === 200 && va.body.validation.ok && va.body.version.status === 'validated');
  const pv = await call('GET', `/api/core/ontology/drafts/${id}/preview`);
  t('перегляд — різниця з активною', pv.status === 200 && pv.body.diff.entityTypes.added.includes('prophecy') && pv.body.diff.entityTypes.removed.includes('mystery'));
  t('публікація без впливу — 409 з кроком', (await call('POST', `/api/core/ontology/drafts/${id}/publish`)).body?.details?.step === 'impact');
  const im = await call('POST', `/api/core/ontology/drafts/${id}/impact`);
  t('вплив — mystery з даними як блокер', im.status === 200 && im.body.impact.blockers[0]?.id === 'mystery');
  const blocked = await call('POST', `/api/core/ontology/drafts/${id}/publish`);
  t('руйнівне видалення — 409, блокери в details', blocked.status === 409 && blocked.body.details?.blockers?.[0]?.id === 'mystery', blocked.body.error);
  const mys = def.entityTypes.find((e: any) => e.id === 'mystery');
  await call('PATCH', `/api/core/ontology/drafts/${id}`, { ops: [{ op: 'set_entity_type', value: { ...mys, status: 'deprecated' } }] });
  await call('POST', `/api/core/ontology/drafts/${id}/validate`);
  await call('POST', `/api/core/ontology/drafts/${id}/impact`);
  const pub = await call('POST', `/api/core/ontology/drafts/${id}/publish`);
  t('публікація — 200, версія 2 активна, хто опублікував', pub.status === 200 && pub.body.version.status === 'active' && pub.body.version.publishedBy === 'user:a1');
  const r2 = await call('GET', '/api/core/ontology', undefined, 'writer', { 'if-none-match': r1.etag! });
  t('старий ETag — 200 з новою версією 2', r2.status === 200 && r2.body.version === 2 && r2.body.hash !== r1.body.hash);
  t('реєстр сервера — @2: character «Герой», prophecy є', activeRegistryLabel() === 'fusion-story@2' && entityBySlug('character')?.nameUk === 'Герой' && isRegisteredEntityType('prophecy'));
  const ents = await listCoreEntities();
  const rels = await listCoreRelations();
  t('словник /api/core/entities — з активної версії (119 типів, prophecy, mystery застарілий)', ents.length === 119 && ents.some((e) => e.slug === 'prophecy') && !!ents.find((e) => e.slug === 'mystery')?.deprecated && ents.find((e) => e.slug === 'character')?.color === '#123456');
  t('…і зв\'язки — з неї (з англійськими назвами)', rels.length === 39 && rels.every((r) => !!r.nameEn));
  const v1id = (await call('GET', '/api/core/ontology/versions')).body.versions.find((v: any) => v.version === 1).id;
  const list = await call('GET', '/api/core/ontology/versions');
  t('перелік версій: активна 2, чернетки немає, версія 1 — deprecated', list.body.active?.version === 2 && list.body.draft === null && list.body.versions.find((v: any) => v.version === 1)?.status === 'deprecated');
  const rb = await call('POST', `/api/core/ontology/versions/${v1id}/rollback`);
  t('відкат до 1 — 200 (prophecy ще без даних, mystery знову активний)', rb.status === 200, `${rb.status} ${rb.body.error ?? ''}`);
  t('відкат до 1 — нова версія 3 з визначенням 1', rb.body.version?.version === 3 && rb.body.version?.definitionHash === r1.body.hash);
  t('реєстр — знову «Персонаж», prophecy немає', entityBySlug('character')?.nameUk === 'Персонаж' && !isRegisteredEntityType('prophecy'));
  t('архів активної — 409', (await call('POST', `/api/core/ontology/versions/${rb.body.version?.id ?? pub.body.version.id}/archive`)).status === 409);
  const ar = await call('POST', `/api/core/ontology/versions/${v1id}/archive`);
  t('архів застарілої версії 1 — 200', ar.status === 200 && ar.body.version.status === 'archived');
  t('невідома версія — 404', (await call('GET', '/api/core/ontology/versions/00000000-0000-4000-8000-000000000000')).status === 404);
  const ev = await call('GET', '/api/core/ontology/events');
  t('журнал аудиту через API — із публікацією й відкатом від user:a1', ev.status === 200 && ev.body.events.some((e: any) => e.action === 'publish' && e.actor === 'user:a1') && ev.body.events.some((e: any) => e.action === 'rollback'));
} finally {
  server.close();
}

console.log('\nКлієнт (браузер): копія → сервер → офлайн:');
{
  resetRegistry();
  const store = new Map<string, string>();
  (globalThis as any).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } };
  const { loadActiveOntology, activeOntologyHash } = await import('../src/utils/ontologyClient.ts');
  const { factoryOntology } = await import('../src/utils/ontology.ts');
  const def = factoryOntology();
  def.entityTypes.find((e) => e.id === 'character')!.name.uk = 'Герой книги';
  const payload = { ontologyId: 'fusion-story', version: 5, label: '', hash: 'a'.repeat(64), publishedAt: null, source: 'registry', definition: def };
  let seenIfNone: string | null = null;
  let mode: 'ok' | '304' | 'offline' | 'broken' = 'ok';
  const fakeFetch = (async (_u: string, init?: RequestInit) => {
    seenIfNone = (init?.headers as Record<string, string>)?.['If-None-Match'] ?? null;
    if (mode === 'offline') throw new TypeError('fetch failed');
    if (mode === '304') return new Response(null, { status: 304 });
    if (mode === 'broken') return new Response(JSON.stringify({ ...payload, hash: 'b'.repeat(64), definition: { ...def, entityTypes: [] } }), { status: 200 });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  t('нова версія з сервера застосована й збережена', (await loadActiveOntology(fakeFetch)) && entityBySlug('character')?.nameUk === 'Герой книги' && activeRegistryLabel() === 'fusion-story@5' && store.size === 1);
  mode = '304';
  t('далі — If-None-Match з хешем; 304 нічого не змінює', !(await loadActiveOntology(fakeFetch)) && seenIfNone === `"${'a'.repeat(64)}"` && activeOntologyHash() === 'a'.repeat(64));
  mode = 'broken';
  t('зламане визначення з сервера не застосовується', !(await loadActiveOntology(fakeFetch)) && entityBySlug('character')?.nameUk === 'Герой книги');
  mode = 'offline';
  t('офлайн — лишається застосована версія, без помилки', !(await loadActiveOntology(fakeFetch)) && activeRegistryLabel() === 'fusion-story@5');
  // Новий запуск сторінки: свіжий модуль (порожній стан), вбудований реєстр, мережі немає.
  resetRegistry();
  // Окремий URL — окремий екземпляр модуля (як після перезавантаження сторінки).
  const freshUrl = '../src/utils/ontologyClient.ts?restart=1';
  const fresh = (await import(freshUrl)) as typeof import('../src/utils/ontologyClient.ts');
  await fresh.loadActiveOntology(fakeFetch);
  t('новий запуск офлайн: застосовано збережену копію (версія 5)', activeRegistryLabel() === 'fusion-story@5' && entityBySlug('character')?.nameUk === 'Герой книги', activeRegistryLabel());
}

resetRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
