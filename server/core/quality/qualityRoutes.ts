/**
 * Маршрути розділу «Якість персонажів» (Т2.8 В3–В4, `PLAN_QUALITY.md`) —
 * лише для адміністратора платформи: прогін іде на справжніх моделях і
 * коштує грошей.
 *
 *   GET  /api/admin/quality/living-characters        — набір (кейси, виміри, ворота) і прогони
 *   GET  /api/admin/quality/runs/:id                 — прогін із повним звітом
 *   GET  /api/admin/quality/runs/:id/report.md       — звіт Markdown
 *   POST /api/admin/quality/runs { budgetUsd, modes } — запустити (202; один прогін за раз)
 */

import type { Express, NextFunction, Request, Response } from 'express';
import type { CoreRepository } from '../types';
import { LIVING_CHARACTERS_SET } from './controlSet';
import { QUALITY_MODES, type QualityMode, type QualityReport, type QualityRunDeps } from './livingCharacters';
import { failInterruptedRuns, startQualityRun } from './qualityRuns';
import { renderQualityReport } from './qualityReport';

export const QUALITY_BUDGET_DEFAULT_USD = 1;
export const QUALITY_BUDGET_MAX_USD = 20;

export interface QualityRoutesDeps {
  repo: () => CoreRepository | null;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
  makeDeps: (actor: string) => Promise<{ deps: QualityRunDeps; models: Record<string, unknown> }>;
}

export function registerQualityRoutes(app: Express, d: QualityRoutesDeps): void {
  let swept = false;
  const withRepo = (fn: (repo: CoreRepository, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    const repo = d.repo();
    if (!repo) {
      res.status(503).json({ error: 'Семантичне ядро зараз недоступне — журнал прогонів якості живе в ньому.', kind: 'core_unavailable' });
      return;
    }
    try {
      // Перше звернення в цьому процесі: прогони, що «йшли» до перезапуску, — перервано (до будь-якого нового запуску).
      if (!swept) {
        swept = true;
        await failInterruptedRuns(repo).catch(() => 0);
      }
      await fn(repo, req, res);
    } catch (err) {
      const code = (err as { code?: string }).code;
      res.status(code === 'conflict' ? 409 : code === 'not_found' ? 404 : code === 'bad_input' ? 400 : 500).json({ error: (err as Error).message, kind: code ?? 'error' });
    }
  };
  const set = LIVING_CHARACTERS_SET;

  app.get('/api/admin/quality/living-characters', d.requireAdmin, withRepo(async (repo, _req, res) => {
    const runs = await repo.listQualityRuns({ setId: set.id, limit: 50 });
    res.json({
      set: {
        id: set.id,
        version: set.version,
        title: set.title,
        heroes: set.book.characters.map((c) => c.name),
        cases: set.cases.map((c) => ({ id: c.id, hero: c.hero, dimension: c.dimension, question: c.question })),
        gates: set.gates,
        modes: QUALITY_MODES,
      },
      budget: { defaultUsd: QUALITY_BUDGET_DEFAULT_USD, maxUsd: QUALITY_BUDGET_MAX_USD },
      runs,
      running: runs.some((r) => r.status === 'queued' || r.status === 'running'),
    });
  }));

  app.get('/api/admin/quality/runs/:id', d.requireAdmin, withRepo(async (repo, req, res) => {
    const run = await repo.getQualityRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Прогін не знайдено.', kind: 'not_found' });
      return;
    }
    res.json({ run });
  }));

  app.get('/api/admin/quality/runs/:id/report.md', d.requireAdmin, withRepo(async (repo, req, res) => {
    const run = await repo.getQualityRun(req.params.id);
    if (!run?.report) {
      res.status(404).json({ error: 'Звіту ще немає.', kind: 'not_found' });
      return;
    }
    res.type('text/markdown; charset=utf-8').set('Content-Disposition', `attachment; filename="living-characters-${run.id.slice(0, 8)}.md"`).send(renderQualityReport(run.report as unknown as QualityReport));
  }));

  app.post('/api/admin/quality/runs', d.requireAdmin, withRepo(async (repo, req, res) => {
    const b = req.body ?? {};
    const budget = b.budgetUsd === undefined || b.budgetUsd === null || b.budgetUsd === '' ? QUALITY_BUDGET_DEFAULT_USD : Number(b.budgetUsd);
    if (!(budget > 0) || budget > QUALITY_BUDGET_MAX_USD) {
      res.status(400).json({ error: `Бюджет прогону — від $0.01 до $${QUALITY_BUDGET_MAX_USD}.`, kind: 'bad_input' });
      return;
    }
    const modes = (Array.isArray(b.modes) ? b.modes : QUALITY_MODES).filter((m: unknown): m is QualityMode => (QUALITY_MODES as string[]).includes(String(m)));
    if (!modes.length) {
      res.status(400).json({ error: `Режими — ${QUALITY_MODES.join(', ')}.`, kind: 'bad_input' });
      return;
    }
    const actor = `user:${req.principal?.id ?? 'admin'}`;
    const { deps, models } = await d.makeDeps(actor);
    const { run, done } = await startQualityRun(repo, { set, deps, actor, budgetUsd: budget, modes, models, label: deps.label });
    void done.catch((err) => console.warn('[quality] прогін не записався:', (err as Error).message));
    res.status(202).json({ run });
  }));
}
