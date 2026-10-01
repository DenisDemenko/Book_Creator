/**
 * «AI Workflows (Процеси ШІ)» — канва процесу в Graph Studio (Т5.2 В3,
 * `PLAN_GRAPH_STUDIO.md`; ТЗ §5, §35–36, §38, №6, 7, 27, 28).
 *
 * Ліворуч — процеси й палітра (вісім груп §35), посередині — канва
 * (@xyflow/react; LangGraph-GUI — лише еталон, рішення власника §2 п.2),
 * праворуч — інспектор параметрів вузла (§5.3, §36) і перевірка.
 *
 * Правити можна лише чернетку (§38); тестова й робоча версії — лише
 * переглядати й переставляти вузли: розкладка зберігається окремо й
 * семантики не змінює (№28). Публікувати — лише з правом canPublishSchema.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  NODE_TYPES,
  PALETTE_GROUPS,
  defaultParams,
  nodeOutputs,
  nodeTypeById,
  type GraphLayout,
  type ParamDef,
  type WorkflowDefinition,
  type WorkflowIssue,
  type WorkflowNode,
  type WorkflowValidation,
} from '../../utils/workflowGraph';
import { readableTextOn } from '../../utils/coreEntities';
import { ENV_CLASS, ENV_LABEL, gs, type GsAbilities } from './gsApi';

interface Summary {
  workflow: { id: string; name: { en: string; uk: string }; description: string; status: string };
  production: { id: string; version: number } | null;
  test: { id: string; version: number } | null;
  draft: { id: string; version: number; valid: boolean } | null;
  versions: number;
}
interface VersionRow {
  id: string;
  workflowId: string;
  version: number;
  environment: 'draft' | 'test' | 'production' | 'archived';
  definition: WorkflowDefinition | null;
  definitionHash: string;
  validation: (WorkflowValidation & { hash?: string }) | null;
  revision: number;
  publishedAt: string | null;
  notes: string;
}

const groupColor = (type: string) => PALETTE_GROUPS.find((g) => g.id === nodeTypeById(type)?.group)?.color ?? '#475569';
const bi = (n: { en: string; uk: string }) => `${n.en} (${n.uk})`;

/** Пошарова розкладка від START — для вузлів без збережених координат. */
function autoLayout(def: WorkflowDefinition, have: GraphLayout): GraphLayout {
  const out: GraphLayout = { ...have };
  const depth = new Map<string, number>();
  const start = def.nodes.find((n) => n.type === 'START');
  const queue = start ? [start.id] : [];
  if (start) depth.set(start.id, 0);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of def.edges) if (e.from === cur && !depth.has(e.to)) { depth.set(e.to, (depth.get(cur) ?? 0) + 1); queue.push(e.to); }
  }
  // Довгий конвеєр — смугами по COLS шарів, щоб канва не ставала стрічкою.
  const COLS = 5;
  const perDepth = new Map<number, number>();
  for (const n of def.nodes) perDepth.set(depth.get(n.id) ?? 0, (perDepth.get(depth.get(n.id) ?? 0) ?? 0) + 1);
  const bandHeight = (Math.max(1, ...perDepth.values()) * 130) + 90;
  const rows = new Map<number, number>();
  for (const n of def.nodes) {
    if (out[n.id]) continue;
    const d = depth.get(n.id) ?? 0;
    const r = rows.get(d) ?? 0;
    rows.set(d, r + 1);
    out[n.id] = { x: (d % COLS) * 250, y: Math.floor(d / COLS) * bandHeight + r * 130 };
  }
  return out;
}

interface WfNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  issues: number;
  selected: boolean;
}

const WfNode: React.FC<NodeProps<Node<WfNodeData>>> = ({ data }) => {
  const t = nodeTypeById(data.node.type);
  const bg = groupColor(data.node.type);
  const outs = nodeOutputs(data.node);
  return (
    <div
      className="rounded-xl border shadow-lg"
      style={{ background: '#0f172a', borderColor: data.issues ? '#f87171' : data.selected ? '#f8fafc' : bg, borderWidth: data.selected || data.issues ? 2 : 1, minWidth: 170, maxWidth: 230 }}
      data-wf-node={data.node.id}
      data-wf-node-type={data.node.type}
    >
      {t?.inputs !== 'none' && <Handle type="target" position={Position.Left} style={{ background: '#94a3b8', width: 9, height: 9 }} />}
      <div className="rounded-t-[10px] px-2 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ background: bg, color: readableTextOn(bg) }}>
        {data.node.type.replace(/_/g, ' ')}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-[12px] font-semibold text-slate-100">{data.node.label || t?.name.uk || data.node.id}</div>
        {data.issues > 0 && <div className="text-[10px] text-rose-300">помилок: {data.issues}</div>}
      </div>
      {outs.length > 0 && (
        <div className="relative border-t border-slate-800 px-2 pb-1 pt-0.5">
          {outs.map((p) => (
            <div key={p} className="relative flex h-[18px] items-center justify-end pr-2 text-[10px] text-slate-400" data-wf-port={p}>
              {p}
              <Handle type="source" id={p} position={Position.Right} style={{ background: p === 'fallback' ? '#f59e0b' : '#38bdf8', width: 9, height: 9, right: -14, top: 9 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
const nodeTypes = { wf: WfNode };

// ---------------------------------------------------------------------------
// Поле параметра
// ---------------------------------------------------------------------------

const inputCls = 'w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-amber-400 focus:outline-hidden disabled:opacity-60';

const ParamField: React.FC<{ def: ParamDef; value: unknown; disabled: boolean; onChange: (v: unknown) => void }> = ({ def, value, disabled, onChange }) => {
  const [jsonText, setJsonText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  // Список — власний текст поля, інакше порожній рядок (новий елемент) зникав би під час набору.
  const [listText, setListText] = useState(() => (Array.isArray(value) ? (value as string[]).join('\n') : ''));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  useEffect(() => {
    if (def.type === 'json') setJsonText(value === undefined ? '' : JSON.stringify(value, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.type, def.id]);
  const label = (
    <span className="mb-0.5 block text-[10px] text-slate-400">
      {bi(def.name)}
      {def.required ? ' *' : ''} <span className="font-mono text-slate-600">{def.id}</span>
    </span>
  );
  const attrs = { 'data-wf-param': def.id } as Record<string, string>;
  switch (def.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-xs text-slate-200">
          <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...attrs} />
          {bi(def.name)}
        </label>
      );
    case 'enum':
      return (
        <label className="block">
          {label}
          <select className={inputCls} value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} {...attrs}>
            <option value="">—</option>
            {(def.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    case 'number':
    case 'integer':
      return (
        <label className="block">
          {label}
          <input
            type="number"
            className={inputCls}
            value={typeof value === 'number' ? value : ''}
            step={def.type === 'integer' ? 1 : 0.05}
            min={def.min}
            max={def.max}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            {...attrs}
          />
        </label>
      );
    case 'string_list':
      return (
        <label className="block">
          {label}
          <textarea
            className={`${inputCls} h-16`}
            value={listText}
            placeholder="по одному в рядку"
            disabled={disabled}
            onChange={(e) => {
              setListText(e.target.value);
              onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean));
            }}
            {...attrs}
          />
        </label>
      );
    case 'json':
      return (
        <label className="block">
          {label}
          <textarea
            className={`${inputCls} h-20 font-mono`}
            value={jsonText}
            disabled={disabled}
            onChange={(e) => {
              setJsonText(e.target.value);
              if (!e.target.value.trim()) { setJsonErr(null); onChange(undefined); return; }
              try { onChange(JSON.parse(e.target.value)); setJsonErr(null); } catch { setJsonErr('Не JSON'); }
            }}
            {...attrs}
          />
          {jsonErr && <span className="text-[10px] text-rose-300">{jsonErr}</span>}
        </label>
      );
    case 'text':
      return (
        <label className="block">
          {label}
          <textarea className={`${inputCls} h-20`} value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...attrs} />
        </label>
      );
    default:
      return (
        <label className="block">
          {label}
          <input className={inputCls} value={typeof value === 'string' ? value : ''} placeholder={def.hint} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...attrs} />
        </label>
      );
  }
};

// ---------------------------------------------------------------------------

function Editor({ abilities }: { abilities: GsAbilities }) {
  const [list, setList] = useState<Summary[]>([]);
  const [wfId, setWfId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [version, setVersion] = useState<VersionRow | null>(null);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [layout, setLayout] = useState<GraphLayout>({});
  const [dirty, setDirty] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [validation, setValidation] = useState<(WorkflowValidation & { hash?: string }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: '', en: '', uk: '', template: 'sample' });
  const [openGroup, setOpenGroup] = useState<string | null>('ai');

  const editable = !!version && version.environment === 'draft' && abilities.canEdit;

  const loadList = useCallback(async () => {
    const r = await gs<{ workflows: Summary[] }>('GET', '/api/core/workflows');
    setList(r.workflows);
    return r.workflows;
  }, []);

  const openVersion = useCallback(async (workflowId: string, versionId: string) => {
    const r = await gs<{ version: VersionRow; layout: GraphLayout }>('GET', `/api/core/workflows/${workflowId}/versions/${versionId}`);
    setVersion(r.version);
    setDef(r.version.definition);
    setLayout(autoLayout(r.version.definition!, r.layout ?? {}));
    setValidation(r.version.validation && r.version.validation.hash === r.version.definitionHash ? r.version.validation : null);
    setDirty(false);
    setLayoutDirty(false);
    setSelected(null);
  }, []);

  const openWorkflow = useCallback(async (id: string, prefer?: string) => {
    setWfId(id);
    const r = await gs<{ versions: VersionRow[] }>('GET', `/api/core/workflows/${id}`);
    setVersions(r.versions);
    const pick = (prefer && r.versions.find((v) => v.id === prefer)) || r.versions.find((v) => v.environment === 'draft') || r.versions.find((v) => v.environment === 'production') || r.versions[0];
    if (pick) await openVersion(id, pick.id);
  }, [openVersion]);

  useEffect(() => {
    void loadList().then((ws) => { if (ws[0]) void openWorkflow(ws[0].workflow.id); }).catch((e) => setNotice({ kind: 'error', text: e.message }));
  }, [loadList, openWorkflow]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (prefer?: string) => {
    await loadList();
    if (wfId) await openWorkflow(wfId, prefer);
  };

  // ── Зміни визначення ─────────────────────────────────────────────────────
  const mutate = (fn: (d: WorkflowDefinition) => WorkflowDefinition) => {
    if (!editable || !def) return;
    setDef(fn(def));
    setDirty(true);
    setValidation(null);
  };
  const addNode = (type: string) => {
    if (!editable || !def) return;
    const base = type.toLowerCase();
    let i = 1;
    while (def.nodes.some((n) => n.id === `${base}_${i}`)) i++;
    const id = `${base}_${i}`;
    const anchor = selected?.kind === 'node' ? layout[selected.id] : null;
    const maxX = Math.max(0, ...Object.values(layout).map((p) => p.x));
    setLayout({ ...layout, [id]: anchor ? { x: anchor.x + 60, y: anchor.y + 170 } : { x: maxX + 250, y: 0 } });
    mutate((d) => ({ ...d, nodes: [...d.nodes, { id, type, params: defaultParams(type) }] }));
    setSelected({ kind: 'node', id });
  };
  const removeNode = (id: string) => mutate((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((e) => e.from !== id && e.to !== id) }));
  const removeEdge = (id: string) => mutate((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== id) }));
  const setNode = (id: string, patch: Partial<WorkflowNode>) => mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const setParam = (id: string, key: string, v: unknown) =>
    mutate((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        if (n.id !== id) return n;
        const params = { ...n.params };
        if (v === undefined) delete params[key];
        else params[key] = v;
        return { ...n, params };
      }),
    }));

  const onConnect = (c: Connection) => {
    if (!editable || !c.source || !c.target) return;
    const port = c.sourceHandle || 'out';
    mutate((d) => {
      if (d.edges.some((e) => e.from === c.source && e.fromPort === port && e.to === c.target)) return d;
      let id = `e-${c.source}-${port}-${c.target}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      let k = 2;
      while (d.edges.some((e) => e.id === id)) id = `${id.slice(0, 60)}_${k++}`;
      return { ...d, edges: [...d.edges, { id, from: c.source!, fromPort: port, to: c.target! }] };
    });
  };
  const onNodesChange = (changes: NodeChange[]) => {
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        setLayout((l) => ({ ...l, [ch.id]: { x: Math.round(ch.position!.x), y: Math.round(ch.position!.y) } }));
        if (editable) setDirty(true);
        else setLayoutDirty(true);
      } else if (ch.type === 'remove') removeNode(ch.id);
      else if (ch.type === 'select' && ch.selected) setSelected({ kind: 'node', id: ch.id });
    }
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    for (const ch of changes) {
      if (ch.type === 'remove') removeEdge(ch.id);
      else if (ch.type === 'select' && ch.selected) setSelected({ kind: 'edge', id: ch.id });
    }
  };

  const issuesByNode = useMemo(() => {
    const m = new Map<string, WorkflowIssue[]>();
    for (const i of validation?.errors ?? []) if (i.nodeId) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i]);
    return m;
  }, [validation]);

  const rfNodes: Node<WfNodeData>[] = useMemo(
    () => (def?.nodes ?? []).map((n) => ({
      id: n.id,
      type: 'wf',
      position: layout[n.id] ?? { x: 0, y: 0 },
      data: { node: n, issues: issuesByNode.get(n.id)?.length ?? 0, selected: selected?.kind === 'node' && selected.id === n.id },
      selected: selected?.kind === 'node' && selected.id === n.id,
      deletable: editable && n.type !== 'START',
    })),
    [def, layout, issuesByNode, selected, editable],
  );
  const rfEdges: Edge[] = useMemo(
    () => (def?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.from,
      sourceHandle: e.fromPort,
      target: e.to,
      label: e.fromPort === 'out' ? undefined : e.fromPort,
      labelStyle: { fill: '#cbd5e1', fontSize: 10 },
      labelBgStyle: { fill: '#0f172a' },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.fromPort === 'fallback' ? '#f59e0b' : '#64748b' },
      style: { stroke: e.fromPort === 'fallback' ? '#f59e0b' : selected?.kind === 'edge' && selected.id === e.id ? '#f8fafc' : '#64748b', strokeWidth: selected?.kind === 'edge' && selected.id === e.id ? 2.5 : 1.5 },
      selected: selected?.kind === 'edge' && selected.id === e.id,
      deletable: editable,
    })),
    [def, selected, editable],
  );

  // ── Дії версії ───────────────────────────────────────────────────────────
  const save = async (): Promise<VersionRow | null> => {
    if (!version || !def || !wfId) return null;
    const r = await gs<{ version: VersionRow; layout: GraphLayout }>('PUT', `/api/core/workflows/${wfId}/versions/${version.id}`, { definition: def, layout, expectedRevision: version.revision });
    setVersion(r.version);
    setDirty(false);
    setLayoutDirty(false);
    return r.version;
  };
  const actions = {
    edit: () => run('edit', async () => {
      const r = await gs<{ version: VersionRow }>('POST', `/api/core/workflows/${wfId}/draft`, { fromVersionId: version?.id });
      await refresh(r.version.id);
      setNotice({ kind: 'ok', text: `Відкрито чернетку v${r.version.version} — робоча версія не зміниться, доки ви не опублікуєте нову.` });
    }),
    save: () => run('save', async () => {
      const v = await save();
      if (v) setNotice({ kind: 'ok', text: `Чернетку v${v.version} збережено.` });
      await loadList();
    }),
    layout: () => run('layout', async () => {
      await gs('PUT', `/api/core/workflows/${wfId}/versions/${version!.id}/layout`, { layout });
      setLayoutDirty(false);
      setNotice({ kind: 'ok', text: 'Розкладку збережено — визначення версії не змінилось.' });
    }),
    validate: () => run('validate', async () => {
      if (dirty) await save();
      const r = await gs<{ validation: WorkflowValidation & { hash: string } }>('POST', `/api/core/workflows/${wfId}/versions/${version!.id}/validate`);
      setValidation(r.validation);
      const fresh = await gs<{ version: VersionRow }>('GET', `/api/core/workflows/${wfId}/versions/${version!.id}`);
      setVersion(fresh.version);
      setNotice(r.validation.ok ? { kind: 'ok', text: `Перевірка пройдена${r.validation.warnings.length ? ` (попереджень: ${r.validation.warnings.length})` : ''}.` } : { kind: 'error', text: `Помилок: ${r.validation.errors.length} — див. праворуч.` });
      await loadList();
    }),
    test: () => run('test', async () => {
      await gs('POST', `/api/core/workflows/${wfId}/versions/${version!.id}/test`);
      await refresh(version!.id);
      setNotice({ kind: 'ok', text: 'Версію заморожено й передано в тест.' });
    }),
    publish: () => run('publish', async () => {
      await gs('POST', `/api/core/workflows/${wfId}/versions/${version!.id}/publish`);
      await refresh(version!.id);
      setNotice({ kind: 'ok', text: 'Опубліковано в робоче середовище.' });
    }),
    discard: () => run('discard', async () => {
      await gs('POST', `/api/core/workflows/${wfId}/versions/${version!.id}/archive`);
      await refresh();
      setNotice({ kind: 'ok', text: 'Версію знято в архів.' });
    }),
    rollback: () => run('rollback', async () => {
      const r = await gs<{ version: VersionRow }>('POST', `/api/core/workflows/${wfId}/versions/${version!.id}/rollback`);
      await refresh(r.version.id);
      setNotice({ kind: 'ok', text: `Відкат: робоча тепер v${r.version.version} (копія v${version!.version}).` });
    }),
    create: () => run('create', async () => {
      const r = await gs<{ workflow: { id: string } }>('POST', '/api/core/workflows', { id: form.id.trim(), name: { en: form.en.trim(), uk: form.uk.trim() }, template: form.template });
      setCreating(false);
      setForm({ id: '', en: '', uk: '', template: 'sample' });
      await loadList();
      await openWorkflow(r.workflow.id);
    }),
  };

  const selNode = selected?.kind === 'node' ? def?.nodes.find((n) => n.id === selected.id) ?? null : null;
  const selEdge = selected?.kind === 'edge' ? def?.edges.find((e) => e.id === selected.id) ?? null : null;
  const fresh = !!validation && validation.ok && !dirty && validation.hash === version?.definitionHash;
  const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40';

  return (
    <div className="flex flex-col gap-3 lg:flex-row" data-gs-workflows>
      {/* Процеси й палітра */}
      <aside className="w-full shrink-0 space-y-3 lg:w-[250px]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200">Workflows (Процеси)</span>
            {abilities.canEdit && (
              <button type="button" className="rounded-lg p-1 text-amber-300 hover:bg-slate-800" onClick={() => setCreating((v) => !v)} title="Новий процес" data-wf-new>
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          {creating && (
            <div className="mb-2 space-y-1.5 rounded-xl border border-slate-700 p-2" data-wf-create-form>
              <input className={inputCls} placeholder="id: ai1_mentions" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} data-wf-create-id />
              <input className={inputCls} placeholder="Name (English)" value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} data-wf-create-en />
              <input className={inputCls} placeholder="Назва (українською)" value={form.uk} onChange={(e) => setForm({ ...form, uk: e.target.value })} data-wf-create-uk />
              <select className={inputCls} value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} data-wf-create-template>
                <option value="sample">Зразок §5.1: від рукопису до канону</option>
                <option value="empty">Порожній: START → END</option>
              </select>
              <button type="button" className={`${btn} w-full justify-center border-amber-500/50 bg-amber-500 text-slate-950`} disabled={!!busy || !form.id || !form.en || !form.uk} onClick={actions.create} data-wf-create-submit>
                Створити
              </button>
            </div>
          )}
          <div className="flex gap-1.5 overflow-x-auto lg:flex-col">
            {list.length === 0 && <p className="text-[11px] text-slate-500">Процесів ще немає.</p>}
            {list.map((s) => (
              <button
                key={s.workflow.id}
                type="button"
                onClick={() => void openWorkflow(s.workflow.id)}
                className={`min-w-[170px] rounded-xl border px-2.5 py-2 text-left lg:min-w-0 ${wfId === s.workflow.id ? 'border-amber-400/70 bg-amber-500/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'}`}
                data-wf-item={s.workflow.id}
              >
                <div className="truncate text-xs font-semibold text-slate-100">{s.workflow.name.uk}</div>
                <div className="truncate font-mono text-[10px] text-slate-500">{s.workflow.id}</div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                  {s.production && <span className={`rounded border px-1 ${ENV_CLASS.production}`}>prod v{s.production.version}</span>}
                  {s.test && <span className={`rounded border px-1 ${ENV_CLASS.test}`}>test v{s.test.version}</span>}
                  {s.draft && <span className={`rounded border px-1 ${ENV_CLASS.draft}`}>draft v{s.draft.version}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {editable && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-wf-palette>
            <div className="mb-2 text-xs font-bold text-slate-200">Node palette (Палітра вузлів)</div>
            <div className="space-y-1">
              {PALETTE_GROUPS.map((g) => (
                <div key={g.id}>
                  <button
                    type="button"
                    onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[11px] font-bold text-slate-300 hover:bg-slate-800"
                    data-wf-palette-group={g.id}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                    {g.code} <span className="font-normal text-slate-500">({g.name.uk})</span>
                  </button>
                  {openGroup === g.id && (
                    <div className="mb-1 ml-4 flex flex-wrap gap-1">
                      {NODE_TYPES.filter((t) => t.group === g.id).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          title={`${t.name.en} (${t.name.uk}) — ${t.description}`}
                          onClick={() => addNode(t.id)}
                          className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-200 hover:border-amber-400"
                          data-wf-palette-item={t.id}
                        >
                          {t.name.uk}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Канва */}
      <div className="min-w-0 flex-1 space-y-2">
        {version && def && (
          <div className="flex flex-wrap items-center gap-2" data-wf-toolbar>
            <select
              className="max-w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
              value={version.id}
              onChange={(e) => void openVersion(wfId!, e.target.value)}
              data-wf-version-select
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>v{v.version} · {ENV_LABEL[v.environment]}</option>
              ))}
            </select>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${ENV_CLASS[version.environment]}`} data-wf-env={version.environment}>{ENV_LABEL[version.environment]}</span>
            {version.environment === 'draft' && abilities.canEdit && (
              <>
                <button type="button" className={`${btn} border-slate-600 text-slate-100 hover:bg-slate-800`} disabled={!!busy || !dirty} onClick={actions.save} data-wf-action="save">Зберегти</button>
                <button type="button" className={`${btn} border-slate-600 text-slate-100 hover:bg-slate-800`} disabled={!!busy} onClick={actions.validate} data-wf-action="validate">Перевірити</button>
                <button type="button" className={`${btn} border-sky-500/50 text-sky-200 hover:bg-sky-500/10`} disabled={!!busy || !fresh} onClick={actions.test} data-wf-action="test" title={fresh ? '' : 'Спершу збережіть і перевірте без помилок'}>У тест</button>
                <button type="button" className={`${btn} border-rose-500/40 text-rose-300 hover:bg-rose-500/10`} disabled={!!busy} onClick={actions.discard} data-wf-action="discard">Відкинути</button>
              </>
            )}
            {version.environment !== 'draft' && abilities.canEdit && !versions.some((v) => v.environment === 'draft') && (
              <button type="button" className={`${btn} border-amber-500/50 text-amber-200 hover:bg-amber-500/10`} disabled={!!busy} onClick={actions.edit} data-wf-action="edit">Нова чернетка з цієї</button>
            )}
            {version.environment === 'test' && abilities.canPublish && (
              <button type="button" className={`${btn} border-emerald-500/60 bg-emerald-500 text-slate-950`} disabled={!!busy} onClick={actions.publish} data-wf-action="publish">Publish to production (Опублікувати)</button>
            )}
            {version.environment === 'test' && abilities.canEdit && (
              <button type="button" className={`${btn} border-slate-600 text-slate-300 hover:bg-slate-800`} disabled={!!busy} onClick={actions.discard} data-wf-action="untest">Зняти з тесту</button>
            )}
            {version.environment === 'archived' && version.publishedAt && abilities.canPublish && (
              <button type="button" className={`${btn} border-violet-500/50 text-violet-200 hover:bg-violet-500/10`} disabled={!!busy} onClick={actions.rollback} data-wf-action="rollback">Відкотитися до цієї</button>
            )}
            {version.environment !== 'draft' && abilities.canEdit && layoutDirty && (
              <button type="button" className={`${btn} border-slate-600 text-slate-100 hover:bg-slate-800`} disabled={!!busy} onClick={actions.layout} data-wf-action="layout">Зберегти розкладку</button>
            )}
            {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            {dirty && <span className="text-[10px] text-amber-300" data-wf-dirty>не збережено</span>}
          </div>
        )}
        {notice && (
          <div className={`rounded-xl border px-3 py-2 text-xs ${notice.kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`} data-wf-notice={notice.kind}>
            {notice.text}
          </div>
        )}
        <div className="relative h-[62vh] min-h-[360px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950" data-wf-canvas>
          {def ? (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelected({ kind: 'node', id: n.id })}
              onEdgeClick={(_, e) => setSelected({ kind: 'edge', id: e.id })}
              onPaneClick={() => setSelected(null)}
              nodesConnectable={editable}
              deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
              minZoom={0.2}
              maxZoom={2}
              fitView
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
            >
              <Background gap={20} color="#1e293b" />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="grid h-full place-items-center text-xs text-slate-500">{list.length ? 'Оберіть процес' : 'Створіть перший процес'}</div>
          )}
          {version && !editable && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-900/90 px-2 py-1 text-[10px] text-slate-400" data-wf-readonly>
              {version.environment === 'draft' ? 'Лише перегляд' : 'Заморожена версія: перегляд і розкладка'}
            </div>
          )}
        </div>
      </div>

      {/* Інспектор */}
      <aside className="w-full shrink-0 space-y-3 lg:w-[300px]" data-wf-inspector>
        {selNode ? (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-wf-inspect-node={selNode.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: groupColor(selNode.type) }}>{selNode.type.replace(/_/g, ' ')}</div>
                <div className="text-xs text-slate-300">{nodeTypeById(selNode.type) ? bi(nodeTypeById(selNode.type)!.name) : selNode.type}</div>
                <div className="font-mono text-[10px] text-slate-500">{selNode.id}</div>
              </div>
              {editable && selNode.type !== 'START' && (
                <button type="button" className="rounded-lg p-1.5 text-rose-300 hover:bg-rose-500/10" onClick={() => { removeNode(selNode.id); setSelected(null); }} title="Вилучити вузол" data-wf-node-delete>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400">{nodeTypeById(selNode.type)?.description}</p>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-slate-400">Підпис на канві</span>
              <input className={inputCls} value={selNode.label ?? ''} disabled={!editable} onChange={(e) => setNode(selNode.id, { label: e.target.value || undefined })} data-wf-node-label />
            </label>
            {(nodeTypeById(selNode.type)?.params ?? []).map((p) => (
              <ParamField key={`${selNode.id}:${p.id}`} def={p} value={selNode.params?.[p.id]} disabled={!editable} onChange={(v) => setParam(selNode.id, p.id, v)} />
            ))}
            {(issuesByNode.get(selNode.id) ?? []).map((i, k) => (
              <div key={k} className="flex gap-1.5 text-[11px] text-rose-300"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{i.message}</div>
            ))}
          </div>
        ) : selEdge ? (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300" data-wf-inspect-edge={selEdge.id}>
            <div className="font-bold text-slate-100">Ребро</div>
            <div>{selEdge.from} <span className="text-amber-300">[{selEdge.fromPort}]</span> → {selEdge.to}</div>
            {editable && (
              <button type="button" className={`${btn} border-rose-500/40 text-rose-300`} onClick={() => { removeEdge(selEdge.id); setSelected(null); }} data-wf-edge-delete>
                <Trash2 className="h-3.5 w-3.5" /> Вилучити
              </button>
            )}
          </div>
        ) : def ? (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-wf-inspect-workflow>
            <div className="text-xs font-bold text-slate-100">Процес</div>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-slate-400">Name (English)</span>
              <input className={inputCls} value={def.name.en} disabled={!editable} onChange={(e) => mutate((d) => ({ ...d, name: { ...d.name, en: e.target.value } }))} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-slate-400">Назва (українською)</span>
              <input className={inputCls} value={def.name.uk} disabled={!editable} onChange={(e) => mutate((d) => ({ ...d, name: { ...d.name, uk: e.target.value } }))} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-slate-400">Опис</span>
              <textarea className={`${inputCls} h-16`} value={def.description} disabled={!editable} onChange={(e) => mutate((d) => ({ ...d, description: e.target.value }))} />
            </label>
            <p className="text-[10px] text-slate-500">Вузлів: {def.nodes.length}, ребер: {def.edges.length}. Виконання — Т5.4.</p>
          </div>
        ) : null}

        {validation && (
          <div className="space-y-1.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-wf-validation={validation.ok ? 'ok' : 'errors'}>
            <div className={`flex items-center gap-1.5 text-xs font-bold ${validation.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {validation.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {validation.ok ? 'Перевірка пройдена' : `Помилок: ${validation.errors.length}`}
            </div>
            {[...validation.errors, ...validation.warnings].slice(0, 30).map((i, k) => (
              <button
                key={k}
                type="button"
                onClick={() => i.nodeId && setSelected({ kind: 'node', id: i.nodeId })}
                className={`block w-full text-left text-[11px] ${k < validation.errors.length ? 'text-rose-300' : 'text-amber-300'} hover:underline`}
                data-wf-issue={i.code}
              >
                {i.message}
              </button>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

export const WorkflowEditor: React.FC<{ abilities: GsAbilities }> = (props) => (
  <ReactFlowProvider>
    <Editor {...props} />
  </ReactFlowProvider>
);
