/**
 * Підсистема 1: специфікація Amazon KDP на боці сервера (ТЗ 3).
 *
 * Ключова відмінність KDP від Etsy, яку задає архітектуру всього модуля:
 * **офіційного API для публікації книги не існує**. Тому KDP-гілка не може
 * «дійти до кінця» — вона закінчується готовими файлами й метаданими-листом,
 * який автор власноруч копіює в кабінет KDP. Спроби автоматизувати
 * завантаження в KDP свідомо немає: це порушення ToS Amazon (ТЗ 9).
 *
 * Чому цей модуль на сервері, хоч у проєкті вже є `src/utils/kdpHelpers.ts`:
 * там валідація прив'язана до типу `Book` і живе в браузері. Конвеєру
 * публікації потрібні ті самі числа без React і без книги — для розрахунку
 * корінця під згенеровану обкладинку, для перевірки перед експортом і для
 * листа метаданих. Дублювання свідоме й обмежене: тут лише числа й правила,
 * жодної роботи з документом.
 */

export interface KdpTrimSize {
  id: string;
  label: string;
  widthInches: number;
  heightInches: number;
  /** Чи входить у перелік «обов'язкових» з ТЗ 3.1. */
  required: boolean;
  noteUk: string;
}

/** Три розміри з ТЗ + найуживаніші сусідні, щоб автору було з чого обирати. */
export const KDP_TRIM_SIZES: KdpTrimSize[] = [
  { id: '5x8', label: '5 × 8″', widthInches: 5, heightInches: 8, required: true, noteUk: 'Кишеньковий формат — поезія, есеїстика, короткі романи.' },
  { id: '5.5x8.5', label: '5.5 × 8.5″', widthInches: 5.5, heightInches: 8.5, required: true, noteUk: 'Digest — компактна художня проза.' },
  { id: '6x9', label: '6 × 9″', widthInches: 6, heightInches: 9, required: true, noteUk: 'Найпоширеніший формат KDP: романи й нон-фікшн.' },
  { id: '7x10', label: '7 × 10″', widthInches: 7, heightInches: 10, required: false, noteUk: 'Ілюстровані видання й посібники.' },
  { id: '8.5x11', label: '8.5 × 11″', widthInches: 8.5, heightInches: 11, required: false, noteUk: 'Робочі зошити та великі ілюстровані книги.' },
];

export type PaperType = 'white' | 'cream' | 'color';

/** Товщина однієї сторінки в дюймах за довідкою KDP. */
export const PAGE_THICKNESS_INCHES: Record<PaperType, number> = {
  white: 0.002252,
  cream: 0.0025,
  color: 0.002347,
};

/** KDP приймає книгу від 24 сторінок; понад 828 не друкує взагалі. */
export const MIN_PAGE_COUNT = 24;
export const MAX_PAGE_COUNT = 828;
/** Виліт під обріз. */
export const BLEED_INCHES = 0.125;
/** Мінімальна роздільна здатність макета обкладинки. */
export const MIN_COVER_DPI = 300;
/** Обмеження полів опису в кабінеті KDP. */
export const MAX_DESCRIPTION_CHARS = 4000;
export const KEYWORD_SLOTS = 7;
export const MAX_KEYWORD_CHARS = 50;
/** Скільки категорій BISAC дозволяє вибрати KDP. */
export const MAX_BISAC_CATEGORIES = 3;

const MM_PER_INCH = 25.4;

export function inchesToMm(inches: number): number {
  return Math.round(inches * MM_PER_INCH * 100) / 100;
}

export function findTrimSize(id: string): KdpTrimSize | undefined {
  return KDP_TRIM_SIZES.find((t) => t.id === id);
}

/**
 * Товщина корінця. Округлення до сотих дюйма — саме з такою точністю KDP
 * приймає макет; давати більше знаків означало б удавану точність.
 */
export function spineThicknessInches(pageCount: number, paper: PaperType = 'white'): number {
  const pages = Math.max(0, Math.floor(pageCount));
  return Math.round(pages * PAGE_THICKNESS_INCHES[paper] * 1000) / 1000;
}

export interface FullCoverSpec {
  trimId: string;
  pageCount: number;
  paper: PaperType;
  spineInches: number;
  spineMm: number;
  /** Повний розгорнутий макет: задня + корінець + передня + виліт з усіх боків. */
  widthInches: number;
  heightInches: number;
  widthMm: number;
  heightMm: number;
  /** Той самий макет у пікселях за 300 dpi — саме це вводять у графічний редактор. */
  widthPx: number;
  heightPx: number;
  dpi: number;
  /** Кольоровий профіль: друк — CMYK, електронна версія — RGB (ТЗ 3.1). */
  colorProfilePrint: 'CMYK';
  colorProfileEbook: 'RGB';
  noteUk: string;
}

/**
 * Розгорнутий макет обкладинки під друк.
 *
 * Формула KDP: ширина = 2 × (ширина сторінки + виліт) + корінець,
 * висота = висота сторінки + 2 × виліт. Помилка тут коштує авторові
 * відхиленого макета, тому число корінця віддається окремим полем — щоб у
 * інтерфейсі його було видно, а не лише підсумковий розмір.
 */
export function calculateFullCover(params: {
  trimId: string;
  pageCount: number;
  paper?: PaperType;
  dpi?: number;
}): FullCoverSpec {
  const trim = findTrimSize(params.trimId) || KDP_TRIM_SIZES[2];
  const paper = params.paper || 'white';
  const dpi = Math.max(MIN_COVER_DPI, params.dpi || MIN_COVER_DPI);
  const spine = spineThicknessInches(params.pageCount, paper);
  const widthInches = Math.round((trim.widthInches * 2 + spine + BLEED_INCHES * 2) * 1000) / 1000;
  const heightInches = Math.round((trim.heightInches + BLEED_INCHES * 2) * 1000) / 1000;

  return {
    trimId: trim.id,
    pageCount: params.pageCount,
    paper,
    spineInches: spine,
    spineMm: inchesToMm(spine),
    widthInches,
    heightInches,
    widthMm: inchesToMm(widthInches),
    heightMm: inchesToMm(heightInches),
    widthPx: Math.round(widthInches * dpi),
    heightPx: Math.round(heightInches * dpi),
    dpi,
    colorProfilePrint: 'CMYK',
    colorProfileEbook: 'RGB',
    noteUk: `Розгорнутий макет ${trim.label}: задня обкладинка + корінець ${inchesToMm(spine)} мм + передня, з вильотом ${inchesToMm(BLEED_INCHES)} мм з кожного боку. Для друку — CMYK, для електронної версії — RGB, не менше ${dpi} dpi.`,
  };
}

// ---------------------------------------------------------------------------
// Валідація перед експортом (ТЗ 3.1, останній пункт)
// ---------------------------------------------------------------------------

export interface KdpIssue {
  severity: 'blocker' | 'warning';
  field: string;
  messageUk: string;
}

export interface ManuscriptCheckInput {
  pageCount: number;
  wordCount?: number;
  hasTableOfContents: boolean;
  /** Рівні заголовків у порядку появи: 1 — глава, 2 — розділ тощо. */
  headingLevels: number[];
  emptyChapters?: string[];
  trimId?: string;
}

/**
 * Перевіряє те, через що KDP найчастіше відхиляє рукопис: занадто мало
 * сторінок, відсутній зміст і «дірки» в ієрархії заголовків (розділ 3-го
 * рівня одразу після 1-го — навігація в Kindle побудується неправильно).
 */
export function validateManuscriptForKdp(input: ManuscriptCheckInput): {
  ok: boolean;
  issues: KdpIssue[];
} {
  const issues: KdpIssue[] = [];

  if (input.pageCount < MIN_PAGE_COUNT) {
    issues.push({
      severity: 'blocker',
      field: 'pageCount',
      messageUk: `У рукописі ${input.pageCount} сторінок — KDP приймає видання від ${MIN_PAGE_COUNT}.`,
    });
  }
  if (input.pageCount > MAX_PAGE_COUNT) {
    issues.push({
      severity: 'blocker',
      field: 'pageCount',
      messageUk: `${input.pageCount} сторінок — понад максимум KDP у ${MAX_PAGE_COUNT}. Розділіть на два томи.`,
    });
  }
  if (!input.hasTableOfContents) {
    issues.push({
      severity: 'warning',
      field: 'toc',
      messageUk: 'Немає змісту. Для друкованої книги це припустимо, для Kindle — майже завжди причина поганих відгуків.',
    });
  }

  const levels = input.headingLevels || [];
  if (!levels.length) {
    issues.push({
      severity: 'blocker',
      field: 'headings',
      messageUk: 'У рукописі немає жодного заголовка — Kindle не зможе побудувати навігацію.',
    });
  } else {
    if (levels[0] !== 1) {
      issues.push({
        severity: 'warning',
        field: 'headings',
        messageUk: `Перший заголовок має рівень ${levels[0]}, а не 1. Структура почнеться «з середини».`,
      });
    }
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        issues.push({
          severity: 'warning',
          field: 'headings',
          messageUk: `Пропущено рівень заголовка: після H${levels[i - 1]} одразу йде H${levels[i]}.`,
        });
        break;
      }
    }
  }

  for (const chapter of input.emptyChapters || []) {
    issues.push({
      severity: 'blocker',
      field: 'chapters',
      messageUk: `Глава «${chapter}» порожня — KDP відхиляє видання з порожніми розділами.`,
    });
  }

  if (input.trimId && !findTrimSize(input.trimId)) {
    issues.push({
      severity: 'blocker',
      field: 'trim',
      messageUk: `Невідомий трим-розмір «${input.trimId}».`,
    });
  }

  return { ok: !issues.some((i) => i.severity === 'blocker'), issues };
}

// ---------------------------------------------------------------------------
// Лист метаданих (ТЗ 3.1, третій пункт)
// ---------------------------------------------------------------------------

export interface KdpMetadataInput {
  title: string;
  subtitle?: string;
  authorName?: string;
  description: string;
  keywords: string[];
  bisacCategories: string[];
  language?: string;
  trimId?: string;
  pageCount?: number;
  paper?: PaperType;
  isbn?: string;
}

export interface KdpMetadataSheet {
  text: string;
  issues: KdpIssue[];
  fields: Record<string, string>;
}

/**
 * Формує довідку, яку автор копіює в кабінет KDP.
 *
 * Автоматично нічого не завантажується — і це не обмеження реалізації, а
 * єдиний законний спосіб: офіційного API в KDP немає (ТЗ 2 і 9). Тому лист
 * побудований так, щоб копіювати поле за полем без роздумів.
 */
export function buildKdpMetadataSheet(input: KdpMetadataInput): KdpMetadataSheet {
  const issues: KdpIssue[] = [];
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const keywords = (input.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  const bisac = (input.bisacCategories || []).map((b) => String(b).trim()).filter(Boolean);

  if (!title) issues.push({ severity: 'blocker', field: 'title', messageUk: 'Назва книги не заповнена.' });
  if (!description) {
    issues.push({ severity: 'blocker', field: 'description', messageUk: 'Опис книги не заповнений.' });
  } else if (description.length > MAX_DESCRIPTION_CHARS) {
    issues.push({
      severity: 'blocker',
      field: 'description',
      messageUk: `Опис має ${description.length} символів — KDP приймає до ${MAX_DESCRIPTION_CHARS}.`,
    });
  }
  if (keywords.length < KEYWORD_SLOTS) {
    issues.push({
      severity: 'warning',
      field: 'keywords',
      messageUk: `Заповнено ${keywords.length} із ${KEYWORD_SLOTS} полів ключових слів. Порожні поля — це втрачений пошуковий трафік.`,
    });
  }
  if (keywords.length > KEYWORD_SLOTS) {
    issues.push({
      severity: 'blocker',
      field: 'keywords',
      messageUk: `Ключових слів ${keywords.length}, а полів у KDP рівно ${KEYWORD_SLOTS}.`,
    });
  }
  for (const keyword of keywords) {
    if (keyword.length > MAX_KEYWORD_CHARS) {
      issues.push({
        severity: 'warning',
        field: 'keywords',
        messageUk: `Ключова фраза «${keyword}» довша за ${MAX_KEYWORD_CHARS} символів — KDP обріже її.`,
      });
    }
  }
  if (!bisac.length) {
    issues.push({ severity: 'warning', field: 'bisac', messageUk: 'Не вибрано жодної категорії BISAC.' });
  }
  if (bisac.length > MAX_BISAC_CATEGORIES) {
    issues.push({
      severity: 'blocker',
      field: 'bisac',
      messageUk: `Категорій ${bisac.length}, а KDP дозволяє ${MAX_BISAC_CATEGORIES}.`,
    });
  }

  const trim = input.trimId ? findTrimSize(input.trimId) : undefined;
  const cover = trim && input.pageCount
    ? calculateFullCover({ trimId: trim.id, pageCount: input.pageCount, paper: input.paper })
    : undefined;

  const fields: Record<string, string> = {
    'Назва (Title)': title,
    'Підзаголовок (Subtitle)': input.subtitle?.trim() || '—',
    'Автор (Author)': input.authorName?.trim() || '—',
    'Мова (Language)': input.language || 'Ukrainian',
    'ISBN': input.isbn?.trim() || 'Безкоштовний ISBN від KDP',
    'Опис (Description)': description,
    'Ключові слова (7 полів)': keywords.length
      ? keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')
      : '—',
    'Категорії (BISAC)': bisac.length ? bisac.join('\n') : '—',
    'Трим-розмір': trim ? trim.label : '—',
    'Папір': input.paper === 'cream' ? 'Cream' : input.paper === 'color' ? 'Color' : 'White',
    'Сторінок': input.pageCount ? String(input.pageCount) : '—',
    'Корінець': cover ? `${cover.spineMm} мм (${cover.spineInches}″)` : '—',
    'Макет обкладинки': cover
      ? `${cover.widthMm} × ${cover.heightMm} мм · ${cover.widthPx} × ${cover.heightPx} px за ${cover.dpi} dpi`
      : '—',
  };

  const lines: string[] = [
    'МЕТАДАНІ ДЛЯ КАБІНЕТУ AMAZON KDP',
    '================================',
    '',
    'Скопіюйте значення поле за полем у форму KDP. Автоматичне завантаження',
    'неможливе: офіційного API для публікації в KDP не існує, а обхідні шляхи',
    'порушують умови Amazon.',
    '',
  ];
  for (const [label, value] of Object.entries(fields)) {
    lines.push(`${label}:`);
    lines.push(value);
    lines.push('');
  }
  if (issues.length) {
    lines.push('ЩО ВАРТО ВИПРАВИТИ ПЕРЕД ЗАВАНТАЖЕННЯМ');
    lines.push('--------------------------------------');
    for (const issue of issues) {
      lines.push(`${issue.severity === 'blocker' ? '[!]' : '[·]'} ${issue.messageUk}`);
    }
    lines.push('');
  }

  return { text: lines.join('\n'), issues, fields };
}
