/**
 * Промпти майстра «Навчальний курс»
 * (docs/tech-spec-course-wizard-2026.md, §5).
 *
 * Шість кроків, один ендпоінт. На кожному кроці модель пропонує чернетку
 * блоку курсу, автор править її в інтерфейсі. Відповідь моделі — чистий
 * JSON без markdown-огорожі; огорожу зриває маршрут (як в expressRoutes).
 */

export const COURSE_STAGES = ['theme', 'outcomes', 'skills', 'modules', 'lessons', 'practice'] as const;
export type CourseWizardStage = (typeof COURSE_STAGES)[number];

const SYSTEM = [
  'Ти — методист освітньої платформи FUSION LAB STUDIO.',
  'Створюєш програми ремісничих курсів для дорослих, які хочуть навчитися робити речі руками.',
  'Відповідай ТІЛЬКИ валідним JSON без markdown-огорожі та коментарів.',
  'Мова відповіді — українська. Пиши конкретно й коротко, без води.',
].join(' ');

interface CourseLite {
  title?: string;
  subtitle?: string;
  summary?: string;
  skills?: { name: string }[];
  modules?: { title: string; summary?: string; lessons?: { title: string }[] }[];
}

export function courseStagePrompt(
  stage: CourseWizardStage,
  course: CourseLite,
  context: Record<string, string>
): { system: string; prompt: string } {
  const title = course.title || 'новий курс';
  const subtitle = course.subtitle || '';

  switch (stage) {
    case 'theme': {
      const craft = context.craft?.trim() || 'обране ремесло';
      const audience = context.audience?.trim() || 'дорослі учні';
      const level = context.level?.trim() || 'початківці';
      return {
        system: SYSTEM,
        prompt: [
          `Створи назву, підзаголовок і портрети аудиторії для курсу.`,
          `Ремесло: ${craft}. Для кого: ${audience}. Рівень входу: ${level}.`,
          `Дай JSON: {"title":"назва курсу","subtitle":"один рядок про результат","audience":["2-4 портрети аудиторії"]}.`,
        ].join('\n'),
      };
    }
    case 'outcomes': {
      return {
        system: SYSTEM,
        prompt: [
          `Курс «${title}»${subtitle ? ` — ${subtitle}` : ''}.`,
          `Сформулюй 4-6 результатів навчання (що людина ВМІТИМЕ наприкінці, дієслова дії)`,
          `і рівно три короткі вигоди для картки курсу.`,
          `Дай JSON: {"outcomes":["..."],"highlights":["...","...","..."]}.`,
        ].join('\n'),
      };
    }
    case 'skills': {
      const skills = (course.skills ?? []).map((s) => s.name).join('; ') || 'поки що жодної';
      return {
        system: SYSTEM,
        prompt: [
          `Курс «${title}»${subtitle ? ` — ${subtitle}` : ''}.`,
          `Наявні навички: ${skills}. Запропонуй 4-6 ПРЕДМЕТНИХ навичок цього ремесла (не дублюй наявні).`,
          `Для кожної: name, level ("base" | "confident" | "pro"), whyItMatters (одне речення, навіщо в ремеслі),`,
          `howToDevelop (2-3 конкретні кроки), practiceIdeas (2-3 вправи поза курсом).`,
          `Дай JSON: {"skills":[{"name":"...","level":"base","whyItMatters":"...","howToDevelop":["..."],"practiceIdeas":["..."]}]}.`,
        ].join('\n'),
      };
    }
    case 'modules': {
      const skills = (course.skills ?? []).map((s, i) => `${i}. ${s.name}`).join('; ') || '—';
      return {
        system: SYSTEM,
        prompt: [
          `Курс «${title}»${subtitle ? ` — ${subtitle}` : ''}.`,
          `Навички курсу: ${skills}.`,
          `Запропонуй 4-6 модулів навчального шляху: title, summary (1-2 речення про зміст),`,
          `skillIndexes — номери навичок зі списку, які розвиває модуль (може бути порожнім).`,
          `Дай JSON: {"modules":[{"title":"...","summary":"...","skillIndexes":[0,2]}]}.`,
        ].join('\n'),
      };
    }
    case 'lessons': {
      const modules = (course.modules ?? [])
        .map((m, i) => `${i}. ${m.title}${m.summary ? ` — ${m.summary}` : ''}`)
        .join('\n');
      return {
        system: SYSTEM,
        prompt: [
          `Курс «${title}». Модулі (порядок важливий):\n${modules || '—'}.`,
          `Для КОЖНОГО модуля у тому самому порядку запропонуй 3-6 уроків:`,
          `title, goal (мета одним реченням), description (2-3 речення), topics (3-5 пунктів змісту).`,
          `Дай JSON: {"modules":[{"title":"назва модуля як вище","lessons":[{"title":"...","goal":"...","description":"...","topics":["..."]}]}]}.`,
        ].join('\n'),
      };
    }
    case 'practice': {
      const lessons = (course.modules ?? [])
        .map((m, mi) => (m.lessons ?? []).map((l, li) => `${mi}.${li} — ${l.title}`).join('\n'))
        .join('\n');
      return {
        system: SYSTEM,
        prompt: [
          `Курс «${title}». Уроки (номери moduleIndex.lessonIndex):\n${lessons || '—'}.`,
          `Для КОЖНОГО уроку запропонуй практичне завдання:`,
          `title, brief (що зробити), steps (3-5 покрокових пунктів), deliverable (що студент здає: файл/фото/текст),`,
          `acceptanceCriteria (3-4 критерії «зроблено правильно»).`,
          `І для КОЖНОГО модуля — підсумкове завдання того самого формату.`,
          `Дай JSON: {"assignments":[{"moduleIndex":0,"lessonIndex":0,"assignment":{"title":"...","brief":"...","steps":["..."],"deliverable":"...","acceptanceCriteria":["..."]}}],`,
          `"finalAssignments":[{"moduleIndex":0,"assignment":{...}}]}.`,
        ].join('\n'),
      };
    }
  }
}
