/**
 * MCP-сервер Студії: дає агентові ЧИТАТИ книгу.
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ СЕРВЕР, А НЕ ЩЕ ОДИН МІСТ ДО DESIGNCRAFT. Пункт 6
 * `PLAN_DESIGNCRAFT_BRIDGE.md`: для творчого шляху зв'язок
 * студія↔designcraft не потрібен узагалі. Агент тримає ДВА сервери —
 * цей для рукопису й `designcraft-cli mcp` для верстки — і сам з'єднує
 * їх у себе. Так Студії не треба знати про верстку, а DesignCraft — про книгу.
 *
 * ЧОМУ ПОВЕРХ ЗОВНІШНЬОГО API, А НЕ ПРЯМО ПО БАЗІ. `/api/external/v1`
 * уже має модель доступу: особистий токен `nst_`, який автор створює й
 * відкликає в Студії, права на рівні маршруту й перевірку власності книги.
 * Сервер, що читав би сховище напряму, обійшов би все це — і став би другим
 * місцем, де вирішується, кому що видно.
 *
 * ЧОМУ ЛИШЕ ЧИТАННЯ. Книга живе в IndexedDB браузера; серверна копія —
 * дзеркало, яке наступне збереження з браузера перезапише. Агент, що писав
 * би в дзеркало, втратив би написане за першим натисканням клавіші в
 * Студії — той самий урок, через який скани WriterScan лягають у «Вхідні», а
 * не в главу. Тому інструменти тут лише читають, і кожна відповідь несе
 * `revision`, щоб агент бачив, наскільки свіже те, що він прочитав.
 *
 * Транспорт — newline-delimited JSON-RPC 2.0 (`handleLine`), як у
 * `designcraft-mcp`. Процесом його запускає `scripts/studio-mcp.mts`.
 */

/** Версія протоколу, яку реалізуємо. */
export const STUDIO_MCP_PROTOCOL = '2025-06-18';
const SUPPORTED = [STUDIO_MCP_PROTOCOL, '2025-03-26', '2024-11-05'];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface StudioMcpOptions {
  /** Корінь Студії, напр. https://fusionlab.in.ua/studio */
  baseUrl: string;
  /** Особистий токен автора (`nst_…`). У журнал і у відповіді не потрапляє. */
  token: string;
  /** Підміняється в тестах. */
  fetchImpl?: typeof fetch;
}

const INSTRUCTIONS =
  'Nova Studio holds the author\'s book. These tools READ it: list books, list chapters, and fetch the ' +
  'manuscript as Markdown. The server copy is a mirror of a book that lives in the author\'s browser, so ' +
  'it can lag behind what they see — every reply carries `revision` and `updatedAt`, and you should quote ' +
  'them when the freshness matters. Nothing here writes to the book: text reaches a chapter only when the ' +
  'author accepts it in the Studio. To lay a book out, pair this with the DesignCraft MCP server, which ' +
  'takes a manuscript and produces a typeset PDF.';

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'studio_me',
    title: 'Who the token belongs to',
    description: 'The author this token authorizes: id, name, email, role.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_list_books',
    title: 'Books on the server',
    description:
      'Books already mirrored to the server, newest first. A book the author has never saved is not here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_list_chapters',
    title: 'Chapters of a book',
    description: 'Chapter id, title, order and section count, in reading order.',
    inputSchema: {
      type: 'object',
      properties: { bookId: { type: 'string', description: 'Book id from studio_list_books.' } },
      required: ['bookId'],
      additionalProperties: false,
    },
  },
  {
    name: 'studio_read_book',
    title: 'Read the manuscript',
    description:
      'The book as Markdown, whole or one chapter. Carries revision and updatedAt: the server copy mirrors ' +
      'a book edited in the browser and may be older than what the author sees.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string', description: 'Book id from studio_list_books.' },
        chapterId: { type: 'string', description: 'Optional: one chapter instead of the whole book.' },
      },
      required: ['bookId'],
      additionalProperties: false,
    },
  },
];

export function studioToolDefinitions(): unknown[] {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export class StudioMcpServer {
  private readonly base: string;
  private readonly token: string;
  private readonly http: typeof fetch;
  private initialized = false;

  constructor(options: StudioMcpOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.http = options.fetchImpl || fetch;
  }

  /** Один рядок протоколу → рядок відповіді (або null для повідомлень без id). */
  async handleLine(line: string): Promise<string | null> {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (err) {
      return JSON.stringify(this.error(null, PARSE_ERROR, `parse error: ${(err as Error).message}`));
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return JSON.stringify(this.error(null, INVALID_REQUEST, 'message must be an object'));
    }
    const id = message.id;
    const method = typeof message.method === 'string' ? message.method : null;
    if (!method) {
      if ('result' in message || 'error' in message) return null;
      return JSON.stringify(this.error(id ?? null, INVALID_REQUEST, 'missing `method`'));
    }
    if (id === undefined) {
      if (method === 'notifications/initialized') this.initialized = true;
      return null;
    }
    try {
      const result = await this.request(method, (message.params as Record<string, unknown>) || {});
      return JSON.stringify({ jsonrpc: '2.0', id, result });
    } catch (err) {
      const e = err as { code?: number; message?: string };
      return JSON.stringify(this.error(id, e.code || INTERNAL_ERROR, e.message || 'internal error'));
    }
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  private error(id: unknown, code: number, message: string) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : STUDIO_MCP_PROTOCOL;
        return {
          protocolVersion: SUPPORTED.includes(asked) ? asked : STUDIO_MCP_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'nova-studio', title: 'Nova Studio', version: '1' },
          instructions: INSTRUCTIONS,
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: studioToolDefinitions() };
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : '';
        const args = (params.arguments as Record<string, unknown>) || {};
        return await this.callTool(name, args);
      }
      default:
        throw { code: METHOD_NOT_FOUND, message: `method not found: ${method}` };
    }
  }

  /** Відповідь інструмента: текстовий блок із JSON, як і в designcraft-mcp. */
  private ok(value: unknown) {
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: false };
  }

  /**
   * Помилка інструмента приходить РЕЗУЛЬТАТОМ з `isError`, а не помилкою
   * протоколу: модель мусить побачити текст і виправитись, а не впасти.
   */
  private toolError(message: string) {
    return { content: [{ type: 'text', text: message }], isError: true };
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const bookId = typeof args.bookId === 'string' ? args.bookId.trim() : '';
    switch (name) {
      case 'studio_me':
        return await this.get('/api/external/v1/me');
      case 'studio_list_books':
        return await this.get('/api/external/v1/books');
      case 'studio_list_chapters':
        if (!bookId) return this.toolError('`bookId` is required; get one from studio_list_books.');
        return await this.get(`/api/external/v1/books/${encodeURIComponent(bookId)}/chapters`);
      case 'studio_read_book': {
        if (!bookId) return this.toolError('`bookId` is required; get one from studio_list_books.');
        const chapterId = typeof args.chapterId === 'string' ? args.chapterId.trim() : '';
        const query = chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : '';
        return await this.get(`/api/external/v1/books/${encodeURIComponent(bookId)}/text${query}`);
      }
      default:
        throw { code: INVALID_PARAMS, message: `unknown tool: ${name}` };
    }
  }

  private async get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.http(`${this.base}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      });
    } catch (err) {
      // Мережа — стан, у якому агент може щось зробити (перепитати, сказати
      // авторові), а не збій протоколу.
      return this.toolError(`Nova Studio is unreachable at ${this.base}: ${(err as Error).message}`);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return this.toolError(`Nova Studio returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      const e = body as { error?: string; kind?: string } | null;
      // Токен у повідомлення НЕ потрапляє: він секрет автора.
      return this.toolError(
        `Nova Studio refused (HTTP ${res.status}${e?.kind ? `, ${e.kind}` : ''}): ${e?.error || text.slice(0, 300)}`
      );
    }
    return this.ok(body);
  }
}
