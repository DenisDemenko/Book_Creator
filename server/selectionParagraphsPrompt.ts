/**
 * Промпт «Виділений фрагмент → абзац(и)» — НОВИЙ модуль ядра.
 *
 * Задум (завдання 3б): письменник виділяє шматок тексту прямо в книзі,
 * тисне праву кнопку й обирає «Вставити абзац згенерованого ШІ тексту на
 * основі виділеного фрагмента». Система копіює саме виділення, шле його
 * моделі разом із заздалегідь підготовленим промтом і вставляє відповідь
 * блоком «AI-чернетка» одразу ПІД виділенням — так само, як це вже працює
 * для правого кліку по зображенню (server/manuscriptImagePrompt.ts).
 *
 * Чому окремий файл, а не гілка в manuscriptImagePrompt.ts: там вхід —
 * зображення (модель має його *побачити*), тут — текст. Спільного між ними
 * лише формат виходу; змішувати два різні входи в одному промті означало б
 * тримати половину інструкцій вимкненими на кожному виклику.
 *
 * Промт редагується адміном у конструкторі «Ядро AI» (модуль
 * `selectionToParagraphs`) — саме цього вимагало завдання: текст інструкції
 * має бути видним і правленим із панелі адміністратора, а не зашитим у код.
 */

export type SelectionTextLanguage = 'uk' | 'en';
export type SelectionParagraphCount = 1 | 2 | 3;

export interface SelectionParagraphsPromptValues {
  /** Те, що письменник виділив у книзі. Обов'язкове — без нього модулю нема з чим працювати. */
  selection: string;
  language?: SelectionTextLanguage;
  paragraphCount?: SelectionParagraphCount;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  /** Файл стилю автора (user_styles.content_md) — той самий, що й в інших модулях. */
  styleGuide?: string;
  /** Текст одразу ПІСЛЯ виділення — щоб вставка підводила до нього, а не суперечила. */
  contextAfter?: string;
  /**
   * Обсяг у словах. Зазвичай виводиться з кількості абзаців, але адмін може
   * задати власний у тестовому виклику конструктора — інакше поле «Обсяг»
   * у формі виглядало б робочим, а насправді ігнорувалось.
   */
  wordBudget?: string;
}

/** Ті самі бюджети слів, що й у промті за зображенням, — вставка має бути співмірною. */
const WORD_BUDGET: Record<SelectionParagraphCount, string> = {
  1: '70-110',
  2: '150-230',
  3: '230-340',
};

const MAX_STYLE_GUIDE_CHARS = 3000;
/** Виділити можна хоч цілу главу; у промт іде розумний обсяг, решта — зайві токени без користі для однієї вставки. */
const MAX_SELECTION_CHARS = 6000;
const MAX_CONTEXT_CHARS = 700;

export function selectionParagraphsSystemInstruction(): string {
  return 'Ти — професійний український літературний редактор і письменник-співавтор.';
}

/** Заводський шаблон промту користувача — абзац із порожнім плейсхолдером зникає цілком. */
export function factorySelectionParagraphsTemplate(): string {
  return [
    'Перед тобою фрагмент рукопису книги «{НАЗВА_КНИГИ}», який автор виділив у редакторі.',
    'Жанр: {ЖАНР}.',
    'Розділ: {РОЗДІЛ}.',
    'Ось аналіз авторського стилю цього письменника — пиши СУВОРО в цій манері, зберігаючи лексику, ' +
      'ритм речень і характерні звороти:\n"""\n{СТИЛЬ}\n"""',
    'ВИДІЛЕНИЙ ФРАГМЕНТ:\n"""\n{ФРАГМЕНТ}\n"""',
    'Ось текст, що йде ОДРАЗУ ПІСЛЯ виділення — нова вставка має плавно підвести розповідь до нього, ' +
      'не суперечачи й не повторюючи його зміст:\n"""\n{КОНТЕКСТ_ПІСЛЯ}\n"""',
    'Спираючись на виділений фрагмент, напиши {КІЛЬКІСТЬ_АБЗАЦІВ} мовою {МОВА} (орієнтовно {ОБСЯГ} слів), ' +
      'що продовжують і розвивають саме цю сцену: поглиблюють образи, додають чуттєві деталі, рух і ' +
      'внутрішній стан героїв. Не переказуй виділене іншими словами — розвивай його далі. ' +
      'Пиши як готовий фрагмент книги: без заголовків, без списків, без службових приміток і пояснень — ' +
      'лише сам текст. Розділяй абзаци порожнім рядком.',
  ].join('\n\n');
}

const COUNT_WORD_UK: Record<SelectionParagraphCount, string> = {
  1: 'ОДИН абзац',
  2: 'ДВА абзаци',
  3: 'ТРИ абзаци',
};

const COUNT_WORD_EN: Record<SelectionParagraphCount, string> = {
  1: 'ONE paragraph',
  2: 'TWO paragraphs',
  3: 'THREE paragraphs',
};

/** Підставляє значення; абзац, що тримається лише на порожньому плейсхолдері, зникає. */
export function renderSelectionParagraphsTemplate(
  template: string,
  values: SelectionParagraphsPromptValues
): string {
  const count: SelectionParagraphCount = values.paragraphCount ?? 1;
  const language: SelectionTextLanguage = values.language ?? 'uk';

  const map: Record<string, string | undefined> = {
    '{НАЗВА_КНИГИ}': values.bookTitle?.trim() || 'без назви',
    '{ЖАНР}': values.genre?.trim() || undefined,
    '{РОЗДІЛ}': values.chapterTitle?.trim() || undefined,
    '{СТИЛЬ}': values.styleGuide?.trim().slice(0, MAX_STYLE_GUIDE_CHARS) || undefined,
    '{ФРАГМЕНТ}': values.selection?.trim().slice(0, MAX_SELECTION_CHARS) || '',
    '{КОНТЕКСТ_ПІСЛЯ}': values.contextAfter?.trim().slice(0, MAX_CONTEXT_CHARS) || undefined,
    '{КІЛЬКІСТЬ_АБЗАЦІВ}': language === 'en' ? COUNT_WORD_EN[count] : COUNT_WORD_UK[count],
    '{ОБСЯГ}': values.wordBudget?.trim() || WORD_BUDGET[count],
    '{МОВА}': language === 'en' ? 'АНГЛІЙСЬКОЮ' : 'УКРАЇНСЬКОЮ',
  };

  const paragraphs = template.split(/\n{2,}/);
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const tokens = Object.keys(map).filter((tk) => paragraph.includes(tk));
    const missing = tokens.filter((tk) => map[tk] === undefined);
    // Абзац, у якому ВСІ плейсхолдери порожні, не має що сказати — прибираємо
    // його цілком, замість лишати «Жанр: .» голим рядком.
    if (tokens.length > 0 && missing.length === tokens.length) continue;
    let text = paragraph;
    for (const tk of tokens) text = text.split(tk).join(map[tk] ?? '');
    kept.push(text.trim());
  }
  return kept.filter(Boolean).join('\n\n');
}

/** Заводська поведінка (адмін ще не чіпав шаблон). */
export function buildSelectionParagraphsPrompt(values: SelectionParagraphsPromptValues): {
  system: string;
  user: string;
} {
  return {
    system: selectionParagraphsSystemInstruction(),
    user: renderSelectionParagraphsTemplate(factorySelectionParagraphsTemplate(), values),
  };
}
