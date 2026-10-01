/**
 * API реєстру схем (Т5.1 В3, `PLAN_ONTOLOGY.md`; ТЗ Graph Studio §33:
 * `get_schema`, `get_schema_version`, `publish_schema`, `rollback_schema`).
 *
 *   GET   /api/core/ontology                         — активна версія (будь-хто з входом; ETag = хеш)
 *   GET   /api/core/ontology/versions                — версії й відкрита чернетка        (адмін)
 *   GET   /api/core/ontology/versions/:id            — версія з визначенням              (адмін)
 *   GET   /api/core/ontology/events                  — журнал аудиту (?versionId=)        (адмін)
 *   POST  /api/core/ontology/drafts                  — чернетка { basedOn?, label?, notes? }
 *   PATCH /api/core/ontology/drafts/:id              — правки { ops, expectedRevision? }
 *   POST  /api/core/ontology/drafts/:id/validate     — VALIDATE
 *   GET   /api/core/ontology/drafts/:id/preview      — PREVIEW (різниця з активною)
 *   POST  /api/core/ontology/drafts/:id/impact       — MIGRATION IMPACT
 *   POST  /api/core/ontology/drafts/:id/publish      — PUBLISH → ACTIVE
 *   POST  /api/core/ontology/versions/:id/rollback   — ROLLBACK (нова версія з визначенням цієї)
 *   POST  /api/core/ontology/versions/:id/archive    — ARCHIVED / відкинути чернетку
 *
 * Зміни — лише адміністратор платформи (рішення власника §2 п.4; окремий
 * дозвіл PUBLISH_SCHEMA — у Т5.2). Без ядра читання віддає вбудований
 * реєстр (документ власника), а зміни — 503.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import type { CoreRepository } from '../types';
import { CoreRuleError } from '../rules';
import { FUSION_ONTOLOGY_ID } from '../../../src/utils/ontology';
import {
  OntologyPublishError,
  archiveVersion,
  createDraft,
  definitionHash,
  editDraft,
  impactDraft,
  openDraft,
  previewDraft,
  publishDraft,
  rollbackTo,
  validateDraft,
  domainOf,
} from './lifecycle';

export interface OntologyRoutesDeps {
  repo: () => CoreRepository | null;
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
}

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, bad_actor: 403 };

function sendError(res: Response, err: unknown): void {
  if (err instanceof OntologyPublishError) {
    res.status(409).json({ error: err.message, kind: 'conflict', details: err.details });
    return;
  }
  if (err instanceof CoreRuleError) {
    res.status(STATUS[err.code] ?? 422).json({ error: err.message, kind: err.code });
    return;
  }
  console.error('[ontology]', err);
  res.status(500).json({ error: (err as Error)?.message || 'Помилка реєстру схем', kind: 'error' });
}

const factoryCache = new Map<string, { definition: Record<string, unknown>; hash: string }>();
const factory = (ontologyId: string) => {
  let f = factoryCache.get(ontologyId);
  if (!f) {
    const definition = domainOf(ontologyId).factory();
    f = { definition, hash: definitionHash(definition) };
    factoryCache.set(ontologyId, f);
  }
  return f;
};

/**
 * Маршрути однієї онтології реєстру схем: твору (`/api/core/ontology`, Т5.1)
 * чи співпраці (`/api/core/collaboration/ontology`, Т6.1). Версія з чужої
 * онтології за цією адресою — «не знайдено».
 */
export function registerOntologyRoutes(app: Express, d: OntologyRoutesDeps, opts: { ontologyId?: string; base?: string } = {}): void {
  const ONTOLOGY = opts.ontologyId ?? FUSION_ONTOLOGY_ID;
  const BASE = opts.base ?? '/api/core/ontology';
  domainOf(ONTOLOGY);
  const own = async (repo: CoreRepository, id: string) => {
    const v = await repo.getOntologyVersion(id);
    if (!v || v.ontologyId !== ONTOLOGY) throw new CoreRuleError('not_found', 'Версію онтології не знайдено');
    return v;
  };
  const actor = (req: Request) => `user:${req.principal?.id ?? 'admin'}`;
  const withRepo = (fn: (repo: CoreRepository, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    const repo = d.repo();
    if (!repo) {
      res.status(503).json({ error: 'Семантичне ядро зараз недоступне — версії онтології живуть у ньому.', kind: 'core_unavailable' });
      return;
    }
    try {
      await fn(repo, req, res);
    } catch (err) {
      sendError(res, err);
    }
  };

  // get_schema / get_schema_version — те, що бачать редактор, чат і правила ядра.
  app.get(BASE, d.requireAuth, async (req: Request, res: Response) => {
    try {
      const repo = d.repo();
      const active = repo ? await repo.getActiveOntologyVersion(ONTOLOGY) : null;
      const f = factory(ONTOLOGY);
      const payload = active?.definition
        ? { ontologyId: active.ontologyId, version: active.version, label: active.label, hash: active.definitionHash, publishedAt: active.publishedAt, source: 'registry' as const, definition: active.definition }
        : { ontologyId: ONTOLOGY, version: 0, label: 'вбудований', hash: f.hash, publishedAt: null, source: 'factory' as const, definition: f.definition };
      const etag = `"${payload.hash}"`;
      res.set('ETag', etag).set('Cache-Control', 'private, no-cache');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.json(payload);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get(`${BASE}/versions`, d.requireAdmin, withRepo(async (repo, _req, res) => {
    const versions = await repo.listOntologyVersions(ONTOLOGY, { limit: 200 });
    const draft = versions.find((v) => v.status === 'draft' || v.status === 'validated') ?? null;
    res.json({ ontologyId: ONTOLOGY, active: versions.find((v) => v.status === 'active') ?? null, draft, versions });
  }));

  app.get(`${BASE}/versions/:id`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await own(repo, String(req.params.id)) });
  }));

  app.get(`${BASE}/events`, d.requireAdmin, withRepo(async (repo, req, res) => {
    const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : undefined;
    if (versionId) await own(repo, versionId);
    res.json({ events: await repo.listOntologyEvents(ONTOLOGY, { versionId, limit: 500 }) });
  }));

  app.post(`${BASE}/drafts`, d.requireAdmin, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    if (b.basedOn) await own(repo, String(b.basedOn));
    const draft = await createDraft(repo, { actor: actor(req), ontologyId: ONTOLOGY, basedOn: b.basedOn || undefined, label: b.label, notes: b.notes });
    res.status(201).json({ version: draft });
  }));

  app.patch(`${BASE}/drafts/:id`, d.requireAdmin, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    const expected = b.expectedRevision === undefined || b.expectedRevision === null ? undefined : Number(b.expectedRevision);
    if (expected !== undefined && !Number.isInteger(expected)) throw new CoreRuleError('bad_input', 'expectedRevision — ціле число');
    res.json({ version: await editDraft(repo, (await own(repo, String(req.params.id))).id, { actor: actor(req), ops: b.ops, expectedRevision: expected }) });
  }));

  app.post(`${BASE}/drafts/:id/validate`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json(await validateDraft(repo, (await own(repo, String(req.params.id))).id, actor(req)));
  }));

  app.get(`${BASE}/drafts/:id/preview`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json(await previewDraft(repo, (await own(repo, String(req.params.id))).id));
  }));

  app.post(`${BASE}/drafts/:id/impact`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json(await impactDraft(repo, (await own(repo, String(req.params.id))).id, actor(req)));
  }));

  app.post(`${BASE}/drafts/:id/publish`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await publishDraft(repo, (await own(repo, String(req.params.id))).id, actor(req)) });
  }));

  app.post(`${BASE}/versions/:id/rollback`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await rollbackTo(repo, (await own(repo, String(req.params.id))).id, actor(req)) });
  }));

  app.post(`${BASE}/versions/:id/archive`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await archiveVersion(repo, (await own(repo, String(req.params.id))).id, actor(req)) });
  }));

  // Відкрита чернетка одним запитом (зручно канві Т5.2).
  app.get(`${BASE}/draft`, d.requireAdmin, withRepo(async (repo, _req, res) => {
    res.json({ version: await openDraft(repo, ONTOLOGY) });
  }));
}
