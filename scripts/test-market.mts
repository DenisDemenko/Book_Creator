/**
 * Тести модуля King Market Intelligence. Запуск: npm run test:market
 *
 * ЩО САМЕ ТУТ ПЕРЕВІРЯЄТЬСЯ І ЧОМУ. Модуль будує ринкові показники не з
 * Etsy API (його тут нема), а зі скринінгу мовною моделлю. Тому цінність
 * має не «чи повертається число», а чи модуль НЕ бреше:
 *  1. вигаданий моделлю listing id або URL мусить бути стертий;
 *  2. відсутнє значення лишається null і потрапляє в `unavailable`,
 *     а не перетворюється на 0 — інакше товар без даних виглядав би як
 *     товар із нульовим попитом;
 *  3. один зріз дає trend 'unknown', а не 'stable' — «не знаємо» і «не
 *     змінилось» це різні факти;
 *  4. Opportunity Score дорівнює сумі власних показаних доданків (ТЗ 28);
 *  5. зрізи лише додаються, ніколи не перезаписуються (ТЗ 8);
 *  6. доступ закритий планом і роллю, а не лише сховане меню.
 *
 * Мережі тут нема взагалі: скринінг інжектується як `deps.screen`.
 */
const DIR = '/tmp/nova-market-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

// Ключ провайдера потрібен лише щоб пройти перевірку «чи налаштований
// рушій» — сам виклик моделі підставний, мережі в тестах нема.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-not-used';

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/store');
const types = await import('../server/market/marketTypes');
const scoring = await import('../server/market/marketScoring');
const prompt = await import('../server/market/marketScreenPrompt');
const marketStore = await import('../server/market/marketStore');
const service = await import('../server/market/marketService');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const snap = (over: Partial<any> = {}): any => ({
  id: `s-${Math.random().toString(36).slice(2)}`,
  productKey: 'k::a', topicKey: 'k', collectedAt: '2026-01-01T00:00:00.000Z',
  priceUsd: 30, reviewCount: 10, favorers: 5, rating: 4.5,
  availability: 'active', title: 'A', source: 'ai_screen', confidence: 0.6, ...over,
});

// ---------------------------------------------------------------------------
console.log('Розбір відповіді моделі:');
{
  t('чистий JSON', Array.isArray(prompt.parseMarketScreenResponse('[{"title":"x"}]') as any));
  t('JSON у ```json-огорожі', Array.isArray(
    prompt.parseMarketScreenResponse('```json\n[{"title":"x"}]\n```') as any));
  let threw = false;
  try { prompt.parseMarketScreenResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не повертає мотлох', threw);
}

console.log('\nНормалізація — межа довіри до моделі:');
{
  const raw = [
    { title: 'Літак з фанери', shopName: 'Shop', priceUsd: 42, currency: 'USD',
      rating: 4.8, reviewCount: 120, favorers: 300, tags: ['plane'], confidence: 1.7,
      listingId: '1234567890', url: 'https://www.etsy.com/listing/1234567890' },
    { title: 'Без ціни', reviewCount: 5, confidence: 0.4, unavailable: ['priceUsd'] },
    { shopName: 'Без назви' },
    { title: 'Літак з фанери', shopName: 'Дубль' },
  ];
  const out = prompt.normalizeMarketScreenResult(raw, {
    topicKey: 'literaky', collectedAt: '2026-09-02T10:00:00.000Z', limit: 10,
  });

  t('рядок без назви відкинуто', out.every((l) => l.title.trim().length > 0));
  t('дублікат злився за productKey', new Set(out.map((l) => l.productKey)).size === out.length);
  const first = out.find((l) => l.title === 'Літак з фанери')!;
  t('вигаданий externalId стерто', first.externalId === null, String(first.externalId));
  t('вигаданий URL стерто', first.url === null, String(first.url));
  t('confidence затиснуто в 0..1', first.provenance.confidence <= 1 && first.provenance.confidence >= 0,
    String(first.provenance.confidence));
  t('статус набору = ESTIMATED', first.provenance.status === 'ESTIMATED', first.provenance.status);
  t('джерело = ai_screen', first.provenance.source === 'ai_screen', first.provenance.source);
  t('firstSeenAt = момент збору', first.firstSeenAt === '2026-09-02T10:00:00.000Z');

  const noPrice = out.find((l) => l.title === 'Без ціни')!;
  t('відсутня ціна лишилась null, а НЕ 0', noPrice.priceUsd === null, String(noPrice.priceUsd));
  t('відсутня ціна названа в unavailable', noPrice.provenance.unavailable.includes('priceUsd'),
    noPrice.provenance.unavailable.join(','));

  const many = Array.from({ length: 30 }, (_, i) => ({ title: `Товар ${i}` }));
  t('ліміт дотримано', prompt.normalizeMarketScreenResult(many,
    { topicKey: 'k', collectedAt: '2026-01-01T00:00:00.000Z', limit: 10 }).length === 10);
}

console.log('\nДинаміка (ТЗ 9):');
{
  const one = scoring.computeDynamics([snap()]);
  t('один зріз → trend "unknown"', one.trend === 'unknown', one.trend);
  t('один зріз → trend НЕ "stable"', one.trend !== 'stable');
  t('один зріз → reviewGrowth null, а не 0', one.reviewGrowth === null, String(one.reviewGrowth));
  t('один зріз → velocity null', one.reviewVelocity === null);
  t('snapshotCount = 1', one.snapshotCount === 1);

  const older = snap({ collectedAt: '2026-01-01T00:00:00.000Z', reviewCount: 10, priceUsd: 30, favorers: 5 });
  const newer = snap({ collectedAt: '2026-01-11T00:00:00.000Z', reviewCount: 30, priceUsd: 36, favorers: 25 });
  const asc = scoring.computeDynamics([older, newer]);
  const desc = scoring.computeDynamics([newer, older]);
  t('приріст відгуків = 20', asc.reviewGrowth === 20, String(asc.reviewGrowth));
  t('приріст у % = 200', asc.reviewGrowthPct === 200, String(asc.reviewGrowthPct));
  t('днів між зрізами = 10', asc.daysBetween === 10, String(asc.daysBetween));
  t('швидкість = 2 відгуки/день', asc.reviewVelocity === 2, String(asc.reviewVelocity));
  t('зміна ціни = 6', asc.priceChange === 6, String(asc.priceChange));
  t('приріст «улюблених» = 20', asc.favoriteGrowth === 20, String(asc.favoriteGrowth));
  t('trend = rising', asc.trend === 'rising', asc.trend);
  t('порядок зрізів не впливає', JSON.stringify(asc) === JSON.stringify(desc));

  const zeroBase = scoring.computeDynamics([
    snap({ collectedAt: '2026-01-01T00:00:00.000Z', reviewCount: 0 }),
    snap({ collectedAt: '2026-01-11T00:00:00.000Z', reviewCount: 5 }),
  ]);
  t('нульова база → % = null, а не Infinity', zeroBase.reviewGrowthPct === null, String(zeroBase.reviewGrowthPct));
}

console.log('\nВаги та Opportunity Score (ТЗ 11, 28):');
{
  const norm = scoring.normalizeWeights({ demand: -50, growth: 30, competition: 30 } as any);
  const sum = Object.values(norm).reduce((a, b) => a + b, 0);
  t('відʼємна вага затиснута в 0', norm.demand === 0, String(norm.demand));
  t('сума ваг = рівно 100', Math.abs(sum - 100) < 1e-9, String(sum));
  const allZero = scoring.normalizeWeights({ demand: 0, growth: 0, competition: 0, pricePotential: 0, engagement: 0, saturation: 0, margin: 0 });
  t('усі нулі → заводські ваги', allZero.demand === types.DEFAULT_SCORE_WEIGHTS.demand);

  const listing = prompt.normalizeMarketScreenResult(
    [{ title: 'Літак', priceUsd: 40, reviewCount: 80, favorers: 200, rating: 4.7, confidence: 0.7 }],
    { topicKey: 'k', collectedAt: '2026-01-01T00:00:00.000Z', limit: 1 })[0];
  const dyn = scoring.computeDynamics([
    snap({ collectedAt: '2026-01-01T00:00:00.000Z', reviewCount: 60 }),
    snap({ collectedAt: '2026-01-11T00:00:00.000Z', reviewCount: 80 }),
  ]);
  const score = scoring.computeOpportunityScore(
    { listing, dynamics: dyn, popularity: 70,
      context: { medianPriceUsd: 35, maxReviewCount: 120, maxFavorers: 300, sampleSize: 10 } },
    types.DEFAULT_SCORE_WEIGHTS);
  const sumContrib = score.breakdown.reduce((a, b) => a + b.contribution, 0);
  t('бал = сумі власних доданків (відтворюваність)',
    Math.abs(score.score - Math.round(sumContrib * 100) / 100) < 0.02,
    `${score.score} vs ${sumContrib}`);
  t('усі 7 компонентів показані', score.breakdown.length === 7, String(score.breakdown.length));
  t('кожен доданок пояснений', score.breakdown.every((b) => b.basisUk.length > 0));

  const blind = scoring.computeOpportunityScore(
    { listing: { ...listing, reviewCount: null, favorers: null, rating: null, priceUsd: null },
      dynamics: scoring.computeDynamics([snap()]), popularity: 0,
      context: { medianPriceUsd: 0, maxReviewCount: 0, maxFavorers: 0, sampleSize: 0 } },
    types.DEFAULT_SCORE_WEIGHTS);
  t('без даних компоненти йдуть у missing', blind.missing.length > 0, String(blind.missing.length));
  t('відсутній компонент узятий нейтральним, не нулем',
    blind.breakdown.filter((b) => blind.missing.includes(b.component)).every((b) => b.raw > 0));
}

// ---------------------------------------------------------------------------
// Конвеєр. Двічі: спершу на JSON-фолбеку, потім на SQLite — числа мають збігтися.
// ---------------------------------------------------------------------------
function makeScreen(counter: { calls: number }, titles: string[], reviews: number[]) {
  const fn: any = async (p: any) => {
    counter.calls += 1;
    const collectedAt = new Date().toISOString();
    return {
      listings: prompt.normalizeMarketScreenResult(
        titles.map((title, i) => ({
          title, shopName: `Shop ${i}`, priceUsd: 20 + i * 5, currency: 'USD',
          rating: 4.5, reviewCount: reviews[i] ?? 10, favorers: 10 * (i + 1), confidence: 0.6,
        })),
        { topicKey: 'k', collectedAt, limit: p.count }),
      provenance: { source: 'ai_screen', status: 'ESTIMATED', confidence: 0.6, unavailable: [] },
      modelId: 'stub-model', engine: 'stub',
    };
  };
  return fn;
}

async function pipelineRun(label: string) {
  console.log(`\nКонвеєр (${label}):`);
  const counter = { calls: 0 };
  const titles = ['Літак А', 'Літак Б', 'Літак В'];
  const base = new Date('2026-09-02T10:00:00.000Z');
  let clock = base;
  const deps = { screen: makeScreen(counter, titles, [10, 20, 30]), now: () => clock, log: () => {} };

  const first = await service.runMarketScreen(
    { topic: 'літаки своїми руками', count: 3, userId: 'u-1', req: {} }, deps as any);
  t('перший прогін не з кешу', first.fromCache === false);
  t('модель викликано один раз', counter.calls === 1, String(counter.calls));
  t('у звіті 3 позиції', first.report.items.length === 3, String(first.report.items.length));
  t('звіт несе дисклеймер', first.report.disclaimerUk.length > 20);

  const cached = await service.runMarketScreen(
    { topic: 'літаки своїми руками', count: 3, userId: 'u-1', req: {} }, deps as any);
  t('повтор віддано з кешу', cached.fromCache === true);
  t('модель НЕ викликана вдруге', counter.calls === 1, String(counter.calls));

  const forced = await service.runMarketScreen(
    { topic: 'літаки своїми руками', count: 3, userId: 'u-1', force: true, req: {} }, deps as any);
  t('force обходить кеш', forced.fromCache === false && counter.calls === 2, String(counter.calls));

  clock = new Date(base.getTime() + 20 * 86400000);
  deps.screen = makeScreen(counter, titles, [40, 20, 30]);
  const later = await service.runMarketScreen(
    { topic: 'літаки своїми руками', count: 3, userId: 'u-1', force: true, req: {} }, deps as any);
  const grown = later.report.items.find((i) => i.listing.title === 'Літак А')!;
  t('історія накопичилась (≥3 зрізи)', grown.dynamics.snapshotCount >= 3, String(grown.dynamics.snapshotCount));
  t('динаміка порахувалась на історії', grown.dynamics.reviewGrowth === 30, String(grown.dynamics.reviewGrowth));
  t('trend вийшов з "unknown"', grown.dynamics.trend !== 'unknown', grown.dynamics.trend);

  const history = await service.productTrend(grown.listing.productKey);
  t('зрізи лише додаються, не перезаписуються', history.length >= 3, String(history.length));
  t('найдавніший зріз незмінний', history[0].reviewCount === 10, String(history[0].reviewCount));
  return later.report;
}

const jsonReport = await pipelineRun('JSON-фолбек');

console.log('\nПерехід на SQLite:');
await db.initDb();
const info = await store.initStore();
t('бекенд = sqlite', info.backend === 'sqlite', info.backend);
marketStore.__resetMarketCacheForTests();
const sqliteReport = await pipelineRun('SQLite');

console.log('\nОбидва бекенди дають однакові числа:');
{
  const a = jsonReport.items.map((i) => `${i.listing.title}:${i.opportunity.score}`).join('|');
  const b = sqliteReport.items.map((i) => `${i.listing.title}:${i.opportunity.score}`).join('|');
  t('бали збігаються', a === b, `${a} ≠ ${b}`);
  t('зведення збігається',
    jsonReport.aggregate.medianPriceUsd === sqliteReport.aggregate.medianPriceUsd);
}

// ---------------------------------------------------------------------------
console.log('\nДоступ до маршрутів (роль + тариф):');
{
  const express = (await import('express')).default;
  const routes = await import('../server/marketRoutes');

  let principal: any = { id: 'u-1', email: 'a@test.ua', name: 'Автор', role: 'writer', isGuest: false };
  let modelText = JSON.stringify([{ title: 'Літак', priceUsd: 30, reviewCount: 10, confidence: 0.5 }]);

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req: any, _res: any, next: any) => { req.principal = principal; next(); });
  routes.registerMarketRoutes(app, {
    resolveEngine: () => 'gemini',
    defaultModelId: 'stub-model',
    loadAdminLayer: async () => ({}),
    generateText: async () => ({ text: modelText, inputTokens: 1, outputTokens: 1 }),
  } as any);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as any).port;
  const call = async (method: string, path: string, body?: any) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* порожня відповідь */ }
    return { status: res.status, data };
  };

  principal = { ...principal, role: 'reader' };
  let r = await call('POST', '/api/market/screen', { topic: 'літаки своїми руками' });
  t('роль reader → 403', r.status === 403, String(r.status));

  principal = { ...principal, role: 'writer' };
  r = await call('POST', '/api/market/screen', { topic: 'літаки своїми руками' });
  t('writer на free → 403 plan_required', r.status === 403 && r.data?.kind === 'plan_required',
    `${r.status} ${r.data?.kind}`);

  const subs = await import('../server/subscriptions');
  await subs.activateSubscription('u-1', 'pro', 'monthly', 'liqpay', 'test');
  r = await call('POST', '/api/market/screen', { topic: 'літаки своїми руками', count: 2, force: true });
  t('writer на pro → 200', r.status === 200, `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`);
  t('звіт повернувся з позиціями', Array.isArray(r.data?.report?.items) && r.data.report.items.length > 0);

  r = await call('POST', '/api/market/screen', { topic: 'x'.repeat(200) });
  t('тема >120 символів → 400', r.status === 400, String(r.status));

  r = await call('POST', '/api/market/screen', { topic: 'дрони своїми руками', count: 999, force: true });
  t('count затиснуто до 25', r.status === 200 && r.data?.report?.requestedCount <= 25,
    String(r.data?.report?.requestedCount));

  modelText = 'вибачте, я не можу';
  r = await call('POST', '/api/market/screen', { topic: 'щось інше', force: true });
  t('не-JSON від моделі → 502 bad_model_output',
    r.status === 502 && r.data?.kind === 'bad_model_output', `${r.status} ${r.data?.kind}`);
  modelText = JSON.stringify([{ title: 'Літак', priceUsd: 30, reviewCount: 10, confidence: 0.5 }]);

  r = await call('PUT', '/api/market/settings', { weights: { demand: 50 } });
  t('PUT settings не для writer', r.status === 403, String(r.status));

  principal = { ...principal, role: 'admin' };
  r = await call('PUT', '/api/market/settings', { weights: { ...types.DEFAULT_SCORE_WEIGHTS, demand: 40 } });
  t('PUT settings для admin → 200', r.status === 200, String(r.status));
  r = await call('GET', '/api/market/settings');
  t('ваги збереглися й нормалізувались',
    r.status === 200 && Math.abs(Object.values(r.data.weights as Record<string, number>).reduce((a, b) => a + Number(b), 0) - 100) < 1e-9,
    JSON.stringify(r.data?.weights));

  server.close();
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
