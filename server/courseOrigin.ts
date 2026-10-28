/**
 * Походження курсу (GrabFusion, A3 / етап 4 плану): курс, створений з чернетки
 * за фото, пам'ятає це й те, що в ньому написав ШІ та автор ще не правив.
 *
 * Чисті функції без сховища й без Node — їх викликає courseStore, а тест
 * перевіряє окремо. Контракту з GrabFusion це не стосується: `origin` лежить
 * лише в курсі Studio і виставляється сервером при `submit`.
 */

/** Поля уроку, за якими ведеться «написано ШІ». `description` — це `body` з контракту чернеток. */
export const ORIGIN_LESSON_FIELDS = ['title', 'goal', 'description', 'topics'] as const;
export type OriginLessonField = (typeof ORIGIN_LESSON_FIELDS)[number];

export interface CourseOrigin {
  kind: 'photo-draft';
  draftId: string;
  /** Коли чернетку відправлено в Studio (ISO 8601). */
  createdAt: string;
  photoCount: number;
  /** lessonId → поля, які написав ШІ й автор ще не правив. */
  aiFields: Record<string, OriginLessonField[]>;
  /** Витрати ШІ на цю чернетку з журналу витрат; немає — не вдалося порахувати. */
  ai?: { calls: number; costUsd: number };
}

interface LessonLike {
  id: string;
  title?: string;
  goal?: string;
  description?: string;
  topics?: string[];
}
interface ModuleLike {
  lessons?: LessonLike[];
}

const norm = (field: OriginLessonField, lesson: LessonLike): string =>
  field === 'topics' ? JSON.stringify(lesson.topics ?? []) : String(lesson[field] ?? '').trim();

function lessonsOf(modules: ModuleLike[] | undefined): Map<string, LessonLike> {
  const map = new Map<string, LessonLike>();
  for (const m of modules ?? []) for (const l of m.lessons ?? []) map.set(l.id, l);
  return map;
}

/** Відомості про походження, що прийшли ззовні, приводить до безпечного вигляду або відкидає. */
export function normalizeOrigin(value: unknown): CourseOrigin | undefined {
  const v = value as Partial<CourseOrigin> | null | undefined;
  if (!v || typeof v !== 'object' || v.kind !== 'photo-draft' || typeof v.draftId !== 'string' || !v.draftId) return undefined;
  const aiFields: Record<string, OriginLessonField[]> = {};
  for (const [lessonId, fields] of Object.entries(v.aiFields ?? {})) {
    const kept = (Array.isArray(fields) ? fields : []).filter((f): f is OriginLessonField => (ORIGIN_LESSON_FIELDS as readonly string[]).includes(f as string));
    if (kept.length) aiFields[lessonId] = [...new Set(kept)];
  }
  const ai =
    v.ai && Number.isFinite(Number(v.ai.calls)) && Number.isFinite(Number(v.ai.costUsd))
      ? { calls: Math.max(0, Math.round(Number(v.ai.calls))), costUsd: Math.max(0, Number(v.ai.costUsd)) }
      : undefined;
  return {
    kind: 'photo-draft',
    draftId: v.draftId,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    photoCount: Number.isFinite(Number(v.photoCount)) ? Math.max(0, Math.round(Number(v.photoCount))) : 0,
    aiFields,
    ...(ai ? { ai } : {}),
  };
}

/**
 * Після правки курсу: поле, яке автор змінив (порівняно зі збереженим), перестає
 * бути «написаним ШІ»; урок, якого вже немає, прибирається. Повертає нову origin
 * (вхідну не мутує). Без origin — `undefined`.
 */
export function reconcileOrigin(origin: CourseOrigin | undefined, prev: ModuleLike[] | undefined, next: ModuleLike[] | undefined): CourseOrigin | undefined {
  if (!origin) return undefined;
  const before = lessonsOf(prev);
  const after = lessonsOf(next);
  const aiFields: Record<string, OriginLessonField[]> = {};
  for (const [lessonId, fields] of Object.entries(origin.aiFields)) {
    const was = before.get(lessonId);
    const now = after.get(lessonId);
    if (!now) continue;
    // Не було що порівнювати (урок щойно додано в збереженому курсі) — лишаємо як є.
    const kept = was ? fields.filter((f) => norm(f, was) === norm(f, now)) : fields;
    if (kept.length) aiFields[lessonId] = kept;
  }
  return { ...origin, aiFields };
}

/** Скільки полів курсу досі написано ШІ без правок автора — для позначки в редакторі. */
export function countAiFields(origin: CourseOrigin | undefined): number {
  return origin ? Object.values(origin.aiFields).reduce((n, f) => n + f.length, 0) : 0;
}
