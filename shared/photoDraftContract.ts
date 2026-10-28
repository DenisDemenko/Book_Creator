/**
 * Контракт «чернетки за фото» (GrabFusion ↔ Studio), крок A0 плану
 * docs/proposals/GRABFUSION_PHOTO_COURSE_APP_2026-10-28.md.
 *
 * ЄДИНЕ ДЖЕРЕЛО СТИКУ. Сервер Studio (частина A) і застосунок GrabFusion
 * (частина B, Python) домовляються лише через цей файл, схему
 * docs/photo-drafts-api/schema.json, опис docs/photo-drafts-api.md і
 * JSON-фікстури docs/photo-drafts-api/fixtures/. Python не підключить
 * TypeScript, тому B бере схему й фікстури; тест
 * scripts/test-photoDraftContract.mts стежить, щоб ці типи, схема й фікстури
 * не розійшлися.
 *
 * ПРАВИЛО ЗМІН. Після G1 (контракт заморожено) — лише додавання нових
 * необовʼязкових полів і нових маршрутів. Перейменування, видалення чи зміна
 * значення — ламка зміна, лише за згоди обох частин і з записом у журнал змін
 * контракту в docs/photo-drafts-api.md.
 *
 * Модуль чистий (без Node, React і побічних ефектів), тож його можна вкласти
 * і в серверний бандл, і в клієнт Studio.
 */

/** Версія контракту. Мінорна — додавання; мажорна — ламка зміна. */
export const PHOTO_DRAFT_CONTRACT_VERSION = '1.3.0';

/** Префікс маршрутів. Автентифікація — `Authorization: Bearer nst_…`. */
export const PHOTO_DRAFT_API_BASE = '/api/external/v1';

/** Область дії токена, якої достатньо застосунку. */
export const PHOTO_DRAFT_TOKEN_SCOPE = 'photo-drafts';

// ---------------------------------------------------------------------------
// Межі
// ---------------------------------------------------------------------------

/**
 * Межі, однакові для сервера й застосунку. Сервер віддає їх і маршрутом
 * `GET /photo-drafts/limits`, щоб застосунок не тримав власну копію.
 */
export const PHOTO_DRAFT_LIMITS = {
  /** Текст опису кадру або серії — у символах Unicode (див. countNoteChars). */
  maxNoteChars: 500,
  /** Байти одного фото після декодування base64. Застосунок стискає до 2048 px заздалегідь. */
  maxImageBytes: 10 * 1024 * 1024,
  /** Найбільша сторона фото, до якої стискає застосунок (рекомендація, сервер не відхиляє більші). */
  recommendedMaxSidePx: 2048,
  /** Кадрів в одній чернетці. */
  maxPhotosPerDraft: 300,
  /** Нових фото на годину на одного автора — захист від зациклення черги й від рахунку за модель. */
  photosPerHour: 120,
  /** Чернеток, що одночасно не відправлені й не відкинуті. */
  maxOpenDrafts: 20,
  maxTitleChars: 160,
  /** Ремесло, аудиторія — короткі рядки. */
  maxShortFieldChars: 200,
  /** Текст уроку після проходу 3 або правки викладача. */
  maxLessonBodyChars: 20_000,
  /** Рекомендований інтервал опитування під час фонових проходів. */
  pollIntervalMs: 2000,
  /** Сторінок в одній чернетці-рукописі (`kind: manuscript`, з 1.3.0). Окремо від `maxPhotosPerDraft`. */
  maxManuscriptPages: 120,
  /** Нових сторінок рукопису на годину на одного автора — окремо від `photosPerHour`. */
  manuscriptPagesPerHour: 200,
  /** Текст однієї сторінки рукопису після розпізнавання або правки, у символах Unicode. */
  maxPageTextChars: 20_000,
} as const;

export type PhotoDraftLimits = typeof PHOTO_DRAFT_LIMITS;

/**
 * Довжина тексту так, як її бачить людина: кодові точки Unicode
 * (`[...text].length`), а не UTF-16 (`text.length`). Емодзі «👍» — один
 * символ, а не два. Лічильник у застосунку має рахувати так само:
 * у Python це `len(text)` для `str`.
 */
export function countNoteChars(text: string): number {
  return [...text].length;
}

/** Чи вміщається опис у межу. Порожній опис дозволений (означає «без опису»). */
export function noteFits(text: string): boolean {
  return countNoteChars(text) <= PHOTO_DRAFT_LIMITS.maxNoteChars;
}

// ---------------------------------------------------------------------------
// Перелічення
// ---------------------------------------------------------------------------

/**
 * Що вийде після відправки: курс draft, експрес-інструкція, глава у «Вхідних»
 * книги (`book`, ШІ структурує й пише) або набір сторінок рукопису (`manuscript`,
 * з 1.3.0: сторінки лише розпізнаються дослівно, без структури й переписування).
 */
export const PHOTO_DRAFT_KINDS = ['course', 'instruction', 'book', 'manuscript'] as const;
export type PhotoDraftKind = (typeof PHOTO_DRAFT_KINDS)[number];

/**
 * Життєвий цикл чернетки:
 *   collecting → structured → written → submitted
 *   будь-який, крім submitted → discarded
 * Повернення назад дозволене: нові фото в structured повертають чернетку в
 * collecting, а нова структура в written — у structured.
 */
export const PHOTO_DRAFT_STATUSES = ['collecting', 'structured', 'written', 'submitted', 'discarded'] as const;
export type PhotoDraftStatus = (typeof PHOTO_DRAFT_STATUSES)[number];

/** Життєвий цикл фото: опис (прохід 1) іде у фоні після прийому. */
export const PHOTO_STATUSES = ['processing', 'described', 'failed'] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

export const PHOTO_DRAFT_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type PhotoDraftLevel = (typeof PHOTO_DRAFT_LEVELS)[number];

/**
 * Режим технічної інструкції (лише для `kind: instruction`, з 1.2.0):
 * `assembly` — складання виробу, `operation` — користування ним.
 */
export const PHOTO_DRAFT_INSTRUCTION_MODES = ['assembly', 'operation'] as const;
export type PhotoDraftInstructionMode = (typeof PHOTO_DRAFT_INSTRUCTION_MODES)[number];

/** Довгі проходи (2 і 3) — у фоні; стан видно в `draft.job`. */
export const PHOTO_DRAFT_JOB_KINDS = ['structure', 'generate'] as const;
export type PhotoDraftJobKind = (typeof PHOTO_DRAFT_JOB_KINDS)[number];

export const PHOTO_DRAFT_JOB_STATUSES = ['running', 'failed'] as const;
export type PhotoDraftJobStatus = (typeof PHOTO_DRAFT_JOB_STATUSES)[number];

export const ASSUMPTION_STATUSES = ['open', 'confirmed', 'rejected'] as const;
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number];

/** Куди лягла відправлена чернетка. */
export const SUBMIT_TARGET_KINDS = ['course', 'express', 'inbox'] as const;
export type SubmitTargetKind = (typeof SUBMIT_TARGET_KINDS)[number];

/**
 * Стабільні коди помилок (`kind`). Текст `error` — для людини, українською, і
 * може змінюватись; застосунок розгалужується лише за `kind`.
 * Ті самі коди, що вже віддає зовнішній API (`unauthenticated`,
 * `invalid_token`, `bad_image`, …), означають те саме.
 */
export const PHOTO_DRAFT_ERROR_KINDS = [
  'unauthenticated',
  'invalid_token',
  'scope_denied',
  'forbidden',
  'bad_input',
  'bad_image',
  'image_too_large',
  'note_too_long',
  'too_many_photos',
  'too_many_drafts',
  'rate_limited',
  'quota_exceeded',
  'ai_budget_exceeded',
  'draft_not_found',
  'photo_not_found',
  'note_not_found',
  'module_not_found',
  'book_not_found',
  'wrong_status',
  'job_running',
  'revision_conflict',
  'submit_blocked',
  'server_error',
] as const;
export type PhotoDraftErrorKind = (typeof PHOTO_DRAFT_ERROR_KINDS)[number];

/** Причини, з яких `submit` відмовляє (400 `submit_blocked`). */
export const SUBMIT_BLOCKER_KINDS = [
  'no_photos',
  'photos_processing',
  'photos_failed',
  'no_structure',
  'module_not_written',
  'open_assumptions',
  'empty_lesson',
  'title_missing',
  'book_missing',
  'empty_page',
] as const;
export type SubmitBlockerKind = (typeof SUBMIT_BLOCKER_KINDS)[number];

// ---------------------------------------------------------------------------
// Обʼєкти відповідей
// ---------------------------------------------------------------------------

export interface PhotoDraftError {
  error: string;
  kind: PhotoDraftErrorKind;
}

export interface SubmitBlocker {
  kind: SubmitBlockerKind;
  message: string;
  moduleId?: string;
  lessonId?: string;
  photoId?: string;
  assumptionId?: string;
}

/** 400 `submit_blocked` — помилка разом із переліком того, що заважає. */
export interface SubmitBlockedError extends PhotoDraftError {
  kind: 'submit_blocked';
  blockers: SubmitBlocker[];
}

export interface DraftPhoto {
  photoId: string;
  /** Ідентифікатор, який дав застосунок; повторний прийом з тим самим clientId не створює дубля. */
  clientId: string;
  status: PhotoStatus;
  /** Порядок у чернетці, з 1. Змінюється через PATCH `photoOrder`. */
  order: number;
  /** Коли знято (ISO 8601), якщо застосунок передав. */
  takenAt: string | null;
  /** Шлях у межах API: `GET` з тим самим токеном віддає байти фото. */
  imageUrl: string;
  /** Прохід 1: що видно на кадрі, з урахуванням опису викладача. */
  description: string | null;
  /** Короткі мітки з проходу 1: інструменти, матеріали, дії. */
  tags: string[];
  error: string | null;
  /**
   * Лише для `kind: manuscript` (з 1.3.0): текст сторінки, розпізнаний дослівно
   * (прохід 1) або виправлений викладачем через `PUT …/photos/:photoId/text`.
   * `null` — ще не розпізнано або розпізнати не вдалося. Для інших видів поля немає.
   */
  text?: string | null;
  /** Лише `manuscript`: true, якщо текст правив викладач (тоді повторне розпізнавання його не затре). */
  textEdited?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DraftNote {
  /** Задає застосунок — тоді повторний PUT безпечно оновлює той самий опис. */
  noteId: string;
  /** Один кадр або серія. */
  photoIds: string[];
  text: string;
  updatedAt: string;
}

export interface DraftLesson {
  lessonId: string;
  title: string;
  goal: string | null;
  photoIds: string[];
  /** Текст уроку (Markdown) після проходу 3 або правки викладача. */
  body: string | null;
  topics: string[];
  /** Які поля написав ШІ й викладач їх ще не правив: 'title' | 'goal' | 'body' | 'topics'. */
  aiFields: string[];
}

export interface DraftModule {
  moduleId: string;
  title: string;
  summary: string | null;
  lessons: DraftLesson[];
  /** Чи пройшов модуль прохід 3 (текст написано). */
  written: boolean;
}

export interface DraftStructure {
  modules: DraftModule[];
}

export interface DraftAssumption {
  assumptionId: string;
  /** Що ШІ припустило й викладач має підтвердити: «Ймовірно, це дуб, а не ясен». */
  text: string;
  status: AssumptionStatus;
  moduleId: string | null;
  lessonId: string | null;
  photoId: string | null;
}

export interface DraftJob {
  kind: PhotoDraftJobKind;
  status: PhotoDraftJobStatus;
  /** Для `generate` — модуль, текст якого пишеться. */
  moduleId: string | null;
  error: string | null;
  startedAt: string;
}

export interface SubmitTarget {
  kind: SubmitTargetKind;
  id: string;
  /** Відносний шлях у Studio, де автор відкриє результат. */
  studioUrl: string;
}

export interface PhotoDraft {
  draftId: string;
  kind: PhotoDraftKind;
  status: PhotoDraftStatus;
  /**
   * Збільшується з кожною дією викладача (з будь-якого пристрою); PATCH з
   * `ifRevision` захищає від затирання. Фонові результати ШІ (опис кадру,
   * завершення проходу) ревізію НЕ змінюють — інакше правка під час опису
   * кадрів щоразу впиралася б у `revision_conflict`.
   */
  revision: number;
  title: string | null;
  craft: string | null;
  audience: string | null;
  level: PhotoDraftLevel | null;
  /** Лише для `kind: book` — книга, у «Вхідні» якої ляже глава. */
  bookId: string | null;
  /**
   * Лише для `kind: manuscript` (з 1.3.0): назва НОВОЇ книги, коли `bookId` немає.
   * Книга живе в браузері автора, тож сервер її не створює: пакет сторінок лягає
   * у «Вхідні» без книги, а автор у Studio створює книгу й вставляє главу.
   */
  newBookTitle?: string | null;
  /** Лише для `kind: instruction` (з 1.2.0): складання чи користування; для інших видів `null`. Новим інструкціям — `assembly`. */
  instructionMode?: PhotoDraftInstructionMode | null;
  /** Код або модель виробу для інструкції (з 1.2.0). */
  modelCode?: string | null;
  photos: DraftPhoto[];
  notes: DraftNote[];
  structure: DraftStructure | null;
  assumptions: DraftAssumption[];
  job: DraftJob | null;
  submitted: SubmitTarget | null;
  createdAt: string;
  updatedAt: string;
}

/** Короткий рядок для переліку чернеток. */
export interface PhotoDraftSummary {
  draftId: string;
  kind: PhotoDraftKind;
  status: PhotoDraftStatus;
  title: string | null;
  photoCount: number;
  updatedAt: string;
}

/** Обгортки відповідей — саме ці обʼєкти лежать у фікстурах. */
export interface LimitsResponse {
  contractVersion: string;
  limits: PhotoDraftLimits;
}
export interface DraftListResponse {
  drafts: PhotoDraftSummary[];
}
export interface DraftResponse {
  draft: PhotoDraft;
}
export interface PhotoResponse {
  photo: DraftPhoto;
  /** Ревізія чернетки після прийому. */
  revision: number;
  /** true — фото з цим clientId уже було прийняте раніше; повернуто наявне. */
  duplicate: boolean;
}
export interface NoteResponse {
  note: DraftNote;
  revision: number;
}
export interface SubmitResponse {
  draft: PhotoDraft;
  target: SubmitTarget;
}

// ---------------------------------------------------------------------------
// Тіла запитів
// ---------------------------------------------------------------------------

export interface CreatePhotoDraftRequest {
  kind: PhotoDraftKind;
  title?: string;
  craft?: string;
  audience?: string;
  level?: PhotoDraftLevel;
  /** Обовʼязковий для `kind: book`; для `manuscript` — або він, або `newBookTitle`. */
  bookId?: string;
  /** Лише для `kind: manuscript` (з 1.3.0): назва нової книги. */
  newBookTitle?: string;
  /** Лише для `kind: instruction`; без нього — `assembly`. */
  instructionMode?: PhotoDraftInstructionMode;
  modelCode?: string;
}

export interface AddPhotoRequest {
  clientId: string;
  /** `data:image/jpeg;base64,…` або голий base64 разом із `mimeType`. JPEG, PNG, WEBP. */
  image: string;
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  takenAt?: string;
  /**
   * Необовʼязкова підказка до цього кадру (з 1.3.0), ≤ `maxNoteChars`: кладеться як опис
   * кадру (нотатка `n-<photoId>`) ще ДО фонового проходу 1 — окремий `PUT …/notes/…` приходить
   * надто пізно. Для рукопису це підказка розпізнаванню (імена, мова), для решти — опис кадру.
   */
  note?: string;
}

/** Тіло `PUT …/photos/:photoId/text` (з 1.3.0, лише `manuscript`): викладач виправив розпізнаний текст сторінки. */
export interface PutPhotoTextRequest {
  text: string;
}

export interface PutNoteRequest {
  photoIds: string[];
  text: string;
}

/** Тіло `POST …/structure` необовʼязкове (з 1.1.0). */
export interface StructureRequest {
  /** true — розкласти заново, коли структура вже є; правки викладача в ній буде втрачено. */
  replace?: boolean;
}

export interface PatchLesson {
  lessonId: string;
  title?: string;
  goal?: string | null;
  body?: string | null;
  topics?: string[];
}

export interface PatchPhotoDraftRequest {
  /** Обовʼязково: ревізія, яку бачив застосунок. Інша на сервері → 409 `revision_conflict`. */
  ifRevision: number;
  title?: string | null;
  craft?: string | null;
  audience?: string | null;
  level?: PhotoDraftLevel | null;
  /** Лише для `kind: instruction`. */
  instructionMode?: PhotoDraftInstructionMode;
  modelCode?: string | null;
  /** Лише для `kind: manuscript`: назва нової книги (`null` — прибрати). */
  newBookTitle?: string | null;
  /** Лише для `kind: manuscript`: існуюча книга автора (`null` — прибрати). Разом із `newBookTitle` — `400 bad_input`. */
  bookId?: string | null;
  /** Усі photoId чернетки в новому порядку. */
  photoOrder?: string[];
  /** Повна структура замість наявної (перенесення кадрів між уроками, назви). */
  structure?: DraftStructure;
  /** Точкові правки уроків — без пересилання всієї структури. */
  lessons?: PatchLesson[];
  assumptions?: { assumptionId: string; status: AssumptionStatus }[];
}

// ---------------------------------------------------------------------------
// Маршрути
// ---------------------------------------------------------------------------

export interface PhotoDraftRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Відносно PHOTO_DRAFT_API_BASE. */
  path: string;
  /** Успішний код відповіді. */
  status: 200 | 201 | 202;
  /** Фікстура успішної відповіді в docs/photo-drafts-api/fixtures/ (без `.json`); null — байти, не JSON. */
  fixture: string | null;
  /** Визначення у схемі (`definitions`), якому відповідає успішна відповідь; null — байти. */
  response: string | null;
  /** Етап плану, на якому маршрут зʼявляється на сервері. */
  stage: 1 | 3 | 5;
}

/**
 * Усі маршрути контракту. Тест звіряє, що кожна фікстура тут згадана й існує,
 * а опис API перелічує кожен маршрут.
 */
export const PHOTO_DRAFT_ROUTES: readonly PhotoDraftRoute[] = [
  { method: 'GET', path: '/photo-drafts/limits', status: 200, fixture: 'limits', response: 'LimitsResponse', stage: 1 },
  { method: 'GET', path: '/photo-drafts', status: 200, fixture: 'list-drafts', response: 'DraftListResponse', stage: 1 },
  { method: 'POST', path: '/photo-drafts', status: 201, fixture: 'create-draft', response: 'DraftResponse', stage: 1 },
  { method: 'GET', path: '/photo-drafts/:draftId', status: 200, fixture: 'get-draft-collecting', response: 'DraftResponse', stage: 1 },
  { method: 'PATCH', path: '/photo-drafts/:draftId', status: 200, fixture: 'patch-draft', response: 'DraftResponse', stage: 1 },
  { method: 'DELETE', path: '/photo-drafts/:draftId', status: 200, fixture: 'discard-draft', response: 'DraftResponse', stage: 1 },
  { method: 'POST', path: '/photo-drafts/:draftId/photos', status: 202, fixture: 'add-photo', response: 'PhotoResponse', stage: 1 },
  { method: 'GET', path: '/photo-drafts/:draftId/photos/:photoId/image', status: 200, fixture: null, response: null, stage: 1 },
  { method: 'POST', path: '/photo-drafts/:draftId/photos/:photoId/retry', status: 202, fixture: 'retry-photo', response: 'PhotoResponse', stage: 1 },
  { method: 'DELETE', path: '/photo-drafts/:draftId/photos/:photoId', status: 200, fixture: 'delete-photo', response: 'DraftResponse', stage: 1 },
  { method: 'PUT', path: '/photo-drafts/:draftId/notes/:noteId', status: 200, fixture: 'put-note', response: 'NoteResponse', stage: 1 },
  { method: 'DELETE', path: '/photo-drafts/:draftId/notes/:noteId', status: 200, fixture: 'delete-note', response: 'DraftResponse', stage: 1 },
  { method: 'PUT', path: '/photo-drafts/:draftId/photos/:photoId/text', status: 200, fixture: 'put-photo-text', response: 'PhotoResponse', stage: 5 },
  { method: 'POST', path: '/photo-drafts/:draftId/structure', status: 202, fixture: 'structure-running', response: 'DraftResponse', stage: 3 },
  { method: 'POST', path: '/photo-drafts/:draftId/modules/:moduleId/generate', status: 202, fixture: 'generate-running', response: 'DraftResponse', stage: 3 },
  { method: 'POST', path: '/photo-drafts/:draftId/submit', status: 201, fixture: 'submit-course', response: 'SubmitResponse', stage: 3 },
] as const;

/**
 * Фікстури, що не є відповіддю «успіху» конкретного маршруту: проміжні стани
 * для опитування й помилки. Кожна має бути у схемі під своїм визначенням.
 */
export const PHOTO_DRAFT_EXTRA_FIXTURES: Readonly<Record<string, string>> = {
  'get-draft-structured': 'DraftResponse',
  'get-draft-written': 'DraftResponse',
  'get-draft-job-failed': 'DraftResponse',
  'submit-instruction': 'SubmitResponse',
  'submit-book': 'SubmitResponse',
  'submit-manuscript': 'SubmitResponse',
  'get-draft-manuscript': 'DraftResponse',
  'error-note-too-long': 'Error',
  'error-revision-conflict': 'Error',
  'error-scope-denied': 'Error',
  'error-rate-limited': 'Error',
  'error-job-running': 'Error',
  'error-submit-blocked': 'SubmitBlockedError',
};
