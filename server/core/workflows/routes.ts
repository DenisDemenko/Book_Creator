/**
 * API процесів ШІ Graph Studio (Т5.2 В2, `PLAN_GRAPH_STUDIO.md`; ТЗ §34,
 * §37, §38, №7, 27, 28).
 *
 *   GET    /api/core/workflows                                 — процеси з робочою, тестовою й чернеткою    (Graph Studio)
 *   POST   /api/core/workflows                                 — новий { id, name, description?, template? } (адмін)
 *   GET    /api/core/workflows/:id                             — процес і версії                             (Graph Studio)
 *   GET    /api/core/workflows/:id/versions/:vid               — версія з визначенням і розкладкою           (Graph Studio)
 *   GET    /api/core/workflows/:id/events                      — журнал                                      (Graph Studio)
 *   POST   /api/core/workflows/:id/draft                       — відкрити чернетку { fromVersionId? }       (адмін)
 *   PUT    /api/core/workflows/:id/versions/:vid               — зберегти чернетку { definition, layout?, expectedRevision? } (адмін)
 *   POST   /api/core/workflows/:id/versions/:vid/validate      — перевірити                                  (адмін)
 *   POST   /api/core/workflows/:id/versions/:vid/test          — чернетка → тест                             (адмін)
 *   POST   /api/core/workflows/:id/versions/:vid/publish       — тест → робоче                               (canPublishSchema)
 *   POST   /api/core/workflows/:id/versions/:vid/rollback      — відкат до цієї версії                       (canPublishSchema)
 *   POST   /api/core/workflows/:id/versions/:vid/archive       — відкинути чернетку / зняти тест            (адмін)
 *   PUT    /api/core/workflows/:id/versions/:vid/layout        — розкладка канви (будь-якої версії, №28)    (адмін)
 *
 * «Graph Studio» — адмін або роль із правом `canPublishSchema` (рішення
 * власника §2 п.3). Виконання процесів — Т5.4.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import type { CoreActor, CoreRepository } from '../types';
import { CoreRuleError } from '../rules';
import {
  archiveVersion,
  createWorkflow,
  ensureDraft,
  getLayout,
  listWorkflowSummaries,
  promoteToTest,
  publishVersion,
  rollbackTo,
  saveDraft,
  saveVersionLayout,
  validateVersion,
} from './lifecycle';

type Mw = (req: Request, res: Response, next: NextFunction) => void;

export interface WorkflowRoutesDeps {
  repo: () => CoreRepository | null;
  requireStudio: Mw;
  requireAdmin: Mw;
  requirePublish: Mw;
}

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, bad_actor: 403 };

export function registerWorkflowRoutes(app: Express, d: WorkflowRoutesDeps): void {
  const BASE = '/api/core/workflows';
  const actor = (req: Request): CoreActor => `user:${req.principal?.id ?? 'admin'}` as CoreActor;
  const withRepo = (fn: (repo: CoreRepository, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    const repo = d.repo();
    if (!repo) {
      res.status(503).json({ error: 'Семантичне ядро зараз недоступне — процеси ШІ живуть у ньому.', kind: 'core_unavailable' });
      return;
    }
    try {
      await fn(repo, req, res);
    } catch (err) {
      if (err instanceof CoreRuleError) {
        res.status(STATUS[err.code] ?? 422).json({ error: err.message, kind: err.code });
        return;
      }
      console.error('[workflows]', err);
      res.status(500).json({ error: (err as Error)?.message || 'Помилка процесів ШІ', kind: 'error' });
    }
  };
  const wid = (req: Request) => String(req.params.id);
  const vid = (req: Request) => String(req.params.vid);

  app.get(BASE, d.requireStudio, withRepo(async (repo, _req, res) => {
    res.json({ workflows: await listWorkflowSummaries(repo) });
  }));

  app.post(BASE, d.requireAdmin, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    const out = await createWorkflow(repo, {
      id: String(b.id ?? '').trim(),
      name: { en: String(b.name?.en ?? '').trim(), uk: String(b.name?.uk ?? '').trim() },
      description: typeof b.description === 'string' ? b.description : '',
      template: b.template === 'sample' ? 'sample' : 'empty',
      actor: actor(req),
    });
    res.status(201).json(out);
  }));

  app.get(`${BASE}/:id`, d.requireStudio, withRepo(async (repo, req, res) => {
    const workflow = await repo.getWorkflow(wid(req));
    if (!workflow) throw new CoreRuleError('not_found', 'Процесу не знайдено');
    res.json({ workflow, versions: await repo.listWorkflowVersions(workflow.id, { limit: 200 }) });
  }));

  app.get(`${BASE}/:id/versions/:vid`, d.requireStudio, withRepo(async (repo, req, res) => {
    const v = await repo.getWorkflowVersion(vid(req));
    if (!v || v.workflowId !== wid(req)) throw new CoreRuleError('not_found', 'Версію процесу не знайдено');
    res.json({ version: v, layout: await getLayout(repo, 'workflow', v.workflowId, v.id) });
  }));

  app.get(`${BASE}/:id/events`, d.requireStudio, withRepo(async (repo, req, res) => {
    res.json({ events: await repo.listWorkflowEvents({ workflowId: wid(req), limit: 200 }) });
  }));

  app.post(`${BASE}/:id/draft`, d.requireAdmin, withRepo(async (repo, req, res) => {
    const from = typeof req.body?.fromVersionId === 'string' ? req.body.fromVersionId : null;
    const draft = await ensureDraft(repo, wid(req), actor(req), from);
    res.json({ version: draft, layout: await getLayout(repo, 'workflow', draft.workflowId, draft.id) });
  }));

  app.put(`${BASE}/:id/versions/:vid`, d.requireAdmin, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    const version = await saveDraft(repo, {
      workflowId: wid(req),
      versionId: vid(req),
      definition: b.definition,
      layout: b.layout,
      expectedRevision: typeof b.expectedRevision === 'number' ? b.expectedRevision : undefined,
      actor: actor(req),
    });
    res.json({ version, layout: await getLayout(repo, 'workflow', version.workflowId, version.id) });
  }));

  app.post(`${BASE}/:id/versions/:vid/validate`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json(await validateVersion(repo, wid(req), vid(req), actor(req)));
  }));

  app.post(`${BASE}/:id/versions/:vid/test`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await promoteToTest(repo, wid(req), vid(req), actor(req)) });
  }));

  app.post(`${BASE}/:id/versions/:vid/publish`, d.requirePublish, withRepo(async (repo, req, res) => {
    res.json({ version: await publishVersion(repo, wid(req), vid(req), actor(req)) });
  }));

  app.post(`${BASE}/:id/versions/:vid/rollback`, d.requirePublish, withRepo(async (repo, req, res) => {
    res.json({ version: await rollbackTo(repo, wid(req), vid(req), actor(req)) });
  }));

  app.post(`${BASE}/:id/versions/:vid/archive`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ version: await archiveVersion(repo, wid(req), vid(req), actor(req)) });
  }));

  app.put(`${BASE}/:id/versions/:vid/layout`, d.requireAdmin, withRepo(async (repo, req, res) => {
    res.json({ layout: await saveVersionLayout(repo, wid(req), vid(req), req.body?.layout, actor(req)) });
  }));
}
