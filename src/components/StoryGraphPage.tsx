/**
 * Сторінка 2 — «Граф історії» (Story Graph, Т1.4, ТЗ-11 §3).
 *
 * Вузли — сутності книги (колір — з реєстру), ребра — зв'язки з підписом
 * типу; масштаб і перетягування (React Flow), пошук вузла, фільтр типів.
 * Клік по вузлу відкриває картку: підтверджені зв'язки першого рівня з
 * абзацами-джерелами (критерій приймання), запропоновані ШІ — з кнопками
 * «Підтвердити / Відхилити», згадки в тексті з переходом у редактор, і
 * довантажує сусідів цього вузла на граф (для великих книг граф не
 * вантажиться цілим). Ручний зв'язок — із картки, за правами (сервер
 * перевіряє їх так само).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowRight, Check, ExternalLink, Link2, Loader2, RotateCcw, Search, X } from 'lucide-react';
import type { Book } from '../types';
import { CORE_ENTITY_RELATIONS, entityBySlug, readableTextOn } from '../utils/coreEntities';
import { forceLayout, placeAround, radialLayout, type Positions } from '../utils/graphLayout';

interface EvidenceRef {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  chapterId: string | null;
  excerpt: string;
}
interface GNode {
  id: string;
  type: string;
  name: string;
  status: string;
  mentions: number;
  degree: number;
}
interface GEdge {
  id: string;
  kind: 'relation' | 'tag';
  type: string;
  from: string;
  to: string;
  status: 'confirmed' | 'suggested';
  evidence: EvidenceRef[];
  evidenceCount: number;
  note: string;
  createdBy: string | null;
}
interface GraphResponse {
  synced: boolean;
  canEdit?: boolean;
  focus: string | null;
  nodes: GNode[];
  edges: GEdge[];
  truncated: boolean;
  totals: { entities: number; edges: number };
}

interface Props {
  book: Book;
  onOpenParagraph: (target: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

export const relationLabel = (key: string) => CORE_ENTITY_RELATIONS.find((r) => r.key === key)?.nameUk ?? key;
export const typeLabel = (type: string) => entityBySlug(type)?.nameUk ?? type;
const typeColor = (type: string) => entityBySlug(type)?.color ?? '#64748b';

/** Типи для фільтра — з ТЗ (вузли: персонажі, сцени, події, конфлікти, пороги, емоції, сюжетні лінії, зображення). */
const FILTER_TYPES = ['character', 'scene', 'event', 'conflict', 'threshold', 'emotion', 'storyline', 'image', 'location', 'object'];

type EntityNodeData = { label: string; type: string; mentions: number; focus: boolean; selected: boolean; match: boolean };

const EntityNode: React.FC<NodeProps<Node<EntityNodeData>>> = ({ data }) => {
  const bg = typeColor(data.type);
  return (
    <div
      className="rounded-xl px-3 py-1.5 text-center shadow-lg"
      style={{
        background: bg,
        color: readableTextOn(bg),
        outline: data.selected ? '3px solid #f8fafc' : data.match ? '3px dashed #facc15' : 'none',
        outlineOffset: 2,
        minWidth: 90,
        maxWidth: 190,
      }}
      data-graph-node-type={data.type}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="truncate text-[12px] font-bold leading-tight">{data.label}</div>
      <div className="truncate text-[9px] opacity-80">
        {typeLabel(data.type)}
        {data.mentions ? ` · ${data.mentions}` : ''}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
};
const nodeTypes = { entity: EntityNode };

function GraphInner({ book, onOpenParagraph }: Props) {
  const base = `/api/projects/${encodeURIComponent(book.id)}`;
  const flow = useReactFlow();
  const [graphNodes, setGraphNodes] = useState<Map<string, GNode>>(new Map());
  const [graphEdges, setGraphEdges] = useState<Map<string, GEdge>>(new Map());
  const [positions, setPositions] = useState<Positions>({});
  const [canEdit, setCanEdit] = useState(false);
  const [synced, setSynced] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [totals, setTotals] = useState({ entities: 0, edges: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [tagLinks, setTagLinks] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<{ edges: GEdge[]; loading: boolean; mentions: EvidenceRef[]; aliases: string[] } | null>(null);
  const [allEntities, setAllEntities] = useState<{ id: string; name: string; type: string }[]>([]);
  const [newRel, setNewRel] = useState<{ type: string; target: string; note: string; reverse: boolean }>({ type: 'participates_in', target: '', note: '', reverse: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  const query = useCallback(
    (focus?: string) => {
      const p = new URLSearchParams();
      if (focus) {
        p.set('focus', focus);
        p.set('depth', '1');
      }
      if (types.length) p.set('types', types.join(','));
      if (onlyConfirmed) p.set('suggested', '0');
      if (!tagLinks) p.set('tags', '0');
      return `${base}/story-graph?${p.toString()}`;
    },
    [base, types, onlyConfirmed, tagLinks],
  );

  // Огляд книги (або перезавантаження після зміни фільтрів).
  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    setCard(null);
    try {
      const res = await api(query());
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 403 ? 'Немає доступу до цієї книги.' : res.status === 503 ? 'Семантичне ядро зараз недоступне.' : body.error || `Помилка ${res.status}`);
        return;
      }
      const g = body as GraphResponse;
      setSynced(g.synced);
      setCanEdit(!!g.canEdit);
      setTruncated(g.truncated);
      setTotals(g.totals);
      setGraphNodes(new Map(g.nodes.map((n) => [n.id, n])));
      setGraphEdges(new Map(g.edges.map((e) => [e.id, e])));
      setPositions(forceLayout(g.nodes, g.edges));
      setTimeout(() => flow.fitView({ padding: 0.2, duration: 300 }), 50);
    } catch {
      setError('Немає зв\'язку з сервером.');
    } finally {
      setLoading(false);
    }
  }, [query, flow]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    api(`${base}/entities`)
      .then((r) => (r.ok ? r.json() : { entities: [] }))
      .then((b) => setAllEntities((b.entities || []).map((e: any) => ({ id: e.id, name: e.name, type: e.type }))))
      .catch(() => {});
  }, [base]);

  /** Клік по вузлу: картка з першим рівнем зв'язків і довантаження сусідів на граф. */
  const openNode = useCallback(
    async (id: string) => {
      setSelected(id);
      setMessage(null);
      setCard({ edges: [], loading: true, mentions: [], aliases: [] });
      const [gRes, eRes] = await Promise.all([
        api(query(id)).catch(() => null),
        api(`${base}/entities/${encodeURIComponent(id)}?excerpts=1`).catch(() => null),
      ]);
      const g: GraphResponse | null = gRes?.ok ? await gRes.json() : null;
      const e = eRes?.ok ? await eRes.json() : null;
      if (!g) {
        setCard({ edges: [], loading: false, mentions: [], aliases: [] });
        return;
      }
      setCanEdit(!!g.canEdit);
      const newNodes = g.nodes.filter((n) => !graphNodes.has(n.id));
      setGraphNodes((prev) => {
        const next = new Map(prev);
        g.nodes.forEach((n) => next.set(n.id, n));
        return next;
      });
      setGraphEdges((prev) => {
        const next = new Map(prev);
        g.edges.forEach((ed) => next.set(ed.id, ed));
        return next;
      });
      if (newNodes.length) {
        const center = positionsRef.current[id] ?? { x: 0, y: 0 };
        const placed = Object.keys(positionsRef.current).length
          ? placeAround(center, newNodes.map((n) => n.id), positionsRef.current)
          : radialLayout(id, g.nodes, g.edges);
        setPositions((prev) => ({ ...prev, ...placed }));
      }
      setCard({
        edges: g.edges.filter((ed) => ed.from === id || ed.to === id),
        loading: false,
        mentions: e?.mentionParagraphs ?? [],
        aliases: (e?.aliases ?? []).map((a: any) => a.alias).filter((a: string) => a !== g.nodes.find((n) => n.id === id)?.name),
      });
    },
    [base, query, graphNodes],
  );

  const setRelationStatus = async (edge: GEdge, status: 'confirmed' | 'rejected') => {
    setBusy(true);
    try {
      const res = await api(`${base}/relations/${edge.id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.error || 'Не вдалося.');
      else if (status === 'rejected') {
        setGraphEdges((prev) => {
          const next = new Map(prev);
          next.delete(edge.id);
          return next;
        });
      }
      if (selected) await openNode(selected);
    } finally {
      setBusy(false);
    }
  };

  const createRelation = async () => {
    if (!selected || !newRel.target) return;
    setBusy(true);
    setMessage(null);
    try {
      const [fromId, toId] = newRel.reverse ? [newRel.target, selected] : [selected, newRel.target];
      const res = await api(`${base}/relations`, { method: 'POST', body: JSON.stringify({ type: newRel.type, fromId, toId, note: newRel.note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.error || 'Не вдалося створити зв\'язок.');
      else {
        setMessage('Зв\'язок створено.');
        setNewRel((r) => ({ ...r, target: '', note: '' }));
        await openNode(selected);
      }
    } finally {
      setBusy(false);
    }
  };

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return new Set<string>();
    return new Set([...graphNodes.values()].filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id));
  }, [search, graphNodes]);

  const findNode = async () => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    let hit = [...graphNodes.values()].find((n) => n.name.toLowerCase().includes(q))?.id;
    // Немає на графі — шукаємо серед усіх сутностей книги й довантажуємо.
    if (!hit) hit = allEntities.find((e) => e.name.toLowerCase().includes(q))?.id;
    if (!hit) {
      setMessage(`«${search.trim()}» — такої сутності в книзі немає.`);
      return;
    }
    await openNode(hit);
    const p = positionsRef.current[hit];
    if (p) flow.setCenter(p.x + 60, p.y + 20, { zoom: 1.1, duration: 400 });
  };

  const rfNodes: Node<EntityNodeData>[] = useMemo(
    () =>
      [...graphNodes.values()].map((n) => ({
        id: n.id,
        type: 'entity',
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: { label: n.name, type: n.type, mentions: n.mentions, focus: n.id === selected, selected: n.id === selected, match: matches.has(n.id) },
      })),
    [graphNodes, positions, selected, matches],
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      [...graphEdges.values()]
        .filter((e) => graphNodes.has(e.from) && graphNodes.has(e.to))
        .map((e) => {
          const hot = selected && (e.from === selected || e.to === selected);
          const color = e.status === 'suggested' ? '#a78bfa' : e.kind === 'tag' ? '#94a3b8' : '#38bdf8';
          return {
            id: e.id,
            source: e.from,
            target: e.to,
            label: relationLabel(e.type),
            animated: e.status === 'suggested',
            style: { stroke: color, strokeWidth: hot ? 2.5 : 1.3, strokeDasharray: e.kind === 'tag' ? '5 4' : undefined, opacity: selected && !hot ? 0.35 : 1 },
            labelStyle: { fill: '#e2e8f0', fontSize: 10 },
            labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
            markerEnd: { type: MarkerType.ArrowClosed, color },
          } as Edge;
        }),
    [graphEdges, graphNodes, selected],
  );

  const presentTypes = useMemo(() => {
    const s = new Set(FILTER_TYPES);
    graphNodes.forEach((n) => s.add(n.type));
    return [...s];
  }, [graphNodes]);

  const selectedNode = selected ? graphNodes.get(selected) : undefined;
  const nameOf = (id: string) => graphNodes.get(id)?.name ?? allEntities.find((e) => e.id === id)?.name ?? '…';
  const confirmedEdges = card?.edges.filter((e) => e.status === 'confirmed') ?? [];
  const suggestedEdges = card?.edges.filter((e) => e.status === 'suggested') ?? [];

  const EdgeRow = ({ e }: { e: GEdge }) => {
    const other = e.from === selected ? e.to : e.from;
    return (
      <li className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5" data-graph-edge={e.id} data-graph-edge-status={e.status}>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-200">
          <span className={e.from === selected ? 'font-bold' : ''}>{nameOf(e.from)}</span>
          <ArrowRight className="h-3 w-3 text-slate-500" />
          <span className="rounded bg-slate-800 px-1.5 text-[11px] text-sky-200">{relationLabel(e.type)}</span>
          <ArrowRight className="h-3 w-3 text-slate-500" />
          <button type="button" className="font-bold hover:text-sky-300" onClick={() => void openNode(other)}>
            {nameOf(e.to)}
          </button>
          <span className="ml-auto text-[10px] text-slate-500">
            {e.kind === 'tag' ? 'з тегів у тексті' : e.status === 'suggested' ? 'запропоновано ШІ' : 'підтверджено'}
          </span>
        </div>
        {e.note && <p className="mt-1 text-[11px] italic text-slate-400">«{e.note}»</p>}
        {e.evidence.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {e.evidence.map((ev) => (
              <li key={ev.paragraphId} className="flex items-start gap-1.5 text-[11px] text-slate-400" data-graph-evidence={ev.paragraphId}>
                <span className="line-clamp-2 flex-1">{ev.excerpt}</span>
                {ev.chapterId && (
                  <button
                    type="button"
                    title="Відкрити в редакторі"
                    data-graph-evidence-open
                    onClick={() => onOpenParagraph({ chapterId: ev.chapterId!, sectionId: ev.sectionId, editorPid: ev.editorPid, text: ev.excerpt })}
                    className="shrink-0 rounded border border-slate-700 p-0.5 hover:border-sky-500"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
            {e.evidenceCount > e.evidence.length && <li className="text-[10px] text-slate-500">…і ще {e.evidenceCount - e.evidence.length}</li>}
          </ul>
        ) : (
          <p className="mt-1 text-[10px] text-slate-500">Без абзаців-джерел (зв'язок задано автором вручну).</p>
        )}
        {e.kind === 'relation' && canEdit && (
          <div className="mt-1.5 flex gap-1.5">
            {e.status === 'suggested' && (
              <button type="button" disabled={busy} data-graph-confirm onClick={() => void setRelationStatus(e, 'confirmed')} className="flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10">
                <Check className="h-3 w-3" /> Підтвердити
              </button>
            )}
            <button type="button" disabled={busy} data-graph-reject onClick={() => void setRelationStatus(e, 'rejected')} className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/10">
              <X className="h-3 w-3" /> {e.status === 'suggested' ? 'Відхилити' : 'Прибрати'}
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="min-w-0 space-y-3" data-story-graph>
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(ev) => {
            ev.preventDefault();
            void findNode();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Знайти вузол: ім'я героя, місце, подія…"
              data-graph-search
              className="w-full rounded-xl border border-slate-700 bg-slate-950/60 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          </div>
          <button type="submit" data-graph-search-go className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500">
            Знайти
          </button>
          <button type="button" onClick={() => void loadOverview()} className="flex items-center justify-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-sky-500" title="Огляд книги">
            <RotateCcw className="h-3.5 w-3.5" /> Огляд
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5" data-graph-type-filter>
          {presentTypes.map((t) => {
            const on = types.includes(t);
            return (
              <button
                key={t}
                type="button"
                data-graph-type={t}
                onClick={() => setTypes((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${on ? 'border-transparent font-bold' : 'border-slate-700 text-slate-300'}`}
                style={on ? { background: typeColor(t), color: readableTextOn(typeColor(t)) } : undefined}
              >
                {typeLabel(t)}
              </button>
            );
          })}
          <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-300">
            <input type="checkbox" checked={onlyConfirmed} onChange={(e) => setOnlyConfirmed(e.target.checked)} data-graph-only-confirmed /> лише підтверджені
          </label>
          <label className="flex items-center gap-1 text-[11px] text-slate-300">
            <input type="checkbox" checked={tagLinks} onChange={(e) => setTagLinks(e.target.checked)} data-graph-tag-links /> зв'язки з тегів
          </label>
        </div>
      </div>

      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
      {!synced && <p className="text-sm text-slate-400">Книгу ще не синхронізовано з ядром — збережіть її й відкрийте граф за кілька секунд.</p>}

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row">
        <div className="relative h-[60vh] min-h-[380px] min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950" data-graph-canvas>
          {loading && <Loader2 className="absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 animate-spin text-slate-500" />}
          {!loading && synced && graphNodes.size === 0 && (
            <p className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-slate-400">
              На графі поки нічого: позначте героїв, емоції й події тегами в тексті — вони з'являться тут після збереження.
            </p>
          )}
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => void openNode(n.id)}
            onNodeDragStop={(_, n) => setPositions((prev) => ({ ...prev, [n.id]: n.position }))}
            onPaneClick={() => {
              setSelected(null);
              setCard(null);
            }}
            minZoom={0.15}
            maxZoom={2.5}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={24} color="#1e293b" />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="pointer-events-none absolute bottom-2 left-12 text-[10px] text-slate-500" data-graph-totals>
            На графі {graphNodes.size} з {totals.entities} сутностей{truncated ? ' (огляд обрізано — відкривайте вузли, щоб довантажити сусідів)' : ''}
          </div>
        </div>

        {selectedNode && (
          <aside className="w-full shrink-0 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:w-[380px]" data-graph-card={selectedNode.id}>
            <div className="flex items-start gap-2">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: typeColor(selectedNode.type) }} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold text-slate-100">{selectedNode.name}</h2>
                <p className="text-[11px] text-slate-400">
                  {typeLabel(selectedNode.type)} · згадок у тексті: {selectedNode.mentions}
                  {card?.aliases.length ? ` · також: ${card.aliases.join(', ')}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => { setSelected(null); setCard(null); }} className="text-slate-500 hover:text-slate-200" title="Закрити">
                <X className="h-4 w-4" />
              </button>
            </div>
            {card?.loading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            {message && <p className="text-[11px] text-amber-300" data-graph-message>{message}</p>}
            {card && !card.loading && (
              <>
                <div>
                  <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Підтверджені зв'язки ({confirmedEdges.length})</h3>
                  {confirmedEdges.length ? (
                    <ul className="space-y-1.5" data-graph-confirmed>
                      {confirmedEdges.map((e) => <EdgeRow key={e.id} e={e} />)}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500">Підтверджених зв'язків ще немає.</p>
                  )}
                </div>
                {suggestedEdges.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-300">Запропоновано ШІ ({suggestedEdges.length})</h3>
                    <ul className="space-y-1.5" data-graph-suggested>
                      {suggestedEdges.map((e) => <EdgeRow key={e.id} e={e} />)}
                    </ul>
                  </div>
                )}
                {card.mentions.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Згадки в тексті</h3>
                    <ul className="space-y-1" data-graph-mentions>
                      {card.mentions.slice(0, 8).map((m) => (
                        <li key={m.paragraphId} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                          <span className="line-clamp-2 flex-1">{m.excerpt}</span>
                          {m.chapterId && (
                            <button type="button" title="Відкрити в редакторі" onClick={() => onOpenParagraph({ chapterId: m.chapterId!, sectionId: m.sectionId, editorPid: m.editorPid, text: m.excerpt })} className="shrink-0 rounded border border-slate-700 p-0.5 hover:border-sky-500">
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {canEdit && (
                  <div className="space-y-1.5 border-t border-slate-800 pt-3" data-graph-new-relation>
                    <h3 className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      <Link2 className="h-3 w-3" /> Новий зв'язок
                    </h3>
                    <select value={newRel.type} onChange={(e) => setNewRel((r) => ({ ...r, type: e.target.value }))} data-graph-new-type className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200">
                      {CORE_ENTITY_RELATIONS.filter((r) => r.registry !== 'critic').map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.nameUk} ({r.example})
                        </option>
                      ))}
                    </select>
                    <select value={newRel.target} onChange={(e) => setNewRel((r) => ({ ...r, target: e.target.value }))} data-graph-new-target className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200">
                      <option value="">з ким / з чим…</option>
                      {allEntities.filter((e) => e.id !== selected).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} — {typeLabel(e.type)}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <input type="checkbox" checked={newRel.reverse} onChange={(e) => setNewRel((r) => ({ ...r, reverse: e.target.checked }))} /> у зворотний бік (вибране → {selectedNode.name})
                    </label>
                    <input value={newRel.note} onChange={(e) => setNewRel((r) => ({ ...r, note: e.target.value }))} placeholder="примітка (необов'язково)" className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200" />
                    <button type="button" disabled={busy || !newRel.target} onClick={() => void createRelation()} data-graph-new-save className="w-full rounded-lg bg-sky-600 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">
                      Додати зв'язок
                    </button>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

export const StoryGraphPage: React.FC<Props> = (props) => (
  <ReactFlowProvider>
    <GraphInner {...props} />
  </ReactFlowProvider>
);

export default StoryGraphPage;
