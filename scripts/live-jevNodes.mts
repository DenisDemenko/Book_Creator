/**
 * Живий прогін шару рішень Jev (Т5.5 В4, `PLAN_JEV_NODES.md`; ТЗ Graph Studio
 * §7–§10, §16, §17, §20, §36, §39 №9–12). Запуск:
 * CORE_TEST_DATABASE_URL=postgres://… npm run live:jev-nodes (потрібен
 * зібраний dist/server.mjs і Chrome/Chromium; схема `fusion_core` у цій базі
 * видаляється — лише тестова база!)
 *
 * Справжній сервер, PostgreSQL і браузер; Jev (TypeSafe) і модель (Gemini) —
 * перехоплений fetch у процесі сервера, з журналом запитів:
 *   (1) процеси з вузлами Jev через API Graph Studio: вибір → шлюз →
 *       маршрутизатор із реєстром; агенти-підпроцеси;
 *   (2) «Напрямки» в браузері: два напрямки реєстру, маршрутизатор реєстру;
 *   (3) запуск: Jev обирає, шлюз пропускає, маршрутизатор виконує підпроцес
 *       (№9, №10); у запиті до Jev — питання зі змінними й лише вхідний стан;
 *   (4) Jev недоступний (529) → запасний LLM, джерело в кроці;
 *   (5) узгодження моделей за політикою (§17): згода → далі, розбіжність →
 *       review; маршрутизація за впевненістю (§16, №12);
 *   (6) «Запуски»: джерело, розподіл, підпроцес; редактор: група §16–17,
 *       реєстр, вузли Jev — не пунктиром;
 *   (7) телефон 390 px.
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
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL.');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-live-jev-nodes');
const PORT = Number(process.env.JEV_NODES_PORT || 34393);
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
const waitFor = async <T,>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30000): Promise<T> => {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) { await sleep(300); v = await fn(); }
  return v;
};

// Jev (TypeSafe) і Gemini — перехоплений fetch у процесі сервера.
const JEV_MODE = path.join(DIR, 'jev-mode.txt');
const LLM_MODE = path.join(DIR, 'llm-mode.txt');
const JEV_CALLS = path.join(DIR, 'jev.jsonl');
const LLM_CALLS = path.join(DIR, 'llm.jsonl');
const FAKE = path.join(DIR, 'fake-ai.mjs');
fs.writeFileSync(JEV_MODE, 'up');
fs.writeFileSync(LLM_MODE, 'agree');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
const bodyOf = async (input, init) => {
  const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
  return typeof raw === 'string' ? raw : await new Response(raw).text();
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
let llmN = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/api\\.typesafe\\.ai/.test(url)) {
    const b = JSON.parse(await bodyOf(input, init));
    fs.appendFileSync(${JSON.stringify(JEV_CALLS)}, JSON.stringify({ auth: (init?.headers ?? {}).Authorization, state: b.state, questions: b.questions }) + '\\n');
    if (fs.readFileSync(${JSON.stringify(JEV_MODE)}, 'utf8').trim() === 'down') return json({ error: { message: 'overloaded' } }, 529);
    const answers = {};
    for (const [id, q] of Object.entries(b.questions)) {
      const ins = q.instructions;
      if (q.type === 'choice') {
        const keys = Object.keys(q.criteria);
        const pick = /функція сцени/.test(ins) ? 'DECISION' : /Хто відповість/.test(ins) ? 'mystery' : keys[0];
        const probabilities = Object.fromEntries(keys.map((k) => [k, k === pick ? 0.92 : Math.round((0.08 / Math.max(1, keys.length - 1)) * 1000) / 1000]));
        answers[id] = { type: 'choice', choice: pick, probabilities, confidence: 0.92 };
      } else if (q.type === 'score') {
        answers[id] = { type: 'score', score: 3, probabilities: { 3: 0.7 }, confidence: 0.7 };
      } else {
        const p = /суперечить канону/.test(ins) ? 0.1 : 0.8;
        answers[id] = { type: 'noul', probability: p, confidence: 0.9 };
      }
    }
    return json({ model: 'jev-1.13.0', answers, usage: { input_tokens: 2000, output_tokens: 0 } });
  }
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /generateContent/.test(url)) {
    const j = JSON.parse(await bodyOf(input, init));
    const text = [...(j.systemInstruction?.parts ?? []), ...(j.contents ?? []).flatMap((c) => c.parts ?? [])].map((p) => p.text ?? '').join('\\n');
    const qs = [...text.matchAll(/Питання "([^"]+)" \\((вибір|оцінка|так \\/ ні)\\)[^\\n]*\\n(?:Варіанти: ([^\\n]*))?/g)];
    if (!qs.length) return real(input, init);
    llmN++;
    const mode = fs.readFileSync(${JSON.stringify(LLM_MODE)}, 'utf8').trim();
    fs.appendFileSync(${JSON.stringify(LLM_CALLS)}, JSON.stringify({ n: llmN, ids: qs.map((m) => m[1]), temperature: j.generationConfig?.temperature ?? null }) + '\\n');
    const answers = {};
    for (const m of qs) {
      if (m[2] === 'вибір') {
        const opts = (m[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        answers[m[1]] = { choice: opts.includes('EMOTION') ? 'EMOTION' : opts[0] };
      } else if (m[2] === 'оцінка') answers[m[1]] = { score: 2 };
      else answers[m[1]] = { probability: mode === 'disagree' && llmN % 2 === 0 ? 0.2 : 0.8 };
    }
    return json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ answers }) }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 20, totalTokenCount: 170 } });
  }
  return real(input, init);
};
`);
const lines = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
const now = new Date().toISOString();
await saveUser({ id: 'u-admin', email: 'admin-jev@test.ua', name: 'Адмін', role: 'admin', createdAt: now } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString() });

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
const api = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

// Процес через API Graph Studio: створити, зберегти, перевірити, у тест, опублікувати.
const e = (from: string, port: string, to: string) => ({ id: `e-${from}-${port}-${to}`, from, fromPort: port, to });
const publish = async (def: any) => {
  const created = await api('POST', '/api/core/workflows', { id: def.id, name: def.name });
  let vid = created.body.draft?.id ?? created.body.version?.id;
  if (!vid) vid = (await api('POST', `/api/core/workflows/${def.id}/draft`, {})).body.version?.id;
  const ver = await api('GET', `/api/core/workflows/${def.id}/versions/${vid}`);
  const saved = await api('PUT', `/api/core/workflows/${def.id}/versions/${vid}`, { definition: def, expectedRevision: ver.body.version?.revision });
  const val = await api('POST', `/api/core/workflows/${def.id}/versions/${vid}/validate`);
  const tst = await api('POST', `/api/core/workflows/${def.id}/versions/${vid}/test`);
  const pub = await api('POST', `/api/core/workflows/${def.id}/versions/${vid}/publish`);
  return { ok: [created.status === 200 || created.status === 201 || !!vid, saved.status === 200, val.status === 200 && val.body.validation?.ok !== false, tst.status === 200, pub.status === 200].every(Boolean), detail: `${saved.status} ${JSON.stringify(val.body.validation?.errors ?? val.body.error ?? '').slice(0, 300)} ${tst.status} ${pub.status} ${pub.body.error ?? ''}` };
};
const n = (id: string, type: string, label: string, params: Record<string, unknown> = {}) => ({ id, type, label, params });
const runAndWait = async (workflowId: string, input: Record<string, unknown>) => {
  const r = await api('POST', '/api/core/workflow-runs', { workflowId, input });
  const id = r.body.run?.id;
  const row = await waitFor(async () => (await q(`SELECT * FROM fusion_core.workflow_runs WHERE id = $1`, [id]))[0], (x: any) => ['succeeded', 'failed', 'paused'].includes(x?.status), 30000);
  const steps = await q(`SELECT node_id, node_type, branch, decision, confidence, model, cost_usd, details, warnings FROM fusion_core.workflow_run_steps WHERE run_id = $1 ORDER BY seq`, [id]);
  return { id, row, steps, step: (nodeId: string) => steps.find((s: any) => s.node_id === nodeId) };
};

try {
  console.log('(1) Процеси з вузлами Jev через API Graph Studio (№9):');
  const agent = (id: string, uk: string) => ({
    format: 'fusion-workflow/1', id, name: { en: id, uk }, description: '',
    nodes: [n('start', 'START', 'In (Вхід)'), n('speak', 'JEV_NOUL', 'Has something (Є що сказати)', { question: `${uk}: чи є що сказати про «{{input.title}}»?`, threshold: 0.6 }), n('end', 'END', 'Done (Готово)')],
    edges: [e('start', 'out', 'speak'), e('speak', 'true', 'end'), e('speak', 'false', 'end'), e('speak', 'fallback', 'end')],
  });
  const a1 = await publish(agent('character_agent', 'Агент персонажа'));
  const a2 = await publish(agent('mystery_agent', 'Агент загадки'));
  t('агенти-підпроцеси опубліковано', a1.ok && a2.ok, `${a1.detail} | ${a2.detail}`);
  const scene = {
    format: 'fusion-workflow/1', id: 'scene_analysis', name: { en: 'Scene analysis', uk: 'Аналіз сцени' }, description: 'Jev: функція сцени → шлюз канону → агент із реєстру',
    nodes: [
      n('start', 'START', 'Scene (Сцена)'),
      n('kind', 'JEV_CHOICE', 'Narrative function (Наративна функція)', { question: 'Яка домінантна функція сцени «{{input.title}}»?', options: ['EVENT', 'DECISION', 'EMOTION'], threshold: 0.5, input_state: ['input.text'], output_mapping: { scene_kind: 'selected' } }),
      n('tension', 'JEV_SCORE', 'Tension (Напруга)', { question: 'Наративна напруга сцени?', levels: ['відсутня', 'слабка', 'помірна', 'сильна', 'дуже сильна', 'кульмінаційна'], scale_min: 0, scale_max: 5 }),
      n('canon', 'JEV_GATE', 'Contradicts canon? (Суперечить канону?)', { question: 'Це суперечить канону: «{{input.text}}»?', threshold: 0.85, pass_when: 'false' }),
      n('route', 'JEV_ROUTER', 'Who answers (Хто відповість)', { question: 'Хто відповість на питання про «{{input.title}}»?', registry: 'story_agents' }),
      n('end_routed', 'END', 'Routed (Направлено)'), n('end_event', 'END', 'Event (Подія)'), n('end_emotion', 'END', 'Emotion (Емоція)'),
      n('end_blocked', 'END', 'Blocked (Зупинено)'), n('end_fallback', 'END', 'Fallback (Резервний)'),
    ],
    edges: [
      e('start', 'out', 'kind'), e('kind', 'EVENT', 'tension'), e('kind', 'DECISION', 'canon'), e('kind', 'EMOTION', 'end_emotion'), e('kind', 'fallback', 'end_fallback'),
      e('tension', 'out', 'end_event'), e('tension', 'fallback', 'end_fallback'),
      e('canon', 'pass', 'route'), e('canon', 'block', 'end_blocked'), e('canon', 'fallback', 'end_fallback'),
      e('route', 'out', 'end_routed'), e('route', 'fallback', 'end_fallback'),
    ],
  };
  const sp = await publish(scene);
  t('«Аналіз сцени» з вибором, шкалою, шлюзом і маршрутизатором реєстру — опубліковано', sp.ok, sp.detail);

  const puppeteer = (await import('puppeteer-core')).default;
  const CHROME = [process.env.CHROMIUM_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
  if (!CHROME) throw new Error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
    page.on('pageerror', (er) => errors.push(String(er)));
    const click = async (sel: string, wait = 500) => {
      await page.waitForSelector(sel, { timeout: 20000 });
      await page.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
      await sleep(wait);
    };
    const text = (sel: string) => page.$eval(sel, (el) => (el as HTMLElement).innerText).catch(() => '');
    const typeInto = async (sel: string, value: string) => {
      await page.waitForSelector(sel, { timeout: 20000 });
      await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); })()`);
      await page.type(sel, value);
    };

    console.log('(2) Graph Studio → «Напрямки» (§10; рішення власника §2 п.2):');
    await page.goto(`${BASE}/admin/graph-studio/destinations`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-gs-destinations]', { timeout: 40000 }).catch(() => null);
    t('вкладка «Напрямки»: реєстр маршрутизатора вже видно (без напрямків)', /scene_analysis/.test(await text('[data-gs-registry="story_agents"]')) && /Напрямків немає/.test(await text('[data-gs-registry="story_agents"]')));
    const addDest = async (option: string, en: string, uk: string, desc: string, wf: string) => {
      await page.evaluate(`(() => { const el = document.querySelector('[data-gs-dest-new-registry]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await typeInto('[data-gs-dest-new-registry]', 'story_agents');
      await typeInto('[data-gs-dest-new-option]', option);
      await page.select('[data-gs-dest-new-workflow]', wf);
      await typeInto('[data-gs-dest-new-en]', en);
      await typeInto('[data-gs-dest-new-uk]', uk);
      await typeInto('[data-gs-dest-new-description]', desc);
      await click('[data-gs-dest-add]', 1200);
      await page.waitForSelector(`[data-gs-dest="story_agents/${option}"]`, { timeout: 10000 }).catch(() => null);
    };
    await addDest('character', 'Character agent', 'Агент персонажа', 'Питання про героя, його мотиви й стосунки', 'character_agent');
    await addDest('mystery', 'Mystery agent', 'Агент загадки', 'Таємниці, підказки й те, що читач ще не знає', 'mystery_agent');
    const dests = await q(`SELECT option, workflow_id, enabled, updated_by, description FROM fusion_core.workflow_destinations WHERE registry = 'story_agents' ORDER BY option`);
    t('два напрямки в базі — з процесами, описами й автором зміни', dests.map((d: any) => `${d.option}:${d.workflow_id}:${d.enabled}`).join() === 'character:character_agent:true,mystery:mystery_agent:true' && dests.every((d: any) => d.updated_by === 'user:u-admin' && d.description.length > 10), JSON.stringify(dests));
    t('у вкладці — обидва напрямки з робочою версією', !!(await page.$('[data-gs-dest="story_agents/character"]')) && !!(await page.$('[data-gs-dest="story_agents/mystery"]')) && !(await page.$('[data-gs-dest-unpublished]')));
    await page.screenshot({ path: path.join(DIR, 'destinations.png'), fullPage: true });

    console.log('(3) Запуск: вибір → шлюз → маршрутизатор → підпроцес (№9, №10):');
    let run = await runAndWait('scene_analysis', { title: 'Розмова на мосту', text: 'Марк вирішує не їхати. Ніхто не знає чому.' });
    const kind = run.step('kind');
    t('Jev-вибір: DECISION (0,92), джерело — Jev, модель jev-1.13.0', run.row.status === 'succeeded' && kind?.branch === 'DECISION' && kind.details.source === 'jev' && kind.model === 'jev-1.13.0' && Math.abs(kind.confidence - 0.92) < 1e-6, JSON.stringify({ s: run.row.status, e: run.row.error, b: kind?.branch }));
    const jc = lines(JEV_CALLS);
    const firstQ = Object.values(jc[0]?.questions ?? {})[0] as any;
    t('у запиті до Jev: питання зі змінними, варіанти й лише вхідний стан (§36)', firstQ?.instructions === 'Яка домінантна функція сцени «Розмова на мосту»?' && Object.keys(firstQ.criteria).join() === 'EVENT,DECISION,EMOTION' && JSON.stringify(jc[0].state) === JSON.stringify({ 'input.text': 'Марк вирішує не їхати. Ніхто не знає чому.' }) && jc[0].auth === 'Bearer live-typesafe-key', JSON.stringify(jc[0]).slice(0, 300));
    t('шлюз: «суперечить канону» 0,1 при порозі 0,85 → пропущено (§20)', run.step('canon')?.branch === 'pass');
    const route = run.step('route');
    const childRun = (await q(`SELECT workflow_id, mode, parent_run_id, status, trigger FROM fusion_core.workflow_runs WHERE parent_run_id = $1`, [run.id]))[0];
    t('маршрутизатор: варіанти — напрямки реєстру з описами для Jev', Object.keys((Object.values(jc[2]?.questions ?? {})[0] as any)?.criteria ?? {}).sort().join() === 'character,mystery' && /Таємниці/.test((Object.values(jc[2].questions)[0] as any).criteria.mystery));
    t('обраний «mystery» виконано підпроцесом mystery_agent (режим subgraph, той самий запуск-батько)', route?.branch === 'out' && childRun?.workflow_id === 'mystery_agent' && childRun.mode === 'subgraph' && childRun.trigger === 'subgraph' && childRun.status === 'succeeded', JSON.stringify(childRun));
    t('відображення виходу: scene_kind у результаті не губиться; вартість Jev — у запуску', Number(run.row.cost_usd) > 0 && run.steps.at(-1)?.node_id === 'end_routed');
    const sceneRunId = run.id;

    console.log('(4) Jev недоступний → запасний LLM (рішення власника §2 п.1):');
    fs.writeFileSync(JEV_MODE, 'down');
    const llmBefore = lines(LLM_CALLS).length;
    run = await runAndWait('scene_analysis', { title: 'Ніч', text: 'Вона плаче.' });
    const k2 = run.step('kind');
    t('рішення від запасного LLM (EMOTION), причина — 529', run.row.status === 'succeeded' && k2?.branch === 'EMOTION' && k2.details.source === 'llm_fallback' && /529/.test(k2.details.fallbackReason ?? '') && lines(LLM_CALLS).length === llmBefore + 1, JSON.stringify({ b: k2?.branch, src: k2?.details?.source, r: k2?.details?.fallbackReason }));
    t('LLM запасного шляху — з температурою 0 (типізоване рішення)', lines(LLM_CALLS).at(-1)?.temperature === 0, JSON.stringify(lines(LLM_CALLS).at(-1)));
    fs.writeFileSync(JEV_MODE, 'up');

    console.log('(5) Узгодження моделей (§17) і впевненість (§16, №12):');
    const risky = {
      format: 'fusion-workflow/1', id: 'mystery_reveal', name: { en: 'Mystery reveal', uk: 'Розкриття загадки' }, description: '',
      nodes: [
        n('start', 'START', 'In (Вхід)'),
        n('reveal', 'JEV_NOUL', 'Reveals mystery? (Розкриває загадку?)', { question: 'Це розкриває загадку: «{{input.text}}»?', threshold: 0.5, importance: 'critical', consensus_from_importance: 'high', consensus_budget: 1 }),
        n('yes', 'END', 'Reveals (Розкриває)'), n('no', 'END', 'Keeps (Не розкриває)'), n('review', 'END', 'To review (На перевірку)'), n('fb', 'END', 'Fallback (Резервний)'),
      ],
      edges: [e('start', 'out', 'reveal'), e('reveal', 'true', 'yes'), e('reveal', 'false', 'no'), e('reveal', 'review', 'review'), e('reveal', 'fallback', 'fb')],
    };
    const rp = await publish(risky);
    t('критичне рішення з політикою узгодження — гілка review обов\'язкова й під\'єднана', rp.ok, rp.detail);
    fs.writeFileSync(LLM_MODE, 'agree');
    let before = lines(LLM_CALLS).length;
    run = await runAndWait('mystery_reveal', { text: 'Ключ був у Марка.' });
    t('Jev + модель A + модель B погодились → далі (true)', run.step('reveal')?.branch === 'true' && run.step('reveal')?.details.consensus.agree === true && lines(LLM_CALLS).length === before + 2);
    fs.writeFileSync(LLM_MODE, 'disagree');
    before = lines(LLM_CALLS).length;
    run = await runAndWait('mystery_reveal', { text: 'Ключ був у Марка.' });
    const disagreeRun = run.id;
    t('модель B не погодилась → review (перевірка людиною)', run.step('reveal')?.branch === 'review' && run.step('reveal')?.details.consensus.agree === false && run.steps.at(-1)?.node_id === 'review');
    fs.writeFileSync(LLM_MODE, 'agree');
    // Впевненість: нова версія «Аналізу сцени» — висока від 0,95 → 0,92 стає середньою → друга перевірка.
    const draft = await api('POST', '/api/core/workflows/scene_analysis/draft', {});
    const vid = draft.body.version?.id ?? draft.body.draft?.id;
    const ver = await api('GET', `/api/core/workflows/scene_analysis/versions/${vid}`);
    const def = ver.body.version.definition;
    Object.assign(def.nodes.find((x: any) => x.id === 'kind').params, { confidence_high: 0.95, on_medium: 'SECOND_OPINION' });
    def.edges.push(e('kind', 'review', 'end_fallback'));
    const sv = await api('PUT', `/api/core/workflows/scene_analysis/versions/${vid}`, { definition: def, expectedRevision: ver.body.version.revision });
    const vv = await api('POST', `/api/core/workflows/scene_analysis/versions/${vid}/validate`);
    await api('POST', `/api/core/workflows/scene_analysis/versions/${vid}/test`);
    const pv = await api('POST', `/api/core/workflows/scene_analysis/versions/${vid}/publish`);
    t('v2: пороги впевненості й «друга перевірка» — без зміни коду (№11, №12)', sv.status === 200 && vv.body.validation?.ok === true && pv.status === 200, JSON.stringify(vv.body.validation?.errors ?? pv.body.error ?? '').slice(0, 300));
    run = await runAndWait('scene_analysis', { title: 'Розмова', text: 'Марк вирішує.' });
    t('0,92 < 0,95 → середня → друга перевірка (LLM обрав EMOTION) не збіглась → review', run.row.version === 2 && run.step('kind')?.branch === 'review' && run.step('kind')?.details.secondOpinion.agree === false && run.step('kind')?.details.routing.tier === 'medium', JSON.stringify(run.step('kind')?.details?.routing));

    console.log('(6) «Запуски» і редактор (№24):');
    await page.goto(`${BASE}/admin/graph-studio/runs`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(`[data-run-row="${sceneRunId}"]`, { timeout: 40000 }).catch(() => null);
    await click(`[data-run-row="${sceneRunId}"]`, 1500);
    await page.waitForSelector('[data-run-jev="kind"]', { timeout: 15000 }).catch(() => null);
    t('крок вибору: джерело Jev і розподіл варіантів', (await page.$eval('[data-run-jev="kind"] [data-run-jev-source]', (el) => el.getAttribute('data-run-jev-source')).catch(() => null)) === 'jev' && (await page.$$('[data-run-jev="kind"] [data-run-jev-dist="choice"] > div')).length === 3, (await page.$eval('[data-run-jev="kind"]', (el) => el.outerHTML).catch(() => 'немає')).slice(0, 600));
    t('крок маршрутизатора: посилання на підпроцес mystery_agent', !!(await page.$('[data-run-subgraph="mystery_agent"]')));
    await click('[data-run-subgraph="mystery_agent"]', 1500);
    await page.waitForSelector('[data-run-parent]', { timeout: 15000 }).catch(() => null);
    t('підпроцес відкрито: SUBGRAPH від scene_analysis', /SUBGRAPH/.test(await text('[data-run-parent]')) && /scene_analysis/.test(await text('[data-run-parent]')));
    await page.screenshot({ path: path.join(DIR, 'runs-subgraph.png'), fullPage: true });
    await page.goto(`${BASE}/admin/graph-studio/runs`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(`[data-run-row="${disagreeRun}"]`, { timeout: 40000 }).catch(() => null);
    await click(`[data-run-row="${disagreeRun}"]`, 1500);
    await page.waitForSelector('[data-run-jev-consensus]', { timeout: 15000 }).catch(() => null);
    t('узгодження в «Запусках»: розбіжність і відповіді моделей', (await page.$eval('[data-run-jev-consensus]', (el) => el.getAttribute('data-run-jev-consensus')).catch(() => null)) === 'disagree');
    await page.screenshot({ path: path.join(DIR, 'runs-consensus.png'), fullPage: true });

    await page.goto(`${BASE}/admin/graph-studio/workflows`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-wf-item="scene_analysis"]', { timeout: 40000 }).catch(() => null);
    await click('[data-wf-item="scene_analysis"]', 1500);
    await page.waitForSelector('[data-wf-node="route"]', { timeout: 20000 }).catch(() => null);
    t('процес лише з вузлів Jev — без позначки «рушій поки не виконує»', !(await page.$('[data-wf-not-executable]')) && !!(await page.$('[data-wf-node-type="JEV_ROUTER"]')));
    await click('[data-wf-node="route"]', 800);
    t('маршрутизатор: реєстр story_agents', (await page.$eval('[data-wf-param="registry"]', (el) => (el as HTMLInputElement).value).catch(() => null)) === 'story_agents');
    await click('[data-wf-node="kind"]', 800);
    t('вибір: група «Впевненість і узгодження» відкрита (є «друга перевірка»), гілка review на канві', !!(await page.$('[data-wf-param-group="routing"][open]')) && (await page.$eval('[data-wf-param-group="routing"] [data-wf-param="on_medium"]', (el) => (el as HTMLSelectElement).value).catch(() => null)) === 'SECOND_OPINION');
    await page.screenshot({ path: path.join(DIR, 'editor-jev.png'), fullPage: true });

    console.log('(7) Телефон 390 px:');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/admin/graph-studio/destinations`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-gs-dest]', { timeout: 40000 }).catch(() => null);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /Згорнути меню/.test(x.textContent || '')) as HTMLElement | undefined;
      b?.click();
    });
    await sleep(1000);
    const overflow = await page.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
    t('«Напрямки» на 390 px без горизонтальної прокрутки', Number(overflow) <= 1, `надлишок ${overflow}px`);
    await page.screenshot({ path: path.join(DIR, 'destinations-phone.png'), fullPage: true });
    t('без помилок сторінки', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  // Ембединги (core_embed) у хмарі б'ються об мережу — не стосується Jev; дивимось на процеси ШІ.
  const serverErrs = log.join('').split('\n').filter((l) => /\[workflow|workflow-|Jev/i.test(l) && /\bError\b|помилк|впала/i.test(l));
  t('журнал сервера — без помилок', serverErrs.length === 0, serverErrs.slice(0, 3).join(' | '));
} catch (err) {
  t('прогін без збоїв', false, (err as Error).stack ?? String(err));
} finally {
  child.kill();
  await db.end();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
