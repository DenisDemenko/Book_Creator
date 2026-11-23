import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Character } from '../../src/types';
import { requirePermission } from '../auth';
import { BookRevisionConflict, getBook, listBooks, saveBook } from '../bookStore';
import { getAsset, listAssets, readAsset, saveAsset } from '../media/mediaLibraryStore';
import { decodeScanImage, requireExternalToken } from './externalApiRoutes';
import { libraryUrl } from './photoDraftMapping';
import type { PhotoDraftDeps } from './photoDraftRoutes';
import { PHOTO_DRAFT_LIMITS } from '../../shared/photoDraftContract';

const BASE = '/api/external/v1/photo-drafts/character-prototypes';
const JOB_TTL = 30 * 60_000;
const MAX_JOBS = 128;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

type Photo = { bytes: Uint8Array; mimeType: string; assetId?: string };
type Draft = { visible: string; fiction: string };
type Job = {
  ownerId: string; bookId: string; digest: string; assetId?: string; expires: number;
  status: 'processing' | 'ready' | 'failed'; draft?: Draft;
};

const validPhoto = (p: { mimeType: string; sizeBytes: number }) =>
  IMAGE_TYPES.has(p.mimeType) && p.sizeBytes > 0 && p.sizeBytes <= PHOTO_DRAFT_LIMITS.maxImageBytes;
const clean = (value: unknown, max: number) =>
  typeof value === 'string' && [...value.trim()].length <= max ? value.trim() : '';
const digest = (photo: Photo) => createHash('sha256').update(photo.bytes).digest('hex');
const fail = (res: Response, status: number, kind: string, error: string) =>
  res.status(status).json({ kind, error });

async function ownedBook(id: string, ownerId: string) {
  const book = await getBook(id);
  return book?.ownerId === ownerId && !book.book.privateStore ? book : null;
}

async function libraryPhoto(id: string, bookId: string, ownerId: string): Promise<Photo | null> {
  const metadata = await getAsset(id);
  if (!metadata || metadata.ownerId !== ownerId || metadata.bookId !== bookId || !validPhoto(metadata)) return null;
  const file = await readAsset(id);
  return file && file.record.ownerId === ownerId && file.record.bookId === bookId &&
    validPhoto({ mimeType: file.record.mimeType, sizeBytes: file.bytes.length })
    ? { bytes: file.bytes, mimeType: file.record.mimeType, assetId: id } : null;
}

async function inputPhoto(body: Record<string, unknown>, bookId: string, ownerId: string): Promise<Photo | null> {
  if (typeof body.assetId === 'string') return libraryPhoto(body.assetId, bookId, ownerId);
  const photo = decodeScanImage(body.image, null);
  return photo && validPhoto({ mimeType: photo.mimeType, sizeBytes: photo.bytes.length }) ? photo : null;
}

export function registerCharacterPrototypeRoutes(app: Express, deps: PhotoDraftDeps) {
  const auth = requireExternalToken(deps.now);
  const owner = (req: Request) => String(req.principal!.id);
  const jobs = new Map<string, Job>();
  const saving = new Set<string>();
  const queueIsFull = (userId: string) => jobs.size >= MAX_JOBS ||
    [...jobs.values()].some(job => job.ownerId === userId && job.status === 'processing');
  const findJob = (id: string, userId: string) => {
    const job = jobs.get(id);
    return job && job.ownerId === userId && job.expires > Date.now() ? job : null;
  };
  const unexpected = (res: Response) =>
    fail(res, 500, 'server_error', 'Не вдалося виконати дію з героєм. Спробуйте ще раз.');

  app.get(BASE + '/books', auth, async (req, res) => {
    try {
      const userId = owner(req);
      const candidates = await listBooks(userId);
      // Return only selectors, never a manuscript or the contents of its canon.
      const books = (await Promise.all(candidates.map(async ({ id, title }) =>
        await ownedBook(id, userId) ? { id, title } : null))).filter(Boolean);
      return res.json({ books });
    } catch { return unexpected(res); }
  });

  app.get(BASE + '/books/:bookId/photos', auth, async (req, res) => {
    try {
      const userId = owner(req), bookId = String(req.params.bookId);
      if (!(await ownedBook(bookId, userId))) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');
      const photos = (await listAssets(userId, { bookId })).filter(validPhoto).slice(0, 100)
        .map(({ id, title, filename }) => ({ id, title: title || filename }));
      return res.json({ photos });
    } catch { return unexpected(res); }
  });

  app.get(BASE + '/books/:bookId/photos/:assetId', auth, async (req, res) => {
    try {
      const userId = owner(req), bookId = String(req.params.bookId);
      if (!(await ownedBook(bookId, userId))) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');
      const photo = await libraryPhoto(String(req.params.assetId), bookId, userId);
      if (!photo) return fail(res, 404, 'photo_not_found', 'Фото не знайдено.');
      res.set('Cache-Control', 'private, no-store');
      return res.json({ image: 'data:' + photo.mimeType + ';base64,' + Buffer.from(photo.bytes).toString('base64') });
    } catch { return unexpected(res); }
  });

  app.post(BASE + '/books/:bookId/describe', auth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const userId = owner(req), bookId = String(req.params.bookId);
      const book = await ownedBook(bookId, userId);
      if (!book) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');
      const photo = await inputPhoto(req.body ?? {}, bookId, userId);
      if (!photo) return fail(res, 400, 'bad_image', 'Виберіть фото JPEG, PNG або WebP.');
      for (const [id, job] of jobs) if (job.expires <= Date.now()) jobs.delete(id);
      if (queueIsFull(userId))
        return fail(res, 429, 'rate_limited', 'Опис уже готується. Зачекайте або спробуйте трохи пізніше.');

      const billed = await deps.passModels?.visionBlock?.(req, 'describe');
      if (billed?.billed && billed.reason) return fail(res, 402, 'ai_budget_exceeded', billed.reason);
      if (!billed?.billed && deps.checkAiBudget) {
        const quota = await deps.checkAiBudget({ userId, role: String(req.principal?.role ?? 'writer') });
        if (!quota.allowed) return fail(res, 402, 'ai_budget_exceeded', quota.reasonUk || 'Вичерпано ліміт ШІ.');
      }
      const id = randomUUID();
      if (queueIsFull(userId))
        return fail(res, 429, 'rate_limited', 'Опис уже готується. Зачекайте або спробуйте трохи пізніше.');
      const job: Job = { ownerId: userId, bookId, assetId: photo.assetId, digest: digest(photo), expires: Date.now() + JOB_TTL, status: 'processing' };
      jobs.set(id, job);
      const work = async () => {
        try {
          const result = await deps.describe({
            ownerId: userId, draftId: id, req, mimeType: photo.mimeType, base64: Buffer.from(photo.bytes).toString('base64'),
            context: { kind: 'book', title: clean(book.title, 300), craft: null, audience: null, notes: [clean(req.body?.note, 500)] },
            prototype: { language: req.body?.language === 'en' ? 'en' : 'uk' },
          });
          if (!result.fiction || !result.description) throw new Error('Incomplete prototype description.');
          job.draft = { visible: result.description, fiction: result.fiction };
          job.status = 'ready';
        } catch { job.status = 'failed'; }
      };
      if (deps.schedule) deps.schedule(work); else void work();
      return res.status(202).json({ jobId: id });
    } catch { return unexpected(res); }
  });

  app.get(BASE + '/jobs/:jobId', auth, (req, res) => {
    const job = findJob(String(req.params.jobId), owner(req));
    if (!job) return fail(res, 404, 'draft_not_found', 'Опис більше недоступний. Розпізнайте фото ще раз.');
    res.set('Cache-Control', 'private, no-store');
    return res.json({ status: job.status, draft: job.draft });
  });

  app.post(BASE + '/books/:bookId/save', auth, requirePermission('canEditContent'), async (req, res) => {
    const userId = owner(req), bookId = String(req.params.bookId);
    const body = req.body ?? {};
    if (typeof body.jobId !== 'string' || !UUID.test(body.jobId))
      return fail(res, 400, 'bad_input', 'Спершу розпізнайте фото.');
    const characterId = 'char-gf-' + body.jobId;
    const studioUrl = '/projects/' + encodeURIComponent(bookId) + '/editor?from=grabfusion&grabfusionCharacter=' + characterId;
    const saveKey = JSON.stringify([userId, bookId, characterId]);
    if (saving.has(saveKey)) return fail(res, 409, 'job_running', 'Герой ще зберігається. Спробуйте за мить.');
    saving.add(saveKey);
    try {
      let book = await ownedBook(bookId, userId);
      if (!book) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');
      const existing = (current: typeof book) => Array.isArray(current?.book.characters) &&
        current.book.characters.some((character: Character) => character?.id === characterId);
      if (existing(book)) return res.json({ characterId, studioUrl });
      const name = clean(body.name, 160), visible = clean(body.visible, 2400), fiction = clean(body.fiction, 2400);
      if (!name || !visible || !fiction) return fail(res, 400, 'bad_input', 'Введіть ім’я героя й перевірте обидва описи.');
      const job = findJob(body.jobId, userId);
      if (!job || job.bookId !== bookId || job.status !== 'ready')
        return fail(res, 409, 'wrong_status', 'Розпізнайте фото для цієї книги ще раз.');
      const photo = await inputPhoto(body, bookId, userId);
      if (!photo || photo.assetId !== job.assetId || digest(photo) !== job.digest)
        return fail(res, 400, 'bad_image', 'Фото змінилося. Розпізнайте його ще раз.');

      const assetId = photo.assetId ?? 'md-gf-' + body.jobId;
      let asset = await getAsset(assetId);
      if (asset && (asset.ownerId !== userId || asset.bookId !== bookId)) return fail(res, 404, 'photo_not_found', 'Фото не знайдено.');
      if (!asset && photo.assetId) return fail(res, 404, 'photo_not_found', 'Фото не знайдено.');
      if (!asset) {
        const filename = 'grabfusion-character-' + body.jobId + '.' + (photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg');
        const principal = req.principal!;
        const quota = await deps.checkStorage?.({ userId, email: String(principal.email ?? ''), role: principal.role, bytes: photo.bytes.length, bookId, filename });
        if (quota && !quota.allowed) return fail(res, 402, 'quota_exceeded', quota.reasonUk || 'Вичерпано ліміт сховища.');
        asset = await saveAsset({
          id: assetId, ownerId: userId, bookId, kind: 'upload', filename, bytes: photo.bytes, mimeType: photo.mimeType,
          passport: { title: name, altText: [...visible].slice(0, 240).join('') },
          beforePersist: async () => { if (!(await ownedBook(bookId, userId))) throw new Error('Book no longer available.'); },
        });
      }

      const character: Character = {
        id: characterId, bookId, name, role: 'minor', avatarUrl: libraryUrl(asset.id),
        appearance: { distinguishingMarks: visible },
        biography: fiction, behaviorPatterns: [],
        personality: { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' },
        relationships: [], tags: ['GrabFusion'],
      };
      for (let attempt = 0; attempt < 3 && book; attempt += 1) {
        if (existing(book)) return res.json({ characterId, studioUrl });
        const characters = Array.isArray(book.book.characters) ? book.book.characters : [];
        try {
          await saveBook({ ownerId: userId, expectedRevision: book.revision,
            book: { ...book.book, characters: [...characters, character], updatedAt: new Date().toISOString() },
            beforeWrite: async () => { if (!(await ownedBook(bookId, userId))) throw new Error('Book no longer available.'); },
          });
          return res.status(201).json({ characterId, studioUrl });
        } catch (error) {
          if (!(error instanceof BookRevisionConflict)) throw error;
          book = await ownedBook(bookId, userId);
        }
      }
      // The uploaded photo is reused on retry with this job. Never overwrite a newer book revision.
      return fail(res, 409, 'revision_conflict', 'Книга оновлюється. Натисніть «Зберегти героя» ще раз.');
    } catch { return unexpected(res); }
    finally { saving.delete(saveKey); }
  });
}
