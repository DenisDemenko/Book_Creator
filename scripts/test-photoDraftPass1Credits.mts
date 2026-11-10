/**
 * Тести єдиного обліку балів для проходу 1 чернеток за фото (опис кадру, розпізнавання сторінки; журнал #538)
 * і покинутих резервів балів.
 * Запуск: npm run test:photo-draft-pass1
 *
 *  1. Чиста частина: оцінка токенів, ціна за найдорожчою моделлю ланцюга, перемикач.
 *  2. runBilledVision із підставним гаманцем: резерв, списання за фактом, повернення, коли гейт не діє.
 *  3. visionCreditsBlock: швидка перевірка балансу без резерву.
 *  4. Маршрути: 402 при завантаженні кадру, грошовий ліміт не питається, коли платять балами.
 *  5. Справжній описувач + справжній гаманець + підставний Gemini: ledger, мітка `[бали]`, повернення при збої.
 *  6. Покинуті резерви: повертаються лише свої префікси й лише після строку.
 *  7. Загублений опис кадру (деплой посеред роботи): видно як failed, повтор дозволено.
 */
const DIR = '/tmp/nova-pass1-credits-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.GEMINI_API_KEY = 'test-key-not-real';
process.env.SCAN_VISION_FALLBACK_MODELS = 'off';

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const vb = await import('../server/external/visionBilling');
const routes = await import('../server/external/photoDraftRoutes');
const xroutes = await import('../server/external/externalApiRoutes');
const sinks = await import('../server/external/photoDraftSinks');
const storeMod = await import('../server/store');
const { CreditWallet } = await import('../server/creditWallet');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

// ---------------------------------------------------------------------------
console.log('\nЧиста частина');
{
  const d = vb.estimateVisionPass('describe');
  const r = vb.estimateVisionPass('recognize');
  t('вхід однаковий (фото + службовий текст), вихід сторінки більший за опис кадру', d.inputTokens === r.inputTokens && r.outputTokens > d.outputTokens);
  t('стеля виходу сторінки вища за стелю опису', r.maxOutputTokens > d.maxOutputTokens && r.outputTokens <= r.maxOutputTokens);
  t('вхід має запас над найбільшим фото (9 плиток Gemini ≈ 2322 токени)', d.inputTokens > 2322);
  t('перемикач: за замовчуванням увімкнено', vb.pass1CreditsEnabled(env({})) === true);
  t('перемикач: off / 0 / false / no вимикають', ['off', '0', 'false', 'NO', ' Off '].every((v) => vb.pass1CreditsEnabled(env({ PHOTO_DRAFT_PASS1_CREDITS: v })) === false));
  t('перемикач: інше значення не вимикає', vb.pass1CreditsEnabled(env({ PHOTO_DRAFT_PASS1_CREDITS: 'on' })) === true);

  const rate = (_e: string, m: string) =>
    m === 'cheap' ? { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 } : m === 'dear' ? { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } : { inputPerMillionUsd: null, outputPerMillionUsd: null };
  const qc = vb.quoteVisionChain('describe', ['cheap'], rate as any);
  const qd = vb.quoteVisionChain('describe', ['cheap', 'dear'], rate as any);
  t('ланцюг із дорожчою моделлю резервує за нею', !!qc && !!qd && qd.maxUsd > qc.maxUsd && qd.maxCredits >= qc.maxCredits);
  t('резерв не нижчий за очікуване', !!qc && qc.maxUsd >= qc.expectedUsd && qc.maxCredits >= qc.expectedCredits);
  t('модель без ціни в ланцюзі пропускається, не обнуляє резерв', JSON.stringify(vb.quoteVisionChain('describe', ['nope', 'cheap'], rate as any)) === JSON.stringify(qc));
  t('жодної ціни — null (гейт не діє, а не «безкоштовно»)', vb.quoteVisionChain('describe', ['nope'], rate as any) === null);
  t('кадр коштує щонайменше 1 бал', !!qc && qc.expectedCredits >= 1);
}

// ---------------------------------------------------------------------------
console.log('\nrunBilledVision (підставний гаманець)');
const RATE = { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 };
function billingDeps(over: Record<string, any> = {}) {
  const log: string[] = [];
  const deps = {
    enabled: () => true,
    primaryModel: async () => 'gemini-test',
    fallbackModels: () => [] as string[],
    rate: () => RATE,
    costUsd: (_m: string, i: number, o: number) => (i / 1e6) * 0.1 + (o / 1e6) * 0.4,
    begin: async (_req: any, maxUsd: number) => {
      log.push(`begin:${maxUsd > 0}`);
      return {
        reservedCredits: 3,
        settleUsd: (usd: number) => log.push(`settle:${usd.toFixed(6)}`),
        release: (why: string) => log.push(`release:${why}`),
      };
    },
    status: async () => ({ unlimited: false, balance: 100 }),
    ...over,
  };
  return { deps: deps as any, log };
}
{
  const { deps, log } = billingDeps();
  let sawBilled: boolean | null = null;
  const out = await vb.runBilledVision({ req: {} as any, kind: 'describe', run: async (b) => ((sawBilled = b), { text: 'x', modelId: 'gemini-test', inputTokens: 2000, outputTokens: 100 }) }, deps);
  t('резерв до виклику, списання після', log[0] === 'begin:true' && log[1].startsWith('settle:') && log.length === 2);
  t('виклик знає, що вже оплачено балами', sawBilled === true);
  t('списується фактична вартість моделі, що відповіла', Math.abs(Number(log[1].slice(7)) - (0.0002 + 0.00004)) < 1e-9, log[1]);
  t('результат виклику не змінюється', out.text === 'x' && out.modelId === 'gemini-test');
}
{
  const { deps, log } = billingDeps({ costUsd: () => 0 });
  await vb.runBilledVision({ req: {} as any, kind: 'describe', run: async () => ({ modelId: 'x', inputTokens: 1, outputTokens: 1 }) }, deps);
  const q = vb.quoteVisionChain('describe', ['gemini-test'], () => RATE as any)!;
  t('невідома ціна відповідача — списується очікуване, а не весь резерв', Math.abs(Number(log[1].slice(7)) - q.expectedUsd) < 1e-9, log[1]);
}
{
  const { deps, log } = billingDeps();
  let err: any;
  await vb.runBilledVision({ req: {} as any, kind: 'recognize', run: async () => { throw new Error('Модель перевантажена'); } }, deps).catch((e) => (err = e));
  t('збій моделі повертає резерв і кидає ту саму помилку', log.length === 2 && log[1].startsWith('release:') && /перевантажена/.test(err?.message), log.join('|'));
}
{
  const { deps, log } = billingDeps({
    begin: async () => {
      throw Object.assign(new Error('Недостатньо AI-балів: потрібно 3, на балансі 1.'), { kind: 'credits' });
    },
  });
  let called = false;
  let err: any;
  await vb.runBilledVision({ req: {} as any, kind: 'describe', run: async () => ((called = true), { modelId: 'x', inputTokens: 1, outputTokens: 1 }) }, deps).catch((e) => (err = e));
  t('бракує балів — модель не викликається, помилка йде нагору', !called && err?.kind === 'credits' && log.length === 0);
}
for (const [name, over] of [
  ['гейт не діє (адмін): begin → null', { begin: async () => null }],
  ['перемикач вимкнено', { enabled: () => false }],
  ['ціни моделі не звірено', { rate: () => ({ inputPerMillionUsd: null, outputPerMillionUsd: null }) }],
] as const) {
  const { deps, log } = billingDeps(over);
  let sawBilled: boolean | null = null;
  await vb.runBilledVision({ req: {} as any, kind: 'describe', run: async (b) => ((sawBilled = b), { modelId: 'x', inputTokens: 1, outputTokens: 1 }) }, deps);
  t(`${name}: як було — без списання, грошовий ліміт діє`, sawBilled === false && !log.some((l) => l.startsWith('settle')));
}

// ---------------------------------------------------------------------------
console.log('\nvisionCreditsBlock');
{
  const blk = (over: Record<string, any>) => vb.visionCreditsBlock({} as any, 'describe', billingDeps(over).deps);
  const unl = await blk({ status: async () => ({ unlimited: true, balance: null }) });
  t('безлімітний (адмін) — бали не діють', unl.billed === false && unl.reason === null);
  const low = await blk({ status: async () => ({ unlimited: false, balance: 0 }) });
  t('баланс нижчий за резерв — відмова зі словами про бали', low.billed === true && /бал/i.test(String(low.reason)) && /опис кадру/.test(String(low.reason)), JSON.stringify(low));
  const lowPage = await vb.visionCreditsBlock({} as any, 'recognize', billingDeps({ status: async () => ({ unlimited: false, balance: 0 }) }).deps);
  t('для сторінки в тексті — «розпізнавання сторінки»', /розпізнавання сторінки/.test(String(lowPage.reason)));
  const ok = await blk({});
  t('балів вистачає — платить балами, відмови немає', ok.billed === true && ok.reason === null);
  const off = await blk({ enabled: () => false });
  t('перемикач вимкнено — бали не діють', off.billed === false);
  const noPrice = await blk({ rate: () => ({ inputPerMillionUsd: null, outputPerMillionUsd: null }) });
  t('ціни не звірено — бали не діють (кадр не блокується)', noPrice.billed === false && noPrice.reason === null);
  const origWarn = console.warn;
  console.warn = () => undefined;
  const broken = await blk({ status: async () => { throw new Error('гаманець недоступний'); } });
  console.warn = origWarn;
  t('гаманець недоступний — не блокуємо, діє грошовий ліміт', broken.billed === false && broken.reason === null);
}

// ---------------------------------------------------------------------------
console.log('\nМаршрути: завантаження й повтор кадру');
const users: Record<string, any> = { 'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Викладачка', role: 'writer', isGuest: false } };
const nowIso = new Date().toISOString();
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Викладачка', role: 'writer', createdAt: nowIso } as any);
const tasks: Array<() => Promise<void>> = [];
const flush = async () => { while (tasks.length) await tasks.shift()!(); };
const state = { visionBlock: { billed: true, reason: null as string | null }, kinds: [] as string[], uahChecks: 0, uahAllowed: true, describes: 0 };
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : { id: null, email: 'guest@local', role: 'guest', isGuest: true };
  next();
});
xroutes.registerExternalApiRoutes(app, { recognize: async () => ({ text: 'x', modelId: 'm' }), schedule: () => undefined });
routes.registerPhotoDraftRoutes(app, {
  describe: async () => ((state.describes += 1), { description: 'Заготовка.', tags: [], modelId: 'v' }),
  recognize: async () => ({ text: 'Текст.', modelId: 'v' }),
  checkAiBudget: async () => (state.uahChecks++, state.uahAllowed ? { allowed: true } : { allowed: false, reasonUk: 'Вичерпано ліміт ШІ у гривнях' }),
  passModels: {
    list: async () => ({ models: [], defaultModelId: null, checkedAt: nowIso }),
    quote: () => null,
    balance: async () => ({ unlimited: true, balance: null }),
    begin: async () => null,
    visionBlock: async (_req: any, kind: any) => (state.kinds.push(kind), state.visionBlock),
  } as any,
  sinks: { createCourse: sinks.createCourseDraft, createExpress: sinks.createExpressInstruction, createInboxScans: sinks.createInboxScans },
  schedule: (task) => { tasks.push(task); },
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
  return { status: res.status, data: (res.headers.get('content-type') || '').includes('json') ? ((await res.json()) as any) : null };
}
const PD = '/api/external/v1/photo-drafts';
const code = await call('POST', '/api/external-tokens/pairing-code', { session: 'u-a', body: { scope: 'photo-drafts' } });
const tok: string = (await call('POST', '/api/external/v1/pair', { body: { code: code.data.code } })).data.token;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
let seq = 0;
const mk = async (kind: string) => (await call('POST', PD, { token: tok, body: { kind, title: 'Ложка', craft: 'різьблення', audience: 'початківці', level: 'beginner', ...(kind === 'manuscript' ? { newBookTitle: 'Книга' } : {}) } })).data.draft.draftId as string;
const add = (id: string) => call('POST', `${PD}/${id}/photos`, { token: tok, body: { clientId: `p1-${++seq}`, image } });
const reset = () => { state.kinds = []; state.uahChecks = 0; state.uahAllowed = true; state.describes = 0; state.visionBlock = { billed: true, reason: null }; };

{
  const id = await mk('course');
  reset();
  state.visionBlock = { billed: true, reason: 'Недостатньо AI-балів: опис кадру потребує до 2, на балансі 0.' };
  const r = await add(id);
  t('бракує балів — 402 ai_budget_exceeded зі словами про бали', r.status === 402 && r.data.kind === 'ai_budget_exceeded' && /бал/i.test(r.data.error), JSON.stringify(r.data));
  const d = (await call('GET', `${PD}/${id}`, { token: tok })).data.draft;
  t('відмова до збереження: кадру в чернетці немає, опис не запущено', d.photos.length === 0 && state.describes === 0);
  t('грошовий ліміт при цьому не питали (платять балами)', state.uahChecks === 0);
  t('для курсу перевірка «опис кадру»', state.kinds.join() === 'describe');
}
{
  const id = await mk('instruction');
  reset();
  const r = await add(id);
  await flush();
  t('балів вистачає — 202, прохід 1 стартував', r.status === 202 && state.describes === 1);
  t('платять балами — грошовий ліміт НЕ питали (інакше двічі)', state.uahChecks === 0);
}
{
  const id = await mk('instruction');
  reset();
  state.visionBlock = { billed: false, reason: null };
  const r = await add(id);
  await flush();
  t('бали не діють (адмін, вимкнено) — як було: питаємо грошовий ліміт', r.status === 202 && state.uahChecks === 1);
  reset();
  state.visionBlock = { billed: false, reason: null };
  state.uahAllowed = false;
  const r2 = await add(id);
  t('…і його вичерпання — 402', r2.status === 402 && /гривн/.test(r2.data.error));
}
{
  const id = await mk('manuscript');
  reset();
  const r = await add(id);
  await flush();
  t('рукопис — перевірка «розпізнавання сторінки»', r.status === 202 && state.kinds.join() === 'recognize');
}
{
  // повтор невдалого кадру
  const id = await mk('course');
  reset();
  const first = await add(id);
  const photoId: string = first.data.photo.photoId;
  await flush();
  // зробити кадр невдалим: наступний прохід падає
  const store = await import('../server/external/photoDraftStore');
  await store.mutateDraft(id, 'u-a', (d: any) => { const p = d.photos.find((x: any) => x.photoId === photoId); p.status = 'failed'; p.error = 'збій'; }, { byTeacher: false, now: () => new Date() });
  reset();
  state.visionBlock = { billed: true, reason: 'Недостатньо AI-балів: опис кадру потребує до 2, на балансі 0.' };
  const r = await call('POST', `${PD}/${id}/photos/${photoId}/retry`, { token: tok });
  t('повтор без балів — 402, кадр лишається невдалим', r.status === 402 && (await call('GET', `${PD}/${id}`, { token: tok })).data.draft.photos[0].status === 'failed');
  reset();
  const ok = await call('POST', `${PD}/${id}/photos/${photoId}/retry`, { token: tok });
  await flush();
  t('повтор із балами — 202 і без грошового ліміту', ok.status === 202 && state.uahChecks === 0 && state.describes === 1);
}
{
  console.log('\nЗагублений опис кадру (деплой посеред роботи)');
  const passes = await import('../server/external/photoDraftPasses');
  const store = await import('../server/external/photoDraftStore');
  const id = await mk('course');
  reset();
  const first = await add(id);
  await flush();
  const photoId: string = first.data.photo.photoId;
  const setProcessing = (ageMs: number) =>
    store.mutateDraft(id, 'u-a', (d: any) => { const p = d.photos.find((x: any) => x.photoId === photoId); p.status = 'processing'; p.error = null; p.updatedAt = new Date(Date.now() - ageMs).toISOString(); }, { byTeacher: false, now: () => new Date() });
  const view = async () => (await call('GET', `${PD}/${id}`, { token: tok })).data.draft.photos[0];

  await setProcessing(60_000);
  const fresh = await view();
  t('свіжий опис — ще processing', fresh.status === 'processing' && fresh.error === null);
  t('…і повтор його не перезапускає (409)', (await call('POST', `${PD}/${id}/photos/${photoId}/retry`, { token: tok })).status === 409);

  await setProcessing(passes.PHOTO_STALE_MS + 60_000);
  const lost = await view();
  t('опис, що висить довше за межу, видно як failed із поясненням', lost.status === 'failed' && lost.error === passes.PHOTO_STALE_MESSAGE, JSON.stringify(lost).slice(0, 160));
  const sub = await call('POST', `${PD}/${id}/submit`, { token: tok });
  const kinds = (sub.data.blockers ?? []).map((b: any) => b.kind);
  t('відправка бачить його як «не вдалося описати», а не «ще описується»', sub.status === 400 && kinds.includes('photos_failed') && !kinds.includes('photos_processing'), JSON.stringify(kinds));
  reset();
  const again = await call('POST', `${PD}/${id}/photos/${photoId}/retry`, { token: tok });
  await flush();
  t('повтор дозволено: 202, опис знову запущено й завершено', again.status === 202 && state.describes === 1 && (await view()).status === 'described');
  t('сама межа: 8 хв', passes.PHOTO_STALE_MS === 8 * 60 * 1000);
}
server.close();

// ---------------------------------------------------------------------------
console.log('\nСправжній описувач + справжній гаманець + підставний Gemini');
{
  const describer = await import('../server/external/photoDraftDescriber');
  const gate = await import('../server/creditGate');
  const w = new CreditWallet(db.getDb() as any);
  await storeMod.saveUser({ id: 'u-w', email: 'w@test.ua', name: 'Авторка', role: 'writer', createdAt: nowIso } as any);
  await storeMod.saveUser({ id: 'u-adm', email: 'adm@test.ua', name: 'Адмін', role: 'admin', createdAt: nowIso } as any);
  const principal = (id: string, role: string) => ({ principal: { id, email: `${id}@test.ua`, role, isGuest: false } }) as any;
  const params = (req: any) => ({ ownerId: req.principal.id, draftId: 'pd_int', mimeType: 'image/jpeg', base64: JPEG.toString('base64'), context: { kind: 'course', instructionMode: null, title: null, craft: null, audience: null, notes: [] }, req }) as any;

  const realFetch = globalThis.fetch;
  let mode: 'ok' | 'fail' = 'ok';
  let calls = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).includes('generativelanguage')) return realFetch(url, init);
    calls++;
    if (mode === 'fail') return new Response(JSON.stringify({ error: { message: 'internal' } }), { status: 500 });
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"description":"Заготовка з вишні на верстаку.","tags":["вишня"]}' }] } }], usageMetadata: { promptTokenCount: 2800, candidatesTokenCount: 60 } }),
      { status: 200 }
    );
  }) as any;
  const origWarn = console.warn;
  console.warn = () => undefined;
  try {
    const before = (await gate.syncCredits('u-w')).available;
    const out = await describer.describePhotoWithCoreVision(params(principal('u-w', 'writer')));
    const after = w.getBalance('u-w');
    t('опис повернувся як раніше', out.description.startsWith('Заготовка') && out.tags[0] === 'вишня', JSON.stringify(out));
    console.log(`    (один кадр на проході: баланс ${before} → ${w.getBalance('u-w').available})`);
    t('списано від 1 бала, резерву не лишилось', after.available < before && before - after.available <= 5 && after.reserved === 0, `${before}→${after.available}, reserved ${after.reserved}`);
    const led = w.listLedger('u-w');
    t('у журналі гаманця: резерв `vis:` і списання', led.some((l) => l.kind === 'reserve' && String(l.ref).startsWith('vis:')) && led.some((l) => l.kind === 'charge' && String(l.ref).startsWith('vis:')));
    const usage = await storeMod.listUsageSince(new Date(Date.now() - 60_000).toISOString());
    const rec = usage.find((u: any) => u.userId === 'u-w');
    t('запис витрат позначено [бали] — у грошовий ліміт чату не потрапить', !!rec && /\[бали\]/.test(String(rec.context)), JSON.stringify(rec?.context));

    // збій моделі → резерв повернуто
    mode = 'fail';
    const b2 = w.getBalance('u-w').available;
    let err: any;
    await describer.describePhotoWithCoreVision(params(principal('u-w', 'writer'))).catch((e) => (err = e));
    const a2 = w.getBalance('u-w');
    t('збій моделі: кадр не списано, резерв повернуто', !!err && a2.available === b2 && a2.reserved === 0, `${b2}→${a2.available}, reserved ${a2.reserved}, err ${String(err?.message).slice(0, 60)}`);

    // не вистачає балів → модель не викликається
    mode = 'ok';
    w.adjust('u-w', -w.getBalance('u-w').available, 'тест: обнулення', 'test');
    calls = 0;
    let low: any;
    await describer.describePhotoWithCoreVision(params(principal('u-w', 'writer'))).catch((e) => (low = e));
    t('порожній баланс: помилка про бали, Gemini не викликали', low?.kind === 'credits' && /бал/i.test(low.message) && calls === 0, String(low?.message));

    // адмін: бали не діють
    calls = 0;
    const admLed = w.listLedger('u-adm').length;
    await describer.describePhotoWithCoreVision(params(principal('u-adm', 'admin')));
    t('адмін: Gemini викликано, у гаманці нічого не змінилось', calls === 1 && w.listLedger('u-adm').length === admLed);

    // перемикач
    w.adjust('u-w', 50, 'тест: поповнення', 'test');
    process.env.PHOTO_DRAFT_PASS1_CREDITS = 'off';
    const b3 = w.getBalance('u-w').available;
    await describer.describePhotoWithCoreVision(params(principal('u-w', 'writer')));
    t('PHOTO_DRAFT_PASS1_CREDITS=off: бали не списуються (повернення на грошовий ліміт)', w.getBalance('u-w').available === b3);
    delete process.env.PHOTO_DRAFT_PASS1_CREDITS;
  } finally {
    globalThis.fetch = realFetch;
    console.warn = origWarn;
  }

  // WriterScan (без draftId) не чіпаємо
  const scan = await import('../server/external/scanRecognizer');
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).includes('generativelanguage')) return realFetch(url, init);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Текст сторінки.' }] } }], usageMetadata: { promptTokenCount: 2800, candidatesTokenCount: 40 } }), { status: 200 });
  }) as any;
  try {
    const b = w.getBalance('u-w').available;
    const req = principal('u-w', 'writer');
    await scan.recognizeScanWithCoreVision({ mimeType: 'image/jpeg', base64: JPEG.toString('base64'), ownerId: 'u-w', bookId: 'b1', req } as any);
    t('скан WriterScan (без чернетки) лишається на грошовому ліміті: бали не списано', w.getBalance('u-w').available === b);
    await scan.recognizeScanWithCoreVision({ mimeType: 'image/jpeg', base64: JPEG.toString('base64'), ownerId: 'u-w', bookId: 'b1', draftId: 'pd_int', req } as any);
    t('сторінка рукопису GrabFusion (з draftId) — балами', w.getBalance('u-w').available < b);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
console.log('\nПокинуті резерви');
{
  const w = new CreditWallet(db.getDb() as any);
  const gate = await import('../server/creditGate');
  w.grant('u-sw', 100, 'grant:u-sw', 'тест');
  const T0 = Date.parse('2026-11-10T10:00:00.000Z');
  const mkRes = (key: string, atMs: number, amount: number) => {
    const w2 = new CreditWallet(db.getDb() as any, () => new Date(atMs).toISOString());
    w2.reserve('u-sw', key, amount);
  };
  mkRes('txt:u-sw:1:a', T0, 5);
  mkRes('vis:u-sw:2:b', T0, 3);
  mkRes('vid:u-sw:3:c', T0, 10);
  mkRes('tableimg:order-77', T0, 7); // чужий потік (маркетплейс) — не наш префікс
  mkRes('txt:u-sw:4:d', T0 + 40 * 60_000, 2); // свіжий
  const s0 = w.getBalance('u-sw');
  t('перед чисткою зарезервовано 27', s0.reserved === 27 && s0.available === 73, JSON.stringify(s0));

  const early = gate.sweepStaleReservations(T0 + 10 * 60_000);
  t('через 10 хв нічого не покинуто', early.released === 0 && w.getBalance('u-sw').reserved === 27);
  const mid = gate.sweepStaleReservations(T0 + 45 * 60_000);
  const s1 = w.getBalance('u-sw');
  t('через 45 хв повернуто txt і vis (8 балів), відео ще чекає', mid.released === 2 && mid.credits === 8 && s1.reserved === 19 && s1.available === 81, JSON.stringify({ mid, s1 }));
  const late = gate.sweepStaleReservations(T0 + 3 * 3_600_000);
  const s2 = w.getBalance('u-sw');
  t('через 3 години — і відео, і свіжий txt; чужий потік лишається', late.released === 2 && s2.reserved === 7 && s2.available === 93, JSON.stringify({ late, s2 }));
  const again = gate.sweepStaleReservations(T0 + 4 * 3_600_000);
  t('повторна чистка нічого не міняє', again.released === 0 && w.getBalance('u-sw').reserved === 7);
  let closed = '';
  try { w.settle('txt:u-sw:1:a', 1); } catch (e: any) { closed = e.code; }
  t('запізніле списання за повернутим резервом відхиляється, а не списує вдруге', closed === 'RESERVATION_CLOSED', closed);
  const led = w.listLedger('u-sw').filter((l) => l.kind === 'release' && /перервано/.test(String(l.reason)));
  t('причина повернення видна в журналі гаманця', led.length === 4, String(led.length));
}

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
