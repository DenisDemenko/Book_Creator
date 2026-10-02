/**
 * Живий прогін опитувальника ролі (Т6.3, `PLAN_ROLE_ONBOARDING.md`; ТЗ Role
 * Onboarding v3.1 §3–12, §14, §20, §24–28). Запуск:
 * CORE_TEST_DATABASE_URL=postgres://… npm run live:role-onboarding (потрібен
 * зібраний dist/server.mjs і Chrome/Chromium; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 * Справжній сервер (ROLE_ONBOARDING=on), PostgreSQL і браузер:
 *   (1) перший вхід кожного: майстер, фрілансер без спеціалізації — помилка,
 *       «Назад» без втрати, підсумок, налаштування учасника; після — не
 *       показується; аналітика окремо від канону;
 *   (2) «Відкрити у Студії» чужу книгу з order_id: тип зафіксовано, роль +
 *       спеціалізація, область, можливості, повідомлення → запит доступу;
 *       повторний вхід — «запит чекає рішення»;
 *   (3) власниця в «Команді» → «Доступ» → «Запити»: змінити й надати сцену +
 *       медіатеку; фактичні права — лише сцена (ілюстратор не бачить рукопису);
 *   (4) запрошення: пропуск — одразу підсумок, без запиту;
 *   (5) курс: співавтор просить доступ до курсу, автор курсу схвалює —
 *       співавтор відкриває курс з правом редагування;
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
const DIR = path.join(os.tmpdir(), 'nova-live-role-onboarding');
const PORT = Number(process.env.ROLE_ONBOARDING_PORT || 34383);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'book-live-onboarding';
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

const { initStore, saveUser, createSession, createCollabInvite } = await import('../server/store');
const { initialBookData } = await import('../src/data/initialBook');
await initStore();
const now = new Date().toISOString();
const TOK: Record<string, string> = {};
const people: [string, string, string][] = [['u-new', 'writer', 'Новачка'], ['u-owner', 'writer', 'Олена Авторка'], ['u-ill', 'writer', 'Ілюстратор'], ['u-reader', 'writer', 'Бета-читачка'], ['u-teacher', 'teacher', 'Викладачка'], ['u-co', 'writer', 'Співавтор курсу'], ['u-phone', 'writer', 'Телефон']];
for (const [id, role, name] of people) {
  await saveUser({ id, email: `${id}@onb.test`, name, role, createdAt: now } as any);
  TOK[id] = crypto.randomBytes(24).toString('hex');
  await createSession({ token: TOK[id], userId: id, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });
}
await createCollabInvite({
  id: 'inv-reader', bookId: BOOK, bookTitle: 'Маяк', inviterUserId: 'u-owner', inviteeEmail: 'u-reader@onb.test',
  role: 'beta_reader', token: 'tok-reader', status: 'accepted', emailSent: false, createdAt: now, acceptedAt: now, acceptedUserId: 'u-reader',
} as any);

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, ROLE_ONBOARDING: 'on', PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, APP_URL: BASE, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
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
/** Людина вже проходила перший вхід — щоб не заважав у сценарії з іншою точкою запуску. */
const skipFirstLogin = async (uid: string) => {
  const s = await api('POST', '/api/core/onboarding/sessions', uid, { source: 'first_login' });
  await api('POST', `/api/core/onboarding/sessions/${s.body.session.id}/cancel`, uid);
};

const FULL: any = JSON.parse(JSON.stringify({ ...initialBookData, id: BOOK, title: 'Маяк', updatedAt: new Date(Date.now() - 60_000).toISOString() }));
const SCENE = String(FULL.chapters[0].sections[0].id);
await api('PUT', `/api/books/${BOOK}`, 'u-owner', { book: FULL });
await waitFor(() => q(`SELECT id FROM fusion_core.projects WHERE id = $1`, [BOOK]), (r) => r.length === 1, 40000);
for (const uid of ['u-owner', 'u-ill', 'u-reader', 'u-teacher', 'u-co']) await skipFirstLogin(uid);

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors: string[] = [];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
const openAs = async (uid: string, url = '/', viewport = { width: 1440, height: 1000 }) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await ctx.setCookie({ name: 'nova_session', value: TOK[uid], domain: 'localhost', path: '/' });
  page.on('pageerror', (e) => errors.push(`${uid}: ${String(e)}`));
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return { ctx, page };
};
const click = async (page: Page, sel: string, wait = 400) => {
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
  await sleep(wait);
};
const step = (page: Page) => page.$eval('[data-onb-wizard]', (e) => Number(e.getAttribute('data-onb-current'))).catch(() => 0);
const next = async (page: Page, expect?: number) => {
  await click(page, '[data-onb-next]', 300);
  if (expect) await page.waitForFunction(`Number(document.querySelector('[data-onb-wizard]')?.getAttribute('data-onb-current')) === ${expect}`, { timeout: 15000 }).catch(() => null);
};

try {
  console.log('(1) Перший вхід кожного (§3 п.1, §25, №2, 5, 14, 28):');
  {
    const { ctx, page } = await openAs('u-new');
    await page.waitForSelector('[data-onb-step="1"]', { timeout: 40000 }).catch(() => null);
    t('майстер на першому вході', (await step(page)) === 1);
    t('типи проєктів — з реєстру (книга, курс…)', (await page.$$eval('[data-onb-type]', (els) => els.map((e) => e.getAttribute('data-onb-type')))).join() === 'book,course,educational_program,illustration_project,design_project,other');
    await click(page, '[data-onb-type="book"]');
    await next(page, 2);
    await click(page, '[data-onb-intent="create_own_project"]');
    await next(page, 3);
    t('перший екран ролей — 9 ролей §27 і пошук', (await page.$$('[data-onb-role]')).length === 9 && !!(await page.$('[data-onb-search]')));
    await click(page, '[data-onb-role="author"]');
    await click(page, '[data-onb-role="freelancer"]');
    await next(page);
    t('фрілансер без спеціалізації — помилка на кроці (№5)', (await step(page)) === 3 && !!(await page.$('[data-onb-issue="specialization_required"]')));
    await page.select('[data-onb-spec="freelancer"]', 'cover_designer');
    await page.type('[data-onb-search]', 'коректор');
    await sleep(300);
    t('пошук ролі', (await page.$$eval('[data-onb-role-list] [data-onb-role]', (els) => els.map((e) => e.getAttribute('data-onb-role')))).join() === 'proofreader');
    await page.type('[data-onb-other]', 'ще й верстальниця');
    await next(page, 4);
    t('параметри ролі — автор і дизайнер (за спеціалізацією фрілансера)', (await page.$$('[data-onb-detail^="author:"]')).length === 5 && (await page.$$('[data-onb-detail^="designer:"]')).length === 5);
    await click(page, '[data-onb-detail="author:characters"]');
    await click(page, '[data-onb-back]', 500);
    t('«Назад» без втрати даних', (await step(page)) === 3 && (await page.$eval('[data-onb-role="author"]', (e) => e.getAttribute('data-on'))) === '1' && (await page.$eval('[data-onb-other]', (e) => (e as HTMLInputElement).value)) === 'ще й верстальниця');
    await next(page, 4);
    t('крок 4 пам\'ятає вибране', (await page.$eval('[data-onb-detail="author:characters"]', (e) => e.getAttribute('data-on'))) === '1');
    await next(page, 7);
    t('власний проєкт — кроки області й можливостей пропущено', (await step(page)) === 7);
    await click(page, '[data-onb-ai="continuity_check"]');
    await next(page, 8);
    const summary = await page.$$eval('[data-onb-summary]', (els) => els.map((e) => `${e.getAttribute('data-onb-summary')}=${(e as HTMLElement).innerText.replace(/\n/g, ' ')}`));
    t('підсумок: тип, ролі (з спеціалізацією), доступ, ШІ', summary.some((x) => x.startsWith('type=') && x.includes('Книга')) && summary.some((x) => x.includes('Автор') && x.includes('Фрілансер') && x.includes('Дизайнер обкладинки')) && summary.some((x) => x.startsWith('ai=') && x.includes('Перевірка безперервності')), summary.join(' | '));
    await click(page, '[data-onb-complete]', 1500);
    t('завершено → пропозиція створити книгу', !!(await page.$('[data-onb-outcome="preferences"] [data-onb-next-action="create_book"]')));
    const [pref] = await q(`SELECT workspace, ai_profile, ai_assistance, role_details FROM fusion_core.participant_preferences WHERE user_id = 'u-new' AND project_id = '*'`);
    t('налаштування учасника в ядрі', pref?.workspace === 'author' && pref.ai_assistance.join() === 'continuity_check' && pref.role_details.author?.join() === 'characters', JSON.stringify(pref));
    await click(page, '[data-onb-close]', 800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
    await sleep(2500);
    t('наступний вхід — без майстра', !(await page.$('[data-onb-wizard]')));
    const evs = await q(`SELECT event FROM fusion_core.onboarding_events WHERE user_id = 'u-new'`);
    t('аналітика §28 окремо (started, step_completed, role_selected, completed, studio_entered)', ['onboarding_started', 'onboarding_step_completed', 'role_selected', 'onboarding_completed', 'studio_entered'].every((e) => evs.some((x: any) => x.event === e)), evs.map((x: any) => x.event).join(','));
    await ctx.close();
  }

  console.log('(2) «Відкрити у Студії» чужу книгу з order_id (§14, §20, №1, 9, 13):');
  let requestId = '';
  {
    const { ctx, page } = await openAs('u-ill', `/?project=${BOOK}&order=ord-5`);
    await page.waitForSelector('[data-onb-step]', { timeout: 40000 }).catch(() => null);
    t('адресу почищено від project/order', !(await page.evaluate('location.search')).toString().includes('project='));
    t('майстер для чужої книги (роль невідома)', (await step(page)) === 1);
    t('тип проєкту зафіксовано — книга', (await page.$eval('[data-onb-type="course"]', (e) => (e as HTMLButtonElement).disabled)) && (await page.$eval('[data-onb-type="book"]', (e) => e.getAttribute('data-on'))) === '1');
    await next(page, 2);
    t('мета — «фріланс-замовлення» з контексту', (await page.$eval('[data-onb-intent="fulfill_freelance_order"]', (e) => e.getAttribute('data-on'))) === '1');
    await next(page, 3);
    await click(page, '[data-onb-role="freelancer"]');
    await page.select('[data-onb-spec="freelancer"]', 'illustrator');
    await next(page, 4);
    await click(page, '[data-onb-detail="illustrator:scene_illustrations"]');
    await next(page, 5);
    t('області: недоступні позначено «з’явиться пізніше»', (await page.$eval('[data-onb-scope="marketing_data"]', (e) => (e as HTMLButtonElement).disabled)) && !(await page.$eval('[data-onb-scope="selected_scenes"]', (e) => (e as HTMLButtonElement).disabled)));
    await click(page, '[data-onb-scope="selected_scenes"]');
    await next(page, 6);
    const caps = await page.$$eval('[data-onb-cap][data-on="1"]', (els) => els.map((e) => e.getAttribute('data-onb-cap')));
    t('можливості — шаблон ролі (фрілансер + ілюстратор), це лише запит', caps.join() === 'view,comment,upload,propose', caps.join());
    await page.type('[data-onb-message]', 'Ілюстрація до першої сцени');
    await next(page, 7);
    await next(page, 8);
    const access = await page.$eval('[data-onb-summary="access"]', (e) => (e as HTMLElement).innerText);
    t('підсумок: запит доступу вирішує власник', /вирішує власник/.test(access), access);
    await click(page, '[data-onb-complete]', 1500);
    t('запит надіслано', !!(await page.$('[data-onb-outcome="access_request"]')));
    const [r] = await q(`SELECT id, status, level, scope, order_id, message FROM fusion_core.access_requests WHERE project_id = $1 AND user_id = 'u-ill'`, [BOOK]);
    requestId = r?.id;
    t('у ядрі: запит з order_id, рівнем перевірки й повідомленням', r?.status === 'pending' && r.level === 'review' && r.scope === 'selected_scenes' && r.order_id === 'ord-5' && r.message === 'Ілюстрація до першої сцени');
    const [part] = await q(`SELECT source, source_ref FROM fusion_core.project_participants WHERE project_id = $1 AND user_id = 'u-ill'`, [BOOK]);
    const grants = await q(`SELECT id FROM fusion_core.access_grants WHERE project_id = $1 AND participant_id IN (SELECT id FROM fusion_core.project_participants WHERE user_id = 'u-ill')`, [BOOK]);
    t('учасник із замовлення, але без жодного доступу (роль ≠ дозвіл)', part?.source === 'freelance_order' && part.source_ref === 'ord-5' && grants.length === 0);
    t('API книги — 403 до рішення', (await api('GET', `/api/projects/${BOOK}/entities`, 'u-ill')).status === 403);
    await page.goto(`${BASE}/?project=${BOOK}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-onb-outcome="pending"]', { timeout: 30000 }).catch(() => null);
    t('повторний вхід — «запит чекає рішення»', !!(await page.$('[data-onb-outcome="pending"]')));
    await ctx.close();
  }

  console.log('(3) Власниця: «Команда» → «Доступ» → «Запити» (§20, №10, 11):');
  {
    const { ctx, page } = await openAs('u-owner');
    await page.waitForSelector('#collab-team-drawer-btn', { timeout: 40000 });
    t('власниця не бачить майстра (перший вхід уже пройдено)', !(await page.$('[data-onb-wizard]')));
    await page.evaluate(`(async () => {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('nova_studio', 1);
        req.onupgradeneeded = () => { const d = req.result; for (const s of ['books', 'meta', 'snapshots']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' }); };
        req.onsuccess = () => { const tx = req.result.transaction(['books', 'meta'], 'readwrite'); tx.objectStore('books').put({ id: ${JSON.stringify(BOOK)}, data: ${JSON.stringify(FULL)}, updatedAt: new Date().toISOString() }); tx.objectStore('meta').put({ key: 'active_book_id', value: ${JSON.stringify(BOOK)} }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); };
        req.onerror = () => reject(req.error);
      });
    })()`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#collab-team-drawer-btn', { timeout: 40000 });
    await click(page, '#collab-team-drawer-btn', 800);
    await click(page, '[data-collab-tab="access"]', 800);
    await page.waitForSelector(`[data-access-request="${requestId}"]`, { timeout: 20000 }).catch(() => null);
    const card = await page.$eval(`[data-access-request="${requestId}"]`, (e) => (e as HTMLElement).innerText).catch(() => '');
    t('запит у «Команді»: людина, ролі, рівень, замовлення, повідомлення', /Ілюстратор/.test(card) && /Фрілансер/.test(card) && /ord-5/.test(card) && /першої сцени/.test(card), card.replace(/\n/g, ' | ').slice(0, 300));
    await page.click(`[data-access-request="${requestId}"] [data-access-request-approve]`);
    await sleep(1200);
    const err = await page.$eval(`[data-access-request="${requestId}"] [data-access-request-error]`, (e) => (e as HTMLElement).innerText).catch(() => '');
    t('«Схвалити як є» без обраних сцен — сервер просить обрати', /Оберіть/.test(err), err);
    await page.select(`[data-access-request="${requestId}"] [data-access-request-scope]`, 'scene');
    await sleep(200);
    await page.select(`[data-access-request="${requestId}"] [data-access-request-refs]`, SCENE);
    await page.select(`[data-access-request="${requestId}"] [data-access-request-level]`, 'comment');
    await page.type(`[data-access-request="${requestId}"] [data-access-request-reason]`, 'лише перша сцена');
    await page.click(`[data-access-request="${requestId}"] [data-access-request-modify]`);
    await page.waitForSelector('[data-access-request-done="modified"]', { timeout: 15000 }).catch(() => null);
    t('«Змінити й надати» — у журналі рішень', !!(await page.$('[data-access-request-done="modified"]')));
    const grants = await q(`SELECT level, scope_type, scope_ref FROM fusion_core.access_grants WHERE project_id = $1 AND participant_id IN (SELECT id FROM fusion_core.project_participants WHERE user_id = 'u-ill') ORDER BY scope_type`, [BOOK]);
    t('надано: сцена (коментування) + робоча медіатека', grants.map((g: any) => `${g.scope_type}:${g.level}:${g.scope_ref ?? ''}`).join() === `media_library:work:,scene:comment:${SCENE}`, JSON.stringify(grants));
    const acc = await api('GET', `/api/core/projects/${BOOK}/access`, 'u-ill');
    t('ілюстратор не отримує весь рукопис (№11)', acc.body.me?.effective?.restricted === true && acc.body.me.effective.scenes?.[SCENE] === 'comment' && acc.body.me.effective.book === 'none');
    const ev = await q(`SELECT action FROM fusion_core.collab_events WHERE project_id = $1 AND action IN ('access_requested', 'access_request_decided', 'access_granted')`, [BOOK]);
    t('аудит: запит, рішення, надання (№27)', ['access_requested', 'access_request_decided', 'access_granted'].every((a) => ev.some((x: any) => x.action === a)));
    await page.screenshot({ path: path.join(DIR, 'access-requests.png') });
    await ctx.close();
  }

  console.log('(4) Запрошення: пропуск (§24, №12):');
  {
    const { ctx, page } = await openAs('u-reader', `/?project=${BOOK}`);
    await page.waitForSelector('[data-onb-step]', { timeout: 40000 }).catch(() => null);
    t('одразу підсумок — роль із запрошення', (await step(page)) === 8 && /Бета-рідер|бета-рідер/i.test(await page.$eval('[data-onb-summary="roles"]', (e) => (e as HTMLElement).innerText).catch(() => '')));
    t('доступ — за запрошенням', /запрошенням/.test(await page.$eval('[data-onb-summary="access"]', (e) => (e as HTMLElement).innerText).catch(() => '')));
    await click(page, '[data-onb-complete]', 1500);
    await page.waitForSelector('[data-onb-wizard]', { hidden: true, timeout: 15000 }).catch(() => null);
    t('майстер закрився, запиту доступу немає', !(await page.$('[data-onb-wizard]')) && (await q(`SELECT 1 FROM fusion_core.access_requests WHERE user_id = 'u-reader'`)).length === 0);
    t('роль бета-рідера в проєкті', (await q(`SELECT role_id FROM fusion_core.participant_roles WHERE project_id = $1 AND status = 'active' AND participant_id IN (SELECT id FROM fusion_core.project_participants WHERE user_id = 'u-reader')`, [BOOK])).some((r: any) => r.role_id === 'beta_reader'));
    await ctx.close();
  }

  console.log('(5) Курс: співавтор за наданим доступом (№3, рішення §2 п.1):');
  {
    const c = await api('POST', '/api/courses', 'u-teacher', { title: 'Курс письма' });
    const cid = c.body.course?.id;
    const projectId = `course-${cid}`;
    await waitFor(() => q(`SELECT project_type FROM fusion_core.projects WHERE id = $1`, [projectId]), (r) => r.length === 1, 10000);
    t('курс — проєкт ядра типу «курс»', (await q(`SELECT project_type FROM fusion_core.projects WHERE id = $1`, [projectId]))[0]?.project_type === 'course');
    const { ctx, page } = await openAs('u-co', `/?project=${projectId}`);
    await page.waitForSelector('[data-onb-step]', { timeout: 40000 }).catch(() => null);
    t('майстер курсу: тип «курс» зафіксовано', (await page.$eval('[data-onb-type="course"]', (e) => e.getAttribute('data-on')).catch(() => '')) === '1');
    await next(page, 2);
    await click(page, '[data-onb-intent="join_existing_project"]');
    await next(page, 3);
    await click(page, '[data-onb-role="co_author"]');
    await next(page, 4);
    await next(page, 5);
    t('для курсу сцени недоступні, курс — так', (await page.$eval('[data-onb-scope="selected_scenes"]', (e) => (e as HTMLButtonElement).disabled)) && !(await page.$eval('[data-onb-scope="selected_course"]', (e) => (e as HTMLButtonElement).disabled)));
    await click(page, '[data-onb-scope="selected_course"]');
    await next(page, 6);
    await next(page, 7);
    await next(page, 8);
    await click(page, '[data-onb-complete]', 1500);
    const [r] = await q(`SELECT id, level FROM fusion_core.access_requests WHERE project_id = $1 AND user_id = 'u-co'`, [projectId]);
    t('запит доступу до курсу', !!r && r.level === 'create', JSON.stringify(r));
    t('до рішення курс закритий (404)', (await api('GET', `/api/courses/${cid}`, 'u-co')).status === 404);
    t('автор курсу бачить запит', (await api('GET', `/api/core/projects/${projectId}/access-requests`, 'u-teacher')).body.requests?.some((x: any) => x.id === r?.id));
    await api('POST', `/api/core/projects/${projectId}/access-requests/${r.id}/decide`, 'u-teacher', { action: 'modify', level: 'edit' });
    const got = await api('GET', `/api/courses/${cid}`, 'u-co');
    t('після схвалення — курс із правом редагування', got.status === 200 && got.body.access === 'edit');
    t('у списку курсів — серед спільних', (await api('GET', '/api/courses', 'u-co')).body.shared?.some((x: any) => x.id === cid));
    await page.goto(`${BASE}/?project=${projectId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-course-access]', { timeout: 40000 }).catch(() => null);
    t('«Відкрити у Студії» курс — одразу в Студії курсів, співавтор із редагуванням', (await page.$eval('[data-course-access]', (e) => e.getAttribute('data-course-access')).catch(() => '')) === 'edit' && !(await page.$('[data-onb-wizard]')));
    t('у меню — «Створити курс» (участь, а не роль експерта)', !!(await page.$('#nav-tab-course-studio')));
    t('публікувати й видаляти співавтору не пропонується', !(await page.evaluate(`!!Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Опублікувати'))`)));
    await page.screenshot({ path: path.join(DIR, 'course-coauthor.png') });
    await ctx.close();
  }

  console.log('(6) Телефон 390 px (№26):');
  {
    const { ctx, page } = await openAs('u-phone', '/', { width: 390, height: 844 });
    await page.waitForSelector('[data-onb-step]', { timeout: 40000 }).catch(() => null);
    await click(page, '[data-onb-type="book"]');
    await next(page, 2);
    await click(page, '[data-onb-intent="create_own_project"]');
    await next(page, 3);
    const overflow = await page.evaluate(`(() => { const w = document.querySelector('[data-onb-wizard]'); return Math.max(document.documentElement.scrollWidth - window.innerWidth, w ? w.scrollWidth - w.clientWidth : 0); })()`);
    t('майстер на 390 px без горизонтальної прокрутки', Number(overflow) <= 1, `надлишок ${overflow}px`);
    await page.screenshot({ path: path.join(DIR, 'wizard-phone.png') });
    await click(page, '[data-onb-later]', 800);
    t('«Пізніше» — чернетка лишається (продовжити)', (await q(`SELECT status, current_step FROM fusion_core.onboarding_sessions WHERE user_id = 'u-phone'`))[0]?.status === 'draft');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-onb-step]', { timeout: 40000 }).catch(() => null);
    t('повторний вхід — продовжити з того самого кроку (№14)', (await step(page)) === 3);
    await ctx.close();
  }
  t('канон твору без людей (№29): жодної сутності з іменами учасників', (await q(`SELECT 1 FROM fusion_core.entities WHERE name IN ('Ілюстратор', 'Бета-читачка', 'Співавтор курсу')`)).length === 0);
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
