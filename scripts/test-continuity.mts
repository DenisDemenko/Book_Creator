/**
 * Безперервність — таблиці, права, критерій сторінки 8 (Т2.4 В1) і правило
 * «час» (Т2.4 В2).
 *
 * Критерій етапу В1 (PLAN_CONTINUITY.md §3): список проблем безперервності
 * зі статусами й обома доказами, автор змінює статус; риси сутностей
 * (мітка → значення) — автор вписує на картці. Фундамент: таблиці
 * (міграція 0012), `CoreRepository`, дзеркало CHECK-обмежень у `rules.ts`,
 * маршрути.
 *
 * В2: `TimelineWarning` (уже обчислює `timeline.ts` для сторінки 6) →
 * `continuity_issues` (kind: 'time') — перепаковка без нової логіки
 * виявлення (`server/core/continuity.ts: refreshTimeContinuity`).
 *
 * В3: універсальне правило `trait_contradiction` на `entity_traits` (дві
 * підтверджені риси тієї самої сутності, однакова мітка, різне значення,
 * без `supersedes` — суперечність) плюс перенесення `appearance_versions.age`
 * у рису «вік» (`syncAgeTraitFromVersion`/`refreshTraitContradictions`).
 *
 * Інші правила (місце, предмет, знання) — наступні етапи В4–В5.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:continuity
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
import { CoreRuleError, checkEntityTrait, checkContinuityIssue } from '../server/core/rules.ts';
import { refreshTimeContinuity, refreshTraitContradictions, syncAgeTraitFromVersion, removeAgeTraitForVersion, AGE_TRAIT_LABEL } from '../server/core/continuity.ts';
import { buildTimeline } from '../server/core/timeline.ts';
import { normalizeStoryTime } from '../src/utils/storyTime.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof CoreRuleError ? e.code : String(e);
  }
};
const codeAsync = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    return e instanceof CoreRuleError ? e.code : String(e);
  }
};

console.log('\nПравила рис сутностей:');
const tb = { projectId: 'p', entityId: 'e', createdBy: 'user:u', label: 'вік', value: '30' };
t('мітка й значення обов\'язкові, з межами довжини',
  code(() => checkEntityTrait({ ...tb, label: '   ' })) === 'bad_input' &&
  code(() => checkEntityTrait({ ...tb, label: 'x'.repeat(81) })) === 'bad_input' &&
  code(() => checkEntityTrait({ ...tb, value: ' ' })) === 'bad_input' &&
  code(() => checkEntityTrait({ ...tb, value: 'x'.repeat(401) })) === 'bad_input');
t('автор — confirmed/author за замовчуванням; AI — лише suggested, підтвердити зразу не можна',
  checkEntityTrait(tb).status === 'confirmed' && checkEntityTrait(tb).source === 'author' &&
  checkEntityTrait({ ...tb, createdBy: 'ai:AI-2' }).status === 'suggested' && checkEntityTrait({ ...tb, createdBy: 'ai:AI-2' }).source === 'ai' &&
  code(() => checkEntityTrait({ ...tb, createdBy: 'ai:AI-2', status: 'confirmed' })) === 'ai_suggests_only');
t('мітку й значення обрізає з пробілів', checkEntityTrait({ ...tb, label: ' вік ', value: ' 30 ' }).label === 'вік');

console.log('\nПравила проблем безперервності:');
const ci = { projectId: 'p', kind: 'age' as const, summary: 'Вік не збігається', createdBy: 'user:u', evidenceA: { sectionId: 's1', paragraphId: null, quote: 'їй було 8', entityId: 'e' } };
t('опис і доказ А обов\'язкові; невідомий вид — bad_input',
  code(() => checkContinuityIssue({ ...ci, summary: ' ' })) === 'bad_input' &&
  code(() => checkContinuityIssue({ ...ci, evidenceA: { ...ci.evidenceA, quote: ' ' } })) === 'bad_input' &&
  code(() => checkContinuityIssue({ ...ci, kind: 'ghost' as any })) === 'bad_input');
t('без доказу Б і без «недостатньо даних» — evidence_required; з позначкою — ок, insufficientData',
  code(() => checkContinuityIssue(ci)) === 'evidence_required' &&
  checkContinuityIssue({ ...ci, insufficientData: true }).insufficientData === true);
const withB = { ...ci, evidenceB: { sectionId: 's3', paragraphId: null, quote: 'їй було 30', entityId: 'e' } };
t('з обома доказами — ок, не insufficientData, автор — confirmed/rule',
  checkContinuityIssue(withB).insufficientData === false && checkContinuityIssue(withB).status === 'confirmed' && checkContinuityIssue(withB).source === 'rule');
t('AI — лише suggested; підтвердити зразу — ai_suggests_only',
  checkContinuityIssue({ ...withB, createdBy: 'ai:AI-2' }).status === 'suggested' && checkContinuityIssue({ ...withB, createdBy: 'ai:AI-2' }).source === 'ai' &&
  code(() => checkContinuityIssue({ ...withB, createdBy: 'ai:AI-2', status: 'confirmed' })) === 'ai_suggests_only');
t('доказ Б без цитати не рахується доказом — потрібна позначка',
  code(() => checkContinuityIssue({ ...ci, evidenceB: { sectionId: 's3', paragraphId: null, quote: '  ', entityId: null } })) === 'evidence_required');

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nБезперервність (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [
      { id: 'c-o', name: 'Олена' },
      { id: 'c-m', name: 'Марко' },
    ],
    chapters: [
      { id: 'ch1', title: 'Дитинство', order: 0, sections: [sec('s1', 0, '[/character:Олена] Олені було 8 років.')] },
      { id: 'ch2', title: 'Війна', order: 1, sections: [sec('s2', 0, '[/character:Олена] Олена повернулась зі шрамом.')] },
      { id: 'ch3', title: 'Мир', order: 2, sections: [sec('s3', 0, '[/character:Олена] Олені було 30 років.')] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;

  // ── Риси сутностей ──
  const age8 = await repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'вік', value: '8', sectionId: 's1', createdBy: 'user:u-owner' });
  t('риса створена: confirmed, від автора, прив\'язана до розділу', age8.status === 'confirmed' && age8.source === 'author' && age8.sectionId === 's1');
  t('список рис сутності: одна, по створенню', (await repo.listEntityTraits(P, olena)).map((r) => r.id).join() === age8.id);
  t('чужа сутність, розділ, риса-для-заміни з іншою міткою — not_found/bad_input',
    (await codeAsync(() => repo.upsertEntityTrait({ projectId: P, entityId: '00000000-0000-4000-8000-000000000000', label: 'вік', value: '1', createdBy: 'user:u' }))) === 'not_found' &&
    (await codeAsync(() => repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'вік', value: '1', sectionId: 'zzz', createdBy: 'user:u' }))) === 'not_found' &&
    (await codeAsync(() => repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'колір', value: 'руде', supersedes: age8.id, createdBy: 'user:u' }))) === 'bad_input');
  const age30 = await repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'вік', value: '30', sectionId: 's3', supersedes: age8.id, createdBy: 'user:u-owner' });
  t('заміна тією самою міткою — ок, supersedes записано', age30.supersedes === age8.id);
  const aiTrait = await repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'шрам', value: 'на щоці', sectionId: 's2', createdBy: 'ai:AI-2' });
  t('риса від AI — suggested, автор підтверджує', aiTrait.status === 'suggested' && (await repo.setEntityTraitStatus(P, aiTrait.id, 'confirmed', 'user:u-owner')).status === 'confirmed');
  t('видалення риси — true, повторно — false', (await repo.deleteEntityTrait(P, aiTrait.id)) && !(await repo.deleteEntityTrait(P, aiTrait.id)));

  // ── Проблеми безперервності ──
  const evA = { sectionId: 's1', paragraphId: null, quote: 'Олені було 8 років', entityId: olena };
  const evB = { sectionId: 's3', paragraphId: null, quote: 'Олені було 30 років', entityId: olena };
  const issue = await repo.upsertContinuityIssue({ projectId: P, kind: 'age', entityId: olena, summary: 'Вік Олени не збігається між гл.1 і гл.3', evidenceA: evA, evidenceB: evB, createdBy: 'user:u-owner' });
  t('проблема створена: suggested? ні — від автора confirmed, обидва докази збережено',
    issue.status === 'confirmed' && issue.evidenceA.quote === evA.quote && issue.evidenceB?.quote === evB.quote && issue.insufficientData === false);
  const aiIssue = await repo.upsertContinuityIssue({ projectId: P, kind: 'place', entityId: marko, summary: 'Марко в двох місцях', evidenceA: evA, insufficientData: true, createdBy: 'ai:AI-2' });
  t('проблема від AI без доказу Б, з позначкою — suggested, недостатньо даних', aiIssue.status === 'suggested' && aiIssue.insufficientData === true && aiIssue.evidenceB === null);
  t('список фільтрується за kind/status/entityId',
    (await repo.listContinuityIssues(P, { kind: 'age' })).length === 1 &&
    (await repo.listContinuityIssues(P, { status: 'suggested' })).length === 1 &&
    (await repo.listContinuityIssues(P, { entityId: marko })).length === 1 &&
    (await repo.listContinuityIssues(P)).length === 2);
  t('getContinuityIssue: своя — знаходить, чужа книга — null', (await repo.getContinuityIssue(P, issue.id))?.id === issue.id && (await repo.getContinuityIssue('інша', issue.id)) === null);
  const resolved = await repo.setContinuityIssueStatus(P, issue.id, 'resolved', 'user:u-owner');
  t('зміна статусу — resolved, невідома проблема — not_found', resolved.status === 'resolved' && (await codeAsync(() => repo.setContinuityIssueStatus(P, '00000000-0000-4000-8000-000000000000', 'resolved', 'user:u'))) === 'not_found');
  t('видалення проблеми — true, повторно — false', (await repo.deleteContinuityIssue(P, aiIssue.id)) && !(await repo.deleteContinuityIssue(P, aiIssue.id)));

  // ── Маршрути ──
  console.log(`\nМаршрути безперервності (${label}):`);
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
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${baseUrl}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  const listIssues = await call('GET', '/continuity/issues', 'reader');
  t('GET issues: читачу видно, без права змін, лишилась 1 (resolved, aiIssue видалено)', listIssues.status === 200 && listIssues.body.canEdit === false && listIssues.body.issues.length === 1);
  t('GET issues чужому — 403', (await call('GET', '/continuity/issues', 'stranger')).status === 403);
  const filtered = await call('GET', '/continuity/issues?kind=age&status=resolved', 'owner');
  t('GET issues ?kind&status — фільтрує', filtered.body.issues.length === 1 && filtered.body.issues[0].id === issue.id);
  const putBad = await call('PUT', `/continuity/issues/${issue.id}`, 'owner', { status: 'ghost' });
  t('PUT issue: поганий статус — 400; читачу — 403; невідома — 404',
    putBad.status === 400 &&
    (await call('PUT', `/continuity/issues/${issue.id}`, 'reader', { status: 'confirmed' })).status === 403 &&
    (await call('PUT', '/continuity/issues/00000000-0000-4000-8000-000000000000', 'owner', { status: 'confirmed' })).status === 404);
  const putOk = await call('PUT', `/continuity/issues/${issue.id}`, 'owner', { status: 'dismissed' });
  t('КРИТЕРІЙ: автор змінює статус проблеми — 200, dismissed', putOk.status === 200 && putOk.body.issue.status === 'dismissed');

  const getTraits = await call('GET', `/entities/${olena}/traits`, 'reader');
  t('GET traits: читачу видно, без права змін, 2 риси (age8 і age30, aiTrait видалено)', getTraits.status === 200 && getTraits.body.canEdit === false && getTraits.body.traits.length === 2);
  t('GET traits чужому — 403; невідома сутність — 404',
    (await call('GET', `/entities/${olena}/traits`, 'stranger')).status === 403 &&
    (await call('GET', '/entities/00000000-0000-4000-8000-000000000000/traits', 'reader')).status === 404);
  const mkTrait = await call('PUT', `/entities/${marko}/traits`, 'owner', { label: 'зріст', value: 'високий' });
  t('PUT traits без id — нова риса, 201, від автора, confirmed', mkTrait.status === 201 && mkTrait.body.trait.status === 'confirmed' && mkTrait.body.trait.createdBy === 'user:u-owner');
  const updTrait = await call('PUT', `/entities/${marko}/traits`, 'owner', { id: mkTrait.body.trait.id, label: 'зріст', value: 'дуже високий' });
  t('PUT traits з id — оновлення тієї самої риси', updTrait.body.trait.id === mkTrait.body.trait.id && updTrait.body.trait.value === 'дуже високий');
  t('PUT traits: читачу — 403; без мітки чи значення — 400',
    (await call('PUT', `/entities/${marko}/traits`, 'reader', { label: 'x', value: 'y' })).status === 403 &&
    (await call('PUT', `/entities/${marko}/traits`, 'owner', { label: '', value: 'y' })).status === 400);
  const delTrait = await call('DELETE', `/entities/${marko}/traits/${mkTrait.body.trait.id}`, 'owner');
  t('DELETE trait: читачу — 403; власнику — ok; повторно — 404',
    (await call('DELETE', `/entities/${marko}/traits/${mkTrait.body.trait.id}`, 'reader')).status === 403 &&
    delTrait.status === 200 && delTrait.body.ok === true &&
    (await call('DELETE', `/entities/${marko}/traits/${mkTrait.body.trait.id}`, 'owner')).status === 404);

  server.close();
}

async function timeRuleSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nПравило «час» — Т2.4 В2 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Тоді', order: 0, sections: [
        sec('s1', 0, '[/character:Олена] [/event:Пожежа] Маленька Олена бачила пожежу.'),
        sec('s2', 1, '[/character:Марко] [/event:Суд] Марко прийшов на суд.'),
      ] },
      { id: 'ch2', title: 'Спокійно', order: 1, sections: [
        sec('s3', 0, '[/character:Олена] [/event:Народження] Олена народилась.'),
        sec('s4', 1, '[/character:Олена] [/event:Весілля] Олена вийшла заміж.'),
      ] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const id = async (type: string, name: string) => (await repo.resolveAlias(P, type, name))!;
  const fire = await id('event', 'Пожежа');
  const trial = await id('event', 'Суд');
  const birth = await id('event', 'Народження');
  const wedding = await id('event', 'Весілля');
  const put = (subjectKind: 'scene' | 'event', subjectId: string, start: string) => {
    const v = normalizeStoryTime({ kind: 'exact', start, end: null }) as any;
    return repo.upsertTimePoint({ projectId: P, subjectKind, subjectId, kind: v.kind, start: v.start, end: v.end, sortKey: v.key, endKey: v.endKey, label: v.label, createdBy: 'user:u-owner' });
  };
  await put('scene', 's1', '1998');
  await put('scene', 's2', '2024');
  await put('event', trial, '2024-03-10');
  // Суперечність: «Суд» позначено як «передує» і «одночасно з» «Пожежею», і навпаки — та сама пара, три попередження (order, overlap, cycle).
  await repo.createRelation({ projectId: P, type: 'precedes', fromId: trial, toId: fire, evidence: [], status: 'confirmed', createdBy: 'user:u-owner' });
  await repo.createRelation({ projectId: P, type: 'overlaps', fromId: fire, toId: trial, evidence: [], status: 'confirmed', createdBy: 'user:u-owner' });
  await repo.createRelation({ projectId: P, type: 'follows', fromId: trial, toId: fire, evidence: [], status: 'confirmed', createdBy: 'user:u-owner' });
  // Без суперечності: «Народження» справді передує «Весіллю» (обидва — лише час сцени).
  await put('scene', 's3', '1990');
  await put('scene', 's4', '2015');
  await repo.createRelation({ projectId: P, type: 'precedes', fromId: birth, toId: wedding, evidence: [], status: 'confirmed', createdBy: 'user:u-owner' });

  const before = (await buildTimeline(repo, P)).warnings;
  t('фікстура: 3 попередження (order/overlap/cycle), усі — та сама пара «Суд»/«Пожежа»', before.length === 3 && before.every((w) => [trial, fire].every((x) => w.subjects.includes(x))), JSON.stringify(before.map((w) => w.kind)));

  const r1 = await refreshTimeContinuity(repo, P);
  t('КРИТЕРІЙ: перевірка перепаковує суперечності хронології — 3 попередження, 1 пара → 1 проблема', r1.checked === 3 && r1.created === 1 && r1.updated === 0 && r1.issues.length === 1, JSON.stringify(r1));
  const issue = r1.issues[0];
  t('проблема: kind time, rule/confirmed, обидва докази — «Суд» і «Пожежа», опис зі всіх трьох повідомлень',
    issue.kind === 'time' && issue.source === 'rule' && issue.status === 'confirmed' && issue.insufficientData === false &&
    [issue.evidenceA.entityId, issue.evidenceB?.entityId].sort().join() === [fire, trial].sort().join() &&
    /передувати/.test(issue.summary) && /одночасні/.test(issue.summary) && /Замкнене коло/.test(issue.summary), issue.summary);
  t('негативний приклад: «Народження» → «Весілля» без суперечності — жодної проблеми для цієї пари',
    (await repo.listContinuityIssues(P, { kind: 'time' })).every((i) => ![birth, wedding].every((x) => [i.evidenceA.entityId, i.evidenceB?.entityId].includes(x))));

  const r2 = await refreshTimeContinuity(repo, P);
  t('повторний прогін без змін — та сама проблема оновлюється, не дублюється', r2.created === 0 && r2.updated === 1 && r2.issues[0].id === issue.id && (await repo.listContinuityIssues(P, { kind: 'time' })).length === 1);

  await repo.setContinuityIssueStatus(P, issue.id, 'dismissed', 'user:u-owner');
  const r3 = await refreshTimeContinuity(repo, P);
  t('автор відхилив — повторний прогін не воскрешає її (skipped, не updated/created)', r3.skipped >= 1 && r3.created === 0 && r3.updated === 0 && (await repo.getContinuityIssue(P, issue.id))!.status === 'dismissed');

  // ── Маршрут ──
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string) => {
    const r = await fetch(`${baseUrl}${path}`, { method, headers: { 'x-user': user } });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  t('маршрут POST .../continuity/rules/time: читачу — 403', (await call('POST', '/continuity/rules/time', 'reader')).status === 403);
  const ran = await call('POST', '/continuity/rules/time', 'owner');
  t('маршрут: власнику — 200, той самий результат (dismissed лишається пропущеним)', ran.status === 200 && ran.body.skipped >= 1 && ran.body.created === 0);
  server.close();
}

async function ageRuleSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\ntrait_contradiction і риса «вік» — Т2.4 В3 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Гл.1', order: 0, sections: [sec('s1', 0, '[/character:Олена] Олена мала 8 років.')] },
      { id: 'ch2', title: 'Гл.2', order: 1, sections: [sec('s2', 0, '[/character:Марко] Марко саме одружувався.')] },
      { id: 'ch3', title: 'Гл.3', order: 2, sections: [sec('s3', 0, '[/character:Олена] [/character:Марко] Обидва вже дорослі.')] },
      { id: 'ch4', title: 'Гл.4', order: 3, sections: [sec('s4', 0, '[/character:Марко] Марко постарів.')] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;

  // Олена: дві версії з НЕ перетинними главами — природне дорослішання, не суперечність.
  const oChild = await repo.upsertAppearanceVersion({ projectId: P, entityId: olena, label: 'дитинство', age: '8', fromChapter: 1, toChapter: 1, createdBy: 'user:u-owner' });
  await syncAgeTraitFromVersion(repo, P, oChild);
  const oAdult = await repo.upsertAppearanceVersion({ projectId: P, entityId: olena, label: 'дорослість', age: '30', fromChapter: 3, createdBy: 'user:u-owner' });
  await syncAgeTraitFromVersion(repo, P, oAdult);
  const oTraits = await repo.listEntityTraits(P, olena);
  t('дві похідні риси «вік» для Олени, з розділом і значенням версії', oTraits.length === 2 && oTraits.every((tr) => tr.label === AGE_TRAIT_LABEL) && oTraits.some((tr) => tr.value === '8' && tr.sectionId === 's1') && oTraits.some((tr) => tr.value === '30' && tr.sectionId === 's3'));
  const oAdultTrait = oTraits.find((tr) => tr.value === '30')!;
  const oChildTrait = oTraits.find((tr) => tr.value === '8')!;
  t('глави не перетинаються — пізніша supersedes ранішу автоматично', oAdultTrait.supersedes === oChildTrait.id);

  // Марко: дві версії з перетинними главами (2–4 і 1–3) і різним віком — справжня суперечність.
  const mYoung = await repo.upsertAppearanceVersion({ projectId: P, entityId: marko, label: 'молодість', age: '20', fromChapter: 1, toChapter: 3, createdBy: 'user:u-owner' });
  await syncAgeTraitFromVersion(repo, P, mYoung);
  const mOld = await repo.upsertAppearanceVersion({ projectId: P, entityId: marko, label: 'старість', age: '60', fromChapter: 2, toChapter: 4, createdBy: 'user:u-owner' });
  await syncAgeTraitFromVersion(repo, P, mOld);
  const mTraits = await repo.listEntityTraits(P, marko);
  const mYoungTrait = mTraits.find((tr) => tr.value === '20')!;
  const mOldTrait = mTraits.find((tr) => tr.value === '60')!;
  t('глави перетинаються — supersedes НЕ ставиться автоматично', mOldTrait.supersedes === null && mYoungTrait.supersedes === null);

  const r1 = await refreshTraitContradictions(repo, P, { label: AGE_TRAIT_LABEL, kind: 'age' });
  t('КРИТЕРІЙ: суперечність віку — та сама риса, різне значення, без supersedes — 1 проблема (Марко), Олену не займає', r1.created === 1 && r1.issues[0].entityId === marko && r1.issues[0].kind === 'age' && r1.issues[0].insufficientData === false, JSON.stringify(r1.issues));

  const r2 = await refreshTraitContradictions(repo, P, { label: AGE_TRAIT_LABEL, kind: 'age' });
  t('повторний прогін — оновлює ту саму проблему, не дублює', r2.created === 0 && r2.updated === 1 && (await repo.listContinuityIssues(P, { kind: 'age' })).length === 1);

  await repo.setContinuityIssueStatus(P, r1.issues[0].id, 'dismissed', 'user:u-owner');
  const r3 = await refreshTraitContradictions(repo, P, { label: AGE_TRAIT_LABEL, kind: 'age' });
  t('автор відхилив — не воскресає', r3.created === 0 && r3.updated === 0 && r3.skipped >= 1);

  // Автор явно позначає «це заміна» через supersedes — суперечність зникає, попри перетин.
  await repo.upsertEntityTrait({ id: mOldTrait.id, projectId: P, entityId: marko, label: mOldTrait.label, value: mOldTrait.value, supersedes: mYoungTrait.id, createdBy: 'user:u-owner' });
  const r4 = await refreshTraitContradictions(repo, P, { label: AGE_TRAIT_LABEL, kind: 'age' });
  t('явний supersedes від автора — правило більше не бачить суперечності (те, що вже dismissed, тут не рахується)', r4.checked === 0);
  await repo.upsertEntityTrait({ id: mOldTrait.id, projectId: P, entityId: marko, label: mOldTrait.label, value: mOldTrait.value, supersedes: null, createdBy: 'user:u-owner' });

  // Універсальність правила: та сама функція на довільній мітці (В5 — «предмет»/«місце» пізніше).
  await repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'колір волосся', value: 'руде', sectionId: 's1', createdBy: 'user:u-owner' });
  await repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'колір волосся', value: 'чорне', sectionId: 's3', createdBy: 'user:u-owner' });
  const r5 = await refreshTraitContradictions(repo, P, { label: 'колір волосся', kind: 'object' });
  t('та сама функція, інша мітка й kind — теж ловить суперечність', r5.created === 1 && r5.issues[0].kind === 'object' && r5.issues[0].entityId === olena);

  // Видалення версії знімає похідну рису й перелаштовує ланцюжок.
  await repo.deleteAppearanceVersion(P, oChild.id, 'user:u-owner');
  await removeAgeTraitForVersion(repo, P, olena, oChild.id);
  const oTraitsAfter = await repo.listEntityTraits(P, olena);
  const oAdultAfter = oTraitsAfter.find((tr) => tr.appearanceVersionId === oAdult.id);
  t('версію видалено — її риса зникла разом з нею, у решти supersedes знято', !oTraitsAfter.some((tr) => tr.appearanceVersionId === oChild.id) && oAdultAfter?.supersedes === null);

  // ── Маршрут і наскрізна синхронізація через POST/PATCH/DELETE версії ──
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${baseUrl}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  t('маршрут POST .../continuity/rules/age: читачу — 403', (await call('POST', '/continuity/rules/age', 'reader')).status === 403);
  const ranAge = await call('POST', '/continuity/rules/age', 'owner');
  t('маршрут: власнику — 200', ranAge.status === 200);

  const mk = await call('POST', `/visual/appearance/${marko}`, 'owner', { label: 'дитинство', age: '5', fromChapter: 1, toChapter: 1 });
  t('POST версії через маршрут — одразу створює похідну рису «вік»', mk.status === 201 && (await repo.listEntityTraits(P, marko)).some((tr) => tr.appearanceVersionId === mk.body.version.id && tr.value === '5'));
  const vid = mk.body.version.id;
  await call('PATCH', `/visual/appearance/${marko}/versions/${vid}`, 'owner', { age: '6' });
  t('PATCH віку через маршрут — оновлює ту саму рису, не створює нову', (await repo.listEntityTraits(P, marko)).filter((tr) => tr.appearanceVersionId === vid).length === 1 && (await repo.listEntityTraits(P, marko)).find((tr) => tr.appearanceVersionId === vid)?.value === '6');
  await call('DELETE', `/visual/appearance/${marko}/versions/${vid}`, 'owner');
  t('DELETE версії через маршрут — прибирає похідну рису', !(await repo.listEntityTraits(P, marko)).some((tr) => tr.appearanceVersionId === vid));
  server.close();
}

await suite('memory', new MemoryCoreRepository(), 'book-m');
await timeRuleSuite('memory', new MemoryCoreRepository(), 'book-tm');
await ageRuleSuite('memory', new MemoryCoreRepository(), 'book-am');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — не старіша за v13 (безперервність: риси, проблеми, зв\'язок з версією зовнішності)', Number(rows[0].v) >= 13, `v${rows[0].v}`);
    await suite('postgres', new PgCoreRepository(pool), 'book-p');
    await timeRuleSuite('postgres', new PgCoreRepository(pool), 'book-tp');
    await ageRuleSuite('postgres', new PgCoreRepository(pool), 'book-ap');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
