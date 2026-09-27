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
 * В4: правило «знання» — узагальнення `characterKnowledge()`: `timeline.ts:
 * knowledgeCandidates()` дає всіх кандидатів «герой ↔ факт» одразу («subject»
 * — офіційний момент дізнання, «present» — герой лише в сцені, де факт
 * згадано); `present` раніший за власний `subject` того самого героя й
 * факту — суперечність (`refreshKnowledgeContinuity`).
 *
 * В5: правила «місце» і «предмет» — (а) `trait_contradiction` на всіх мітках
 * рис локацій / предметів, (б) за тегами сцени: герой у двох несумісних
 * локаціях чи предмет у двох власників одночасно, без сцени переходу чи
 * передачі (`refreshPlaceContinuity` / `refreshObjectContinuity`).
 *
 * В6: AI-2 «стан світу» по розділу (задача `ai_continuity`, підставна модель):
 * що бачить модель (розділ + раніші абзаци про ті самі сутності, без
 * майбутнього), проблеми й риси — лише пропозиції з доказами; повторна
 * перевірка лише змінених місць (відбиток абзаців-доказів → `needs_review`,
 * одне сповіщення на сутність) і перегін AI-2 лише там (`changed: true`).
 *
 * В7: чернетка-симуляція (ТЗ-H) — той самий перевіряльник, що й правило
 * «знання», над текстом, якого в книзі немає: навмисний «витік знання»
 * знаходиться, у книгу й у проблеми нічого не пишеться, перевірка — в історії
 * (`continuity_draft_checks`, міграція 0014).
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
import { refreshTimeContinuity, refreshTraitContradictions, syncAgeTraitFromVersion, removeAgeTraitForVersion, refreshKnowledgeContinuity, refreshPlaceContinuity, refreshObjectContinuity, AGE_TRAIT_LABEL } from '../server/core/continuity.ts';
import { buildTimeline } from '../server/core/timeline.ts';
import { normalizeStoryTime } from '../src/utils/storyTime.ts';
import type { CoreRepository } from '../server/core/types.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import type { JobStore } from '../server/core/jobs/types.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';
import { AI_CONTINUITY_JOB_KIND, aiContinuityJobKind, continuityTask, continuityWorldState } from '../server/core/continuityAi.ts';
import { refreshContinuityReview } from '../server/core/continuity.ts';
import { checkDraftKnowledge } from '../server/core/continuityDraft.ts';

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

async function knowledgeRuleSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nПравило «знання» — Т2.4 В4 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }, { id: 'c-i', name: 'Ігор' }],
    chapters: [
      { id: 'ch1', title: 'Тоді', order: 0, sections: [
        sec('s1', 0, '[/character:Марко] [/character:Олена] [/character:Ігор] Марко пошепки натякнув на [/revelation:Таємниця @Марко], а Олена мовчки слухала.'),
        sec('s1b', 1, '[/character:Марко] [/character:Олена] Марко знову натякнув на [/revelation:Таємниця @Марко] за вечерею.'),
        sec('s1c', 2, '[/character:Марко] [/character:Олена] Марко закричав, що почався [/event:Напад @Марко], і Олена теж побігла.'),
      ] },
      { id: 'ch2', title: 'Правда', order: 1, sections: [
        sec('s2', 0, '[/character:Олена] Нарешті Олені сказали правду: [/revelation:Таємниця @Олена].'),
      ] },
      { id: 'ch3', title: 'Пізніше', order: 2, sections: [
        sec('s3', 0, '[/character:Марко] [/character:Олена] Марко ще раз згадав [/revelation:Таємниця @Марко], Олена кивнула.'),
      ] },
      { id: 'ch4', title: 'Офіційно', order: 3, sections: [
        sec('s4', 0, '[/character:Олена] Олені нарешті офіційно повідомили про [/event:Напад @Олена].'),
      ] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const igor = (await repo.resolveAlias(P, 'character', 'Ігор'))!;
  const secret = (await repo.resolveAlias(P, 'revelation', 'Таємниця'))!;
  const attack = (await repo.resolveAlias(P, 'event', 'Напад'))!;

  const r1 = await refreshKnowledgeContinuity(repo, P);
  t('КРИТЕРІЙ: 2 пари «герой+факт» з витоком (Олена: «Таємниця» і «Напад»), Ігоря й Марка не займає',
    r1.checked === 2 && r1.created === 2 && r1.issues.length === 2 && r1.issues.every((i) => i.kind === 'knowledge' && i.entityId === olena),
    JSON.stringify(r1.issues.map((i) => i.summary)));
  const secretIssue = r1.issues.find((i) => i.evidenceB!.sectionId === 's2')!;
  const attackIssue = r1.issues.find((i) => i.evidenceB!.sectionId === 's4')!;
  t('«Таємниця»: доказ А — найраніша сцена-виток (s1, дві такі), доказ Б — офіційне дізнання (s2), лічильник у описі',
    secretIssue.evidenceA.sectionId === 's1' && secretIssue.evidenceA.entityId === olena && secretIssue.evidenceB!.entityId === olena &&
    /Таємниця/.test(secretIssue.summary) && /ще 1 така сцена/.test(secretIssue.summary), secretIssue.summary);
  t('«Напад»: та сама функція ловить і звичайну подію, не лише розкриття — доказ А s1c, доказ Б s4',
    attackIssue.evidenceA.sectionId === 's1c' && attackIssue.evidenceB!.sectionId === 's4' && !/ще/.test(attackIssue.summary), attackIssue.summary);
  t('негативні приклади: Ігор (немає власного офіційного дізнання) і сцена s3 (Олена вже знає) — жодної зайвої проблеми',
    (await repo.listContinuityIssues(P, { kind: 'knowledge' })).length === 2);

  const r2 = await refreshKnowledgeContinuity(repo, P);
  t('повторний прогін — оновлює ті самі дві проблеми, не дублює', r2.created === 0 && r2.updated === 2 && (await repo.listContinuityIssues(P, { kind: 'knowledge' })).length === 2);

  await repo.setContinuityIssueStatus(P, secretIssue.id, 'dismissed', 'user:u-owner');
  const r3 = await refreshKnowledgeContinuity(repo, P);
  t('автор відхилив одну — не воскресає, друга й далі оновлюється', r3.created === 0 && r3.updated === 1 && r3.skipped >= 1 && (await repo.getContinuityIssue(P, secretIssue.id))!.status === 'dismissed');

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
  t('маршрут POST .../continuity/rules/knowledge: читачу — 403', (await call('POST', '/continuity/rules/knowledge', 'reader')).status === 403);
  const ran = await call('POST', '/continuity/rules/knowledge', 'owner');
  t('маршрут: власнику — 200', ran.status === 200 && ran.body.skipped >= 1);
  server.close();
  void igor; void attack; void secret;
}

async function placeObjectRuleSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nПравила «місце» і «предмет» — Т2.4 В5 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Сцена ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const scenes: [string, string][] = [
    ['p1', '[/character:Олена] [/location:Київ] Олена в Києві, з нею [/object:Меч @Олена].'],
    ['p2', '[/character:Олена] [/character:Марко] [/location:Львів] Олена у Львові; меч у Марка: [/object:Меч @Марко].'],
    ['p3', '[/character:Олена] [/location:Україна] Олена десь в Україні.'],
    ['p4', '[/character:Ігор] [/location:Поділ] Ігор на Подолі.'],
    ['p5', '[/character:Ігор] [/location:Київ] Ігор у Києві.'],
    ['p6', '[/character:Марко] [/location:Київ] Марко в Києві.'],
    ['p7', '[/character:Марко] [/location:Київ] [/location:Львів] Марко їде з Києва до Львова.'],
    ['p8', '[/character:Марко] [/location:Львів] Марко у Львові.'],
    ['p9', '[/character:Ігор] [/location:Київ] Ігор приблизно тоді ж у Києві.'],
    ['p10', '[/character:Ігор] [/location:Львів] Ігор у Львові.'],
    ['p11', '[/character:Олена] [/location:Київ] Олена знову в Києві.'],
    ['p12', '[/character:Олена] [/location:Львів] Олена наступного року у Львові.'],
    ['p13', '[/character:Ігор] Ігор тримав [/object:Ключ].'],
    ['p14', '[/character:Марко] Марко тримав [/object:Ключ].'],
    ['p15', 'На стіні висів [/object:Щит — дубовий — Олена].'],
    ['p16', '[/character:Марко] Марко побачив [/object:Щит — дубовий — Ігор].'],
    ['p17', '[/character:Олена] Олена віддала [/object:Ключ @Олена] Маркові: тепер [/object:Ключ @Марко].'],
    ['p18', '[/character:Марко] [/object:Ключ @Марко] у Марка.'],
    ['p19', '[/character:Олена] [/object:Ключ @Олена] знов в Олени.'],
  ];
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }, { id: 'c-i', name: 'Ігор' }],
    chapters: [{ id: 'ch1', title: 'Усе', order: 0, sections: scenes.map(([id, text], i) => sec(id, i, text)) }],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const id = async (type: string, name: string) => (await repo.resolveAlias(P, type, name))!;
  const [olena, marko, igor] = [await id('character', 'Олена'), await id('character', 'Марко'), await id('character', 'Ігор')];
  const [kyiv, lviv, ukraine, podil] = [await id('location', 'Київ'), await id('location', 'Львів'), await id('location', 'Україна'), await id('location', 'Поділ')];
  const [sword, key, shield] = [await id('object', 'Меч'), await id('object', 'Ключ'), await id('object', 'Щит')];
  const put = (sectionId: string, start: string, kind: 'exact' | 'approximate' = 'exact') => {
    const v = normalizeStoryTime({ kind, start, end: null }) as any;
    return repo.upsertTimePoint({ projectId: P, subjectKind: 'scene', subjectId: sectionId, kind: v.kind, start: v.start, end: v.end, sortKey: v.key, endKey: v.endKey, label: v.label, createdBy: 'user:u-owner' });
  };
  for (const sid of ['p1', 'p2', 'p3', 'p4', 'p5']) await put(sid, '2000-05-01');
  for (const sid of ['p6', 'p7', 'p8']) await put(sid, '2001-01-01');
  await put('p9', '2002', 'approximate');
  await put('p10', '2002');
  await put('p11', '2003');
  await put('p12', '2004');
  for (const sid of ['p13', 'p14']) await put(sid, '2005-01-01');
  for (const sid of ['p15', 'p16']) await put(sid, '2006');
  for (const sid of ['p17', 'p18', 'p19']) await put(sid, '2007');
  const rel = (type: string, fromId: string, toId: string) => repo.createRelation({ projectId: P, type, fromId, toId, evidence: [], status: 'confirmed', createdBy: 'user:u-owner' });
  await rel('part_of', podil, kyiv);
  await rel('part_of', kyiv, ukraine);
  await rel('contains', ukraine, lviv);
  // Риси: суперечність у локації й у предмета; різні мітки й риси героя — не займають.
  const trait = (entityId: string, lbl: string, value: string, sectionId: string) => repo.upsertEntityTrait({ projectId: P, entityId, label: lbl, value, sectionId, createdBy: 'user:u-owner' });
  await trait(kyiv, 'колір стін', 'білий', 'p1');
  await trait(kyiv, 'Колір стін ', 'жовтий', 'p5');
  await trait(kyiv, 'розмір', 'великий', 'p5');
  await trait(sword, 'стан', 'новий', 'p1');
  await trait(sword, 'стан', 'іржавий', 'p2');
  await trait(olena, 'колір очей', 'сірі', 'p1');
  await trait(olena, 'колір очей', 'карі', 'p3');

  // ── Місце ──
  const r1 = await refreshPlaceContinuity(repo, P);
  const placeIssues = await repo.listContinuityIssues(P, { kind: 'place' });
  const oPlace = r1.issues.find((i) => i.entityId === olena)!;
  t('КРИТЕРІЙ «місце»: Олена в Києві (p1) і у Львові (p2) того самого дня — проблема, обидва докази, «твердий» час → confirmed',
    !!oPlace && oPlace.evidenceA.sectionId === 'p1' && oPlace.evidenceB!.sectionId === 'p2' && oPlace.status === 'confirmed' &&
    /Київ/.test(oPlace.summary) && /Львів/.test(oPlace.summary) && /Києв/.test(oPlace.evidenceA.quote), `${oPlace?.status} · ${oPlace?.evidenceA.quote}`);
  const iPlace = r1.issues.find((i) => i.entityId === igor)!;
  t('В6: у проблеми правила — відбиток абзаців-доказів (повторна перевірка змінених місць)', !!oPlace?.checkedHash && r1.issues.filter((i) => i.evidenceA.paragraphId).every((i) => !!i.checkedHash) && r1.issues.filter((i) => !i.evidenceA.paragraphId).every((i) => i.checkedHash === null));
  t('приблизний час з одного боку (p9 ≈ 2002 і p10 2002) — лише пропозиція (suggested)',
    !!iPlace && iPlace.evidenceA.sectionId === 'p9' && iPlace.evidenceB!.sectionId === 'p10' && iPlace.status === 'suggested', iPlace?.summary);
  t('негативні: Україна (вкладено: part_of / contains) не суперечить ні Києву, ні Львову; Поділ у складі Києва; сцена переходу p7 знімає p6/p8; різні роки — ні',
    r1.parts.scenes.created === 2 && !r1.issues.some((i) => i.entityId === marko) &&
    !r1.issues.some((i) => [i.evidenceA.sectionId, i.evidenceB?.sectionId].some((x) => x === 'p3' || x === 'p4' || x === 'p11' || x === 'p12')),
    JSON.stringify(r1.issues.map((i) => [i.evidenceA.sectionId, i.evidenceB?.sectionId, i.kind])));
  const kyivTrait = r1.issues.find((i) => i.entityId === kyiv)!;
  t('(а) риси локації: «колір стін» Києва білий / жовтий — одна проблема (мітка без регістру й пробілів); «розмір» і риси героя — ні',
    r1.parts.traits.created === 1 && !!kyivTrait && kyivTrait.kind === 'place' && /білий/.test(kyivTrait.summary + kyivTrait.evidenceA.quote + kyivTrait.evidenceB!.quote),
    JSON.stringify(r1.parts));
  t('разом — 3 проблеми kind «place»', placeIssues.length === 3 && r1.created === 3);

  // ── Предмет ──
  const r2 = await refreshObjectContinuity(repo, P);
  const swordIssue = r2.issues.find((i) => i.entityId === sword && /власник/.test(i.summary))!;
  t('КРИТЕРІЙ «предмет»: Меч у Олени (p1) і в Марка (p2) того самого дня, обидва власники явні (@Ім\'я) — confirmed',
    !!swordIssue && swordIssue.evidenceA.sectionId === 'p1' && swordIssue.evidenceB!.sectionId === 'p2' && swordIssue.status === 'confirmed' &&
    /Олена/.test(swordIssue.summary) && /Марко/.test(swordIssue.summary), swordIssue?.summary);
  const keyIssue = r2.issues.find((i) => i.entityId === key)!;
  t('власник виведений (найближчий герой, без @) — Ключ у Ігоря й Марка (p13/p14) — лише пропозиція з підказкою «перевірте»',
    !!keyIssue && keyIssue.evidenceA.sectionId === 'p13' && keyIssue.evidenceB!.sectionId === 'p14' && keyIssue.status === 'suggested' && /перевірте/.test(keyIssue.summary),
    keyIssue?.summary);
  const shieldIssue = r2.issues.find((i) => i.entityId === shield)!;
  t('поле «власник» у тезі (Щит — дубовий — Олена / … — Ігор) важить більше за найближчого героя (Марко) — Олена проти Ігоря, confirmed',
    !!shieldIssue && shieldIssue.status === 'confirmed' && /Олена/.test(shieldIssue.summary) && /Ігор/.test(shieldIssue.summary) && !/Марко/.test(shieldIssue.summary),
    shieldIssue?.summary);
  t('сцена передачі (p17: Ключ від Олени до Марка) знімає p18/p19 того самого року; (а) «стан» Меча новий / іржавий — одна проблема',
    r2.parts.scenes.created === 3 && r2.parts.traits.created === 1 && !r2.issues.some((i) => ['p17', 'p18', 'p19'].includes(i.evidenceA.sectionId)),
    JSON.stringify(r2.issues.map((i) => [i.evidenceA.sectionId, i.evidenceB?.sectionId, i.status])));

  // ── Повторний прогін, статуси автора ──
  await repo.setContinuityIssueStatus(P, keyIssue.id, 'confirmed', 'user:u-owner');
  await repo.setContinuityIssueStatus(P, oPlace.id, 'dismissed', 'user:u-owner');
  const r3 = await refreshPlaceContinuity(repo, P);
  const r4 = await refreshObjectContinuity(repo, P);
  t('повторний прогін — оновлює, не дублює; відхилене автором не воскресає',
    r3.created === 0 && r3.updated === 2 && r3.skipped === 1 && r4.created === 0 && r4.updated === 4 &&
    (await repo.listContinuityIssues(P, { kind: 'place' })).length === 3 && (await repo.listContinuityIssues(P, { kind: 'object' })).length === 4 &&
    (await repo.getContinuityIssue(P, oPlace.id))!.status === 'dismissed', JSON.stringify([r3.parts, r4.parts]));
  t('статус, який поставив автор (Ключ: suggested → confirmed), повторний прогін не скидає', (await repo.getContinuityIssue(P, keyIssue.id))!.status === 'confirmed');
  const age = await refreshTraitContradictions(repo, P, { label: AGE_TRAIT_LABEL, kind: 'age' });
  t('правило «вік» (В3) на тій самій книзі — як і було: жодної риси «вік» — нічого', age.checked === 0 && age.created === 0);

  // ── Маршрути ──
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
  const call = async (path: string, user: string) => {
    const r = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'x-user': user } });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  t('маршрути POST .../continuity/rules/place і /object: читачу — 403',
    (await call('/continuity/rules/place', 'reader')).status === 403 && (await call('/continuity/rules/object', 'reader')).status === 403);
  const rp = await call('/continuity/rules/place', 'owner');
  const ro = await call('/continuity/rules/object', 'owner');
  t('маршрути: власнику — 200, з розкладом на «сцени» і «риси»',
    rp.status === 200 && ro.status === 200 && rp.body.parts?.scenes && rp.body.parts?.traits && ro.body.created === 0 && ro.body.updated === 4);
  server.close();
}

async function aiContinuitySuite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nAI-2 «стан світу» і повторна перевірка змінених місць — Т2.4 В6 (${label}):`);
  const prev = new Map<string, { ids: string[]; hashes: string[] }>();
  const sec = (id: string, order: number, content: string) => {
    const old = prev.get(id);
    const r = reconcileParagraphIds({ sectionId: id, content, prevIds: old?.ids, prevHashes: old?.hashes });
    prev.set(id, { ids: r.ids, hashes: r.hashes });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const s3text = (edited: boolean) =>
    `[/character:Олена] [/location:Хата] Олена повернулась до хати під солом'яним дахом${edited ? ', де все було як завжди' : ''}.\n\nЇї карі очі сльозились.`;
  const book = (edited: boolean): any => ({
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Дім', order: 0, sections: [
        sec('s1', 0, '[/character:Олена] [/location:Хата] Олена жила в хаті з червоною дахівкою.'),
        sec('s2', 1, '[/character:Марко] Марко читав.'),
      ] },
      { id: 'ch2', title: 'Повернення', order: 1, sections: [sec('s3', 0, s3text(edited))] },
      { id: 'ch3', title: 'Далі', order: 2, sections: [sec('s4', 0, '[/character:Олена] Олена поїхала з хати назавжди.')] },
    ],
  });
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book(false) });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const hut = (await repo.resolveAlias(P, 'location', 'Хата'))!;
  const [p1] = (await repo.listParagraphs(P, 's1')).map((x) => x.id);
  const [m1] = (await repo.listParagraphs(P, 's2')).map((x) => x.id);
  const [q1, q2] = (await repo.listParagraphs(P, 's3')).map((x) => x.id);
  const [f1] = (await repo.listParagraphs(P, 's4')).map((x) => x.id);
  await repo.upsertEntityTrait({ projectId: P, entityId: olena, label: 'колір очей', value: 'сірі', sectionId: 's1', createdBy: 'user:u-owner' });
  await repo.upsertEntityTrait({ projectId: P, entityId: hut, label: 'дах', value: 'червона дахівка', sectionId: 's1', createdBy: 'user:u-owner' });
  // Проблема автора поза зміненими місцями (s1/s2) — повторна перевірка її не чіпає.
  const manual = await repo.upsertContinuityIssue({ projectId: P, kind: 'place', entityId: null, summary: 'Ручна проблема автора', evidenceA: { sectionId: 's1', paragraphId: p1, quote: 'хаті', entityId: null }, evidenceB: { sectionId: 's2', paragraphId: m1, quote: 'читав', entityId: null }, createdBy: 'user:u-owner' });

  const w = (await continuityWorldState(repo, P, 's3'))!;
  t('стан світу станом на s3: абзаци розділу, раніші абзаци про ті самі сутності (s1), без чужих (s2, лише Марко) і без майбутнього (s4)',
    w.current.map((x) => x.id).join() === [q1, q2].join() && w.earlier.map((x) => x.id).join() === p1 && w.traits.length === 2,
    JSON.stringify({ cur: w.current.length, earlier: w.earlier.map((x) => x.sectionId), traits: w.traits.map((x) => x.label) }));

  const calls: AiGenerateInput[] = [];
  let answer: (user: string) => object = () => ({ findings: [] });
  const generate = async (input: AiGenerateInput) => {
    calls.push(input);
    return { text: JSON.stringify(answer(input.user)), modelId: 'fake-ai2', engine: 'fake', inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
  };
  let clock = Date.parse('2026-09-27T10:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_CONTINUITY_JOB_KIND, aiContinuityJobKind({ repo: () => repo, generate, resolveModel: async () => 'fake-ai2' }));
  const runSection = async (sectionId: string) => {
    const { job } = await q.enqueue({ projectId: P, kind: AI_CONTINUITY_JOB_KIND, payload: { sectionId }, createdBy: 'user:u-owner' });
    await q.runOnce();
    clock += 61_000;
    return (await jobStore.get(P, job.id))!;
  };
  const standard = () => ({ findings: [
    { kind: 'continuity_issue', issue_kind: 'place', entity_type: 'location', entity_name: 'Хата', summary: 'Раніше дах хати — червона дахівка, тут — солом\'яний.', paragraph_ids: [p1, q1], quote: 'під солом\'яним дахом', confidence: 0.8 },
    { kind: 'continuity_issue', issue_kind: 'age', entity_type: 'character', entity_name: 'Олена', summary: 'Вік Олени тут не узгоджується з попереднім.', paragraph_ids: [q2], confidence: 0.3, insufficient_data: true },
    { kind: 'continuity_issue', issue_kind: 'style', summary: 'Не той вид.', paragraph_ids: [p1, q1], confidence: 0.5 },
    { kind: 'continuity_issue', issue_kind: 'place', summary: 'Лише про минуле.', paragraph_ids: [p1], confidence: 0.5 },
    { kind: 'continuity_issue', issue_kind: 'place', summary: 'Посилання на майбутнє.', paragraph_ids: [f1], confidence: 0.5 },
    { kind: 'continuity_trait', entity_type: 'location', entity_name: 'Хата', label: 'дах', value: 'солом\'яний', summary: 'Дах хати солом\'яний.', paragraph_ids: [q1], quote: 'під солом\'яним дахом', confidence: 0.9 },
    { kind: 'continuity_trait', entity_type: 'character', entity_name: 'Олена', label: 'Колір очей', value: 'карі', summary: 'У Олени карі очі.', paragraph_ids: [q2], confidence: 0.9 },
    { kind: 'continuity_trait', entity_type: 'character', entity_name: 'Олена', label: 'колір очей', value: 'Сірі', summary: 'У Олени сірі очі.', paragraph_ids: [q2], confidence: 0.9 },
  ] });
  answer = standard;
  const j1 = await runSection('s3');
  const r1 = j1.result as any;
  const prompt = calls[0];
  t('AI-2 (coreAi2Analysis): у запиті — абзаци s3 і s1, риси й підказка; s2 і майбутнього s4 немає',
    prompt.module === 'coreAi2Analysis' && prompt.user.includes(`[${q1}]`) && prompt.user.includes(`[${p1}]`) && !prompt.user.includes(`[${m1}]`) && !prompt.user.includes(`[${f1}]`) &&
    prompt.user.includes('Олена: «колір очей» = «сірі»') && prompt.user.includes('continuity_issue'),
    JSON.stringify(r1 ?? j1.error));
  t('КРИТЕРІЙ: 2 проблеми (місце з двома доказами, вік — «недостатньо даних»), 2 риси; інший вид / без абзацу розділу / майбутнє / відома риса — відкинуто',
    r1?.issues === 2 && r1?.traits === 2 && r1?.rejected === 4, JSON.stringify(r1));
  const aiIssues = (await repo.listContinuityIssues(P)).filter((i) => i.source === 'ai');
  const placeAi = aiIssues.find((i) => i.kind === 'place')!;
  const ageAi = aiIssues.find((i) => i.kind === 'age')!;
  t('проблема «місце» від AI-2: suggested, джерело ai, доказ А — s1 (раніше), доказ Б — s3 з цитатою моделі, відбиток є, сутність — Хата',
    !!placeAi && placeAi.status === 'suggested' && placeAi.evidenceA.paragraphId === p1 && placeAi.evidenceB?.paragraphId === q1 &&
    placeAi.evidenceB?.quote === 'під солом\'яним дахом' && !!placeAi.checkedHash && placeAi.entityId === hut && placeAi.createdBy === 'ai:AI-2',
    JSON.stringify(placeAi));
  t('«вік» без другої сторони — insufficientData, доказу Б немає', !!ageAi && ageAi.insufficientData && ageAi.evidenceB === null && ageAi.evidenceA.paragraphId === q2);
  const traits = (await repo.listEntityTraits(P)).filter((x) => x.source === 'ai');
  t('риси від AI-2 — suggested, у розділі s3: «дах» Хати й «колір очей» Олени (карі)',
    traits.length === 2 && traits.every((x) => x.status === 'suggested' && x.sectionId === 's3') && traits.some((x) => x.entityId === hut && x.value === 'солом\'яний') && traits.some((x) => x.entityId === olena && x.value === 'карі'));

  const j2 = await runSection('s3');
  t('повторний прогін тієї ж відповіді — нічого не дублює', (j2.result as any)?.issues === 0 && (j2.result as any)?.traits === 0 &&
    (await repo.listContinuityIssues(P)).filter((i) => i.source === 'ai').length === 2 && (await repo.listEntityTraits(P)).filter((x) => x.source === 'ai').length === 2,
    JSON.stringify(j2.result));
  t('…а в запиті — «уже відомі проблеми» цього розділу', calls[1].user.includes('Уже відомі проблеми цього розділу') && calls[1].user.includes('[place]'));

  // Риса AI-2, яку підтвердив автор, живить правило (В5): «дах» Хати — дахівка / солом'яний.
  const roof = traits.find((x) => x.entityId === hut)!;
  await repo.upsertEntityTrait({ id: roof.id, projectId: P, entityId: hut, label: roof.label, value: roof.value, sectionId: 's3', status: 'confirmed', source: 'ai', createdBy: 'user:u-owner' });
  const rp = await refreshPlaceContinuity(repo, P);
  t('підтверджена риса від AI-2 → правило «місце» (а) ловить «дах»: дахівка / солом\'яний', rp.parts.traits.created === 1 && rp.issues.some((i) => i.entityId === hut && /дах/.test(i.summary)), JSON.stringify(rp.parts));

  // ── Повторна перевірка лише змінених місць ──
  const before = (await repo.listNotifications(P)).length;
  const sync2 = await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book(true) });
  const [q1b, q2b] = (await repo.listParagraphs(P, 's3')).map((x) => x.id);
  t('правка першого абзацу s3: id абзаців зберігаються (та сама пара доказів)', q1b === q1 && q2b === q2);
  const placeNow = (await repo.getContinuityIssue(P, placeAi.id))!;
  t('КРИТЕРІЙ: змінився абзац-доказ — проблема «на перегляд»; «вік» (незмінний абзац) і ручна (s1/s2) — як були',
    (sync2 as any).continuityNeedReview === 1 && placeNow.status === 'needs_review' &&
    (await repo.getContinuityIssue(P, ageAi.id))!.status === 'suggested' && (await repo.getContinuityIssue(P, manual.id))!.status === 'confirmed',
    JSON.stringify({ n: (sync2 as any).continuityNeedReview, place: placeNow.status }));
  const notes = (await repo.listNotifications(P)).filter((n) => n.kind === 'continuity_needs_review');
  t('одне сповіщення на сутність (Хата), з розділом', notes.length === 1 && (await repo.listNotifications(P)).length > before && (notes[0].payload as any).entityId === hut && (notes[0].payload as any).sectionIds.includes('s3'), JSON.stringify(notes.map((n) => n.message)));
  const again = await refreshContinuityReview(repo, P, { paragraphIds: [q1] });
  t('повторний виклик — «на перегляд» уже стоїть, нових позначок і сповіщень немає', again.flagged === 0 && again.notifications === 0);

  // ── Маршрут: перегнати AI-2 лише там, де є «на перегляд» ──
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', queue: () => q });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const post = async (body: unknown, user = 'owner') => {
    const r = await fetch(`${baseUrl}/continuity/ai`, { method: 'POST', headers: { 'x-user': user, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  t('маршрут POST .../continuity/ai: читачу — 403; без розділу — 400; невідомий розділ — 404; більше 10 — 400',
    (await post({ sectionId: 's3' }, 'reader')).status === 403 && (await post({})).status === 400 &&
    (await post({ sectionId: 'nope' })).status === 404 && (await post({ sectionIds: Array.from({ length: 11 }, (_, i) => `x${i}`) })).status === 400);
  const ch = await post({ changed: true });
  const w2 = (await continuityWorldState(repo, P, 's3'))!;
  t('у завданні проблема «на перегляд» — не «не повторювати», а «перевір знову» з тими самими абзацами',
    continuityTask(w2).includes('перевір знову') && continuityTask(w2).includes(`абзаци: ${p1}, ${q1}`));
  t('changed: true — поставлено рівно розділ з проблемою «на перегляд» (s3)', ch.status === 202 && ch.body.sections.join() === 's3' && ch.body.jobs.length === 1, JSON.stringify(ch.body));
  await q.runOnce();
  clock += 61_000;
  const j3 = (await jobStore.get(P, ch.body.jobs[0].jobId))!;
  t('AI-2 знайшов ту саму суперечність у зміненому тексті — проблему оновлено (не дубль): знову suggested, новий відбиток',
    (j3.result as any)?.refreshed === 1 && (j3.result as any)?.issues === 0 &&
    (await repo.getContinuityIssue(P, placeAi.id))!.status === 'suggested' && (await repo.getContinuityIssue(P, placeAi.id))!.checkedHash !== placeAi.checkedHash &&
    (await repo.listContinuityIssues(P)).filter((i) => i.source === 'ai').length === 2,
    JSON.stringify(j3.result ?? j3.error));
  const none = await post({ changed: true });
  t('«на перегляд» більше немає — changed: true нічого не ставить (200, порожньо)', none.status === 200 && none.body.jobs.length === 0);
  server.close();
}

async function draftCheckSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nЧернетка-симуляція: перевірка «витоку знання» — Т2.4 В7 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Сцена ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Тоді', order: 0, sections: [
        sec('s1', 0, '[/character:Марко] [/character:Олена] Марко пошепки згадав [/revelation:Таємниця @Марко], Олена не почула.'),
        sec('s1b', 1, '[/character:Олена] [/character:Марко] Почався [/event:Напад @Марко], Олена бачила все.'),
      ] },
      { id: 'ch2', title: 'Правда', order: 1, sections: [sec('s2', 0, '[/character:Олена] Олені розповіли правду: [/revelation:Таємниця @Олена].')] },
      { id: 'ch3', title: 'Далі', order: 2, sections: [
        sec('s3', 0, '[/character:Марко] Марко сам знайшов [/revelation:Скарб @Марко].'),
        sec('s4', 1, '[/character:Олена] Олена йде далі.'),
      ] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const id = async (type: string, name: string) => (await repo.resolveAlias(P, type, name))!;
  const olena = await id('character', 'Олена');
  const secret = await id('revelation', 'Таємниця');
  const issuesBefore = (await repo.listContinuityIssues(P)).length;
  const parasBefore = (await Promise.all(['s1', 's1b', 's2', 's3', 's4'].map((x) => repo.listParagraphs(P, x)))).flat().map((x) => `${x.id}:${x.text}`).join('|');

  const draft = 'Олена думала про [/revelation:Таємниця] і про напад, який бачила. А ще про [/event:Потоп].';
  const atS2 = await checkDraftKnowledge(repo, P, { characterId: olena, draftText: draft, sectionId: 's2' }) as any;
  const leak = atS2.findings?.[0];
  t('КРИТЕРІЙ ТЗ-H: чернетка станом на s2 — навмисний «витік знання»: Олена згадує «Таємницю», яку дізнається лише в s2 (тег, «дізнається пізніше»)',
    atS2.findings?.length === 1 && leak.entityId === secret && leak.kind === 'revelation' && leak.match === 'tag' && leak.reason === 'learns_later' &&
    leak.learnsAt?.sectionId === 's2' && leak.learnsAt?.via === 'subject' && /Таємниця/.test(leak.quote),
    JSON.stringify(atS2.findings));
  t('подія «Напад» за назвою в тексті — відома (Олена була присутня в s1b); тег «Потоп», якого в книзі немає, — не витік, окремим списком',
    atS2.known.join() === 'Напад' && atS2.mentioned === 2 && atS2.unknownTags.join() === 'event:Потоп', JSON.stringify({ known: atS2.known, unk: atS2.unknownTags }));
  const atS4 = await checkDraftKnowledge(repo, P, { characterId: olena, draftText: draft, sectionId: 's4' }) as any;
  t('та сама чернетка станом на s4 (після s2) — витоку немає', atS4.findings.length === 0 && atS4.known.sort().join() === ['Напад', 'Таємниця'].sort().join());
  const atS1 = await checkDraftKnowledge(repo, P, { characterId: olena, draftText: 'На початку Олена вже знала про скарб і про напад.', sectionId: 's1' }) as any;
  t('станом на s1: «Скарб» за назвою — Олена не дізнається ніколи; «Напад» — дізнається пізніше (s1b, присутня); порядок — як у тексті',
    atS1.findings.map((f: any) => `${f.entityName}:${f.reason}:${f.match}`).join() === 'Скарб:never_learns:name,Напад:learns_later:name' &&
    atS1.findings[1].learnsAt?.sectionId === 's1b' && atS1.findings[1].learnsAt?.via === 'present' && atS1.findings[0].learnsAt === null,
    JSON.stringify(atS1.findings.map((f: any) => [f.entityName, f.reason, f.match, f.learnsAt?.sectionId])));
  const atEnd = await checkDraftKnowledge(repo, P, { characterId: olena, draftText: 'Олена знала [/revelation:Таємниця] і [/revelation:Скарб].' }) as any;
  t('без сцени — кінець книги: витік лише те, чого не дізнається зовсім («Скарб»)', atEnd.scene === null && atEnd.findings.map((f: any) => f.entityName).join() === 'Скарб');
  t('розкриття, де Олена лише присутня (s1), знанням не рахується — станом на s1b «Таємниця» теж витік',
    ((await checkDraftKnowledge(repo, P, { characterId: olena, draftText: '[/revelation:Таємниця]', sectionId: 's1b' })) as any).findings.length === 1);
  t('не герой чи невідома сцена — помилка, а не порожній результат',
    ((await checkDraftKnowledge(repo, P, { characterId: secret, draftText: 'x' })) as any).error === 'no_character' &&
    ((await checkDraftKnowledge(repo, P, { characterId: olena, draftText: 'x', sectionId: 'nope' })) as any).error === 'no_section');
  const parasAfter = (await Promise.all(['s1', 's1b', 's2', 's3', 's4'].map((x) => repo.listParagraphs(P, x)))).flat().map((x) => `${x.id}:${x.text}`).join('|');
  t('у книгу нічого не записано: абзаци ті самі, проблем безперервності не додалось, «Потоп» не став сутністю',
    parasAfter === parasBefore && (await repo.listContinuityIssues(P)).length === issuesBefore && !(await repo.resolveAlias(P, 'event', 'Потоп')));

  // ── Сховище історії ──
  t('історія: порожній текст — bad_input; невідомий герой — not_found',
    (await codeAsync(() => repo.addContinuityDraftCheck({ projectId: P, characterId: olena, draftText: '  ', findings: [], createdBy: 'user:u-owner' }))) === 'bad_input' &&
    (await codeAsync(() => repo.addContinuityDraftCheck({ projectId: P, characterId: '00000000-0000-4000-8000-000000000000', draftText: 'x', findings: [], createdBy: 'user:u-owner' }))) === 'not_found');

  // ── Маршрути ──
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${baseUrl}${path}`, { method, headers: { 'x-user': user, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  t('POST check-draft: читачу — 403; без героя чи тексту — 400; задовга — 400; не герой / невідома сцена — 404',
    (await call('POST', '/continuity/check-draft', 'reader', { characterId: olena, draftText: 'x' })).status === 403 &&
    (await call('POST', '/continuity/check-draft', 'owner', { draftText: 'x' })).status === 400 &&
    (await call('POST', '/continuity/check-draft', 'owner', { characterId: olena, draftText: 'x'.repeat(20001) })).status === 400 &&
    (await call('POST', '/continuity/check-draft', 'owner', { characterId: secret, draftText: 'x' })).status === 404 &&
    (await call('POST', '/continuity/check-draft', 'owner', { characterId: olena, draftText: 'x', sectionId: 'nope' })).status === 404);
  const c1 = await call('POST', '/continuity/check-draft', 'owner', { characterId: olena, draftText: draft, sectionId: 's2' });
  t('КРИТЕРІЙ: власник перевіряє чернетку — 201, витік знайдено й збережено в історії (сцена, текст, знахідка)',
    c1.status === 201 && c1.body.check.findings.length === 1 && c1.body.check.findings[0].entityId === secret && c1.body.check.sectionId === 's2' &&
    c1.body.check.draftText === draft && c1.body.check.simulationId === null && c1.body.known.join() === 'Напад' && c1.body.check.createdBy === 'user:u-owner',
    JSON.stringify(c1.body));
  const c2 = await call('POST', '/continuity/check-draft', 'owner', { characterId: olena, draftText: 'Нічого особливого.', simulationId: 'sim-1' });
  t('перевірка без витоку — теж в історії; поле симуляції збережено (під Т2.7)', c2.status === 201 && c2.body.check.findings.length === 0 && c2.body.check.simulationId === 'sim-1');
  const h = await call('GET', `/continuity/draft-checks?characterId=${olena}`, 'owner');
  t('GET історії — новіші першими; фільтр за симуляцією; читачу — 403',
    h.status === 200 && h.body.checks.map((x: any) => x.id).join() === [c2.body.check.id, c1.body.check.id].join() &&
    (await call('GET', '/continuity/draft-checks?simulationId=sim-1', 'owner')).body.checks.map((x: any) => x.id).join() === c2.body.check.id &&
    (await call('GET', '/continuity/draft-checks', 'reader')).status === 403, JSON.stringify(h.body.checks?.map((x: any) => x.id)));
  const one = await call('GET', `/continuity/draft-checks/${c1.body.check.id}`, 'owner');
  t('GET однієї перевірки — та сама; невідома — 404', one.status === 200 && one.body.check.findings[0].reason === 'learns_later' && (await call('GET', '/continuity/draft-checks/nope', 'owner')).status === 404);
  server.close();
}

await suite('memory', new MemoryCoreRepository(), 'book-m');
await timeRuleSuite('memory', new MemoryCoreRepository(), 'book-tm');
await ageRuleSuite('memory', new MemoryCoreRepository(), 'book-am');
await knowledgeRuleSuite('memory', new MemoryCoreRepository(), 'book-km');
await placeObjectRuleSuite('memory', new MemoryCoreRepository(), 'book-pm');
await aiContinuitySuite('memory', new MemoryCoreRepository(), new MemoryJobStore(), 'book-cm');
await draftCheckSuite('memory', new MemoryCoreRepository(), 'book-dm');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — не старіша за v14 (безперервність: риси, проблеми, зв\'язок з версією зовнішності, перевірки чернеток)', Number(rows[0].v) >= 14, `v${rows[0].v}`);
    await suite('postgres', new PgCoreRepository(pool), 'book-p');
    await timeRuleSuite('postgres', new PgCoreRepository(pool), 'book-tp');
    await ageRuleSuite('postgres', new PgCoreRepository(pool), 'book-ap');
    await knowledgeRuleSuite('postgres', new PgCoreRepository(pool), 'book-kp');
    await placeObjectRuleSuite('postgres', new PgCoreRepository(pool), 'book-pp');
    await aiContinuitySuite('postgres', new PgCoreRepository(pool), new PgJobStore(pool), 'book-cp');
    await draftCheckSuite('postgres', new PgCoreRepository(pool), 'book-dp');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
