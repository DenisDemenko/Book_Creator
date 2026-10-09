import { directLabyrinth, type DirectorServices } from "./director";
import {
  runtimeInitialState,
  runtimeAction,
  effectiveObjects,
} from "./runtime";
import {
  describeRoutes,
  headingFromEvents,
  type Heading,
} from "../../../shared/labyrinthNarration";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  LabyrinthDefinition,
  LabyrinthRun,
  LabyrinthRunEvent,
  LabyrinthVersion,
} from "../../../shared/labyrinth";
import {
  initialState,
  LabyrinthError,
  stateHash,
  structuralAction,
  validateDefinition,
} from "./model";
const uuid = (id: string) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new LabyrinthError(404, "Запис лабіринта не знайдено.");
  return id;
};
export const revisionNumber = (n: unknown) => {
  if (!Number.isSafeInteger(n) || Number(n) < 0)
    throw new LabyrinthError(422, "Вкажіть поточну ревізію.");
  return Number(n);
};
const timestamp = (v: Date | string) => new Date(v).toISOString();
const version = (r: any): LabyrinthVersion => ({
  mapId: r.map_id,
  projectId: r.project_id,
  revision: r.revision,
  bookRevision: r.book_revision,
  definition: r.definition,
  hash: r.hash,
  createdBy: r.created_by,
  createdAt: timestamp(r.created_at),
});
const run = (r: any): LabyrinthRun => ({
  id: r.id,
  projectId: r.project_id,
  mapId: r.map_id,
  mapRevision: r.map_revision,
  revision: r.revision,
  seed: r.seed,
  difficulty: r.difficulty,
  mode: r.mode,
  participants: r.participants,
  state: r.state,
  createdBy: r.created_by,
  createdAt: timestamp(r.created_at),
});
/** Shares the existing Core pool and migration lifecycle; never owns or closes it. */
export class PgLabyrinthStore {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private async verifyReferences(
    c: PoolClient,
    projectId: string,
    d: LabyrinthDefinition,
  ) {
    for (const node of d.nodes) {
      if (node.sceneId) {
        const { rows } = await c.query(
          "SELECT id FROM documents WHERE project_id=$1 AND id=$2 AND kind='section' AND deleted_at IS NULL",
          [projectId, node.sceneId],
        );
        if (!rows.length)
          throw new LabyrinthError(422, "Сцена має належати цій книзі.");
      }
    }
    for (const obj of [...d.objects, ...d.heroes]) {
      if (obj.entityId) {
        uuid(obj.entityId);
        const { rows } = await c.query(
          "SELECT id FROM entities WHERE project_id=$1 AND id=$2 AND status='confirmed'",
          [projectId, obj.entityId],
        );
        if (!rows.length)
          throw new LabyrinthError(
            422,
            "Сутність має бути підтверджена в цій книзі.",
          );
      }
    }
  }
  async validateDesign(projectId: string, input: unknown) {
    const definition = validateDefinition(input);
    await this.transaction((c) =>
      this.verifyReferences(c, projectId, definition),
    );
    return definition;
  }
  async routeView(
    projectId: string,
    runId: string,
    heroId: string,
    heading?: Heading,
  ) {
    const r = await this.getRun(projectId, runId);
    if (!Object.hasOwn(r.state.heroes, heroId))
      throw new LabyrinthError(404, "Героя немає в цьому проходженні.");
    const v = await this.getVersion(projectId, r.mapId, r.mapRevision);
    const { rows } = await this.pool.query(
      "SELECT event FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND revision<=$3 AND event->'action'->>'kind'='move' AND event->'action'->>'heroId'=$4 ORDER BY revision DESC LIMIT 100",
      [projectId, runId, r.revision, heroId],
    );
    return {
      ...describeRoutes(
        v.definition,
        { ...r.state, objects: effectiveObjects(v.definition, r.state) },
        heroId,
        heading ??
          headingFromEvents(
            v.definition,
            rows.map((row) => row.event),
            heroId,
          ),
      ),
      runId: r.id,
      runRevision: r.revision,
      mapRevision: r.mapRevision,
    };
  }
  async listMaps(projectId: string) {
    const { rows } = await this.pool.query(
      "SELECT v.project_id,v.map_id,v.revision,v.book_revision,v.hash,v.created_by,v.created_at,v.definition->>'title' AS title FROM labyrinth_maps m JOIN labyrinth_versions v ON(v.project_id=m.project_id AND v.map_id=m.id AND v.revision=m.revision) WHERE m.project_id=$1 ORDER BY v.created_at DESC LIMIT 100",
      [projectId],
    );
    return rows.map((r) => {
      const { definition, ...metadata } = version(r);
      return { ...metadata, title: r.title };
    });
  }
  async getVersion(projectId: string, mapId: string, revision: number) {
    uuid(mapId);
    revisionNumber(revision);
    const { rows } = await this.pool.query(
      "SELECT * FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=$3",
      [projectId, mapId, revision],
    );
    if (!rows.length)
      throw new LabyrinthError(404, "Версію карти не знайдено.");
    return version(rows[0]);
  }
  async listVersions(projectId: string, mapId: string) {
    uuid(mapId);
    const { rows } = await this.pool.query(
      "SELECT project_id,map_id,revision,book_revision,hash,created_by,created_at FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 ORDER BY revision DESC LIMIT 100",
      [projectId, mapId],
    );
    return rows.map((r) => {
      const { definition, ...metadata } = version(r);
      return metadata;
    });
  }
  async saveVersion(
    projectId: string,
    actor: string,
    input: unknown,
    expectedRevision: number,
    mapId?: string,
  ) {
    revisionNumber(expectedRevision);
    if (mapId) uuid(mapId);
    if (!actor.startsWith("user:") || actor.length <= 5)
      throw new LabyrinthError(403, "Версію створює автор.");
    const definition = validateDefinition(input);
    return this.transaction(async (c) => {
      const { rows: projects } = await c.query(
        "SELECT revision FROM projects WHERE id=$1 FOR SHARE",
        [projectId],
      );
      if (!projects.length)
        throw new LabyrinthError(404, "Книгу ще не синхронізовано з ядром.");
      await this.verifyReferences(c, projectId, definition);
      if (!mapId) {
        if (expectedRevision !== 0)
          throw new LabyrinthError(409, "Нова карта починається з ревізії 0.");
        mapId = randomUUID();
        await c.query(
          "INSERT INTO labyrinth_maps(project_id,id) VALUES($1,$2)",
          [projectId, mapId],
        );
      }
      const { rows } = await c.query(
        "SELECT revision FROM labyrinth_maps WHERE project_id=$1 AND id=$2 FOR UPDATE",
        [projectId, mapId],
      );
      if (!rows.length) throw new LabyrinthError(404, "Карту не знайдено.");
      if (rows[0].revision !== expectedRevision)
        throw new LabyrinthError(
          409,
          "Карту вже змінено. Оновіть поточну ревізію.",
        );
      const rev = expectedRevision + 1;
      const inserted = await c.query(
        "INSERT INTO labyrinth_versions(project_id,map_id,revision,book_revision,definition,hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          projectId,
          mapId,
          rev,
          projects[0].revision,
          JSON.stringify(definition),
          stateHash(definition),
          actor,
        ],
      );
      await c.query(
        "UPDATE labyrinth_maps SET revision=$3 WHERE project_id=$1 AND id=$2",
        [projectId, mapId, rev],
      );
      return version(inserted.rows[0]);
    });
  }
  async createRun(
    projectId: string,
    mapId: string,
    mapRevision: number,
    actor: string,
    seed: string,
    mode: unknown = "structural",
  ) {
    if (mode !== "structural" && mode !== "runtime")
      throw new LabyrinthError(422, "Невідомий режим прогону.");
    uuid(mapId);
    revisionNumber(mapRevision);
    if (typeof seed !== "string" || !seed.trim() || seed.length > 128)
      throw new LabyrinthError(422, "Seed має містити 1–128 символів.");
    return this.transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=$3",
        [projectId, mapId, mapRevision],
      );
      if (!rows.length)
        throw new LabyrinthError(404, "Версію карти не знайдено.");
      const state =
        mode === "runtime"
          ? runtimeInitialState(rows[0].definition)
          : initialState(rows[0].definition);
      const result = await c.query(
        "INSERT INTO labyrinth_runs(project_id,map_id,map_revision,seed,state,created_by,participants,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          projectId,
          mapId,
          mapRevision,
          seed.trim(),
          JSON.stringify(state),
          actor,
          JSON.stringify([
            {
              userId: actor.slice(5),
              heroIds: rows[0].definition.heroes.map((h: any) => h.id),
            },
          ]),
          mode,
        ],
      );
      const r = run(result.rows[0]);
      await c.query(
        "INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,0,$3)",
        [
          projectId,
          r.id,
          JSON.stringify({
            kind: "created",
            actor,
            mapRevision,
            state,
            afterHash: stateHash(state),
          }),
        ],
      );
      return r;
    });
  }
  async listRuns(projectId: string, mapId: string, mapRevision: number) {
    uuid(mapId);
    revisionNumber(mapRevision);
    const { rows } = await this.pool.query(
      "SELECT id,map_id,map_revision,mode,revision,state->>'turn' AS turn,state->>'storyTime' AS story_time,created_at FROM labyrinth_runs WHERE project_id=$1 AND map_id=$2 AND map_revision=$3 ORDER BY created_at DESC,id LIMIT 20",
      [projectId, mapId, mapRevision],
    );
    return rows.map((r) => ({
      id: r.id,
      mapId: r.map_id,
      mapRevision: r.map_revision,
      mode: r.mode,
      revision: r.revision,
      turn: Number(r.turn),
      storyTime: Number(r.story_time),
      createdAt: timestamp(r.created_at),
    }));
  }
  async getRun(projectId: string, runId: string) {
    uuid(runId);
    const { rows } = await this.pool.query(
      "SELECT * FROM labyrinth_runs WHERE project_id=$1 AND id=$2",
      [projectId, runId],
    );
    if (!rows.length) throw new LabyrinthError(404, "Проходження не знайдено.");
    return run(rows[0]);
  }
  async getEvents(projectId: string, runId: string, after = -1) {
    await this.getRun(projectId, runId);
    if (!Number.isSafeInteger(after) || after < -1)
      throw new LabyrinthError(422, "Некоректний курсор журналу.");
    const { rows } = await this.pool.query(
      "SELECT revision,event,created_at FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND revision>$3 ORDER BY revision LIMIT 100",
      [projectId, runId, after],
    );
    return rows.map((r) => ({
      ...r.event,
      revision: r.revision,
      createdAt: timestamp(r.created_at),
    }));
  }
  async structuralStep(
    projectId: string,
    runId: string,
    expectedRevision: number,
    actor: string,
    action: unknown,
  ) {
    uuid(runId);
    revisionNumber(expectedRevision);
    return this.transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM labyrinth_runs WHERE project_id=$1 AND id=$2 FOR UPDATE",
        [projectId, runId],
      );
      if (!rows.length)
        throw new LabyrinthError(404, "Проходження не знайдено.");
      const r = run(rows[0]);
      if (r.mode === "runtime")
        throw new LabyrinthError(
          409,
          "Використайте захищені дії безпечного прогону.",
        );
      if (r.revision !== expectedRevision)
        throw new LabyrinthError(
          409,
          "Проходження вже змінено. Оновіть поточну ревізію.",
        );
      const { rows: versions } = await c.query(
        "SELECT definition FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=$3",
        [projectId, r.mapId, r.mapRevision],
      );
      const next = structuralAction(versions[0].definition, r.state, action);
      const event: LabyrinthRunEvent = {
        revision: r.revision + 1,
        actor,
        action: next.action,
        reason: "Авторська структурна перевірка графа",
        mapRevision: r.mapRevision,
        beforeHash: stateHash(r.state),
        afterHash: stateHash(next.state),
        state: next.state,
        createdAt: new Date().toISOString(),
      };
      const updated = await c.query(
        "UPDATE labyrinth_runs SET revision=$3,state=$4 WHERE project_id=$1 AND id=$2 RETURNING *",
        [projectId, runId, event.revision, JSON.stringify(next.state)],
      );
      await c.query(
        "INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,$3,$4)",
        [projectId, runId, event.revision, JSON.stringify(event)],
      );
      return { run: run(updated.rows[0]), event };
    });
  }
  async runtimeStep(
    projectId: string,
    runId: string,
    expectedRevision: number,
    actor: string,
    action: unknown,
    key: unknown,
  ) {
    uuid(runId);
    revisionNumber(expectedRevision);
    if (typeof key !== "string" || !key.trim() || key.length > 128)
      throw new LabyrinthError(422, "Потрібен ключ повтору запиту.");
    const hash = stateHash({ expectedRevision, actor, action });
    return this.transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM labyrinth_runs WHERE project_id=$1 AND id=$2 FOR UPDATE",
        [projectId, runId],
      );
      if (!rows.length)
        throw new LabyrinthError(404, "Проходження не знайдено.");
      const r = run(rows[0]);
      const receipt = await c.query(
        "SELECT * FROM labyrinth_action_receipts WHERE project_id=$1 AND run_id=$2 AND key=$3",
        [projectId, runId, key],
      );
      if (receipt.rows.length) {
        if (receipt.rows[0].request_hash !== hash)
          throw new LabyrinthError(
            409,
            "Ключ повтору вже використано для іншої дії.",
          );
        return receipt.rows[0].response;
      }
      if (r.mode !== "runtime" || r.revision !== expectedRevision)
        throw new LabyrinthError(409, "Оновіть ревізію безпечного прогону.");
      const v = await c.query(
        "SELECT definition FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=$3",
        [projectId, r.mapId, r.mapRevision],
      );
      const next = runtimeAction(v.rows[0].definition, r.state, action);
      const event = {
        revision: r.revision + 1,
        actor,
        action: next.action,
        reason: "Доведений маршрут порятунку",
        mapRevision: r.mapRevision,
        beforeHash: stateHash(r.state),
        afterHash: stateHash(next.state),
        state: next.state,
        proof: next.proof,
        createdAt: new Date().toISOString(),
      };
      const updated = await c.query(
        "UPDATE labyrinth_runs SET revision=$3,state=$4 WHERE project_id=$1 AND id=$2 RETURNING *",
        [projectId, runId, event.revision, JSON.stringify(next.state)],
      );
      await c.query(
        "INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,$3,$4)",
        [projectId, runId, event.revision, JSON.stringify(event)],
      );
      const response = { run: run(updated.rows[0]), event };
      await c.query(
        "INSERT INTO labyrinth_action_receipts(project_id,run_id,key,request_hash,response) VALUES($1,$2,$3,$4,$5)",
        [projectId, runId, key, hash, JSON.stringify(response)],
      );
      return response;
    });
  }
  async directorStep(
    projectId: string,
    runId: string,
    expectedRevision: number,
    actor: string,
    useAI: boolean,
    key: unknown,
    services: DirectorServices = {},
    recheck?: () => Promise<void>,
  ) {
    uuid(runId);
    revisionNumber(expectedRevision);
    if (
      typeof key !== "string" ||
      !key.trim() ||
      key.length > 128 ||
      typeof useAI !== "boolean"
    )
      throw new LabyrinthError(
        422,
        "Потрібні режим директора та ключ повтору.",
      );
    const hash = stateHash({
      expectedRevision,
      actor,
      action: { kind: "director", useAI },
    });
    return this.transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM labyrinth_runs WHERE project_id=$1 AND id=$2 FOR NO KEY UPDATE",
        [projectId, runId],
      );
      if (!rows.length)
        throw new LabyrinthError(404, "Проходження не знайдено.");
      const receipt = await c.query(
        "SELECT * FROM labyrinth_action_receipts WHERE project_id=$1 AND run_id=$2 AND key=$3",
        [projectId, runId, key],
      );
      if (receipt.rows.length) {
        if (receipt.rows[0].request_hash !== hash)
          throw new LabyrinthError(409, "Ключ повтору вже використано.");
        return receipt.rows[0].response;
      }
      const r = run(rows[0]);
      if (r.revision !== expectedRevision)
        throw new LabyrinthError(409, "Оновіть поточну ревізію прогону.");
      const v = await c.query(
        "SELECT definition FROM labyrinth_versions WHERE project_id=$1 AND map_id=$2 AND revision=$3",
        [projectId, r.mapId, r.mapRevision],
      );
      const base = structuredClone(r);
      const budget = await c.query(
        "SELECT attempts FROM labyrinth_director_budget WHERE project_id=$1 AND run_id=$2",
        [projectId, runId],
      );
      if (base.state.engine?.director)
        base.state.engine.director.modelCalls = Math.max(
          base.state.engine.director.modelCalls,
          budget.rows[0]?.attempts ?? 0,
        );
      const maxCalls = v.rows[0].definition.director?.maxModelCalls ?? 0;
      const initial = base.state.engine?.director?.modelCalls ?? 0;
      const next = await directLabyrinth(v.rows[0].definition, base, useAI, {
        ...services,
        reserveAttempt: async () => {
          if (initial >= maxCalls) return false;
          // Independent commit: the outer action may later roll back, but the paid attempt never becomes free.
          const reservation = await this.pool.query(
            "INSERT INTO labyrinth_director_budget(project_id,run_id,attempts) VALUES($1,$2,$3) ON CONFLICT(project_id,run_id) DO UPDATE SET attempts=labyrinth_director_budget.attempts+1 WHERE labyrinth_director_budget.attempts<$4 RETURNING attempts",
            [projectId, runId, initial + 1, maxCalls],
          );
          return reservation.rows.length > 0;
        },
      });
      await recheck?.();
      const event = {
        revision: r.revision + 1,
        actor,
        action: { kind: "director", useAI },
        reason: next.trace.reason,
        mapRevision: r.mapRevision,
        beforeHash: stateHash(r.state),
        afterHash: stateHash(next.state),
        state: next.state,
        proof: next.proof,
        directorTrace: next.trace,
        createdAt: new Date().toISOString(),
      };
      const updated = await c.query(
        "UPDATE labyrinth_runs SET revision=$3,state=$4 WHERE project_id=$1 AND id=$2 RETURNING *",
        [projectId, runId, event.revision, JSON.stringify(next.state)],
      );
      await c.query(
        "INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,$3,$4)",
        [projectId, runId, event.revision, JSON.stringify(event)],
      );
      const response = { run: run(updated.rows[0]), event };
      await c.query(
        "INSERT INTO labyrinth_action_receipts(project_id,run_id,key,request_hash,response) VALUES($1,$2,$3,$4,$5)",
        [projectId, runId, key, hash, JSON.stringify(response)],
      );
      return response;
    });
  }
  async restoreRun(
    projectId: string,
    runId: string,
    expectedRevision: number,
    sourceRevision: number,
    actor: string,
  ) {
    uuid(runId);
    revisionNumber(expectedRevision);
    revisionNumber(sourceRevision);
    return this.transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM labyrinth_runs WHERE project_id=$1 AND id=$2 FOR UPDATE",
        [projectId, runId],
      );
      if (!rows.length)
        throw new LabyrinthError(404, "Проходження не знайдено.");
      const r = run(rows[0]);
      if (r.revision !== expectedRevision)
        throw new LabyrinthError(409, "Проходження вже змінено.");
      const checkpoint = await c.query(
        "SELECT event FROM labyrinth_run_events WHERE project_id=$1 AND run_id=$2 AND revision=$3",
        [projectId, runId, sourceRevision],
      );
      if (!checkpoint.rows.length)
        throw new LabyrinthError(404, "Контрольну точку не знайдено.");
      const state = checkpoint.rows[0].event.state;
      const fork = await c.query(
        "INSERT INTO labyrinth_runs(project_id,map_id,map_revision,seed,state,created_by,participants,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          projectId,
          r.mapId,
          r.mapRevision,
          r.seed,
          JSON.stringify(state),
          actor,
          JSON.stringify(r.participants),
          r.mode,
        ],
      );
      const result = run(fork.rows[0]);
      await c.query(
        "INSERT INTO labyrinth_run_events(project_id,run_id,revision,event) VALUES($1,$2,0,$3)",
        [
          projectId,
          result.id,
          JSON.stringify({
            kind: "restored",
            actor,
            sourceRunId: runId,
            sourceRevision,
            mapRevision: r.mapRevision,
            state,
            afterHash: stateHash(state),
          }),
        ],
      );
      return result;
    });
  }
}
