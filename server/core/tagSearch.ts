/**
 * Пошук абзаців за тегом сутності (постановка власника 03.11.2026): «за
 * заданим тегом повернути ВСІ абзаци з посиланням на глави книги».
 *
 * ЧОМУ ЦЕ НЕ ПИТАЄ Jev. Теги вже проставлені — Jev вирішував це тоді, коли їх
 * ставили (`ai/jevTags.ts`). Питати модель ще раз на кожен пошук означало б
 * платити за кожен запит автора й отримувати щоразу трохи інший список на
 * тому самому тексті. Пошук читає те, що вже вирішено.
 *
 * ЩО ЦЕЙ ПОШУК НЕ БАЧИТЬ, І ЧОМУ. Тег, у якого порожнє значення після
 * двокрапки (`[/emotion:]`), у ядро не потрапляє зовсім: сутність там
 * визначається саме іменем зі значення, і такий тег ні на кого не вказує —
 * `sync.ts` рахує його як `withoutValue` і пропускає. Теги від AI-1 і від
 * кнопки Jev значення несуть, тож вони доходять; ручний тег із підказки
 * слеша вставляється порожнім, і доки автор не допише значення, пошук його
 * не покаже. Це межа даних, а не вибірки, і обійти її тут неможливо.
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

import { parseEntityValue, parseEntityTagsInSource, stripEntityTags } from '../../src/utils/coreEntities';
import { PARAGRAPH_TAG_SLUG } from '../../src/utils/paragraphNumbers';

export interface TagSearchEntity {
  id: string;
  name: string;
  status: string;
  /** Тип із реєстру — потрібен, коли шукають кількома тегами одразу. */
  type: string;
  /** Значення після двокрапки, як його записав синк. */
  value: string;
  /**
   * Номер екземпляра з `#N` (`[/emotion:#17]`). Є лише в тегів, прочитаних
   * з тексту: тег рівня типу з номером у ядро не потрапляє — синк пропускає
   * його як тег без імені.
   */
  instance?: number;
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
  /** Які з шуканих типів справді є в цьому абзаці. */
  types: string[];
  /** Номер абзацу з його власного тега `[/paragraph:#N]`; немає, якщо абзац не пронумеровано. */
  paragraphNumber?: number;
  /** Повний текст абзацу БЕЗ тегів — лише коли попросили (`includeText`), бо для списку досить уривка. */
  text?: string;
}

export interface TagSearchInputs {
  /** Сутності ПОТРІБНИХ типів (вибірка вже за типами). */
  entities: ReadonlyArray<{ id: string; name: string; status: string; type: string }>;
  mentions: ReadonlyArray<{ entityId: string; paragraphId: string; status: string; value?: string }>;
  /**
   * Теги, прочитані ПРЯМО з тексту абзаців (`parseEntityTagsInSource`), без
   * посередництва ядра. Це друге джерело, і воно потрібне саме тому, що ядро
   * тег із порожнім значенням не бачить: `[/emotion:]` ні на кого не вказує,
   * тож синк його пропускає. У тексті ж він стоїть, автор його бачить — і
   * пошук за тегом мусить його знайти.
   */
  textTags?: ReadonlyArray<{ paragraphId: string; type: string; value: string }>;
  /** Типи, які шукають. Порожньо — будь-який із наявних у `entities`. */
  slugs?: readonly string[];
  /**
   * `any` — абзац підходить, якщо є хоч один із тегів; `all` — якщо є всі.
   * Типово `any`: саме так читається «знайти абзаци з тегом».
   */
  mode?: 'any' | 'all';
  /**
   * Підрядок у значенні тега або в назві сутності, без регістру. Саме
   * значення й шукають, коли питання не «де емоції», а «де страх».
   */
  value?: string;
  /**
   * Номер екземпляра: лишає лише теги `#N` з цим номером. З типом
   * (`emotion` + 17) це й є «швидко знайти сімнадцятий тег емоції»; з типом
   * `paragraph` — абзац №N.
   */
  instance?: number;
  /** Додати до кожного влучення повний текст абзацу (для передачі в чат). */
  includeText?: boolean;
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
  /** Скільки влучень пропустити — посторінкова видача поверх того самого порядку. */
  offset?: number;
}

export interface TagSearchResult {
  hits: TagSearchHit[];
  /** Скільки абзаців знайдено всього — до обрізання за `limit`. */
  total: number;
  /** Скільки різних сутностей цього типу справді трапилось у тексті. */
  entitiesFound: number;
  /** Зсув, з якого віддано цю сторінку. */
  offset: number;
}

/** Типове обмеження видачі: стільки автор ще переглядає очима. */
export const TAG_SEARCH_DEFAULT_LIMIT = 200;

/**
 * Відхилена згадка — це рішення автора «ні, тут цього немає». Показувати її в
 * пошуку означало б повертати те, що він уже прибрав.
 */
const counts = (status: string): boolean => status !== 'rejected';

/** Номер абзацу з його власного тега `[/paragraph:#N]`; `undefined`, якщо абзац не пронумеровано. */
function paragraphNumberOf(text: string): number | undefined {
  for (const tag of parseEntityTagsInSource(text)) {
    if (!tag.entity || tag.slug !== PARAGRAPH_TAG_SLUG) continue;
    const parsed = parseEntityValue(PARAGRAPH_TAG_SLUG, tag.value);
    if (parsed.text === '' && parsed.instance !== undefined) return parsed.instance;
  }
  return undefined;
}

export function buildTagHits(input: TagSearchInputs): TagSearchResult {
  const limit = input.limit ?? TAG_SEARCH_DEFAULT_LIMIT;
  const offset = Math.max(0, input.offset ?? 0);
  const wanted = new Set((input.slugs ?? []).map((x) => x.toLowerCase()));
  const needle = (input.value ?? '').trim().toLowerCase();
  const entityById = new Map(input.entities.map((e) => [e.id, e]));
  const paragraphById = new Map(input.paragraphs.map((p) => [p.id, p]));
  const docById = new Map(input.documents.map((d) => [d.id, d]));

  // Абзац → сутності, що в ньому згадані. Один абзац — одне влучення, навіть
  // якщо тегів у ньому кілька.
  const byParagraph = new Map<string, TagSearchEntity[]>();
  const seenEntities = new Set<string>();
  for (const m of input.mentions) {
    if (!counts(m.status)) continue;
    const entity = entityById.get(m.entityId);
    if (!entity) continue;
    if (wanted.size && !wanted.has(entity.type.toLowerCase())) continue;
    const value = String(m.value ?? '');
    if (needle && !`${value} ${entity.name}`.toLowerCase().includes(needle)) continue;
    const paragraph = paragraphById.get(m.paragraphId);
    if (!paragraph || paragraph.deletedAt) continue;
    const section = docById.get(paragraph.documentId);
    if (!section || section.deletedAt) continue;
    const chapter = section.parentId ? docById.get(section.parentId) : undefined;
    if (chapter?.deletedAt) continue;

    let list = byParagraph.get(m.paragraphId);
    if (!list) byParagraph.set(m.paragraphId, (list = []));
    // Та сама сутність із тим самим значенням двічі — один запис; та сама
    // сутність з РІЗНИМИ значеннями — різні, бо це різні згадки для автора.
    if (!list.some((e) => e.id === entity.id && e.value === value)) {
      list.push({ id: entity.id, name: entity.name, status: entity.status, type: entity.type, value });
      seenEntities.add(entity.id);
    }
  }

  /*
   * Теги з тексту. Той самий тег, що вже прийшов із ядра (той самий тип і те
   * саме значення чи ім'я), вдруге не додається — інакше кожен підтверджений
   * тег показувався б двічі: раз із ядра, раз із тексту.
   */
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const tag of input.textTags ?? []) {
    const type = tag.type.toLowerCase();
    if (wanted.size && !wanted.has(type)) continue;
    const value = norm(tag.value);
    if (needle && !value.includes(needle)) continue;
    const paragraph = paragraphById.get(tag.paragraphId);
    if (!paragraph || paragraph.deletedAt) continue;
    const section = docById.get(paragraph.documentId);
    if (!section || section.deletedAt) continue;
    const chapter = section.parentId ? docById.get(section.parentId) : undefined;
    if (chapter?.deletedAt) continue;

    let list = byParagraph.get(tag.paragraphId);
    if (!list) byParagraph.set(tag.paragraphId, (list = []));
    const duplicate = list.some((e) => {
      if (e.type.toLowerCase() !== type) return false;
      const ev = norm(e.value);
      const en = norm(e.name);
      return value ? ev === value || (en !== '' && value.includes(en)) : ev === '' && en === '';
    });
    if (duplicate) continue;
    list.push({
      id: `text:${type}:${value}`,
      name: '',
      status: 'in_text',
      type,
      value: tag.value.trim(),
      instance: parseEntityValue(type, tag.value).instance,
    });
    // Порожній тег — це ще не сутність: у «різних сутностей» його не рахуємо.
    if (value) seenEntities.add(`text:${type}:${value}`);
  }

  /*
   * Номер екземпляра: лишаємо лише записи з таким номером, а абзаци, де після
   * цього нічого не лишилось, відпадають. Записи з ядра номера не мають
   * (тег рівня типу з номером синк пропускає), тож при фільтрі за номером їх
   * немає в видачі — і це правильно: вони не `#17`.
   */
  if (input.instance !== undefined) {
    for (const [paragraphId, entities] of byParagraph) {
      const kept = entities.filter((e) => e.instance === input.instance);
      if (kept.length) byParagraph.set(paragraphId, kept);
      else byParagraph.delete(paragraphId);
    }
  }

  const rows = [];
  for (const [paragraphId, entities] of byParagraph) {
    const types = [...new Set(entities.map((e) => e.type))];
    // `all`: абзац підходить лише тоді, коли в ньому є КОЖЕН шуканий тег.
    if (input.mode === 'all' && wanted.size && ![...wanted].every((w) => types.includes(w))) continue;
    const paragraph = paragraphById.get(paragraphId)!;
    const section = docById.get(paragraph.documentId)!;
    const chapter = section.parentId ? docById.get(section.parentId) ?? null : null;
    rows.push({
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
        types,
        paragraphNumber: paragraphNumberOf(paragraph.text),
        ...(input.includeText ? { text: stripEntityTags(paragraph.text).trim() } : {}),
      } satisfies TagSearchHit,
    });
  }

  rows.sort((a, b) =>
    a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2]
  );

  return {
    hits: rows.slice(offset, offset + limit).map((r) => r.hit),
    total: rows.length,
    entitiesFound: seenEntities.size,
    offset,
  };
}
