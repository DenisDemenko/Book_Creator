/**
 * Тести: JSON-режим Gemini бере ключ і модель, які передав виклик (журнал #530).
 * Запуск: npm run test:gemini-json-key
 *
 * Передісторія: 09.11.2026 на production крок «Розкласти на кроки» падав з «Ключ доступу до
 * моделі ШІ недійсний або не налаштований», хоча опис кадрів на тому ж платформному ключі
 * з «Ключів API» працював. generateText у JSON-режимі йшов через єдиний SDK-клієнт зі
 * змінної GEMINI_API_KEY і зашитою моделлю, ігноруючи і apiKeyOverride, і modelId.
 */
const DIR = '/tmp/nova-gemini-json-key-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.GEMINI_API_KEY = 'env-key-not-real';

import fs from 'node:fs';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const core = await import('../server/aiCore');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

interface Seen { url: string; key: string | null }
const seen: Seen[] = [];
const realFetch = globalThis.fetch;

/** `answers` — що віддати на 1-й, 2-й… запит: 'ok', 'keyRejected', '503'. */
function stub(answers: Array<'ok' | 'keyRejected' | '503'>) {
  seen.length = 0;
  let i = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    const h = new Headers(init?.headers);
    seen.push({ url: String(url), key: h.get('x-goog-api-key') });
    const kind = answers[Math.min(i++, answers.length - 1)];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (kind === 'keyRejected') {
      return json(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } });
    }
    if (kind === '503') return json(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } });
    return json(200, {
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 50 },
    });
  }) as typeof fetch;
}

const base = { engine: 'gemini' as const, prompt: 'p', systemInstruction: 's', json: true, req: {}, label: 'тест' };

console.log('\nКлюч і модель виклику доходять до SDK');
{
  stub(['ok']);
  const out = await core.generateText({ ...base, modelId: 'gemini-test-model', apiKeyOverride: 'platform-key-111' });
  t('запит пішов один раз', seen.length === 1, String(seen.length));
  t('ключ — переданий, а не з середовища', seen[0]?.key === 'platform-key-111', String(seen[0]?.key));
  t('модель — передана', /models\/gemini-test-model:generateContent/.test(seen[0]?.url || ''), seen[0]?.url);
  t('відповідь і токени повернулись', out.text === '{"ok":true}' && out.inputTokens === 7 && out.outputTokens === 3);
}
{
  stub(['ok']);
  await core.generateText({ ...base });
  t('без ключа й моделі — як раніше: ключ із середовища', seen[0]?.key === 'env-key-not-real', String(seen[0]?.key));
  t('без моделі — GEMINI_MODEL', new RegExp(`models/${core.GEMINI_MODEL}:generateContent`).test(seen[0]?.url || ''), seen[0]?.url);
}
{
  stub(['ok']);
  await core.generateText({ ...base, apiKeyOverride: 'env-key-not-real' });
  t('ключ збігся з серверним — той самий клієнт', seen.length === 1 && seen[0]?.key === 'env-key-not-real');
}

console.log('Токени міркування');
{
  stub(['ok']);
  const plain = await core.generateText({ ...base });
  t('за замовчуванням вихід без токенів міркування — облік інших викликів не змінено', plain.outputTokens === 3, String(plain.outputTokens));
  stub(['ok']);
  const billed = await core.generateText({ ...base, countThinkingTokens: true });
  t('countThinkingTokens — вихід разом із міркуванням (тарифікується як вихід)', billed.outputTokens === 53, String(billed.outputTokens));
}

console.log('\nКлюч із запиту відхилено');
{
  stub(['keyRejected', 'ok']);
  const out = await core.generateText({ ...base, apiKeyOverride: 'platform-key-bad', generation: { transientRetries: 0 } });
  t('другий запит — із серверним ключем', seen.length === 2 && seen[1]?.key === 'env-key-not-real', JSON.stringify(seen.map((s) => s.key)));
  t('результат отримано', out.text === '{"ok":true}');
}
{
  stub(['keyRejected', 'keyRejected']);
  let err: any;
  await core.generateText({ ...base, apiKeyOverride: 'platform-key-bad', generation: { transientRetries: 0 } }).catch((e) => (err = e));
  t('обидва ключі відхилено — помилка про ключ', err?.status === 401 && /Ключ доступу/.test(err?.message || ''), String(err?.message));
  t('рівно два запити, без третього', seen.length === 2, String(seen.length));
}
{
  stub(['keyRejected']);
  let err: any;
  await core.generateText({ ...base, apiKeyOverride: 'env-key-not-real', generation: { transientRetries: 0 } }).catch((e) => (err = e));
  t('ключ = серверний і відхилений — без повтору тим самим ключем', seen.length === 1 && err?.status === 401, String(seen.length));
}
{
  stub(['503']);
  let err: any;
  await core.generateText({ ...base, apiKeyOverride: 'platform-key-111', generation: { transientRetries: 0 } }).catch((e) => (err = e));
  t('перевантаження моделі — не привід міняти ключ', seen.length === 1 && seen[0]?.key === 'platform-key-111', String(seen.length));
}

globalThis.fetch = realFetch;
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
