export type BookDesignThemeId =
  | 'classic'
  | 'modern-fiction'
  | 'sci-fi'
  | 'fantasy'
  | 'dark-fantasy'
  | 'thriller'
  | 'noir-detective'
  | 'romance'
  | 'poetry-literary'
  | 'non-fiction'
  | 'academic-research'
  | 'business-premium'
  | 'children'
  | 'graphic-story'
  | 'experimental-art';

export type SemanticParagraphStyle =
  | 'Body'
  | 'Heading 1'
  | 'Heading 2'
  | 'Quote'
  | 'Epigraph'
  | 'Letter'
  | 'InnerThought'
  | 'ChatMessage'
  | 'SceneBreak'
  | 'Caption'
  | 'LocationTime'
  | 'SystemMessage'
  | 'Evidence'
  | 'Lore'
  | 'CaseStudy'
  | 'KeyIdea'
  | 'Footnote';

export type ThemeCategory =
  | 'fiction'
  | 'genre-fiction'
  | 'literary'
  | 'non-fiction'
  | 'academic'
  | 'children'
  | 'visual';

export type ThemeVariantId = 'light' | 'editorial' | 'bold';

export interface ThemeVariant {
  id: ThemeVariantId;
  labelUk: string;
  descriptionUk: string;
  /** Pure presentation hint for the future UI; renderer support comes later. */
  density: 'airy' | 'balanced' | 'compact';
  contrast: 'soft' | 'medium' | 'strong';
}

export interface SemanticStyleRule {
  /** Whether the style is part of this theme's visible vocabulary. */
  enabled: boolean;
  font?: 'body' | 'heading' | 'mono';
  align?: 'left' | 'center' | 'right' | 'justify';
  italic?: boolean;
  bold?: boolean;
  uppercase?: boolean;
  border?: 'none' | 'top' | 'bottom' | 'box' | 'left';
  background?: 'none' | 'subtle';
  before?: string;
  after?: string;
}

export interface BookDesignTheme {
  id: BookDesignThemeId;
  labelUk: string;
  descriptionUk: string;
  category: ThemeCategory;
  /** Human-oriented recommendation tags. They are not permissions or logic. */
  recommendedFor: string[];

  bodyFont: string;
  headingFont: string;
  monoFont: string;
  bodyAlign: 'left' | 'justify';
  chapterAlign: 'left' | 'center';
  bodySizeDelta: number;
  chapterSizeDelta: number;
  sectionSizeDelta: number;
  paragraphIndentMultiplier: number;
  paragraphSpacingMultiplier: number;
  sceneBreak: string;
  chapterNumberStyle: 'quiet' | 'display' | 'technical' | 'ornamental';

  /** What metadata may be shown at scene/chapter openings. */
  chapterOpening: {
    showNumber: boolean;
    showLocation: boolean;
    showTime: boolean;
    showPov: boolean;
    showEpigraph: boolean;
  };

  /** Theme-specific semantic vocabulary. Missing rules inherit Body. */
  semanticStyles: Partial<Record<SemanticParagraphStyle, SemanticStyleRule>>;

  /** Three visual moods without multiplying the number of theme systems. */
  variants: readonly ThemeVariant[];
}

const VARIANTS: readonly ThemeVariant[] = [
  { id: 'light', labelUk: 'Light', descriptionUk: 'Більше повітря та спокійніший контраст.', density: 'airy', contrast: 'soft' },
  { id: 'editorial', labelUk: 'Editorial', descriptionUk: 'Збалансований книжково-журнальний характер.', density: 'balanced', contrast: 'medium' },
  { id: 'bold', labelUk: 'Bold', descriptionUk: 'Сильніші заголовки й виразніші службові блоки.', density: 'balanced', contrast: 'strong' },
];

const BASE_SEMANTICS: Partial<Record<SemanticParagraphStyle, SemanticStyleRule>> = {
  Quote: { enabled: true, font: 'body', italic: true, align: 'left' },
  Epigraph: { enabled: true, font: 'body', italic: true, align: 'right' },
  Letter: { enabled: true, font: 'body', align: 'left' },
  InnerThought: { enabled: true, font: 'body', italic: true },
  ChatMessage: { enabled: true, font: 'body', align: 'left', background: 'subtle' },
  SceneBreak: { enabled: true, align: 'center' },
  Caption: { enabled: true, font: 'body', align: 'center', italic: true },
  Footnote: { enabled: true, font: 'body', align: 'left' },
};

function semantic(
  extra: Partial<Record<SemanticParagraphStyle, SemanticStyleRule>> = {}
): Partial<Record<SemanticParagraphStyle, SemanticStyleRule>> {
  return { ...BASE_SEMANTICS, ...extra };
}

function opening(
  values: Partial<BookDesignTheme['chapterOpening']> = {}
): BookDesignTheme['chapterOpening'] {
  return {
    showNumber: true,
    showLocation: false,
    showTime: false,
    showPov: false,
    showEpigraph: false,
    ...values,
  };
}

/**
 * Phase 1 deliberately uses fonts already available in the current image.
 * The visual system is therefore safe before the OFL font-pack task lands.
 * Theme-specific OFL families can replace these fallbacks without changing
 * public theme ids or stored book settings.
 *
 * Important: these are DESIGN SYSTEMS, not color skins. Each one describes
 * typography, chapter opening behavior and a semantic vocabulary that later
 * DesignCraft passes can turn into real paragraph/object styles.
 */
export const BOOK_DESIGN_THEMES: Record<BookDesignThemeId, BookDesignTheme> = {
  classic: {
    id: 'classic', labelUk: 'Classic', category: 'fiction',
    descriptionUk: 'Традиційна літературна верстка: епіграф, спокійний ритм, декоративна пауза й виразний початок глави.',
    recommendedFor: ['класичний роман', 'історична проза', 'мемуари'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Serif', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'justify', chapterAlign: 'center', bodySizeDelta: 0, chapterSizeDelta: 1, sectionSizeDelta: 0,
    paragraphIndentMultiplier: 1, paragraphSpacingMultiplier: 1, sceneBreak: '❦', chapterNumberStyle: 'quiet',
    chapterOpening: opening({ showEpigraph: true }),
    semanticStyles: semantic({ Epigraph: { enabled: true, font: 'body', italic: true, align: 'right' } }),
    variants: VARIANTS,
  },
  'modern-fiction': {
    id: 'modern-fiction', labelUk: 'Modern Fiction', category: 'fiction',
    descriptionUk: 'Повітряна сучасна проза з великим номером глави, асиметрією й сильним білим простором.',
    recommendedFor: ['сучасний роман', 'психологічна проза', 'міська проза'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'left', bodySizeDelta: 0.35, chapterSizeDelta: 5, sectionSizeDelta: 1,
    paragraphIndentMultiplier: 0.6, paragraphSpacingMultiplier: 1.35, sceneBreak: '· · ·', chapterNumberStyle: 'display',
    chapterOpening: opening(), semanticStyles: semantic(), variants: VARIANTS,
  },
  'sci-fi': {
    id: 'sci-fi', labelUk: 'Sci‑Fi', category: 'genre-fiction',
    descriptionUk: 'Технологічна асиметрія: місце й час, компактні службові елементи, повідомлення, логи та системні блоки.',
    recommendedFor: ['science fiction', 'кіберпанк', 'технотрилер', 'космічна опера'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'left', bodySizeDelta: 0, chapterSizeDelta: 3, sectionSizeDelta: 0.5,
    paragraphIndentMultiplier: 0.35, paragraphSpacingMultiplier: 1.15, sceneBreak: '◇', chapterNumberStyle: 'technical',
    chapterOpening: opening({ showLocation: true, showTime: true }),
    semanticStyles: semantic({
      LocationTime: { enabled: true, font: 'mono', uppercase: true, border: 'bottom' },
      SystemMessage: { enabled: true, font: 'mono', background: 'subtle', border: 'box' },
      ChatMessage: { enabled: true, font: 'mono', background: 'subtle' },
    }),
    variants: VARIANTS,
  },
  fantasy: {
    id: 'fantasy', labelUk: 'Fantasy', category: 'genre-fiction',
    descriptionUk: 'Міфологічна книжкова система з епіграфами, легендами, символами й атмосферним відкриттям глав.',
    recommendedFor: ['fantasy', 'міфологія', 'пригоди', 'епічний роман'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Serif', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'justify', chapterAlign: 'center', bodySizeDelta: 0.1, chapterSizeDelta: 2, sectionSizeDelta: 0.5,
    paragraphIndentMultiplier: 1, paragraphSpacingMultiplier: 1, sceneBreak: '✦', chapterNumberStyle: 'ornamental',
    chapterOpening: opening({ showLocation: true, showEpigraph: true }),
    semanticStyles: semantic({ Lore: { enabled: true, font: 'body', italic: true, border: 'left' } }),
    variants: VARIANTS,
  },
  'dark-fantasy': {
    id: 'dark-fantasy', labelUk: 'Dark Fantasy', category: 'genre-fiction',
    descriptionUk: 'Щільніша, похмура верстка з різкими паузами, пророцтвами та сильними внутрішніми монологами.',
    recommendedFor: ['dark fantasy', 'horror fantasy', 'готичний роман'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Serif', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'justify', chapterAlign: 'left', bodySizeDelta: 0, chapterSizeDelta: 3, sectionSizeDelta: 0,
    paragraphIndentMultiplier: 0.8, paragraphSpacingMultiplier: 0.9, sceneBreak: '†', chapterNumberStyle: 'ornamental',
    chapterOpening: opening({ showEpigraph: true }),
    semanticStyles: semantic({
      Epigraph: { enabled: true, font: 'body', italic: true, align: 'left', border: 'left' },
      InnerThought: { enabled: true, font: 'body', italic: true },
      Lore: { enabled: true, font: 'body', border: 'top' },
    }),
    variants: VARIANTS,
  },
  thriller: {
    id: 'thriller', labelUk: 'Thriller', category: 'genre-fiction',
    descriptionUk: 'Швидкий ритм: коротке відкриття глави, дата/час/локація, повідомлення та доказові блоки.',
    recommendedFor: ['трилер', 'кримінальна проза', 'шпигунський роман'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'left', bodySizeDelta: 0, chapterSizeDelta: 2.5, sectionSizeDelta: 0.5,
    paragraphIndentMultiplier: 0.4, paragraphSpacingMultiplier: 1.2, sceneBreak: '— • —', chapterNumberStyle: 'technical',
    chapterOpening: opening({ showLocation: true, showTime: true }),
    semanticStyles: semantic({
      LocationTime: { enabled: true, font: 'mono', uppercase: true },
      Evidence: { enabled: true, font: 'mono', border: 'box', background: 'subtle' },
      ChatMessage: { enabled: true, font: 'mono', border: 'left' },
    }),
    variants: VARIANTS,
  },
  'noir-detective': {
    id: 'noir-detective', labelUk: 'Noir / Detective', category: 'genre-fiction',
    descriptionUk: 'Кінематографічна детективна система з досьє, записками, доказами та стриманою типографікою.',
    recommendedFor: ['детектив', 'noir', 'mystery', 'поліцейська проза'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'justify', chapterAlign: 'left', bodySizeDelta: 0, chapterSizeDelta: 2, sectionSizeDelta: 0,
    paragraphIndentMultiplier: 0.7, paragraphSpacingMultiplier: 1, sceneBreak: '◆', chapterNumberStyle: 'display',
    chapterOpening: opening({ showLocation: true, showTime: true }),
    semanticStyles: semantic({
      Evidence: { enabled: true, font: 'mono', border: 'box' },
      Letter: { enabled: true, font: 'body', italic: true, border: 'left' },
    }),
    variants: VARIANTS,
  },
  romance: {
    id: 'romance', labelUk: 'Romance', category: 'genre-fiction',
    descriptionUk: 'М’яка емоційна верстка з листами, повідомленнями, спогадами та виразною внутрішньою мовою героя.',
    recommendedFor: ['романтика', 'жіноча проза', 'сімейна сага'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Serif', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'justify', chapterAlign: 'center', bodySizeDelta: 0.2, chapterSizeDelta: 2, sectionSizeDelta: 0.5,
    paragraphIndentMultiplier: 0.8, paragraphSpacingMultiplier: 1.15, sceneBreak: '♡', chapterNumberStyle: 'quiet',
    chapterOpening: opening({ showPov: true }),
    semanticStyles: semantic({
      Letter: { enabled: true, font: 'body', italic: true, align: 'left' },
      InnerThought: { enabled: true, font: 'body', italic: true },
    }),
    variants: VARIANTS,
  },
  'poetry-literary': {
    id: 'poetry-literary', labelUk: 'Poetry / Literary', category: 'literary',
    descriptionUk: 'Велика роль білого простору, гнучкий ритм рядка, цитати й авторські паузи без зайвої рамковості.',
    recommendedFor: ['поезія', 'есе', 'літературна проза', 'коротка форма'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Serif', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'center', bodySizeDelta: 0.5, chapterSizeDelta: 1, sectionSizeDelta: 0,
    paragraphIndentMultiplier: 0, paragraphSpacingMultiplier: 1.8, sceneBreak: '⁂', chapterNumberStyle: 'quiet',
    chapterOpening: opening({ showNumber: false, showEpigraph: true }),
    semanticStyles: semantic({ Quote: { enabled: true, font: 'body', italic: true, align: 'center' } }),
    variants: VARIANTS,
  },
  'non-fiction': {
    id: 'non-fiction', labelUk: 'Non‑fiction', category: 'non-fiction',
    descriptionUk: 'Ясна структурована система для пояснення: сильна ієрархія, тези, приклади, callout-блоки й таблиці.',
    recommendedFor: ['популярна наука', 'психологія', 'освітня книга', 'довідник'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'left', bodySizeDelta: -0.1, chapterSizeDelta: 2, sectionSizeDelta: 1,
    paragraphIndentMultiplier: 0, paragraphSpacingMultiplier: 1.6, sceneBreak: '—', chapterNumberStyle: 'quiet',
    chapterOpening: opening(),
    semanticStyles: semantic({
      KeyIdea: { enabled: true, font: 'heading', bold: true, border: 'left', background: 'subtle' },
      CaseStudy: { enabled: true, font: 'body', border: 'box' },
    }),
    variants: VARIANTS,
  },
  'academic-research': {
    id: 'academic-research', labelUk: 'Academic / Research', category: 'academic',
    descriptionUk: 'Дисциплінована наукова верстка: нумерація, виноски, цитати, таблиці та нейтральна ієрархія.',
    recommendedFor: ['дослідження', 'монографія', 'навчальний посібник', 'дисертаційний матеріал'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Serif', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'justify', chapterAlign: 'left', bodySizeDelta: -0.2, chapterSizeDelta: 1, sectionSizeDelta: 0,
    paragraphIndentMultiplier: 0.8, paragraphSpacingMultiplier: 0.9, sceneBreak: '§', chapterNumberStyle: 'quiet',
    chapterOpening: opening(),
    semanticStyles: semantic({
      Quote: { enabled: true, font: 'body', border: 'left' },
      Footnote: { enabled: true, font: 'body', align: 'left' },
    }),
    variants: VARIANTS,
  },
  'business-premium': {
    id: 'business-premium', labelUk: 'Business / Premium', category: 'non-fiction',
    descriptionUk: 'Впевнена преміальна подача: великі тези, кейси, ключові ідеї та чиста executive-структура.',
    recommendedFor: ['бізнес', 'менеджмент', 'стартапи', 'self-development'],
    bodyFont: 'DejaVu Sans', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'left', bodySizeDelta: 0, chapterSizeDelta: 4, sectionSizeDelta: 1,
    paragraphIndentMultiplier: 0, paragraphSpacingMultiplier: 1.55, sceneBreak: '—', chapterNumberStyle: 'display',
    chapterOpening: opening(),
    semanticStyles: semantic({
      KeyIdea: { enabled: true, font: 'heading', bold: true, border: 'top' },
      CaseStudy: { enabled: true, font: 'body', background: 'subtle', border: 'box' },
      Quote: { enabled: true, font: 'heading', bold: true, align: 'left' },
    }),
    variants: VARIANTS,
  },
  children: {
    id: 'children', labelUk: 'Children', category: 'children',
    descriptionUk: 'Великий дружній набір: коротші рядки, багато повітря, ілюстративні паузи та проста навігація.',
    recommendedFor: ['дитяча книга', 'раннє читання', 'освітня історія'],
    bodyFont: 'DejaVu Sans', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'center', bodySizeDelta: 2, chapterSizeDelta: 4, sectionSizeDelta: 2,
    paragraphIndentMultiplier: 0, paragraphSpacingMultiplier: 1.8, sceneBreak: '✦', chapterNumberStyle: 'display',
    chapterOpening: opening({ showNumber: false }),
    semanticStyles: semantic({ Caption: { enabled: true, font: 'body', bold: true, align: 'center' } }),
    variants: VARIANTS,
  },
  'graphic-story': {
    id: 'graphic-story', labelUk: 'Graphic Story', category: 'visual',
    descriptionUk: 'Візуально-сценарна система: великі зображення, короткі текстові блоки, scene cards і сильні captions.',
    recommendedFor: ['графічна історія', 'артбук', 'візуальний роман', 'сценарна книга'],
    bodyFont: 'DejaVu Sans', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'left', bodySizeDelta: 0.4, chapterSizeDelta: 5, sectionSizeDelta: 1.5,
    paragraphIndentMultiplier: 0, paragraphSpacingMultiplier: 1.7, sceneBreak: '▰', chapterNumberStyle: 'display',
    chapterOpening: opening({ showLocation: true }),
    semanticStyles: semantic({
      LocationTime: { enabled: true, font: 'heading', uppercase: true, border: 'bottom' },
      Caption: { enabled: true, font: 'heading', bold: true, align: 'left' },
      ChatMessage: { enabled: true, font: 'body', background: 'subtle', border: 'box' },
    }),
    variants: VARIANTS,
  },
  'experimental-art': {
    id: 'experimental-art', labelUk: 'Experimental / Art Book', category: 'visual',
    descriptionUk: 'Концептуальна система для нестандартних розворотів, великих цитат, image spreads і змінного ритму сторінки.',
    recommendedFor: ['артбук', 'концептуальна книга', 'фото-книга', 'експериментальна проза'],
    bodyFont: 'DejaVu Serif', headingFont: 'DejaVu Sans', monoFont: 'DejaVu Sans Mono',
    bodyAlign: 'left', chapterAlign: 'left', bodySizeDelta: 0.2, chapterSizeDelta: 6, sectionSizeDelta: 2,
    paragraphIndentMultiplier: 0, paragraphSpacingMultiplier: 2, sceneBreak: '○', chapterNumberStyle: 'display',
    chapterOpening: opening({ showNumber: false, showLocation: true, showPov: true }),
    semanticStyles: semantic({
      Quote: { enabled: true, font: 'heading', bold: true, align: 'center' },
      Epigraph: { enabled: true, font: 'body', italic: true, align: 'center' },
      Caption: { enabled: true, font: 'heading', align: 'left' },
    }),
    variants: VARIANTS,
  },
};

export const BOOK_DESIGN_THEME_ORDER: readonly BookDesignThemeId[] = [
  'classic',
  'modern-fiction',
  'sci-fi',
  'fantasy',
  'dark-fantasy',
  'thriller',
  'noir-detective',
  'romance',
  'poetry-literary',
  'non-fiction',
  'academic-research',
  'business-premium',
  'children',
  'graphic-story',
  'experimental-art',
];

export function isBookDesignThemeId(value: unknown): value is BookDesignThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BOOK_DESIGN_THEMES, value);
}

export function getBookDesignTheme(value: unknown): BookDesignTheme | null {
  return isBookDesignThemeId(value) ? BOOK_DESIGN_THEMES[value] : null;
}

export function listBookDesignThemes(): BookDesignTheme[] {
  return BOOK_DESIGN_THEME_ORDER.map((id) => BOOK_DESIGN_THEMES[id]);
}
