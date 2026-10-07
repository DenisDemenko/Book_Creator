import {getDb} from '../../db';
import {contributionIdentity} from './contributionRoutes';
import {contributionDb,newContribution,recordContribution} from './contributionStore';
import type { Express, Request, Response } from 'express';
import type { RealtimeAccessDeps } from '../../realtimeAuth';
import { resolveProjectAccess, type ProjectAccess } from '../projectRoutes';
import type { CoreRepository } from '../types';
import { visibleCharacterRefs } from './access';
import { canEditSection, restrictBook, SECTION_CONTENT_FIELDS } from './accessView';
import { BookRevisionConflict, getBook, getBookRevision, listBookRevisions, patchBookSection, saveBook, type StoredBook } from '../../bookStore';

export interface SourceRoutesDeps {
  access: RealtimeAccessDeps;
  repo?: () => CoreRepository | null;
  onSaved?: (stored: StoredBook, access: ProjectAccess) => void;
}

/** Shared projects read server source; all scoped writes target exactly one scene. */
export function registerSourceRoutes(app: Express, deps: SourceRoutesDeps): void {
  const base = '/api/core/projects/:projectId/source';
  const handle = (fn: (req: Request, res: Response, access: ProjectAccess, stored: StoredBook) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        const access = await resolveProjectAccess(req.principal as never, String(req.params.projectId), deps.access);
        if (!access) { res.status(req.principal && !req.principal.isGuest ? 403 : 401).json({ error: 'Немає доступу до книги.' }); return; }
        const stored = await getBook(access.projectId);
        const owner = await deps.access.getCollabOwnerId(access.projectId) ?? await deps.access.getBookOwnerId(access.projectId);
        if (!stored || stored.ownerId !== owner) { res.status(404).json({ error: 'Серверне джерело книги не знайдено.' }); return; }
        await fn(req, res, access, stored);
      } catch (err) {
        if (err instanceof BookRevisionConflict) {
          res.status(409).json({ error: err.message, kind: 'revision_conflict', current: err.current });
        } else {
          console.error('[collaboration-source]', err);
          res.status(500).json({ error: 'Не вдалося зберегти серверне джерело.' });
        }
      }
    };
  const filtered = async (book: Record<string, unknown>, access: ProjectAccess) => { const repo=deps.repo?.(); return restrictBook(book,access.effective,repo?await visibleCharacterRefs(repo,access.effective):new Set()); };
  const revision = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

  app.get(base, handle(async (_req, res, access, stored) => {
    res.json({ revision: stored.revision, book: await filtered(stored.book, access), canWrite: access.effective.canWriteAny });
  }));
  app.get(`${base}/history`, handle(async (_req, res, access, stored) => {
    res.json({ current: stored.revision, revisions: await listBookRevisions(access.projectId) });
  }));
  app.get(`${base}/history/:revision`, handle(async (req, res, access, _stored) => {
    const n = Number(req.params.revision);
    if (!revision(n)) { res.status(400).json({ error: 'Некоректна ревізія.' }); return; }
    const book = await getBookRevision(access.projectId, n);
    if (!book) { res.status(404).json({ error: 'Ревізію не знайдено.' }); return; }
    res.json({ revision: n, book: await filtered(book, access) });
  }));
  app.patch(`${base}/chapters/:chapterId/sections/:sectionId`, handle(async (req, res, access, stored) => {
    const { chapterId, sectionId } = req.params;
    if (!canEditSection(access.effective, String(chapterId), String(sectionId))) { res.status(403).json({ error: 'Немає права редагувати цю сцену.' }); return; }
    const { patch, expectedRevision } = req.body ?? {};
    if (!revision(expectedRevision) || !patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(k => !SECTION_CONTENT_FIELDS.includes(k))) {
      res.status(400).json({ error: 'Потрібні ревізія та поля змісту однієї сцени.' }); return;
    }
    const chapter = (stored.book.chapters as any[])?.find(c => c.id === chapterId);
    if (!chapter?.sections?.some((s: any) => s.id === sectionId)) { res.status(404).json({ error: 'Сцену не знайдено.' }); return; }
    for (const k of ['content', 'contentEn', 'lastModified']) if (patch[k] !== undefined && typeof patch[k] !== 'string') { res.status(400).json({ error: `Некоректне поле ${k}.` }); return; }
    for (const k of ['wordCount', 'characterCount']) if (patch[k] !== undefined && (!Number.isFinite(patch[k]) || patch[k] < 0)) { res.status(400).json({ error: `Некоректне поле ${k}.` }); return; }
    for (const k of ['paragraphIds', 'paragraphHashes', 'footnotes']) if (patch[k] !== undefined && !Array.isArray(patch[k])) { res.status(400).json({ error: `Некоректне поле ${k}.` }); return; }
    const identity=await contributionIdentity(deps.repo?.()??null,access.projectId,access.userId);
    if (!access.isOwner && access.role!=='admin' && (['coauthor','co_author'].includes(access.role)||identity.roleIds.includes('co_author'))) {res.status(409).json({error:'Співавтор надсилає Change Proposal для схвалення.',kind:'proposal_required'});return;}
    const audit=!!getDb();if(audit)contributionDb();
    const saved = await patchBookSection({ bookId: access.projectId, chapterId: String(chapterId), sectionId: String(sectionId), expectedRevision, patch,
      ...(audit?{onSqlCommit:s=>recordContribution(newContribution({projectId:access.projectId,userId:access.userId,...identity,actionType:'EDITED',resourceType:'scene',resourceId:String(sectionId),chapterId:String(chapterId),sourceRevision:expectedRevision,resultRevision:s.revision,taskId:null,deliverableId:null,approvedBy:access.userId,provenance:{source:'source_patch'}}))}:{}) });
    deps.onSaved?.(saved, access);
    res.json({ revision: saved.revision, book: await filtered(saved.book, access) });
  }));
  // Restoring whole source is an author's explicit operation; participants use scene patches.
  app.post(`${base}/restore`, handle(async (req, res, access, _stored) => {
    if (!access.isOwner && access.role !== 'admin') { res.status(403).json({ error: 'Відновлює книгу власник або адміністратор.' }); return; }
    const { sourceRevision, expectedRevision } = req.body ?? {};
    if (!revision(sourceRevision) || !revision(expectedRevision)) { res.status(400).json({ error: 'Потрібні дві ревізії.' }); return; }
    const book = await getBookRevision(access.projectId, sourceRevision);
    if (!book) { res.status(404).json({ error: 'Ревізію не знайдено.' }); return; }
    book.updatedAt = new Date().toISOString();
    const saved = await saveBook({ book, expectedRevision });
    deps.onSaved?.(saved, access);
    res.json({ revision: saved.revision, book: saved.book });
  }));
}
