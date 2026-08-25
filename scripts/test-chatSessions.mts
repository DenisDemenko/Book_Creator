/**
 * Тести чат-сесій AI-асистента. Запуск: npm run test:chat
 *
 * Покриття, як вимагає ТЗ (мінімум позитивний і негативний сценарій на
 * кожен API): чисті функції контексту/валідації, шар сховища, і реальні
 * HTTP-роути на піднятому Express із підставним генератором — тож тести
 * не потребують ані мережі, ані AI-ключа.
 */
const DIR = '/tmp/nova-chat-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/store');
const chat = await import('../server/chatRoutes');
const providers = await import('../server/chatProviders');
const pricing = await import('../server/pricing');
const subs = await import('../server/subscriptions');
const admin = await import('../server/adminRoutes');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

await db.initDb();
const info = await store.initStore();

console.log('Середовище:');
t('бекенд = sqlite', info.backend === 'sqlite', info.backend);

// ---------------------------------------------------------------------------
console.log('\nЧисті функції — заголовок сесії:');
{
  t('короткий текст стає заголовком як є',
    chat.deriveTitle('Порадь поворот сюжету') === 'Порадь поворот сюжету');
  const long = 'а'.repeat(200);
  const title = chat.deriveTitle(long);
  t('довгий текст обрізається з трикрапкою', title.length <= 60 && title.endsWith('…'), `${title.length} символів`);
  t('порожній рядок дає запасну назву', chat.deriveTitle('   ') === 'Нова розмова');
  t('переноси рядків згортаються в пробіли',
    chat.deriveTitle('перший\n\nдругий') === 'перший другий');
}

// ---------------------------------------------------------------------------
console.log('\nЧисті функції — контекст для моделі:');
{
  const empty = chat.buildPromptContext([], 'Привіт');
  t('порожня історія: лише нова репліка', empty === 'Автор: Привіт', empty);

  const withHistory = chat.buildPromptContext(
    [{ role: 'user', content: 'Хто така Олена?' }, { role: 'assistant', content: 'Інженерка.' }],
    'А що з нею далі?'
  );
  t('історія потрапляє в промпт', withHistory.includes('Хто така Олена?') && withHistory.includes('Інженерка.'));
  t('ролі підписані українською', withHistory.includes('Автор:') && withHistory.includes('Асистент:'));
  t('нова репліка в кінці', withHistory.trimEnd().endsWith('А що з нею далі?'));

  // Негативний/граничний сценарій: довга історія має обрізатись вікном.
  const huge = Array.from({ length: 100 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `репліка-${i}`,
  }));
  const windowed = chat.buildPromptContext(huge, 'нове');
  t('вікно обрізає давню історію', !windowed.includes('репліка-0'));
  t('вікно зберігає найсвіжіші репліки', windowed.includes('репліка-99'));
  const kept = (windowed.match(/репліка-/g) || []).length;
  t(`у вікні рівно ${chat.CONTEXT_WINDOW_MESSAGES} реплік`, kept === chat.CONTEXT_WINDOW_MESSAGES, String(kept));
}

// ---------------------------------------------------------------------------
console.log('\nЧисті функції — валідація та системний промпт:');
{
  t('порожнє повідомлення відхиляється', chat.validateMessage('   ') !== null);
  t('не-рядок відхиляється', chat.validateMessage(42) !== null);
  t('задовге повідомлення відхиляється', chat.validateMessage('x'.repeat(chat.MAX_MESSAGE_CHARS + 1)) !== null);
  t('нормальне повідомлення приймається', chat.validateMessage('Порадь щось') === null);

  const bare = chat.buildSystemPrompt(null);
  t('без стилю: базова інструкція є', bare.includes('помічник письменника'));
  t('без стилю: файлу стилю немає', !bare.includes('файл стилю'));

  const styled = chat.buildSystemPrompt('## Ритм\nКороткі речення.', { title: 'Тіні', genre: 'кіберпанк' });
  t('зі стилем: стиль підставлено', styled.includes('Короткі речення.'));
  t('зі стилем: контекст книги підставлено', styled.includes('Тіні') && styled.includes('кіберпанк'));

  // Нагадування про поточну модель — запобігає ситуації, коли автор перемкнув
  // модель посеред розмови, а нова модель за інерцією з контексту видає себе
  // за попередню (реальний баг: DeepSeek відповів текстом «я Claude», хоча
  // виклик і ціна коректно пішли до DeepSeek — server/chatRoutes.ts, п. buildSystemPrompt).
  const withoutLabel = chat.buildSystemPrompt(null);
  t('без modelLabel: нагадування про ідентичність відсутнє', !withoutLabel.includes('викликано як модель'));

  const withLabel = chat.buildSystemPrompt(null, undefined, 'DeepSeek V4');
  t('з modelLabel: нагадування містить назву моделі', withLabel.includes('DeepSeek V4'));
  t('з modelLabel: явно каже ігнорувати чуже самоназивання з історії',
    withLabel.includes('не твоя ідентичність') || withLabel.includes('не повторюй чужого самоназивання'));
}

// ---------------------------------------------------------------------------
console.log('\nШар сховища:');
{
  const now = new Date().toISOString();
  const session = {
    id: 'chat-1', userId: 'u-1', title: 'Перша', modelId: 'test-model',
    totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, messageCount: 0,
    createdAt: now, updatedAt: now,
  };
  await store.createChatSession(session);
  t('сесія створена', (await store.getChatSession('chat-1'))?.title === 'Перша');
  t('неіснуюча сесія повертає undefined', (await store.getChatSession('chat-missing')) === undefined);

  await store.createChatSession({ ...session, id: 'chat-2', title: 'Друга', userId: 'u-1', updatedAt: new Date(Date.now() + 1000).toISOString() });
  await store.createChatSession({ ...session, id: 'chat-3', title: 'Чужа', userId: 'u-2' });

  const mine = await store.listChatSessions('u-1');
  t('список повертає лише свої сесії', mine.length === 2, String(mine.length));
  t('список відсортований за свіжістю', mine[0].id === 'chat-2', mine[0].id);
  t('чужа сесія не потрапила у список', !mine.some((s) => s.userId !== 'u-1'));

  await store.addChatMessage({ id: 'm1', sessionId: 'chat-1', role: 'user', content: 'привіт', inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: new Date(Date.now() + 1).toISOString() });
  await store.addChatMessage({ id: 'm2', sessionId: 'chat-1', role: 'assistant', content: 'вітаю', inputTokens: 10, outputTokens: 20, costUsd: 0.0001, createdAt: new Date(Date.now() + 2).toISOString() });
  const msgs = await store.listChatMessages('chat-1');
  t('репліки збережені й у правильному порядку', msgs.length === 2 && msgs[0].role === 'user' && msgs[1].role === 'assistant');
  t('репліки чужої сесії не підмішались', (await store.listChatMessages('chat-3')).length === 0);
  t('вартість збережена на рівні репліки', msgs[1].costUsd === 0.0001);

  const updated = { ...session, title: 'Перша', totalInputTokens: 10, totalOutputTokens: 20, totalCostUsd: 0.0001, messageCount: 2, updatedAt: new Date().toISOString() };
  await store.updateChatSession(updated);
  const reread = await store.getChatSession('chat-1');
  t('лічильники сесії оновилися', reread?.messageCount === 2 && reread?.totalCostUsd === 0.0001);
  t('накопичена вартість = SUM по репліках',
    Math.abs((reread?.totalCostUsd || 0) - msgs.reduce((s, m) => s + m.costUsd, 0)) < 1e-9);

  t('видалення сесії повертає true', (await store.deleteChatSession('chat-1')) === true);
  t('після видалення сесії немає', (await store.getChatSession('chat-1')) === undefined);
  t('репліки видалені каскадом', (await store.listChatMessages('chat-1')).length === 0);
  t('повторне видалення повертає false', (await store.deleteChatSession('chat-1')) === false);
}

// ---------------------------------------------------------------------------
console.log('\nHTTP-роути (підставний генератор, без мережі й ключа):');
{
  let currentPrincipal: any = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'writer', isGuest: false };
  let shouldFailAi = false;
  let lastSystemPrompt = '';
  let lastPrompt = '';
  let lastModelId = '';
  const usageCalls: { success: boolean; input: number; output: number; model?: string }[] = [];

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.principal = currentPrincipal; next(); });

  let lastImages: any[] | undefined;
  chat.registerChatRoutes(app, {
    generate: async (prompt: string, systemInstruction: string, modelId?: string, _userId?: string, images?: any[]) => {
      lastSystemPrompt = systemInstruction;
      lastPrompt = prompt;
      lastModelId = modelId || '';
      lastImages = images;
      if (shouldFailAi) throw new Error('провайдер недоступний');
      return { text: 'Відповідь асистента.', inputTokens: 100, outputTokens: 50 };
    },
    defaultModelId: 'gemini-3.7-flash',
    checkChatQuota: async () => ({ allowed: true, remaining: 10 }),
    onUsage: async (_req, _label, model, input, output, success) => { usageCalls.push({ success, input, output, model }); },
    loadStyleGuide: async () => '## Ритм\nКороткі речення.',
  });

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, path: string, body?: any) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  // POST /api/chat/sessions
  const created = await call('POST', '/api/chat/sessions', { title: '' });
  t('POST /sessions → 201', created.status === 201, String(created.status));
  const sessionId = created.data?.session?.id;
  t('POST /sessions повертає id', !!sessionId);
  t('нова сесія має нульові лічильники', created.data?.session?.messageCount === 0 && created.data?.session?.totalCostUsd === 0);
  t('нова сесія отримала модель за замовчуванням', created.data?.session?.modelId === 'gemini-3.7-flash');

  // POST /sessions — вибір моделі (мультимодельність)
  const deep = await call('POST', '/api/chat/sessions', { title: '', modelId: 'deepseek-chat' });
  t('POST /sessions з бажаною моделлю → 201', deep.status === 201, String(deep.status));
  t('обрана модель збережена в сесії', deep.data?.session?.modelId === 'deepseek-chat');
  const fallback = await call('POST', '/api/chat/sessions', { title: '', modelId: 'no-such-model' });
  t('невідома модель → модель за замовчуванням', fallback.data?.session?.modelId === 'gemini-3.7-flash');

  // GET /api/chat/models — список доступних моделей
  const models = await call('GET', '/api/chat/models');
  t('GET /models → 200 зі списком', models.status === 200 && Array.isArray(models.data?.models), String(models.status));
  t('список містить 8 моделей (6 провайдерів, 3 моделі Claude)', models.data?.models?.length === 8, String(models.data?.models?.length));
  t('defaultModelId повертається клієнту', models.data?.defaultModelId === 'gemini-3.7-flash');
  const geminiModel = models.data?.models?.find((m: any) => m.engine === 'gemini');
  t('модель містить ціну за мільйон токенів (для селектора)',
    typeof geminiModel?.inputPerMillionUsd === 'number' && typeof geminiModel?.outputPerMillionUsd === 'number',
    JSON.stringify(geminiModel));

  // GET /api/chat/sessions
  const listed = await call('GET', '/api/chat/sessions');
  t('GET /sessions → 200 зі списком', listed.status === 200 && Array.isArray(listed.data?.sessions));
  t('створена сесія є у списку', listed.data.sessions.some((s: any) => s.id === sessionId));

  // POST message — позитивний сценарій
  const sent = await call('POST', `/api/chat/sessions/${sessionId}/messages`, { content: 'Порадь, з чого почати другий розділ.' });
  t('POST /messages → 200', sent.status === 200, String(sent.status));
  t('повернуто відповідь асистента', sent.data?.assistantMessage?.content === 'Відповідь асистента.');
  t('токени записані в репліку', sent.data?.assistantMessage?.inputTokens === 100 && sent.data?.assistantMessage?.outputTokens === 50);
  t('вартість порахована (>0)', (sent.data?.assistantMessage?.costUsd || 0) > 0, String(sent.data?.assistantMessage?.costUsd));
  t('лічильники сесії накопичились', sent.data?.session?.messageCount === 2 && sent.data?.session?.totalInputTokens === 100);
  t('заголовок узято з першої репліки', sent.data?.session?.title?.startsWith('Порадь, з чого почати'), sent.data?.session?.title);
  t('файл стилю потрапив у системний промпт', lastSystemPrompt.includes('Короткі речення.'));
  t('витрата пішла в загальний журнал', usageCalls.length === 1 && usageCalls[0].success === true);

  // Контекст попередньої історії — друга репліка має бачити першу
  const second = await call('POST', `/api/chat/sessions/${sessionId}/messages`, { content: 'А коротше?' });
  t('друга репліка → 200', second.status === 200);
  t('лічильники накопичуються далі', second.data?.session?.messageCount === 4 && second.data?.session?.totalInputTokens === 200);
  t('заголовок НЕ перезаписався другою реплікою', second.data?.session?.title?.startsWith('Порадь, з чого почати'));

  // GET history
  const history = await call('GET', `/api/chat/sessions/${sessionId}`);
  t('GET /sessions/:id → 200', history.status === 200);
  t('історія містить усі 4 репліки', history.data?.messages?.length === 4, String(history.data?.messages?.length));
  t('накопичена вартість = SUM по репліках',
    Math.abs(history.data.session.totalCostUsd - history.data.messages.reduce((s: number, m: any) => s + m.costUsd, 0)) < 1e-9);

  // Зміна моделі на льоту — POST /messages приймає modelId
  const switched = await call('POST', `/api/chat/sessions/${sessionId}/messages`, { content: 'Зміни модель.', modelId: 'gpt-4o' });
  t('зміна моделі на льоту → 200', switched.status === 200, String(switched.status));
  t('генератор отримав нову модель', lastModelId === 'gpt-4o', lastModelId);
  t('системний промпт нагадує моделі її ідентичність (GPT-4o) — запобігає видаванню себе за попередню модель',
    lastSystemPrompt.includes('GPT-4o'), lastSystemPrompt.slice(0, 200));
  t('сесія зберегла нову модель', switched.data?.session?.modelId === 'gpt-4o');
  t('витрата в журналі позначена новою моделлю', usageCalls.some((c) => c.model === 'gpt-4o' && c.success));

  // Клієнтський потік розмови (як у Modul_token) — сервер використовує його
  const threadSent = await call('POST', `/api/chat/sessions/${sessionId}/messages`, {
    content: 'Остання репліка.',
    messages: [
      { role: 'user', content: 'Лише цей клієнтський контекст' },
      { role: 'assistant', content: 'Бачу контекст' },
    ],
  });
  t('потік розмови від клієнта → 200', threadSent.status === 200, String(threadSent.status));
  t('модель отримала клієнтський контекст у промпті', lastPrompt.includes('Лише цей клієнтський контекст'));
  t('відповідь містить поле model', typeof threadSent.data?.assistantMessage?.model === 'string', String(threadSent.data?.assistantMessage?.model));

  // --- Негативні сценарії ---
  const badInput = await call('POST', `/api/chat/sessions/${sessionId}/messages`, { content: '   ' });
  t('порожнє повідомлення → 400', badInput.status === 400, String(badInput.status));

  const tooLong = await call('POST', `/api/chat/sessions/${sessionId}/messages`, { content: 'x'.repeat(chat.MAX_MESSAGE_CHARS + 1) });
  t('задовге повідомлення → 400', tooLong.status === 400, String(tooLong.status));

  const missing = await call('GET', '/api/chat/sessions/chat-does-not-exist');
  t('неіснуюча сесія → 404', missing.status === 404, String(missing.status));

  const missingPost = await call('POST', '/api/chat/sessions/chat-does-not-exist/messages', { content: 'привіт' });
  t('повідомлення в неіснуючу сесію → 404', missingPost.status === 404, String(missingPost.status));

  // Чужа сесія — маскується під 404, щоб не підтверджувати існування id
  currentPrincipal = { id: 'u-other', email: 'other@test.ua', name: 'Інший', role: 'writer', isGuest: false };
  const foreign = await call('GET', `/api/chat/sessions/${sessionId}`);
  t('чужа сесія → 404 (не 403, щоб не розкривати існування)', foreign.status === 404, String(foreign.status));
  const foreignDelete = await call('DELETE', `/api/chat/sessions/${sessionId}`);
  t('видалити чужу сесію не можна', foreignDelete.status === 404, String(foreignDelete.status));
  currentPrincipal = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'writer', isGuest: false };

  // Гість — 401
  currentPrincipal = { id: null, email: null, name: 'Гість', role: 'guest', isGuest: true };
  const guest = await call('GET', '/api/chat/sessions');
  t('гість → 401', guest.status === 401, String(guest.status));
  currentPrincipal = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'writer', isGuest: false };

  // Збій провайдера → 502, але репліка автора збережена
  shouldFailAi = true;
  const beforeFail = await call('GET', `/api/chat/sessions/${sessionId}`);
  const aiFail = await call('POST', `/api/chat/sessions/${sessionId}/messages`, { content: 'Це впаде.' });
  t('збій провайдера → 502', aiFail.status === 502, String(aiFail.status));
  t('502 не тече сирою помилкою назовні', !JSON.stringify(aiFail.data).includes('провайдер недоступний'));
  const afterFail = await call('GET', `/api/chat/sessions/${sessionId}`);
  t('репліка автора збережена попри збій', afterFail.data.messages.length === beforeFail.data.messages.length + 1);
  t('вартість не зросла після невдачі', afterFail.data.session.totalCostUsd === beforeFail.data.session.totalCostUsd);
  t('невдача теж пішла в журнал витрат', usageCalls.some((c) => c.success === false && c.input === 0));
  shouldFailAi = false;

  // Немає AI-ключа → підписана демо-відповідь із нульовою вартістю
  // (стан конфігурації, а не помилка — на відміну від 502 вище).
  const appNoAi = express();
  appNoAi.use(express.json());
  appNoAi.use((req: any, _res, next) => { req.principal = { id: 'u-http', role: 'writer', isGuest: false }; next(); });
  chat.registerChatRoutes(appNoAi, { generate: null, defaultModelId: 'gemini-3.7-flash' });
  const serverNoAi = appNoAi.listen(0);
  await new Promise((r) => serverNoAi.once('listening', r));
  const portNoAi = (serverNoAi.address() as any).port;
  const noAiRes = await fetch(`http://127.0.0.1:${portNoAi}/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'привіт' }),
  });
  const noAiData: any = await noAiRes.json();
  t('без AI-ключа → 200 з демо-відповіддю', noAiRes.status === 200, String(noAiRes.status));
  t('демо-відповідь явно підписана як демо', /Демо-відповідь без AI-ключа/.test(noAiData?.assistantMessage?.content || ''));
  t('демо-відповідь не додає вигаданої вартості', noAiData?.assistantMessage?.costUsd === 0);
  t('демо-відповідь не додає вигаданих токенів', noAiData?.assistantMessage?.inputTokens === 0);
  serverNoAi.close();

  // GET /api/chat/models: модель має бути доступною (не задизейбленою), якщо
  // автор задав ВЛАСНИЙ ключ (розділ «Ключі API»), навіть без серверного env-ключа.
  const appOwnKey = express();
  appOwnKey.use(express.json());
  appOwnKey.use((req: any, _res, next) => { req.principal = { id: 'u-http', role: 'writer', isGuest: false }; next(); });
  chat.registerChatRoutes(appOwnKey, {
    generate: null,
    defaultModelId: 'gemini-3.7-flash',
    listUserConfiguredEngines: async (userId) => (userId === 'u-http' ? ['claude'] : []),
  });
  const serverOwnKey = appOwnKey.listen(0);
  await new Promise((r) => serverOwnKey.once('listening', r));
  const portOwnKey = (serverOwnKey.address() as any).port;
  const ownKeyModels = await (await fetch(`http://127.0.0.1:${portOwnKey}/api/chat/models`)).json();
  const claudeOpt = ownKeyModels.models.find((m: any) => m.engine === 'claude');
  const gptOpt = ownKeyModels.models.find((m: any) => m.engine === 'gpt');
  t('модель з власним ключем користувача → available: true (без серверного ключа)', claudeOpt?.available === true, JSON.stringify(claudeOpt));
  t('модель без жодного ключа (ні серверного, ні власного) → available: false', gptOpt?.available === false, JSON.stringify(gptOpt));
  serverOwnKey.close();

  // $-квота чату: при вичерпанні POST /messages → 403
  const appQuota = express();
  appQuota.use(express.json());
  appQuota.use((req: any, _res, next) => { req.principal = { id: 'u-quota', role: 'writer', isGuest: false }; next(); });
  chat.registerChatRoutes(appQuota, {
    generate: async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1 }),
    defaultModelId: 'gemini-3.7-flash',
    checkChatQuota: async () => ({ allowed: false, reasonUk: 'Вичерпано місячний ліміт чат-витрат плану Pro ($5).', quota: 5, remaining: 0 }),
  });
  const serverQuota = appQuota.listen(0);
  await new Promise((r) => serverQuota.once('listening', r));
  const portQuota = (serverQuota.address() as any).port;
  const qbase = `http://127.0.0.1:${portQuota}`;
  const qsess = await (await fetch(`${qbase}/api/chat/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const qmsg = await fetch(`${qbase}/api/chat/sessions/${qsess.session.id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'привіт' }),
  });
  const qdata: any = await qmsg.json();
  t('при вичерпанні $-квоти → 403', qmsg.status === 403, String(qmsg.status));
  t('403 містить kind chat_quota_exceeded', qdata?.kind === 'chat_quota_exceeded');
  serverQuota.close();

  // --- Вкладення: зображення (кнопка-скріпка в чаті) ---
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  // Позитивний: gpt-4o (vision-рушій) отримує зображення
  const withImage = await call('POST', `/api/chat/sessions/${sessionId}/messages`, {
    content: 'Що на цій картинці?',
    modelId: 'gpt-4o',
    attachments: { images: [{ name: 'photo.png', mimeType: 'image/png', dataBase64: tinyPngBase64 }] },
  });
  t('повідомлення із зображенням до vision-моделі → 200', withImage.status === 200, String(withImage.status));
  t('генератор отримав зображення', lastImages?.length === 1 && lastImages[0].mimeType === 'image/png');
  t('репліка автора в історії позначена прикріпленим зображенням', withImage.data?.userMessage?.content?.includes('photo.png'));

  // Негативний: DeepSeek (текстова модель) отримує зображення → 400, запит навіть не пішов до генератора
  lastImages = undefined;
  const withImageOnTextModel = await call('POST', `/api/chat/sessions/${sessionId}/messages`, {
    content: 'Що на цій картинці?',
    modelId: 'deepseek-chat',
    attachments: { images: [{ name: 'photo.png', mimeType: 'image/png', dataBase64: tinyPngBase64 }] },
  });
  t('зображення на текстову модель (DeepSeek) → 400', withImageOnTextModel.status === 400, String(withImageOnTextModel.status));
  t('400 містить kind vision_unsupported', withImageOnTextModel.data?.kind === 'vision_unsupported');
  t('генератор НЕ викликався для відхиленого запиту', lastImages === undefined);

  // Ліміт кількості зображень — понад MAX_ATTACHED_IMAGES обрізається
  const manyImages = Array.from({ length: chat.MAX_ATTACHED_IMAGES + 3 }, (_, i) => ({
    name: `img-${i}.png`, mimeType: 'image/png', dataBase64: tinyPngBase64,
  }));
  await call('POST', `/api/chat/sessions/${sessionId}/messages`, {
    content: 'Кілька картинок.', modelId: 'gpt-4o', attachments: { images: manyImages },
  });
  t('кількість зображень обрізається до MAX_ATTACHED_IMAGES', lastImages?.length === chat.MAX_ATTACHED_IMAGES, String(lastImages?.length));

  // --- Вкладення: текстовий файл (txt/md/pdf — вміст витягнутий на клієнті) ---
  const withTextFile = await call('POST', `/api/chat/sessions/${sessionId}/messages`, {
    content: 'Прочитай нотатку.',
    modelId: 'gpt-4o',
    attachments: { textFiles: [{ name: 'plan.md', content: '## План\nРозділ 1: зрада.' }] },
  });
  t('повідомлення з текстовим файлом → 200', withTextFile.status === 200, String(withTextFile.status));
  t('вміст файлу потрапив у промпт моделі', lastPrompt.includes('Розділ 1: зрада.'));
  t('вміст файлу видно в історії репліки автора', withTextFile.data?.userMessage?.content?.includes('plan.md'));

  // DELETE — позитивний
  const deleted = await call('DELETE', `/api/chat/sessions/${sessionId}`);
  t('DELETE /sessions/:id → 200', deleted.status === 200, String(deleted.status));
  t('після видалення GET → 404', (await call('GET', `/api/chat/sessions/${sessionId}`)).status === 404);

  server.close();
}

// ---------------------------------------------------------------------------
console.log('\nПровайдери (server/chatProviders.ts) — визначення моделей:');
{
  t('resolveEngine: gemini', providers.resolveEngine('gemini-3.7-flash') === 'gemini');
  t('resolveEngine: gpt', providers.resolveEngine('gpt-4o') === 'gpt');
  t('resolveEngine: claude', providers.resolveEngine('claude-sonnet-5') === 'claude');
  t('resolveEngine: deepseek', providers.resolveEngine('deepseek-chat') === 'deepseek');
  t('resolveEngine: groq (llama)', providers.resolveEngine('llama-3.3-70b-versatile') === 'groq');
  t('resolveEngine: mistral', providers.resolveEngine('mistral-large-latest') === 'mistral');
  t('resolveEngine: невідома модель → gemini', providers.resolveEngine('custom-xyz') === 'gemini');
  t('CHAT_MODELS містить рівно 8 варіантів (3 Claude: Haiku/Sonnet/Opus)', providers.CHAT_MODELS.length === 8, String(providers.CHAT_MODELS.length));
  t('isKnownModel: відома модель', providers.isKnownModel('deepseek-chat') === true);
  t('isKnownModel: невідома модель', providers.isKnownModel('zzz-not-a-model') === false);
  t('усі 6 рушіїв мають генератор у PROVIDERS',
    ['gemini', 'gpt', 'claude', 'deepseek', 'groq', 'mistral'].every((e) => typeof providers.PROVIDERS[e as keyof typeof providers.PROVIDERS] === 'function'));
}

// ---------------------------------------------------------------------------
console.log('\nТарифи нових провайдерів (server/pricing.ts):');
{
  t('priceForTextEngine(deepseek) використовує DeepSeek тариф',
    pricing.priceForTextEngine('deepseek', 1_000_000, 0) === pricing.DEEPSEEK_TEXT_PRICING.inputPerMillionUsd);
  t('priceForTextEngine(groq) використовує Groq тариф',
    pricing.priceForTextEngine('groq', 0, 1_000_000) === pricing.GROQ_TEXT_PRICING.outputPerMillionUsd);
  t('priceForTextEngine(mistral) сумує вхід+вихід',
    pricing.priceForTextEngine('mistral', 1_000_000, 1_000_000) ===
      pricing.MISTRAL_TEXT_PRICING.inputPerMillionUsd + pricing.MISTRAL_TEXT_PRICING.outputPerMillionUsd);
  t('deepseek flash: $0.22 вхід / $0.66 вихід за млн',
    pricing.DEEPSEEK_TEXT_PRICING.inputPerMillionUsd === 0.22 && pricing.DEEPSEEK_TEXT_PRICING.outputPerMillionUsd === 0.66);
  t('тарифи нових двигунів є в pricingSnapshot().textEngines',
    Object.keys(pricing.pricingSnapshot().textEngines).length === 6);

  // Кілька моделей Claude з різною ціною (Opus дорожчий за Sonnet, дешевший за нього Haiku).
  const sonnetCost = pricing.priceForTextEngine('claude', 1_000_000, 1_000_000, 'claude-sonnet-5');
  const opusCost = pricing.priceForTextEngine('claude', 1_000_000, 1_000_000, 'claude-opus-5');
  const haikuCost = pricing.priceForTextEngine('claude', 1_000_000, 1_000_000, 'claude-haiku-4-5-20251001');
  t('Claude Opus дорожчий за Sonnet за ту саму кількість токенів', opusCost > sonnetCost, `${opusCost} vs ${sonnetCost}`);
  t('Claude Haiku дешевший за Sonnet', haikuCost < sonnetCost, `${haikuCost} vs ${sonnetCost}`);
  t('Claude Opus 5: $5 вхід / $25 вихід за млн',
    pricing.CLAUDE_MODEL_PRICING['claude-opus-5'].inputPerMillionUsd === 5 &&
    pricing.CLAUDE_MODEL_PRICING['claude-opus-5'].outputPerMillionUsd === 25);
  t('Claude Haiku 4.5: $1 вхід / $5 вихід за млн',
    pricing.CLAUDE_MODEL_PRICING['claude-haiku-4-5-20251001'].inputPerMillionUsd === 1 &&
    pricing.CLAUDE_MODEL_PRICING['claude-haiku-4-5-20251001'].outputPerMillionUsd === 5);
  t('невідома модель Claude падає на CLAUDE_TEXT_PRICING (Sonnet 5)',
    pricing.priceForTextEngine('claude', 1_000_000, 1_000_000, 'claude-unknown-future-model') === sonnetCost);
  t('priceRateForModel повертає різну ціну для різних моделей Claude',
    pricing.priceRateForModel('claude', 'claude-opus-5').inputPerMillionUsd !==
      pricing.priceRateForModel('claude', 'claude-haiku-4-5-20251001').inputPerMillionUsd);
}

// ---------------------------------------------------------------------------
console.log('\n$-квота чату (checkChatQuota, server/subscriptions.ts):');
{
  const now = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 86400_000).toISOString();

  const admin = await subs.checkChatQuota('u-admin-check', 'admin');
  t('адмін без ліміту', admin.allowed && admin.quota === null);

  const free = await subs.checkChatQuota('u-free-check', 'writer');
  t('free/start без $-ліміту (chatQuotaUsd = null)', free.allowed && free.quota === null);

  await store.upsertSubscription({
    userId: 'u-pro-check', plan: 'pro', billingCycle: 'monthly', status: 'active',
    currentPeriodStart: now, currentPeriodEnd: periodEnd, createdAt: now, updatedAt: now,
  });
  const under = await subs.checkChatQuota('u-pro-check', 'writer');
  t('pro: початково дозволено, ліміт $5', under.allowed && under.quota === 5, String(under.quota));

  for (let i = 0; i < 6; i++) {
    await store.recordUsage({
      id: `use-quota-${i}-${Date.now()}`, timestamp: new Date().toISOString(), userId: 'u-pro-check',
      userEmail: 'pro@test.ua', role: 'writer', kind: 'text', engineId: 'deepseek',
      modelId: 'deepseek-chat', costUsd: 1, context: chat.CHAT_USAGE_CONTEXT, success: true,
    });
  }
  const over = await subs.checkChatQuota('u-pro-check', 'writer');
  t('pro: після $6 чат-витрат — заборонено', !over.allowed && over.remaining === 0, JSON.stringify(over));

  // Витрати поза контекстом чату не рахуються в квоту.
  await store.upsertSubscription({
    userId: 'u-pro2-check', plan: 'pro', billingCycle: 'monthly', status: 'active',
    currentPeriodStart: now, currentPeriodEnd: periodEnd, createdAt: now, updatedAt: now,
  });
  await store.recordUsage({
    id: `use-other-${Date.now()}`, timestamp: new Date().toISOString(), userId: 'u-pro2-check',
    userEmail: 'pro2@test.ua', role: 'writer', kind: 'text', engineId: 'gemini',
    modelId: 'gemini-3.7-flash', costUsd: 100, context: 'Редагування', success: true,
  });
  const otherOnly = await subs.checkChatQuota('u-pro2-check', 'writer');
  t('лише витрати чату рахуються в квоту', otherOnly.allowed, JSON.stringify(otherOnly));
}

// ---------------------------------------------------------------------------
console.log('\nАдмінські роути сесій чату (сайдбар «Тарифи та аналітика ШІ»):');
{
  let adminPrincipal: any = { id: 'u-admin', email: 'admin@test.ua', name: 'Адмін', role: 'admin', isGuest: false };
  const appAdmin = express();
  appAdmin.use(express.json());
  appAdmin.use((req: any, _res, next) => { req.principal = adminPrincipal; next(); });
  admin.registerAdminRoutes(appAdmin);

  const serverAdmin = appAdmin.listen(0);
  await new Promise((r) => serverAdmin.once('listening', r));
  const portAdmin = (serverAdmin.address() as any).port;
  const baseAdmin = `http://127.0.0.1:${portAdmin}`;
  const callAdmin = async (method: string, path: string, body?: any) => {
    const res = await fetch(`${baseAdmin}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  // POST /api/admin/chat/sessions — тестова сесія під обліковим записом адміна
  const createdAdminSession = await callAdmin('POST', '/api/admin/chat/sessions', {});
  t('POST /admin/chat/sessions → 201', createdAdminSession.status === 201, String(createdAdminSession.status));
  const adminSessionId = createdAdminSession.data?.session?.id;
  t('сесія створена під обліковим записом адміна', createdAdminSession.data?.session?.userId === 'u-admin');
  t('сесія має модель за замовчуванням (перша з CHAT_MODELS)', createdAdminSession.data?.session?.modelId === providers.CHAT_MODELS[0].id);

  const createdWithModel = await callAdmin('POST', '/api/admin/chat/sessions', { modelId: 'deepseek-chat' });
  t('POST з бажаною моделлю використовує її', createdWithModel.data?.session?.modelId === 'deepseek-chat');

  t('нова сесія реально з’являється в БД', (await store.getChatSession(adminSessionId))?.userId === 'u-admin');

  // DELETE /api/admin/chat/sessions/:id — модерація будь-якої сесії
  const deletedAdmin = await callAdmin('DELETE', `/api/admin/chat/sessions/${adminSessionId}`);
  t('DELETE /admin/chat/sessions/:id → 200', deletedAdmin.status === 200, String(deletedAdmin.status));
  t('сесію справді видалено', (await store.getChatSession(adminSessionId)) === undefined);

  const deleteMissing = await callAdmin('DELETE', '/api/admin/chat/sessions/does-not-exist');
  t('видалення неіснуючої сесії → 404', deleteMissing.status === 404, String(deleteMissing.status));

  // Не-адмін не має доступу (requireAdmin)
  adminPrincipal = { id: 'u-writer', email: 'writer@test.ua', name: 'Автор', role: 'writer', isGuest: false };
  const forbidden = await callAdmin('POST', '/api/admin/chat/sessions', {});
  t('не-адмін → 403 на POST /admin/chat/sessions', forbidden.status === 403, String(forbidden.status));

  serverAdmin.close();
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
