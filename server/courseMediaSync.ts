/**
 * Фото курсу з медіатеки Студії → вітрина (етап 0 плану «Курс за фото»).
 *
 * ЧОМУ ЦЕ ПОТРІБНО. Покупець відкриває курс у маркетплейсі, а фото автора
 * лежать у медіатеці Студії за адресою `/api/media/file/<id>` — відносною, без
 * публічного доступу. Збирач payload відкидав усе, що не абсолютний http(s)
 * (`courseMarketplacePayload`), тож фото, завантажені через медіатеку, мовчки
 * зникали, а в уроці покупець бачив лише текст. Тепер:
 *   - обкладинка з медіатеки їде файлом як публічна (`role: cover`);
 *   - фото уроків їдуть файлами як ПЛАТНІ (`role: lesson_photo`) з ключем
 *     `sourceKey` = id активу; у зміст курсу вони потрапляють як `media:<id>`,
 *     а вітрина розкриває це лише покупцю;
 *   - після завантаження вітрині кажуть, які фото ще потрібні, решта
 *     видаляється (`prune`), тож прибране з уроку фото не лишається в сховищі.
 *
 * Операція ідемпотентна: той самий `sourceKey` замінює файл на місці. Тому
 * будь-яка помилка тут зупиняє публікацію з причиною — адмін повторює, і нічого
 * не множиться. Фото без файла на диску чи чуже / не-зображення не зупиняє
 * публікацію, але потрапляє у звіт (`skipped`).
 */
import { libraryAssetId } from '../src/utils/libraryMediaUrl';
import { readAsset } from './media/mediaLibraryStore';
import {
  attachCourseMediaToMarketplace,
  pruneCourseMediaOnMarketplace,
  MarketplaceBridgeError,
  type BridgeSettings,
} from './marketplaceBridge';

/** Формати, які приймає вітрина (`BRIDGE_ALLOWED_COVER_MIME`). */
export const COURSE_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
/** Стеля розміру одного файла у вітрині (`BRIDGE_MAX_FILE_BYTES`). */
export const COURSE_PHOTO_MAX_BYTES = 50 * 1024 * 1024;

export interface CourseMediaCourse {
  id: string;
  ownerId: string;
  coverUrl?: string;
  modules: Array<{
    coverPhotoUrl?: string;
    lessons: Array<{ photoUrls: string[] }>;
  }>;
}

export type SkipReason = 'missing' | 'foreign' | 'unsupported_format' | 'too_big';

export interface CourseMediaReport {
  /** `library` — обкладинка завантажена файлом; `external` — посилання; `none` — немає. */
  cover: 'library' | 'external' | 'none';
  /** Скільки фото уроків (і обкладинок модулів) лежить у вітрині після синхронізації. */
  uploaded: number;
  /** Фото, які не вдалося взяти з медіатеки; у вітрині їх не буде. */
  skipped: Array<{ id: string; reason: SkipReason }>;
  /** Скільки застарілих фото прибрано з вітрини. */
  pruned: number;
  /** Приймач без `course-media-v1`: стільки фото медіатеки не поїхало. */
  unsupported: number;
}

/** Усі активи медіатеки, на які посилається зміст курсу: без повторів, у порядку курсу. */
export function collectCoursePhotoIds(course: CourseMediaCourse): string[] {
  const ids: string[] = [];
  const add = (url: string | undefined) => {
    const id = libraryAssetId(url);
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const module of course.modules ?? []) {
    add(module.coverPhotoUrl);
    for (const lesson of module.lessons ?? []) {
      for (const url of lesson.photoUrls ?? []) add(url);
    }
  }
  return ids;
}

interface SyncDeps {
  settings?: BridgeSettings;
  fetch?: typeof fetch;
  /** Підміна читання медіатеки — для тестів. */
  read?: typeof readAsset;
}

type Loaded =
  | { ok: true; bytes: Uint8Array; mimeType: string; filename: string }
  | { ok: false; reason: SkipReason };

async function load(id: string, ownerId: string, read: typeof readAsset): Promise<Loaded> {
  const found = await read(id);
  if (!found) return { ok: false, reason: 'missing' };
  // Чужий актив тут не читаємо: id у змісті курсу вводить автор, і без цієї
  // перевірки він міг би винести у вітрину файл іншого користувача.
  if (found.record.ownerId !== ownerId) return { ok: false, reason: 'foreign' };
  if (!COURSE_PHOTO_MIME.has(found.record.mimeType)) return { ok: false, reason: 'unsupported_format' };
  if (found.bytes.byteLength > COURSE_PHOTO_MAX_BYTES) return { ok: false, reason: 'too_big' };
  const ext = found.record.mimeType.split('/')[1] || 'bin';
  const title = String((found.record as { title?: string }).title ?? '').trim();
  return {
    ok: true,
    bytes: found.bytes,
    mimeType: found.record.mimeType,
    filename: `${(title || id).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60)}.${ext}`,
  };
}

const SKIP_TEXT: Record<SkipReason, string> = {
  missing: 'файла немає в медіатеці',
  foreign: 'файл належить іншому користувачу',
  unsupported_format: 'формат не підходить (потрібні JPEG, PNG, WebP або AVIF)',
  too_big: 'файл завеликий (понад 50 МБ)',
};

/**
 * Синхронізувати фото курсу. Викликається ПІСЛЯ `publishCourseToMarketplace`
 * (вітрина прикріплює фото до вже наявного лістингу). Кидає
 * `MarketplaceBridgeError`, якщо щось, без чого картка або урок неповні, не
 * вдалося; повторна публікація безпечна.
 */
export async function syncCourseMedia(
  course: CourseMediaCourse,
  options: { photoUpload: boolean } & SyncDeps
): Promise<CourseMediaReport> {
  const read = options.read ?? readAsset;
  const bridgeDeps = { settings: options.settings, fetch: options.fetch };
  const coverId = libraryAssetId(course.coverUrl);
  const photoIds = collectCoursePhotoIds(course);
  const coverKind: CourseMediaReport['cover'] = coverId
    ? 'library'
    : String(course.coverUrl ?? '').trim()
      ? 'external'
      : 'none';

  if (!options.photoUpload) {
    // Обкладинка — те, без чого картка порожня, тож її відсутність зупиняє
    // публікацію; фото уроків лише рахуємо, щоб адмін бачив, що не поїхало.
    if (coverId) {
      throw new MarketplaceBridgeError(
        'Обкладинка курсу лежить у медіатеці Студії, а API маркетплейсу ще не вміє приймати фото курсу ' +
          '(потрібен деплой приймача). Доти вкажіть обкладинку посиланням http(s).',
        'rejected',
        502
      );
    }
    return { cover: coverKind, uploaded: 0, skipped: [], pruned: 0, unsupported: photoIds.length };
  }

  const report: CourseMediaReport = { cover: coverKind, uploaded: 0, skipped: [], pruned: 0, unsupported: 0 };

  if (coverId) {
    const cover = await load(coverId, course.ownerId, read);
    if (cover.ok === false) {
      throw new MarketplaceBridgeError(
        `Обкладинку курсу не вдалося взяти з медіатеки: ${SKIP_TEXT[cover.reason]}. ` +
          'Без обкладинки картка в каталозі порожня — виберіть інше зображення.',
        'cover_required',
        400
      );
    }
    await attachCourseMediaToMarketplace(
      { bookId: course.id, role: 'cover', filename: cover.filename, mimeType: cover.mimeType, bytes: cover.bytes },
      bridgeDeps
    );
  }

  const failures: string[] = [];
  for (const [index, id] of photoIds.entries()) {
    const photo = await load(id, course.ownerId, read);
    if (photo.ok === false) {
      report.skipped.push({ id, reason: photo.reason });
      continue;
    }
    try {
      await attachCourseMediaToMarketplace(
        {
          bookId: course.id,
          role: 'lesson_photo',
          sourceKey: id,
          filename: photo.filename,
          mimeType: photo.mimeType,
          bytes: photo.bytes,
          position: index,
        },
        bridgeDeps
      );
      report.uploaded += 1;
    } catch (err) {
      // Немає звʼязку чи ключ не той — решта фото теж не поїде, не вичерпуємо
      // час на кожне окремо.
      if (err instanceof MarketplaceBridgeError && (err.kind === 'unreachable' || err.kind === 'unauthorized')) {
        throw err;
      }
      failures.push(`${id}: ${(err as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new MarketplaceBridgeError(
      `Не вдалося завантажити у вітрину ${failures.length} із ${photoIds.length} фото курсу. ` +
        'Повторіть публікацію — вона безпечна, вже завантажені фото не подвояться.',
      'rejected',
      502,
      failures.slice(0, 5).join(' | ')
    );
  }

  // Лише коли все завантажено: збій посеред шляху не повинен стерти фото, які
  // покупці вже бачать.
  const pruned = await pruneCourseMediaOnMarketplace(course.id, photoIds, bridgeDeps);
  report.pruned = pruned.pruned;
  return report;
}
