/**
 * Підставний MCP-сервер замість бінарника DesignCraft.
 *
 * ЧОМУ. Транспорт живої сесії (`server/pdf/designcraft/session.ts`) інакше
 * можна було б перевірити лише разом зі справжнім `designcraft-cli`, якого в
 * CI немає, — тобто ніколи. Цей файл говорить тим самим протоколом
 * (newline-delimited JSON-RPC 2.0 на stdin/stdout) і вміє на вимогу поводитись
 * так, як справжній сервер поводиться в рідкісних випадках: віддати крок із
 * помилкою, розірвати відповідь між записами в потік, замовкнути, померти
 * посеред запиту.
 *
 * Поведінку обирає поле `behave` в аргументах інструмента, тож тест керує
 * нею з виклику, а не змінними середовища.
 */
import { stdin, stdout } from 'node:process';

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: false });
const bad = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: true });

function send(message) {
  stdout.write(`${JSON.stringify(message)}\n`);
}

/** Відповідь, розірвана навпіл просто посеред JSON: клієнт мусить склеїти. */
function sendSplit(message) {
  const line = `${JSON.stringify(message)}\n`;
  const cut = Math.floor(line.length / 2);
  stdout.write(line.slice(0, cut));
  setTimeout(() => stdout.write(line.slice(cut)), 15);
}

let buffer = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
    index = buffer.indexOf('\n');
  }
});

function handle(message) {
  const { id, method, params } = message;
  if (id === undefined) return; // повідомлення без id (notifications/initialized)

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'fake-designcraft', version: '0.0.0' },
      },
    });
    return;
  }

  if (method !== 'tools/call') {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    return;
  }

  const args = params?.arguments || {};
  // Клієнт кладе параметри команди в `params` (execute) або в `commands[]`
  // (batch), тож прапорець поведінки шукаємо там, де він реально опиняється.
  const behave = args.behave ?? args.params?.behave ?? args.commands?.[0]?.params?.behave;
  switch (behave) {
    case 'fail':
      send({
        jsonrpc: '2.0',
        id,
        result: bad({
          completed: 2,
          results: [{ index: 1 }, { id: 11, story: 12 }],
          failedIndex: 2,
          failedCommand: 'story.get',
          error: 'no such story s9',
        }),
      });
      return;

    case 'rpcerror':
      send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'missing tool `name`' } });
      return;

    case 'notjson':
      // isError з текстом, який не є JSON: клієнт не має впасти на розборі.
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'не json зовсім' }], isError: true } });
      return;

    case 'split':
      sendSplit({ jsonrpc: '2.0', id, result: text({ overset: null, pageCount: 42 }) });
      return;

    case 'huge':
      send({ jsonrpc: '2.0', id, result: text({ padding: 'я'.repeat(4000) }) });
      return;

    case 'silent':
      return; // відповіді не буде ніколи

    case 'die':
      process.exit(7);
      return;

    default:
      send({ jsonrpc: '2.0', id, result: text({ ok: true, tool: params?.name, got: args }) });
  }
}
