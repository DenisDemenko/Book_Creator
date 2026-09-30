/**
 * Живий прогін розділу «Пам'ять» у профілі героя — Т2.6 В6.
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:character-memory
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер, книга — стартовий фікстур
 * `BK-2084-CYBER`. Автор набирає в редакторі сцену з тегами (Олена й Марко
 * сваряться); на сторінці героїні: «Зібрати з тегів» → світовий факт зі
 * сценою й джерелом; «AI-2: очима …» — справжня фонова задача `ai_memory`
 * (модель підставна — перехоплювач `fetch` у процесі сервера відповідає
 * замість Gemini) → пропозиція → «Підтвердити»; свій приватний спогад;
 * знімок героїні (`GET …/snapshot`) — з підтвердженою пам'яттю; правка
 * сцени в редакторі → «перевірити» → «Оновити з тегів»; перехід до абзацу;
 * телефон 390 px.
 *
 * Пастка (log.md #172): у page.evaluate — лише рядки або стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL (PostgreSQL з pgvector).');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-character-memory');
const PORT = Number(process.env.CHARACTER_MEMORY_PORT || 34291);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-2084-CYBER';
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
const waitFor = async <T,>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 40000): Promise<T> => {
  let v = await fn();
  for (let i = 0; i < ms / 500 && !ok(v); i++) {
    await sleep(500);
    v = await fn();
  }
  return v;
};

// Підставна модель AI-2: на тлумачення розділу очима героя — спогад і наслідок з першим абзацом розділу.
const FAKE_LOG = path.join(DIR, 'fake-ai2.jsonl');
const FAKE = path.join(DIR, 'fake-ai2.mjs');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /generateContent/.test(url)) {
    const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
    const body = typeof raw === 'string' ? raw : await new Response(raw).text();
    const j = JSON.parse(body);
    const text = [...(j.systemInstruction?.parts ?? []), ...(j.contents ?? []).flatMap((c) => c.parts ?? [])].map((p) => p.text ?? '').join('\\n');
    const hero = (/ОЧИМА героя «([^»]+)»/.exec(text) ?? [])[1] ?? null;
    const ids = ((/Абзаци ЦЬОГО розділу: ([^\\n]+?)\\.(?:\\n| \\()/.exec(text) ?? [])[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    fs.appendFileSync(${JSON.stringify(FAKE_LOG)}, JSON.stringify({ hero, ids: ids.length, hasPrivate: /таємний код/.test(text) }) + '\\n');
    const pid = ids.find((id) => text.includes('[' + id + '] ') && new RegExp('\\\\[' + id + '\\\\] [^\\\\n]*Марко').test(text)) ?? ids[0];
    const answer = hero && pid ? { findings: [
      { kind: 'memory_recollection', summary: hero + ' вважає, що Марко звинуватив її навмисно, аби відвести підозру від себе.', about: ['Марко'], paragraph_ids: [pid], confidence: 0.8 },
      { kind: 'memory_consequence', summary: hero + ' більше не довіряє Маркові.', trust: [{ towards: 'Марко', delta: -2 }], goals: ['з\\'ясувати, що приховує Марко'], paragraph_ids: [pid], confidence: 0.7 },
    ] } : { findings: [] };
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 60, totalTokenCount: 210 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
`);
const fakeCalls = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-memory@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, ['--import', pathToFileURL(FAKE).href, path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: 'live-fake-key', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', APP_URL: BASE },
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
const [{ v }] = await q('SELECT max(version) AS v FROM fusion_core.core_schema_migrations');
t('ядро піднялось, схема v16 (пам\'ять героя)', Number(v) >= 16, `v${v}`);

const api = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
page.on('dialog', (d) => { void d.accept(); });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('\nПідготовка: автор набирає сцену з тегами в редакторі:');
const openEditor = async () => {
  await page.goto(`${BASE}/projects/${BOOK}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 40000 });
  await sleep(1500);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
};
await openEditor();
const first = await page.$('#book-content-editor-ua .ProseMirror > *');
await first!.click();
await page.keyboard.press('End');
await page.keyboard.type(' [/character:Олена Ковальчук] [/character:Марко] [/conflict:Сварка в лабораторії] Марко звинуватив Олену в крадіжці архіву.');
const [conflict] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Сварка в лабораторії'`, [BOOK]), (r) => r.length === 1);
const [olena] = await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук' AND type = 'character'`, [BOOK]);
const [para] = await waitFor(
  () => q(`SELECT id, document_id FROM fusion_core.paragraphs WHERE project_id = $1 AND text LIKE '%звинуватив Олену%' AND deleted_at IS NULL`, [BOOK]),
  (r) => r.length === 1,
);
t('синхронізовано: сварка, Олена, абзац сцени', !!(conflict && olena && para));
if (!conflict || !olena || !para) { console.error(log.join('').slice(-3000)); process.exit(1); }
// Фонові задачі ядра мусять відпрацювати до кінця: без цього перевірка читає
// недописаний стан (розбір — запис #301).
const pendingJobs = await waitFor(
  () => q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND status IN ('queued', 'running')`, [BOOK]),
  (r) => Number(r[0]?.n) === 0,
  90000,
);
t('фонові задачі ядра відпрацювали до кінця', Number(pendingJobs[0]?.n) === 0, `у черзі ${pendingJobs[0]?.n}`);

console.log('\nСторінка героїні — розділ «Пам\'ять»:');
const openProfile = async () => {
  await page.goto(`${BASE}/projects/${BOOK}/characters/${olena.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-memory-panel]', { timeout: 40000 });
  await sleep(800);
};
await openProfile();
t('розділ «Пам\'ять» на сторінці героїні — порожній, з підказкою', !!(await page.$('[data-memory-empty]')));
await page.click('[data-memory-collect]');
await page.waitForSelector('[data-memory-type="world_fact"]', { timeout: 15000 }).catch(() => null);
const factCard = await page.evaluate(() => {
  const el = document.querySelector('[data-memory-type="world_fact"]') as HTMLElement | null;
  return el ? { text: el.innerText, status: el.getAttribute('data-memory-status'), origin: el.getAttribute('data-memory-origin'), open: el.querySelector('[data-memory-open]')?.getAttribute('data-memory-open'), group: !!el.closest('[data-memory-group="world_fact"]') } : null;
});
t('«Зібрати з тегів» — світовий факт «Сварка в лабораторії»: група «Світ», з тегів, підтверджено, джерело — абзац сцени',
  !!factCard && /Сварка в лабораторії/.test(factCard.text) && factCard.status === 'confirmed' && factCard.origin === 'tag' && factCard.open === para.id && factCard.group, JSON.stringify(factCard));
const msg1 = await page.$eval('[data-memory-message]', (e) => e.textContent || '').catch(() => '');
t('повідомлення про збір', /додано спогадів: 1/.test(msg1), msg1);

console.log('\nAI-2 тлумачить сцену очима героїні (справжня задача ai_memory):');
await page.select('[data-memory-ai-section]', para.document_id);
await page.click('[data-memory-run-ai]');
const aiMsg = await waitFor(() => page.$eval('[data-memory-message]', (e) => e.textContent || '').catch(() => ''), (s) => /AI-2/.test(s), 60000);
t('задача пройшла — «AI-2 запропонував спогадів: 2»', /запропонував спогадів: 2/.test(aiMsg), aiMsg);
const calls = fakeCalls();
t('один запит до моделі — очима лише Олени (Марко — окремо не питали)', calls.length === 1 && calls[0].hero === 'Олена Ковальчук', JSON.stringify(calls));
await page.waitForSelector('[data-memory-attention] [data-memory-origin="ai"]', { timeout: 10000 }).catch(() => null);
const sug = await page.evaluate(() => Array.from(document.querySelectorAll('[data-memory-attention] [data-memory-origin="ai"]')).map((el) => ({ id: el.getAttribute('data-memory'), type: el.getAttribute('data-memory-type'), text: (el as HTMLElement).innerText })));
t('«На розгляд автору»: спогад і наслідок (довіра до Марка −2, мета), зі статусом «пропозиція»',
  sug.length === 2 && sug.some((s) => s.type === 'recollection' && /навмисно/.test(s.text) && /пропозиція/.test(s.text)) && sug.some((s) => s.type === 'consequence' && /довіра до Марко: -2/.test(s.text) && /мета:/.test(s.text)), JSON.stringify(sug.map((s) => s.text.slice(0, 80))));
const rec = sug.find((s) => s.type === 'recollection')!;
const cons = sug.find((s) => s.type === 'consequence')!;
await page.click(`[data-memory="${rec.id}"] [data-memory-confirm]`);
const recRow = await waitFor(() => q(`SELECT status, reviewed_by FROM fusion_core.character_memories WHERE id = $1`, [rec.id]), (r) => r[0]?.status === 'confirmed', 10000);
t('«Підтвердити» — у базі confirmed, від автора', recRow[0]?.status === 'confirmed' && recRow[0]?.reviewed_by === 'user:u-admin', JSON.stringify(recRow));
await page.waitForSelector(`[data-memory-group="recollection"] [data-memory="${rec.id}"]`, { timeout: 10000 }).catch(() => null);
t('картка перейшла в групу «Спогади»', !!(await page.$(`[data-memory-group="recollection"] [data-memory="${rec.id}"]`)));
await page.click(`[data-memory="${cons.id}"] [data-memory-reject]`);
await waitFor(() => q(`SELECT status FROM fusion_core.character_memories WHERE id = $1`, [cons.id]), (r) => r[0]?.status === 'rejected', 10000);
await sleep(500);
t('«Відхилити» — зникає з переліку, «Показати відхилені (1)»', !(await page.$(`[data-memory="${cons.id}"]`)) && /\(1\)/.test(await page.$eval('[data-memory-toggle-rejected]', (e) => e.textContent || '').catch(() => '')));

console.log('\nСвій спогад (приватний):');
await page.click('[data-memory-new]');
await page.waitForSelector('[data-memory-form]', { timeout: 5000 });
await page.select('[data-memory-new-type]', 'belief');
await page.type('[data-memory-new-content]', 'Олена певна: таємний код архіву знає лише вона.');
await page.click('[data-memory-new-private]');
await page.click('[data-memory-add]');
const own = await waitFor(() => q(`SELECT id, visibility, status, origin FROM fusion_core.character_memories WHERE project_id = $1 AND content LIKE '%таємний код%'`, [BOOK]), (r) => r.length === 1, 10000);
await page.waitForSelector(`[data-memory="${own[0]?.id}"] [data-memory-private]`, { timeout: 10000 }).catch(() => null);
t('приватне переконання — у базі (автор, hidden, підтверджено) і на сторінці з позначкою «приватне»',
  own[0]?.visibility === 'hidden' && own[0]?.status === 'confirmed' && own[0]?.origin === 'author' && !!(await page.$(`[data-memory-group="belief"] [data-memory="${own[0]?.id}"] [data-memory-private]`)));

await (await page.$('[data-memory-panel]'))?.screenshot({ path: path.join(DIR, 'memory-panel.png') });

console.log('\nЗнімок героїні:');
const snap = await api('GET', `/api/projects/${BOOK}/characters/${olena.id}/snapshot`);
t('GET …/snapshot — підтверджені спогад, факт і переконання; відхиленого наслідку немає; стан записано',
  snap.status === 200 && snap.body.snapshot.memories?.some((m: any) => /навмисно/.test(m.content)) && snap.body.snapshot.memories?.some((m: any) => /Сварка в лабораторії/.test(m.content)) &&
  snap.body.snapshot.beliefs?.some((b: any) => /таємний код/.test(b.statement)) && !JSON.stringify(snap.body.snapshot).includes('більше не довіряє') && !!snap.body.state?.id,
  JSON.stringify({ s: snap.status, m: snap.body.snapshot?.memories?.length, b: snap.body.snapshot?.beliefs?.length }));

console.log('\nПравка сцени → «перевірити» → «Оновити з тегів»:');
await openEditor();
// Дописати в кінець саме того абзацу (клавіша End веде лише в кінець видимого рядка).
await waitFor(() => page.evaluate(`(() => /звинуватив Олену/.test(document.querySelector('#book-content-editor-ua .ProseMirror')?.textContent || ''))()`) as Promise<boolean>, (x) => x === true, 20000);
await sleep(1500);
const insert = () => page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  let at = null;
  ed.state.doc.descendants((n, pos) => { if (at === null && n.isTextblock && /звинуватив Олену/.test(n.textContent)) { at = pos + n.nodeSize - 1; return false; } return true; });
  if (at === null) return false;
  ed.chain().focus().insertContentAt(at, ' Потім довго мовчали.').run();
  return true;
})()`);
let inserted = await insert();
let saved = await waitFor(() => q(`SELECT 1 FROM fusion_core.paragraphs WHERE id = $1 AND text LIKE '%мовчали%'`, [para.id]), (r) => r.length === 1, 30000);
if (!saved.length) {
  // Редактор міг перезавантажити вміст після першої вставки — ще раз.
  inserted = await insert();
  saved = await waitFor(() => q(`SELECT 1 FROM fusion_core.paragraphs WHERE id = $1 AND text LIKE '%мовчали%'`, [para.id]), (r) => r.length === 1, 40000);
}
t('правка в редакторі — дописано в кінець абзацу сцени, збережено й синхронізовано', inserted === true && saved.length === 1);
const flagged = await waitFor(
  () => q(`SELECT id, status, origin, review_note FROM fusion_core.character_memories WHERE project_id = $1 AND character_id = $2 AND simulation_id IS NULL AND status = 'needs_review'`, [BOOK, olena.id]),
  (r) => r.length >= 2,
  40000,
);
t('КРИТЕРІЙ Т2.6: правка сцени — «перевірити» факт із тегів і підтверджений спогад AI (приватне переконання без доказів — ні)',
  flagged.some((r) => r.origin === 'tag') && flagged.some((r) => r.id === rec.id) && !flagged.some((r) => r.id === own[0]?.id),
  JSON.stringify({ f: flagged.map((r) => [r.origin, r.review_note]), para: (await q(`SELECT right(text, 60) AS t FROM fusion_core.paragraphs WHERE id = $1`, [para.id]))[0]?.t, all: await q(`SELECT origin, status FROM fusion_core.character_memories WHERE project_id = $1`, [BOOK]) }));
const [note] = await q(`SELECT message FROM fusion_core.core_notifications WHERE project_id = $1 AND kind = 'memories_need_review' ORDER BY created_at DESC LIMIT 1`, [BOOK]);
t('сповіщення автору', /Олена Ковальчук/.test(note?.message ?? ''), note?.message);
await openProfile();
const tagFlag = flagged.find((r) => r.origin === 'tag')!;
await page.waitForSelector(`[data-memory-attention] [data-memory="${tagFlag.id}"][data-memory-status="needs_review"]`, { timeout: 10000 }).catch(() => null);
const flagCard = await page.evaluate((id: string) => {
  const el = document.querySelector(`[data-memory="${id}"]`) as HTMLElement | null;
  return el ? { text: el.innerText, refresh: !!el.querySelector('[data-memory-refresh]'), confirm: el.querySelector('[data-memory-confirm]')?.textContent } : null;
}, tagFlag.id);
t('на сторінці: «перевірити», примітка, «Досі так» і «Оновити з тегів»', !!flagCard && /перевірити/.test(flagCard.text) && /змінено/.test(flagCard.text) && flagCard.refresh && /Досі так/.test(flagCard.confirm ?? ''), JSON.stringify(flagCard));
await page.click(`[data-memory="${tagFlag.id}"] [data-memory-refresh]`);
const fresh = await waitFor(
  () => q(`SELECT id, status FROM fusion_core.character_memories WHERE project_id = $1 AND character_id = $2 AND origin = 'tag' ORDER BY created_at DESC`, [BOOK, olena.id]),
  (r) => r.some((x) => x.status === 'superseded') && r.some((x) => x.status === 'confirmed'),
  10000,
);
t('«Оновити з тегів» — старий замінено, новий підтверджено', fresh.some((x) => x.id === tagFlag.id && x.status === 'superseded') && fresh.some((x) => x.id !== tagFlag.id && x.status === 'confirmed'));
await sleep(1000);
await page.waitForSelector(`[data-memory="${rec.id}"] [data-memory-confirm]`, { timeout: 10000 });
await page.click(`[data-memory="${rec.id}"] [data-memory-confirm]`);
await waitFor(() => q(`SELECT status FROM fusion_core.character_memories WHERE id = $1`, [rec.id]), (r) => r[0]?.status === 'confirmed', 10000);
const recAfter = (await q(`SELECT status, review_note FROM fusion_core.character_memories WHERE id = $1`, [rec.id]))[0];
t('спогад AI — «Досі так» знову підтверджено, стара примітка про правку знята', recAfter?.status === 'confirmed' && recAfter?.review_note === null, JSON.stringify(recAfter));

console.log('\nПерехід до абзацу:');
await openProfile();
await page.click(`[data-memory="${rec.id}"] [data-memory-open]`);
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 20000 }).catch(() => null);
t('«Відкрити в тексті» — редактор із цією сценою', /звинуватив Олену/.test(await page.$eval('#book-content-editor-ua', (e) => e.textContent || '').catch(() => '')));

console.log('\nТелефон:');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await openProfile();
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await sleep(800);
const m = await page.evaluate(() => {
  const el = document.querySelector('[data-memory-panel]') as HTMLElement;
  const box = el.getBoundingClientRect();
  const wide = Array.from(el.querySelectorAll('*')).filter((x) => x.getBoundingClientRect().right > box.right + 1).slice(0, 3).map((x) => `${x.tagName}.${String((x as HTMLElement).className).slice(0, 40)}`);
  return { scroll: el.scrollWidth, client: el.clientWidth, wide };
});
t('на 390 px — розділ «Пам\'ять» без горизонтальної прокрутки', m.scroll <= m.client + 1 && m.client >= 220, JSON.stringify(m));
await (await page.$('[data-memory-panel]'))?.screenshot({ path: path.join(DIR, 'memory-mobile.png') });
console.log(`  (знімки: ${DIR}/memory-panel.png, memory-mobile.png)`);
t('без помилок сторінки', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
