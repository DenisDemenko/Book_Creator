/**
 * Живий прогін Graph Studio (Т5.2 В5, `PLAN_GRAPH_STUDIO.md`; ТЗ Graph Studio
 * §4, §5, §35, §37, §38, №6, 7, 27, 28). Запуск:
 * CORE_TEST_DATABASE_URL=postgres://… npm run live:graph-studio (потрібен
 * зібраний dist/server.mjs і Chrome/Chromium; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер:
 *   (1) доступ: автор — відмова; адмін відкриває Graph Studio з карти адмінки,
 *       адреса /admin/graph-studio/…;
 *   (2) процес на канві: зразок §5.1, правка параметра з помилкою на вузлі,
 *       розірване й знову з'єднане мишею ребро, збереження, перевірка, тест;
 *   (3) PUBLISH_SCHEMA: видавець без права — відмова; адмін вмикає право ролі
 *       в матриці прав — видавець бачить студію без правки й публікує;
 *   (4) №28: перетягнутий вузол робочої версії — розкладка збережена, хеш і
 *       визначення ті самі;
 *   (5) §38 і №27: нова чернетка не змінює робочої; публікація v2; відкат до
 *       v1 з вкладки «Версії» — v3 з визначенням v1;
 *   (6) онтологія на канві: чернетка, зв'язок MOTIVATES обмежено GOAL → DECISION
 *       (ТЗ §4.3) — ребро на канві групи; перевірка, вплив, публікація;
 *   (7) телефон 390 px.
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
const DIR = path.join(os.tmpdir(), 'nova-live-graph-studio');
const PORT = Number(process.env.GRAPH_STUDIO_PORT || 34373);
const BASE = `http://localhost:${PORT}`;
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

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const now = new Date().toISOString();
const TOK: Record<string, string> = {};
for (const [id, role, name] of [['u-admin', 'admin', 'Адмін'], ['u-author', 'writer', 'Авторка'], ['u-pub', 'publisher', 'Видавець']] as const) {
  await saveUser({ id, email: `${id}@graph.test`, name, role, createdAt: now } as any);
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

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors: string[] = [];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
const openAs = async (uid: string) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  await ctx.setCookie({ name: 'nova_session', value: TOK[uid], domain: 'localhost', path: '/' });
  page.on('pageerror', (e) => errors.push(`${uid}: ${String(e)}`));
  page.on('dialog', (d) => { void d.accept(); });
  return page;
};
const notice = (page: Page, sel = '[data-wf-notice]') => page.$eval(sel, (e) => `${e.getAttribute('data-wf-notice') ?? e.getAttribute('data-onto-notice')}: ${(e as HTMLElement).innerText}`).catch(() => '');
const click = async (page: Page, sel: string, wait = 1500) => { await page.click(sel); await sleep(wait); };
const center = async (page: Page, sel: string) => {
  const b = await (await page.$(sel))?.boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
};
const WF = 'canon_pipeline';
// Ядро саме публікує системні процеси (Т5.4: ai1_mentions, ai2_*,
// character_voice), а редактор відкриває перший за абеткою — тож після
// перезавантаження процес прогону обираємо явно.
const openWf = async (page: any) => {
  await page.waitForSelector(`[data-wf-item="${WF}"]`, { timeout: 20000 }).catch(() => null);
  await page.evaluate((id: string) => (document.querySelector(`[data-wf-item="${id}"]`) as HTMLElement | null)?.click(), WF);
  await page.waitForSelector('[data-wf-node="review"]', { timeout: 20000 }).catch(() => null);
  await sleep(1500);
};
const versionsOf = () => q(`SELECT version, environment, definition_hash, revision, definition FROM fusion_core.workflow_versions WHERE workflow_id = $1 ORDER BY version`, [WF]);

try {
  // ── (1) ────────────────────────────────────────────────────────────────────
  console.log('(1) Доступ і вхід:');
  t('автор — 403 на студію (сервер)', (await api('GET', '/api/core/graph-studio/me', 'u-author')).status === 403);
  const author = await openAs('u-author');
  await author.goto(`${BASE}/admin/graph-studio/workflows`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await author.waitForSelector('[data-gs-denied], [data-gs-page]', { timeout: 40000 }).catch(() => null);
  await sleep(2000);
  t('автор за адресою бачить відмову, а не студію', !!(await author.$('[data-gs-denied]')) && !(await author.$('[data-wf-canvas]')));
  const admin = await openAs('u-admin');
  await admin.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await admin.waitForSelector('#nav-tab-admin', { timeout: 40000 });
  await admin.evaluate(() => (document.querySelector('#nav-tab-admin') as HTMLElement | null)?.click());
  await admin.waitForSelector('button[title^="Graph Studio"]', { timeout: 20000 });
  await click(admin, 'button[title^="Graph Studio"]', 2500);
  t('з карти адмінки — Graph Studio з адресою /admin/graph-studio/workflows', admin.url().endsWith('/admin/graph-studio/workflows') && !!(await admin.$('[data-gs-page="workflows"]')), admin.url());
  const tabs = await admin.$$eval('[data-gs-tab]', (es) => es.map((e) => e.getAttribute('data-gs-tab')));
  t('шість вкладок §35 і «Напрямки» (Т5.5)', tabs.join() === 'ontology,workflows,destinations,story-graph,runs,versions,evaluations', tabs.join());
  t('адмін: правка чернеток і PUBLISH_SCHEMA', /правка чернеток/.test(await admin.$eval('[data-gs-abilities]', (e) => (e as HTMLElement).innerText)) && /PUBLISH_SCHEMA/.test(await admin.$eval('[data-gs-abilities]', (e) => (e as HTMLElement).innerText)));

  // ── (2) ────────────────────────────────────────────────────────────────────
  console.log('\n(2) Процес на канві:');
  await click(admin, '[data-wf-new]', 400);
  await admin.type('[data-wf-create-id]', WF);
  await admin.type('[data-wf-create-en]', 'Canon pipeline');
  await admin.type('[data-wf-create-uk]', 'Конвеєр канону');
  await admin.select('[data-wf-create-template]', 'sample');
  await click(admin, '[data-wf-create-submit]', 2500);
  const groups = await admin.$$eval('[data-wf-palette-group]', (es) => es.map((e) => e.getAttribute('data-wf-palette-group')));
  t('палітра — вісім груп §35', groups.join() === 'core,story_core,ai,jev,control,validation,human,output', groups.join());
  t('зразок §5.1 на канві — 10 вузлів, чернетка', (await admin.$$eval('[data-wf-node]', (e) => e.length)) === 10 && (await admin.$eval('[data-wf-env]', (e) => e.getAttribute('data-wf-env'))) === 'draft');
  await click(admin, '[data-wf-node="extract"]', 500);
  const temp = await admin.$('[data-wf-inspect-node="extract"] [data-wf-param="temperature"]');
  await temp?.click({ clickCount: 3 });
  await temp?.type('5');
  await click(admin, '[data-wf-action="validate"]', 2000);
  t('температура 5 — помилка на вузлі «Виділити сутності»', /Помилок/.test(await notice(admin)) && (await admin.$$eval('[data-wf-issue="bad_param"]', (e) => e.length)) === 1);
  await click(admin, '[data-wf-node="extract"]', 500);
  const temp2 = await admin.$('[data-wf-inspect-node="extract"] [data-wf-param="temperature"]');
  await temp2?.click({ clickCount: 3 });
  await temp2?.type('0.2');
  // Розірвати гілку «invalid» перевіряльника й з'єднати знову мишею.
  const edgeSel = '[data-id="e-classify-invalid-end"]';
  // Справжній клік мишею по середині лінії ребра (React Flow слухає pointer-події).
  await admin.click('[data-wf-canvas] .react-flow__pane');
  await sleep(800);
  await admin.waitForSelector(`.react-flow__edge[data-id="e-classify-invalid-end"]`, { timeout: 5000 }).catch(() => null);
  const labelBox = await (await admin.$(`.react-flow__edge[data-id="e-classify-invalid-end"] .react-flow__edge-textwrapper`))?.boundingBox();
  if (labelBox) await admin.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
  else console.log('    (підпис ребра не знайдено)');
  await sleep(500);
  const delBtn = await admin.$('[data-wf-edge-delete]');
  if (delBtn) { await delBtn.click(); await sleep(500); }
  await click(admin, '[data-wf-action="validate"]', 2000);
  t('ребро обрано мишею й вилучено з інспектора', !!delBtn);
  t('без гілки «invalid» — помилка «нікуди не веде»', (await admin.$$eval('[data-wf-issue="unconnected_branch"]', (e) => e.length)) >= 1);
  const from = await center(admin, '[data-wf-node="classify"] [data-wf-port="invalid"] .react-flow__handle');
  const to = await center(admin, '[data-wf-node="end"] .react-flow__handle-left');
  if (from && to) {
    await admin.mouse.move(from.x, from.y);
    await admin.mouse.down();
    await admin.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
    await admin.mouse.move(to.x, to.y, { steps: 8 });
    await admin.mouse.up();
    await sleep(600);
  }
  await click(admin, '[data-wf-action="validate"]', 2000);
  t('ребро знову з\'єднано мишею — перевірка пройдена', /пройдена/.test(await notice(admin)), await notice(admin));
  const rows1 = await versionsOf();
  t('у базі — чернетка v1 з ребром classify[invalid] → end і температурою 0.2', rows1.length === 1 && rows1[0].definition.edges.some((e: any) => e.from === 'classify' && e.fromPort === 'invalid' && e.to === 'end') && rows1[0].definition.nodes.find((n: any) => n.id === 'extract').params.temperature === 0.2);
  await click(admin, '[data-wf-action="test"]', 2000);
  t('чернетка → тест (заморожена)', (await admin.$eval('[data-wf-env]', (e) => e.getAttribute('data-wf-env'))) === 'test' && !!(await admin.$('[data-wf-readonly]')));

  // ── (3) ────────────────────────────────────────────────────────────────────
  console.log('\n(3) Право PUBLISH_SCHEMA:');
  t('видавець без права — 403', (await api('GET', '/api/core/graph-studio/me', 'u-pub')).status === 403 && (await api('POST', `/api/core/workflows/${WF}/versions/${rows1[0].id ?? 'x'}/publish`, 'u-pub')).status === 403);
  const roles = await api('PATCH', '/api/admin/roles/publisher', 'u-admin', { permissions: { canPublishSchema: true } });
  t('адмін вмикає право ролі «Видавець» у матриці прав', roles.status === 200 && roles.body.effective?.canPublishSchema === true);
  const pubPage = await openAs('u-pub');
  await pubPage.goto(`${BASE}/admin/graph-studio/workflows`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pubPage.waitForSelector('[data-wf-env]', { timeout: 40000 }).catch(() => null);
  await openWf(pubPage);
  t('видавець бачить студію без правки: немає палітри й «нового процесу»', !(await pubPage.$('[data-wf-palette]')) && !(await pubPage.$('[data-wf-new]')) && !!(await pubPage.$('[data-wf-action="publish"]')));
  await click(pubPage, '[data-wf-action="publish"]', 2500);
  t('видавець публікує: v1 — робоча', (await pubPage.$eval('[data-wf-env]', (e) => e.getAttribute('data-wf-env'))) === 'production');
  const pubRow = (await q(`SELECT published_by FROM fusion_core.workflow_versions WHERE workflow_id = $1 AND environment = 'production'`, [WF]))[0];
  t('у базі опублікував видавець', pubRow?.published_by === 'user:u-pub');

  // ── (4) ────────────────────────────────────────────────────────────────────
  console.log('\n(4) Розкладка не змінює семантики (№28):');
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('[data-wf-env]', { timeout: 40000 });
  await openWf(admin);
  const before = (await versionsOf())[0];
  const node = await center(admin, '[data-wf-node="review"]');
  if (node) {
    await admin.mouse.move(node.x, node.y - 10);
    await admin.mouse.down();
    await admin.mouse.move(node.x + 80, node.y + 120, { steps: 10 });
    await admin.mouse.up();
    await sleep(500);
  }
  await click(admin, '[data-wf-action="layout"]', 1500);
  const after = (await versionsOf())[0];
  const lay = (await q(`SELECT layout FROM fusion_core.graph_layouts WHERE graph_kind = 'workflow' AND graph_id = $1`, [WF]))[0];
  t('розкладку робочої версії збережено окремо', /Розкладку збережено/.test(await notice(admin)) && !!lay?.layout?.review);
  t('хеш, ревізія й визначення робочої версії — ті самі', after.definition_hash === before.definition_hash && after.revision === before.revision && JSON.stringify(after.definition) === JSON.stringify(before.definition));

  // ── (5) ────────────────────────────────────────────────────────────────────
  console.log('\n(5) Чернетка не змінює робочого; публікація й відкат:');
  await click(admin, '[data-wf-action="edit"]', 2500);
  await click(admin, '[data-wf-node="extract"]', 500);
  const temp3 = await admin.$('[data-wf-inspect-node="extract"] [data-wf-param="temperature"]');
  await temp3?.click({ clickCount: 3 });
  await temp3?.type('0.9');
  await click(admin, '[data-wf-action="save"]', 1500);
  const v = await versionsOf();
  t('нова чернетка v2 збережена, робоча v1 — з температурою 0.2 (§38)', v.length === 2 && v[1].environment === 'draft' && v[1].definition.nodes.find((n: any) => n.id === 'extract').params.temperature === 0.9 && v[0].environment === 'production' && v[0].definition.nodes.find((n: any) => n.id === 'extract').params.temperature === 0.2);
  await click(admin, '[data-wf-action="validate"]', 2000);
  await click(admin, '[data-wf-action="test"]', 2000);
  await click(admin, '[data-wf-action="publish"]', 2500);
  const v2 = await versionsOf();
  t('v2 опубліковано, v1 — в архіві', v2[1].environment === 'production' && v2[0].environment === 'archived');
  await click(admin, '[data-gs-tab="versions"]', 2500);
  t('вкладка «Версії»: адреса й список версій процесу', admin.url().endsWith('/admin/graph-studio/versions') && !!(await admin.$(`[data-gs-wf-versions="${WF}"]`)));
  await click(admin, `[data-gs-wf-rollback="${WF}:1"]`, 2500);
  const v3 = await versionsOf();
  t('відкат до v1: нова v3 робоча з визначенням v1 (№27), v2 — в архіві', v3.length === 3 && v3[2].environment === 'production' && v3[2].definition_hash === v3[0].definition_hash && v3[1].environment === 'archived', JSON.stringify(v3.map((x: any) => [x.version, x.environment])));
  const events = (await q(`SELECT action FROM fusion_core.workflow_events WHERE workflow_id = $1`, [WF])).map((r: any) => r.action);
  t('журнал процесу: створення, правки, перевірки, тест, публікації, відкат', ['create', 'edit', 'validate', 'to_test', 'publish', 'create_draft', 'rollback'].every((a) => events.includes(a)));

  // ── (6) ────────────────────────────────────────────────────────────────────
  console.log('\n(6) Онтологія на канві:');
  await click(admin, '[data-gs-tab="ontology"]', 3000);
  t('огляд: 12 груп і 39 зв\'язків', (await admin.$$eval('[data-onto-node^="g:"]', (e) => e.length)) === 12 && (await admin.$$eval('[data-onto-node^="r:"]', (e) => e.length)) === 39);
  await click(admin, '[data-onto-action="draft"]', 2000);
  await click(admin, '[data-onto-node="r:motivates"]', 700);
  await admin.select('[data-onto-rel-side="from"]', 'goal');
  await admin.select('[data-onto-rel-side="to"]', 'decision');
  await click(admin, '[data-onto-rel-apply]', 1500);
  t('зв\'язок MOTIVATES обмежено GOAL → DECISION у чернетці', /змінено в чернетці/.test(await notice(admin, '[data-onto-notice]')));
  await admin.select('[data-onto-group]', 'C');
  await sleep(2000);
  t('на канві групи C — ребро «мотивує» від цілі до рішення (рішення з групи B — бліде)', !!(await admin.$('[data-id="re:motivates:goal:decision"]')) && !!(await admin.$('[data-onto-node="t:decision"]')));
  await click(admin, '[data-onto-action="validate"]', 2000);
  await click(admin, '[data-onto-action="impact"]', 2000);
  t('VALIDATE і MIGRATION IMPACT — без помилок і блокерів', (await admin.$eval('[data-onto-step-validate]', (e) => e.getAttribute('data-onto-step-validate'))) === 'ok' && (await admin.$eval('[data-onto-step-impact]', (e) => e.getAttribute('data-onto-step-impact'))) === 'ok');
  await click(admin, '[data-onto-action="publish"]', 2500);
  const active = (await q(`SELECT version, definition FROM fusion_core.ontology_versions WHERE ontology_id = 'fusion-story' AND status = 'active'`))[0];
  const mot = active?.definition.relationTypes.find((r: any) => r.id === 'motivates');
  t('опубліковано: активна онтологія v2, motivates: goal → decision', Number(active?.version) === 2 && mot?.from?.join() === 'goal' && mot?.to?.join() === 'decision');

  // ── (7) ────────────────────────────────────────────────────────────────────
  console.log('\n(7) Телефон 390 px:');
  await admin.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await admin.goto(`${BASE}/admin/graph-studio/workflows`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await admin.waitForSelector('[data-wf-canvas]', { timeout: 40000 });
  await admin.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
  await sleep(1500);
  const ph: any = await admin.evaluate(`(() => {
    const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) } : null; };
    return { w: window.innerWidth, sw: document.documentElement.scrollWidth, canvas: r('[data-wf-canvas]'), tabs: r('[data-gs-tabs]'), toolbar: r('[data-wf-toolbar]') };
  })()`);
  t('канва, вкладки й панель дій вміщаються, без горизонтальної прокрутки', !!ph.canvas && ph.canvas.right <= ph.w && ph.canvas.width >= 300 && !!ph.tabs && ph.tabs.right <= ph.w && ph.sw <= ph.w + 1, JSON.stringify(ph));
  await admin.screenshot({ path: path.join(DIR, 'graph-studio-phone.png') });
  t('без помилок JavaScript на сторінках', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  child.kill();
  await db.end();
}
const serverErrs = log.join('').split('\n').filter((l) => /\bError\b|помилка маршруту|\[workflows\]/i.test(l) && !/SMTP|smtp|GEMINI|API key|ключ|опубліковано v1 системних процесів/i.test(l));
t('журнал сервера — без помилок', serverErrs.length === 0, serverErrs.slice(0, 3).join(' | '));
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
