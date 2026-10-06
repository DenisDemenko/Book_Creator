import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { analyzeCausality, refreshCausalityContinuity, parseCausalityPolicy } from '../server/core/causality.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { randomUUID } from 'node:crypto';
import type { CoreRepository } from '../server/core/types.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { createCorePool } from '../server/core/index.ts';
import { runMigrations, loadMigrations, resolveMigrationsDir } from '../server/core/migrate.ts';
async function suite(repo: CoreRepository) {
const P = `causality-${randomUUID()}`;
const sec = (id: string, content: string, order: number) => { const r = reconcileParagraphIds({ sectionId: id, content }); return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes }; };
const book: any = { id: P, title: 'Доказ Анни', characters: [{ id: 'a', name: 'Анна' }, { id: 's', name: 'Сергій' }], chapters: [{ id: 'chapter', title: 'Доказ', order: 0, sections: [
  sec('hidden', '[/character:Анна] [/event:Анна приховала доказ @Анна] Анна сховала лист.', 0),
  sec('notice', '[/character:Сергій] [/decision:Сергій помічає суперечність @Сергій] Сергій вирішив шукати лист.', 1),
  sec('investigation', '[/character:Сергій] [/decision:Розслідування @Сергій] Сергій почав розслідування.', 2),
  sec('collision', '[/character:Сергій] [/event:Нове зіткнення @Сергій] Сергій зустрів Анну.', 3),
  sec('revealed', '[/character:Сергій] [/revelation:Місце листа @Сергій] Анна розкрила схованку.', 4),
] }] };
await syncBookToCore(repo, { id: P, ownerId: 'owner', title: book.title, book });
const entities = await repo.listEntities(P);
const entity = (name: string) => { const e = entities.find(e => e.name === name); assert.ok(e, name); return e!; };
const hidden = entity('Анна приховала доказ'), notice = entity('Сергій помічає суперечність'), investigation = entity('Розслідування'), collision = entity('Нове зіткнення'), fact = entity('Місце листа');
let passed = 0;
const check = (name: string, fn: () => unknown) => { fn(); console.log(`✓ ${name}`); passed++; };
const link = (fromId: string, toId: string, type = 'leads_to', status: 'confirmed' | 'suggested' = 'confirmed') => repo.createRelation({ projectId: P, fromId, toId, type, status, createdBy: 'user:owner' });
const policy = async (id: string, p: unknown) => { const e = (await repo.getEntity(P, id))!; await repo.updateEntity(P, id, { canonical: { ...e.canonical, causality: parseCausalityPolicy(p) } }, 'user:owner'); };
const original = JSON.stringify(await repo.listAllParagraphs(P));
let r = await analyzeCausality(repo, P);
check('перехід без причини має попередження та два місця джерел', () => assert.ok(r.warnings.find(w => w.code === 'missing_cause' && w.entityId === notice.id && w.evidenceB?.sectionId === 'hidden')));
await link(notice.id, hidden.id, 'caused_by');
await link(notice.id, investigation.id, 'triggers');
await link(investigation.id, collision.id);
r = await analyzeCausality(repo, P, { entityIds: [hidden.id] });
check('напрям caused_by обернений; залежності транзитивні', () => assert.deepEqual(new Set(r.dependencies), new Set([hidden.id, notice.id, investigation.id, collision.id])));
r = await analyzeCausality(repo, P);
check('ланцюжок Анна → суперечність → розслідування → зіткнення має причини', () => assert.equal(r.warnings.filter(w => w.code === 'missing_cause').length, 0));
await policy(investigation.id, { requiresKnowledge: [fact.id] });
r = await analyzeCausality(repo, P);
check('дія без знання: доказ дії й пізнього розкриття', () => { const w = r.warnings.find(w => w.code === 'knowledge'); assert.equal(w?.evidenceA.sectionId, 'investigation'); assert.equal(w?.evidenceB?.sectionId, 'revealed'); });
await policy(investigation.id, { requiresKnowledge: [fact.id], exception: 'false_belief' });
r = await analyzeCausality(repo, P);
check('хибне припущення дозволене, факт не записано в канон', () => assert.equal(r.warnings.filter(w => w.code === 'knowledge').length, 0));
await policy(investigation.id, { requiresKnowledge: [fact.id] });
const backwards = await link(collision.id, hidden.id);
r = await analyzeCausality(repo, P);
check('причина після наслідку і причинне коло знаходяться', () => { assert.ok(r.warnings.some(w => w.code === 'cause_after_effect')); assert.ok(r.warnings.some(w => w.code === 'cycle')); });
await repo.setRelationStatus(P, backwards.id, 'rejected', 'user:owner');
const prevented = await link(hidden.id, investigation.id, 'prevents');
r = await analyzeCausality(repo, P);
check('перешкода дає попередження, а не заборону', () => assert.ok(r.warnings.some(w => w.code === 'prevented_event')));
await repo.setRelationStatus(P, prevented.id, 'rejected', 'user:owner');
await repo.upsertEntityTrait({ projectId: P, entityId: entity('Анна').id, label: 'очі', value: 'зелені', sectionId: 'hidden', createdBy: 'user:owner' });
await policy(collision.id, { claims: [{ entityId: entity('Анна').id, label: 'очі', value: 'сині' }] });
r = await analyzeCausality(repo, P);
check('твердження події звіряється із затвердженою рисою', () => assert.ok(r.warnings.some(w => w.code === 'canon_conflict')));
const saved = await refreshCausalityContinuity(repo, P);
check('причинність лише пропозицією на сторінці безперервності', () => assert.ok(saved.issues.length && saved.issues.every(i => i.kind === 'causality' && i.status === 'suggested')));
const repeated = await refreshCausalityContinuity(repo, P);
check('повторна перевірка не створює дублів', () => assert.equal(repeated.created, 0));
await repo.setContinuityIssueStatus(P, saved.issues[0].id, 'dismissed', 'user:owner');
await refreshCausalityContinuity(repo, P);
const dismissed = await repo.getContinuityIssue(P, saved.issues[0].id);
check('відхилення автора збережене після повторної перевірки', () => assert.equal(dismissed?.status, 'dismissed'));
const after = JSON.stringify(await repo.listAllParagraphs(P));
check('рукопис і його версії не змінені аналізом', () => assert.equal(after, original));
await policy(investigation.id, {});
await policy(collision.id, {});
await refreshCausalityContinuity(repo, P);
const stale = await repo.listContinuityIssues(P);
check('усунуті причини попереджень потребують рішення автора', () => assert.ok(stale.some(i => i.status === 'needs_review')));
await assert.rejects(() => analyzeCausality(repo, P, { entityIds: ['foreign'] }), /підтвердженому канону/);
passed++; console.log('✓ чужа сутність не читається');
check('невалідні винятки та поля відхиляються', () => { assert.throws(() => parseCausalityPolicy({ exception: 'anything' })); assert.throws(() => parseCausalityPolicy({ requiresKnowledge: 'secret' })); });
await policy(investigation.id, { requiresKnowledge: [fact.id] });
await repo.upsertDocument({ projectId: P, id: 'revealed', kind: 'section', parentId: 'chapter', title: 'revealed', order: 1 });
r = await analyzeCausality(repo, P);
check('доказ раннього розкриття знімає помилку знання', () => assert.equal(r.warnings.filter(w => w.code === 'knowledge').length, 0));
await repo.upsertDocument({ projectId: P, id: 'revealed', kind: 'section', parentId: 'chapter', title: 'revealed', order: 4 });
r = await analyzeCausality(repo, P, { entityIds: [hidden.id] });
check('перевірка зміненої причини включає залежні рішення', () => assert.ok(r.warnings.some(w => w.code === 'knowledge' && w.entityId === investigation.id)));
await policy(investigation.id, {});

const app = express(); app.use(express.json());
app.use((req, _res, next) => { const id = String(req.headers['x-user'] ?? ''); (req as any).principal = { id: id || null, role: 'writer', isGuest: !id }; next(); });
registerProjectRoutes(app, { repo: () => repo, coreState: () => 'ready', access: { async getBookOwnerId(id) { return id === P ? 'owner' : null; }, async getCollabOwnerId() { return undefined; }, async listAcceptedInvites() { return [{ acceptedUserId: 'reader', role: 'reader' }]; } } });
const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
const call = async (path: string, user: string, body: unknown = {}, method = 'POST') => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-user': user }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
try {
  const view = await call('/causality/check', 'reader');
  check('читач має read-only перевірку', () => assert.equal(view.status, 200));
  const outsider = await call('/causality/check', 'outsider');
  const guest = await call('/causality/check', '');
  check('чужий і гість не отримують граф чи докази', () => { assert.equal(outsider.status, 403); assert.equal(guest.status, 401); });
  const denied = await call('/continuity/rules/causality', 'reader');
  check('читач не записує проблеми', () => assert.equal(denied.status, 403));
  const invalid = await call('/causality/check', 'owner', { entityIds: 'wrong' });
  check('API відхиляє неправильний фільтр', () => assert.equal(invalid.status, 400));
  const bad = await call(`/causality/entities/${notice.id}/policy`, 'owner', { requiresKnowledge: ['foreign'] }, 'PUT');
  const ok = await call(`/causality/entities/${notice.id}/policy`, 'owner', { exception: 'mystery' }, 'PUT');
  check('політика автора зберігає виняток, не допускає чужі ID', () => { assert.equal(bad.status, 400); assert.equal(ok.status, 200); assert.equal(ok.body.policy.exception, 'mystery'); });
  const run = await call('/continuity/rules/all', 'owner');
  check('кнопка всіх правил включає причинність', () => { assert.equal(run.status, 200); assert.ok(run.body.rules.causality); });
  if (process.argv.includes('--browser')) {
    const { build } = await import('esbuild');
    const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ContinuityPage from './src/components/ContinuityPage'; createRoot(document.getElementById('root')).render(<ContinuityPage book={${JSON.stringify(book)}} onOpenParagraph={p=>{window.openedParagraph=p}}/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic' });
    app.get('/probe.js', (_req, res) => res.type('application/javascript').send(bundle.outputFiles[0].text));
    app.get('/probe', (_req, res) => res.send('<html lang="uk"><meta charset="utf-8"><body style="background:#111827;color:white"><div id="root"></div><script type="module" src="/probe.js"></script></body></html>'));
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ 'x-user': 'owner' });
      await page.goto(base.replace(`/api/projects/${P}`, '/probe'));
      await page.waitForSelector('[data-continuity-tab="causality"]');
      await page.click('[data-continuity-tab="causality"]');
      await page.waitForSelector(`[data-causality-event] option[value="${notice.id}"]`);
      await page.select('[data-causality-event]', notice.id);
      await page.waitForSelector('[data-causality-exception]');
      await page.select('[data-causality-exception]', '');
      await page.evaluate((name: string) => { const label = [...document.querySelectorAll('[data-causality-policy] label')].find(l => l.textContent?.trim() === name); const box = label?.querySelector('input'); if (!box) throw new Error('Knowledge checkbox missing'); box.click(); }, fact.name);
      await page.click('[data-causality-save]');
      await page.waitForFunction(() => document.querySelector('[data-causality-policy] [role="status"]')?.textContent?.includes('Збережено'));
      const fromUi = (await repo.getEntity(P, notice.id))!;
      check('БРАУЗЕР: автор задає потрібне знання, правило збережено', () => assert.ok((fromUi.canonical.causality as any).requiresKnowledge.includes(fact.id)));
      await page.click('[data-continuity-tab="issues"]');
      await page.waitForSelector('[data-cont-run-rules]');
      await page.click('[data-cont-run-rules]');
      await page.waitForSelector('[data-cont-issue-kind="causality"]');
      await page.click('[data-cont-kind="causality"]');
      const content = await page.$eval('[data-cont-issues-tab]', e => e.textContent);
      check('БРАУЗЕР: причинність показує обидва джерела й фільтр', () => { assert.match(content!, /Місце листа/); assert.match(content!, /Сергій/); });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: `/tmp/causality-${repo.kind}.png`, fullPage: true });
      console.log(`Screenshot: /tmp/causality-${repo.kind}.png`);
    } finally { await browser.close(); }
  }
} finally { await new Promise<void>(r => server.close(() => r())); }
console.log(`Підсумок: ${passed} пройшло.`);
}
await suite(new MemoryCoreRepository());
if (process.env.CORE_TEST_DATABASE_URL) {
  const pool = createCorePool(process.env.CORE_TEST_DATABASE_URL);
  try { await runMigrations(pool, loadMigrations(resolveMigrationsDir())); await suite(new PgCoreRepository(pool)); }
  finally { await pool.end(); }
} else console.log('PostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано).');
