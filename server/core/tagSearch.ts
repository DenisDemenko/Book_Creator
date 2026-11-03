/**
 * Пошук абзаців за тегом сутності (постановка власника 03.11.2026): «за
 * заданим тегом повернути ВСІ абзаци з посиланням на глави книги».
 *
 * ЧОМУ ЦЕ НЕ ПИТАЄ Jev. Теги вже проставлені — Jev вирішував це тоді, коли їх
 * ставили (`ai/jevTags.ts`). Питати модель ще раз на кожен пошук означало б
 * платити за кожен запит автора й отримувати щоразу трохи інший список на
 * тому самому тексті. Пошук читає те, що вже вирішено.
 *
 * ЧОМУ ЗА ТИПОМ, А НЕ ЗА ЕКЗЕМПЛЯРОМ. Картка сутності вже показує згадки
 * ОДНІЄЇ сутності («Олена»), і обмежена тридцятьма. Питання власника інше:
 * усі абзаци з тегом `/emotion` — тобто за ТИПОМ із реєстру 118, скільки б
 * різних емоцій там не було. Тому вхід — slug типу, а в кожному влученні
 * перелічені ті сутності цього типу, що в ньому згадані.
 *
 * ПОРЯДОК — КНИЖКОВИЙ. Результати впорядковані як у книзі: глава, розділ,
 * абзац. Пошук, що віддає абзаци в порядку бази, змушує автора щоразу
 * відновлювати, де він у тексті.
 */

/** Сутність у влученні: яка саме з цього типу згадана в абзаці. */
export interface TagSearchEntity {
  id: string;
  name: string;
  status: string;
}

/** Один абзац із тегом — разом з адресою в книзі й у редакторі. */
export interface TagSearchHit {
  paragraphId: string;
  /** Номер блоку в редакторі — за ним відкривається саме цей абзац. */
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterTitle: string | null;
  excerpt: string;
  entities: TagSearchEntity[];
}

export interface TagSearchInputs {
  /** Сутності ПОТРІБНОГО типу (вибірка вже за типом). */
  entities: ReadonlyArray<{ id: string; name: string; status: string }>;
  mentions: ReadonlyArray<{ entityId: string; paragraphId: string; status: string }>;
  paragraphs: ReadonlyArray<{
    id: string;
    documentId: string;
    order: number;
    text: string;
    editorPid: string | null;
    deletedAt: string | null;
  }>;
  documents: ReadonlyArray<{
    id: string;
    parentId: string | null;
    order: number;
    title: string;
    deletedAt: string | null;
  }>;
  excerpt: (text: string) => string;
  /** Скільки влучень віддати; `total` однаково рахується по всіх. */
  limit?: number;
}

export interface TagSearchResult {
  hits: TagSearchHit[];
  /** Скільки абзаців знайдено всього — до обрізання за `limit`. */
  total: number;
  /** Скільки різних сутностей цього типу справді трапилось у тексті. */
  entitiesFound: number;
}

/** Типове обмеження видачі: стільки автор ще переглядає очима. */
export const TAG_SEARCH_DEFAULT_LIMIT = 200;

/**
 * Відхилена згадка — це рішення автора «ні, тут цього немає». Показувати її в
 * пошуку означало б повертати те, що він уже прибрав.
 */
const counts = (status: string): boolean => status !== 'rejected';

export function buildTagHits(input: TagSearchInputs): TagSearchResult {
  const limit = input.limit ?? TAG_SEARCH_DEFAULT_LIMIT;
  const entityById = new Map(input.entities.map((e) => [e.id, e]));
  const paragraphById = new Map(input.paragraphs.map((p) => [p.id, p]));
  const docById = new Map(input.documents.map((d) => [d.id, d]));

  // Абзац → сутності цього типу, що в ньому згадані. Один абзац — одне
  // влучення, навіть якщо тегів цього типу в ньому кілька.
  const byParagraph = new Map<string, TagSearchEntity[]>();
  const seenEntities = new Set<string>();
  for (const m of input.mentions) {
    if (!counts(m.status)) continue;
    const entity = entityById.get(m.entityId);
    if (!entity) continue;
    const paragraph = paragraphById.get(m.paragraphId);
    if (!paragraph || paragraph.deletedAt) continue;
    const section = docById.get(paragraph.documentId);
    if (!section || section.deletedAt) continue;
    const chapter = section.parentId ? docById.get(section.parentId) : undefined;
    if (chapter?.deletedAt) continue;

    let list = byParagraph.get(m.paragraphId);
    if (!list) byParagraph.set(m.paragraphId, (list = []));
    if (!list.some((e) => e.id === entity.id)) {
      list.push({ id: entity.id, name: entity.name, status: entity.status });
      seenEntities.add(entity.id);
    }
  }

  const rows = [...byParagraph.entries()].map(([paragraphId, entities]) => {
    const paragraph = paragraphById.get(paragraphId)!;
    const section = docById.get(paragraph.documentId)!;
    const chapter = section.parentId ? docById.get(section.parentId) ?? null : null;
    return {
      sort: [chapter?.order ?? -1, section.order, paragraph.order] as const,
      hit: {
        paragraphId,
        editorPid: paragraph.editorPid ?? paragraph.id,
        sectionId: section.id,
        sectionTitle: section.title,
        chapterId: chapter?.id ?? null,
        chapterTitle: chapter?.title ?? null,
        excerpt: input.excerpt(paragraph.text),
        entities,
      } satisfies TagSearchHit,
    };
  });

  rows.sort((a, b) =>
    a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2]
  );

  return {
    hits: rows.slice(0, limit).map((r) => r.hit),
    total: rows.length,
    entitiesFound: seenEntities.size,
  };
}
