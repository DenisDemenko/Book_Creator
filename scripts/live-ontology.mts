/**
 * Живий прогін реєстру схем (Т5.1 В4, `PLAN_ONTOLOGY.md`; ТЗ Graph Studio
 * §39 №1–5, 28, 30). Запуск: CORE_TEST_DATABASE_URL=postgres://…
 * npm run live:ontology (потрібен зібраний dist/server.mjs і `.env` з
 * VITE_FIREBASE_*; схема `fusion_core` у цій базі видаляється — лише
 * тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер:
 *   (1) перший старт ядра імпортує чинний реєстр як онтологію 1.0;
 *   (2) редактор показує теги за v1 (назва, колір), невідомого типу
 *       `prophecy` ще немає;
 *   (3) адмін через API: чернетка → правки → перевірка → перегляд → вплив;
 *       вилучення типу з даними — 409, застарілий — публікується;
 *   (4) редактор після перезавантаження сторінки (без перезбирання): нова
 *       назва й колір `character`, тег `prophecy` став міткою, застарілий
 *       `ending` — тег у тексті лишився, у панелі типу немає; машинні ID у
 *       тексті книги ті самі;
 *   (5) офлайн — збережена копія тієї самої версії;
 *   (6) відкат до 1 не пускає, бо в книзі вже є дані нового типу; відкат до 2
 *       після 3 — нова версія з визначенням 2, і редактор її показує;
 *   (7) журнал аудиту.
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
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL (PostgreSQL з pgvector).');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-live-ontology');
const PORT = Number(process.env.ONTOLOGY_PORT || 34333);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-ONTOLOGY-LIVE';
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
const { textColorOnWhite, FACTORY_ENTITIES } = await import('../src/utils/coreEntities');
const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-onto', email: 'admin-ontology@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
await saveUser({ id: 'u-writer', email: 'writer-ontology@test.ua', name: 'Автор', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
const WRITER = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-onto', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
await createSession({ token: WRITER, userId: 'u-writer', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const TEXT = [
  '[/character:Олена] Олена піднялась на маяк і довго дивилась на море.',
  '[/ending:Відкритий] Кінець лишився відкритим — так хотів автор.',
  '[/prophecy:Сивіла] Стара Сивіла сказала, що світло згасне тричі.',
].join('\n\n');
const TEST_BOOK = {
  ...initialBookData,
  id: BOOK,
  title: 'Маяк — живий прогін онтології',
  chapters: [{ id: 'ch-1', bookId: BOOK, title: 'Глава 1', order: 1, sections: [{ id: 'sec-1', chapterId: 'ch-1', title: 'Маяк', order: 1, wordCount: 0, lastModified: new Date().toISOString(), content: TEXT }] }],
  characters: [],
  footnotes: [],
};

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, APP_URL: BASE },
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

const api = async (method: string, p: string, body?: unknown, token = TOKEN) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
};

// ── (1) імпорт ───────────────────────────────────────────────────────────────
console.log('(1) Перший старт ядра:');
const [{ v: schemaV }] = await q('SELECT max(version) AS v FROM fusion_core.core_schema_migrations');
t('схема ядра v19 (реєстр схем)', Number(schemaV) >= 19, `v${schemaV}`);
const v1rows = await q(`SELECT version, status, label, created_by, jsonb_array_length(definition->'entityTypes') AS n, jsonb_array_length(definition->'relationTypes') AS r FROM fusion_core.ontology_versions`);
t('імпортовано онтологію 1.0: 118 типів, 39 зв\'язків, активна, system:ontology-import (№1)', v1rows.length === 1 && v1rows[0].status === 'active' && Number(v1rows[0].n) === 118 && Number(v1rows[0].r) === 39 && v1rows[0].created_by === 'system:ontology-import', JSON.stringify(v1rows[0]));
t('журнал сервера: імпорт і активна версія', /імпортовано Fusion Story Ontology 1\.0/.test(log.join('')) && /активна версія — fusion-story@1/.test(log.join('')));
const g1 = await api('GET', '/api/core/ontology', undefined, WRITER);
t('автор бачить активну версію 1 (get_schema)', g1.status === 200 && g1.body.version === 1 && g1.body.source === 'registry');
t('автор не створює чернетку — 403', (await api('POST', '/api/core/ontology/drafts', {}, WRITER)).status === 403);

// Дані в ядрі: тип mystery у книзі — вилучити його не можна буде.
await q(`INSERT INTO fusion_core.projects (id, owner_id, title) VALUES ('onto-live', 'u-onto', 'Маяк')`);
await q(`INSERT INTO fusion_core.entities (project_id, type, name, created_by, status) VALUES ('onto-live', 'mystery', 'Таємниця маяка', 'user:u-onto', 'confirmed')`);

// ── Браузер ──────────────────────────────────────────────────────────────────
const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => { void d.accept(); });
let offline = false;
await page.setRequestInterception(true);
page.on('request', (r) => {
  if (offline && r.url().includes('/api/core/ontology')) void r.abort('internetdisconnected');
  else void r.continue();
});

const openEditor = async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async (e) => {
    console.error('Навігація не вдалась:', (e as Error).message, '\nЛог сервера:', log.join('').slice(-1500));
    throw e;
  });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.click('#nav-tab-editor');
  await page.waitForSelector('.ProseMirror [data-entity-slug]', { timeout: 40000 });
  await sleep(1500);
};
const marks = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.ProseMirror [data-entity-slug]')).map((m) => ({ slug: m.getAttribute('data-entity-slug'), color: (m as HTMLElement).style.color, title: m.getAttribute('title') || '' })),
  );
const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};
const openPanel = async () => {
  if (!(await page.$('[data-core-entity-panel]'))) await page.click('[data-tour="editor__entities"]');
  await page.waitForSelector('[data-core-entity-panel]', { timeout: 20000 });
};
const panelRows = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-entity-row]')).map((r) => r.getAttribute('data-entity-row')));
const openAllGroups = async () => {
  await page.evaluate(() => {
    for (const h of Array.from(document.querySelectorAll('button[data-entity-group]'))) {
      if (!h.nextElementSibling) (h as HTMLElement).click();
    }
  });
  await sleep(400);
};
const searchPanel = async (text: string) => {
  await page.click('[data-entity-search]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (text) await page.type('[data-entity-search]', text);
  await sleep(500);
  return panelRows();
};

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

  // ── (2) редактор за v1 ─────────────────────────────────────────────────────
  console.log('\n(2) Редактор за версією 1:');
  await openEditor();
  const ch1 = FACTORY_ENTITIES.find((e) => e.slug === 'character')!;
  let m = await marks();
  t('character — назва й колір із версії 1', m.some((x) => x.slug === 'character' && x.title.includes(ch1.nameUk) && x.color === rgb(textColorOnWhite(ch1.color))), JSON.stringify(m.find((x) => x.slug === 'character')));
  t('ending — мітка; prophecy — ще не тип (не мітка)', m.some((x) => x.slug === 'ending') && !m.some((x) => x.slug === 'prophecy'));
  const cached1 = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('nova.ontology.active.v1') || 'null')?.version ?? null; } catch { return null; } });
  t('браузер зберіг копію активної версії 1', cached1 === 1, String(cached1));
  await openPanel();
  t('панель: prophecy не знайти, ending — є', !(await searchPanel('proph')).includes('prophecy') && (await searchPanel('ending')).includes('ending'));

  // ── (3) цикл через API ─────────────────────────────────────────────────────
  console.log('\n(3) Адмін: чернетка → перевірка → перегляд → вплив → публікація:');
  const cd = await api('POST', '/api/core/ontology/drafts', { label: '1.1', notes: 'Пророцтво, новий колір героя' });
  const draftId = cd.body.version?.id;
  t('чернетка версії 2', cd.status === 201 && cd.body.version.version === 2, `${cd.status}`);
  const def = (await api('GET', `/api/core/ontology/versions/${draftId}`)).body.version.definition;
  const ch = def.entityTypes.find((e: any) => e.id === 'character');
  const mys = def.entityTypes.find((e: any) => e.id === 'mystery');
  const PROPHECY = { id: 'prophecy', name: { en: 'Prophecy', uk: 'Пророцтво' }, groupId: 'B', family: null, status: 'active', registry: 'custom', ui: { color: '#7C3AED', order: 118 }, ai: { description: 'Передбачення, що збувається чи ні.', hints: [] }, properties: [{ id: 'zmist', name: { uk: 'Зміст' }, type: 'text' }], aliases: ['пророцтво'] };
  const ed = await api('PATCH', `/api/core/ontology/drafts/${draftId}`, {
    expectedRevision: cd.body.version.revision,
    ops: [
      { op: 'set_entity_type', value: { ...ch, name: { en: 'Character', uk: 'Герой твору' }, ui: { ...ch.ui, color: '#0F766E' } } },
      { op: 'set_entity_type', value: PROPHECY },
      { op: 'set_entity_status', id: 'ending', status: 'deprecated' },
      { op: 'remove_entity_type', id: 'mystery' },
    ],
  });
  t('правки прийнято', ed.status === 200, ed.body.error);
  const va = await api('POST', `/api/core/ontology/drafts/${draftId}/validate`);
  t('VALIDATE — без помилок', va.status === 200 && va.body.validation.ok);
  const pv = await api('GET', `/api/core/ontology/drafts/${draftId}/preview`);
  t('PREVIEW — додано prophecy, вилучено mystery, застаріло ending, змінено character', pv.body.diff?.entityTypes.added.includes('prophecy') && pv.body.diff.entityTypes.removed.includes('mystery') && pv.body.diff.entityTypes.deprecated.includes('ending') && pv.body.diff.entityTypes.changed.some((c: any) => c.id === 'character'));
  const im = await api('POST', `/api/core/ontology/drafts/${draftId}/impact`);
  t('MIGRATION IMPACT — mystery має 1 сутність у книзі: блокер', im.body.impact?.blockers?.[0]?.id === 'mystery' && im.body.impact.blockers[0].usage.entities === 1, im.body.impact?.blockers?.[0]?.message);
  const blocked = await api('POST', `/api/core/ontology/drafts/${draftId}/publish`);
  t('PUBLISH — 409: руйнівне видалення типу з даними заборонено', blocked.status === 409 && /mystery/.test(blocked.body.error), blocked.body.error);
  await api('PATCH', `/api/core/ontology/drafts/${draftId}`, { ops: [{ op: 'set_entity_type', value: { ...mys, status: 'deprecated' } }] });
  await api('POST', `/api/core/ontology/drafts/${draftId}/validate`);
  await api('POST', `/api/core/ontology/drafts/${draftId}/impact`);
  const pub = await api('POST', `/api/core/ontology/drafts/${draftId}/publish`);
  t('mystery застарілий замість вилучення — опубліковано, версія 2 активна', pub.status === 200 && pub.body.version.status === 'active' && pub.body.version.version === 2, pub.body.error);

  // ── (4) редактор за v2 ─────────────────────────────────────────────────────
  console.log('\n(4) Редактор після перезавантаження сторінки (без перезбирання):');
  await openEditor();
  m = await marks();
  const chMark = m.find((x) => x.slug === 'character');
  t('character — «Герой твору» і новий колір (UI-метадані з реєстру, №5)', !!chMark && chMark.title.includes('Герой твору') && chMark.color === rgb(textColorOnWhite('#0F766E')), JSON.stringify(chMark));
  t('тег prophecy у тексті став міткою нового типу', m.some((x) => x.slug === 'prophecy' && x.title.includes('Пророцтво')));
  t('застарілий ending — тег у тексті лишився міткою (дані дійсні)', m.some((x) => x.slug === 'ending'));
  await openPanel();
  t('панель: prophecy знаходиться пошуком, ending — ні (застарілий)', (await searchPanel('proph')).includes('prophecy') && !(await searchPanel('ending')).includes('ending'));
  await searchPanel('');
  await openAllGroups();
  const rows = await panelRows();
  t('у групах панелі: prophecy є, ending і mystery немає', rows.includes('prophecy') && !rows.includes('ending') && !rows.includes('mystery'), `${rows.length} рядків`);
  const text = await page.evaluate((id: string) => new Promise<string>((ok) => {
    const r = indexedDB.open('nova_studio', 1);
    r.onsuccess = () => {
      const g = r.result.transaction('books').objectStore('books').get(id);
      g.onsuccess = () => ok(String(g.result?.data?.chapters?.[0]?.sections?.[0]?.content ?? ''));
      g.onerror = () => ok('');
    };
    r.onerror = () => ok('');
  }), BOOK);
  t('текст книги — ті самі машинні ID (№30)', text.includes('[/character:Олена]') && text.includes('[/ending:Відкритий]') && text.includes('[/prophecy:Сивіла]'));
  const ents = await (await fetch(`${BASE}/api/core/entities`, { headers: { Cookie: `nova_session=${TOKEN}` } })).json();
  t('/api/core/entities — словник версії 2 (119 типів, ontology fusion-story@2)', ents.ontology === 'fusion-story@2' && ents.entities.length === 119 && ents.entities.some((e: any) => e.slug === 'prophecy'), `${ents.ontology} ${ents.entities?.length}`);

  // ── (5) офлайн ─────────────────────────────────────────────────────────────
  console.log('\n(5) Офлайн:');
  offline = true;
  await openEditor();
  m = await marks();
  t('без /api/core/ontology — збережена копія версії 2 (character «Герой твору», prophecy — мітка)', m.some((x) => x.slug === 'character' && x.title.includes('Герой твору')) && m.some((x) => x.slug === 'prophecy'));
  offline = false;

  // ── (6) відкат ─────────────────────────────────────────────────────────────
  console.log('\n(6) Відкат:');
  await q(`INSERT INTO fusion_core.entities (project_id, type, name, created_by, status) VALUES ('onto-live', 'prophecy', 'Пророцтво Сивіли', 'user:u-onto', 'confirmed')`);
  const v1id = (await q(`SELECT id FROM fusion_core.ontology_versions WHERE version = 1`))[0].id;
  const rb1 = await api('POST', `/api/core/ontology/versions/${v1id}/rollback`);
  t('відкат до 1 — 409: у книзі вже є сутність prophecy (її тип зник би)', rb1.status === 409 && /prophecy/.test(rb1.body.error) && !!rb1.body.details?.draftId, rb1.body.error);
  t('…чернетку відкату лишено з блокерами; відкидаємо', (await api('POST', `/api/core/ontology/versions/${rb1.body.details?.draftId}/archive`)).body.version?.status === 'archived');
  const v2id = pub.body.version.id;
  const d3 = await api('POST', '/api/core/ontology/drafts', { label: '1.2' });
  await api('PATCH', `/api/core/ontology/drafts/${d3.body.version.id}`, { ops: [{ op: 'set_entity_type', value: { ...PROPHECY, ui: { ...PROPHECY.ui, color: '#B91C1C' } } }] });
  await api('POST', `/api/core/ontology/drafts/${d3.body.version.id}/validate`);
  await api('POST', `/api/core/ontology/drafts/${d3.body.version.id}/impact`);
  const p3 = await api('POST', `/api/core/ontology/drafts/${d3.body.version.id}/publish`);
  t('версія з червоним prophecy опублікована', p3.status === 200, p3.body.error);
  await openEditor();
  t('редактор: prophecy червоний', (await marks()).some((x) => x.slug === 'prophecy' && x.color === rgb(textColorOnWhite('#B91C1C'))));
  const rb2 = await api('POST', `/api/core/ontology/versions/${v2id}/rollback`);
  const hashes = await q(`SELECT version, definition_hash, status FROM fusion_core.ontology_versions ORDER BY version`);
  const h2 = hashes.find((h: any) => Number(h.version) === 2)?.definition_hash;
  t('відкат до 2 — НОВА активна версія з визначенням 2 (№4)', rb2.status === 200 && rb2.body.version.definitionHash === h2 && rb2.body.version.version > 3, `${rb2.status} v${rb2.body.version?.version}`);
  t('у базі одна активна; опубліковані версії не змінились', hashes.filter((h: any) => h.status === 'active').length === 1, hashes.map((h: any) => `${h.version}:${h.status}`).join(' '));
  await openEditor();
  t('редактор: prophecy знову фіолетовий', (await marks()).some((x) => x.slug === 'prophecy' && x.color === rgb(textColorOnWhite('#7C3AED'))));
  const trig = await q(`UPDATE fusion_core.ontology_versions SET definition = '{"x":1}'::jsonb WHERE version = 2`).then(() => false, () => true);
  t('опубліковане визначення не змінити навіть SQL-ем', trig);

  // ── (7) журнал ─────────────────────────────────────────────────────────────
  console.log('\n(7) Журнал аудиту:');
  const ev = await api('GET', '/api/core/ontology/events');
  const acts = new Set((ev.body.events ?? []).map((e: any) => e.action));
  t('імпорт, чернетка, правка, перевірка, вплив, публікація, відкат, відкидання — з автором', ['import', 'create_draft', 'edit', 'validate', 'impact', 'publish', 'rollback', 'discard'].every((a) => acts.has(a)) && ev.body.events.every((e: any) => /^(user:u-onto|system:)/.test(e.actor)), [...acts].join(', '));
  t('без помилок JavaScript на сторінці', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  child.kill();
  await db.end();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
