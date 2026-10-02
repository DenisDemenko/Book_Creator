/**
 * Вкладка «Story Graph (Граф твору)» Graph Studio (Т5.3 В3, `PLAN_STORY_CORE.md`;
 * ТЗ Graph Studio §23–25, §33, №13, 18).
 *
 * Усе — через Story Core API (`/api/core/story-core`), жодних окремих
 * копій канону: граф — справжні сутності й зв'язки книги; пропозиції — новий
 * реєстр §24 (поруч — пропозиції AI-1 старого шляху, як є).
 *   • вибір книги: адмін — усі книги ядра, інші — до яких мають доступ;
 *   • фільтри: групи типів онтології, стан (усі / підтверджені / пропозиції ШІ),
 *     джерело (автор, теги в тексті, AI-1, пропозиції реєстру);
 *   • картка вузла чи ребра з походженням (§25): ревізії, докази, хто створив,
 *     процес, модель, промпт, версія онтології, рішення й правка автора;
 *   • панель пропозицій: перевірка, схвалення (з правкою), запис у канон,
 *     відхилення — за правами (сервер перевіряє кожну операцію);
 *   • ручна пропозиція сутності чи зв'язку.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowRight, BookOpen, Check, ClipboardCheck, FilePlus2, Loader2, RotateCcw, ShieldCheck, Stamp, X } from 'lucide-react';
import { readableTextOn } from '../../utils/coreEntities';
import { forceLayout, placeAround, radialLayout, type Positions } from '../../utils/graphLayout';
import { gs } from './gsApi';

// ── Типи відповідей ────────────────────────────────────────────────────────

interface Rights { read: boolean; propose: boolean; approve: boolean; publishSchema: boolean; authorOnly?: boolean }
interface BookRow { id: string; title: string; role: string; isOwner: boolean; rights: Rights; openProposals: Record<string, number> }
interface SchemaType { id: string; name: { en: string; uk: string }; groupId: string; status: string; color: string; properties: { id: string; name: { uk: string }; type: string; required: boolean; enumId: string | null }[] }
interface SchemaRel { id: string; name: { en: string; uk: string }; status: string; from: string[] | null; to: string[] | null }
interface Schema { version: number | null; groups: { id: string; name: { en: string; uk: string } }[]; entityTypes: SchemaType[]; relationTypes: SchemaRel[]; enums: { id: string; values: { id: string; name: { uk: string } }[] }[] }
interface EvidenceRef { paragraphId: string; excerpt: string; chapterId: string | null; sectionId: string }
interface GNode { id: string; type: string; name: string; status: string; mentions: number; degree: number }
interface GEdge { id: string; kind: 'relation' | 'tag'; type: string; from: string; to: string; status: 'confirmed' | 'suggested'; evidence: EvidenceRef[]; evidenceCount: number; note: string; createdBy: string | null }
interface Graph { nodes: GNode[]; edges: GEdge[]; truncated: boolean; totals: { entities: number; edges: number } }
interface Issue { code: string; message: string; field?: string }
interface Proposal {
  id: string; kind: 'entity' | 'relation'; state: string; payload: any; evidence: string[]; confidence: number | null; provenance: Record<string, any>;
  validation: { ok: boolean; errors: Issue[]; warnings: Issue[]; ontologyVersion: number | null } | null;
  authorEdit: { fields: string[]; before: any; after: any } | null; canonRef: string | null; supersededBy: string | null; revision: number;
  createdBy: string; createdAt: string; decidedBy: string | null; decidedAt: string | null; reason: string;
}
interface Legacy { suggestions: any[]; relations: { id: string; type: string; fromId: string; toId: string; evidence: string[]; createdBy: string }[] }

const OPEN = ['detected', 'proposed', 'validated', 'approved'];
const STATE_LABEL: Record<string, string> = {
  detected: 'Detected (Виявлено)', proposed: 'Proposed (Запропоновано)', validated: 'Validated (Перевірено)', approved: 'Approved (Схвалено)',
  canon: 'Canon (Канон)', rejected: 'Rejected (Відхилено)', superseded: 'Superseded (Замінено)',
};
const STATE_CLASS: Record<string, string> = {
  detected: 'border-slate-600 text-slate-300', proposed: 'border-amber-500/50 text-amber-200', validated: 'border-sky-500/50 text-sky-200',
  approved: 'border-violet-500/50 text-violet-200', canon: 'border-emerald-500/50 text-emerald-200', rejected: 'border-rose-500/40 text-rose-300', superseded: 'border-slate-700 text-slate-500',
};
type SourceKey = 'author' | 'tag' | 'ai' | 'proposal';
const SOURCES: { id: SourceKey; label: string }[] = [
  { id: 'author', label: 'автор' },
  { id: 'tag', label: 'теги в тексті' },
  { id: 'ai', label: 'AI-1' },
  { id: 'proposal', label: 'пропозиції' },
];
const edgeSource = (e: GEdge): SourceKey => (e.kind === 'tag' ? 'tag' : e.createdBy?.startsWith('ai:') ? 'ai' : 'author');
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('uk-UA') : '—');
const who = (actor: string | null | undefined) => (actor ? actor.replace(/^user:/, '👤 ').replace(/^ai:/, '🤖 ').replace(/^system:/, '⚙ ') : '—');

const call = async <T,>(op: string, projectId: string | null, args: Record<string, unknown> = {}): Promise<T> =>
  (await gs<{ result: T }>('POST', `/api/core/story-core/call/${op}`, { projectId: projectId ?? undefined, args })).result;

const BOOK_KEY = 'gs.storyBook';
const readBook = () => { try { return localStorage.getItem(BOOK_KEY) || ''; } catch { return ''; } };
const saveBook = (id: string) => { try { localStorage.setItem(BOOK_KEY, id); } catch { /* немає сховища — не страшно */ } };

// ── Вузол графа ─────────────────────────────────────────────────────────────

type NodeData = { label: string; type: string; typeName: string; color: string; mentions: number; selected: boolean; suggested: boolean };
const EntityNode: React.FC<NodeProps<Node<NodeData>>> = ({ data }) => (
  <div
    className="rounded-xl px-3 py-1.5 text-center shadow-lg"
    style={{ background: data.color, color: readableTextOn(data.color), outline: data.selected ? '3px solid #f8fafc' : data.suggested ? '2px dashed #a78bfa' : 'none', outlineOffset: 2, minWidth: 90, maxWidth: 190 }}
    data-gs-story-node-type={data.type}
  >
    <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
    <div className="truncate text-[12px] font-bold leading-tight">{data.label}</div>
    <div className="truncate text-[9px] opacity-80">{data.typeName}{data.mentions ? ` · ${data.mentions}` : ''}</div>
    <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
  </div>
);
const nodeTypes = { entity: EntityNode };

// ── Походження (§25) ────────────────────────────────────────────────────────

const Provenance: React.FC<{ p: Proposal; relName: (k: string) => string }> = ({ p }) => {
  const pr = p.provenance ?? {};
  const rows: [string, React.ReactNode][] = [
    ['Джерело', pr.source === 'workflow' ? 'процес ШІ' : pr.source === 'ai' ? 'ШІ' : 'автор'],
    ['Хто запропонував', who(p.createdBy)],
    ...(pr.workflowId ? [['Процес', `${pr.workflowId}${pr.workflowVersion ? ` v${pr.workflowVersion}` : ''}${pr.nodeId ? ` · вузол ${pr.nodeId}` : ''}`] as [string, React.ReactNode]] : []),
    ...(pr.model ? [['Модель', pr.model] as [string, React.ReactNode]] : []),
    ...(pr.promptVersion ? [['Версія промпту', pr.promptVersion] as [string, React.ReactNode]] : []),
    ...(pr.ontologyVersion ? [['Версія онтології', `v${pr.ontologyVersion}`] as [string, React.ReactNode]] : []),
    ...(p.confidence != null ? [['Впевненість', `${Math.round(p.confidence * 100)}%`] as [string, React.ReactNode]] : []),
    ...(Array.isArray(pr.jevDecisions) && pr.jevDecisions.length ? [['Рішення Jev', pr.jevDecisions.map((d: any) => [d.node, d.choice ?? d.decision, d.score != null ? `(${d.score})` : ''].filter(Boolean).join(' ')).join('; ')] as [string, React.ReactNode]] : []),
    ...(p.decidedBy ? [['Вирішив', `${who(p.decidedBy)} · ${fmt(p.decidedAt)}`] as [string, React.ReactNode]] : []),
    ...(p.authorEdit?.fields.length ? [['Виправив автор', p.authorEdit.fields.join(', ')] as [string, React.ReactNode]] : []),
    ...(p.reason ? [['Причина', p.reason] as [string, React.ReactNode]] : []),
  ];
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11px]" data-gs-provenance={p.id}>
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words text-slate-200">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
};

// ── Головна панель ─────────────────────────────────────────────────────────

function Inner() {
  const flow = useReactFlow();
  const [books, setBooks] = useState<BookRow[] | null>(null);
  const [bookId, setBookId] = useState<string>(readBook());
  const [schema, setSchema] = useState<Schema | null>(null);
  const [nodes, setNodes] = useState<Map<string, GNode>>(new Map());
  const [edges, setEdges] = useState<Map<string, GEdge>>(new Map());
  const [positions, setPositions] = useState<Positions>({});
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  /** Останній запит графа: відповідь на давніший не перезаписує новішого. */
  const requestSeq = useRef(0);
  const [meta, setMeta] = useState<{ truncated: boolean; totals: { entities: number; edges: number } }>({ truncated: false, totals: { entities: 0, edges: 0 } });
  const [groups, setGroups] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<'all' | 'confirmed' | 'suggested'>('all');
  const [sources, setSources] = useState<Set<SourceKey>>(new Set(['author', 'tag', 'ai', 'proposal']));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge' | 'proposal'; id: string } | null>(null);
  const [entityCard, setEntityCard] = useState<any | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [legacy, setLegacy] = useState<Legacy>({ suggestions: [], relations: [] });
  const [showClosed, setShowClosed] = useState(false);
  const [entities, setEntities] = useState<{ id: string; name: string; type: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'card' | 'proposals' | 'new'>('proposals');

  const book = books?.find((b) => b.id === bookId) ?? null;
  const rights = book?.rights;

  useEffect(() => {
    gs<{ projects: BookRow[] }>('GET', '/api/core/story-core/projects')
      .then((r) => {
        setBooks(r.projects);
        if (!r.projects.some((b) => b.id === bookId)) setBookId(r.projects[0]?.id ?? '');
      })
      .catch((e) => setError(e.message));
    call<Schema>('get_schema', null, { compact: true }).then(setSchema).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeOf = useCallback((id: string) => schema?.entityTypes.find((t) => t.id === id), [schema]);
  const typeName = (id: string) => typeOf(id)?.name.uk ?? id;
  const typeColor = (id: string) => typeOf(id)?.color ?? '#64748b';
  const relName = useCallback((k: string) => schema?.relationTypes.find((r) => r.id === k)?.name.uk ?? k, [schema]);
  const nameOf = (id: string) => nodes.get(id)?.name ?? entities.find((e) => e.id === id)?.name ?? id.slice(0, 8);

  const graphTypes = useMemo(() => (groups.length && schema ? schema.entityTypes.filter((t) => groups.includes(t.groupId)).map((t) => t.id) : []), [groups, schema]);
  const graphArgs = useCallback((focus?: string) => ({ ...(focus ? { focus, depth: 1 } : { isolated: true }), types: graphTypes, suggested: stateFilter !== 'confirmed', tags: sources.has('tag') }), [graphTypes, stateFilter, sources]);

  const loadProposals = useCallback(async () => {
    if (!bookId) return;
    const r = await call<{ proposals: Proposal[]; legacy: Legacy }>('list_proposals', bookId, { limit: 500 });
    setProposals(r.proposals);
    setLegacy(r.legacy ?? { suggestions: [], relations: [] });
  }, [bookId]);

  const loadGraph = useCallback(async () => {
    if (!bookId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setSelected(null);
    setEntityCard(null);
    try {
      const g = await call<Graph>('get_graph', bookId, graphArgs());
      if (seq !== requestSeq.current) return;
      setNodes(new Map(g.nodes.map((n) => [n.id, n])));
      setEdges(new Map(g.edges.map((e) => [e.id, e])));
      setPositions(forceLayout(g.nodes, g.edges));
      setMeta({ truncated: g.truncated, totals: g.totals });
      setTimeout(() => flow.fitView({ padding: 0.2, duration: 300 }), 50);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError((e as Error).message);
      setNodes(new Map());
      setEdges(new Map());
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [bookId, graphArgs, flow]);

  useEffect(() => {
    if (!bookId) return;
    saveBook(bookId);
    void loadGraph();
  }, [bookId, loadGraph]);
  useEffect(() => {
    if (!bookId) return;
    void loadProposals().catch(() => {});
    call<{ entities: { id: string; name: string; type: string }[] }>('search_entities', bookId, { limit: 500 }).then((r) => setEntities(r.entities)).catch(() => setEntities([]));
  }, [bookId, loadProposals]);

  const openNode = useCallback(async (id: string) => {
    const seq = ++requestSeq.current;
    setSelected({ kind: 'node', id });
    setTab('card');
    setEntityCard(null);
    try {
      const [g, card] = await Promise.all([call<Graph>('get_graph', bookId, graphArgs(id)), call<any>('get_entity', bookId, { entityId: id })]);
      if (seq !== requestSeq.current) return;
      setEntityCard(card);
      const fresh = g.nodes.filter((n) => !nodes.has(n.id));
      setNodes((prev) => { const next = new Map(prev); g.nodes.forEach((n) => next.set(n.id, n)); return next; });
      setEdges((prev) => { const next = new Map(prev); g.edges.forEach((e) => next.set(e.id, e)); return next; });
      if (fresh.length) {
        const center = positionsRef.current[id] ?? { x: 0, y: 0 };
        const placed = Object.keys(positionsRef.current).length ? placeAround(center, fresh.map((n) => n.id), positionsRef.current) : radialLayout(id, g.nodes, g.edges);
        setPositions((prev) => ({ ...prev, ...placed }));
      }
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    }
  }, [bookId, graphArgs, nodes]);

  const act = async (fn: () => Promise<string>, reload: 'graph' | 'proposals' | 'both' = 'both') => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await fn();
      setNotice({ kind: 'ok', text });
      if (reload !== 'graph') await loadProposals();
      if (reload !== 'proposals') {
        const keep = selected;
        await loadGraph();
        if (keep?.kind === 'proposal') setSelected(keep);
      }
      gs<{ projects: BookRow[] }>('GET', '/api/core/story-core/projects').then((r) => setBooks(r.projects)).catch(() => {});
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // ── Полотно ───────────────────────────────────────────────────────────────

  const openRelationProposals = proposals.filter((p) => p.kind === 'relation' && OPEN.includes(p.state));
  const visibleEdges = useMemo(() => [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to) && sources.has(edgeSource(e)) && (stateFilter !== 'suggested' || e.status === 'suggested')), [edges, nodes, sources, stateFilter]);
  const rfNodes: Node<NodeData>[] = useMemo(() => [...nodes.values()].map((n) => ({
    id: n.id,
    type: 'entity',
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { label: n.name, type: n.type, typeName: typeName(n.type), color: typeColor(n.type), mentions: n.mentions, selected: selected?.kind === 'node' && selected.id === n.id, suggested: n.status === 'suggested' },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [nodes, positions, selected, schema]);
  const rfEdges: Edge[] = useMemo(() => {
    const out: Edge[] = visibleEdges.map((e) => {
      const color = e.status === 'suggested' ? '#a78bfa' : e.kind === 'tag' ? '#94a3b8' : '#38bdf8';
      const hot = selected?.kind === 'edge' && selected.id === e.id;
      return {
        id: e.id, source: e.from, target: e.to, label: relName(e.type), animated: e.status === 'suggested',
        style: { stroke: color, strokeWidth: hot ? 3 : 1.4, strokeDasharray: e.kind === 'tag' ? '5 4' : undefined },
        labelStyle: { fill: '#e2e8f0', fontSize: 10 }, labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 }, markerEnd: { type: MarkerType.ArrowClosed, color },
        data: { kind: 'edge' },
      } as Edge;
    });
    if (sources.has('proposal')) {
      for (const p of openRelationProposals) {
        if (!nodes.has(p.payload.fromId) || !nodes.has(p.payload.toId)) continue;
        out.push({
          id: `proposal:${p.id}`, source: p.payload.fromId, target: p.payload.toId, label: `${relName(p.payload.type)} · пропозиція`,
          style: { stroke: '#f59e0b', strokeWidth: selected?.id === p.id ? 3 : 1.6, strokeDasharray: '2 5' },
          labelStyle: { fill: '#fde68a', fontSize: 10 }, labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
        } as Edge);
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEdges, openRelationProposals, nodes, sources, selected, relName]);

  const selectedEdge = selected?.kind === 'edge' ? edges.get(selected.id) : undefined;
  const selectedNode = selected?.kind === 'node' ? nodes.get(selected.id) : undefined;
  const linkedProposals = (recordId: string) => proposals.filter((p) => p.canonRef === recordId || (p.kind === 'entity' && p.payload.targetId === recordId));

  // ── Рендер ───────────────────────────────────────────────────────────────

  if (error && !books) return <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" data-gs-story-error>{error}</div>;
  if (!books) return <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!books.length) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-300" data-gs-story-empty>
        Немає книг у семантичному ядрі, до яких у вас є доступ. Книга з'являється тут після першого збереження (синхронізація з ядром).
      </div>
    );
  }

  const visibleProposals = proposals.filter((p) => showClosed || OPEN.includes(p.state));

  return (
    <section className="min-w-0 space-y-3" data-gs-story>
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <BookOpen className="h-4 w-4 text-slate-400" />
          <select value={bookId} onChange={(e) => setBookId(e.target.value)} className="min-w-0 max-w-full flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-100 sm:flex-none" data-gs-story-book>
            {books.map((b) => (
              <option key={b.id} value={b.id}>{b.title}{OPEN.reduce((n, s) => n + (b.openProposals[s] ?? 0), 0) ? ` · пропозицій: ${OPEN.reduce((n, s) => n + (b.openProposals[s] ?? 0), 0)}` : ''}</option>
            ))}
          </select>
          {rights && (
            <div className="flex flex-wrap gap-1 text-[10px]" data-gs-story-rights>
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">{book!.isOwner ? 'власник' : book!.role}</span>
              <span className={`rounded-full border px-2 py-0.5 ${rights.propose ? 'border-amber-500/50 text-amber-200' : 'border-slate-700 text-slate-500'}`}>{rights.propose ? 'пропонує' : 'лише читання'}</span>
              <span className={`rounded-full border px-2 py-0.5 ${rights.approve ? 'border-emerald-500/50 text-emerald-200' : 'border-slate-700 text-slate-500'}`} data-gs-story-canon-write={rights.approve ? 'yes' : 'no'}>{rights.approve ? 'CANON_WRITE' : 'без запису в канон'}</span>
            </div>
          )}
          {schema?.version != null && <span className="text-[10px] text-slate-500">онтологія v{schema.version}</span>}
          <button type="button" onClick={() => void loadGraph()} className="ml-auto flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-sky-500" data-gs-story-reload>
            <RotateCcw className="h-3.5 w-3.5" /> Огляд
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-gs-story-groups>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">групи</span>
          {(schema?.groups ?? []).map((g) => {
            const on = groups.includes(g.id);
            return (
              <button key={g.id} type="button" title={`${g.name.en} (${g.name.uk})`} onClick={() => setGroups((prev) => (on ? prev.filter((x) => x !== g.id) : [...prev, g.id]))}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-sky-400 bg-sky-500/20 font-bold text-sky-100' : 'border-slate-700 text-slate-300'}`} data-gs-story-group={g.id}>
                {g.id}<span className="hidden sm:inline"> · {g.name.uk}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">стан</span>
          {([['all', 'усі'], ['confirmed', 'підтверджені'], ['suggested', 'пропозиції ШІ']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setStateFilter(id)} className={`rounded-full border px-2 py-0.5 text-[11px] ${stateFilter === id ? 'border-amber-400 bg-amber-500/20 font-bold text-amber-100' : 'border-slate-700 text-slate-300'}`} data-gs-story-state={id}>{label}</button>
          ))}
          <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">джерело</span>
          {SOURCES.map((s) => {
            const on = sources.has(s.id);
            return (
              <button key={s.id} type="button" onClick={() => setSources((prev) => { const n = new Set(prev); if (on) n.delete(s.id); else n.add(s.id); return n; })}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-violet-400 bg-violet-500/20 text-violet-100' : 'border-slate-700 text-slate-500 line-through'}`} data-gs-story-source={s.id}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {notice && <div className={`rounded-xl border px-3 py-2 text-xs ${notice.kind === 'ok' ? 'border-emerald-500/40 text-emerald-200' : 'border-rose-500/40 text-rose-200'}`} data-gs-story-notice={notice.kind}>{notice.text}</div>}
      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" data-gs-story-error>{error}</p>}

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row">
        <div className="relative h-[52vh] min-h-[340px] min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 lg:h-[70vh]" data-gs-story-canvas>
          {loading && <Loader2 className="absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 animate-spin text-slate-500" />}
          {!loading && !error && nodes.size === 0 && (
            <p className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-slate-400">На графі поки нічого (або фільтр нічого не лишив).</p>
          )}
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => void openNode(n.id)}
            onEdgeClick={(_, e) => {
              if (e.id.startsWith('proposal:')) { setSelected({ kind: 'proposal', id: e.id.slice(9) }); setTab('proposals'); }
              else { setSelected({ kind: 'edge', id: e.id }); setTab('card'); }
            }}
            onNodeDragStop={(_, n) => setPositions((prev) => ({ ...prev, [n.id]: n.position }))}
            onPaneClick={() => { setSelected(null); setEntityCard(null); }}
            minZoom={0.15}
            maxZoom={2.5}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={24} color="#1e293b" />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="pointer-events-none absolute bottom-2 left-12 right-2 text-[10px] text-slate-500" data-gs-story-totals>
            На графі {nodes.size} з {meta.totals.entities} сутностей, {visibleEdges.length} зв'язків{meta.truncated ? ' (огляд обрізано — відкривайте вузли)' : ''}
          </div>
        </div>

        <aside className="w-full shrink-0 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 lg:max-h-[70vh] lg:w-[420px] lg:overflow-y-auto" data-gs-story-side>
          <div className="flex gap-1 text-[11px]">
            {([['card', 'Картка'], ['proposals', `Пропозиції (${proposals.filter((p) => OPEN.includes(p.state)).length})`], ['new', 'Нова пропозиція']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-lg px-2.5 py-1 font-bold ${tab === id ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800'}`} data-gs-story-side-tab={id}>{label}</button>
            ))}
          </div>

          {tab === 'card' && (
            <div data-gs-story-card={selected?.id ?? ''}>
              {!selected && <p className="text-[11px] text-slate-500">Оберіть вузол чи зв'язок на графі — тут буде його походження.</p>}
              {selectedNode && (
                <div className="space-y-2" data-gs-story-node-card={selectedNode.id}>
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: typeColor(selectedNode.type) }} />
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-100">{selectedNode.name}</h3>
                      <p className="text-[11px] text-slate-400">{typeName(selectedNode.type)} · {selectedNode.status === 'confirmed' ? 'канон' : selectedNode.status === 'suggested' ? 'запропоновано AI-1' : selectedNode.status} · згадок: {selectedNode.mentions}</p>
                    </div>
                  </div>
                  {!entityCard && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
                  {entityCard && (
                    <>
                      {entityCard.aliases?.length > 0 && <p className="text-[11px] text-slate-400">Також: {entityCard.aliases.map((a: any) => a.alias).join(', ')}</p>}
                      <p className="text-[11px] text-slate-400">Створив: {who(entityCard.entity.createdBy)} · {fmt(entityCard.entity.createdAt)} · ревізія {entityCard.entity.version}</p>
                      {Object.keys(entityCard.entity.canonical ?? {}).length > 0 && (
                        <dl className="grid grid-cols-[auto,1fr] gap-x-2 text-[11px]" data-gs-story-canonical>
                          {Object.entries(entityCard.entity.canonical).map(([k, v]) => (
                            <React.Fragment key={k}><dt className="text-slate-500">{typeOf(selectedNode.type)?.properties.find((p) => p.id === k)?.name.uk ?? k}</dt><dd className="break-words text-slate-200">{String(v)}</dd></React.Fragment>
                          ))}
                        </dl>
                      )}
                      <h4 className="pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Ревізії</h4>
                      <ul className="space-y-0.5 text-[11px] text-slate-400" data-gs-story-versions>
                        {(entityCard.versions ?? []).map((v: any) => (
                          <li key={v.version}><span className="font-mono text-slate-200">r{v.version}</span> · {who(v.changedBy)} · {fmt(v.changedAt)}{v.reason ? ` · ${v.reason}` : ''}</li>
                        ))}
                      </ul>
                      {linkedProposals(selectedNode.id).map((p) => (
                        <div key={p.id} className="rounded-lg border border-slate-800 p-2">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">Походження з пропозиції</p>
                          <Provenance p={p} relName={relName} />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
              {selectedEdge && (
                <div className="space-y-2" data-gs-story-edge-card={selectedEdge.id}>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-200">
                    <b>{nameOf(selectedEdge.from)}</b><ArrowRight className="h-3 w-3 text-slate-500" />
                    <span className="rounded bg-slate-800 px-1.5 text-[11px] text-sky-200">{relName(selectedEdge.type)}</span>
                    <ArrowRight className="h-3 w-3 text-slate-500" /><b>{nameOf(selectedEdge.to)}</b>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {selectedEdge.kind === 'tag' ? 'з тегів у тексті (змінюється лише в тексті)' : selectedEdge.status === 'suggested' ? 'запропоновано AI-1' : 'канон'}
                    {selectedEdge.createdBy ? ` · створив ${who(selectedEdge.createdBy)}` : ''}
                  </p>
                  {selectedEdge.note && <p className="text-[11px] italic text-slate-400">«{selectedEdge.note}»</p>}
                  <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Докази ({selectedEdge.evidenceCount})</h4>
                  {selectedEdge.evidence.length ? (
                    <ul className="space-y-1" data-gs-story-evidence>
                      {selectedEdge.evidence.map((ev) => <li key={ev.paragraphId} className="text-[11px] text-slate-400">{ev.excerpt}</li>)}
                    </ul>
                  ) : <p className="text-[11px] text-slate-500">Без абзаців-джерел.</p>}
                  {linkedProposals(selectedEdge.id).map((p) => (
                    <div key={p.id} className="rounded-lg border border-slate-800 p-2">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">Походження з пропозиції</p>
                      <Provenance p={p} relName={relName} />
                    </div>
                  ))}
                  {selectedEdge.kind === 'relation' && selectedEdge.status === 'suggested' && rights?.propose && (
                    <div className="flex gap-1.5">
                      <button type="button" disabled={busy} onClick={() => void act(async () => { await gs('POST', `/api/projects/${encodeURIComponent(bookId)}/relations/${selectedEdge.id}/status`, { status: 'confirmed' }); return 'Зв\'язок AI-1 підтверджено.'; })} className="flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-300" data-gs-story-edge-confirm><Check className="h-3 w-3" /> Підтвердити</button>
                      <button type="button" disabled={busy} onClick={() => void act(async () => { await gs('POST', `/api/projects/${encodeURIComponent(bookId)}/relations/${selectedEdge.id}/status`, { status: 'rejected' }); return 'Зв\'язок AI-1 відхилено.'; })} className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-0.5 text-[11px] text-rose-300" data-gs-story-edge-reject><X className="h-3 w-3" /> Відхилити</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'proposals' && (
            <div className="space-y-2" data-gs-story-proposals>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} data-gs-story-show-closed /> показати й вирішені</label>
              {visibleProposals.length === 0 && <p className="text-[11px] text-slate-500">Відкритих пропозицій немає.</p>}
              <ul className="space-y-1.5">
                {visibleProposals.map((p) => (
                  <ProposalRow key={p.id} p={p} active={selected?.id === p.id} rights={rights} busy={busy} schema={schema} nameOf={nameOf} typeName={typeName} relName={relName}
                    onSelect={() => setSelected({ kind: 'proposal', id: p.id })}
                    onAct={(op, args, msg) => void act(async () => { await call(op, bookId, { proposalId: p.id, expectedRevision: p.revision, ...args }); return msg; }, op === 'validate_entity' || op === 'validate_relation' || op === 'reject_proposal' ? 'proposals' : 'both')}
                  />
                ))}
              </ul>
              {(legacy.relations.length > 0 || legacy.suggestions.length > 0) && (
                <div className="space-y-1.5 border-t border-slate-800 pt-2" data-gs-story-legacy>
                  <h4 className="text-[10px] font-bold uppercase tracking-wide text-violet-300">Пропозиції AI-1 (Т1.1, як є)</h4>
                  <ul className="space-y-1">
                    {legacy.relations.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 p-1.5 text-[11px] text-slate-300" data-gs-story-legacy-relation={r.id}>
                        <span>{nameOf(r.fromId)} → {relName(r.type)} → {nameOf(r.toId)}</span>
                        {rights?.propose && (
                          <span className="ml-auto flex gap-1">
                            <button type="button" disabled={busy} title="Підтвердити" onClick={() => void act(async () => { await gs('POST', `/api/projects/${encodeURIComponent(bookId)}/relations/${r.id}/status`, { status: 'confirmed' }); return 'Зв\'язок AI-1 підтверджено.'; })} className="rounded border border-emerald-500/40 px-1.5 text-emerald-300"><Check className="h-3 w-3" /></button>
                            <button type="button" disabled={busy} title="Відхилити" onClick={() => void act(async () => { await gs('POST', `/api/projects/${encodeURIComponent(bookId)}/relations/${r.id}/status`, { status: 'rejected' }); return 'Зв\'язок AI-1 відхилено.'; })} className="rounded border border-rose-500/40 px-1.5 text-rose-300"><X className="h-3 w-3" /></button>
                          </span>
                        )}
                      </li>
                    ))}
                    {legacy.suggestions.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 p-1.5 text-[11px] text-slate-300" data-gs-story-legacy-suggestion={s.id}>
                        <span className="min-w-0 flex-1">
                          {s.kind === 'relation_suggestion' ? `${s.entityName} → ${relName(s.relationType)} → ${s.targetEntityName}` : `згадка: ${s.entityName} (${typeName(s.entityType)})`}
                          {s.paragraphExcerpt && <span className="block truncate text-[10px] text-slate-500">{s.paragraphExcerpt}</span>}
                        </span>
                        {rights?.propose && (
                          <span className="flex gap-1">
                            {s.kind === 'relation_suggestion' && (
                              <button type="button" disabled={busy} title="Підтвердити" onClick={() => void act(async () => { await gs('POST', `/api/projects/${encodeURIComponent(bookId)}/suggestions/${s.id}/confirm`); return 'Пропозицію AI-1 підтверджено.'; })} className="rounded border border-emerald-500/40 px-1.5 text-emerald-300"><Check className="h-3 w-3" /></button>
                            )}
                            <button type="button" disabled={busy} title="Відхилити" onClick={() => void act(async () => { await gs('POST', `/api/projects/${encodeURIComponent(bookId)}/suggestions/${s.id}/reject`); return 'Пропозицію AI-1 відхилено.'; })} className="rounded border border-rose-500/40 px-1.5 text-rose-300"><X className="h-3 w-3" /></button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-slate-500">Згадку підтверджують у редакторі книги — там ставиться тег.</p>
                </div>
              )}
            </div>
          )}

          {tab === 'new' && (
            rights?.propose
              ? <NewProposal schema={schema} entities={entities} defaultFrom={selectedNode?.id ?? ''} busy={busy} onSubmit={(op, args) => void act(async () => {
                  const r = await call<{ proposal: Proposal }>(op, bookId, { ...args, validate: true });
                  setSelected({ kind: 'proposal', id: r.proposal.id });
                  setTab('proposals');
                  return r.proposal.validation?.ok ? 'Пропозицію створено й перевірено.' : `Пропозицію створено, але перевірка не пройдена: ${(r.proposal.validation?.errors ?? []).map((e) => e.message).join('; ')}`;
                }, 'proposals')} />
              : <p className="text-[11px] text-slate-500" data-gs-story-no-propose>Пропонувати можуть ті, хто редагує книгу.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

// ── Рядок пропозиції ───────────────────────────────────────────────────────

interface RowProps {
  p: Proposal; active: boolean; rights?: Rights; busy: boolean; schema: Schema | null;
  nameOf: (id: string) => string; typeName: (id: string) => string; relName: (k: string) => string;
  onSelect: () => void; onAct: (op: string, args: Record<string, unknown>, message: string) => void;
}

const ProposalRow: React.FC<RowProps> = ({ p, active, rights, busy, schema, nameOf, typeName, relName, onSelect, onAct }) => {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState<string>(p.kind === 'entity' ? p.payload.name : p.payload.note ?? '');
  const [canonical, setCanonical] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p.payload.canonical ?? {}).map(([k, v]) => [k, String(v)])));
  const [reason, setReason] = useState('');
  const open = OPEN.includes(p.state);
  const props = p.kind === 'entity' ? schema?.entityTypes.find((t) => t.id === p.payload.type)?.properties ?? [] : [];
  const edits = () => {
    if (!edit) return undefined;
    if (p.kind === 'relation') return { payload: { note: name } };
    const c: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(canonical)) if (v.trim()) c[k] = props.find((x) => x.id === k)?.type === 'number' ? Number(v) : v.trim();
    return { payload: { name, canonical: c } };
  };
  const validateOp = p.kind === 'entity' ? 'validate_entity' : 'validate_relation';
  return (
    <li className={`rounded-lg border p-2 ${active ? 'border-amber-400 bg-amber-500/5' : 'border-slate-800 bg-slate-950/40'}`} data-gs-proposal={p.id} data-gs-proposal-state={p.state} onClick={onSelect}>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-200">
        <span className={`rounded-full border px-1.5 text-[10px] ${STATE_CLASS[p.state]}`}>{STATE_LABEL[p.state] ?? p.state}</span>
        {p.kind === 'entity'
          ? <span><b>{p.payload.name}</b> <span className="text-slate-400">· {typeName(p.payload.type)}{p.payload.targetId ? ' (уточнення)' : ''}</span></span>
          : <span>{nameOf(p.payload.fromId)} → <span className="text-sky-200">{relName(p.payload.type)}</span> → {nameOf(p.payload.toId)}</span>}
      </div>
      {p.validation && (p.validation.errors.length > 0 || p.validation.warnings.length > 0) && (
        <ul className="mt-1 space-y-0.5 text-[10px]" data-gs-proposal-issues>
          {p.validation.errors.map((e, i) => <li key={`e${i}`} className="text-rose-300" data-gs-issue={e.code}>✗ {e.message}</li>)}
          {p.validation.warnings.map((w, i) => <li key={`w${i}`} className="text-amber-300" data-gs-issue={w.code}>! {w.message}</li>)}
        </ul>
      )}
      {active && (
        <div className="mt-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <Provenance p={p} relName={relName} />
          {open && rights?.approve && edit && (
            <div className="space-y-1 rounded-lg border border-slate-800 p-1.5" data-gs-proposal-edit>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={p.kind === 'entity' ? 'назва' : 'примітка'} className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100" data-gs-proposal-edit-name />
              {props.map((pr) => (
                <input key={pr.id} value={canonical[pr.id] ?? ''} onChange={(e) => setCanonical((c) => ({ ...c, [pr.id]: e.target.value }))} placeholder={`${pr.name.uk}${pr.required ? ' *' : ''}`} className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200" data-gs-proposal-edit-prop={pr.id} />
              ))}
            </div>
          )}
          {open && (rights?.propose || rights?.approve) && (
            <div className="flex flex-wrap gap-1">
              {rights?.propose && p.state !== 'approved' && (
                <button type="button" disabled={busy} onClick={() => onAct(validateOp, {}, 'Перевірку виконано.')} className="flex items-center gap-1 rounded border border-sky-500/40 px-2 py-0.5 text-[11px] text-sky-200" data-gs-proposal-validate><ClipboardCheck className="h-3 w-3" /> Перевірити</button>
              )}
              {rights?.approve && (
                <>
                  <button type="button" disabled={busy} onClick={() => setEdit((v) => !v)} className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200" data-gs-proposal-edit-toggle>{edit ? 'Без правки' : 'Правка'}</button>
                  {p.state !== 'approved' && (
                    <button type="button" disabled={busy} onClick={() => onAct('approve_proposal', { edits: edits(), reason }, 'Пропозицію схвалено.')} className="flex items-center gap-1 rounded border border-violet-500/40 px-2 py-0.5 text-[11px] text-violet-200" data-gs-proposal-approve><ShieldCheck className="h-3 w-3" /> Схвалити</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => onAct(p.state === 'approved' && !edit ? 'write_canon' : 'approve_proposal', p.state === 'approved' && !edit ? {} : { edits: edits(), reason, writeCanon: true }, 'Записано в канон.')} className="flex items-center gap-1 rounded border border-emerald-500/50 px-2 py-0.5 text-[11px] font-bold text-emerald-200" data-gs-proposal-canon><Stamp className="h-3 w-3" /> {p.state === 'approved' ? 'У канон' : 'Схвалити й у канон'}</button>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="причина (необовʼязково)" className="min-w-[120px] flex-1 rounded border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-200" data-gs-proposal-reason />
                  <button type="button" disabled={busy} onClick={() => onAct('reject_proposal', { reason }, 'Пропозицію відхилено.')} className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-0.5 text-[11px] text-rose-300" data-gs-proposal-reject><X className="h-3 w-3" /> Відхилити</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
};

// ── Ручна пропозиція ────────────────────────────────────────────────────────

const NewProposal: React.FC<{ schema: Schema | null; entities: { id: string; name: string; type: string }[]; defaultFrom: string; busy: boolean; onSubmit: (op: string, args: Record<string, unknown>) => void }> = ({ schema, entities, defaultFrom, busy, onSubmit }) => {
  const [kind, setKind] = useState<'entity' | 'relation'>('entity');
  const [type, setType] = useState('character');
  const [name, setName] = useState('');
  const [props, setProps] = useState<Record<string, string>>({});
  const [rel, setRel] = useState({ type: 'participates_in', fromId: defaultFrom, toId: '', note: '' });
  useEffect(() => { if (defaultFrom) setRel((r) => ({ ...r, fromId: defaultFrom })); }, [defaultFrom]);
  const types = (schema?.entityTypes ?? []).filter((t) => t.status === 'active');
  const typeDef = types.find((t) => t.id === type);
  const from = entities.find((e) => e.id === rel.fromId);
  const to = entities.find((e) => e.id === rel.toId);
  // Підказка з онтології: які зв'язки підходять до обраних кінців.
  const relTypes = (schema?.relationTypes ?? []).filter((r) => r.status === 'active' && (!from || !r.from || r.from.includes(from.type)) && (!to || !r.to || r.to.includes(to.type)));
  useEffect(() => {
    if (relTypes.length && !relTypes.some((r) => r.id === rel.type)) setRel((r) => ({ ...r, type: relTypes[0].id }));
  }, [relTypes, rel.type]);
  return (
    <div className="space-y-1.5 text-xs" data-gs-story-new>
      <div className="flex gap-1">
        {(['entity', 'relation'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-lg border px-2 py-0.5 text-[11px] ${kind === k ? 'border-amber-400 text-amber-100' : 'border-slate-700 text-slate-400'}`} data-gs-story-new-kind={k}>{k === 'entity' ? 'Сутність' : 'Звʼязок'}</button>
        ))}
      </div>
      {kind === 'entity' ? (
        <>
          <select value={type} onChange={(e) => { setType(e.target.value); setProps({}); }} className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-slate-200" data-gs-story-new-type>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name.en} ({t.name.uk})</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="назва" className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-slate-100" data-gs-story-new-name />
          {(typeDef?.properties ?? []).slice(0, 12).map((pr) => (
            <input key={pr.id} value={props[pr.id] ?? ''} onChange={(e) => setProps((p) => ({ ...p, [pr.id]: e.target.value }))} placeholder={`${pr.name.uk}${pr.required ? ' *' : ''}`} className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200" data-gs-story-new-prop={pr.id} />
          ))}
          <button type="button" disabled={busy || !name.trim()} onClick={() => {
            const canonical: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(props)) if (v.trim()) canonical[k] = typeDef?.properties.find((x) => x.id === k)?.type === 'number' ? Number(v) : v.trim();
            onSubmit('create_entity_proposal', { type, name: name.trim(), canonical });
          }} className="flex w-full items-center justify-center gap-1 rounded-lg bg-amber-500 py-1.5 font-bold text-slate-950 disabled:opacity-50" data-gs-story-new-submit><FilePlus2 className="h-3.5 w-3.5" /> Запропонувати сутність</button>
        </>
      ) : (
        <>
          <select value={rel.fromId} onChange={(e) => setRel((r) => ({ ...r, fromId: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-slate-200" data-gs-story-new-from>
            <option value="">звідки…</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.type}</option>)}
          </select>
          <select value={rel.type} onChange={(e) => setRel((r) => ({ ...r, type: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-slate-200" data-gs-story-new-rel-type>
            {relTypes.map((r) => <option key={r.id} value={r.id}>{r.name.en} ({r.name.uk})</option>)}
          </select>
          <select value={rel.toId} onChange={(e) => setRel((r) => ({ ...r, toId: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-slate-200" data-gs-story-new-to>
            <option value="">куди…</option>
            {entities.filter((e) => e.id !== rel.fromId).map((e) => <option key={e.id} value={e.id}>{e.name} — {e.type}</option>)}
          </select>
          <input value={rel.note} onChange={(e) => setRel((r) => ({ ...r, note: e.target.value }))} placeholder="примітка (необовʼязково)" className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-slate-100" data-gs-story-new-note />
          <button type="button" disabled={busy || !rel.fromId || !rel.toId || !rel.type} onClick={() => onSubmit('create_relation_proposal', rel)} className="flex w-full items-center justify-center gap-1 rounded-lg bg-amber-500 py-1.5 font-bold text-slate-950 disabled:opacity-50" data-gs-story-new-submit><FilePlus2 className="h-3.5 w-3.5" /> Запропонувати звʼязок</button>
        </>
      )}
      <p className="text-[10px] text-slate-500">Пропозиція одразу перевіряється щодо активної онтології; у канон її записує той, хто має право CANON_WRITE.</p>
    </div>
  );
};

export const StoryGraphPanel: React.FC = () => (
  <ReactFlowProvider>
    <Inner />
  </ReactFlowProvider>
);

export default StoryGraphPanel;
