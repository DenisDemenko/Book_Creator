/**
 * Автоматичні теги рівня ТИПУ з нумерацією екземплярів (постановка власника
 * 03.11.2026): Jev каже, які з 118 типів сутностей є в абзаці з ймовірністю не
 * менше 95%, а тут ці теги лягають у книгу з номерами, за якими їх швидко
 * знайти.
 *
 * ЧОМУ ТЕГ РІВНЯ ТИПУ БЕЗ ІМЕНІ. Jev відповідає на питання «чи є в абзаці
 * ознаки сутності цього ТИПУ». Він не називає, яка саме емоція чи яка локація:
 * `[/emotion:]` означає «тут є емоційний стан», а не «тут страх». Придумувати
 * ім'я — значить видавати здогад моделі за її відповідь.
 *
 * ЧОМУ ТАКІ ТЕГИ БЕЗ НОМЕРА БУЛИ Б БЕЗКОРИСНІ. Сотні однакових `[/emotion:]` у
 * книзі нічим не відрізняються: знайти «той самий» тег чи послатись на нього в
 * розмові неможливо. Тому кожен отримує номер екземпляра в значенні:
 * `[/emotion:#17]` — сімнадцятий такий тег у книзі.
 *
 *   • ЛІЧИЛЬНИК СВІЙ ДЛЯ КОЖНОГО ТИПУ і йде в порядку книги.
 *   • НОМЕР НІКОЛИ НЕ ПЕРЕНОМЕРОВУЄТЬСЯ. Новий тег отримує max+1 серед тих, що
 *     вже стоять, тож `#17` назавжди називає саме цей екземпляр, навіть якщо
 *     пізніше між тегами вставлять інші. Порядок номерів може розійтись з
 *     порядком у тексті — і це ціна стабільності посилань; пошук усе одно
 *     видає абзаци в порядку книги.
 *   • НОМЕР — ЦЕ НЕ ЧАСТИНА НАЗВИ. Розбір значення (`parseEntityValue`) знімає
 *     хвіст `#N` і віддає його окремо (`instance`), тож ядро не створює сутність
 *     «#17»: тег без імені синхронізація й так пропускає.
 *
 * ТЕГ АБЗАЦУ. У реєстрі 118 є тип `paragraph` («Абзац»). Він кладеться на
 * КОЖЕН текстовий абзац тим самим механізмом, тож `[/paragraph:#412]` — це
 * «абзац №412 у книзі на момент розмітки». Це людський номер для посилань («у
 * абзаці 412…»), а не живий індекс: він не змінюється, коли вставляють нові
 * абзаци. Кладеться ОСТАННІМ, щоб колір абзацу, якщо тло колись повернеться,
 * визначався змістом, а не номером.
 *
 * ЧОМУ СТРУКТУРНІ ТИПИ НЕ ПИТАЮТЬСЯ В Jev. «Чи є в абзаці ознаки абзацу» —
 * завжди так; «чи є в абзаці ознаки глави» — безглуздо. Вісім структурних
 * типів виключені зі сканування, а `paragraph` ставиться напряму.
 *
 * Чиста логіка без мережі й без сховища: працює над об'єктом книги і повертає
 * копію, тож її можна перевіряти, не звертаючись до Jev.
 */

import { paragraphKey, splitParagraphs, type CarrierBook } from './tagCarrier';
import { PARAGRAPH_TAG_SLUG, plainParagraphFlags } from './paragraphNumbers';
import {
  MAX_ENTITIES_PER_PARAGRAPH,
  activeEntities,
  buildEntityTag,
  parseEntityTagsInSource,
  parseEntityValue,
  type CoreEntity,
} from './coreEntities';

/** Структурні типи: у Jev про них не питаємо (див. шапку). */
export const STRUCTURAL_SLUGS: readonly string[] = [
  'project',
  'document',
  'chapter',
  'section',
  'paragraph',
  'content-block',
  'outline',
  'summary',
];

/** Тип тега абзацу — єдиний структурний, який ставиться напряму. */
export const PARAGRAPH_SLUG = PARAGRAPH_TAG_SLUG;

/** Типи, про які питають Jev: усі активні, крім структурних. */
export function scanEntityTypes(): CoreEntity[] {
  return activeEntities().filter((e) => !STRUCTURAL_SLUGS.includes(e.slug));
}

/** Абзац книги разом із місцем: потрібен і для запитів до Jev, і для повернення тегів. */
export interface BookParagraph {
  /** Номер абзацу в книзі, з 1, лише серед текстових (є літера чи цифра). */
  n: number;
  chapterIdx: number;
  sectionIdx: number;
  paraIdx: number;
  chapterTitle: string;
  sectionTitle: string;
  /** Текст разом з тегами, як у рукописі. */
  text: string;
  /** Відбиток видимого тексту (`paragraphKey`): однакові абзаци мають однаковий. */
  key: string;
}

/**
 * Текстові абзаци книги в порядку читання. Беруться лише ЗВИЧАЙНІ абзаци
 * (`plainParagraphFlags`): заголовок, цитата, таблиця, розділювач, ілюстрація й
 * чернетка ШІ — це блоки, чий текст читає власний розбір маркерів, і тег на
 * початку таблиці чи між `[AI-DRAFT]` зламав би їх. Розділювач («***») і
 * ілюстрація до того ж не мають ні літери, ні цифри.
 */
export function listBookParagraphs(book: CarrierBook): BookParagraph[] {
  const out: BookParagraph[] = [];
  (book.chapters ?? []).forEach((chapter, chapterIdx) => {
    (chapter.sections ?? []).forEach((section, sectionIdx) => {
      const blocks = splitParagraphs(section.content);
      const plain = plainParagraphFlags(blocks);
      blocks.forEach((text, paraIdx) => {
        if (!plain[paraIdx]) return;
        const key = paragraphKey(text);
        if (!key) return;
        out.push({
          n: out.length + 1,
          chapterIdx,
          sectionIdx,
          paraIdx,
          chapterTitle: String(chapter.title ?? ''),
          sectionTitle: String(section.title ?? ''),
          text,
          key,
        });
      });
    });
  });
  return out;
}

/** Найбільші номери екземплярів, що вже стоять у книзі, за типами. */
export function instanceCounters(book: CarrierBook): Map<string, number> {
  const counters = new Map<string, number>();
  for (const chapter of book.chapters ?? []) {
    for (const section of chapter.sections ?? []) {
      for (const block of splitParagraphs(section.content)) {
        for (const tag of parseEntityTagsInSource(block)) {
          if (!tag.entity) continue;
          const instance = parseEntityValue(tag.entity, tag.value).instance;
          if (instance !== undefined && instance > (counters.get(tag.slug) ?? 0)) counters.set(tag.slug, instance);
        }
      }
    }
  }
  return counters;
}

/** Що поставити на абзац: типи за спаданням певності Jev. */
export interface AutoTagPick {
  /** `BookParagraph.n`. */
  n: number;
  slugs: string[];
}

export interface AutoTagOptions {
  /** Класти тег `paragraph` з номером на кожен текстовий абзац. Типово так. */
  numberParagraphs?: boolean;
}

export interface AutoTagResult<B> {
  book: B;
  tagsPlaced: number;
  /** Скільки тегів кожного типу поставлено (без тега абзацу). */
  byType: Record<string, number>;
  paragraphsTagged: number;
  paragraphsNumbered: number;
  /** Тегів, які не вмістились через ліміт на абзац. */
  skippedByLimit: number;
  /** Останній виданий номер за типами — з нього продовжиться наступний прогін. */
  counters: Record<string, number>;
}

/** Скільки символів на початку абзацу займають теги, що вже там стоять. */
const LEADING_TAGS = /^(?:\s*\[[^\]]*\])*/;

/**
 * Кладе теги в книгу. Вхідну книгу не змінює — віддає копію.
 *
 * Теги стають ПІСЛЯ тих, що вже стоять на початку абзацу (як у редакторі: перший
 * тег лишається першим), а тег абзацу — після всіх. Тип, який уже є в абзаці,
 * не дублюється, а загальна кількість не перевищує реєстрового ліміту; місце
 * під тег абзацу резервується наперед, щоб контентні теги не витіснили номер.
 */
export function applyAutoTags<B extends CarrierBook>(
  book: B,
  picks: readonly AutoTagPick[],
  opts: AutoTagOptions = {}
): AutoTagResult<B> {
  const numberParagraphs = opts.numberParagraphs !== false;
  const clone = structuredClone(book) as B;
  const paragraphs = listBookParagraphs(clone);
  const pickBy = new Map(picks.map((p) => [p.n, p.slugs]));
  const counters = instanceCounters(clone);
  const next = (slug: string) => {
    const value = (counters.get(slug) ?? 0) + 1;
    counters.set(slug, value);
    return value;
  };

  const blocksOf = new Map<string, string[]>();
  const blocksFor = (p: BookParagraph) => {
    const key = `${p.chapterIdx}:${p.sectionIdx}`;
    let blocks = blocksOf.get(key);
    if (!blocks) {
      blocks = splitParagraphs(clone.chapters![p.chapterIdx].sections![p.sectionIdx].content);
      blocksOf.set(key, blocks);
    }
    return blocks;
  };

  const byType: Record<string, number> = {};
  let tagsPlaced = 0;
  let paragraphsTagged = 0;
  let paragraphsNumbered = 0;
  let skippedByLimit = 0;
  const changed = new Set<string>();

  for (const p of paragraphs) {
    const blocks = blocksFor(p);
    const original = blocks[p.paraIdx];
    const present = parseEntityTagsInSource(original).filter((t) => t.entity);
    const presentSlugs = new Set(present.map((t) => t.slug));

    const wantsNumber = numberParagraphs && !presentSlugs.has(PARAGRAPH_SLUG);
    let room = Math.max(0, MAX_ENTITIES_PER_PARAGRAPH - present.length - (wantsNumber ? 1 : 0));

    const add: string[] = [];
    let contentAdded = 0;
    for (const slug of pickBy.get(p.n) ?? []) {
      if (slug === PARAGRAPH_SLUG || presentSlugs.has(slug)) continue;
      if (room <= 0) {
        skippedByLimit += 1;
        continue;
      }
      room -= 1;
      presentSlugs.add(slug);
      add.push(buildEntityTag(slug, `#${next(slug)}`));
      byType[slug] = (byType[slug] ?? 0) + 1;
      contentAdded += 1;
    }
    if (wantsNumber) {
      add.push(buildEntityTag(PARAGRAPH_SLUG, `#${next(PARAGRAPH_SLUG)}`));
      paragraphsNumbered += 1;
    }
    if (!add.length) continue;

    /*
     * Авторський текст не змінюється ні на пропуск: `rest` — це решта абзацу
     * ДОСЛІВНО, разом із початковими пропусками. Раніше їх було обрізано
     * (`rest.replace(/^\s+/, '')`), і в 54 абзацах книги Архата текст після
     * зняття тегів перестав збігатися з оригіналом — це знайшла перевірка
     * «зняти лише початкові теги й порівняти». Так само `removeAutoTags` знімає
     * тег і рівно один пропуск після нього, тож круг «поставити → зняти»
     * повертає абзац точно.
     */
    const lead = LEADING_TAGS.exec(original)?.[0] ?? '';
    const rest = original.slice(lead.length);
    const tags = add.join(' ');
    blocks[p.paraIdx] = lead
      ? `${lead} ${tags}${rest && !/^\s/.test(rest) ? ' ' : ''}${rest}`
      : `${tags} ${rest}`;
    changed.add(`${p.chapterIdx}:${p.sectionIdx}`);
    tagsPlaced += contentAdded;
    if (contentAdded) paragraphsTagged += 1;
  }

  // Переписуємо лише розділи, де щось змінилось: решта лишається байт у байт.
  for (const key of changed) {
    const [ci, si] = key.split(':').map(Number);
    clone.chapters![ci].sections![si].content = blocksOf.get(key)!.join('\n\n');
  }

  return {
    book: clone,
    tagsPlaced,
    byType,
    paragraphsTagged,
    paragraphsNumbered,
    skippedByLimit,
    counters: Object.fromEntries(counters),
  };
}

/** Тег рівня типу з номером: `[/emotion:#17]` — і лише такі (без імені). */
const NUMBERED_TYPE_TAG = /\[\/([a-z0-9-]+):\s*#\d{1,7}\s*\]\s?/g;

/**
 * Прибирає ВСІ автоматичні теги: рівня типу з номером і без імені. Теги, які
 * поставив автор (з ім'ям, `@Чиє`, полями), не чіпаються: лише порожнє ім'я з
 * номером однозначно позначає автоматику.
 *
 * Потрібно, щоб прогін можна було скасувати цілком, а не гадати, які теги
 * «його».
 */
export function removeAutoTags<B extends CarrierBook>(book: B, opts: { slugs?: readonly string[] } = {}): { book: B; removed: number } {
  const clone = structuredClone(book) as B;
  const only = opts.slugs ? new Set(opts.slugs) : null;
  let removed = 0;
  for (const chapter of clone.chapters ?? []) {
    for (const section of chapter.sections ?? []) {
      const before = section.content ?? '';
      const after = before.replace(NUMBERED_TYPE_TAG, (m, slug: string) => {
        if (only && !only.has(slug)) return m;
        removed += 1;
        return '';
      });
      if (after !== before) section.content = after;
    }
  }
  return { book: clone, removed };
}
