/**
 * Живий прогін розділу «Допит» на сторінці героя — Т2.7 В5 (`PLAN_INTERVIEW.md`).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:interview
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер. Книгу зберігає автор через
 * `PUT /api/books/:id` (синхронізація — справжня фонова задача). Jev —
 * справжній `HttpJevAdapter`, модель голосу — справжній модуль «Ядра AI»
 * `coreCharacterVoice`; мережі до TypeSafe і Gemini в хмарі немає, тож
 * перехоплювач `fetch` у процесі сервера відповідає замість них.
 * На сторінці героїні: увімкнути «AI-персонаж» → нова розмова станом на
 * сцену → питання → відповідь із рішенням Jev і пропозиціями → прийняти
 * спогад (у «Пам'яті» — «з допиту»), факт («гіпотеза з допиту» у профілі),
 * відхилити, фрагмент із тегом — у розділ «AI-чернеткою» (книга на сервері),
 * другий тег — окремо; низька впевненість Jev → «чекає» → вибір автора →
 * відповідь; правка сцени → «застарів»; телефон 390 px.
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
const DIR = path.join(os.tmpdir(), 'nova-interview');
const PORT = Number(process.env.INTERVIEW_PORT || 34297);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-LIVE-INTERVIEW';
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
const FAKE = path.join(DIR, 'fake-interview.mjs');
fs.writeFileSync(MODE, 'ok');
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
      n++;
      const q = (/Питання автора: (.*)$/m.exec(text) ?? [])[1] ?? '';
      fs.appendFileSync(${JSON.stringify(VOICE_LOG)}, JSON.stringify({ q, future: /зрадник/.test(text), history: (text.match(/^Автор: /gm) ?? []).length, action: (/дія: ([a-z_]+)/.exec(text) ?? [])[1] ?? null }) + '\\n');
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
const setMode = (m: 'ok' | 'low') => fs.writeFileSync(MODE, m);
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

console.log('\n«AI-персонаж» на сторінці героїні:');
await openProfile();
t('розділ «Допит» є; героїня вимкнена — підказка', !!(await page.$('[data-interview-agent][data-interview-level="off"]')) && !!(await page.$('[data-interview-off]')));
await click('[data-interview-set-level="interview"]');
await page.waitForSelector('[data-interview-agent][data-interview-level="interview"]', { timeout: 10000 }).catch(() => null);
const [agentRow] = await q(`SELECT enabled, autonomy_level FROM fusion_core.character_agents WHERE project_id = $1 AND character_id = $2`, [BOOK, olena.id]);
t('рівень «Допит» — у базі увімкнено', agentRow?.enabled === true && agentRow?.autonomy_level === 'interview', JSON.stringify(agentRow));
await page.type('[data-interview-note]', 'говорить стримано, коротко');
await click('[data-interview-note-save]');
await waitFor(() => q(`SELECT agent_config FROM fusion_core.character_agents WHERE character_id = $1`, [olena.id]), (r) => r[0]?.agent_config?.note === 'говорить стримано, коротко', 10000);
t('нотатка голосу збережена', true);

console.log('\nРозмова станом на сцену «Кабінет»:');
await page.select('[data-interview-boundary]', 'scene:s2');
await page.type('[data-interview-title]', 'Про архів');
await click('[data-interview-start]');
await page.waitForSelector('[data-interview-open-sim]', { timeout: 15000 });
const [sim] = await q(`SELECT id, scene_id, as_of_chapter, status, config FROM fusion_core.scene_simulations WHERE project_id = $1`, [BOOK]);
t('допит у базі: сцена s2, глава 1, активний, відбиток межі', sim?.scene_id === 's2' && sim?.as_of_chapter === 1 && sim?.status === 'active' && !!sim?.config?.boundaryHash, JSON.stringify(sim));
await page.type('[data-interview-question-input]', 'Де ти була тієї ночі?');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-interview-turn="1"] [data-interview-answer]', { timeout: 30000 }).catch(() => null);
const a1 = await page.evaluate(() => {
  const el = document.querySelector('[data-interview-turn="1"]') as HTMLElement | null;
  return el ? { text: el.innerText, source: el.querySelector('[data-interview-source]')?.getAttribute('data-interview-source'), props: Array.from(el.querySelectorAll('[data-interview-proposals] > [data-proposal]')).map((p) => p.getAttribute('data-proposal-kind')), tags: el.querySelectorAll('[data-proposal-tag-pick]').length } : null;
});
t('відповідь героїні від першої особи з рішенням Jev (дія «ухилитися», джерело Jev)', !!a1 && /нікого не чекала/.test(a1.text) && /дія: ухилитися/.test(a1.text) && a1.source === 'jev', JSON.stringify(a1?.text.slice(0, 200)));
t('під відповіддю — пропозиції: 2 спогади, факт, фрагмент із 2 тегами (П7)', a1?.props.join() === 'memory,memory,fact,fragment' && a1?.tags === 2, JSON.stringify(a1?.props));
const vc = voiceCalls();
t('у запиті голосу немає майбутнього (глава 2 — «зрадник»)', vc.length === 1 && vc[0].future === false && vc[0].action === 'deflect', JSON.stringify(vc));

const props = await q(`SELECT id, kind, proposed_change, parent_id FROM fusion_core.canon_proposals WHERE simulation_id = $1 ORDER BY created_at`, [sim.id]);
const mem1 = props.find((p) => p.kind === 'memory' && /не вірить/.test(p.proposed_change.content));
const mem2 = props.find((p) => p.kind === 'memory' && /підозрюють/.test(p.proposed_change.content));
const fact = props.find((p) => p.kind === 'fact');
const frag = props.find((p) => p.kind === 'fragment');
const [tagA, tagB] = props.filter((p) => p.kind === 'tag');

console.log('\nПропозиції — вибірково:');
await click(`[data-proposal="${mem1.id}"] [data-proposal-edit-open]`);
await page.$eval(`[data-proposal="${mem1.id}"] [data-proposal-edit]`, (e) => { (e as HTMLTextAreaElement).select(); });
await page.type(`[data-proposal="${mem1.id}"] [data-proposal-edit]`, 'Олена відчула: автор їй не вірить.');
await click(`[data-proposal="${mem1.id}"] [data-proposal-accept]`);
const m1 = await waitFor(() => q(`SELECT status, result FROM fusion_core.canon_proposals WHERE id = $1`, [mem1.id]), (r) => r[0]?.status === 'accepted', 10000);
const [memRow] = await q(`SELECT content, status, origin, source_event_kind, scene_id FROM fusion_core.character_memories WHERE id = $1`, [m1[0]?.result?.memoryId]);
t('спогад прийнято з правкою → пам\'ять героїні: підтверджений, від автора, з ходу допиту, сцена s2',
  memRow?.content === 'Олена відчула: автор їй не вірить.' && memRow?.status === 'confirmed' && memRow?.origin === 'author' && memRow?.source_event_kind === 'simulation_event' && memRow?.scene_id === 's2', JSON.stringify(memRow));
await page.waitForSelector(`[data-memory="${m1[0]?.result?.memoryId}"] [data-memory-from-interview]`, { timeout: 10000 }).catch(() => null);
t('у розділі «Пам\'ять» — одразу, з позначкою «з допиту»', !!(await page.$(`[data-memory="${m1[0]?.result?.memoryId}"] [data-memory-from-interview]`)));
await click(`[data-proposal="${mem2.id}"] [data-proposal-reject]`);
await waitFor(() => q(`SELECT status FROM fusion_core.canon_proposals WHERE id = $1`, [mem2.id]), (r) => r[0]?.status === 'rejected', 10000);
t('КРИТЕРІЙ (4): другий спогад тієї ж відповіді — відхилено, у пам\'ять не потрапив',
  (await q(`SELECT 1 FROM fusion_core.character_memories WHERE content LIKE '%підозрюють%'`)).length === 0);
await click(`[data-proposal="${fact.id}"] [data-proposal-accept]`);
const f1 = await waitFor(() => q(`SELECT status, result FROM fusion_core.canon_proposals WHERE id = $1`, [fact.id]), (r) => r[0]?.status === 'accepted', 10000);
await page.waitForSelector(`[data-profile-fact="${f1[0]?.result?.findingId}"] [data-profile-fact-hypothesis]`, { timeout: 15000 }).catch(() => null);
const factCard = await page.evaluate((id: string) => {
  const el = document.querySelector(`[data-profile-fact="${id}"]`) as HTMLElement | null;
  return el ? { text: el.innerText, group: el.closest('[data-profile-section]')?.getAttribute('data-profile-section') } : null;
}, f1[0]?.result?.findingId);
t('КРИТЕРІЙ (1): факт — у профілі «Пропозиції ШІ» з позначкою «гіпотеза з допиту» і джерелом-сценою', !!factCard && /гіпотеза з допиту/.test(factCard.text) && /боїться/.test(factCard.text) && factCard.group === 'suggested' && /Кабінет|сама в кабінеті/.test(factCard.text), JSON.stringify(factCard));

console.log('\nФрагмент у книгу — «AI-чернеткою» з тегом (П7):');
t('тег до неприйнятого фрагмента — без кнопки (лише галочка)', !(await page.$(`[data-proposal="${tagA.id}"] [data-proposal-accept]`)));
await click(`[data-proposal-tag-pick="${tagA.id}"]`);
const selSection = await page.$eval(`[data-proposal="${frag.id}"] [data-proposal-section]`, (e) => (e as HTMLSelectElement).value);
t('розділ для вставки — типово сцена допиту', selSection === 's2', selSection);
await click(`[data-proposal="${frag.id}"] [data-proposal-accept]`);
const insertMsg = await waitFor(msg, (s) => /AI-чернеткою/.test(s), 10000);
t('повідомлення: вставлено AI-чернеткою в «Кабінет»', /Кабінет/.test(insertMsg), insertMsg);
const bookHas = async (re: RegExp) => {
  const b = await api('GET', `/api/books/${BOOK}`);
  const s = b.body.book?.chapters?.[0]?.sections?.find((x: any) => x.id === 's2');
  return re.test(s?.content ?? '') ? s.content : null;
};
// Книга автора — у браузері (IndexedDB); на сервер вона дзеркалиться із запізненням (перше збереження вкладки лише дізнається ревізію).
const clientHas = async (re: RegExp) => {
  const b: any = await idb(`const tx = db.transaction('books'); const g = tx.objectStore('books').get(${JSON.stringify(BOOK)}); g.onsuccess = () => ok(g.result?.data ?? null);`);
  const s = b?.chapters?.[0]?.sections?.find((x: any) => x.id === 's2');
  return re.test(s?.content ?? '') ? s.content : null;
};
const draft = await waitFor(() => clientHas(/\[AI-DRAFT\][\s\S]*тихо сказала Олена[\s\S]*тривога @Олена Ковальчук\][\s\S]*\[\/AI-DRAFT\]/), (x) => !!x, 30000);
t('книга автора: у розділі «Кабінет» — AI-чернетка з чистим текстом і прийнятим тегом', !!draft && !/\[\/character:[^\]]*\] — Я нікого/.test(draft) && !/втома/.test(draft), JSON.stringify(draft));
await page.waitForSelector(`[data-proposal="${tagB.id}"] [data-proposal-accept]`, { timeout: 10000 }).catch(() => null);
await click(`[data-proposal="${tagB.id}"] [data-proposal-accept]`);
const withB = await waitFor(() => bookHas(/тривога @Олена Ковальчук\] \[\/emotion:втома @Олена Ковальчук\]\s*\n\n\[\/AI-DRAFT\]/), (x) => !!x, 30000);
t('другий тег прийнято окремо — дописано до фрагмента в чернетці (і книга на сервері)', !!withB, JSON.stringify(withB?.slice(-160)));
const [tagRows] = await q(`SELECT count(*)::int AS n FROM fusion_core.canon_proposals WHERE parent_id = $1 AND status = 'accepted'`, [frag.id]);
t('у базі: фрагмент і обидва теги — прийнято', tagRows.n === 2);
const synced = await waitFor(() => q(`SELECT 1 FROM fusion_core.paragraphs WHERE project_id = $1 AND text LIKE '%тихо сказала Олена%' AND deleted_at IS NULL`, [BOOK]), (r) => r.length >= 1, 40000);
t('синхронізація ядра побачила фрагмент у книзі', synced.length >= 1);
const [simNow] = await q(`SELECT status FROM fusion_core.scene_simulations WHERE id = $1`, [sim.id]);
const kinds = await q(`SELECT kind FROM fusion_core.paragraphs WHERE project_id = $1 AND text LIKE '%тихо сказала Олена%' AND deleted_at IS NULL`, [BOOK]);
t('фрагмент у ядрі — AI-чернетка (draft); допит через свою ж вставку не застарів', kinds.every((k) => k.kind === 'draft') && simNow?.status === 'active', JSON.stringify({ kinds, simNow }));
await (await page.$('[data-interview-panel]'))?.screenshot({ path: path.join(DIR, 'interview-panel.png') });

console.log('\nНизька впевненість Jev → «чекає» → вибір автора:');
await openProfile();
await click(`[data-interview-open="${sim.id}"]`);
await page.waitForSelector('[data-interview-question-input]', { timeout: 15000 });
setMode('low');
await page.type('[data-interview-question-input]', 'Чому ти мовчиш про Марка?');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-interview-turn="2"] [data-interview-awaiting] [data-interview-option]', { timeout: 30000 }).catch(() => null);
const aw = await page.evaluate(() => {
  const el = document.querySelector('[data-interview-turn="2"] [data-interview-awaiting]') as HTMLElement | null;
  return el ? { text: el.innerText, options: Array.from(el.querySelectorAll('[data-interview-option]')).map((b) => b.textContent) } : null;
});
t('хід 2 — «чекає на вас» з причиною й варіантами українською; питання заблоковано', !!aw && aw.options.length >= 2 && /чекає на вас/.test(aw.text) && /Jev не певний/.test(aw.text) && (await page.$eval('[data-interview-question-input]', (e) => (e as HTMLInputElement).disabled)), JSON.stringify(aw));
// Jev і далі не певний: автор вирішує за героїню рівень за рівнем (стратегічний → сценічний → хід).
let steps = 0;
for (; steps < 4; steps++) {
  if (await page.$('[data-interview-turn="2"] [data-interview-answer]')) break;
  const opt = await page.$('[data-interview-turn="2"] [data-interview-awaiting] [data-interview-option]');
  if (!opt) break;
  await opt.click();
  await page.waitForFunction(() => !!document.querySelector('[data-interview-turn="2"] [data-interview-answer]') || !!document.querySelector('[data-interview-turn="2"] [data-interview-awaiting] [data-interview-option]'), { timeout: 20000 }).catch(() => null);
  await sleep(700);
}
const a2 = await page.$eval('[data-interview-turn="2"] [data-interview-answer]', (e) => (e as HTMLElement).innerText).catch(() => '');
const src2 = await page.$eval('[data-interview-turn="2"] [data-interview-source]', (e) => e.getAttribute('data-interview-source')).catch(() => '');
t('автор вирішив за героїню → відповідь із рішенням автора', /хід 2/.test(a2) && src2 === 'author', `кроків ${steps}: ${a2.slice(0, 120)} ${src2}`);
setMode('ok');
t('у запиті голосу 2 — історія з попереднім ходом', voiceCalls().at(-1)?.history === 1, JSON.stringify(voiceCalls().at(-1)));

console.log('\nПравка сцени → допит «застарів»:');
const got = await api('GET', `/api/books/${BOOK}`);
const b2 = got.body.book;
const s2 = b2.chapters[0].sections.find((x: any) => x.id === 's2');
const edited = `${s2.content}\n\nЗа вікном почався дощ.`;
const r2 = reconcileParagraphIds({ sectionId: 's2', content: edited, prevIds: s2.paragraphIds, prevHashes: s2.paragraphHashes });
Object.assign(s2, { content: edited, paragraphIds: r2.ids, paragraphHashes: r2.hashes });
const put2 = await api('PUT', `/api/books/${BOOK}`, { book: b2, expectedRevision: got.body.revision });
t('автор змінив сцену (збережено)', put2.status === 200, put2.text.slice(0, 160));
const stale = await waitFor(() => q(`SELECT status FROM fusion_core.scene_simulations WHERE id = $1`, [sim.id]), (r) => r[0]?.status === 'stale', 40000);
// Сповіщення з'являється тим самим викликом синхронізації, але читати його
// одразу після зміни статусу не можна: у батчі з 19 прогонів запис ще не
// долетів до бази й перевірка падала (29.09.2026). Чекаємо самий рядок.
const staleNote = await waitFor(
  () => q(`SELECT 1 FROM fusion_core.core_notifications WHERE project_id = $1 AND kind = 'interviews_stale'`, [BOOK]),
  (r) => r.length === 1,
);
t('КРИТЕРІЙ (5): допит — «застарів» (синхронізація), сповіщення', stale[0]?.status === 'stale' && staleNote.length === 1,
  `статус «${stale[0]?.status ?? '—'}», сповіщень ${staleNote.length}`);
const memAfter = await waitFor(() => q(`SELECT status FROM fusion_core.character_memories WHERE id = $1`, [m1[0]?.result?.memoryId]), (r) => r[0]?.status === 'needs_review', 20000);
t('…прийнятий спогад із допиту — «перевірити»', memAfter[0]?.status === 'needs_review');
await openProfile();
await click(`[data-interview-open="${sim.id}"]`);
await page.waitForSelector('[data-interview-stale]', { timeout: 15000 }).catch(() => null);
const pendingMem = (await q(`SELECT id FROM fusion_core.canon_proposals WHERE simulation_id = $1 AND kind = 'memory' AND status = 'pending' ORDER BY created_at LIMIT 1`, [sim.id]))[0];
const disabledBefore = pendingMem ? await page.$eval(`[data-proposal="${pendingMem.id}"] [data-proposal-accept]`, (e) => (e as HTMLButtonElement).disabled).catch(() => null) : null;
t('на сторінці: попередження «застаріла», питань немає, «Прийняти» — вимкнено', !!(await page.$('[data-interview-stale]')) && !(await page.$('[data-interview-question-input]')) && disabledBefore === true, String(disabledBefore));
await click('[data-interview-stale-ok]');
await click(`[data-proposal="${pendingMem.id}"] [data-proposal-accept]`);
const acc = await waitFor(() => q(`SELECT status, result FROM fusion_core.canon_proposals WHERE id = $1`, [pendingMem.id]), (r) => r[0]?.status === 'accepted', 10000);
t('«усе одно дозволити» → прийнято з позначкою «із застарілого»', acc[0]?.result?.stale === true);

console.log('\nТелефон:');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await openProfile();
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
await click(`[data-interview-open="${sim.id}"]`);
await page.waitForSelector('[data-interview-turns]', { timeout: 15000 }).catch(() => null);
await sleep(600);
const mob = await page.evaluate(() => {
  const el = document.querySelector('[data-interview-panel]') as HTMLElement;
  const box = el.getBoundingClientRect();
  const wide = Array.from(el.querySelectorAll('*')).filter((x) => x.getBoundingClientRect().right > box.right + 1).slice(0, 3).map((x) => `${x.tagName}.${String((x as HTMLElement).className).slice(0, 40)}`);
  return { scroll: el.scrollWidth, client: el.clientWidth, wide, doc: document.documentElement.scrollWidth };
});
t('на 390 px — розділ «Допит» без горизонтальної прокрутки', mob.scroll <= mob.client + 1 && mob.client >= 220 && mob.doc <= 391, JSON.stringify(mob));
await (await page.$('[data-interview-panel]'))?.screenshot({ path: path.join(DIR, 'interview-mobile.png') });
console.log(`  (знімки: ${DIR}/interview-panel.png, interview-mobile.png)`);
t('без помилок сторінки', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
