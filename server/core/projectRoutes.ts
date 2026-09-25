/**
 * API проєкту семантичного ядра (Т0.8): `/api/projects/:id/*`.
 *
 * Проєкт = книга (К6). Кожен маршрут під цим префіксом проходить
 * `requireProjectAccess`: гість — 401, чужа книга — 403, і лише потім ядро.
 * Право визначається так само, як для спільного редагування (Т0.1,
 * `server/realtimeAuth.ts`): власник книги (спершу власник спільної роботи,
 * потім власник серверної копії) і ті, хто прийняв запрошення; адміністратор
 * — завжди. Хто саме — видно з `req.projectAccess.role`.
 *
 * Видимість висновків AI (ТЗ-H §5.1): `hidden` не віддається нікому через
 * API (таємниці не йдуть ні в пошук, ні в клієнта), `author` — лише
 * власнику й адміністратору, `project` — усім учасникам.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import { isValidBookId, type RealtimeAccessDeps } from '../realtimeAuth';
import { CoreRuleError } from './rules';
import type { CoreRepository, FindingRow } from './types';

export interface ProjectAccess {
  projectId: string;
  userId: string;
  /** 'admin' | 'owner' | роль із запрошення ('designer', 'translator', 'reader'…). */
  role: string;
  isOwner: boolean;
  canWrite: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    projectAccess?: ProjectAccess;
  }
}

interface Principal {
  id: string | null;
  role: string;
  isGuest: boolean;
}

export async function resolveProjectAccess(
  principal: Principal | undefined,
  projectId: string,
  deps: RealtimeAccessDeps,
): Promise<ProjectAccess | null> {
  if (!principal || principal.isGuest || !principal.id || !isValidBookId(projectId)) return null;
  const userId = principal.id;
  const collabOwner = await deps.getCollabOwnerId(projectId);
  const owner = collabOwner ?? (await deps.getBookOwnerId(projectId)) ?? undefined;
  if (owner && owner === userId) return { projectId, userId, role: 'owner', isOwner: true, canWrite: true };
  if (principal.role === 'admin') return { projectId, userId, role: 'admin', isOwner: false, canWrite: true };
  if (owner) {
    const invite = (await deps.listAcceptedInvites(projectId)).find((inv) => inv.acceptedUserId === userId);
    if (invite) return { projectId, userId, role: invite.role, isOwner: false, canWrite: invite.role !== 'reader' };
  }
  return null;
}

export interface ProjectRoutesDeps {
  access: RealtimeAccessDeps;
  repo: () => CoreRepository | null;
  /** Стан ядра для відповіді 503 (без адреси бази / база впала). */
  coreState: () => string;
  /** Остання синхронізація книги (Т0.6) — для підсумку сторінок. */
  lastSync?: (projectId: string) => Promise<{ status: string; finishedAt: string | null } | null>;
}

export function requireProjectAccess(deps: Pick<ProjectRoutesDeps, 'access'>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const principal = (req as any).principal as Principal | undefined;
    if (!principal || principal.isGuest) {
      res.status(401).json({ error: 'Потрібен вхід у систему.', kind: 'unauthenticated' });
      return;
    }
    try {
      const access = await resolveProjectAccess(principal, String(req.params.id ?? ''), deps.access);
      if (!access) {
        res.status(403).json({ error: 'Немає доступу до цього проєкту.', kind: 'forbidden' });
        return;
      }
      req.projectAccess = access;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function visibleTo(access: ProjectAccess) {
  return (f: FindingRow) =>
    f.visibility === 'project' || (f.visibility === 'author' && (access.isOwner || access.role === 'admin'));
}

function fail(res: Response, err: unknown) {
  if (err instanceof CoreRuleError) {
    res.status(err.code === 'not_found' ? 404 : 422).json({ error: err.message, kind: err.code });
    return;
  }
  console.error('[core] помилка маршруту проєкту:', err);
  res.status(500).json({ error: 'Не вдалося прочитати дані ядра.', kind: 'server_error' });
}

export function registerProjectRoutes(app: Express, deps: ProjectRoutesDeps): void {
  // Префікс цілком: і наявні, і майбутні маршрути проєкту — лише з правом.
  app.use('/api/projects/:id', requireProjectAccess(deps));

  const withRepo = (handler: (repo: CoreRepository, req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      const repo = deps.repo();
      if (!repo) {
        res.status(503).json({
          error: 'Семантичне ядро зараз недоступне — решта Студії працює.',
          kind: 'core_unavailable',
          core: deps.coreState(),
        });
        return;
      }
      try {
        await handler(repo, req, res);
      } catch (err) {
        fail(res, err);
      }
    };

  /** Хто я в проєкті — для інтерфейсу сторінок (що показувати, що дозволити). */
  app.get('/api/projects/:id/access', (req, res) => {
    res.json({ access: req.projectAccess, core: deps.coreState() });
  });

  /** Підсумок ядра для сторінок: скільки абзаців, сутностей за типами, зв'язків, висновків. */
  app.get('/api/projects/:id/summary', withRepo(async (repo, req, res) => {
    const id = req.params.id;
    const project = await repo.getProject(id);
    if (!project) {
      res.json({ projectId: id, synced: false, revision: 0, paragraphs: 0, entities: {}, relations: 0, findings: { suggested: 0, needsReview: 0 } });
      return;
    }
    const [paragraphs, entities, relations, findings, sync] = await Promise.all([
      repo.listAllParagraphs(id),
      repo.listEntities(id),
      repo.listRelations(id),
      repo.listFindings(id),
      deps.lastSync?.(id) ?? Promise.resolve(null),
    ]);
    const byType: Record<string, number> = {};
    for (const e of entities) if (e.status !== 'rejected') byType[e.type] = (byType[e.type] ?? 0) + 1;
    const visible = findings.filter(visibleTo(req.projectAccess!));
    res.json({
      projectId: id,
      synced: true,
      revision: project.revision,
      paragraphs: paragraphs.filter((p) => !p.deletedAt).length,
      entities: byType,
      relations: relations.filter((r) => r.status !== 'rejected').length,
      findings: {
        suggested: visible.filter((f) => f.status === 'suggested').length,
        needsReview: visible.filter((f) => f.needsReview).length,
      },
      lastSync: sync,
    });
  }));

  /** Сутності проєкту (фільтр `?type=character`), з кількістю згадок. */
  app.get('/api/projects/:id/entities', withRepo(async (repo, req, res) => {
    const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
    const includeRejected = req.query.includeRejected === '1';
    const [entities, counts] = await Promise.all([repo.listEntities(req.params.id, type), repo.countMentionsByEntity(req.params.id)]);
    res.json({
      entities: entities
        .filter((e) => includeRejected || e.status !== 'rejected')
        .map((e) => ({ ...e, mentions: counts[e.id] ?? 0 })),
    });
  }));

  /** Одна сутність: псевдоніми, згадки, зв'язки, висновки (з урахуванням видимості). */
  app.get('/api/projects/:id/entities/:entityId', withRepo(async (repo, req, res) => {
    const { id, entityId } = req.params;
    const entity = await repo.getEntity(id, entityId);
    if (!entity) {
      res.status(404).json({ error: 'Сутність не знайдено в цьому проєкті.', kind: 'not_found' });
      return;
    }
    const [aliases, mentions, relations, findings] = await Promise.all([
      repo.listAliases(id, entityId),
      repo.listMentionsByEntity(id, entityId),
      repo.listRelations(id, entityId),
      repo.listFindings(id, { entityId }),
    ]);
    res.json({
      entity,
      aliases: aliases.map((a) => ({ alias: a.alias, kind: a.kind })),
      mentions,
      relations,
      findings: findings.filter(visibleTo(req.projectAccess!)),
    });
  }));

  /** Зв'язки проєкту або однієї сутності (`?entityId=`). */
  app.get('/api/projects/:id/relations', withRepo(async (repo, req, res) => {
    const entityId = typeof req.query.entityId === 'string' && req.query.entityId ? req.query.entityId : undefined;
    const includeRejected = req.query.includeRejected === '1';
    const relations = await repo.listRelations(req.params.id, entityId);
    res.json({ relations: relations.filter((r) => includeRejected || r.status !== 'rejected') });
  }));
}
