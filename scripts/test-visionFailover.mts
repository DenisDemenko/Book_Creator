/**
 * Тести ліміту часу й запасних моделей для моделі зору (GrabFusion, етап 1 «швидкість розпізнавання»).
 * Запуск: npm run test:vision-failover
 *
 * Передісторія: 09.11.2026 розпізнавання трьох сторінок займало 5–6 хвилин — модель модуля
 * (gemini-3.7-flash) мовчала, а виклик не мав ліміту часу й чекав 300 с до «fetch failed».
 *  1. Налаштування з env.
 *  2. Вибір моделі: головна, запасні, пропуск непридатних, що саме вважається приводом перейти.
 *  3. Справжній generateText із підставним fetch: ліміт часу обриває зависання, повтори керовані,
 *     thinkingLevel доходить до тіла запиту Gemini.
 */
const DIR = '/tmp/nova-vision-failover-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.GEMINI_API_KEY = 'test-key-not-real';

import fs from 'node:fs';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const vf = await import('../server/external/visionFailover');
const core = await import('../server/aiCore');
const providers = await import('../server/chatProviders');

type Deps = import('../server/external/visionFailover').VisionFailoverDeps;
type Args = import('../server/external/visionFailover').VisionFailoverArgs;

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

// ---------------------------------------------------------------------------
console.log('\nНалаштування з env');
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
t('ліміт часу за замовчуванням 30 с', vf.visionTimeoutMs(env({})) === 30_000);
t('SCAN_VISION_TIMEOUT_MS береться', vf.visionTimeoutMs(env({ SCAN_VISION_TIMEOUT_MS: '45000' })) === 45_000);
t(
  'безглуздий або надто малий ліміт ігнорується',
  vf.visionTimeoutMs(env({ SCAN_VISION_TIMEOUT_MS: '5' })) === 30_000 && vf.visionTimeoutMs(env({ SCAN_VISION_TIMEOUT_MS: 'abc' })) === 30_000
);
t('запасні за замовчуванням — дві швидкі моделі', JSON.stringify(vf.visionFallbackModels(env({}))) === JSON.stringify(['gemini-3.5-flash-lite', 'gemini-3-flash-preview']));
t('SCAN_VISION_FALLBACK_MODELS — перелік через кому', JSON.stringify(vf.visionFallbackModels(env({ SCAN_VISION_FALLBACK_MODELS: ' a , b ' }))) === '["a","b"]');
t('off / none / - / порожнє вимикають запасні', ['off', 'none', '-', '', '  '].every((v) => vf.visionFallbackModels(env({ SCAN_VISION_FALLBACK_MODELS: v })).length === 0));

// ---------------------------------------------------------------------------
console.log('\nВибір моделі (підставне generate)');
type Call = { modelId: string; generation: any; key?: string };
function harness(script: Record<string, Array<'ok' | Error>>, over: Partial<Deps> = {}) {
  vf.resetVisionCooldowns(); // пауза живе на рівні модуля — кожен сценарій починає з чистого стану
  const calls: Call[] = [];
  const warns: string[] = [];
  const queue: Record<string, Array<'ok' | Error>> = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  let clock = 0;
  const deps: Deps = {
    generate: (async (p: any) => {
      calls.push({ modelId: p.modelId, generation: p.generation, key: p.apiKeyOverride });
      clock += 100;
      const step = (queue[p.modelId] || ['ok']).shift() ?? 'ok';
      if (step instanceof Error) throw step;
      return { text: `текст від ${p.modelId}`, inputTokens: 1, outputTokens: 1 };
    }) as any,
    resolveKey: async () => undefined,
    engineReady: () => true,
    supportsVision: () => true,
    warn: (m) => warns.push(m),
    now: () => clock,
    ...over,
  };
  const run = (args: Partial<Args> = {}) =>
    vf.generateVisionWithFailover(
      {
        primaryModelId: 'gemini-3.7-flash',
        ownerId: 'u1',
        keyLabel: 'scan-ocr',
        params: { prompt: 'p', req: {}, label: 'тест' },
        timeoutMs: 30_000,
        fallbackModels: ['fb-1', 'fb-2'],
        ...args,
      },
      deps
    );
  return { run, calls, warns, tick: (ms: number) => (clock += ms) };
}
const timeout = () => new core.AiTimeoutError(30_000);
const upstream = (status: number, msg = 'x') => new providers.ChatProviderError(status, msg);

{
  const h = harness({});
  const out = await h.run();
  t('головна відповіла — запасні не чіпаємо', h.calls.length === 1 && out.modelId === 'gemini-3.7-flash' && out.text === 'текст від gemini-3.7-flash');
  t('кожна спроба має ліміт часу, а Gemini — thinkingLevel low', h.calls[0].generation.timeoutMs === 30_000 && h.calls[0].generation.thinkingLevel === 'low');
  t('повтори головної вимкнено, коли є запасні', h.calls[0].generation.transientRetries === 0);
}
// Текстові проходи чернеток (журнал #530): без вимоги зору, зі своїми лімітами й тегом логу.
{
  const h = harness({ 'gemini-3.7-flash': [timeout()] }, { supportsVision: () => false });
  const out = await h.run({ requireVision: false, logTag: 'photo-pass', fallbackModels: ['fb-1'], timeoutMs: 75_000, lastTimeoutMs: 170_000, baseGeneration: { temperature: 0.4, maxTokens: 8192 } });
  t('requireVision=false: модель без зору — не відмова й не відсів із запасних', out.modelId === 'fb-1' && h.calls.length === 2);
  t('ліміт часу: перша — ранній, остання — повний', h.calls[0].generation.timeoutMs === 75_000 && h.calls[1].generation.timeoutMs === 170_000, JSON.stringify(h.calls.map((c) => c.generation.timeoutMs)));
  t('температура й стеля токенів ідуть у кожну спробу', h.calls.every((c) => c.generation.temperature === 0.4 && c.generation.maxTokens === 8192));
  t('тег у логу текстового проходу', h.warns.length > 0 && h.warns.every((w) => w.startsWith('[photo-pass]')), h.warns.join(' | '));
  t('повертає токени — з них списуються бали', out.inputTokens === 1 && out.outputTokens === 1);
}
{
  const h = harness({}, { supportsVision: () => false });
  let thrown: any;
  await h.run().catch((e) => (thrown = e));
  t('за замовчуванням (зір) модель без зору й надалі відмовляє', /не бачить/.test(thrown?.message || '') && h.calls.length === 0, String(thrown?.message));
}
{
  const h = harness({ 'gemini-3.7-flash': [timeout()] });
  const out = await h.run();
  t('тайм-аут головної → відповідає перша запасна', out.modelId === 'fb-1' && h.calls.map((c) => c.modelId).join() === 'gemini-3.7-flash,fb-1');
  t('перехід записано в журнал із назвами моделей', h.warns.some((w) => /gemini-3\.7-flash/.test(w) && /fb-1/.test(w)) && h.warns.some((w) => /відповіла запасна модель fb-1/.test(w)));
}
{
  const h = harness({ 'gemini-3.7-flash': [upstream(503, 'high demand')], 'fb-1': [upstream(503, 'high demand')] });
  const out = await h.run();
  t('503 на двох моделях → відповідає третя', out.modelId === 'fb-2' && h.calls.length === 3);
  t('остання модель ланцюжка повторює тимчасові відмови як завжди', h.calls[2].generation.transientRetries === undefined && h.calls[1].generation.transientRetries === 0);
}
for (const status of [404, 429, 500, 502, 504]) {
  const h = harness({ 'gemini-3.7-flash': [upstream(status)] });
  t(`статус ${status} — привід перейти на запасну`, (await h.run()).modelId === 'fb-1');
}
for (const status of [401, 402, 403]) {
  const h = harness({ 'gemini-3.7-flash': [upstream(status, 'ліміт')] });
  let thrown: any;
  await h.run().catch((e) => (thrown = e));
  t(`статус ${status} (ключ/бюджет) — без переходу, помилка йде як є`, thrown?.status === status && h.calls.length === 1);
}
{
  const h = harness({ 'gemini-3.7-flash': [timeout()], 'fb-1': [timeout()], 'fb-2': [upstream(503, 'остання')] });
  let thrown: any;
  await h.run().catch((e) => (thrown = e));
  t('відмовили всі — кидається помилка останньої, збій не ховається', thrown?.status === 503 && /остання/.test(thrown.message) && h.calls.length === 3);
}
{
  const h = harness({ 'gemini-3.7-flash': [upstream(400, 'Thinking level LOW is not supported for this model')] });
  const out = await h.run();
  t(
    'модель не знає thinkingLevel → та сама модель ще раз без нього',
    out.modelId === 'gemini-3.7-flash' && h.calls.length === 2 && h.calls[0].generation.thinkingLevel === 'low' && h.calls[1].generation.thinkingLevel === undefined
  );
}
{
  const h = harness({ 'gemini-3.7-flash': [upstream(400, 'Image too large')] });
  let thrown: any;
  await h.run().catch((e) => (thrown = e));
  t('інші 400 (наприклад, зображення) на запасну не переводять', thrown?.status === 400 && h.calls.length === 1);
}
{
  const h = harness({ 'gemini-3.7-flash': [timeout()] }, { supportsVision: (m) => m !== 'fb-1' });
  const out = await h.run({ fallbackModels: ['fb-1', 'gemini-3.7-flash', 'fb-2', 'fb-2'] });
  t('запасні без зору, дублі й сама головна пропускаються', out.modelId === 'fb-2' && h.calls.map((c) => c.modelId).join() === 'gemini-3.7-flash,fb-2');
}
{
  const h = harness({ 'gemini-3.7-flash': [timeout()] }, { engineReady: (e) => e === 'gemini' });
  const out = await h.run({ fallbackModels: ['gpt-5.5', 'fb-2'] });
  t('запасна з рушієм без ключа пропускається', out.modelId === 'fb-2');
}
{
  const h = harness({}, { resolveKey: async () => undefined, engineReady: () => false });
  let thrown: any;
  await h.run().catch((e) => (thrown = e));
  t('головна без ключа — та сама відмова «Модель не налаштована»', /Модель не налаштована: потрібен GEMINI_API_KEY/.test(thrown?.message || '') && h.calls.length === 0);
  const h2 = harness(
    { 'gemini-3.7-flash': [timeout()] },
    { resolveKey: async (_o, e) => (e === 'gpt' ? 'власний-ключ-автора' : undefined), engineReady: (e) => e === 'gemini' }
  );
  const out = await h2.run({ fallbackModels: ['gpt-5.5'] });
  t('власний ключ автора для запасного рушія береться', out.modelId === 'gpt-5.5' && h2.calls[1].key === 'власний-ключ-автора');
  t('thinkingLevel ставиться лише Gemini', h2.calls[0].generation.thinkingLevel === 'low' && h2.calls[1].generation.thinkingLevel === undefined);
}
{
  const h = harness({}, { supportsVision: () => false });
  let thrown: any;
  await h.run().catch((e) => (thrown = e));
  t('головна без зору — та сама відмова, що й була', /не бачить зображень/.test(thrown?.message || '') && h.calls.length === 0);
}
{
  const h = harness({ 'gemini-3.7-flash': [timeout()] });
  let thrown: any;
  await h.run({ fallbackModels: [] }).catch((e) => (thrown = e));
  t('без запасних тайм-аут — помилка, а не вічне очікування', thrown instanceof core.AiTimeoutError && h.calls.length === 1);
  t('без запасних головна повторює тимчасові відмови як завжди', h.calls[0].generation.transientRetries === undefined);
}

// ---------------------------------------------------------------------------
console.log('\nПауза для моделі, що не відповіла');
{
  const h = harness({ 'gemini-3.7-flash': [timeout()] });
  await h.run();
  const callsAfterFirst = h.calls.length;
  const out2 = await h.run();
  t('наступний пакет одразу йде на запасну, не чекаючи головної', out2.modelId === 'fb-1' && h.calls.length === callsAfterFirst + 1 && h.calls[h.calls.length - 1].modelId === 'fb-1');
  h.tick(vf.VISION_COOLDOWN_MS + 1);
  const out3 = await h.run();
  t('після паузи головна пробується знову й, відповівши, повертає першість', out3.modelId === 'gemini-3.7-flash');
  const out4 = await h.run();
  t('відповівши, головна далі йде першою', out4.modelId === 'gemini-3.7-flash' && h.calls[h.calls.length - 1].modelId === 'gemini-3.7-flash');
}
{
  const h = harness({ 'gemini-3.7-flash': [timeout(), upstream(503, 'ще лежить')] });
  await h.run({ fallbackModels: [] }).catch(() => {});
  let thrown: any;
  await h.run({ fallbackModels: [] }).catch((e) => (thrown = e));
  t('єдину модель ланцюжка не пропускаємо навіть на паузі', h.calls.length === 2 && thrown?.status === 503);
}
{
  const h = harness({ 'gemini-3.7-flash': [upstream(402, 'бюджет')] });
  await h.run().catch(() => {});
  const out = await h.run();
  t('відмова через бюджет/ключ паузи не запускає', out.modelId === 'gemini-3.7-flash');
}
vf.resetVisionCooldowns();

// ---------------------------------------------------------------------------
console.log('\nСправжній generateText із підставним fetch');
const realFetch = globalThis.fetch;
let fetchCalls = 0;
let lastBody: any = null;
function stubFetch(kind: 'hang' | '503' | 'ok') {
  fetchCalls = 0;
  globalThis.fetch = (async (_url: any, init: any) => {
    fetchCalls++;
    lastBody = JSON.parse(String(init?.body || '{}'));
    if (kind === 'ok') {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'привіт' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }), { status: 200 });
    }
    if (kind === '503') return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 });
    // зависання: відповіді немає, поки запит не скасують
    return new Promise<Response>((_res, rej) =>
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    );
  }) as any;
}
const base = { engine: 'gemini' as const, modelId: 'gemini-3.7-flash', prompt: 'p', req: {}, label: 'тест' };
try {
  stubFetch('hang');
  const t0 = Date.now();
  let err: any;
  await core.generateText({ ...base, generation: { timeoutMs: 250 } }).catch((e) => (err = e));
  t('зависла модель обривається за ліміт часу, а не за 300 с', err instanceof core.AiTimeoutError && Date.now() - t0 < 2000, String(err?.message));
  t('тайм-аут не повторюється (одна спроба)', fetchCalls === 1);

  stubFetch('503');
  await core.generateText({ ...base, generation: { transientRetries: 0 } }).catch(() => {});
  t('transientRetries: 0 — одна спроба на 503, без добивання', fetchCalls === 1);

  stubFetch('503');
  await core.generateText({ ...base, generation: { transientRetries: 1 } }).catch(() => {});
  t('transientRetries: 1 — рівно одна повторна спроба', fetchCalls === 2);

  stubFetch('ok');
  await core.generateText({ ...base, generation: { thinkingLevel: 'low' } });
  t('thinkingLevel low доходить до тіла запиту Gemini', lastBody?.generationConfig?.thinkingConfig?.thinkingLevel === 'low');
  stubFetch('ok');
  await core.generateText({ ...base });
  t('без thinkingLevel тіло запиту не змінюється', lastBody?.generationConfig && !('thinkingConfig' in lastBody.generationConfig) && lastBody.generationConfig.temperature === 0.7);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
