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
import { JobRejectedError } from './jobs/types';
import type { JobQueue } from './jobs/queue';
import { AI_MENTIONS_JOB_KIND, MENTION_SUGGESTION, RELATION_SUGGESTION, publicSuggestion } from './ai/mentions';
import { hybridSearch, type SearchDeps, type SearchRequest } from './search/service';
import { interpretSearchQuery, type SearchInterpretDeps, type SearchInterpretation } from './search/interpret';

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
  /** Черга ядра (Т0.7) — для запуску AI-1 з інтерфейсу (Т1.1). */
  queue?: () => JobQueue | null;
  /** Пошук за змістом (Т1.2): ембедер, модель ембедингів, дозапуск `core_embed`. */
  search?: Omit<SearchDeps, 'repo'>;
  /** Тлумачення запиту AI-2 (Т1.3, `searchInterpret`); без нього — пошук без тлумачення. */
  interpret?: Omit<SearchInterpretDeps, 'repo'>;
}

/** Не більше стількох тлумачень запиту ШІ на користувача за хвилину — це платні виклики. */
export const INTERPRET_PER_MINUTE = 20;
/** Скільки збережених запитів може мати автор у книзі. */
export const MAX_SAVED_SEARCHES = 50;

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
};
const flag = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1;

/** Параметри пошуку з запиту (GET — рядок запиту, POST — тіло); те саме лягає в збережений запит. */
export function parseSearchParams(src: Record<string, unknown>) {
  const q = typeof src.q === 'string' ? src.q : typeof src.query === 'string' ? src.query : '';
  const status = src.status === 'confirmed' || src.status === 'suggested' ? src.status : undefined;
  return {
    q: q.slice(0, 500),
    entityIds: list(src.entityIds).slice(0, 10),
    chapterIds: list(src.chapterIds),
    chapterFrom: num(src.chapterFrom),
    chapterTo: num(src.chapterTo),
    status: status as 'confirmed' | 'suggested' | undefined,
    interpret: flag(src.interpret),
    limit: num(src.limit),
  };
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

  // ── Т1.1: пропозиції AI-1 (згадки й зв'язки) ──────────────────────────────

  const requireWrite = (req: Request, res: Response): boolean => {
    if (req.projectAccess?.canWrite) return true;
    res.status(403).json({ error: 'Ваша роль у проєкті лише для читання.', kind: 'forbidden' });
    return false;
  };

  /** Запустити AI-1 над розділом: фонова задача, відповідь — її id. */
  app.post('/api/projects/:id/ai/mentions', withRepo(async (repo, req, res) => {
    if (!requireWrite(req, res)) return;
    const queue = deps.queue?.();
    if (!queue) {
      res.status(503).json({ error: 'Фонові задачі ядра зараз недоступні.', kind: 'core_unavailable' });
      return;
    }
    const sectionId = String(req.body?.sectionId ?? '');
    const paragraphs = sectionId ? await repo.listParagraphs(req.params.id, sectionId) : [];
    if (!paragraphs.length) {
      res.status(409).json({
        error: 'Розділ ще не синхронізовано з ядром — збережіть книгу й спробуйте за кілька секунд.',
        kind: 'not_synced',
      });
      return;
    }
    try {
      const { job } = await queue.enqueue({
        projectId: req.params.id,
        kind: AI_MENTIONS_JOB_KIND,
        payload: { sectionId, paragraphIds: paragraphs.map((p) => p.id) },
        createdBy: `user:${req.projectAccess!.userId}`,
      });
      res.status(202).json({ jobId: job.id, paragraphs: paragraphs.length });
    } catch (err) {
      if (err instanceof JobRejectedError) {
        const status = err.code === 'rate_limited' ? 429 : err.code === 'budget_exhausted' ? 402 : 422;
        res.status(status).json({ error: err.message, kind: err.code, retryAfterMs: err.retryAfterMs });
        return;
      }
      throw err;
    }
  }));

  /** Стан фонової задачі проєкту (прогрес, підсумок, помилка). */
  app.get('/api/projects/:id/jobs/:jobId', withRepo(async (_repo, req, res) => {
    const job = await deps.queue?.()?.store.get(req.params.id, req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Задачу не знайдено в цьому проєкті.', kind: 'not_found' });
      return;
    }
    res.json({ id: job.id, kind: job.kind, status: job.status, progress: job.progress, result: job.result, error: job.error });
  }));

  /** Нерозглянуті пропозиції AI (згадки й зв'язки), за бажанням — лише розділу. */
  app.get('/api/projects/:id/suggestions', withRepo(async (repo, req, res) => {
    const sectionId = typeof req.query.sectionId === 'string' && req.query.sectionId ? req.query.sectionId : undefined;
    const findings = (await repo.listFindings(req.params.id, { status: 'suggested' }))
      .filter((f) => f.kind === MENTION_SUGGESTION || f.kind === RELATION_SUGGESTION)
      .filter(visibleTo(req.projectAccess!));
    const out = [];
    for (const f of findings) {
      const paragraph = f.sourceParagraphIds[0] ? await repo.getParagraph(req.params.id, f.sourceParagraphIds[0]) : null;
      if (paragraph?.deletedAt) continue;
      if (sectionId && paragraph?.documentId !== sectionId) continue;
      out.push(publicSuggestion(f, paragraph ?? undefined));
    }
    res.json({ suggestions: out });
  }));

  const loadSuggestion = async (repo: CoreRepository, req: Request, res: Response): Promise<FindingRow | null> => {
    const f = await repo.getFinding(req.params.id, req.params.findingId);
    if (!f || (f.kind !== MENTION_SUGGESTION && f.kind !== RELATION_SUGGESTION) || !visibleTo(req.projectAccess!)(f)) {
      res.status(404).json({ error: 'Пропозицію не знайдено.', kind: 'not_found' });
      return null;
    }
    if (f.status !== 'suggested') {
      res.status(409).json({ error: 'Пропозицію вже розглянуто.', kind: 'already_decided', status: f.status });
      return null;
    }
    return f;
  };

  /**
   * «Підтвердити» (П3). Згадка: висновок підтверджено, відповідь — тег і абзац,
   * куди його поставить редактор у браузері (рукопис змінює лише редактор, К2).
   * Зв'язок: створюється в ядрі як підтверджений автором.
   */
  app.post('/api/projects/:id/suggestions/:findingId/confirm', withRepo(async (repo, req, res) => {
    if (!requireWrite(req, res)) return;
    const f = await loadSuggestion(repo, req, res);
    if (!f) return;
    const actor = `user:${req.projectAccess!.userId}`;
    const p = f.payload as Record<string, any>;
    if (f.kind === RELATION_SUGGESTION) {
      const relation = await repo.createRelation({
        projectId: req.params.id,
        type: String(p.relationType),
        fromId: String(f.entityId),
        toId: String(p.targetEntityId),
        evidence: f.sourceParagraphIds,
        status: 'confirmed',
        note: typeof p.quote === 'string' ? p.quote : '',
        createdBy: actor,
      });
      await repo.setFindingStatus(req.params.id, f.id, 'confirmed', actor, 'підтверджено автором');
      res.json({ kind: RELATION_SUGGESTION, relation });
      return;
    }
    const paragraph = await repo.getParagraph(req.params.id, f.sourceParagraphIds[0]);
    if (!paragraph || paragraph.deletedAt) {
      res.status(409).json({ error: 'Абзацу вже немає в книзі.', kind: 'paragraph_gone' });
      return;
    }
    await repo.setFindingStatus(req.params.id, f.id, 'confirmed', actor, 'підтверджено автором — тег у рукописі');
    res.json({
      kind: MENTION_SUGGESTION,
      tag: p.tag,
      paragraphId: paragraph.id,
      editorPid: paragraph.editorPid ?? paragraph.id,
      sectionId: paragraph.documentId,
    });
  }));

  /** «Відхилити»: більше не пропонується (для згадки — у цьому абзаці). */
  app.post('/api/projects/:id/suggestions/:findingId/reject', withRepo(async (repo, req, res) => {
    if (!requireWrite(req, res)) return;
    const f = await loadSuggestion(repo, req, res);
    if (!f) return;
    await repo.setFindingStatus(req.params.id, f.id, 'rejected', `user:${req.projectAccess!.userId}`, 'відхилено автором');
    res.json({ ok: true });
  }));

  // ── Т1.2: гібридний пошук ────────────────────────────────────────────────

  /**
   * Пошук абзаців книги: слова + зміст + граф сутностей, з поясненням джерела
   * в кожного результату. GET `?q=&entityIds=a,b&limit=` або POST з тим самим
   * тілом. Читати може кожен учасник книги (право перевірено вище).
   */
  const interpretCalls = new Map<string, number[]>();
  const interpretAllowed = (userId: string): boolean => {
    const now = Date.now();
    const recent = (interpretCalls.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= INTERPRET_PER_MINUTE) {
      interpretCalls.set(userId, recent);
      return false;
    }
    recent.push(now);
    interpretCalls.set(userId, recent);
    return true;
  };

  const search = withRepo(async (repo, req, res) => {
    const params = parseSearchParams((req.method === 'GET' ? req.query : req.body ?? {}) as Record<string, unknown>);
    if (!params.q.trim() && !params.entityIds.length) {
      res.status(400).json({ error: 'Порожній запит: введіть слова або оберіть сутність.', kind: 'bad_input' });
      return;
    }
    const project = await repo.getProject(req.params.id);
    if (!project) {
      res.json({ query: params.q, synced: false, stems: [], entities: [], results: [], sources: null, interpretation: null });
      return;
    }
    const request: SearchRequest = {
      query: params.q,
      entityIds: params.entityIds,
      chapterIds: params.chapterIds,
      chapterRange: params.chapterFrom || params.chapterTo ? { from: params.chapterFrom, to: params.chapterTo } : undefined,
      mentionStatus: params.status,
      limit: params.limit,
    };

    // Тлумачення ШІ — лише розкладає запит на фільтри (AI не відповідає, відповідь — знайдені абзаци).
    let interpretation: (SearchInterpretation & { ok: true }) | { ok: false; error: string } | null = null;
    if (params.interpret && params.q.trim()) {
      if (!deps.interpret) interpretation = { ok: false, error: 'Тлумачення запиту ШІ тут не підключене — пошук без нього.' };
      else if (!interpretAllowed(req.projectAccess!.userId)) {
        interpretation = { ok: false, error: `Забагато тлумачень запиту за хвилину (не більше ${INTERPRET_PER_MINUTE}) — цей пошук без ШІ.` };
      } else {
        try {
          const it = await interpretSearchQuery({ repo, ...deps.interpret }, req.params.id, params.q, `user:${req.projectAccess!.userId}`);
          interpretation = { ok: true, ...it };
          // Слова — від ШІ (імена пішли у фільтри), запит цілком — у пошук за змістом.
          request.text = it.text;
          request.hintEntityIds = it.groups;
          // Явний вибір автора у фільтрах важливіший за тлумачення.
          if (!params.chapterIds.length && !request.chapterRange && it.chapterIds.length) request.chapterIds = it.chapterIds;
          if (!params.status && it.mentionStatus) request.mentionStatus = it.mentionStatus;
        } catch (err) {
          interpretation = { ok: false, error: `ШІ не розібрав запит (${(err as Error).message}) — пошук без тлумачення.` };
        }
      }
    }
    const out = await hybridSearch({ repo, ...(deps.search ?? {}) }, req.params.id, request);
    res.json({ synced: true, revision: project.revision, ...out, interpretation });
  });
  app.get('/api/projects/:id/search', search);
  app.post('/api/projects/:id/search', search);

  // ── Т1.3: збережені запити (особисті, у межах книги) ─────────────────────

  app.get('/api/projects/:id/saved-searches', withRepo(async (repo, req, res) => {
    res.json({ items: await repo.listSavedSearches(req.params.id, req.projectAccess!.userId) });
  }));

  app.post('/api/projects/:id/saved-searches', withRepo(async (repo, req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 200) {
      res.status(400).json({ error: 'Назва запиту — від 1 до 200 символів.', kind: 'bad_input' });
      return;
    }
    const params = parseSearchParams((req.body?.params ?? {}) as Record<string, unknown>);
    if (!params.q.trim() && !params.entityIds.length) {
      res.status(400).json({ error: 'Нема чого зберігати: запит порожній.', kind: 'bad_input' });
      return;
    }
    if (!(await repo.getProject(req.params.id))) {
      res.status(409).json({ error: 'Книгу ще не синхронізовано з ядром.', kind: 'not_synced' });
      return;
    }
    const mine = await repo.listSavedSearches(req.params.id, req.projectAccess!.userId);
    if (mine.length >= MAX_SAVED_SEARCHES) {
      res.status(409).json({ error: `Збережених запитів уже ${MAX_SAVED_SEARCHES} — видаліть непотрібні.`, kind: 'limit' });
      return;
    }
    const { limit: _limit, ...stored } = params;
    const item = await repo.addSavedSearch({ projectId: req.params.id, userId: req.projectAccess!.userId, name, params: stored });
    res.status(201).json({ item });
  }));

  app.delete('/api/projects/:id/saved-searches/:savedId', withRepo(async (repo, req, res) => {
    const ok = await repo.deleteSavedSearch(req.params.id, req.projectAccess!.userId, req.params.savedId);
    if (!ok) {
      res.status(404).json({ error: 'Збережений запит не знайдено.', kind: 'not_found' });
      return;
    }
    res.json({ ok: true });
  }));

  /** Зв'язки проєкту або однієї сутності (`?entityId=`). */
  app.get('/api/projects/:id/relations', withRepo(async (repo, req, res) => {
    const entityId = typeof req.query.entityId === 'string' && req.query.entityId ? req.query.entityId : undefined;
    const includeRejected = req.query.includeRejected === '1';
    const relations = await repo.listRelations(req.params.id, entityId);
    res.json({ relations: relations.filter((r) => includeRejected || r.status !== 'rejected') });
  }));
}
