/**
 * Тести вибору моделі й балів для проходів 2–3 чернеток за фото (контракт 1.4.0, журнал #530).
 * Запуск: npm run test:photo-drafts-models
 *
 * Справжній Express і справжні маршрути; текстова модель, перевірка ключів і гаманець — підставні:
 *  1. GET …/ai-options: перелік моделей, бали за прохід, баланс, відповідність схемі.
 *  2. Вибір моделі в structure/generate: недоступна, невідома, без ціни, типова.
 *  3. Бали: резерв до запуску, списання за фактом, повернення при збої й при непридатній відповіді.
 *  4. Не вистачає балів — 402 і роботу не запущено; грошовий ліміт тексту не чіпається, коли бали діють.
 *  5. Без гейта (адмін) — як раніше: грошовий ліміт.
 */
const DIR = '/tmp/nova-photo-drafts-models-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import Ajv from 'ajv';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const store = await import('../server/external/photoDraftStore');
const xroutes = await import('../server/external/externalApiRoutes');
const xstore = await import('../server/external/externalApiStore');
const routes = await import('../server/external/photoDraftRoutes');
const sinks = await import('../server/external/photoDraftSinks');
const est = await import('../server/external/photoDraftEstimate');
void store;
void xstore;

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/photo-drafts-api/schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(schema, 'pd');
const conforms = (def: string, data: unknown) => {
  const fn = ajv.getSchema(`pd#/definitions/${def}`)!;
  return fn(data) ? '' : ajv.errorsText(fn.errors);
};

// ---------------------------------------------------------------------------
console.log('\nОцінка проходів (чиста частина)');
{
  const small = est.estimateStructurePass('s'.repeat(250), 'p'.repeat(2500), 4, 8192);
  t('вхід = символи / 2,5 (кирилиця)', small.inputTokens === 1100, String(small.inputTokens));
  t('вихід проходу 2 росте з кадрами', est.estimateStructurePass('', '', 10, 8192).outputTokens > est.estimateStructurePass('', '', 2, 8192).outputTokens);
  t('вихід не вище стелі запиту', est.estimateStructurePass('', '', 500, 8192).outputTokens === 8192);
  t('прохід 3 рахує навіть порожній модуль як один урок', est.estimateGeneratePass('', '', 0, 8192).outputTokens === est.estimateGeneratePass('', '', 1, 8192).outputTokens);
  const usd = est.passUsd({ inputPerMillionUsd: 1, outputPerMillionUsd: 4 }, { inputTokens: 1000, outputTokens: 500, maxOutputTokens: 8192 });
  t('собівартість за тарифом', !!usd && Math.abs(usd.expectedUsd - (0.001 + 0.002)) < 1e-9, JSON.stringify(usd));
  t('резерв не нижчий за очікуване й має запас', !!usd && usd.maxUsd > usd.expectedUsd);
  t('ціна не звірена — null, а не безкоштовно', est.passUsd({ inputPerMillionUsd: null, outputPerMillionUsd: 4 }, { inputTokens: 1, outputTokens: 1, maxOutputTokens: 10 }) === null);
}

// ---------------------------------------------------------------------------
const storeMod = await import('../server/store');
const nowIso = new Date().toISOString();
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Викладачка', role: 'writer', createdAt: nowIso } as any);
await storeMod.saveUser({ id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', createdAt: nowIso } as any);

const users: Record<string, any> = {
  'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Викладачка', role: 'writer', isGuest: false },
  'u-b': { id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', isGuest: false },
};
const GUEST = { id: null, email: 'guest@local', name: 'Гість', role: 'guest', isGuest: true };

const tasks: Array<() => Promise<void>> = [];
const flush = async () => {
  while (tasks.length) await tasks.shift()!();
};

const ai = { mode: 'ok' as 'ok' | 'fail' | 'junk', calls: [] as any[], budget: true, uahChecks: 0 };
const wallet = { available: 500, reserved: 0, ledger: [] as string[], gated: true };
const fakeWrite = async (p: any) => {
  ai.calls.push({ draftId: p.draftId, modelId: p.modelId, creditBilled: p.creditBilled, label: p.label, prompt: p.prompt });
  if (ai.mode === 'fail') throw new Error('Модель перевантажена');
  if (ai.mode === 'junk') return { text: 'вибачте, не можу', modelId: p.modelId || 'x', costUsd: 0.002 };
  if (/Кадри \(за порядком зйомки\)/.test(p.prompt)) {
    const ids = [...p.prompt.matchAll(/Кадр (ph_\w+)/g)].map((m: any) => m[1] as string);
    return {
      text: JSON.stringify({ title: 'Назва', modules: [{ title: 'Підготовка', summary: 'x', lessons: [{ title: 'Розмітка', goal: 'g', photoIds: ids, topics: [] }] }], assumptions: [] }),
      modelId: p.modelId || 'm-ok',
      costUsd: 0.0014,
    };
  }
  const lessonIds = [...p.prompt.matchAll(/=== Урок (l-\d+): <<<([^>]*)>>>/g)].map((m: any) => ({ id: m[1] as string, title: m[2] as string }));
  return {
    text: JSON.stringify({ lessons: lessonIds.map((l) => ({ lessonId: l.id, goal: 'мета', body: `## ${l.title}\n\nТекст.`, topics: [] })), assumptions: [] }),
    modelId: p.modelId || 'm-ok',
    costUsd: 0.0021,
  };
};

const MODELS = [
  { modelId: 'm-ok', label: 'Модель ОК', provider: 'Тест', status: 'ok', usable: true, note: null },
  { modelId: 'm-busy', label: 'Модель зайнята', provider: 'Тест', status: 'busy', usable: true, note: 'Модель зараз перевантажена.' },
  { modelId: 'm-noprice', label: 'Без ціни', provider: 'Тест', status: 'ok', usable: true, note: null },
  { modelId: 'm-nokey', label: 'Без ключа', provider: 'Тест', status: 'no_key', usable: false, note: 'Ключ цього провайдера не введено в адмінці Studio.' },
];
const creditsOf = (usd: number) => Math.ceil(usd / 0.0007);
const fakeModels = {
  list: async () => ({ models: MODELS as any, defaultModelId: 'm-ok', checkedAt: '2026-11-09T16:00:00.000Z' }),
  quote: (modelId: string, e: { inputTokens: number; outputTokens: number; maxOutputTokens: number }) => {
    if (modelId === 'm-noprice') return null;
    const k = modelId === 'm-busy' ? 2 : 1;
    const expectedUsd = ((e.inputTokens * 1 + e.outputTokens * 4) / 1_000_000) * k;
    const maxUsd = expectedUsd * 1.5;
    return { expectedUsd, maxUsd, expectedCredits: creditsOf(expectedUsd), maxCredits: creditsOf(maxUsd) };
  },
  balance: async () => (wallet.gated ? { unlimited: false, balance: wallet.available } : { unlimited: true, balance: null }),
  begin: async (_req: any, quote: { maxCredits: number }) => {
    if (!wallet.gated) return null;
    if (wallet.available < quote.maxCredits) {
      throw Object.assign(new Error(`Недостатньо AI-балів: ця генерація коштує ${quote.maxCredits}, на балансі ${wallet.available}.`), { kind: 'credits' });
    }
    wallet.available -= quote.maxCredits;
    wallet.reserved += quote.maxCredits;
    wallet.ledger.push(`reserve:${quote.maxCredits}`);
    return {
      reservedCredits: quote.maxCredits,
      settleUsd: (usd: number) => {
        const charged = usd > 0 ? Math.min(quote.maxCredits, creditsOf(usd)) : quote.maxCredits;
        wallet.reserved -= quote.maxCredits;
        wallet.available += quote.maxCredits - charged;
        wallet.ledger.push(`settle:${charged}`);
      },
      release: (reason: string) => {
        wallet.reserved -= quote.maxCredits;
        wallet.available += quote.maxCredits;
        wallet.ledger.push(`release:${reason}`);
      },
    };
  },
};

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : GUEST;
  next();
});
xroutes.registerExternalApiRoutes(app, { recognize: async () => ({ text: 'x', modelId: 'm' }), schedule: () => undefined });
routes.registerPhotoDraftRoutes(app, {
  describe: async () => ({ description: 'Заготовка з вишні на верстаку.', tags: ['вишня'], modelId: 'test-vision' }),
  recognize: async () => ({ text: 'Текст сторінки.', modelId: 'test-vision' }),
  checkAiBudget: async () => {
    ai.uahChecks++;
    return ai.budget ? { allowed: true } : { allowed: false, reasonUk: 'Вичерпано ліміт ШІ' };
  },
  writeText: fakeWrite,
  passModels: fakeModels,
  sinks: { createCourse: sinks.createCourseDraft, createExpress: sinks.createExpressInstruction, createInboxScans: sinks.createInboxScans },
  schedule: (task) => {
    tasks.push(task);
  },
});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

async function call(method: string, p: string, opts: { session?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + p, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data: data as any, type };
}
const errs: string[] = [];
const isError = (r: { status: number; data: any }, status: number, kind: string) => {
  const bad = conforms('Error', r.data);
  if (bad) errs.push(`${kind}: ${bad}`);
  return r.status === status && r.data?.kind === kind && !bad;
};
const PD = '/api/external/v1/photo-drafts';
const code = await call('POST', '/api/external-tokens/pairing-code', { session: 'u-a', body: { scope: 'photo-drafts' } });
const grab: string = (await call('POST', '/api/external/v1/pair', { body: { code: code.data.code } })).data.token;
const tokenB: string = (await call('POST', '/api/external-tokens', { session: 'u-b', body: { name: 'B' } })).data.token;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
const get = async (id: string) => (await call('GET', `${PD}/${id}`, { token: grab })).data.draft;

let seq = 0;
async function makeDraft(kind: 'course' | 'instruction' | 'manuscript', n: number) {
  const created = await call('POST', PD, { token: grab, body: { kind, title: 'Ложка', craft: 'різьблення', audience: 'початківці', level: 'beginner' } });
  if (!created.data.draft) console.log('CREATE FAILED', created.status, JSON.stringify(created.data), 'token', grab ? 'ok' : 'none');
  const id: string = created.data.draft.draftId;
  for (let i = 0; i < n; i++) await call('POST', `${PD}/${id}/photos`, { token: grab, body: { clientId: `pm-${++seq}`, image } });
  await flush();
  return id;
}
const resetWallet = (available = 500) => {
  wallet.available = available;
  wallet.reserved = 0;
  wallet.ledger = [];
  wallet.gated = true;
};

// ---------------------------------------------------------------------------
console.log('\nGET …/ai-options');
const d1 = await makeDraft('course', 4);
{
  const r = await call('GET', `${PD}/${d1}/ai-options`, { token: grab });
  const body = r.data;
  t('200 і відповідь за схемою', r.status === 200 && conforms('AiOptionsResponse', body) === '', conforms('AiOptionsResponse', body));
  t('прохід за замовчуванням — structure, модуля немає', body.pass === 'structure' && body.moduleId === null);
  t('типова модель — з переліку й придатна', body.defaultModelId === 'm-ok' && body.models[0].modelId === 'm-ok');
  const byId = Object.fromEntries(body.models.map((m: any) => [m.modelId, m]));
  t('придатна має бали очікувано й максимум', byId['m-ok'].credits?.expected > 0 && byId['m-ok'].credits.max >= byId['m-ok'].credits.expected, JSON.stringify(byId['m-ok'].credits));
  t('дорожча модель коштує більше балів', byId['m-busy'].credits.expected > byId['m-ok'].credits.expected);
  t('без ключа — не придатна, без балів, із поясненням', byId['m-nokey'].usable === false && byId['m-nokey'].credits === null && /ключ/i.test(byId['m-nokey'].note));
  t('придатна, але без ціни — стає price_unknown і не обирається', byId['m-noprice'].usable === false && byId['m-noprice'].status === 'price_unknown' && byId['m-noprice'].credits === null);
  t('баланс і ознака обліку', body.balance === 500 && body.unlimited === false);
  t('checkedAt віддано як є', body.checkedAt === '2026-11-09T16:00:00.000Z');
  t('більше кадрів — більше балів', (await (async () => {
    const big = await makeDraft('course', 12);
    const rb = await call('GET', `${PD}/${big}/ai-options`, { token: grab });
    return rb.data.models.find((m: any) => m.modelId === 'm-ok').credits.expected > byId['m-ok'].credits.expected;
  })()));
  wallet.gated = false;
  const adm = await call('GET', `${PD}/${d1}/ai-options`, { token: grab });
  t('без гейта — unlimited і balance null', adm.data.unlimited === true && adm.data.balance === null && conforms('AiOptionsResponse', adm.data) === '');
  resetWallet();
}
t('pass=bogus — 400 bad_input', isError(await call('GET', `${PD}/${d1}/ai-options?pass=bogus`, { token: grab }), 400, 'bad_input'));
t('pass=generate без модуля — 404 module_not_found', isError(await call('GET', `${PD}/${d1}/ai-options?pass=generate&moduleId=m-9`, { token: grab }), 404, 'module_not_found'));
t('без токена — 401', (await call('GET', `${PD}/${d1}/ai-options`)).status === 401);
t('чужа чернетка — 404', isError(await call('GET', `${PD}/${d1}/ai-options`, { token: tokenB }), 404, 'draft_not_found'));
{
  const ms = await makeDraft('manuscript', 1);
  t('рукопис — 409 wrong_status', isError(await call('GET', `${PD}/${ms}/ai-options`, { token: grab }), 409, 'wrong_status'));
}

// ---------------------------------------------------------------------------
console.log('\nPOST …/structure з вибором моделі');
const d2 = await makeDraft('course', 4);
resetWallet();
ai.calls = [];
ai.uahChecks = 0;
t('модель не рядок — 400', isError(await call('POST', `${PD}/${d2}/structure`, { token: grab, body: { modelId: 42 } }), 400, 'bad_input'));
t('невідома модель — 400', isError(await call('POST', `${PD}/${d2}/structure`, { token: grab, body: { modelId: 'nope' } }), 400, 'bad_input'));
const noKey = await call('POST', `${PD}/${d2}/structure`, { token: grab, body: { modelId: 'm-nokey' } });
t('модель без ключа — 400 з поясненням', isError(noKey, 400, 'bad_input') && /ключ/i.test(noKey.data.error), noKey.data.error);
t('модель без ціни — 400', isError(await call('POST', `${PD}/${d2}/structure`, { token: grab, body: { modelId: 'm-noprice' } }), 400, 'bad_input'));
t('відмови не резервують і не стартують роботу', wallet.ledger.length === 0 && wallet.available === 500 && (await get(d2)).job === null && ai.calls.length === 0);

const started = await call('POST', `${PD}/${d2}/structure`, { token: grab, body: { modelId: 'm-busy' } });
t('обрана модель — 202 за схемою', started.status === 202 && conforms('DraftResponse', started.data) === '');
t('бали зарезервовано ДО роботи', wallet.reserved > 0 && wallet.available < 500 && wallet.ledger[0]?.startsWith('reserve:'), JSON.stringify(wallet));
const reservedNow = wallet.reserved;
t('друга робота поки біжить — 409, резерву не додалося', isError(await call('POST', `${PD}/${d2}/structure`, { token: grab, body: { modelId: 'm-busy', replace: true } }), 409, 'job_running') && wallet.reserved === reservedNow);
await flush();
const call1 = ai.calls[0];
t('writeText дістав обрану модель і ознаку оплати балами', call1?.modelId === 'm-busy' && call1?.creditBilled === true, JSON.stringify(call1));
t('підпис виклику позначено «[бали]»', /\[бали\]/.test(call1?.label || ''), call1?.label);
const settled = wallet.ledger.find((x) => x.startsWith('settle:'));
t('списано за фактом: резерв знято, повернуто різницю', !!settled && wallet.reserved === 0 && wallet.available > 0, JSON.stringify(wallet));
t('списано не більше резерву', !!settled && Number(settled.split(':')[1]) <= Number(wallet.ledger[0].split(':')[1]));
t('грошовий ліміт тексту не опитувався (бали діють)', ai.uahChecks === 0, String(ai.uahChecks));
t('структура зʼявилась, статус structured', (await get(d2)).status === 'structured');

// ---------------------------------------------------------------------------
console.log('\nТиповa модель, збій і непридатна відповідь');
resetWallet();
ai.calls = [];
const d3 = await makeDraft('course', 4);
await call('POST', `${PD}/${d3}/structure`, { token: grab });
await flush();
t('без modelId — типова з переліку', ai.calls[0]?.modelId === 'm-ok', String(ai.calls[0]?.modelId));

resetWallet();
ai.mode = 'fail';
const d4 = await makeDraft('course', 4);
await call('POST', `${PD}/${d4}/structure`, { token: grab });
await flush();
t('збій моделі — резерв повернуто повністю, нічого не списано', wallet.available === 500 && wallet.reserved === 0 && !wallet.ledger.some((x) => x.startsWith('settle')), JSON.stringify(wallet));
t('збій — робота failed із причиною', (await get(d4)).job?.status === 'failed');

resetWallet();
ai.mode = 'junk';
const d5 = await makeDraft('course', 4);
await call('POST', `${PD}/${d5}/structure`, { token: grab });
await flush();
t('сміття замість JSON — бали повернуто, авторові не рахується', wallet.available === 500 && !wallet.ledger.some((x) => x.startsWith('settle')), JSON.stringify(wallet));
ai.mode = 'ok';

// ---------------------------------------------------------------------------
console.log('\nБракує балів');
resetWallet(1);
ai.calls = [];
const d6 = await makeDraft('course', 4);
const low = await call('POST', `${PD}/${d6}/structure`, { token: grab });
t('402 ai_budget_exceeded зі словами про бали', isError(low, 402, 'ai_budget_exceeded') && /бал/i.test(low.data.error), low.data.error);
t('роботу не запущено, модель не викликано, баланс цілий', (await get(d6)).job === null && ai.calls.length === 0 && wallet.available === 1 && wallet.reserved === 0);

// ---------------------------------------------------------------------------
console.log('\nПрохід 3 («Написати»)');
resetWallet();
ai.calls = [];
const modId = (await get(d2)).structure.modules[0].moduleId;
{
  const opt = await call('GET', `${PD}/${d2}/ai-options?pass=generate&moduleId=${modId}`, { token: grab });
  t('ai-options для generate — за схемою, із модулем', opt.status === 200 && opt.data.pass === 'generate' && opt.data.moduleId === modId && conforms('AiOptionsResponse', opt.data) === '', conforms('AiOptionsResponse', opt.data));
  const bad = await call('POST', `${PD}/${d2}/modules/${modId}/generate`, { token: grab, body: { modelId: 'm-nokey' } });
  t('generate: недоступна модель — 400', isError(bad, 400, 'bad_input'));
  const run = await call('POST', `${PD}/${d2}/modules/${modId}/generate`, { token: grab, body: { modelId: 'm-ok' } });
  t('generate з моделлю — 202, бали резервуються', run.status === 202 && wallet.reserved > 0);
  await flush();
  t('generate: модель і ознака оплати дійшли до writeText', ai.calls[0]?.modelId === 'm-ok' && ai.calls[0]?.creditBilled === true);
  t('generate: списано за фактом', wallet.ledger.some((x) => x.startsWith('settle:')) && wallet.reserved === 0);
  t('generate: текст модуля записано', (await get(d2)).structure.modules[0].written === true);
}

// ---------------------------------------------------------------------------
console.log('\nБез гейта балів (адмін, облік вимкнено)');
resetWallet();
wallet.gated = false;
ai.calls = [];
ai.uahChecks = 0;
const d7 = await makeDraft('course', 4);
await call('POST', `${PD}/${d7}/structure`, { token: grab });
await flush();
t('прохід іде, creditBilled=false', ai.calls[0]?.creditBilled === false, JSON.stringify(ai.calls[0]));
t('грошовий ліміт тексту опитано', ai.uahChecks >= 1);
t('підпис без позначки «[бали]»', !/\[бали\]/.test(ai.calls[0]?.label || ''));
// Кадри додаються ДО того, як ліміт «вичерпано»: збереження фото теж його перевіряє.
const d8 = await makeDraft('course', 4);
ai.budget = false;
t('без балів ліміт вичерпано — 402, як до 1.4.0', isError(await call('POST', `${PD}/${d8}/structure`, { token: grab }), 402, 'ai_budget_exceeded'));
ai.budget = true;

// ---------------------------------------------------------------------------
console.log('\nБез passModels — як до 1.4.0');
{
  const app2 = express();
  app2.use(express.json());
  app2.use((req: any, _res, next) => {
    req.principal = users['u-a'];
    next();
  });
  xroutes.registerExternalApiRoutes(app2, { recognize: async () => ({ text: 'x', modelId: 'm' }), schedule: () => undefined });
  routes.registerPhotoDraftRoutes(app2, {
    describe: async () => ({ description: 'x', tags: [], modelId: 'v' }),
    writeText: fakeWrite,
    schedule: (task) => {
      tasks.push(task);
    },
  });
  const s2 = app2.listen(0);
  await new Promise((r) => s2.once('listening', r));
  const b2 = `http://127.0.0.1:${(s2.address() as any).port}`;
  const code2 = await (await fetch(`${b2}/api/external-tokens/pairing-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'photo-drafts' }) })).json();
  const tok2 = (await (await fetch(`${b2}/api/external/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code2.code }) })).json()).token;
  const r = await fetch(`${b2}${PD}/pd_x/ai-options`, { headers: { authorization: `Bearer ${tok2}` } });
  t('ai-options без passModels — 503, а не падіння', r.status === 503);
  s2.close();
}

t('усі помилки відповідають схемі', errs.length === 0, errs.slice(0, 3).join(' | '));
server.close();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
