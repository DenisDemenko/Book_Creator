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
