/**
 * Тести розділу «Ключі API користувача». Запуск: npm run test:api-keys
 *
 * Покриття: шифрування «у спокої» (server/userApiKeyCrypto.ts), шар сховища
 * (server/store.ts, sqlite-бекенд), HTTP-роути (server/apiKeysRoutes.ts) на
 * піднятому Express із підставним req.principal (без мережі й без реального
 * логіну — той самий підхід, що в scripts/test-chatSessions.mts), і що
 * server/chatProviders.ts реально бере apiKeyOverride замість env-ключа
 * (перехоплюємо global.fetch, мережа не йде).
 */
const DIR = '/tmp/nova-api-keys-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
delete process.env.USER_API_KEY_SECRET;
delete process.env.SESSION_SECRET;

import fs from 'node:fs';
import express from 'express';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/store');
const crypto = await import('../server/userApiKeyCrypto');
const providers = await import('../server/chatProviders');
const apiKeysRoutes = await import('../server/apiKeysRoutes');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

await db.initDb();
await store.initStore();

// ---------------------------------------------------------------------------
console.log('\nШифрування — без секрету в середовищі:');
{
  t('isApiKeyCryptoConfigured() === false без секрету', crypto.isApiKeyCryptoConfigured() === false);
  let threw = false;
  try { crypto.encryptApiKey('sk-test-123'); } catch { threw = true; }
  t('encryptApiKey кидає помилку без секрету', threw);
}

process.env.USER_API_KEY_SECRET = 'test-secret-do-not-use-in-prod';

console.log('\nШифрування — із секретом:');
{
  t('isApiKeyCryptoConfigured() === true із секретом', crypto.isApiKeyCryptoConfigured() === true);

  const plain = 'sk-deepseek-abc123XYZ';
  const enc = crypto.encryptApiKey(plain);
  t('шифротекст не містить відкритий ключ', !enc.includes(plain));
  t('шифротекст має формат v1:iv:tag:data', enc.split(':').length === 4 && enc.startsWith('v1:'));
  t('розшифрування повертає той самий ключ', crypto.decryptApiKey(enc) === plain);

  const enc2 = crypto.encryptApiKey(plain);
  t('два шифрування того самого ключа дають різний шифротекст (випадковий IV)', enc !== enc2);
  t('але розшифровуються в те саме', crypto.decryptApiKey(enc2) === plain);

  const fp1 = crypto.apiKeyFingerprint(plain);
  const fp2 = crypto.apiKeyFingerprint(plain);
  const fp3 = crypto.apiKeyFingerprint('інший-ключ');
  t('відбиток стабільний для того самого ключа', fp1 === fp2, `${fp1} vs ${fp2}`);
  t('відбиток різний для різних ключів', fp1 !== fp3);
  t('відбиток не розкриває сам ключ', !fp1.includes(plain));

  let threwBad = false;
  try { crypto.decryptApiKey('щось-неправильне'); } catch { threwBad = true; }
  t('розшифрування невалідного формату кидає помилку', threwBad);
}

// ---------------------------------------------------------------------------
console.log('\nШар сховища (server/store.ts):');
{
  const now = new Date().toISOString();
  const enc = crypto.encryptApiKey('sk-owner-key');
  await store.upsertUserApiKey({ userId: 'u-1', engine: 'deepseek', encryptedKey: enc, fingerprint: 'abc123', createdAt: now, updatedAt: now });

  const fetched = await store.getUserApiKey('u-1', 'deepseek');
  t('ключ збережено й читається', fetched?.encryptedKey === enc);
  t('розшифрування збереженого ключа дає оригінал', fetched && crypto.decryptApiKey(fetched.encryptedKey) === 'sk-owner-key');
  t('чужого ключа для іншого рушія немає', (await store.getUserApiKey('u-1', 'groq')) === undefined);
  t('ключ іншого користувача не видно', (await store.getUserApiKey('u-2', 'deepseek')) === undefined);

  // upsert — заміна того самого (userId, engine)
  const enc2 = crypto.encryptApiKey('sk-replaced-key');
  await store.upsertUserApiKey({ userId: 'u-1', engine: 'deepseek', encryptedKey: enc2, fingerprint: 'def456', createdAt: now, updatedAt: now });
  const replaced = await store.getUserApiKey('u-1', 'deepseek');
  t('upsert замінює попередній ключ того самого рушія', replaced?.encryptedKey === enc2);

  await store.upsertUserApiKey({ userId: 'u-1', engine: 'mistral', encryptedKey: crypto.encryptApiKey('sk-2'), fingerprint: 'g1', createdAt: now, updatedAt: now });
  const listed = await store.listUserApiKeys('u-1');
  t('список повертає всі ключі користувача', listed.length === 2, String(listed.length));

  t('видалення повертає true', (await store.deleteUserApiKey('u-1', 'deepseek')) === true);
  t('після видалення ключа немає', (await store.getUserApiKey('u-1', 'deepseek')) === undefined);
  t('повторне видалення повертає false', (await store.deleteUserApiKey('u-1', 'deepseek')) === false);
  t('інший ключ користувача не зачепило видалення', (await store.getUserApiKey('u-1', 'mistral')) !== undefined);
}

// ---------------------------------------------------------------------------
console.log('\nHTTP-роути (server/apiKeysRoutes.ts):');
{
  let currentPrincipal: any = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'admin', isGuest: false };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.principal = currentPrincipal; next(); });
  apiKeysRoutes.registerApiKeysRoutes(app);

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, path: string, body?: any) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  const initial = await call('GET', '/api/account/api-keys');
  t('GET /api-keys → 200', initial.status === 200, String(initial.status));
  // Шість текстових рушіїв + двигуни зображень. Перевіряємо не загальне
  // число, а склад: інакше додавання будь-якого провайдера вимагає правити
  // тест, нічого при цьому не доводячи.
  const initialKeys: any[] = initial.data?.keys ?? [];
  t(
    'повертає рівно 6 текстових провайдерів',
    initialKeys.filter((k) => k.kind !== 'image').length === 6,
    String(initialKeys.filter((k) => k.kind !== 'image').length)
  );
  t(
    'Seedream присутній як провайдер зображень',
    initialKeys.some((k) => k.engine === 'seedream' && k.kind === 'image'),
    initialKeys.map((k) => `${k.engine}:${k.kind}`).join(', ')
  );
  t('спочатку жоден власний ключ не заданий', initial.data.keys.every((k: any) => k.configured === false));
  t('відповідь не містить сам ключ', !JSON.stringify(initial.data).includes('sk-'));

  const savedImage = await call('PUT', '/api/account/api-keys/seedream', { apiKey: 'ark-user-own-key-123' });
  t('PUT ключа Seedream → 200', savedImage.status === 200, String(savedImage.status));
  const afterImage = await call('GET', '/api/account/api-keys');
  t(
    'Seedream позначений як налаштований власним ключем',
    (afterImage.data?.keys ?? []).some((k: any) => k.engine === 'seedream' && k.configured === true)
  );
  await call('DELETE', '/api/account/api-keys/seedream');

  const prevPrincipal = currentPrincipal;
  currentPrincipal = { id: 'u-writer', email: 'writer@test.ua', name: 'Письменник', role: 'writer', isGuest: false };
  const writerGet = await call('GET', '/api/account/api-keys');
  t('письменник не має доступу до ключів → 403', writerGet.status === 403, String(writerGet.status));
  const writerPut = await call('PUT', '/api/account/api-keys/groq', { apiKey: 'gsk-writer' });
  t('письменник не може зберегти ключ → 403', writerPut.status === 403, String(writerPut.status));
  currentPrincipal = prevPrincipal;

  const badEngine = await call('PUT', '/api/account/api-keys/not-a-real-engine', { apiKey: 'sk-x' });
  t('невідомий провайдер → 400', badEngine.status === 400, String(badEngine.status));

  const emptyKey = await call('PUT', '/api/account/api-keys/groq', { apiKey: '   ' });
  t('порожній ключ → 400', emptyKey.status === 400, String(emptyKey.status));

  const saved = await call('PUT', '/api/account/api-keys/groq', { apiKey: 'gsk-user-own-key-123' });
  t('PUT дійсний ключ → 200', saved.status === 200, String(saved.status));
  t('відповідь підтверджує configured: true', saved.data?.configured === true);
  t('відповідь має відбиток, а не сам ключ', !!saved.data?.fingerprint && !JSON.stringify(saved.data).includes('gsk-user-own-key-123'));

  const afterSave = await call('GET', '/api/account/api-keys');
  const groqRow = afterSave.data.keys.find((k: any) => k.engine === 'groq');
  t('GET після збереження показує configured: true для groq', groqRow?.configured === true);
  t('інші провайдери лишились не заданими', afterSave.data.keys.filter((k: any) => k.engine !== 'groq').every((k: any) => k.configured === false));

  // Ізоляція між користувачами
  currentPrincipal = { id: 'u-other', email: 'other@test.ua', name: 'Інший', role: 'admin', isGuest: false };
  const otherView = await call('GET', '/api/account/api-keys');
  const otherGroq = otherView.data.keys.find((k: any) => k.engine === 'groq');
  t('чужий ключ не видно іншому користувачу', otherGroq?.configured === false);
  currentPrincipal = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'admin', isGuest: false };

  const deleted = await call('DELETE', '/api/account/api-keys/groq');
  t('DELETE → 200', deleted.status === 200, String(deleted.status));
  const afterDelete = await call('GET', '/api/account/api-keys');
  t('після видалення знову configured: false', afterDelete.data.keys.find((k: any) => k.engine === 'groq')?.configured === false);

  // Гість — 401 (requireAuth, як і в чат-роутах)
  currentPrincipal = { id: null, email: null, name: 'Гість', role: 'guest', isGuest: true };
  const guest = await call('GET', '/api/account/api-keys');
  t('гість → 401', guest.status === 401, String(guest.status));

  await new Promise((r) => server.close(r));
}

// ---------------------------------------------------------------------------
console.log('\nHTTP-роути — 503 без налаштованого секрету:');
{
  delete process.env.USER_API_KEY_SECRET;
  const appNoSecret = express();
  appNoSecret.use(express.json());
  appNoSecret.use((req: any, _res, next) => { req.principal = { id: 'u-nosecret', role: 'admin', isGuest: false }; next(); });
  apiKeysRoutes.registerApiKeysRoutes(appNoSecret);
  const serverNoSecret = appNoSecret.listen(0);
  await new Promise((r) => serverNoSecret.once('listening', r));
  const portNoSecret = (serverNoSecret.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${portNoSecret}/api/account/api-keys/groq`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-x' }),
  });
  t('PUT без USER_API_KEY_SECRET → 503', res.status === 503, String(res.status));
  await new Promise((r) => serverNoSecret.close(r));
  process.env.USER_API_KEY_SECRET = 'test-secret-do-not-use-in-prod';
}

// ---------------------------------------------------------------------------
console.log('\nchatProviders.PROVIDERS бере apiKeyOverride замість env-ключа:');
{
  const originalFetch = globalThis.fetch;
  let capturedInit: any = null;
  let capturedUrl = '';
  (globalThis as any).fetch = async (url: string, init?: any) => {
    capturedUrl = String(url);
    capturedInit = init;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        content: [{ type: 'text', text: 'ok' }],
        usage_: undefined,
      }),
    } as any;
  };

  try {
    delete process.env.MISTRAL_API_KEY;
    await providers.PROVIDERS.mistral('привіт', 'system', 'mistral-large-latest', 'user-override-mistral-key');
    const auth = capturedInit?.headers?.Authorization || '';
    t('openAiCompatible (mistral): Authorization несе user-override ключ', auth === 'Bearer user-override-mistral-key', auth);

    delete process.env.GEMINI_API_KEY;
    await providers.PROVIDERS.gemini('привіт', 'system', 'gemini-3.7-flash', 'user-override-gemini-key');
    t('generateGemini: ключ підставлено в URL query', capturedUrl.includes('key=user-override-gemini-key'), capturedUrl);

    delete process.env.ANTHROPIC_API_KEY;
    await providers.PROVIDERS.claude('привіт', 'system', 'claude-sonnet-5', 'user-override-claude-key');
    const xKey = capturedInit?.headers?.['x-api-key'] || '';
    t('generateClaude: x-api-key несе user-override ключ', xKey === 'user-override-claude-key', xKey);
    const claudeBody = JSON.parse(capturedInit?.body || '{}');
    t('generateClaude: тіло запиту НЕ містить temperature (сучасні моделі Claude відповідають 400 на цей параметр)',
      !('temperature' in claudeBody), JSON.stringify(claudeBody));

    // Без override і без env-ключа — має впасти на "не налаштований провайдер"
    delete process.env.GROQ_API_KEY;
    let threwMissing = false;
    try { await providers.PROVIDERS.groq('привіт', 'system', 'llama-3.3-70b-versatile'); }
    catch (err: any) { threwMissing = /не налаштований/.test(err?.message || ''); }
    t('без override і без env-ключа → помилка «не налаштований»', threwMissing);

    // Прикріплені зображення — VISION_ENGINES (gemini/gpt/claude) конвертують
    // їх у свій нативний формат (кнопка-скріпка в чаті, server/chatRoutes.ts).
    const testImage = { mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };

    process.env.OPENAI_API_KEY = 'sk-test';
    await providers.PROVIDERS.gpt('опиши', 'system', 'gpt-4o', undefined, [testImage]);
    const gptBody = JSON.parse(capturedInit?.body || '{}');
    const gptImagePart = gptBody.messages?.[1]?.content?.find((p: any) => p.type === 'image_url');
    t('openAiCompatible (gpt): зображення йде як image_url data-URL',
      gptImagePart?.image_url?.url === `data:image/png;base64,${testImage.dataBase64}`, JSON.stringify(gptImagePart));

    // json-режим (Q18 grilling-сесії — «Ядро AI» просить JSON у БУДЬ-ЯКОГО
    // рушія, обраного в чаті, не лише в Gemini): openAiCompatible отримує
    // response_format, Claude — assistant-prefill. Без цього тесту регресія
    // (JSON-модулі ядра ламаються на моделях без апаратної опори) непомітна
    // на рівні типів — самі функції компілюються однаково з json чи без.
    process.env.OPENAI_API_KEY = 'sk-test';
    await providers.PROVIDERS.gpt('опиши', 'system', 'gpt-4o', undefined, undefined, true);
    const gptJsonBody = JSON.parse(capturedInit?.body || '{}');
    t('openAiCompatible (gpt): json=true додає response_format json_object',
      gptJsonBody.response_format?.type === 'json_object', JSON.stringify(gptJsonBody.response_format));

    await providers.PROVIDERS.gpt('опиши', 'system', 'gpt-4o');
    const gptNoJsonBody = JSON.parse(capturedInit?.body || '{}');
    t('openAiCompatible (gpt): без json — поле response_format відсутнє (не ламає наявну поведінку чату)',
      !('response_format' in gptNoJsonBody), JSON.stringify(gptNoJsonBody));
    delete process.env.OPENAI_API_KEY;

    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const claudeJsonResult = await providers.PROVIDERS.claude('опиши', 'system', 'claude-sonnet-5', undefined, undefined, true);
    const claudeJsonBody = JSON.parse(capturedInit?.body || '{}');
    t('generateClaude: json=true додає assistant-prefill "{"',
      claudeJsonBody.messages?.[1]?.role === 'assistant' && claudeJsonBody.messages[1].content === '{',
      JSON.stringify(claudeJsonBody.messages));
    t('generateClaude: json=true повертає текст із "{" на початку (мок повертає "ok" — має стати "{ok")',
      claudeJsonResult.text === '{ok', claudeJsonResult.text);

    await providers.PROVIDERS.claude('опиши', 'system', 'claude-sonnet-5');
    const claudeNoJsonBody = JSON.parse(capturedInit?.body || '{}');
    t('generateClaude: без json — лише репліка користувача, без prefill (наявна поведінка чату незмінна)',
      claudeNoJsonBody.messages?.length === 1, JSON.stringify(claudeNoJsonBody.messages));
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    process.env.GEMINI_API_KEY = 'test-key';
    await providers.PROVIDERS.gemini('опиши', 'system', 'gemini-3.7-flash', undefined, [testImage]);
    const geminiBody = JSON.parse(capturedInit?.body || '{}');
    const geminiImagePart = geminiBody.contents?.[0]?.parts?.find((p: any) => p.inlineData);
    t('generateGemini: зображення йде як inlineData',
      geminiImagePart?.inlineData?.mimeType === 'image/png' && geminiImagePart?.inlineData?.data === testImage.dataBase64,
      JSON.stringify(geminiImagePart));
    delete process.env.GEMINI_API_KEY;

    process.env.ANTHROPIC_API_KEY = 'test-key';
    await providers.PROVIDERS.claude('опиши', 'system', 'claude-sonnet-5', undefined, [testImage]);
    const claudeImgBody = JSON.parse(capturedInit?.body || '{}');
    const claudeImagePart = claudeImgBody.messages?.[0]?.content?.find((p: any) => p.type === 'image');
    t('generateClaude: зображення йде як base64 image-блок',
      claudeImagePart?.source?.media_type === 'image/png' && claudeImagePart?.source?.data === testImage.dataBase64,
      JSON.stringify(claudeImagePart));
    delete process.env.ANTHROPIC_API_KEY;
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail > 0 ? 1 : 0);
