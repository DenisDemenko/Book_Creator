/**
 * Маршрутизатор процесів ШІ — серверний шар (Т6.4 В2, `PLAN_ROLE_STUDIO.md`;
 * ТЗ Role Onboarding §21–22; критерії №21, 22).
 *
 * Проміжний шар на точках ШІ (`AI_ROUTED_PREFIXES`): книга з тіла запиту
 * (`bookId`, `book_id`, курс майстра — `course-<id>`), людина — з облікового
 * запису. Якщо проєкт є в ядрі:
 *   • ОХОРОНА: людина без доступу до проєкту (учасник із нерозглянутим
 *     запитом, вийшов, відкликано, чужа книга) → 403 `no_project_access` —
 *     ШІ не працює з книгою, якої людина не бачить;
 *   • МАРШРУТ: ролі й простори (`myRoleView`), обраний простір, допомога ШІ,
 *     область (частина проєкту чи весь) → `routeAiWorkflow` → `req.aiRoute`;
 *     `generateText` і чат дописують інструкцію процесу до системного промту.
 * Права маршрут не розширює: він лише налаштовує модель.
 * Книги поза ядром (лише на пристрої) — без змін. Кеш на людину й проєкт — 30 с.
 *
 *   GET /api/core/projects/:projectId/ai-route?task=… — маршрут для Студії
 */

import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { CoreRepository } from '../types';
import type { RealtimeAccessDeps } from '../../realtimeAuth';
import { isValidBookId } from '../../realtimeAuth';
import { resolveProjectAccess } from '../projectRoutes';
import { levelRank } from './access';
import { myRoleView, type MyRoleView } from './myRole';
import { AI_ROUTED_PREFIXES, AI_TASKS, routeAiWorkflow, taskForEndpoint, type AiRoute, type AiTask } from '../../../src/utils/aiWorkflows';

export interface AiRouteDeps {
  repo: () => CoreRepository | null;
  access: RealtimeAccessDeps;
  /** Курс → проєкт ядра (`course-<id>`), якщо його ще немає. */
  ensureProject?: (projectId: string) => Promise<void>;
  /** Час для кешу (тести). */
  now?: () => number;
}

export type AiRouteResult = { kind: 'none' } | { kind: 'forbidden' } | { kind: 'route'; route: AiRoute; view: MyRoleView };

declare module 'express-serve-static-core' {
  interface Request {
    /** Т6.4: процес ШІ для цього запиту (див. server/core/collaboration/aiRoute.ts). */
    aiRoute?: AiRoute | null;
  }
}

const TTL_MS = 30_000;

export function createAiRouter(deps: AiRouteDeps) {
  const cache = new Map<string, { at: number; value: Exclude<AiRouteResult, { kind: 'route' }> | { kind: 'ctx'; view: MyRoleView; scope: 'project' | 'partial'; orderId: string | null } }>();
  const now = () => (deps.now ? deps.now() : Date.now());

  /** Контекст людини в проєкті (без завдання) — кешується. */
  async function context(principal: Request['principal'], projectId: string) {
    if (!principal || principal.isGuest || !principal.id) return { kind: 'none' as const };
    const repo = deps.repo();
    if (!repo) return { kind: 'none' as const };
    const key = `${principal.id}\u0000${principal.role}\u0000${projectId}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    let value: NonNullable<ReturnType<typeof cache.get>>['value'];
    if (projectId.startsWith('course-')) await deps.ensureProject?.(projectId).catch(() => {});
    const project = await repo.getProject(projectId);
    if (!project) value = { kind: 'none' };
    else {
      let access = await resolveProjectAccess(principal as never, projectId, deps.access).catch(() => null);
      // Власник за записом ядра (серверної копії книги ще чи вже немає) — не відмова.
      if (!access && project.ownerId === principal.id) {
        const r = await resolveProjectAccess(principal as never, projectId, { ...deps.access, getCollabOwnerId: async () => project.ownerId }).catch(() => null);
        access = r;
      }
      if (!access) value = { kind: 'forbidden' };
      else {
        const isAdmin = access.role === 'admin';
        const view = await myRoleView(repo, { projectId, userId: access.userId, isOwner: access.isOwner, isAdmin });
        const full = access.isOwner || isAdmin || access.effective.full;
        const scope = full || levelRank(access.effective.book) >= levelRank('view') ? 'project' : 'partial';
        const pref = await repo.getParticipantPreference(access.userId, projectId);
        const participant = await repo.getParticipant(projectId, access.userId);
        const orderId = participant?.source === 'freelance_order' ? participant.sourceRef ?? null : null;
        value = { kind: 'ctx', view: { ...view, roleDetails: pref?.roleDetails ?? view.roleDetails }, scope, orderId };
      }
    }
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: now(), value });
    return value;
  }

  async function resolve(principal: Request['principal'], projectId: string | null | undefined, task: AiTask): Promise<AiRouteResult> {
    if (!projectId || !isValidBookId(projectId)) return { kind: 'none' };
    const c = await context(principal, projectId);
    if (c.kind !== 'ctx') return c;
    const route = routeAiWorkflow({
      workspaces: c.view.workspaces,
      activeWorkspace: c.view.activeWorkspace,
      projectType: c.view.projectType,
      task,
      scope: c.scope,
      aiAssistance: c.view.aiAssistance,
      roleDetails: c.view.roleDetails,
      orderId: c.orderId,
      isOwner: c.view.isOwner,
    });
    return route ? { kind: 'route', route, view: c.view } : { kind: 'none' };
  }

  /** Зміна ролей, простору чи доступу людини — скинути кеш (усіх її проєктів). */
  function forget(userId?: string) {
    if (!userId) return cache.clear();
    for (const k of cache.keys()) if (k.startsWith(`${userId}\u0000`)) cache.delete(k);
  }

  return { resolve, forget };
}
export type AiRouter = ReturnType<typeof createAiRouter>;

/** Книга з тіла / рядка запиту точки ШІ. */
export function projectIdFromRequest(req: Request): string | null {
  const b = (req.body ?? {}) as Record<string, any>;
  const q = (req.query ?? {}) as Record<string, any>;
  const raw = b.bookId ?? b.book_id ?? q.bookId ?? q.book_id ?? (b.course && typeof b.course === 'object' && typeof b.course.id === 'string' && b.course.id ? `course-${b.course.id}` : null) ?? b.courseProjectId;
  return typeof raw === 'string' && raw ? raw : null;
}

export const isAiRoutedPath = (path: string): boolean => AI_ROUTED_PREFIXES.some((p) => path.startsWith(p));

/** Проміжний шар: охорона й маршрут (лише POST — читання стану задач не маршрутизуються). */
export function aiRouteMiddleware(router: AiRouter): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST' || !isAiRoutedPath(req.path)) return next();
    try {
      const r = await router.resolve(req.principal, projectIdFromRequest(req), taskForEndpoint(req.path));
      if (r.kind === 'forbidden') {
        res.status(403).json({ error: 'Немає доступу до цієї книги — ШІ не працює з нею.', kind: 'no_project_access' });
        return;
      }
      if (r.kind === 'route') {
        req.aiRoute = r.route;
        res.setHeader('X-Nova-AI-Workflow', `${r.route.workflow}; task=${r.route.task}; fit=${r.route.fit}`);
      }
    } catch (err) {
      // Збій маршрутизатора не зупиняє ШІ: інструкції не буде, права — як і були (перевіряє сам модуль).
      console.warn('[ai-route]', (err as Error)?.message ?? err);
    }
    next();
  };
}

export function registerAiRouteRoutes(app: Express, d: { router: AiRouter; requireAuth: RequestHandler }): void {
  app.get('/api/core/projects/:projectId/ai-route', d.requireAuth, async (req, res) => {
    const projectId = String(req.params.projectId);
    if (!isValidBookId(projectId)) return void res.status(422).json({ error: 'Неправильний id проєкту', kind: 'bad_input' });
    const task = (AI_TASKS as readonly string[]).includes(String(req.query.task)) ? (String(req.query.task) as AiTask) : 'chat';
    try {
      const r = await d.router.resolve(req.principal, projectId, task);
      if (r.kind === 'forbidden') return void res.status(403).json({ error: 'Немає доступу до цієї книги.', kind: 'no_project_access' });
      res.json({ projectId, task, route: r.kind === 'route' ? r.route : null });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || 'Помилка маршрутизатора ШІ', kind: 'error' });
    }
  });
}
