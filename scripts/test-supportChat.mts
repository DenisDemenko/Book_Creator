/**
 * Тести чату підтримки сайту (адмін-CRM). Запуск: npm run test:support-chat
 *
 * Покриття:
 *  1. Чисті функції валідації/прев'ю (supportChatRoutes.ts).
 *  2. Шар сховища (server/store.ts) — обидва бекенди (JSON і SQLite) дають
 *     той самий результат: тред один на користувача, лічильники непрочитаного
 *     ростуть з правильного боку, треди сортуються за свіжістю.
 *  3. Реальні HTTP-роути на піднятому Express: користувацька половина
 *     (лише залогінені), адмінська половина (лише admin), і те, що
 *     непрочитане гасне саме тим боком, який відкрив переписку.
 */
const DIR = '/tmp/nova-supportchat-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/store');
const support = await import('../server/supportChatRoutes');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

// ---------------------------------------------------------------------------
console.log('Чисті функції — валідація та прев\'ю:');
{
  t('порожнє повідомлення відхиляється', support.validateSupportMessage('   ') !== null);
  t('не-рядок відхиляється', support.validateSupportMessage(42) !== null);
  t('задовге повідомлення відхиляється',
    support.validateSupportMessage('x'.repeat(support.MAX_SUPPORT_MESSAGE_CHARS + 1)) !== null);
  t('нормальне повідомлення приймається', support.validateSupportMessage('Не працює завантаження обкладинки.') === null);

  const long = 'а '.repeat(200).trim();
  const preview = support.supportMessagePreview(long);
  t('довге прев\'ю обрізається з трикрапкою', preview.length <= 140 && preview.endsWith('…'), String(preview.length));
  t('короткий текст лишається як є', support.supportMessagePreview('Привіт!') === 'Привіт!');
  t('переноси рядків згортаються в пробіли',
    support.supportMessagePreview('перший\n\nдругий') === 'перший другий');
}

// ---------------------------------------------------------------------------
function threadOf(userId: string, over: Partial<import('../server/store').StoredSupportThread> = {}) {
  const now = new Date().toISOString();
  return {
    id: `support-${userId}`,
    userId,
    status: 'open' as const,
    lastMessageAt: now,
    lastMessagePreview: '',
    messageCount: 0,
    unreadByAdmin: 0,
    unreadByUser: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

async function runStoreSuite(label: string) {
  console.log(`\nСховище (${label}):`);

  const thread = await store.createSupportThread(threadOf('u-1'));
  t('тред створюється', thread.id === 'support-u-1');

  const byId = await store.getSupportThread(thread.id);
  t('читається за id', byId?.userId === 'u-1');

  const byUser = await store.getSupportThreadByUser('u-1');
  t('читається за userId', byUser?.id === thread.id);

  const missing = await store.getSupportThreadByUser('нема-такого');
  t('відсутній користувач → undefined', missing === undefined);

  const msg1 = await store.addSupportMessage({
    id: 'm-1', threadId: thread.id, senderRole: 'user', senderId: 'u-1',
    content: 'Не бачу свою книгу в списку.', createdAt: new Date().toISOString(),
  });
  t('репліка користувача додається', msg1.senderRole === 'user');

  const updated = await store.updateSupportThread({
    ...thread, messageCount: 1, unreadByAdmin: 1,
    lastMessagePreview: 'Не бачу свою книгу в списку.', updatedAt: new Date().toISOString(),
  });
  t('тред оновлюється', updated.messageCount === 1 && updated.unreadByAdmin === 1);

  await store.addSupportMessage({
    id: 'm-2', threadId: thread.id, senderRole: 'admin', senderId: 'admin-1',
    content: 'Перевірте, будь ласка, чи книга збереглась у чернетках.', createdAt: new Date().toISOString(),
  });

  const messages = await store.listSupportMessages(thread.id);
  t('обидві репліки читаються за хронологією', messages.length === 2 && messages[0].senderRole === 'user' && messages[1].senderRole === 'admin');

  // Другий користувач — щоб перевірити, що треди не змішуються.
  await store.createSupportThread(threadOf('u-2', { id: 'support-u-2', lastMessageAt: new Date(Date.now() + 1000).toISOString() }));
  const all = await store.listAllSupportThreads();
  t('усі треди видно адміну', all.length === 2, String(all.length));
  t('найсвіжіший тред першим', all[0].userId === 'u-2', all.map((x) => x.userId).join(','));

  t('порожній тред іншого користувача не має повідомлень',
    (await store.listSupportMessages('support-u-2')).length === 0);
}

console.log('\nБекенд JSON (SQLite ще не піднято):');
t('SQLite поки недоступний', !db.isAvailable());
await runStoreSuite('JSON');

console.log('\nПерехід на SQLite:');
await db.initDb();
t('бекенд = sqlite', db.isAvailable());
store.__resetCacheForTests();
await runStoreSuite('SQLite');

// ---------------------------------------------------------------------------
console.log('\nHTTP-роути (без мережі, підставний principal):');
{
  let currentPrincipal: any = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'writer', isGuest: false };

  // /api/admin/support/threads підтягує контакти через listUsers() — тред
  // без справжнього рядка користувача (як буває, коли principal підставний)
  // мав би віддавати user: null, а не падати; але для реального сценарію
  // (де messenger доступний лише зареєстрованим) рядок користувача завжди є,
  // тож заводимо його і тут, щоб перевірити саме контакти в списку.
  await store.saveUser({
    id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'writer', createdAt: new Date().toISOString(),
  });

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.principal = currentPrincipal; next(); });
  support.registerSupportChatRoutes(app);

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

  // Гість — доступ заборонено.
  currentPrincipal = { id: null, email: 'guest@local', name: 'Гість', role: 'guest', isGuest: true };
  const guestTry = await call('GET', '/api/support/thread');
  t('гостю /api/support/thread недоступний', guestTry.status === 401, String(guestTry.status));

  // Звичайний користувач відкриває власний тред (створюється лінькво).
  currentPrincipal = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'writer', isGuest: false };
  const firstOpen = await call('GET', '/api/support/thread');
  t('GET /api/support/thread → 200', firstOpen.status === 200, String(firstOpen.status));
  t('порожній тред без повідомлень', Array.isArray(firstOpen.data?.messages) && firstOpen.data.messages.length === 0);

  const sent = await call('POST', '/api/support/thread/messages', { content: 'Не можу опублікувати курс — кнопка сіра.' });
  t('POST /api/support/thread/messages → 201', sent.status === 201, String(sent.status));
  const threadId = sent.data?.thread?.id;
  t('повідомлення позначено роллю user', sent.data?.message?.senderRole === 'user');
  t('лічильник непрочитаного адміном зріс', sent.data?.thread?.unreadByAdmin === 1, String(sent.data?.thread?.unreadByAdmin));

  const emptyMsg = await call('POST', '/api/support/thread/messages', { content: '   ' });
  t('порожнє повідомлення → 400', emptyMsg.status === 400, String(emptyMsg.status));

  // Другий вхід користувача гасить unreadByUser (поки що 0, бо відповіді ще не було).
  const reopen = await call('GET', '/api/support/thread');
  t('повторний GET бачить надіслане повідомлення', reopen.data?.messages?.length === 1);

  // Не-адмін не бачить адмінські роути.
  const forbiddenList = await call('GET', '/api/admin/support/threads');
  t('не-адміну /api/admin/support/threads → 403', forbiddenList.status === 403, String(forbiddenList.status));

  // Адмін заходить.
  currentPrincipal = { id: 'admin-http', email: 'admin@test.ua', name: 'Адмін', role: 'admin', isGuest: false };
  const adminList = await call('GET', '/api/admin/support/threads');
  t('адміну список тредів → 200', adminList.status === 200 && Array.isArray(adminList.data?.threads));
  const row = adminList.data.threads.find((r: any) => r.threadId === threadId || r.id === threadId);
  t('тред користувача у списку з контактами', !!row && row.user?.email === 'http@test.ua', JSON.stringify(row?.user));
  t('unreadByAdmin видно в списку', row?.unreadByAdmin === 1, String(row?.unreadByAdmin));

  const missingThread = await call('GET', '/api/admin/support/threads/нема-такого');
  t('неіснуючий тред → 404', missingThread.status === 404, String(missingThread.status));

  const opened = await call('GET', `/api/admin/support/threads/${threadId}`);
  t('адмін відкриває тред → 200', opened.status === 200, String(opened.status));
  t('unreadByAdmin згас після відкриття', opened.data?.thread?.unreadByAdmin === 0, String(opened.data?.thread?.unreadByAdmin));
  t('адмін бачить повідомлення користувача', opened.data?.messages?.length === 1);

  const reply = await call('POST', `/api/admin/support/threads/${threadId}/messages`, { content: 'Перевірте кабінет курсів — там сірою кнопка, поки не заповнено всі модулі.' });
  t('відповідь адміна → 201', reply.status === 201, String(reply.status));
  t('відповідь позначена роллю admin', reply.data?.message?.senderRole === 'admin');
  t('unreadByUser зріс після відповіді адміна', reply.data?.thread?.unreadByUser === 1, String(reply.data?.thread?.unreadByUser));

  // Користувач повертається — бачить відповідь, unreadByUser гасне.
  currentPrincipal = { id: 'u-http', email: 'http@test.ua', name: 'Тест', role: 'writer', isGuest: false };
  const userSeesReply = await call('GET', '/api/support/thread');
  t('користувач бачить відповідь адміна', userSeesReply.data?.messages?.length === 2);
  t('unreadByUser згас після перегляду', userSeesReply.data?.thread?.unreadByUser === 0, String(userSeesReply.data?.thread?.unreadByUser));

  server.close();
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
