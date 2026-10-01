/**
 * Живий прогін шести критеріїв FLC 2.0 §7 для «Допиту живого персонажа» —
 * Т2.7 В6 (`PLAN_INTERVIEW.md`). Запуск: CORE_TEST_DATABASE_URL=postgres://…
 * npm run live:interview-criteria (потрібен зібраний dist/server.mjs і `.env`
 * з VITE_FIREBASE_* — без них застосунок у браузері не стартує; схема
 * `fusion_core` у цій базі видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер; Jev — справжній `HttpJevAdapter`,
 * голос — модуль «Ядра AI» `coreCharacterVoice`; TypeSafe і Gemini підставні
 * (перехоплювач `fetch` у процесі сервера, режими задаються файлами).
 * Книга: Олена й Марко сваряться (гл. 1), Олена сама (гл. 1), у гл. 2 —
 * розкриття «Марко зрадник»; у Марка — приватний спогад «вкрав архів».
 *   (1) факт профілю — з джерелом або позначкою гіпотези;
 *   (2) у запитах голосу немає майбутнього й чужих приватних секретів;
 *   (3) десять відповідей поспіль — без втрати контексту й без зміни канону;
 *   (4) автор приймає окремі результати в канон і пам'ять або відхиляє;
 *   (5) правка затвердженої сцени — залежна пам'ять «перевірити», допит застарів;
 *   (6) Jev недоступний (529, мережа) — запасний LLM; голос недоступний —
 *       «не вдалося» без втрати стану й без секретів, «повторити» — відповідь.
 * Плюс сторінка героїні: 10+ ходів, «Повторити» в інтерфейсі, телефон 390 px.
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
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL (PostgreSQL з pgvector).');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-interview-criteria');
const PORT = Number(process.env.INTERVIEW_CRITERIA_PORT || 34298);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-LIVE-FLC';
const HERO = 'Олена Ковальчук';
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

// Перехоплювач fetch у процесі сервера: TypeSafe (Jev) і Gemini (голос героя, запасний LLM).
const MODE = path.join(DIR, 'jev-mode.txt');
const VOICE_LOG = path.join(DIR, 'voice.jsonl');
const VOICE_MODE = path.join(DIR, 'voice-mode.txt');
const JEV_LOG = path.join(DIR, 'jev-states.jsonl');
const FAKE = path.join(DIR, 'fake-interview.mjs');
fs.writeFileSync(MODE, 'ok');
fs.writeFileSync(VOICE_MODE, 'ok');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
const bodyOf = async (input, init) => {
  const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
  return typeof raw === 'string' ? raw : await new Response(raw).text();
};
let n = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/api\\.typesafe\\.ai/.test(url)) {
    const body = JSON.parse(await bodyOf(input, init));
    const mode = fs.readFileSync(${JSON.stringify(MODE)}, 'utf8').trim();
    const st = JSON.stringify(body.state ?? {});
    fs.appendFileSync(${JSON.stringify(JEV_LOG)}, JSON.stringify({ future: /зрадник/.test(st), secret: /вкрав архів/.test(st) }) + '\\n');
    if (mode === 'network') throw new TypeError('fetch failed');
    if (mode === '529') return new Response(JSON.stringify({ error: { message: 'перевантажено' } }), { status: 529 });
    const conf = mode === 'low' ? 0.1 : 0.9;
    const answers = {};
    for (const [id, qq] of Object.entries(body.questions)) {
      if (qq.type === 'choice') {
        const keys = Object.keys(qq.criteria);
        const pick = keys.includes('deflect') ? 'deflect' : keys[0];
        answers[id] = { type: 'choice', choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.7 : 0.3 / Math.max(1, keys.length - 1)])), confidence: conf };
      } else if (qq.type === 'score') answers[id] = { type: 'score', score: 2, probabilities: { '2': 1 }, confidence: conf };
      else answers[id] = { type: 'noul', probability: 0.8, confidence: conf };
    }
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 400, output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /generateContent/.test(url)) {
    const j = JSON.parse(await bodyOf(input, init));
    const text = [...(j.systemInstruction?.parts ?? []), ...(j.contents ?? []).flatMap((c) => c.parts ?? [])].map((p) => p.text ?? '').join('\\n');
    let answer;
    if (/на допиті в автора/.test(text)) {
      const vmode = fs.readFileSync(${JSON.stringify(VOICE_MODE)}, 'utf8').trim();
      if (vmode === 'down') return new Response(JSON.stringify({ error: { message: 'model overloaded', code: 503 } }), { status: 503, headers: { 'content-type': 'application/json' } });
      n++;
      const q = (/Питання автора: (.*)$/m.exec(text) ?? [])[1] ?? '';
      fs.appendFileSync(${JSON.stringify(VOICE_LOG)}, JSON.stringify({ q, secret: /вкрав архів/.test(text), answers: (text.match(/^Олена Ковальчук: /gm) ?? []).length, future: /зрадник/.test(text), history: (text.match(/^Автор: /gm) ?? []).length, action: (/дія: ([a-z_]+)/.exec(text) ?? [])[1] ?? null }) + '\\n');
      answer = {
        reply: 'Я сиділа в кабінеті й нікого не чекала. Навіщо вам це? (хід ' + n + ')',
        intent: 'ухилитися від прямої відповіді',
        proposals: {
          memories: [{ type: 'recollection', content: 'Олена відчула, що автор їй не вірить (хід ' + n + ').' }, { type: 'belief', content: 'Олена вважає, що її підозрюють через Марка (хід ' + n + ').' }],
          facts: [{ statement: 'Олена боїться, що її звинуватять (хід ' + n + ').', field: 'fear' }],
          fragment: { text: '[/character:${HERO}] — Я нікого не чекала, — тихо сказала Олена (хід ' + n + ').', tags: ['[/emotion:тривога @${HERO}]', '[/emotion:втома @${HERO}]'] },
        },
      };
    } else {
      const answers = {};
      for (const m of text.matchAll(/Питання "([a-z_0-9]+)" \\(вибір\\)[^\\n]*\\nВаріанти: ([^\\n]+)/g)) answers[m[1]] = { choice: m[2].split(',')[0].trim() };
      for (const m of text.matchAll(/Питання "([a-z_0-9]+)" \\(оцінка\\)/g)) answers[m[1]] = { score: 2 };
      answer = { answers };
    }
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 80, totalTokenCount: 380 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
`);
const setMode = (m: 'ok' | 'low' | '529' | 'network') => fs.writeFileSync(MODE, m);
const setVoice = (m: 'ok' | 'down') => fs.writeFileSync(VOICE_MODE, m);
const voiceCalls = () => (fs.existsSync(VOICE_LOG) ? fs.readFileSync(VOICE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-interview@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, ['--import', pathToFileURL(FAKE).href, path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: 'live-fake-key', TYPESAFE_API_KEY: 'live-typesafe-key', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', APP_URL: BASE },
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
t('ядро піднялось, схема v17 (допит)', Number(v) >= 17, `v${v}`);

const api = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
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

// Книга живе в IndexedDB браузера (і дзеркалиться на сервер): беремо стартову
// книгу як зразок полів і кладемо свою — з тими самими полями — і в браузер, і на сервер.
await page.goto(`${BASE}/projects/BK-2084-CYBER/editor`, { waitUntil: 'domcontentloaded' });
// Спершу застосунок сам створює сховище й кладе стартову книгу (інакше наш indexedDB.open випередить його оновлення схеми).
if (!(await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 40000 }).catch(() => null))) {
  await page.screenshot({ path: path.join(DIR, 'fail-editor.png') });
  console.error('Редактор не відкрився:', page.url(), (await page.evaluate(() => document.body.innerText.slice(0, 800))).replace(/\n+/g, ' | '));
  process.exit(1);
}
await sleep(1500);
const idb = (code: string) => page.evaluate(`new Promise((ok, bad) => { const r = indexedDB.open('nova_studio', 1); r.onerror = () => bad(r.error); r.onsuccess = () => { const db = r.result; ${code} }; })`);
const fixture: any = await waitFor(
  () => idb(`try { const tx = db.transaction('books'); const g = tx.objectStore('books').get('BK-2084-CYBER'); g.onsuccess = () => ok(g.result?.data ?? null); g.onerror = () => ok(null); } catch (e) { ok(null); }`).catch(() => null),
  (x) => !!x,
  40000,
);
if (!fixture) {
  console.error('Стартової книги в браузері немає', await page.evaluate(`(async () => JSON.stringify({ dbs: await indexedDB.databases?.(), ls: Object.keys(localStorage), url: location.href, text: document.body.innerText.slice(0, 300) }))()`));
  process.exit(1);
}
const prev = new Map<string, { ids: string[]; hashes: string[] }>();
const secTpl = fixture.chapters[0].sections[0];
const sec = (chapterId: string, id: string, title: string, order: number, content: string) => {
  const old = prev.get(id);
  const r = reconcileParagraphIds({ sectionId: id, content, prevIds: old?.ids, prevHashes: old?.hashes });
  prev.set(id, { ids: r.ids, hashes: r.hashes });
  return { ...secTpl, id, chapterId, title, order, content, wordCount: content.split(/\s+/).length, paragraphIds: r.ids, paragraphHashes: r.hashes, scene: undefined, lastModified: new Date().toISOString() };
};
const olenaCard = fixture.characters.find((c: any) => c.name === 'Олена');
const markoCard = { ...fixture.characters[1], id: 'char-marko', name: 'Марко', surname: '', alias: '' };
const book = {
  ...fixture,
  id: BOOK,
  title: 'Архів',
  characters: [olenaCard, markoCard],
  chapters: [
    { ...fixture.chapters[0], id: 'ch1', bookId: BOOK, title: 'Ніч', order: 1, sections: [
      sec('ch1', 's1', 'Сварка', 1, `[/character:${HERO}] [/character:Марко] [/conflict:Сварка в лабораторії] Марко звинуватив Олену в крадіжці архіву.`),
      sec('ch1', 's2', 'Кабінет', 2, `[/character:${HERO}] Олена сиділа сама в кабінеті.`),
    ] },
    { ...fixture.chapters[1], id: 'ch2', bookId: BOOK, title: 'Ранок', order: 2, sections: [sec('ch2', 's3', 'Правда', 1, `[/character:${HERO}] [/revelation:Марко зрадник @${HERO}] Олена дізналась, що Марко — зрадник.`)] },
  ],
};
const saved = await api('PUT', `/api/books/${BOOK}`, { book });
t('книгу збережено на сервері', saved.status === 200, saved.text.slice(0, 200));
await idb(`const tx = db.transaction(['books', 'meta'], 'readwrite'); tx.objectStore('books').put({ id: ${JSON.stringify(BOOK)}, data: ${JSON.stringify(book)}, updatedAt: new Date().toISOString() }); tx.objectStore('meta').put({ key: 'active_book_id', value: ${JSON.stringify(BOOK)} }); tx.oncomplete = () => ok(true); tx.onerror = () => bad(tx.error);`);
const [olena] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = $2 AND type = 'character'`, [BOOK, HERO]), (r) => r.length === 1, 60000);
await waitFor(() => q(`SELECT 1 FROM fusion_core.paragraphs WHERE project_id = $1 AND text LIKE '%зрадник%'`, [BOOK]), (r) => r.length === 1, 60000);
t('героїня є в ядрі (синхронізація)', !!olena);
if (!olena) { console.error(log.join('').slice(-3000)); process.exit(1); }
// Фонові задачі ядра мусять відпрацювати до кінця: без цього перевірка читає
// недописаний стан (розбір — запис #301).
const pendingJobs = await waitFor(
  () => q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND status IN ('queued', 'running')`, [BOOK]),
  (r) => Number(r[0]?.n) === 0,
  90000,
);
t('фонові задачі ядра відпрацювали до кінця', Number(pendingJobs[0]?.n) === 0, `у черзі ${pendingJobs[0]?.n}`);

const openProfile = async () => {
  await page.goto(`${BASE}/projects/${BOOK}/characters/${olena.id}`, { waitUntil: 'domcontentloaded' });
  const ok = await page.waitForSelector('[data-interview-panel]', { timeout: 40000 }).catch(() => null);
  if (!ok) {
    await page.screenshot({ path: path.join(DIR, 'fail.png') });
    console.error(await page.evaluate(() => document.body.innerText.slice(0, 1500)));
    throw new Error('немає розділу «Допит»');
  }
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
  await sleep(800);
};
const msg = () => page.$eval('[data-interview-message]', (e) => e.textContent || '').catch(() => '');
const click = async (sel: string) => {
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.$eval(sel, (e) => (e as HTMLElement).scrollIntoView({ block: 'center' }));
  await page.click(sel);
};

const P = `/api/projects/${BOOK}`;
const H = `${P}/characters/${olena.id}`;
const [marko] = await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Марко' AND type = 'character'`, [BOOK]);

console.log('\nПідготовка: таємниця Марка, переконання Олени, «AI-персонаж», допит станом на сцену «Кабінет»:');
const priv = await api('POST', `${P}/characters/${marko.id}/memories`, { memoryType: 'recollection', content: 'Я сам вкрав архів уночі, поки Олена спала.', sceneId: 's1', visibility: 'hidden' });
t('у Марка — приватний спогад «вкрав архів» (лише власник)', priv.status === 201 && priv.body.memory?.visibility === 'hidden', priv.text.slice(0, 160));
const own = await api('POST', `${H}/memories`, { memoryType: 'belief', content: 'Марко мені заздрить.', sceneId: 's1' });
t('в Олени — своє переконання «Марко заздрить»', own.status === 201);
const ag = await api('POST', `${H}/agent`, { autonomyLevel: 'interview', config: { note: 'говорить стримано' } });
t('«AI-персонаж» — рівень «Допит»', ag.status === 200 && ag.body.agent.autonomyLevel === 'interview');
const st = await api('POST', `${H}/interview`, { sceneId: 's2', title: 'Шість критеріїв' });
const sim = st.body.simulation;
t('допит почато станом на сцену «Кабінет»', st.status === 201 && sim?.sceneId === 's2' && sim?.status === 'active', st.text.slice(0, 160));
const S = `${P}/simulations/${sim.id}`;

const canon = async () => JSON.stringify({
  e: await q(`SELECT id, name, status, version FROM fusion_core.entities WHERE project_id = $1 ORDER BY id`, [BOOK]),
  r: await q(`SELECT id, status FROM fusion_core.entity_relations WHERE project_id = $1 ORDER BY id`, [BOOK]),
  f: await q(`SELECT id, status FROM fusion_core.analysis_findings WHERE project_id = $1 ORDER BY id`, [BOOK]),
  p: await q(`SELECT id, text_hash FROM fusion_core.paragraphs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY id`, [BOOK]),
  m: await q(`SELECT id, status, content FROM fusion_core.character_memories WHERE project_id = $1 AND simulation_id IS NULL ORDER BY id`, [BOOK]),
});

console.log('\nКРИТЕРІЙ (3): десять відповідей поспіль:');
const before = await canon();
const turns: any[] = [];
for (let i = 1; i <= 10; i++) turns.push(await api('POST', `${S}/turn`, { question: `Питання ${i}: що ти робила тієї ночі?` }));
t('10 питань — 10 відповідей, ходи 1…10', turns.every((r, i) => r.status === 200 && r.body.status === 'answered' && r.body.turn === i + 1), turns.map((r) => `${r.status}:${r.body.status}`).join(','));
const vc = voiceCalls();
t('у 10-му запиті голосу — 9 попередніх питань і 9 відповідей героїні (контекст не губиться)', vc.length === 10 && vc[9].history === 9 && vc[9].answers === 9, JSON.stringify(vc[9]));
const answers = (await api('GET', S)).body.events.filter((e: any) => e.eventType === 'answer');
t('кожна відповідь — з рішенням Jev на хід (джерело, дія)', answers.length === 10 && answers.every((e: any) => e.sourceDecisionId && e.publicPayload.source === 'jev' && e.publicPayload.action));
t('канон, рукопис і пам\'ять канону — без змін після 10 відповідей', before === (await canon()));

console.log('\nКРИТЕРІЙ (2): без майбутнього й чужих таємниць:');
t('жоден із 10 запитів голосу не містить глави 2 («зрадник») і приватного спогаду Марка', vc.every((c) => !c.future && !c.secret), JSON.stringify(vc.map((c) => [c.future, c.secret])));
const jevStates = fs.existsSync(JEV_LOG) ? fs.readFileSync(JEV_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
t('…і в жодному стані, що пішов у Jev (усі три рівні), — теж (Т2.8 В1: межа — глава сцени)', jevStates.length >= 10 && jevStates.every((x: any) => !x.future && !x.secret), `станів: ${jevStates.length}, з майбутнім: ${jevStates.filter((x: any) => x.future).length}`);
const leak = await q(`SELECT count(*)::int AS n FROM fusion_core.simulation_events WHERE simulation_id = $1 AND (public_payload::text LIKE '%вкрав архів%' OR public_payload::text LIKE '%зрадник%')`, [sim.id]);
t('у ходах допиту — теж ні', leak[0].n === 0);

console.log('\nКРИТЕРІЙ (6): збої Jev і голосу:');
setMode('529');
const f529 = await api('POST', `${S}/turn`, { question: 'Хто винен у крадіжці?' });
t('Jev 529 → запасний LLM, відповідь є, причина збережена', f529.body.status === 'answered' && f529.body.event.publicPayload.source === 'llm_fallback' && /529/.test(f529.body.event.publicPayload.fallbackReason ?? ''), JSON.stringify(f529.body.event?.publicPayload?.fallbackReason));
setMode('network');
const fnet = await api('POST', `${S}/turn`, { question: 'А де був Марко?' });
t('мережа до Jev впала → запасний LLM, відповідь є', fnet.body.status === 'answered' && fnet.body.event.publicPayload.source === 'llm_fallback', JSON.stringify(fnet.body.event?.publicPayload?.fallbackReason));
setMode('ok');
setVoice('down');
const turnBefore = (await api('GET', S)).body.simulation.currentTurn;
const fv = await api('POST', `${S}/turn`, { question: 'Чому ти мовчала вранці?' });
const failedEv = fv.body.event;
t('голос недоступний → «не вдалося», питання збережене (хід +1), без секретів у помилці', fv.body.status === 'failed' && fv.body.turn === turnBefore + 1 && failedEv.publicPayload.stage === 'voice' && !/вкрав|зрадник/.test(JSON.stringify(failedEv.publicPayload)), JSON.stringify(failedEv?.publicPayload).slice(0, 200));
t('нове питання, поки це без відповіді, — 409 (стан не губиться)', (await api('POST', `${S}/turn`, { question: 'Ще одне?' })).status === 409);

console.log('\nСторінка героїні: 13 ходів і «Повторити»:');
await openProfile();
await click(`[data-interview-open="${sim.id}"]`);
await page.waitForSelector(`[data-interview-turn="${turnBefore + 1}"] [data-interview-failed]`, { timeout: 20000 }).catch(() => null);
const shown = await page.$$eval('[data-interview-turn]', (els) => els.length);
t(`на сторінці — усі ${turnBefore + 1} ходів, останній «не вдалося» з «Повторити»`, shown === turnBefore + 1 && !!(await page.$(`[data-interview-turn="${turnBefore + 1}"] [data-interview-retry]`)), `ходів ${shown}`);
setVoice('ok');
await click(`[data-interview-turn="${turnBefore + 1}"] [data-interview-retry]`);
await page.waitForSelector(`[data-interview-turn="${turnBefore + 1}"] [data-interview-answer]`, { timeout: 30000 }).catch(() => null);
const retried = await page.$eval(`[data-interview-turn="${turnBefore + 1}"] [data-interview-answer]`, (e) => (e as HTMLElement).innerText).catch(() => '');
const evs = (await api('GET', S)).body.events;
t('«Повторити» → відповідь на те саме питання в тому самому ході; питання не продубльовано', /Чому ти мовчала вранці\?/.test(evs.filter((e: any) => e.turnIndex === turnBefore + 1 && e.eventType === 'question').map((e: any) => e.publicPayload.text).join()) && evs.filter((e: any) => e.eventType === 'question').length === turnBefore + 1 && /нікого не чекала/.test(retried), retried.slice(0, 120));
t('канон досі без змін (13 ходів, збої, повтор)', before === (await canon()));

console.log('\nКРИТЕРІЇ (1) і (4): вибіркове прийняття:');
const props = await q(`SELECT id, kind, proposed_change FROM fusion_core.canon_proposals WHERE simulation_id = $1 AND status = 'pending' ORDER BY created_at`, [sim.id]);
const mems = props.filter((p) => p.kind === 'memory');
const facts = props.filter((p) => p.kind === 'fact');
const accM = await api('POST', `${P}/proposals/${mems[0].id}/accept`, {});
const rejM = await api('POST', `${P}/proposals/${mems[1].id}/reject`, { reason: 'не так' });
const accF = await api('POST', `${P}/proposals/${facts[0].id}/accept`, {});
const rejF = await api('POST', `${P}/proposals/${facts[1].id}/reject`, {});
t('КРИТЕРІЙ (4): один спогад і один факт прийнято, інші — відхилено', accM.status === 200 && rejM.status === 200 && accF.status === 200 && rejF.status === 200 && !!accM.body.memory && !!accF.body.fact);
const memIds = (await q(`SELECT content FROM fusion_core.character_memories WHERE project_id = $1 AND character_id = $2 AND simulation_id IS NULL AND status = 'confirmed'`, [BOOK, olena.id])).map((r) => r.content);
t('…у пам\'яті героїні — лише прийнятий', memIds.includes(mems[0].proposed_change.content) && !memIds.includes(mems[1].proposed_change.content));
const prof = (await api('GET', `${H}/profile`)).body;
const allFacts = [...prof.facts.confirmed, ...prof.facts.suggested, ...prof.facts.contradicted, ...prof.facts.unknown];
t('КРИТЕРІЙ (1): кожен факт профілю — з джерелом або позначкою гіпотези; факт допиту — «гіпотеза»', allFacts.length >= 1 && allFacts.every((f: any) => f.sources.length > 0 || f.hypothesis) && allFacts.some((f: any) => f.hypothesis && f.origin === 'interview'), JSON.stringify(allFacts.map((f: any) => [f.statement.slice(0, 30), f.sources.length, f.hypothesis])));

console.log('\nКРИТЕРІЙ (5): правка затвердженої сцени:');
const got = await api('GET', `/api/books/${BOOK}`);
const b2 = got.body.book;
const s2 = b2.chapters[0].sections.find((x: any) => x.id === 's2');
const edited = s2.content.replace('сиділа сама в кабінеті', 'сиділа сама в темному кабінеті');
const r2 = reconcileParagraphIds({ sectionId: 's2', content: edited, prevIds: s2.paragraphIds, prevHashes: s2.paragraphHashes });
Object.assign(s2, { content: edited, paragraphIds: r2.ids, paragraphHashes: r2.hashes });
const put2 = await api('PUT', `/api/books/${BOOK}`, { book: b2, expectedRevision: got.body.revision });
t('автор змінив сцену «Кабінет»', put2.status === 200, put2.text.slice(0, 120));
const stale = await waitFor(() => q(`SELECT status FROM fusion_core.scene_simulations WHERE id = $1`, [sim.id]), (r) => r[0]?.status === 'stale', 60000);
const memAfter = await waitFor(() => q(`SELECT status FROM fusion_core.character_memories WHERE id = $1`, [accM.body.memory.id]), (r) => r[0]?.status === 'needs_review', 30000);
const factAfter = await q(`SELECT needs_review FROM fusion_core.analysis_findings WHERE id = $1`, [accF.body.fact.id]);
t('допит «застарів», прийнятий спогад — «перевірити», факт — «на перегляд»', stale[0]?.status === 'stale' && memAfter[0]?.status === 'needs_review' && factAfter[0]?.needs_review === true, JSON.stringify({ stale, memAfter, factAfter }));
t('нових ходів у застарілому допиті немає (409)', (await api('POST', `${S}/turn`, { question: 'Ще?' })).status === 409);

console.log('\nТелефон:');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await openProfile();
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await click(`[data-interview-open="${sim.id}"]`);
await page.waitForSelector('[data-interview-stale]', { timeout: 15000 }).catch(() => null);
const mob = await page.evaluate(() => {
  const el = document.querySelector('[data-interview-panel]') as HTMLElement;
  return { scroll: el.scrollWidth, client: el.clientWidth, doc: document.documentElement.scrollWidth, stale: !!document.querySelector('[data-interview-stale]') };
});
t('на 390 px: попередження «застаріла», без горизонтальної прокрутки', mob.stale && mob.scroll <= mob.client + 1 && mob.doc <= 391, JSON.stringify(mob));
await (await page.$('[data-interview-panel]'))?.screenshot({ path: path.join(DIR, 'criteria-mobile.png') });
t('без помилок сторінки', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
