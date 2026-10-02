/**
 * Контрольні точки LangGraph у ядрі (Т5.4 В1; ТЗ Graph Studio §31).
 *
 * Збереж LangGraph у пам'яті (`MemorySaver`) + знімок потоку запуску в
 * `workflow_checkpoints` після кожного запису: пауза, продовження після
 * перезапуску сервера й відгалуження читають стан звідти. Потік LangGraph
 * (`thread_id`) = id запуску; відгалуження копіює потік батьківського запуску
 * під новим id (`copyThread`).
 */

import { MemorySaver } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { CoreRepository } from '../../types';

type Stored = [Uint8Array, Uint8Array, string | undefined];
type Writes = Record<string, [string, string, Uint8Array]>;

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const u8 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export interface ThreadSnapshot {
  storage: Record<string, Record<string, [string, string, string | null]>>;
  writes: Record<string, Record<string, [string, string, string]>>;
}

export class CoreCheckpointSaver extends MemorySaver {
  private loaded = new Set<string>();

  constructor(private readonly repo: CoreRepository) {
    super();
  }

  private threadOf(config: RunnableConfig): string | undefined {
    const t = config.configurable?.thread_id;
    return typeof t === 'string' ? t : undefined;
  }

  /** Підняти потік із бази (раз на екземпляр). */
  async ensureLoaded(threadId: string | undefined): Promise<void> {
    if (!threadId || this.loaded.has(threadId)) return;
    this.loaded.add(threadId);
    const snap = (await this.repo.getWorkflowCheckpoint(threadId)) as unknown as ThreadSnapshot | null;
    if (snap) this.restore(threadId, snap);
  }

  private restore(threadId: string, snap: ThreadSnapshot): void {
    const storage = (this.storage as Record<string, Record<string, Record<string, Stored>>>);
    storage[threadId] = Object.create(null);
    for (const [ns, cps] of Object.entries(snap.storage ?? {})) {
      storage[threadId][ns] = Object.create(null);
      for (const [id, [c, m, parent]] of Object.entries(cps)) storage[threadId][ns][id] = [u8(c), u8(m), parent ?? undefined];
    }
    const writes = this.writes as Record<string, Writes>;
    for (const [key, inner] of Object.entries(snap.writes ?? {})) {
      writes[key] = Object.create(null);
      for (const [ik, [task, channel, v]] of Object.entries(inner)) writes[key][ik] = [task, channel, u8(v)];
    }
  }

  /** Знімок потоку для бази. */
  snapshot(threadId: string): ThreadSnapshot {
    const storage = (this.storage as Record<string, Record<string, Record<string, Stored>>>)[threadId] ?? {};
    const out: ThreadSnapshot = { storage: {}, writes: {} };
    for (const [ns, cps] of Object.entries(storage)) {
      out.storage[ns] = {};
      for (const [id, [c, m, parent]] of Object.entries(cps)) out.storage[ns][id] = [b64(c), b64(m), parent ?? null];
    }
    for (const [key, inner] of Object.entries(this.writes as Record<string, Writes>)) {
      if (JSON.parse(key)[0] !== threadId) continue;
      out.writes[key] = {};
      for (const [ik, [task, channel, v]] of Object.entries(inner)) out.writes[key][ik] = [task, channel, b64(v)];
    }
    return out;
  }

  private async persist(threadId: string | undefined): Promise<void> {
    if (!threadId) return;
    await this.repo.saveWorkflowCheckpoint(threadId, this.snapshot(threadId) as unknown as Record<string, unknown>);
  }

  async getTuple(config: RunnableConfig) {
    await this.ensureLoaded(this.threadOf(config));
    return super.getTuple(config);
  }

  async *list(config: RunnableConfig, options?: Parameters<MemorySaver['list']>[1]) {
    await this.ensureLoaded(this.threadOf(config));
    yield* super.list(config, options);
  }

  async put(config: RunnableConfig, checkpoint: Parameters<MemorySaver['put']>[1], metadata: Parameters<MemorySaver['put']>[2]) {
    await this.ensureLoaded(this.threadOf(config));
    const r = await super.put(config, checkpoint, metadata);
    await this.persist(this.threadOf(config));
    return r;
  }

  async putWrites(config: RunnableConfig, writes: Parameters<MemorySaver['putWrites']>[1], taskId: string) {
    await this.ensureLoaded(this.threadOf(config));
    await super.putWrites(config, writes, taskId);
    await this.persist(this.threadOf(config));
  }

  /** Відгалуження (§31 FORK): потік `from` під новим id `to` (зі збереженням у базі). */
  async copyThread(from: string, to: string): Promise<void> {
    await this.ensureLoaded(from);
    const snap = this.snapshot(from);
    const renamed: ThreadSnapshot = { storage: snap.storage, writes: {} };
    for (const [key, inner] of Object.entries(snap.writes)) {
      const [, ns, id] = JSON.parse(key);
      renamed.writes[JSON.stringify([to, ns, id])] = inner;
    }
    this.loaded.add(to);
    this.restore(to, renamed);
    await this.persist(to);
  }
}
