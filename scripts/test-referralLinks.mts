/**
 * Реферальні посилання зі знижкою. Запуск: npm run test:referral-links
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Посилання обіцяє покупцеві знижку, а гроші рахує
 * вітрина. Між цими двома реченнями й лежать усі способи зламати задачу:
 *
 *  1. ЗНИЖКА ПОЗА МЕЖАМИ. Відсоток приходить із браузера. 101% або -5 —
 *     це не «дивне число», а ціна, нижча за нуль, або подарунок понад товар.
 *  2. НУЛЬ — НЕ КОД. Промокод «−0%» нічого не робить, але назавжди лишається
 *     в переліку вітрини. Тому при 0% код не створюється зовсім, а посилання
 *     йде з `?ref=` — міткою джерела, яку вітрина вже розуміє.
 *  3. ПОСИЛАННЯ ВЕДЕ НЕ ТУДИ. Адреса мосту (`api.…`) — службова; покупець має
 *     потрапити на сторінку товару (`www.…/catalog/<slug>`), і без редиректу.
 *  4. ТОВАР, ЯКОГО НЕМАЄ У ВІТРИНІ. Перелік для вибору береться з журналу
 *     публікацій (#554) — лише вдалі публікації, що мають slug.
 *  5. ВІТРИНА ЩЕ НЕ ВМІЄ. Поки маршрут мосту не розгорнуто, відповідь має
 *     казати це прямо, а не «щось пішло не так».
 */
const DIR = '/tmp/nova-referral-links-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
// Ключ мосту лежить у базі зашифрованим; без цього секрета його не зберегти.
process.env.USER_API_KEY_SECRET = 'test-secret-for-referral-links';

import fs from 'node:fs';
import express from 'express';
import type { AddressInfo } from 'node:net';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const pub = await import('../server/storefrontPublications');
const bridge = await import('../server/marketplaceBridge');
const admin = await import('../server/adminRoutes');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

// ---------------------------------------------------------------------------
console.log('\nКлієнт мосту');
const settings = { url: 'https://api.example.test', key: 'bridge-secret' } as never;
{
  const calls: Array<{ url: string; method: string; body: any; key: string | undefined }> = [];
  const fakeFetch = (async (url: string, init: any = {}) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined, key: init?.headers?.['x-bridge-key'] });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'p1', code: 'BLOHERY-7F3A', type: 'percent', value: 25, maxRedemptions: null, redemptionCount: 0, active: true, expiresAt: null, createdAt: '2026-11-14T08:00:00.000Z' }) };
  }) as never;

  const made = await bridge.createBridgePromoCode({ code: 'blohery-7f3a', percent: 25 }, { fetch: fakeFetch, settings });
  t('створення йде на /bridge/promo-codes із ключем мосту', calls[0].url.endsWith('/bridge/promo-codes') && calls[0].method === 'POST' && calls[0].key === 'bridge-secret');
  t('тип завжди percent, значення — відсоток', calls[0].body.type === 'percent' && calls[0].body.value === 25);
  t('порожні обмеження не передаються', !('maxRedemptions' in calls[0].body) && !('expiresAt' in calls[0].body));
  t('повертає код вітрини', made.code === 'BLOHERY-7F3A');

  await bridge.createBridgePromoCode({ code: 'X-1', percent: 10, maxRedemptions: 5, expiresAt: '2026-12-01' }, { fetch: fakeFetch, settings });
  t('обмеження передаються, коли задані', calls[1].body.maxRedemptions === 5 && calls[1].body.expiresAt === '2026-12-01');

  const notDeployed = (async () => ({ ok: false, status: 404, text: async () => 'Cannot POST /bridge/promo-codes' })) as never;
  let message = '';
  try {
    await bridge.createBridgePromoCode({ code: 'A-1', percent: 10 }, { fetch: notDeployed, settings });
  } catch (err) {
    message = String((err as Error).message);
  }
  t('вітрина без маршруту — зрозуміла відмова, а не «щось пішло не так»', /розгорніть маркетплейс/i.test(message), message);

  const rejectedKey = (async () => ({ ok: false, status: 401, text: async () => 'no' })) as never;
  let kindOf = '';
  try {
    await bridge.listBridgePromoCodes({ fetch: rejectedKey, settings });
  } catch (err) {
    kindOf = (err as { kind?: string }).kind || '';
  }
  t('чужий ключ — unauthorized, не «unreachable»', kindOf === 'unauthorized', kindOf);
}

// ---------------------------------------------------------------------------
console.log('\nМаршрути адмінки');
await (await import('../server/store')).initStore();
const storeMod = await import('../server/store');
await storeMod.saveUser({ id: 'u-admin', email: 'a@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as never);

// Журнал публікацій — джерело переліку товарів, на які можна дати посилання.
pub.recordPublication({ kind: 'book', sourceId: 'BK-1', status: 'ok', externalId: 'book:BK-1', slug: 'katalog-styliv', title: 'Каталог стилів' });
pub.recordPublication({ kind: 'book', sourceId: 'BK-2', status: 'failed', error: 'міст відмовив', title: 'Невдала' });
pub.recordPublication({ kind: 'course', sourceId: 'C-1', status: 'ok', externalId: 'course:C-1', slug: null, title: 'Курс без slug' });

const bridgeCalls: Array<{ url: string; method: string; body: any }> = [];
let bridgeAnswer: () => { ok: boolean; status: number; text: () => Promise<string> } = () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ id: 'p9', code: 'BLOHERY-7F3A', type: 'percent', value: 30, maxRedemptions: null, redemptionCount: 0, active: true, expiresAt: null, createdAt: '2026-11-14T08:00:00.000Z' }),
});
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any = {}) => {
  const target = String(url);
  if (target.includes('/bridge/promo-codes')) {
    bridgeCalls.push({ url: target, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    if ((init?.method || 'GET') === 'GET') {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'p9', code: 'OLD-1', type: 'percent', value: 10, maxRedemptions: 3, redemptionCount: 1, active: true, expiresAt: null, createdAt: '2026-11-14T08:00:00.000Z' }]) };
    }
    return bridgeAnswer();
  }
  return realFetch(url as never, init);
}) as never;

await (await import('../server/marketplaceBridge')).saveBridgeSettings({ url: 'https://api.example.test', key: 'bridge-secret' });

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.principal = { id: 'u-admin', email: 'a@test.ua', role: 'admin', isGuest: false };
  next();
});
admin.registerAdminRoutes(app);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, body?: unknown) => {
  const res = await realFetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

try {
  const list = await call('GET', '/api/admin/referral-links');
  t('перелік товарів — лише вдалі публікації зі slug', list.status === 200 && list.body.listings.length === 1 && list.body.listings[0].slug === 'katalog-styliv', JSON.stringify(list.body.listings));
  t('коди вітрини видно', list.body.codes?.[0]?.code === 'OLD-1');
  t('адреса вітрини — публічна, не адреса мосту', String(list.body.storefrontUrl).includes('fusionlab.in.ua') && !String(list.body.storefrontUrl).includes('api.'), list.body.storefrontUrl);

  const made = await call('POST', '/api/admin/referral-links', { slug: 'katalog-styliv', percent: 30, label: 'Блогери' });
  t('посилання веде на сторінку товару з промокодом', made.status === 200 && made.body.url === 'https://www.fusionlab.in.ua/catalog/katalog-styliv?promo=BLOHERY-7F3A&ref=BLOHERY-7F3A', made.body.url);
  t('код узято з вітрини, а не вигадано тут', made.body.code === 'BLOHERY-7F3A');
  t('назву кирилицею перетворено на латинський код', /^[A-Z0-9-]+$/.test(bridgeCalls.at(-1)!.body.code), bridgeCalls.at(-1)!.body.code);

  const zero = await call('POST', '/api/admin/referral-links', { slug: 'katalog-styliv', percent: 0, label: 'Розсилка' });
  const callsBefore = bridgeCalls.length;
  t('нуль відсотків — посилання без промокоду', zero.status === 200 && zero.body.code === null && zero.body.url.includes('?ref=') && !zero.body.url.includes('promo='), zero.body.url);
  t('нуль відсотків НЕ створює код у вітрині', bridgeCalls.filter((c) => c.method === 'POST').length === callsBefore - 1 + 0 || bridgeCalls.at(-1)!.method !== 'POST');

  for (const bad of [101, -5, 12.5, Number.NaN]) {
    const res = await call('POST', '/api/admin/referral-links', { slug: 'katalog-styliv', percent: bad });
    t(`знижка ${bad} відхилена`, res.status === 400, String(res.status));
  }
  t('без товару — 400', (await call('POST', '/api/admin/referral-links', { percent: 10 })).status === 400);

  bridgeAnswer = () => ({ ok: false, status: 404, text: async () => 'Cannot POST' });
  const notDeployed = await call('POST', '/api/admin/referral-links', { slug: 'katalog-styliv', percent: 15 });
  t('вітрина без маршруту — помилка з поясненням, що робити', notDeployed.status >= 400 && /розгорніть маркетплейс/i.test(String(notDeployed.body.error)), String(notDeployed.body.error));
} finally {
  server.close();
  globalThis.fetch = realFetch;
}

// ---------------------------------------------------------------------------
console.log('\nПанель в адмінці');
{
  const src = fs.readFileSync(new URL('../src/components/AdminReferralLinksPanel.tsx', import.meta.url), 'utf8');
  t('панель читає й створює через власний маршрут', src.includes("'/api/admin/referral-links'") && src.includes("method: 'POST'"));
  t('відсоток обмежено 0–100 уже в полі', src.includes('Math.max(0, Math.min(100,'));
  t('посилання можна скопіювати', src.includes('navigator.clipboard.writeText'));
  t('видно, скільки разів код уже використали', src.includes('redemptionCount'));
  const products = fs.readFileSync(new URL('../src/components/AdminProductsView.tsx', import.meta.url), 'utf8');
  t('панель стоїть у «Управлінні товарами»', products.includes('<AdminReferralLinksPanel />'));
}

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
