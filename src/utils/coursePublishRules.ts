/**
 * Правила подання курсу у вітрину — ОДИН модуль для редактора й сервера.
 *
 * Досі сервер (`courseRoutes.publishProblems`) і редактор (`collectReadiness`)
 * мали власні списки, і вони розійшлись: сервер не знав ні про ціну, ні про
 * обкладинку, ні про відео. Звідси дві найгірші знахідки аудиту курсів:
 * курс без ціни після погодження ставав БЕЗКОШТОВНИМ (`priceMinor ?? 0`), а
 * курс без обкладинки проходив подання й падав лише в адміна.
 *
 * Тут — те, без чого курс не можна ані подати, ані погодити. Редактор додає
 * поверх цього власні «шліфувальні» пункти (фото модуля, мета уроку тощо).
 */

/** Структурний тип: підходить і серверний `Course`, і клієнтський `CourseV2`. */
import { libraryAssetId } from './libraryMediaUrl';

export interface CourseRulesInput {
  title: string;
  subtitle?: string;
  audience: string[];
  outcomes: string[];
  highlights: string[];
  coverUrl?: string;
  priceMinor?: number;
  free?: boolean;
  currency?: string;
  /** Slug категорії вітрини ('' — свідомо без категорії). */
  categorySlug?: string;
  skills: unknown[];
  modules: Array<{
    title: string;
    introVideoUrl?: string;
    lessons: Array<{ title: string; videoUrl?: string; durationMin?: number }>;
  }>;
}

/**
 * Коли студенти курсу можуть виставити на продаж власну роботу, зроблену під
 * час курсу: ніколи / після завершення / з будь-якого моменту. Рішення автора
 * курсу; за замовчуванням — після завершення. Вітрина читає це з публікації.
 */
export type GraduateSelling = 'off' | 'after_completion' | 'anytime';
export const GRADUATE_SELLING_MODES: readonly GraduateSelling[] = ['off', 'after_completion', 'anytime'];
export const DEFAULT_GRADUATE_SELLING: GraduateSelling = 'after_completion';
export const GRADUATE_SELLING_LABELS: Record<GraduateSelling, string> = {
  off: 'Не дозволяти',
  after_completion: 'Після завершення курсу',
  anytime: 'З будь-якого моменту',
};

/** Невідоме чи відсутнє значення читаємо як типове: старі курси ніколи його не задавали. */
export function normalizeGraduateSelling(value: unknown): GraduateSelling {
  return GRADUATE_SELLING_MODES.includes(value as GraduateSelling) ? (value as GraduateSelling) : DEFAULT_GRADUATE_SELLING;
}

/** Єдина валюта вітрини: кошик і LiqPay рахують лише в гривнях. */
export const COURSE_CURRENCY = 'UAH';

/** Межа тривалості одного уроку, хв — більше схоже на помилку вводу (години замість хвилин). */
export const MAX_LESSON_MINUTES = 600;

/**
 * Чи вбудує вітрина це посилання. Ті самі шаблони, що й у маркетплейсі
 * (`apps/web/src/lib/youtube.ts`, `vimeo.ts`): «правильне» тут, але
 * невбудовне там посилання дало б покупцеві урок без відео.
 */
export function videoProvider(raw: string | undefined | null): 'youtube' | 'vimeo' | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtube\.com\/(?:embed|shorts|live)\/|youtube-nocookie\.com\/embed\/|youtu\.be\/)[A-Za-z0-9_-]{11}/.test(s) ||
    /(?:youtube\.com|youtu\.be)\/.*[?&]list=[A-Za-z0-9_-]+/.test(s)
  ) {
    return 'youtube';
  }
  if (
    /player\.vimeo\.com\/video\/\d+/i.test(s) ||
    /vimeo\.com\/(?:channels|groups)\/[^/]+\/(?:videos\/)?\d+/i.test(s) ||
    /vimeo\.com\/\d+/i.test(s)
  ) {
    return 'vimeo';
  }
  return null;
}

/** Порожнє посилання — це «відео немає», а не помилка. */
export function videoUrlProblem(raw: string | undefined | null): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return videoProvider(s) ? null : 'посилання не на YouTube чи Vimeo — вітрина його не покаже';
}

export function lessonDurationProblem(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LESSON_MINUTES) {
    return `тривалість має бути цілим числом хвилин від 1 до ${MAX_LESSON_MINUTES}`;
  }
  return null;
}

/** Ціна курсу: явна ціна в копійках або явне «Безкоштовний». */
export function coursePriceProblem(course: Pick<CourseRulesInput, 'priceMinor' | 'free'>): string | null {
  const price = course.priceMinor;
  if (course.free === true) {
    return price && price > 0 ? 'Позначено «Безкоштовний», але вказано ціну — залиште щось одне.' : null;
  }
  if (price === undefined || price === null || !Number.isFinite(price)) {
    return 'Не вказано ціну. Якщо курс роздається безкоштовно — позначте «Безкоштовний».';
  }
  if (!Number.isInteger(price) || price < 0) return 'Ціна вказана некоректно.';
  if (price === 0) return 'Ціна 0 без позначки «Безкоштовний» — вкажіть ціну або позначте курс безкоштовним.';
  return null;
}

/** Те, без чого курс не подати й не погодити. Порожній масив — можна. */
export function courseSubmitProblems(
  course: CourseRulesInput,
  options: { categoryRequired?: boolean } = {}
): string[] {
  const problems: string[] = [];
  if (!course.title?.trim() || course.title === 'Новий курс') problems.push('Курс без назви.');
  if (!course.subtitle?.trim()) problems.push('Немає підзаголовка.');
  if ((course.audience || []).filter(Boolean).length === 0) problems.push('Не описана аудиторія.');
  if ((course.outcomes || []).filter(Boolean).length === 0) problems.push('Немає результатів навчання.');
  if ((course.highlights || []).filter(Boolean).length < 3) problems.push('Менше трьох вигод на картку курсу.');
  if ((course.skills || []).length === 0) problems.push('Немає навичок курсу.');

  if (!String(course.coverUrl ?? '').trim()) {
    problems.push('Немає обкладинки: без неї картка в каталозі — порожній прямокутник.');
  } else if (!/^https?:\/\//i.test(String(course.coverUrl).trim()) && !libraryAssetId(course.coverUrl)) {
    // Підходить посилання http(s) або зображення з медіатеки Студії — його
    // міст завантажує у вітрину файлом (`courseMediaSync`).
    problems.push('Обкладинка має бути посиланням http(s) на зображення або фото з медіатеки.');
  }

  // Категорія обов'язкова лише коли вітрина віддала перелік (старий маркетплейс
  // без /bridge/categories не повинен блокувати подання). «Свідомо без категорії»
  // (порожній slug) більше не допускається: курс без розділу не знайти в каталозі.
  if (options.categoryRequired && !String(course.categorySlug ?? '').trim()) {
    problems.push('Не обрано категорію вітрини: без неї курс не знайти в каталозі.');
  }

  const price = coursePriceProblem(course);
  if (price) problems.push(price);

  const currency = String(course.currency ?? '').trim().toUpperCase();
  if (currency && currency !== COURSE_CURRENCY) {
    problems.push(`Валюта «${course.currency}» не підтримується: вітрина приймає оплату лише в гривнях (UAH).`);
  }

  const modules = course.modules || [];
  if (modules.length === 0) problems.push('Немає жодного модуля.');
  modules.forEach((m, i) => {
    const n = i + 1;
    if (!m.title?.trim()) problems.push(`Модуль ${n}: без назви.`);
    if ((m.lessons || []).length === 0) problems.push(`Модуль ${n}: жодного уроку.`);
    const intro = videoUrlProblem(m.introVideoUrl);
    if (intro) problems.push(`Модуль ${n}, вступне відео: ${intro}.`);
    (m.lessons || []).forEach((l, li) => {
      const label = `${n}.${li + 1}`;
      const video = videoUrlProblem(l.videoUrl);
      if (video) problems.push(`Урок ${label}, відео: ${video}.`);
      const duration = lessonDurationProblem(l.durationMin);
      if (duration) problems.push(`Урок ${label}: ${duration}.`);
    });
  });
  return problems;
}
