/**
 * Живий прогін трьох рівнів Jev — Т2.5 В5.
 * Запуск: CORE_TEST_DATABASE_URL=postgres://… npm run live:jev-levels
 *         (потрібен зібраний dist/server.mjs; схема `fusion_core` у цій базі
 *         видаляється — лише тестова база!)
 *
 * Справжній сервер і PostgreSQL; книгу з тегами зберігає автор через
 * `PUT /api/books/:id` (синхронізація з ядром — справжня фонова задача).
 * Jev — справжній `HttpJevAdapter` (ключ `TYPESAFE_API_KEY` задано), але
 * мережі до TypeSafe в хмарі немає: перехоплювач `fetch` у процесі сервера
 * відповідає замість `api.typesafe.ai` (режими: нормально, низька
 * впевненість, 529, мережа впала) і замість Gemini (запасний LLM і чернетка
 * репліки). Інтерфейсу ще немає (його дає Т2.7 «Допит») — лише API:
 * рішення трьох рівнів, кеш у таблиці (переживає перезапуск сервера),
 * «чекає автора» → вибір автора, запасний шлях, зведення, прототип FLC.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';

const DB_URL = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!DB_URL) {
  console.log('Пропущено: потрібна тестова база CORE_TEST_DATABASE_URL (PostgreSQL з pgvector).');
  process.exit(0);
}
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-jev-levels');
const PORT = Number(process.env.JEV_LEVELS_PORT || 34285);
const BASE = `http://localhost:${PORT}`;
const BOOK = 'BK-LIVE-JEV';
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

// Перехоплювач fetch у процесі сервера: TypeSafe (Jev) і Gemini (запасний LLM, чернетка).
const MODE = path.join(DIR, 'jev-mode.txt');
const JEV_LOG = path.join(DIR, 'jev-requests.jsonl');
const LLM_LOG = path.join(DIR, 'llm-requests.jsonl');
const FAKE = path.join(DIR, 'fake-jev.mjs');
fs.writeFileSync(MODE, 'ok');
fs.writeFileSync(FAKE, `
import fs from 'node:fs';
const real = globalThis.fetch;
const bodyOf = async (input, init) => {
  const raw = init?.body ?? (typeof input === 'object' && typeof input?.clone === 'function' ? await input.clone().text() : '');
  return typeof raw === 'string' ? raw : await new Response(raw).text();
};
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/api\\.typesafe\\.ai/.test(url)) {
    const body = JSON.parse(await bodyOf(input, init));
    const mode = fs.readFileSync(${JSON.stringify(MODE)}, 'utf8').trim();
    fs.appendFileSync(${JSON.stringify(JEV_LOG)}, JSON.stringify({ mode, auth: (init?.headers ?? {}).Authorization, model: body.model, questions: Object.keys(body.questions), state: body.state }) + '\\n');
    if (mode === 'network') throw new TypeError('fetch failed');
    if (mode === '529') return new Response(JSON.stringify({ error: { message: 'перевантажено' } }), { status: 529 });
    const conf = mode === 'low' ? 0.1 : 0.9;
    const answers = {};
    for (const [id, qq] of Object.entries(body.questions)) {
      if (qq.type === 'choice') {
        const keys = Object.keys(qq.criteria);
        const pick = keys[keys.length > 1 ? 1 : 0];
        answers[id] = { type: 'choice', choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.7 : 0.3 / Math.max(1, keys.length - 1)])), confidence: conf };
      } else if (qq.type === 'score') answers[id] = { type: 'score', score: 1, probabilities: { '1': 1 }, confidence: conf };
      else answers[id] = { type: 'noul', probability: 0.8, confidence: conf };
    }
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 500, output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (/generativelanguage\\.googleapis\\.com/.test(url) && /generateContent/.test(url)) {
    const raw = await bodyOf(input, init);
    const j = JSON.parse(raw);
    const text = [...(j.systemInstruction?.parts ?? []), ...(j.contents ?? []).flatMap((c) => c.parts ?? [])].map((p) => p.text ?? '').join('\\n');
    const evaluate = /оцінюєш стан персонажа/.test(text);
    fs.appendFileSync(${JSON.stringify(LLM_LOG)}, JSON.stringify({ kind: evaluate ? 'evaluate' : 'draft' }) + '\\n');
    let answer;
    if (evaluate) {
      const answers = {};
      for (const m of text.matchAll(/Питання "([a-z_0-9]+)" \\(вибір\\)[^\\n]*\\nВаріанти: ([^\\n]+)/g)) answers[m[1]] = { choice: m[2].split(',')[0].trim() };
      for (const m of text.matchAll(/Питання "([a-z_0-9]+)" \\(оцінка\\)/g)) answers[m[1]] = { score: 2 };
      answer = { answers };
    } else answer = { reply: 'Я була в лабораторії, перевіряла архів.', intent: 'відвести підозру' };
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30, totalTokenCount: 230 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(input, init);
};
`);
const lines = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const jevRequests = () => lines(JEV_LOG);
const llmRequests = () => lines(LLM_LOG);
const setMode = (m: 'ok' | 'low' | '529' | 'network') => fs.writeFileSync(MODE, m);

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-jev@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });

let child: ChildProcess | null = null;
const log: string[] = [];
const start = async () => {
  child = spawn(process.execPath, ['--import', pathToFileURL(FAKE).href, path.join(ROOT, 'dist/server.mjs')], {
    cwd: ROOT,
    env: { ROLE_ONBOARDING: 'off', ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db`, CORE_DATABASE_URL: DB_URL, GEMINI_API_KEY: 'live-fake-key', TYPESAFE_API_KEY: 'live-typesafe-key', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', APP_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (d) => log.push(String(d)));
  child.stderr!.on('data', (d) => log.push(String(d)));
  let health: any = null;
  for (let i = 0; i < 120 && health?.core !== 'ready'; i++) {
    try { health = await (await fetch(`${BASE}/api/health`)).json(); } catch { /* */ }
    if (health?.core !== 'ready') await sleep(500);
  }
  if (health?.core !== 'ready') { console.error(log.join('').slice(-3000)); child.kill(); process.exit(1); }
};
const stop = async () => {
  if (!child) return;
  const c = child;
  child = null;
  await new Promise<void>((r) => { c.once('exit', () => r()); c.kill(); });
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${BASE}/api/health`); await sleep(250); } catch { break; }
  }
};
process.on('exit', () => { try { child?.kill(); } catch { /* */ } });

await start();
t('ядро піднялось', true);
const [{ v }] = await q('SELECT max(version) AS v FROM fusion_core.core_schema_migrations');
t('схема ядра — не старіша за v15 (журнал рішень героя)', Number(v) >= 15, `v${v}`);

const api = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(`${BASE}${p}`, { method, headers: { Cookie: `nova_session=${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
};
const P = `/api/projects/${BOOK}`;

// Автор зберігає книгу з тегами — ядро синхронізує її фоновою задачею.
const sec = (id: string, order: number, content: string) => {
  const r = reconcileParagraphIds({ sectionId: id, content });
  return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
};
const saved = await api('PUT', `/api/books/${BOOK}`, {
  book: {
    id: BOOK,
    title: 'Архів',
    characters: [{ id: 'c-o', name: 'Олена Ковальчук', role: 'protagonist', biography: 'Інженерка, що чистить нейроархіви.' }, { id: 'c-d', name: 'Детектив' }],
    chapters: [
      { id: 'ch1', title: 'Ніч', order: 0, sections: [sec('s1', 0, '[/character:Олена Ковальчук] [/goal:Дізнатися правду про дипломата @Олена Ковальчук] Олена вночі відкрила нейроархів.\n\n[/character:Детектив] Детектив чекав біля входу.')] },
      { id: 'ch2', title: 'Ранок', order: 1, sections: [sec('s2', 0, '[/character:Олена Ковальчук] [/need:Захистити брата @Олена Ковальчук] [/threshold:Архів відкрито @Олена Ковальчук] Уранці Олена зрозуміла, що назад дороги немає.')] },
    ],
  },
});
t('книгу збережено', saved.status === 200, saved.text.slice(0, 200));
const [olena] = await waitFor(() => q(`SELECT id FROM fusion_core.entities WHERE project_id = $1 AND name = 'Олена Ковальчук' AND type = 'character'`, [BOOK]), (r) => r.length === 1, 60000);
t('героїня є в ядрі (синхронізація)', !!olena);
if (!olena) { console.error(log.join('').slice(-3000)); process.exit(1); }

/*
  Чекаємо, поки фонова синхронізація ВІДПРАЦЮЄ ЦІЛКОМ, а не лише доки в ядрі
  з'явиться героїня. Заради цього очікування й додано: рішення героя
  кешується за відбитком входу (траєкторії, мотиви, емоції), а синхронізація
  ці входи ще дописує — тобто запит «повторно те саме рішення» міг піти ДО
  того, як входи усталились, і чесно не влучити в кеш. Саме так прогін і
  падав 29.09.2026: у різних прогонах — на різному рядку («повторно» в
  одному, «після перезапуску» в іншому), а в базі все було гаразд. Другий
  бік цієї ж гонки описано в `live:core-sync` — там так само чекають на
  `core_jobs`.
*/
const settled = await waitFor(
  () => q(`SELECT count(*)::int AS n FROM fusion_core.core_jobs WHERE project_id = $1 AND status IN ('queued', 'running')`, [BOOK]),
  (r) => Number(r[0]?.n) === 0,
  90000,
);
t('фонова синхронізація відпрацювала до кінця', Number(settled[0]?.n) === 0, `у черзі ${settled[0]?.n}`);
const H = `${P}/characters/${olena.id}`;

console.log('\nТри рівні через справжній HttpJevAdapter (TypeSafe підставний перехоплювачем):');
const s1 = await api('POST', `${H}/decide`, { level: 'strategic' });
const jr = jevRequests();
t('стратегічне — 200, джерело jev, модель jev-1.13.0, дія з траєкторій', s1.status === 200 && s1.body.decision.origin === 'jev' && s1.body.decision.modelVersion === 'jev-1.13.0' && s1.body.decision.selectedAction === 'waver', `${s1.status} ${s1.text.slice(0, 200)}`);
t('запит до TypeSafe: Bearer ключ, модель, питання рівня (траєкторія, конфлікт мотивів)', jr.length === 1 && jr[0].auth === 'Bearer live-typesafe-key' && jr[0].model === 'jev-1.13.0' && jr[0].questions.includes('trajectory') && jr[0].questions.includes('motive_conflict'), JSON.stringify(jr[0]?.questions));
t('повторно — з таблиці, TypeSafe не кличеться', (await api('POST', `${H}/decide`, { level: 'strategic' })).body.reused === true && jevRequests().length === 1);
const tac = await api('POST', `${H}/decide`, { level: 'tactical', sceneId: 'live-s1', situation: 'Детектив питає про нейроархів.', allowedActions: ['answer', 'lie', 'silence', 'deflect'], forbiddenActions: ['lie'], checks: ['вона знає пароль архіву'] });
t('тактичне: сцена + хід (+2 виклики), заборонене не пропонується моделі, перевірка Noul', tac.status === 200 && jevRequests().length === 3 && tac.body.decision.selectedAction !== 'lie' && tac.body.decision.checks.check_1 === 0.8, JSON.stringify(tac.body.decision?.checks));
const chain = await q(`SELECT level, parent_id, id FROM fusion_core.character_decisions WHERE project_id = $1 AND character_id = $2 AND status = 'active' ORDER BY created_at`, [BOOK, olena.id]);
const byLevel = Object.fromEntries(chain.map((r) => [r.level, r]));
t('у базі: ланцюжок parent_id тактичне → сценічне → стратегічне', byLevel.tactical?.parent_id === byLevel.scene?.id && byLevel.scene?.parent_id === byLevel.strategic?.id, JSON.stringify(chain.map((r) => r.level)));

console.log('\nКеш у таблиці переживає перезапуск сервера:');
await stop();
await start();
const again = await api('POST', `${H}/decide`, { level: 'scene', sceneId: 'live-s1', situation: '' });
// Кількості й позначки «reused» виводимо в підказку перевірки: без них
// невдача цього рядка не каже, ЩО саме не зійшлося — кеш не пережив
// перезапуск чи сценічне рішення додало зайвий виклик. 29.09.2026 саме
// на цьому рядку прогін падав, і за логом це неможливо було розрізнити.
const stratAfter = await api('POST', `${H}/decide`, { level: 'strategic' });
const callsAfterRestart = jevRequests().length;
const expectedCalls = 3 + (again.body.reused ? 0 : 1);
t('після перезапуску: стратегічне з таблиці, TypeSafe не кличеться', stratAfter.body.reused === true && callsAfterRestart === expectedCalls,
  `стратегічне reused=${stratAfter.body.reused}, сценічне reused=${again.body.reused}, викликів ${callsAfterRestart} проти очікуваних ${expectedCalls}`);

console.log('\nНизька впевненість → «чекає автора» → вибір автора:');
setMode('low');
const low = await api('POST', `${H}/decide`, { level: 'tactical', sceneId: 'live-s2', situation: 'Нічна перевірка архіву.' });
t('сцена — «чекає автора», зупинка на сцені; варіанти для автора', low.status === 200 && low.body.awaitingAuthor && low.body.blockedAt === 'scene' && low.body.decision.authorOptions.length === 6, low.text.slice(0, 200));
const pending = await api('GET', `${H}/decisions?status=awaiting_author`);
t('журнал героя: одне очікування', pending.status === 200 && pending.body.decisions.length === 1 && pending.body.canDecide === true);
const resolved = await api('POST', `${H}/decisions/${low.body.decision.id}/resolve`, { action: 'hide_secret' });
const [row] = await q(`SELECT status, source, selected_action, resolved_by FROM fusion_core.character_decisions WHERE id = $1`, [low.body.decision.id]);
t('вибір автора — у базі: чинне, джерело author, хто вирішив', resolved.status === 200 && row.status === 'active' && row.source === 'author' && row.selected_action === 'hide_secret' && row.resolved_by === 'user:u-admin', JSON.stringify(row));
t('повторний вибір — 409', (await api('POST', `${H}/decisions/${low.body.decision.id}/resolve`, { action: 'seek_truth' })).status === 409);
setMode('ok');

console.log('\nЗбій Jev → запасний LLM (Gemini підставний):');
setMode('529');
const f1 = await api('POST', `${H}/decide`, { level: 'scene', sceneId: 'live-s3', situation: 'Засідання ради.' });
setMode('network');
const f2 = await api('POST', `${H}/decide`, { level: 'scene', sceneId: 'live-s4', situation: 'Дах вежі.' });
setMode('ok');
t('529 і мережа — рішення від запасного LLM, причини в журналі', f1.body.decision?.origin === 'llm' && /529/.test(f1.body.decision.fallbackReason) && f2.body.decision?.origin === 'llm' && /fetch failed/.test(f2.body.decision.fallbackReason), `${f1.text.slice(0, 160)} | ${f2.text.slice(0, 160)}`);
t('запасний LLM справді питали (дві оцінки через ядро ШІ)', llmRequests().filter((r) => r.kind === 'evaluate').length === 2);

console.log('\nЗведення спостережуваності:');
const sum = await api('GET', `${P}/decisions/summary`);
const S = sum.body;
t('зведення: виклики Jev, запасний шлях 2, класи збою (529, мережа), вирішене автором, токени й вартість',
  sum.status === 200 && S.llmFallback === 2 && S.failures.overloaded === 1 && S.failures.network === 1 && S.resolvedByAuthor === 1 && S.tokens.jev.input === S.jevAnswered * 500 && S.jevUsd > 0 && S.jevCalls === S.jevAnswered + 2,
  JSON.stringify({ calls: S.jevCalls, ans: S.jevAnswered, fb: S.llmFallback, share: S.fallbackShare, f: S.failures, usd: S.jevUsd }));
t('зведення — лише числа (без тексту книги й причин)', !/Олена|архів|перевантажено|fetch failed/.test(sum.text));

console.log('\nПрототип FLC через три рівні:');
const before = jevRequests().length;
const proto = await api('POST', `${P}/flc/prototype`, { entityId: olena.id, question: 'Олено, що ви робили в архіві вночі?', sceneId: 'live-s1' });
t('прототип: режим levels, стратегічне й сцена з кешу, лише тактичне — новий виклик Jev, чернетка від LLM',
  proto.status === 200 && proto.body.mode === 'levels' && proto.body.levels.map((l: any) => `${l.level}:${l.reused}`).join() === 'strategic:true,scene:true,tactical:false' &&
  jevRequests().length === before + 1 && proto.body.draft?.reply === 'Я була в лабораторії, перевіряла архів.' && proto.body.cost.jevInputTokens === 500, proto.text.slice(0, 300));
const [logged] = await q(`SELECT level, parent_id, simulation_id FROM fusion_core.character_decisions WHERE id = $1`, [proto.body.decisionId]);
t('рішення прототипу — у журналі: тактичне, прогін, батько — сцена', logged?.level === 'tactical' && logged.simulation_id === proto.body.simulationId && logged.parent_id === proto.body.levels[1].id);

await stop();
await db.end();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) {
  console.error(log.join('').slice(-2000));
  process.exit(1);
}
