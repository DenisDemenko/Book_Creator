/**
 * HTTP-тести модуля публікації. Запуск: npm run test:publishing-routes
 *
 * Піднімається справжній Express із зареєстрованими роутами, але Etsy
 * підставний: `fetchImpl` віддає заздалегідь відомі відповіді, тож тести не
 * потребують ані мережі, ані ключів, ані крамниці.
 *
 * На кожен ендпоінт — позитивний і негативний сценарій, як вимагає ТЗ:
 * 200/201/202 проти 400/401/404/409/503.
 */
const DIR = '/tmp/nova-publishing-routes-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.ETSY_TOKEN_SECRET = 'routes-test-secret-phrase';
delete process.env.ETSY_API_KEY;
delete process.env.ETSY_SHARED_SECRET;
delete process.env.ETSY_REDIRECT_URI;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/publishingStore');
const routes = await import('../server/publishingRoutes');
const account = await import('../server/etsy/etsyAccount');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

await db.initDb();

// ---------------------------------------------------------------------------
// Підставний Etsy
// ---------------------------------------------------------------------------
const etsyCalls: string[] = [];
const stubFetch = async (url: string, init: any) => {
  etsyCalls.push(`${init?.method || 'GET'} ${url}`);
  if (url.includes('/oauth/token')) {
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ access_token: '4242.aaa', refresh_token: '4242.rrr', expires_in: 3600 }),
    };
  }
  if (url.includes('/listings/active')) {
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        count: 1234,
        results: [
          { listing_id: 1, title: 'Watercolor journal printable pages', tags: ['watercolor', 'journal', 'printable pages'], num_favorers: 90, price: { amount: 1200, divisor: 100 } },
          { listing_id: 2, title: 'Watercolor sketchbook printable pages', tags: ['watercolor', 'printable pages'], num_favorers: 30, price: { amount: 800, divisor: 100 } },
          { listing_id: 3, title: 'Journal printable pages bundle', tags: ['journal', 'printable pages'], num_favorers: 10, price: { amount: 1000, divisor: 100 } },
        ],
      }),
    };
  }
  if (/\/shops$/.test(url)) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ results: [{ shop_id: 55, shop_name: 'NovaShop' }] }) };
  }
  if (/\/listings$/.test(url) && init?.method === 'POST') {
    return { ok: true, status: 201, text: async () => JSON.stringify({ listing_id: 9001, state: 'draft' }) };
  }
  return { ok: true, status: 200, text: async () => '{}' };
};

// ---------------------------------------------------------------------------
// Застосунок
// ---------------------------------------------------------------------------
let principal: any = { id: 'u-1', email: 'a@test.ua', name: 'Автор', role: 'writer', isGuest: false };

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use((req: any, _res, next) => { req.principal = principal; next(); });
routes.registerPublishingRoutes(app, {
  fetchImpl: stubFetch as any,
  appUrl: 'https://app.test',
  disableWorkers: true,
});

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const call = async (method: string, path: string, body?: any) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};

const upload = async (productId: string, name: string, content: string) => {
  const res = await fetch(`${base}/api/publishing/products/${productId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    body: Buffer.from(content, 'utf8'),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

// ---------------------------------------------------------------------------
console.log('KDP-ендпоінти:');
{
  const spec = await call('GET', '/api/publishing/kdp/spec');
  t('GET /kdp/spec → 200', spec.status === 200);
  t('специфікація містить три обов’язкові трим-розміри',
    ['5x8', '5.5x8.5', '6x9'].every((id: string) => spec.data.trimSizes.some((s: any) => s.id === id)));
  t('специфікація прямо каже про відсутність API в KDP', String(spec.data.noteUk).includes('API'));

  const cover = await call('POST', '/api/publishing/kdp/cover-spec', { trimId: '6x9', pageCount: 300, paper: 'white' });
  t('POST /kdp/cover-spec → 200', cover.status === 200);
  t('повертається корінець у міліметрах', cover.data.spineMm > 0);
  t('повертається розмір у пікселях за 300 dpi', cover.data.dpi >= 300 && cover.data.widthPx > 0);

  const coverBad = await call('POST', '/api/publishing/kdp/cover-spec', { trimId: '6x9' });
  t('без кількості сторінок → 400', coverBad.status === 400, String(coverBad.status));

  const valid = await call('POST', '/api/publishing/kdp/validate', {
    pageCount: 200, hasTableOfContents: true, headingLevels: [1, 2, 2],
  });
  t('POST /kdp/validate коректного рукопису → ok', valid.status === 200 && valid.data.ok === true);

  const invalid = await call('POST', '/api/publishing/kdp/validate', {
    pageCount: 10, hasTableOfContents: false, headingLevels: [],
  });
  t('замалий рукопис → ok:false зі списком проблем',
    invalid.status === 200 && invalid.data.ok === false && invalid.data.issues.length > 0);

  const meta = await call('POST', '/api/publishing/kdp/metadata', {
    title: 'Книга', description: 'Опис', keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    bisacCategories: ['FIC000000'], trimId: '6x9', pageCount: 200,
  });
  t('POST /kdp/metadata → 200 з готовим листом', meta.status === 200 && meta.data.text.includes('Книга'));

  const metaBad = await call('POST', '/api/publishing/kdp/metadata', { title: '', description: '', keywords: [], bisacCategories: [] });
  t('порожні метадані → перелік блокерів',
    metaBad.status === 200 && metaBad.data.issues.some((i: any) => i.severity === 'blocker'));
}

// ---------------------------------------------------------------------------
console.log('\nТовари:');
let productId = '';
{
  const created = await call('POST', '/api/publishing/products', {
    title: 'Акварельний набір', description: 'Опис набору', priceUsd: 12, type: 'course',
    tags: ['Watercolor!', 'journal', 'watercolor'],
  });
  t('POST /products → 201', created.status === 201, String(created.status));
  productId = created.data?.product?.id;
  t('товар отримав id', Boolean(productId));
  t('теги нормалізовано й дублі прибрано',
    created.data.product.tags.length === 2 && created.data.product.tags[0] === 'watercolor',
    JSON.stringify(created.data.product.tags));

  const noTitle = await call('POST', '/api/publishing/products', { description: 'без назви' });
  t('товар без назви → 400', noTitle.status === 400, String(noTitle.status));

  const list = await call('GET', '/api/publishing/products');
  t('GET /products → 200 зі списком', list.status === 200 && list.data.products.length === 1);

  const one = await call('GET', `/api/publishing/products/${productId}`);
  t('GET /products/:id → 200', one.status === 200 && one.data.product.id === productId);

  const updated = await call('PUT', `/api/publishing/products/${productId}`, { priceUsd: 15 });
  t('PUT /products/:id → 200 з новою ціною', updated.status === 200 && updated.data.product.priceUsd === 15);

  const missing = await call('GET', '/api/publishing/products/prod-nema');
  t('неіснуючий товар → 404', missing.status === 404, String(missing.status));

  // Чужий товар маскується під 404, щоб не підтверджувати існування id.
  principal = { id: 'u-2', email: 'b@test.ua', name: 'Інший', role: 'writer', isGuest: false };
  const foreign = await call('GET', `/api/publishing/products/${productId}`);
  t('чужий товар → 404 (не 403)', foreign.status === 404, String(foreign.status));
  const foreignDelete = await call('DELETE', `/api/publishing/products/${productId}`);
  t('видалити чужий товар не можна', foreignDelete.status === 404, String(foreignDelete.status));
  principal = { id: 'u-1', email: 'a@test.ua', name: 'Автор', role: 'writer', isGuest: false };

  principal = { id: null, role: 'guest', isGuest: true };
  const guest = await call('GET', '/api/publishing/products');
  t('гість → 401', guest.status === 401, String(guest.status));
  principal = { id: 'u-1', email: 'a@test.ua', name: 'Автор', role: 'writer', isGuest: false };
}

// ---------------------------------------------------------------------------
console.log('\nФайли товару й пакувальник:');
{
  const up = await upload(productId, 'lesson.txt', 'Урок перший');
  t('POST /files → 201', up.status === 201, String(up.status));
  t('розмір файлу повернуто', up.data?.file?.bytes === Buffer.byteLength('Урок перший'));

  await upload(productId, 'template.txt', 'Шаблон');

  const noName = await fetch(`${base}/api/publishing/products/${productId}/files`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x'),
  });
  t('завантаження без x-file-name → 400', noName.status === 400, String(noName.status));

  const files = await call('GET', `/api/publishing/products/${productId}/files`);
  t('GET /files → 200 з двома файлами', files.status === 200 && files.data.files.length === 2);

  // Ім'я з підйомом угору по дереву не має вивести за межі теки товару.
  await upload(productId, '../../evil.txt', 'спроба втечі');
  const afterEvil = await call('GET', `/api/publishing/products/${productId}/files`);
  t('спроба вийти за теку товару знешкоджена',
    afterEvil.data.files.every((f: any) => !f.name.includes('..')) &&
      !fs.existsSync(`${DIR}/evil.txt`),
    JSON.stringify(afterEvil.data.files.map((f: any) => f.name)));

  const analyze = await call('POST', `/api/publishing/products/${productId}/bundle/analyze`, {
    fileNames: ['lesson.txt', 'template.txt'],
  });
  t('POST /bundle/analyze → 200', analyze.status === 200);
  t('дрібний набір рекомендує сценарій Б', analyze.data.recommendation.scenario === 'B');

  const packed = await call('POST', `/api/publishing/products/${productId}/bundle/package`, {
    fileNames: ['lesson.txt', 'template.txt'],
  });
  t('POST /bundle/package → 201', packed.status === 201, String(packed.status));
  t('архів записано у файли товару', packed.data.file.name.endsWith('.zip'));
  t('у товарі зафіксовано bundleZip', packed.data.product.exportFiles.bundleZip === packed.data.file.name);
  t('README потрапив у перелік вмісту', packed.data.entries.some((e: any) => e.path.startsWith('README')));

  const emptyPack = await call('POST', `/api/publishing/products/${productId}/bundle/package`, { fileNames: ['нема.txt'] });
  t('пакування без жодного компонента → 400', emptyPack.status === 400, String(emptyPack.status));

  const delMissing = await call('DELETE', `/api/publishing/products/${productId}/files/${encodeURIComponent('нема.txt')}`);
  t('видалення неіснуючого файлу → 404', delMissing.status === 404, String(delMissing.status));
  const delOk = await call('DELETE', `/api/publishing/products/${productId}/files/template.txt`);
  t('видалення наявного файлу → 200', delOk.status === 200, String(delOk.status));
}

// ---------------------------------------------------------------------------
console.log('\nEtsy без ключів (стан конфігурації, а не помилка):');
{
  const status = await call('GET', '/api/etsy/status');
  t('GET /etsy/status → 200 навіть без ключів', status.status === 200);
  t('configured=false і пояснення чому', status.data.configured === false && String(status.data.reasonUk).includes('ETSY_API_KEY'));
  t('ліміти платформи віддаються клієнту',
    status.data.limits.maxFiles === 5 && status.data.limits.maxFileBytes === 20 * 1024 * 1024);

  const start = await call('POST', '/api/etsy/oauth/start');
  t('старт OAuth без ключів → 503 з поясненням', start.status === 503, String(start.status));

  const publish = await call('POST', `/api/publishing/products/${productId}/publish/etsy`, {});
  t('публікація без ключів → 503', publish.status === 503, String(publish.status));

  const research = await call('POST', '/api/etsy/research', { topic: 'watercolor journal' });
  t('дослідження без ключа → 503 з поясненням', research.status === 503, String(research.status));
}

// ---------------------------------------------------------------------------
console.log('\nEtsy з ключами:');
{
  process.env.ETSY_API_KEY = 'test-key';
  process.env.ETSY_SHARED_SECRET = 'test-shared-secret';
  process.env.ETSY_REDIRECT_URI = 'https://app.test/api/etsy/oauth/callback';

  const status = await call('GET', '/api/etsy/status');
  t('після появи ключів configured=true', status.data.configured === true);
  t('крамниця ще не підключена', status.data.connected === false);

  const start = await call('POST', '/api/etsy/oauth/start');
  t('POST /oauth/start → 200 з посиланням', start.status === 200 && String(start.data.url).includes('code_challenge'));
  t('у посиланні є client_id застосунку', String(start.data.url).includes('test-key'));
  const state = start.data.state;
  t('state збережено на сервері', Boolean(state));

  const badCallback = await call('GET', '/api/etsy/oauth/callback?code=abc&state=підроблений');
  t('колбек із чужим state → редірект з помилкою',
    badCallback.status === 302 && String(badCallback.headers.get('location')).includes('etsy=error'),
    String(badCallback.status));

  const okCallback = await call('GET', `/api/etsy/oauth/callback?code=abc&state=${encodeURIComponent(state)}`);
  t('коректний колбек → редірект з ознакою успіху',
    okCallback.status === 302 && String(okCallback.headers.get('location')).includes('etsy=ok'),
    String(okCallback.headers.get('location')));

  const connected = await call('GET', '/api/etsy/status');
  t('крамниця підключена', connected.data.connected === true);
  t('визначено shop_id', connected.data.shopId === '55', String(connected.data.shopId));
  t('назва крамниці збережена', connected.data.shopName === 'NovaShop');
  t('токен назовні не віддається', !JSON.stringify(connected.data).includes('4242.aaa'));

  const stored = await store.getEtsyAccount('u-1');
  t('токен у базі зашифрований', Boolean(stored) && !String(stored!.accessTokenEnc).includes('4242.aaa'));
  t('зашифрований токен розшифровується назад',
    (await account.ensureAccessToken('u-1', {
      apiKey: 'test-key', fetchImpl: stubFetch as any,
      bucket: { reserve: () => 0, acquire: async () => {}, available: () => 1 },
    }))?.token === '4242.aaa');

  const repeatState = await call('GET', `/api/etsy/oauth/callback?code=abc&state=${encodeURIComponent(state)}`);
  t('повторне використання того самого state неможливе',
    String(repeatState.headers.get('location')).includes('etsy=error'));
}

// ---------------------------------------------------------------------------
console.log('\nПередпольотна перевірка й постановка в чергу:');
let jobId = '';
{
  const validate = await call('POST', `/api/publishing/products/${productId}/publish/etsy/validate`, {
    fileNames: ['lesson.txt'], imageNames: [],
  });
  t('POST /publish/etsy/validate → 200', validate.status === 200);
  t('відсутнє зображення дає попередження, але не блокує',
    validate.data.ok === true && validate.data.issues.some((i: any) => i.field === 'images'));

  const missingFile = await call('POST', `/api/publishing/products/${productId}/publish/etsy/validate`, {
    fileNames: ['нема-такого.pdf'],
  });
  t('незавантажений файл блокує публікацію', missingFile.data.ok === false);

  const badPrice = await call('POST', `/api/publishing/products/${productId}/publish/etsy`, {
    fileNames: ['lesson.txt'], priceUsd: 0,
  });
  t('нульова ціна → 400 з переліком проблем',
    badPrice.status === 400 && Array.isArray(badPrice.data.issues), String(badPrice.status));

  const queued = await call('POST', `/api/publishing/products/${productId}/publish/etsy`, {
    fileNames: ['lesson.txt'], imageNames: [], activate: true,
  });
  t('коректна публікація → 202 (прийнято в чергу)', queued.status === 202, String(queued.status));
  t('повернуто публікацію й задачу', Boolean(queued.data.publication?.id) && Boolean(queued.data.job?.id));
  jobId = queued.data.job.id;
  t('задача стартує з кроку створення лістингу', queued.data.job.step === 'create_listing');

  const again = await call('POST', `/api/publishing/products/${productId}/publish/etsy`, {
    fileNames: ['lesson.txt'], imageNames: [], activate: true,
  });
  t('повторний запит не створює другу задачу', again.data.job?.id === jobId, again.data.job?.id);

  const job = await call('GET', `/api/publishing/jobs/${jobId}`);
  t('GET /jobs/:id → 200', job.status === 200 && job.data.job.id === jobId);

  principal = { id: 'u-2', email: 'b@test.ua', name: 'Інший', role: 'writer', isGuest: false };
  const foreignJob = await call('GET', `/api/publishing/jobs/${jobId}`);
  t('чужа задача → 404', foreignJob.status === 404, String(foreignJob.status));
  principal = { id: 'u-1', email: 'a@test.ua', name: 'Автор', role: 'writer', isGuest: false };

  const publications = await call('GET', '/api/publishing/publications');
  t('GET /publications → 200 зі списком', publications.status === 200 && publications.data.publications.length >= 1);
}

// ---------------------------------------------------------------------------
console.log('\nДослідження теми:');
{
  const empty = await call('POST', '/api/etsy/research', { topic: '   ' });
  t('порожня тема → 400', empty.status === 400, String(empty.status));

  const tooLong = await call('POST', '/api/etsy/research', { topic: 'ж'.repeat(200) });
  t('задовга тема → 400', tooLong.status === 400, String(tooLong.status));

  const before = etsyCalls.length;
  const first = await call('POST', '/api/etsy/research', { topic: 'watercolor journal' });
  t('POST /etsy/research → 200', first.status === 200, String(first.status));
  t('зібрано лістинги', first.data.report.listingCount === 3, String(first.data.report.listingCount));
  t('віддано обсяг пропозиції за темою', first.data.report.totalActive === 1234);
  t('сформовано кандидатів у теги', first.data.report.suggestedTags.length > 0);
  t('відповідь містить застереження про оцінність показників',
    String(first.data.report.disclaimerUk).includes('Etsy не надає'));
  t('перший запит справді пішов у Etsy', etsyCalls.length > before);

  const cachedBefore = etsyCalls.length;
  const second = await call('POST', '/api/etsy/research', { topic: 'Watercolor  Journal' });
  t('повторний запит тієї самої теми віддається з кешу', second.data.fromCache === true);
  t('кешований запит не витрачає жодного виклику Etsy', etsyCalls.length === cachedBefore, `${cachedBefore} → ${etsyCalls.length}`);

  const forced = await call('POST', '/api/etsy/research', { topic: 'watercolor journal', force: true });
  t('звичайний користувач не може примусово скинути кеш', forced.data.fromCache === true);

  const trend = await call('GET', '/api/etsy/research/trend?topic=watercolor%20journal');
  t('GET /research/trend → 200 з часовим рядом', trend.status === 200 && trend.data.points.length >= 1);

  const noTopic = await call('GET', '/api/etsy/research/trend');
  t('динаміка без теми → 400', noTopic.status === 400, String(noTopic.status));
}

// ---------------------------------------------------------------------------
console.log('\nВідключення крамниці:');
{
  const off = await call('DELETE', '/api/etsy/connection');
  t('DELETE /etsy/connection → 200', off.status === 200);
  t('після відключення токенів у базі немає', (await store.getEtsyAccount('u-1')) === undefined);

  const publish = await call('POST', `/api/publishing/products/${productId}/publish/etsy`, { fileNames: ['lesson.txt'] });
  t('публікація без підключеної крамниці → 409', publish.status === 409, String(publish.status));
  t('помилка має машинний код для UI', publish.data.kind === 'etsy_not_connected');
}

server.close();
console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
process.exit(fail ? 1 : 0);
