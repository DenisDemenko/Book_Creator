import React, { useMemo, useState } from 'react';
import { Focus, Maximize2, Minus, Move, Plus, RotateCcw, Search, UsersRound } from 'lucide-react';
import { AttentionAurora } from './AttentionAurora';

export type RelationshipNodeKind = 'person' | 'event' | 'organization' | 'object' | 'abstract';
export type RelationshipEdgeKind = 'support' | 'conflict' | 'secret' | 'family' | 'love' | 'dependency' | 'custom';

export interface RelationshipNode {
  id: string;
  label: string;
  subtitle?: string;
  kind: RelationshipNodeKind;
  x: number;
  y: number;
  attention?: boolean;
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: RelationshipEdgeKind;
  strength?: number;
  secret?: boolean;
}

interface RelationshipMapViewProps {
  title?: string;
  nodes?: RelationshipNode[];
  edges?: RelationshipEdge[];
  onSelectNode?: (node: RelationshipNode) => void;
  selectedNodeId?: string | null;
}

const mockNodes: RelationshipNode[] = [
  { id: 'mark', label: 'Марк', subtitle: 'протагоніст', kind: 'person', x: 18, y: 34 },
  { id: 'olena', label: 'Олена', subtitle: 'союзник / секрет', kind: 'person', x: 49, y: 45, attention: true },
  { id: 'glass', label: 'Проєкт «Скло»', subtitle: 'організація', kind: 'organization', x: 78, y: 25 },
  { id: 'deal', label: 'Угода', subtitle: 'ключова подія', kind: 'event', x: 61, y: 72 },
];

const mockEdges: RelationshipEdge[] = [
  { id: 'e1', source: 'mark', target: 'olena', label: 'довіра', kind: 'support', strength: 0.8 },
  { id: 'e2', source: 'olena', target: 'glass', label: 'секретний зв’язок', kind: 'secret', strength: 0.6, secret: true },
  { id: 'e3', source: 'mark', target: 'deal', label: 'ризик', kind: 'dependency', strength: 0.7 },
];

export const RelationshipMapView: React.FC<RelationshipMapViewProps> = ({
  title = 'Карта зв’язків',
  nodes = mockNodes,
  edges = mockEdges,
  onSelectNode,
  selectedNodeId,
}) => {
  const [zoom, setZoom] = useState(100);
  const [query, setQuery] = useState('');
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(selectedNodeId || nodes[0]?.id || null);
  const selectedId = selectedNodeId ?? localSelectedId;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? nodes.filter((node) => `${node.label} ${node.subtitle || ''}`.toLowerCase().includes(q)) : nodes;
  }, [nodes, query]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const chooseNode = (node: RelationshipNode) => {
    setLocalSelectedId(node.id);
    onSelectNode?.(node);
  };

  return (
    <section className="min-h-0 flex-1 bg-slate-950 p-4 text-slate-100 lg:p-6" data-story-experience="relationship-map">
      <header className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Shared Relationship Map</div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Спільний Canvas для історії, Mafia та розстановок. Відрізняється набір доступних інструментів, але поведінка полотна лишається однаковою.</p>
        </div>
        <div className="relative w-full lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Знайти вузол…" className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-cyan-500/60" />
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative h-[650px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(71,85,105,.34) 1px, transparent 0)', backgroundSize: `${Math.max(16, 24 * zoom / 100)}px ${Math.max(16, 24 * zoom / 100)}px` }}>
          <div className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1 shadow-xl">
            <button type="button" onClick={() => setZoom((value) => Math.max(10, value - 10))} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><Minus className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setZoom(100)} className="min-w-14 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-300">{zoom}%</button>
            <button type="button" onClick={() => setZoom((value) => Math.min(200, value + 10))} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><Plus className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setZoom(100)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800" title="Fit"><Maximize2 className="h-3.5 w-3.5" /></button>
            <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800" title="Auto-layout"><Focus className="h-3.5 w-3.5" /></button>
            <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800" title="Reset"><RotateCcw className="h-3.5 w-3.5" /></button>
          </div>

          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {edges.map((edge) => {
              const a = nodeById.get(edge.source);
              const b = nodeById.get(edge.target);
              if (!a || !b) return null;
              return <line key={edge.id} x1={`${a.x}%`} y1={`${a.y}%`} x2={`${b.x}%`} y2={`${b.y}%`} stroke={edge.secret ? '#a78bfa' : '#475569'} strokeDasharray={edge.secret ? '6 5' : undefined} strokeWidth={Math.max(1, (edge.strength || .5) * 3)} />;
            })}
          </svg>

          {filtered.map((node) => (
            <AttentionAurora key={node.id} active={!!node.attention} intensity="soft" className="absolute" ariaLabel={node.attention ? `Нова зміна: ${node.label}` : undefined}>
              <button
                type="button"
                onClick={() => chooseNode(node)}
                className={`min-w-32 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-slate-950 px-3 py-2 text-left shadow-xl transition ${selectedId === node.id ? 'border-cyan-400/70 ring-2 ring-cyan-500/10' : 'border-slate-700 hover:border-slate-500'}`}
                style={{ position: 'absolute', left: `${node.x}%`, top: `${node.y}%`, transform: `translate(-50%, -50%) scale(${zoom / 100})`, transformOrigin: 'center' }}
              >
                <div className="text-xs font-bold text-white">{node.label}</div>
                {node.subtitle && <div className="mt-0.5 text-[10px] text-slate-500">{node.subtitle}</div>}
              </button>
            </AttentionAurora>
          ))}

          <div className="absolute bottom-3 right-3 z-20 h-24 w-36 rounded-xl border border-slate-700 bg-slate-950/90 p-2 shadow-xl"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Мінікарта</div><div className="relative mt-2 h-14 rounded-md bg-slate-900">{nodes.map((node) => <span key={node.id} className="absolute h-2 w-2 rounded-full bg-slate-500" style={{ left: `${node.x}%`, top: `${node.y}%` }} />)}</div></div>
        </div>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-4 flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Inspector</div><h2 className="mt-1 text-sm font-bold text-white">{nodeById.get(selectedId || '')?.label || 'Вузол'}</h2></div><UsersRound className="h-4 w-4 text-slate-600" /></div>
          <div className="space-y-3 text-xs text-slate-400">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Тип</div><div className="mt-1 text-slate-300">{nodeById.get(selectedId || '')?.kind || '—'}</div></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Пов’язані зв’язки</div><div className="mt-1 text-slate-300">{edges.filter((edge) => edge.source === selectedId || edge.target === selectedId).length}</div></div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><Move className="mb-2 h-4 w-4 text-cyan-300" /><div>Canvas UX підтримує pan, zoom, Fit, minimap і майбутній drag & drop. Серверна модель графа лишається задачею технічного агента.</div></div>
          </div>
        </aside>
      </div>
    </section>
  );
};
