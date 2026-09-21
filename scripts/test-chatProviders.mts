/**
 * Тести рушіїв AI на рівні HTTP-контракту. Запуск: npm run test:chat-providers
 *
 * Мережі тут нема: підмінюється globalThis.fetch, тож перевіряється саме те,
 * ЩО ми надсилаємо провайдеру і як тлумачимо його відповідь.
 *
 * Причина існування файлу — вада, знайдена живим прогоном 02.09.2026
 * (log.md #68): режим JSON у Claude реалізований підкладанням репліки
 * асистента («assistant prefill»), а `claude-sonnet-5` таких запитів не
 * приймає взагалі й відповідає 400. Гілка роками не виконувалась, бо всі
 * наявні модулі з json:true ходили через Gemini.
 */
process.env.ANTHROPIC_API_KEY = 'test-key';

const providers = await import('../server/chatProviders');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const realFetch = globalThis.fetch;
interface Call { messages: any[]; model?: string; url?: string; body?: any; }
function stub(handler: (call: Call, n: number) => { status: number; body: any }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ messages: body.messages, model: body.model, url: String(url), body });
    const res = handler({ messages: body.messages, model: body.model, url: String(url), body }, calls.length);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body };
  }) as never;
  return calls;
}
const okBody = (text: string) => ({ content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 2 } });
/** Відповідь OpenAI-сумісних рушіїв (OpenAI, DeepSeek, Groq, Mistral) — форма інша, ніж у Claude. */
const okOpenAiBody = (text: string) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 2 } });
const tinyPng = [
  { mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
];
const prefillError = {
  error: {
    type: 'invalid_request_error',
    message: 'This model does not support assistant message prefill. The conversation must end with a user message.',
  },
};

console.log('Claude, режим JSON:');
{
  const calls = stub(() => ({ status: 200, body: okBody('"a":1}') }));
  const out = await providers.PROVIDERS.claude('питання', 'система', 'claude-haiku-4-5-20251001', undefined, undefined, true);
  t('модель, що підтримує prefill: репліку асистента надіслано',
    calls[0].messages.length === 2 && calls[0].messages[1].role === 'assistant');
  t('дужку «{» дописано назад', out.text === '{"a":1}', out.text);
  t('запит рівно один', calls.length === 1, String(calls.length));
}

console.log('\nМодель без підтримки prefill:');
{
  const calls = stub((_c, n) =>
    n === 1 ? { status: 400, body: prefillError } : { status: 200, body: okBody('{"listings":[]}') });
  const out = await providers.PROVIDERS.claude('питання', 'система', 'claude-sonnet-5', undefined, undefined, true);
  t('після відмови зроблено другий запит', calls.length === 2, String(calls.length));
  t('у повторі репліки асистента немає',
    calls[1].messages.length === 1 && calls[1].messages[0].role === 'user');
  t('зайву дужку НЕ дописано — відповідь лишилась валідною',
    out.text === '{"listings":[]}', out.text);
  t('розбір проходить', JSON.parse(out.text).listings.length === 0);
}

console.log('\nІнші помилки не маскуються відкатом:');
{
  const calls = stub(() => ({ status: 400, body: { error: { type: 'invalid_request_error', message: 'max_tokens is too large' } } }));
  let caught: any = null;
  try {
    await providers.PROVIDERS.claude('питання', 'система', 'claude-sonnet-5', undefined, undefined, true);
  } catch (e) { caught = e; }
  t('помилку кинуто', caught !== null);
  t('повтору не було', calls.length === 1, String(calls.length));
  t('текст помилки збережено', String(caught?.message || '').includes('max_tokens'), String(caught?.message));
}

console.log('\nБез режиму JSON prefill не застосовується:');
{
  const calls = stub(() => ({ status: 200, body: okBody('звичайна відповідь') }));
  const out = await providers.PROVIDERS.claude('питання', 'система', 'claude-sonnet-5', undefined, undefined, false);
  t('надіслано лише репліку користувача', calls[0].messages.length === 1);
  t('текст не змінено', out.text === 'звичайна відповідь', out.text);
}

console.log('\nЗір — властивість МОДЕЛІ, а не рушія (задача #223):');
{
  const models = providers.CHAT_MODELS;
  const engines = ['gemini', 'gpt', 'claude', 'deepseek', 'groq', 'mistral'];

  t('у кожній моделі реєстру є булевий прапорець vision',
    models.every((m) => typeof m.vision === 'boolean'));
  t('у КОЖНОГО рушія списку є хоч одна модель із зором — саме це й обіцяє опис',
    engines.every((e) => models.some((m) => m.engine === e && m.vision)),
    engines.filter((e) => !models.some((m) => m.engine === e && m.vision)).join(', ') || 'усі шість');
  t('у DeepSeek і Groq поряд стоять і зряча, і текстова модель — це причина правки',
    models.some((m) => m.engine === 'deepseek' && m.vision) && models.some((m) => m.engine === 'deepseek' && !m.vision) &&
    models.some((m) => m.engine === 'groq' && m.vision) && models.some((m) => m.engine === 'groq' && !m.vision));

  const sees = (id: string) => providers.modelSupportsVision(id);
  t('Gemini бачить', sees('gemini-3.7-flash'));
  t('GPT бачить', sees('gpt-5.5'));
  t('Claude бачить', sees('claude-sonnet-5'));
  t('DeepSeek flash бачить (Vision ✓ за таблицею провайдера)', sees('deepseek-flash'));
  t('DeepSeek V4 Pro НЕ бачить (Vision ✗ за тією ж таблицею)', !sees('deepseek-v4-pro'));
  t('Llama 4 Scout бачить (multimodal, до 5 зображень)', sees('meta-llama/llama-4-scout-17b-16e-instruct'));
  t('Llama 3.3 70B НЕ бачить (текстова)', !sees('llama-3.3-70b-versatile'));
  t('Mistral Large бачить (text+image+file)', sees('mistral-large-latest'));

  // Старе ім'я моделі: книги, збережені до цієї правки, тримають `deepseek-chat`.
  t('старий id deepseek-chat перекладається на живе ім’я flash',
    providers.normalizeModelId('deepseek-chat') === 'deepseek-flash', providers.normalizeModelId('deepseek-chat'));
  t('старий id не вважається невідомим', providers.isKnownModel('deepseek-chat'));
  t('людська назва старого id — як у живої моделі',
    providers.chatModelLabel('deepseek-chat') === 'DeepSeek V4.1 Flash', providers.chatModelLabel('deepseek-chat'));
  t('старий id бачить зображення (бо flash бачить)', sees('deepseek-chat'));

  // Нова модель того ж провайдера, якої ще немає в реєстрі.
  t('невідома нова модель мультимодального провайдера — вважаємо зрячою', sees('gpt-9-unknown'));
  t('невідома нова модель DeepSeek — НЕ вважаємо зрячою (там обидва види поряд)', !sees('deepseek-unknown-9'));
  t('невідома нова модель Groq — теж ні', !sees('llama-9-unknown'));

  const hint = providers.visionEngineHint();
  t('підказка в помилці перелічує всі шість рушіїв', engines.every((e) => hint.includes(providers.ENGINE_LABELS[e as keyof typeof providers.ENGINE_LABELS])), hint);
}

console.log('\nЗображення доїжджає до провайдера у ЙОГО форматі (задача #223):');
{
  // OpenAI-сумісні рушії: той самий `image_url`, лише з base64 усередині.
  for (const engine of ['gpt', 'deepseek', 'groq', 'mistral'] as const) {
    const modelId = engine === 'deepseek' ? 'deepseek-flash'
      : engine === 'groq' ? 'meta-llama/llama-4-scout-17b-16e-instruct'
      : engine === 'mistral' ? 'mistral-large-latest' : 'gpt-4o';
    const calls = stub(() => ({ status: 200, body: okOpenAiBody('опис') }));
    await providers.PROVIDERS[engine]('опиши фото', 'система', modelId, 'test-key', tinyPng);
    const content = calls[0]?.body?.messages?.[1]?.content;
    t(`${engine}: вміст репліки — масив із текстом і зображенням`,
      Array.isArray(content) && content[0]?.type === 'text' && content[1]?.type === 'image_url');
    t(`${engine}: зображення передано як data-URL з base64`,
      String(content?.[1]?.image_url?.url || '').startsWith('data:image/png;base64,'));
    t(`${engine}: у запит пішла САМЕ обрана модель`, calls[0]?.model === modelId, String(calls[0]?.model));
  }

  // Перекладання старого id робиться перед самим запитом, не лише в UI.
  const legacyCalls = stub(() => ({ status: 200, body: okOpenAiBody('опис') }));
  await providers.PROVIDERS.deepseek('опиши фото', 'система', 'deepseek-chat', 'test-key', tinyPng);
  t('deepseek-chat у запиті перетворюється на deepseek-flash',
    legacyCalls[0]?.model === 'deepseek-flash', String(legacyCalls[0]?.model));

  // Gemini — нативний inlineData у URL моделі.
  process.env.GEMINI_API_KEY = 'test-key';
  const geminiCalls = stub(() => ({
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: 'опис' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } },
  }));
  await providers.PROVIDERS.gemini('опиши фото', 'система', 'gemini-3.7-flash', undefined, tinyPng);
  t('gemini: модель зашита в URL generateContent', String(geminiCalls[0]?.url || '').includes('gemini-3.7-flash:generateContent'));
  t('gemini: зображення пішло як inlineData',
    geminiCalls[0]?.body?.contents?.[0]?.parts?.[0]?.inlineData?.mimeType === 'image/png');

  // Claude — блоки `image` з base64-джерелом.
  const claudeCalls = stub(() => ({
    status: 200,
    body: { content: [{ type: 'text', text: 'опис' }], usage: { input_tokens: 1, output_tokens: 2 } },
  }));
  await providers.PROVIDERS.claude('опиши фото', 'система', 'claude-sonnet-5', 'test-key', tinyPng);
  const claudeContent = claudeCalls[0]?.body?.messages?.[0]?.content;
  t('claude: зображення окремим блоком перед текстом',
    Array.isArray(claudeContent) && claudeContent[0]?.type === 'image' && claudeContent[1]?.type === 'text');
  t('claude: base64-джерело з правильним media_type',
    claudeContent?.[0]?.source?.type === 'base64' && claudeContent?.[0]?.source?.media_type === 'image/png');
  t('claude: у запит пішла САМЕ обрана модель', claudeCalls[0]?.model === 'claude-sonnet-5');
}

globalThis.fetch = realFetch;
console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
