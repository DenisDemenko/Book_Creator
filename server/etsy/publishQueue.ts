/**
 * Черга публікації на Etsy: покроковий, відновлюваний конвеєр.
 *
 * ЧОМУ ЧЕРГА, А НЕ ПРОСТО `await` У РОУТІ
 * Публікація — це 1 + до 10 + до 5 + 1 звернень до Etsy, кожне з яких може
 * впертися в 429 або 5xx. Виконувати це прямо в HTTP-запиті означало б
 * тримати з'єднання хвилинами й губити всю роботу від будь-якого обриву.
 * Тому роут лише ставить задачу в чергу й одразу віддає її id, а конвеєр
 * крутиться окремо.
 *
 * ЧОМУ ЧЕРГА В БАЗІ, А НЕ В ПАМ'ЯТІ
 * ТЗ 8 вимагає пережити рестарт сервера без втрати статусу задачі. Задача
 * зберігає `step` (де вона зупинилась) і `progress` (що вже завантажено), тож
 * після рестарту робота продовжується з місця обриву. Саме тому крок
 * «створити чернетку» відокремлений від «завантажити файли»: інакше повтор
 * після падіння створював би другий лістинг у крамниці.
 *
 * ІДЕМПОТЕНТНІСТЬ (ТЗ 4.5)
 * Перед створенням лістингу перевіряється, чи в публікації вже є
 * `externalId`. Якщо є — крок пропускається. Разом з UNIQUE(product_id,
 * platform) у схемі це дає гарантію «один товар — один лістинг», навіть якщо
 * автор натисне кнопку п'ять разів поспіль.
 */

import {
  getPublication,
  savePublication,
  saveJob,
  claimNextJob,
  requeueStuckJobs,
  getJobForPublication,
  type StoredPublicationJob,
  type JobStep,
} from '../publishingStore';
import {
  activateListing,
  createDraftListing,
  listingUrl,
  uploadListingFile,
  uploadListingImage,
  EtsyApiError,
  type EtsyClient,
} from './etsyClient';
import { computeBackoffDelayMs, isRetryableStatus } from './rateLimiter';
import { readProductFile } from './productFiles';

export interface PublishJobPayload {
  productId: string;
  shopId: string;
  title: string;
  description: string;
  priceUsd: number;
  tags: string[];
  taxonomyId?: number;
  shopSectionId?: number;
  /** Імена файлів у сховищі товару (productFiles.ts). */
  imageNames: string[];
  fileNames: string[];
  /** false — лишити чернеткою, автор сам активує в кабінеті Etsy. */
  activate: boolean;
}

interface JobProgress {
  listingId?: string;
  uploadedImages?: string[];
  uploadedFiles?: string[];
}

export interface PublishQueueDeps {
  /** Клієнт Etsy для конкретного автора; null — акаунт не підключено. */
  clientForUser: (userId: string) => Promise<EtsyClient | null>;
  /** Читання підготовленого файлу товару (за замовчуванням — з диска). */
  readFile?: (productId: string, name: string) => Promise<Uint8Array>;
  now?: () => Date;
  log?: (line: string) => void;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ставить задачу в чергу. Якщо для публікації вже є незавершена задача, нову
 * не створюємо — повертаємо наявну: подвійне натискання кнопки не має
 * подвоювати роботу.
 */
export async function enqueuePublishJob(params: {
  publicationId: string;
  userId: string;
  payload: PublishJobPayload;
  now?: Date;
}): Promise<StoredPublicationJob> {
  const now = (params.now || new Date()).toISOString();
  const existing = await getJobForPublication(params.publicationId);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return existing;
  }

  const job: StoredPublicationJob = {
    id: nextId('pubjob'),
    publicationId: params.publicationId,
    userId: params.userId,
    status: 'queued',
    // Якщо попередня спроба вже створила лістинг, стартуємо з кроку, на якому
    // вона зупинилась, а не з початку.
    step: (existing?.progress as JobProgress)?.listingId ? (existing!.step as JobStep) : 'create_listing',
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: now,
    payload: params.payload as unknown as Record<string, unknown>,
    progress: (existing?.progress as Record<string, unknown>) || {},
    createdAt: now,
    updatedAt: now,
  };
  await saveJob(job);
  return job;
}

/**
 * Виконує один крок задачі й повертає оновлений стан.
 *
 * Крок за раз — навмисно: між кроками стан фіксується в базі, тож падіння
 * процесу коштує щонайбільше одного кроку, а не всієї публікації.
 */
export async function runJobStep(
  job: StoredPublicationJob,
  deps: PublishQueueDeps
): Promise<StoredPublicationJob> {
  const now = deps.now || (() => new Date());
  const log = deps.log || ((line: string) => console.log(line));
  const readFile = deps.readFile || readProductFile;
  const payload = job.payload as unknown as PublishJobPayload;
  const progress = (job.progress || {}) as JobProgress;

  const publication = await getPublication(job.publicationId);
  if (!publication) {
    return finishJob(job, 'failed', 'Публікацію видалено, поки задача чекала в черзі.', now().toISOString());
  }

  const client = await deps.clientForUser(job.userId);
  if (!client) {
    return finishJob(
      job,
      'failed',
      'Крамницю Etsy не підключено або втрачено доступ. Підключіть її знову на вкладці «Публікація».',
      now().toISOString()
    );
  }

  try {
    switch (job.step) {
      case 'create_listing': {
        // Ідемпотентність: лістинг для цієї публікації міг з'явитись у
        // попередній спробі — тоді просто йдемо далі.
        const existingListingId = progress.listingId || publication.externalId;
        if (existingListingId) {
          progress.listingId = String(existingListingId);
          log(`[queue] ${job.id}: лістинг ${existingListingId} вже існує, крок пропущено`);
        } else {
          const created = await createDraftListing(client, {
            shopId: payload.shopId,
            title: payload.title,
            description: payload.description,
            priceUsd: payload.priceUsd,
            tags: payload.tags,
            taxonomyId: payload.taxonomyId,
            shopSectionId: payload.shopSectionId,
          });
          progress.listingId = String(created.listing_id);
          await savePublication({
            ...publication,
            status: 'draft',
            externalId: progress.listingId,
            externalUrl: listingUrl(progress.listingId),
            lastSyncedAt: now().toISOString(),
            errorLog: undefined,
            updatedAt: now().toISOString(),
          });
          log(`[queue] ${job.id}: створено чернетку лістингу ${progress.listingId}`);
        }
        return advance(job, 'upload_images', progress, now().toISOString());
      }

      case 'upload_images': {
        const uploaded = new Set(progress.uploadedImages || []);
        let rank = uploaded.size + 1;
        for (const name of payload.imageNames || []) {
          if (uploaded.has(name)) continue;
          const bytes = await readFile(payload.productId, name);
          await uploadListingImage(client, {
            shopId: payload.shopId,
            listingId: progress.listingId!,
            fileName: name,
            bytes,
            rank: rank++,
          });
          uploaded.add(name);
          // Фіксуємо після КОЖНОГО файлу: інакше падіння на п'ятому
          // зображенні змусило б завантажувати перші чотири повторно.
          progress.uploadedImages = [...uploaded];
          await saveJob({ ...job, progress: progress as unknown as Record<string, unknown>, updatedAt: now().toISOString() });
        }
        return advance(job, 'upload_files', progress, now().toISOString());
      }

      case 'upload_files': {
        const uploaded = new Set(progress.uploadedFiles || []);
        let rank = uploaded.size + 1;
        for (const name of payload.fileNames || []) {
          if (uploaded.has(name)) continue;
          const bytes = await readFile(payload.productId, name);
          await uploadListingFile(client, {
            shopId: payload.shopId,
            listingId: progress.listingId!,
            fileName: name,
            bytes,
            rank: rank++,
          });
          uploaded.add(name);
          progress.uploadedFiles = [...uploaded];
          await saveJob({ ...job, progress: progress as unknown as Record<string, unknown>, updatedAt: now().toISOString() });
        }
        return advance(job, payload.activate ? 'activate' : 'done', progress, now().toISOString());
      }

      case 'activate': {
        const result = await activateListing(client, {
          shopId: payload.shopId,
          listingId: progress.listingId!,
        });
        await savePublication({
          ...publication,
          status: 'published',
          externalId: progress.listingId,
          externalUrl: result?.url || listingUrl(progress.listingId!),
          lastSyncedAt: now().toISOString(),
          errorLog: undefined,
          updatedAt: now().toISOString(),
        });
        log(`[queue] ${job.id}: лістинг ${progress.listingId} активовано`);
        return advance(job, 'done', progress, now().toISOString());
      }

      case 'done':
      default: {
        const current = await getPublication(job.publicationId);
        if (current && current.status !== 'published') {
          await savePublication({
            ...current,
            status: payload.activate ? 'published' : 'draft',
            lastSyncedAt: now().toISOString(),
            updatedAt: now().toISOString(),
          });
        }
        return finishJob({ ...job, progress: progress as unknown as Record<string, unknown> }, 'done', undefined, now().toISOString());
      }
    }
  } catch (err) {
    return handleStepError(job, progress, err, deps, publication.id);
  }
}

async function advance(
  job: StoredPublicationJob,
  step: JobStep,
  progress: JobProgress,
  nowIso: string
): Promise<StoredPublicationJob> {
  const updated: StoredPublicationJob = {
    ...job,
    step,
    // Крок завершився успішно — лічильник спроб обнуляємо, щоб довга
    // публікація не «з'їдала» ліміт спроб наступного кроку.
    attempts: 0,
    // Назад у чергу: наступний крок підхопить той самий воркер наступним
    // тиком, а стан між кроками вже зафіксовано в базі.
    status: 'queued',
    nextAttemptAt: nowIso,
    lastError: undefined,
    progress: progress as unknown as Record<string, unknown>,
    updatedAt: nowIso,
  };
  await saveJob(updated);
  return updated;
}

async function finishJob(
  job: StoredPublicationJob,
  status: 'done' | 'failed',
  error: string | undefined,
  nowIso: string
): Promise<StoredPublicationJob> {
  const updated: StoredPublicationJob = {
    ...job,
    status,
    step: 'done',
    lastError: error,
    nextAttemptAt: nowIso,
    updatedAt: nowIso,
  };
  await saveJob(updated);
  if (status === 'failed') {
    const publication = await getPublication(job.publicationId);
    if (publication) {
      // Часткова невдача (ТЗ 4.5): якщо лістинг уже створено, лишаємо його
      // чернеткою — автор доллє файли руками, а не втратить роботу.
      await savePublication({
        ...publication,
        status: publication.externalId ? 'draft' : 'failed',
        errorLog: error,
        updatedAt: nowIso,
      });
    }
  }
  return updated;
}

async function handleStepError(
  job: StoredPublicationJob,
  progress: JobProgress,
  err: unknown,
  deps: PublishQueueDeps,
  _publicationId: string
): Promise<StoredPublicationJob> {
  const now = deps.now || (() => new Date());
  const log = deps.log || ((line: string) => console.log(line));
  const nowIso = now().toISOString();
  const attempts = job.attempts + 1;
  const status = err instanceof EtsyApiError ? err.status : 0;
  const message = (err as Error)?.message || 'Невідома помилка публікації.';

  const retryable = status === 0 || isRetryableStatus(status);
  if (retryable && attempts < job.maxAttempts) {
    const delay = computeBackoffDelayMs(attempts);
    const updated: StoredPublicationJob = {
      ...job,
      status: 'queued',
      attempts,
      lastError: message,
      nextAttemptAt: new Date(now().getTime() + delay).toISOString(),
      progress: progress as unknown as Record<string, unknown>,
      updatedAt: nowIso,
    };
    await saveJob(updated);
    log(`[queue] ${job.id}: крок ${job.step} впав (${message}) — повтор ${attempts}/${job.maxAttempts} через ${delay} мс`);
    return updated;
  }

  log(`[queue] ${job.id}: крок ${job.step} остаточно впав — ${message}`);
  return finishJob({ ...job, attempts, progress: progress as unknown as Record<string, unknown> }, 'failed', message, nowIso);
}

/**
 * Фоновий воркер. Один процес — один воркер, черга послідовна: паралелізм тут
 * не пришвидшив би нічого, бо стелею є ліміт Etsy у 10 запитів/сек, зате
 * ускладнив би відновлення після збою.
 */
export function startPublishWorker(
  deps: PublishQueueDeps & { intervalMs?: number }
): { stop: () => void } {
  const intervalMs = deps.intervalMs ?? 2000;
  const now = deps.now || (() => new Date());
  const log = deps.log || ((line: string) => console.log(line));
  let stopped = false;
  let busy = false;

  // Задачі, що лишились у стані `running`, після рестарту нікому не належать.
  requeueStuckJobs(now().toISOString())
    .then((n) => {
      if (n) log(`[queue] Після рестарту повернуто в чергу задач: ${n}`);
    })
    .catch((err) => console.error('[queue] Не вдалося відновити задачі після рестарту:', err));

  const timer = setInterval(async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const job = await claimNextJob(now().toISOString());
      if (job) await runJobStep(job, deps);
    } catch (err) {
      console.error('[queue] Помилка воркера публікації:', err);
    } finally {
      busy = false;
    }
  }, intervalMs);
  // Воркер не має тримати процес живим сам по собі.
  (timer as any)?.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** Проганяє чергу до порожнього стану — для тестів і для ручного «дожати». */
export async function drainQueue(deps: PublishQueueDeps, maxSteps = 50): Promise<number> {
  const now = deps.now || (() => new Date());
  let steps = 0;
  while (steps < maxSteps) {
    const job = await claimNextJob(now().toISOString());
    if (!job) break;
    await runJobStep(job, deps);
    steps++;
  }
  return steps;
}
