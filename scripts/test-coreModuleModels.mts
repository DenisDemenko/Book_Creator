/**
 * Тести прив'язки «модуль ядра AI → модель» (server/coreModuleModels.ts)
 * і мосту до вітрини (server/marketplaceBridge.ts) — обидва тримають
 * налаштування в таблиці `meta`, тож ганяються на одній тимчасовій базі.
 * Запуск: npm run test:core-module-models
 */
const DIR = '/tmp/nova-core-models-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
// Секрет шифрування потрібен мосту: без нього ключ свідомо не зберігається.
process.env.USER_API_KEY_SECRET = 'a'.repeat(64);

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const { initStore } = await import('../server/store.ts');
const {
  readCoreModuleModels,
  setCoreModuleModel,
  resolveModuleModelId,
  CORE_MODULE_MODELS_META_KEY,
} = await import('../server/coreModuleModels.ts');
const {
  normalizeBridgeUrl,
  saveBridgeSettings,
  readBridgeSettings,
  readBridgeSettingsView,
  publishBookToMarketplace,
  publishCourseToMarketplace,
  bridgeExternalId,
  courseExternalId,
  MarketplaceBridgeError,
} = await import('../server/marketplaceBridge.ts');
const { setAppSetting } = await import('../server/store.ts');

await initStore();

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nПрив’язка модуля до моделі:');
{
  t('спочатку мапа порожня', Object.keys(await readCoreModuleModels()).length === 0);

  await setCoreModuleModel('selectionToParagraphs', 'gpt-4o');
  const map = await readCoreModuleModels();
  t('модель збережена', map.selectionToParagraphs === 'gpt-4o');

  t('явний вибір автора перекриває адмінський', (await resolveModuleModelId('selectionToParagraphs', 'claude-sonnet-5')) === 'claude-sonnet-5');
  t('порожній вибір автора віддає адмінський', (await resolveModuleModelId('selectionToParagraphs', '')) === 'gpt-4o');
  t('пробіли — це теж «порожньо»', (await resolveModuleModelId('selectionToParagraphs', '   ')) === 'gpt-4o');
  t('модуль без прив’язки не вигадує модель', (await resolveModuleModelId('chat')) === undefined);

  await setCoreModuleModel('selectionToParagraphs', '');
  t('порожнє значення прибирає прив’язку', (await readCoreModuleModels()).selectionToParagraphs === undefined);

  await setCoreModuleModel('chat', 'gemini-3.7-flash');
  await setCoreModuleModel('kdp', 'claude-sonnet-5');
  const two = await readCoreModuleModels();
  t('модулі не затирають один одного', two.chat === 'gemini-3.7-flash' && two.kdp === 'claude-sonnet-5');

  await setAppSetting(CORE_MODULE_MODELS_META_KEY, '{зіпсований json');
  t('зіпсована мапа не валить читання', Object.keys(await readCoreModuleModels()).length === 0);

  await setAppSetting(CORE_MODULE_MODELS_META_KEY, JSON.stringify({ chat: 'ok-model', notAModule: 'x', kdp: 42 }));
  const cleaned = await readCoreModuleModels();
  t('чужі ключі й нерядкові значення відкидаються', cleaned.chat === 'ok-model' && Object.keys(cleaned).length === 1);
}

console.log('\nАдреса мосту:');
{
  t('прибирає кінцевий слеш', normalizeBridgeUrl('https://api.fusionlab.in.ua/') === 'https://api.fusionlab.in.ua');
  t('порожній рядок лишається порожнім', normalizeBridgeUrl('  ') === '');
  t('localhost по http дозволений', normalizeBridgeUrl('http://localhost:3001') === 'http://localhost:3001');

  let rejectedPlainHttp = false;
  try { normalizeBridgeUrl('http://api.fusionlab.in.ua'); } catch (e) { rejectedPlainHttp = e instanceof MarketplaceBridgeError; }
  t('публічний http відхилено — ключ не піде відкритим текстом', rejectedPlainHttp);

  let rejectedGarbage = false;
  try { normalizeBridgeUrl('не-url'); } catch (e) { rejectedGarbage = e instanceof MarketplaceBridgeError; }
  t('сміття замість URL відхилено', rejectedGarbage);
}

console.log('\nНалаштування мосту:');
{
  const empty = await readBridgeSettingsView();
  t('спочатку ключа немає', empty.keySet === false && empty.url === '');

  let notConfigured = false;
  try { await readBridgeSettings(); } catch (e: any) { notConfigured = e?.kind === 'not_configured'; }
  t('без налаштувань — чесна помилка, а не порожній запит', notConfigured);

  const view = await saveBridgeSettings({ url: 'https://api.fusionlab.in.ua', key: 'super-secret-bridge-key' });
  t('ключ збережено', view.keySet === true);
  t('віддається лише відбиток, не сам ключ', Boolean(view.keyFingerprint) && !JSON.stringify(view).includes('super-secret-bridge-key'));

  const raw = await (await import('../server/store.ts')).getAppSetting('marketplace_bridge_key');
  t('у базі ключ зашифрований', Boolean(raw) && !String(raw).includes('super-secret-bridge-key'));

  const settings = await readBridgeSettings();
  t('розшифровується назад', settings.key === 'super-secret-bridge-key' && settings.url === 'https://api.fusionlab.in.ua');
}

console.log('\nПублікація у вітрину:');
{
  t('externalId розрізняє формати', bridgeExternalId('book-1', 'print') !== bridgeExternalId('book-1', 'digital'));

  const calls: { url: string; init: any }[] = [];
  const fakeFetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'listing-1', slug: 'testova-knyha' }), { status: 201 });
  }) as unknown as typeof fetch;

  const result = await publishBookToMarketplace(
    {
      bookId: 'book-1',
      format: 'digital',
      title: 'Тестова книга',
      priceMinor: 32000,
      coverUrl: 'https://example.com/cover.png',
      highlights: ['PDF', 'EPUB'],
    },
    { fetch: fakeFetch, settings: { url: 'https://api.example.com', key: 'k' } }
  );

  t('пішов запит на /bridge/books', calls[0]?.url === 'https://api.example.com/bridge/books');
  t('ключ у заголовку', calls[0]?.init?.headers?.['x-bridge-key'] === 'k');
  const sent = JSON.parse(calls[0].init.body);
  t('externalId містить формат', sent.externalId === 'book-1:digital');
  t('ціна в копійках цілим числом', sent.priceMinor === 32000 && Number.isInteger(sent.priceMinor));
  t('відповідь маркетплейсу повернена', (result.listing as any)?.slug === 'testova-knyha');

  // Дробова ціна не має витікати в API — гроші лише цілими копійками.
  const rounding: { init: any }[] = [];
  const roundFetch = (async (_u: any, init: any) => { rounding.push({ init }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  await publishBookToMarketplace(
    { bookId: 'b', format: 'print', title: 'X', priceMinor: 120000.6 },
    { fetch: roundFetch, settings: { url: 'https://api.example.com', key: 'k' } }
  );
  t('дробова ціна округлена', JSON.parse(rounding[0].init.body).priceMinor === 120001);

  const unauthorized = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
  let kind = '';
  try {
    await publishBookToMarketplace(
      { bookId: 'b', format: 'digital', title: 'X', priceMinor: 1 },
      { fetch: unauthorized, settings: { url: 'https://api.example.com', key: 'bad' } }
    );
  } catch (e: any) { kind = e?.kind; }
  t('401 від маркетплейсу — зрозуміла помилка про ключ', kind === 'unauthorized');

  const broken = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  let unreachable = '';
  try {
    await publishBookToMarketplace(
      { bookId: 'b', format: 'digital', title: 'X', priceMinor: 1 },
      { fetch: broken, settings: { url: 'https://api.example.com', key: 'k' } }
    );
  } catch (e: any) { unreachable = e?.kind; }
  t('недоступний маркетплейс — окремий вид помилки', unreachable === 'unreachable');
}

console.log('\nПублікація курсу у вітрину:');
{
  t('externalId курсу — без формату, один товар на книгу', courseExternalId('book-1') === 'book-1:course');
  t('externalId курсу відрізняється від externalId книги', courseExternalId('book-1') !== bridgeExternalId('book-1', 'digital'));

  const calls: { url: string; init: any }[] = [];
  const fakeFetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'course-listing-1', slug: 'testovyi-kurs' }), { status: 201 });
  }) as unknown as typeof fetch;

  const result = await publishCourseToMarketplace(
    {
      bookId: 'book-1',
      title: 'Тестовий курс',
      priceMinor: 45000,
      coverUrl: 'https://example.com/cover.png',
      highlights: ['Модуль 1', 'Модуль 2'],
      moduleCount: 2,
      lessonCount: 7,
    },
    { fetch: fakeFetch, settings: { url: 'https://api.example.com', key: 'k' } }
  );

  t('пішов запит на /bridge/courses (окремий шлях від /bridge/books)', calls[0]?.url === 'https://api.example.com/bridge/courses');
  t('ключ у заголовку', calls[0]?.init?.headers?.['x-bridge-key'] === 'k');
  const sent = JSON.parse(calls[0].init.body);
  t('externalId курсу в тілі запиту', sent.externalId === 'book-1:course');
  t('кількість модулів і уроків передана', sent.moduleCount === 2 && sent.lessonCount === 7);
  t('відповідь маркетплейсу повернена', (result.listing as any)?.slug === 'testovyi-kurs');

  // Приймач /bridge/courses на боці Fusion Lab не підтверджений — тест
  // фіксує, що Nova коректно повідомляє про недоступність/відмову, а не
  // прикидається, ніби публікація вдалась.
  const notFound = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
  let notFoundKind = '';
  try {
    await publishCourseToMarketplace(
      { bookId: 'b', title: 'X', priceMinor: 1 },
      { fetch: notFound, settings: { url: 'https://api.example.com', key: 'k' } }
    );
  } catch (e: any) { notFoundKind = e?.kind; }
  t('відсутній /bridge/courses на боці вітрини — чесна помилка «rejected», не мовчазний успіх', notFoundKind === 'rejected');
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
