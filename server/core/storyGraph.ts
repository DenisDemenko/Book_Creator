/**
 * Граф історії (Т1.4, ТЗ-11 §3 «Story Graph»): вузли — сутності книги,
 * ребра — зв'язки між ними, кожне ребро з джерелами-абзацами.
 *
 * Два види ребер:
 *   • `relation` — запис `entity_relations`: підтверджений автором або
 *     запропонований ШІ (AI-1, Т1.1) чи створений вручну на цій сторінці;
 *   • `tag` — зв'язок, який автор уже поставив у тексті тегом із суб'єктом
 *     (П1): `[/emotion:страх @Сергій]` → «Сергій —переживає→ страх». Такий
 *     зв'язок не зберігається окремо — він рахується з тегів, і його джерела
 *     — ті самі абзаци. Змінити його можна лише в тексті.
 *
 * Великі книги: без фокуса — огляд із найзв'язніших сутностей (ліміт вузлів),
 * з фокусом — сама сутність і сусіди на глибину 1–2 (`focus`, `depth`); так
 * інтерфейс довантажує сусідів поступово.
 */

import type { CoreRepository, DocumentRow, EntityRow, ParagraphRow, RelationRow } from './types';
import { paragraphExcerpt } from './search/text';

export interface EvidenceRef {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  chapterId: string | null;
  excerpt: string;
}

export interface StoryGraphNode {
  id: string;
  type: string;
  name: string;
  status: string;
  mentions: number;
  /** Скільки ребер у вузла в усьому графі книги (з урахуванням фільтра статусу). */
  degree: number;
}

export interface StoryGraphEdge {
  id: string;
  kind: 'relation' | 'tag';
  type: string;
  from: string;
  to: string;
  status: 'confirmed' | 'suggested';
  /** Абзаци-джерела (до `MAX_EVIDENCE`). */
  evidence: EvidenceRef[];
  /** Усього абзаців-джерел (може бути більше, ніж показано). */
  evidenceCount: number;
  note: string;
  createdBy: string | null;
}

export interface StoryGraph {
  focus: string | null;
  depth: number;
  nodes: StoryGraphNode[];
  edges: StoryGraphEdge[];
  /** Показано не все: огляд обрізано лімітом. */
  truncated: boolean;
  totals: { entities: number; edges: number };
}

export interface StoryGraphOptions {
  focus?: string;
  depth?: number;
  /** Лише ці типи сутностей (фокус показується завжди). */
  types?: string[];
  /** Показувати й запропоновані ШІ зв'язки (типово — так). */
  includeSuggested?: boolean;
  /** Показувати зв'язки з тегів (типово — так). */
  includeTagLinks?: boolean;
  limit?: number;
}

export const GRAPH_DEFAULT_LIMIT = 80;
export const GRAPH_MAX_LIMIT = 300;
const MAX_EVIDENCE = 5;

/**
 * Тип зв'язку для тега з суб'єктом: емоція чи стан — «переживає», решта —
 * «бере участь». Обидва ключі — з реєстру зв'язків (`CORE_ENTITY_RELATIONS`).
 */
export function tagLinkType(entityType: string): string {
  return entityType === 'emotion' || entityType === 'character-state' ? 'experiences' : 'participates_in';
}

/** Посилання на абзаци-джерела: лише живі абзаци, з уривком і адресою для переходу в редактор. */
export async function evidenceRefs(
  repo: CoreRepository,
  projectId: string,
  paragraphIds: string[],
  preload?: { paragraphs: ParagraphRow[]; documents: DocumentRow[] },
): Promise<EvidenceRef[]> {
  if (!paragraphIds.length) return [];
  const [paragraphs, documents] = preload
    ? [preload.paragraphs, preload.documents]
    : await Promise.all([repo.listAllParagraphs(projectId), repo.listDocuments(projectId)]);
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const docs = new Map(documents.map((d) => [d.id, d]));
  const out: EvidenceRef[] = [];
  for (const id of paragraphIds) {
    const p = byId.get(id);
    const section = p ? docs.get(p.documentId) : undefined;
    if (!p || p.deletedAt || !section || section.deletedAt) continue;
    const chapter = section.parentId ? docs.get(section.parentId) : undefined;
    out.push({
      paragraphId: p.id,
      editorPid: p.editorPid ?? p.id,
      sectionId: p.documentId,
      chapterId: chapter && !chapter.deletedAt ? chapter.id : null,
      excerpt: paragraphExcerpt(p.text, 220),
    });
  }
  return out;
}

export async function buildStoryGraph(repo: CoreRepository, projectId: string, opts: StoryGraphOptions = {}): Promise<StoryGraph> {
  const includeSuggested = opts.includeSuggested !== false;
  const includeTags = opts.includeTagLinks !== false;
  const depth = Math.max(1, Math.min(2, Math.floor(Number(opts.depth) || 1)));
  const limit = Math.max(1, Math.min(GRAPH_MAX_LIMIT, Math.floor(Number(opts.limit) || GRAPH_DEFAULT_LIMIT)));
  const types = opts.types?.length ? new Set(opts.types) : null;

  const [entitiesAll, counts, relations, subjectMentions, paragraphs, documents] = await Promise.all([
    repo.listEntities(projectId),
    repo.countMentionsByEntity(projectId),
    repo.listRelations(projectId),
    includeTags ? repo.listSubjectMentions(projectId) : Promise.resolve([]),
    repo.listAllParagraphs(projectId),
    repo.listDocuments(projectId),
  ]);
  const entities = new Map<string, EntityRow>(entitiesAll.filter((e) => e.status !== 'rejected').map((e) => [e.id, e]));
  const liveParagraph = new Set(paragraphs.filter((p) => !p.deletedAt).map((p) => p.id));

  // Ребра всієї книги (без фільтра типів — він застосовується до вузлів).
  const all: (Omit<StoryGraphEdge, 'evidence' | 'evidenceCount'> & { evidenceIds: string[] })[] = [];
  for (const r of relations as RelationRow[]) {
    if (r.status === 'rejected' || (!includeSuggested && r.status !== 'confirmed')) continue;
    if (!entities.has(r.fromId) || !entities.has(r.toId)) continue;
    all.push({
      id: r.id,
      kind: 'relation',
      type: r.type,
      from: r.fromId,
      to: r.toId,
      status: r.status as 'confirmed' | 'suggested',
      note: r.note,
      createdBy: r.createdBy,
      evidenceIds: r.evidence.filter((id) => liveParagraph.has(id)),
    });
  }
  const tagEdges = new Map<string, (typeof all)[number]>();
  for (const m of subjectMentions) {
    if (m.status === 'rejected' || !m.subjectEntityId || m.subjectEntityId === m.entityId) continue;
    if (!includeSuggested && m.status !== 'confirmed') continue;
    const target = entities.get(m.entityId);
    if (!target || !entities.has(m.subjectEntityId)) continue;
    const id = `tag:${m.subjectEntityId}:${m.entityId}`;
    let e = tagEdges.get(id);
    if (!e) {
      e = {
        id,
        kind: 'tag',
        type: tagLinkType(target.type),
        from: m.subjectEntityId,
        to: m.entityId,
        status: m.status as 'confirmed' | 'suggested',
        note: '',
        createdBy: null,
        evidenceIds: [],
      };
      tagEdges.set(id, e);
    }
    if (m.status === 'confirmed') e.status = 'confirmed';
    if (!e.evidenceIds.includes(m.paragraphId)) e.evidenceIds.push(m.paragraphId);
  }
  all.push(...tagEdges.values());

  const degree = new Map<string, number>();
  for (const e of all) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const typeOk = (id: string) => !types || types.has(entities.get(id)!.type);

  let chosen: Set<string>;
  let truncated = false;
  const focus = opts.focus && entities.has(opts.focus) ? opts.focus : null;
  if (focus) {
    // Сусіди на глибину 1–2 через ребра; фільтр типів — для сусідів, не для фокуса.
    chosen = new Set([focus]);
    let frontier = new Set([focus]);
    for (let d = 0; d < depth; d++) {
      const next = new Set<string>();
      for (const e of all) {
        const a = frontier.has(e.from) ? e.to : frontier.has(e.to) ? e.from : null;
        if (a && !chosen.has(a) && typeOk(a)) next.add(a);
      }
      next.forEach((id) => chosen.add(id));
      frontier = next;
    }
    if (chosen.size > limit) {
      const keep = [...chosen].filter((id) => id !== focus).sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0)).slice(0, limit - 1);
      chosen = new Set([focus, ...keep]);
      truncated = true;
    }
  } else {
    // Огляд: найзв'язніші й найзгадуваніші сутності.
    const ranked = [...entities.keys()]
      .filter(typeOk)
      .map((id) => ({ id, score: (degree.get(id) ?? 0) * 3 + (counts[id] ?? 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || entities.get(a.id)!.name.localeCompare(entities.get(b.id)!.name));
    truncated = ranked.length > limit;
    chosen = new Set(ranked.slice(0, limit).map((x) => x.id));
  }

  const edgesIn = all.filter((e) => chosen.has(e.from) && chosen.has(e.to));
  // Для фокуса з глибиною 1 — лише ребра, що торкаються фокуса (перший рівень).
  const edges = focus && depth === 1 ? edgesIn.filter((e) => e.from === focus || e.to === focus) : edgesIn;
  const preload = { paragraphs, documents };
  const outEdges: StoryGraphEdge[] = [];
  for (const e of edges) {
    const { evidenceIds, ...rest } = e;
    outEdges.push({ ...rest, evidence: await evidenceRefs(repo, projectId, evidenceIds.slice(0, MAX_EVIDENCE), preload), evidenceCount: evidenceIds.length });
  }
  const nodes: StoryGraphNode[] = [...chosen].map((id) => {
    const e = entities.get(id)!;
    return { id, type: e.type, name: e.name, status: e.status, mentions: counts[id] ?? 0, degree: degree.get(id) ?? 0 };
  });
  return { focus, depth, nodes, edges: outEdges, truncated, totals: { entities: entities.size, edges: all.length } };
}
