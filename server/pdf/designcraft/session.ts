/**
 * Жива сесія DesignCraft: один процес на весь рендер замість процесу на крок.
 *
 * ЧОМУ. Рушій V3 запускає `designcraft-cli script` на кожен крок конвеєра:
 * autoflow, ~log₂(сторінок) проб бінарного пошуку, до трьох проходів
 * ілюстрацій, фінальний прохід. Для книги на 300 сторінок це ≈12–14 запусків
 * процесу, і кожен ПОВТОРНО читає документ із диска, перекомпоновує його й
 * пише новий файл. Проміжні `.designcraft` існують лише тому, що наступний
 * процес не має пам'яті.
 *
 * `designcraft-cli mcp` — єдина наявна довгоживуча headless-сесія: він тримає
 * in-process `designcraft_engine::Session` і говорить JSON-RPC 2.0 рядками по
 * stdin/stdout. Тут він використовується НЕ як канал для моделі, а як
 * машинний транспорт: інструмент `execute` пропускає будь-яку команду рушія,
 * `batch` — список команд, і звіт `batch` має ТОЧНО ту саму форму, що звіт
 * `script` (`{completed, results, failedIndex, failedCommand, error}`), тож
 * обробка результатів переноситься з V3 один в один.
 *
 * ЩО ЦЕ НЕ Є. Остаточною формою міст не стає: правильний транспорт —
 * headless control-канал у самому DesignCraft (`serve --control PORT`,
 * ~50 рядків Rust поверх `crates/mcp/src/headless.rs`), після якого наявні
 * `.dcs`-скрипти працюють через `--connect` без змін. Деталі й порядок робіт
 * — у `PLAN_DESIGNCRAFT_BRIDGE.md`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { DesigncraftCommand } from './commands';

/** Версія протоколу MCP, яку реалізує designcraft-mcp. */
const PROTOCOL_VERSION = '2025-06-18';

/** Звіт `batch` / `script`: та сама форма в обох транспортах. */
export interface DesigncraftReport {
  completed?: number;
  results?: unknown[];
  failedIndex?: number | null;
  failedCommand?: string | null;
  error?: string | null;
}

export interface DesigncraftSessionOptions {
  cliPath: string;
  timeoutMs: number;
  /** Межа на одну відповідь: story.get на справжній книзі дає сотні КБ. */
  maxResponseChars: number;
}

/**
 * Помилка кроку в сесії. Несе розібраний звіт, щоб рушій формулював ті самі
 * повідомлення, що й для `script`.
 */
export class DesigncraftSessionError extends Error {
  constructor(
    message: string,
    readonly report: DesigncraftReport | null,
    readonly kind: 'tool' | 'protocol' | 'timeout' | 'exit' = 'tool'
  ) {
    super(message);
    this.name = 'DesigncraftSessionError';
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

export class DesigncraftSession {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private stderr = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;
  private exitReason: string | null = null;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    private readonly options: DesigncraftSessionOptions
  ) {
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      // stderr — лише логи сервера; тримаємо хвіст для діагностики.
      this.stderr = (this.stderr + chunk).slice(-8000);
    });
    child.on('error', (err) => this.die(`процес не запустився: ${err.message}`));
    child.on('close', (code) => this.die(`процес завершився з кодом ${String(code)}`));
  }

  /** Запустити сесію й пройти рукостискання MCP. */
  static async start(options: DesigncraftSessionOptions): Promise<DesigncraftSession> {
    const child = spawn(options.cliPath, ['mcp'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    const session = new DesigncraftSession(child, options);
    await session.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'nova-studio', version: '1' },
    });
    session.notify('notifications/initialized');
    return session;
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > this.options.maxResponseChars) {
      this.die(`відповідь перевищила ${this.options.maxResponseChars} символів`);
      return;
    }
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.onMessage(line);
      index = this.buffer.indexOf('\n');
    }
  }

  private onMessage(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(line);
    } catch {
      // Сервер пише логи в stderr, тож нерозбірний рядок у stdout — поломка протоколу.
      this.die(`нерозбірний рядок у stdout: ${line.slice(0, 200)}`);
      return;
    }
    const id = typeof message.id === 'number' ? message.id : null;
    if (id === null) return; // повідомлення без id нас не стосуються
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new DesigncraftSessionError(
          `JSON-RPC: ${message.error.message || 'без повідомлення'}`,
          null,
          'protocol'
        )
      );
      return;
    }
    pending.resolve(message.result);
  }

  /** Процес або протокол зламалися: усі незавершені запити падають з однією причиною. */
  private die(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.exitReason = reason;
    const detail = this.stderr.trim() ? ` stderr: ${this.stderr.trim().slice(-600)}` : '';
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new DesigncraftSessionError(`DesignCraft: ${reason}.${detail}`, null, 'exit'));
    }
    this.pending.clear();
    this.child.kill('SIGKILL');
  }

  private notify(method: string): void {
    if (this.closed) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new DesigncraftSessionError(
          `DesignCraft: сесія вже закрита (${this.exitReason || 'без причини'}).`,
          null,
          'exit'
        )
      );
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.die(`крок не відповів за ${this.options.timeoutMs} мс`);
        reject(
          new DesigncraftSessionError(
            `DesignCraft не відповів за ${this.options.timeoutMs} мс (${method}).`,
            null,
            'timeout'
          )
        );
      }, this.options.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /**
   * Викликати інструмент і розпакувати відповідь. MCP віддає результат як
   * текстовий блок, усередині якого JSON; `isError` означає, що крок не
   * вдався, і тоді в тому самому тексті лежить звіт зі `failedIndex`.
   */
  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const raw = (await this.request('tools/call', { name, arguments: args })) as {
      content?: { type?: string; text?: string }[];
      isError?: boolean;
    };
    const text = raw?.content?.find((part) => part?.type === 'text')?.text ?? '';
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.slice(0, 2000) };
      }
    }
    if (raw?.isError) {
      const report = (payload || {}) as DesigncraftReport;
      const step =
        report.failedIndex === undefined || report.failedIndex === null
          ? ''
          : `Крок ${report.failedIndex}${report.failedCommand ? ` (${report.failedCommand})` : ''}: `;
      throw new DesigncraftSessionError(
        `${step}${String(report.error || text.slice(0, 500) || 'невідома помилка')}`,
        report,
        'tool'
      );
    }
    return payload;
  }

  /** Список команд у порядку; звіт тієї ж форми, що й у `script`. */
  async batch(commands: readonly DesigncraftCommand[]): Promise<DesigncraftReport> {
    return (await this.callTool('batch', {
      commands: commands.map((c) => ({ command: c.command, params: c.params || {} })),
    })) as DesigncraftReport;
  }

  /** Одна команда рушія; повертає її власний результат, не звіт. */
  async execute(command: string, params: Record<string, unknown> = {}): Promise<any> {
    return await this.callTool('execute', { command, params });
  }

  /** Закрити сесію. Безпечно викликати двічі — тому стоїть у `finally`. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.exitReason = 'закрито рушієм';
    for (const [, pending] of this.pending) clearTimeout(pending.timer);
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill();
  }
}
