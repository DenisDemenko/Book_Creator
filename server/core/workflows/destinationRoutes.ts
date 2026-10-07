import { SEMANTIC_REGISTRY, SEMANTIC_WORKFLOW } from '../../../src/utils/semanticChange';
/**
 * Реєстр напрямків маршрутизатора Jev — API Graph Studio (Т5.5 В2,
 * `PLAN_JEV_NODES.md`; ТЗ Graph Studio §10, №10; рішення власника §2 п.2).
 *
 *   GET    /api/core/workflow-destinations?registry=          — напрямки, процеси й маршрутизатори реєстрів (Graph Studio)
 *   PUT    /api/core/workflow-destinations/:registry/:option  — додати чи змінити { label, description, workflowId, enabled } (право публікації схем)
 *   DELETE /api/core/workflow-destinations/:registry/:option  — вилучити (право публікації схем)
 *
 * Напрямок діє одразу на робочі процеси (маршрутизатор із реєстром бачить
 * його без правки себе), тому правити — як публікувати: адмін і ті, кому
 * видано право публікації схем.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import type { CoreActor, CoreRepository, WorkflowDestinationRow } from '../types';
import { CoreRuleError } from '../rules';
import { routerRegistry, type WorkflowDefinition } from '../../../src/utils/workflowGraph';
import { publishedVersion } from './engine/runner';

type Mw = (req: Request, res: Response, next: NextFunction) => void;

export interface DestinationRoutesDeps {
  repo: () => CoreRepository | null;
  requireStudio: Mw;
  requirePublish: Mw;
}

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, bad_actor: 403 };

/** Процеси для вибору й маршрутизатори, що читають кожен реєстр (з робочих версій). */
async function overview(repo: CoreRepository) {
  const workflows = await repo.listWorkflows();
  const out: { id: string; name: { en: string; uk: string }; published: number | null }[] = [];
  const routers: Record<string, { workflowId: string; nodeId: string; label: string | null }[]> = {};
  for (const w of workflows) {
    const prod = await publishedVersion(repo, w.id).catch(() => null);
    out.push({ id: w.id, name: w.name, published: prod?.version ?? null });
    if (w.id === SEMANTIC_WORKFLOW && prod) (routers[SEMANTIC_REGISTRY] ??= []).push({ workflowId: w.id, nodeId: 'dispatch', label: 'Зачеплений підграф після core_sync' });
    const def = prod?.definition as unknown as WorkflowDefinition | null;
    for (const n of def?.nodes ?? []) {
      const reg = routerRegistry(n);
      if (reg) (routers[reg] ??= []).push({ workflowId: w.id, nodeId: n.id, label: n.label ?? null });
    }
  }
  return { workflows: out, routers };
}

export function registerDestinationRoutes(app: Express, d: DestinationRoutesDeps): void {
  const BASE = '/api/core/workflow-destinations';
  const actor = (req: Request): CoreActor => `user:${req.principal?.id ?? 'admin'}` as CoreActor;
  const withRepo = (fn: (repo: CoreRepository, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    const repo = d.repo();
    if (!repo) return void res.status(503).json({ error: 'Семантичне ядро зараз недоступне — напрямки живуть у ньому.', kind: 'core_unavailable' });
    try {
      await fn(repo, req, res);
    } catch (err) {
      if (err instanceof CoreRuleError) return void res.status(STATUS[err.code] ?? 422).json({ error: err.message, kind: err.code });
      console.error('[workflow-destinations]', err);
      res.status(500).json({ error: (err as Error)?.message || 'Помилка реєстру напрямків', kind: 'error' });
    }
  };
  const withPublished = async (repo: CoreRepository, rows: WorkflowDestinationRow[]) =>
    Promise.all(rows.map(async (r) => ({ ...r, published: (await publishedVersion(repo, r.workflowId).catch(() => null))?.version ?? null })));

  app.get(BASE, d.requireStudio, withRepo(async (repo, req, res) => {
    const registry = typeof req.query.registry === 'string' && req.query.registry ? req.query.registry : undefined;
    const destinations = await withPublished(repo, await repo.listWorkflowDestinations({ registry }));
    res.json({ destinations, ...(await overview(repo)) });
  }));

  app.put(`${BASE}/:registry/:option`, d.requirePublish, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    const row = await repo.saveWorkflowDestination({
      registry: String(req.params.registry),
      option: String(req.params.option),
      label: { en: String(b.label?.en ?? ''), uk: String(b.label?.uk ?? '') },
      description: typeof b.description === 'string' ? b.description : '',
      workflowId: String(b.workflowId ?? ''),
      enabled: b.enabled !== false,
      updatedBy: actor(req),
    });
    const [withFlag] = await withPublished(repo, [row]);
    res.json({ destination: withFlag, ...(withFlag.published ? {} : { warning: `У процесу «${row.workflowId}» немає робочої версії — маршрутизатор цей напрямок не запропонує, доки його не опубліковано.` }) });
  }));

  app.delete(`${BASE}/:registry/:option`, d.requirePublish, withRepo(async (repo, req, res) => {
    const ok = await repo.deleteWorkflowDestination(String(req.params.registry), String(req.params.option));
    if (!ok) throw new CoreRuleError('not_found', 'Напрямок не знайдено');
    res.json({ ok: true });
  }));
}
