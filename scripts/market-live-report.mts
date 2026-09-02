/**
 * Живий прогін King Market Intelligence: справжній виклик моделі, справжній
 * запис у базу студії. Запуск:
 *
 *   npx tsx scripts/market-live-report.mts "літаки своїми руками" 10 [modelId]
 *
 * ЦЕ НЕ ЧАСТИНА `npm test`. Скрипт ходить у мережу й витрачає гроші на
 * токени, тому запускається вручну. Автоматичні тести модуля — у
 * `scripts/test-market.mts`, вони працюють із підставною моделлю й офлайн.
 *
 * Пише в ту саму базу, що й застосунок (DATA_DIR/DATABASE_PATH з .env), тож
 * після прогону звіт видно на сторінці «Аналітика ринку» в студії.
 *
 * ПРО ПРИРОДУ ДАНИХ. Etsy Open API тут не задіяний (без ETSY_API_KEY), тому
 * все, що видасть цей звіт, — оцінка мовної моделі, а не факти про конкретні
 * лістинги Etsy. Скрипт друкує це застереження в кінці навмисне: звіт, який
 * читають без нього, шкідливіший за відсутність звіту.
 */
import 'dotenv/config';

const [, , topicArg, countArg, modelArg] = process.argv;
const topic = (topicArg || '').trim();
const count = Math.min(25, Math.max(1, Number(countArg) || 10));
if (!topic) {
  console.error('Вкажіть тему: npx tsx scripts/market-live-report.mts "літаки своїми руками" 10');
  process.exit(2);
}

const store = await import('../server/store');
const registry = await import('../server/coreAiRegistry');
const providers = await import('../server/chatProviders');
const aiCore = await import('../server/aiCore');
const promptMod = await import('../server/market/marketScreenPrompt');
const service = await import('../server/market/marketService');
const marketStore = await import('../server/market/marketStore');
const types = await import('../server/market/marketTypes');

await store.initStore();

const modelId = modelArg || (await marketStore.getScreenModelId()) || 'claude-sonnet-5';
const engine = providers.resolveEngine(modelId);
if (!providers.engineConfigured(engine)) {
  console.error(`Рушій «${engine}» не налаштований: бракує ${providers.ENGINE_ENV_KEY[engine]} у .env`);
  process.exit(3);
}

console.log(`Тема: «${topic}», позицій: ${count}, модель: ${modelId} (${engine})\n`);

const fakeReq: any = {
  principal: { id: 'cli-live-run', email: 'cli@local', role: 'admin', isGuest: false },
};

/**
 * Обхід для середовищ без вихідної мережі: якщо задано MARKET_SCREEN_FIXTURE,
 * замість виклику провайдера читається відповідь моделі з файлу. Проходить
 * рівно той самий шлях розбору й нормалізації, що й жива відповідь, — тобто
 * перевіряє весь конвеєр, крім самого HTTP-виклику. Природа даних від цього
 * не змінюється: це так само оцінка мовної моделі, і звіт так само несе
 * позначку ESTIMATED.
 */
const FIXTURE = process.env.MARKET_SCREEN_FIXTURE;

const screen = async (p: { topic: string; count: number }) => {
  const template = registry.resolveCoreTemplate('etsyMarketScreen', {});
  const rendered = registry.renderCoreTemplate('etsyMarketScreen', template, {
    topic: p.topic,
    count: String(p.count),
    language: 'українська',
  });
  const t0 = Date.now();
  if (FIXTURE) {
    const text = (await import('node:fs')).readFileSync(FIXTURE, 'utf-8');
    console.log(`  відповідь моделі взято з файлу ${FIXTURE} (мережу не задіяно)`);
    const rawFx = promptMod.parseMarketScreenResponse(text);
    const listingsFx = promptMod.normalizeMarketScreenResult(rawFx, {
      topicKey: p.topic, collectedAt: new Date().toISOString(), limit: p.count,
    });
    return {
      listings: listingsFx,
      provenance: {
        source: 'ai_screen' as const,
        status: 'ESTIMATED' as const,
        confidence: listingsFx.length
          ? listingsFx.reduce((a, l) => a + l.provenance.confidence, 0) / listingsFx.length : 0,
        unavailable: [],
      },
      modelId: `${modelId} (fixture)`,
      engine,
      rawResponse: text,
    };
  }
  const out = await aiCore.generateText({
    engine: engine as never,
    modelId,
    prompt: rendered.user,
    systemInstruction: rendered.system,
    json: true,
    req: fakeReq,
    label: 'King Market Intelligence: живий скринінг (CLI)',
  });
  console.log(`  модель відповіла за ${((Date.now() - t0) / 1000).toFixed(1)} с, ` +
    `${out.inputTokens} → ${out.outputTokens} токенів`);
  const raw = promptMod.parseMarketScreenResponse(out.text);
  const listings = promptMod.normalizeMarketScreenResult(raw, {
    topicKey: p.topic,
    collectedAt: new Date().toISOString(),
    limit: p.count,
  });
  return {
    listings,
    provenance: {
      source: 'ai_screen' as const,
      status: 'ESTIMATED' as const,
      confidence: listings.length
        ? listings.reduce((a, l) => a + l.provenance.confidence, 0) / listings.length
        : 0,
      unavailable: [],
    },
    modelId,
    engine,
    rawResponse: out.text,
  };
};

// Помилку провайдера ловимо самі: без цього необроблена відмова валить
// процес стеком у консоль, а на Windows ще й тягне за собою асерт libuv при
// різкому виході — і причина губиться серед шуму.
let run;
try {
  run = await service.runMarketScreen(
    { topic, count, userId: 'cli-live-run', modelId, force: true, req: fakeReq },
    { screen: screen as never }
  );
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nСкринінг не вдався: ${msg}`);
  if (/prefill/i.test(msg)) {
    console.error('Модель не приймає режим JSON через підкладену репліку асистента. ' +
      'Оновіть server/chatProviders.ts або оберіть іншу модель третім аргументом.');
  } else if (/401|403|Unauthorized/i.test(msg)) {
    console.error(`Перевірте ключ провайдера «${engine}» у .env.`);
  }
  process.exit(1);
}

const r = run.report;
console.log(`\nЗвіт зібрано: ${r.items.length} позицій із ${r.requestedCount} запитаних.`);
console.log(`Джерело: ${r.provenance.source} / ${r.provenance.status}, модель ${r.modelId}\n`);

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
const numOr = (v: number | null, d = 0) => (v === null ? '—' : v.toFixed(d));
console.log(pad('#', 3) + pad('Товар', 42) + pad('Магазин', 20) +
  pad('Ціна$', 8) + pad('Відг.', 7) + pad('Рейт.', 7) + pad('Попул.', 8) + 'Opportunity');
console.log('-'.repeat(103));
r.items.forEach((item, i) => {
  console.log(
    pad(String(i + 1), 3) +
    pad(item.listing.title, 42) +
    pad(item.listing.shopName || '—', 20) +
    pad(numOr(item.listing.priceUsd, 2), 8) +
    pad(numOr(item.listing.reviewCount), 7) +
    pad(numOr(item.listing.rating, 1), 7) +
    pad(item.popularity.toFixed(0), 8) +
    item.opportunity.score.toFixed(1)
  );
});

const a = r.aggregate;
console.log(`\nЗведення: ціна сер. ${numOr(a.avgPriceUsd, 2)} / мед. ${numOr(a.medianPriceUsd, 2)} ` +
  `(діапазон ${numOr(a.minPriceUsd, 2)}–${numOr(a.maxPriceUsd, 2)}), ` +
  `відгуків сер. ${numOr(a.avgReviewCount)}, Opportunity сер. ${numOr(a.avgOpportunity, 1)}, ` +
  `нових ${a.newCount}, зростає ${a.risingCount}, спадає ${a.decliningCount}`);

if (r.keywordCandidates.length) {
  console.log('Ключові слова: ' + r.keywordCandidates.slice(0, 12).map((k) => k.phrase).join(', '));
}

const top = r.items[0];
if (top) {
  console.log(`\nРозклад Opportunity для «${top.listing.title}» (${top.opportunity.score.toFixed(2)}):`);
  for (const b of top.opportunity.breakdown) {
    console.log(`  ${pad(b.component, 16)} сире ${pad(b.raw.toFixed(1), 7)} × ${pad(b.weight + '%', 6)} = ` +
      `${pad(b.contribution.toFixed(2), 7)} ${b.basisUk}`);
  }
  const sum = top.opportunity.breakdown.reduce((s, b) => s + b.contribution, 0);
  console.log(`  сума доданків = ${sum.toFixed(2)} (має дорівнювати балу)`);
  if (top.opportunity.missing.length) {
    console.log(`  без даних (узято нейтральними): ${top.opportunity.missing.join(', ')}`);
  }
}

console.log(`\n${'!'.repeat(70)}\n${r.disclaimerUk}\n${'!'.repeat(70)}`);
console.log(`\nЗбережено в базу студії. Тем у журналі: ${(await marketStore.listTrackedTopics()).length}.`);
void types;
