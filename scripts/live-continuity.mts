/**
 * Живий прогін сторінки 8 «Перевірка безперервності» — Т2.4 В8.
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:continuity
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер, книга — стартовий фікстур
 * `BK-2084-CYBER`. Текст із тегами автор набирає в редакторі; далі все — на
 * сторінці `/continuity`: «Перевірити правилами» (п'ять правил без AI),
 * картка проблеми з двома доказами й «Відкрити в тексті», кнопки статусу,
 * «AI-2: перевірити розділ» (справжня фонова задача `ai_continuity`, модель
 * підставна — перехоплювач `fetch` у процесі сервера відповідає замість
 * Gemini), риси — підтвердити пропозицію AI-2 і додати свою, перевірка
 * чернетки на «витік знання» з історією, телефон 390 px.
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
const DIR = path.join(os.tmpdir(), 'nova-continuity');
const PORT = Number(process.env.CONTINUITY_PORT || 34281);
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

// Підставна модель тексту (AI-2): на запит Gemini generateContent відповідає рисою й проблемою
// з доказом — останнім абзацом, який сервер показав моделі (саме абзацом ЦЬОГО розділу).
const FAKE_LOG = path.join(DIR, 'fake-text-requests.jsonl');
const FAKE = path.join(DIR, 'fake-text-provider.mjs');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /generateContent/.test(url)) {
    const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
    const body = typeof raw === 'string' ? raw : await new Response(raw).text();
    fs.appendFileSync(${JSON.stringify(FAKE_LOG)}, JSON.stringify({ url, body: body.slice(0, 20000) }) + '\\n');
    const own = /Абзаци ЦЬОГО розділу: ([^\\n.]+)/.exec(JSON.parse(body).contents?.map?.((c) => c.parts.map((p) => p.text).join('')).join('') ?? body);
    const ids = own ? own[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    const last = ids[ids.length - 1];
    const answer = { findings: last ? [
      { kind: 'continuity_trait', entity_type: 'location', entity_name: 'Київ', label: 'розмір', value: 'величезний', summary: 'Київ величезний.', paragraph_ids: [last], confidence: 0.8 },
      { kind: 'continuity_issue', issue_kind: 'place', entity_type: 'location', entity_name: 'Київ', summary: 'Опис Києва тут не сходиться з раніше встановленим.', paragraph_ids: [last], confidence: 0.4, insufficient_data: true },
    ] : [] };
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60, totalTokenCount: 180 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
`);
const fakeRequests = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-continuity@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, ['--import', pathToFileURL(FAKE).href, path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ROLE_ONBOARDING: 'off', ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: 'live-fake-key', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', APP_URL: BASE },
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
t('ядро піднялось (схема з міграцією 0014)', true);
const [{ v }] = await q('SELECT max(version) AS v FROM fusion_core.core_schema_migrations');
t('схема ядра v14 — таблиця перевірок чернеток на місці', Number(v) >= 14, `v${v}`);

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

console.log('\nПідготовка: автор набирає текст із тегами в редакторі:');
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
await page.keyboard.type(' [/character:Марко] [/location:Київ] Марко в Києві шепнув про [/revelation:Таємниця @Марко].');
const [kyiv] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Київ'`, [BOOK]), (r) => r.length === 1);
const [secret] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Таємниця'`, [BOOK]), (r) => r.length === 1);
const [olena] = await q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук'`, [BOOK]);
t('синхронізовано: Київ, Таємниця (Олена — з фікстури)', !!(kyiv && secret && olena));
// Фонові задачі ядра мусять відпрацювати до кінця: без цього перевірка читає
// недописаний стан (розбір — запис #301).
const pendingJobs = await waitFor(
  () => q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND status IN ('queued', 'running')`, [BOOK]),
  (r) => Number(r[0]?.n) === 0,
  90000,
);
t('фонові задачі ядра відпрацювали до кінця', Number(pendingJobs[0]?.n) === 0, `у черзі ${pendingJobs[0]?.n}`);
const [para] = await waitFor(
  () => q(`SELECT p.id, p.document_id, p.text FROM fusion_core.paragraphs p WHERE p.project_id = $1 AND p.text LIKE '%Таємниця @Марко%' AND p.deleted_at IS NULL`, [BOOK]),
  (r) => r.length === 1,
);
// Автор уже вписав рису Києва на картці (маршрут В1) — у тому ж розділі, де текст.
await api('PUT', `/api/projects/${BOOK}/entities/${kyiv.id}/traits`, { label: 'колір стін', value: 'білий', sectionId: para.document_id });
await api('PUT', `/api/projects/${BOOK}/entities/${kyiv.id}/traits`, { label: 'Колір стін', value: 'жовтий', sectionId: para.document_id });
// Проблема AI-2 з абзацом-доказом (форма та сама, що пише задача ai_continuity) — для «Відкрити в тексті».
await db.query(
  `INSERT INTO fusion_core.continuity_issues (project_id, kind, entity_id, summary, evidence_a, evidence_b, status, source, insufficient_data, created_by)
   VALUES ($1, 'knowledge', $2, 'Марко знає таємницю раніше, ніж мав би.', $3, NULL, 'suggested', 'ai', true, 'ai:AI-2')`,
  [BOOK, secret.id, JSON.stringify({ sectionId: para.document_id, paragraphId: para.id, quote: 'Марко в Києві шепнув про Таємниця', entityId: secret.id })],
);

console.log('\nСторінка 8 — перелік, «Перевірити правилами», картка з двома доказами:');
await page.goto(`${BASE}/projects/${BOOK}/continuity`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-continuity]', { timeout: 20000 });
t('немає заглушки «з\'явиться на етапі» — сторінка 8 робоча', !(await page.evaluate(() => /з'явиться повністю на етапі/.test(document.body.textContent || ''))));
await page.waitForSelector('[data-cont-issue]', { timeout: 15000 });
t('проблема AI-2 — у переліку як «Пропозиція»', (await page.$$eval('[data-cont-issue]', (els) => els.map((e) => e.getAttribute('data-cont-issue-status')))).join() === 'suggested');
await page.click('[data-cont-run-rules]');
await page.waitForSelector('[data-cont-message]', { timeout: 20000 });
const msg = await waitFor(() => page.$eval('[data-cont-message]', (e) => e.textContent || ''), (s) => /Правила перевірено/.test(s), 20000);
t('«Перевірити правилами» — п\'ять правил за командою, підсумок у повідомленні', /нових проблем — 1/.test(msg), msg);
const placeCard = await waitFor(() => page.$$eval('[data-cont-issue-kind="place"]', (els) => els.map((e) => ({ ev: e.querySelectorAll('[data-cont-evidence]').length, text: e.textContent || '' }))), (r) => r.length === 1, 10000);
t('КРИТЕРІЙ сторінки 8: картка «Місце» — обидва докази поруч («білий» і «жовтий»)', placeCard[0]?.ev === 2 && /білий/.test(placeCard[0].text) && /жовтий/.test(placeCard[0].text), JSON.stringify(placeCard));

await page.click('[data-cont-kind="knowledge"]');
await waitFor(() => page.$$eval('[data-cont-issue]', (els) => els.length), (n) => n === 1, 10000);
t('фільтр за видом: «Знання» — лише одна проблема, «Місце» сховано', (await page.$$('[data-cont-issue-kind="place"]')).length === 0);
const knowledgeCard = await page.$eval('[data-cont-issue-kind="knowledge"]', (e) => ({ missing: !!e.querySelector('[data-cont-evidence-missing]'), text: e.textContent || '' }));
t('«недостатньо даних» — друга сторона підписана, не порожня', knowledgeCard.missing && /Недостатньо даних/.test(knowledgeCard.text));

console.log('\nКнопки статусу (автор змінює статус):');
await page.click('[data-cont-issue-kind="knowledge"] [data-cont-set="confirmed"]');
const st = await waitFor(() => q(`SELECT status, created_by FROM fusion_core.continuity_issues WHERE project_id = $1 AND kind = 'knowledge'`, [BOOK]), (r) => r[0]?.status === 'confirmed', 10000);
t('КРИТЕРІЙ: «Підтвердити» — статус у базі confirmed, від автора', st[0]?.status === 'confirmed' && st[0]?.created_by === 'user:u-admin', JSON.stringify(st));
await waitFor(() => page.$eval('[data-cont-issue-kind="knowledge"]', (e) => e.getAttribute('data-cont-issue-status')), (s) => s === 'confirmed', 10000);
t('картка оновилась — тепер «Виправлено / Відхилити»', !!(await page.$('[data-cont-issue-kind="knowledge"] [data-cont-set="resolved"]')));

console.log('\n«Відкрити в тексті»:');
await page.click(`[data-cont-issue-kind="knowledge"] [data-cont-open="${para.id}"]`);
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 20000 });
t('перехід до абзацу — відкрився редактор з розділом доказу', /Таємниця @Марко|шепнув/.test(await page.$eval('#book-content-editor-ua', (e) => e.textContent || '')));

console.log('\nAI-2 по розділу (справжня задача ai_continuity, підставна модель):');
await page.goto(`${BASE}/projects/${BOOK}/continuity`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-cont-ai-section]', { timeout: 20000 });
await page.select('[data-cont-ai-section]', para.document_id);
await page.click('[data-cont-run-ai]');
const aiMsg = await waitFor(() => page.$eval('[data-cont-message]', (e) => e.textContent || '').catch(() => ''), (s) => /AI-2 завершив/.test(s), 60000);
t('AI-2 завершив: 1 проблема й 1 риса на розгляд', /проблем — 1, рис на розгляд — 1/.test(aiMsg), aiMsg);
t('модель викликано рівно раз — лише за командою', fakeRequests().length === 1, String(fakeRequests().length));
const aiIssue = await q(`SELECT status, source, insufficient_data FROM fusion_core.continuity_issues WHERE project_id = $1 AND source = 'ai' AND kind = 'place'`, [BOOK]);
t('проблема AI-2 в базі — suggested, «недостатньо даних»', aiIssue.length === 1 && aiIssue[0].status === 'suggested' && aiIssue[0].insufficient_data === true, JSON.stringify(aiIssue));

console.log('\nРиси: пропозиція AI-2 → «Підтвердити», своя риса:');
await page.click('[data-continuity-tab="traits"]');
await page.waitForSelector(`[data-cont-trait-entity="${kyiv.id}"]`, { timeout: 15000 });
const suggestedRow = await page.$(`[data-cont-trait-entity="${kyiv.id}"] [data-cont-trait-status="suggested"]`);
t('риса AI-2 «розмір: величезний» — з позначкою пропозиції і кнопками', !!suggestedRow && /величезний/.test(await suggestedRow!.evaluate((e) => e.textContent || '')));
await page.click(`[data-cont-trait-entity="${kyiv.id}"] [data-cont-trait-status="suggested"] [data-cont-trait-set="confirmed"]`);
const conf = await waitFor(() => q(`SELECT status, source FROM fusion_core.entity_traits WHERE project_id = $1 AND label = 'розмір'`, [BOOK]), (r) => r[0]?.status === 'confirmed', 10000);
t('«Підтвердити» — confirmed, походження ai збережено', conf[0]?.status === 'confirmed' && conf[0]?.source === 'ai', JSON.stringify(conf));
await page.select('[data-cont-trait-entity-select]', kyiv.id);
await page.type('[data-cont-trait-label]', 'матеріал мосту');
await page.type('[data-cont-trait-value]', 'камінь');
await page.click('[data-cont-trait-add]');
const added = await waitFor(() => q(`SELECT status, source FROM fusion_core.entity_traits WHERE project_id = $1 AND label = 'матеріал мосту'`, [BOOK]), (r) => r.length === 1, 10000);
t('своя риса з форми — confirmed, від автора', added[0]?.status === 'confirmed' && added[0]?.source === 'author');

console.log('\nЧернетка: «витік знання» (ТЗ-H) та історія:');
await page.click('[data-continuity-tab="draft"]');
await page.waitForSelector('[data-cont-draft-text]', { timeout: 10000 });
await waitFor(() => page.$$eval('[data-cont-draft-hero] option', (els) => els.length), (n) => n > 0, 10000);
await page.select('[data-cont-draft-hero]', olena.id);
await page.type('[data-cont-draft-text]', 'Олена тихо сказала, що знає [/revelation:Таємниця].');
await page.click('[data-cont-draft-check]');
await page.waitForSelector('[data-cont-draft-result]', { timeout: 15000 });
const finding = await page.$eval('[data-cont-draft-result]', (e) => ({ f: e.querySelectorAll('[data-cont-draft-finding]').length, reason: e.querySelector('[data-cont-draft-finding]')?.getAttribute('data-cont-draft-reason'), text: e.textContent || '' }));
t('КРИТЕРІЙ ТЗ-H: навмисний витік знайдено — Олена не дізнається «Таємницю» в книзі', finding.f === 1 && finding.reason === 'never_learns' && /Таємниця/.test(finding.text), JSON.stringify(finding));
await waitFor(() => page.$$eval('[data-cont-draft-history-row]', (els) => els.length), (n) => n === 1, 10000);
t('перевірка — в історії героя', (await page.$$('[data-cont-draft-history-row]')).length === 1);
const saved = await q(`SELECT jsonb_array_length(findings) AS n FROM fusion_core.continuity_draft_checks WHERE project_id = $1`, [BOOK]);
const bookIntact = await q(`SELECT count(*)::int AS n FROM fusion_core.paragraphs WHERE project_id = $1 AND text LIKE '%що знає [/revelation:Таємниця]%'`, [BOOK]);
t('у базі — один запис історії з однією знахідкою; у текст книги чернетка не потрапила', saved.length === 1 && Number(saved[0].n) === 1 && Number(bookIntact[0].n) === 0, JSON.stringify({ saved, bookIntact }));

await page.goto(`${BASE}/projects/${BOOK}/continuity`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-cont-issue]', { timeout: 20000 });
await sleep(800);
await page.screenshot({ path: path.join(DIR, 'continuity-desktop.png') });

console.log('\nТелефон:');
await page.setViewport({ width: 390, height: 844 });
for (const tab of ['issues', 'traits', 'draft']) {
  await page.goto(`${BASE}/projects/${BOOK}/continuity`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-continuity]', { timeout: 20000 });
  if (tab !== 'issues') {
    await page.waitForSelector(`[data-continuity-tab="${tab}"]`, { timeout: 10000 });
    await page.click(`[data-continuity-tab="${tab}"]`);
  }
  await sleep(800);
  const mm = await page.evaluate(() => {
    const el = document.querySelector('[data-continuity]') as HTMLElement | null;
    return { scrollW: document.documentElement.scrollWidth, vw: window.innerWidth, w: el?.scrollWidth ?? 0, cw: el?.clientWidth ?? 0 };
  });
  const wide = await page.evaluate(() => {
    const root = document.querySelector('[data-continuity]') as HTMLElement | null;
    const r = root?.getBoundingClientRect();
    return r ? Array.from(root!.querySelectorAll('*')).filter((e) => e.getBoundingClientRect().right > r.right + 1).slice(0, 3).map((e) => `${e.tagName}.${(e as HTMLElement).className.slice(0, 40)}:${Math.round(e.getBoundingClientRect().width)}`) : [];
  });
  t(`телефон 390 px, вкладка «${tab}» — у межах екрана, сама сторінка без горизонтальної прокрутки`, mm.scrollW <= mm.vw + 1 && mm.w <= mm.cw + 1, JSON.stringify({ ...mm, wide }));
  await page.screenshot({ path: path.join(DIR, `continuity-${tab}-phone.png`), fullPage: true });
}
console.log(`  (знімки: ${DIR}/continuity-*-phone.png)`);
t('жодної помилки JavaScript на сторінці', errors.length === 0, errors.join(' | ').slice(0, 400));

await browser.close();
child.kill();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2500)); process.exit(1); }
