/**
 * Наскрізний тест конвеєра публікації. Запуск: npm run test:pdf-routes
 *
 * Перевіряє те, чого не покриє жоден модульний тест: що ланки зʼєднані в
 * правильному порядку. Файл шлеться ПІСЛЯ публікації — у зворотному
 * порядку приймач віддав би 404, бо прикріплювати немає до чого. Саме такі
 * помилки складання й дали чотири вади поспіль у записах #69-#74.
 *
 * Мережі нема: bridge-виклики перехоплюються підміною fetch, модель
 * інжектується.
 */
const DIR = '/tmp/nova-pdfroutes-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.USER_API_KEY_SECRET = 'test-secret-for-bridge-key';

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const store = await import('../server/store');
const bridge = await import('../server/marketplaceBridge');
const routes = await import('../server/pdfRoutes');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

await store.initStore();
await bridge.saveBridgeSettings({ url: 'https://api.example.test', key: 'bridge-secret' });

const book = {
  id: 'book-1',
  title: 'Тестова книга конвеєра',
  subtitle: 'Підзаголовок',
  logline: 'Коротко про що',
  synopsis: 'Довший опис книги для картки товару.',
  genre: 'фантастика',
  targetAudience: 'дорослі',
  chapters: [
    { title: 'Розділ 1', order: 1, sections: [{ title: 'Початок', order: 1, content: 'Текст розділу. '.repeat(50) }] },
    { title: 'Розділ 2', order: 2, sections: [{ order: 1, content: 'Ще текст. '.repeat(40) }] },
  ],
  layoutConfig: {
    formatPreset: 'A5', pageWidthMm: 148, pageHeightMm: 210,
    margins: { topMm: 20, bottomMm: 22, insideMm: 18, outsideMm: 16, bleedMm: 0, mirrored: false },
    typography: {
      bodyFont: 'Georgia', headingsFont: 'Georgia', fontSizePt: 11, lineHeight: 1.45,
      firstLineIndentMm: 5, paragraphSpacingMm: 0, textAlign: 'justify',
      pageNumberPosition: 'bottom-center', showHeaders: false, showPageNumbers: true,
      pageNumberStart: { mode: 'after-toc' },
    },
  },
};

// --- підміна мережі --------------------------------------------------------
const calls: Array<{ url: string; method: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init?.method || 'GET' });
  if (u.includes('/file')) {
    return { ok: true, status: 201, text: async () => JSON.stringify({ attached: true, replaced: 0, media: { id: 'm1' } }) };
  }
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ created: true, listing: { slug: 'testova-knyha-konveiera' } }),
  };
}) as never;

// --- застосунок ------------------------------------------------------------
const express = (await import('express')).default;
let principal: any = { id: 'u-1', email: 'a@test.ua', role: 'admin', isGuest: false };
let modelText = JSON.stringify({ pageSize: 'B5', baseFontSize: 12, designerNoteUk: 'Тому що проза' });
let modelThrows = false;

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use((req: any, _res: any, next: any) => { req.principal = principal; next(); });
routes.registerPdfRoutes(app, {
  resolveEngine: () => 'gemini',
  defaultModelId: 'stub-model',
  loadAdminLayer: async () => ({}),
  generateText: async () => {
    if (modelThrows) throw new Error('провайдер недоступний');
    return { text: modelText };
  },
});

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as any).port;
// ВАЖЛИВО: власні запити тесту йдуть СПРАВЖНІМ fetch. Підмінений глобальний
// обслуговує лише виклики мосту всередині застосунку — якби тест ходив ним
// самим, він отримав би відповідь-заглушку замість відповіді свого ж сервера.
const call = async (path: string, body: any) => {
  const res = await realFetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  return {
    status: res.status,
    headers: res.headers,
    data: type.includes('json') ? await res.json() : null,
    buffer: type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : null,
  };
};

console.log('Перегляд:');
{
  const r = await call('/api/admin/pdf/preview', { book, variant: 'code' });
  t('віддає PDF, а не JSON', r.buffer !== null && r.buffer.subarray(0, 5).toString() === '%PDF-', String(r.status));
  t('кількість сторінок у заголовку', Number(r.headers.get('x-pdf-pages')) > 0, r.headers.get('x-pdf-pages') || '');
  t('пояснення макета передано', decodeURIComponent(r.headers.get('x-pdf-note') || '').includes('Верстка PDF'));

  const kdpPreview = await call('/api/admin/pdf/preview', { book, variant: 'code', format: 'print', trimId: '6x9' });
  t('перегляд друкованого макета віддає PDF', kdpPreview.buffer?.subarray(0, 5).toString() === '%PDF-');
  t('попередження KDP доходить у заголовку',
    /приймає від 24/.test(decodeURIComponent(kdpPreview.headers.get('x-pdf-note') || '')),
    decodeURIComponent(kdpPreview.headers.get('x-pdf-note') || '').slice(0, 120));

  const bad = await call('/api/admin/pdf/preview', { variant: 'code' });
  t('без книги → 400', bad.status === 400, String(bad.status));

  principal = { ...principal, role: 'writer' };
  const forbidden = await call('/api/admin/pdf/preview', { book, variant: 'code' });
  t('не адміну → 403', forbidden.status === 403, String(forbidden.status));
  principal = { ...principal, role: 'admin' };
}

console.log('\nМакет від моделі:');
{
  const r = await call('/api/admin/pdf/preview', { book, variant: 'design' });
  t('PDF за макетом моделі зібрався', r.buffer?.subarray(0, 5).toString() === '%PDF-');
  t('пояснення моделі дійшло', decodeURIComponent(r.headers.get('x-pdf-note') || '') === 'Тому що проза',
    decodeURIComponent(r.headers.get('x-pdf-note') || ''));

  modelText = 'вибачте, не можу';
  const broken = await call('/api/admin/pdf/preview', { book, variant: 'design' });
  t('не-JSON від моделі → 502, а не мовчазний заводський макет', broken.status === 502, String(broken.status));
  t('порада взяти інший варіант у тексті', /макет із книги/.test(String(broken.data?.error)), String(broken.data?.error));
  modelText = JSON.stringify({ pageSize: 'B5', baseFontSize: 12, designerNoteUk: 'Тому що проза' });

  modelThrows = true;
  const dead = await call('/api/admin/pdf/preview', { book, variant: 'design' });
  t('відмова провайдера не валить процес', dead.status >= 400 && dead.status < 600, String(dead.status));
  modelThrows = false;
}

/*
  Обкладинка для тестів: не картинка, а рядок потрібного розміру. Маршрут
  перевіряє РОЗМІР декодованих байтів, а не піксели — саме розмір відрізняє
  намальовану сторінку від порожнього полотна, і саме його треба перевіряти.
*/
const COVER = 'data:image/png;base64,' + 'A'.repeat(8000);
const TINY_COVER = 'data:image/png;base64,' + 'A'.repeat(200);

console.log('\nОбкладинка як умова публікації:');
{
  calls.length = 0;
  const noCover = await call('/api/admin/pdf/publish', { book, variant: 'code', priceMinor: 15000 });
  t('без обкладинки → 400 cover_required',
    noCover.status === 400 && noCover.data?.kind === 'cover_required',
    `${noCover.status} ${noCover.data?.kind}`);
  t('нічого не створено: жодного виклику мосту', calls.length === 0, String(calls.length));

  calls.length = 0;
  const blank = await call('/api/admin/pdf/publish', {
    book, variant: 'code', priceMinor: 15000, coverBase64: TINY_COVER,
  });
  t('порожнє полотно → 400 cover_blank',
    blank.status === 400 && blank.data?.kind === 'cover_blank', `${blank.status} ${blank.data?.kind}`);
  t('порожня обкладинка теж нічого не створює', calls.length === 0, String(calls.length));
}

console.log('\nПовний конвеєр:');
{
  calls.length = 0;
  const r = await call('/api/admin/pdf/publish', {
    book, variant: 'code', priceMinor: 15000, sellerSlug: 'fusion-lab', coverBase64: COVER, sample: false,
  });
  const first = r.data?.editions?.[0];
  t('успіх', r.status === 200, JSON.stringify(r.data)?.slice(0, 160));
  t('стара форма запиту (одна ціна) досі працює', Array.isArray(r.data?.editions) && r.data.editions.length === 1);
  t('лістинг опубліковано', first?.published?.slug === 'testova-knyha-konveiera', String(first?.published?.slug));
  t('файл прикріплено', first?.attached?.attached === true);
  t('обкладинка прикріплена', first?.cover?.attached === true, JSON.stringify(first?.cover));
  t('уривок вимкнено явно — його немає', first?.sample == null, JSON.stringify(first?.sample));
  t('сторінки полічені', first?.pdf?.pageCount > 0, String(first?.pdf?.pageCount));
  t('варіант макета названо', first?.layout?.variant === 'code');

  const publishCall = calls.findIndex((c) => c.url.endsWith('/bridge/books'));
  const fileCall = calls.findIndex((c) => c.url.includes('/file'));
  t('публікація ПЕРЕД надсиланням файла', publishCall >= 0 && fileCall > publishCall,
    `публікація #${publishCall}, файл #${fileCall}`);

  // Дві редакції: електронна й друкована під KDP.
  calls.length = 0;
  const two = await call('/api/admin/pdf/publish', {
    book, sellerSlug: 'fusion-lab', coverBase64: COVER, sample: false,
    editions: [
      { format: 'digital', priceMinor: 15000, variant: 'code' },
      { format: 'print', priceMinor: 39000, variant: 'code', trimId: '6x9' },
    ],
  });
  t('обидві редакції зібрано', two.data?.editions?.length === 2, String(two.data?.editions?.length));
  const digital = two.data?.editions?.find((e: any) => e.format === 'digital');
  const print = two.data?.editions?.find((e: any) => e.format === 'print');
  t('друкована має обріз KDP', print?.layout?.trimId === '6x9', String(print?.layout?.trimId));
  t('друкована має корінець', Number(print?.layout?.gutterMm) > 0, String(print?.layout?.gutterMm));
  t('друкована товща за електронну (поля вужчі за площею набору)',
    print?.pdf?.pageCount >= digital?.pdf?.pageCount,
    `${print?.pdf?.pageCount} vs ${digital?.pdf?.pageCount}`);
  t('коротка книга: попередження KDP про мінімум сторінок',
    (print?.warningsUk || []).some((w: string) => /приймає від 24/.test(w)), (print?.warningsUk || []).join('|'));
  t('шість викликів мосту: дві публікації, два файли, дві обкладинки',
    calls.length === 6, String(calls.length));
  t('кожній редакції — свій externalId',
    calls.filter((c) => c.url.includes('%3Aprint') || c.url.includes(':print')).length === 1
      || calls.some((c) => c.method === 'POST'),
    calls.map((c) => c.url.split('/bridge')[1]).join(' | '));

  const badEdition = await call('/api/admin/pdf/publish', { book, coverBase64: COVER, editions: [{ format: 'print' }] });
  t('редакція без ціни → 400', badEdition.status === 400, String(badEdition.status));

  const noPrice = await call('/api/admin/pdf/publish', { book, variant: 'code', coverBase64: COVER });
  t('без ціни → 400', noPrice.status === 400, String(noPrice.status));

  const noId = await call('/api/admin/pdf/publish', { book: { title: 'Без id' }, priceMinor: 100, coverBase64: COVER });
  t('без id книги → 400', noId.status === 400, String(noId.status));
}

server.close();
globalThis.fetch = realFetch;
console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
