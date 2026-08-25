/**
 * Промпт для «Проаналізувати фото і згенерувати AI текст книги» — правий
 * клік на вставленому в текст зображенні (WrappedImageNode.tsx), окремо від
 * server/textFromImage.ts (те саме за духом, але той модуль писав ЛИШЕ
 * українською й лише для окремого вікна на вкладці «Ілюстрації»; тут текст
 * одразу вставляється в рукопис — тому потрібна конкретна кількість абзаців
 * і мова саме того редактора (UA/EN), де стоїть курсор).
 *
 * Розширено (за проханням користувача): промпт тепер спирається на:
 *   • «файл стилю» автора (server/db.ts::user_styles, `content_md`) — AI-аналіз
 *     авторської манери письма, той самий контент, що вже підмішується в
 *     системний промпт чат-асистента (server/chatRoutes.ts::buildSystemPrompt);
 *   • абзац тексту БЕЗПОСЕРЕДНЬО ПЕРЕД зображенням і абзац ОДРАЗУ ПІСЛЯ —
 *     щоб згенерований фрагмент логічно й стилістично продовжував те, що
 *     вже написано навколо картинки, а не був відірваною вставкою.
 * Обидва — опційні (не всі фото стоять між двома абзацами, не кожен автор
 * уже сформував файл стилю).
 */

export type ManuscriptTextLanguage = 'uk' | 'en';
export type ManuscriptParagraphCount = 1 | 2 | 3;

export interface ManuscriptImagePromptOptions {
  language: ManuscriptTextLanguage;
  paragraphCount: ManuscriptParagraphCount;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  /** Файл стилю автора (user_styles.content_md) — вирізаний до розумної довжини, як і в чат-асистенті. */
  styleGuide?: string;
  /** Абзац тексту книги одразу ПЕРЕД зображенням (звичайний текст, без маркерів — TipTap textContent). */
  contextBefore?: string;
  /** Абзац тексту книги одразу ПІСЛЯ зображення. */
  contextAfter?: string;
}

const WORD_BUDGET: Record<ManuscriptParagraphCount, string> = {
  1: '70-110',
  2: '150-230',
  3: '230-340',
};

/** Той самий ліміт, що й для styleGuide у чат-асистенті (server/chatRoutes.ts::buildSystemPrompt) — довгий файл стилю не повинен роздувати запит. */
const MAX_STYLE_GUIDE_CHARS = 3000;
/** Абзаци-сусіди зображення йдуть як контекст, не як вихідний матеріал для копіювання — досить останніх/перших речень, не всього абзацу, якщо він дуже довгий. */
const MAX_CONTEXT_PARAGRAPH_CHARS = 700;

export function manuscriptImageSystemInstruction(language: ManuscriptTextLanguage): string {
  return language === 'en'
    ? 'You are a professional literary editor and co-writing novelist.'
    : 'Ти — професійний український літературний редактор і письменник-співавтор.';
}

export function buildManuscriptImagePrompt(opts: ManuscriptImagePromptOptions): string {
  const count = opts.paragraphCount;
  const words = WORD_BUDGET[count];
  const styleGuide = opts.styleGuide?.trim().slice(0, MAX_STYLE_GUIDE_CHARS);
  const contextBefore = opts.contextBefore?.trim().slice(-MAX_CONTEXT_PARAGRAPH_CHARS);
  const contextAfter = opts.contextAfter?.trim().slice(0, MAX_CONTEXT_PARAGRAPH_CHARS);

  if (opts.language === 'en') {
    const countWord = count === 1 ? 'ONE paragraph' : count === 2 ? 'TWO paragraphs' : 'THREE paragraphs';
    const parts = [
      `You are an experienced co-writing novelist. Below is a photo/illustration inserted into the manuscript ` +
        `of the book "${opts.bookTitle || 'Untitled'}"${opts.genre ? ` (genre: ${opts.genre})` : ''}` +
        `${opts.chapterTitle ? `, chapter "${opts.chapterTitle}"` : ''}.`,
    ];
    if (styleGuide) {
      parts.push(
        `Here is an analysis of this author's writing style — write strictly in this voice, matching its ` +
          `vocabulary, sentence rhythm, and recurring devices:\n"""\n${styleGuide}\n"""`
      );
    }
    if (contextBefore) {
      parts.push(
        `Here is the paragraph that comes IMMEDIATELY BEFORE this image in the manuscript — your new text must ` +
          `pick up naturally from where it leaves off, matching tone and continuity:\n"""\n${contextBefore}\n"""`
      );
    }
    if (contextAfter) {
      parts.push(
        `Here is the paragraph that comes IMMEDIATELY AFTER this image in the manuscript — your new text must ` +
          `lead smoothly into it, without contradicting or repeating its content:\n"""\n${contextAfter}\n"""`
      );
    }
    parts.push(
      `Look closely at the image and write ${countWord} of literary prose in ENGLISH (${words} words total) that ` +
        `continues the scene the photo suggests — mood, setting, action, sensory detail visible in the picture` +
        `${contextBefore || contextAfter ? ', bridging the surrounding text above' : ''}. ` +
        `Write it as a ready-to-insert fragment of the finished book: no headings, no lists, no meta-commentary — ` +
        `just the prose itself. Separate paragraphs with a single blank line.`
    );
    return parts.join('\n\n');
  }

  const countWord = count === 1 ? 'ОДИН абзац' : count === 2 ? 'ДВА абзаци' : 'ТРИ абзаци';
  const parts = [
    `Ти — досвідчений український письменник-співавтор. Перед тобою фотографія/ілюстрація, вставлена в текст ` +
      `книги «${opts.bookTitle || 'без назви'}»${opts.genre ? ` у жанрі «${opts.genre}»` : ''}` +
      `${opts.chapterTitle ? `, розділ «${opts.chapterTitle}»` : ''}.`,
  ];
  if (styleGuide) {
    parts.push(
      `Ось аналіз авторського стилю цього письменника — пиши СУВОРО в цій манері, зберігаючи лексику, ` +
        `ритм речень і характерні звороти:\n"""\n${styleGuide}\n"""`
    );
  }
  if (contextBefore) {
    parts.push(
      `Ось абзац тексту, що йде БЕЗПОСЕРЕДНЬО ПЕРЕД цим зображенням у рукописі — новий фрагмент має логічно й ` +
        `стилістично продовжувати саме його, зберігаючи тон і безперервність розповіді:\n"""\n${contextBefore}\n"""`
    );
  }
  if (contextAfter) {
    parts.push(
      `А ось абзац, що йде ОДРАЗУ ПІСЛЯ зображення — новий фрагмент має плавно підвести розповідь до нього, ` +
        `не суперечачи й не повторюючи його зміст:\n"""\n${contextAfter}\n"""`
    );
  }
  parts.push(
    `Уважно роздивись зображення і напиши УКРАЇНСЬКОЮ мовою ${countWord} художньої прози (${words} слів разом), ` +
      `що продовжує розповідь і спирається на деталі з зображення — атмосферу, обстановку, дії, деталі, які ` +
      `можна прочитати з картинки${contextBefore || contextAfter ? ', природно з\'єднуючи текст навколо зображення' : ''}. ` +
      `Пиши як фрагмент готового тексту книги: без заголовків, без списків, без службових приміток чи пояснень — ` +
      `лише сам текст, готовий для вставки в рукопис. Розділяй абзаци порожнім рядком.`
  );
  return parts.join('\n\n');
}
