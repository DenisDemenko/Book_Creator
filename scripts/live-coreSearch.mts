/**
 * Живий прогін гібридного пошуку (Т1.2, журнал #253).
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:core-search
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL з pgvector і браузер. Ключів моделей у
 * прогоні немає (мережі до провайдерів теж) — тож перевіряється саме те, що
 * мусить працювати й без них: книга після збереження синхронізується, задача
 * `core_embed` ставиться сама й чесно пропускає смислову частину без ключа,
 * пошук за словами знаходить абзац, граф — «персонаж + емоція» (критерій
 * Т1.2) з точним paragraph_id; адмін бачить і змінює модель ембедингів, а
 * панель пояснює, що її дефолт — лише для пошуку. Смислову частину з
 * векторами перевіряє `test:core-search` (підставний ембедер).
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
const DIR = path.join(os.tmpdir(), 'nova-core-search');
const PORT = Number(process.env.CORE_SEARCH_PORT || 34253);
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
  for (let i = 0; i < ms / 1000 && !ok(v); i++) {
    await sleep(1000);
    v = await fn();
  }
  return v;
};

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-search@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
await saveUser({ id: 'u-x', email: 'x@test.ua', name: 'Чужий', role: 'writer', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
const TOKEN_X = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
await createSession({ token: TOKEN_X, userId: 'u-x', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '' },
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
const schema = (log.join('').match(/схема v(\d+)/) ?? [])[1];
t('ядро піднялось, міграція пошуку накочена (схема v6)', schema === '6', `v${schema}`);

const api = async (method: string, p: string, body?: unknown, token = TOKEN) => {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Cookie: `nova_session=${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

console.log('\nКнига в ядрі:');
await page.goto(`${BASE}/projects/${BOOK}/editor`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 40000 });
await sleep(1500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button,a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
  b?.click();
});
const first = await page.$('#book-content-editor-ua .ProseMirror > *');
await first!.click();
await page.keyboard.press('End');
await page.keyboard.type(' ');
await page.keyboard.press('Backspace');
const pids = (await page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  const out = []; ed.state.doc.forEach((n) => out.push(n.attrs.pid || null)); return out;
})()`)) as string[];
const synced = await waitFor(
  () => q(`SELECT id, text, document_id FROM fusion_core.paragraphs WHERE project_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`, [BOOK, pids]),
  (rows) => rows.length >= 3,
);
t('абзаци розділу — у ядрі', synced.length >= 3, `${synced.length} з ${pids.length}`);
const tsv = await q(`SELECT count(*)::int AS n FROM fusion_core.paragraphs WHERE project_id = $1 AND search_tsv IS NOT NULL`, [BOOK]);
t('у кожного абзацу — пошуковий вектор слів (tsvector)', tsv[0].n >= synced.length, `${tsv[0].n}`);

const embedJob = await waitFor(
  () => q(`SELECT status, result, created_by FROM fusion_core.core_jobs WHERE project_id = $1 AND kind = 'core_embed' ORDER BY created_at DESC LIMIT 1`, [BOOK]),
  (rows) => rows[0]?.status === 'succeeded' || rows[0]?.status === 'failed',
);
t('після синхронізації сама поставилась задача core_embed', embedJob[0]?.created_by === 'system:core_sync', embedJob[0]?.created_by);
t('без ключа — не збій, а «пропущено» з причиною', embedJob[0]?.status === 'succeeded' && embedJob[0]?.result?.skipped === 'unavailable' && /ключа/.test(embedJob[0]?.result?.reason ?? ''), JSON.stringify(embedJob[0]?.result).slice(0, 160));

console.log('\nПошук за словами:');
const byId = new Map(synced.map((r: any) => [r.id, r]));
const target = pids.find((id) => (byId.get(id)?.text ?? '').length > 40) ?? pids[1];
const words = String(byId.get(target)!.text).replace(/\[[^\]]*\]/g, ' ').match(/[\p{L}]{7,}/gu) ?? [];
const word = words.sort((a, b) => b.length - a.length)[0];
const w = await api('GET', `/api/projects/${BOOK}/search?q=${encodeURIComponent(word)}`);
t(`слово з абзацу («${word}») знаходить цей абзац`, w.status === 200 && w.body.results.some((r: any) => r.paragraphId === target && r.editorPid === target && r.sources.text), `${w.status} ${w.body.results?.length}`);
t('без ключа ембедингів — пошук за словами, причина у відповіді', w.body.sources?.vector?.used === false && /Немає ключа/.test(w.body.sources?.vector?.reason ?? '') && w.body.sources?.vector?.model === 'gemini-embedding-001', JSON.stringify(w.body.sources?.vector));
const embedJobs = await q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND kind = 'core_embed'`, [BOOK]);
t('без ключа пошук не ставить зайвих задач core_embed', embedJobs[0].n === 1, `${embedJobs[0].n}`);

console.log('\nКритерій Т1.2 — «персонаж + емоція»:');
// Згадки так, як їх кладе синхронізація з тегів: страх Олени — в одному абзаці,
// Олена без страху — в іншому, страх без Олени — в третьому.
const [pFear, pOlena, pOther] = [pids[1], pids[2], pids[3] ?? pids[0]];
// Героїня книги — та сама сутність, що створила синхронізація зі списку
// персонажів («Олена Ковальчук», псевдонім «Олена»); запит — з відмінком.
const [olena] = await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND type = 'character' AND name = 'Олена Ковальчук'`, [BOOK]);
const [fear] = await q(`INSERT INTO fusion_core.entities (project_id, type, name, status, created_by) VALUES ($1, 'emotion', 'страх', 'confirmed', 'user:u-admin') RETURNING id`, [BOOK]);
const mention = (entity: string, pid: string, subject: string | null) =>
  q(`INSERT INTO fusion_core.entity_mentions (project_id, entity_id, paragraph_id, span_start, span_end, source, status, subject_entity_id)
     VALUES ($1, $2, $3, 0, 1, 'tag', 'confirmed', $4)`, [BOOK, entity, pid, subject]);
await mention(fear.id, pFear, olena.id);
await mention(olena.id, pOlena, null);
await mention(fear.id, pOther, null);
const s = await api('GET', `/api/projects/${BOOK}/search?q=${encodeURIComponent('Олени страх')}`);
const top = s.body.results?.[0];
t('«Олени страх» — першим абзац зі страхом саме Олени (точний paragraph_id)', s.status === 200 && top?.paragraphId === pFear, `${top?.paragraphId} vs ${pFear}`);
t('у результаті — розділ, номер у редакторі й пояснення', top?.sectionId === byId.get(pFear)?.document_id && top?.editorPid === pFear && /Олена Ковальчук — через «страх»/.test(top?.why ?? ''), top?.why);
t('впізнано обидві сутності запиту (героїня — за псевдонімом і з відмінком)', s.body.entities?.length === 2 && s.body.entities.some((e: any) => e.id === olena.id), JSON.stringify(s.body.entities?.map((e: any) => e.name)));
t('абзац, де є все назване, позначено як повний збіг', top?.sources?.graph?.groupsCovered === 2 && top?.sources?.graph?.groupsTotal === 2);
const rest = s.body.results.map((r: any) => r.paragraphId);
t('Олена без страху і страх без Олени — теж у видачі, але нижче', rest.indexOf(pOlena) > 0 && rest.indexOf(pOther) > 0, rest.slice(0, 5).join());
const f = await api('POST', `/api/projects/${BOOK}/search`, { entityIds: [olena.id, fear.id] });
t('фільтр «обидві сутності» — рівно один абзац', f.status === 200 && f.body.results.length === 1 && f.body.results[0].paragraphId === pFear);
t('чужому — 403', (await api('GET', `/api/projects/${BOOK}/search?q=страх`, undefined, TOKEN_X)).status === 403);

console.log('\nМодель ембедингів (адмін):');
const g = await api('GET', '/api/ai/core-embedding-model');
t('дефолт — gemini-embedding-001, у переліку 4 моделі', g.status === 200 && g.body.modelId === 'gemini-embedding-001' && g.body.defaultModelId === 'gemini-embedding-001' && g.body.models.length === 4, JSON.stringify(g.body).slice(0, 160));
t('без ключів — моделі позначено недоступними', g.body.models.every((m: any) => m.available === false));
t('невідома модель — 400 (DeepSeek ембедингів не має)', (await api('PUT', '/api/ai/core-embedding-model', { modelId: 'deepseek-v4-pro' })).status === 400);
const put = await api('PUT', '/api/ai/core-embedding-model', { modelId: 'text-embedding-3-small' });
t('зміна моделі', put.status === 200 && put.body.modelId === 'text-embedding-3-small');
const s2 = await api('GET', `/api/projects/${BOOK}/search?q=${encodeURIComponent(word)}`);
t('пошук бере нову модель', s2.body.sources?.vector?.model === 'text-embedding-3-small');
t('інші функції ШІ не зачеплено: мапа «модуль → модель» порожня', JSON.stringify((await api('GET', '/api/ai/core-module-models')).body.models) === '{}');
const back = await api('PUT', '/api/ai/core-embedding-model', { modelId: null });
t('порожнє значення — назад до дефолту пошуку', back.body.modelId === 'gemini-embedding-001');
t('не адміну — 403', (await api('GET', '/api/ai/core-embedding-model', undefined, TOKEN_X)).status === 403);

console.log('\nПанель «Ядро AI (адмін)»:');
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#quick-ai-btn', { timeout: 40000 });
await sleep(1500);
await page.click('#quick-ai-btn');
await sleep(1200);
const opened = await page.evaluate((txt: string) => {
  const b = Array.from(document.querySelectorAll('button')).find((e) => (e.textContent || '').trim() === txt) as HTMLElement | undefined;
  b?.click();
  return !!b;
}, 'Ядро AI (адмін)');
await page.waitForSelector('[data-embedding-model-setting]', { timeout: 15000 }).catch(() => null);
const block = await page.evaluate(() => (document.querySelector('[data-embedding-model-setting]') as HTMLElement | null)?.innerText ?? '');
t('блок «Модель ембедингів» у панелі', opened && /Модель ембедингів/.test(block), block.slice(0, 80));
t('підпис: дефолт — Gemini, і лише для пошуку, не для інших функцій ШІ', /За замовчуванням — Gemini Embedding 001/.test(block) && /ЛИШЕ на пошук/.test(block) && /не на інші функції ШІ/.test(block));
const selected = await page.evaluate(() => (document.querySelector('[data-embedding-model-setting] select') as HTMLSelectElement | null)?.value);
t('обрано дефолт', selected === 'gemini-embedding-001', String(selected));
await (await page.$('[data-embedding-model-setting]'))?.scrollIntoView();
await page.screenshot({ path: path.join(DIR, 'embedding-model.png') });
console.log(`  (знімок: ${path.join(DIR, 'embedding-model.png')})`);

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
