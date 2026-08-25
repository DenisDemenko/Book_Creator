/**
 * Шаблони промтів для «Конструктора промтів» (вкладка в AI-асистенті).
 *
 * Три шари, від найспецифічнішого до найзагальнішого:
 *   1. шаблон АВТОРА       — таблиця user_prompt_templates (server/db.ts);
 *   2. дефолт АДМІНА       — ключ у таблиці meta, один на всю систему;
 *   3. ЗАВОДСЬКИЙ шаблон   — константи нижче, з яких і починався проєкт.
 *
 * Кнопка «Відновити налаштування адміна» в конструкторі просто прибирає
 * шар (1), після чого автор знову бачить (2), а якщо адмін нічого не
 * змінював — (3).
 *
 * Шаблонів по одному на кожну кількість абзаців (1, 2, 3): автор редагує
 * живий ТЕКСТ промту, а текст не параметризується числом — «напиши ОДИН
 * абзац» і «напиши ТРИ абзаци» це різні інструкції з різними бюджетами
 * слів і різним ритмом. Мова натомість лишається параметром усередині
 * шаблону (плейсхолдер {МОВА}).
 */

import type { ManuscriptTextLanguage, ManuscriptParagraphCount } from './manuscriptImagePrompt.ts';
import { buildManuscriptImagePrompt, manuscriptImageSystemInstruction } from './manuscriptImagePrompt.ts';

/** Ключ у таблиці `meta`, під яким лежить глобальний (адмінський) шар. */
export const PROMPT_TEMPLATES_META_KEY = 'prompt_templates_admin';

/** Стеля довжини одного поля шаблону. Промпт оплачується токенами, тож нескінченним він бути не може. */
export const MAX_TEMPLATE_CHARS = 8000;

export interface PromptTemplate {
  /** Системна інструкція («ти — редактор і письменник-співавтор»). */
  system: string;
  /** Промпт користувача — той, у якому й живуть плейсхолдери. */
  user: string;
}

/** Набір шаблонів одного конструктора: по одному на 1, 2 і 3 абзаци. */
export interface PromptTemplateSet {
  '1': PromptTemplate;
  '2': PromptTemplate;
  '3': PromptTemplate;
}

/** Усі конструктори разом (наразі один — аналіз фото; далі додадуться чат, KDP тощо). */
export interface PromptTemplateBundle {
  manuscriptPhoto?: Partial<PromptTemplateSet>;
}

/**
 * Значення, які сервер підставляє замість плейсхолдерів.
 * `undefined` означає «цих даних немає» — тоді плейсхолдер прибирається
 * разом із порожнім рядком навколо, щоб у промпті не лишалось дір.
 */
export interface PromptPlaceholderValues {
  language: ManuscriptTextLanguage;
  paragraphCount: ManuscriptParagraphCount;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  /** Підпис під картинкою, який автор написав у рукописі. */
  imageCaption?: string;
  styleGuide?: string;
  contextBefore?: string;
  contextAfter?: string;
}

/** Бюджет слів на кількість абзаців — той самий, що в заводському промпті. */
const WORD_BUDGET: Record<ManuscriptParagraphCount, string> = {
  1: '70-110',
  2: '150-230',
  3: '230-340',
};

const LANGUAGE_NAME: Record<ManuscriptTextLanguage, string> = {
  uk: 'УКРАЇНСЬКОЮ',
  en: 'АНГЛІЙСЬКОЮ (English)',
};

const PARAGRAPH_WORD: Record<ManuscriptParagraphCount, string> = {
  1: 'ОДИН абзац',
  2: 'ДВА абзаци',
  3: 'ТРИ абзаци',
};

/**
 * Плейсхолдери — українською, бо конструктор україномовний, і латиниця
 * посеред українського промту читалась би як сміття.
 *
 * Порядок має значення лише для документації; підстановка йде по точному
 * збігу токена, тож `{КОНТЕКСТ_ДО}` і `{КОНТЕКСТ_ПІСЛЯ}` не конфліктують.
 */
export const PLACEHOLDERS = [
  '{МОВА}',
  '{КІЛЬКІСТЬ_АБЗАЦІВ}',
  '{СЛІВ}',
  '{НАЗВА_КНИГИ}',
  '{ЖАНР}',
  '{РОЗДІЛ}',
  '{ПІДПИС_ФОТО}',
  '{СТИЛЬ}',
  '{КОНТЕКСТ_ДО}',
  '{КОНТЕКСТ_ПІСЛЯ}',
] as const;

export type PlaceholderToken = (typeof PLACEHOLDERS)[number];

/** Заводські шаблони: рівно той промпт, який сервер будував до появи конструктора, лише з плейсхолдерами замість підстановок. */
export function factoryTemplate(count: ManuscriptParagraphCount): PromptTemplate {
  return {
    system: manuscriptImageSystemInstruction('uk'),
    user: [
      // {ЖАНР} і {РОЗДІЛ} — ОКРЕМІ абзаци, а не частина речення з
      // {НАЗВА_КНИГИ}: остання завжди заповнена («без назви» дефолтом), а
      // «зникає, якщо порожньо» діє на рівні цілого абзацу (renderTemplate
      // нижче). В одному реченні порожній жанр лишив би по собі биту фразу
      // «у жанрі «»» замість того, щоб зникнути цілком.
      'Ти — досвідчений письменник-співавтор. Перед тобою фотографія/ілюстрація, вставлена в текст ' +
        'книги «{НАЗВА_КНИГИ}».',
      'Жанр: {ЖАНР}.',
      'Розділ: {РОЗДІЛ}.',
      'Підпис під фотографією в рукописі: «{ПІДПИС_ФОТО}».',
      'Ось аналіз авторського стилю цього письменника — пиши СУВОРО в цій манері, зберігаючи лексику, ' +
        'ритм речень і характерні звороти:\n"""\n{СТИЛЬ}\n"""',
      'Ось абзац тексту, що йде БЕЗПОСЕРЕДНЬО ПЕРЕД цим зображенням у рукописі — новий фрагмент має ' +
        'логічно й стилістично продовжувати саме його:\n"""\n{КОНТЕКСТ_ДО}\n"""',
      'А ось абзац, що йде ОДРАЗУ ПІСЛЯ зображення — новий фрагмент має плавно підвести розповідь до ' +
        'нього, не суперечачи й не повторюючи його зміст:\n"""\n{КОНТЕКСТ_ПІСЛЯ}\n"""',
      'Уважно роздивись зображення і напиши {МОВА} мовою {КІЛЬКІСТЬ_АБЗАЦІВ} художньої прози ' +
        '({СЛІВ} слів разом), що продовжує розповідь і спирається на деталі з зображення — атмосферу, ' +
        'обстановку, дії, деталі, які можна прочитати з картинки. Пиши як фрагмент готового тексту ' +
        'книги: без заголовків, без списків, без службових приміток чи пояснень — лише сам текст, ' +
        'готовий для вставки в рукопис. Розділяй абзаци порожнім рядком.',
    ].join('\n\n'),
  };
}

export function factoryTemplateSet(): PromptTemplateSet {
  return { '1': factoryTemplate(1), '2': factoryTemplate(2), '3': factoryTemplate(3) };
}

/**
 * Зводить три шари в один шаблон. Порожній рядок у шарі трактується як
 * «нічого не задано» — інакше автор, який випадково стер поле, мовчки
 * отримав би запит без промту взагалі (узгоджено: порожній шаблон тихо
 * відкочується на дефолт).
 */
export function resolveTemplate(
  count: ManuscriptParagraphCount,
  userLayer?: PromptTemplateBundle,
  adminLayer?: PromptTemplateBundle
): PromptTemplate {
  const key = String(count) as '1' | '2' | '3';
  const factory = factoryTemplate(count);
  const admin = adminLayer?.manuscriptPhoto?.[key];
  const user = userLayer?.manuscriptPhoto?.[key];

  const pick = (field: keyof PromptTemplate): string =>
    user?.[field]?.trim() || admin?.[field]?.trim() || factory[field];

  return { system: pick('system'), user: pick('user') };
}

/** Чи є в тексті хоч один відомий плейсхолдер — конструктор попереджає автора, якщо жодного не лишилось. */
export function usedPlaceholders(text: string): PlaceholderToken[] {
  return PLACEHOLDERS.filter((p) => text.includes(p));
}

const MAX_STYLE_GUIDE_CHARS = 3000;
const MAX_CONTEXT_PARAGRAPH_CHARS = 700;

/**
 * Підставляє значення в шаблон.
 *
 * Плейсхолдер, для якого немає даних (не кожне фото стоїть між двома
 * абзацами, не кожен автор має файл стилю), прибирається РАЗОМ зі своїм
 * абзацом: інакше в промпті лишались би висячі підводки на кшталт
 * «Ось аналіз авторського стилю:» з порожніми лапками під ними, і модель
 * чесно намагалась би на них відповісти.
 */
export function renderTemplate(template: string, values: PromptPlaceholderValues): string {
  const map: Record<PlaceholderToken, string | undefined> = {
    '{МОВА}': LANGUAGE_NAME[values.language],
    '{КІЛЬКІСТЬ_АБЗАЦІВ}': PARAGRAPH_WORD[values.paragraphCount],
    '{СЛІВ}': WORD_BUDGET[values.paragraphCount],
    '{НАЗВА_КНИГИ}': values.bookTitle?.trim() || 'без назви',
    '{ЖАНР}': values.genre?.trim() || undefined,
    '{РОЗДІЛ}': values.chapterTitle?.trim() || undefined,
    '{ПІДПИС_ФОТО}': values.imageCaption?.trim() || undefined,
    '{СТИЛЬ}': values.styleGuide?.trim().slice(0, MAX_STYLE_GUIDE_CHARS) || undefined,
    '{КОНТЕКСТ_ДО}': values.contextBefore?.trim().slice(-MAX_CONTEXT_PARAGRAPH_CHARS) || undefined,
    '{КОНТЕКСТ_ПІСЛЯ}': values.contextAfter?.trim().slice(0, MAX_CONTEXT_PARAGRAPH_CHARS) || undefined,
  };

  const paragraphs = template.split(/\n{2,}/);
  const kept: string[] = [];

  for (const paragraph of paragraphs) {
    const tokens = usedPlaceholders(paragraph);
    const missing = tokens.filter((tk) => map[tk] === undefined);
    // Абзац, який тримається ЛИШЕ на порожньому плейсхолдері, викидаємо цілком.
    if (missing.length > 0 && tokens.length === missing.length) continue;

    let text = paragraph;
    for (const tk of tokens) {
      text = text.split(tk).join(map[tk] ?? '');
    }
    kept.push(text.trim());
  }

  return kept.filter(Boolean).join('\n\n');
}

/**
 * Повний промпт для запиту до моделі. Якщо шаблон (після зведення шарів)
 * не містить жодного плейсхолдера, це легальний вибір автора — просто
 * віддаємо текст як є; попередження про це показує конструктор, а не сервер.
 */
export function buildPromptFromTemplate(
  template: PromptTemplate,
  values: PromptPlaceholderValues
): { system: string; user: string } {
  return {
    system: renderTemplate(template.system, values).slice(0, MAX_TEMPLATE_CHARS),
    user: renderTemplate(template.user, values).slice(0, MAX_TEMPLATE_CHARS),
  };
}

/**
 * Запасний шлях: якщо шарів немає взагалі (гість — у нього немає user_id,
 * тож і шаблону в БД бути не може), користуємось тим самим кодом, що й
 * до появи конструктора. Так гість не втрачає саму функцію генерації.
 */
export function buildFactoryPrompt(values: PromptPlaceholderValues): { system: string; user: string } {
  return {
    system: manuscriptImageSystemInstruction(values.language),
    user: buildManuscriptImagePrompt({
      language: values.language,
      paragraphCount: values.paragraphCount,
      bookTitle: values.bookTitle,
      genre: values.genre,
      chapterTitle: values.chapterTitle,
      styleGuide: values.styleGuide,
      contextBefore: values.contextBefore,
      contextAfter: values.contextAfter,
    }),
  };
}
