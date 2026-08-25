/**
 * Тести модуля публікації (KDP + Etsy). Запуск: npm run test:publishing
 *
 * Тут немає ані мережі, ані ключів Etsy: усе, що стосується платформи,
 * підставляється (fetch, клієнт Etsy, час). Покриття за рівнями, як вимагає
 * ТЗ («мінімум по 2 тести на кожен API — позитивний і негативний»):
 *
 *   1. чисті правила  — KDP-специфікація, правила лістингу, backoff, теги;
 *   2. криптографія   — шифрування токенів і виявлення підміни;
 *   3. транспорт      — повтори, ліміт швидкості, оновлення токена по 401;
 *   4. аналітика      — токенізація, біграми, індекс популярності;
 *   5. пакувальник    — реальний .zip, який має розпаковуватись;
 *   6. сховище        — CRUD, ізоляція чужих товарів, черга задач;
 *   7. конвеєр        — повний happy path публікації, ідемпотентність,
 *                       часткова невдача і відновлення після рестарту.
 */
const DIR = '/tmp/nova-publishing-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.ETSY_TOKEN_SECRET = 'test-secret-phrase-for-tokens';

import fs from 'node:fs';
import zlib from 'node:zlib';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/publishingStore');
const kdp = await import('../server/kdpSpec');
const rules = await import('../server/etsy/etsyListingRules');
const limiter = await import('../server/etsy/rateLimiter');
const crypto = await import('../server/etsy/tokenCrypto');
const oauth = await import('../server/etsy/etsyOAuth');
const clientMod = await import('../server/etsy/etsyClient');
const research = await import('../server/etsy/etsyResearch');
const zip = await import('../server/etsy/zipWriter');
const packager = await import('../server/etsy/coursePackager');
const queue = await import('../server/etsy/publishQueue');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

// ---------------------------------------------------------------------------
// Спершу — JSON-бекенд. Поки не викликано initDb(), сховище вважає SQLite
// недоступним і працює поверх файлів. Так той самий контракт перевіряється
// на обох бекендах, а не лише на основному: середовище зі старим Node не
// повинно поводитись інакше.
console.log('JSON-бекенд (fallback без node:sqlite):');
{
  const nowIso = new Date().toISOString();
  await store.saveProduct({
    id: 'json-prod', authorId: 'u-json', type: 'book', title: 'JSON-товар', description: '',
    priceUsd: 3, tags: ['a'], components: [], exportFiles: {}, createdAt: nowIso, updatedAt: nowIso,
  });
  t('товар зберігається у файл', (await store.getProduct('json-prod'))?.title === 'JSON-товар');
  t('список фільтрується по автору', (await store.listProducts('u-json')).length === 1);
  t('чужого товару в списку немає', (await store.listProducts('u-other')).length === 0);

  await store.savePublication({
    id: 'json-pub', productId: 'json-prod', userId: 'u-json', platform: 'etsy',
    status: 'files_ready', createdAt: nowIso, updatedAt: nowIso,
  });
  await store.savePublication({
    id: 'json-pub-dup', productId: 'json-prod', userId: 'u-json', platform: 'etsy',
    status: 'draft', externalId: '1', createdAt: nowIso, updatedAt: nowIso,
  });
  t('унікальність (товар, майданчик) діє і в JSON',
    (await store.listPublicationsForProduct('json-prod')).length === 1);

  await store.saveJob({
    id: 'json-job', publicationId: 'json-pub', userId: 'u-json', status: 'queued',
    step: 'create_listing', attempts: 0, maxAttempts: 5, nextAttemptAt: nowIso,
    payload: {}, progress: {}, createdAt: nowIso, updatedAt: nowIso,
  });
  t('черга працює і в JSON', (await store.claimNextJob(nowIso))?.id === 'json-job');
  t('повернення завислих задач працює і в JSON', (await store.requeueStuckJobs(nowIso)) === 1);
  t('файл сховища створено', fs.existsSync(`${DIR}/publishing.json`));

  await store.deleteProduct('json-prod');
  t('видалення товару прибирає і його публікації',
    (await store.getProduct('json-prod')) === undefined &&
      (await store.listPublicationsForProduct('json-prod')).length === 0);
}

await db.initDb();
store.__resetCacheForTests();
console.log('\nСередовище:');
t('SQLite доступний', db.isAvailable(), db.unavailableMessage());

// ---------------------------------------------------------------------------
console.log('\nKDP — корінець і макет обкладинки:');
{
  t('корінець 200 сторінок білого паперу ≈ 0.45″',
    Math.abs(kdp.spineThicknessInches(200, 'white') - 0.45) < 0.005,
    String(kdp.spineThicknessInches(200, 'white')));
  t('кремовий папір товщий за білий',
    kdp.spineThicknessInches(200, 'cream') > kdp.spineThicknessInches(200, 'white'));
  t('нуль сторінок дає нульовий корінець', kdp.spineThicknessInches(0) === 0);

  const cover = kdp.calculateFullCover({ trimId: '6x9', pageCount: 300, paper: 'white' });
  // 6 × 2 + 0.6756 + 0.25 = 12.926
  t('ширина розгорнутої обкладинки враховує корінець і виліт',
    Math.abs(cover.widthInches - (12 + cover.spineInches + 0.25)) < 0.001,
    String(cover.widthInches));
  t('висота = сторінка + два вильоти', Math.abs(cover.heightInches - 9.25) < 0.001);
  t('розмір у пікселях рахується за 300 dpi',
    cover.widthPx === Math.round(cover.widthInches * 300));
  t('профіль друку — CMYK, електронний — RGB',
    cover.colorProfilePrint === 'CMYK' && cover.colorProfileEbook === 'RGB');
  t('невідомий трим відкочується на 6×9',
    kdp.calculateFullCover({ trimId: 'нема-такого', pageCount: 100 }).trimId === '6x9');
  t('усі три обов’язкові розміри з ТЗ присутні',
    ['5x8', '5.5x8.5', '6x9'].every((id) => kdp.findTrimSize(id)?.required === true));
}

// ---------------------------------------------------------------------------
console.log('\nKDP — валідація рукопису:');
{
  const good = kdp.validateManuscriptForKdp({
    pageCount: 220, hasTableOfContents: true, headingLevels: [1, 2, 2, 1, 2],
  });
  t('коректний рукопис проходить', good.ok, JSON.stringify(good.issues));

  const tooThin = kdp.validateManuscriptForKdp({
    pageCount: 12, hasTableOfContents: true, headingLevels: [1],
  });
  t('12 сторінок блокуються (мінімум 24)', !tooThin.ok);

  const tooThick = kdp.validateManuscriptForKdp({
    pageCount: 900, hasTableOfContents: true, headingLevels: [1],
  });
  t('900 сторінок блокуються (максимум 828)', !tooThick.ok);

  const noHeadings = kdp.validateManuscriptForKdp({
    pageCount: 100, hasTableOfContents: true, headingLevels: [],
  });
  t('рукопис без заголовків блокується', !noHeadings.ok);

  const gap = kdp.validateManuscriptForKdp({
    pageCount: 100, hasTableOfContents: true, headingLevels: [1, 3],
  });
  t('пропущений рівень заголовка — попередження, не блокер',
    gap.ok && gap.issues.some((i) => i.field === 'headings' && i.severity === 'warning'));

  const noToc = kdp.validateManuscriptForKdp({
    pageCount: 100, hasTableOfContents: false, headingLevels: [1, 2],
  });
  t('відсутній зміст — попередження', noToc.ok && noToc.issues.some((i) => i.field === 'toc'));

  const empty = kdp.validateManuscriptForKdp({
    pageCount: 100, hasTableOfContents: true, headingLevels: [1], emptyChapters: ['Глава 3'],
  });
  t('порожня глава блокує експорт', !empty.ok);
}

// ---------------------------------------------------------------------------
console.log('\nKDP — лист метаданих:');
{
  const sheet = kdp.buildKdpMetadataSheet({
    title: 'Тіні над Дніпром',
    subtitle: 'Роман',
    authorName: 'Ярослав Вороний',
    description: 'Історія про місто, яке пам’ятає.',
    keywords: ['український роман', 'магічний реалізм', 'київ', 'історія', 'містика', 'сага', 'драма'],
    bisacCategories: ['FIC014000', 'FIC019000'],
    trimId: '6x9',
    pageCount: 300,
    paper: 'cream',
  });
  t('лист містить назву', sheet.text.includes('Тіні над Дніпром'));
  t('лист містить усі 7 ключових слів', sheet.fields['Ключові слова (7 полів)'].split('\n').length === 7);
  t('лист містить розрахований корінець', /Корінець/.test(sheet.text) && sheet.fields['Корінець'] !== '—');
  t('коректні метадані не дають блокерів', !sheet.issues.some((i) => i.severity === 'blocker'));
  t('лист прямо пояснює, що API в KDP немає', sheet.text.includes('API'));

  const bad = kdp.buildKdpMetadataSheet({
    title: '',
    description: 'x'.repeat(kdp.MAX_DESCRIPTION_CHARS + 1),
    keywords: new Array(9).fill('слово'),
    bisacCategories: ['A', 'B', 'C', 'D'],
  });
  t('порожня назва — блокер', bad.issues.some((i) => i.field === 'title' && i.severity === 'blocker'));
  t('опис понад 4000 символів — блокер',
    bad.issues.some((i) => i.field === 'description' && i.severity === 'blocker'));
  t('9 ключових слів на 7 полів — блокер',
    bad.issues.some((i) => i.field === 'keywords' && i.severity === 'blocker'));
  t('4 категорії BISAC — блокер', bad.issues.some((i) => i.field === 'bisac' && i.severity === 'blocker'));
}

// ---------------------------------------------------------------------------
console.log('\nEtsy — правила лістингу:');
{
  const MB = 1024 * 1024;
  const ok = rules.validateListingDraft({
    title: 'Watercolor journal bundle',
    description: 'Опис набору.',
    priceUsd: 12,
    tags: ['watercolor', 'journal'],
    files: [{ name: 'bundle.zip', bytes: 5 * MB }],
    imageCount: 3,
  });
  t('коректний лістинг проходить', ok.ok, JSON.stringify(ok.issues));

  const sixFiles = rules.validateListingDraft({
    title: 'Six', description: 'd', priceUsd: 5, imageCount: 1,
    files: new Array(6).fill(0).map((_, i) => ({ name: `f${i}.pdf`, bytes: 1000 })),
  });
  t('6-й файл блокується ДО звернення до API',
    !sixFiles.ok && sixFiles.issues.some((i) => i.field === 'files'));

  const tooBig = rules.validateListingDraft({
    title: 'Big', description: 'd', priceUsd: 5, imageCount: 1,
    files: [{ name: 'huge.zip', bytes: 21 * MB }],
  });
  t('файл понад 20 МБ блокується', !tooBig.ok);

  const badExt = rules.validateListingDraft({
    title: 'Bad', description: 'd', priceUsd: 5, imageCount: 1,
    files: [{ name: 'course.exe', bytes: 1000 }],
  });
  t('недозволений формат блокується', !badExt.ok);

  const variations = rules.validateListingDraft({
    title: 'Var', description: 'd', priceUsd: 5, imageCount: 1, hasVariations: true,
    files: [{ name: 'a.pdf', bytes: 100 }],
  });
  t('варіації для цифрового товару блокуються', !variations.ok);

  const noImage = rules.validateListingDraft({
    title: 'NoImg', description: 'd', priceUsd: 5, imageCount: 0,
    files: [{ name: 'a.pdf', bytes: 100 }],
  });
  t('відсутнє зображення — попередження, а не блокер',
    noImage.ok && noImage.issues.some((i) => i.field === 'images'));

  const zeroPrice = rules.validateListingDraft({
    title: 'Free', description: 'd', priceUsd: 0, imageCount: 1,
    files: [{ name: 'a.pdf', bytes: 100 }],
  });
  t('нульова ціна блокується', !zeroPrice.ok);
}

console.log('\nEtsy — нормалізація тегів:');
{
  t('розділові знаки прибираються', rules.normalizeTag('Watercolor, Journal!') === 'watercolor journal');
  t('довгий тег обрізається по межі слова',
    (rules.normalizeTag('watercolor journal printable pages') || '').length <= rules.MAX_TAG_CHARS);
  t('обрізаний тег не закінчується посеред слова',
    !/\s$/.test(rules.normalizeTag('watercolor journal printable pages') || ''));
  t('порожній тег відкидається', rules.normalizeTag('   !!!  ') === null);
  const many = rules.normalizeTags(new Array(20).fill(0).map((_, i) => `tag${i}`));
  t('нормалізація обрізає до 13 тегів', many.length === rules.MAX_TAGS, String(many.length));
  t('дублі прибираються', rules.normalizeTags(['book', 'Book!', 'book']).length === 1);
}

console.log('\nEtsy — сценарій доставки курсу (А/Б):');
{
  const MB = 1024 * 1024;
  const small = rules.recommendDeliveryScenario([
    { name: 'workbook.pdf', bytes: 3 * MB },
    { name: 'audio.mp3', bytes: 5 * MB },
  ]);
  t('компактний набір → сценарій Б', small.scenario === 'B', small.reasonUk);

  const big = rules.recommendDeliveryScenario([{ name: 'video.mov', bytes: 300 * MB }]);
  t('великий курс → сценарій А', big.scenario === 'A');

  const borderline = rules.recommendDeliveryScenario([{ name: 'x.zip', bytes: 19 * MB }]);
  t('19 МБ (понад 90% ліміту) → сценарій А із поясненням', borderline.scenario === 'A');

  const manyFiles = rules.recommendDeliveryScenario(
    new Array(7).fill(0).map((_, i) => ({ name: `f${i}.pdf`, bytes: 1000 }))
  );
  t('понад 5 компонентів → сценарій А', manyFiles.scenario === 'A');
}

// ---------------------------------------------------------------------------
console.log('\nТокен-бакет і backoff:');
{
  let clock = 0;
  const bucket = limiter.createTokenBucket({ ratePerSecond: 10, now: () => clock });
  let waits: number[] = [];
  for (let i = 0; i < 10; i++) waits.push(bucket.reserve());
  t('перші 10 запитів проходять без очікування', waits.every((w) => w === 0));
  const eleventh = bucket.reserve();
  t('11-й запит чекає ≈100 мс', eleventh >= 90 && eleventh <= 110, String(eleventh));
  clock += 1000;
  t('через секунду бакет поповнюється', bucket.reserve() === 0);

  const noJitter = () => 0.5;
  t('backoff першої спроби ≈1 с',
    Math.abs(limiter.computeBackoffDelayMs(1, { jitter: noJitter }) - 1000) < 5);
  t('backoff росте експоненційно',
    limiter.computeBackoffDelayMs(3, { jitter: noJitter }) > limiter.computeBackoffDelayMs(2, { jitter: noJitter }));
  t('backoff не перевищує стелю',
    limiter.computeBackoffDelayMs(20, { jitter: noJitter, maxMs: 5000 }) <= 5000);
  const spread = new Set(
    new Array(20).fill(0).map((_, i) => limiter.computeBackoffDelayMs(2, { jitter: () => i / 20 }))
  );
  t('джитер справді розкидає затримки', spread.size > 5, `${spread.size} різних значень`);
  t('429 і 503 повторюються', limiter.isRetryableStatus(429) && limiter.isRetryableStatus(503));
  t('400 і 404 не повторюються', !limiter.isRetryableStatus(400) && !limiter.isRetryableStatus(404));
}

// ---------------------------------------------------------------------------
console.log('\nШифрування токенів:');
{
  t('шифрування налаштоване', crypto.isCryptoConfigured());
  const secret = '12345678.abcdefghijklmnop';
  const enc = crypto.encryptToken(secret);
  t('шифротекст не містить самого токена', !enc.includes('abcdefghijklmnop'));
  t('розшифрування повертає оригінал', crypto.decryptToken(enc) === secret);
  t('два шифрування дають різний результат (випадковий IV)',
    crypto.encryptToken(secret) !== crypto.encryptToken(secret));

  const parts = enc.split(':');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('підмінено').toString('base64url')].join(':');
  let caught = false;
  try { crypto.decryptToken(tampered); } catch { caught = true; }
  t('підмінений шифротекст не розшифровується', caught);

  let caughtFormat = false;
  try { crypto.decryptToken('просто рядок'); } catch { caughtFormat = true; }
  t('чужий формат відхиляється', caughtFormat);

  t('відбиток токена не дозволяє відновити токен',
    crypto.tokenFingerprint(secret).startsWith('sha256:') && !crypto.tokenFingerprint(secret).includes('abcdef'));
}

// ---------------------------------------------------------------------------
console.log('\nOAuth + PKCE:');
{
  const pkce = oauth.createPkcePair();
  t('верифаєр достатньої довжини', pkce.codeVerifier.length >= 43);
  t('challenge не дорівнює verifier', pkce.codeChallenge !== pkce.codeVerifier);
  t('два виклики дають різні state', oauth.createPkcePair().state !== pkce.state);

  const url = oauth.buildAuthorizeUrl({
    apiKey: 'key-123', redirectUri: 'https://app.example/api/etsy/oauth/callback',
    state: pkce.state, codeChallenge: pkce.codeChallenge,
  });
  t('URL авторизації містить S256', url.includes('code_challenge_method=S256'));
  t('URL містить усі потрібні скоупи', url.includes('listings_w') && url.includes('shops_r'));
  t('верифаєр НЕ потрапляє в URL', !url.includes(pkce.codeVerifier));

  const okFetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({
      access_token: '777.aaa', refresh_token: '777.rrr', expires_in: 3600,
    }),
  });
  const tokens = await oauth.exchangeCodeForToken(okFetch as any, {
    apiKey: 'k', redirectUri: 'r', code: 'c', codeVerifier: 'v', nowMs: 1_000_000,
  });
  t('обмін коду повертає токени', tokens.accessToken === '777.aaa' && tokens.refreshToken === '777.rrr');
  t('etsy_user_id дістається з токена', tokens.etsyUserId === '777');
  t('термін дії рахується від поточного часу',
    tokens.expiresAt === new Date(1_000_000 + 3600_000).toISOString());

  const badFetch = async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' });
  let oauthError: any = null;
  try {
    await oauth.exchangeCodeForToken(badFetch as any, { apiKey: 'k', redirectUri: 'r', code: 'c', codeVerifier: 'v' });
  } catch (err) { oauthError = err; }
  t('400 від Etsy перетворюється на зрозумілу помилку', oauthError?.status === 400);
  t('сира відповідь Etsy не витікає в повідомлення',
    !String(oauthError?.message).includes('invalid_grant'));

  t('токен із запасом 5 хв вважається протухлим',
    oauth.needsRefresh(new Date(Date.now() + 60_000).toISOString()));
  t('свіжий токен не оновлюється',
    !oauth.needsRefresh(new Date(Date.now() + 3600_000).toISOString()));
  t('битий термін дії вважається протухлим', oauth.needsRefresh('не дата'));
}

// ---------------------------------------------------------------------------
console.log('\nHTTP-клієнт Etsy — повтори й 401:');
{
  const noSleep = async () => {};
  const bucket = limiter.createTokenBucket({ ratePerSecond: 1000 });
  const silent = () => {};

  let calls = 0;
  const flakyFetch = async () => {
    calls++;
    if (calls < 3) return { ok: false, status: 503, text: async () => 'oops' };
    return { ok: true, status: 200, text: async () => '{"listing_id":42}' };
  };
  const flaky = clientMod.createEtsyClient({
    apiKey: 'k', fetchImpl: flakyFetch as any, bucket, getAccessToken: async () => 'tok',
    sleep: noSleep, jitter: () => 0.5, log: silent,
  });
  const result = await flaky.request<any>('/application/test');
  t('503 повторюється й зрештою минає', result.listing_id === 42 && calls === 3, `викликів: ${calls}`);

  let badCalls = 0;
  const badFetch = async () => { badCalls++; return { ok: false, status: 400, text: async () => 'bad' }; };
  const bad = clientMod.createEtsyClient({
    apiKey: 'k', fetchImpl: badFetch as any, bucket, getAccessToken: async () => 'tok',
    sleep: noSleep, log: silent,
  });
  let badErr: any = null;
  try { await bad.request('/application/test'); } catch (err) { badErr = err; }
  t('400 не повторюється', badCalls === 1, `викликів: ${badCalls}`);
  t('400 віддається як EtsyApiError зі статусом', badErr?.status === 400);

  let authCalls = 0;
  let refreshed = 0;
  const authFetch = async (_url: string, init: any) => {
    authCalls++;
    const token = init?.headers?.Authorization;
    if (token === 'Bearer old') return { ok: false, status: 401, text: async () => 'expired' };
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  let current = 'old';
  const authClient = clientMod.createEtsyClient({
    apiKey: 'k', fetchImpl: authFetch as any, bucket,
    getAccessToken: async () => current,
    refreshToken: async () => { refreshed++; current = 'fresh'; return 'fresh'; },
    sleep: noSleep, log: silent,
  });
  const authRes = await authClient.request<any>('/application/test');
  t('401 запускає оновлення токена рівно один раз', refreshed === 1);
  t('після оновлення запит повторюється успішно', authRes.ok === true && authCalls === 2);

  let alwaysUnauthorized = 0;
  const deadClient = clientMod.createEtsyClient({
    apiKey: 'k',
    fetchImpl: (async () => { alwaysUnauthorized++; return { ok: false, status: 401, text: async () => 'no' }; }) as any,
    bucket, getAccessToken: async () => 'x', refreshToken: async () => null,
    sleep: noSleep, log: silent,
  });
  let deadErr: any = null;
  try { await deadClient.request('/application/test'); } catch (err) { deadErr = err; }
  t('якщо оновити токен не вдалось — 401 без нескінченного циклу',
    deadErr?.status === 401 && alwaysUnauthorized === 1, `викликів: ${alwaysUnauthorized}`);

  let netCalls = 0;
  const netClient = clientMod.createEtsyClient({
    apiKey: 'k',
    fetchImpl: (async () => { netCalls++; throw new Error('ECONNRESET'); }) as any,
    bucket, getAccessToken: async () => 'x', sleep: noSleep, jitter: () => 0.5, log: silent, maxAttempts: 3,
  });
  let netErr: any = null;
  try { await netClient.request('/application/test'); } catch (err) { netErr = err; }
  t('мережевий збій повторюється до вичерпання спроб', netCalls === 3, `викликів: ${netCalls}`);
  t('після вичерпання спроб — зрозуміла помилка', String(netErr?.message).includes('Etsy'));

  // Окремі бакети: дослідження не має з'їдати ліміт публікації (ТЗ 6.4).
  let clock = 0;
  const publishBucket = limiter.createTokenBucket({ ratePerSecond: 8, now: () => clock });
  const researchBucket = limiter.createTokenBucket({ ratePerSecond: 4, now: () => clock });
  for (let i = 0; i < 4; i++) researchBucket.reserve();
  t('вичерпаний дослідницький бакет не впливає на публікаційний',
    researchBucket.available() === 0 && publishBucket.available() === 8);
}

// ---------------------------------------------------------------------------
console.log('\nАналітика дослідження тем:');
{
  t('токенізація прибирає стоп-слова й розділові знаки',
    JSON.stringify(research.tokenize('The Watercolor Journal, for you!')) ===
      JSON.stringify(['watercolor', 'journal']));
  t('короткі слова відкидаються', !research.tokenize('a b cd watercolor').includes('cd'));
  t('чисті числа відкидаються', !research.tokenize('journal 2026').includes('2026'));
  t('біграми будуються по сусідніх словах',
    JSON.stringify(research.bigrams(['a', 'b', 'c'])) === JSON.stringify(['a b', 'b c']));

  const listings = [
    { listingId: '1', title: 'Watercolor journal printable', tags: ['watercolor', 'journal'], numFavorers: 100, priceUsd: 10, position: 1 },
    { listingId: '2', title: 'Watercolor sketchbook pages', tags: ['watercolor', 'sketchbook'], numFavorers: 50, priceUsd: 20, position: 2 },
    { listingId: '3', title: 'Journal printable pages', tags: ['journal'], numFavorers: 0, priceUsd: 30, position: 3 },
  ];
  const candidates = research.extractKeywordCandidates(listings);
  t('частотний аналіз знаходить спільні слова',
    candidates.some((c) => c.phrase === 'watercolor') && candidates.some((c) => c.phrase === 'journal'));
  t('кожен кандидат має готовий тег ≤20 символів',
    candidates.every((c) => c.tag.length <= rules.MAX_TAG_CHARS));
  t('одиничні слова не потрапляють у кандидати',
    !candidates.some((c) => c.phrase === 'sketchbook'));
  t('слово-тег важить більше за слово в назві',
    (candidates.find((c) => c.phrase === 'watercolor')?.score || 0) > 2);
  t('кандидатів не більше за ліміт тегів Etsy', candidates.length <= rules.MAX_TAGS);

  const maxFav = 100;
  const top = research.popularityIndex({ numFavorers: 100, position: 1 }, { maxFavorers: maxFav, sampleSize: 3 });
  const bottom = research.popularityIndex({ numFavorers: 0, position: 3 }, { maxFavorers: maxFav, sampleSize: 3 });
  t('індекс популярності вищий у лідера', top > bottom, `${top} проти ${bottom}`);
  t('індекс лежить у межах 0–100', top <= 100 && bottom >= 0);

  t('ціна Etsy розкладається за divisor',
    research.priceToUsd({ amount: 1250, divisor: 100 }) === 12.5);
  t('відсутня ціна дає нуль, а не NaN', research.priceToUsd(undefined) === 0);
  t('медіана рахується правильно', research.median([10, 20, 30]) === 20);
  t('медіана порожнього масиву — нуль', research.median([]) === 0);

  const report = research.buildResearchReport({
    topic: 'watercolor journal', totalActive: 4200, listings, collectedAt: '2026-08-20T10:00:00.000Z',
  });
  t('звіт рахує середні «улюблені»', report.avgFavorers === 50);
  t('звіт віддає готові теги', report.suggestedTags.length > 0);
  t('звіт зобов’язково містить застереження про оцінність',
    report.disclaimerUk.includes('Etsy не надає'));
  t('слова самої теми не пропонуються як «нові» теги',
    !report.suggestedTags.includes('watercolor journal'));
  t('ключ теми нормалізується',
    research.normalizeTopicKey('  Watercolor   Journal! ') === 'watercolor journal');
  t('ключ теми враховує категорію',
    research.normalizeTopicKey('journal', 123) === 'journal#123');
}

// ---------------------------------------------------------------------------
console.log('\nПакувальник набору:');
{
  const MB = 1024 * 1024;
  const analysis = packager.analyzeComponents([
    { name: 'workbook.pdf', bytes: 2 * MB },
    { name: 'audio.mp3', bytes: 4 * MB },
  ]);
  t('набір у межах ліміту вважається придатним', analysis.fitsEtsy && analysis.recommendation.scenario === 'B');
  t('сумарний розмір рахується', analysis.totalBytes === 6 * MB);

  const dup = packager.analyzeComponents([
    { name: 'a.pdf', bytes: 10 }, { name: 'A.PDF', bytes: 10 },
  ]);
  t('повторювані імена дають попередження', dup.warningsUk.some((w) => w.includes('повторюється')));

  const emptySet = packager.analyzeComponents([]);
  t('порожній набір попереджає', emptySet.warningsUk.length > 0);

  const bundle = await packager.packageCourse({
    title: 'Курс: акварельний щоденник',
    description: 'Три уроки й шаблони.',
    authorName: 'Ярослав',
    components: [
      { name: 'lesson.txt', bytes: 11, data: new TextEncoder().encode('Урок перший') },
      { name: 'template.txt', bytes: 7, data: new TextEncoder().encode('Шаблон') },
    ],
  });
  t('архів сформовано', bundle.zip.length > 0);
  t('ім’я файлу безпечне для майданчиків', /^[a-z0-9-]+\.zip$/.test(bundle.fileName), bundle.fileName);
  t('README вкладено в набір', bundle.entries.some((e) => e.path.startsWith('README')));
  t('усі компоненти вкладено', bundle.entries.length === 3);

  // Найважливіше: архів має бути справжнім zip, який відкриє покупець.
  const zipPath = `${DIR}/bundle.zip`;
  fs.writeFileSync(zipPath, Buffer.from(bundle.zip));
  const signature = Buffer.from(bundle.zip.slice(0, 4)).toString('hex');
  t('файл починається з сигнатури PK\\x03\\x04', signature === '504b0304', signature);

  const readmeName = bundle.readmeFormat === 'pdf' ? 'README.pdf' : 'README.txt';
  t('формат README узгоджений із записом у архіві',
    bundle.entries.some((e) => e.path === readmeName));

  // Розпаковуємо власними силами: читаємо центральний каталог і deflate.
  const raw = Buffer.from(bundle.zip);
  const eocdIndex = raw.lastIndexOf(Buffer.from('504b0506', 'hex'));
  t('центральний каталог знайдено', eocdIndex > 0);
  const entryCount = raw.readUInt16LE(eocdIndex + 10);
  t('кількість записів у EOCD збігається', entryCount === bundle.entries.length, String(entryCount));

  // Перевіряємо, що вміст першого компонента відновлюється байт у байт.
  const lessonOffset = raw.indexOf(Buffer.from('lesson.txt', 'utf8'));
  const localStart = lessonOffset - 30;
  const method = raw.readUInt16LE(localStart + 8);
  const compSize = raw.readUInt32LE(localStart + 18);
  const nameLen = raw.readUInt16LE(localStart + 26);
  const extraLen = raw.readUInt16LE(localStart + 28);
  const dataStart = localStart + 30 + nameLen + extraLen;
  const payload = raw.subarray(dataStart, dataStart + compSize);
  const restored = method === 8 ? zlib.inflateRawSync(payload) : payload;
  t('вміст компонента відновлюється без втрат', restored.toString('utf8') === 'Урок перший', restored.toString('utf8'));

  const crcSelf = zip.crc32(new TextEncoder().encode('123456789'));
  t('CRC32 збігається з еталонним значенням', crcSelf === 0xcbf43926, crcSelf.toString(16));
}

// ---------------------------------------------------------------------------
console.log('\nСховище — товари й публікації:');
{
  const nowIso = new Date().toISOString();
  const product = {
    id: 'prod-1', authorId: 'u-1', type: 'course' as const, title: 'Курс',
    description: 'опис', priceUsd: 15, tags: ['course'], components: [], exportFiles: {},
    createdAt: nowIso, updatedAt: nowIso,
  };
  await store.saveProduct(product);
  t('товар збережено', (await store.getProduct('prod-1'))?.title === 'Курс');
  t('неіснуючий товар — undefined', (await store.getProduct('prod-missing')) === undefined);

  await store.saveProduct({ ...product, id: 'prod-2', title: 'Книга', updatedAt: new Date(Date.now() + 1000).toISOString() });
  await store.saveProduct({ ...product, id: 'prod-3', authorId: 'u-2', title: 'Чужий' });
  const mine = await store.listProducts('u-1');
  t('список повертає лише свої товари', mine.length === 2, String(mine.length));
  t('список відсортований за свіжістю', mine[0].id === 'prod-2');

  await store.saveProduct({ ...product, title: 'Курс (оновлено)', updatedAt: new Date().toISOString() });
  t('повторне збереження оновлює, а не дублює',
    (await store.listProducts('u-1')).length === 2 &&
      (await store.getProduct('prod-1'))?.title === 'Курс (оновлено)');

  const pub = {
    id: 'pub-1', productId: 'prod-1', userId: 'u-1', platform: 'etsy' as const,
    status: 'files_ready' as const, createdAt: nowIso, updatedAt: nowIso,
  };
  await store.savePublication(pub);
  t('публікацію збережено', (await store.getPublicationForProduct('prod-1', 'etsy'))?.status === 'files_ready');

  await store.savePublication({ ...pub, id: 'pub-DUPLICATE', status: 'draft', externalId: '999' });
  const publications = await store.listPublicationsForProduct('prod-1');
  t('пара (товар, майданчик) унікальна — дубля не створено', publications.length === 1, String(publications.length));
  t('повторне збереження оновило наявний запис',
    publications[0].status === 'draft' && publications[0].externalId === '999');

  await store.savePublication({ ...pub, id: 'pub-2', platform: 'kdp', status: 'files_ready' });
  t('той самий товар може мати публікації на різних майданчиках',
    (await store.listPublicationsForProduct('prod-1')).length === 2);

  t('чужі публікації не потрапляють у список',
    (await store.listPublicationsForUser('u-2')).length === 0);
}

console.log('\nСховище — черга задач:');
{
  const nowIso = new Date().toISOString();
  const job = {
    id: 'job-1', publicationId: 'pub-1', userId: 'u-1', status: 'queued' as const,
    step: 'create_listing' as const, attempts: 0, maxAttempts: 5, nextAttemptAt: nowIso,
    payload: { productId: 'prod-1' }, progress: {}, createdAt: nowIso, updatedAt: nowIso,
  };
  await store.saveJob(job);
  const claimed = await store.claimNextJob(nowIso);
  t('задачу взято в роботу', claimed?.id === 'job-1' && claimed?.status === 'running');
  t('взята задача більше не видається', (await store.claimNextJob(nowIso)) === undefined);

  const future = new Date(Date.now() + 60_000).toISOString();
  await store.saveJob({ ...job, id: 'job-2', nextAttemptAt: future });
  t('задача з майбутнім часом ще не береться', (await store.claimNextJob(nowIso)) === undefined);
  t('після настання часу задача береться', (await store.claimNextJob(future))?.id === 'job-2');

  const requeued = await store.requeueStuckJobs(nowIso);
  t('після «рестарту» завислі задачі повертаються в чергу', requeued === 2, String(requeued));
  t('повернена задача зберігає свій крок',
    (await store.getJob('job-1'))?.step === 'create_listing');
  t('задачі користувача перелічуються', (await store.listJobsForUser('u-1')).length === 2);
}

console.log('\nСховище — OAuth-стан і зрізи дослідження:');
{
  const nowIso = new Date().toISOString();
  await store.saveOAuthState({
    state: 'st-1', userId: 'u-1', codeVerifier: 'verifier', redirectUri: 'https://x/cb', createdAt: nowIso,
  });
  t('стан читається один раз', (await store.takeOAuthState('st-1'))?.codeVerifier === 'verifier');
  t('повторне використання state неможливе', (await store.takeOAuthState('st-1')) === undefined);

  await store.saveOAuthState({
    state: 'st-old', userId: 'u-1', codeVerifier: 'v', redirectUri: 'r',
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
  });
  t('старі стани прибираються', (await store.purgeOldOAuthStates(new Date(Date.now() - 3600_000).toISOString())) === 1);

  for (let i = 0; i < 3; i++) {
    await store.saveResearchSnapshot({
      id: `res-${i}`, topicKey: 'journal', topic: 'journal', collectedAt: new Date(Date.now() + i * 1000).toISOString(),
      listingCount: 10 + i, totalActive: 1000 + i, avgFavorers: i, medianPrice: 10, payload: { suggestedTags: ['a'] },
    });
  }
  const latest = await store.getLatestResearchSnapshot('journal');
  t('останній зріз — найсвіжіший', latest?.id === 'res-2', latest?.id);
  t('історія зберігає всі зрізи', (await store.listResearchHistory('journal')).length === 3);
  t('зріз чужої теми не підмішується', (await store.listResearchHistory('нема')).length === 0);
  t('відстежувані теми перелічуються', (await store.listTrackedTopics()).some((x) => x.topicKey === 'journal'));
}

// ---------------------------------------------------------------------------
console.log('\nКонвеєр публікації:');
{
  const nowIso = new Date().toISOString();
  await store.saveProduct({
    id: 'prod-pub', authorId: 'u-9', type: 'bundle', title: 'Набір', description: 'опис',
    priceUsd: 9, tags: ['tag'], components: [], exportFiles: {}, createdAt: nowIso, updatedAt: nowIso,
  });

  function stubClient(behaviour: { failFilesTimes?: number } = {}) {
    const calls: string[] = [];
    let fileFailures = behaviour.failFilesTimes || 0;
    return {
      calls,
      client: {
        async request(pathname: string, options: any) {
          calls.push(`${options?.method || 'GET'} ${pathname}`);
          if (/\/listings$/.test(pathname) && options?.method === 'POST') {
            return { listing_id: 5150, state: 'draft' };
          }
          if (/\/images$/.test(pathname)) return { listing_image_id: 1 };
          if (/\/files$/.test(pathname)) {
            if (fileFailures > 0) {
              fileFailures--;
              throw new clientMod.EtsyApiError('Etsy тимчасово недоступний.', 503);
            }
            return { listing_file_id: 1 };
          }
          if (options?.method === 'PATCH') return { listing_id: 5150, state: 'active', url: 'https://etsy.com/listing/5150' };
          return {};
        },
      },
    };
  }

  const files: Record<string, Uint8Array> = {
    'cover.png': new TextEncoder().encode('img'),
    'bundle.zip': new TextEncoder().encode('zip'),
  };
  const readFile = async (_p: string, name: string) => files[name];

  // --- happy path ---
  const pubHappy = await store.savePublication({
    id: 'pub-happy', productId: 'prod-pub', userId: 'u-9', platform: 'etsy',
    status: 'files_ready', createdAt: nowIso, updatedAt: nowIso,
  });
  await queue.enqueuePublishJob({
    publicationId: pubHappy.id, userId: 'u-9',
    payload: {
      productId: 'prod-pub', shopId: '77', title: 'Набір', description: 'опис', priceUsd: 9,
      tags: ['tag'], imageNames: ['cover.png'], fileNames: ['bundle.zip'], activate: true,
    },
  });
  const stub = stubClient();
  const steps = await queue.drainQueue({
    clientForUser: async () => stub.client as any, readFile, log: () => {},
  });
  const publishedPub = await store.getPublication('pub-happy');
  t('конвеєр дійшов до кінця', steps >= 4, `кроків: ${steps}`);
  t('лістинг створено, зображення й файл завантажено, лістинг активовано',
    stub.calls.some((c) => c.includes('POST') && c.endsWith('/listings')) &&
      stub.calls.some((c) => c.endsWith('/images')) &&
      stub.calls.some((c) => c.endsWith('/files')) &&
      stub.calls.some((c) => c.startsWith('PATCH')),
    stub.calls.join(' | '));
  t('публікація має статус published', publishedPub?.status === 'published', publishedPub?.status);
  t('збережено посилання на живий лістинг', publishedPub?.externalUrl?.includes('5150') === true);
  t('збережено etsy_listing_id', publishedPub?.externalId === '5150');

  // --- ідемпотентність ---
  const before = stub.calls.filter((c) => c.endsWith('/listings')).length;
  await queue.enqueuePublishJob({
    publicationId: pubHappy.id, userId: 'u-9',
    payload: {
      productId: 'prod-pub', shopId: '77', title: 'Набір', description: 'опис', priceUsd: 9,
      tags: ['tag'], imageNames: [], fileNames: [], activate: true,
    },
  });
  await queue.drainQueue({ clientForUser: async () => stub.client as any, readFile, log: () => {} });
  const after = stub.calls.filter((c) => c.endsWith('/listings') && c.startsWith('POST')).length;
  t('повторна публікація не створює другий лістинг', after === before, `${before} → ${after}`);

  // --- часткова невдача: файли падають, лістинг лишається чернеткою ---
  await store.saveProduct({
    id: 'prod-fail', authorId: 'u-9', type: 'bundle', title: 'Проблемний', description: '',
    priceUsd: 5, tags: [], components: [], exportFiles: {}, createdAt: nowIso, updatedAt: nowIso,
  });
  const pubFail = await store.savePublication({
    id: 'pub-fail', productId: 'prod-fail', userId: 'u-9', platform: 'etsy',
    status: 'files_ready', createdAt: nowIso, updatedAt: nowIso,
  });
  await queue.enqueuePublishJob({
    publicationId: pubFail.id, userId: 'u-9',
    payload: {
      productId: 'prod-fail', shopId: '77', title: 'Проблемний', description: '', priceUsd: 5,
      tags: [], imageNames: [], fileNames: ['bundle.zip'], activate: true,
    },
  });
  const failing = stubClient({ failFilesTimes: 99 });
  // Час підсовуємо «з майбутнього», щоб backoff не змушував тест чекати.
  let virtualNow = Date.now();
  await queue.drainQueue({
    clientForUser: async () => failing.client as any,
    readFile,
    now: () => new Date((virtualNow += 120_000)),
    log: () => {},
  }, 40);
  const failedJob = (await store.listJobsForUser('u-9')).find((j) => j.publicationId === 'pub-fail');
  const failedPub = await store.getPublication('pub-fail');
  t('задача після вичерпання спроб позначена failed', failedJob?.status === 'failed', failedJob?.status);
  t('спроб рівно стільки, скільки дозволено', failedJob?.attempts === 5, String(failedJob?.attempts));
  t('лістинг лишився чернеткою, а не зник', failedPub?.status === 'draft', failedPub?.status);
  t('причина збою збережена для автора', Boolean(failedPub?.errorLog));

  // --- відновлення після рестарту ---
  const pubRestart = await store.savePublication({
    id: 'pub-restart', productId: 'prod-pub', userId: 'u-9', platform: 'kdp',
    status: 'files_ready', createdAt: nowIso, updatedAt: nowIso,
  });
  const restartJob = await queue.enqueuePublishJob({
    publicationId: pubRestart.id, userId: 'u-9',
    payload: {
      productId: 'prod-pub', shopId: '77', title: 'X', description: '', priceUsd: 1,
      tags: [], imageNames: ['cover.png'], fileNames: ['bundle.zip'], activate: false,
    },
  });
  await store.saveJob({ ...restartJob, status: 'running', step: 'upload_files', progress: { listingId: '5150', uploadedImages: ['cover.png'] } });
  const requeued = await store.requeueStuckJobs(new Date().toISOString());
  t('рестарт повертає «завислу» задачу в чергу', requeued >= 1);
  const resumed = await store.getJob(restartJob.id);
  t('крок і прогрес пережили рестарт',
    resumed?.step === 'upload_files' && (resumed?.progress as any)?.uploadedImages?.[0] === 'cover.png');

  const resumeStub = stubClient();
  await queue.drainQueue({ clientForUser: async () => resumeStub.client as any, readFile, log: () => {} });
  t('після відновлення лістинг НЕ створюється заново',
    !resumeStub.calls.some((c) => c.startsWith('POST') && c.endsWith('/listings')),
    resumeStub.calls.join(' | '));
  t('після відновлення зображення НЕ завантажується вдруге',
    !resumeStub.calls.some((c) => c.endsWith('/images')));

  // --- крамниця не підключена ---
  const pubNoShop = await store.savePublication({
    id: 'pub-noshop', productId: 'prod-fail', userId: 'u-8', platform: 'etsy',
    status: 'files_ready', createdAt: nowIso, updatedAt: nowIso,
  });
  await queue.enqueuePublishJob({
    publicationId: pubNoShop.id, userId: 'u-8',
    payload: {
      productId: 'prod-fail', shopId: '', title: 'X', description: '', priceUsd: 1,
      tags: [], imageNames: [], fileNames: [], activate: true,
    },
  });
  await queue.drainQueue({ clientForUser: async () => null, readFile, log: () => {} });
  const noShopJob = (await store.listJobsForUser('u-8'))[0];
  t('без підключеної крамниці задача чесно падає, а не висить',
    noShopJob?.status === 'failed' && String(noShopJob?.lastError).includes('Etsy'));
}

// ---------------------------------------------------------------------------
console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
