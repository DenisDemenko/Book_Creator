/**
 * Носій тегів сутностей для експортованої книги (постановка власника
 * 03.11.2026): теги НЕВИДИМІ читачеві, але ВИДИМІ, коли файл читає Студія.
 *
 * ЧОМУ НЕ ХОВАТИ ТЕГИ У ТЕКСТІ. Біла фарба, нульовий кегль чи «прихований»
 * шар — це все ще текст файла: копіювання з PDF його забирає, читалка шукає
 * по ньому, а скринрідер його озвучує. Тому носій — ДАНІ ПОРУЧ із текстом, а
 * не розмітка в ньому: читач їх не бачить за побудовою, бо в документі їх
 * просто немає.
 *
 * ЩО САМЕ НЕСЕ НОСІЙ. Не весь текст, а лише карту «абзац → теги». Абзац
 * впізнається відбитком його ВИДИМОГО тексту, а не номером: у файлі номерів
 * абзаців немає, і зверстана книга не зберігає нумерації рукопису.
 *
 * ЧОМУ ВІДБИТОК РАХУЄТЬСЯ ТАК. Файл, який читає Студія, — це текст після PDF
 * чи DOCX: розмітка Студії (`[B]…[/B]`), пунктуація й пропуски там уже не ті.
 * Тому з абзацу лишаються лише літери й цифри в нижньому регістрі, а все, що
 * в квадратних дужках, відкидається. Ціна: абзаци, що відрізняються тільки
 * розділовими знаками, зіллються в один відбиток — і це чесна межа, а не
 * помилка: такі абзаци звіряються по порядку.
 *
 * ЧОМУ ЦЕ ЧИСТА ЛОГІКА БЕЗ PDF. Вона потрібна і серверу (записати носій), і
 * браузеру (повернути теги в книгу, яка живе саме там — рукопис змінює лише
 * браузер, К2). Запис і читання самого PDF — в `server/pdf/tagCarrierPdf.ts`.
 */

import { blockHash } from './paragraphIds';
import {
  MAX_ENTITIES_PER_PARAGRAPH,
  buildEntityTag,
  parseEntityTagsInSource,
  stripEntityTags,
} from './coreEntities';

export const TAG_CARRIER_FORMAT = 'nova-tags';
export const TAG_CARRIER_VERSION = 1;

/** Скільки тегів і абзаців носій узагалі готовий нести: охорона від роздутого файла. */
export const TAG_CARRIER_MAX_PARAGRAPHS = 200_000;

export interface CarrierTag {
  slug: string;
  value: string;
}

export interface CarrierParagraph {
  /** Номер абзацу в розділі — підказка при однакових відбитках. */
  n: number;
  /** Відбиток видимого тексту (див. `paragraphKey`). */
  h: string;
  tags: CarrierTag[];
}

export interface CarrierSection {
  title: string;
  paragraphs: CarrierParagraph[];
}

export interface CarrierChapter {
  title: string;
  sections: CarrierSection[];
}

export interface TagCarrier {
  format: typeof TAG_CARRIER_FORMAT;
  version: typeof TAG_CARRIER_VERSION;
  bookId: string | null;
  title: string;
  chapters: CarrierChapter[];
}

/** Мінімум, який потрібен від книги: назви й текст розділів. */
export interface CarrierBook {
  id?: string;
  title?: string;
  chapters?: Array<{
    id?: string;
    title?: string;
    sections?: Array<{ id?: string; title?: string; content?: string }>;
  }>;
}

/** Абзаци розділу — тим самим поділом, яким Студія й імпорт ділять рукопис. */
export function splitParagraphs(content: string | undefined): string[] {
  return String(content ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/);
}

/**
 * Відбиток видимого тексту абзацу. Порожній рядок означає «нічого впізнавати»
 * (розділювач, лише розмітка) — такий абзац носій не несе.
 */
export function paragraphKey(block: string): string {
  const visible = stripEntityTags(block)
    .replace(/\[[^\]\n]*\]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return visible ? blockHash(visible) : '';
}

const normTitle = (v: string | undefined) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Збирає носій із книги: лише абзаци, у яких справді є теги. */
export function buildTagCarrier(book: CarrierBook): TagCarrier {
  const chapters: CarrierChapter[] = [];
  let count = 0;
  for (const chapter of book.chapters ?? []) {
    const sections: CarrierSection[] = [];
    for (const section of chapter.sections ?? []) {
      const paragraphs: CarrierParagraph[] = [];
      splitParagraphs(section.content).forEach((block, n) => {
        if (count >= TAG_CARRIER_MAX_PARAGRAPHS) return;
        const tags = parseEntityTagsInSource(block)
          .filter((t) => t.entity)
          .map((t) => ({ slug: t.slug, value: t.value }));
        const h = paragraphKey(block);
        if (!tags.length || !h) return;
        paragraphs.push({ n, h, tags });
        count += 1;
      });
      if (paragraphs.length) sections.push({ title: String(section.title ?? ''), paragraphs });
    }
    if (sections.length) chapters.push({ title: String(chapter.title ?? ''), sections });
  }
  return {
    format: TAG_CARRIER_FORMAT,
    version: TAG_CARRIER_VERSION,
    bookId: book.id ? String(book.id) : null,
    title: String(book.title ?? ''),
    chapters,
  };
}

/** Чи схожий довільний JSON на наш носій; бите чи чуже відкидається тихо. */
export function parseTagCarrier(raw: unknown): TagCarrier | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<TagCarrier>;
  if (c.format !== TAG_CARRIER_FORMAT || c.version !== TAG_CARRIER_VERSION) return null;
  if (!Array.isArray(c.chapters)) return null;
  return c as TagCarrier;
}

export interface CarrierApplyResult<B> {
  book: B;
  /** Абзаців, куди повернулися теги. */
  matched: number;
  /** Тегів, поставлених усього. */
  tagsPlaced: number;
  /** Абзаців носія, яких у книзі не знайдено. */
  unmatched: number;
  /** Тегів, які не вмістилися через ліміт на абзац. */
  skippedByLimit: number;
}

/**
 * Повертає теги в книгу, прочитану з файла. Книгу не змінює — віддає копію.
 *
 * Звіряння — за відбитком видимого тексту, у межах розділу з тією самою
 * назвою, а коли такого нема — по всій книзі. Однакові відбитки (повтори
 * типу «Так.») роздаються по порядку, а не всі на перший збіг.
 *
 * Теги кладуться НА ПОЧАТОК абзацу, як і в редакторі: мітки не розривають
 * речення, а порядок визначає колір. Те, що вже стоїть в абзаці, не
 * дублюється, а загальна кількість не перевищує реєстрового ліміту.
 */
export function applyTagCarrier<B extends CarrierBook>(book: B, carrier: TagCarrier): CarrierApplyResult<B> {
  const clone = structuredClone(book) as B;

  // Індекс: відбиток → усі місця в книзі, у порядку тексту.
  type Slot = { chapterIdx: number; sectionIdx: number; sectionTitle: string; paraIdx: number; used: boolean };
  const index = new Map<string, Slot[]>();
  const blocksOf = new Map<string, string[]>();
  (clone.chapters ?? []).forEach((chapter, chapterIdx) => {
    (chapter.sections ?? []).forEach((section, sectionIdx) => {
      const blocks = splitParagraphs(section.content);
      blocksOf.set(`${chapterIdx}:${sectionIdx}`, blocks);
      blocks.forEach((block, paraIdx) => {
        const h = paragraphKey(block);
        if (!h) return;
        const list = index.get(h) ?? [];
        list.push({ chapterIdx, sectionIdx, sectionTitle: normTitle(section.title), paraIdx, used: false });
        index.set(h, list);
      });
    });
  });

  let matched = 0;
  let tagsPlaced = 0;
  let unmatched = 0;
  let skippedByLimit = 0;

  for (const chapter of carrier.chapters) {
    for (const section of chapter.sections) {
      const wantTitle = normTitle(section.title);
      for (const paragraph of section.paragraphs) {
        const candidates = (index.get(paragraph.h) ?? []).filter((s) => !s.used);
        /*
         * Порядок вибору: той самий розділ і те саме місце в ньому → той самий
         * розділ → те саме місце деінде → будь-який вільний. Підказка `n`
         * потрібна саме для повторів: коли «Так.» стоїть двічі поруч, а тег
         * був на другому, відбиток однаковий, і без `n` тег ліг би на
         * перший.
         */
        const sameTitle = candidates.filter((s) => s.sectionTitle === wantTitle);
        const slot =
          sameTitle.find((s) => s.paraIdx === paragraph.n) ??
          sameTitle[0] ??
          candidates.find((s) => s.paraIdx === paragraph.n) ??
          candidates[0];
        if (!slot) {
          unmatched += 1;
          continue;
        }
        slot.used = true;
        const blocks = blocksOf.get(`${slot.chapterIdx}:${slot.sectionIdx}`)!;
        const original = blocks[slot.paraIdx];

        const present = parseEntityTagsInSource(original).filter((t) => t.entity);
        const seen = new Set(present.map((t) => `${t.slug}\u0000${t.value.trim().toLowerCase()}`));
        let room = Math.max(0, MAX_ENTITIES_PER_PARAGRAPH - present.length);
        const add: string[] = [];
        for (const tag of paragraph.tags) {
          const key = `${tag.slug}\u0000${tag.value.trim().toLowerCase()}`;
          if (seen.has(key)) continue;
          if (room <= 0) {
            skippedByLimit += 1;
            continue;
          }
          seen.add(key);
          room -= 1;
          add.push(buildEntityTag(tag.slug, tag.value));
        }
        if (!add.length) continue;
        blocks[slot.paraIdx] = `${add.join(' ')} ${original}`;
        matched += 1;
        tagsPlaced += add.length;
      }
    }
  }

  // Переписуємо лише ті розділи, де щось змінилось: решта лишається байт у байт.
  (clone.chapters ?? []).forEach((chapter, chapterIdx) => {
    (chapter.sections ?? []).forEach((section, sectionIdx) => {
      const blocks = blocksOf.get(`${chapterIdx}:${sectionIdx}`)!;
      const rebuilt = blocks.join('\n\n');
      if (rebuilt !== splitParagraphs(section.content).join('\n\n')) section.content = rebuilt;
    });
  });

  return { book: clone, matched, tagsPlaced, unmatched, skippedByLimit };
}
