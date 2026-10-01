/**
 * «Ontology (Онтологія)» у Graph Studio — канва онтології твору (Т5.2 В4,
 * `PLAN_GRAPH_STUDIO.md`; ТЗ §4: вузли ENTITY_GROUP, ENTITY_TYPE,
 * RELATION_TYPE; життєвий цикл EDIT → DRAFT → VALIDATE → PREVIEW → MIGRATION
 * IMPACT → PUBLISH → ACTIVE).
 *
 * Огляд — 12 доменних груп (A–J3) з кількістю типів; група розгортається в
 * свої типи. Зв'язки — окрема колонка; зв'язок з обмеженими кінцями
 * (`from` / `to`) малюється ребрами між типами, як у прикладі ТЗ §4.3
 * (CHARACTER —HAS_GOAL→ GOAL). Властивості-посилання (`entity_ref`) —
 * пунктирні ребра.
 *
 * Правка — лише чернетки, операціями реєстру схем Т5.1 (`set_entity_type`,
 * `set_relation_type`, `set_group`, `set_entity_status`…); публікація — з
 * правом canPublishSchema. Розкладка канви — окремо (`…/ontology/layout`),
 * визначення й хешу не змінює (№28).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, CheckCircle2, Loader2, Plus } from 'lucide-react';
import type { OntologyDefinition, OntologyEntityType, OntologyGroup, OntologyRelationType } from '../../utils/ontology';
import { readableTextOn } from '../../utils/coreEntities';
import { ENV_CLASS, gs, type GsAbilities } from './gsApi';

type Pos = Record<string, { x: number; y: number }>;
interface DraftRow {
  id: string;
  version: number;
  status: string;
  revision: number;
  definition: OntologyDefinition;
  definitionHash: string;
  validation: { ok: boolean; errors: { path: string; message: string }[]; warnings: { message: string }[]; hash?: string } | null;
  impact: { hash: string; blockers: { message: string }[]; affected: { message: string }[] } | null;
}
type Sel = { kind: 'group' | 'type' | 'relation'; id: string } | null;

const BASE = '/api/core/ontology';
const inputCls = 'w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-amber-400 focus:outline-hidden disabled:opacity-60';
const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40';

interface ONodeData extends Record<string, unknown> {
  kind: 'group' | 'type' | 'relation';
  title: string;
  subtitle: string;
  color: string;
  deprecated?: boolean;
  faded?: boolean;
  selected?: boolean;
}

const ONode: React.FC<NodeProps<Node<ONodeData>>> = ({ id, data }) => {
  const isType = data.kind === 'type';
  const bg = isType ? data.color : data.kind === 'group' ? '#1e293b' : '#0f172a';
  return (
    <div
      className={`rounded-xl px-3 py-1.5 shadow-lg ${data.kind === 'relation' ? 'border border-dashed border-sky-500/60' : 'border border-slate-700'}`}
      style={{ background: bg, color: isType ? readableTextOn(bg) : '#e2e8f0', opacity: data.faded ? 0.45 : data.deprecated ? 0.6 : 1, outline: data.selected ? '2px solid #f8fafc' : 'none', outlineOffset: 2, minWidth: data.kind === 'group' ? 170 : 110, maxWidth: 220 }}
      data-onto-node={id}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="text-[9px] font-bold uppercase tracking-wide opacity-70">{data.kind === 'group' ? 'ENTITY_GROUP' : data.kind === 'type' ? 'ENTITY_TYPE' : 'RELATION_TYPE'}</div>
      <div className={`truncate font-semibold ${data.kind === 'group' ? 'text-[13px]' : 'text-[12px]'} ${data.deprecated ? 'line-through' : ''}`}>{data.title}</div>
      <div className="truncate text-[10px] opacity-80">{data.subtitle}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
};
const nodeTypes = { onto: ONode };

const gKey = (id: string) => `g:${id}`;
const tKey = (id: string) => `t:${id}`;
const rKey = (id: string) => `r:${id}`;

function Canvas({ abilities }: { abilities: GsAbilities }) {
  const [active, setActive] = useState<{ version: number; definition: OntologyDefinition } | null>(null);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [showDraft, setShowDraft] = useState(true);
  const [layout, setLayout] = useState<Pos>({});
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [group, setGroup] = useState<string>('');
  const [sel, setSel] = useState<Sel>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [newType, setNewType] = useState<{ id: string; en: string; uk: string } | null>(null);

  const load = useCallback(async () => {
    const [a, d, l] = await Promise.all([
      gs<{ version: number; definition: OntologyDefinition }>('GET', BASE),
      gs<{ version: DraftRow | null }>('GET', `${BASE}/draft`),
      gs<{ layout: Pos }>('GET', `${BASE}/layout`),
    ]);
    setActive(a);
    setDraft(d.version);
    setLayout(l.layout ?? {});
    setLayoutDirty(false);
  }, []);
  useEffect(() => { void load().catch((e) => setNotice({ kind: 'error', text: e.message })); }, [load]);

  const def: OntologyDefinition | null = (showDraft && draft?.definition) || active?.definition || null;
  const editable = !!draft && showDraft && abilities.canEdit;

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ kind: 'ok', text: msg });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const applyOps = (ops: unknown[], msg: string) => run(async () => {
    const r = await gs<{ version: DraftRow }>('PATCH', `${BASE}/drafts/${draft!.id}`, { ops, expectedRevision: draft!.revision });
    setDraft(r.version);
    setPreview(null);
    return msg;
  });

  // ── Вузли й ребра ────────────────────────────────────────────────────────
  const { nodes, edges } = useMemo(() => {
    const out: { nodes: Node<ONodeData>[]; edges: Edge[] } = { nodes: [], edges: [] };
    if (!def) return out;
    const groups = [...def.groups].sort((a, b) => a.order - b.order);
    const typesOf = (gid: string) => def.entityTypes.filter((t) => t.groupId === gid).sort((a, b) => a.ui.order - b.ui.order);
    const pos = (key: string, fallback: { x: number; y: number }) => layout[key] ?? fallback;
    const isSel = (kind: string, id: string) => sel?.kind === kind && sel.id === id;
    const typeNode = (t: OntologyEntityType, fb: { x: number; y: number }, faded = false): Node<ONodeData> => ({
      id: tKey(t.id), type: 'onto', position: pos(tKey(t.id), fb),
      data: { kind: 'type', title: t.name.uk, subtitle: `${t.id} · ${t.name.en}`, color: t.ui.color, deprecated: t.status === 'deprecated', faded, selected: isSel('type', t.id) },
    });
    // Зв'язки — сіткою по три в ряд, щоб колонка не розтягувала канву.
    const relationNodes = (rels: OntologyRelationType[], x: number) => rels.map((r, i): Node<ONodeData> => ({
      id: rKey(r.id), type: 'onto', position: pos(rKey(r.id), { x: x + (i % 3) * 210, y: Math.floor(i / 3) * 70 }),
      data: { kind: 'relation', title: r.name.uk, subtitle: `${r.id} · ${r.from ? r.from.join(', ') : 'будь-які'} → ${r.to ? r.to.join(', ') : 'будь-які'}`, color: '#0f172a', deprecated: r.status === 'deprecated', selected: isSel('relation', r.id) },
    }));
    const relEdge = (id: string, source: string, target: string, label: string): Edge => ({
      id, source, target, label, labelStyle: { fill: '#cbd5e1', fontSize: 10 }, labelBgStyle: { fill: '#0f172a' }, style: { stroke: '#38bdf8', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8' },
    });
    if (!group) {
      // Огляд: групи сіткою 3×4, зв'язки — колонкою праворуч.
      groups.forEach((g, i) => {
        out.nodes.push({
          id: gKey(g.id), type: 'onto', position: pos(gKey(g.id), { x: (i % 3) * 230, y: Math.floor(i / 3) * 110 }),
          data: { kind: 'group', title: `${g.id} · ${g.name.uk}`, subtitle: `${typesOf(g.id).length} типів · ${g.name.en}`, color: '#1e293b', selected: isSel('group', g.id) },
        });
      });
      out.nodes.push(...relationNodes([...def.relationTypes].sort((a, b) => a.ui.order - b.ui.order), 760));
      // Обмежені зв'язки — між групами їхніх типів.
      for (const r of def.relationTypes) {
        if (!r.from || !r.to) continue;
        const gOf = (t: string) => def.entityTypes.find((x) => x.id === t)?.groupId;
        const gf = new Set(r.from.map(gOf).filter(Boolean) as string[]);
        const gt = new Set(r.to.map(gOf).filter(Boolean) as string[]);
        for (const a of gf) for (const b of gt) out.edges.push(relEdge(`ge:${r.id}:${a}:${b}`, gKey(a), gKey(b), r.name.uk));
      }
      return out;
    }
    const inGroup = typesOf(group);
    inGroup.forEach((t, i) => out.nodes.push(typeNode(t, { x: (i % 4) * 190, y: Math.floor(i / 4) * 90 })));
    const ids = new Set(inGroup.map((t) => t.id));
    // У групі — лише зв'язки, обмежені її типами; «будь-які → будь-які» — в огляді.
    const rels = def.relationTypes.filter((r) => r.from && r.to && (r.from.some((x) => ids.has(x)) || r.to.some((x) => ids.has(x))));
    out.nodes.push(...relationNodes([...rels].sort((a, b) => a.ui.order - b.ui.order), 820));
    const anyRels = def.relationTypes.filter((r) => !r.from || !r.to).length;
    if (anyRels) out.nodes.push({ id: 'note:any', type: 'onto', position: pos('note:any', { x: 820, y: Math.ceil(rels.length / 3) * 70 + 10 }), draggable: true, data: { kind: 'relation', title: `+ ${anyRels} зв'язків «будь-які → будь-які»`, subtitle: 'Обмежте кінці зв\'язку в інспекторі — він з\'явиться тут ребром', color: '#0f172a' } });
    // Типи інших груп, з якими цю групу пов'язують обмежені зв'язки чи посилання.
    const outer = new Map<string, OntologyEntityType>();
    const want = (tid: string) => {
      if (ids.has(tid)) return;
      const t = def.entityTypes.find((x) => x.id === tid);
      if (t) outer.set(t.id, t);
    };
    for (const r of rels) if (r.from && r.to && (r.from.some((x) => ids.has(x)) || r.to.some((x) => ids.has(x)))) { r.from.forEach(want); r.to.forEach(want); }
    for (const t of inGroup) for (const p of t.properties) if (p.type === 'entity_ref') (p.refTypes ?? []).forEach(want);
    const base = (Math.ceil(inGroup.length / 4) + 1) * 90;
    [...outer.values()].forEach((t, i) => out.nodes.push(typeNode(t, { x: (i % 4) * 190, y: base + Math.floor(i / 4) * 90 }, true)));
    for (const r of rels) {
      if (!r.from || !r.to) continue;
      for (const a of r.from) for (const b of r.to) {
        if (!ids.has(a) && !ids.has(b)) continue;
        out.edges.push(relEdge(`re:${r.id}:${a}:${b}`, tKey(a), tKey(b), r.name.uk));
      }
    }
    for (const t of inGroup) for (const p of t.properties) {
      if (p.type !== 'entity_ref') continue;
      for (const ref of p.refTypes ?? []) out.edges.push({ id: `pe:${t.id}:${p.id}:${ref}`, source: tKey(t.id), target: tKey(ref), label: p.name.uk, labelStyle: { fill: '#94a3b8', fontSize: 9 }, labelBgStyle: { fill: '#0f172a' }, style: { stroke: '#64748b', strokeDasharray: '4 3' } });
    }
    return out;
  }, [def, group, layout, sel]);

  const onNodesChange = (changes: NodeChange[]) => {
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        setLayout((l) => ({ ...l, [ch.id]: { x: Math.round(ch.position!.x), y: Math.round(ch.position!.y) } }));
        if (abilities.canEdit) setLayoutDirty(true);
      }
    }
  };
  const onNodeClick = (_: unknown, n: Node) => {
    if (n.id.startsWith('note:')) {
      setGroup('');
      return;
    }
    const k = n.id.slice(0, 1);
    const id = n.id.slice(2);
    setSel({ kind: k === 'g' ? 'group' : k === 't' ? 'type' : 'relation', id });
  };
  const onNodeDoubleClick = (_: unknown, n: Node) => {
    if (n.id.startsWith('g:')) {
      setGroup(n.id.slice(2));
      setSel(null);
    }
  };

  // ── Інспектор ───────────────────────────────────────────────────────────
  const selType = sel?.kind === 'type' ? def?.entityTypes.find((t) => t.id === sel.id) ?? null : null;
  const selRel = sel?.kind === 'relation' ? def?.relationTypes.find((r) => r.id === sel.id) ?? null : null;
  const selGroup = sel?.kind === 'group' ? def?.groups.find((g) => g.id === sel.id) ?? null : null;

  const [typeForm, setTypeForm] = useState<OntologyEntityType | null>(null);
  const [relForm, setRelForm] = useState<OntologyRelationType | null>(null);
  const [groupForm, setGroupForm] = useState<OntologyGroup | null>(null);
  useEffect(() => { setTypeForm(selType ? JSON.parse(JSON.stringify(selType)) : null); }, [selType]);
  useEffect(() => { setRelForm(selRel ? JSON.parse(JSON.stringify(selRel)) : null); }, [selRel]);
  useEffect(() => { setGroupForm(selGroup ? JSON.parse(JSON.stringify(selGroup)) : null); }, [selGroup]);

  const freshValidation = draft?.validation && draft.validation.hash === draft.definitionHash ? draft.validation : null;
  const freshImpact = draft?.impact && draft.impact.hash === draft.definitionHash ? draft.impact : null;
  const typeOptions = useMemo(() => (def ? [...def.entityTypes].sort((a, b) => a.id.localeCompare(b.id)) : []), [def]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row" data-gs-ontology>
      <aside className="w-full shrink-0 space-y-3 lg:w-[250px]">
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
          <div className="font-bold text-slate-100">Story Ontology (Онтологія твору)</div>
          <div>Активна: <span className="font-mono text-emerald-300" data-onto-active>v{active?.version ?? '—'}</span></div>
          {draft ? (
            <div className="space-y-1.5">
              <div>Чернетка: <span className="font-mono text-amber-300" data-onto-draft>v{draft.version}</span> <span className={`rounded-full border px-1.5 text-[10px] ${ENV_CLASS.draft}`}>{draft.status}</span></div>
              <label className="flex items-center gap-2 text-[11px]">
                <input type="checkbox" checked={showDraft} onChange={(e) => setShowDraft(e.target.checked)} data-onto-show-draft />
                показувати чернетку
              </label>
            </div>
          ) : abilities.canEdit ? (
            <button type="button" className={`${btn} border-amber-500/50 text-amber-200 hover:bg-amber-500/10`} disabled={busy} onClick={() => void run(async () => {
              const r = await gs<{ version: DraftRow }>('POST', `${BASE}/drafts`, {});
              setDraft(r.version);
              setShowDraft(true);
              return `Відкрито чернетку v${r.version.version} — активна версія не зміниться до публікації.`;
            })} data-onto-action="draft">Відкрити чернетку</button>
          ) : (
            <p className="text-[11px] text-slate-500">Чернетки немає.</p>
          )}
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-slate-400">Група (ENTITY_GROUP)</span>
            <select className={inputCls} value={group} onChange={(e) => { setGroup(e.target.value); setSel(null); }} data-onto-group>
              <option value="">Огляд: усі групи</option>
              {(def?.groups ?? []).slice().sort((a, b) => a.order - b.order).map((g) => <option key={g.id} value={g.id}>{g.id} · {g.name.uk}</option>)}
            </select>
          </label>
          <p className="text-[10px] text-slate-500">Подвійний клік по групі — розгорнути її типи. Позиції вузлів — розкладка, вона не змінює онтології.</p>
          {abilities.canEdit && layoutDirty && (
            <button type="button" className={`${btn} border-slate-600 text-slate-100 hover:bg-slate-800`} disabled={busy} onClick={() => void run(async () => {
              const r = await gs<{ layout: Pos }>('PUT', `${BASE}/layout`, { layout });
              setLayout(r.layout);
              setLayoutDirty(false);
              return 'Розкладку збережено — визначення онтології не змінилось.';
            })} data-onto-action="layout">Зберегти розкладку</button>
          )}
        </div>

        {editable && (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs" data-onto-lifecycle>
            <div className="font-bold text-slate-100">Життєвий цикл</div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={`${btn} border-slate-600 text-slate-100 hover:bg-slate-800`} disabled={busy} onClick={() => void run(async () => {
                const r = await gs<{ version: DraftRow }>('POST', `${BASE}/drafts/${draft!.id}/validate`);
                setDraft(r.version);
                return r.version.validation?.ok ? 'VALIDATE: без помилок.' : `VALIDATE: помилок ${r.version.validation?.errors.length ?? 0}.`;
              })} data-onto-action="validate">Validate</button>
              <button type="button" className={`${btn} border-slate-600 text-slate-100 hover:bg-slate-800`} disabled={busy} onClick={() => void run(async () => {
                setPreview(await gs('GET', `${BASE}/drafts/${draft!.id}/preview`));
                return 'PREVIEW: різниця з активною — під канвою.';
              })} data-onto-action="preview">Preview</button>
              <button type="button" className={`${btn} border-slate-600 text-slate-100 hover:bg-slate-800`} disabled={busy} onClick={() => void run(async () => {
                const r = await gs<{ version: DraftRow }>('POST', `${BASE}/drafts/${draft!.id}/impact`);
                setDraft(r.version);
                return r.version.impact?.blockers.length ? `MIGRATION IMPACT: блокерів ${r.version.impact.blockers.length}.` : 'MIGRATION IMPACT: блокерів немає.';
              })} data-onto-action="impact">Impact</button>
              {abilities.canPublish && (
                <button type="button" className={`${btn} border-emerald-500/60 bg-emerald-500 text-slate-950`} disabled={busy || !freshValidation?.ok || !freshImpact || freshImpact.blockers.length > 0} onClick={() => void run(async () => {
                  const r = await gs<{ version: { version: number } }>('POST', `${BASE}/drafts/${draft!.id}/publish`);
                  await load();
                  return `Опубліковано: активна тепер v${r.version.version}.`;
                })} data-onto-action="publish">Publish</button>
              )}
              <button type="button" className={`${btn} border-rose-500/40 text-rose-300 hover:bg-rose-500/10`} disabled={busy} onClick={() => void run(async () => {
                await gs('POST', `${BASE}/versions/${draft!.id}/archive`);
                await load();
                return 'Чернетку відкинуто.';
              })} data-onto-action="discard">Відкинути</button>
            </div>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <span className={`rounded border px-1 ${freshValidation?.ok ? ENV_CLASS.production : ENV_CLASS.archived}`} data-onto-step-validate={freshValidation ? (freshValidation.ok ? 'ok' : 'errors') : 'none'}>validate {freshValidation ? (freshValidation.ok ? '✓' : '✗') : '—'}</span>
              <span className={`rounded border px-1 ${freshImpact && !freshImpact.blockers.length ? ENV_CLASS.production : ENV_CLASS.archived}`} data-onto-step-impact={freshImpact ? (freshImpact.blockers.length ? 'blocked' : 'ok') : 'none'}>impact {freshImpact ? (freshImpact.blockers.length ? '✗' : '✓') : '—'}</span>
            </div>
            {freshValidation && !freshValidation.ok && freshValidation.errors.slice(0, 8).map((e, i) => (
              <div key={i} className="flex gap-1 text-[11px] text-rose-300" data-onto-issue><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{e.message}</div>
            ))}
            {freshImpact?.blockers.map((b, i) => <div key={i} className="text-[11px] text-rose-300" data-onto-blocker>{b.message}</div>)}
            {freshImpact?.affected.slice(0, 5).map((b, i) => <div key={i} className="text-[11px] text-amber-300">{b.message}</div>)}
            {newType ? (
              <div className="space-y-1.5 rounded-xl border border-slate-700 p-2" data-onto-new-type>
                <input className={inputCls} placeholder="slug: dream" value={newType.id} onChange={(e) => setNewType({ ...newType, id: e.target.value })} data-onto-new-id />
                <input className={inputCls} placeholder="Name (English)" value={newType.en} onChange={(e) => setNewType({ ...newType, en: e.target.value })} data-onto-new-en />
                <input className={inputCls} placeholder="Назва (українською)" value={newType.uk} onChange={(e) => setNewType({ ...newType, uk: e.target.value })} data-onto-new-uk />
                <button type="button" className={`${btn} w-full justify-center border-amber-500/50 bg-amber-500 text-slate-950`} disabled={busy || !newType.id || !newType.en || !newType.uk || !group} onClick={() => {
                  const order = Math.max(0, ...(def?.entityTypes ?? []).map((t) => t.ui.order)) + 1;
                  const value: OntologyEntityType = { id: newType.id.trim(), name: { en: newType.en.trim(), uk: newType.uk.trim() }, groupId: group, family: null, status: 'active', registry: 'custom', ui: { color: '#64748b', order }, ai: { description: '', hints: [] }, properties: [], aliases: [] };
                  void applyOps([{ op: 'set_entity_type', value }], `Новий тип «${value.name.uk}» у чернетці.`).then(() => {
                    setNewType(null);
                    setSel({ kind: 'type', id: value.id });
                  });
                }} data-onto-new-submit>Додати в групу {group || '—'}</button>
                {!group && <p className="text-[10px] text-amber-300">Спершу оберіть групу.</p>}
              </div>
            ) : (
              <button type="button" className={`${btn} border-slate-600 text-slate-200`} onClick={() => setNewType({ id: '', en: '', uk: '' })} data-onto-action="new-type"><Plus className="h-3.5 w-3.5" /> Новий тип</button>
            )}
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-2">
        {notice && <div className={`rounded-xl border px-3 py-2 text-xs ${notice.kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`} data-onto-notice={notice.kind}>{notice.text}</div>}
        <div className="relative h-[66vh] min-h-[380px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950" data-onto-canvas>
          {def ? (
            <ReactFlow
              key={group || 'overview'}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onPaneClick={() => setSel(null)}
              nodesConnectable={false}
              deleteKeyCode={null}
              minZoom={0.15}
              maxZoom={2}
              fitView
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
            >
              <Background gap={22} color="#1e293b" />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="grid h-full place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-900/90 px-2 py-1 text-[10px] text-slate-400" data-onto-mode>
            {def ? `${showDraft && draft ? `Чернетка v${draft.version}` : `Активна v${active?.version}`} · ${def.entityTypes.length} типів · ${def.relationTypes.length} зв'язків${group ? ` · група ${group}` : ''}` : ''}
          </div>
        </div>
        {preview && (
          <pre className="max-h-48 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2 text-[10px] text-slate-300" data-onto-preview>{JSON.stringify((preview as { diff?: unknown }).diff ?? preview, null, 2)}</pre>
        )}
      </div>

      <aside className="w-full shrink-0 lg:w-[300px]" data-onto-inspector>
        {typeForm ? (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs" data-onto-inspect-type={typeForm.id}>
            <div className="text-[10px] font-bold uppercase text-slate-400">ENTITY_TYPE <span className="font-mono">{typeForm.id}</span></div>
            <label className="block"><span className="text-[10px] text-slate-400">Name (English)</span><input className={inputCls} disabled={!editable} value={typeForm.name.en} onChange={(e) => setTypeForm({ ...typeForm, name: { ...typeForm.name, en: e.target.value } })} data-onto-type-en /></label>
            <label className="block"><span className="text-[10px] text-slate-400">Назва (українською)</span><input className={inputCls} disabled={!editable} value={typeForm.name.uk} onChange={(e) => setTypeForm({ ...typeForm, name: { ...typeForm.name, uk: e.target.value } })} data-onto-type-uk /></label>
            <label className="block"><span className="text-[10px] text-slate-400">Група</span>
              <select className={inputCls} disabled={!editable} value={typeForm.groupId} onChange={(e) => setTypeForm({ ...typeForm, groupId: e.target.value })} data-onto-type-group>
                {(def?.groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.id} · {g.name.uk}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2"><span className="text-[10px] text-slate-400">Колір</span><input type="color" disabled={!editable} value={typeForm.ui.color} onChange={(e) => setTypeForm({ ...typeForm, ui: { ...typeForm.ui, color: e.target.value } })} data-onto-type-color /><span className="font-mono text-[10px] text-slate-500">{typeForm.ui.color}</span></label>
            <label className="block"><span className="text-[10px] text-slate-400">AI: опис для моделі</span><textarea className={`${inputCls} h-16`} disabled={!editable} value={typeForm.ai.description} onChange={(e) => setTypeForm({ ...typeForm, ai: { ...typeForm.ai, description: e.target.value } })} /></label>
            <div className="text-[10px] text-slate-400">Властивостей: {typeForm.properties.length}{typeForm.properties.length ? ` (${typeForm.properties.slice(0, 6).map((p) => p.name.uk).join(', ')}${typeForm.properties.length > 6 ? '…' : ''})` : ''} · статус: {typeForm.status}</div>
            {editable && (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={`${btn} border-amber-500/50 bg-amber-500 text-slate-950`} disabled={busy} onClick={() => void applyOps([{ op: 'set_entity_type', value: typeForm }], `Тип «${typeForm.name.uk}» змінено в чернетці.`)} data-onto-type-apply>Застосувати</button>
                <button type="button" className={`${btn} border-slate-600 text-slate-300`} disabled={busy} onClick={() => void applyOps([{ op: 'set_entity_status', id: typeForm.id, status: typeForm.status === 'active' ? 'deprecated' : 'active' }], typeForm.status === 'active' ? 'Тип позначено застарілим (DEPRECATED).' : 'Тип повернуто.')} data-onto-type-status>{typeForm.status === 'active' ? 'Застарілий' : 'Повернути'}</button>
              </div>
            )}
          </div>
        ) : relForm ? (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs" data-onto-inspect-relation={relForm.id}>
            <div className="text-[10px] font-bold uppercase text-slate-400">RELATION_TYPE <span className="font-mono">{relForm.id}</span></div>
            <label className="block"><span className="text-[10px] text-slate-400">Name (English)</span><input className={inputCls} disabled={!editable} value={relForm.name.en} onChange={(e) => setRelForm({ ...relForm, name: { ...relForm.name, en: e.target.value } })} /></label>
            <label className="block"><span className="text-[10px] text-slate-400">Назва (українською)</span><input className={inputCls} disabled={!editable} value={relForm.name.uk} onChange={(e) => setRelForm({ ...relForm, name: { ...relForm.name, uk: e.target.value } })} /></label>
            {(['from', 'to'] as const).map((side) => (
              <label key={side} className="block">
                <span className="text-[10px] text-slate-400">{side === 'from' ? 'Від (from)' : 'До (to)'} — порожньо = будь-які</span>
                <select multiple className={`${inputCls} h-24`} disabled={!editable} value={relForm[side] ?? []} onChange={(e) => {
                  const v = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setRelForm({ ...relForm, [side]: v.length ? v : null });
                }} data-onto-rel-side={side}>
                  {typeOptions.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.name.uk}</option>)}
                </select>
              </label>
            ))}
            {editable && (
              <button type="button" className={`${btn} border-amber-500/50 bg-amber-500 text-slate-950`} disabled={busy} onClick={() => void applyOps([{ op: 'set_relation_type', value: relForm }], `Зв'язок «${relForm.name.uk}» змінено в чернетці.`)} data-onto-rel-apply>Застосувати</button>
            )}
          </div>
        ) : groupForm ? (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs" data-onto-inspect-group={groupForm.id}>
            <div className="text-[10px] font-bold uppercase text-slate-400">ENTITY_GROUP <span className="font-mono">{groupForm.id}</span></div>
            <label className="block"><span className="text-[10px] text-slate-400">Name (English)</span><input className={inputCls} disabled={!editable} value={groupForm.name.en} onChange={(e) => setGroupForm({ ...groupForm, name: { ...groupForm.name, en: e.target.value } })} /></label>
            <label className="block"><span className="text-[10px] text-slate-400">Назва (українською)</span><input className={inputCls} disabled={!editable} value={groupForm.name.uk} onChange={(e) => setGroupForm({ ...groupForm, name: { ...groupForm.name, uk: e.target.value } })} /></label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={`${btn} border-slate-600 text-slate-200`} onClick={() => { setGroup(groupForm.id); setSel(null); }} data-onto-open-group>Розгорнути типи</button>
              {editable && (
                <button type="button" className={`${btn} border-amber-500/50 bg-amber-500 text-slate-950`} disabled={busy} onClick={() => void applyOps([{ op: 'set_group', value: groupForm }], `Групу ${groupForm.id} змінено в чернетці.`)}>Застосувати</button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-[11px] text-slate-400">
            Оберіть групу, тип чи зв'язок на канві. {editable ? 'Зміни йдуть у чернетку операціями реєстру схем; активна версія не зміниться до публікації.' : draft ? 'Увімкніть «показувати чернетку», щоб правити.' : 'Правка — у чернетці.'}
            {freshValidation?.ok && <div className="mt-2 flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3 w-3" /> чернетка перевірена</div>}
          </div>
        )}
      </aside>
    </div>
  );
}

export const OntologyCanvas: React.FC<{ abilities: GsAbilities }> = (props) => (
  <ReactFlowProvider>
    <Canvas {...props} />
  </ReactFlowProvider>
);
