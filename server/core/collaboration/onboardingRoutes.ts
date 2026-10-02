/**
 * Role Onboarding — API (Т6.3 В2, `PLAN_ROLE_ONBOARDING.md`; ТЗ Role
 * Onboarding §4 шлюз, §20 підтвердження власником, §25 збереження, §28).
 *
 *   GET  /api/core/onboarding/gate?projectId=               — чи потрібен майстер (і чернетка, запит, ролі)
 *   POST /api/core/onboarding/sessions                      — почати / продовжити { source, projectId?, projectType?, orderId? }
 *   GET  /api/core/onboarding/sessions/:id                  — своя сесія
 *   PUT  /api/core/onboarding/sessions/:id/steps/:step      — зберегти крок { answers, expectedRevision? }
 *   POST /api/core/onboarding/sessions/:id/complete         — завершити
 *   POST /api/core/onboarding/sessions/:id/cancel           — скасувати
 *   POST /api/core/onboarding/events                        — «увійшов у Студію» (studio_entered)
 *   GET  /api/core/onboarding/requests                      — мої запити доступу
 *   GET  /api/core/projects/:projectId/access-requests      — запити до проєкту (власник, адмін, керування)
 *   POST /api/core/projects/:projectId/access-requests/:id/decide — { action: approve|modify|reject, level?, scopeType?, scopeRefs?, mediaWork?, validUntil?, reason? }
 *   POST /api/core/projects/:projectId/access-requests/:id/cancel — відкликати свій запит
 *
 * Сесії й запити — лише свої; вирішує власник книги, адміністратор або
 * учасник із правом керування. Схвалення = наданий доступ Т6.2, і людину в
 * кімнаті перепідключає (`onAccessChanged`).
 */

import type { Express, Request, RequestHandler, Response } from 'express';
import type { AccessLevel, CoreRepository, OnboardingSource } from '../types';
import { ACCESS_LEVELS, ONBOARDING_SOURCES } from '../types';
import { CoreRuleError } from '../rules';
import type { RealtimeAccessDeps } from '../../realtimeAuth';
import { isValidBookId } from '../../realtimeAuth';
import { resolveProjectAccess } from '../projectRoutes';
import type { BookIndex } from './access';
import type { BookOutline } from './routes';
import {
  cancelAccessRequest,
  cancelOnboarding,
  completeOnboarding,
  decideAccessRequest,
  onboardingGate,
  saveOnboardingStep,
  startOnboarding,
  type OnboardingDeps,
} from './onboarding';

export interface OnboardingRoutesDeps {
  repo: () => CoreRepository | null;
  access: RealtimeAccessDeps;
  requireAuth: RequestHandler;
  onboarding: OnboardingDeps;
  /** Автоматичний показ майстра (ROLE_ONBOARDING ≠ off). */
  enabled: () => boolean;
  /** Курс → проєкт ядра (`course-<id>`), якщо його ще немає. */
  ensureProject?: (projectId: string) => Promise<void>;
  bookOutline?: (projectId: string) => Promise<BookOutline | null>;
  describeUser?: (userId: string) => Promise<{ name?: string; email?: string } | null>;
  onAccessChanged?: (projectId: string, userId: string) => void;
}

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, bad_actor: 403 };
/** Точки, де проєкту ще може не бути на сервері (людина його щойно створює). */
const CREATING: OnboardingSource[] = ['create_project', 'import_project', 'first_login', 'manual', 'new_studio'];

export function registerOnboardingRoutes(app: Express, d: OnboardingRoutesDeps): void {
  const run =
    (fn: (repo: CoreRepository, who: { userId: string; isAdmin: boolean }, req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      const p = req.principal;
      if (!p || p.isGuest || !p.id) {
        res.status(401).json({ error: 'Потрібен вхід у систему.', kind: 'unauthenticated' });
        return;
      }
      const repo = d.repo();
      if (!repo) {
        res.status(503).json({ error: 'Семантичне ядро зараз недоступне — опитувальник ролі живе в ньому.', kind: 'core_unavailable' });
        return;
      }
      try {
        await fn(repo, { userId: p.id, isAdmin: p.role === 'admin' }, req, res);
      } catch (err) {
        if (err instanceof CoreRuleError) {
          res.status(STATUS[err.code] ?? 422).json({ error: err.message, kind: err.code, issues: (err as any).issues });
          return;
        }
        console.error('[onboarding]', err);
        res.status(500).json({ error: (err as Error)?.message || 'Помилка опитувальника ролі', kind: 'error' });
      }
    };

  const projectParam = (v: unknown): string | null => {
    if (v === undefined || v === null || v === '') return null;
    const id = String(v);
    if (!isValidBookId(id)) throw new CoreRuleError('bad_input', 'Неправильний id проєкту');
    return id;
  };

  app.get('/api/core/onboarding/gate', d.requireAuth, run(async (repo, who, req, res) => {
    const projectId = projectParam(req.query.projectId);
    if (projectId) await d.ensureProject?.(projectId).catch(() => {});
    const gate = await onboardingGate(repo, d.onboarding, who, { projectId, enabled: d.enabled() });
    res.json({ enabled: d.enabled(), ...gate });
  }));

  app.post('/api/core/onboarding/sessions', d.requireAuth, run(async (repo, who, req, res) => {
    const b = req.body ?? {};
    const source = String(b.source ?? 'manual') as OnboardingSource;
    if (!(ONBOARDING_SOURCES as readonly string[]).includes(source)) throw new CoreRuleError('bad_input', `Невідома точка запуску «${source}»`);
    const projectId = projectParam(b.projectId);
    if (projectId) {
      await d.ensureProject?.(projectId).catch(() => {});
      const owner = await d.onboarding.ownerOf(projectId);
      if (owner === null && !CREATING.includes(source)) throw new CoreRuleError('not_found', 'Проєкт не знайдено — перевірте посилання');
    }
    const orderId = typeof b.orderId === 'string' && b.orderId.trim() ? b.orderId.trim().slice(0, 200) : null;
    const r = await startOnboarding(repo, d.onboarding, who, {
      userId: who.userId,
      source: orderId && source === 'marketplace' ? 'marketplace' : source,
      projectId,
      projectType: typeof b.projectType === 'string' && b.projectType ? b.projectType : null,
      orderId,
    });
    res.status(r.resumed ? 200 : 201).json(r);
  }));

  const own = async (repo: CoreRepository, userId: string, id: string) => {
    const s = await repo.getOnboardingSession(id);
    if (!s || s.userId !== userId) throw new CoreRuleError('not_found', 'Опитувальник не знайдено');
    return s;
  };

  app.get('/api/core/onboarding/sessions/:id', d.requireAuth, run(async (repo, who, req, res) => {
    res.json({ session: await own(repo, who.userId, String(req.params.id)) });
  }));

  app.put('/api/core/onboarding/sessions/:id/steps/:step', d.requireAuth, run(async (repo, who, req, res) => {
    const b = req.body ?? {};
    const r = await saveOnboardingStep(repo, d.onboarding, who, { sessionId: String(req.params.id), step: Number(req.params.step), answers: b.answers ?? {}, expectedRevision: typeof b.expectedRevision === 'number' ? b.expectedRevision : undefined });
    res.json(r);
  }));

  app.post('/api/core/onboarding/sessions/:id/complete', d.requireAuth, run(async (repo, who, req, res) => {
    const b = req.body ?? {};
    const r = await completeOnboarding(repo, d.onboarding, who, { sessionId: String(req.params.id), expectedRevision: typeof b.expectedRevision === 'number' ? b.expectedRevision : undefined });
    res.json(r);
  }));

  app.post('/api/core/onboarding/sessions/:id/cancel', d.requireAuth, run(async (repo, who, req, res) => {
    res.json({ session: await cancelOnboarding(repo, who, String(req.params.id)) });
  }));

  app.post('/api/core/onboarding/events', d.requireAuth, run(async (repo, who, req, res) => {
    const b = req.body ?? {};
    if (b.event !== 'studio_entered') throw new CoreRuleError('bad_input', 'З клієнта — лише studio_entered');
    const projectId = projectParam(b.projectId);
    await repo.addOnboardingEvent({ userId: who.userId, projectId, event: 'studio_entered', details: { tab: typeof b.tab === 'string' ? b.tab.slice(0, 60) : null } });
    res.status(201).json({ ok: true });
  }));

  app.get('/api/core/onboarding/requests', d.requireAuth, run(async (repo, who, _req, res) => {
    res.json({ requests: await repo.listAccessRequests({ userId: who.userId, limit: 100 }) });
  }));

  // ── Запити доступу до проєкту ─────────────────────────────────────────────

  const manager = async (req: Request) => {
    const projectId = String(req.params.projectId);
    if (!isValidBookId(projectId)) throw new CoreRuleError('bad_input', 'Неправильний id проєкту');
    await d.ensureProject?.(projectId).catch(() => {});
    const access = await resolveProjectAccess(req.principal as never, projectId, d.access).catch(() => null);
    if (!access || !(access.isOwner || access.role === 'admin' || access.effective.book === 'manage')) {
      throw new CoreRuleError('bad_actor', 'Запити доступу розглядає власник книги, адміністратор або учасник із правом керування');
    }
    return access;
  };

  app.get('/api/core/projects/:projectId/access-requests', d.requireAuth, run(async (repo, _who, req, res) => {
    const access = await manager(req);
    const status = typeof req.query.status === 'string' && req.query.status ? (req.query.status as any) : undefined;
    const requests = await repo.listAccessRequests({ projectId: access.projectId, status, limit: 200 });
    const users: Record<string, { name?: string; email?: string } | null> = {};
    for (const r of requests) if (!(r.userId in users)) users[r.userId] = d.describeUser ? await d.describeUser(r.userId).catch(() => null) : null;
    res.json({ requests, users, outline: d.bookOutline ? await d.bookOutline(access.projectId).catch(() => null) : null });
  }));

  app.post('/api/core/projects/:projectId/access-requests/:id/decide', d.requireAuth, run(async (repo, _who, req, res) => {
    const access = await manager(req);
    const b = req.body ?? {};
    const action = b.action;
    if (action !== 'approve' && action !== 'modify' && action !== 'reject') throw new CoreRuleError('bad_input', 'Рішення — approve, modify або reject');
    if (b.level !== undefined && !(ACCESS_LEVELS as readonly string[]).includes(b.level)) throw new CoreRuleError('bad_input', `Невідомий рівень «${b.level}»`);
    let bookIndex: BookIndex | null = null;
    const outline = d.bookOutline ? await d.bookOutline(access.projectId).catch(() => null) : null;
    if (outline) bookIndex = new Map(outline.chapters.map((c) => [c.id, c.sections.map((s) => s.id)]));
    const request = await decideAccessRequest(repo, {
      projectId: access.projectId,
      requestId: String(req.params.id),
      decider: { userId: access.userId, isOwner: access.isOwner, isAdmin: access.role === 'admin' },
      action,
      level: b.level as AccessLevel | undefined,
      scopeType: typeof b.scopeType === 'string' ? b.scopeType : undefined,
      scopeRefs: Array.isArray(b.scopeRefs) ? b.scopeRefs.map(String).slice(0, 100) : undefined,
      mediaWork: typeof b.mediaWork === 'boolean' ? b.mediaWork : undefined,
      validUntil: typeof b.validUntil === 'string' && b.validUntil ? b.validUntil : null,
      reason: typeof b.reason === 'string' ? b.reason : '',
      bookIndex,
    });
    if (request.status !== 'rejected') d.onAccessChanged?.(access.projectId, request.userId);
    res.json({ request });
  }));

  app.post('/api/core/projects/:projectId/access-requests/:id/cancel', d.requireAuth, run(async (repo, who, req, res) => {
    const projectId = String(req.params.projectId);
    if (!isValidBookId(projectId)) throw new CoreRuleError('bad_input', 'Неправильний id проєкту');
    res.json({ request: await cancelAccessRequest(repo, who, projectId, String(req.params.id)) });
  }));
}
