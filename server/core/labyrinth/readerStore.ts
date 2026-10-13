import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { LabyrinthDefinition, LabyrinthRun, LabyrinthRunState } from "../../../shared/labyrinth";
import type { ReaderEdition, ReaderPublication, ReaderScene, ReaderSessionSummary, ReaderView } from "../../../shared/labyrinthReader";
import { headingFromEvents, type Heading } from "../../../shared/labyrinthNarration";
import { LabyrinthError, stateHash } from "./model";
import { runtimeInitialState, runtimeAction } from "./runtime";
import { directLabyrinth } from "./director";
import { readerAction, readerProjection, readerWorld } from "./reader";

const uuid = (s: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s))
    throw new LabyrinthError(404, "Проходження або карту не знайдено.");
  return s;
};
const rev = (n: unknown) => {
  if (!Number.isSafeInteger(n) || Number(n) < 0) throw new LabyrinthError(422, "Вкажіть поточну ревізію.");
  return Number(n);
};
const keyOf = (s: unknown) => {
  if (typeof s !== "string" || !s.trim() || s.length > 128)
    throw new LabyrinthError(422, "Вкажіть ідентифікатор запиту.");
  return s;
};
const iso = (d: Date | string) => new Date(d).toISOString();
const toRun = (r: any): LabyrinthRun => ({
  id: r.id, projectId: r.project_id, mapId: r.map_id, mapRevision: r.map_revision,
  revision: r.revision, seed: r.seed, difficulty: "reader", mode: "runtime",
  participants: r.participants, state: r.state, createdBy: r.created_by, createdAt: iso(r.created_at),
});
type Recheck = () => Promise<void>;
const noRecheck: Recheck = async () => {};
/** Same Core pool; distinct release/session boundary. Full runtime state never leaves this store. */
export class PgLabyrinthReaderStore {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  }
  async publication(p: string, mapId: string): Promise<ReaderPublication> {
    uuid(mapId);
    const { rows } = await this.pool.query(
      "SELECT h.*,e.map_revision,e.book_revision,e.hero_ids FROM labyrinth_maps m LEFT JOIN labyrinth_reader_heads h ON(h.project_id=m.project_id AND h.map_id=m.id) LEFT JOIN labyrinth_reader_editions e ON(e.project_id=h.project_id AND e.map_id=h.map_id AND e.revision=h.revision) WHERE m.project_id=$1 AND m.id=$2",
      [p, mapId],
    );
    if (!rows.length) throw new LabyrinthError(404, "Карту не знайдено.");
    const r = rows[0];
    return { revision: r.revision ?? 0, active: r.active ?? false, mapRevision: r.map_revision ?? null,
      bookRevision: r.book_revision ?? null, heroIds: r.hero_ids ?? [] };
  }
  async publish(p: string, mapId: string, expected: unknown, mapRevision: unknown,
    heroIds: unknown, actor: string, recheck: Recheck = noRecheck): Promise<ReaderPublication> {
    uuid(mapId); rev(expected); rev(mapRevision);
    if (!Array.isArray(heroIds) || !heroIds.length || heroIds.length > 12 ||
      new Set(heroIds).size !== heroIds.length || heroIds.some((x) => typeof x !== "string"))
      throw new LabyrinthError(422, "Виберіть від одного до дванадцяти героїв для читання.");
    return this.tx(async (c) => {
      await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const versions = await c.query(
        "SELECT definition FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=$3",
        [p, mapId, mapRevision],
      );
      if (!versions.rows.length) throw new LabyrinthError(404, "Збережену версію не знайдено.");
      const d = versions.rows[0].definition as LabyrinthDefinition;
      // Every offered hero must start a provably traversable solo edition.
      for (const heroId of heroIds) runtimeInitialState(readerWorld(d, heroId));
      const project = await c.query("SELECT revision FROM projects WHERE id=$1 FOR SHARE", [p]);
      const ids = [...new Set(d.nodes.flatMap((n) => n.sceneId ? [n.sceneId] : []))];
      const docs = await c.query(
        "SELECT id,title FROM documents WHERE project_id=$1 AND id=ANY($2::text[]) AND kind='section' AND deleted_at IS NULL", [p, ids],
      );
      if (docs.rows.length !== ids.length) throw new LabyrinthError(422, "Прив'язана сцена більше недоступна. Оновіть карту.");
      const paragraphs = await c.query(
        "SELECT document_id,kind,text FROM paragraphs WHERE project_id=$1 AND document_id=ANY($2::text[]) AND deleted_at IS NULL AND kind IN ('paragraph','heading','blockquote') ORDER BY document_id,ord,id",
        [p, ids],
      );
      const scenes: Record<string, ReaderScene> = {};
      for (const node of d.nodes) {
        const document = docs.rows.find((r) => r.id === node.sceneId);
        scenes[node.id] = {
          title: document?.title ?? node.title,
          paragraphs: [
            ...(node.description ? [{ kind: "paragraph" as const, text: node.description }] : []),
            ...paragraphs.rows.filter((r) => r.document_id === node.sceneId).map((r) => ({ kind: r.kind, text: r.text })),
          ],
        };
      }
      const snapshot = JSON.stringify(scenes);
      if (Buffer.byteLength(snapshot) > 8 * 1024 * 1024)
        throw new LabyrinthError(422, "Текст доступної версії перевищує 8 МБ. Розділіть книгу на окремі карти.");
      await c.query(
        "INSERT INTO labyrinth_reader_heads(project_id,map_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [p, mapId],
      );
      const head = (await c.query(
        "SELECT * FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR UPDATE", [p, mapId],
      )).rows[0];
      if (head.revision !== expected) throw new LabyrinthError(409, "Доступну версію вже змінено. Оновіть стан.");
      const revision = head.revision + 1;
      await recheck();
      await c.query(
        "INSERT INTO labyrinth_reader_editions(project_id,map_id,revision,map_revision,book_revision,hero_ids,scenes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [p, mapId, revision, mapRevision, project.rows[0].revision, JSON.stringify(heroIds), snapshot, actor],
      );
      await c.query("UPDATE labyrinth_reader_heads SET revision=$3,active=true WHERE project_id=$1 AND map_id=$2", [p, mapId, revision]);
      return { revision, active: true, mapRevision: Number(mapRevision), bookRevision: project.rows[0].revision, heroIds: heroIds as string[] };
    });
  }
  async withdraw(p: string, mapId: string, expected: unknown, recheck: Recheck = noRecheck): Promise<ReaderPublication> {
    uuid(mapId); rev(expected);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR UPDATE", [p, mapId],
      );
      if (!rows.length) throw new LabyrinthError(404, "Версію ще не відкрито читачам.");
      if (rows[0].revision !== expected) throw new LabyrinthError(409, "Доступну версію вже змінено.");
      await recheck();
      const revision = rows[0].revision + 1;
      await c.query("UPDATE labyrinth_reader_heads SET revision=$3,active=false,revoked_through=$3 WHERE project_id=$1 AND map_id=$2",
        [p, mapId, revision]);
      return { revision, active: false, mapRevision: null, bookRevision: null, heroIds: [] };
    });
  }
  async library(p: string, userId: string): Promise<{ editions: ReaderEdition[]; sessions: ReaderSessionSummary[] }> {
    const editions = await this.pool.query(
      "SELECT e.*,v.definition FROM labyrinth_reader_heads h JOIN labyrinth_reader_editions e USING(project_id,map_id,revision) JOIN labyrinth_versions v ON(v.project_id=e.project_id AND v.map_id=e.map_id AND v.revision=e.map_revision) WHERE h.project_id=$1 AND h.active ORDER BY e.created_at DESC LIMIT 100", [p],
    );
    const sessions = await this.pool.query(
      "SELECT r.id,r.map_id,r.map_revision,r.revision,r.state->>'turn' AS turn,r.state->>'storyTime' AS story_time,r.created_at,v.definition,s.hero_id FROM labyrinth_reader_sessions s JOIN labyrinth_reader_heads h USING(project_id,map_id) JOIN labyrinth_runs r ON(r.project_id=s.project_id AND r.id=s.run_id) JOIN labyrinth_versions v ON(v.project_id=r.project_id AND v.map_id=r.map_id AND v.revision=r.map_revision) WHERE s.project_id=$1 AND s.user_id=$2 AND h.active AND s.publication_revision>h.revoked_through ORDER BY r.created_at DESC,r.id LIMIT 100", [p, userId],
    );
    return {
      editions: editions.rows.map((e) => ({
        mapId: e.map_id, publicationRevision: e.revision, mapRevision: e.map_revision, bookRevision: e.book_revision,
        title: e.definition.title, heroes: e.definition.heroes.filter((h: any) => e.hero_ids.includes(h.id)).map((h: any) => ({ id: h.id, name: h.name })),
      })),
      sessions: sessions.rows.map((r) => ({
        id: r.id, mapId: r.map_id, mapRevision: r.map_revision, revision: r.revision,
        title: r.definition.title, heroName: r.definition.heroes.find((h: any) => h.id === r.hero_id)?.name ?? "",
        turn: Number(r.turn), storyTime: Number(r.story_time), createdAt: iso(r.created_at),
      })),
    };
  }
  private async session(c: PoolClient, p: string, id: string, userId: string, write = false) {
    uuid(id);
    const bind = (await c.query("SELECT map_id FROM labyrinth_reader_sessions WHERE project_id=$1 AND run_id=$2 AND user_id=$3", [p, id, userId])).rows[0];
    if (!bind) throw new LabyrinthError(404, "Ваше проходження не знайдено.");
    // Same lock order for start/action/restore/withdraw: publication, then run.
    const head = (await c.query("SELECT * FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR SHARE", [p, bind.map_id])).rows[0];
    const r = (await c.query(
      "SELECT r.*,s.hero_id,s.visited,s.heading,s.publication_revision,e.scenes,e.book_revision,v.definition FROM labyrinth_reader_sessions s JOIN labyrinth_runs r ON(r.project_id=s.project_id AND r.id=s.run_id) JOIN labyrinth_reader_editions e ON(e.project_id=s.project_id AND e.map_id=s.map_id AND e.revision=s.publication_revision) JOIN labyrinth_versions v ON(v.project_id=r.project_id AND v.map_id=r.map_id AND v.revision=r.map_revision) WHERE s.project_id=$1 AND s.run_id=$2 AND s.user_id=$3 FOR " + (write ? "UPDATE" : "SHARE") + " OF r,s",
      [p, id, userId],
    )).rows[0];
    if (!r) throw new LabyrinthError(404, "Ваше проходження не знайдено.");
    if (!head?.active || r.publication_revision <= head.revoked_through)
      throw new LabyrinthError(403, "Автор відкликав доступ до цієї версії.");
    return r;
  }
  private async view(c: PoolClient, p: string, r: any): Promise<ReaderView> {
    const { rows } = await c.query(
      "SELECT revision,event->'state'->>'turn' AS turn,event->'state'->>'storyTime' AS story_time,event->'reader'->>'label' AS label FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 ORDER BY revision DESC LIMIT 100", [p, r.id],
    );
    return {
      id: r.id, revision: r.revision, mapRevision: r.map_revision, bookRevision: r.book_revision,
      title: r.definition.title, turn: r.state.turn, storyTime: r.state.storyTime,
      ...readerProjection(r.definition, r.state, r.hero_id, r.visited, r.heading, r.scenes),
      checkpoints: rows.map((e) => ({ revision: e.revision, turn: Number(e.turn), storyTime: Number(e.story_time), label: e.label ?? "Збережений хід" })),
    };
  }
  async get(p: string, id: string, userId: string): Promise<ReaderView> {
    return this.tx(async (c) => this.view(c, p, await this.session(c, p, id, userId)));
  }
  private async request(c: PoolClient, p: string, userId: string, key: string, hash: string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["reader:" + p + ":" + userId + ":" + key]);
    const receipt = (await c.query("SELECT * FROM labyrinth_reader_requests WHERE project_id=$1 AND user_id=$2 AND key=$3", [p, userId, key])).rows[0];
    if (receipt && receipt.request_hash !== hash) throw new LabyrinthError(409, "Цей ідентифікатор уже використаний для іншого запиту.");
    return receipt;
  }
  private async insert(c: PoolClient, p: string, mapId: string, edition: any,
    heroId: string, userId: string, state: LabyrinthRunState, visited: string[], heading: Heading,
    seed: string, source?: { id: string; revision: number }) {
    const actor = "user:" + userId;
    const r = (await c.query(
      "INSERT INTO labyrinth_runs(project_id,map_id,map_revision,seed,state,created_by,participants,mode,difficulty) VALUES($1,$2,$3,$4,$5,$6,$7,'runtime','reader') RETURNING *",
      [p, mapId, edition.map_revision, seed, JSON.stringify(state), actor, JSON.stringify([{ userId, heroIds: [heroId] }])],
    )).rows[0];
    await c.query("INSERT INTO labyrinth_reader_sessions(project_id,run_id,user_id,map_id,publication_revision,hero_id,visited,heading) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [p, r.id, userId, mapId, edition.revision, heroId, JSON.stringify(visited), heading]);
    const label = edition.definition.nodes.find((n: any) => n.id === state.heroes[heroId].nodeId)?.title ?? "";
    await c.query("INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,0,$3)",
      [p, r.id, JSON.stringify({ kind: source ? "restored" : "created", actor, mapRevision: edition.map_revision,
        ...(source ? { sourceRunId: source.id, sourceRevision: source.revision } : {}), state, afterHash: stateHash(state),
        reader: { visited, heading, label } })]);
    return { ...r, hero_id: heroId, visited, heading, scenes: edition.scenes, book_revision: edition.book_revision, definition: edition.definition };
  }
  async start(p: string, mapId: string, publicationRevision: unknown, heroId: unknown,
    userId: string, key: unknown, recheck: Recheck = noRecheck): Promise<ReaderView> {
    uuid(mapId); rev(publicationRevision); keyOf(key);
    if (typeof heroId !== "string") throw new LabyrinthError(422, "Виберіть героя.");
    const hash = stateHash({ kind: "start", mapId, publicationRevision, heroId });
    return this.tx(async (c) => {
      const receipt = await this.request(c, p, userId, key as string, hash);
      if (receipt) return this.view(c, p, await this.session(c, p, receipt.run_id, userId));
      const head = (await c.query("SELECT * FROM labyrinth_reader_heads WHERE project_id=$1 AND map_id=$2 FOR SHARE", [p, mapId])).rows[0];
      if (!head?.active) throw new LabyrinthError(403, "Автор ще не відкрив читання цієї карти.");
      if (head.revision !== publicationRevision) throw new LabyrinthError(409, "Доступна версія змінилась. Оновіть бібліотеку.");
      const edition = (await c.query(
        "SELECT e.*,v.definition FROM labyrinth_reader_editions e JOIN labyrinth_versions v ON(v.project_id=e.project_id AND v.map_id=e.map_id AND v.revision=e.map_revision) WHERE e.project_id=$1 AND e.map_id=$2 AND e.revision=$3",
        [p, mapId, publicationRevision],
      )).rows[0];
      if (!edition.hero_ids.includes(heroId)) throw new LabyrinthError(403, "Цей герой не відкритий для читання.");
      const d = readerWorld(edition.definition, heroId);
      let state = runtimeInitialState(d);
      const seed = randomUUID();
      if (d.director?.enabled) {
        const provisional: LabyrinthRun = { id: "", projectId: p, mapId, mapRevision: edition.map_revision, revision: 0,
          seed, difficulty: "reader", mode: "runtime", participants: [], state, createdBy: "user:" + userId, createdAt: new Date().toISOString() };
        state = (await directLabyrinth(d, provisional, false)).state;
      }
      await recheck();
      const r = await this.insert(c, p, mapId, edition, heroId, userId, state, [state.heroes[heroId].nodeId], "north", seed);
      await c.query("INSERT INTO labyrinth_reader_requests(project_id,user_id,key,request_hash,run_id) VALUES($1,$2,$3,$4,$5)", [p, userId, key, hash, r.id]);
      return this.view(c, p, r);
    });
  }
  async action(p: string, id: string, expected: unknown, input: unknown,
    userId: string, key: unknown, recheck: Recheck = noRecheck): Promise<ReaderView> {
    rev(expected); keyOf(key);
    return this.tx(async (c) => {
      const r = await this.session(c, p, id, userId, true);
      const action = readerAction(input, r.hero_id);
      const hash = stateHash({ expected, action, userId });
      const receipt = (await c.query("SELECT * FROM labyrinth_action_receipts WHERE project_id=$1 AND run_id=$2 AND key=$3", [p, id, key])).rows[0];
      if (receipt) {
        if (receipt.request_hash !== hash) throw new LabyrinthError(409, "Цей ідентифікатор уже використаний для іншої дії.");
        return this.view(c, p, r);
      }
      if (r.revision !== expected) throw new LabyrinthError(409, "Проходження вже змінилось. Оновіть сцену.");
      const d = readerWorld(r.definition, r.hero_id);
      if (d.exitNodeIds.includes(r.state.heroes[r.hero_id].nodeId))
        throw new LabyrinthError(409, "Проходження завершено. Можна повернутися до збереженого ходу.");
      // Accept only currently exposed choices; no remote objects, author-only event starts or hero spoofing.
      const exposed = readerProjection(d, r.state, r.hero_id, r.visited, r.heading, r.scenes);
      if (action.kind === "move" && !exposed.choices.some((x) => x.edgeId === action.edgeId && x.available) ||
        action.kind === "interact" && !exposed.interactions.some((x) => x.objectId === action.objectId && x.to === action.to && x.available))
        throw new LabyrinthError(409, "Ця дія зараз недоступна в поточному місці.");
      let state: LabyrinthRunState;
      try {
        state = runtimeAction(d, r.state, action).state;
        if (d.director?.enabled && !d.exitNodeIds.includes(state.heroes[r.hero_id].nodeId))
          state = (await directLabyrinth(d, { ...toRun(r), state }, false)).state;
      } catch (e) {
        if (e instanceof LabyrinthError)
          throw new LabyrinthError(e.status, "Цей крок зараз не має безпечного продовження. Виберіть іншу дію.");
        throw e;
      }
      const visited = [...new Set([...r.visited, state.heroes[r.hero_id].nodeId])];
      const heading = action.kind === "move" ? headingFromEvents(d, [{ action, state }], r.hero_id) : r.heading;
      const revision = r.revision + 1;
      await recheck();
      await c.query("UPDATE labyrinth_runs SET state=$3,revision=$4 WHERE project_id=$1 AND id=$2", [p, id, JSON.stringify(state), revision]);
      await c.query("UPDATE labyrinth_reader_sessions SET visited=$3,heading=$4 WHERE project_id=$1 AND run_id=$2", [p, id, JSON.stringify(visited), heading]);
      await c.query("INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,$3,$4)",
        [p, id, revision, JSON.stringify({ actor: "user:" + userId, action, mapRevision: r.map_revision, beforeHash: stateHash(r.state),
          afterHash: stateHash(state), state, reader: { visited, heading, label: d.nodes.find((n) => n.id === state.heroes[r.hero_id].nodeId)?.title ?? "" } })]);
      await c.query("INSERT INTO labyrinth_action_receipts(project_id,run_id,key,request_hash,response) VALUES($1,$2,$3,$4,$5)", [p, id, key, hash, JSON.stringify({ acceptedRevision: revision })]);
      return this.view(c, p, { ...r, revision, state, visited, heading });
    });
  }
  async restore(p: string, id: string, expected: unknown, source: unknown,
    userId: string, key: unknown, recheck: Recheck = noRecheck): Promise<ReaderView> {
    rev(expected); rev(source); keyOf(key);
    const hash = stateHash({ kind: "restore", id, expected, source });
    return this.tx(async (c) => {
      const receipt = await this.request(c, p, userId, key as string, hash);
      if (receipt) return this.view(c, p, await this.session(c, p, receipt.run_id, userId));
      const r = await this.session(c, p, id, userId, true);
      if (r.revision !== expected) throw new LabyrinthError(409, "Проходження вже змінилось. Оновіть сцену.");
      const checkpoint = (await c.query("SELECT event FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND revision=$3", [p, id, source])).rows[0]?.event;
      if (!checkpoint?.reader) throw new LabyrinthError(404, "Збережений хід не знайдено.");
      await recheck();
      const edition = { revision: r.publication_revision, map_revision: r.map_revision, book_revision: r.book_revision, scenes: r.scenes, definition: r.definition };
      const fork = await this.insert(c, p, r.map_id, edition, r.hero_id, userId, checkpoint.state, checkpoint.reader.visited,
        checkpoint.reader.heading, r.seed, { id, revision: Number(source) });
      await c.query("INSERT INTO labyrinth_reader_requests(project_id,user_id,key,request_hash,run_id) VALUES($1,$2,$3,$4,$5)", [p, userId, key, hash, fork.id]);
      return this.view(c, p, fork);
    });
  }
}
