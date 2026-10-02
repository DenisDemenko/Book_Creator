/**
 * Живий прогін Story Core і вкладки «Граф твору» Graph Studio (Т5.3 В4,
 * `PLAN_STORY_CORE.md`; ТЗ Graph Studio §23–25, §33, №13–16, 18). Запуск:
 * CORE_TEST_DATABASE_URL=postgres://… npm run live:story-core (потрібен
 * зібраний dist/server.mjs і Chrome/Chromium; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер:
 *   (1) API: книги за доступом (адмін — усі, власниця — своя з CANON_WRITE,
 *       редактор — пропонує без схвалення); операції §33; довільної немає;
 *   (2) вкладка «Граф твору»: вибір книги, вузли — справжні сутності (№18),
 *       фільтри групи, стану й джерела;
 *   (3) пропозиція ШІ з процесу: походження (процес, модель, промпт, Jev),
 *       перевірка, схвалення з правкою автора, запис у канон (№14–16);
 *   (4) ручна пропозиція зв'язку з форми → перевірка щодо онтології →
 *       схвалення й канон → ребро на графі з карткою походження;
 *   (5) пропозиція AI-1 старого шляху поруч — підтвердження;
 *   (6) телефон 390 px.
 *
 * Пастка (log.md #172): у page.evaluate — лише рядки або стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL.');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-live-story-core');
const PORT = Number(process.env.STORY_CORE_PORT || 34379);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'book-live-story-core';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Pool({ connectionString: DB_URL });
await db.query('DROP SCHEMA IF EXISTS fusion_core CASCADE');
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const waitFor = async <T,>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30000): Promise<T> => {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) { await sleep(400); v = await fn(); }
  return v;
};

const { initStore, saveUser, createSession } = await import('../server/store');
const { initialBookData } = await import('../src/data/initialBook');
await initStore();
const now = new Date().toISOString();
const TOK: Record<string, string> = {};
for (const [id, role, name] of [['u-admin', 'admin', 'Адмін'], ['u-owner', 'writer', 'Авторка'], ['u-ed', 'writer', 'Редактор'], ['u-x', 'writer', 'Чужий']] as const) {
  await saveUser({ id, email: `${id}@story.test`, name, role, createdAt: now } as any);
  TOK[id] = crypto.randomBytes(24).toString('hex');
  await createSession({ token: TOK[id], userId: id, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });
}

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ROLE_ONBOARDING: 'off', ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, APP_URL: BASE, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));
process.on('exit', () => { try { child.kill(); } catch { /* */ } });
let health: any = null;
for (let i = 0; i < 120 && health?.core !== 'ready'; i++) {
  try { health = await (await fetch(`${BASE}/api/health`)).json(); } catch { /* */ }
  if (health?.core !== 'ready') await sleep(500);
}
if (health?.core !== 'ready') { console.error(log.join('').slice(-3000)); child.kill(); process.exit(1); }
const api = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${TOK[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const op = (name: string, who: string, args: Record<string, unknown> = {}, projectId: string | undefined = BOOK) => api('POST', `/api/core/story-core/call/${name}`, who, { projectId, args });

// Книга власниці → синхронізація з ядром (герої й абзаци).
const FULL: any = JSON.parse(JSON.stringify({ ...initialBookData, id: BOOK, title: 'Маяк', updatedAt: new Date(Date.now() - 60_000).toISOString() }));
await api('PUT', `/api/books/${BOOK}`, 'u-owner', { book: FULL });
const chars = await waitFor(() => q(`SELECT id, name FROM fusion_core.entities WHERE project_id = $1 AND type = 'character' ORDER BY name`, [BOOK]), (r) => r.length >= 3, 40000);
const paras = await waitFor(() => q(`SELECT id FROM fusion_core.paragraphs WHERE project_id = $1 AND deleted_at IS NULL AND kind = 'paragraph' ORDER BY ord LIMIT 5`, [BOOK]), (r) => r.length >= 2, 40000);
await waitFor(() => q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND status IN ('queued', 'running')`, [BOOK]), (r) => Number(r[0]?.n) === 0, 90000);
const [A, B, C] = chars;
await api('POST', `/api/core/projects/${BOOK}/participants/roles`, 'u-owner', { userId: 'u-ed', roleId: 'translator' });
const gr = await api('POST', `/api/core/projects/${BOOK}/access`, 'u-owner', { userId: 'u-ed', level: 'edit', scopeType: 'book' });
// Пропозиція AI-1 старого шляху (suggested-зв'язок) і пропозиція процесу ШІ в новому реєстрі (Т5.4 писатиме так само).
const [legacyRel] = await q(`INSERT INTO fusion_core.entity_relations (project_id, type, from_id, to_id, status, evidence, created_by) VALUES ($1, 'follows', $2, $3, 'suggested', $4, 'ai:AI-1') RETURNING id`, [BOOK, B.id, A.id, [paras[0].id]]);
const [aiProp] = await q(`INSERT INTO fusion_core.story_proposals (project_id, kind, state, payload, dedupe_key, evidence, confidence, provenance, created_by)
  VALUES ($1, 'entity', 'proposed', $2, 'entity:location:старий маяк', $3, 0.74, $4, 'ai:AI-1') RETURNING id`,
  [BOOK, JSON.stringify({ type: 'location', name: 'Старий маяк', canonical: {} }), [paras[1].id], JSON.stringify({ source: 'workflow', workflowId: 'canon_pipeline', workflowVersion: 2, nodeId: 'extract', model: 'gemini-2.5-flash', promptVersion: 'extract-v4', ontologyVersion: 1, jevDecisions: [{ node: 'decide', choice: 'propose', score: 0.74 }] })]);
await q(`INSERT INTO fusion_core.story_proposal_events (project_id, proposal_id, action, actor, to_state) VALUES ($1, $2, 'create', 'ai:AI-1', 'proposed')`, [BOOK, aiProp.id]);

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors: string[] = [];

try {
  console.log('(1) Story Core API і права:');
  t('книгу синхронізовано: герої й абзаци в ядрі', chars.length >= 3 && paras.length >= 2, chars.map((c: any) => c.name).join(', '));
  t('редактору надано редагування книги', gr.status === 201, `${gr.status} ${gr.body.error ?? ''}`);
  const adm = await api('GET', '/api/core/story-core/projects', 'u-admin');
  t('адмін: книга в переліку з CANON_WRITE і відкритою пропозицією', adm.body.projects?.some((p: any) => p.id === BOOK && p.rights.approve && p.openProposals.proposed === 1), JSON.stringify(adm.body).slice(0, 200));
  const own = await api('GET', '/api/core/story-core/projects', 'u-owner');
  t('власниця: своя книга, CANON_WRITE', own.body.projects?.length === 1 && own.body.projects[0].isOwner && own.body.projects[0].rights.approve);
  const ed = await api('GET', '/api/core/story-core/projects', 'u-ed');
  t('редактор: пропонує, але не записує в канон', ed.body.projects?.[0]?.rights.propose === true && ed.body.projects[0].rights.approve === false);
  t('чужий: порожньо й 403 на операцію', (await api('GET', '/api/core/story-core/projects', 'u-x')).body.projects?.length === 0 && (await op('get_graph', 'u-x')).status === 403);
  const opsList = await api('GET', '/api/core/story-core/ops', 'u-ed');
  t('16 операцій §33 (+ читальні для студії); довільної немає (№13)', ['get_schema', 'search_entities', 'get_sources', 'create_relation_proposal', 'write_canon', 'rollback_schema'].every((id) => opsList.body.ops.some((o: any) => o.id === id)) && (await op('raw_sql', 'u-admin', { sql: 'select 1' })).status === 404);
  const edProp = await op('create_relation_proposal', 'u-ed', { type: 'opposes', fromId: C.id, toId: A.id, note: 'суперечка редактора' });
  t('редактор пропонує зв\'язок — перевірено одразу', edProp.status === 200 && edProp.body.result.proposal.state === 'validated', `${edProp.status} ${edProp.body.error ?? JSON.stringify(edProp.body.result?.proposal?.validation?.errors)}`);
  t('…але не схвалює (403 decide)', (await op('approve_proposal', 'u-ed', { proposalId: edProp.body.result?.proposal?.id })).body.permission === 'decide');

  console.log('(2) Вкладка «Граф твору»:');
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  await page.setCookie({ name: 'nova_session', value: TOK['u-admin'], domain: 'localhost', path: '/' });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/admin/graph-studio/story-graph`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-gs-story-book]', { timeout: 40000 });
  await page.waitForSelector('.react-flow__node', { timeout: 30000 }).catch(() => null);
  await sleep(1200);
  t('вибір книги: книга ядра в переліку', (await page.$$eval('[data-gs-story-book] option', (os) => os.map((o) => (o as HTMLOptionElement).value))).includes(BOOK));
  const ids = await page.$$eval('.react-flow__node', (ns) => ns.map((n) => n.getAttribute('data-id')));
  const entCount = (await q(`SELECT count(*)::int AS n FROM fusion_core.entities WHERE project_id = $1 AND status <> 'rejected'`, [BOOK]))[0].n;
  t('вузли — справжні сутності ядра (№18)', chars.every((c: any) => ids.includes(c.id)) && ids.length <= entCount, `${ids.length} вузлів з ${entCount}`);
  t('права в шапці: CANON_WRITE', (await page.$eval('[data-gs-story-canon-write]', (e) => e.getAttribute('data-gs-story-canon-write'))) === 'yes');
  const hasEdge = (id: string) => page.$(`.react-flow__edge[data-id="${id}"]`).then((e) => !!e);
  t('ребро пропозиції AI-1 на графі (запропоноване)', await hasEdge(legacyRel.id));
  t('ребро відкритої пропозиції реєстру — пунктиром поверх графа', await hasEdge(`proposal:${edProp.body.result.proposal.id}`));
  await page.click('[data-gs-story-source="ai"]');
  await sleep(500);
  t('фільтр джерела: без AI-1 — ребра немає', !(await hasEdge(legacyRel.id)));
  await page.click('[data-gs-story-source="ai"]');
  await page.click('[data-gs-story-state="confirmed"]');
  await sleep(1500);
  t('фільтр стану: лише підтверджені — без пропозицій AI-1', !(await hasEdge(legacyRel.id)));
  await page.click('[data-gs-story-state="all"]');
  await page.click('[data-gs-story-group="C"]');
  await sleep(1500);
  const types = await page.$$eval('[data-gs-story-node-type]', (ns) => [...new Set(ns.map((n) => n.getAttribute('data-gs-story-node-type')))]);
  t('фільтр групи C (персонажі й психологія) — лише її типи', types.includes('character') && !types.includes('location') && !types.includes('scene') && !types.includes('event'), types.join(','));
  await page.click('[data-gs-story-group="C"]');
  await sleep(1500);

  console.log('(3) Пропозиція процесу ШІ → канон:');
  await page.click('[data-gs-story-side-tab="proposals"]');
  await page.waitForSelector(`[data-gs-proposal="${aiProp.id}"]`, { timeout: 10000 });
  await page.click(`[data-gs-proposal="${aiProp.id}"]`);
  await sleep(400);
  const prov = await page.$eval(`[data-gs-provenance="${aiProp.id}"]`, (e) => (e as HTMLElement).innerText).catch(() => '');
  t('походження: процес, вузол, модель, промпт, онтологія, Jev, впевненість (§25)', ['canon_pipeline v2', 'extract', 'gemini-2.5-flash', 'extract-v4', 'v1', 'decide propose', '74%'].every((s) => prov.includes(s)), prov.replace(/\n/g, ' | '));
  await page.click(`[data-gs-proposal="${aiProp.id}"] [data-gs-proposal-validate]`);
  await page.waitForSelector(`[data-gs-proposal="${aiProp.id}"][data-gs-proposal-state="validated"]`, { timeout: 10000 }).catch(() => null);
  t('перевірка щодо онтології → Validated', !!(await page.$(`[data-gs-proposal="${aiProp.id}"][data-gs-proposal-state="validated"]`)));
  await page.click(`[data-gs-proposal="${aiProp.id}"] [data-gs-proposal-edit-toggle]`);
  await page.click(`[data-gs-proposal="${aiProp.id}"] [data-gs-proposal-edit-name]`, { clickCount: 3 });
  await page.type(`[data-gs-proposal="${aiProp.id}"] [data-gs-proposal-edit-name]`, 'Маяк на скелі');
  await page.click(`[data-gs-proposal="${aiProp.id}"] [data-gs-proposal-canon]`);
  await page.waitForSelector('[data-gs-story-notice]', { timeout: 15000 }).catch(() => null);
  await sleep(1500);
  const n1 = await page.$eval('[data-gs-story-notice]', (e) => `${e.getAttribute('data-gs-story-notice')}: ${(e as HTMLElement).innerText}`).catch(() => '');
  const [canonRow] = await q(`SELECT state, canon_ref, author_edit, decided_by FROM fusion_core.story_proposals WHERE id = $1`, [aiProp.id]);
  const [lighthouse] = canonRow?.canon_ref ? await q(`SELECT name, status, created_by, version FROM fusion_core.entities WHERE id = $1`, [canonRow.canon_ref]) : [];
  t('схвалення з правкою + запис у канон (№15, №16)', n1.startsWith('ok') && canonRow?.state === 'canon' && lighthouse?.name === 'Маяк на скелі' && lighthouse.status === 'confirmed' && lighthouse.created_by === 'user:u-admin', `${n1} · ${JSON.stringify(canonRow)}`);
  t('правка автора збережена (що було → що стало)', canonRow?.author_edit?.fields?.includes('name') && canonRow.author_edit.before.name === 'Старий маяк');
  const evs = await q(`SELECT action, actor FROM fusion_core.story_proposal_events WHERE proposal_id = $1 ORDER BY created_at, id`, [aiProp.id]);
  t('аудит: create (ai) → validate → edit → validate → approve → write_canon', evs.map((e: any) => e.action).join() === 'create,validate,edit,validate,approve,write_canon' && evs[0].actor === 'ai:AI-1' && evs.at(-1).actor === 'user:u-admin', evs.map((e: any) => e.action).join());

  console.log('(4) Ручна пропозиція зв\'язку → канон → ребро з походженням:');
  await page.click('[data-gs-story-side-tab="new"]');
  await page.click('[data-gs-story-new-kind="relation"]');
  await page.select('[data-gs-story-new-from]', A.id);
  await page.select('[data-gs-story-new-to]', B.id);
  await sleep(300);
  await page.select('[data-gs-story-new-rel-type]', 'motivates');
  await page.type('[data-gs-story-new-note]', 'живий прогін Т5.3');
  await page.click('[data-gs-story-new-submit]');
  await sleep(2500);
  const [manual] = await q(`SELECT id, state, created_by FROM fusion_core.story_proposals WHERE project_id = $1 AND payload->>'note' = 'живий прогін Т5.3'`, [BOOK]);
  t('пропозицію створено й перевірено (Validated)', manual?.state === 'validated' && manual.created_by === 'user:u-admin', JSON.stringify(manual));
  t('вона вже вибрана в панелі пропозицій', !!(await page.$(`[data-gs-proposal="${manual?.id}"] [data-gs-provenance]`)));
  await page.click(`[data-gs-proposal="${manual.id}"] [data-gs-proposal-canon]`);
  await sleep(2500);
  const [manualRow] = await q(`SELECT state, canon_ref FROM fusion_core.story_proposals WHERE id = $1`, [manual.id]);
  const [rel] = manualRow?.canon_ref ? await q(`SELECT type, status, note, created_by FROM fusion_core.entity_relations WHERE id = $1`, [manualRow.canon_ref]) : [];
  t('у каноні — підтверджений зв\'язок', manualRow?.state === 'canon' && rel?.status === 'confirmed' && rel.type === 'motivates' && rel.note === 'живий прогін Т5.3');
  await page.waitForSelector(`.react-flow__edge[data-id="${manualRow.canon_ref}"]`, { timeout: 10000 }).catch(() => null);
  t('ребро з\'явилося на графі', await hasEdge(manualRow.canon_ref));
  await page.evaluate(`(() => { const el = document.querySelector('.react-flow__edge[data-id="${manualRow.canon_ref}"] .react-flow__edge-textwrapper') || document.querySelector('.react-flow__edge[data-id="${manualRow.canon_ref}"]'); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await page.waitForSelector(`[data-gs-story-edge-card="${manualRow.canon_ref}"]`, { timeout: 8000 }).catch(() => null);
  const edgeCard = await page.$eval(`[data-gs-story-edge-card="${manualRow.canon_ref}"]`, (e) => (e as HTMLElement).innerText).catch(() => '');
  t('картка ребра: канон, хто створив і походження з пропозиції', /канон/.test(edgeCard) && /u-admin/.test(edgeCard) && /Походження з пропозиції/i.test(edgeCard), edgeCard.replace(/\n/g, ' | ').slice(0, 300));

  console.log('(5) Пропозиції AI-1 поруч:');
  await page.click('[data-gs-story-side-tab="proposals"]');
  await page.waitForSelector(`[data-gs-story-legacy-relation="${legacyRel.id}"]`, { timeout: 8000 }).catch(() => null);
  t('зв\'язок AI-1 у списку «як є»', !!(await page.$(`[data-gs-story-legacy-relation="${legacyRel.id}"]`)));
  await page.click(`[data-gs-story-legacy-relation="${legacyRel.id}"] button[title="Підтвердити"]`);
  await sleep(2000);
  t('підтверджено → статус confirmed у ядрі', (await q(`SELECT status FROM fusion_core.entity_relations WHERE id = $1`, [legacyRel.id]))[0]?.status === 'confirmed');
  await page.click('[data-gs-story-show-closed]');
  await sleep(300);
  t('вирішені — за перемикачем (Canon)', (await page.$$(`[data-gs-proposal-state="canon"]`)).length >= 2);
  await page.screenshot({ path: path.join(DIR, 'story-graph-desktop.png') });

  console.log('(6) Телефон:');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-gs-story-canvas]', { timeout: 30000 });
  await sleep(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t('390 px: без горизонтальної прокрутки, полотно й панель — одна під одною', overflow <= 1, `надлишок ${overflow}px`);
  await page.screenshot({ path: path.join(DIR, 'story-graph-phone.png') });
  t('без помилок сторінки', errors.length === 0, errors.join(' | '));
} catch (err) {
  t('прогін без збоїв', false, (err as Error).stack ?? String(err));
} finally {
  await browser.close();
  child.kill();
  await db.end();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
