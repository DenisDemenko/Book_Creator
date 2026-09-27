/**
 * Безперервність — таблиці, права, критерій сторінки 8 — Т2.4 В1 (журнал #TBD).
 *
 * Критерій етапу (PLAN_CONTINUITY.md §3 В1): список проблем безперервності
 * зі статусами й обома доказами, автор змінює статус; риси сутностей
 * (мітка → значення) — автор вписує на картці. Правила самі (час, вік,
 * місце, предмет, знання) — наступні етапи В2–В5; тут — лише фундамент:
 * таблиці (міграція 0012), `CoreRepository`, дзеркало CHECK-обмежень у
 * `rules.ts`, маршрути.
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

await suite('memory', new MemoryCoreRepository(), 'book-m');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — не старіша за v12 (безперервність: риси, проблеми)', Number(rows[0].v) >= 12, `v${rows[0].v}`);
    await suite('postgres', new PgCoreRepository(pool), 'book-p');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
