/**
 * Гібридний пошук по книзі (Т1.2) — ОДИН сервіс для сторінки «Пошук»
 * (Т1.3) і для ТЗ-H (чат із книгою): обидва викликають `hybridSearch`.
 *
 * Три джерела, кожне зі своїм поясненням у видачі:
 *   • слова  — tsvector по тексту абзацу (з відмінками через основу слова);
 *   • зміст  — косинусна близькість ембедингів (pgvector), якщо є ключ
 *              моделі ембедингів і вектори книги пораховано;
 *   • граф   — згадки сутностей і зв'язки між ними: імена з запиту
 *              («Олена страх») впізнаються як сутності книги, і абзац, де
 *              емоція «страх» належить саме Олені, стоїть найвище.
 * Злиття — Reciprocal Rank Fusion: кожне джерело дає свій порядок, сума
 * 1/(60+місце) не залежить від того, що бали джерел у різних шкалах.
 *
 * Права. Маршрут пускає сюди лише учасника книги (`requireProjectAccess`),
 * а сам пошук бачить тільки живий текст: видалені абзаци й розділи, а також
 * висновки AI (зокрема приховані, ТЗ-H §5.1) у видачу не потрапляють —
 * джерела пошуку це текст книги, згадки й зв'язки.
 */

import { entityBySlug } from '../../../src/utils/coreEntities';
import type { CoreRepository, DocumentRow, EntityRow, MentionRow, ParagraphRow, RelationRow } from '../types';
import { EmbeddingUnavailableError, type Embedder } from './embedder';
import { planEmbeddingsFrom } from './embedJob';
import { ftsPlainText, isSearchableKind, paragraphExcerpt, searchStems, searchTokens, wordStem } from './text';

export interface SearchRequest {
  /** Запит автора звичайними словами: «Олена страх», «сцена на мосту вночі». */
  query?: string;
  /** Жорсткий фільтр: абзац мусить стосуватися КОЖНОЇ з цих сутностей. */
  entityIds?: string[];
  /** Скільки абзаців повернути (типово 20, не більше 50). */
  limit?: number;
  /**
   * Слова для пошуку за текстом, якщо вони відрізняються від запиту (так їх
   * виділяє тлумачення ШІ, Т1.3: імена пішли у фільтри, лишилось «приховує
   * від дружини»). Запит цілком усе одно йде в пошук за змістом.
   */
  text?: string;
  /** Сутності, які назвало тлумачення ШІ (м'яко, як упізнані в запиті): група — альтернативи. */
  hintEntityIds?: string[][];
  /** Фільтр ТЗ «глава»: лише ці глави. */
  chapterIds?: string[];
  /** Фільтр ТЗ «період»: від глави до глави (номери з 1, у порядку книги). */
  chapterRange?: { from?: number; to?: number };
  /** Фільтр ТЗ «статус підтвердження»: зважати лише на згадки з цим статусом. */
  mentionStatus?: 'confirmed' | 'suggested';
}

export interface SearchDeps {
  repo: CoreRepository;
  /** Ембедер і модель — без них пошук іде за словами й графом. */
  embedder?: Embedder | null;
  model?: () => Promise<string>;
  /**
   * Чи є ключ до моделі ембедингів. Без ключа пошук не ставить `core_embed`
   * (задача однаково нічого не порахує) і чесно пише причину.
   */
  available?: (model: string) => Promise<boolean>;
  /** Вектори поточної моделі покривають не всю книгу — поставити `core_embed`. */
  onEmbeddingsStale?: (projectId: string, missing: number) => void;
  /** Витрата на ембединг запиту (журнал usage_log). */
  recordQueryCost?: (u: { projectId: string; model: string; tokens: number }) => Promise<void>;
}

export interface RecognizedEntity {
  id: string;
  type: string;
  name: string;
  /** Звідки: з тексту запиту, з фільтра чи з тлумачення ШІ. */
  via: 'query' | 'filter' | 'ai';
}

export interface SearchHit {
  paragraphId: string;
  /** Номер абзацу в редакторі — за ним сторінка переходить до абзацу в канві. */
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterTitle: string;
  /** Номер глави в книзі (з 1), якщо абзац у главі. */
  chapterNumber: number | null;
  order: number;
  kind: string;
  excerpt: string;
  /** Контекст: сусідні абзаци того самого розділу (уривки). */
  context: { before: string | null; after: string | null };
  score: number;
  sources: {
    text?: { rank: number; score: number; terms: string[] };
    vector?: { rank: number; similarity: number };
    graph?: {
      rank: number;
      /** Скільки з названого в запиті (груп сутностей) є в абзаці — і скільки названо всього. */
      groupsCovered: number;
      groupsTotal: number;
      entities: { id: string; type: string; name: string; subjectOf?: string }[];
      relations: { id: string; type: string; from: string; to: string }[];
    };
  };
  /** Людське пояснення, чому абзац у видачі. */
  why: string;
}

export interface SearchResponse {
  query: string;
  stems: string[];
  entities: RecognizedEntity[];
  /** Застосовані фільтри глав і статусу — як їх зрозумів сервер. */
  filters: { chapterIds: string[]; mentionStatus: 'confirmed' | 'suggested' | null };
  results: SearchHit[];
  sources: {
    text: { used: boolean; hits: number };
    vector: { used: boolean; hits: number; model: string | null; embedded: number; total: number; reason?: string };
    graph: { used: boolean; hits: number };
  };
}

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
const RRF_K = 60;
/** Скільки кандидатів бере кожне джерело до злиття. */
const CANDIDATES = 100;
/**
 * Смислове джерело завжди поверне «найближчі» абзаци, навіть коли нічого
 * схожого немає. Тож лишаємо тих, хто не надто далеко від найкращого.
 */
const VECTOR_RELATIVE_CUTOFF = 0.15;

// ── Розпізнавання сутностей у запиті ────────────────────────────────────────

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3 || Math.abs(a.length - b.length) > 3) return false;
  const sa = wordStem(a);
  const sb = wordStem(b);
  return sa === sb || a.startsWith(sb) || b.startsWith(sa);
}

/**
 * Які слова запиту (їхні номери) складають ім'я; null — ім'я в запиті не
 * згадано. Кожне слово імені мусить знайтися серед слів запиту.
 */
export function nameTokensInQuery(name: string, queryTokens: string[]): number[] | null {
  const words = searchTokens(name);
  if (!words.length || words.join('').length < 3) return null;
  const hit: number[] = [];
  for (const w of words) {
    const i = queryTokens.findIndex((q) => wordsMatch(w, q));
    if (i < 0) return null;
    hit.push(i);
  }
  return hit;
}

/** Чи згадано ім'я в запиті. */
export function nameInQuery(name: string, queryTokens: string[]): boolean {
  return nameTokensInQuery(name, queryTokens) !== null;
}

export interface EntityMatch {
  entity: EntityRow;
  /** Номери слів запиту, якими названо сутність (за ім'ям чи псевдонімом). */
  tokens: number[];
}

export async function recognizeEntities(repo: CoreRepository, projectId: string, query: string, entities?: EntityRow[]): Promise<EntityMatch[]> {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const all = (entities ?? (await repo.listEntities(projectId))).filter((e) => e.status !== 'rejected');
  const aliases = await repo.listAliases(projectId);
  const namesOf = new Map<string, string[]>();
  for (const e of all) namesOf.set(e.id, [e.name]);
  for (const a of aliases) namesOf.get(a.entityId)?.push(a.alias);
  const out: EntityMatch[] = [];
  for (const e of all) {
    const hit = new Set<number>();
    for (const n of namesOf.get(e.id) ?? []) nameTokensInQuery(n, tokens)?.forEach((i) => hit.add(i));
    if (hit.size) out.push({ entity: e, tokens: [...hit] });
  }
  return out;
}

/**
 * Групи «що саме названо в запиті»: сутності, названі тими самими словами,
 * — одна група (альтернативи: «Олена» — і героїня «Олена Ковальчук» з
 * псевдонімом «Олена», і окремо створена «Олена»). Різні слова — різні
 * групи («Олена» і «страх»), і абзац, де є всі групи, — саме те, про що
 * питали.
 */
export function entityGroups(matches: EntityMatch[]): string[][] {
  const groups: { ids: string[]; tokens: Set<number> }[] = [];
  for (const m of matches) {
    const touching = groups.filter((g) => m.tokens.some((i) => g.tokens.has(i)));
    const merged = { ids: [m.entity.id, ...touching.flatMap((g) => g.ids)], tokens: new Set([...m.tokens, ...touching.flatMap((g) => [...g.tokens])]) };
    for (const g of touching) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups.map((g) => g.ids);
}

// ── Граф: які абзаци стосуються яких сутностей ──────────────────────────────

interface GraphInfo {
  /** Для абзацу — які з потрібних сутностей він зачіпає і як. */
  cover: Map<string, Map<string, { subjectOf?: string }>>;
  relations: Map<string, RelationRow[]>;
}

async function graphFor(
  repo: CoreRepository,
  projectId: string,
  entityIds: string[],
  mentionStatus?: 'confirmed' | 'suggested',
): Promise<GraphInfo> {
  const wanted = new Set(entityIds);
  const cover: GraphInfo['cover'] = new Map();
  const touch = (pid: string, entityId: string, how: { subjectOf?: string } = {}) => {
    let m = cover.get(pid);
    if (!m) cover.set(pid, (m = new Map()));
    const prev = m.get(entityId);
    if (!prev || (how.subjectOf && !prev.subjectOf)) m.set(entityId, how);
  };
  const mentions: MentionRow[] = [];
  for (const id of wanted) mentions.push(...(await repo.listMentionsByEntity(projectId, id)));
  for (const m of mentions) {
    if (m.status === 'rejected' || (mentionStatus && m.status !== mentionStatus)) continue;
    touch(m.paragraphId, m.entityId);
    // Емоція (стан, дія…) з суб'єктом (П1): абзац стосується і самого героя.
    if (m.subjectEntityId && wanted.has(m.subjectEntityId)) touch(m.paragraphId, m.subjectEntityId, { subjectOf: m.entityId });
  }
  const relations = new Map<string, RelationRow[]>();
  if (wanted.size >= 2) {
    const seen = new Set<string>();
    for (const id of wanted) {
      for (const r of await repo.listRelations(projectId, id)) {
        if (seen.has(r.id) || r.status === 'rejected' || (mentionStatus && r.status !== mentionStatus)) continue;
        if (!wanted.has(r.fromId) || !wanted.has(r.toId)) continue;
        seen.add(r.id);
        for (const pid of r.evidence) {
          const list = relations.get(pid) ?? [];
          list.push(r);
          relations.set(pid, list);
          touch(pid, r.fromId);
          touch(pid, r.toId);
        }
      }
    }
  }
  return { cover, relations };
}

// ── Сам пошук ───────────────────────────────────────────────────────────────

function typeLabel(type: string): string {
  return entityBySlug(type)?.nameUk?.toLowerCase() ?? type;
}

export async function hybridSearch(deps: SearchDeps, projectId: string, req: SearchRequest): Promise<SearchResponse> {
  const { repo } = deps;
  const query = String(req.query ?? '').trim().slice(0, 500);
  const limit = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(Number(req.limit) || SEARCH_DEFAULT_LIMIT)));
  const stems = searchStems(typeof req.text === 'string' ? req.text.slice(0, 500) : query);
  const mentionStatus = req.mentionStatus === 'confirmed' || req.mentionStatus === 'suggested' ? req.mentionStatus : undefined;

  const [paragraphs, documents, entities] = await Promise.all([
    repo.listAllParagraphs(projectId),
    repo.listDocuments(projectId),
    repo.listEntities(projectId),
  ]);
  const docs = new Map<string, DocumentRow>(documents.map((d) => [d.id, d]));
  const live = new Map<string, ParagraphRow>();
  for (const p of paragraphs) {
    const d = docs.get(p.documentId);
    if (!p.deletedAt && d && !d.deletedAt && isSearchableKind(p.kind)) live.set(p.id, p);
  }
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Глави в порядку книги — для фільтрів «глава» й «період» і номера в результаті.
  const chapters = documents.filter((d) => d.kind === 'chapter' && !d.deletedAt).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const chapterNo = new Map(chapters.map((c, i) => [c.id, i + 1]));
  const chapterOf = (p: ParagraphRow): string | null => {
    const d = docs.get(p.documentId);
    if (!d) return null;
    if (d.kind === 'chapter') return d.id;
    return d.parentId && docs.get(d.parentId)?.kind === 'chapter' ? d.parentId : null;
  };
  let chapterFilter: Set<string> | null = null;
  if (req.chapterIds?.length) chapterFilter = new Set(req.chapterIds.filter((id) => chapterNo.has(id)));
  const range = req.chapterRange;
  if (range && (Number.isFinite(Number(range.from)) || Number.isFinite(Number(range.to)))) {
    const from = Number.isFinite(Number(range.from)) ? Number(range.from) : 1;
    const to = Number.isFinite(Number(range.to)) ? Number(range.to) : chapters.length;
    const inRange = new Set(chapters.filter((_, i) => i + 1 >= from && i + 1 <= to).map((c) => c.id));
    chapterFilter = chapterFilter ? new Set([...chapterFilter].filter((id) => inRange.has(id))) : inRange;
  }

  // Сутності: з фільтра (жорстко) і впізнані в запиті (м'яко — лише підсилюють).
  const filterIds = [...new Set((req.entityIds ?? []).filter((id) => entityById.has(id)))];
  const matches = query ? await recognizeEntities(repo, projectId, query, entities) : [];
  const recognized = matches.map((m) => m.entity);
  const recognizedEntities: RecognizedEntity[] = [
    ...filterIds.map((id) => ({ id, type: entityById.get(id)!.type, name: entityById.get(id)!.name, via: 'filter' as const })),
    ...recognized.filter((e) => !filterIds.includes(e.id)).map((e) => ({ id: e.id, type: e.type, name: e.name, via: 'query' as const })),
  ];
  // Сутності з тлумачення ШІ — ще не названі ні фільтром, ні словами запиту.
  const known = new Set(recognizedEntities.map((e) => e.id));
  const hintGroups = (req.hintEntityIds ?? [])
    .map((g) => [...new Set(g)].filter((id) => entityById.has(id)))
    .filter((g) => g.length && !g.some((id) => known.has(id)));
  for (const g of hintGroups) {
    for (const id of g) {
      const e = entityById.get(id)!;
      recognizedEntities.push({ id, type: e.type, name: e.name, via: 'ai' });
      known.add(id);
    }
  }
  const graphIds = recognizedEntities.map((e) => e.id);
  const graph = graphIds.length ? await graphFor(repo, projectId, graphIds, mentionStatus) : { cover: new Map(), relations: new Map() };
  // Групи названого (фільтр — кожна сутність окремою групою).
  const groups = [...filterIds.map((id) => [id]), ...entityGroups(matches.filter((m) => !filterIds.includes(m.entity.id))), ...hintGroups];
  const groupsCovered = (pid: string): number => {
    const c = graph.cover.get(pid);
    return c ? groups.filter((g) => g.some((id) => c.has(id))).length : 0;
  };

  // Жорсткий фільтр: абзац зачіпає всі сутності фільтра.
  const allowed = (pid: string): boolean => {
    const p = live.get(pid);
    if (!p) return false;
    if (chapterFilter) {
      const ch = chapterOf(p);
      if (!ch || !chapterFilter.has(ch)) return false;
    }
    if (!filterIds.length) return true;
    const c = graph.cover.get(pid);
    return !!c && filterIds.every((id) => c.has(id));
  };

  // 1) Слова.
  const textRanked = stems.length ? (await repo.searchParagraphsByText(projectId, stems, CANDIDATES)).filter((h) => allowed(h.paragraphId)) : [];

  // 2) Зміст.
  const vectorInfo: SearchResponse['sources']['vector'] = { used: false, hits: 0, model: null, embedded: 0, total: 0 };
  let vectorRanked: { paragraphId: string; score: number }[] = [];
  if (query && deps.embedder && deps.model) {
    const model = await deps.model();
    vectorInfo.model = model;
    const existing = await repo.listEmbeddingHashes(projectId, model);
    const plan = planEmbeddingsFrom(paragraphs, documents, existing, model);
    vectorInfo.total = plan.total;
    vectorInfo.embedded = plan.total - plan.todo.length;
    const available = deps.available ? await deps.available(model).catch(() => false) : true;
    if (plan.todo.length && available) deps.onEmbeddingsStale?.(projectId, plan.todo.length);
    if (!available) {
      vectorInfo.reason = `Немає ключа до моделі ембедингів «${model}» — пошук за словами й сутностями.`;
    } else if (!existing.length) {
      vectorInfo.reason = plan.total ? 'Вектори книги ще рахуються — поки пошук за словами й сутностями.' : 'У книзі ще немає тексту для пошуку за змістом.';
    } else {
      try {
        const q = await deps.embedder(model, [query], 'query');
        await deps.recordQueryCost?.({ projectId, model, tokens: q.tokens }).catch(() => {});
        const raw = (await repo.searchParagraphsByVector(projectId, model, q.vectors[0], CANDIDATES)).filter((h) => allowed(h.paragraphId));
        const best = raw[0]?.score ?? 0;
        vectorRanked = raw.filter((h) => h.score >= best - VECTOR_RELATIVE_CUTOFF);
        vectorInfo.used = true;
      } catch (err) {
        vectorInfo.reason =
          err instanceof EmbeddingUnavailableError ? err.message : `Пошук за змістом тимчасово недоступний: ${(err as Error).message}`;
      }
    }
  } else if (query && !deps.embedder) {
    vectorInfo.reason = 'Модель ембедингів не налаштована — пошук за словами й сутностями.';
  }

  // 3) Граф: більше потрібних сутностей в абзаці — вище; зв'язок «суб'єкт» (емоція
  // саме цього героя) і підтверджений зв'язок між ними — ще вище.
  const graphRanked = [...graph.cover.entries()]
    .filter(([pid]) => allowed(pid))
    .map(([pid, c]) => {
      const bound = [...c.values()].some((x) => x.subjectOf) ? 0.5 : 0;
      const rel = graph.relations.has(pid) ? 0.25 : 0;
      return { paragraphId: pid, score: groupsCovered(pid) * 2 + c.size * 0.1 + bound + rel };
    })
    .sort((a, b) => b.score - a.score || (live.get(a.paragraphId)!.order - live.get(b.paragraphId)!.order) || a.paragraphId.localeCompare(b.paragraphId))
    .slice(0, CANDIDATES);

  // Злиття (RRF).
  const fused = new Map<string, { score: number; hit: SearchHit['sources'] }>();
  const add = (pid: string, rank: number, set: (s: SearchHit['sources']) => void) => {
    const cur = fused.get(pid) ?? { score: 0, hit: {} };
    cur.score += 1 / (RRF_K + rank);
    set(cur.hit);
    fused.set(pid, cur);
  };
  textRanked.forEach((h, i) => add(h.paragraphId, i + 1, (s) => {
    const tokens = searchTokens(ftsPlainText(live.get(h.paragraphId)!.text));
    s.text = { rank: i + 1, score: h.score, terms: stems.filter((st) => tokens.some((t) => t.startsWith(st))) };
  }));
  vectorRanked.forEach((h, i) => add(h.paragraphId, i + 1, (s) => {
    s.vector = { rank: i + 1, similarity: Math.round(h.score * 1000) / 1000 };
  }));
  graphRanked.forEach((h, i) => add(h.paragraphId, i + 1, (s) => {
    const c = graph.cover.get(h.paragraphId)!;
    s.graph = {
      rank: i + 1,
      groupsCovered: groupsCovered(h.paragraphId),
      groupsTotal: groups.length,
      entities: [...c.entries()].map(([id, how]) => ({
        id,
        type: entityById.get(id)?.type ?? '',
        name: entityById.get(id)?.name ?? '',
        ...(how.subjectOf ? { subjectOf: entityById.get(how.subjectOf)?.name ?? '' } : {}),
      })),
      relations: (graph.relations.get(h.paragraphId) ?? []).map((r: RelationRow) => ({
        id: r.id,
        type: r.type,
        from: entityById.get(r.fromId)?.name ?? '',
        to: entityById.get(r.toId)?.name ?? '',
      })),
    };
  }));

  const docOrder = (p: ParagraphRow) => {
    const s = docs.get(p.documentId);
    const ch = s?.parentId ? docs.get(s.parentId) : undefined;
    return [ch?.order ?? 0, s?.order ?? 0, p.order];
  };
  const byDocOrder = (a: ParagraphRow, b: ParagraphRow) => {
    const x = docOrder(a);
    const y = docOrder(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };

  const bySection = new Map<string, ParagraphRow[]>();
  const sectionParagraphs = (sectionId: string): ParagraphRow[] => {
    let list = bySection.get(sectionId);
    if (!list) {
      list = [...live.values()].filter((x) => x.documentId === sectionId).sort((a, b) => a.order - b.order);
      bySection.set(sectionId, list);
    }
    return list;
  };
  const tier = (pid: string) => (groups.length >= 2 && groupsCovered(pid) === groups.length ? 1 : 0);

  const results: SearchHit[] = [...fused.entries()]
    // Запит назвав кілька різних речей («персонаж + емоція»)? Тоді абзац, де
    // є ВСЕ назване, вищий за будь-який, де лише частина, — хоч би як той
    // збігався словами чи змістом. Усередині рівня — злиття RRF.
    .sort((a, b) => tier(b[0]) - tier(a[0]) || b[1].score - a[1].score || byDocOrder(live.get(a[0])!, live.get(b[0])!))
    .slice(0, limit)
    .map(([pid, f]) => {
      const p = live.get(pid)!;
      const section = docs.get(p.documentId);
      const chapterId = chapterOf(p);
      const chapter = chapterId ? docs.get(chapterId) : undefined;
      const siblings = sectionParagraphs(p.documentId);
      const at = siblings.findIndex((x) => x.id === p.id);
      return {
        paragraphId: p.id,
        editorPid: p.editorPid ?? p.id,
        sectionId: p.documentId,
        sectionTitle: section?.title ?? '',
        chapterId: chapter?.id ?? null,
        chapterTitle: chapter?.title ?? '',
        chapterNumber: chapterId ? chapterNo.get(chapterId) ?? null : null,
        order: p.order,
        kind: p.kind,
        excerpt: paragraphExcerpt(p.text),
        context: {
          before: at > 0 ? paragraphExcerpt(siblings[at - 1].text, 200) || null : null,
          after: at >= 0 && at < siblings.length - 1 ? paragraphExcerpt(siblings[at + 1].text, 200) || null : null,
        },
        score: Math.round(f.score * 10000) / 10000,
        sources: f.hit,
        why: explain(f.hit),
      };
    });

  return {
    query,
    stems,
    entities: recognizedEntities,
    filters: { chapterIds: chapterFilter ? [...chapterFilter] : [], mentionStatus: mentionStatus ?? null },
    results,
    sources: {
      text: { used: stems.length > 0, hits: textRanked.length },
      vector: { ...vectorInfo, hits: vectorRanked.length },
      graph: { used: graphIds.length > 0, hits: graphRanked.length },
    },
  };
}

/** «слова: страх · зміст: 0.81 · граф: емоційний стан «страх» (Олена)». */
export function explain(s: SearchHit['sources']): string {
  const parts: string[] = [];
  if (s.graph) {
    const ents = s.graph.entities.map((e) =>
      e.subjectOf ? `${e.name} — через «${e.subjectOf}»` : `${typeLabel(e.type)} «${e.name}»`,
    );
    parts.push(`сутності: ${ents.join(', ')}`);
    for (const r of s.graph.relations) parts.push(`зв'язок: ${r.from} —${r.type}→ ${r.to}`);
  }
  if (s.text) parts.push(`слова: ${s.text.terms.join(', ') || '—'}`);
  if (s.vector) parts.push(`за змістом: близькість ${s.vector.similarity.toFixed(2)}`);
  return parts.join(' · ');
}
