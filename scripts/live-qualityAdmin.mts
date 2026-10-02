/**
 * Живий прогін розділу «Якість персонажів» (Т2.8 В5, `PLAN_QUALITY.md`).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:quality-admin
 * (потрібен зібраний dist/server.mjs і `.env` з VITE_FIREBASE_*; схема
 * `fusion_core` у цій базі видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер; Jev — справжній `HttpJevAdapter`
 * (і як рушій рішень, і як суддя), голос — модуль «Ядра AI»
 * `coreCharacterVoice`, запасний LLM — модуль AI-2. TypeSafe і Gemini
 * підставні (перехоплювач `fetch` у процесі сервера): голос відповідає лише
 * рядками СВОГО знімка, що перегукуються з питанням; Jev обирає дію за
 * змістом питання, а суддею ставить «у характері», якщо відповідь спирається
 * на пам'ять героя. Отже, числа тут — не якість моделей, а чесність шляху:
 * що в справжньому сервері до голосу й до Jev не доходить ні чуже приватне,
 * ні майбутнє, і що розділ адмінки показує прогін, ворота й звіт.
 *
 *   (1) доступ: лише адміністратор (автор — 403);
 *   (2) розділ відкривається з карти адмінки, набір — 16 кейсів;
 *   (3) прогін із кнопки: «іде» → «завершено», виміри з Jev / без Jev поруч,
 *       ворота, ходи; другий запуск, поки йде перший, — 409;
 *   (4) жорсткі ворота (витоки чужого й майбутнього) — 0 в обох режимах, і в
 *       запитах до голосу та в станах Jev, які бачив перехоплювач, — теж 0;
 *   (5) у журналі `quality_runs` — звіт без промптів і станів Jev; звіт .md;
 *   (6) ліміт витрат: дорогий голос і ліміт $0.01 — прогін зупиняється,
 *       «збій» з причиною на сторінці, витрачено не більше ніж на один виклик;
 *   (7) телефон 390 px — без горизонтальної прокрутки сторінки.
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
const DIR = path.join(os.tmpdir(), 'nova-quality-admin');
const PORT = Number(process.env.QUALITY_ADMIN_PORT || 34311);
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

// Перехоплювач fetch у процесі сервера. Що бачили голос і Jev — у журнали
// (чи є там чуже приватне чи майбутнє — рахує тест, а не перехоплювач).
const COST_MODE = path.join(DIR, 'cost-mode.txt');
const VOICE_LOG = path.join(DIR, 'voice.jsonl');
const JEV_LOG = path.join(DIR, 'jev.jsonl');
const FAKE = path.join(DIR, 'fake-quality.mjs');
fs.writeFileSync(COST_MODE, 'cheap');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
const bodyOf = async (input, init) => {
  const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
  return typeof raw === 'string' ? raw : await new Response(raw).text();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stems = (s) => (String(s).toLowerCase().match(/[\\p{L}']+/gu) ?? []).filter((w) => w.length >= 4).map((w) => w.slice(0, 4));
const STOP = new Set(['тобі', 'твоє', 'твій', 'чому', 'якщо', 'зараз', 'насп']);
const CLASS = [[/довір|поклас/i, 'deflect'], [/брат|тарас/i, 'answer'], [/вкрав|архів|сейф/i, 'lie'], [/втом|додому/i, 'silence']];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/api\\.typesafe\\.ai/.test(url)) {
    const body = JSON.parse(await bodyOf(input, init));
    const st = body.state ?? {};
    fs.appendFileSync(${JSON.stringify(JEV_LOG)}, JSON.stringify({ hero: st.name ?? st.character ?? null, state: JSON.stringify(st) }) + '\\n');
    const situation = String(st.situation ?? '');
    const answers = {};
    if (body.questions.character_fit) {
      const reply = (/Відповідь героя: «([\\s\\S]*)»$/.exec(situation) ?? [])[1] ?? '';
      const own = [...(st.memories ?? []), ...(st.beliefs ?? [])].map((m) => typeof m === 'string' ? m : (m.content ?? m.statement ?? ''));
      const grounded = own.some((l) => stems(l).some((x) => stems(reply).includes(x) && !STOP.has(x)));
      answers.character_fit = { type: 'score', score: grounded ? 3 : 1, confidence: 0.8 };
      answers.style_fit = { type: 'score', score: /^\\s*—/.test(reply) ? 3 : 1, confidence: 0.8 };
      answers.contradicts_state = { type: 'noul', probability: 0.1, confidence: 0.8 };
    } else {
      const cls = (CLASS.find(([re]) => re.test(situation)) ?? [])[1];
      for (const [id, qq] of Object.entries(body.questions)) {
        if (qq.type === 'choice') {
          const keys = Object.keys(qq.criteria);
          const pick = cls && keys.includes(cls) ? cls : keys[situation.length % keys.length];
          answers[id] = { type: 'choice', choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.7 : 0.3 / Math.max(1, keys.length - 1)])), confidence: 0.9 };
        } else if (qq.type === 'score') answers[id] = { type: 'score', score: 2, confidence: 0.9 };
        else answers[id] = { type: 'noul', probability: 0.2, confidence: 0.9 };
      }
    }
    return json({ model: 'jev-1.13.0', answers, usage: { input_tokens: 400, output_tokens: 0 } });
  }
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /generateContent/.test(url)) {
    const j = JSON.parse(await bodyOf(input, init));
    const text = [...(j.systemInstruction?.parts ?? []), ...(j.contents ?? []).flatMap((c) => c.parts ?? [])].map((p) => p.text ?? '').join('\\n');
    const expensive = fs.readFileSync(${JSON.stringify(COST_MODE)}, 'utf8').trim() === 'expensive';
    const usage = { promptTokenCount: expensive ? 100000 : 300, candidatesTokenCount: 80, totalTokenCount: expensive ? 100080 : 380 };
    let answer;
    if (/Знімок героя станом на цю сцену/.test(text)) {
      await sleep(60);
      const q = (/Питання автора: (.*)$/m.exec(text) ?? [])[1] ?? '';
      const snap = (/Знімок героя станом на цю сцену:\\n([\\s\\S]*?)\\n\\nРішення на цей хід/.exec(text) ?? [])[1] ?? '{}';
      let lines = [];
      try { const s = JSON.parse(snap); lines = [...(s.memories ?? []), ...(s.beliefs ?? []), ...(s.confirmed_facts ?? []), ...(s.recent_text ?? [])].map(String); } catch { lines = []; }
      fs.appendFileSync(${JSON.stringify(VOICE_LOG)}, JSON.stringify({ q, prompt: text }) + '\\n');
      const qs = stems(q).filter((s) => !STOP.has(s));
      const found = lines.filter((l) => stems(l).some((s) => qs.includes(s))).slice(0, 2);
      const reply = (found.length ? '— ' + found.map((f) => f.replace(/^[a-z_]+: /, '')).join(' ') + ' — Більше не скажу.' : '— Не знаю. ' + (q.length > 20 ? 'Спитайте інакше.' : 'Облиште.')) + ' (' + q.slice(0, 30) + ')';
      answer = { reply, intent: 'ухилитися' };
    } else {
      const sit = (/"situation": "([^"]*)"/.exec(text) ?? [])[1] ?? text;
      const answers = {};
      for (const m of text.matchAll(/Питання "([a-z_0-9]+)" \\(вибір\\)[^\\n]*\\nВаріанти: ([^\\n]+)/g)) {
        const opts = m[2].split(',').map((x) => x.trim());
        answers[m[1]] = { choice: opts[sit.length % opts.length] };
      }
      for (const m of text.matchAll(/Питання "([a-z_0-9]+)" \\(оцінка\\)/g)) answers[m[1]] = { score: 2 };
      answer = { answers };
    }
    return json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP', index: 0 }], usageMetadata: usage });
  }
  return real(input, init);
};
`);
const readLog = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const now = new Date().toISOString();
await saveUser({ id: 'u-admin', email: 'admin-quality@test.ua', name: 'Адмін', role: 'admin', createdAt: now } as any);
await saveUser({ id: 'u-author', email: 'author-quality@test.ua', name: 'Автор', role: 'author', createdAt: now } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
const AUTHOR = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });
await createSession({ token: AUTHOR, userId: 'u-author', createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, ['--import', pathToFileURL(FAKE).href, path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ROLE_ONBOARDING: 'off', ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: 'live-fake-key', TYPESAFE_API_KEY: 'live-typesafe-key', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', APP_URL: BASE },
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
t('ядро піднялось, схема v18 (журнал прогонів якості)', Number(v) >= 18, `v${v}`);

const api = async (method: string, p: string, body?: unknown, token = TOKEN) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, type: res.headers.get('content-type') ?? '', body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
};

// ── (1) доступ ────────────────────────────────────────────────────────────────
console.log('\n(1) Доступ:');
t('автор не бачить розділ (403)', (await api('GET', '/api/admin/quality/living-characters', undefined, AUTHOR)).status === 403);
t('автор не запускає прогін (403)', (await api('POST', '/api/admin/quality/runs', { budgetUsd: 1 }, AUTHOR)).status === 403);
t('без сесії — 401/403', [401, 403].includes((await fetch(`${BASE}/api/admin/quality/living-characters`)).status));
const info = await api('GET', '/api/admin/quality/living-characters');
t('адміністратор бачить набір: 16 кейсів, два режими, прогонів ще нема', info.status === 200 && info.body.set?.cases?.length === 16 && info.body.set?.modes?.length === 2 && info.body.runs?.length === 0, `${info.status} ${info.body.set?.cases?.length}`);
t('невірний бюджет — 400', (await api('POST', '/api/admin/quality/runs', { budgetUsd: 500 })).status === 400);
t('невідомий режим — 400', (await api('POST', '/api/admin/quality/runs', { budgetUsd: 1, modes: ['magic'] })).status === 400);

// ── Браузер ───────────────────────────────────────────────────────────────────
const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name: string) => page.screenshot({ path: path.join(DIR, `quality-${name}.png`), fullPage: true });
const text = () => page.evaluate(() => (document.querySelector('[data-quality-view]') as HTMLElement | null)?.innerText ?? '');

try {
  // ── (2) розділ з карти ──────────────────────────────────────────────────────
  console.log('\n(2) Розділ відкривається з карти адмінки:');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-admin', { timeout: 40000 });
  await page.click('#nav-tab-admin');
  await page.waitForSelector('.os-pill', { timeout: 20000 });
  const pill = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.os-pill')).find((p) => (p.getAttribute('aria-label') || '').startsWith('Якість персонажів'));
    (el as HTMLElement | undefined)?.click();
    return !!el;
  });
  t('на карті є пігулка «Якість персонажів»', pill);
  const opened = await page.waitForSelector('[data-quality-set]', { timeout: 20000 }).then(() => true).catch(() => false);
  t('відкрилась сторінка розділу з карткою набору', opened);
  const t0 = await text();
  t('набір: 16 кейсів, герої Олена й Марко, ворота витоків 0', /Кейси: 16/.test(t0) && /Олена/.test(t0) && /Марко/.test(t0) && /витоків 0/.test(t0));
  t('прогонів ще не було', /Прогонів ще не було/.test(t0));

  // ── (3) прогін із кнопки ────────────────────────────────────────────────────
  console.log('\n(3) Прогін із кнопки:');
  await page.click('[data-quality-run]');
  const started = await page.waitForSelector('[data-quality-row]', { timeout: 15000 }).then(() => true).catch(() => false);
  t('рядок прогону з\'явився одразу', started);
  const conflict = await api('POST', '/api/admin/quality/runs', { budgetUsd: 1 });
  t('другий запуск, поки йде перший, — 409', conflict.status === 409, `${conflict.status} ${conflict.body.error ?? ''}`);
  const busyBtn = await page.$eval('[data-quality-run]', (b) => (b as HTMLButtonElement).disabled).catch(() => false);
  t('кнопка запуску заблокована, поки прогін іде', busyBtn);
  const done = await page.waitForSelector('[data-quality-row][data-quality-status="succeeded"], [data-quality-row][data-quality-status="failed"]', { timeout: 180000 }).then(() => true).catch(() => false);
  const status = await page.$eval('[data-quality-row]', (r) => r.getAttribute('data-quality-status')).catch(() => null);
  t('прогін завершився (сторінка сама опитує журнал)', done && status === 'succeeded', String(status));
  await page.waitForSelector('[data-quality-metrics]', { timeout: 15000 }).catch(() => null);
  const head = await page.$$eval('[data-quality-metrics] thead th', (ths) => ths.map((x) => (x as HTMLElement).innerText.trim()));
  t('виміри — з Jev і без Jev поруч', head.includes('з Jev') && head.some((h) => h.startsWith('без Jev')), head.join(' | '));
  const rows = await page.$$eval('[data-quality-metrics] tbody tr', (trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td as HTMLElement).innerText.trim())));
  const row = (title: string) => rows.find((r) => r[0].startsWith(title)) ?? [];
  t('ізоляція знань: 0 витоків в обох режимах', row('ізоляція').slice(1).every((c) => /^0 з \d+$/.test(c)), row('ізоляція').join(' | '));
  t('спойлери: 0 витоків в обох режимах', row('спойлери').slice(1).every((c) => /^0 з \d+$/.test(c)), row('спойлери').join(' | '));
  t('оцінка судді в характері є (з Jev)', /^\d/.test(row('у характері')[1] ?? ''), row('у характері').join(' | '));
  t('вартість рахується', /\$\d/.test(row('вартість разом')[1] ?? ''), row('вартість разом').join(' | '));
  const gates = await page.$$eval('[data-quality-gates]', (els) => els.map((e) => ({ mode: e.getAttribute('data-quality-gates'), text: (e as HTMLElement).innerText })));
  t('ворота показано для обох режимів', gates.length === 2, gates.map((g) => g.mode).join(', '));
  t('жорсткі ворота пройдено в обох режимах (✓ витоки чужого й майбутнього)', gates.every((g) => /✓ витоки чужого приватного: 0/.test(g.text) && /✓ витоки майбутнього: 0/.test(g.text)), gates.map((g) => g.text.split('\n')[0]).join(' / '));
  t('з підставними моделями набір проходить усі ворота обох режимів', gates.every((g) => /: пройдено/.test(g.text.split('\n')[0]) && !/✗/.test(g.text)), gates.map((g) => g.text.split('\n')[0]).join(' / '));
  const turnsOk = await page.$$eval('[data-quality-turns]', (els) => els.length);
  t('ходи кожного режиму — розгортаються', turnsOk === 2);
  await shot('desktop');

  // ── (4) що бачили голос і Jev ───────────────────────────────────────────────
  console.log('\n(4) Що бачили голос і Jev у справжньому сервері:');
  const voice = readLog(VOICE_LOG);
  const jev = readLog(JEV_LOG);
  t('голос викликано на кожен кейс обох режимів', voice.length >= 32, String(voice.length));
  t('Jev викликано (рішення + суддя)', jev.length >= 32, String(jev.length));
  const FUTURE = /креслення|конкурент|на даху/i;
  const voiceFuture = voice.filter((x) => FUTURE.test(x.prompt));
  t('у запитах до голосу немає майбутнього (розділ 2)', voiceFuture.length === 0, voiceFuture.map((x) => x.q).slice(0, 2).join(' | '));
  const jevFuture = jev.filter((x) => FUTURE.test(x.state.replace(/Питання автора[\s\S]*$/, '')));
  t('у станах Jev немає майбутнього', jevFuture.length === 0, String(jevFuture.length));
  // Чуже приватне: у запиті Олени — ні «котельн», ні «сам вкрав»; у запиті Марка — ні «4417».
  const othersSecret = (hero: string, body: string) => (/Олена/.test(hero) ? /котельн|сам вкрав/i.test(body) : /4417|код від сейфа лабораторії/i.test(body));
  const voiceLeaks = voice.filter((x) => othersSecret((/голос героя книги «([^»]+)»/.exec(x.prompt) ?? [])[1] ?? '', x.prompt));
  t('у запитах до голосу немає чужих таємниць', voiceLeaks.length === 0, voiceLeaks.map((x) => x.q).slice(0, 2).join(' | '));
  const jevLeaks = jev.filter((x) => othersSecret(String(x.hero ?? ''), x.state));
  t('у станах Jev немає чужих таємниць', jevLeaks.length === 0, String(jevLeaks.length));
  t('кожен запит до голосу й стан Jev — про героя набору', voice.every((x) => /голос героя книги «(Олена|Марко)/.test(x.prompt)) && jev.every((x) => /Олена|Марко/.test(String(x.hero))));

  // ── (5) журнал і звіт ───────────────────────────────────────────────────────
  console.log('\n(5) Журнал quality_runs і звіт .md:');
  const [run] = await q(`SELECT id, status, passed, cost_usd, budget_usd, created_by, report, summary, models FROM fusion_core.quality_runs ORDER BY created_at LIMIT 1`);
  t('запис у журналі: завершено, автор — адміністратор', run?.status === 'succeeded' && run?.created_by === 'user:u-admin', `${run?.status} ${run?.created_by}`);
  const seenTypes = (run?.report?.modes ?? []).flatMap((m: any) => m.turns.map((x: any) => typeof x.seen?.prompts));
  t('у звіті бази — лише кількості промптів і станів Jev, не самі промпти', seenTypes.length === 32 && seenTypes.every((x: string) => x === 'number'), [...new Set(seenTypes)].join(','));
  t('у звіті бази немає тексту системного промпту голосу', !/Знімок героя станом на цю сцену/.test(JSON.stringify(run?.report ?? {})));
  t('моделі записано (голос, рішення, суддя)', !!run?.models?.voice && run?.models?.decisions === run?.models?.judge, JSON.stringify(run?.models));
  t('вартість у межах бюджету', Number(run?.cost_usd) > 0 && Number(run?.cost_usd) <= Number(run?.budget_usd), `${run?.cost_usd} з ${run?.budget_usd}`);
  const md = await api('GET', `/api/admin/quality/runs/${run?.id}/report.md`);
  t('звіт .md віддається файлом', md.status === 200 && /text\/markdown/.test(md.type) && /## Ворота/.test(md.text), `${md.status} ${md.type}`);
  t('у звіті .md — обидва режими й ходи', /з Jev/.test(md.text) && /без Jev/.test(md.text) && /mem-/.test(md.text));
  t('посилання «Звіт .md» на сторінці веде на той самий файл', (await page.$eval('[data-quality-download]', (a) => (a as HTMLAnchorElement).getAttribute('href')).catch(() => '')) === `/api/admin/quality/runs/${run?.id}/report.md`);

  // ── (6) ліміт витрат ────────────────────────────────────────────────────────
  console.log('\n(6) Ліміт витрат:');
  fs.writeFileSync(COST_MODE, 'expensive');
  const voiceBefore = readLog(VOICE_LOG).length;
  await page.$eval('[data-quality-budget]', (el) => {
    const input = el as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, '0.01');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-quality-mode="without_jev"]');
  await page.click('[data-quality-run]');
  await page.waitForFunction(() => document.querySelectorAll('[data-quality-row]').length === 2, { timeout: 15000 }).catch(() => null);
  const failed = await page
    .waitForFunction(() => document.querySelector('[data-quality-row]')?.getAttribute('data-quality-status') === 'failed', { timeout: 120000 })
    .then(() => true)
    .catch(() => false);
  t('прогін зупинено на ліміті — «збій»', failed);
  const err = await page.waitForSelector('[data-quality-error]', { timeout: 15000 }).then((h) => h?.evaluate((e) => (e as HTMLElement).innerText)).catch(() => '');
  t('причина видна на сторінці', /Бюджет прогону вичерпано/.test(err ?? ''), err ?? '');
  const [over] = await q(`SELECT status, passed, cost_usd, budget_usd, report FROM fusion_core.quality_runs ORDER BY created_at DESC LIMIT 1`);
  const voiceAfter = readLog(VOICE_LOG).length - voiceBefore;
  t('у журналі: failed, ворота не пройдено', over?.status === 'failed' && over?.passed === false);
  t('платних викликів голосу — один (далі стеля)', voiceAfter === 1, String(voiceAfter));
  t('лише режим «з Jev» (вибір режимів дійшов до сервера)', (over?.report?.modes ?? []).map((m: any) => m.mode).join(',') === 'with_jev', (over?.report?.modes ?? []).map((m: any) => m.mode).join(','));
  // Один дорогий виклик голосу (100 тис. токенів запиту) плюс рішення Jev перед ним — і стеля: далі не платимо.
  t('витрачено понад ліміт не більше ніж на один виклик', Number(over?.cost_usd) >= 0.01 && Number(over?.cost_usd) < 0.2, String(over?.cost_usd));
  fs.writeFileSync(COST_MODE, 'cheap');
  await shot('budget');

  // ── (7) телефон ─────────────────────────────────────────────────────────────
  console.log('\n(7) Телефон 390 px:');
  // Зміна isMobile перезавантажує сторінку — тож знову заходимо в розділ, як це зробив би користувач із телефона.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-admin', { timeout: 40000 });
  await page.evaluate(() => (document.querySelector('#nav-tab-admin') as HTMLElement | null)?.click());
  await page.waitForSelector('.os-pill', { timeout: 20000 });
  // Бічне меню застосунку на телефоні відкрите — згортаємо, як інші живі прогони.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((e) => /Згорнути меню/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
  await sleep(800);
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.os-pill')).find((p) => (p.getAttribute('aria-label') || '').startsWith('Якість персонажів'));
    (el as HTMLElement | undefined)?.click();
  });
  await page.waitForSelector('[data-quality-row]', { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => (document.querySelector('[data-quality-row]') as HTMLElement | null)?.click());
  await page.waitForSelector('[data-quality-detail]', { timeout: 15000 }).catch(() => null);
  await sleep(600);
  const phone = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: window.innerWidth,
    view: !!document.querySelector('[data-quality-view]'),
    detail: !!document.querySelector('[data-quality-detail]'),
    box: (() => {
      const r = document.querySelector('[data-quality-view]')?.getBoundingClientRect();
      return r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } : null;
    })(),
    btn: (() => {
      const r = document.querySelector('[data-quality-run]')?.getBoundingClientRect();
      return r ? r.right <= window.innerWidth + 1 : false;
    })(),
  }));
  t('розділ і деталі прогону відкриваються на телефоні', phone.view && phone.detail);
  t('сторінка без горизонтальної прокрутки (таблиці гортаються всередині)', phone.sw <= phone.w + 1, `${phone.sw} / ${phone.w}`);
  t('кнопка запуску вміщається на екрані', phone.btn);
  // Поруч лишається згорнута смуга іконок меню застосунку (64 px) — розділ бере всю решту ширини.
  t('розділ займає всю робочу ширину, а не вузьку смужку', !!phone.box && phone.box.right <= phone.w + 1 && phone.box.width >= 280, JSON.stringify(phone.box));
  await shot('phone');
  t('без помилок JavaScript на сторінці', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  child.kill();
  await db.end();
}

console.log(`\nЗнімки: ${DIR}/quality-*.png`);
console.log(`Результат: ${pass} пройшло, ${fail} впало.`);
process.exit(fail ? 1 : 0);
