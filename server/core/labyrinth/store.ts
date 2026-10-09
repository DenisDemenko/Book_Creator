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
  ) {
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
      const state = initialState(rows[0].definition);
      const result = await c.query(
        "INSERT INTO labyrinth_runs(project_id,map_id,map_revision,seed,state,created_by,participants) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
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
}
