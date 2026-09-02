export type NavigationTab =
  | 'express'      // Експрес-майстер: книга за 5 хвилин (Wisart Book Crealiry.md §3.4)
  | 'dashboard'    // Фаза 1: головний інформаційний хаб (профіль, стиль, прогрес, швидкий доступ)
  | 'start'        // Стартова сторінка & налаштування задуму книги
  | 'editor'       // Текстовий редактор & дерево книги
  | 'mastery'      // Майстерність письменника & Система розвитку навичок
  | 'scenario'     // Сценарний модуль, синопсис, сцени, емоційна дуга
  | 'characters'   // База персонажів & взаємодії
  | 'mindboard'    // Mind Board: задум книги в центрі, герої навколо, стікери ідей
  | 'toc'          // Автоматичне формування Змісту книги (TOC)
  | 'qr-footnotes' // Сноски, примітки & QR-теги в тексті
  | 'ai-studio'    // AI Редактор, дифи, спелчекер & стилістика
  | 'illustrations'// Генератор ілюстрацій & Visual Bible
  | 'layout'       // Верстка, параметри друку & полів
  | 'preview'      // Розворот книги & читацький режим
  | 'cover'        // Створення обкладинок
  | 'media'        // Медіатека книги
  | 'changelog'    // Лог-файл прогресу та аудит змін
  | 'export'       // Експорт PDF / DOCX / EPUB
  | 'admin'        // Панель адміністратора: користувачі, права, витрати на API
  | 'subscription' // Тарифи, оформлення підписки та оплата (PrivatBank / PayPal)
  | 'api-keys'     // Ключі API провайдерів ШІ для всієї платформи (вводить лише адміністратор)
  | 'kdp-format'   // Форматування готового файлу під Amazon KDP (Claude, Pro/Ultra)
  | 'courses'      // Перетворення книги на курс/мінікурс: теги, матеріали, експорт
  | 'narration'    // Озвучення книги й курсу (ElevenLabs): розділи та виділені фрагменти, Pro/Ultra
  | 'pdf-editor'   // WYSIWYG-верстка PDF перед публікацією: рамки тексту, обтікання графіки
  | 'knowledge'    // Фаза 2: База знань — референси, цитати, перетягування в текст
  | 'trainers'     // Фаза 2: Пілотні тренажери (Персонаж, Діалог) з AI-оцінкою
  | 'diagn'        // Модуль /diagn: AI-діагностика стилю, структури та компетенцій автора
  | 'structure'    // Фаза 3, 3.1: Конструктор структури книги (шаблони + AI-заголовки)
  | 'portfolio'    // Фаза 3, 3.3: Приватне портфоліо автора (лише для самого автора)
  | 'publishing'   // Модуль публікації та експорту: Amazon KDP (файли + метадані) та Etsy (лістинг через Open API v3)
  | 'market';      // King Market Intelligence: аналітика ринку Etsy (AI-скринінг, Opportunity Score) — Pro/Ultra

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  bookId?: string;
  bookVersion?: string;
  role?: UserRole;
  user?: string;
  author?: string;
  tab?: string;
  action: string;
  details: string;
  changedEntity?: string;
  category?: 'character' | 'text' | 'structure' | 'ai' | 'export' | 'system' | 'layout' | 'version';
}

export interface CharacterRelationship {
  targetCharacterId: string;
  type: 'love' | 'friendship' | 'family' | 'conflict' | 'rivalry' | 'alliance' | 'secret';
  description: string;
}

export interface CharacterInScene {
  characterId: string;
  goal: string;
  emotionalState: string;
  action: string;
  conflict: string;
}

export interface Character {
  id: string;
  bookId: string;
  name: string;
  surname?: string;
  alias?: string;
  role: 'protagonist' | 'antagonist' | 'deuteragonist' | 'mentor' | 'ally' | 'rival' | 'minor';
  age?: number;
  gender?: string;
  profession?: string;
  /**
   * Характерні шаблони поведінки персонажа в діалогах (поведінкові патерни),
   * наприклад: «Він дивиться прямо в очі своєму напарнику та говорить прямо».
   * Заповнюються письменником вручну або за допомогою AI в розділі
   * «Персонажі»; показуються при наведенні на героя в редакторі
   * («Книга і текст») та слугують підказками під час написання діалогів.
   * Кожен елемент масиву — один окремий шаблон.
   */
  behaviorPatterns?: string[];
  /**
   * Структуровані риси темпераменту персонажа за моделлю Big Five, 0–100
   * (50 — нейтрально). Використовуються, щоб AI-генерація бібліотеки
   * патернів поведінки (behaviorPatternLibrary) спиралась не лише на
   * вільний текстовий опис, а на конкретні виміри характеру: наприклад,
   * низька extraversion (інтроверт) → патерни на кшталт «відвела очі».
   */
  bigFive?: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  /**
   * Бібліотека AI-згенерованих патернів поведінки, згрупована за
   * ситуаційним тригером (на відміну від вільного списку behaviorPatterns
   * вище). Кожен тригер — типова сценарна ситуація в діалозі; кожен
   * патерн у ньому — конкретна поведінкова дія, узгоджена з bigFive
   * персонажа. Письменник сам копіює потрібний патерн у текст сцени.
   */
  behaviorPatternLibrary?: {
    trigger: 'question' | 'stress_conflict' | 'lying_hiding' | 'interest_sympathy' | 'calm_conversation';
    patterns: string[];
  }[];
  /**
   * Дата/час/місце народження персонажа — основа для розрахунку його
   * ведичної (сидеричної) натальної карти («задіак джйотіш»), яку можна
   * додатково врахувати при генерації behaviorPatternLibrary вище. Час і
   * місце — опційні: без точного часу неможливо порахувати Лагну
   * (висхідний знак) і будинки, тож карта обмежується знаками Сонця й
   * Місяця. Місце задається вільним текстом (геокодується сервером).
   */
  birthDate?: string;
  /** HH:MM, 24-годинний формат. */
  birthTime?: string;
  birthPlace?: string;
  /**
   * Кешована ведична натальна карта, порахована сервером
   * (server/jyotishChart.ts) з birthDate/birthTime/birthPlace. НЕ
   * редагується вручну — перераховується кнопкою в картці персонажа при
   * зміні дати/часу/місця народження.
   */
  jyotishChart?: {
    lagna?: string;
    moonRashi: string;
    moonNakshatra: string;
    moonPada: number;
    sunRashi: string;
    planets: Record<string, string>;
    rahuRashi: string;
    ketuRashi: string;
    hasExactTime: boolean;
    summary: string;
    computedAt: string;
  };
  /**
   * П'ять скандх (буддійська модель) — якісний опис того, ЯК персонаж
   * обробляє подію: тіло реагує → виникає відчуття → розум інтерпретує →
   * спрацьовує звичний імпульс → персонаж діє. На відміну від bigFive
   * (кількісні риси) це вільнотекстові відповіді на 5 питань, які можна
   * заповнити вручну або згенерувати AI (POST /api/ai/generate-skandhas).
   */
  skandhas?: {
    rupa: string;
    vedana: string;
    sanjna: string;
    sankhara: string;
    vinnana: string;
  };
  appearance: {
    height?: string;
    build?: string;
    hair?: string;
    eyes?: string;
    face?: string;
    clothing?: string;
    distinguishingMarks?: string;
  };
  personality: {
    strengths: string[];
    weaknesses: string[];
    fears: string[];
    desires: string[];
    goals: string[];
    motivation: string;
    internalConflict: string;
  };
  biography: string;
  avatarUrl?: string;
  fullBodyUrl?: string;
  characterSheetUrl?: string;
  relationships: CharacterRelationship[];
  tags: string[];
}

export interface Scene {
  id: string;
  sectionId: string;
  title: string;
  act: number; // 1, 2, 3
  summary: string;
  location: string;
  timeOfDay: string;
  timelineOrder: number;
  intensityScore: number; // 1 to 10 for emotional arc
  conflict: string;
  resolution: string;
  characters: CharacterInScene[];
  aiDramaturgyNotes?: string;
}

export interface Section {
  id: string;
  chapterId: string;
  title: string;
  titleEn?: string;
  order: number;
  content: string; // rich text or markdown
  contentEn?: string; // English translation / edition
  wordCount: number;
  characterCount?: number;
  footnotes?: Footnote[];
  scene?: Scene;
  lastModified: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  titleEn?: string;
  order: number;
  description?: string;
  descriptionEn?: string;
  sections: Section[];
  /**
   * Склад глави: id героїв, які взагалі діють у цій главі — незалежно від
   * того, чи розписані сцени по розділах. Керується на вкладці
   * «Книга & Текст» і показується хмарою на Mind Board.
   *
   * Узгодження зі сценами: додавання героя в сцену автоматично додає його
   * сюди; учасник сцени, відсутній у складі, показується з позначкою
   * розбіжності та кнопкою «підтягнути». Прибирання зі складу глави сцен
   * не чіпає — це навмисно, щоб дія була зворотною.
   */
  cast?: string[];
}

export interface VisualBible {
  id: string;
  bookId: string;
  styleName: string;
  artStyle: string;
  colorPalette: string[];
  lighting: string;
  mood: string;
  referenceNotes: string;
  keyMotifs: string[];
  aspectRatio: string;
}

export interface BookIllustration {
  id: string;
  chapterId?: string;
  sectionId?: string;
  url: string;
  caption: string;
  promptUsed?: string;
  negativePrompt?: string;
  aspectRatio: string;
  style: string;
  modelUsed?: string;
  modelKey?: string;
  selectedTextSnippet?: string;
  source?: 'ai' | 'upload';
  createdAt?: string;
  fileSize?: string;
  /** ШІ-текст сцени, написаний «за мотивами» цього зображення (редагований автором). */
  generatedText?: string;
  /** Яким двигуном написано generatedText: 'gemini' | 'gpt'. */
  generatedTextEngine?: string;
}

export interface ImageItem {
  id: string;
  bookId: string;
  chapterId?: string;
  sectionId?: string;
  characterId?: string;
  type: 'illustration' | 'character_portrait' | 'cover' | 'reference' | 'concept';
  prompt: string;
  style: string;
  imageUrl: string;
  caption?: string;
  createdAt: string;
  status: 'draft' | 'final';
}

export interface AIProposal {
  id: string;
  sectionId: string;
  originalText: string;
  proposedText: string;
  instruction: string;
  category: 'improve' | 'rewrite' | 'shorten' | 'expand' | 'artistic' | 'dialogue' | 'tone' | 'grammar' | 'custom';
  status: 'pending' | 'accepted' | 'rejected';
  diffSegments: {
    type: 'added' | 'removed' | 'unchanged';
    text: string;
  }[];
  createdAt: string;
}

export interface SpellCheckIssue {
  id: string;
  type: 'spelling' | 'grammar' | 'syntax' | 'repetition' | 'style' | 'cliche';
  word: string;
  context: string;
  message: string;
  suggestions: string[];
  offset?: number;
  length?: number;
  severity: 'error' | 'warning' | 'info';
}

export type PageFormatPreset = 'A4' | 'A5' | 'A6' | 'B5' | '5x8' | '5.25x8' | '5.5x8.5' | '6x9' | '6.14x9.21' | '7x10' | 'custom';

export type TOCLeaderStyle = 'dots' | 'dashes' | 'line' | 'waves' | 'blank' | 'double-dots';
export type TOCNumberingStyle = 'arabic' | 'roman' | 'words' | 'none';

export interface TOCConfig {
  leaderStyle: TOCLeaderStyle;
  numberingStyle: TOCNumberingStyle;
  showSectionSubitems: boolean;
  showFrontMatter: boolean;
  title: string;
  customPrefix: string; // e.g. "Глава", "Розділ", "Частина", "Акт", або пусте
  pageNumberPosition: 'right' | 'inline';
}

export interface Footnote {
  id: string;
  marker: string; // e.g. "1", "*", "a"
  number: number;
  text: string;
  term?: string; // The specific word or phrase being annotated
  sectionId?: string;
  chapterId?: string;
}

export interface QRTag {
  id: string;
  code: string; // e.g. "QR-01"
  title: string;
  actionType: 'url' | 'text' | 'audio' | 'secret' | 'social';
  payload: string; // Link or hidden secret text
  description?: string;
  sectionId?: string;
  chapterId?: string;
  svgData?: string;
  createdAt?: string;
}

/**
 * Курс / мінікурс на базі книги («Курси»).
 *
 * Тег ставиться письменником прямо в редакторі книги (виділив уривок
 * тексту → «Додати тег курсу») і фіксує конкретне місце в рукописі —
 * той самий ідіом, що вже використовують Footnote/QRTag/
 * BookIllustration.selectedTextSnippet вище, лише з власним заголовком.
 * Матеріали курсу (відео, фото, домашні завдання, 3D-моделі) прив'язуються
 * або до тегу, або напряму до глави/розділу.
 */
export interface CourseTag {
  id: string;
  bookId: string;
  chapterId: string;
  sectionId: string;
  label: string;
  labelEn?: string;
  textSnippet: string;
  createdAt: string;
}

export type CourseMaterialKind = 'youtube' | 'photo' | 'homework' | 'model_3d';
export type Model3DFormat = 'dxf' | 'f3d' | 'obj' | 'stl';

export interface CourseMaterial {
  id: string;
  bookId: string;
  tagId?: string;
  chapterId?: string;
  sectionId?: string;
  kind: CourseMaterialKind;
  title: string;
  description?: string;
  /** kind === 'youtube' */
  youtubeUrl?: string;
  /** kind === 'photo' | 'homework' | 'model_3d' — файл зберігається як data URL (як BookIllustration/Медіатека). */
  fileName?: string;
  fileUrl?: string;
  fileSize?: string;
  /** kind === 'homework' */
  homeworkFormat?: 'pdf' | 'docx';
  /** kind === 'model_3d' */
  model3DFormat?: Model3DFormat;
  createdAt: string;
}

/**
 * Урок у структурі курсу — не новий контейнер контенту, а лише
 * впорядковане посилання на вже наявні CourseTag (кожен тег і так
 * прив'язаний до конкретного місця в рукописі й тягне за собою свої
 * матеріали через CourseMaterial.tagId). Один тег можна включити в
 * кілька уроків одразу — курс лишається способом ПОДАТИ вже позначений
 * матеріал послідовно, а не окремою копією контенту.
 */
export interface CourseLesson {
  id: string;
  title: string;
  titleEn?: string;
  tagIds: string[];
  createdAt: string;
}

/**
 * Модуль курсу — верхній рівень структури («розділ курсу»), містить
 * впорядкований список уроків. І модулі, і уроки всередині модуля мають
 * власний видимий порядок (масив = порядок), окремого поля order не
 * потрібно.
 */
export interface CourseModule {
  id: string;
  title: string;
  titleEn?: string;
  lessons: CourseLesson[];
  createdAt: string;
}

export interface CourseConfig {
  enabled: boolean;
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  tags: CourseTag[];
  materials: CourseMaterial[];
  /**
   * Необов'язково: старі курси (створені до появи модулів/уроків)
   * лишаються плоским списком тегів+матеріалів без жодної структури
   * зверху — і це коректний, повністю робочий стан, не «недоліковані
   * дані». Автор сам вирішує, чи вибудовувати курс у модулі.
   */
  modules?: CourseModule[];
}

/**
 * WYSIWYG-верстка PDF («Верстка PDF») — позиціонування графічних об'єктів
 * на сторінці глави з режимом обтікання текстом, і перевизначення полів
 * сторінки для конкретної глави. Базові поля/типографіка й далі беруться
 * з BookLayoutConfig нижче; тут лише винятки та розміщені об'єкти.
 */
export type PdfWrapMode = 'none' | 'left' | 'right' | 'top-bottom';

export interface PdfFrameObject {
  id: string;
  chapterId: string;
  sectionId?: string;
  /** Якщо об'єкт створено з наявної ілюстрації медіатеки/глави. */
  sourceIllustrationId?: string;
  imageUrl: string;
  caption?: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  wrapMode: PdfWrapMode;
  wrapMarginMm: number;
  zIndex: number;
}

export interface PdfChapterLayout {
  chapterId: string;
  margins?: {
    topMm: number;
    bottomMm: number;
    insideMm: number;
    outsideMm: number;
  };
  objects: PdfFrameObject[];
}

export interface BookPdfLayout {
  chapters: PdfChapterLayout[];
}

/** Координата вузла на полі Mind Board (у пікселях поля). */
export interface MindBoardPos {
  x: number;
  y: number;
}

/** Стікер із додатковою ідеєю, яку автор хотів би реалізувати. */
export interface MindBoardSticky {
  id: string;
  text: string;
  x: number;
  y: number;
}

/**
 * Розкладка Mind Board. Тут зберігаються ЛИШЕ координати та стікери —
 * самі герої й задум книги живуть у своїх звичних полях (`book.characters`,
 * `book.logline` тощо), тому дошка не дублює дані, а показує ті самі, що й
 * решта розділів. Зв'язки між героями — це `Character.relationships`.
 */
export interface MindBoardState {
  conceptPos?: MindBoardPos;
  /** characterId → позиція вузла героя. */
  characterPos?: Record<string, MindBoardPos>;
  stickies?: MindBoardSticky[];
}

/**
 * Шрифт, підключений користувачем з Google Fonts на додачу до вбудованих.
 * Зберігається разом із книгою, щоб вибір шрифту не «зникав» на іншому
 * пристрої: за `family` шрифт застосовується до тексту, за `href` —
 * довантажується таблиця стилів Google Fonts.
 */
export interface CustomFont {
  family: string;
  href: string;
  addedAt: string;
}

export interface BookLayoutConfig {
  formatPreset: PageFormatPreset;
  pageWidthMm: number;
  pageHeightMm: number;
  margins: {
    topMm: number;
    bottomMm: number;
    insideMm: number; // Gutter / корінець
    outsideMm: number;
    bleedMm: number;
    mirrored: boolean;
  };
  typography: {
    bodyFont: string;
    headingsFont: string;
    fontSizePt: number;
    lineHeight: number;
    firstLineIndentMm: number;
    paragraphSpacingMm: number;
    textAlign: 'justify' | 'left';
    /** 6 позицій номера сторінки; старі значення збережено для сумісності. */
    pageNumberPosition:
      | 'bottom-center'
      | 'bottom-left'
      | 'bottom-right'
      | 'top-left'
      | 'top-right'
      | 'top-center'
      | 'bottom-outside'
      | 'top-outside';
    showHeaders: boolean;
    /** Показувати номер сторінки в полях («Верстка PDF»). За замовчуванням true. */
    showPageNumbers?: boolean;
    /** Звідки починається нумерація сторінок («Верстка PDF»). */
    pageNumberStart?: {
      mode: 'title' | 'after-toc' | 'custom';
      startNumber?: number;
    };
  };
  /** Шрифти, довантажені користувачем з Google Fonts (див. CustomFont). */
  customFonts?: CustomFont[];
  tocConfig?: TOCConfig;
  /**
   * Дизайн-стиль друкованого/PDF-експорту книги (generateBookExportHtml):
   * 'classic' — теперішня проста верстка (за замовчуванням, без змін для
   * існуючих книг); 'editorial' — редакційний стиль на кшталт Claude Design
   * (серифні заголовки, ініціали-буквиці, нумеровані розділи, обкладинка й
   * зміст із кікерами, стилізовані виноски) — вмикається письменником
   * свідомо, нічого не змінює автоматично.
   */
  designTheme?: 'classic' | 'editorial';
  frontMatter: {
    showTitlePage: boolean;
    showCopyright: boolean;
    showDedication: boolean;
    showEpigraph: boolean;
    showTableOfContents: boolean;
    dedicationText: string;
    epigraphText: string;
    epigraphAuthor: string;
    copyrightText: string;
  };
}

export interface CoverConfig {
  format: 'paperback' | 'hardcover' | 'ebook' | 'square' | 'custom';
  coverType?: 'paperback' | 'hardcover' | 'ebook';
  spineWidthMm: number;
  frontTitle: string;
  subtitle: string;
  tagline?: string;
  authorName: string;
  authorBio?: string;
  frontArtUrl?: string;
  backDescription: string;
  barcode: string;
  palette: string[];
  theme: 'cyberpunk' | 'fantasy' | 'noir' | 'scifi' | 'classic' | 'modern_minimal';
  coverImageUrl?: string;
}

export interface BookVersionSnapshot {
  id: string;
  bookId: string;
  versionNumber: string;
  revisionNumber: number;
  label: string;
  note?: string;
  comment?: string;
  authorRole: UserRole;
  authorName?: string;
  author?: string;
  timestamp: string;
  wordCount: number;
  chapterCount: number;
  pageCount?: number;
  tags?: string[];
  snapshotData?: Partial<Book>;
}

/**
 * Крива головного героя: 13-кроковий конструктор шляху героя (мономіф
 * Кемпбелла) + 14-точкова емоційна крива, узгоджена з кроками. Той самий
 * простір ідей, що й скіл `hero-journey`, але тут — не окремий інструмент,
 * а частина книги: заповнюється або в експрес-майстрі (ExpressWizardView),
 * або прямо в редакторі (панель «Персонажі і сцена», HeroArcPanel.tsx), і
 * переноситься з майстра в книгу разом з рештою плану (App.tsx::applyExpressPlan).
 *
 * Статичні дані кроків/точок (назви, питання, дефолтна інтенсивність) —
 * не тут: вони не належать книзі, а живуть у коді компонента
 * (src/data/heroArc.ts), той самий підхід, що й у FRAMEWORKS/STEPS
 * ExpressWizardView.tsx.
 */
export interface HeroArcState {
  /** Відповіді на 13 кроків конструктора, ключ — id кроку ("s1".."s13"). */
  answers: Record<string, string>;
  /** Інтенсивність (-10..10) для кожної з 14 точок емоційної кривої. */
  intensities: number[];
}

export interface Book {
  id: string;
  /**
   * Власний словник книги: вигадані імена, топоніми й терміни («Сварог»,
   * «Неоносій»), які не мають вважатися помилками. Використовується для
   * фільтрації результатів AI-перевірки орфографії.
   */
  customDictionary?: string[];
  /** Розкладка дошки задуму (Mind Board). Див. MindBoardState. */
  mindBoard?: MindBoardState;
  /**
   * Зрізи показників навичок у часі — джерело для «Карти покращень книги»
   * та порівнянь «до/після». Див. SkillSnapshot.
   */
  skillSnapshots?: SkillSnapshot[];
  /** Крива головного героя — див. HeroArcState. */
  heroArc?: HeroArcState;
  version: string;
  revisionNumber: number;
  versionHistory?: BookVersionSnapshot[];
  title: string;
  titleEn?: string;
  subtitle?: string;
  subtitleEn?: string;
  author: string;
  authorEn?: string;
  language: string; // 'uk'
  genre: string;
  targetAudience?: string;
  synopsis: string;
  synopsisEn?: string;
  logline: string;
  theme: string;
  status: 'draft' | 'editing' | 'layout' | 'ready_to_publish';
  chapters: Chapter[];
  characters: Character[];
  visualBible: VisualBible;
  illustrations?: BookIllustration[];
  footnotes?: Footnote[];
  qrTags?: QRTag[];
  layoutConfig: BookLayoutConfig;
  coverConfig: CoverConfig;
  /**
   * Модель AI, востаннє обрана в чат-асистенті (QuickAiModal.tsx) — «рушій
   * книги» для всього AI-ядра цієї книги (наразі реально читається лише
   * функцією «Проаналізувати фото і згенерувати AI текст книги» в
   * редакторі розділу; переклад/граматика й далі мають власну поведінку).
   * Значення — точний `modelId` (напр. "claude-sonnet-5"), не назва рушія —
   * той самий формат, що й `chat_sessions.modelId` на сервері.
   */
  preferredAiModelId?: string;
  /** Курс/мінікурс на базі книги («Курси»). */
  course?: CourseConfig;
  /** WYSIWYG-верстка PDF («Верстка PDF»). */
  pdfLayout?: BookPdfLayout;
  /** База знань — референси автора (Фаза 2, 2.1). */
  knowledgeFiles?: KnowledgeFile[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Один файл у Базі знань («Дослідження»). Як і зображення в Медіатеці, сам
 * вміст лежить у книзі (IndexedDB браузера) — сервер лише рахує байти проти
 * тарифної квоти (server/mediaStorage.ts, той самий облік, що й Медіатека).
 */
export interface KnowledgeFile {
  id: string;
  fileName: string;
  fileType: 'txt' | 'md' | 'docx' | 'image';
  /** Витягнутий простий текст — для txt/md/docx. */
  contentText?: string;
  /** Data URL — лише для fileType 'image'. */
  previewImageUrl?: string;
  fileSizeLabel: string;
  createdAt: string;
}

export interface DocumentVersion {
  id: string;
  sectionId: string;
  title: string;
  content: string;
  timestamp: string;
  wordCount: number;
  note?: string;
}

export type UserRole = 
  | 'admin'       // Адміністратор сайту: повний доступ, налаштування, матриця прав
  | 'writer'      // Письменник / Автор: створення тексту, сюжет, персонажі, сцени, AI помічник
  | 'designer'    // Дизайнер / Ілюстратор: обкладинка, Visual Bible, ілюстрації, медіатека
  | 'translator'  // Перекладач: двомовна локалізація, EN поля, експорт English Edition
  | 'publisher'   // Видавець / Редактор: верстка, Amazon KDP аудит, корінець, поліграфія, експорт
  | 'reader'      // Читач / Бета-рідер: режим читання, перегляд книги та лору персонажів
  | 'guest';      // Гість: відкритий вхід без реєстрації, лише перегляд і заглушки замість AI

export interface RolePermission {
  canEditContent: boolean;
  canEditTranslation: boolean;
  canEditVisuals: boolean;
  canEditLayout: boolean;
  canExport: boolean;
  /**
   * Чи дозволено відкривати раніше експортований ZIP («Резервна копія книги»)
   * для продовження роботи над рукописом, і створювати такий ZIP самостійно.
   * Доступно всім робочим ролям (адмін/письменник/перекладач/дизайнер/видавець),
   * недоступно read-only ролям (читач, гість).
   */
  canImportBook: boolean;
  canManageCharacters: boolean;
  canManagePlot: boolean;
  canUseAi: boolean;
  canManageSettings: boolean;
  canViewAuditLog: boolean;
  canManageRoles: boolean;
  /** Чи дозволено витрачати платні генерації зображень. Гість — ні. */
  canGenerateImages: boolean;
  /**
   * Публікація в межах Nova. Досі не була виражена окремим правом, через що
   * маршрути `server/publishingRoutes.ts` стояли за самим `requireAuth` —
   * тобто публікувати міг будь-хто автентифікований. Відповідає праву
   * `publishing:nova` матриці маркетплейсу (docs/migration-plan.md, H1).
   */
  canPublish: boolean;
  /**
   * Зовнішні майданчики: Amazon KDP та Etsy, включно з OAuth-підключенням
   * крамниці. Окремо від `canPublish`, бо це вихід за межі платформи.
   * Відповідає `publishing:external`.
   */
  canPublishExternal: boolean;
  /**
   * Введення **власних** секретних ключів AI-провайдерів. Ролям, яким Nova
   * надає послуги своїми ключами, вимкнено (H4). Відповідає `keys:manage`.
   */
  canManageApiKeys: boolean;
  /**
   * Доступ до модуля King Market Intelligence (аналітика ринку Etsy).
   * Окреме право, а не похідне від `canPublishExternal`: скринінг витрачає
   * платні виклики моделі з ядра, тож ролі, які лише оформлюють видання
   * (дизайнер, перекладач, читач, гість), його не отримують. Дзеркалить
   * серверну перевірку `canMarketIntel` на маршрутах /api/market/*.
   */
  canMarketIntel: boolean;
  isReadOnly: boolean;
  allowedTabs: NavigationTab[];
}

/** Автентифікований користувач (або гість) у поточній сесії. */
export interface AuthUser {
  id: string | null;
  email: string | null;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  isGuest: boolean;
  disabled?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
}

/** Обліковий запис у списку панелі адміністратора. */
export interface AdminUserRow extends AuthUser {
  isProtectedAdmin: boolean;
  generations: number;
  spentUsd: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  bio?: string;
}

export interface RoleInfo {
  id: UserRole;
  nameUk: string;
  nameEn: string;
  badgeEmoji: string;
  badgeColor: string;
  bgGradient: string;
  descriptionUk: string;
  descriptionEn: string;
  responsibilitiesUk: string[];
  responsibilitiesEn: string[];
  permissions: RolePermission;
  defaultPersona: {
    name: string;
    email: string;
    avatar: string;
  };
}

// --- СИСТЕМА РОЗВИТКУ НАВИЧОК ТА МАЙСТЕРНОСТІ ПИСЬМЕННИКА ---

export type SkillCategory =
  | 'thinking'      // 2.1. Мислення
  | 'concept'       // 2.2. Ідея та концепція
  | 'plot'          // 2.3. Сюжет та структура
  | 'characters'    // 2.4. Персонажі
  | 'craft'         // 2.5. Майстерність письма
  | 'emotion'       // 2.6. Емоційний вплив
  | 'editing'       // 2.7. Редактура
  | 'book_prep'     // 2.8. Підготовка книги
  | 'visual'        // 2.9. Візуальна майстерність
  | 'author_brand'; // 2.10. Автор та професійний розвиток

export type MasteryLevel = 1 | 2 | 3 | 4 | 5;

export interface SkillCategoryInfo {
  id: SkillCategory;
  titleUk: string;
  titleEn: string;
  icon: string;
  color: string;
  description: string;
  subSkills: string[];
}

export type TaskDifficulty = 'Початковий' | 'Середній' | 'Високий' | 'Майстер';

export type BookIntegrationTarget = 
  | 'character_conflict'
  | 'character_fear'
  | 'character_desire'
  // Записується у Character.weaknesses; обробник і підпис в UI вже існували,
  // але сам варіант був відсутній в юніоні, тож гілка була недосяжною.
  | 'character_flaw'
  | 'character_bio'
  | 'logline'
  | 'synopsis'
  | 'theme'
  | 'chapter_scene'
  | 'dialogue'
  | 'visual_concept'
  | 'book_blurb'
  | 'author_bio'
  | 'general';

export interface SkillTask {
  id: string;
  title: string;
  category: SkillCategory;
  skillName: string;
  level: MasteryLevel;
  difficulty: TaskDifficulty;
  estimatedMinutes: number;
  goal: string;
  explanation: string;
  instruction: string;
  example: string;
  hint?: string;
  targetBookEntity?: BookIntegrationTarget;
  xpReward: number;
  nextTaskId?: string;
  tags?: string[];
}

export interface TaskEvaluationResult {
  taskId: string;
  score: number; // 0-100
  strengths: string[];
  growthAreas: string[];
  recommendation: string;
  nextStepSuggestion: string;
  xpEarned: number;
  suggestedBookIntegration?: {
    target: BookIntegrationTarget;
    label: string;
    extractedContent: string;
  };
  evaluatedAt: string;
}

export interface CompletedTaskRecord {
  taskId: string;
  taskTitle: string;
  category: SkillCategory;
  skillName: string;
  level: MasteryLevel;
  userAnswer: string;
  xpEarned: number;
  evaluation?: TaskEvaluationResult;
  completedAt: string;
  appliedToBook: boolean;
}

export interface DiagnosticQuestion {
  id: string;
  category: SkillCategory;
  skillName: string;
  question: string;
  description?: string;
  options: {
    text: string;
    score: number; // 20, 40, 60, 80, 100
    level: MasteryLevel;
  }[];
}

export interface DiagnosticProfile {
  completed: boolean;
  completedAt?: string;
  categoryScores: Record<SkillCategory, number>; // 0 to 100%
  strengths: string[];
  weaknesses: string[];
  authorArchetype: string;
  levelTitle: string;
  trajectorySummary: string;
  recommendedTaskIds: string[];
}

export interface MasteryAchievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: SkillCategory | 'general';
  xpBonus: number;
  unlockedAt?: string;
  progress: number; // 0 to 100
  maxProgress: number;
  currentProgress: number;
}

export interface WriterMasteryState {
  xp: number;
  level: number;
  levelTitle: string;
  dailyStreak: number;
  lastActiveDate: string;
  todayTaskId: string;
  todayTaskCompleted: boolean;
  diagnostic: DiagnosticProfile;
  completedTasks: CompletedTaskRecord[];
  achievements: MasteryAchievement[];
  customGoals?: string[];
}

// --- ВИДИМІ РЕЗУЛЬТАТИ РОЗВИТКУ НАВИЧОК (хвиля 1) ---
// Модель для показу того, як конкретна навичка проявляється в самому тексті:
// маркери компетентностей у розділі та зрізи показників книги в часі.

/**
 * Тип текстового маркера компетентності — те, що підсвічується в режимі
 * «Показати компетентності» і за чим рахуються показники глави.
 */
export type CompetenceMarkerType =
  | 'thesis'          // 🟦 теза
  | 'argument'        // 🟩 аргумент
  | 'example'         // 🟨 приклад
  | 'conflict'        // 🟥 конфлікт
  | 'emotional_peak'  // 🟪 емоційна кульмінація
  | 'plot_turn'       // 🟧 поворот сюжету
  | 'description';    // ⬜ опис

/**
 * Знайдений у тексті фрагмент, що демонструє компетентність.
 *
 * Позиція зберігається двічі: як точна цитата (`quote`) і як числовий зсув.
 * Цитата — головний якір: після редагування розділу зсуви «поїдуть», а за
 * цитатою фрагмент можна знайти знову. Зсув лишається підказкою для
 * швидкого пошуку і на випадок повторюваних цитат.
 */
export interface CompetenceMarker {
  id: string;
  type: CompetenceMarkerType;
  quote: string;
  offset?: number;
  length?: number;
  /** Впевненість моделі, 0..1 — слабкі маркери можна ховати. */
  confidence: number;
  /** Чому AI вважає це саме таким маркером (для інспектора). */
  note?: string;
}

/**
 * Результат аналізу одного розділу. Кешується за `textHash`, щоб повторне
 * відкриття глави не означало новий платний виклик моделі.
 */
export interface TextCompetenceAnalysis {
  sectionId: string;
  textHash: string;
  markers: CompetenceMarker[];
  /** Оцінки 0..100 за ключами каталогу `skillMarkers`. */
  skillScores: Record<string, number>;
  analyzedAt: string;
  /** Версія рушія аналізу — див. коментар до SkillSnapshot. */
  engineVersion: string;
}

/**
 * Зріз показників книги на певний момент — основа всіх порівнянь «до/після».
 *
 * `engineVersion` і `model` тут не для звітності, а для коректності: якщо
 * зрізи зроблені різними версіями промпту чи різними моделями, їхня різниця
 * вимірює зміну поведінки AI, а не зростання автора. Порівнювати можна лише
 * зрізи з однаковим рушієм.
 */
export interface SkillSnapshot {
  id: string;
  bookId: string;
  takenAt: string;
  bookVersion?: string;
  bookRevision?: number;
  /** Оцінки 0..100 за ключами каталогу `skillMarkers`. */
  scores: Record<string, number>;
  wordCount: number;
  chapterCount: number;
  engineVersion: string;
  model?: string;
  /** Позначка «зроблено вручну» чи автоматично (напр. при версії книги). */
  trigger?: 'manual' | 'auto' | 'version';
}

// --- REAL-TIME MULTI-USER COLLABORATION & WEBSOCKET TYPES ---

export interface CollaboratorPresence {
  clientId: string;
  userId: string;
  userName: string;
  role: UserRole;
  currentTab: NavigationTab;
  activeSectionId?: string;
  activeChapterId?: string;
  color: string;
  avatarUrl?: string;
  lastActive: string;
  isTyping?: boolean;
  /** Браузер і платформа сесії — «Chrome · Windows». Порожньо для старих клієнтів. */
  deviceLabel?: string;
}

export interface CollabChatMessage {
  id: string;
  clientId: string;
  senderName: string;
  role: UserRole;
  color: string;
  message: string;
  timestamp: string;
  tabContext?: NavigationTab;
}

export type RealtimeSyncStatus = 'connected' | 'connecting' | 'disconnected' | 'syncing';

export interface RealtimeServerEvent {
  type: 
    | 'room:sync'
    | 'presence:update'
    | 'book:remote_update'
    | 'chat:message'
    | 'version:snapshot_created'
    | 'user:joined'
    | 'user:left'
    | 'error';
  payload: any;
  senderId?: string;
  timestamp: string;
}



