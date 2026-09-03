/**
 * Тести скринінгу через офіційний Etsy Open API v3.
 * Запуск: npm run test:etsy-screen
 *
 * МЕРЕЖІ ТУТ НЕМАЄ. Клієнт приймає `fetchImpl` ззовні, тож підставляємо
 * власну функцію й перевіряємо переклад справжньої відповіді Etsy у
 * `MarketListing` — без ключа, без квоти й без залежності від того, що саме
 * Etsy сьогодні продає.
 *
 * ЩО САМЕ ПЕРЕВІРЯЄТЬСЯ І ЧОМУ. Реальне джерело спокушає сильніше за модель:
 * дані «справжні», тож хочеться показати їх усі. Тому головні перевірки —
 * не «поля переклались», а те, що адаптер НЕ прикрашає джерело:
 *  1. ціна в чужій валюті стає null, а не «доларом» із тим самим числом;
 *  2. рейтинг і відгуки, яких у видачі немає, лишаються null і потрапляють
 *     в `unavailable`, а не добираються звідкись;
 *  3. `totalActive` береться з `count` Etsy — і 0 лишається нулем, бо
 *     «жодного товару за запитом» це факт, а не брак даних;
 *  4. порядок відповіді зберігається: він і є пошукова позиція.
 */
import { createTokenBucket } from '../server/etsy/rateLimiter';
import { createEtsyClient } from '../server/etsy/etsyClient';
import {
  createdAtOf,
  priceUsdStrict,
  screenViaEtsyApi,
  toMarketListing,
  EtsyScreenUnavailable,
} from '../server/market/etsyScreen';
import { computeOpportunityScore } from '../server/market/marketScoring';
import { DEFAULT_SCORE_WEIGHTS } from '../server/market/marketTypes';

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

/** Фрагмент справжньої відповіді /application/listings/active. */
const rawListing = (over: Record<string, unknown> = {}) => ({
  listing_id: 1234567890,
  title: 'Handmade Ceramic Coffee Mug with Botanical Glaze',
  state: 'active',
  quantity: 12,
  price: { amount: 3400, divisor: 100, currency_code: 'USD' },
  num_favorers: 512,
  tags: ['ceramic mug', 'handmade pottery', 'cozy kitchen'],
  materials: ['stoneware', 'glaze'],
  creation_timestamp: 1_700_000_000,
  taxonomy_id: 1633,
  shop_id: 42,
  ...over,
});

console.log('Ціна: код валюти не можна ігнорувати');
{
  t('USD → число', priceUsdStrict(rawListing()) === 34);
  t('EUR → null, а не «$34»',
    priceUsdStrict(rawListing({ price: { amount: 3400, divisor: 100, currency_code: 'EUR' } })) === null);
  t('GBP → null',
    priceUsdStrict(rawListing({ price: { amount: 999, divisor: 100, currency_code: 'GBP' } })) === null);
  t('дільник, відмінний від 100', priceUsdStrict({ price: { amount: 340, divisor: 10, currency_code: 'USD' } }) === 34);
  t('немає ціни → null', priceUsdStrict({}) === null);
  t('зіпсована ціна → null', priceUsdStrict({ price: { amount: 'багато', divisor: 100, currency_code: 'USD' } }) === null);
  // Не про Infinity: `divisor || 100` мовчки підставляв сотню й видавав
  // упевнені $1.00 із зіпсованої відповіді.
  t('нульовий дільник → null, а не підставлені 100',
    priceUsdStrict({ price: { amount: 100, divisor: 0, currency_code: 'USD' } }) === null);
  t('відсутній дільник → звичні для Etsy 100',
    priceUsdStrict({ price: { amount: 3400, currency_code: 'USD' } }) === 34);
}

console.log('\nДата створення');
{
  t('unix-мітка → ISO', createdAtOf(rawListing())?.startsWith('2023-11-') === true, String(createdAtOf(rawListing())));
  t('немає мітки → null', createdAtOf({}) === null);
  t('сміття → null', createdAtOf({ creation_timestamp: 'вчора' }) === null);
}

console.log('\nПереклад лістинга');
{
  const listing = toMarketListing({
    raw: rawListing(),
    topicKey: 'ceramic mug',
    collectedAt: '2026-09-03T10:00:00.000Z',
  });
  t('id збережено', listing.externalId === '1234567890', String(listing.externalId));
  t('посилання можна відкрити й звірити',
    listing.url === 'https://www.etsy.com/listing/1234567890', String(listing.url));
  t('джерело — etsy_api', listing.provenance.source === 'etsy_api');
  t('впевненість 1: API не оцінює, він або дав, або ні', listing.provenance.confidence === 1);
  t('статус VERIFIED', listing.provenance.status === 'VERIFIED');
  t('ціна', listing.priceUsd === 34);
  t('«улюблені»', listing.favorers === 512);
  t('теги', listing.tags.length === 3);
  t('матеріали', listing.materials.length === 2);
  t('стан лістингу', listing.availability === 'active');

  // Головне: чого у видачі немає — того немає й у звіті.
  t('рейтинг лишився null', listing.rating === null);
  t('кількість відгуків лишилась null', listing.reviewCount === null);
  t('назва крамниці лишилась null', listing.shopName === null);
  t('категорія лишилась null, а не «taxonomy:1633»', listing.category === null);
  for (const field of ['rating', 'reviewCount', 'shopName', 'category']) {
    t(`«${field}» названо в unavailable`, listing.provenance.unavailable.includes(field));
  }

  const eur = toMarketListing({
    raw: rawListing({ price: { amount: 3000, divisor: 100, currency_code: 'EUR' } }),
    topicKey: 'ceramic mug',
    collectedAt: '2026-09-03T10:00:00.000Z',
  });
  t('ціна в євро → null і в unavailable',
    eur.priceUsd === null && eur.provenance.unavailable.includes('priceUsd'));

  const bare = toMarketListing({ raw: { listing_id: 7, title: 'X' }, topicKey: 'k', collectedAt: 'now' });
  t('лістинг без жодного корисного поля → UNAVAILABLE',
    bare.provenance.status === 'UNAVAILABLE', bare.provenance.status);
}

console.log('\nЗбір через підставний fetch');
{
  const calls: string[] = [];
  const makeClient = (payload: unknown, status = 200) =>
    createEtsyClient({
      apiKey: 'test-key',
      bucket: createTokenBucket({ capacity: 8, ratePerSecond: 8 }),
      getAccessToken: async () => '',
      log: () => {},
      fetchImpl: (async (url: string) => {
        calls.push(String(url));
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(payload),
        };
      }) as any,
    });

  const client = makeClient({
    count: 18432,
    results: [rawListing({ listing_id: 1, title: 'Перший' }), rawListing({ listing_id: 2, title: 'Другий' })],
  });

  const result = await screenViaEtsyApi(
    { getClient: () => client, now: () => new Date('2026-09-03T10:00:00.000Z'), log: () => {} },
    { topic: 'ceramic mug', count: 10 }
  );

  t('один запит на скринінг, без зайвого гортання', calls.length === 1, String(calls.length));
  t('пошук іде за ключовими словами', calls[0].includes('keywords=ceramic'), calls[0]);
  t('просимо власне ранжування Etsy', calls[0].includes('sort_on=score'), calls[0]);
  t('ліміт дорівнює запитаній кількості', calls[0].includes('limit=10'), calls[0]);
  t('зібрано обидва лістинги', result.listings.length === 2);
  t('порядок відповіді збережено — він і є позиція',
    result.listings[0].title === 'Перший' && result.listings[1].title === 'Другий');
  t('справжній обсяг ніші взято з count', result.totalActive === 18432, String(result.totalActive));
  t('походження набору — etsy_api', result.provenance.source === 'etsy_api');
  t('поля, яких немає в жодного товару, названі в unavailable набору',
    result.provenance.unavailable.includes('rating') && result.provenance.unavailable.includes('reviewCount'),
    result.provenance.unavailable.join(','));
  t('модель не згадується: жодних modelId/engine',
    result.modelId === undefined && result.engine === undefined);

  const empty = await screenViaEtsyApi(
    { getClient: () => makeClient({ count: 0, results: [] }), log: () => {} },
    { topic: 'ніша, якої немає', count: 10 }
  );
  t('порожня ніша: 0 лишається нулем, а не null',
    empty.totalActive === 0, String(empty.totalActive));
  t('порожня ніша: набір позначено UNAVAILABLE',
    empty.provenance.status === 'UNAVAILABLE');

  let threw: unknown = null;
  try {
    await screenViaEtsyApi({ getClient: () => null }, { topic: 'x', count: 10 });
  } catch (err) {
    threw = err;
  }
  t('без ключа — зрозуміла відмова, а не падіння',
    threw instanceof EtsyScreenUnavailable && (threw as Error).message.includes('ETSY_API_KEY'),
    String((threw as Error)?.message).slice(0, 60));
}

console.log('\nCompetition рахується з реального обсягу ніші');
{
  const listing = toMarketListing({ raw: rawListing(), topicKey: 'k', collectedAt: 'now' });
  const base = {
    listing,
    dynamics: { snapshotCount: 1, reviewVelocity: null } as any,
    popularity: 50,
  };
  const ctx = { medianPriceUsd: 34, maxReviewCount: 0, maxFavorers: 512, sampleSize: 10 };

  const narrow = computeOpportunityScore(
    { ...base, context: { ...ctx, totalActive: 300 } }, DEFAULT_SCORE_WEIGHTS);
  const wide = computeOpportunityScore(
    { ...base, context: { ...ctx, totalActive: 120_000 } }, DEFAULT_SCORE_WEIGHTS);
  const noTotal = computeOpportunityScore({ ...base, context: ctx }, DEFAULT_SCORE_WEIGHTS);

  const comp = (r: any) => r.breakdown.find((b: any) => b.component === 'competition');
  t('вузька ніша отримує більше балів за конкуренцію',
    comp(narrow).raw > comp(wide).raw, `${comp(narrow).raw} > ${comp(wide).raw}`);
  t('120 000 лістингів — майже нуль балів', comp(wide).raw < 10, String(comp(wide).raw));
  t('підстава називає справжнє число',
    comp(narrow).basisUk.includes('300') && comp(narrow).basisUk.includes('активних'),
    comp(narrow).basisUk.slice(0, 70));
  t('без totalActive підстава чесно каже, що це сурогат',
    comp(noTotal).basisUk.includes('сурогат'), comp(noTotal).basisUk.slice(0, 80));
  t('дві шкали дають різні числа — інакше заміна була б безглузда',
    comp(noTotal).raw !== comp(wide).raw, `${comp(noTotal).raw} vs ${comp(wide).raw}`);

  // Бал і далі дорівнює сумі показаних доданків (ТЗ 28) — заміна шкали
  // не мала права цього зламати.
  const sum = narrow.breakdown.reduce((acc: number, b: any) => acc + b.contribution, 0);
  t('score = сума contribution', Math.abs(sum - narrow.score) < 0.5, `${sum} vs ${narrow.score}`);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
