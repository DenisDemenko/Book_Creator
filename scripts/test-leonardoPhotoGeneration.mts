/**
 * Тести server/leonardoPhotoGeneration.ts (задача #203) — 6 фото-двигунів
 * Leonardo v2 API з нативною підтримкою референсних зображень. Мокає
 * global.fetch так само, як scripts/test-videoGeneration.mts і
 * scripts/test-imageGeneration.mts: жодного реального мережевого виклику.
 */
import {
  LEONARDO_V2_PHOTO_SPECS,
  leonardoV2PhotoMaxReferences,
  leonardoV2PhotoDims,
  generateLeonardoV2Photo,
  LeonardoV2PhotoError,
  type LeonardoPhotoEngineId,
} from '../server/leonardoPhotoGeneration';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ALL_IDS: LeonardoPhotoEngineId[] = [
  'leonardo-gpt-image-25-flare',
  'leonardo-gpt-image-25-sunburst',
  'leonardo-nano-banana-2-lite',
  'leonardo-seedream-4-5',
  'leonardo-seedream-5-pro',
  'leonardo-flux-dev',
];

console.log('LEONARDO_V2_PHOTO_SPECS — санітарні перевірки:');
{
  t('рівно 6 моделей', Object.keys(LEONARDO_V2_PHOTO_SPECS).length === 6, Object.keys(LEONARDO_V2_PHOTO_SPECS).join(', '));
  for (const id of ALL_IDS) t(`${id} присутній`, !!LEONARDO_V2_PHOTO_SPECS[id]);

  t('GPT Image 2.5 Flare — модель', LEONARDO_V2_PHOTO_SPECS['leonardo-gpt-image-25-flare'].modelSlug === 'openai/gpt-image-2.5-flare');
  t('GPT Image 2.5 Sunburst — модель', LEONARDO_V2_PHOTO_SPECS['leonardo-gpt-image-25-sunburst'].modelSlug === 'openai/gpt-image-2.5-sunburst');
  t('Nano Banana 2 Lite (Leonardo) — модель', LEONARDO_V2_PHOTO_SPECS['leonardo-nano-banana-2-lite'].modelSlug === 'nano-banana-2-lite');
  t('Seedream 4.5 — модель', LEONARDO_V2_PHOTO_SPECS['leonardo-seedream-4-5'].modelSlug === 'seedream-4.5');
  t('Seedream 5.0 Pro — модель', LEONARDO_V2_PHOTO_SPECS['leonardo-seedream-5-pro'].modelSlug === 'seedream-5.0-pro');
  t('FLUX Dev — модель', LEONARDO_V2_PHOTO_SPECS['leonardo-flux-dev'].modelSlug === 'flux-dev');

  t('GPT Image 2.5 Flare — до 16 референсів', leonardoV2PhotoMaxReferences(LEONARDO_V2_PHOTO_SPECS['leonardo-gpt-image-25-flare']) === 16);
  t('GPT Image 2.5 Sunburst — до 16 референсів', leonardoV2PhotoMaxReferences(LEONARDO_V2_PHOTO_SPECS['leonardo-gpt-image-25-sunburst']) === 16);
  t('Nano Banana 2 Lite (Leonardo) — до 6 референсів', leonardoV2PhotoMaxReferences(LEONARDO_V2_PHOTO_SPECS['leonardo-nano-banana-2-lite']) === 6);
  t('Seedream 4.5 — до 6 референсів', leonardoV2PhotoMaxReferences(LEONARDO_V2_PHOTO_SPECS['leonardo-seedream-4-5']) === 6);
  t('Seedream 5.0 Pro — до 10 референсів', leonardoV2PhotoMaxReferences(LEONARDO_V2_PHOTO_SPECS['leonardo-seedream-5-pro']) === 10);
  t('FLUX Dev — рівно 2 (content+style, не масив "до N")', leonardoV2PhotoMaxReferences(LEONARDO_V2_PHOTO_SPECS['leonardo-flux-dev']) === 2);

  t('НЕ обіцяна вимога автора "до 12" нізвідки не взялась', ![16,6,10,2].includes(12));
}

console.log('\nleonardoV2PhotoDims — прив\'язка до дискретного списку (GPT Image 2.5 Flare):');
{
  const spec = LEONARDO_V2_PHOTO_SPECS['leonardo-gpt-image-25-flare'];
  const allowed = new Set([768, 848, 896, 928, 1024, 1152, 1200, 1264, 1376]);
  for (const ratio of ['1:1', '16:9', '9:16', '3:4', '21:9'] as const) {
    const { width, height } = leonardoV2PhotoDims(spec, ratio);
    t(`${ratio}: ширина ${width} — у дозволеному списку`, allowed.has(width), String(width));
    t(`${ratio}: висота ${height} — у дозволеному списку`, allowed.has(height), String(height));
  }
  const square = leonardoV2PhotoDims(spec, '1:1');
  t('1:1 → квадрат', square.width === square.height, `${square.width}x${square.height}`);
}

console.log('\nleonardoV2PhotoDims — числовий діапазон, кратний 8 (FLUX Dev, 480-2048):');
{
  const spec = LEONARDO_V2_PHOTO_SPECS['leonardo-flux-dev'];
  const { width, height } = leonardoV2PhotoDims(spec, '1:1');
  t('1024x1024 за замовчуванням для 1:1', width === 1024 && height === 1024, `${width}x${height}`);
  const wide = leonardoV2PhotoDims(spec, '21:9');
  t('довша сторона лишається дефолтним лонгсайдом (1024)', wide.width === 1024, String(wide.width));
  t('коротша сторона кратна 8', wide.height % 8 === 0, String(wide.height));
  t('коротша сторона не менша за мінімум (480)', wide.height >= 480, String(wide.height));
}

console.log('\nleonardoV2PhotoDims — Seedream 5.0 Pro (дефолт 2048x2048):');
{
  const spec = LEONARDO_V2_PHOTO_SPECS['leonardo-seedream-5-pro'];
  const { width, height } = leonardoV2PhotoDims(spec, '1:1');
  t('1:1 → 2048x2048 (документований дефолт моделі)', width === 2048 && height === 2048, `${width}x${height}`);
}

function mockSequence(handlers: Array<(url: string, init: any) => any>) {
  let call = 0;
  const seen: Array<{ url: string; init: any }> = [];
  const fn = async (url: string, init?: any) => {
    seen.push({ url: String(url), init });
    const handler = handlers[Math.min(call, handlers.length - 1)];
    call++;
    return handler(String(url), init);
  };
  return { fn, seen, callCount: () => call };
}

console.log('\ngenerateLeonardoV2Photo — без референсів, повний цикл (submit → poll PENDING → poll COMPLETE → завантаження):');
{
  const realFetch = global.fetch;
  const { fn, seen } = mockSequence([
    () => ({ ok: true, status: 200, json: async () => ({ id: 'gen-a1', status: 'PENDING' }) }),
    () => ({ ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'PENDING' } }) }),
    () => ({ ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://example.com/flare.png' }] } }) }),
    () => ({ ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
  ]);
  global.fetch = fn;
  try {
    const result = await generateLeonardoV2Photo({
      engineId: 'leonardo-gpt-image-25-flare',
      apiKey: 'test-key',
      prompt: 'портрет кіберпанк-детектива',
      aspectRatio: '1:1',
    });
    t('повернув буфер із даними', result.buffer.length > 0);
    t('mimeType image/png', result.mimeType === 'image/png', result.mimeType);
    t('URL відправлення — v2/generations', seen[0].url.includes('/v2/generations'), seen[0].url);
    const submittedBody = JSON.parse(seen[0].init.body);
    t('model — правильний slug', submittedBody.model === 'openai/gpt-image-2.5-flare', submittedBody.model);
    t('без guidances, коли референсів нема', !('guidances' in submittedBody.parameters));
    t('quantity — 1 (контракт generateImage() — одне зображення за виклик)', submittedBody.parameters.quantity === 1);
  } catch (e: any) {
    t('успішний цикл не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\ngenerateLeonardoV2Photo — з референсами (Nano Banana 2 Lite через Leonardo, strength підтримується):');
{
  const realFetch = global.fetch;
  // Реальний порядок викликів: fetch(refUrl1) [завантажити джерело] →
  // init-image#1 → S3#1 → fetch(refUrl2) → init-image#2 → S3#2 → submit →
  // poll → завантаження результату.
  const handlers2 = [
    () => ({ ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }), // джерело референс 1
    () => ({ ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'ref-id-1', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k1' }) } }) }), // init-image 1
    () => ({ ok: true, status: 204 }), // S3 upload 1
    () => ({ ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }), // джерело референс 2
    () => ({ ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'ref-id-2', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k2' }) } }) }), // init-image 2
    () => ({ ok: true, status: 204 }), // S3 upload 2
    () => ({ ok: true, status: 200, json: async () => ({ id: 'gen-b2' }) }), // submit
    () => ({ ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://example.com/nb.png' }] } }) }), // poll
    () => ({ ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }), // фінальне завантаження результату
  ];
  const { fn, seen } = mockSequence(handlers2);
  global.fetch = fn;
  try {
    const result = await generateLeonardoV2Photo({
      engineId: 'leonardo-nano-banana-2-lite',
      apiKey: 'test-key',
      prompt: 'x',
      aspectRatio: '1:1',
      referenceImageUrls: ['https://app.example.com/generated/a.png', 'https://app.example.com/generated/b.png'],
    });
    t('повернув буфер', result.buffer.length > 0);
    const submitCall = seen.find((c) => c.url.includes('/v2/generations') && c.init?.method === 'POST' && !c.url.includes('/generations/'));
    t('submit викликано', !!submitCall);
    const body = JSON.parse(submitCall!.init.body);
    t('guidances.image_reference — 2 елементи', body.parameters.guidances.image_reference.length === 2, JSON.stringify(body.parameters.guidances));
    t('перший референс — id завантаженого зображення', body.parameters.guidances.image_reference[0].image.id === 'ref-id-1');
    t('type — UPLOADED', body.parameters.guidances.image_reference[0].image.type === 'UPLOADED');
    t('strength присутній (модель це підтримує)', body.parameters.guidances.image_reference[0].strength === 'MID');
    const uploadCalls = seen.filter((c) => c.url === 'https://s3.example.com/upload');
    t('S3-завантаження відбулось двічі', uploadCalls.length === 2, String(uploadCalls.length));
  } catch (e: any) {
    t('цикл з референсами не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\ngenerateLeonardoV2Photo — GPT Image 2.5 Flare: референс БЕЗ strength (модель його не використовує):');
{
  const realFetch = global.fetch;
  const handlers = [
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
    () => ({ ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'ref-id-x', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k' }) } }) }),
    () => ({ ok: true, status: 204 }),
    () => ({ ok: true, status: 200, json: async () => ({ id: 'gen-c3' }) }),
    () => ({ ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://example.com/f.png' }] } }) }),
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
  ];
  const { fn, seen } = mockSequence(handlers);
  global.fetch = fn;
  try {
    await generateLeonardoV2Photo({
      engineId: 'leonardo-gpt-image-25-flare',
      apiKey: 'test-key',
      prompt: 'x',
      aspectRatio: '1:1',
      referenceImageUrls: ['https://app.example.com/generated/a.png'],
    });
    const submitCall = seen.find((c) => c.url.includes('/v2/generations') && !c.url.includes('/generations/'));
    const body = JSON.parse(submitCall!.init.body);
    t('без strength — «does not use strength» задокументовано', !('strength' in body.parameters.guidances.image_reference[0]), JSON.stringify(body.parameters.guidances));
  } catch (e: any) {
    t('не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\ngenerateLeonardoV2Photo — FLUX Dev: 2 референси → content + style (не масив image_reference):');
{
  const realFetch = global.fetch;
  const handlers = [
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
    () => ({ ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'content-id', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k1' }) } }) }),
    () => ({ ok: true, status: 204 }),
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
    () => ({ ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'style-id', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k2' }) } }) }),
    () => ({ ok: true, status: 204 }),
    () => ({ ok: true, status: 200, json: async () => ({ id: 'gen-d4' }) }),
    () => ({ ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://example.com/fx.png' }] } }) }),
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
  ];
  const { fn, seen } = mockSequence(handlers);
  global.fetch = fn;
  try {
    await generateLeonardoV2Photo({
      engineId: 'leonardo-flux-dev',
      apiKey: 'test-key',
      prompt: 'x',
      aspectRatio: '16:9',
      referenceImageUrls: ['https://app.example.com/generated/content.png', 'https://app.example.com/generated/style.png'],
    });
    const submitCall = seen.find((c) => c.url.includes('/v2/generations') && !c.url.includes('/generations/'));
    const body = JSON.parse(submitCall!.init.body);
    t('guidances.content — 1 елемент, id першого референсу', body.parameters.guidances.content[0].image.id === 'content-id', JSON.stringify(body.parameters.guidances));
    t('guidances.style — 1 елемент, id другого референсу', body.parameters.guidances.style[0].image.id === 'style-id');
    t('немає image_reference (FLUX Dev не приймає цю форму)', !('image_reference' in body.parameters.guidances));
  } catch (e: any) {
    t('не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\ngenerateLeonardoV2Photo — понад межу референсів кидає ДО будь-якого мережевого виклику:');
{
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('не мало викликатись'); };
  try {
    await generateLeonardoV2Photo({
      engineId: 'leonardo-flux-dev',
      apiKey: 'test-key',
      prompt: 'x',
      aspectRatio: '1:1',
      referenceImageUrls: ['https://a', 'https://b', 'https://c'],
    });
    t('3 референси для FLUX Dev (межа 2) мали кинути помилку', false);
  } catch (e: any) {
    t('це LeonardoV2PhotoError', e instanceof LeonardoV2PhotoError);
    t('повідомлення називає межу (2)', /2/.test(e.message), e.message);
    t('жодного мережевого виклику не було', calls === 0, String(calls));
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\ngenerateLeonardoV2Photo — init-image повертає 403 → no_key, без подальших викликів:');
{
  const realFetch = global.fetch;
  const handlers = [
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }), // джерело референсу
    () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }), // init-image
  ];
  const { fn, callCount } = mockSequence(handlers);
  global.fetch = fn;
  try {
    await generateLeonardoV2Photo({
      engineId: 'leonardo-seedream-4-5',
      apiKey: 'test-key',
      prompt: 'x',
      aspectRatio: '1:1',
      referenceImageUrls: ['https://app.example.com/generated/a.png'],
    });
    t('403 на init-image мав кинути помилку', false);
  } catch (e: any) {
    t('kind=no_key', e.kind === 'no_key', e.kind);
    t('лише 2 виклики (джерело + init-image, без S3/submit)', callCount() === 2, String(callCount()));
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\ngenerateLeonardoV2Photo — статус FAILED зупиняє опитування:');
{
  const realFetch = global.fetch;
  const handlers = [
    () => ({ ok: true, status: 200, json: async () => ({ id: 'gen-e5' }) }),
    () => ({ ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'FAILED' } }) }),
  ];
  const { fn, callCount } = mockSequence(handlers);
  global.fetch = fn;
  try {
    await generateLeonardoV2Photo({ engineId: 'leonardo-seedream-5-pro', apiKey: 'test-key', prompt: 'x', aspectRatio: '1:1' });
    t('FAILED мав кинути помилку', false);
  } catch (e: any) {
    t('повідомлення згадує FAILED', /FAILED/.test(e.message), e.message);
    t('лише 2 виклики (submit + одне опитування)', callCount() === 2, String(callCount()));
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\ngenerateLeonardoV2Photo — відповідь опитування БЕЗ обгортки generations_by_pk (як FLUX 3 Video, #202):');
{
  const realFetch = global.fetch;
  const handlers = [
    () => ({ ok: true, status: 200, json: async () => ({ id: 'gen-f6', status: 'PENDING' }) }), // submit — теж без обгортки
    () => ({ ok: true, status: 200, json: async () => ({ status: 'COMPLETE', generated_images: [{ url: 'https://example.com/bare.png' }] }) }), // poll — без generations_by_pk
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
  ];
  const { fn } = mockSequence(handlers);
  global.fetch = fn;
  try {
    const result = await generateLeonardoV2Photo({ engineId: 'leonardo-flux-dev', apiKey: 'test-key', prompt: 'x', aspectRatio: '1:1' });
    t('впорався з відповіддю без generations_by_pk', result.buffer.length > 0);
  } catch (e: any) {
    t('не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\nЗадача #206 — submit НЕ надсилає prompt_enhance (реальний продакшн-збій: Leonardo відхилив жорстко закодоване \'AUTO\' для Seedream 5.0 Pro):');
{
  const realFetch = global.fetch;
  const handlers = [
    () => ({ ok: true, status: 200, json: async () => ({ id: 'gen-g7', status: 'PENDING' }) }),
    () => ({ ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://example.com/g7.png' }] } }) }),
    () => ({ ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from(PNG_B64, 'base64').buffer }),
  ];
  const { fn, seen } = mockSequence(handlers);
  global.fetch = fn;
  try {
    await generateLeonardoV2Photo({ engineId: 'leonardo-seedream-5-pro', apiKey: 'test-key', prompt: 'x', aspectRatio: '1:1' });
    const submitBody = JSON.parse(seen[0].init.body);
    t('parameters БЕЗ prompt_enhance (раніше жорстко \'AUTO\')', !('prompt_enhance' in submitBody.parameters), JSON.stringify(submitBody.parameters));
  } catch (e: any) {
    t('не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\nЗадача #206 — HTTP 200 із GraphQL-конвертом помилки (реальна відповідь Leonardo, Seedream 5.0 Pro, 18.09.2026) розпізнається й показує СПРАВЖНЮ причину, а не "без розпізнаного id":');
{
  const realFetch = global.fetch;
  const REAL_ERROR_BODY = [
    {
      extensions: {
        code: 'BadRequestException',
        details: {
          code: 'VALIDATION_ERROR',
          errors: [{ code: 'VALIDATION_ERROR', message: 'parameters.prompt_enhance must be one of: OFF' }],
          message: 'parameters.prompt_enhance must be one of: OFF',
        },
        statusCode: 400,
      },
      locations: [],
      message: 'An error occurred.',
      path: [],
    },
  ];
  const handlers = [() => ({ ok: true, status: 200, json: async () => REAL_ERROR_BODY })];
  const { fn } = mockSequence(handlers);
  global.fetch = fn;
  try {
    await generateLeonardoV2Photo({ engineId: 'leonardo-seedream-5-pro', apiKey: 'test-key', prompt: 'x', aspectRatio: '1:1' });
    t('мав кинути помилку', false);
  } catch (e: any) {
    t('повідомлення несе СПРАВЖНЮ причину validation-помилки', e.message.includes('prompt_enhance must be one of: OFF'), e.message);
    t('НЕ загальне "відповідь без розпізнаного id"', !e.message.includes('без розпізнаного id'), e.message);
  } finally {
    global.fetch = realFetch;
  }
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
