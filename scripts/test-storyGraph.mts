/**
 * Граф історії — задача Т1.4 (журнал #255).
 *
 * Критерій приймання сторінки 2 (ТЗ-11 §3): натискання на героя відкриває
 * його підтверджені зв'язки першого рівня й джерела. Плюс: розкладка
 * (детермінована, без накладань), огляд із лімітом, фокус і глибина,
 * фільтр типів, лише підтверджені, зв'язки з тегів (суб'єкт П1), видалені
 * абзаци не джерела, ручне створення й підтвердження зв'язків за правами.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:story-graph
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { registerProjectRoutes, canEditStory } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { buildStoryGraph, tagLinkType } from '../server/core/storyGraph.ts';
import { forceLayout, placeAround, radialLayout } from '../src/utils/graphLayout.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nРозкладка:');
{
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}` }));
  const edges = [...Array.from({ length: 9 }, (_, i) => ({ from: 'n0', to: `n${i + 1}` })), { from: 'n10', to: 'n11' }, { from: 'n11', to: 'n12' }];
  const a = forceLayout(nodes, edges);
  const b = forceLayout(nodes, edges);
  t('огляд детермінований (та сама картинка щоразу)', JSON.stringify(a) === JSON.stringify(b));
  let minD = Infinity;
  for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) minD = Math.min(minD, Math.hypot(a[`n${i}`].x - a[`n${j}`].x, a[`n${i}`].y - a[`n${j}`].y));
  t('вузли не накладаються', minD > 60, `мін. відстань ${Math.round(minD)}`);
  const d = (p: string, q: string) => Math.hypot(a[p].x - a[q].x, a[p].y - a[q].y);
  const linked = [1, 2, 3].map((i) => d('n0', `n${i}`)).reduce((x, y) => x + y) / 3;
  const unlinked = [13, 14, 15].map((i) => d('n0', `n${i}`)).reduce((x, y) => x + y) / 3;
  t('зв\'язані ближчі за незв\'язані', linked < unlinked, `${Math.round(linked)} < ${Math.round(unlinked)}`);
  const r = radialLayout('n0', nodes.slice(0, 6), edges);
  const radii = [1, 2, 3, 4, 5].map((i) => Math.round(Math.hypot(r[`n${i}`].x, r[`n${i}`].y)));
  t('фокус у центрі, перший рівень — по колу', r.n0.x === 0 && r.n0.y === 0 && new Set(radii).size === 1, radii.join());
  const extra = placeAround({ x: 0, y: 0 }, ['x1', 'x2', 'x3'], { a: { x: 0, y: -230 } });
  t('довантажені сусіди — навколо вузла, не на зайнятих місцях', Object.values(extra).every((p) => Math.hypot(p.x, p.y + 230) > 120 && Math.hypot(p.x, p.y) >= 200));
  t('тип зв\'язку з тега: емоція — «переживає», решта — «бере участь»', tagLinkType('emotion') === 'experiences' && tagLinkType('event') === 'participates_in');
}

console.log('\nПрава на зміну графа:');
{
  const acc = (role: string, isOwner = false) => ({ projectId: 'p', userId: 'u', role, isOwner, canWrite: role !== 'reader' });
  t('власник, адмін, співавтор, редактор — так', canEditStory(acc('owner', true)) && canEditStory(acc('admin')) && canEditStory(acc('coauthor')) && canEditStory(acc('editor')));
  t('читач, дизайнер, перекладач, видавець — ні', !canEditStory(acc('reader')) && !canEditStory(acc('designer')) && !canEditStory(acc('translator')) && !canEditStory(acc('publisher')));
}

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nГраф історії (${label}):`);
  const section = (id: string, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Сцена ${id}`, order: 0, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const text1 = [
    '[/character:Сергій] [/emotion:страх] Сергій боявся відчинити двері.',
    '[/character:Марко] Марко чекав на сходах, готовий до сварки.',
    '[/character:Сергій] [/character:Марко] [/event:Сварка] Вони посварились біля дверей.',
    '[/character:Ліна] Ліна спостерігала з вікна.',
  ];
  const book = (t1: string[]) => ({
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-s', name: 'Сергій' }, { id: 'c-m', name: 'Марко' }, { id: 'c-l', name: 'Ліна' }],
    chapters: [{ id: 'ch1', title: 'Двері', order: 0, sections: [section('s1', t1.join('\n\n'))] }],
  });
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book(text1) });
  const [p1, p2, p3, p4] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const id = async (type: string, name: string) => (await repo.resolveAlias(P, type, name))!;
  const serhii = await id('character', 'Сергій');
  const marko = await id('character', 'Марко');
  const lina = await id('character', 'Ліна');
  const fear = await id('emotion', 'страх');
  const quarrel = await id('event', 'Сварка');
  const opp = await repo.createRelation({ projectId: P, type: 'opposes', fromId: marko, toId: serhii, evidence: [p2, p3], status: 'confirmed', note: 'чекав, щоб посваритись', createdBy: 'user:u-owner' });
  const sug = await repo.createRelation({ projectId: P, type: 'participates_in', fromId: serhii, toId: quarrel, evidence: [p3], createdBy: 'ai:AI-1' });
  const rej = await repo.createRelation({ projectId: P, type: 'targets', fromId: lina, toId: serhii, evidence: [p4], createdBy: 'ai:AI-1' });
  await repo.setRelationStatus(P, rej.id, 'rejected', 'user:u-owner');

  // ── КРИТЕРІЙ: клік по героєві ──
  const g = await buildStoryGraph(repo, P, { focus: serhii, depth: 1 });
  const confirmed = g.edges.filter((e) => e.status === 'confirmed');
  const oppEdge = g.edges.find((e) => e.id === opp.id);
  t('КРИТЕРІЙ: у фокусі героя — підтверджені зв\'язки першого рівня', !!oppEdge && oppEdge.status === 'confirmed' && confirmed.every((e) => e.from === serhii || e.to === serhii), g.edges.map((e) => `${e.type}:${e.status}`).join());
  t('…з джерелами: абзаци з уривком, розділом, главою й номером у редакторі',
    oppEdge!.evidence.map((e) => e.paragraphId).join() === [p2, p3].join() && oppEdge!.evidence[0].excerpt === 'Марко чекав на сходах, готовий до сварки.' && oppEdge!.evidence[0].chapterId === 'ch1' && oppEdge!.evidence[0].sectionId === 's1' && oppEdge!.evidence[0].editorPid === p2);
  const tagEdge = g.edges.find((e) => e.kind === 'tag' && e.from === serhii && e.to === fear);
  t('зв\'язок із тега: Сергій —переживає→ страх, підтверджений, джерело — абзац тега', tagEdge?.type === 'experiences' && tagEdge.status === 'confirmed' && tagEdge.evidence[0]?.paragraphId === p1, JSON.stringify(tagEdge?.evidence.map((e) => e.paragraphId)));
  t('запропонований ШІ — теж видно, окремим статусом', g.edges.some((e) => e.id === sug.id && e.status === 'suggested'));
  t('відхилений — не на графі', !g.edges.some((e) => e.id === rej.id) && !g.nodes.some((n) => n.id === lina));
  t('вузли — фокус і сусіди, з типом, згадками й ступенем', g.nodes.map((n) => n.id).sort().join() === [serhii, marko, fear, quarrel].sort().join() && g.nodes.find((n) => n.id === serhii)!.mentions === 2 && g.nodes.find((n) => n.id === serhii)!.degree >= 3);

  const onlyConf = await buildStoryGraph(repo, P, { focus: serhii, includeSuggested: false });
  t('«лише підтверджені» — без пропозицій ШІ', !onlyConf.edges.some((e) => e.status === 'suggested') && !onlyConf.nodes.some((n) => n.id === quarrel));
  const noTags = await buildStoryGraph(repo, P, { focus: serhii, includeTagLinks: false });
  t('без зв\'язків із тегів', !noTags.edges.some((e) => e.kind === 'tag') && !noTags.nodes.some((n) => n.id === fear));
  const onlyEmotion = await buildStoryGraph(repo, P, { focus: serhii, types: ['emotion'] });
  t('фільтр типів: лише емоції (фокус — завжди)', onlyEmotion.nodes.map((n) => n.id).sort().join() === [serhii, fear].sort().join());

  await repo.createRelation({ projectId: P, type: 'precedes', fromId: quarrel, toId: await (async () => (await repo.createEntity({ projectId: P, type: 'event', name: 'Примирення', createdBy: 'user:u-owner' })).id)(), status: 'confirmed', createdBy: 'user:u-owner' });
  const d1 = await buildStoryGraph(repo, P, { focus: serhii, depth: 1 });
  const d2 = await buildStoryGraph(repo, P, { focus: serhii, depth: 2 });
  t('глибина 2 довантажує сусідів сусідів', d2.nodes.length === d1.nodes.length + 1 && d2.nodes.some((n) => n.name === 'Примирення') && d2.edges.some((e) => e.type === 'precedes'));

  const overview = await buildStoryGraph(repo, P, {});
  t('огляд без фокуса — усі зв\'язані сутності', overview.focus === null && [serhii, marko, fear, quarrel, lina].every((x) => overview.nodes.some((n) => n.id === x)) && !overview.truncated);
  const small = await buildStoryGraph(repo, P, { limit: 2 });
  t('ліміт огляду: найзв\'язніші + позначка «обрізано»', small.nodes.length === 2 && small.truncated && small.nodes.some((n) => n.id === serhii), small.nodes.map((n) => n.name).join());

  // Абзац-джерело зник із книги.
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book([text1[0], text1[2], text1[3]]) });
  const after = await buildStoryGraph(repo, P, { focus: serhii });
  const oppAfter = after.edges.find((e) => e.id === opp.id)!;
  t('видалений абзац — більше не джерело', oppAfter.evidence.map((e) => e.paragraphId).join() === p3 && oppAfter.evidenceCount === 1, oppAfter.evidence.map((e) => e.paragraphId).join());

  // ── Маршрути ──
  console.log(`\nМаршрути графа (${label}):`);
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }, { acceptedUserId: 'u-editor', role: 'editor' }, { acceptedUserId: 'u-designer', role: 'designer' }]; },
  };
  const who: Record<string, any> = {
    owner: { id: 'u-owner', role: 'writer', isGuest: false },
    reader: { id: 'u-reader', role: 'reader', isGuest: false },
    editor: { id: 'u-editor', role: 'writer', isGuest: false },
    designer: { id: 'u-designer', role: 'writer', isGuest: false },
    stranger: { id: 'u-x', role: 'writer', isGuest: false },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const gOwner = await call('GET', `/story-graph?focus=${serhii}&depth=1`, 'owner');
  t('GET: граф героя, власник може змінювати', gOwner.status === 200 && gOwner.body.canEdit === true && gOwner.body.edges.some((e: any) => e.id === opp.id && e.evidence.length === 1));
  const gReader = await call('GET', `/story-graph?focus=${serhii}&suggested=0&tags=0&types=character`, 'reader');
  t('читач бачить граф, змінювати — ні; фільтри з рядка запиту', gReader.status === 200 && gReader.body.canEdit === false && gReader.body.edges.every((e: any) => e.status === 'confirmed' && e.kind === 'relation') && gReader.body.nodes.every((n: any) => n.type === 'character'));
  t('чужому — 403', (await call('GET', '/story-graph', 'stranger')).status === 403);
  const card = await call('GET', `/entities/${serhii}?excerpts=1`, 'reader');
  t('картка: згадки в тексті з уривками й адресою', card.status === 200 && card.body.mentionParagraphs?.length === 2 && card.body.mentionParagraphs.every((m: any) => m.chapterId === 'ch1' && m.excerpt));

  const mk = (user: string, body: unknown) => call('POST', '/relations', user, body);
  const created = await mk('owner', { type: 'follows', fromId: lina, toId: serhii, evidence: [p4], note: 'стежить' });
  t('ручний зв\'язок власника — 201, підтверджений, від автора, з джерелом', created.status === 201 && created.body.relation.status === 'confirmed' && created.body.relation.createdBy === 'user:u-owner' && created.body.relation.evidence.join() === p4);
  t('редактор теж може', (await mk('editor', { type: 'opposes', fromId: lina, toId: marko })).status === 201);
  t('читач і дизайнер — 403', (await mk('reader', { type: 'opposes', fromId: serhii, toId: lina })).status === 403 && (await mk('designer', { type: 'opposes', fromId: serhii, toId: lina })).status === 403);
  t('невідомий тип — 422', (await mk('owner', { type: 'loves_forever', fromId: serhii, toId: lina })).status === 422);
  t('та сама сутність — 400', (await mk('owner', { type: 'opposes', fromId: serhii, toId: serhii })).status === 400);
  t('дубль — 409', (await mk('owner', { type: 'follows', fromId: lina, toId: serhii })).status === 409);
  t('джерело не з книги — 400', (await mk('owner', { type: 'targets', fromId: serhii, toId: lina, evidence: ['нема'] })).status === 400);
  t('чужа сутність — 404', (await mk('owner', { type: 'targets', fromId: serhii, toId: '00000000-0000-4000-8000-000000000000' })).status === 404);

  t('підтвердити пропозицію ШІ — читач не може', (await call('POST', `/relations/${sug.id}/status`, 'reader', { status: 'confirmed' })).status === 403);
  const conf = await call('POST', `/relations/${sug.id}/status`, 'owner', { status: 'confirmed' });
  t('підтвердити пропозицію ШІ — стала підтвердженою', conf.status === 200 && conf.body.relation.status === 'confirmed');
  t('поганий статус — 400', (await call('POST', `/relations/${sug.id}/status`, 'owner', { status: 'maybe' })).status === 400);
  const rejected = await call('POST', `/relations/${created.body.relation.id}/status`, 'owner', { status: 'rejected' });
  const gAfter = await call('GET', `/story-graph?focus=${serhii}`, 'owner');
  t('відхилений зв\'язок зникає з графа', rejected.status === 200 && !gAfter.body.edges.some((e: any) => e.id === created.body.relation.id) && gAfter.body.edges.some((e: any) => e.id === sug.id && e.status === 'confirmed'));
  server.close();
}

await suite('memory', new MemoryCoreRepository(), 'book-m');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    await suite('postgres', new PgCoreRepository(pool), 'book-p');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
