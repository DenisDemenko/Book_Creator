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
import { FUSION_ONTOLOGY_ID, factoryOntology } from '../../../src/utils/ontology';
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

let factoryCache: { definition: ReturnType<typeof factoryOntology>; hash: string } | null = null;
const factory = () => (factoryCache ??= { definition: factoryOntology(), hash: definitionHash(factoryOntology()) });

export function registerOntologyRoutes(app: Express, d: OntologyRoutesDeps): void {
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
  app.get('/api/core/ontology', d.requireAuth, async (req: Request, res: Response) => {
    try {
      const repo = d.repo();
      const active = repo ? await repo.getActiveOntologyVersion(FUSION_ONTOLOGY_ID) : null;
      const f = factory();
      const payload = active?.definition
        ? { ontologyId: active.ontologyId, version: active.version, label: active.label, hash: active.definitionHash, publishedAt: active.publishedAt, source: 'registry' as const, definition: active.definition }
        : { ontologyId: FUSION_ONTOLOGY_ID, version: 0, label: 'вбудований', hash: f.hash, publishedAt: null, source: 'factory' as const, definition: f.definition };
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

  app.get('/api/core/ontology/versions', d.requireAdmin, withRepo(async (repo, _req, res) => {
    const versions = await repo.listOntologyVersions(FUSION_ONTOLOGY_ID, { limit: 200 });
    const draft = versions.find((v) => v.status === 'draft' || v.status === 'validated') ?? null;
    res.json({ ontologyId: FUSION_ONTOLOGY_ID, active: versions.find((v) => v.status === 'active') ?? null, draft, versions });
  }));

  app.get('/api/core/ontology/versions/:id', d.requireAdmin, withRepo(async (repo, req, res) => {
    const v = await repo.getOntologyVersion(String(req.params.id));
    if (!v) throw new CoreRuleError('not_found', 'Версію онтології не знайдено');
    res.json({ version: v });
  }));

  app.get('/api/core/ontology/events', d.requireAdmin, withRepo(async (repo, req, res) => {
    const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : undefined;
    res.json({ events: await repo.listOntologyEvents(FUSION_ONTOLOGY_ID, { versionId, limit: 500 }) });
  }));

  app.post('/api/core/ontology/drafts', d.requireAdmin, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    const draft = await createDraft(repo, { actor: actor(req), basedOn: b.basedOn || undefined, label: b.label, notes: b.notes });
    res.status(201).json({ version: draft });
  }));

  app.patch('/api/core/ontology/drafts/:id', d.requireAdmin, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    const expected = b.expectedRevision === undefined || b.expectedRevision === null ? undefined : Number(b.expectedRevision);
    if (expected !== undefined && !Number.isInteger(expected)) throw new CoreRuleError('bad_input', 'expectedRevision — ціле число');
    res.json({ version: await editDraft(repo, String(req.params.id), { actor: actor(req), ops: b.ops, expectedRevision: expected }) });
  }));

  app.post('/api/core/ontology/drafts/:id/validate', d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json(await validateDraft(repo, String(req.params.id), actor(req)));
  }));

  app.get('/api/core/ontology/drafts/:id/preview', d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json(await previewDraft(repo, String(req.params.id)));
  }));

  app.post('/api/core/ontology/drafts/:id/impact', d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json(await impactDraft(repo, String(req.params.id), actor(req)));
  }));

  app.post('/api/core/ontology/drafts/:id/publish', d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await publishDraft(repo, String(req.params.id), actor(req)) });
  }));

  app.post('/api/core/ontology/versions/:id/rollback', d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await rollbackTo(repo, String(req.params.id), actor(req)) });
  }));

  app.post('/api/core/ontology/versions/:id/archive', d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await archiveVersion(repo, String(req.params.id), actor(req)) });
  }));

  // Відкрита чернетка одним запитом (зручно канві Т5.2).
  app.get('/api/core/ontology/draft', d.requireAdmin, withRepo(async (repo, _req, res) => {
    res.json({ version: await openDraft(repo) });
  }));
}
