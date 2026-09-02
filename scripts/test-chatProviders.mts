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
interface Call { messages: any[]; }
function stub(handler: (call: Call, n: number) => { status: number; body: any }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ messages: body.messages });
    const res = handler({ messages: body.messages }, calls.length);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body };
  }) as never;
  return calls;
}
const okBody = (text: string) => ({ content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 2 } });
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

globalThis.fetch = realFetch;
console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
