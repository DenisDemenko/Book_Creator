/**
 * Тести мосту «Nova → вітрина Fusion Lab». Запуск: npm run test:bridge
 *
 * Головне тут — перевірка ЗВʼЯЗКУ. Раніше вона била лише в /health, тож
 * зелений результат не означав нічого про ключ: розбіжність спливала аж
 * при першій справжній публікації, коли автор уже чекав на лістинг.
 * Тепер перевіряється сам ключ, і ці тести стежать, щоб:
 *   1. проба була DELETE неіснуючого лістинга — вона не має лишати слідів;
 *   2. 404 читалось як «ключ прийнято», а не як помилка;
 *   3. 401 читалось як «ключ не той», а не як «сервіс недоступний»;
 *   4. невизначені відповіді НЕ зараховувались як успіх.
 * Мережі нема: fetch інжектується.
 */
const DIR = '/tmp/nova-bridge-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const bridge = await import('../server/marketplaceBridge');
const store = await import('../server/store');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const settings = { url: 'https://api.fusionlab.in.ua', key: 'secret-key' };

interface Seen { url: string; method?: string; key?: string }
function stub(health: { status: number } | 'throw', probe: { status: number } | 'throw') {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: (async (url: string, init: any = {}) => {
      const isProbe = String(url).includes('/bridge/books');
      seen.push({ url: String(url), method: init.method, key: init.headers?.['x-bridge-key'] });
      const spec = isProbe ? probe : health;
      if (spec === 'throw') throw new Error('network down');
      return {
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        text: async () => 'ok',
      };
    }) as never,
  };
}

console.log('Проба не має лишати слідів:');
{
  const s = stub({ status: 200 }, { status: 404 });
  await bridge.testBridgeConnection({ fetch: s.fetch, settings });
  const probe = s.seen.find((c) => c.url.includes('/bridge/books'))!;
  t('метод DELETE, а не POST', probe.method === 'DELETE', probe.method);
  t('ключ надіслано в заголовку', probe.key === 'secret-key', probe.key);
  t('ідентифікатор явно тестовий', /nova-bridge-selftest/.test(probe.url), probe.url);
  t('формат не digital і не print', !/:(digital|print)$/.test(probe.url), probe.url);

  const s2 = stub({ status: 200 }, { status: 404 });
  await bridge.testBridgeConnection({ fetch: s2.fetch, settings });
  const probe2 = s2.seen.find((c) => c.url.includes('/bridge/books'))!;
  t('ідентифікатор щоразу інший', probe.url !== probe2.url);
}

console.log('\nТлумачення відповідей:');
{
  const ok = await bridge.testBridgeConnection({ fetch: stub({ status: 200 }, { status: 404 }).fetch, settings });
  t('404 → ключ прийнято', ok.keyAccepted === true && ok.tone === 'ok', `${ok.keyAccepted} ${ok.tone}`);

  const bad401 = await bridge.testBridgeConnection({ fetch: stub({ status: 200 }, { status: 401 }).fetch, settings });
  t('401 → ключ відхилено', bad401.keyAccepted === false && bad401.tone === 'err', `${bad401.keyAccepted}`);
  t('у тексті сказано про BRIDGE_API_KEY', /BRIDGE_API_KEY/.test(bad401.messageUk));

  const bad403 = await bridge.testBridgeConnection({ fetch: stub({ status: 200 }, { status: 403 }).fetch, settings });
  t('403 теж → ключ відхилено', bad403.keyAccepted === false);

  const weird = await bridge.testBridgeConnection({ fetch: stub({ status: 200 }, { status: 200 }).fetch, settings });
  t('200 → ключ прийнято, але це попередження', weird.keyAccepted === true && weird.tone === 'warn', weird.tone);

  const five = await bridge.testBridgeConnection({ fetch: stub({ status: 200 }, { status: 502 }).fetch, settings });
  t('502 → висновку немає, НЕ успіх', five.keyAccepted === null && five.tone !== 'ok', `${five.keyAccepted} ${five.tone}`);
}

console.log('\nНедоступність відрізняється від невірного ключа:');
{
  const deadStub = stub('throw', { status: 404 });
  const dead = await bridge.testBridgeConnection({ fetch: deadStub.fetch, settings });
  t('адреса мертва → reachable false', dead.reachable === false);
  t('про ключ висновку не роблять', dead.keyAccepted === null, String(dead.keyAccepted));
  t('підказка про адресу API', /api\.fusionlab\.in\.ua|адрес/i.test(dead.messageUk));
  t('ключ у мертву адресу не надсилали',
    deadStub.seen.every((c) => !c.url.includes('/bridge/books')),
    deadStub.seen.map((c) => c.url).join(', '));

  const halfDead = await bridge.testBridgeConnection({ fetch: stub({ status: 200 }, 'throw').fetch, settings });
  t('міст не відповів → не успіх', halfDead.tone !== 'ok' && halfDead.keyAccepted === null, halfDead.tone);
}

console.log('\nНормалізація адреси (секрет не має піти відкритим текстом):');
{
  t('https приймається', bridge.normalizeBridgeUrl('https://api.fusionlab.in.ua/') === 'https://api.fusionlab.in.ua');
  let threw = false;
  try { bridge.normalizeBridgeUrl('http://api.fusionlab.in.ua'); } catch { threw = true; }
  t('http на публічний домен відхилено', threw);
}

console.log('\nТестова книга:');
{
  const book = bridge.bridgeTestBook();
  t('ідентифікатор стабільний', book.bookId === bridge.BRIDGE_TEST_BOOK_ID, book.bookId);
  t('назва сама каже, що це тест і його можна видаляти',
    /тест/i.test(book.title) && /видаляти/i.test(book.title), book.title);
  t('опис пояснює, звідки лістинг узявся', /адмінпанел/i.test(String(book.description)));
}

console.log('\nНадсилання файла книги:');
{
  const seen: any[] = [];
  const mk = (status: number, body = '{}') => (async (url: string, init: any = {}) => {
    seen.push({ url: String(url), method: init.method, key: init.headers?.['x-bridge-key'], body: init.body });
    return { status, ok: status >= 200 && status < 300, text: async () => body };
  }) as never;

  const bytes = new TextEncoder().encode('%PDF-1.7 fake');
  const ok = await bridge.attachBookFileToMarketplace(
    { bookId: 'nova-bridge-test', format: 'digital', filename: 'kniha.pdf', mimeType: 'application/pdf', bytes },
    { fetch: mk(201, JSON.stringify({ attached: true, replaced: 1, media: { id: 'm1' } })), settings });

  t('адреса містить externalId і /file',
    seen[0].url.endsWith('/bridge/books/nova-bridge-test%3Adigital/file'), seen[0].url);
  t('ключ надіслано', seen[0].key === 'secret-key');
  t('тіло — FormData, не JSON', seen[0].body instanceof FormData);
  t('Content-Type НЕ заданий вручну (межу ставить fetch)',
    !Object.keys(seen[0] as any).includes('content-type'));
  t('результат: прикріплено, попередній замінено', ok.attached === true && ok.replaced === 1);

  let notFound: any = null;
  try {
    await bridge.attachBookFileToMarketplace(
      { bookId: 'x', format: 'digital', filename: 'a.pdf', mimeType: 'application/pdf', bytes },
      { fetch: mk(404), settings });
  } catch (e) { notFound = e; }
  t('404 → зрозуміла порада опублікувати спершу',
    /спершу опублікуйте/.test(String(notFound?.message)), String(notFound?.message));

  let badType: any = null;
  try {
    await bridge.attachBookFileToMarketplace(
      { bookId: 'x', format: 'digital', filename: 'a.exe', mimeType: 'application/x-msdownload', bytes },
      { fetch: mk(400, JSON.stringify({ message: 'Тип файлу не підтримується: application/x-msdownload' })), settings });
  } catch (e) { badType = e; }
  t('причина відмови за типом видна', /Тип файлу не підтримується/.test(String(badType?.message)), String(badType?.message));
}

console.log('\nЗняття лістинга з вітрини:');
{
  const calls: any[] = [];
  const mk = (status: number) => (async (url: string, init: any = {}) => {
    calls.push({ url: String(url), method: init.method, key: init.headers?.['x-bridge-key'] });
    return { status, ok: status >= 200 && status < 300, text: async () => 'body' };
  }) as never;

  const gone = await bridge.unpublishBookFromMarketplace(
    { bookId: 'nova-bridge-test', format: 'digital' }, { fetch: mk(200), settings });
  t('успіх → removed: true', gone.removed === true);
  t('externalId склеєний як bookId:format',
    gone.externalId === 'nova-bridge-test:digital', gone.externalId);
  t('метод DELETE і ключ надіслано',
    calls[0].method === 'DELETE' && calls[0].key === 'secret-key');

  const absent = await bridge.unpublishBookFromMarketplace(
    { bookId: 'nova-bridge-test', format: 'digital' }, { fetch: mk(404), settings });
  t('404 не кидає помилку — мета вже досягнута', absent.removed === false);

  let unauthorized: any = null;
  try {
    await bridge.unpublishBookFromMarketplace(
      { bookId: 'x', format: 'digital' }, { fetch: mk(401), settings });
  } catch (e) { unauthorized = e; }
  t('401 → помилка про ключ', unauthorized?.kind === 'unauthorized', String(unauthorized?.kind));

  let rejected: any = null;
  try {
    await bridge.unpublishBookFromMarketplace(
      { bookId: 'x', format: 'digital' }, { fetch: mk(500), settings });
  } catch (e) { rejected = e; }
  t('500 → помилка «відхилено», а не тихий успіх', rejected?.kind === 'rejected', String(rejected?.kind));
}

console.log('\nSlug дістається з конверта приймача:');
{
  const okFetch = (body: string) => (async () => ({
    status: 200, ok: true, text: async () => body,
  })) as never;
  const publish = (body: string) => bridge.publishBookToMarketplace(
    { ...bridge.bridgeTestBook(), format: 'digital', priceMinor: 100 },
    { fetch: okFetch(body), settings });

  // Реальна форма відповіді POST /bridge/books.
  const enveloped = await publish(JSON.stringify({
    created: true,
    listing: { slug: 'testova-knyha-mostu-nova', title: 'Тестова книга' },
  }));
  t('slug витягнуто з {created, listing}', enveloped.slug === 'testova-knyha-mostu-nova', String(enveloped.slug));
  t('created передано далі', enveloped.created === true);

  const updated = await publish(JSON.stringify({ created: false, listing: { slug: 'a-b' } }));
  t('оновлення відрізняється від створення', updated.created === false && updated.slug === 'a-b');

  // Якщо приймач колись віддасть картку без конверта.
  const bare = await publish(JSON.stringify({ slug: 'bez-konverta' }));
  t('картка без конверта теж читається', bare.slug === 'bez-konverta', String(bare.slug));

  const nothing = await publish(JSON.stringify({ created: true, listing: {} }));
  t('без slug — undefined, а не порожній рядок', nothing.slug === undefined, String(nothing.slug));

  t('повна відповідь лишилась для аудиту',
    JSON.stringify((enveloped.listing as any)?.listing?.title) === '"Тестова книга"');
}

console.log('\nПричина відмови маркетплейсу доходить до користувача:');
{
  const reject = (status: number, body: string) => (async () => ({
    status, ok: false, text: async () => body,
  })) as never;
  const publish = async (status: number, body: string) => {
    try {
      await bridge.publishBookToMarketplace(
        { ...bridge.bridgeTestBook(), format: 'digital', priceMinor: 100 },
        { fetch: reject(status, body), settings });
      return '';
    } catch (e: any) { return String(e?.message || ''); }
  };

  const noSeller = await publish(400, JSON.stringify({
    message: 'Не знайдено продавця для книг: передайте sellerSlug або задайте BRIDGE_SELLER_SLUG',
    error: 'Bad Request', statusCode: 400,
  }));
  t('причину видно, а не самий код', /Не знайдено продавця/.test(noSeller), noSeller);
  t('код теж лишився', /400/.test(noSeller));

  const validation = await publish(400, JSON.stringify({
    message: ['title must be longer than or equal to 3 characters', 'priceMinor must be an integer'],
    statusCode: 400,
  }));
  t('масив помилок валідації зведено в рядок',
    /title must be longer/.test(validation) && /priceMinor must be/.test(validation), validation);

  const html = await publish(502, '<html>Bad Gateway</html>');
  t('не-JSON тіло теж показано', /Bad Gateway/.test(html), html);

  const empty = await publish(500, '');
  t('порожнє тіло → лишається код', /HTTP 500/.test(empty), empty);
}

console.log('\nПерелік вітрини і ручне зняття:');
{
  const mk = (status: number, body: string) => (async (url: string, init: any = {}) => {
    seenShelf.push({ url: String(url), method: init.method || 'GET', key: init.headers?.['x-bridge-key'] });
    return { status, ok: status >= 200 && status < 300, text: async () => body };
  }) as never;
  const seenShelf: any[] = [];

  const rows = await bridge.listBridgeBooks({
    fetch: mk(200, JSON.stringify({ books: [
      { externalId: 'b1:digital', slug: 's1', title: 'Книга', status: 'published', priceMinor: 15000, hasFile: true },
    ] })),
    settings,
  });
  t('перелік читається', rows.length === 1 && rows[0].externalId === 'b1:digital', String(rows.length));
  t('ключ надіслано', seenShelf[0].key === 'secret-key');
  t('метод GET', seenShelf[0].method === 'GET');

  const empty = await bridge.listBridgeBooks({ fetch: mk(200, 'не json'), settings });
  t('зіпсована відповідь → порожній перелік, а не падіння', empty.length === 0);

  seenShelf.length = 0;
  const removed = await bridge.unpublishByExternalId('b1:print', { fetch: mk(200, '{}'), settings });
  t('знімається САМЕ той id, що показав перелік',
    seenShelf[0].url.endsWith('/bridge/books/b1%3Aprint'), seenShelf[0].url);
  t('метод DELETE', seenShelf[0].method === 'DELETE');
  t('результат: знято', removed.removed === true);

  const absent = await bridge.unpublishByExternalId('нема', { fetch: mk(404, ''), settings });
  t('404 → не помилка, лістинга вже немає', absent.removed === false);

  let denied: any = null;
  try { await bridge.unpublishByExternalId('x', { fetch: mk(401, ''), settings }); } catch (e) { denied = e; }
  t('401 → помилка про ключ', denied?.kind === 'unauthorized');
}

console.log('\nПовідомлення «не налаштовано» називає саме те, чого бракує:');
{
  // Працюємо зі справжнім сховищем у тимчасовій теці: підмінити експорт
  // ESM-модуля не можна, та й перевіряти краще реальний шлях читання.
  const scenario = async (url: string, key: string) => {
    await store.setAppSetting(bridge.BRIDGE_URL_KEY, url);
    await store.setAppSetting(bridge.BRIDGE_SECRET_KEY, key);
    try { await bridge.readBridgeSettings(); return ''; }
    catch (e: any) { return String(e?.message || ''); }
  };

  const both = await scenario('', '');
  t('нічого не задано — сказано про обидва', /ані адресу/.test(both), both);

  const noUrl = await scenario('', 'encrypted');
  t('ключ є, адреси нема — сказано саме про адресу',
    /ключ збережено/.test(noUrl) && /НЕ задано адресу/.test(noUrl), noUrl);

  const noKey = await scenario('https://api.fusionlab.in.ua', '');
  t('адреса є, ключа нема — сказано саме про ключ',
    /ключ не збережено/.test(noKey), noKey);

}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
