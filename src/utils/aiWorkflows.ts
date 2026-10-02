/**
 * Маршрутизатор процесів ШІ за роллю (Т6.4 В2, `PLAN_ROLE_STUDIO.md`; ТЗ Role
 * Onboarding §21–22). Чистий модуль — спільний для сервера (інструкція моделі
 * в кожному модулі ШІ) і Студії («Мій простір», підказки в модулях).
 *
 *   роль (простір) + тип проєкту + завдання + область доступу → процес ШІ
 *
 * Маршрут лише НАЛАШТОВУЄ модель (інструкція процесу, фокус, межі контексту)
 * і ніколи не розширює права: що людина бачить і може змінювати, вирішує
 * наданий доступ (Т6.2) на сервері. «Поза процесом» — не заборона (роль ≠
 * дозвіл), лише позначка й загальна інструкція.
 *
 * Шар рішень Jev (§22) — правила, не модель: підказує фокус простору (для
 * дизайнера книги із замовленням — обкладинка, верстка, ілюстрація,
 * маркетинговий дизайн). Записів доступу не створює.
 */

export type LocalizedText = { en: string; uk: string };

export const AI_TASKS = [
  'writing',
  'editing',
  'analysis',
  'character',
  'character_visual',
  'illustration',
  'cover',
  'layout',
  'media',
  'translation',
  'publishing',
  'course',
  'coaching',
  'technical',
  'chat',
  'general',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_TASK_NAMES: Record<AiTask, LocalizedText> = {
  writing: { en: 'Writing', uk: 'Письмо' },
  editing: { en: 'Editing', uk: 'Редагування' },
  analysis: { en: 'Text analysis', uk: 'Аналіз тексту' },
  character: { en: 'Characters', uk: 'Персонажі' },
  character_visual: { en: 'Character visuals', uk: 'Образ персонажа' },
  illustration: { en: 'Illustration', uk: 'Ілюстрація' },
  cover: { en: 'Cover', uk: 'Обкладинка' },
  layout: { en: 'Layout', uk: 'Верстка' },
  media: { en: 'Media', uk: 'Медіа' },
  translation: { en: 'Translation', uk: 'Переклад' },
  publishing: { en: 'Publishing', uk: 'Публікація' },
  course: { en: 'Course', uk: 'Курс' },
  coaching: { en: 'Writer training', uk: 'Тренування автора' },
  technical: { en: 'Technical', uk: 'Технічне' },
  chat: { en: 'Assistant', uk: 'Асистент' },
  general: { en: 'General', uk: 'Загальне' },
};

export interface AiSuggestion {
  id: string;
  label: LocalizedText;
  /** Розділ Студії, де ця дія живе (NavigationTab). */
  tab: string;
  task: AiTask;
}

export interface AiWorkflowDef {
  id: string;
  name: LocalizedText;
  /** Простори реєстру ролей, які ведуть у цей процес. */
  workspaces: string[];
  primary: AiTask[];
  secondary: AiTask[];
  /** Інструкція моделі для процесу (додається до системного промту модуля). */
  instruction: string;
  /** Уточнення під конкретне завдання процесу. */
  taskHints: Partial<Record<AiTask, string>>;
  suggestions: AiSuggestion[];
}

const s = (id: string, en: string, uk: string, tab: string, task: AiTask): AiSuggestion => ({ id, label: { en, uk }, tab, task });

export const AI_WORKFLOWS: AiWorkflowDef[] = [
  {
    id: 'writer',
    name: { en: 'Writer workflow', uk: 'Письменницький процес' },
    workspaces: ['author'],
    primary: ['writing', 'analysis', 'character', 'course', 'coaching', 'chat'],
    secondary: ['editing', 'translation', 'character_visual'],
    instruction:
      'Ти допомагаєш АВТОРУ твору. Пропонуй варіанти й пояснюй вибір, але не нав\'язуй свій стиль: голос, задум і рішення — за автором. Тримайся канону книги (персонажі, факти, хронологія) і позначай, де пропозиція його змінює.',
    taskHints: {
      writing: 'Пиши в стилі й темпі автора; не додавай подій і героїв, яких немає в задумі, без явного прохання.',
      analysis: 'Аналізуй структуру, ритм і логіку сцени з посиланням на конкретні місця тексту.',
      character: 'Узгоджуй риси й поведінку героїв із тим, що вже є в книзі.',
    },
    suggestions: [
      s('continue_scene', 'Continue the scene', 'Продовжити сцену', 'editor', 'writing'),
      s('scene_doctor', 'Scene analysis', 'Аналіз сцени', 'scenario', 'analysis'),
      s('character_bio', 'Develop a character', 'Розвинути персонажа', 'characters', 'character'),
      s('story_graph', 'Check the story graph', 'Перевірити граф історії', 'core-story-graph', 'analysis'),
    ],
  },
  {
    id: 'editorial',
    name: { en: 'Editorial workflow', uk: 'Редакторський процес' },
    workspaces: ['editor'],
    primary: ['editing', 'analysis', 'chat'],
    secondary: ['writing', 'translation', 'character'],
    instruction:
      'Ти допомагаєш РЕДАКТОРУ. Пропонуй правки як пропозиції з поясненням (було → стало → чому), зберігай авторський голос, не переписуй текст цілком. Відрізняй помилки (граматика, факти, логіка) від смакових порад.',
    taskHints: {
      editing: 'Мінімальні точкові правки; кожну — з короткою причиною.',
      analysis: 'Шукай суперечності, повтори, провисання темпу; посилайся на місця тексту.',
    },
    suggestions: [
      s('grammar', 'Grammar and style check', 'Перевірка граматики й стилю', 'ai-studio', 'editing'),
      s('continuity', 'Continuity check', 'Перевірка безперервності', 'core-continuity', 'analysis'),
      s('changes', 'Review changes', 'Переглянути зміни', 'changelog', 'editing'),
    ],
  },
  {
    id: 'review',
    name: { en: 'Reviewer workflow', uk: 'Рецензентський процес' },
    workspaces: ['reviewer'],
    primary: ['analysis', 'chat'],
    secondary: ['editing'],
    instruction:
      'Ти допомагаєш РЕЦЕНЗЕНТУ чи бета-рідеру. Формулюй враження й зауваження для автора (що працює, що ні, де втрачається інтерес), не переписуй текст і не пропонуй готових фрагментів замість авторських.',
    taskHints: { analysis: 'Відгук читача: емоції, зрозумілість, темп — з прикладами з тексту.' },
    suggestions: [
      s('reader_response', 'Reader response', 'Відгук читача', 'editor', 'analysis'),
      s('preview', 'Read the spread', 'Читати розворот', 'preview', 'analysis'),
    ],
  },
  {
    id: 'illustration',
    name: { en: 'Illustration workflow', uk: 'Процес ілюстратора' },
    workspaces: ['illustrator'],
    primary: ['illustration', 'character_visual', 'media', 'chat'],
    secondary: ['cover', 'character', 'analysis'],
    instruction:
      'Ти допомагаєш ІЛЮСТРАТОРУ. Думай візуально: композиція, світло, ракурс, настрій, деталі зовнішності й місця з тексту та референсів. Тримайся візуальної біблії й уже затверджених образів героїв; не вигадуй деталей сюжету, яких немає в наданому фрагменті.',
    taskHints: {
      illustration: 'Опиши сцену як бриф для ілюстрації: що в кадрі, хто, де, коли, настрій, палітра.',
      character_visual: 'Зовнішність героя — лише з тексту й референсів; позначай припущення.',
    },
    suggestions: [
      s('scene_brief', 'Scene illustration brief', 'Бриф ілюстрації сцени', 'illustrations', 'illustration'),
      s('character_refs', 'Character references', 'Референси персонажів', 'characters', 'character_visual'),
      s('visual_library', 'Visual library', 'Візуальна бібліотека', 'core-visual', 'illustration'),
      s('media', 'Generate in the media library', 'Згенерувати в медіатеці', 'media', 'media'),
    ],
  },
  {
    id: 'design',
    name: { en: 'Design workflow', uk: 'Дизайнерський процес' },
    workspaces: ['designer'],
    primary: ['cover', 'layout', 'illustration', 'media', 'chat'],
    secondary: ['character_visual', 'publishing'],
    instruction:
      'Ти допомагаєш ДИЗАЙНЕРУ книги. Думай про читабельність, типографіку, сітку, ієрархію, поліграфічні вимоги (поля, виліт, корінець) і вітрину. Пропонуй варіанти з поясненням, тримайся жанру й візуальної біблії.',
    taskHints: {
      cover: 'Обкладинка: жанрові очікування, читабельність назви в мініатюрі, фокус композиції.',
      layout: 'Верстка: шрифти, інтерліньяж, поля, висячі рядки, вимоги друку й KDP.',
    },
    suggestions: [
      s('cover_concept', 'Cover concept', 'Концепція обкладинки', 'cover', 'cover'),
      s('layout_advice', 'Layout suggestions', 'Поради з верстки', 'layout', 'layout'),
      s('pdf_layout', 'PDF layout', 'PDF-верстка', 'pdf-editor', 'layout'),
      s('media', 'Media library', 'Медіатека', 'media', 'media'),
    ],
  },
  {
    id: 'translation',
    name: { en: 'Translation workflow', uk: 'Перекладацький процес' },
    workspaces: ['translator'],
    primary: ['translation', 'editing', 'chat'],
    secondary: ['analysis', 'writing'],
    instruction:
      'Ти допомагаєш ПЕРЕКЛАДАЧУ. Зберігай зміст, тон і голоси героїв; імена, назви й терміни — послідовно (за глосарієм книги, якщо він є). Пояснюй неочевидні вибори й культурні адаптації.',
    taskHints: { translation: 'Переклад близький до оригіналу за змістом, природний мовою перекладу; позначай місця з кількома варіантами.' },
    suggestions: [
      s('translate', 'Contextual translation', 'Контекстний переклад', 'core-translation', 'translation'),
      s('editor', 'Bilingual editor', 'Двомовний редактор', 'editor', 'translation'),
    ],
  },
  {
    id: 'publishing',
    name: { en: 'Publishing workflow', uk: 'Процес публікації' },
    workspaces: ['manager'],
    primary: ['publishing', 'layout', 'analysis', 'chat'],
    secondary: ['cover', 'media', 'course'],
    instruction:
      'Ти допомагаєш МЕНЕДЖЕРУ книги. Фокус — публікація й продаж: метадані, опис товару, ключові слова, категорії, перевірка готовності до друку й вітрини. Не змінюй текст твору — лише пропонуй супровідні матеріали.',
    taskHints: { publishing: 'Конкретні поля для картки товару й чекліст публікації.' },
    suggestions: [
      s('listing', 'Product listing', 'Картка товару', 'publishing', 'publishing'),
      s('kdp', 'KDP format check', 'Перевірка формату KDP', 'kdp-format', 'layout'),
      s('export', 'Export', 'Експорт', 'export', 'publishing'),
      s('status', 'Project status', 'Стан проєкту', 'dashboard', 'analysis'),
    ],
  },
  {
    id: 'technical',
    name: { en: 'Technical workflow', uk: 'Технічний процес' },
    workspaces: ['developer'],
    primary: ['technical', 'analysis', 'chat'],
    secondary: ['media', 'publishing'],
    instruction:
      'Ти допомагаєш РОЗРОБНИКУ проєкту. Фокус — технічні завдання: інтеграції, формати файлів, автоматизація, інтерактивний контент. Відповідай точно й структуровано; текст твору не змінюй.',
    taskHints: {},
    suggestions: [
      s('collab', 'Collaboration and access', 'Співпраця й доступ', 'core-collaboration', 'technical'),
      s('search', 'Smart search', 'Розумний пошук', 'core-search', 'analysis'),
      s('export', 'Export formats', 'Формати експорту', 'export', 'technical'),
    ],
  },
];

export const workflowById = (id: string | null | undefined): AiWorkflowDef | undefined => AI_WORKFLOWS.find((w) => w.id === id);
export const workflowForWorkspace = (workspace: string | null | undefined): AiWorkflowDef | undefined =>
  workspace ? AI_WORKFLOWS.find((w) => w.workspaces.includes(workspace)) : undefined;

/**
 * Точка ШІ → завдання. Ключ — шлях без `/api/ai/` для `/api/ai/*`, інакше
 * повний шлях. Невідома точка — `general` (процес той самий, без уточнення).
 */
export const AI_ENDPOINT_TASKS: Record<string, AiTask> = {
  'edit-text': 'editing',
  'check-grammar': 'editing',
  'analyze-scene': 'analysis',
  translate: 'translation',
  'generate-character-art': 'character_visual',
  'craft-character-prompt': 'character_visual',
  'generate-character': 'character',
  'elaborate-instruction-steps': 'writing',
  'generate-behavior-patterns': 'character',
  'generate-skandhas': 'character',
  'generate-skandha-cycle': 'character',
  'craft-illustration-prompt': 'illustration',
  'generate-illustration-art': 'illustration',
  'generate-book-text-from-image': 'writing',
  'describe-character-from-image': 'character_visual',
  'design-layout': 'layout',
  'character-consistency': 'character',
  'behavior-drift': 'character',
  'reader-response': 'analysis',
  'character-codex': 'character',
  'emotion-analyze': 'coaching',
  'threshold-analyze': 'coaching',
  'generate-manuscript-paragraphs-from-image': 'writing',
  'generate-paragraphs-from-selection': 'writing',
  'coach-analyze': 'coaching',
  'coach-chat': 'coaching',
  'coach-book-audit': 'analysis',
  'format-manuscript': 'layout',
  'generate-prompt': 'writing',
  'generate-cover': 'cover',
  'generate-cover-art': 'cover',
  'generate-media-art': 'media',
  'generate-video': 'media',
  'analyze-text-competences': 'coaching',
  'analyze-opening-strength': 'analysis',
  'evaluate-skill-task': 'coaching',
  'coach-feedback': 'coaching',
  'generate-exercise': 'coaching',
  'generate-blueprint': 'writing',
  'analyze-emotional-arc': 'analysis',
  'notes-import/process': 'writing',
  'knowledge-quote': 'writing',
  'evaluate-trainer': 'coaching',
  'structure-suggest-title': 'writing',
  'assistant-chat': 'chat',
  'diagnostic-assessment': 'coaching',
  '/api/style/generate': 'analysis',
  '/api/style/sync-mastery': 'coaching',
  '/api/v1/diagn': 'coaching',
  '/api/courses/wizard/stage': 'course',
  '/api/narration/synthesize': 'media',
  '/api/express/seed': 'writing',
  '/api/express/suggest': 'writing',
  '/api/express/generate': 'writing',
};

/** Префікси шляхів, на яких працює маршрутизатор (проміжний шар сервера). */
export const AI_ROUTED_PREFIXES = ['/api/ai/', '/api/style/', '/api/v1/diagn', '/api/courses/wizard/', '/api/narration/synthesize', '/api/express/'];

export function taskForEndpoint(path: string): AiTask {
  const clean = path.split('?')[0].replace(/\/+$/, '');
  if (clean.startsWith('/api/ai/')) {
    const rest = clean.slice('/api/ai/'.length);
    if (AI_ENDPOINT_TASKS[rest]) return AI_ENDPOINT_TASKS[rest];
    // `generate-media-art/status/<id>` тощо — за першим сегментом.
    const first = rest.split('/')[0];
    return AI_ENDPOINT_TASKS[first] ?? 'general';
  }
  return AI_ENDPOINT_TASKS[clean] ?? 'general';
}

export type AiFit = 'primary' | 'secondary' | 'outside';
export type AiScope = 'project' | 'partial';

export interface AiRouteInput {
  /** Простори ролей людини в проєкті (у порядку ролей). */
  workspaces: string[];
  /** Обраний простір («Мій простір»), якщо є. */
  activeWorkspace?: string | null;
  projectType?: string | null;
  task: AiTask;
  /** `partial` — доступ лише до частини проєкту (сцени, розділи, герої, медіатека). */
  scope: AiScope;
  /** Допомога ШІ з опитувальника (§11) — id пунктів. */
  aiAssistance?: string[];
  /** Параметри ролі (§8): група → пункти. */
  roleDetails?: Record<string, string[]>;
  orderId?: string | null;
  isOwner?: boolean;
}

export interface JevFocus {
  id: string;
  label: LocalizedText;
  tab: string;
}

export interface AiRoute {
  workflow: string;
  workflowName: LocalizedText;
  workspace: string;
  task: AiTask;
  fit: AiFit;
  scope: AiScope;
  /** Чому саме цей процес (для показу й журналу). */
  reason: string;
  /** Текст, який сервер дописує до системного промту модуля. */
  instruction: string;
  suggestions: AiSuggestion[];
  /** Фокус простору за правилами Jev (§22); лише підказка. */
  focus: JevFocus[];
}

const ASSIST_LINES: Record<string, string> = {
  story_analysis: 'аналіз історії',
  character_analysis: 'аналіз персонажів',
  continuity_check: 'перевірку безперервності',
  editing_suggestions: 'пропозиції редагування',
  idea_generation: 'генерацію ідей',
  scene_context: 'контекст сцени',
  character_references: 'референси персонажів',
  visual_bible: 'візуальну біблію',
  prompt_assistance: 'допомогу з промптами',
  book_metadata: 'метадані книги',
  product_description: 'опис товару',
  marketing_copy: 'маркетинговий текст',
  publication_checklist: 'чекліст публікації',
};

const f = (id: string, en: string, uk: string, tab: string): JevFocus => ({ id, label: { en, uk }, tab });
const DESIGN_FOCUS: Record<string, JevFocus> = {
  cover: f('cover_design', 'Cover design', 'Дизайн обкладинки', 'cover'),
  book_layout: f('book_layout', 'Book layout', 'Верстка книги', 'layout'),
  illustration: f('illustration', 'Illustration', 'Ілюстрація', 'illustrations'),
  promotional_materials: f('marketing_design', 'Marketing design', 'Маркетинговий дизайн', 'media'),
};
const ILLUSTRATION_FOCUS: Record<string, JevFocus> = {
  scene_illustrations: f('scene_illustration', 'Scene illustrations', 'Ілюстрації сцен', 'illustrations'),
  character_illustrations: f('character_design', 'Character design', 'Образи персонажів', 'characters'),
  cover_art: f('cover_art', 'Cover art', 'Зображення для обкладинки', 'cover'),
  maps: f('maps', 'Maps', 'Карти', 'media'),
  diagrams: f('diagrams', 'Diagrams', 'Схеми', 'media'),
};

/**
 * Jev Rule Router (§22): фокус простору. Обрані параметри ролі — першими;
 * для дизайнера книги із замовленням — повний набір §22 (обкладинка,
 * верстка, ілюстрація, маркетинговий дизайн).
 */
export function jevFocus(input: Pick<AiRouteInput, 'projectType' | 'orderId' | 'roleDetails'> & { workspace: string }): JevFocus[] {
  const picked = (group: string, table: Record<string, JevFocus>) => (input.roleDetails?.[group] ?? []).map((x) => table[x]).filter((x): x is JevFocus => !!x);
  const merge = (first: JevFocus[], rest: JevFocus[]) => [...first, ...rest.filter((r) => !first.some((x) => x.id === r.id))];
  if (input.workspace === 'designer') {
    const chosen = picked('designer', DESIGN_FOCUS);
    if (input.projectType === 'book' && input.orderId) return merge(chosen, Object.values(DESIGN_FOCUS));
    return chosen.length ? chosen : input.projectType === 'book' ? [DESIGN_FOCUS.cover, DESIGN_FOCUS.book_layout] : [];
  }
  if (input.workspace === 'illustrator') {
    const chosen = picked('illustrator', ILLUSTRATION_FOCUS);
    return chosen.length ? chosen : [ILLUSTRATION_FOCUS.scene_illustrations, ILLUSTRATION_FOCUS.character_illustrations];
  }
  return [];
}

const SCOPE_LINE =
  'Людина має доступ лише до частини проєкту: працюй тільки з наданим у запиті фрагментом, не вигадуй і не відтворюй інших частин книги чи курсу, а якщо для відповіді бракує контексту — так і скажи.';

/**
 * Маршрут: процес для завдання. Серед просторів людини (обраний — першим)
 * перемагає той, де завдання основне; інакше — суміжне; інакше — обраний
 * простір із позначкою «поза процесом». Без жодного простору — null (ШІ
 * працює як раніше).
 */
export function routeAiWorkflow(input: AiRouteInput): AiRoute | null {
  const ordered = [...new Set([...(input.activeWorkspace ? [input.activeWorkspace] : []), ...input.workspaces])].filter((w) => workflowForWorkspace(w));
  if (!ordered.length) return null;
  let pick: { ws: string; wf: AiWorkflowDef; fit: AiFit } | null = null;
  for (const fit of ['primary', 'secondary'] as const) {
    for (const ws of ordered) {
      const wf = workflowForWorkspace(ws)!;
      if ((fit === 'primary' ? wf.primary : wf.secondary).includes(input.task)) {
        pick = { ws, wf, fit };
        break;
      }
    }
    if (pick) break;
  }
  if (!pick) pick = { ws: ordered[0], wf: workflowForWorkspace(ordered[0])!, fit: input.task === 'general' ? 'secondary' : 'outside' };
  const { ws, wf, fit } = pick;
  const lines = [`[Процес ШІ Nova: ${wf.name.uk}]`];
  if (fit === 'outside') lines.push(`Завдання «${AI_TASK_NAMES[input.task].uk}» поза основним процесом людини — допомагай загально, без спеціальних припущень.`);
  else lines.push(wf.instruction);
  const hint = fit !== 'outside' ? wf.taskHints[input.task] : undefined;
  if (hint) lines.push(hint);
  if (input.scope === 'partial') lines.push(SCOPE_LINE);
  const assist = (input.aiAssistance ?? []).map((x) => ASSIST_LINES[x]).filter(Boolean);
  if (assist.length && fit !== 'outside') lines.push(`Людина просила допомагати їй насамперед через: ${assist.join(', ')}.`);
  if (input.projectType === 'course') lines.push('Проєкт — навчальний курс: зважай на учнів, мету уроків і зрозумілість пояснень.');
  const reason =
    fit === 'primary'
      ? `${AI_TASK_NAMES[input.task].uk} — основне завдання процесу «${wf.name.uk}»`
      : fit === 'secondary'
        ? `${AI_TASK_NAMES[input.task].uk} — суміжне завдання процесу «${wf.name.uk}»`
        : `${AI_TASK_NAMES[input.task].uk} — поза процесом «${wf.name.uk}» (не заборона)`;
  return {
    workflow: wf.id,
    workflowName: wf.name,
    workspace: ws,
    task: input.task,
    fit,
    scope: input.scope,
    reason,
    instruction: lines.join('\n'),
    suggestions: wf.suggestions,
    focus: jevFocus({ workspace: ws, projectType: input.projectType, orderId: input.orderId, roleDetails: input.roleDetails }),
  };
}

/** Дописати інструкцію процесу до системного промту модуля (порожній маршрут — без змін). */
export function withWorkflowInstruction(system: string | undefined, route: Pick<AiRoute, 'instruction'> | null | undefined): string | undefined {
  if (!route?.instruction) return system;
  return system && system.trim() ? `${system}\n\n${route.instruction}` : route.instruction;
}
