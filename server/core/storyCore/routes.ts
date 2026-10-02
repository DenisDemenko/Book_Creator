/**
 * HTTP Story Core API для Graph Studio (Т5.3 В2, `PLAN_STORY_CORE.md`).
 *
 *   GET  /api/core/story-core/ops                 — реєстр операцій і що з них дозволено
 *   GET  /api/core/story-core/projects            — книги для вкладки «Граф твору»
 *   POST /api/core/story-core/call/:op            — { projectId?, args } → результат операції
 *   GET  /api/core/story-core/call/:op?projectId= — те саме для операцій читання
 *
 * Права — з доступу до книги (Т6.2): адмін бачить усі книги ядра, інші —
 * власні й ті, де вони учасники; обмежений доступ граф і Story Core не
 * відкриває. Публікація й відкат схеми — за правом `canPublishSchema`.
 */

import type { Express, Request, RequestHandler, Response } from 'express';
import type { RealtimeAccessDeps } from '../../realtimeAuth';
import { resolveProjectAccess, type ProjectAccess } from '../projectRoutes';
import { levelRank } from '../collaboration/access';
import { CoreRuleError } from '../rules';
import type { CoreRepository } from '../types';
import { OPEN_PROPOSAL_STATES } from '../types';
import { OntologyPublishError } from '../ontology/lifecycle';
import { STORY_CORE_OPS, StoryCoreForbidden, allowed, callStoryCore, proposalCounts, storyCoreOp, type StoryCoreRights } from './api';

export interface StoryCoreRoutesDeps {
  repo: () => CoreRepository | null;
  access: RealtimeAccessDeps;
  requireAuth: RequestHandler;
  /** Право ролі `canPublishSchema` (адмін — так). */
  canPublishSchema: (req: Request) => Promise<boolean>;
}

/** Права Story Core з доступу до книги. */
export function rightsFor(access: ProjectAccess, publishSchema: boolean): StoryCoreRights {
  const privileged = access.isOwner || access.role === 'admin';
  const book = access.effective.book;
  return {
    read: privileged || !access.effective.restricted,
    propose: privileged || (!access.effective.restricted && access.canWrite),
    approve: privileged || (book !== 'work' && levelRank(book) >= levelRank('approve')),
    publishSchema,
    authorOnly: privileged,
  };
}

function fail(res: Response, err: unknown) {
  if (err instanceof StoryCoreForbidden) {
    res.status(403).json({ error: err.message, kind: 'forbidden', permission: err.permission });
    return;
  }
  if (err instanceof OntologyPublishError) {
    res.status(409).json({ error: err.message, kind: 'conflict', details: err.details });
    return;
  }
  if (err instanceof CoreRuleError) {
    res.status(err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 422).json({ error: err.message, kind: err.code });
    return;
  }
  console.error('[core] помилка Story Core API:', err);
  res.status(500).json({ error: 'Не вдалося виконати операцію Story Core.', kind: 'server_error' });
}

export function registerStoryCoreRoutes(app: Express, deps: StoryCoreRoutesDeps): void {
  const principalOf = (req: Request) => (req as any).principal as { id: string | null; role: string; isGuest: boolean } | undefined;
  const withRepo = (handler: (repo: CoreRepository, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    const repo = deps.repo();
    if (!repo) {
      res.status(503).json({ error: 'Семантичне ядро зараз недоступне.', kind: 'core_unavailable' });
      return;
    }
    try {
      await handler(repo, req, res);
    } catch (err) {
      fail(res, err);
    }
  };

  app.get('/api/core/story-core/ops', deps.requireAuth, withRepo(async (_repo, req, res) => {
    const publishSchema = await deps.canPublishSchema(req);
    res.json({
      ops: STORY_CORE_OPS.map((o) => ({ id: o.id, name: o.name, kind: o.kind, project: o.project, args: o.args, ...(o.project ? {} : { allowed: allowed(o, { actor: `user:${principalOf(req)!.id}`, rights: { read: true, propose: false, approve: false, publishSchema } }) }) })),
    });
  }));

  app.get('/api/core/story-core/projects', deps.requireAuth, withRepo(async (repo, req, res) => {
    const principal = principalOf(req)!;
    const publishSchema = await deps.canPublishSchema(req);
    const rows = principal.role === 'admin' ? await repo.listProjects() : await repo.listProjects({ ownerId: principal.id!, participantUserId: principal.id! });
    const out = [];
    for (const p of rows) {
      const access = await resolveProjectAccess(principal, p.id, deps.access).catch(() => null);
      if (!access) continue;
      const rights = rightsFor(access, publishSchema);
      if (!rights.read) continue;
      const open = await repo.listStoryProposals(p.id, { states: [...OPEN_PROPOSAL_STATES], limit: 1000 });
      out.push({ id: p.id, title: p.title || p.id, revision: p.revision, updatedAt: p.updatedAt, role: access.role, isOwner: access.isOwner, rights, openProposals: proposalCounts(open) });
    }
    res.json({ projects: out });
  }));

  const call = withRepo(async (repo, req, res) => {
    const principal = principalOf(req)!;
    const op = storyCoreOp(String(req.params.op));
    if (!op) {
      res.status(404).json({ error: `Операції «${req.params.op}» у Story Core API немає`, kind: 'not_found' });
      return;
    }
    const src = (req.method === 'GET' ? req.query : req.body ?? {}) as Record<string, unknown>;
    if (req.method === 'GET' && op.kind !== 'read') {
      res.status(405).json({ error: 'Змінювати — лише POST.', kind: 'method_not_allowed' });
      return;
    }
    const args = req.method === 'GET' ? src : ((src.args ?? {}) as Record<string, unknown>);
    const publishSchema = await deps.canPublishSchema(req);
    const actor = `user:${principal.id}`;
    let projectId: string | null = null;
    let rights: StoryCoreRights = { read: true, propose: false, approve: false, publishSchema };
    if (op.project) {
      projectId = typeof src.projectId === 'string' ? src.projectId : '';
      const access = projectId ? await resolveProjectAccess(principal, projectId, deps.access) : null;
      if (!access) {
        res.status(403).json({ error: 'Немає доступу до цієї книги.', kind: 'forbidden' });
        return;
      }
      if (!(await repo.getProject(projectId))) {
        res.status(404).json({ error: 'Книгу ще не синхронізовано з ядром.', kind: 'not_synced' });
        return;
      }
      rights = rightsFor(access, publishSchema);
    }
    const result = await callStoryCore(op.id, { repo, actor, projectId, rights }, args);
    res.json({ op: op.id, result, rights });
  });
  app.get('/api/core/story-core/call/:op', deps.requireAuth, call);
  app.post('/api/core/story-core/call/:op', deps.requireAuth, call);
}
