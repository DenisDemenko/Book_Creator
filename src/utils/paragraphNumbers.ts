/**
 * Правила тега номера абзацу `[/paragraph:#N]` — спільні для разового прогону
 * по книзі (`autoTags.ts`) і для редактора (`ParagraphNumberPlugin.ts`).
 *
 * ПРАВИЛО ВЛАСНИКА (03.11.2026): «при створенні нового абзацу повинен
 * автоматично створюватися його тег номера. Але якщо абзац порожній — без
 * тексту, без картинок — ця тега автоматично повинна прибиратися».
 *
 *   • Абзац Є, коли в ньому є видимий текст (теги в рахунок не йдуть: абзац, у
 *     якому лишились самі теги, порожній) або вставний вузол — зображення.
 *   • Непорожній абзац без тега дістає його. Порожній — втрачає.
 *   • В абзаці не більше одного тега номера: другий (після злиття двох абзаців)
 *     прибирається, лишається перший.
 *   • Номер у книзі єдиний: повтор (скопійований абзац) дістає новий номер.
 *
 * ЧОМУ НУМЕРУЮТЬСЯ ЛИШЕ ЗВИЧАЙНІ АБЗАЦИ. Заголовок (`#`), цитата (`>`), таблиця,
 * розділювач, ілюстрація й чернетка ШІ — це блоки, чий текст читає власний
 * розбір маркерів. Тег на початку таблиці чи між `[AI-DRAFT]` зламав би їх. А
 * заголовок — це назва, а не абзац: тег усередині неї потрапив би в зміст.
 *
 * ЩО ТУТ НЕ РІШАЄТЬСЯ. Де в тексті стоїть тег і як він малюється — справа
 * плагіна; тут лише аналіз одного абзацу, який можна перевірити без редактора.
 */

import { buildEntityTag, parseEntityTagsInSource, parseEntityValue, stripEntityTags } from './coreEntities';

export const PARAGRAPH_TAG_SLUG = 'paragraph';

/**
 * Блок, що не є звичайним абзацом: заголовок, цитата, ілюстрація, розділювач,
 * таблиця, межі чернетки ШІ. Маркери — ті самі, що пише `tiptapDocToMarkerBlocks`.
 */
const SPECIAL_BLOCK = /^\s*(?:#{1,3}\s|>|\[(?:IMG:|DIVIDER\]|TABLE\]|\/?AI-DRAFT\]|AI-GENERATED:|\/AI-GENERATED\]))/;
const DRAFT_OPEN = /^\s*\[(?:AI-DRAFT\]|AI-GENERATED:[^\]\r\n]*\])\s*$/;
const DRAFT_CLOSE = /^\s*\[(?:\/AI-DRAFT|\/AI-GENERATED)\]\s*$/;

/**
 * Для кожного блока розділу: чи це звичайний абзац. Блоки МІЖ відкриттям і
 * закриттям чернетки ШІ — теж не звичайні: вони живуть усередині вузла
 * чернетки, а не серед абзаців розділу.
 */
export function plainParagraphFlags(blocks: readonly string[]): boolean[] {
  let inDraft = false;
  return blocks.map((block) => {
    if (DRAFT_OPEN.test(block)) {
      inDraft = true;
      return false;
    }
    if (DRAFT_CLOSE.test(block)) {
      inDraft = false;
      return false;
    }
    if (inDraft) return false;
    return !SPECIAL_BLOCK.test(block);
  });
}

/** Скільки символів на початку абзацу займають теги підряд (разом з пропусками між ними). */
const LEADING_TAGS = /^(?:\s*\[[^\]]*\])*/;

export interface ParagraphNumberTag {
  start: number;
  end: number;
  /** Кінець діапазону для видалення: разом з одним пропуском після тега, якщо він є. */
  removeEnd: number;
  /** Номер екземпляра з `#N`; `null`, якщо тег стоїть без номера. */
  number: number | null;
}

export interface ParagraphAnalysis {
  /** Немає ні видимого тексту, ні вставних вузлів. */
  empty: boolean;
  /** Теги `paragraph` в абзаці, у порядку тексту. */
  tags: ParagraphNumberTag[];
  /** Де закінчується серія тегів на початку абзацу — сюди ляже новий тег. */
  leadEnd: number;
}

/**
 * Аналіз одного абзацу за його текстом (із тегами). `hasInlineContent` каже,
 * що абзац містить вставні вузли (зображення) — вони роблять його непорожнім,
 * хоч тексту в ньому немає.
 */
export function analyzeParagraph(text: string, hasInlineContent = false): ParagraphAnalysis {
  const visible = stripEntityTags(text).trim();
  // «Наш» тег — без імені: порожній чи `#N`. `[/paragraph:Вступ]` — сутність, яку
  // автор назвав сам; автоматика її не рахує, не прибирає й не перенумеровує.
  const tags = parseEntityTagsInSource(text)
    .filter((t) => t.entity && t.slug === PARAGRAPH_TAG_SLUG && parseEntityValue(PARAGRAPH_TAG_SLUG, t.value).text === '')
    .map((t) => ({
      start: t.start,
      end: t.end,
      removeEnd: text[t.end] === ' ' ? t.end + 1 : t.end,
      number: parseEntityValue(PARAGRAPH_TAG_SLUG, t.value).instance ?? null,
    }));
  return {
    empty: visible === '' && !hasInlineContent,
    tags,
    leadEnd: LEADING_TAGS.exec(text)?.[0].length ?? 0,
  };
}

/** Текст нового тега номера з пропуском після нього, коли далі йде текст. */
export function paragraphNumberTagText(n: number, opts: { spaceBefore?: boolean; spaceAfter?: boolean } = {}): string {
  return `${opts.spaceBefore ? ' ' : ''}${buildEntityTag(PARAGRAPH_TAG_SLUG, `#${n}`)}${opts.spaceAfter === false ? '' : ' '}`;
}

/** Номери тегів `paragraph` у тексті розділу (для лічильника й перевірки повторів). */
export function paragraphNumbersIn(content: string): number[] {
  const out: number[] = [];
  for (const t of parseEntityTagsInSource(content)) {
    if (!t.entity || t.slug !== PARAGRAPH_TAG_SLUG) continue;
    const parsed = parseEntityValue(PARAGRAPH_TAG_SLUG, t.value);
    if (parsed.text === '' && parsed.instance !== undefined) out.push(parsed.instance);
  }
  return out;
}

/** Мінімум від книги, потрібний індексу: розділи з ідентифікатором і текстом. */
export interface NumberIndexBook {
  chapters?: Array<{ sections?: Array<{ id?: string; content?: string }> }>;
}

/**
 * Індекс номерів абзаців ІНШИХ розділів: найбільший і набір використаних.
 *
 * ЧОМУ З КЕШЕМ. Плагін питає цей індекс після кожної правки, що зачепила
 * абзац, а книга на 600 тисяч знаків — це кілька мільйонів символів для
 * регулярного виразу на кожне натискання клавіші. Кеш тримає номери кожного
 * розділу разом із текстом, з якого їх прочитано, і перечитує лише той розділ,
 * чий текст змінився. Розділ, що редагується просто зараз, у підрахунок не
 * входить: плагін читає його з живого документа, а збережена копія відстає.
 *
 * Розділ без `id` не кешується — інакше всі такі розділи ділили б один запис.
 */
export function createOtherNumbersIndex() {
  const cache = new Map<string, { content: string; numbers: number[] }>();
  return (book: NumberIndexBook, excludeSectionId?: string): { max: number; used: Set<number> } => {
    const used = new Set<number>();
    let max = 0;
    for (const chapter of book.chapters ?? []) {
      for (const section of chapter.sections ?? []) {
        if (section.id && section.id === excludeSectionId) continue;
        const content = section.content ?? '';
        let numbers: number[];
        if (section.id) {
          let entry = cache.get(section.id);
          if (!entry || entry.content !== content) {
            entry = { content, numbers: paragraphNumbersIn(content) };
            cache.set(section.id, entry);
          }
          numbers = entry.numbers;
        } else {
          numbers = paragraphNumbersIn(content);
        }
        for (const n of numbers) {
          used.add(n);
          if (n > max) max = n;
        }
      }
    }
    return { max, used };
  };
}
