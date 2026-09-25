/**
 * Рантайм агентів (`AgentRuntime`) для прототипу FLC етапу 0 (Т1.6).
 *
 * Рішення Н1–Н2 (звіт прототипу, журнал #257): DeepSeek Harness (`dsh`
 * 0.1.5-rc.3, developer preview, «core plugins and APIs will continue to
 * evolve») у MVP напряму не йде. Натомість — цей тонкий рантайм із тим самим
 * договором, який потім може реалізувати адаптер Harness:
 *   • агент бачить лише ЗАРЕЄСТРОВАНІ серверні tools зі свого списку — ні
 *     файлової системи, ні оболонки, ні мережі (ТЗ-H §7.3);
 *   • кожен виклик tool — з project_id / actor_id / character_id сесії, агент
 *     їх не підмінить;
 *   • таймаут на крок і ліміт викликів;
 *   • журнал подій лише на дописування («model-visible means logged»), з
 *     часом кожного кроку.
 */

export interface RuntimeScope {
  projectId: string;
  actorId: string;
  characterId: string;
  simulationId: string;
}

export interface AgentTool<A = any, R = any> {
  name: string;
  description: string;
  run(args: A, scope: RuntimeScope, signal: AbortSignal): Promise<R>;
}

export interface TraceEvent {
  seq: number;
  at: string;
  agent: string;
  kind: 'step_start' | 'tool_call' | 'tool_result' | 'tool_denied' | 'step_end' | 'step_error';
  tool?: string;
  ms?: number;
  detail?: string;
}

export class ToolDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolDeniedError';
  }
}

export interface AgentContext {
  scope: Readonly<RuntimeScope>;
  signal: AbortSignal;
  tool<R = unknown>(name: string, args?: unknown): Promise<R>;
}

export interface AgentRuntime {
  readonly name: string;
  /** Запустити крок агента: `run` бачить лише tools зі списку `allow`. */
  step<R>(agent: string, allow: string[], run: (ctx: AgentContext) => Promise<R>, opts?: { timeoutMs?: number; maxToolCalls?: number }): Promise<R>;
  readonly trace: readonly TraceEvent[];
}

export class InProcessAgentRuntime implements AgentRuntime {
  readonly name = 'in-process';
  private readonly events: TraceEvent[] = [];
  private readonly tools = new Map<string, AgentTool>();

  constructor(private readonly scope: RuntimeScope, tools: AgentTool[]) {
    for (const t of tools) this.tools.set(t.name, t);
    Object.freeze(this.scope);
  }

  get trace(): readonly TraceEvent[] {
    return this.events.slice();
  }

  private log(e: Omit<TraceEvent, 'seq' | 'at'>) {
    this.events.push({ seq: this.events.length + 1, at: new Date().toISOString(), ...e });
  }

  async step<R>(agent: string, allow: string[], run: (ctx: AgentContext) => Promise<R>, opts: { timeoutMs?: number; maxToolCalls?: number } = {}): Promise<R> {
    const started = Date.now();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const maxCalls = opts.maxToolCalls ?? 8;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Крок «${agent}» перевищив ${timeoutMs} мс`)), timeoutMs);
    let calls = 0;
    const allowed = new Set(allow);
    const ctx: AgentContext = {
      scope: this.scope,
      signal: controller.signal,
      tool: async <T>(name: string, args?: unknown): Promise<T> => {
        const tool = this.tools.get(name);
        if (!tool || !allowed.has(name)) {
          this.log({ agent, kind: 'tool_denied', tool: name, detail: tool ? 'не дозволено цьому агенту' : 'такого tool немає' });
          throw new ToolDeniedError(`Tool «${name}» недоступний агенту «${agent}»`);
        }
        if (++calls > maxCalls) {
          this.log({ agent, kind: 'tool_denied', tool: name, detail: `ліміт викликів ${maxCalls}` });
          throw new ToolDeniedError(`Агент «${agent}» вичерпав ліміт викликів tools (${maxCalls})`);
        }
        controller.signal.throwIfAborted();
        const t0 = Date.now();
        this.log({ agent, kind: 'tool_call', tool: name });
        const out = (await tool.run(args, this.scope, controller.signal)) as T;
        this.log({ agent, kind: 'tool_result', tool: name, ms: Date.now() - t0 });
        return out;
      },
    };
    this.log({ agent, kind: 'step_start' });
    try {
      const result = await Promise.race([
        run(ctx),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
      ]);
      this.log({ agent, kind: 'step_end', ms: Date.now() - started });
      return result;
    } catch (err) {
      this.log({ agent, kind: 'step_error', ms: Date.now() - started, detail: (err as Error).message });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
