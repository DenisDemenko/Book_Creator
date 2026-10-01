/**
 * Учасники проєкту й їхні ролі — API (Т6.1 В3, `PLAN_COLLABORATION.md`).
 *
 *   GET    /api/core/projects/:projectId/participants                   — учасники з ролями (будь-хто з доступом до книги)
 *   GET    /api/core/projects/:projectId/participants/me                — мої ролі в проєкті
 *   POST   /api/core/projects/:projectId/participants/roles             — призначити роль { userId, roleId, specialization?, projectType? } (власник / адмін)
 *   DELETE /api/core/projects/:projectId/participants/roles/:id         — відкликати (власник / адмін)
 *   GET    /api/core/projects/:projectId/participants/events            — журнал участі (власник / адмін)
 *   POST   /api/core/projects/:projectId/participants/import-legacy     — перенести project_members (адмін)
 *
 * Роль ≠ дозвіл (Onboarding §19): призначення не відкриває доступу до книги —
 * доступ і далі дає власність чи прийняте запрошення, а Т6.2 замінить його
 * наданим доступом (Access Grant).
 */

import type { Express, Request, Response } from 'express';
import type { CoreRepository } from '../types';
import { CoreRuleError } from '../rules';
import type { RealtimeAccessDeps } from '../../realtimeAuth';
import { resolveProjectAccess, type ProjectAccess } from '../projectRoutes';
import { assignRole, importLegacyMembers, participantsOf, revokeRole, rolesOf } from './participants';

export interface ParticipantRoutesDeps {
  repo: () => CoreRepository | null;
  access: RealtimeAccessDeps;
}

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, bad_actor: 403 };

export function registerParticipantRoutes(app: Express, d: ParticipantRoutesDeps): void {
  const handler =
    (need: 'member' | 'manager' | 'admin', fn: (repo: CoreRepository, access: ProjectAccess, req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      const projectId = String(req.params.projectId);
      const access = await resolveProjectAccess(req.principal as never, projectId, d.access).catch(() => null);
      if (!access) {
        res.status(req.principal && !req.principal.isGuest ? 403 : 401).json({ error: 'Немає доступу до цієї книги.', kind: 'forbidden' });
        return;
      }
      if (need === 'manager' && !access.isOwner && access.role !== 'admin') {
        res.status(403).json({ error: 'Ролі в проєкті призначає власник книги або адміністратор.', kind: 'forbidden' });
        return;
      }
      if (need === 'admin' && access.role !== 'admin') {
        res.status(403).json({ error: 'Доступно лише адміністратору.', kind: 'forbidden' });
        return;
      }
      const repo = d.repo();
      if (!repo) {
        res.status(503).json({ error: 'Семантичне ядро зараз недоступне — учасники проєкту живуть у ньому.', kind: 'core_unavailable' });
        return;
      }
      try {
        await fn(repo, access, req, res);
      } catch (err) {
        if (err instanceof CoreRuleError) {
          res.status(STATUS[err.code] ?? 422).json({ error: err.message, kind: err.code });
          return;
        }
        console.error('[participants]', err);
        res.status(500).json({ error: (err as Error)?.message || 'Помилка учасників проєкту', kind: 'error' });
      }
    };

  const base = '/api/core/projects/:projectId/participants';

  app.get(base, handler('member', async (repo, access, _req, res) => {
    res.json({ projectId: access.projectId, participants: await participantsOf(repo, access.projectId) });
  }));

  app.get(`${base}/me`, handler('member', async (repo, access, _req, res) => {
    res.json({ projectId: access.projectId, userId: access.userId, roles: await rolesOf(repo, access.projectId, access.userId), access: { isOwner: access.isOwner, canWrite: access.canWrite } });
  }));

  app.post(`${base}/roles`, handler('manager', async (repo, access, req, res) => {
    const b = req.body ?? {};
    if (typeof b.userId !== 'string' || !b.userId.trim()) throw new CoreRuleError('bad_input', 'Вкажіть userId учасника');
    if (typeof b.roleId !== 'string' || !b.roleId.trim()) throw new CoreRuleError('bad_input', 'Вкажіть roleId з реєстру ролей');
    const r = await assignRole(repo, {
      projectId: access.projectId,
      userId: b.userId.trim(),
      roleId: b.roleId.trim(),
      specialization: typeof b.specialization === 'string' && b.specialization.trim() ? b.specialization.trim() : null,
      projectType: typeof b.projectType === 'string' && b.projectType ? b.projectType : undefined,
      actor: `user:${access.userId}`,
      source: access.role === 'admin' && !access.isOwner ? 'admin' : 'manual',
    });
    res.status(r.created ? 201 : 200).json(r);
  }));

  app.delete(`${base}/roles/:id`, handler('manager', async (repo, access, req, res) => {
    res.json({ role: await revokeRole(repo, { projectId: access.projectId, assignmentId: String(req.params.id), actor: `user:${access.userId}` }) });
  }));

  app.get(`${base}/events`, handler('manager', async (repo, access, _req, res) => {
    res.json({ events: await repo.listCollabEvents(access.projectId, { limit: 200 }) });
  }));

  app.post(`${base}/import-legacy`, handler('admin', async (repo, access, _req, res) => {
    res.json(await importLegacyMembers(repo, access.projectId, `user:${access.userId}`));
  }));
}
