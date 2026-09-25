/**
 * Хронологія — задача Т2.1 (журнал #258).
 *
 * Критерій сторінки 6 (ТЗ-11 §7): флешбек відображається окремо від поточного
 * часу оповіді. І для ТЗ-H: для героя й сцени сервер повертає список відомих
 * йому фактів (знання в часі). Плюс: розбір часу (дата, «день N», число,
 * інтервал), дві шкали, лінії, фільтри, зв'язки precedes / follows /
 * overlaps і суперечності з переходом до сцени, порядок зі Студії, права.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:timeline
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { buildTimeline, characterKnowledge } from '../server/core/timeline.ts';
import { PROFILE_FACT } from '../server/core/characterProfile.ts';
import { describeStoryTime, normalizeStoryTime, storyTimeKey } from '../src/utils/storyTime.ts';
import { CoreRuleError } from '../server/core/rules.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nЧас у світі книги:');
{
  t('рік, місяць, день — зростають', storyTimeKey('1998')! < storyTimeKey('1998-02')! && storyTimeKey('1998-02')! < storyTimeKey('1998-02-15')! && storyTimeKey('1998-12-31')! < storyTimeKey('1999')!);
  t('до н. е. — від\'ємні', storyTimeKey('-44')! < storyTimeKey('10')!);
  t('«день 3» і просто число', storyTimeKey('день 3') === 3 && storyTimeKey('Day 12') === 12 && storyTimeKey('2,5') === 2.5);
  t('нерозпізнане — null (13-й місяць, слова)', storyTimeKey('1998-13') === null && storyTimeKey('колись') === null);
  const iv = normalizeStoryTime({ kind: 'interval', start: '1998', end: '2001' });
  t('інтервал: ключі початку й кінця', typeof iv !== 'string' && iv.key === 1998 && iv.endKey === 2001);
  t('інтервал навпаки — відмова з поясненням', normalizeStoryTime({ kind: 'interval', start: '2001', end: '1998' }) === 'Кінець інтервалу раніше за початок');
  t('невизначений — без ключа', (normalizeStoryTime({ kind: 'unknown' }) as any).key === null);
  t('підписи', describeStoryTime({ kind: 'approximate', start: '1998', end: null }) === '≈ 1998' && describeStoryTime({ kind: 'interval', start: '1998', end: '2001' }) === '1998 — 2001' && describeStoryTime({ kind: 'exact', start: '1998', end: null, label: 'весна 1998' }) === 'весна 1998');
}

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nХронологія (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id === 's1' ? 'Сьогодення' : id === 's2' ? 'Лист' : id === 's3' ? 'Дитинство' : 'Повернення', order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Зараз', order: 0, sections: [
        sec('s1', 0, '[/character:Олена] [/location:Київ] [/storyline:Розслідування] Олена відкрила справу.'),
        sec('s2', 1, '[/character:Олена] [/revelation:Правда про брата] Олена дізналась правду з листа.'),
      ] },
      { id: 'ch2', title: 'Тоді', order: 1, sections: [
        sec('s3', 0, '[/character:Олена] [/event:Пожежа] Маленька Олена бачила пожежу.'),
        sec('s4', 1, '[/character:Марко] [/location:Львів] [/event:Суд] Марко прийшов на суд.'),
      ] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const id = async (type: string, name: string) => (await repo.resolveAlias(P, type, name))!;
  const olena = await id('character', 'Олена');
  const marko = await id('character', 'Марко');
  const fire = await id('event', 'Пожежа');
  const trial = await id('event', 'Суд');
  const kyiv = await id('location', 'Київ');
  const line = await id('storyline', 'Розслідування');
  const [p2] = (await repo.listParagraphs(P, 's2')).map((p) => p.id);

  const noTime = await buildTimeline(repo, P);
  t('без часу: порядок розкриття є, флешбеків немає', noTime.scenes.map((s) => `${s.narrativeIndex}:${s.sectionId}`).join() === '1:s1,2:s2,3:s3,4:s4' && noTime.scenes.every((s) => !s.time && !s.flashback));
  const studio = await buildTimeline(repo, P, { studioOrder: new Map([['s1', 3], ['s2', 4], ['s3', 1], ['s4', 5]]) });
  t('порядок у світі зі Студії (Scene.timelineOrder) — уже дає флешбек', studio.scenes.find((s) => s.sectionId === 's3')!.flashback && studio.scenes[0].time?.source === 'studio');

  const put = (subjectKind: 'scene' | 'event', subjectId: string, start: string, kind: any = 'exact', end: string | null = null) => {
    const v = normalizeStoryTime({ kind, start, end }) as any;
    return repo.upsertTimePoint({ projectId: P, subjectKind, subjectId, kind: v.kind, start: v.start, end: v.end, sortKey: v.key, endKey: v.endKey, label: v.label, createdBy: 'user:u-owner' });
  };
  await put('scene', 's1', '2024');
  await put('scene', 's2', '2024-02');
  await put('scene', 's3', '1998');
  await put('scene', 's4', '2024-03');
  let rej = false;
  try { await repo.upsertTimePoint({ projectId: P, subjectKind: 'scene', subjectId: 's1', kind: 'interval', start: '2', end: '1', sortKey: 2, endKey: 1, label: '', createdBy: 'user:u' }); } catch (e) { rej = e instanceof CoreRuleError; }
  t('сховище: інтервал навпаки — відмова (як CHECK у базі)', rej);

  const tl = await buildTimeline(repo, P);
  const s3 = tl.scenes.find((s) => s.sectionId === 's3')!;
  t('КРИТЕРІЙ: «Дитинство» (1998), розказане третім, — флешбек, окремо від часу оповіді', s3.flashback && s3.flashbackAfter === 's2' && tl.scenes.filter((s) => s.flashback).length === 1);
  t('дві шкали: порядок розкриття й час у світі', s3.narrativeIndex === 3 && s3.time?.key === 1998 && s3.chapterNumber === 2 && tl.scenes.find((s) => s.sectionId === 's4')!.time!.key! > 2024);
  t('сцени знають героїв, місця й лінії', tl.scenes[0].characters.some((c) => c.id === olena) && tl.scenes[0].locations.some((l) => l.id === kyiv) && tl.scenes[0].storylines.some((l) => l.id === line) && tl.lanes.map((l) => l.name).join() === 'Розслідування');
  const fireEv = tl.events.find((e) => e.entityId === fire)!;
  t('подія без свого часу — час сцени, де вперше згадано', fireEv.time?.key === 1998 && fireEv.time.source === 'scene' && fireEv.sectionId === 's3');
  await put('event', trial, '2024-03-10');
  await repo.createRelation({ projectId: P, type: 'precedes', fromId: trial, toId: fire, evidence: [], status: 'confirmed', createdBy: 'user:u-owner' });
  await repo.createRelation({ projectId: P, type: 'overlaps', fromId: fire, toId: trial, evidence: [], status: 'confirmed', createdBy: 'user:u-owner' });
  await repo.createRelation({ projectId: P, type: 'follows', fromId: trial, toId: fire, evidence: [p2], status: 'confirmed', createdBy: 'user:u-owner' });
  const tw = await buildTimeline(repo, P);
  const kinds = tw.warnings.map((w) => w.kind).sort().join();
  t('суперечності: «передує», але пізніше; «одночасні», але не перетинаються; замкнене коло', kinds === 'cycle,relation_order,relation_overlap', kinds);
  const ord = tw.warnings.find((w) => w.kind === 'relation_order')!;
  t('попередження — з переходом до сцени (абзац, розділ, глава)', !!ord.paragraphId && ord.sectionId === 's4' && ord.chapterId === 'ch2' && /«Суд» має передувати «Пожежа»/.test(ord.message), JSON.stringify(ord));
  t('зв\'язки часу — у відповіді', tw.relations.length === 3 && tw.relations.every((r) => ['precedes', 'follows', 'overlaps'].includes(r.type)));

  const byMarko = await buildTimeline(repo, P, { character: marko });
  t('фільтр за героєм — лише його сцени й події', byMarko.scenes.map((s) => s.sectionId).join() === 's4' && byMarko.events.every((e) => e.sectionId === 's4'));
  t('фільтр за місцем і лінією', (await buildTimeline(repo, P, { location: kyiv })).scenes.map((s) => s.sectionId).join() === 's1' && (await buildTimeline(repo, P, { storyline: line })).scenes.map((s) => s.sectionId).join() === 's1');

  // ── Знання героя в часі ──
  const fact = await repo.addFinding({ projectId: P, entityId: olena, kind: PROFILE_FACT, payload: { statement: 'Олена знає, що брат живий.' }, sourceParagraphIds: [p2], createdBy: 'ai:AI-2' });
  await repo.setFindingStatus(P, fact.id, 'confirmed', 'user:u-owner');
  const k4 = (await characterKnowledge(repo, P, olena, 's4'))!;
  t('ГОТОВО: до «Повернення» (2024-03) Олена знає — правду з листа, пожежу, факт профілю',
    k4.known.map((k) => `${k.kind}:${k.name}`).sort().join('|') === ['event:Пожежа', 'fact:Олена знає, що брат живий.', 'revelation:Правда про брата'].sort().join('|'), k4.known.map((k) => k.name).join());
  const k3 = (await characterKnowledge(repo, P, olena, 's3'))!;
  t('у флешбеку (1998) — ще не знає того, що дізнається 2024-го, хоч це розказано раніше', k3.scene.flashback && !k3.known.some((k) => k.kind === 'revelation' || k.kind === 'fact') && k3.later >= 2, JSON.stringify(k3.known));
  const k1 = (await characterKnowledge(repo, P, olena, 's1'))!;
  t('на початку книги (2024) — лише пожежа з її дитинства (1998), правди з листа ще немає', k1.known.map((k) => k.name).join() === 'Пожежа', k1.known.map((k) => k.name).join());
  await repo.deleteTimePoint(P, 'scene', 's3');
  const k3n = (await characterKnowledge(repo, P, olena, 's3'))!;
  t('без часу сцени — межа за порядком у книзі (і правило пояснено)', k3n.known.some((k) => k.kind === 'revelation') && /раніше в книзі/.test(k3n.rule));
  await put('scene', 's3', '1998');
  t('невідомий герой чи сцена — null', (await characterKnowledge(repo, P, olena, 'нема')) === null);

  // ── Маршрути ──
  console.log(`\nМаршрути хронології (${label}):`);
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false }, stranger: { id: 'u-x', role: 'writer', isGuest: false } };
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
  const g = await call('GET', '/timeline', 'reader');
  t('GET: читач бачить хронологію (без змін), флешбек позначено', g.status === 200 && g.body.canEdit === false && g.body.scenes.find((s: any) => s.sectionId === 's3').flashback);
  t('GET з фільтром героя', (await call('GET', `/timeline?character=${marko}`, 'owner')).body.scenes.length === 1);
  t('чужому — 403', (await call('GET', '/timeline', 'stranger')).status === 403);
  const p1 = await call('PUT', '/timeline/points', 'owner', { subjectKind: 'scene', subjectId: 's1', kind: 'interval', start: '2023-12', end: '2024-01' });
  t('PUT: інтервал сцени — збережено з ключами', p1.status === 200 && p1.body.point.kind === 'interval' && p1.body.point.endKey > p1.body.point.sortKey);
  t('PUT: читачу — 403', (await call('PUT', '/timeline/points', 'reader', { subjectKind: 'scene', subjectId: 's1', kind: 'exact', start: '1' })).status === 403);
  t('PUT: нерозпізнаний час — 400 з поясненням', (await call('PUT', '/timeline/points', 'owner', { subjectKind: 'scene', subjectId: 's1', kind: 'exact', start: 'колись' })).body.error?.includes('Не вдалося розпізнати'));
  t('PUT: сцени чи події немає — 404', (await call('PUT', '/timeline/points', 'owner', { subjectKind: 'scene', subjectId: 'нема', kind: 'exact', start: '1' })).status === 404 && (await call('PUT', '/timeline/points', 'owner', { subjectKind: 'event', subjectId: '00000000-0000-4000-8000-000000000000', kind: 'exact', start: '1' })).status === 404);
  t('PUT: подія — теж', (await call('PUT', '/timeline/points', 'owner', { subjectKind: 'event', subjectId: fire, kind: 'approximate', start: '1998-07', label: 'літо 1998' })).status === 200);
  t('DELETE: точку прибрано; повторно — 404', (await call('DELETE', `/timeline/points/event/${fire}`, 'owner')).body.ok === true && (await call('DELETE', `/timeline/points/event/${fire}`, 'owner')).status === 404);
  const kn = await call('GET', `/timeline/knowledge?character=${olena}&scene=s4`, 'reader');
  t('GET знання героя до сцени', kn.status === 200 && kn.body.known.some((k: any) => k.kind === 'revelation') && typeof kn.body.later === 'number');
  t('знання: без героя чи сцени — 404', (await call('GET', '/timeline/knowledge?scene=s4', 'owner')).status === 404);
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
