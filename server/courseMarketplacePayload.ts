/**
 * Один збирач того, що з курсу Студії йде у вітрину (`/bridge/courses`).
 *
 * Раніше цей об'єкт збирався вручну у двох місцях — у погодженні модерації й
 * в адмінському `publish-course` — і розходився: адмінський шлях пересилав
 * сирі `skills`/`modules` з тіла запиту, а погодження — лише назви й відео.
 * Тепер обидва шляхи викликають `buildCoursePublishInput`, тож у вітрину
 * потрапляє те саме, що в курсі, і нічого сторонньо-принесеного.
 *
 * Публічне/платне розділяє вже вітрина (білий список у `toPublicCurriculum`):
 * Студія надсилає повний зміст разом зі стабільними id модулів і уроків, а
 * вітрина до оплати показує лише програму — назви, мету, теми, тривалість.
 * Відео, текст уроку, фото й завдання бачить тільки покупець.
 */
import type {
  PublishCourseAssignment,
  PublishCourseInput,
  PublishCourseModule,
} from './marketplaceBridge';
import { COURSE_CURRENCY } from '../src/utils/coursePublishRules';

/** Мінімум полів курсу, потрібних збирачу (сумісний і з `Course`, і з `CourseV2`). */
interface CourseLike {
  id: string;
  title: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  coverUrl?: string;
  highlights: string[];
  audience: string[];
  outcomes: string[];
  category?: string;
  categorySlug?: string;
  priceMinor?: number;
  free?: boolean;
  skills: Array<{ name: string; level: 'base' | 'confident' | 'pro'; whyItMatters?: string }>;
  modules: Array<{
    id: string;
    title: string;
    summary?: string;
    coverPhotoUrl?: string;
    introVideoUrl?: string;
    finalAssignment?: AssignmentLike;
    lessons: Array<{
      id: string;
      title: string;
      goal?: string;
      description?: string;
      topics: string[];
      videoUrl?: string;
      photoUrls: string[];
      assignment?: AssignmentLike;
      durationMin?: number;
    }>;
  }>;
}

interface AssignmentLike {
  title: string;
  brief: string;
  steps: string[];
  deliverable: string;
  acceptanceCriteria: string[];
  estimateMin?: number;
}

const filled = (list: string[] | undefined): string[] =>
  (list ?? []).map((item) => String(item ?? '').trim()).filter(Boolean);

/** Фото відкриває покупець у браузері, тож придатні лише абсолютні http(s)-посилання. */
const webUrl = (value: string | undefined): string | undefined => {
  const url = String(value ?? '').trim();
  return /^https?:\/\//i.test(url) ? url : undefined;
};

function assignment(value: AssignmentLike | undefined): PublishCourseAssignment | undefined {
  if (!value || !String(value.title ?? '').trim()) return undefined;
  return {
    title: value.title.trim(),
    brief: value.brief,
    steps: filled(value.steps),
    deliverable: value.deliverable,
    acceptanceCriteria: filled(value.acceptanceCriteria),
    estimateMin: value.estimateMin,
  };
}

/**
 * Безпечний обсяг для приймача без `course-content-v2`: програма й відео — те,
 * що старі приймачі вже вміли ховати від публіки. Без id, опису, фото й завдань.
 */
function buildLegacyModules(course: CourseLike): PublishCourseModule[] {
  return course.modules.map((m) => ({
    title: m.title,
    summary: m.summary,
    introVideoUrl: m.introVideoUrl,
    lessons: m.lessons.map((l) => ({ title: l.title, durationMin: l.durationMin, videoUrl: l.videoUrl })),
  }));
}

export function buildCourseModules(course: CourseLike, rich = true): PublishCourseModule[] {
  if (!rich) return buildLegacyModules(course);
  return course.modules.map((m) => ({
    id: m.id,
    title: m.title,
    summary: m.summary,
    coverPhotoUrl: webUrl(m.coverPhotoUrl),
    introVideoUrl: m.introVideoUrl,
    finalAssignment: assignment(m.finalAssignment),
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      goal: l.goal,
      topics: filled(l.topics),
      durationMin: l.durationMin,
      description: l.description,
      videoUrl: l.videoUrl,
      photoUrls: filled(l.photoUrls).map(webUrl).filter((u): u is string => u !== undefined),
      assignment: assignment(l.assignment),
    })),
  }));
}

export function buildCoursePublishInput(
  course: CourseLike,
  sellerSlug: string,
  /** true — приймач заявив `course-content-v2` (див. `bridgeSupportsCourseContent`); за замовчуванням безпечний обсяг. */
  options: { richContent?: boolean } = {}
): PublishCourseInput {
  const priceMinor = course.free === true ? 0 : Math.round(Number(course.priceMinor));
  return {
    bookId: course.id,
    title: course.title,
    subtitle: course.subtitle,
    summary: course.summary,
    description: course.description,
    priceMinor,
    currency: COURSE_CURRENCY,
    coverUrl: course.coverUrl,
    highlights: filled(course.highlights),
    sellerSlug,
    moduleCount: course.modules.length,
    lessonCount: course.modules.reduce((n, m) => n + m.lessons.length, 0),
    // Slug категорії вітрини має перевагу; старий вільний текст іде лише
    // тоді, коли slug ще не обрано (маркетплейс зіставить його м'яко).
    categorySlug: course.categorySlug,
    category: course.categorySlug === undefined ? course.category : undefined,
    audience: filled(course.audience),
    outcomes: filled(course.outcomes),
    skills: course.skills.map((s) => ({ name: s.name, level: s.level, whyItMatters: s.whyItMatters })),
    modules: buildCourseModules(course, options.richContent === true),
  };
}
