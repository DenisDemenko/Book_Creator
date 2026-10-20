/**
 * MCP-сервер Студії й маршрут читання тексту (пункт 6 плану).
 * Запуск: npm run test:studio-mcp
 *
 * Піднімається справжній Express із зовнішнім API, створюється справжній
 * токен `nst_`, і MCP-сервер ходить до цього локального сервера по HTTP —
 * тобто перевіряється весь ланцюг, без мережі й без підставного fetch.
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ:
 *
 *  1. ЧУЖЕ НЕ ВИДНО. Токен одного автора не має читати книгу іншого — ні
 *     через маршрут, ні через інструмент.
 *  2. ВІДПОВІДЬ КАЖЕ, ЩО ВОНА ДЗЕРКАЛО. Книга живе в браузері; текст на
 *     сервері може бути старшим. Агент мусить бачити `revision` і
 *     застереження, а не здогадуватись.
 *  3. ТОКЕН НЕ ВИТІКАЄ. Ні в повідомленнях про помилку, ні в підказках.
 *  4. ПОМИЛКА ІНСТРУМЕНТА — РЕЗУЛЬТАТ, А НЕ ЗБІЙ ПРОТОКОЛУ: модель мусить
 *     прочитати текст і виправитись, а не впасти.
 *  5. ЛИШЕ ЧИТАННЯ. Серед інструментів не має бути жодного, що пише в книгу.
 */
const DIR = '/tmp/nova-studio-mcp-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

const db = await import('../server/db');
const xstore = await import('../server/external/externalApiStore');
const routes = await import('../server/external/externalApiRoutes');
const storeMod = await import('../server/store');
const bookStore = await import('../server/bookStore');
const { StudioMcpServer, studioToolDefinitions, STUDIO_MCP_PROTOCOL } = await import('../server/external/studioMcp');

await db.initDb();

const now = new Date().toISOString();
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', createdAt: now } as never);
await storeMod.saveUser({ id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', createdAt: now } as never);
await bookStore.saveBook({
  ownerId: 'u-a',
  book: {
    id: 'book-a',
    title: 'Книга А',
    author: 'Авторка',
    chapters: [
      { id: 'ch-1', title: 'Перша глава', order: 1, sections: [{ id: 's1', order: 1, content: '<p>Текст <b>першої</b> глави.</p>' }] },
      { id: 'ch-2', title: 'Друга глава', order: 2, sections: [{ id: 's2', order: 1, content: '<p>Текст другої глави.</p>' }] },
    ],
  } as never,
});
await bookStore.saveBook({ ownerId: 'u-b', book: { id: 'book-b', title: 'Чужа', chapters: [] } as never });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req: any, _res, next) => {
  req.principal = { id: null, email: 'guest@local', name: 'Гість', role: 'guest', isGuest: true };
  next();
});
routes.registerExternalApiRoutes(app, {
  recognize: async () => ({ text: '', modelId: 'test' }),
  checkStorage: async () => ({ allowed: true }),
  schedule: () => {},
});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

const { token: tokenA } = await xstore.createToken({ userId: 'u-a', name: 'agent' });
const { token: tokenB } = await xstore.createToken({ userId: 'u-b', name: 'agent' });

// ---------------------------------------------------------------------------
console.log('\nМаршрут читання тексту');
{
  const get = (path: string, token: string) =>
    fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  const ok = await get('/api/external/v1/books/book-a/text', tokenA);
  const body: any = await ok.json();
  t('своя книга — 200', ok.status === 200, String(ok.status));
  t('віддано markdown', typeof body?.markdown === 'string' && body.markdown.length > 0, String(body?.chars));
  t('HTML перетворено, а не віддано як є', !/<p>/.test(body?.markdown || ''), (body?.markdown || '').slice(0, 60));
  t('жирний текст став markdown', /\*\*першої\*\*/.test(body?.markdown || ''), (body?.markdown || '').slice(0, 120));
  t('обидві глави в тексті', /Перша глава/.test(body.markdown) && /Друга глава/.test(body.markdown));
  t('є ревізія', Number.isFinite(body?.book?.revision), String(body?.book?.revision));
  t('є час оновлення', !!body?.book?.updatedAt);
  t('кількість глав повідомлено', body?.book?.chapterCount === 2, String(body?.book?.chapterCount));
  t('відповідь прямо каже, що це дзеркало', /дзеркало/.test(body?.mirrorNoteUk || ''), (body?.mirrorNoteUk || '').slice(0, 60));
  t('сказано, що писати не можна', /писати в книгу через цей api не можна/i.test(body?.mirrorNoteUk || ''));

  const one = await get('/api/external/v1/books/book-a/text?chapterId=ch-2', tokenA);
  const oneBody: any = await one.json();
  t('одна глава — 200', one.status === 200);
  t('у тексті лише вибрана глава', /Друга глава/.test(oneBody.markdown) && !/Перша глава/.test(oneBody.markdown), oneBody.markdown.slice(0, 80));
  t('chapterId повернено', oneBody.chapterId === 'ch-2', String(oneBody.chapterId));

  const noChapter = await get('/api/external/v1/books/book-a/text?chapterId=nope', tokenA);
  t('невідома глава — 404', noChapter.status === 404, String(noChapter.status));
  t('причина машинна', (await noChapter.json())?.kind === 'chapter_not_found');

  const foreign = await get('/api/external/v1/books/book-a/text', tokenB);
  t('чужа книга — 404, а не 403', foreign.status === 404, String(foreign.status));

  const noToken = await fetch(`${base}/api/external/v1/books/book-a/text`);
  t('без токена — 401', noToken.status === 401, String(noToken.status));
}

// ---------------------------------------------------------------------------
console.log('\nMCP: протокол і набір інструментів');
{
  const mcp = new StudioMcpServer({ baseUrl: base, token: tokenA });

  const init = JSON.parse(
    (await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))) || '{}'
  );
  t('initialize відповідає', init?.result?.protocolVersion === STUDIO_MCP_PROTOCOL, init?.result?.protocolVersion);
  t('сервер назвав себе', init?.result?.serverInfo?.name === 'nova-studio');
  t('інструкція каже, що копія — дзеркало', /mirror/i.test(init?.result?.instructions || ''));
  t('інструкція радить парувати з DesignCraft', /DesignCraft/.test(init?.result?.instructions || ''));

  t('повідомлення без id не дає відповіді', (await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))) === null);
  t('initialized зафіксовано', mcp.isInitialized === true);

  const tools = studioToolDefinitions() as any[];
  t('інструментів чотири', tools.length === 4, tools.map((x) => x.name).join(', '));
  t('жоден інструмент не пише', !tools.some((x) => /write|submit|update|create|delete/i.test(x.name)), tools.map((x) => x.name).join(', '));
  t('кожен має схему', tools.every((x) => x.inputSchema?.type === 'object'));

  const bad = JSON.parse((await mcp.handleLine('це не json')) || '{}');
  t('нерозбірний рядок — помилка протоколу', bad?.error?.code === -32700, JSON.stringify(bad?.error));
  const noMethod = JSON.parse((await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 9 }))) || '{}');
  t('без method — помилка', noMethod?.error?.code === -32600);
  const unknown = JSON.parse((await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'nope' }))) || '{}');
  t('невідомий метод — -32601', unknown?.error?.code === -32601);
}

// ---------------------------------------------------------------------------
console.log('\nMCP: інструменти читають справжню книгу');
{
  const mcp = new StudioMcpServer({ baseUrl: base, token: tokenA });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const line = await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }));
    const parsed = JSON.parse(line || '{}');
    const text = parsed?.result?.content?.[0]?.text ?? '';
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
    return { isError: !!parsed?.result?.isError, payload, text };
  };

  const me = await call('studio_me');
  t('studio_me повертає автора', me.payload?.user?.id === 'u-a', JSON.stringify(me.payload).slice(0, 80));

  const books = await call('studio_list_books');
  t('studio_list_books бачить свою книгу', (books.payload?.books || []).some((b: any) => b.id === 'book-a'));
  t('і НЕ бачить чужої', !(books.payload?.books || []).some((b: any) => b.id === 'book-b'), JSON.stringify(books.payload?.books));

  const chapters = await call('studio_list_chapters', { bookId: 'book-a' });
  t('studio_list_chapters у порядку читання', (chapters.payload?.chapters || []).map((c: any) => c.id).join(',') === 'ch-1,ch-2', JSON.stringify(chapters.payload?.chapters?.map((c: any) => c.id)));

  const read = await call('studio_read_book', { bookId: 'book-a' });
  t('studio_read_book віддає текст', /Перша глава/.test(read.payload?.markdown || ''));
  t('і несе ревізію', Number.isFinite(read.payload?.book?.revision));

  const oneChapter = await call('studio_read_book', { bookId: 'book-a', chapterId: 'ch-1' });
  t('читання однієї глави працює', /Перша глава/.test(oneChapter.payload?.markdown || '') && !/Друга глава/.test(oneChapter.payload?.markdown || ''));

  const missing = await call('studio_read_book', {});
  t('без bookId — помилка РЕЗУЛЬТАТОМ, не збоєм', missing.isError === true, missing.text.slice(0, 80));
  t('сказано, звідки взяти bookId', /studio_list_books/.test(missing.text), missing.text.slice(0, 120));

  const foreign = await call('studio_read_book', { bookId: 'book-b' });
  t('чужа книга — isError', foreign.isError === true, foreign.text.slice(0, 100));
  t('у тексті помилки НЕМА токена', !foreign.text.includes(tokenA) && !/nst_/.test(foreign.text), foreign.text.slice(0, 120));

  // Невідомий інструмент — це помилка ВИКЛИКАЧА, не стан, який модель може
  // виправити читанням тексту, тож тут саме помилка протоколу з -32602.
  const nope = JSON.parse(
    (await mcp.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'нема_такого', arguments: {} } })
    )) || '{}'
  );
  t('невідомий інструмент — -32602', nope?.error?.code === -32602, JSON.stringify(nope?.error));
  t('у помилці названо інструмент', /нема_такого/.test(nope?.error?.message || ''), nope?.error?.message);
}

// ---------------------------------------------------------------------------
console.log('\nMCP: недосяжна Студія не валить сервер');
{
  const mcp = new StudioMcpServer({ baseUrl: 'http://127.0.0.1:1', token: tokenA });
  const line = await mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'studio_list_books', arguments: {} } }));
  const parsed = JSON.parse(line || '{}');
  t('недосяжність — isError, а не падіння', parsed?.result?.isError === true, JSON.stringify(parsed?.result).slice(0, 100));
  t('сказано, куди не вдалося дістатись', /127\.0\.0\.1:1/.test(parsed?.result?.content?.[0]?.text || ''));
  t('токена в повідомленні немає', !/nst_/.test(parsed?.result?.content?.[0]?.text || ''));
}

server.close();
console.log(`\nStudio MCP: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
