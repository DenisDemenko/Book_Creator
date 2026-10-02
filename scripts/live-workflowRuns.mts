/**
 * Живий прогін рушія процесів ШІ (Т5.4, `PLAN_WORKFLOW_ENGINE.md`; ТЗ Graph
 * Studio §5.3, §27, §30, §31, §39 №6–8, 11, 24). Запуск:
 * CORE_TEST_DATABASE_URL=postgres://… npm run live:workflow-runs (потрібен
 * зібраний dist/server.mjs і Chrome/Chromium; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 * Справжній сервер (LangGraph.js у процесі Студії), PostgreSQL і браузер;
 * модель — перехоплений fetch до Gemini (журнал запитів у файлі):
 *   (1) старт ядра — чотири системні процеси, опубліковані v1;
 *   (2) «Знайти згадки» (задача AI-1) — через опублікований процес: запуск,
 *       кроки, пропозиції, температура v1 у запиті до моделі;
 *   (3) нова версія в Graph Studio API: температура й поріг — без коду; задача
 *       бере v2, поріг відсіює слабку згадку (№11);
 *   (4) Graph Studio → «Запуски»: журнал, трасування вузлів і підсумки §27;
 *   (5) ручний запуск із «Запусків», PAUSE під час моделі → RESUME (без
 *       повторного виклику), REPLAY, FORK після моделі (без виклику);
 *   (6) телефон 390 px.
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
import { reconcileParagraphIds } from '../src/utils/paragraphIds';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL.');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-live-workflow-runs');
const PORT = Number(process.env.WORKFLOW_RUNS_PORT || 34391);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'book-live-workflows';
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
  while (!ok(v) && Date.now() < end) { await sleep(300); v = await fn(); }
  return v;
};

// Модель: перехоплений fetch до Gemini у процесі сервера.
const MODE = path.join(DIR, 'mode.txt');
const CALLS = path.join(DIR, 'calls.jsonl');
const FAKE = path.join(DIR, 'fake-gemini.mjs');
fs.writeFileSync(MODE, 'fast');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
const bodyOf = async (input, init) => {
  const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
  return typeof raw === 'string' ? raw : await new Response(raw).text();
};
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /generateContent/.test(url)) {
    const j = JSON.parse(await bodyOf(input, init));
    const text = [...(j.systemInstruction?.parts ?? []), ...(j.contents ?? []).flatMap((c) => c.parts ?? [])].map((p) => p.text ?? '').join('\\n');
    const temperature = j.generationConfig?.temperature ?? null;
    fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify({ temperature, ai1: /згадки/.test(text) }) + '\\n');
    if (fs.readFileSync(${JSON.stringify(MODE)}, 'utf8').trim() === 'slow') await new Promise((r) => setTimeout(r, 5000));
    const findings = [];
    for (const m of text.matchAll(/^\\[([^\\]]+)\\] (.*)$/gm)) {
      if (/Олена/.test(m[2])) findings.push({ kind: 'mention', entity_type: 'character', entity_name: 'Олена', summary: 'Олена', paragraph_ids: [m[1]], confidence: 0.9 });
      if (/Марко/.test(m[2])) findings.push({ kind: 'mention', entity_type: 'character', entity_name: 'Марко', summary: 'Марко', paragraph_ids: [m[1]], confidence: 0.6 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ findings }) }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 320, candidatesTokenCount: 90, totalTokenCount: 410 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
`);
const calls = () => (fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const now = new Date().toISOString();
await saveUser({ id: 'u-admin', email: 'admin-wf@test.ua', name: 'Адмін', role: 'admin', createdAt: now } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, ['--import', pathToFileURL(FAKE).href, path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ROLE_ONBOARDING: 'off', ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: 'live-fake-key', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', TYPESAFE_API_KEY: '', APP_URL: BASE },
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
const api = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

const section = (id: string, content: string) => {
  const r = reconcileParagraphIds({ sectionId: id, content });
  return { id, title: 'Міст', order: 0, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
};
const BOOKDATA = {
  id: BOOK, title: 'Маяк', author: 'Адмін', updatedAt: new Date(Date.now() - 60_000).toISOString(),
  characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
  chapters: [{ id: 'ch1', title: 'Глава', order: 0, sections: [section('s1', 'Олена стояла на мосту.\n\nМарко мовчав.\n\nВітер гнав хмари.')] }],
};

try {
  console.log('(1) Системні процеси на старті ядра (§2 п.2):');
  const wfs = await api('GET', '/api/core/workflows');
  const ids = (wfs.body.workflows ?? []).map((w: any) => `${w.workflow.id}:v${w.production?.version ?? '-'}`).sort().join();
  t('AI-1, AI-2 профіль і пам\'ять, голос героя — опубліковані v1', ids === 'ai1_mentions:v1,ai2_memory:v1,ai2_profile:v1,character_voice:v1', ids);

  console.log('(2) «Знайти згадки» — через опублікований процес (№8):');
  await api('PUT', `/api/books/${BOOK}`, { book: BOOKDATA });
  const paras = await waitFor(() => q(`SELECT id, text FROM fusion_core.paragraphs WHERE project_id = $1 AND document_id = 's1' AND deleted_at IS NULL ORDER BY ord`, [BOOK]), (r) => r.length === 3, 60000);
  t('книга в ядрі: три абзаци', paras.length === 3);
  const enqueue = async () => {
    const r = await api('POST', `/api/projects/${BOOK}/ai/mentions`, { sectionId: 's1' });
    const job = await waitFor(() => q(`SELECT status, result, error FROM fusion_core.core_jobs WHERE id = $1`, [r.body.jobId]), (x) => ['succeeded', 'failed'].includes(x[0]?.status), 60000);
    return { start: r, job: job[0] };
  };
  let { start, job } = await enqueue();
  t('задача AI-1 прийнята й виконана', start.status === 202 && job?.status === 'succeeded', JSON.stringify(job?.result ?? job?.error).slice(0, 200));
  const runs1 = await q(`SELECT * FROM fusion_core.workflow_runs WHERE workflow_id = 'ai1_mentions' ORDER BY created_at`);
  t('запуск процесу ai1_mentions v1 з джерелом «задача»', runs1.length === 1 && runs1[0].status === 'succeeded' && runs1[0].trigger === 'job:ai_mentions' && runs1[0].version === 1 && job.result.workflowRunId === runs1[0].id);
  const steps1 = await q(`SELECT node_id, model, tokens_in, tokens_out, cost_usd FROM fusion_core.workflow_run_steps WHERE run_id = $1 ORDER BY seq`, [runs1[0].id]);
  t('трасування: 7 вузлів, модель і токени на кроці LLM', steps1.map((s: any) => s.node_id).join() === 'start,context,prompt,llm,validate,propose,end' && steps1[3].tokens_in === 320 && steps1[3].tokens_out === 90);
  t('пропозиції — дві згадки', job.result.suggestions === 2, JSON.stringify(job.result));
  t('температура v1 (0,7) дійшла до моделі', calls().at(-1)?.temperature === 0.7, JSON.stringify(calls().at(-1)));

  console.log('(3) Нова версія — температура й поріг без коду (§5.3, №11):');
  const draft = await api('POST', '/api/core/workflows/ai1_mentions/draft', {});
  const vid = draft.body.version?.id ?? draft.body.draft?.id ?? draft.body.id;
  const ver = await api('GET', `/api/core/workflows/ai1_mentions/versions/${vid}`);
  const def = ver.body.version.definition;
  def.nodes.find((n: any) => n.id === 'llm').params.temperature = 0.15;
  def.nodes.find((n: any) => n.id === 'propose').params.min_confidence = 0.7;
  const saved = await api('PUT', `/api/core/workflows/ai1_mentions/versions/${vid}`, { definition: def, expectedRevision: ver.body.version.revision });
  const val = await api('POST', `/api/core/workflows/ai1_mentions/versions/${vid}/validate`);
  const tst = await api('POST', `/api/core/workflows/ai1_mentions/versions/${vid}/test`);
  const pub = await api('POST', `/api/core/workflows/ai1_mentions/versions/${vid}/publish`);
  t('v2: збережено, перевірено, у тест і опубліковано', saved.status === 200 && val.status === 200 && tst.status === 200 && pub.status === 200, `${saved.status} ${val.status} ${tst.status} ${pub.status} ${pub.body.error ?? ''}`);
  await q(`UPDATE fusion_core.analysis_findings SET status = 'rejected' WHERE project_id = $1`, [BOOK]);
  ({ start, job } = await enqueue());
  const runs2 = await q(`SELECT version FROM fusion_core.workflow_runs WHERE workflow_id = 'ai1_mentions' ORDER BY created_at`);
  t('задача взяла v2', runs2.at(-1)?.version === 2);
  t('температура v2 (0,15) дійшла до моделі', calls().at(-1)?.temperature === 0.15, JSON.stringify(calls().at(-1)));
  t('поріг 0,7: «Марко» (0,6) відсіяно — без зміни коду', job?.status === 'succeeded' && (job.result.filtered ?? 0) >= 1, JSON.stringify(job?.result));

  const puppeteer = (await import('puppeteer-core')).default;
  const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
  if (!CHROME) throw new Error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => { void d.accept(); });
    const click = async (sel: string, wait = 500) => {
      await page.waitForSelector(sel, { timeout: 20000 });
      await page.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
      await sleep(wait);
    };
    const text = (sel: string) => page.$eval(sel, (e) => (e as HTMLElement).innerText).catch(() => '');
    const attr = (sel: string, a: string) => page.$eval(sel, (e, n) => e.getAttribute(n as string), a).catch(() => null);

    console.log('(4) Graph Studio → «Запуски» (§27, №24):');
    await page.goto(`${BASE}/admin/graph-studio/runs`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-gs-runs="ready"] [data-run-row]', { timeout: 40000 }).catch(() => null);
    const rows = await page.$$('[data-run-row]');
    t('журнал: обидва запуски AI-1', rows.length === 2);
    await click(`[data-run-row="${runs1[0].id}"]`, 1200);
    await page.waitForSelector('[data-run-step]', { timeout: 15000 }).catch(() => null);
    t('трасування: 7 вузлів із назвами канви', (await page.$$('[data-run-step]')).length === 7 && /Model \(Модель\)/.test(await text('[data-run-step="llm"]')));
    const totals = await text('[data-run-totals]');
    t('підсумки: токени, вартість, затримка, попередження, помилки', /320 → 90/.test(totals) && /COST/.test(totals) && /LATENCY/.test(totals) && /ERRORS/.test(totals), totals.replace(/\n/g, ' | '));
    t('крок перевірки: valid і впевненість', /valid/.test(await text('[data-run-step="validate"]')));
    await page.screenshot({ path: path.join(DIR, 'runs.png'), fullPage: true });

    console.log('(5) Ручний запуск, PAUSE → RESUME, REPLAY, FORK (§31):');
    fs.writeFileSync(MODE, 'slow');
    await page.select('[data-run-manual-workflow]', 'ai1_mentions');
    await page.type('[data-run-manual-project]', BOOK);
    await page.evaluate(`(() => { const el = document.querySelector('[data-run-manual-input]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ${JSON.stringify(JSON.stringify({ paragraphIds: paras.map((p: any) => p.id) }))}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const before = calls().length;
    await click('[data-run-manual-start]', 1500);
    await page.waitForSelector('[data-run-detail-status="running"]', { timeout: 15000 }).catch(() => null);
    t('ручний запуск — виконується', (await attr('[data-run-detail-status]', 'data-run-detail-status')) === 'running');
    await click('[data-run-action="pause"]', 500);
    await page.waitForSelector('[data-run-detail-status="paused"]', { timeout: 20000 }).catch(() => null);
    const manualId = await attr('[data-run-detail]', 'data-run-detail');
    const pausedRow = (await q(`SELECT status, current_node FROM fusion_core.workflow_runs WHERE id = $1`, [manualId]))[0];
    t('PAUSE під час моделі — зупинка перед перевіркою', pausedRow?.status === 'paused' && pausedRow.current_node === 'validate', JSON.stringify(pausedRow));
    t('контрольна точка в ядрі', (await q(`SELECT 1 FROM fusion_core.workflow_checkpoints WHERE run_id = $1`, [manualId])).length === 1);
    fs.writeFileSync(MODE, 'fast');
    const calledOnce = calls().length - before;
    await click('[data-run-action="resume"]', 1500);
    await page.waitForSelector('[data-run-detail-status="succeeded"]', { timeout: 20000 }).catch(() => null);
    t('RESUME — завершено без нового виклику моделі', (await attr('[data-run-detail-status]', 'data-run-detail-status')) === 'succeeded' && calls().length - before === calledOnce && calledOnce === 1);
    await click('[data-run-action="replay"]', 1500);
    await page.waitForSelector('[data-run-detail-status="succeeded"] , [data-run-detail-status="failed"]', { timeout: 20000 }).catch(() => null);
    await sleep(800);
    const replayRow = (await q(`SELECT mode, parent_run_id, status, version FROM fusion_core.workflow_runs WHERE mode = 'replay' ORDER BY created_at DESC LIMIT 1`))[0];
    t('REPLAY — новий запуск від ручного, та сама версія', replayRow?.mode === 'replay' && replayRow.parent_run_id === manualId && replayRow.version === 2 && replayRow.status === 'succeeded', JSON.stringify(replayRow));
    await click(`[data-run-row="${manualId}"]`, 1200);
    const callsFork = calls().length;
    await page.select('[data-run-fork-step]', '4');
    await click('[data-run-action="fork"]', 1500);
    const forkRow = await waitFor(async () => (await q(`SELECT mode, fork_step, status FROM fusion_core.workflow_runs WHERE mode = 'fork' ORDER BY created_at DESC LIMIT 1`))[0], (r: any) => r?.status === 'succeeded' || r?.status === 'failed', 20000);
    t('FORK після моделі (крок 4) — без виклику моделі', forkRow?.status === 'succeeded' && forkRow.fork_step === 4 && calls().length === callsFork, JSON.stringify(forkRow));
    await page.screenshot({ path: path.join(DIR, 'runs-fork.png'), fullPage: true });

    console.log('(6) Телефон 390 px (§35):');
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${BASE}/admin/graph-studio/runs`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-run-row]', { timeout: 40000 }).catch(() => null);
    await click(`[data-run-row="${manualId}"]`, 1200);
    const overflow = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
    t('«Запуски» на 390 px без горизонтальної прокрутки сторінки (таблиця — своя)', Number(overflow) <= 1, `надлишок ${overflow}px`);
    await page.screenshot({ path: path.join(DIR, 'runs-phone.png'), fullPage: true });
    t('без помилок сторінки', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
} catch (err) {
  t('прогін без збоїв', false, (err as Error).stack ?? String(err));
} finally {
  child.kill();
  await db.end();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
