/**
 * Тести перевірки моделей для проходів 2–3 (журнал #530). Запуск: npm run test:photo-draft-models
 *
 * Мережі нема: ключі, пробні запити й ціни — підставні. Головне:
 *  1. Відмова провайдера розрізняється: ключ, гроші, модель, перевантаження.
 *  2. Перелік: без ключа — не придатна, без ціни — не придатна і без пробного запиту, типова — з привʼязки адміна.
 *  3. Кеш: повторне відкриття екрана не б'є провайдера; зміна ключа скидає кеш; зайнята модель перевіряється частіше.
 *  4. Бали: ціна за тарифом моделі й адмінською маржею, невідома ціна — null.
 */
const DIR = '/tmp/nova-photo-draft-models-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const m = await import('../server/external/photoDraftAiModels');
const core = await import('../server/aiCore');
const providers = await import('../server/chatProviders');
const creditPricing = await import('../server/creditPricing');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

const perr = (status: number, message: string) => new providers.ChatProviderError(status, message);

console.log('\nЩо означає відмова провайдера');
const cls = (e: unknown) => m.classifyProbeFailure(e).status;
t('401 — ключ відхилено', cls(perr(401, 'Incorrect API key provided')) === 'key_rejected');
t('Gemini: 400 «API key not valid» — ключ відхилено', cls(perr(400, 'API key not valid. Please pass a valid API key.')) === 'key_rejected');
t('403 — ключ відхилено', cls(perr(403, 'PERMISSION_DENIED')) === 'key_rejected');
t('402 — немає коштів', cls(perr(402, 'Payment required')) === 'no_funds');
t('429 insufficient_quota — немає коштів', cls(perr(429, 'You exceeded your current quota, please check your plan and billing details.')) === 'no_funds');
t('Gemini RESOURCE_EXHAUSTED — немає коштів', cls(perr(429, 'RESOURCE_EXHAUSTED: quota exceeded for metric')) === 'no_funds');
t('Claude: «credit balance is too low» — немає коштів', cls(perr(400, 'Your credit balance is too low to access the Anthropic API.')) === 'no_funds');
t('429 без слів про гроші — просто зайнята', cls(perr(429, 'Rate limit reached, try again later')) === 'busy');
t('503 — зайнята', cls(perr(503, 'This model is currently experiencing high demand.')) === 'busy');
t('404 — провайдер не знає моделі', cls(perr(404, 'models/gemini-x is not found for API version v1beta')) === 'model_missing');
t('тайм-аут — зайнята', cls(new core.AiTimeoutError(12_000)) === 'busy');
t('мережа — зайнята', cls(new TypeError('fetch failed')) === 'busy');
t('кожна відмова має людське пояснення', ['key_rejected', 'no_funds', 'busy', 'model_missing'].every((k) => !!m.classifyProbeFailure(perr(k === 'key_rejected' ? 401 : k === 'no_funds' ? 402 : k === 'busy' ? 503 : 404, 'x')).note));

// ---------------------------------------------------------------------------
type Info = import('../server/chatProviders').ChatModelInfo;
const info = (id: string, engine: Info['engine'], label = id): Info => ({ id, engine, label, provider: engine.toUpperCase(), contextWindow: '1M', vision: true });
const MODELS: Info[] = [
  info('g-1', 'gemini'),
  info('c-1', 'claude'),
  info('c-2', 'claude'),
  info('o-1', 'gpt'),
  info('d-1', 'deepseek'),
];

const harness = (over: Partial<import('../server/external/photoDraftAiModels').ModelsDeps> = {}) => {
  const clock = { now: 1_000_000 };
  const pings: string[] = [];
  const ctl = {
    keys: { gemini: 'k-gem', claude: 'k-cla', gpt: undefined as string | undefined, deepseek: 'k-ds' } as Record<string, string | undefined>,
    envReady: new Set<string>(),
    pingFails: {} as Record<string, unknown>,
    bound: undefined as string | undefined,
    prices: { 'g-1': [1, 4], 'c-1': [3, 15], 'c-2': [15, 75], 'o-1': [2, 8], 'd-1': null } as Record<string, [number, number] | null>,
    resolveCalls: 0,
    fallbacks: ['g-lite'] as string[],
  };
  const deps: import('../server/external/photoDraftAiModels').ModelsDeps = {
    models: () => MODELS,
    resolveKey: async (_o, engine) => {
      ctl.resolveCalls++;
      return ctl.keys[engine];
    },
    engineReady: (e) => ctl.envReady.has(e),
    ping: async (modelId, _engine, key) => {
      pings.push(`${modelId}:${key}`);
      const f = ctl.pingFails[modelId];
      if (f) throw f;
    },
    boundModel: async () => ctl.bound,
    fallbackModels: () => ctl.fallbacks,
    rate: (_e, id) => {
      const p = ctl.prices[id];
      return p ? { inputPerMillionUsd: p[0], outputPerMillionUsd: p[1] } : { inputPerMillionUsd: null, outputPerMillionUsd: null };
    },
    now: () => clock.now,
    ...over,
  };
  m.resetModelProbeCache();
  return { deps, ctl, clock, pings };
};

console.log('\nПерелік моделей');
{
  const h = harness();
  const r = await m.listPassModels('u-1', h.deps);
  const by = Object.fromEntries(r.models.map((x) => [x.modelId, x]));
  t('з ключем і ціною — придатна, ok', by['g-1'].status === 'ok' && by['g-1'].usable && by['g-1'].note === null);
  t('без ключа (GPT) — no_key, не придатна', by['o-1'].status === 'no_key' && !by['o-1'].usable && /ключ/i.test(by['o-1'].note || ''));
  t('без ціни (DeepSeek) — price_unknown, не придатна', by['d-1'].status === 'price_unknown' && !by['d-1'].usable);
  t('на модель без ключа й без ціни пробних запитів нема', !h.pings.some((p) => p.startsWith('o-1') || p.startsWith('d-1')), h.pings.join());
  t('ключ рушія шукали раз на рушій, а не на модель', h.ctl.resolveCalls === 4, String(h.ctl.resolveCalls));
  t('типова — перша придатна ok, коли привʼязки нема', r.defaultModelId === 'g-1' && r.models[0].modelId === 'g-1');
  t('непридатні — в кінці', r.models.slice(-2).every((x) => !x.usable));
  t('checkedAt — ISO від годинника', r.checkedAt === new Date(1_000_000).toISOString());
}
{
  const h = harness();
  h.ctl.bound = 'c-2';
  const r = await m.listPassModels('u-1', h.deps);
  t('привʼязка адміна, якщо придатна, — типова й перша', r.defaultModelId === 'c-2' && r.models[0].modelId === 'c-2');
}
{
  const h = harness();
  h.ctl.bound = 'c-2';
  h.ctl.pingFails['c-2'] = perr(401, 'Incorrect API key');
  const r = await m.listPassModels('u-1', h.deps);
  t('привʼязана, але ключ відхилено — типова інша', r.defaultModelId !== 'c-2' && r.defaultModelId !== null, String(r.defaultModelId));
  t('c-2 позначено key_rejected', r.models.find((x) => x.modelId === 'c-2')?.status === 'key_rejected');
}
{
  const h = harness();
  h.ctl.bound = 'custom-model-x';
  h.ctl.keys.gemini = 'k-gem';
  h.ctl.prices['custom-model-x'] = [1, 2];
  const r = await m.listPassModels('u-1', h.deps);
  t('привʼязана модель поза переліком чату теж кандидат', r.models.some((x) => x.modelId === 'custom-model-x'));
}
{
  const h = harness();
  h.ctl.keys.gpt = undefined;
  h.ctl.envReady.add('gpt');
  const r = await m.listPassModels('u-1', h.deps);
  t('ключ лише в змінній оточення — теж ключ', r.models.find((x) => x.modelId === 'o-1')?.usable === true);
}
{
  const h = harness();
  h.ctl.pingFails['g-1'] = perr(503, 'high demand');
  const r = await m.listPassModels('u-1', h.deps);
  const g = r.models.find((x) => x.modelId === 'g-1')!;
  t('перевантажена — busy, але придатна (є запасна)', g.status === 'busy' && g.usable === true);
  t('ok-модель пропонується типовою замість перевантаженої', r.defaultModelId !== 'g-1');
}
{
  const h = harness();
  for (const id of ['g-1', 'g-lite', 'c-1', 'c-2']) h.ctl.pingFails[id] = perr(402, 'no money');
  h.ctl.keys.gpt = undefined;
  const r = await m.listPassModels('u-1', h.deps);
  t('жодної придатної — типової немає', r.defaultModelId === null && r.models.every((x) => !x.usable));
}

console.log('Запасна модель Gemini');
{
  const h = harness();
  h.ctl.pingFails['g-1'] = perr(429, 'RESOURCE_EXHAUSTED: quota exceeded for metric');
  const r = await m.listPassModels('u-1', h.deps);
  const g = r.models.find((x) => x.modelId === 'g-1')!;
  t('квоту основної вичерпано, запасна жива — придатна (busy) з поясненням', g.usable && g.status === 'busy' && /вичерпано/.test(g.note || '') && /g-lite/.test(g.note || ''), JSON.stringify(g));
  t('запасну перевіряли тим самим ключем', h.pings.includes('g-lite:k-gem'));
}
{
  const h = harness();
  h.ctl.pingFails['g-1'] = perr(503, 'high demand');
  h.ctl.pingFails['g-lite'] = perr(503, 'high demand');
  const r = await m.listPassModels('u-1', h.deps);
  const g = r.models.find((x) => x.modelId === 'g-1')!;
  t('запасна теж не відповідає — лишається busy (придатна) без обіцянки запасної', g.status === 'busy' && g.usable && !/запасну/.test(g.note || ''));
}
{
  const h = harness();
  h.ctl.pingFails['g-1'] = perr(429, 'quota exceeded, billing');
  h.ctl.pingFails['g-lite'] = perr(429, 'quota exceeded, billing');
  const r = await m.listPassModels('u-1', h.deps);
  const g = r.models.find((x) => x.modelId === 'g-1')!;
  t('квота вичерпана й на запасній — no_funds, не придатна', g.status === 'no_funds' && !g.usable);
}
{
  const h = harness();
  h.ctl.pingFails['g-1'] = perr(401, 'API key not valid');
  const r = await m.listPassModels('u-1', h.deps);
  t('ключ відхилено — запасну не пробуємо (ключ той самий)', !h.pings.some((p) => p.startsWith('g-lite')) && r.models.find((x) => x.modelId === 'g-1')!.status === 'key_rejected');
}
{
  const h = harness();
  h.ctl.pingFails['c-1'] = perr(503, 'busy');
  await m.listPassModels('u-1', h.deps);
  t('запасні Gemini не підмінюють інші рушії', !h.pings.some((p) => p.startsWith('g-lite')));
}

console.log('\nКеш перевірки');
{
  const h = harness();
  await m.listPassModels('u-1', h.deps);
  const first = h.pings.length;
  await m.listPassModels('u-1', h.deps);
  t('повторне відкриття — без нових запитів до провайдера', h.pings.length === first, `${first} → ${h.pings.length}`);
  h.clock.now += m.PROBE_TTL_OK_MS + 1;
  await m.listPassModels('u-1', h.deps);
  t('після TTL — перевіряє знову', h.pings.length === first * 2, String(h.pings.length));
}
{
  const h = harness();
  await m.listPassModels('u-1', h.deps);
  const first = h.pings.length;
  h.ctl.keys.gemini = 'k-gem-NEW';
  await m.listPassModels('u-1', h.deps);
  t('змінили ключ у адмінці — перевіряється заново лише цей рушій', h.pings.length === first + 1 && h.pings[h.pings.length - 1] === 'g-1:k-gem-NEW', h.pings.slice(first).join());
}
{
  const h = harness();
  h.ctl.pingFails['g-1'] = perr(503, 'busy');
  await m.listPassModels('u-1', h.deps);
  const n = h.pings.filter((p) => p.startsWith('g-1')).length;
  h.ctl.pingFails['g-1'] = undefined;
  h.clock.now += m.PROBE_TTL_BUSY_MS + 1;
  const r = await m.listPassModels('u-1', h.deps);
  t('зайнята перевіряється вже за хвилину й одужує', h.pings.filter((p) => p.startsWith('g-1')).length === n + 1 && r.models.find((x) => x.modelId === 'g-1')?.status === 'ok');
}
{
  const h = harness();
  const slow = new Promise<void>((res) => setTimeout(res, 30));
  let started = 0;
  const deps = { ...h.deps, ping: async () => { started++; await slow; } };
  m.resetModelProbeCache();
  await Promise.all([m.listPassModels('u-1', deps), m.listPassModels('u-2', deps)]);
  t('два екрани одночасно — один запит на модель', started === 3, String(started));
}

console.log('\nБали за прохід');
{
  const rate = { inputPerMillionUsd: 1, outputPerMillionUsd: 4 };
  const quote = m.quotePass('gemini-3.7-flash', { inputTokens: 2000, outputTokens: 1000, maxOutputTokens: 8192 }, { rate: () => rate });
  t('є квота', !!quote);
  const expectedUsd = (2000 * 1 + 1000 * 4) / 1_000_000;
  t('очікувана собівартість — за тарифом моделі', !!quote && Math.abs(quote.expectedUsd - expectedUsd) < 1e-12);
  t('бали = creditsForCostUsd (маржа з адмінки)', !!quote && quote.expectedCredits === creditPricing.creditsForCostUsd(expectedUsd), JSON.stringify(quote));
  t('резерв не менший за очікуване', !!quote && quote.maxCredits >= quote.expectedCredits && quote.maxUsd > quote.expectedUsd);
  t('невідома ціна — null', m.quotePass('x', { inputTokens: 1, outputTokens: 1, maxOutputTokens: 1 }, { rate: () => ({ inputPerMillionUsd: null, outputPerMillionUsd: 1 }) }) === null);
  const dear = m.quotePass('x', { inputTokens: 2000, outputTokens: 1000, maxOutputTokens: 8192 }, { rate: () => ({ inputPerMillionUsd: 15, outputPerMillionUsd: 75 }) })!;
  t('дорожча модель — більше балів', dear.expectedCredits > quote!.expectedCredits);
}

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
