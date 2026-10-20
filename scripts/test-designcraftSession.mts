/**
 * Транспорт живої сесії DesignCraft. Запуск: npm run test:designcraft-session
 *
 * ЧОМУ ЦЕЙ ТЕСТ ІСНУЄ. Запис #449 чесно зафіксував дірку: сесійний транспорт
 * перевірявся лише прогоном GateB зі справжнім `designcraft-cli`, якого в CI
 * немає, тож у `npm test` він не входив і регресію ніхто б не зловив. Тут
 * замість бінарника стоїть підставний сервер того самого протоколу
 * (`fixtures/fake-designcraft-mcp.mjs`), тому тест іде будь-де.
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Не «щасливий шлях» — його й GateB покриває, — а те, що
 * ламається тихо:
 *
 *  1. ЗВІТ ПРО ЗБІЙ НЕ ГУБИТЬСЯ. `isError` мусить донести `failedIndex` і
 *     `failedCommand` до рушія, інакше замість «крок 2 (story.get): no such
 *     story» автор побачить «невідома помилка».
 *  2. МЕЖІ РЯДКІВ. Відповідь приходить потоком і може розірватися посеред
 *     JSON; склеювання — єдине, що стоїть між цим і «нерозбірний рядок».
 *  3. НІЩО НЕ ВИСИТЬ НАЗАВЖДИ. Сервер замовк, помер або віддав завелику
 *     відповідь — усі незавершені запити мусять впасти з причиною, а не
 *     лишити рендер у вічному очікуванні.
 *
 * ЧОГО ЦЕ НЕ ПОКРИВАЄ: сам конвеєр верстки. Те, що сесія будує правильний
 * документ, доводить лише `test-designcraftGateB.mts` із
 * `DESIGNCRAFT_SESSION=1` і справжнім бінарником.
 */
process.env.DATA_DIR ||= '/tmp/nova-designcraft-session-test';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function t(name: string, condition: boolean, details = ''): void {
  if (condition) pass += 1;
  else fail += 1;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${details ? ` — ${details}` : ''}`);
}

const { DesigncraftSession, DesigncraftSessionError } = await import('../server/pdf/designcraft/session');

/** Клас прийшов динамічним import, тож як ТИП його треба брати через InstanceType. */
type SessionError = InstanceType<typeof DesigncraftSessionError>;

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-designcraft-mcp.mjs');

function options(overrides: Partial<{ timeoutMs: number; maxResponseChars: number }> = {}) {
  return {
    cliPath: process.execPath,
    args: [FAKE],
    timeoutMs: 5_000,
    maxResponseChars: 1_000_000,
    ...overrides,
  };
}

async function caught(run: () => Promise<unknown>): Promise<SessionError | Error | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err as Error;
  }
}

// ---------------------------------------------------------------------------
console.log('\nРукостискання і щасливий шлях');
{
  const session = await DesigncraftSession.start(options());
  try {
    const one = await session.execute('file.new', { preset: 'A5' });
    t('execute повертає розпакований результат', one?.ok === true, JSON.stringify(one));
    t('аргументи доходять до сервера', one?.got?.command === 'file.new', JSON.stringify(one?.got));
    t('викликається саме інструмент execute', one?.tool === 'execute', String(one?.tool));

    const report = await session.batch([
      { command: 'file.new', params: {} },
      { command: 'story.get', params: { story: 9 } },
    ]);
    t('batch повертає звіт', (report as any)?.ok === true, JSON.stringify(report));

    const two = await session.execute('document.inspect', {});
    t('друга команда в тій самій сесії працює', two?.ok === true);
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
console.log('\nЗвіт про збій доходить до рушія');
{
  const session = await DesigncraftSession.start(options());
  try {
    const err = (await caught(() => session.batch([{ command: 'x', params: { behave: 'fail' } }]))) as SessionError;
    t('isError стає помилкою', err instanceof DesigncraftSessionError, String(err?.name));
    t('kind = tool', err?.kind === 'tool', String(err?.kind));
    t('звіт збережено', !!err?.report, JSON.stringify(err?.report)?.slice(0, 80));
    t('failedIndex у звіті', err?.report?.failedIndex === 2, String(err?.report?.failedIndex));
    t('failedCommand у звіті', err?.report?.failedCommand === 'story.get', String(err?.report?.failedCommand));
    t('часткові results збережено', Array.isArray(err?.report?.results) && err.report!.results!.length === 2);
    t('повідомлення називає крок і команду', /Крок 2 \(story\.get\)/.test(err?.message || ''), err?.message);
    t('повідомлення несе текст помилки рушія', /no such story s9/.test(err?.message || ''), err?.message);

    // Сесія мусить лишитись робочою: збій кроку — не смерть транспорту.
    const after = await session.execute('document.inspect', {});
    t('після збою кроку сесія жива', after?.ok === true);
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
console.log('\nПомилки протоколу й нерозбірний текст');
{
  const session = await DesigncraftSession.start(options());
  try {
    const rpc = (await caught(() => session.execute('x', { behave: 'rpcerror' }))) as SessionError;
    t('JSON-RPC error стає помилкою', rpc instanceof DesigncraftSessionError);
    t('kind = protocol', rpc?.kind === 'protocol', String(rpc?.kind));
    t('повідомлення містить текст сервера', /missing tool/.test(rpc?.message || ''), rpc?.message);

    const notJson = (await caught(() => session.execute('x', { behave: 'notjson' }))) as SessionError;
    t('isError з нерозбірним текстом не валить клієнта', notJson instanceof DesigncraftSessionError);
    t('текст сервера доходить', /не json зовсім/.test(notJson?.message || ''), notJson?.message);
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
console.log('\nМежі рядків: відповідь, розірвана посеред JSON');
{
  const session = await DesigncraftSession.start(options());
  try {
    const out = await session.execute('story.get', { behave: 'split' });
    t('розірвану відповідь склеєно', out?.pageCount === 42, JSON.stringify(out));
    const next = await session.execute('document.inspect', {});
    t('після склеювання буфер чистий', next?.ok === true, JSON.stringify(next)?.slice(0, 60));
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
console.log('\nНіщо не висить назавжди');
{
  // Завелика відповідь.
  const big = await DesigncraftSession.start(options({ maxResponseChars: 500 }));
  const huge = (await caught(() => big.execute('x', { behave: 'huge' }))) as SessionError;
  t('завелика відповідь валить запит', huge instanceof DesigncraftSessionError, String(huge?.name));
  t('причина названа', /перевищила 500/.test(huge?.message || ''), huge?.message);
  big.close();

  // Сервер замовк.
  const quiet = await DesigncraftSession.start(options({ timeoutMs: 300 }));
  const timeout = (await caught(() => quiet.execute('x', { behave: 'silent' }))) as SessionError;
  t('замовклий сервер дає таймаут', timeout?.kind === 'timeout', String(timeout?.kind));
  t('таймаут називає час і метод', /300 мс \(tools\/call\)/.test(timeout?.message || ''), timeout?.message);
  quiet.close();

  // Процес помер посеред запиту.
  const dying = await DesigncraftSession.start(options());
  const died = (await caught(() => dying.execute('x', { behave: 'die' }))) as SessionError;
  t('смерть процесу валить запит', died instanceof DesigncraftSessionError, String(died?.name));
  t('kind = exit', died?.kind === 'exit', String(died?.kind));
  t('причина містить код виходу', /кодом 7/.test(died?.message || ''), died?.message);
  const afterDeath = (await caught(() => dying.execute('document.inspect', {}))) as SessionError;
  t('запит після смерті не висить', afterDeath instanceof DesigncraftSessionError);
  t('сказано, що сесія закрита', /сесія вже закрита/.test(afterDeath?.message || ''), afterDeath?.message);
  dying.close();
}

// ---------------------------------------------------------------------------
console.log('\nЗакриття');
{
  const session = await DesigncraftSession.start(options());
  await session.execute('file.new', {});
  session.close();
  session.close(); // стоїть у finally рушія, тож мусить бути безпечним двічі
  t('close() двічі безпечний', true);
  const after = (await caught(() => session.execute('x', {}))) as SessionError;
  t('після close запит відхиляється, а не висить', after instanceof DesigncraftSessionError, after?.message);
}

console.log(`\nDesignCraft session transport: ${pass} пройдено, ${fail} провалено.`);
console.log('  Конвеєр верстки цим НЕ покрито: його доводить GateB із DESIGNCRAFT_SESSION=1 і справжнім бінарником.');
if (fail > 0) process.exit(1);
