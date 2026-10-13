import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { StoryDraft, StoryBlock, StoryRunSummary } from "../../../shared/labyrinthStory";
import type { GroupGuard } from "./groupStore";
import type { StoredBook } from "../../bookStore";
import { GROUP_TERMS } from "../../../shared/labyrinthGroup";
import { LabyrinthError, stateHash } from "./model";
import { assembleStory, rewriteInput, applyStoryRewrite, buildStoryBook, type StoryEvent, type StoryMaterial } from "./story";

const fail = (status: number, text: string): never => { throw new LabyrinthError(status, text); };
const uuid = (s: string) => { if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s)) fail(404, "Збірку або проходження не знайдено."); return s; };
const rev = (n: unknown) => { if (!Number.isSafeInteger(n) || Number(n) < 0) fail(422, "Вкажіть поточну ревізію."); return Number(n); };
const keyOf = (s: unknown) => { if (typeof s !== "string" || !s.trim() || s.length > 128) fail(422, "Вкажіть ідентифікатор запиту."); return s as string; };
const titleOf = (s: unknown) => { if (typeof s !== "string" || !s.trim() || s.length > 300) fail(422, "Введіть назву нової книги (до 300 символів)."); return (s as string).trim(); };
type Model = (input: string, signal: AbortSignal) => Promise<{ text: string; modelId: string; inputTokens?: number; outputTokens?: number; costUsd?: number }>;
export type StoryBookWriter = (book: Record<string, unknown>, ownerId: string, recheck: () => Promise<void>) => Promise<StoredBook>;
export class PgLabyrinthStoryStore {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try { await c.query("BEGIN"); const out = await fn(c); await c.query("COMMIT"); return out; }
    catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  private async material(c: PoolClient, p: string, id: string, guard: GroupGuard) {
    uuid(id);
    const bind = (await c.query("SELECT map_id,difficulty FROM labyrinth_runs WHERE project_id=$1 AND id=$2", [p, id])).rows[0];
    if (!bind || !["reader", "reader_group"].includes(bind.difficulty)) fail(404, "Читацьке проходження не знайдено.");
    const head = (await c.query("SELECT * FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR SHARE", [p, bind.map_id])).rows[0];
    const r = (await c.query(
      "SELECT r.*,COALESCE(g.publication_revision,s.publication_revision) AS publication_revision,g.status AS group_status,g.decision,g.rules AS group_rules,s.hero_id,e.scenes,e.book_revision,v.definition " +
      "FROM labyrinth_runs r LEFT JOIN labyrinth_groups g ON(g.project_id=r.project_id AND g.run_id=r.id) " +
      "LEFT JOIN labyrinth_reader_sessions s ON(s.project_id=r.project_id AND s.run_id=r.id) " +
      "JOIN labyrinth_reader_editions e ON(e.project_id=r.project_id AND e.map_id=r.map_id AND e.revision=COALESCE(g.publication_revision,s.publication_revision)) " +
      "JOIN labyrinth_versions v ON(v.project_id=r.project_id AND v.map_id=r.map_id AND v.revision=r.map_revision) " +
      "WHERE r.project_id=$1 AND r.id=$2 FOR SHARE OF r", [p, id])).rows[0];
    if (!r) fail(404, "Проходження не знайдено.");
    if (!head?.active || r.publication_revision <= head.revoked_through) fail(403, "Доступ до читацької версії відкликано.");
    const members = r.difficulty === "reader_group" ? (await c.query(
      "SELECT * FROM labyrinth_group_members WHERE project_id=$1 AND run_id=$2 FOR SHARE", [p, id])).rows : [];
    const heroes: string[] = r.difficulty === "reader" ? [r.hero_id] : r.group_rules.order.filter((id:string)=>members.some(m=>m.hero_id===id&&m.status==="active"));
    if (!heroes.length || (r.difficulty === "reader_group" && (r.group_status !== "finished" || r.decision)) ||
      heroes.some(h => !r.definition.exitNodeIds.includes(r.state.heroes[h]?.nodeId)))
      fail(409, "Спочатку завершіть проходження та всі спільні рішення.");
    let count = 0;
    const events = async (runId: string, until: number, depth = 0): Promise<StoryEvent[]> => {
      if (depth > 32) fail(422, "Занадто довгий ланцюг відновлень.");
      const rows = (await c.query("SELECT revision,event FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND revision<=$3 ORDER BY revision LIMIT 1501", [p, runId, until])).rows;
      count += rows.length; if (count > 1500) fail(422, "Журнал завеликий для однієї збірки.");
      const first = rows[0]?.event;
      let parents: StoryEvent[] = [];
      if (first?.sourceRunId) {
        uuid(first.sourceRunId); rev(first.sourceRevision);
        const parent = (await c.query(
          "SELECT r.map_id,r.map_revision,s.publication_revision,s.hero_id FROM labyrinth_runs r JOIN labyrinth_reader_sessions s ON(s.project_id=r.project_id AND s.run_id=r.id) WHERE r.project_id=$1 AND r.id=$2",
          [p, first.sourceRunId])).rows[0];
        if (!parent || parent.map_id !== r.map_id || parent.map_revision !== r.map_revision || parent.publication_revision !== r.publication_revision || parent.hero_id !== r.hero_id)
          fail(422, "Джерело відновлення не належить цьому проходженню.");
        parents = await events(first.sourceRunId, first.sourceRevision, depth + 1);
        if (!parents.length || stateHash(parents[parents.length - 1].event.state) !== stateHash(first.state)) fail(422, "Стан відновлення не відповідає джерелу.");
      }
      return [...parents, ...rows.map(v => ({ runId, revision: v.revision, event: v.event }))];
    };
    const journal = await events(id, r.revision);
    const messages = r.difficulty === "reader_group" ? (await c.query(
      "SELECT * FROM labyrinth_group_messages WHERE project_id=$1 AND run_id=$2 AND channel='contribution' AND consent_active ORDER BY source_revision,created_at,id FOR SHARE", [p, id])).rows : [];
    const contributions = [];
    for (const m of messages) {
      const member = members.find(x => x.hero_id === m.hero_id && x.user_id === m.user_id);
      if (member?.candidate && member.status === "active" && m.terms === GROUP_TERMS && await guard.canReadUser(m.user_id))
        contributions.push({ id: m.id, runId: id, sourceRevision: m.source_revision, heroId: m.hero_id, nodeId: m.node_id, text: m.text, aiAssisted: m.ai_assisted });
    }
    const historyHeroes=r.difficulty==="reader"?heroes:r.group_rules.order.filter((id:string)=>members.some(m=>m.hero_id===id&&m.status!=="invited"));
    const m: StoryMaterial = { runId: id, mapId: r.map_id, revision: r.revision, mapRevision: r.map_revision,
      bookRevision: r.book_revision, definition: r.definition, scenes: r.scenes, heroes:historyHeroes,finishedHeroIds:heroes,
      events: journal, contributions, finalState: r.state };
    const blocks = assembleStory(m);
    const sourceHash = stateHash({ runId: id, revision: r.revision, mapRevision: r.map_revision,
      bookRevision: r.book_revision, blocks: blocks.map(b => ({ id: b.id, text: b.text, source: b.source, aiAssisted: b.aiAssisted })) });
    return { m, blocks, sourceHash };
  }
  private async row(c: PoolClient, p: string, id: string, write = false) {
    uuid(id);
    const r = (await c.query("SELECT * FROM labyrinth_story_drafts WHERE project_id=$1 AND id=$2 FOR " + (write ? "UPDATE" : "SHARE"), [p, id])).rows[0];
    if (!r) fail(404, "Чернетку не знайдено."); return r;
  }
  private async fresh(c: PoolClient, p: string, id: string, guard: GroupGuard, write = false) {
    // Lock order is publication -> run -> draft, consistent with reader/group commands.
    uuid(id);
    const bind = (await c.query("SELECT run_id FROM labyrinth_story_drafts WHERE project_id=$1 AND id=$2", [p, id])).rows[0];
    if (!bind) fail(404, "Чернетку не знайдено.");
    const material = await this.material(c, p, bind.run_id, guard), r = await this.row(c, p, id, write);
    if (r.source_hash !== material.sourceHash) fail(409, "Проходження або згода на внесок змінилися. Зберіть нову чернетку.");
    await guard.recheck(); return { r, material };
  }
  private async view(c: PoolClient, r: any): Promise<StoryDraft> {
    const pending = (await c.query("SELECT 1 FROM labyrinth_story_requests WHERE project_id=$1 AND draft_id=$2 AND status='pending' AND operation='rewrite' AND created_at>=now()-interval '2 minutes'", [r.project_id, r.id])).rowCount;
    return { ...r.payload, id: r.id, revision: r.revision, status: r.status, title: r.title,
      newBookId: r.new_book_id, createdAt: new Date(r.created_at).toISOString(), generationPending: !!pending,
      legalAuthorship: false, publicationReady: false };
  }
  private async receipt(c: PoolClient, p: string, user: string, key: string, hash: string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["story:" + p + ":" + user + ":" + key]);
    const row = (await c.query("SELECT * FROM labyrinth_story_requests WHERE project_id=$1 AND user_id=$2 AND key=$3", [p, user, key])).rows[0];
    if (row && row.request_hash !== hash) fail(409, "Ідентифікатор належить іншій дії.");
    if (row && row.status !== "complete") fail(409, row.status === "pending" ? "Літературний запит ще виконується." : "Попередня спроба не завершилась. Для нової спроби підтвердьте новий запит.");
    return row;
  }
  private async record(c: PoolClient, p: string, id: string, user: string, key: string, hash: string, operation: string, status = "complete") {
    await c.query("INSERT INTO labyrinth_story_requests(project_id,user_id,key,draft_id,request_hash,operation,status) VALUES($1,$2,$3,$4,$5,$6,$7)", [p, user, key, id, hash, operation, status]);
  }
  private async save(c: PoolClient, r: any, payload: any, status = r.status, title = r.title, bookId = r.new_book_id) {
    const next = (await c.query("UPDATE labyrinth_story_drafts SET revision=revision+1,payload=$3,status=$4,title=$5,new_book_id=$6 WHERE project_id=$1 AND id=$2 RETURNING *",
      [r.project_id, r.id, JSON.stringify(payload), status, title, bookId])).rows[0];
    return this.view(c, next);
  }
  async list(p: string, mapId: string, guard: GroupGuard) {
    uuid(mapId);
    const rows = (await this.pool.query(
      "SELECT r.id,r.revision,r.difficulty,r.created_at,r.state,g.status,s.hero_id,v.definition " +
      "FROM labyrinth_runs r JOIN labyrinth_versions v ON(v.project_id=r.project_id AND v.map_id=r.map_id AND v.revision=r.map_revision) " +
      "LEFT JOIN labyrinth_groups g ON(g.project_id=r.project_id AND g.run_id=r.id) " +
      "LEFT JOIN labyrinth_reader_sessions s ON(s.project_id=r.project_id AND s.run_id=r.id) " +
      "JOIN labyrinth_reader_heads h ON(h.project_id=r.project_id AND h.map_id=r.map_id) " +
      "WHERE r.project_id=$1 AND r.map_id=$2 AND h.active AND COALESCE(g.publication_revision,s.publication_revision)>h.revoked_through AND r.difficulty IN ('reader','reader_group') ORDER BY r.created_at DESC LIMIT 100", [p, mapId])).rows;
    const runs: StoryRunSummary[] = rows.filter(r => r.difficulty === "reader_group" ? r.status === "finished" :
      r.definition.exitNodeIds.includes(r.state.heroes[r.hero_id]?.nodeId)).map(r => ({ id: r.id, revision: r.revision,
      kind: r.difficulty === "reader_group" ? "group" : "solo", createdAt: new Date(r.created_at).toISOString() }));
    const drafts = (await this.pool.query("SELECT id,title,revision,status,run_id,new_book_id FROM labyrinth_story_drafts WHERE project_id=$1 AND map_id=$2 ORDER BY created_at DESC LIMIT 100", [p, mapId])).rows
      .map(r => ({ id: r.id, title: r.title, revision: r.revision, status: r.status, runId: r.run_id, newBookId: r.new_book_id }));
    await guard.recheck(); return { runs, drafts };
  }
  async get(p: string, id: string, guard: GroupGuard) { return this.tx(async c => this.view(c, (await this.fresh(c, p, id, guard)).r)); }
  async create(p: string, runId: string, expected: unknown, title: unknown, user: string, key: unknown, guard: GroupGuard) {
    rev(expected); const k = keyOf(key), name = titleOf(title), hash = stateHash({ operation: "create", runId, expected, title: name });
    return this.tx(async c => {
      const receipt = await this.receipt(c, p, user, k, hash);
      if (receipt) return this.view(c, (await this.fresh(c, p, receipt.draft_id, guard)).r);
      const source = await this.material(c, p, runId, guard);
      if (source.m.revision !== expected) fail(409, "Проходження змінилось. Оновіть список.");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["story-source:" + p + ":" + runId + ":" + source.sourceHash]);
      let row = (await c.query("SELECT * FROM labyrinth_story_drafts WHERE project_id=$1 AND run_id=$2 AND source_hash=$3 AND title=$4", [p, runId, source.sourceHash, name])).rows[0];
      await guard.recheck();
      if (!row) {
        const payload = { runId, mapId: source.m.mapId, mapRevision: source.m.mapRevision, bookRevision: source.m.bookRevision,
          sourceRevision: source.m.revision, sourceHash: source.sourceHash, blocks: source.blocks, ai: null };
        row = (await c.query("INSERT INTO labyrinth_story_drafts(project_id,run_id,map_id,source_hash,title,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [p, runId, source.m.mapId, source.sourceHash, name, JSON.stringify(payload), user])).rows[0];
      } else if(row.status==="rejected") {
        row=(await c.query("UPDATE labyrinth_story_drafts SET status='draft',revision=revision+1,payload=$3 WHERE project_id=$1 AND id=$2 RETURNING *",
          [p,row.id,JSON.stringify({...row.payload,blocks:source.blocks,ai:null})])).rows[0];
      }
      await this.record(c, p, row.id, user, k, hash, "create"); return this.view(c, row);
    });
  }
  async edit(p: string, id: string, expected: unknown, title: unknown, edits: unknown, user: string, key: unknown, guard: GroupGuard) {
    rev(expected); const k = keyOf(key), name = titleOf(title), hash = stateHash({ operation: "edit", id, expected, title: name, edits });
    return this.tx(async c => {
      const receipt = await this.receipt(c, p, user, k, hash), { r } = await this.fresh(c, p, id, guard, true);
      if (receipt) return this.view(c, r);
      if (r.status !== "draft" || r.revision !== expected) fail(409, "Чернетка вже змінилася або завершена.");
      if (!Array.isArray(edits) || edits.length > r.payload.blocks.length) fail(422, "Некоректна редакція.");
      const map = new Map<string, string | null>();
      for (const e of edits as any[]) {
        const b = r.payload.blocks.find((b: StoryBlock) => b.id === e?.id);
        if (!e || Object.keys(e).length !== 2 || !b || !["fact", "scene"].includes(b.kind) || map.has(e.id) ||
          (e.text !== null && (typeof e.text !== "string" || !e.text.trim() || e.text.length > 16000))) fail(422, "Факти, фінал і погоджений оригінал внеску не переписуються. Редагуйте літературну пропозицію.");
        map.set(e.id, e.text === null ? null : e.text.trim());
      }
      const payload = { ...r.payload, blocks: r.payload.blocks.map((b: StoryBlock) => map.has(b.id) ?
        { ...b, aiAssisted: b.aiAssisted || b.proposalOrigin === "ai", proposal: map.get(b.id)!, proposalOrigin: map.get(b.id) === null ? null : "author" } : b) };
      if (Buffer.byteLength(JSON.stringify(payload)) > 4 * 1024 * 1024) fail(422, "Редакція завелика.");
      const result = await this.save(c, r, payload, "draft", name);
      await this.record(c, p, id, user, k, hash, "edit"); return result;
    });
  }
  async reject(p: string, id: string, expected: unknown, user: string, key: unknown, guard: GroupGuard) {
    rev(expected); const k = keyOf(key), hash = stateHash({ operation: "reject", id, expected });
    return this.tx(async c => {
      const receipt = await this.receipt(c, p, user, k, hash), { r } = await this.fresh(c, p, id, guard, true);
      if (receipt) return this.view(c, r);
      if (r.status !== "draft" || r.revision !== expected) fail(409, "Чернетка вже змінилася або завершена.");
      const out = await this.save(c, r, r.payload, "rejected"); await this.record(c, p, id, user, k, hash, "reject"); return out;
    });
  }
  async rewrite(p: string, id: string, expected: unknown, user: string, key: unknown, guard: GroupGuard,
    recheckAi: () => Promise<void>, model: Model) {
    rev(expected); const k = keyOf(key), hash = stateHash({ operation: "rewrite", id, expected });
    const prepared = await this.tx(async c => {
      await c.query("UPDATE labyrinth_story_requests SET status='failed' WHERE project_id=$1 AND draft_id=$2 AND operation='rewrite' AND status='pending' AND created_at<now()-interval '2 minutes'", [p, uuid(id)]);
      const receipt = await this.receipt(c, p, user, k, hash), { r } = await this.fresh(c, p, id, guard, true);
      if (receipt) return { done: await this.view(c, r) };
      if (r.status !== "draft" || r.revision !== expected) fail(409, "Чернетка вже змінилась або завершена.");
      if ((await c.query("SELECT 1 FROM labyrinth_story_requests WHERE project_id=$1 AND draft_id=$2 AND status='pending' AND operation='rewrite'", [p, id])).rowCount)
        fail(409, "Для цієї чернетки вже виконується літературний запит.");
      await recheckAi(); const input = rewriteInput(r.payload.blocks);
      await this.record(c, p, id, user, k, hash, "rewrite", "pending"); return { input, blocks: r.payload.blocks as StoryBlock[] };
    });
    if (prepared.done) return prepared.done;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await guard.recheck(); await recheckAi();
      const generated = await Promise.race([model(prepared.input!, controller.signal), new Promise<never>((_ok, bad) => {
        timer = setTimeout(() => { controller.abort(); bad(new LabyrinthError(504, "Літературний запит не завершився вчасно.")); }, 60000);
      })]);
      const blocks = applyStoryRewrite(prepared.blocks!, generated.text);
      return await this.tx(async c => {
        const { r } = await this.fresh(c, p, id, guard, true); await recheckAi();
        if (r.status !== "draft" || r.revision !== expected) fail(409, "Поки ШІ відповідав, чернетку змінили. Пізню відповідь не записано.");
        const pending = (await c.query("SELECT status FROM labyrinth_story_requests WHERE project_id=$1 AND user_id=$2 AND key=$3", [p, user, k])).rows[0];
        if (pending?.status !== "pending") fail(409, "Запит уже завершений або скасований.");
        await c.query("UPDATE labyrinth_story_requests SET status='complete' WHERE project_id=$1 AND user_id=$2 AND key=$3", [p, user, k]);
        return this.save(c, r, { ...r.payload, blocks, ai: { modelId: generated.modelId, generatedAt: new Date().toISOString(),
          inputTokens: generated.inputTokens ?? 0, outputTokens: generated.outputTokens ?? 0, costUsd: generated.costUsd ?? 0 } });
      });
    } catch (e) {
      await this.pool.query("UPDATE labyrinth_story_requests SET status='failed' WHERE project_id=$1 AND user_id=$2 AND key=$3 AND status='pending'", [p, user, k]);
      if (e instanceof LabyrinthError) throw e;
      throw new LabyrinthError(502, "Літературна редакція ШІ недоступна. Факти збережені; можна редагувати вручну або підтвердити нову спробу.");
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  async accept(p: string, id: string, expected: unknown, user: string, key: unknown, guard: GroupGuard,
    writeBook: StoryBookWriter, readBook: (id: string) => Promise<StoredBook | null>) {
    rev(expected); const k = keyOf(key), hash = stateHash({ operation: "accept", id, expected });
    return this.tx(async c => {
      const receipt = await this.receipt(c, p, user, k, hash), { r } = await this.fresh(c, p, id, guard, true);
      if (receipt) return this.view(c, r);
      if (r.status !== "draft" || r.revision !== expected) fail(409, "Чернетка вже змінилася або завершена.");
      if ((await this.view(c, r)).generationPending) fail(409, "Спочатку дочекайтеся літературної пропозиції.");
      const owner = (await c.query("SELECT owner_id FROM projects WHERE id=$1", [p])).rows[0]?.owner_id;
      if (!owner) fail(409, "У книги має бути визначений власник.");
      const sourceBook = await readBook(p);
      const book = buildStoryBook(await this.view(c, r), String(sourceBook?.book.author || "Автор книги"));
      book.labyrinthStory.sourceProjectId = p;
      const existing = await readBook(book.id);
      if (existing) {
        const provenance = existing.book.labyrinthStory as any;
        if (existing.ownerId !== owner || provenance?.draftId !== id || provenance.sourceHash !== r.source_hash || provenance.reviewHash!==book.labyrinthStory.reviewHash)
          fail(409, "Ідентифікатор нової книги вже зайнятий.");
      } else await writeBook(book as unknown as Record<string, unknown>, owner, async()=>{
        const latest=await this.material(c,p,r.run_id,guard);
        if(latest.sourceHash!==r.source_hash)fail(409,"Згода або доступ до внеску змінилися перед записом книги.");
        await guard.recheck();
      });
      // Deterministic target id recovers a completed SQLite/JSON write after a Core commit failure.
      await this.record(c, p, id, user, k, hash, "accept");
      return this.save(c, r, r.payload, "accepted", r.title, book.id);
    });
  }
}
