/**
 * Тести інтеграції з Gamma. Запуск: npm run test:gamma
 *
 * МЕРЕЖІ НЕМАЄ: клієнт приймає fetchImpl ззовні.
 *
 * ЩО САМЕ ВАЖИТЬ. Кожна генерація списує кредити з рахунку ВЛАСНИКА студії,
 * а пробний прогін показав, що їх лишалось близько сотні. Тому перевіряємо
 * не «згенерувалось», а те, що інтеграція не витрачає гроші непомітно й не
 * бреше про причину, коли вони скінчились:
 *
 *  1. 402 від Gamma читається як «кредити скінчились», а не «помилка 402»,
 *     і НЕ повторюється — повтор списав би ще, якби кредити зʼявились;
 *  2. 403 читається як «тариф не дає доступу до API»;
 *  3. витрачені кредити потрапляють у сховище, інакше питання «куди вони
 *     поділись» лишиться без відповіді;
 *  4. ґейт за тарифом стоїть ДО виклику Gamma — інакше безкоштовний
 *     користувач витрачав би чужий баланс.
 */
const DIR = '/tmp/nova-gamma-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/gamma/gammaStore');
const clientMod = await import('../server/gamma/gammaClient');
const { createTokenBucket } = await import('../server/etsy/rateLimiter');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

await db.initDb();

/** Підставний fetch: віддає задану відповідь і рахує виклики. */
function stub(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; headers: any; body?: string }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: any) => {
    calls.push({ url: String(url), method: init?.method || 'GET', headers: init?.headers, body: init?.body });
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  }) as never;
  const client = clientMod.createGammaClient({
    apiKey: 'test-key',
    fetchImpl,
    bucket: createTokenBucket({ capacity: 5, ratePerSecond: 5 }),
    sleep: async () => {},
    log: () => {},
  });
  return { client, calls };
}

console.log('Заголовок і адреса');
{
  const { client, calls } = stub([{ status: 200, body: { generationId: 'gen-1' } }]);
  await clientMod.createGeneration(client, { inputText: 'Тест', format: 'presentation' });
  t('адреса публічного API', calls[0].url === 'https://public-api.gamma.app/v1.0/generations', calls[0].url);
  t('метод POST', calls[0].method === 'POST');
  t('ключ у заголовку X-API-KEY', calls[0].headers['X-API-KEY'] === 'test-key');
  t('тіло — JSON із текстом', JSON.parse(calls[0].body!).inputText === 'Тест');
}

console.log('\nПомилки читаються людською мовою');
{
  const cases: Array<[number, string, string]> = [
    [402, 'no_credits', 'кредит'],
    [403, 'plan', 'тариф'],
    [401, 'no_key', 'GAMMA_API_KEY'],
    [400, 'bad_input', 'параметри'],
  ];
  for (const [status, kind, word] of cases) {
    const { client, calls } = stub([{ status, body: { message: 'nope' } }]);
    let caught: any = null;
    try {
      await clientMod.createGeneration(client, { inputText: 'x' });
    } catch (err) {
      caught = err;
    }
    t(`${status} → kind «${kind}»`, caught?.kind === kind, String(caught?.kind));
    t(`${status} → у тексті є «${word}»`, String(caught?.message).toLowerCase().includes(word.toLowerCase()),
      String(caught?.message).slice(0, 60));
    // Найважливіше: 4xx не повторюємо. Повтор при 402 — це спроба списати
    // ще раз рівно тоді, коли грошей уже немає.
    t(`${status} не повторюється`, calls.length === 1, `${calls.length} виклик(ів)`);
  }
}

console.log('\n5xx повторюється, 4xx — ні');
{
  const { client, calls } = stub([
    { status: 503, body: {} },
    { status: 503, body: {} },
    { status: 200, body: { generationId: 'gen-2' } },
  ]);
  const out = await clientMod.createGeneration(client, { inputText: 'x' });
  t('після двох 503 успіх', out.generationId === 'gen-2');
  t('було три виклики', calls.length === 3, String(calls.length));
}

console.log('\nСховище задач і облік кредитів');
{
  await store.createJob({
    id: 'gen-1', userId: 'u-1', bookId: 'book-1', kind: 'course_deck', format: 'presentation',
    status: 'pending', title: 'Курс', gammaUrl: null, exportUrl: null, exportAs: 'pptx',
    creditsUsed: null, creditsLeft: null, errorUk: null,
  });
  const created = await store.getJob('gen-1');
  t('задача створена в стані pending', created?.status === 'pending');
  t('незавершена задача ще нічого не списала', created?.creditsUsed === null);

  await store.updateJob('gen-1', {
    status: 'completed', gammaUrl: 'https://gamma.app/docs/x',
    exportUrl: 'https://assets/api/x.pptx', creditsUsed: 42, creditsLeft: 95,
  });
  const done = await store.getJob('gen-1');
  t('кредити збережено', done?.creditsUsed === 42 && done?.creditsLeft === 95,
    `${done?.creditsUsed}/${done?.creditsLeft}`);
  t('посилання збережено', Boolean(done?.gammaUrl && done?.exportUrl));

  await store.createJob({
    id: 'gen-2', userId: 'u-1', bookId: null, kind: 'landing', format: 'webpage',
    status: 'completed', title: 'Лендінг', gammaUrl: 'https://gamma.app/docs/y', exportUrl: null,
    exportAs: null, creditsUsed: 30, creditsLeft: 65, errorUk: null,
  });
  await store.createJob({
    id: 'gen-3', userId: 'u-2', bookId: null, kind: 'social', format: 'social',
    status: 'completed', title: 'Пост', gammaUrl: null, exportUrl: null,
    exportAs: null, creditsUsed: 10, creditsLeft: 55, errorUk: null,
  });
  await store.createJob({
    id: 'gen-4', userId: 'u-1', bookId: null, kind: 'document', format: 'document',
    status: 'failed', title: 'Провал', gammaUrl: null, exportUrl: null,
    exportAs: null, creditsUsed: null, creditsLeft: null, errorUk: 'не вийшло',
  });

  const mine = await store.creditsSpent({ userId: 'u-1' });
  t('витрати рахуються по своїх задачах', mine.credits === 72 && mine.jobs === 2,
    `${mine.credits} за ${mine.jobs}`);
  const all = await store.creditsSpent({});
  t('загальні витрати включають усіх', all.credits === 82, String(all.credits));
  t('провалена задача не рахується як витрата',
    (await store.creditsSpent({ userId: 'u-1' })).jobs === 2);

  const list = await store.listJobs('u-1');
  t('перелік фільтрує за автором', list.length === 3, String(list.length));
  t('провалена задача видима в переліку', list.some((j) => j.status === 'failed'));
}

console.log('\nСтатус генерації');
{
  const { client } = stub([{
    status: 200,
    body: {
      generationId: 'gen-9', status: 'completed',
      gammaUrl: 'https://gamma.app/docs/z',
      exportUrl: 'https://assets/z.pptx',
      credits: { deducted: 42, remaining: 95 },
    },
  }]);
  const st = await clientMod.getGeneration(client, 'gen-9');
  t('статус прочитано', st.status === 'completed');
  t('кредити з відповіді доступні', st.credits?.deducted === 42 && st.credits?.remaining === 95);
}

console.log('\nОцінка вартості (цифри з документації Gamma)');
{
  const cost = await import('../server/gamma/gammaCost');

  const deck = cost.estimateGeneration({ numCards: 9, imageTier: 'standard' });
  // 9 карток × 1..3 = 9..27 тексту; 9 картинок × 2..15 = 18..135.
  t('дек 9 карток зі звичайними картинками', deck.min === 27 && deck.max === 162,
    `${deck.min}–${deck.max}`);
  t('видно, скільки з цього — картинки', deck.imagesMin === 18 && deck.imagesMax === 135,
    `${deck.imagesMin}–${deck.imagesMax}`);

  const noImg = cost.estimateGeneration({ numCards: 9, imageTier: 'none' });
  t('без картинок платимо лише за текст', noImg.min === 9 && noImg.max === 27,
    `${noImg.min}–${noImg.max}`);
  t('без картинок їхня частка нульова', noImg.imagesMax === 0);
  // Головне, заради чого рахуємо: картинки дорожчі за текст у рази.
  t('картинки коштують більше за текст', deck.imagesMax > noImg.max * 3,
    `${deck.imagesMax} проти ${noImg.max}`);

  const premium = cost.estimateGeneration({ numCards: 9, imageTier: 'premium' });
  t('преміальні картинки різко дорожчі', premium.max > deck.max * 3,
    `${premium.max} проти ${deck.max}`);

  t('нуль карток → нуль', cost.estimateGeneration({ numCards: 0, imageTier: 'premium' }).max === 0);
  t('сміття в кількості не дає NaN',
    Number.isFinite(cost.estimateGeneration({ numCards: NaN as never, imageTier: 'standard' }).max));

  const img = cost.estimateImage('premium');
  t('окреме зображення — ціна рівня', img.min === 34 && img.max === 75, `${img.min}–${img.max}`);

  // Невідома модель має вважатись дорогою: помилитись у бік «дорожче»
  // безпечніше, ніж пообіцяти дешевину й списати втричі більше.
  t('невідома модель → premium, а не найдешевше',
    cost.tierOfModel('якась-нова-модель-2027') === 'premium',
    cost.tierOfModel('якась-нова-модель-2027'));
  t('klein/turbo → standard', cost.tierOfModel('flux-2-klein') === 'standard');
  t('ultra → ultra', cost.tierOfModel('gemini-3-pro-image-hd') === 'ultra',
    cost.tierOfModel('gemini-3-pro-image-hd'));
  t('порожня модель → standard', cost.tierOfModel(null) === 'standard');
}

console.log('\nОкреме зображення й ліміти квоти');
{
  const { client, calls } = stub([{ status: 200, body: { imageGenerationId: 'img-1', status: 'pending' } }]);
  const out = await clientMod.createImage(client, { prompt: 'обкладинка', sizePreset: 'social-portrait' });
  t('адреса окремого зображення', calls[0].url.endsWith('/v1.0/images'), calls[0].url);
  t('id повернуто', out.imageGenerationId === 'img-1');

  const st = stub([{ status: 200, body: { imageGenerationId: 'img-1', status: 'completed', image: { url: 'https://cdn/x.jpg' }, credits: { deducted: 70, remaining: 60 } } }]);
  const done = await clientMod.getImage(st.client, 'img-1');
  t('статус зображення читається', done.status === 'completed' && done.image?.url === 'https://cdn/x.jpg');
  t('кредити зображення доступні', done.credits?.deducted === 70);
}

console.log('\nЧия підписка працює');
{
  process.env.USER_API_KEY_SECRET = process.env.USER_API_KEY_SECRET || 'x'.repeat(64);
  const account = await import('../server/gamma/gammaAccount');
  const crypto = await import('../server/userApiKeyCrypto');
  const st = await import('../server/store');

  delete process.env.GAMMA_API_KEY;

  // Автор без свого ключа й без ключа студії — чесна відмова з інструкцією.
  const none = await account.resolveGammaKey({ userId: 'u-1', role: 'writer' });
  t('без ключів — генерація недоступна', none.apiKey === null && none.owner === 'none');
  t('відмова каже, ЩО зробити',
    Boolean(none.reasonUk?.includes('Settings') && none.reasonUk?.includes('Pro')),
    String(none.reasonUk).slice(0, 60));

  // ГОЛОВНЕ: ключ студії НЕ підміняє відсутній ключ автора.
  process.env.GAMMA_API_KEY = 'studio-key';
  const writerWithStudioKey = await account.resolveGammaKey({ userId: 'u-1', role: 'writer' });
  t('ключ студії не дістається авторові — чужі гроші не витрачаються',
    writerWithStudioKey.apiKey === null, String(writerWithStudioKey.owner));
  const admin = await account.resolveGammaKey({ userId: 'u-admin', role: 'admin' });
  t('адміністратор працює ключем студії — це його рахунок',
    admin.apiKey === 'studio-key' && admin.owner === 'studio');

  // Власний ключ автора перемагає ключ студії.
  const at = new Date().toISOString();
  await st.upsertUserApiKey({
    userId: 'u-1',
    engine: 'gamma',
    encryptedKey: crypto.encryptApiKey('author-own-key'),
    fingerprint: crypto.apiKeyFingerprint('author-own-key'),
    createdAt: at,
    updatedAt: at,
  });
  const own = await account.resolveGammaKey({ userId: 'u-1', role: 'writer' });
  t('власний ключ автора працює', own.apiKey === 'author-own-key' && own.owner === 'author');

  const adminOwn = await account.resolveGammaKey({ userId: 'u-1', role: 'admin' });
  t('власний ключ має пріоритет навіть в адміністратора',
    adminOwn.owner === 'author', adminOwn.owner);

  await st.deleteUserApiKey('u-1', 'gamma');
  const afterRemove = await account.resolveGammaKey({ userId: 'u-1', role: 'writer' });
  t('після відключення знову недоступно', afterRemove.apiKey === null);
  delete process.env.GAMMA_API_KEY;
}

console.log('\nКонфігурація');
{
  const cfg = await import('../server/gamma/gammaConfig');
  delete process.env.GAMMA_API_KEY;
  const off = cfg.readGammaConfig();
  t('без ключа — не налаштовано', off.configured === false);
  t('причина названа й згадує тариф',
    Boolean(off.reasonUk?.includes('GAMMA_API_KEY') && off.reasonUk?.includes('Pro')),
    String(off.reasonUk).slice(0, 70));
  process.env.GAMMA_API_KEY = 'k';
  t('з ключем — налаштовано', cfg.readGammaConfig().configured === true);
  delete process.env.GAMMA_API_KEY;
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
