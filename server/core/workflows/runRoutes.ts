import type {WorkflowDefinition} from '../../../src/utils/workflowGraph';
import {collaborationDomainEvents} from '../collaboration/domainEvents';
/**
 * Запуски процесів ШІ — API Graph Studio (Т5.4 В3, `PLAN_WORKFLOW_ENGINE.md`;
 * ТЗ Graph Studio §27, §31, §39 №24; рішення власника §2 п.3).
 *
 *   GET  /api/core/workflow-runs?workflowId=&projectId=&status=&limit=  — журнал запусків        (Graph Studio)
 *   GET  /api/core/workflow-runs/:runId                                 — запуск, кроки, визначення (Graph Studio)
 *   POST /api/core/workflow-runs                                        — ручний запуск { workflowId, input?, projectId?, versionId? }
 *   POST /api/core/workflow-runs/:runId/pause                           — призупинити
 *   POST /api/core/workflow-runs/:runId/resume                          — продовжити
 *   POST /api/core/workflow-runs/:runId/cancel                          — скасувати призупинений
 *   POST /api/core/workflow-runs/:runId/replay                          — повторити (та сама версія й вхід)
 *   POST /api/core/workflow-runs/:runId/fork  { afterStep }             — відгалузити від кроку
 *
 * Бачать і керують — адмін і ті, кому видано право публікації схем. Дії, що
 * запускають граф, відповідають одразу (202) — виконання йде у фоні, журнал
 * показує його стан.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import type { CoreActor, CoreRepository, WorkflowRunRow, WorkflowRunStatus } from '../types';
import { WORKFLOW_RUN_STATUSES } from '../types';
import { CoreRuleError } from '../rules';
import { cancelRun, forkRun, replayRun, requestPause, resumeRun, startRun, type EngineDeps, type RunOutcome } from './engine/runner';

import {workflowAnalytics,workflowFeedback,evaluateFeedback} from './observability';

type Mw = (req: Request, res: Response, next: NextFunction) => void;

export interface WorkflowRunRoutesDeps {
  repo: () => CoreRepository | null;
  engine: () => EngineDeps | null;
  requireStudio: Mw;
  requireControl: Mw;
}

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, bad_actor: 403 };

export function registerWorkflowRunRoutes(app: Express, d: WorkflowRunRoutesDeps): void {
  const BASE = '/api/core/workflow-runs';
  const actor = (req: Request): CoreActor => `user:${req.principal?.id ?? 'admin'}` as CoreActor;
  const fail = (res: Response, err: unknown) => {
    if (err instanceof CoreRuleError) return void res.status(STATUS[err.code] ?? 422).json({ error: err.message, kind: err.code });
    console.error('[workflow-runs]', err);
    res.status(500).json({ error: (err as Error)?.message || 'Помилка запуску процесу ШІ', kind: 'error' });
  };
  const withRepo = (fn: (repo: CoreRepository, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    const repo = d.repo();
    if (!repo) return void res.status(503).json({ error: 'Семантичне ядро зараз недоступне — запуски процесів живуть у ньому.', kind: 'core_unavailable' });
    try {
      await fn(repo, req, res);
    } catch (err) {
      fail(res, err);
    }
  };
  const withEngine = (fn: (engine: EngineDeps, req: Request, res: Response) => Promise<void>) => withRepo(async (_repo, req, res) => {
    const engine = d.engine();
    if (!engine) return void res.status(503).json({ error: 'Рушій процесів ШІ недоступний.', kind: 'core_unavailable' });
    await fn(engine, req, res);
  });

  /**
   * Запустити граф у фоні й відповісти, щойно є рядок запуску. Помилка до
   * створення запуску — звичайна відповідь з помилкою.
   */
  const background = (res: Response, go: (onCreated: (run: WorkflowRunRow) => void) => Promise<RunOutcome>) => {
    let answered = false;
    const onCreated = (run: WorkflowRunRow) => {
      if (answered) return;
      answered = true;
      res.status(202).json({ run });
    };
    go(onCreated)
      .then((out) => {
        if (!answered) {
          answered = true;
          res.status(202).json({ run: out.run });
        }
      })
      .catch((err) => {
        if (!answered) {
          answered = true;
          fail(res, err);
        } else console.error('[workflow-runs] фонове виконання', err);
      });
  };

  const scope = async (repo:CoreRepository,req:Request) => {
    const projectId=typeof req.query.projectId==='string'?req.query.projectId:'';
    const workflowId=typeof req.query.workflowId==='string'?req.query.workflowId:undefined;
    if(!projectId)throw new CoreRuleError('bad_input','Оберіть книгу для аналітики та feedback.');
    const engine=d.engine();
    if(!await engine?.services.canInspectWorkflowProject?.(actor(req),projectId))throw new CoreRuleError('bad_actor','Feedback доступний власнику та адміністратору книги.');
    return {projectId,workflowId};
  };
  app.get(`${BASE}/analytics`,d.requireStudio,withRepo(async(repo,req,res)=>{
    res.set('Cache-Control','no-store');res.json(await workflowAnalytics(repo,await scope(repo,req)));
  }));
  app.get(`${BASE}/feedback`,d.requireStudio,withRepo(async(repo,req,res)=>{
    res.set('Cache-Control','no-store');const f=await scope(repo,req);res.json({rows:await workflowFeedback(repo,f.projectId,f.workflowId),limit:1000,selfTraining:false});
  }));
  app.post(`${BASE}/feedback/evaluate`,d.requireControl,withRepo(async(repo,req,res)=>{
    res.set('Cache-Control','no-store');const f=await scope(repo,req);res.json(await evaluateFeedback(repo,f.projectId,f.workflowId,req.body?.cases));
  }));

  app.get(BASE, d.requireStudio, withRepo(async (repo, req, res) => {
    const status = typeof req.query.status === 'string' && (WORKFLOW_RUN_STATUSES as readonly string[]).includes(req.query.status) ? (req.query.status as WorkflowRunStatus) : undefined;
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const runs = await repo.listWorkflowRuns({
      workflowId: typeof req.query.workflowId === 'string' && req.query.workflowId ? req.query.workflowId : undefined,
      projectId: typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : undefined,
      status,
      limit,
    });
    res.json({ runs });
  }));

  app.get(`${BASE}/:runId`, d.requireStudio, withRepo(async (repo, req, res) => {
    const run = await repo.getWorkflowRun(String(req.params.runId));
    if (!run) throw new CoreRuleError('not_found', 'Запуск не знайдено');
    const [steps, version, children] = await Promise.all([
      repo.listWorkflowSteps(run.id),
      repo.getWorkflowVersion(run.versionId),
      repo.listWorkflowRuns({ parentRunId: run.id, limit: 200 }).then((all) => all.map((r) => ({ id: r.id, workflowId: r.workflowId, mode: r.mode, status: r.status, createdAt: r.createdAt }))),
    ]);
    const parent = run.parentRunId ? await repo.getWorkflowRun(run.parentRunId) : null;
    // Перечитування після конфлікту має показувати актуальний зміст і ревізію.
    const pending = run.output?.review as { proposalId?: string } | undefined;
    const proposal = run.status === 'paused' && run.projectId && pending?.proposalId
      ? await repo.getStoryProposal(run.projectId, pending.proposalId) : null;
    const viewRun = proposal ? { ...run, output: { ...run.output, review: {
      ...pending, expectedRevision: proposal.revision, payload: proposal.payload,
      evidence: proposal.evidence, validation: proposal.validation, confidence: proposal.confidence,
      provenance: proposal.provenance,
    } } } : run;
    let records:{entities:string[];relations:string[];available:boolean}={entities:[],relations:[],available:false};
    if(run.projectId&&await d.engine()?.services.canInspectWorkflowProject?.(actor(req),run.projectId)){
      const proposals=(await repo.listStoryProposals(run.projectId,{limit:1000})).filter(p=>p.provenance.runId===run.id&&p.state==='canon'&&p.canonRef);
      records={entities:proposals.filter(p=>p.kind==='entity').map(p=>p.canonRef!),relations:proposals.filter(p=>p.kind==='relation').map(p=>p.canonRef!),available:true};
    }
    res.json({
      run: viewRun,
      records,
      steps,
      version: version ? { id: version.id, version: version.version, environment: version.environment, definition: version.definition } : null,
      parent: parent ? { id: parent.id, workflowId: parent.workflowId, status: parent.status, mode: parent.mode } : null,
      children,
    });
  }));

  app.post(BASE, d.requireControl, withEngine(async (engine, req, res) => {
    const b = req.body ?? {};
    if (typeof b.workflowId !== 'string' || !b.workflowId) throw new CoreRuleError('bad_input', 'Оберіть процес');
    const input = b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {};
    if(input.collaborationEventId!==undefined){
      const projectId=typeof b.projectId==='string'?b.projectId:'';
      if(!projectId||!await engine.services.canInspectWorkflowProject?.(actor(req),projectId))throw new CoreRuleError('bad_actor','Подія співпраці потребує повного доступу книги.');
      const event=(await collaborationDomainEvents(engine.repo,projectId)).find(e=>e.id===input.collaborationEventId);
      if(!event)throw new CoreRuleError('not_found','Подію не знайдено в цій книзі.');
      const type=event.type;
      const published=(await engine.repo.listWorkflowVersions(b.workflowId)).find(v=>v.environment==='production');
      const def=published?await engine.repo.getWorkflowVersion(published.id):null;
      if(!(def?.definition as unknown as WorkflowDefinition|undefined)?.nodes.some(n=>n.type==='START'&&Array.isArray(n.params?.collaboration_events)&&n.params.collaboration_events.includes(type)))throw new CoreRuleError('bad_input','Production-процес не підписаний на цю подію.');
      for(const k of Object.keys(input))delete input[k];
      Object.assign(input,{collaborationEvent:event});
      // Event dispatch always uses the current published definition, never client-selected drafts.
      b.versionId=undefined;
    }
    background(res, (onCreated) => startRun(engine, {
      workflowId: b.workflowId,
      input,
      projectId: typeof b.projectId === 'string' && b.projectId ? b.projectId : null,
      versionId: typeof b.versionId === 'string' && b.versionId ? b.versionId : undefined,
      trigger: 'manual',
      actor: actor(req),
      onCreated,
    }));
  }));

  app.post(`${BASE}/:runId/pause`, d.requireControl, withRepo(async (repo, req, res) => {
    res.json({ run: await requestPause(repo, String(req.params.runId)) });
  }));

  app.post(`${BASE}/:runId/cancel`, d.requireControl, withRepo(async (repo, req, res) => {
    res.json({ run: await cancelRun(repo, String(req.params.runId)) });
  }));

  app.post(`${BASE}/:runId/resume`, d.requireControl, withEngine(async (engine, req, res) => {
    const run = await engine.repo.getWorkflowRun(String(req.params.runId));
    if (!run) throw new CoreRuleError('not_found', 'Запуск не знайдено');
    if (run.status !== 'paused') throw new CoreRuleError('conflict', 'Продовжити можна лише призупинений запуск');
    background(res, async (onCreated) => {
      const p = resumeRun(engine, run.id, actor(req),{review:req.body?.review});
      // Той самий запуск — відповідаємо, щойно рушій підхопив його.
      setTimeout(async () => onCreated((await engine.repo.getWorkflowRun(run.id)) ?? run), 50);
      return p;
    });
  }));

  app.post(`${BASE}/:runId/replay`, d.requireControl, withEngine(async (engine, req, res) => {
    background(res, (onCreated) => replayRun(engine, String(req.params.runId), actor(req), onCreated));
  }));

  app.post(`${BASE}/:runId/fork`, d.requireControl, withEngine(async (engine, req, res) => {
    const afterStep = Number((req.body ?? {}).afterStep);
    background(res, (onCreated) => forkRun(engine, String(req.params.runId), afterStep, actor(req), onCreated));
  }));
}
