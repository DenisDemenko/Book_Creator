/**
 * «Доповнити це з ШІ» в блоці «Готовність» редактора курсів (прохання власника 13.11.2026).
 *
 * ЩО ЦЕ. Блок «Готовність» показує перелік того, без чого курс не подати
 * («Без цього не подати») і що варто доробити («Варто доробити»). Донедавна це
 * були просто рядки: автор читав «Урок 1.2: немає завдання з критеріями» і йшов
 * шукати цей урок руками. Тут — міст між рядком і дією: з тексту пункту
 * виводиться ПРОГАЛИНА (`CourseGap`) — що саме і де бракує, — і вже за нею
 * сервер просить ШІ запропонувати вміст, а редактор показує пропозицію у вікні.
 *
 * ЧОМУ ТУТ, А НЕ В КОМПОНЕНТІ. Той самий опис прогалини потрібен обом бокам:
 * редактор його створює, сервер — перевіряє (інакше «доповнити» перетворилось би
 * на «напиши в курс що завгодно за описом із браузера»). Модуль чистий: без
 * React, мережі й сховища.
 *
 * ЧОГО ТУТ НЕМАЄ НАВМИСНО. Прогалини, яких ШІ не закриває: фото й обкладинка,
 * відео, ціна, категорія вітрини. Для них кнопки не буде — обіцяти «доповню»
 * там, де потрібен файл автора чи його рішення про гроші, гірше, ніж мовчати.
 */

/** Що саме бракує. Поля `moduleId`/`lessonId` — лише там, де прогалина всередині модуля чи уроку. */
export type CourseGapKind =
  | 'subtitle'
  | 'audience'
  | 'outcomes'
  | 'highlights'
  | 'skills'
  | 'module-title'
  | 'module-summary'
  | 'module-final'
  | 'lesson-title'
  | 'lesson-goal'
  | 'lesson-description'
  | 'lesson-assignment';

export interface CourseGap {
  kind: CourseGapKind;
  moduleId?: string;
  lessonId?: string;
}

/** Підпис кнопки й заголовок вікна — однакові в редакторі й у тестах. */
export const GAP_LABELS: Record<CourseGapKind, string> = {
  subtitle: 'підзаголовок курсу',
  audience: 'для кого цей курс',
  outcomes: 'результати навчання',
  highlights: 'вигоди на картку курсу',
  skills: 'навички курсу',
  'module-title': 'назву модуля',
  'module-summary': 'опис модуля',
  'module-final': 'підсумкове завдання модуля',
  'lesson-title': 'назву уроку',
  'lesson-goal': 'мету уроку',
  'lesson-description': 'опис уроку',
  'lesson-assignment': 'завдання уроку',
};

/** Форма, у якій ШІ повертає пропозицію для кожної прогалини. */
export type GapSuggestion =
  | { form: 'text'; text: string }
  | { form: 'list'; items: string[] }
  | { form: 'skills'; skills: Array<{ name: string; level: 'base' | 'confident' | 'pro'; whyItMatters: string }> }
  | { form: 'assignment'; title: string; brief: string; steps: string[]; deliverable: string; acceptanceCriteria: string[] };

/** Якої форми чекати від прогалини: і промпт, і розбір, і вікно правки дивляться сюди. */
export function gapForm(kind: CourseGapKind): GapSuggestion['form'] {
  if (kind === 'audience' || kind === 'outcomes' || kind === 'highlights') return 'list';
  if (kind === 'skills') return 'skills';
  if (kind === 'module-final' || kind === 'lesson-assignment') return 'assignment';
  return 'text';
}

/** Скільки пунктів має бути в переліку (менше — пункт готовності не закриється). */
export const LIST_MIN: Partial<Record<CourseGapKind, number>> = { highlights: 3, audience: 1, outcomes: 2 };

interface GapCourseShape {
  modules: Array<{ id: string; lessons: Array<{ id: string }> }>;
}

/**
 * Текст пункту готовності → прогалина. `null` — ШІ тут не допоможе.
 *
 * Тексти беруться з двох місць: `courseSubmitProblems` (спільні правила подання)
 * і `collectReadiness` у редакторі. Номери модулів і уроків у них людські
 * («Модуль 2», «Урок 2.3»), тож id дістаємо з самого курсу — інакше кнопка
 * мовчки доповнювала б не той урок.
 */
export function gapForProblem(text: string, course: GapCourseShape): CourseGap | null {
  const line = String(text || '').trim();
  if (!line) return null;

  if (line.startsWith('Немає підзаголовка')) return { kind: 'subtitle' };
  if (line.startsWith('Не описана аудиторія')) return { kind: 'audience' };
  if (line.startsWith('Немає результатів навчання')) return { kind: 'outcomes' };
  if (line.startsWith('Менше трьох вигод')) return { kind: 'highlights' };
  if (line.startsWith('Немає навичок курсу')) return { kind: 'skills' };

  const lesson = /^Урок (\d+)\.(\d+): (.+)$/.exec(line);
  if (lesson) {
    const module = course.modules[Number(lesson[1]) - 1];
    const target = module?.lessons[Number(lesson[2]) - 1];
    if (!module || !target) return null;
    const rest = lesson[3];
    const kind: CourseGapKind | null = rest.startsWith('без назви')
      ? 'lesson-title'
      : rest.startsWith('без мети')
        ? 'lesson-goal'
        : rest.startsWith('без опису')
          ? 'lesson-description'
          : rest.startsWith('немає завдання')
            ? 'lesson-assignment'
            : null;
    return kind ? { kind, moduleId: module.id, lessonId: target.id } : null;
  }

  const moduleLine = /^Модуль (\d+): (.+)$/.exec(line);
  if (moduleLine) {
    const module = course.modules[Number(moduleLine[1]) - 1];
    if (!module) return null;
    const rest = moduleLine[2];
    // «немає фото» і «жодного уроку» свідомо лишаються без кнопки: перше — файл автора,
    // друге — рішення про структуру курсу, а не текст, який можна запропонувати.
    const kind: CourseGapKind | null = rest.startsWith('без назви')
      ? 'module-title'
      : rest.startsWith('без опису')
        ? 'module-summary'
        : rest.startsWith('немає підсумкового завдання')
          ? 'module-final'
          : null;
    return kind ? { kind, moduleId: module.id } : null;
  }

  return null;
}

/**
 * Фото — окремо від прогалин ШІ (прохання власника 13.11.2026).
 *
 * «Модуль 1: немає фото» ШІ не закриє: потрібен файл автора. Але й лишати цей
 * рядок зовсім без дії незручно — автор читає його в «Готовності», а йти по
 * фото мусить у форму модуля. Тому тут свій розбір: той самий рядок → куди
 * покласти знімок, а поруч із ним у редакторі стоїть «Додати фото» з вибором
 * «з медіатеки» або «завантажити нове».
 */
export type CoursePhotoTarget =
  | { kind: 'course-cover' }
  | { kind: 'module-cover'; moduleId: string };

export function photoTargetForProblem(text: string, course: GapCourseShape): CoursePhotoTarget | null {
  const line = String(text || '').trim();
  if (!line) return null;
  if (line.startsWith('Немає обкладинки') || line.startsWith('Обкладинка має бути посиланням')) {
    return { kind: 'course-cover' };
  }
  const m = /^Модуль (\d+): немає фото/.exec(line);
  if (!m) return null;
  const module = course.modules[Number(m[1]) - 1];
  return module ? { kind: 'module-cover', moduleId: module.id } : null;
}

/** Підпис місця — у заголовку вікна, щоб було видно, куди саме ляже знімок. */
export const PHOTO_TARGET_LABELS: Record<CoursePhotoTarget['kind'], string> = {
  'course-cover': 'обкладинка курсу',
  'module-cover': 'фото модуля',
};

/** Чи описує об'єкт справжню прогалину цього курсу (перевіряє й сервер, не лише редактор). */
export function isValidGap(gap: unknown, course: GapCourseShape): gap is CourseGap {
  const g = gap as CourseGap;
  if (!g || typeof g !== 'object' || !GAP_LABELS[g.kind]) return false;
  const needsModule = g.kind.startsWith('module-') || g.kind.startsWith('lesson-');
  const needsLesson = g.kind.startsWith('lesson-');
  if (!needsModule) return g.moduleId === undefined && g.lessonId === undefined;
  const module = course.modules.find((m) => m.id === g.moduleId);
  if (!module) return false;
  if (!needsLesson) return g.lessonId === undefined;
  return !!module.lessons.find((l) => l.id === g.lessonId);
}
