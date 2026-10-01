/**
 * Живий прогін онтології співпраці й реєстру ролей (Т6.1 В4,
 * `PLAN_COLLABORATION.md`). Запуск: CORE_TEST_DATABASE_URL=postgres://…
 * npm run live:collab-roles (потрібен зібраний dist/server.mjs і `.env` з
 * VITE_FIREBASE_*; схема `fusion_core` у цій базі видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер:
 *   (1) перший старт ядра імпортує обидві онтології — твору й співпраці;
 *   (2) власник відкриває «Команду» → «Запросити»: ролі — з реєстру, за
 *       категоріями, з описом; запрошує ілюстраторку;
 *   (3) Марія приймає — учасниця з роллю «Ілюстратор»; права як були
 *       (пише в кімнаті книги); власник додає другу роль, фрілансер без
 *       спеціалізації — відмова;
 *   (4) адмін публікує версію реєстру ролей з новою роллю — без зміни онтології
 *       твору; вікно запрошення показує її без перезбирання;
 *   (5) вилучити тип твору, на який посилається зв'язок співпраці, — не можна;
 *   (6) телефон 390 px — вибір ролі вміщається.
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
const DIR = path.join(os.tmpdir(), 'nova-live-collab-roles');
const PORT = Number(process.env.COLLAB_ROLES_PORT || 34355);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-COLLAB-LIVE';
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

const { initialBookData } = await import('../src/data/initialBook');
const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const now = new Date().toISOString();
const people = [
  { id: 'u-owner', email: 'owner-collab@test.ua', name: 'Олена', role: 'writer' },
  { id: 'u-maria', email: 'maria-collab@test.ua', name: 'Марія', role: 'writer' },
  { id: 'u-admin', email: 'admin-collab@test.ua', name: 'Адмін', role: 'admin' },
];
const TOK: Record<string, string> = {};
for (const p of people) {
  await saveUser({ ...p, createdAt: now } as any);
  TOK[p.id] = crypto.randomBytes(24).toString('hex');
  await createSession({ token: TOK[p.id], userId: p.id, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });
}

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, APP_URL: BASE, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
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
  const text = await res.text();
  return { status: res.status, body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
};

// ── (1) ──────────────────────────────────────────────────────────────────────
console.log('(1) Перший старт ядра:');
const onto = await q(`SELECT ontology_id, version, status FROM fusion_core.ontology_versions ORDER BY ontology_id`);
t('імпортовано fusion-collab 1 і fusion-story 1 — обидві активні (№31)', onto.length === 2 && onto.every((o: any) => o.status === 'active' && Number(o.version) === 1), JSON.stringify(onto));
t('журнал сервера: імпорт онтології співпраці (35 ролей, 9 міждоменних зв\'язків)', /імпортовано Fusion Collaboration Ontology 1\.0 \(entityTypes 18, roles 35, crossDomainRelations 9\)/.test(log.join('')));
const co = await api('GET', '/api/core/collaboration/ontology', 'u-maria');
t('онтологію співпраці читає будь-хто з входом (версія 1, 35 ролей)', co.status === 200 && co.body.version === 1 && co.body.definition.roles.length === 35);
t('автор не створює чернетку реєстру ролей — 403', (await api('POST', '/api/core/collaboration/ontology/drafts', 'u-owner', {})).status === 403);

// ── Браузер ──────────────────────────────────────────────────────────────────
const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
await browser.setCookie({ name: 'nova_session', value: TOK['u-owner'], domain: 'localhost', path: '/' });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => { void d.accept(); });

const TEST_BOOK = { ...initialBookData, id: BOOK, title: 'Маяк — команда' };
const openInvite = async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#collab-team-drawer-btn', { timeout: 40000 });
  await page.evaluate(() => (document.querySelector('#collab-team-drawer-btn') as HTMLElement | null)?.click());
  await page.waitForSelector('[data-collab-tab="invite"]', { timeout: 20000 });
  await page.evaluate(() => (document.querySelector('[data-collab-tab="invite"]') as HTMLElement | null)?.click());
  await page.waitForSelector('[data-invite-role]', { timeout: 20000 });
  await sleep(1200);
};
const roleOptions = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-invite-role] optgroup')).map((g) => ({ group: g.getAttribute('label'), roles: Array.from(g.querySelectorAll('option')).map((o) => o.getAttribute('value')) })),
  );

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.evaluate(async (book: any) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('nova_studio', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('snapshots')) d.createObjectStore('snapshots', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction(['books', 'meta'], 'readwrite');
        tx.objectStore('books').put({ id: book.id, data: book, updatedAt: new Date().toISOString() });
        tx.objectStore('meta').put({ key: 'active_book_id', value: book.id });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, TEST_BOOK as any);

  // ── (2) ────────────────────────────────────────────────────────────────────
  console.log('\n(2) Вікно запрошення — ролі з реєстру:');
  await openInvite();
  let groups = await roleOptions();
  const all = groups.flatMap((g) => g.roles);
  t('ролі за категоріями реєстру (візуальні, мовні, редакторські, управлінські)', groups.length >= 4 && groups.some((g) => g.group === 'Візуальні та творчі ролі' && g.roles.includes('illustrator')), JSON.stringify(groups.map((g) => g.group)));
  t('у списку — ролі реєстру, без автора, співавтора й власника', all.includes('beta_reader') && all.includes('translator') && !all.some((r) => ['author', 'co_author', 'project_owner'].includes(String(r))), `${all.length} ролей`);
  await page.select('[data-invite-role]', 'illustrator');
  await sleep(300);
  const desc = await page.$eval('[data-invite-role-description]', (e) => (e as HTMLElement).innerText).catch(() => '');
  t('опис обраної ролі — з реєстру', /Ілюстрації сцен, персонажів/.test(desc), desc);
  await page.type('input[type="email"]', 'maria-collab@test.ua');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('form button[type="submit"]')).find((b) => b.closest('form')?.querySelector('[data-invite-role]')) as HTMLElement | undefined;
    btn?.click();
  });
  await sleep(2500);
  const listText = await page.evaluate(() => document.body.innerText);
  t('запрошення в списку — з назвою ролі «Ілюстратор»', /maria-collab@test\.ua/.test(listText) && /Ілюстратор/.test(listText));
  const inv = (await api('GET', `/api/collaboration/invites?bookId=${BOOK}`, 'u-owner')).body.invites?.[0];
  t('збережено роль реєстру illustrator', inv?.role === 'illustrator' && inv?.roleLabel?.uk === 'Ілюстратор', JSON.stringify(inv?.role));

  // ── (3) ────────────────────────────────────────────────────────────────────
  console.log('\n(3) Прийняття → учасниця з роллю:');
  const token = inv?.token;
  const acc = await api('POST', `/api/collaboration/invite/${token}/accept`, 'u-maria');
  t('прийнято: простір designer, роль illustrator, учасниця в ядрі', acc.status === 200 && acc.body.role === 'designer' && acc.body.roleId === 'illustrator' && acc.body.participant?.roleId === 'illustrator', JSON.stringify(acc.body.participantError ?? ''));
  const rows = await q(`SELECT p.user_id, p.source, r.role_id, r.registry_version FROM fusion_core.project_participants p JOIN fusion_core.participant_roles r ON r.participant_id = p.id WHERE p.project_id = $1`, [BOOK]);
  t('у базі: u-maria / invitation / illustrator / реєстр 1', rows.some((r: any) => r.user_id === 'u-maria' && r.source === 'invitation' && r.role_id === 'illustrator' && Number(r.registry_version) === 1), JSON.stringify(rows));
  const me = await api('GET', `/api/core/projects/${BOOK}/participants/me`, 'u-maria');
  t('права як були: Марія пише в книзі (роль ≠ дозвіл)', me.body.roles?.join() === 'illustrator' && me.body.access?.canWrite === true);
  t('власник додає Марії другу роль', (await api('POST', `/api/core/projects/${BOOK}/participants/roles`, 'u-owner', { userId: 'u-maria', roleId: 'cover_designer' })).status === 201);
  t('фрілансер без спеціалізації — 422', (await api('POST', `/api/core/projects/${BOOK}/participants/roles`, 'u-owner', { userId: 'u-free', roleId: 'freelancer' })).status === 422);
  t('Марія сама ролей не призначає — 403', (await api('POST', `/api/core/projects/${BOOK}/participants/roles`, 'u-maria', { userId: 'u-maria', roleId: 'author' })).status === 403);

  // ── (4) ────────────────────────────────────────────────────────────────────
  console.log('\n(4) Нова роль версією реєстру (№48):');
  const d2 = await api('POST', '/api/core/collaboration/ontology/drafts', 'u-admin', { label: '1.1' });
  const NARRATOR = { id: 'audiobook_narrator', label: { en: 'Audiobook Narrator', uk: 'Диктор аудіокниги' }, category: 'language', projectTypes: ['book'], defaultWorkspace: 'translator', suggestedCapabilities: ['view', 'comment', 'upload'], aiProfile: 'translator_default', status: 'active', requiresSpecialization: false, specializations: [], singleHolder: false, combinable: true, invitable: true, legacyIds: [], order: 35, description: { en: 'Records the audiobook.', uk: 'Начитує аудіокнигу.' } };
  await api('PATCH', `/api/core/collaboration/ontology/drafts/${d2.body.version?.id}`, 'u-admin', { ops: [{ op: 'set_role', value: NARRATOR }] });
  const va = await api('POST', `/api/core/collaboration/ontology/drafts/${d2.body.version?.id}/validate`, 'u-admin');
  await api('POST', `/api/core/collaboration/ontology/drafts/${d2.body.version?.id}/impact`, 'u-admin');
  const pub = await api('POST', `/api/core/collaboration/ontology/drafts/${d2.body.version?.id}/publish`, 'u-admin');
  t('опубліковано fusion-collab 2', va.body.validation?.ok && pub.status === 200 && pub.body.version?.version === 2, pub.body.error);
  const story = await q(`SELECT version FROM fusion_core.ontology_versions WHERE ontology_id = 'fusion-story' AND status = 'active'`);
  t('онтологія твору — та сама версія 1', Number(story[0]?.version) === 1);
  t('чернетку співпраці за адресою онтології твору не знайти — 404', (await api('GET', `/api/core/ontology/versions/${d2.body.version?.id}`, 'u-admin')).status === 404);
  await openInvite();
  groups = await roleOptions();
  t('вікно запрошення показує «Диктор аудіокниги» без перезбирання', groups.some((g) => g.group === 'Мовні ролі' && g.roles.includes('audiobook_narrator')));

  // ── (5) ────────────────────────────────────────────────────────────────────
  console.log('\n(5) Міждоменні зв\'язки захищають онтологію твору (№49):');
  const sd = await api('POST', '/api/core/ontology/drafts', 'u-admin', {});
  await api('PATCH', `/api/core/ontology/drafts/${sd.body.version?.id}`, 'u-admin', { ops: [{ op: 'remove_entity_type', id: 'scene' }] });
  await api('POST', `/api/core/ontology/drafts/${sd.body.version?.id}/validate`, 'u-admin');
  const si = await api('POST', `/api/core/ontology/drafts/${sd.body.version?.id}/impact`, 'u-admin');
  t('вилучення scene — блокер: на неї посилаються зв\'язки співпраці', si.body.impact?.blockers?.some((b: any) => b.id === 'scene' && b.kind === 'cross_domain_ref'), si.body.impact?.blockers?.map((b: any) => b.message).join(' | '));
  t('публікація — 409', (await api('POST', `/api/core/ontology/drafts/${sd.body.version?.id}/publish`, 'u-admin')).status === 409);
  await api('POST', `/api/core/ontology/versions/${sd.body.version?.id}/archive`, 'u-admin');

  // ── (6) ────────────────────────────────────────────────────────────────────
  console.log('\n(6) Телефон 390 px:');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await openInvite();
  const ph = await page.evaluate(() => {
    const sel = document.querySelector('[data-invite-role]')?.getBoundingClientRect();
    return { w: window.innerWidth, sw: document.documentElement.scrollWidth, right: sel ? Math.round(sel.right) : null, width: sel ? Math.round(sel.width) : null };
  });
  t('вибір ролі вміщається на екрані, без горизонтальної прокрутки', ph.right != null && ph.right <= ph.w && (ph.width ?? 0) >= 200 && ph.sw <= ph.w + 1, JSON.stringify(ph));
  await page.screenshot({ path: path.join(DIR, 'collab-roles-phone.png') });
  t('без помилок JavaScript на сторінці', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  child.kill();
  await db.end();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
