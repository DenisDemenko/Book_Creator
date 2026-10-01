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
 * Наданий доступ (Т6.2 В3, `PLAN_ACCESS.md`):
 *   GET    /api/core/projects/:projectId/access              — мій доступ; керівнику — учасники з доступами й цілі (розділи, сцени, герої, локації)
 *   POST   /api/core/projects/:projectId/access              — надати { userId, level, scopeType, scopeRef?, validUntil? }
 *   DELETE /api/core/projects/:projectId/access/:grantId     — відкликати
 *   GET    /api/core/projects/:projectId/access/events       — журнал надань і відкликань
 * Керує доступом власник книги, адміністратор або учасник із правом керування
 * (manage) на книгу; зміна доступу перепідключає людину в кімнаті.
 *
 * Роль ≠ дозвіл (Onboarding §19): призначення не відкриває доступу до книги —
 * доступ дає власність або наданий доступ (Access Grant, Т6.2); прийняте
 * запрошення один раз переноситься в доступ на книгу.
 */

import type { Express, Request, Response } from 'express';
import type { CoreRepository } from '../types';
import { CoreRuleError } from '../rules';
import type { RealtimeAccessDeps } from '../../realtimeAuth';
import { resolveProjectAccess, type ProjectAccess } from '../projectRoutes';
import { assignRole, importLegacyMembers, participantsOf, revokeRole, rolesOf } from './participants';
import { describeAccess, grantAccess, revokeAccess, type BookIndex, type Granter } from './access';
import { ACCESS_LEVELS, ACCESS_SCOPES, type AccessLevel, type AccessScope } from '../types';

/** Структура книги для вибору цілі доступу: розділи й сцени з назвами. */
export interface BookOutline {
  chapters: Array<{ id: string; title: string; sections: Array<{ id: string; title: string }> }>;
}

export interface ParticipantRoutesDeps {
  repo: () => CoreRepository | null;
  access: RealtimeAccessDeps;
  /** Т6.2: розділи й сцени книги (серверна копія власника) — для цілей доступу. */
  bookOutline?: (projectId: string) => Promise<BookOutline | null>;
  /** Т6.2: ім'я й пошта людини — для панелі «Доступ». */
  describeUser?: (userId: string) => Promise<{ name?: string; email?: string } | null>;
  /** Т6.2: доступ людини змінився — перепідключити її в кімнаті. */
  onAccessChanged?: (projectId: string, userId: string) => void;
}

/** Області, які застосовуються зараз (рішення власника §2 п.2); решта — у моделі, Т7. */
export const ACTIVE_ACCESS_SCOPES: AccessScope[] = ['book', 'chapter', 'scene', 'character', 'location', 'media_library'];

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

  // ── Т6.2 В3: наданий доступ ─────────────────────────────────────────────────

  const accessBase = '/api/core/projects/:projectId/access';
  const granterOf = (access: ProjectAccess): Granter => ({ userId: access.userId, isOwner: access.isOwner, isAdmin: access.role === 'admin' });
  const canManage = (access: ProjectAccess) => access.isOwner || access.role === 'admin' || access.effective.book === 'manage';
  const indexOf = (outline: BookOutline | null): BookIndex | null =>
    outline ? new Map(outline.chapters.map((c) => [c.id, c.sections.map((s) => s.id)])) : null;

  app.get(accessBase, handler('member', async (repo, access, _req, res) => {
    const me = { userId: access.userId, isOwner: access.isOwner, role: access.role, effective: describeAccess(access.effective) };
    const meta = { levels: ACCESS_LEVELS, scopes: ACTIVE_ACCESS_SCOPES, modelScopes: ACCESS_SCOPES };
    if (!canManage(access)) {
      res.json({ projectId: access.projectId, canManage: false, me, participants: [], targets: null, ...meta });
      return;
    }
    const [people, grants, outline, characters, locations] = await Promise.all([
      participantsOf(repo, access.projectId),
      repo.listAccessGrants({ projectId: access.projectId }),
      d.bookOutline ? d.bookOutline(access.projectId).catch(() => null) : Promise.resolve(null),
      repo.listEntities(access.projectId, 'character'),
      repo.listEntities(access.projectId, 'location'),
    ]);
    const participants = await Promise.all(people.map(async (p) => ({
      ...p,
      user: d.describeUser ? await d.describeUser(p.participant.userId).catch(() => null) : null,
      grants: grants
        .filter((g) => g.participantId === p.participant.id)
        .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'active' ? -1 : 1)),
    })));
    const live = (e: { status: string }) => e.status !== 'rejected';
    res.json({
      projectId: access.projectId,
      canManage: true,
      me,
      participants,
      targets: {
        chapters: outline?.chapters ?? [],
        characters: characters.filter(live).map((e) => ({ id: e.id, name: e.name })),
        locations: locations.filter(live).map((e) => ({ id: e.id, name: e.name })),
      },
      ...meta,
    });
  }));

  app.post(accessBase, handler('member', async (repo, access, req, res) => {
    if (!canManage(access)) throw new CoreRuleError('bad_actor', 'Надавати доступ може власник книги, адміністратор або учасник із правом керування');
    const b = req.body ?? {};
    if (typeof b.userId !== 'string' || !b.userId.trim()) throw new CoreRuleError('bad_input', 'Вкажіть, кому надати доступ (userId)');
    if (!(ACTIVE_ACCESS_SCOPES as string[]).includes(b.scopeType)) throw new CoreRuleError('bad_input', `Область «${b.scopeType}» поки не застосовується (стиль-біблія, завдання, результати — Т7)`);
    const outline = d.bookOutline ? await d.bookOutline(access.projectId).catch(() => null) : null;
    if ((b.scopeType === 'chapter' || b.scopeType === 'scene') && !outline) throw new CoreRuleError('conflict', 'Серверної копії книги немає — розділи й сцени перевірити нема з чим. Збережіть книгу на сервері.');
    const grant = await grantAccess(repo, {
      projectId: access.projectId,
      granter: granterOf(access),
      userId: b.userId.trim(),
      level: b.level as AccessLevel,
      scopeType: b.scopeType as AccessScope,
      scopeRef: typeof b.scopeRef === 'string' && b.scopeRef ? b.scopeRef : null,
      validUntil: typeof b.validUntil === 'string' && b.validUntil ? b.validUntil : null,
      bookIndex: indexOf(outline),
    });
    d.onAccessChanged?.(access.projectId, b.userId.trim());
    res.status(201).json({ grant });
  }));

  app.delete(`${accessBase}/:grantId`, handler('member', async (repo, access, req, res) => {
    if (!canManage(access)) throw new CoreRuleError('bad_actor', 'Відкликати доступ може власник книги, адміністратор або учасник із правом керування');
    const grant = await revokeAccess(repo, { projectId: access.projectId, grantId: String(req.params.grantId), granter: granterOf(access) });
    const p = await repo.getParticipantById(grant.participantId);
    if (p) d.onAccessChanged?.(access.projectId, p.userId);
    res.json({ grant });
  }));

  app.get(`${accessBase}/events`, handler('member', async (repo, access, _req, res) => {
    if (!canManage(access)) throw new CoreRuleError('bad_actor', 'Журнал доступу бачить власник книги, адміністратор або учасник із правом керування');
    const events = (await repo.listCollabEvents(access.projectId, { limit: 200 })).filter((e) => e.action === 'access_granted' || e.action === 'access_revoked');
    res.json({ events });
  }));
}
