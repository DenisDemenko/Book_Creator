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
import { buildStoryGraph, evidenceRefs } from './storyGraph';
import { AI_PROFILE_JOB_KIND, PROFILE_FACT, buildCharacterProfile, studioCanon, type StudioCharacterLike } from './characterProfile';
import type { EntityRow } from './types';
import { runFlcCycle } from './flc/cycle';
import { buildTimeline, characterKnowledge } from './timeline';
import { normalizeStoryTime } from '../../src/utils/storyTime';
import { AI_EMOTIONS_JOB_KIND, EMOTION_POINT, buildEmotionMonitor } from './emotions';
import { ROLE_ENTITY_TYPES, appearanceOverview, describeLinks, heroPortrait, sceneVisuals } from './visual';
import { ASSET_ROLES, type AssetRole } from './types';
import { VERSIONED_ROLES, isLinkableAssetUrl } from './rules';
import { clampIntensity, emotionFamily } from '../../src/utils/emotionScale';
import { LlmFallbackJevAdapter, type JevAdapter, type LlmJson } from './flc/jev';
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
  /** Картка героя в Студії (канон автора) для профілю персонажа (Т1.5). */
  studio?: (projectId: string, entity: EntityRow) => Promise<{ character: StudioCharacterLike | null; all: StudioCharacterLike[] }>;
  /** Прототип FLC етапу 0 (Т1.6): адаптер Jev (null — ключа немає) і LLM. */
  flc?: { jev: () => Promise<JevAdapter | null>; llm: (projectId: string, actor: string) => LlmJson };
  /** Порядок сцен у часі світу зі Студії (`Scene.timelineOrder`), Т2.1. */
  sceneOrder?: (projectId: string) => Promise<Map<string, number>>;
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

/**
 * Хто змінює граф історії (створює й підтверджує зв'язки, Т1.4): власник,
 * адміністратор, співавтор і редактор. Дизайнер, перекладач, видавець і
 * читач бачать граф, але не змінюють його.
 */
export function canEditStory(access: ProjectAccess): boolean {
  return access.isOwner || access.role === 'admin' || access.role === 'coauthor' || access.role === 'editor';
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
    // `?excerpts=1` (картка графа, Т1.4): абзаци згадок з уривком і адресою в редакторі.
    const mentionParagraphs =
      req.query.excerpts === '1'
        ? await evidenceRefs(repo, id, [...new Set(mentions.filter((m) => m.status !== 'rejected').map((m) => m.paragraphId))].slice(0, 30))
        : undefined;
    res.json({
      entity,
      aliases: aliases.map((a) => ({ alias: a.alias, kind: a.kind })),
      mentions,
      relations,
      findings: findings.filter(visibleTo(req.projectAccess!)),
      ...(mentionParagraphs ? { mentionParagraphs } : {}),
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

  // ── Т1.4: граф історії ───────────────────────────────────────────────────

  /**
   * Граф: `?focus=<entityId>&depth=1|2` — сутність і сусіди (поступове
   * довантаження), без фокуса — огляд; `types=a,b`, `suggested=0` (лише
   * підтверджені), `tags=0` (без зв'язків із тегів), `limit`.
   */
  app.get('/api/projects/:id/story-graph', withRepo(async (repo, req, res) => {
    const qs = req.query as Record<string, unknown>;
    const project = await repo.getProject(req.params.id);
    if (!project) {
      res.json({ synced: false, focus: null, depth: 1, nodes: [], edges: [], truncated: false, totals: { entities: 0, edges: 0 } });
      return;
    }
    const graph = await buildStoryGraph(repo, req.params.id, {
      focus: typeof qs.focus === 'string' && qs.focus ? qs.focus : undefined,
      depth: Number(qs.depth) || 1,
      types: typeof qs.types === 'string' && qs.types ? qs.types.split(',').map((x) => x.trim()).filter(Boolean) : undefined,
      includeSuggested: qs.suggested !== '0',
      includeTagLinks: qs.tags !== '0',
      limit: Number(qs.limit) || undefined,
    });
    res.json({ synced: true, canEdit: canEditStory(req.projectAccess!), ...graph });
  }));

  const requireStoryEdit = (req: Request, res: Response): boolean => {
    if (canEditStory(req.projectAccess!)) return true;
    res.status(403).json({ error: 'Змінювати зв\'язки можуть власник, співавтор, редактор і адміністратор.', kind: 'forbidden' });
    return false;
  };

  /** Ручний зв'язок від автора (підтверджений одразу); джерела — абзаци книги, за бажанням. */
  app.post('/api/projects/:id/relations', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const b = req.body ?? {};
    const fromId = String(b.fromId ?? '');
    const toId = String(b.toId ?? '');
    if (!fromId || !toId || fromId === toId) {
      res.status(400).json({ error: 'Потрібні дві різні сутності.', kind: 'bad_input' });
      return;
    }
    const [from, to] = await Promise.all([repo.getEntity(req.params.id, fromId), repo.getEntity(req.params.id, toId)]);
    if (!from || !to || from.status === 'rejected' || to.status === 'rejected') {
      res.status(404).json({ error: 'Сутність не знайдено в цьому проєкті.', kind: 'not_found' });
      return;
    }
    const evidenceIn = (Array.isArray(b.evidence) ? b.evidence : []).map(String).slice(0, 20);
    const evidence = (await evidenceRefs(repo, req.params.id, evidenceIn)).map((e) => e.paragraphId);
    if (evidence.length !== evidenceIn.length) {
      res.status(400).json({ error: 'Абзаців-джерел немає в книзі.', kind: 'bad_input' });
      return;
    }
    const existing = (await repo.listRelations(req.params.id, fromId)).find(
      (r) => r.fromId === fromId && r.toId === toId && r.type === String(b.type) && r.status !== 'rejected',
    );
    if (existing) {
      res.status(409).json({ error: 'Такий зв\'язок уже є.', kind: 'duplicate', relation: existing });
      return;
    }
    const relation = await repo.createRelation({
      projectId: req.params.id,
      type: String(b.type ?? ''),
      fromId,
      toId,
      evidence,
      note: typeof b.note === 'string' ? b.note.slice(0, 1000) : '',
      status: 'confirmed',
      createdBy: `user:${req.projectAccess!.userId}`,
    });
    res.status(201).json({ relation });
  }));

  /** Підтвердити або відхилити зв'язок (зокрема запропонований ШІ). */
  app.post('/api/projects/:id/relations/:relationId/status', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const status = req.body?.status;
    if (status !== 'confirmed' && status !== 'rejected') {
      res.status(400).json({ error: 'Статус — confirmed або rejected.', kind: 'bad_input' });
      return;
    }
    const relation = await repo.setRelationStatus(
      req.params.id,
      req.params.relationId,
      status,
      `user:${req.projectAccess!.userId}`,
      status === 'confirmed' ? 'підтверджено автором (граф історії)' : 'відхилено автором (граф історії)',
    );
    res.json({ relation });
  }));

  // ── Т1.5: профіль персонажа і Profile Builder ────────────────────────────

  /** Профіль героя; `?chapter=N` — «стан на главі N» без спойлерів із пізніших. */
  app.get('/api/projects/:id/characters/:entityId/profile', withRepo(async (repo, req, res) => {
    const entity = await repo.getEntity(req.params.id, req.params.entityId);
    if (!entity || entity.status === 'rejected') {
      res.status(404).json({ error: 'Героя не знайдено в цьому проєкті.', kind: 'not_found' });
      return;
    }
    const upto = Number(req.query.chapter) || null;
    const studio = deps.studio ? await deps.studio(req.params.id, entity).catch(() => undefined) : undefined;
    const profile = await buildCharacterProfile(repo, req.params.id, entity.id, { upto, studio });
    res.json({ ...profile, canEdit: canEditStory(req.projectAccess!) });
  }));

  /** Запустити Profile Builder (AI-2) для героя — фонова задача. */
  app.post('/api/projects/:id/characters/:entityId/profile/build', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const queue = deps.queue?.();
    if (!queue) {
      res.status(503).json({ error: 'Фонові задачі ядра зараз недоступні.', kind: 'core_unavailable' });
      return;
    }
    const entity = await repo.getEntity(req.params.id, req.params.entityId);
    if (!entity || entity.status === 'rejected') {
      res.status(404).json({ error: 'Героя не знайдено в цьому проєкті.', kind: 'not_found' });
      return;
    }
    try {
      const { job } = await queue.enqueue({
        projectId: req.params.id,
        kind: AI_PROFILE_JOB_KIND,
        payload: { entityId: entity.id },
        createdBy: `user:${req.projectAccess!.userId}`,
      });
      res.status(202).json({ jobId: job.id });
    } catch (err) {
      if (err instanceof JobRejectedError) {
        const status = err.code === 'rate_limited' ? 429 : err.code === 'budget_exhausted' ? 402 : 422;
        res.status(status).json({ error: err.message, kind: err.code, retryAfterMs: err.retryAfterMs });
        return;
      }
      throw err;
    }
  }));

  /** Рішення автора щодо факту Profile Builder: підтвердити (стає каноном профілю) чи відхилити. */
  app.post('/api/projects/:id/characters/:entityId/facts/:findingId/status', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const status = req.body?.status;
    if (status !== 'confirmed' && status !== 'rejected') {
      res.status(400).json({ error: 'Статус — confirmed або rejected.', kind: 'bad_input' });
      return;
    }
    const f = await repo.getFinding(req.params.id, req.params.findingId);
    if (!f || f.kind !== PROFILE_FACT || f.entityId !== req.params.entityId || !visibleTo(req.projectAccess!)(f)) {
      res.status(404).json({ error: 'Факт не знайдено.', kind: 'not_found' });
      return;
    }
    if (f.status === status) {
      res.json({ finding: f });
      return;
    }
    const finding = await repo.setFindingStatus(
      req.params.id,
      f.id,
      status,
      `user:${req.projectAccess!.userId}`,
      status === 'confirmed' ? 'підтверджено автором (профіль героя)' : 'відхилено автором (профіль героя)',
    );
    res.json({ finding });
  }));

  // ── Т2.1: хронологія ──────────────────────────────────────────────────────

  const sceneOrder = async (projectId: string) => (deps.sceneOrder ? await deps.sceneOrder(projectId).catch(() => undefined) : undefined);

  /** Дві шкали (порядок розкриття й час у світі), флешбеки, лінії, зв'язки часу й суперечності; фільтри `character`, `location`, `storyline`. */
  app.get('/api/projects/:id/timeline', withRepo(async (repo, req, res) => {
    const project = await repo.getProject(req.params.id);
    if (!project) {
      res.json({ synced: false, scenes: [], events: [], relations: [], warnings: [], lanes: [], filters: {} });
      return;
    }
    const q = req.query as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const timeline = await buildTimeline(repo, req.params.id, {
      character: str(q.character),
      location: str(q.location),
      storyline: str(q.storyline),
      studioOrder: await sceneOrder(req.params.id),
    });
    res.json({ synced: true, canEdit: canEditStory(req.projectAccess!), ...timeline });
  }));

  /** Задати час сцени чи події (автор, з підтвердженням в інтерфейсі). */
  app.put('/api/projects/:id/timeline/points', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const b = req.body ?? {};
    const subjectKind = b.subjectKind === 'scene' || b.subjectKind === 'event' ? b.subjectKind : null;
    const subjectId = typeof b.subjectId === 'string' ? b.subjectId : '';
    if (!subjectKind || !subjectId) {
      res.status(400).json({ error: 'Потрібні сцена чи подія.', kind: 'bad_input' });
      return;
    }
    if (subjectKind === 'scene') {
      const doc = (await repo.listDocuments(req.params.id)).find((d) => d.id === subjectId && d.kind === 'section' && !d.deletedAt);
      if (!doc) {
        res.status(404).json({ error: 'Сцену не знайдено в книзі.', kind: 'not_found' });
        return;
      }
    } else {
      const e = await repo.getEntity(req.params.id, subjectId);
      if (!e || e.status === 'rejected') {
        res.status(404).json({ error: 'Подію не знайдено в книзі.', kind: 'not_found' });
        return;
      }
    }
    const v = normalizeStoryTime({ kind: b.kind, start: b.start, end: b.end, label: b.label });
    if (typeof v === 'string') {
      res.status(400).json({ error: v, kind: 'bad_input' });
      return;
    }
    const point = await repo.upsertTimePoint({
      projectId: req.params.id,
      subjectKind,
      subjectId,
      kind: v.kind,
      start: v.start,
      end: v.end,
      sortKey: v.key,
      endKey: v.endKey,
      label: v.label,
      createdBy: `user:${req.projectAccess!.userId}`,
    });
    res.json({ point });
  }));

  app.delete('/api/projects/:id/timeline/points/:subjectKind/:subjectId', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const kind = req.params.subjectKind === 'scene' || req.params.subjectKind === 'event' ? req.params.subjectKind : null;
    if (!kind || !(await repo.deleteTimePoint(req.params.id, kind, req.params.subjectId))) {
      res.status(404).json({ error: 'Точки часу немає.', kind: 'not_found' });
      return;
    }
    res.json({ ok: true });
  }));

  /** Що герой міг знати до сцени (ТЗ-H knowledge boundary). */
  app.get('/api/projects/:id/timeline/knowledge', withRepo(async (repo, req, res) => {
    const character = typeof req.query.character === 'string' ? req.query.character : '';
    const scene = typeof req.query.scene === 'string' ? req.query.scene : '';
    const k = character && scene ? await characterKnowledge(repo, req.params.id, character, scene, { studioOrder: await sceneOrder(req.params.id) }) : null;
    if (!k) {
      res.status(404).json({ error: 'Героя чи сцену не знайдено.', kind: 'not_found' });
      return;
    }
    res.json(k);
  }));

  // ── Т2.2: емоційний монітор ───────────────────────────────────────────────

  /**
   * Криві емоцій героїв, настрій сцен, мітки подій, попередження, пропозиції AI:
   * `?characters=a,b&family=&layer=&axis=chapter|scene|world&metric=intensity|craft|impact&event=&window=`.
   */
  app.get('/api/projects/:id/emotions', withRepo(async (repo, req, res) => {
    const project = await repo.getProject(req.params.id);
    if (!project) {
      res.json({ synced: false, axis: 'chapter', metric: 'intensity', buckets: [], chapters: [], families: [], characters: [], selected: [], points: [], series: [], scenes: [], warnings: [], suggestions: [], events: [], impact: null, anchors: [] });
      return;
    }
    const q = req.query as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const list = [str(q.characters), str(q.character)].filter(Boolean).join(',').split(',').map((x) => x.trim()).filter(Boolean);
    const axis = str(q.axis);
    const monitor = await buildEmotionMonitor(repo, req.params.id, {
      characters: list,
      family: str(q.family),
      layer: str(q.layer),
      axis,
      metric: str(q.metric),
      event: str(q.event),
      window: Number(q.window) || 2,
      studioOrder: axis === 'world' ? await sceneOrder(req.params.id) : undefined,
      visible: visibleTo(req.projectAccess!),
    });
    res.json({ synced: true, canEdit: canEditStory(req.projectAccess!), ...monitor });
  }));

  /**
   * Точка автора або ручне коригування: герой, абзац-доказ, емоція, сила 0…10,
   * шар, майстерність передачі й вплив (0…10 або null — не оцінено). Та сама
   * емоція героя в тому ж абзаці — заміна; точку з тега це коригує без зміни тексту.
   */
  app.post('/api/projects/:id/emotions/points', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const b = req.body ?? {};
    const hero = await repo.getEntity(req.params.id, String(b.characterId ?? ''));
    if (!hero || hero.type !== 'character' || hero.status === 'rejected') {
      res.status(404).json({ error: 'Героя не знайдено в цьому проєкті.', kind: 'not_found' });
      return;
    }
    const paragraph = await repo.getParagraph(req.params.id, String(b.paragraphId ?? ''));
    if (!paragraph || paragraph.deletedAt) {
      res.status(404).json({ error: 'Абзац-доказ не знайдено в книзі.', kind: 'not_found' });
      return;
    }
    const emotion = typeof b.emotion === 'string' ? b.emotion.trim().toLocaleLowerCase('uk') : '';
    const intensity = Number(b.intensity);
    const optScore = (v: unknown) => (v == null || v === '' ? null : Number(v));
    const craft = optScore(b.craft);
    const impact = optScore(b.impact);
    const bad = (v: number | null) => v != null && (!Number.isFinite(v) || v < 0 || v > 10);
    const layer = b.layer == null || b.layer === '' ? 'primary' : b.layer;
    if (!emotion || emotion.length > 80 || !Number.isFinite(intensity) || intensity < 0 || intensity > 10 || bad(craft) || bad(impact) || !['primary', 'secondary', 'hidden'].includes(layer)) {
      res.status(400).json({ error: 'Потрібні назва емоції (до 80 знаків) і оцінки від 0 до 10; шар — основна, другорядна чи прихована.', kind: 'bad_input' });
      return;
    }
    const point = await repo.upsertEmotionPoint({
      projectId: req.params.id,
      characterId: hero.id,
      paragraphId: paragraph.id,
      emotion,
      family: emotionFamily(emotion),
      layer,
      intensity: clampIntensity(intensity),
      craft: craft == null ? null : clampIntensity(craft),
      impact: impact == null ? null : clampIntensity(impact),
      note: typeof b.note === 'string' ? b.note.slice(0, 500) : '',
      source: 'author',
      createdBy: `user:${req.projectAccess!.userId}`,
    });
    res.status(201).json({ point });
  }));

  app.delete('/api/projects/:id/emotions/points/:pointId', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    if (!(await repo.deleteEmotionPoint(req.params.id, req.params.pointId))) {
      res.status(404).json({ error: 'Такої точки немає.', kind: 'not_found' });
      return;
    }
    res.json({ ok: true });
  }));

  /** Запустити AI-2 «емоції героя» — фонова задача; результат — пропозиції на розгляд. */
  app.post('/api/projects/:id/emotions/analyze', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const queue = deps.queue?.();
    if (!queue) {
      res.status(503).json({ error: 'Фонові задачі ядра зараз недоступні.', kind: 'core_unavailable' });
      return;
    }
    const hero = await repo.getEntity(req.params.id, String(req.body?.characterId ?? ''));
    if (!hero || hero.type !== 'character' || hero.status === 'rejected') {
      res.status(404).json({ error: 'Героя не знайдено в цьому проєкті.', kind: 'not_found' });
      return;
    }
    try {
      const { job } = await queue.enqueue({
        projectId: req.params.id,
        kind: AI_EMOTIONS_JOB_KIND,
        payload: { characterId: hero.id },
        createdBy: `user:${req.projectAccess!.userId}`,
      });
      res.status(202).json({ jobId: job.id });
    } catch (err) {
      if (err instanceof JobRejectedError) {
        const status = err.code === 'rate_limited' ? 429 : err.code === 'budget_exhausted' ? 402 : 422;
        res.status(status).json({ error: err.message, kind: err.code, retryAfterMs: err.retryAfterMs });
        return;
      }
      throw err;
    }
  }));

  /**
   * Рішення автора щодо пропозиції AI-2: підтвердити (стає точкою кривої,
   * можна уточнити силу `intensity`) чи відхилити.
   */
  app.post('/api/projects/:id/emotions/suggestions/:findingId/status', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const status = req.body?.status;
    if (status !== 'confirmed' && status !== 'rejected') {
      res.status(400).json({ error: 'Статус — confirmed або rejected.', kind: 'bad_input' });
      return;
    }
    const f = await repo.getFinding(req.params.id, req.params.findingId);
    if (!f || f.kind !== EMOTION_POINT || !f.entityId || !visibleTo(req.projectAccess!)(f)) {
      res.status(404).json({ error: 'Пропозицію не знайдено.', kind: 'not_found' });
      return;
    }
    if (f.status !== 'suggested') {
      res.status(409).json({ error: 'Цю пропозицію вже розглянуто.', kind: 'already_decided', finding: f });
      return;
    }
    const actor = `user:${req.projectAccess!.userId}`;
    let point = null;
    if (status === 'confirmed' && (f.insufficientData || !f.sourceParagraphIds.length)) {
      res.status(422).json({ error: 'Це позначка «недостатньо даних» — підтверджувати нема чого, можна лише відхилити.', kind: 'insufficient_data' });
      return;
    }
    if (status === 'confirmed') {
      const p = f.payload as Record<string, unknown>;
      const b = req.body ?? {};
      const emotion = String(p.emotion ?? '').trim().toLocaleLowerCase('uk');
      // Автор може уточнити оцінки перед підтвердженням; порожнє — як запропонував AI.
      const pickScore = (over: unknown, orig: unknown) => {
        const v = over !== undefined ? over : orig;
        return v == null || v === '' || !Number.isFinite(Number(v)) ? null : clampIntensity(Number(v));
      };
      const intensity = pickScore(b.intensity, p.intensity) ?? 5;
      const layer = ['primary', 'secondary', 'hidden'].includes(String(b.layer ?? p.layer)) ? (String(b.layer ?? p.layer) as 'primary' | 'secondary' | 'hidden') : 'primary';
      // Спершу точка: якщо абзацу вже немає — висновок лишається на розгляді.
      point = await repo.upsertEmotionPoint({
        projectId: req.params.id,
        characterId: f.entityId,
        paragraphId: f.sourceParagraphIds[0] ?? '',
        emotion,
        family: emotionFamily(emotion),
        layer,
        intensity,
        craft: pickScore(b.craft, p.craft),
        impact: pickScore(b.impact, p.impact),
        note: String(p.statement ?? ''),
        source: 'ai',
        findingId: f.id,
        createdBy: actor,
      });
    }
    const finding = await repo.setFindingStatus(
      req.params.id,
      f.id,
      status,
      actor,
      status === 'confirmed' ? 'підтверджено автором (емоційний монітор)' : 'відхилено автором (емоційний монітор)',
    );
    res.json({ finding, point });
  }));

  // ── Т2.3 В2: бібліотека ілюстрацій — прив'язка зображень до сутностей ──────

  /** Портрет із картки героя в Студії — запасний, коли зв'язку ще немає. */
  const cardPortrait = (projectId: string) => async (entity: EntityRow) => {
    if (!deps.studio) return null;
    const st = await deps.studio(projectId, entity).catch(() => undefined);
    return st?.character?.avatarUrl || null;
  };

  /** Зв'язки зображень книги; `?assetUrl=&entityId=&sectionId=` — фільтри. Відхилені — лише з `includeRejected=1`. */
  app.get('/api/projects/:id/visual/links', withRepo(async (repo, req, res) => {
    const q = req.query as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    if (!(await repo.getProject(req.params.id))) {
      res.json({ synced: false, links: [] });
      return;
    }
    const links = (await repo.listAssetLinks(req.params.id, { assetUrl: str(q.assetUrl), entityId: str(q.entityId), sectionId: str(q.sectionId) }))
      .filter((l) => q.includeRejected === '1' || l.status !== 'rejected');
    res.json({ synced: true, canEdit: canEditStory(req.projectAccess!), links: await describeLinks(repo, req.params.id, links) });
  }));

  /** Для вибирача в Медіатеці: сутності (за типами ролей) і розділи книги. */
  app.get('/api/projects/:id/visual/targets', withRepo(async (repo, req, res) => {
    const [entities, docs] = await Promise.all([repo.listEntities(req.params.id), repo.listDocuments(req.params.id)]);
    const chapters = docs.filter((d) => d.kind === 'chapter' && !d.deletedAt).sort((a, b) => a.order - b.order);
    const chapterNo = new Map(chapters.map((c, i) => [c.id, i + 1]));
    const sections = docs
      .filter((d) => d.kind === 'section' && !d.deletedAt && d.parentId && chapterNo.has(d.parentId))
      .sort((a, b) => chapterNo.get(a.parentId!)! - chapterNo.get(b.parentId!)! || a.order - b.order)
      .map((d) => ({ id: d.id, title: d.title, chapterNumber: chapterNo.get(d.parentId!)! }));
    res.json({
      entities: entities
        .filter((e) => e.status !== 'rejected')
        .map((e) => ({ id: e.id, type: e.type, name: e.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'uk')),
      sections,
      roles: ASSET_ROLES,
      roleTypes: ROLE_ENTITY_TYPES,
    });
  }));

  /** Прив'язати зображення: до сутності (портрет, повний зріст, референс, «зображено», локація, предмет) або до сцени. */
  app.post('/api/projects/:id/visual/links', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const b = req.body ?? {};
    const role = String(b.role ?? '') as AssetRole;
    const assetUrl = typeof b.assetUrl === 'string' ? b.assetUrl.trim() : '';
    if (!ASSET_ROLES.includes(role) || !isLinkableAssetUrl(assetUrl)) {
      res.status(400).json({ error: 'Потрібні зображення з Медіатеки (не вбудований data:-URL) і роль.', kind: 'bad_input' });
      return;
    }
    let entityId: string | null = null;
    let sectionId: string | null = null;
    if (role === 'scene') {
      const doc = (await repo.listDocuments(req.params.id)).find((d) => d.id === b.sectionId && d.kind === 'section' && !d.deletedAt);
      if (!doc) {
        res.status(404).json({ error: 'Розділ не знайдено в книзі.', kind: 'not_found' });
        return;
      }
      sectionId = doc.id;
    } else {
      const e = await repo.getEntity(req.params.id, String(b.entityId ?? ''));
      if (!e || e.status === 'rejected') {
        res.status(404).json({ error: 'Сутність не знайдено в книзі.', kind: 'not_found' });
        return;
      }
      const types = ROLE_ENTITY_TYPES[role as Exclude<AssetRole, 'scene'>];
      if (types && !types.includes(e.type)) {
        res.status(400).json({ error: `Роль «${role}» — для сутностей типу ${types.join(' / ')}, а «${e.name}» — ${e.type}.`, kind: 'bad_input' });
        return;
      }
      entityId = e.id;
    }
    // Версія зовнішності (Т2.3 В3) — лише для портрета, повного зросту, референсу героя.
    const versionId = typeof b.appearanceVersionId === 'string' && b.appearanceVersionId ? b.appearanceVersionId : null;
    if (versionId) {
      const v = await repo.getAppearanceVersion(req.params.id, versionId);
      if (!v || v.entityId !== entityId || !VERSIONED_ROLES.includes(role)) {
        res.status(400).json({ error: 'Версія зовнішності — лише цього героя і для портрета, повного зросту чи референсу.', kind: 'bad_input' });
        return;
      }
    }
    const link = await repo.upsertAssetLink({
      projectId: req.params.id,
      assetUrl,
      role,
      entityId,
      sectionId,
      appearanceVersionId: versionId,
      status: 'confirmed',
      source: 'author',
      note: typeof b.note === 'string' ? b.note.slice(0, 500) : '',
      createdBy: `user:${req.projectAccess!.userId}`,
    });
    res.status(201).json({ link: (await describeLinks(repo, req.params.id, [link]))[0] });
  }));

  /** Підтвердити чи відхилити зв'язок (пропозиції AI-3 — етап В4; відхилений перенесений з книги не повертається). */
  app.post('/api/projects/:id/visual/links/:linkId/status', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const status = req.body?.status;
    if (status !== 'confirmed' && status !== 'rejected') {
      res.status(400).json({ error: 'Статус — confirmed або rejected.', kind: 'bad_input' });
      return;
    }
    const l = await repo.getAssetLink(req.params.id, req.params.linkId);
    if (!l) {
      res.status(404).json({ error: 'Зв\'язку немає.', kind: 'not_found' });
      return;
    }
    res.json({ link: await repo.setAssetLinkStatus(req.params.id, l.id, status) });
  }));

  /**
   * Відв'язати. Зв'язок, перенесений з книги, не видаляється, а стає
   * відхиленим — інакше наступна синхронізація повернула б його.
   */
  app.delete('/api/projects/:id/visual/links/:linkId', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const l = await repo.getAssetLink(req.params.id, req.params.linkId);
    if (!l) {
      res.status(404).json({ error: 'Зв\'язку немає.', kind: 'not_found' });
      return;
    }
    if (l.source === 'legacy') await repo.setAssetLinkStatus(req.params.id, l.id, 'rejected');
    else await repo.deleteAssetLink(req.params.id, l.id);
    res.json({ ok: true, rejected: l.source === 'legacy' });
  }));

  /** «Хто в сцені»: герої розділу з портретами й ілюстрації сцени — для редактора. */
  app.get('/api/projects/:id/visual/scene', withRepo(async (repo, req, res) => {
    const sectionId = typeof req.query.sectionId === 'string' ? req.query.sectionId : '';
    const v = sectionId ? await sceneVisuals(repo, req.params.id, sectionId, cardPortrait(req.params.id)) : null;
    if (!v) {
      res.status(404).json({ error: 'Розділ ще не синхронізовано з ядром.', kind: 'not_found' });
      return;
    }
    res.json(v);
  }));

  /** Портрет героя (зв'язок або картка). */
  app.get('/api/projects/:id/visual/portrait/:entityId', withRepo(async (repo, req, res) => {
    const e = await repo.getEntity(req.params.id, req.params.entityId);
    if (!e || e.type !== 'character') {
      res.status(404).json({ error: 'Героя не знайдено.', kind: 'not_found' });
      return;
    }
    res.json({ portrait: await heroPortrait(repo, req.params.id, e.id, await cardPortrait(req.params.id)(e)) });
  }));

  // ── Т2.3 В3: версії зовнішності героя за віком чи етапом ─────────────────

  /** Герой книги (лише тип «персонаж») або 404. */
  const heroOr404 = async (repo: CoreRepository, req: Request, res: Response): Promise<EntityRow | null> => {
    const e = await repo.getEntity(req.params.id, req.params.entityId);
    if (!e || e.status === 'rejected' || e.type !== 'character') {
      res.status(404).json({ error: 'Героя не знайдено.', kind: 'not_found' });
      return null;
    }
    return e;
  };
  /** Картка героя в Студії: опис зовнішності (канон автора) і портрет. */
  const heroCard = async (projectId: string, e: EntityRow) => {
    const st = deps.studio ? await deps.studio(projectId, e).catch(() => undefined) : undefined;
    const c = studioCanon(st?.character ?? null, st?.all ?? []);
    return { description: c.fields.find((f) => f.key === 'appearance')?.value ?? '', portraitUrl: c.portraitUrl };
  };
  const chapterList = async (repo: CoreRepository, projectId: string) =>
    (await repo.listDocuments(projectId))
      .filter((d) => d.kind === 'chapter' && !d.deletedAt)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((d, i) => ({ number: i + 1, title: d.title }));
  const versionBody = (b: any) => ({
    label: typeof b.label === 'string' ? b.label : '',
    age: typeof b.age === 'string' || typeof b.age === 'number' ? String(b.age) : undefined,
    fromChapter: b.fromChapter ?? null,
    toChapter: b.toChapter ?? null,
    description: typeof b.description === 'string' ? b.description : undefined,
    approved: typeof b.approved === 'boolean' ? b.approved : undefined,
  });

  /** Стрічка версій героя; `?chapter=N` — «стан на главі N» (діюча позначена, пізніші приховані). */
  app.get('/api/projects/:id/visual/appearance/:entityId', withRepo(async (repo, req, res) => {
    const e = await heroOr404(repo, req, res);
    if (!e) return;
    const chapters = await chapterList(repo, req.params.id);
    const n = Number(req.query.chapter);
    const upto = Number.isInteger(n) && n >= 1 ? Math.min(n, Math.max(1, chapters.length)) : null;
    const view = await appearanceOverview(repo, req.params.id, e.id, await heroCard(req.params.id, e), upto);
    res.json({ ...view, entity: { id: e.id, name: e.name }, chapters, canEdit: canEditStory(req.projectAccess!) });
  }));

  /** Нова версія. Опис не передано — береться з картки героя (канон автора). */
  app.post('/api/projects/:id/visual/appearance/:entityId', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const e = await heroOr404(repo, req, res);
    if (!e) return;
    const b = versionBody(req.body ?? {});
    const version = await repo.upsertAppearanceVersion({
      projectId: req.params.id,
      entityId: e.id,
      ...b,
      description: b.description ?? (await heroCard(req.params.id, e)).description,
      approved: b.approved ?? true,
      createdBy: `user:${req.projectAccess!.userId}`,
    });
    res.status(201).json({ version });
  }));

  /** Змінити версію (назва, вік, глави, опис, затвердження). */
  app.patch('/api/projects/:id/visual/appearance/:entityId/versions/:versionId', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const prev = await repo.getAppearanceVersion(req.params.id, req.params.versionId);
    if (!prev || prev.entityId !== req.params.entityId) {
      res.status(404).json({ error: 'Версії зовнішності немає.', kind: 'not_found' });
      return;
    }
    const raw = req.body ?? {};
    const b = versionBody(raw);
    const version = await repo.upsertAppearanceVersion({
      id: prev.id,
      projectId: req.params.id,
      entityId: prev.entityId,
      label: 'label' in raw ? b.label : prev.label,
      age: b.age ?? prev.age,
      fromChapter: 'fromChapter' in raw ? b.fromChapter : prev.fromChapter,
      toChapter: 'toChapter' in raw ? b.toChapter : prev.toChapter,
      description: b.description ?? prev.description,
      approved: b.approved ?? prev.approved,
      createdBy: `user:${req.projectAccess!.userId}`,
    });
    res.json({ version });
  }));

  /** Видалити версію; її портрети лишаються загальними портретами героя. */
  app.delete('/api/projects/:id/visual/appearance/:entityId/versions/:versionId', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const prev = await repo.getAppearanceVersion(req.params.id, req.params.versionId);
    if (!prev || prev.entityId !== req.params.entityId) {
      res.status(404).json({ error: 'Версії зовнішності немає.', kind: 'not_found' });
      return;
    }
    res.json({ ok: await repo.deleteAppearanceVersion(req.params.id, prev.id, `user:${req.projectAccess!.userId}`) });
  }));

  /**
   * Портрет версії: `{ assetUrl }` — зображення з Медіатеки стає портретом
   * цієї версії (зв'язок «портрет» героя з позначкою версії); попередній
   * портрет версії, прив'язаний автором, відв'язується, перенесений з книги —
   * стає загальним. `{ assetUrl: null }` — прибрати портрет версії.
   */
  app.put('/api/projects/:id/visual/appearance/:entityId/versions/:versionId/portrait', withRepo(async (repo, req, res) => {
    if (!requireStoryEdit(req, res)) return;
    const v = await repo.getAppearanceVersion(req.params.id, req.params.versionId);
    if (!v || v.entityId !== req.params.entityId) {
      res.status(404).json({ error: 'Версії зовнішності немає.', kind: 'not_found' });
      return;
    }
    const raw = req.body?.assetUrl;
    const assetUrl = typeof raw === 'string' ? raw.trim() : null;
    if (raw != null && !isLinkableAssetUrl(assetUrl ?? '')) {
      res.status(400).json({ error: 'Потрібне зображення з Медіатеки (не вбудований data:-URL).', kind: 'bad_input' });
      return;
    }
    const actor = `user:${req.projectAccess!.userId}`;
    const links = await repo.listAssetLinks(req.params.id, { entityId: v.entityId });
    for (const l of links) {
      if (l.role !== 'portrait' || l.appearanceVersionId !== v.id || l.assetUrl === assetUrl) continue;
      if (l.source === 'author') await repo.deleteAssetLink(req.params.id, l.id);
      else await repo.upsertAssetLink({ projectId: l.projectId, assetUrl: l.assetUrl, role: l.role, entityId: l.entityId, status: l.status, source: l.source, appearanceVersionId: null, createdBy: l.createdBy });
    }
    let link = null;
    if (assetUrl) {
      const same = links.find((l) => l.role === 'portrait' && l.assetUrl === assetUrl);
      link = await repo.upsertAssetLink({
        projectId: req.params.id,
        assetUrl,
        role: 'portrait',
        entityId: v.entityId,
        appearanceVersionId: v.id,
        status: 'confirmed',
        source: same && same.source !== 'ai' ? same.source : 'author',
        createdBy: same && same.source === 'legacy' ? same.createdBy : actor,
      });
    }
    await repo.addAppearanceHistory({
      projectId: req.params.id,
      versionId: v.id,
      entityId: v.entityId,
      action: assetUrl ? 'portrait' : 'portrait_removed',
      snapshot: { label: v.label, assetUrl },
      actor,
    });
    res.json({ link: link ? (await describeLinks(repo, req.params.id, [link]))[0] : null });
  }));

  // ── Т1.6: прототип FLC етапу 0 (лише адміністратор) ──────────────────────

  /**
   * Один повний цикл retrieval → профіль → Jev → LLM → чернетка для героя.
   * Прототип для звіту (Т1.6): лише адміністратор, нічого не записує в канон;
   * відповідь — чернетка з рішенням, часом кроків, вартістю й журналом агентів.
   */
  app.post('/api/projects/:id/flc/prototype', withRepo(async (repo, req, res) => {
    if (req.projectAccess!.role !== 'admin') {
      res.status(403).json({ error: 'Прототип FLC доступний лише адміністратору.', kind: 'forbidden' });
      return;
    }
    if (!deps.flc) {
      res.status(503).json({ error: 'Прототип FLC тут не підключено.', kind: 'core_unavailable' });
      return;
    }
    const b = req.body ?? {};
    const entity = await repo.getEntity(req.params.id, String(b.entityId ?? ''));
    const question = typeof b.question === 'string' ? b.question.trim() : '';
    if (!entity || entity.status === 'rejected' || !question) {
      res.status(400).json({ error: 'Потрібні герой книги і запитання.', kind: 'bad_input' });
      return;
    }
    const actor = `user:${req.projectAccess!.userId}`;
    const llm = deps.flc.llm(req.params.id, actor);
    try {
      const result = await runFlcCycle(
        {
          repo,
          jev: await deps.flc.jev(),
          fallback: new LlmFallbackJevAdapter(llm),
          llm,
          studio: deps.studio ? await deps.studio(req.params.id, entity).catch(() => undefined) : undefined,
        },
        {
          projectId: req.params.id,
          entityId: entity.id,
          question: question.slice(0, 2000),
          asOfChapter: Number(b.asOfChapter) || null,
          allowedActions: Array.isArray(b.allowedActions) ? b.allowedActions.map(String) : undefined,
          actorId: actor,
        },
      );
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: `Цикл не завершився: ${(err as Error).message}`, kind: 'flc_failed' });
    }
  }));

  /** Зв'язки проєкту або однієї сутності (`?entityId=`). */
  app.get('/api/projects/:id/relations', withRepo(async (repo, req, res) => {
    const entityId = typeof req.query.entityId === 'string' && req.query.entityId ? req.query.entityId : undefined;
    const includeRejected = req.query.includeRejected === '1';
    const relations = await repo.listRelations(req.params.id, entityId);
    res.json({ relations: relations.filter((r) => includeRejected || r.status !== 'rejected') });
  }));
}
