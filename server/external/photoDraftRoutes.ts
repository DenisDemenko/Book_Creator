/**
 * Чернетки за фото — сервер контракту docs/photo-drafts-api.md (етап 1, A1).
 *
 * Споживач — Python-сервіс GrabFusion (частина B плану
 * docs/proposals/GRABFUSION_PHOTO_COURSE_APP_2026-10-28.md). Автентифікація та
 * сама, що в решті зовнішнього API: `Authorization: Bearer nst_…`; токен
 * GrabFusion має область `photo-drafts` і нічого, крім цих маршрутів і `/me`,
 * не відкриває (requireExternalToken → scopeAllowsPath).
 *
 * ЩО РОБИТЬ ЕТАП 1. Чернетка, кадри (ідемпотентно за `clientId` — на цьому
 * стоїть черга застосунку без звʼязку), описи викладача до 500 символів,
 * правки з `ifRevision` і прохід 1 — опис кадру моделлю зору у фоні (202 +
 * опитування; той самий урок, що й скани: проксі обриває довгі запити).
 * ЕТАП 3 (A2). Прохід 2 «structure» (кадри → модулі й уроки + припущення), прохід 3
 * «generate» (текст одного модуля) і `submit` (перевірка якості → чернетка курсу /
 * експрес-інструкція / запис у «Вхідні» книги). Проходи — як і прохід 1: 202 +
 * опитування, текст оплачується з тарифу викладача.
 *
 * ФОТО — У МЕДІАТЕЦІ АВТОРА. Кожен кадр зберігається звичайним активом
 * медіатеки (з обліком сховища тарифу), а чернетка тримає лише його id. Тож
 * після відправки курс посилається на фото медіатеки, і їх уже вміє довезти
 * до вітрини етап 0 (courseMediaSync).
 *
 * ОПЛАТА ШІ — ТАРИФ ВИКЛАДАЧА (рішення власника 28.10.2026): ліміт перевіряється
 * ДО збереження фото, щоб викладач не накопичив кадрів, які не буде чим описати.
 */

import type { Express, Request, Response } from 'express';
import { requirePermission } from '../auth';
import { getBook } from '../bookStore';
import { readAsset, saveAsset } from '../media/mediaLibraryStore';
import { decodeScanImage, requireExternalToken, type RecognizeParams } from './externalApiRoutes';
import { cleanOcrText } from './scanOcrPrompt';
import { creditBilledLabel } from '../creditBilledContext';
import {
  DraftChangeError,
  countOpenDrafts,
  countPhotosSince,
  getDraft,
  insertDraft,
  listDrafts,
  mutateDraft,
  newPhotoDraftId,
  newPhotoId,
  type StoredDraft,
  type StoredPhoto,
} from './photoDraftStore';
import {
  ASSUMPTION_STATUSES,
  PHOTO_DRAFT_CONTRACT_VERSION,
  PHOTO_DRAFT_INSTRUCTION_MODES,
  PHOTO_DRAFT_KINDS,
  PHOTO_DRAFT_LEVELS,
  PHOTO_DRAFT_LIMITS,
  countNoteChars,
  type DraftLesson,
  type DraftModule,
  type DraftPhoto,
  type AiOptionsResponse,
  type AiPass,
  type DraftStructure,
  type PassModelOption,
  type PassModelStatus,
  type PhotoDraft,
  type PhotoDraftInstructionMode,
  type PhotoDraftKind,
  type PhotoDraftLevel,
  type PhotoDraftSummary,
  type SubmitTarget,
} from '../../shared/photoDraftContract';
import type { DescribeContext } from './photoDraftPrompts';
import {
  applyGenerated,
  buildGeneratePrompt,
  buildStructurePrompt,
  computeSubmitBlockers,
  generateSystemInstruction,
  INSTRUCTION_MAX_STEPS,
  jobIsStale,
  PHOTO_STALE_MESSAGE,
  photoIsStale,
  mergeAssumptions,
  parseGenerateResult,
  parseStructureResult,
  placePhotos,
  structureSystemInstruction,
} from './photoDraftPasses';
import { estimateGeneratePass, estimateStructurePass, type PassTokenEstimate } from './photoDraftEstimate';
import { toCourseInput, toExpressPayload, toInboxItems, toManuscriptItems, type CourseInput, type InboxItem } from './photoDraftMapping';

const BASE = '/api/external/v1/photo-drafts';
/** Стеля виходу моделі в проходах 2–3 і основа оцінки резерву балів. */
const PASS_MAX_TOKENS = 8192;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface DescribePhotoParams {
  ownerId: string;
  /** Для підпису витрат у журналі: з нього видно, скільки ШІ коштувала чернетка. */
  draftId: string;
  mimeType: string;
  base64: string;
  context: DescribeContext;
  req: Request;
}

/** Текстовий прохід (2 або 3): у продукті — photoDraftSinks.writeWithCoreText. */
export interface WriteTextParams {
  ownerId: string;
  draftId: string;
  system: string;
  prompt: string;
  maxTokens: number;
  label: string;
  req: Request;
  /** З 1.4.0: модель, яку обрав автор (з `GET …/ai-options`). Без неї — привʼязка адміна до модуля. */
  modelId?: string;
  /** true — бали за прохід уже зарезервовано: грошовий ліміт тексту не перевіряти. */
  creditBilled?: boolean;
}

/** Результат текстового проходу; `costUsd` — фактична собівартість для списання балів. */
export interface WriteTextResult {
  text: string;
  modelId: string;
  costUsd?: number;
}

/** Одна модель у відповіді `GET …/ai-options` до того, як до неї додано бали. */
export interface PassModelProbe {
  modelId: string;
  label: string;
  provider: string;
  status: PassModelStatus;
  usable: boolean;
  note: string | null;
}

/** Вартість проходу в балах і доларах: очікувана й верхня межа резерву. */
export interface PassQuote {
  expectedCredits: number;
  maxCredits: number;
  expectedUsd: number;
  maxUsd: number;
}

/** Резерв балів під один прохід: списати за фактом або повернути. */
export interface PassCharge {
  reservedCredits: number;
  settleUsd: (actualUsd: number) => void;
  release: (reason: string) => void;
}

/**
 * Вибір моделі й облік балів для проходів 2–3 (з 1.4.0, журнал #530). У продукті —
 * photoDraftAiModels.passModels. Без нього маршрути працюють як до 1.4.0: модель адміна, ліміт тарифу.
 */
export interface PassModels {
  list: (ownerId: string) => Promise<{ models: PassModelProbe[]; defaultModelId: string | null; checkedAt: string }>;
  /** `null` — ціну моделі не звірено. */
  quote: (modelId: string, est: PassTokenEstimate) => PassQuote | null;
  /** Баланс автора; `unlimited` — бали не списуються. */
  balance: (req: Request) => Promise<{ unlimited: boolean; balance: number | null }>;
  /** Резервує бали ДО запуску. Бракує — кидає помилку з `kind: 'credits'`; `null` — гейт не діє. */
  begin: (req: Request, quote: PassQuote) => Promise<PassCharge | null>;
  /**
   * Прохід 1 (опис кадру, розпізнавання сторінки) теж в балах (#538): швидка перевірка балансу БЕЗ резерву
   * при завантаженні кадру. `billed: false` — бали не діють, лишається грошовий ліміт тексту. Сам резерв і
   * списання робить photoDescriber/scanRecognizer (visionBilling.ts) — вони й так мають `req`.
   */
  visionBlock?: (req: Request, kind: 'describe' | 'recognize') => Promise<{ billed: boolean; reason: string | null }>;
}

/** Куди лягає відправлена чернетка (у продукті — photoDraftSinks.ts). */
export interface PhotoDraftSinks {
  createCourse: (ownerId: string, input: CourseInput) => Promise<string>;
  createExpress: (ownerId: string, payload: Record<string, unknown>) => Promise<string>;
  /**
   * «Набір книги» без наявної книги: Studio сама створює книгу з текстом (#540). Немає чи повернув `null` —
   * пакет кладеться у «Вхідні», як до 1.5.0.
   */
  createManuscriptBook?: (p: {
    ownerId: string;
    ownerName: string;
    ownerRole: string;
    bookTitle: string;
    chapterTitle: string;
    items: InboxItem[];
    tokenId?: string | null;
    batchId: string;
  }) => Promise<{ bookId: string; chapterTitle: string; pages: number } | null>;
  /** Повертає id першого запису у «Вхідних». */
  createInboxScans: (p: {
    ownerId: string;
    bookId: string;
    items: InboxItem[];
    tokenId?: string | null;
    /** Лише рукопис (A5): записи складають пакет; `bookId` може бути порожнім. */
    batch?: { id: string; bookTitle?: string | null };
  }) => Promise<string>;
}

export interface PhotoDraftDeps {
  /** Прохід 1. У продукті — модель зору ядра AI (photoDraftDescriber.ts). */
  describe: (p: DescribePhotoParams) => Promise<{ description: string; tags: string[]; modelId: string }>;
  /** Прохід 1 для `kind: manuscript` (A5): дослівне розпізнавання сторінки. У продукті — scanRecognizer.recognizeScanWithCoreVision. */
  recognize?: (p: RecognizeParams) => Promise<{ text: string; modelId: string }>;
  /** Облік і перевірка сховища тарифу (у продукті — mediaStorage.checkAndRecordStorageUpload). */
  checkStorage?: (p: {
    userId: string;
    email: string;
    role: any;
    bytes: number;
    bookId: string | null;
    filename: string;
  }) => Promise<{ allowed: boolean; reasonUk?: string }>;
  /** Ліміт ШІ-витрат тарифу викладача (у продукті — checkChatQuota). */
  checkAiBudget?: (p: { userId: string; role: string }) => Promise<{ allowed: boolean; reasonUk?: string }>;
  /** Проходи 2–3. Немає — маршрути structure/generate відповідають 503. */
  writeText?: (p: WriteTextParams) => Promise<WriteTextResult>;
  /** Вибір моделі й бали за проходи 2–3. Немає — як до 1.4.0. */
  passModels?: PassModels;
  /** Відправка. Немає — submit відповідає 503. */
  sinks?: PhotoDraftSinks;
  /** Витрати ШІ на чернетку з журналу витрат (у продукті — photoDraftSinks.aiUsageForDraft). */
  aiUsage?: (p: { ownerId: string; draftId: string; since: string }) => Promise<{ calls: number; costUsd: number } | null>;
  schedule?: (task: () => Promise<void>) => void;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Допоміжне
// ---------------------------------------------------------------------------

/** Підпис виклику в журналі витрат: оплачений балами позначається, щоб не рахуватись у грошовий ліміт чату. */
function passLabel(label: string, creditBilled: boolean): string {
  return creditBilled ? creditBilledLabel(label) : label;
}

function fail(res: Response, status: number, kind: string, error: string): void {
  res.status(status).json({ error, kind });
}

export function publicPhoto(draftId: string, p: StoredPhoto): DraftPhoto {
  // Опис, що загубився разом із процесом (деплой посеред роботи), назовні — невдалий, з повтором (журнал #538).
  const lost = photoIsStale(p, clockNow().getTime());
  return {
    photoId: p.photoId,
    clientId: p.clientId,
    status: lost ? 'failed' : p.status,
    order: p.order,
    takenAt: p.takenAt,
    imageUrl: `${BASE}/${draftId}/photos/${p.photoId}/image`,
    description: p.description,
    tags: p.tags,
    error: lost ? PHOTO_STALE_MESSAGE : p.error,
    // Лише рукопис (1.3.0): в інших видів поля немає зовсім.
    ...(p.text !== undefined ? { text: p.text, textEdited: !!p.textEdited } : {}),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

let clockNow: () => Date = () => new Date();

/**
 * Робота ШІ, що «біжить» понад JOB_STALE_MS, назовні видна як невдала: процес
 * міг перезапуститись, і застосунок опитував би її вічно.
 */
function visibleJob(d: StoredDraft): PhotoDraft['job'] {
  if (d.job && jobIsStale(d.job, clockNow().getTime())) {
    return { ...d.job, status: 'failed', error: 'Роботу перервано (сервер перезапускався). Запустіть її ще раз.' };
  }
  return d.job;
}

/** Що бачить застосунок. Власник, токен і місце фото в медіатеці назовні не йдуть. */
export function publicDraft(d: StoredDraft): PhotoDraft {
  return {
    draftId: d.id,
    kind: d.kind,
    status: d.status,
    revision: d.revision,
    title: d.title,
    craft: d.craft,
    audience: d.audience,
    level: d.level,
    bookId: d.bookId,
    ...(d.kind === 'manuscript' ? { newBookTitle: d.newBookTitle ?? null } : {}),
    instructionMode: d.kind === 'instruction' ? (d.instructionMode ?? 'assembly') : null,
    modelCode: d.modelCode ?? null,
    photos: [...d.photos].sort((a, b) => a.order - b.order).map((p) => publicPhoto(d.id, p)),
    notes: d.notes,
    structure: d.structure,
    assumptions: d.assumptions,
    job: visibleJob(d),
    submitted: d.submitted,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function summary(d: StoredDraft): PhotoDraftSummary {
  return { draftId: d.id, kind: d.kind, status: d.status, title: d.title, photoCount: d.photos.length, updatedAt: d.updatedAt };
}

/**
 * Коротке текстове поле з тіла: `undefined` — не передано (не чіпати),
 * `null` — очистити. Задовге — відмова, а не тихе обрізання: викладач має
 * бачити, що назва не вмістилась.
 */
function shortField(value: unknown, max: number, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new DraftChangeError(400, 'bad_input', `Поле «${label}» має бути текстом.`);
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (countNoteChars(trimmed) > max) throw new DraftChangeError(400, 'bad_input', `Поле «${label}» задовге (максимум ${max} символів).`);
  return trimmed;
}

function levelField(value: unknown): PhotoDraftLevel | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!(PHOTO_DRAFT_LEVELS as readonly unknown[]).includes(value)) {
    throw new DraftChangeError(400, 'bad_input', `Рівень має бути одним із: ${PHOTO_DRAFT_LEVELS.join(', ')}.`);
  }
  return value as PhotoDraftLevel;
}

/** Режим інструкції: `undefined` — не передано, `null` — не задано. Лише для `kind: instruction`. */
function instructionModeField(value: unknown, kind: PhotoDraftKind): PhotoDraftInstructionMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (kind !== 'instruction') {
    throw new DraftChangeError(400, 'bad_input', 'Режим (складання чи користування) є лише в чернеток-інструкцій.');
  }
  if (!(PHOTO_DRAFT_INSTRUCTION_MODES as readonly unknown[]).includes(value)) {
    throw new DraftChangeError(400, 'bad_input', `Режим інструкції має бути одним із: ${PHOTO_DRAFT_INSTRUCTION_MODES.join(', ')}.`);
  }
  return value as PhotoDraftInstructionMode;
}

function isEditable(d: StoredDraft): boolean {
  return d.status !== 'submitted' && d.status !== 'discarded';
}

function assertEditable(d: StoredDraft): void {
  if (!isEditable(d)) {
    throw new DraftChangeError(
      409,
      'wrong_status',
      d.status === 'submitted' ? 'Чернетку вже відправлено в Studio — змінювати її тут не можна.' : 'Чернетку відкинуто.'
    );
  }
}

function renumber(d: StoredDraft): void {
  [...d.photos].sort((a, b) => a.order - b.order).forEach((p, i) => (p.order = i + 1));
}

/** Нові кадри в уже розкладеній чернетці повертають її до збирання (контракт, розділ 3). */
function backToCollecting(d: StoredDraft): void {
  if (d.status === 'structured' || d.status === 'written') d.status = 'collecting';
}

function strings(value: unknown, label: string, max = 200): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new DraftChangeError(400, 'bad_input', `«${label}» — масив рядків.`);
  }
  return (value as string[]).map((v) => v.trim()).filter(Boolean).map((v) => [...v].slice(0, max).join(''));
}

function nullableText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new DraftChangeError(400, 'bad_input', `«${label}» має бути текстом.`);
  const text = value.replace(/\r\n/g, '\n').trim();
  if (countNoteChars(text) > max) throw new DraftChangeError(400, 'bad_input', `«${label}» задовгий (максимум ${max} символів).`);
  return text || null;
}

/**
 * Повна структура від викладача. Поля, які він змінив порівняно з попередньою
 * структурою, зникають з `aiFields`; нові уроки — без позначок ШІ.
 */
function validateStructure(input: unknown, d: StoredDraft): DraftStructure {
  const photoIds = new Set(d.photos.map((p) => p.photoId));
  const oldLessons = new Map<string, DraftLesson>();
  const oldModules = new Map<string, DraftModule>();
  for (const m of d.structure?.modules ?? []) {
    oldModules.set(m.moduleId, m);
    for (const l of m.lessons) oldLessons.set(l.lessonId, l);
  }
  const modulesIn = (input as any)?.modules;
  if (!Array.isArray(modulesIn)) throw new DraftChangeError(400, 'bad_input', 'structure.modules — масив модулів.');
  const seen = new Set<string>();
  const modules = modulesIn.map((m: any): DraftModule => {
    if (!m || typeof m.moduleId !== 'string' || !ID_RE.test(m.moduleId) || seen.has(m.moduleId)) {
      throw new DraftChangeError(400, 'bad_input', 'Кожен модуль має унікальний moduleId.');
    }
    seen.add(m.moduleId);
    const title = shortField(m.title ?? '', PHOTO_DRAFT_LIMITS.maxTitleChars, 'Назва модуля') ?? '';
    if (!Array.isArray(m.lessons)) throw new DraftChangeError(400, 'bad_input', `Модуль «${title}»: lessons — масив уроків.`);
    const lessons = m.lessons.map((l: any): DraftLesson => {
      if (!l || typeof l.lessonId !== 'string' || !ID_RE.test(l.lessonId) || seen.has(l.lessonId)) {
        throw new DraftChangeError(400, 'bad_input', 'Кожен урок має унікальний lessonId.');
      }
      seen.add(l.lessonId);
      const ids = strings(l.photoIds, 'photoIds', 128);
      const unknown = ids.find((id) => !photoIds.has(id));
      if (unknown) throw new DraftChangeError(404, 'photo_not_found', `Кадру ${unknown} немає в цій чернетці.`);
      const lesson: DraftLesson = {
        lessonId: l.lessonId,
        title: shortField(l.title ?? '', PHOTO_DRAFT_LIMITS.maxTitleChars, 'Назва уроку') ?? '',
        goal: nullableText(l.goal, PHOTO_DRAFT_LIMITS.maxShortFieldChars * 2, 'Мета уроку'),
        photoIds: ids,
        body: nullableText(l.body, PHOTO_DRAFT_LIMITS.maxLessonBodyChars, 'Текст уроку'),
        topics: strings(l.topics, 'topics', 80),
        aiFields: [],
      };
      const old = oldLessons.get(l.lessonId);
      if (old) {
        lesson.aiFields = old.aiFields.filter((f) => JSON.stringify((old as any)[f]) === JSON.stringify((lesson as any)[f]));
      }
      return lesson;
    });
    return {
      moduleId: m.moduleId,
      title,
      summary: nullableText(m.summary, PHOTO_DRAFT_LIMITS.maxShortFieldChars * 2, 'Опис модуля'),
      lessons,
      written: oldModules.get(m.moduleId)?.written === true && lessons.every((l) => !!l.body),
    };
  });
  return { modules };
}

function statusAfterStructure(structure: DraftStructure): 'structured' | 'written' {
  return structure.modules.length > 0 && structure.modules.every((m) => m.written) ? 'written' : 'structured';
}

/** Причина невдачі опису — такою, яку можна показати викладачу на телефоні. */
export function humanizeDescribeError(err: unknown): string {
  const raw = String((err as Error)?.message || err || '').trim();
  if (!raw || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|network/i.test(raw)) {
    return 'Сервіс опису кадрів зараз недоступний. Натисніть «Повторити» трохи пізніше.';
  }
  return raw.slice(0, 500);
}

function sendChangeError(res: Response, err: unknown, where: string): void {
  if (err instanceof DraftChangeError) {
    res.status(err.status).json({ error: err.message, kind: err.kind, ...(err.extra ?? {}) });
    return;
  }
  console.error(`[photoDrafts] ${where}:`, err);
  fail(res, 500, 'server_error', 'Не вдалося виконати дію з чернеткою. Спробуйте ще раз.');
}

// ---------------------------------------------------------------------------
// Маршрути
// ---------------------------------------------------------------------------

export function registerPhotoDraftRoutes(app: Express, deps: PhotoDraftDeps): void {
  const now = deps.now || (() => new Date());
  clockNow = now;
  const schedule =
    deps.schedule ||
    ((task: () => Promise<void>) => {
      void task();
    });
  const auth = requireExternalToken(now);
  const owner = (req: Request) => String(req.principal!.id);

  const budgetBlock = async (req: Request): Promise<string | null> => {
    if (!deps.checkAiBudget) return null;
    const p = req.principal as any;
    const verdict = await deps.checkAiBudget({ userId: String(p.id), role: String(p.role || 'writer') });
    return verdict.allowed ? null : verdict.reasonUk || 'Вичерпано ліміт ШІ-витрат вашого тарифу.';
  };

  /**
   * Чи можна запускати прохід 1 для цього автора: бали (якщо діють) або грошовий ліміт тексту. Балансу з балами
   * вистачає — грошовий ліміт НЕ питаємо (інакше автор платив би двічі, як застерігає creditBilledContext.ts).
   */
  const pass1Block = async (req: Request, draftKind: PhotoDraftKind): Promise<string | null> => {
    const v = await deps.passModels?.visionBlock?.(req, draftKind === 'manuscript' ? 'recognize' : 'describe');
    if (v?.billed) return v.reason;
    return budgetBlock(req);
  };

  /** Прохід 1 у фоні: результат або причина відмови лягають у сам кадр. Ревізію не змінює. */
  const runDescribe = (draftId: string, ownerId: string, photoId: string, mimeType: string, base64: string, req: Request) => {
    schedule(async () => {
      const current = await getDraft(draftId, ownerId).catch(() => null);
      if (!current) return;
      const context: DescribeContext = {
        kind: current.kind,
        instructionMode: current.kind === 'instruction' ? (current.instructionMode ?? 'assembly') : null,
        title: current.title,
        craft: current.craft,
        audience: current.audience,
        notes: current.notes.filter((n) => n.photoIds.includes(photoId)).map((n) => n.text),
      };
      let patch: Partial<StoredPhoto>;
      try {
        if (current.kind === 'manuscript') {
          // Рукопис: не опис сцени, а дослівний текст сторінки; нотатка — підказка до розбору почерку.
          if (!deps.recognize) throw new Error('Розпізнавання сторінок не налаштовано на сервері.');
          const hint = (context.notes ?? []).map((n) => n.trim()).filter(Boolean).join('\n');
          const recognizeOnce = async () => {
            const result = await deps.recognize!({
              mimeType,
              base64,
              ownerId,
              bookId: current.bookId ?? '',
              note: hint || null,
              draftId,
              req,
            });
            return { result, text: [...cleanOcrText(result.text)].slice(0, PHOTO_DRAFT_LIMITS.maxPageTextChars).join('') };
          };
          let attempt = await recognizeOnce();
          // Порожня відповідь моделі — або справді порожня сторінка, або збій: на живому прогоні 04.11.2026 модель
          // повернула порожнє для чіткого друкованого аркуша, і сторінка стала `described` без тексту й без «повторити».
          // Одна друга спроба коштує копійки, а справді порожня сторінка лишається такою (блокер `empty_page` на `submit`).
          if (!attempt.text.trim()) {
            console.warn('[photoDrafts] порожнє розпізнавання сторінки — друга спроба');
            attempt = await recognizeOnce();
          }
          patch = { status: 'described', description: null, tags: [], text: attempt.text, modelId: attempt.result.modelId || null, error: null };
        } else {
          const result = await deps.describe({ ownerId, draftId, mimeType, base64, context, req });
          patch = { status: 'described', description: result.description, tags: result.tags, modelId: result.modelId || null, error: null };
        }
      } catch (err) {
        console.warn('[photoDrafts] опис кадру:', String((err as Error)?.message || err).slice(0, 300));
        patch = { status: 'failed', error: humanizeDescribeError(err) };
      }
      await mutateDraft(
        draftId,
        ownerId,
        (d) => {
          const photo = d.photos.find((p) => p.photoId === photoId);
          if (!photo || photo.status !== 'processing') return; // кадр прибрали або вже перезапустили
          Object.assign(photo, patch, { updatedAt: now().toISOString() });
        },
        { byTeacher: false, now }
      ).catch((err) => console.error('[photoDrafts] запис опису:', err));
    });
  };

  app.get(`${BASE}/limits`, auth, (_req, res) => {
    res.json({ contractVersion: PHOTO_DRAFT_CONTRACT_VERSION, limits: PHOTO_DRAFT_LIMITS });
  });

  app.get(BASE, auth, async (req, res) => {
    try {
      const drafts = (await listDrafts(owner(req))).filter((d) => d.status !== 'discarded');
      res.json({ drafts: drafts.map(summary) });
    } catch (err) {
      sendChangeError(res, err, 'list');
    }
  });

  app.post(BASE, auth, async (req, res) => {
    try {
      const ownerId = owner(req);
      const body = req.body || {};
      const kind = body.kind as PhotoDraftKind;
      if (!(PHOTO_DRAFT_KINDS as readonly unknown[]).includes(kind)) {
        return fail(res, 400, 'bad_input', `Вид чернетки має бути одним із: ${PHOTO_DRAFT_KINDS.join(', ')}.`);
      }
      const title = shortField(body.title, PHOTO_DRAFT_LIMITS.maxTitleChars, 'Назва') ?? null;
      const craft = shortField(body.craft, PHOTO_DRAFT_LIMITS.maxShortFieldChars, 'Ремесло') ?? null;
      const audience = shortField(body.audience, PHOTO_DRAFT_LIMITS.maxShortFieldChars, 'Аудиторія') ?? null;
      const level = levelField(body.level) ?? null;
      let instructionMode: PhotoDraftInstructionMode | null = null;
      let modelCode: string | null = null;
      try {
        instructionMode = instructionModeField(body.instructionMode, kind) ?? (kind === 'instruction' ? 'assembly' : null);
        modelCode = shortField(body.modelCode, PHOTO_DRAFT_LIMITS.maxShortFieldChars, 'Код виробу') ?? null;
      } catch (err) {
        return sendChangeError(res, err, 'create');
      }
      let bookId: string | null = null;
      let newBookTitle: string | null = null;
      if (kind === 'book' || kind === 'manuscript') {
        const wanted = typeof body.bookId === 'string' ? body.bookId.trim() : '';
        if (kind === 'manuscript') {
          try {
            newBookTitle = shortField(body.newBookTitle, PHOTO_DRAFT_LIMITS.maxTitleChars, 'Назва нової книги') ?? null;
          } catch (err) {
            return sendChangeError(res, err, 'create');
          }
          if (wanted && newBookTitle) return fail(res, 400, 'bad_input', 'Передайте або bookId (існуюча книга), або newBookTitle (нова), але не обидва.');
        }
        if (kind === 'book' || wanted) {
          const stored = wanted ? await getBook(wanted) : null;
          if (!stored || stored.ownerId !== ownerId) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');
          bookId = wanted;
        }
      } else if (body.newBookTitle !== undefined && body.newBookTitle !== null) {
        return fail(res, 400, 'bad_input', 'Назва нової книги є лише в чернеток-рукописів.');
      }
      if ((await countOpenDrafts(ownerId)) >= PHOTO_DRAFT_LIMITS.maxOpenDrafts) {
        return fail(
          res,
          409,
          'too_many_drafts',
          `Уже є ${PHOTO_DRAFT_LIMITS.maxOpenDrafts} незавершених чернеток — відправте або відкиньте одну з них.`
        );
      }
      const at = now().toISOString();
      const draft = await insertDraft({
        id: newPhotoDraftId(),
        ownerId,
        kind,
        status: 'collecting',
        revision: 1,
        title,
        craft,
        audience,
        level,
        instructionMode,
        modelCode,
        bookId,
        ...(kind === 'manuscript' ? { newBookTitle } : {}),
        photos: [],
        notes: [],
        structure: null,
        assumptions: [],
        job: null,
        submitted: null,
        tokenId: req.externalTokenId ?? null,
        createdAt: at,
        updatedAt: at,
      });
      res.status(201).json({ draft: publicDraft(draft) });
    } catch (err) {
      sendChangeError(res, err, 'create');
    }
  });

  app.get(`${BASE}/:draftId`, auth, async (req, res) => {
    try {
      const draft = await getDraft(String(req.params.draftId), owner(req));
      if (!draft) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.json({ draft: publicDraft(draft) });
    } catch (err) {
      sendChangeError(res, err, 'get');
    }
  });

  app.patch(`${BASE}/:draftId`, auth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!Number.isInteger(body.ifRevision)) {
        return fail(res, 400, 'bad_input', 'Передайте ifRevision — ревізію чернетки, яку бачить застосунок.');
      }
      // Книга лише для рукопису; перевіряємо власника до черги змін (читання книги асинхронне).
      let bookIdPatch: string | null | undefined;
      if (body.bookId !== undefined) {
        if (body.bookId === null) bookIdPatch = null;
        else {
          const wanted = typeof body.bookId === 'string' ? body.bookId.trim() : '';
          const stored = wanted ? await getBook(wanted) : null;
          if (!stored || stored.ownerId !== owner(req)) return fail(res, 404, 'book_not_found', 'Книгу не знайдено.');
          bookIdPatch = wanted;
        }
      }
      const changed = await mutateDraft(
        String(req.params.draftId),
        owner(req),
        (d) => {
          assertEditable(d);
          if (d.revision !== body.ifRevision) {
            throw new DraftChangeError(
              409,
              'revision_conflict',
              `Чернетку змінено з іншого пристрою (ревізія ${d.revision}, у вас ${body.ifRevision}). Оновіть і повторіть правку.`
            );
          }
          const title = shortField(body.title, PHOTO_DRAFT_LIMITS.maxTitleChars, 'Назва');
          const craft = shortField(body.craft, PHOTO_DRAFT_LIMITS.maxShortFieldChars, 'Ремесло');
          const audience = shortField(body.audience, PHOTO_DRAFT_LIMITS.maxShortFieldChars, 'Аудиторія');
          const level = levelField(body.level);
          if (title !== undefined) d.title = title;
          if (craft !== undefined) d.craft = craft;
          if (audience !== undefined) d.audience = audience;
          if (level !== undefined) d.level = level;
          const mode = instructionModeField(body.instructionMode, d.kind);
          if (mode !== undefined) d.instructionMode = mode;
          const modelCode = shortField(body.modelCode, PHOTO_DRAFT_LIMITS.maxShortFieldChars, 'Код виробу');
          if (modelCode !== undefined) d.modelCode = modelCode;
          if (bookIdPatch !== undefined || body.newBookTitle !== undefined) {
            if (d.kind !== 'manuscript') {
              throw new DraftChangeError(400, 'bad_input', 'Книгу чи назву нової книги можна міняти лише в чернетці-рукописі.');
            }
            if (bookIdPatch !== undefined) d.bookId = bookIdPatch;
            const nb = shortField(body.newBookTitle, PHOTO_DRAFT_LIMITS.maxTitleChars, 'Назва нової книги');
            if (nb !== undefined) d.newBookTitle = nb;
            if (d.bookId && d.newBookTitle) {
              throw new DraftChangeError(400, 'bad_input', 'Або існуюча книга (bookId), або нова (newBookTitle), але не обидві.');
            }
          }
          if (d.kind === 'manuscript' && (body.structure !== undefined || body.lessons !== undefined || body.assumptions !== undefined)) {
            throw new DraftChangeError(409, 'wrong_status', 'У рукописі немає структури, уроків і припущень — сторінки лише розпізнаються дослівно.');
          }

          if (body.photoOrder !== undefined) {
            const order = strings(body.photoOrder, 'photoOrder', 128);
            const ids = d.photos.map((p) => p.photoId);
            if (order.length !== ids.length || new Set(order).size !== order.length || order.some((id) => !ids.includes(id))) {
              throw new DraftChangeError(400, 'bad_input', 'photoOrder має містити кожен кадр чернетки рівно один раз.');
            }
            for (const p of d.photos) p.order = order.indexOf(p.photoId) + 1;
          }

          if (body.structure !== undefined || body.lessons !== undefined) {
            if (d.job?.status === 'running') {
              throw new DraftChangeError(409, 'job_running', 'Зачекайте: ШІ ще працює над структурою чи текстом.');
            }
          }
          if (body.structure !== undefined) {
            d.structure = validateStructure(body.structure, d);
            d.status = statusAfterStructure(d.structure);
          }
          if (body.lessons !== undefined) {
            if (!Array.isArray(body.lessons)) throw new DraftChangeError(400, 'bad_input', 'lessons — масив правок уроків.');
            for (const patch of body.lessons) {
              const lesson = d.structure?.modules.flatMap((m) => m.lessons).find((l) => l.lessonId === patch?.lessonId);
              if (!lesson) throw new DraftChangeError(400, 'bad_input', `Уроку ${String(patch?.lessonId)} немає в структурі.`);
              const drop = (field: string) => (lesson.aiFields = lesson.aiFields.filter((f) => f !== field));
              if (patch.title !== undefined) {
                lesson.title = shortField(patch.title, PHOTO_DRAFT_LIMITS.maxTitleChars, 'Назва уроку') ?? '';
                drop('title');
              }
              if (patch.goal !== undefined) {
                lesson.goal = nullableText(patch.goal, PHOTO_DRAFT_LIMITS.maxShortFieldChars * 2, 'Мета уроку');
                drop('goal');
              }
              if (patch.body !== undefined) {
                lesson.body = nullableText(patch.body, PHOTO_DRAFT_LIMITS.maxLessonBodyChars, 'Текст уроку');
                drop('body');
              }
              if (patch.topics !== undefined) {
                lesson.topics = strings(patch.topics, 'topics', 80);
                drop('topics');
              }
            }
            // Урок без тексту знімає з модуля позначку «написано».
            for (const m of d.structure?.modules ?? []) m.written = m.written && m.lessons.every((l) => !!l.body);
            if (d.structure && d.status !== 'collecting') d.status = statusAfterStructure(d.structure);
          }
          if (body.assumptions !== undefined) {
            if (!Array.isArray(body.assumptions)) throw new DraftChangeError(400, 'bad_input', 'assumptions — масив рішень.');
            for (const a of body.assumptions) {
              const found = d.assumptions.find((x) => x.assumptionId === a?.assumptionId);
              if (!found) throw new DraftChangeError(400, 'bad_input', `Припущення ${String(a?.assumptionId)} немає.`);
              if (!(ASSUMPTION_STATUSES as readonly unknown[]).includes(a.status)) {
                throw new DraftChangeError(400, 'bad_input', `Стан припущення: ${ASSUMPTION_STATUSES.join(', ')}.`);
              }
              found.status = a.status;
            }
          }
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.json({ draft: publicDraft(changed.draft) });
    } catch (err) {
      sendChangeError(res, err, 'patch');
    }
  });

  app.delete(`${BASE}/:draftId`, auth, async (req, res) => {
    try {
      const changed = await mutateDraft(
        String(req.params.draftId),
        owner(req),
        (d) => {
          // З 10.11.2026 (запит власника: видалення чернеток з системи) прибрати можна й ВІДПРАВЛЕНУ: чернетка — лише запис
          // на боці телефона, а результат (книга, курс, інструкція, «Вхідні») живе в Studio окремо й цим не зачіпається.
          d.status = 'discarded';
          d.job = null;
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.json({ draft: publicDraft(changed.draft) });
    } catch (err) {
      sendChangeError(res, err, 'discard');
    }
  });

  // ── Кадри ───────────────────────────────────────────────────────────────

  app.post(`${BASE}/:draftId/photos`, auth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const principal = req.principal as any;
      const ownerId = owner(req);
      const draftId = String(req.params.draftId);
      const draft = await getDraft(draftId, ownerId);
      if (!draft) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      if (!isEditable(draft)) return fail(res, 409, 'wrong_status', 'Чернетку вже відправлено або відкинуто — нові кадри не приймаються.');

      const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.trim() : '';
      if (!ID_RE.test(clientId)) {
        return fail(res, 400, 'bad_input', 'Передайте clientId — ідентифікатор кадру в застосунку (латиниця, цифри, _ і -, до 128 символів).');
      }
      // Повтор після обриву звʼязку: те саме фото, без дубля й без нового опису.
      const existing = draft.photos.find((p) => p.clientId === clientId);
      if (existing) {
        return res.status(202).json({ photo: publicPhoto(draftId, existing), revision: draft.revision, duplicate: true });
      }

      const decoded = decodeScanImage(req.body?.image, req.body?.mimeType);
      if (!decoded) {
        return fail(res, 400, 'bad_image', 'Очікується фото JPEG, PNG або WEBP (data:URL або base64 разом із mimeType).');
      }
      if (decoded.bytes.length > PHOTO_DRAFT_LIMITS.maxImageBytes) {
        return fail(res, 413, 'image_too_large', 'Фото завелике (максимум 10 МБ). Застосунок має стиснути його до 2048 px.');
      }
      const isManuscript = draft.kind === 'manuscript';
      const photoCap = isManuscript ? PHOTO_DRAFT_LIMITS.maxManuscriptPages : PHOTO_DRAFT_LIMITS.maxPhotosPerDraft;
      if (draft.photos.length >= photoCap) {
        return fail(res, 409, 'too_many_photos', `У чернетці вже ${photoCap} ${isManuscript ? 'сторінок' : 'кадрів'} — це межа.`);
      }
      const hourAgo = new Date(now().getTime() - 3600_000).toISOString();
      const hourCap = isManuscript ? PHOTO_DRAFT_LIMITS.manuscriptPagesPerHour : PHOTO_DRAFT_LIMITS.photosPerHour;
      if ((await countPhotosSince(ownerId, hourAgo, isManuscript ? 'manuscript' : 'other')) >= hourCap) {
        return fail(
          res,
          429,
          'rate_limited',
          `Не більше ${hourCap} ${isManuscript ? 'сторінок рукопису' : 'фото'} на годину. Черга продовжить надсилання трохи пізніше.`
        );
      }
      // Підказка до кадру одразу з фото (A5): прохід 1 стартує в цій же відповіді, тож окремий PUT нотатки не встиг би.
      let inlineNote = '';
      if (req.body?.note !== undefined && req.body?.note !== null) {
        if (typeof req.body.note !== 'string') return fail(res, 400, 'bad_input', 'Поле note має бути текстом.');
        inlineNote = req.body.note.trim();
        if (countNoteChars(inlineNote) > PHOTO_DRAFT_LIMITS.maxNoteChars) {
          return fail(res, 400, 'note_too_long', `Опис задовгий (максимум ${PHOTO_DRAFT_LIMITS.maxNoteChars} символів).`);
        }
      }
      const budget = await pass1Block(req, draft.kind);
      if (budget) return fail(res, 402, 'ai_budget_exceeded', budget);

      const stamp = now().toISOString().replace(/[:.]/g, '-');
      const ext = decoded.mimeType === 'image/png' ? 'png' : decoded.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const filename = `grabfusion-${stamp}.${ext}`;
      if (deps.checkStorage) {
        const quota = await deps.checkStorage({
          userId: ownerId,
          email: principal.email,
          role: principal.role,
          bytes: decoded.bytes.length,
          bookId: draft.bookId,
          filename,
        });
        if (!quota.allowed) return fail(res, 402, 'quota_exceeded', quota.reasonUk || 'Вичерпано ліміт сховища вашого тарифу.');
      }

      const asset = await saveAsset({
        ownerId,
        bookId: draft.bookId,
        kind: 'upload',
        filename,
        mimeType: decoded.mimeType,
        bytes: decoded.bytes,
        now,
      });
      const takenRaw = typeof req.body?.takenAt === 'string' ? Date.parse(req.body.takenAt) : NaN;
      const at = now().toISOString();
      const added = await mutateDraft(
        draftId,
        ownerId,
        (d) => {
          assertEditable(d);
          // Між читанням і записом цей самий clientId міг прийти паралельним запитом.
          const twin = d.photos.find((p) => p.clientId === clientId);
          if (twin) return { photo: twin, duplicate: true };
          if (d.photos.length >= photoCap) {
            throw new DraftChangeError(409, 'too_many_photos', `У чернетці вже ${photoCap} ${isManuscript ? 'сторінок' : 'кадрів'} — це межа.`);
          }
          const photo: StoredPhoto = {
            photoId: newPhotoId(),
            clientId,
            status: 'processing',
            order: d.photos.length + 1,
            takenAt: Number.isFinite(takenRaw) ? new Date(takenRaw).toISOString() : null,
            description: null,
            tags: [],
            error: null,
            createdAt: at,
            updatedAt: at,
            assetId: asset.id,
            mimeType: decoded.mimeType,
            modelId: null,
            ...(isManuscript ? { text: null, textEdited: false } : {}),
          };
          d.photos.push(photo);
          if (inlineNote) d.notes.push({ noteId: `n-${photo.photoId}`, photoIds: [photo.photoId], text: inlineNote, updatedAt: at });
          backToCollecting(d);
          return { photo, duplicate: false };
        },
        { byTeacher: true, now }
      );
      if (!added) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      const { photo, duplicate } = added.result;
      if (!duplicate) runDescribe(draftId, ownerId, photo.photoId, decoded.mimeType, decoded.bytes.toString('base64'), req);
      res.status(202).json({ photo: publicPhoto(draftId, photo), revision: added.draft.revision, duplicate });
    } catch (err) {
      sendChangeError(res, err, 'add photo');
    }
  });

  /** Байти кадру — у застосунку немає cookie для /api/media/file. */
  app.get(`${BASE}/:draftId/photos/:photoId/image`, auth, async (req, res) => {
    try {
      const ownerId = owner(req);
      const draft = await getDraft(String(req.params.draftId), ownerId);
      if (!draft) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      const photo = draft.photos.find((p) => p.photoId === String(req.params.photoId));
      if (!photo) return fail(res, 404, 'photo_not_found', 'Кадру немає в цій чернетці.');
      const file = await readAsset(photo.assetId);
      if (!file || file.record.ownerId !== ownerId) return fail(res, 404, 'photo_not_found', 'Фото кадру не знайдено в медіатеці.');
      res.setHeader('Content-Type', file.record.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(Buffer.from(file.bytes));
    } catch (err) {
      sendChangeError(res, err, 'photo image');
    }
  });

  app.post(`${BASE}/:draftId/photos/:photoId/retry`, auth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const ownerId = owner(req);
      const draftId = String(req.params.draftId);
      const photoId = String(req.params.photoId);
      const draft = await getDraft(draftId, ownerId);
      if (!draft) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      const photo = draft.photos.find((p) => p.photoId === photoId);
      if (!photo) return fail(res, 404, 'photo_not_found', 'Кадру немає в цій чернетці.');
      if (!isEditable(draft)) return fail(res, 409, 'wrong_status', 'Чернетку вже відправлено або відкинуто.');
      if (photo.status !== 'failed' && !photoIsStale(photo, now().getTime())) {
        return fail(res, 409, 'wrong_status', 'Повторити можна лише невдалий опис кадру.');
      }
      const file = await readAsset(photo.assetId);
      if (!file || file.record.ownerId !== ownerId) return fail(res, 404, 'photo_not_found', 'Фото кадру не знайдено в медіатеці.');
      const budget = await pass1Block(req, draft.kind);
      if (budget) return fail(res, 402, 'ai_budget_exceeded', budget);

      const changed = await mutateDraft(
        draftId,
        ownerId,
        (d) => {
          const p = d.photos.find((x) => x.photoId === photoId);
          if (!p || (p.status !== 'failed' && !photoIsStale(p, now().getTime()))) throw new DraftChangeError(409, 'wrong_status', 'Опис кадру вже перезапущено.');
          Object.assign(p, { status: 'processing', error: null, updatedAt: now().toISOString() });
          return p;
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      runDescribe(draftId, ownerId, photoId, file.record.mimeType, Buffer.from(file.bytes).toString('base64'), req);
      res.status(202).json({ photo: publicPhoto(draftId, changed.result), revision: changed.draft.revision, duplicate: false });
    } catch (err) {
      sendChangeError(res, err, 'retry');
    }
  });

  /** Рукопис: викладач виправив (або ввів вручну) текст сторінки. */
  app.put(`${BASE}/:draftId/photos/:photoId/text`, auth, async (req, res) => {
    try {
      const photoId = String(req.params.photoId);
      const raw = req.body?.text;
      if (typeof raw !== 'string') return fail(res, 400, 'bad_input', 'Передайте text — текст сторінки (порожній рядок означає «тексту немає»).');
      const text = raw.replace(/\r\n/g, '\n').trim();
      if (countNoteChars(text) > PHOTO_DRAFT_LIMITS.maxPageTextChars) {
        return fail(res, 400, 'bad_input', `Текст сторінки задовгий (максимум ${PHOTO_DRAFT_LIMITS.maxPageTextChars} символів).`);
      }
      const changed = await mutateDraft(
        String(req.params.draftId),
        owner(req),
        (d) => {
          assertEditable(d);
          if (d.kind !== 'manuscript') throw new DraftChangeError(409, 'wrong_status', 'Текст сторінки є лише в чернетки-рукопису.');
          const photo = d.photos.find((p) => p.photoId === photoId);
          if (!photo) throw new DraftChangeError(404, 'photo_not_found', 'Сторінки немає в цій чернетці.');
          if (photo.status === 'processing' && !photoIsStale(photo, now().getTime())) throw new DraftChangeError(409, 'wrong_status', 'Сторінка ще розпізнається — зачекайте.');
          Object.assign(photo, { status: 'described', text, textEdited: true, error: null, updatedAt: now().toISOString() });
          return photo;
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.json({ photo: publicPhoto(String(req.params.draftId), changed.result), revision: changed.draft.revision, duplicate: false });
    } catch (err) {
      sendChangeError(res, err, 'photo text');
    }
  });

  /** Прибрати кадр: він зникає й з описів, і з уроків. Фото в медіатеці лишається. */
  app.delete(`${BASE}/:draftId/photos/:photoId`, auth, async (req, res) => {
    try {
      const photoId = String(req.params.photoId);
      const changed = await mutateDraft(
        String(req.params.draftId),
        owner(req),
        (d) => {
          assertEditable(d);
          if (!d.photos.some((p) => p.photoId === photoId)) {
            throw new DraftChangeError(404, 'photo_not_found', 'Кадру немає в цій чернетці.');
          }
          d.photos = d.photos.filter((p) => p.photoId !== photoId);
          renumber(d);
          d.notes = d.notes
            .map((n) => ({ ...n, photoIds: n.photoIds.filter((id) => id !== photoId) }))
            .filter((n) => n.photoIds.length > 0);
          for (const m of d.structure?.modules ?? []) {
            for (const l of m.lessons) l.photoIds = l.photoIds.filter((id) => id !== photoId);
          }
          for (const a of d.assumptions) if (a.photoId === photoId) a.photoId = null;
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.json({ draft: publicDraft(changed.draft) });
    } catch (err) {
      sendChangeError(res, err, 'delete photo');
    }
  });

  // ── Описи викладача ─────────────────────────────────────────────────────

  app.put(`${BASE}/:draftId/notes/:noteId`, auth, async (req, res) => {
    try {
      const noteId = String(req.params.noteId);
      if (!ID_RE.test(noteId)) return fail(res, 400, 'bad_input', 'noteId — латиниця, цифри, _ і -, до 128 символів.');
      const body = req.body || {};
      if (typeof body.text !== 'string') return fail(res, 400, 'bad_input', 'Передайте text — опис кадру або серії.');
      const text = body.text.replace(/\r\n/g, '\n');
      const length = countNoteChars(text);
      if (length > PHOTO_DRAFT_LIMITS.maxNoteChars) {
        return fail(res, 400, 'note_too_long', `Опис задовгий: ${length} символів з ${PHOTO_DRAFT_LIMITS.maxNoteChars}. Скоротіть його.`);
      }
      if (!Array.isArray(body.photoIds) || !body.photoIds.length || body.photoIds.some((id: unknown) => typeof id !== 'string')) {
        return fail(res, 400, 'bad_input', 'photoIds — непорожній масив кадрів, до яких належить опис.');
      }
      const photoIds = [...new Set(body.photoIds as string[])];
      const changed = await mutateDraft(
        String(req.params.draftId),
        owner(req),
        (d) => {
          assertEditable(d);
          const unknown = photoIds.find((id) => !d.photos.some((p) => p.photoId === id));
          if (unknown) throw new DraftChangeError(404, 'photo_not_found', `Кадру ${unknown} немає в цій чернетці.`);
          const note = { noteId, photoIds, text, updatedAt: now().toISOString() };
          const index = d.notes.findIndex((n) => n.noteId === noteId);
          if (index >= 0) d.notes[index] = note;
          else d.notes.push(note);
          return note;
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.json({ note: changed.result, revision: changed.draft.revision });
    } catch (err) {
      sendChangeError(res, err, 'put note');
    }
  });

  app.delete(`${BASE}/:draftId/notes/:noteId`, auth, async (req, res) => {
    try {
      const noteId = String(req.params.noteId);
      const changed = await mutateDraft(
        String(req.params.draftId),
        owner(req),
        (d) => {
          assertEditable(d);
          if (!d.notes.some((n) => n.noteId === noteId)) throw new DraftChangeError(404, 'note_not_found', 'Опису немає.');
          d.notes = d.notes.filter((n) => n.noteId !== noteId);
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.json({ draft: publicDraft(changed.draft) });
    } catch (err) {
      sendChangeError(res, err, 'delete note');
    }
  });

  // ── Проходи 2–3 і відправка (етап 3, A2) ────────────────────────────────

  /** Стан, у якому прохід ШІ взагалі можна запускати; кидає DraftChangeError. */
  const assertJobStartable = (d: StoredDraft, check: (d: StoredDraft) => void) => {
    assertEditable(d);
    if (d.kind === 'manuscript') {
      throw new DraftChangeError(409, 'wrong_status', 'У рукописі немає проходів «Розкласти» й «Написати»: сторінки лише розпізнаються й правляться вручну.');
    }
    if (d.job?.status === 'running' && !jobIsStale(d.job, now().getTime())) {
      throw new DraftChangeError(409, 'job_running', 'Зачекайте: ШІ ще працює над цією чернеткою.');
    }
    check(d);
  };

  /** Помилка гаманця «бракує балів» без імпорту creditGate: той самий `kind: 'credits'`, що в зображень. */
  const isCreditsError = (err: unknown): err is Error => (err as { kind?: unknown })?.kind === 'credits';

  /** Дві фонові роботи ШІ мають спільні перевірки: власник, стан, одна робота за раз, модель, бали або бюджет. */
  const startJob = async (
    req: Request,
    res: Response,
    kind: 'structure' | 'generate',
    moduleId: string | null,
    check: (d: StoredDraft) => void,
    estimate: (d: StoredDraft) => PassTokenEstimate
  ) => {
    if (!deps.writeText) return fail(res, 503, 'server_error', 'Прохід ШІ не налаштовано на сервері.');
    const ownerId = owner(req);
    const draftId = String(req.params.draftId);
    const before = await getDraft(draftId, ownerId);
    if (!before) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');

    // Модель і бали (1.4.0). Стан перевіряємо ДО резерву, щоб не резервувати те, що однаково відмовлять.
    let charge: PassCharge | null = null;
    let modelId: string | undefined;
    if (deps.passModels) {
      const requested = req.body?.modelId;
      if (requested !== undefined && (typeof requested !== 'string' || requested.length > 200)) {
        return fail(res, 400, 'bad_input', 'modelId — рядок до 200 символів.');
      }
      try {
        assertJobStartable(before, check);
      } catch (err) {
        return sendChangeError(res, err, kind);
      }
      const listing = await deps.passModels.list(ownerId);
      modelId = (typeof requested === 'string' && requested.trim()) || listing.defaultModelId || undefined;
      if (!modelId) return fail(res, 503, 'server_error', 'У Studio немає жодної моделі ШІ з дійсним ключем. Зверніться до адміністратора.');
      const picked = listing.models.find((m) => m.modelId === modelId);
      if (!picked) return fail(res, 400, 'bad_input', 'Невідома модель. Оберіть одну з тих, що повертає GET …/ai-options.');
      if (!picked.usable) return fail(res, 400, 'bad_input', `Модель «${picked.label}» недоступна: ${picked.note || 'перевірка не пройшла'}`);
      const quote = deps.passModels.quote(modelId, estimate(before));
      if (!quote) return fail(res, 400, 'bad_input', `Ціну моделі «${picked.label}» в адмінці не звірено — оберіть іншу.`);
      try {
        charge = await deps.passModels.begin(req, quote);
      } catch (err) {
        if (isCreditsError(err)) return fail(res, 402, 'ai_budget_exceeded', err.message);
        throw err;
      }
    }

    // Оплачено балами — грошовий ліміт тексту не чіпаємо; без балів (адмін, гейт вимкнено) — як було.
    const budget = charge ? null : await budgetBlock(req);
    if (budget) return fail(res, 402, 'ai_budget_exceeded', budget);
    const startedAt = now().toISOString();
    let started;
    try {
      started = await mutateDraft(
        draftId,
        ownerId,
        (d) => {
          assertJobStartable(d, check);
          d.job = { kind, status: 'running', moduleId, error: null, startedAt };
          return JSON.parse(JSON.stringify(d)) as StoredDraft;
        },
        { byTeacher: true, now }
      );
    } catch (err) {
      charge?.release('Прохід не запущено');
      throw err;
    }
    if (!started) {
      charge?.release('Чернетку не знайдено');
      return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
    }
    return { ownerId, draftId, startedAt, snapshot: started.result, draft: started.draft, charge, modelId };
  };

  /** Фоновий кінець роботи: застосувати результат, якщо робота ще «та сама»; ревізію не змінює. */
  const finishJob = (
    ownerId: string,
    draftId: string,
    startedAt: string,
    kind: 'structure' | 'generate',
    run: () => Promise<(d: StoredDraft) => void>
  ) => {
    schedule(async () => {
      let apply: (d: StoredDraft) => void;
      try {
        apply = await run();
      } catch (err) {
        console.warn(`[photoDrafts] прохід ${kind}:`, String((err as Error)?.message || err).slice(0, 300));
        const error = humanizeDescribeError(err);
        apply = (d) => {
          d.job = { ...d.job!, status: 'failed', error };
        };
      }
      await mutateDraft(
        draftId,
        ownerId,
        (d) => {
          // Чернетку відкинули або запустили заново — цей результат уже нічий.
          if (!d.job || d.job.kind !== kind || d.job.startedAt !== startedAt || d.job.status !== 'running') return;
          apply(d);
        },
        { byTeacher: false, now }
      ).catch((err) => console.error(`[photoDrafts] запис проходу ${kind}:`, err));
    });
  };

  /**
   * Які моделі можна обрати для проходу і скільки це коштує в балах (з 1.4.0). Дані не змінює:
   * ключі перевіряються пробним запитом (кеш у photoDraftAiModels), вартість — за розміром цієї чернетки.
   */
  app.get(`${BASE}/:draftId/ai-options`, auth, requirePermission('canUseAi'), async (req, res) => {
    try {
      if (!deps.passModels) return fail(res, 503, 'server_error', 'Вибір моделі не налаштовано на сервері.');
      const ownerId = owner(req);
      const d = await getDraft(String(req.params.draftId), ownerId);
      if (!d) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      if (d.kind === 'manuscript') {
        return fail(res, 409, 'wrong_status', 'У рукописі немає проходів «Розкласти» й «Написати»: моделі обирати нема для чого.');
      }
      const passParam = req.query.pass === undefined ? 'structure' : String(req.query.pass);
      if (passParam !== 'structure' && passParam !== 'generate') {
        return fail(res, 400, 'bad_input', 'pass — `structure` або `generate`.');
      }
      const pass: AiPass = passParam;
      let moduleId: string | null = null;
      let est: PassTokenEstimate;
      if (pass === 'structure') {
        est = estimateStructurePass(structureSystemInstruction(d.kind, d.instructionMode), buildStructurePrompt(d), d.photos.length, PASS_MAX_TOKENS);
      } else {
        moduleId = String(req.query.moduleId ?? '');
        const m = d.structure?.modules.find((x) => x.moduleId === moduleId);
        if (!m) return fail(res, 404, 'module_not_found', 'Модуля немає в структурі.');
        est = estimateGeneratePass(generateSystemInstruction(d.kind, d.instructionMode), buildGeneratePrompt(d, m), m.lessons.length, PASS_MAX_TOKENS);
      }
      const [listing, bal] = await Promise.all([deps.passModels.list(ownerId), deps.passModels.balance(req)]);
      const models: PassModelOption[] = listing.models.map((m) => {
        const quote = m.usable ? deps.passModels!.quote(m.modelId, est) : null;
        // Придатна, але без ціни — бали порахувати не можна, тож обирати її не пропонуємо.
        if (m.usable && !quote) return { ...m, status: 'price_unknown', usable: false, note: 'Ціну моделі в адмінці не звірено — бали порахувати не можна.', credits: null };
        return { ...m, credits: quote ? { expected: quote.expectedCredits, max: quote.maxCredits } : null };
      });
      const defaultModelId = models.some((m) => m.modelId === listing.defaultModelId && m.usable) ? listing.defaultModelId : (models.find((m) => m.usable)?.modelId ?? null);
      const body: AiOptionsResponse = {
        pass,
        moduleId,
        defaultModelId,
        models,
        balance: bal.unlimited ? null : bal.balance,
        unlimited: bal.unlimited,
        checkedAt: listing.checkedAt,
      };
      res.json(body);
    } catch (err) {
      sendChangeError(res, err, 'ai-options');
    }
  });

  app.post(`${BASE}/:draftId/structure`, auth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const replace = req.body?.replace === true;
      const begun = await startJob(req, res, 'structure', null, (d) => {
        if (d.photos.length === 0) throw new DraftChangeError(409, 'wrong_status', 'У чернетці ще немає кадрів.');
        if (d.photos.some((p) => p.status === 'processing' && !photoIsStale(p, now().getTime()))) {
          throw new DraftChangeError(409, 'wrong_status', 'Кадри ще описуються — зачекайте, поки опис закінчиться.');
        }
        if (d.structure && !replace) {
          throw new DraftChangeError(
            409,
            'wrong_status',
            'Структура вже є. Щоб розкласти заново, передайте { "replace": true } — правки викладача в ній буде втрачено.'
          );
        }
      }, (d) => estimateStructurePass(structureSystemInstruction(d.kind, d.instructionMode), buildStructurePrompt(d), d.photos.length, PASS_MAX_TOKENS));
      if (!begun) return;
      const { ownerId, draftId, startedAt, snapshot, draft, charge, modelId } = begun;
      finishJob(ownerId, draftId, startedAt, 'structure', async () => {
        let parsed: ReturnType<typeof parseStructureResult>;
        try {
          const out = await deps.writeText!({
            ownerId,
            draftId,
            system: structureSystemInstruction(snapshot.kind, snapshot.instructionMode),
            prompt: buildStructurePrompt(snapshot),
            maxTokens: PASS_MAX_TOKENS,
            label: passLabel('Структура за фото (GrabFusion)', !!charge),
            req,
            modelId,
            creditBilled: !!charge,
          });
          parsed = parseStructureResult(out.text, snapshot.photos, { maxLessons: snapshot.kind === 'instruction' ? INSTRUCTION_MAX_STEPS : undefined });
          // Списуємо лише коли результат придатний: модель, що повернула сміття, авторові не рахується.
          charge?.settleUsd(out.costUsd ?? 0);
        } catch (err) {
          charge?.release('Прохід «Розкласти» не дав результату');
          throw err;
        }
        return (d) => {
          const modules = parsed.modules;
          placePhotos(modules, d.photos);
          d.structure = { modules };
          d.assumptions = parsed.assumptions.map((a) => (a.photoId && !d.photos.some((p) => p.photoId === a.photoId) ? { ...a, photoId: null } : a));
          if (!d.title && parsed.title) d.title = parsed.title;
          d.status = 'structured';
          d.job = null;
        };
      });
      res.status(202).json({ draft: publicDraft(draft) });
    } catch (err) {
      sendChangeError(res, err, 'structure');
    }
  });

  app.post(`${BASE}/:draftId/modules/:moduleId/generate`, auth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const moduleId = String(req.params.moduleId);
      const begun = await startJob(req, res, 'generate', moduleId, (d) => {
        if (!d.structure) throw new DraftChangeError(409, 'wrong_status', 'Спершу розкладіть кадри на модулі й уроки.');
        if (!d.structure.modules.some((m) => m.moduleId === moduleId)) {
          throw new DraftChangeError(404, 'module_not_found', 'Модуля немає в структурі.');
        }
      }, (d) => {
        const m = d.structure?.modules.find((x) => x.moduleId === moduleId);
        return estimateGeneratePass(
          generateSystemInstruction(d.kind, d.instructionMode),
          m ? buildGeneratePrompt(d, m) : '',
          m?.lessons.length ?? 1,
          PASS_MAX_TOKENS
        );
      });
      if (!begun) return;
      const { ownerId, draftId, startedAt, snapshot, draft, charge, modelId } = begun;
      const module = snapshot.structure!.modules.find((m) => m.moduleId === moduleId)!;
      finishJob(ownerId, draftId, startedAt, 'generate', async () => {
        let parsed: ReturnType<typeof parseGenerateResult>;
        try {
          const out = await deps.writeText!({
            ownerId,
            draftId,
            system: generateSystemInstruction(snapshot.kind, snapshot.instructionMode),
            prompt: buildGeneratePrompt(snapshot, module),
            maxTokens: PASS_MAX_TOKENS,
            label: passLabel('Текст модуля за фото (GrabFusion)', !!charge),
            req,
            modelId,
            creditBilled: !!charge,
          });
          parsed = parseGenerateResult(out.text, module);
          charge?.settleUsd(out.costUsd ?? 0);
        } catch (err) {
          charge?.release('Прохід «Написати» не дав результату');
          throw err;
        }
        return (d) => {
          const target = d.structure?.modules.find((m) => m.moduleId === moduleId);
          if (!target) {
            d.job = { ...d.job!, status: 'failed', error: 'Модуль зник зі структури, поки писався текст.' };
            return;
          }
          applyGenerated(target, parsed);
          d.assumptions = mergeAssumptions(d.assumptions, parsed.assumptions, target);
          if (d.status !== 'collecting') d.status = statusAfterStructure(d.structure!);
          d.job = null;
        };
      });
      res.status(202).json({ draft: publicDraft(draft) });
    } catch (err) {
      sendChangeError(res, err, 'generate');
    }
  });

  const RESULT_WORD: Record<PhotoDraftKind, string> = { course: 'Курс', instruction: 'Інструкція', book: 'Глава', manuscript: 'Рукопис' };

  app.post(`${BASE}/:draftId/submit`, auth, async (req, res) => {
    try {
      if (!deps.sinks) return fail(res, 503, 'server_error', 'Відправка в Studio не налаштована на сервері.');
      const sinks = deps.sinks;
      const ownerId = owner(req);
      const draftId = String(req.params.draftId);
      const before = await getDraft(draftId, ownerId);
      if (!before) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      let bookOk = false;
      if ((before.kind === 'book' || before.kind === 'manuscript') && before.bookId) {
        const book = await getBook(before.bookId).catch(() => null);
        bookOk = !!book && book.ownerId === ownerId;
      } else if (before.kind === 'manuscript' && before.newBookTitle?.trim()) {
        bookOk = true; // нова книга: її створить автор у Studio
      }
      const changed = await mutateDraft(
        draftId,
        ownerId,
        async (d) => {
          assertEditable(d);
          if (d.job?.status === 'running' && !jobIsStale(d.job, now().getTime())) {
            throw new DraftChangeError(409, 'job_running', 'Зачекайте: ШІ ще працює над цією чернеткою.');
          }
          const blockers = computeSubmitBlockers(d, { bookOk, status: d.status, nowMs: now().getTime() });
          if (blockers.length > 0) {
            throw new DraftChangeError(400, 'submit_blocked', `${RESULT_WORD[d.kind]} ще не готов${d.kind === 'course' || d.kind === 'manuscript' ? 'ий' : 'а'} до відправки.`, { blockers });
          }
          let target: SubmitTarget;
          if (d.kind === 'course') {
            const at = now().toISOString();
            const ai = deps.aiUsage ? await deps.aiUsage({ ownerId, draftId, since: d.createdAt }).catch(() => null) : null;
            const id = await sinks.createCourse(ownerId, toCourseInput(d, { at, ai }));
            target = { kind: 'course', id, studioUrl: `/courses/${id}` };
          } else if (d.kind === 'instruction') {
            const id = await sinks.createExpress(ownerId, toExpressPayload(d));
            target = { kind: 'express', id, studioUrl: `/express/${id}` };
          } else if (d.kind === 'manuscript') {
            const items = toManuscriptItems(d);
            // Нової книги ще немає — Studio створює її сама (дашборд, «Книга & Текст», медіатека); збій чи порожній текст — як раніше, «Вхідні».
            let made: { bookId: string; chapterTitle: string; pages: number } | null = null;
            if (!d.bookId && sinks.createManuscriptBook) {
              try {
                const p = req.principal as { name?: string; role?: string } | undefined;
                made = await sinks.createManuscriptBook({
                  ownerId,
                  ownerName: String(p?.name || ''),
                  ownerRole: String(p?.role || 'writer'),
                  bookTitle: (d.newBookTitle ?? '').trim() || (d.title ?? '').trim(),
                  chapterTitle: (d.title ?? '').trim(),
                  items,
                  tokenId: d.tokenId,
                  batchId: d.id,
                });
              } catch (err) {
                console.error('[photoDrafts] книга з рукопису не створена, пакет іде у «Вхідні»:', err);
              }
            }
            if (made) {
              target = { kind: 'book', id: made.bookId, studioUrl: '/' };
            } else {
              const id = await sinks.createInboxScans({
                ownerId,
                bookId: d.bookId ?? '',
                items,
                tokenId: d.tokenId,
                batch: { id: d.id, bookTitle: d.bookId ? null : d.newBookTitle ?? null },
              });
              target = { kind: 'inbox', id, studioUrl: d.bookId ? `/media?tab=inbox&bookId=${encodeURIComponent(d.bookId)}` : '/media?tab=inbox' };
            }
          } else {
            const id = await sinks.createInboxScans({ ownerId, bookId: d.bookId!, items: toInboxItems(d), tokenId: d.tokenId });
            target = { kind: 'inbox', id, studioUrl: `/media?tab=inbox&bookId=${encodeURIComponent(d.bookId!)}` };
          }
          d.status = 'submitted';
          d.submitted = target;
          d.job = null;
          return target;
        },
        { byTeacher: true, now }
      );
      if (!changed) return fail(res, 404, 'draft_not_found', 'Чернетку не знайдено.');
      res.status(201).json({ draft: publicDraft(changed.draft), target: changed.result });
    } catch (err) {
      sendChangeError(res, err, 'submit');
    }
  });
}
