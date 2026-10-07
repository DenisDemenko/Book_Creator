/**
 * Graph Studio → «Напрямки» (Т5.5 В2, `PLAN_JEV_NODES.md`; ТЗ Graph Studio §10,
 * №10; рішення власника §2 п.2): реєстр напрямків маршрутизатора Jev —
 * реєстр → варіант → процес, з описом для Jev. Маршрутизатор із реєстром
 * бачить новий напрямок без правки себе; вимкнений — не пропонує.
 *
 * Правити — адмін і право публікації схем (напрямок діє на робочі процеси
 * одразу); бачать — усі, хто відкриває Graph Studio.
 */

import { SEMANTIC_REGISTRY, SEMANTIC_OPTIONS } from '../../utils/semanticChange';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Route, Save, Trash2 } from 'lucide-react';
import { ENV_CLASS, gs, type GsAbilities } from './gsApi';

interface Destination {
  registry: string;
  option: string;
  label: { en: string; uk: string };
  description: string;
  workflowId: string;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string;
  published: number | null;
}
interface Overview {
  destinations: Destination[];
  workflows: { id: string; name: { en: string; uk: string }; published: number | null }[];
  routers: Record<string, { workflowId: string; nodeId: string; label: string | null }[]>;
}

const ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const inputCls = 'w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 disabled:opacity-60';
const btn = 'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold disabled:opacity-50';
const blank = { registry: '', option: '', en: '', uk: '', description: '', workflowId: '', enabled: true };

export const DestinationsPanel: React.FC<{ abilities: GsAbilities }> = ({ abilities }) => {
  const [data, setData] = useState<Overview | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, Destination>>({});
  const [draft, setDraft] = useState(blank);
  const canEdit = abilities.canPublish;

  const load = useCallback(async () => {
    const r = await gs<Overview>('GET', '/api/core/workflow-destinations');
    setData(r);
    setEdits({});
  }, []);
  useEffect(() => {
    void load().catch((e) => setNotice({ kind: 'error', text: (e as Error).message }));
  }, [load]);

  const registries = useMemo(() => {
    const names = new Set<string>([...(data?.destinations ?? []).map((d) => d.registry), ...Object.keys(data?.routers ?? {})]);
    return [...names].sort();
  }, [data]);
  const published = (data?.workflows ?? []).filter((w) => w.published);

  const save = async (d: { registry: string; option: string; label: { en: string; uk: string }; description: string; workflowId: string; enabled: boolean }, after?: () => void) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await gs<{ destination: Destination; warning?: string }>('PUT', `/api/core/workflow-destinations/${encodeURIComponent(d.registry)}/${encodeURIComponent(d.option)}`, {
        label: d.label, description: d.description, workflowId: d.workflowId, enabled: d.enabled,
      });
      setNotice(r.warning ? { kind: 'warn', text: r.warning } : { kind: 'ok', text: `Напрямок «${d.registry} → ${d.option}» збережено — маршрутизатори реєстру бачать його одразу.` });
      after?.();
      await load();
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (d: Destination) => {
    setBusy(true);
    try {
      await gs('DELETE', `/api/core/workflow-destinations/${encodeURIComponent(d.registry)}/${encodeURIComponent(d.option)}`);
      setNotice({ kind: 'ok', text: `Напрямок «${d.registry} → ${d.option}» вилучено.` });
      await load();
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  const keyOf = (d: Destination) => `${d.registry}/${d.option}`;
  const draftOk = ID_RE.test(draft.registry) && ID_RE.test(draft.option) && (draft.registry !== SEMANTIC_REGISTRY || SEMANTIC_OPTIONS.includes(draft.option)) && draft.en.trim() && draft.uk.trim() && draft.workflowId && draft.description.length <= 255;

  return (
    <div className="space-y-3" data-gs-destinations>
      <p className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
        <Route className="mr-1 inline h-3.5 w-3.5 text-amber-300" />
        Destination Registry (Реєстр напрямків, §10): маршрутизатор Jev із параметром «Реєстр напрямків» пропонує Jev увімкнені напрямки свого реєстру
        (опис — це те, що Jev читає про варіант) і виконує обраний процес як підпроцес. Новий напрямок не потребує правки маршрутизатора.
        {!canEdit && <span className="text-amber-300"> Правити може адмін або роль із правом публікації схем.</span>}
      </p>
      <p className="rounded-xl border border-slate-800 p-3 text-[11px] text-slate-400" data-semantic-destinations-help>
        Для аналізу після збереження книги додайте реєстр «semantic_change» і категорію:
        {' '}{SEMANTIC_OPTIONS.join(', ')}. Детектор запускатиме лише відповідний опублікований процес
        із зачепленими абзацами, сценами та сутностями. Без напрямків автоматичних AI-запитів немає.
        Процес може читати й пропонувати; запис у канон та довільні інструменти недоступні.
      </p>
      {notice && (
        <div className={`rounded-xl border px-3 py-2 text-xs ${notice.kind === 'ok' ? 'border-emerald-500/40 text-emerald-200' : notice.kind === 'warn' ? 'border-amber-500/40 text-amber-200' : 'border-rose-500/40 text-rose-200'}`} data-gs-dest-notice={notice.kind}>{notice.text}</div>
      )}

      {registries.length === 0 && <p className="text-xs text-slate-500" data-gs-dest-empty>Реєстрів ще немає — додайте перший напрямок нижче.</p>}
      {registries.map((reg) => {
        const rows = data.destinations.filter((d) => d.registry === reg);
        const users = data.routers[reg] ?? [];
        return (
          <section key={reg} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-gs-registry={reg}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-mono text-sm font-bold text-amber-200">{reg}</h3>
              <span className="text-[10px] text-slate-500" data-gs-registry-routers={users.length}>
                {users.length ? `Маршрутизатори: ${users.map((u) => `${u.workflowId} · ${u.label || u.nodeId}`).join('; ')}` : 'Жоден робочий процес цей реєстр ще не читає'}
              </span>
            </div>
            {rows.length === 0 && <p className="text-[11px] text-slate-500">Напрямків немає — маршрутизатор піде резервним маршрутом.</p>}
            <div className="space-y-2">
              {rows.map((d0) => {
                const d = edits[keyOf(d0)] ?? d0;
                const set = (patch: Partial<Destination>) => setEdits((e) => ({ ...e, [keyOf(d0)]: { ...d, ...patch } }));
                const dirty = !!edits[keyOf(d0)];
                return (
                  <div key={keyOf(d0)} className={`grid gap-2 rounded-xl border p-2 sm:grid-cols-[8rem_1fr_1fr] ${d.enabled ? 'border-slate-800' : 'border-dashed border-slate-700 opacity-70'}`} data-gs-dest={keyOf(d0)} data-gs-dest-enabled={d.enabled ? 'yes' : 'no'}>
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-slate-100">{d.option}</div>
                      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-300">
                        <input type="checkbox" checked={d.enabled} disabled={!canEdit || busy} onChange={(e) => set({ enabled: e.target.checked })} data-gs-dest-toggle />
                        увімкнено
                      </label>
                      {d0.published ? (
                        <span className={`mt-1 inline-block rounded border px-1 text-[9px] ${ENV_CLASS.production}`}>prod v{d0.published}</span>
                      ) : (
                        <span className="mt-1 inline-block rounded border border-rose-500/40 px-1 text-[9px] text-rose-300" data-gs-dest-unpublished>немає робочої версії</span>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <input className={inputCls} value={d.label.en} disabled={!canEdit || busy} onChange={(e) => set({ label: { ...d.label, en: e.target.value } })} placeholder="Name (English)" />
                      <input className={inputCls} value={d.label.uk} disabled={!canEdit || busy} onChange={(e) => set({ label: { ...d.label, uk: e.target.value } })} placeholder="Назва українською" />
                      <select className={inputCls} value={d.workflowId} disabled={!canEdit || busy} onChange={(e) => set({ workflowId: e.target.value })} data-gs-dest-workflow>
                        {data.workflows.map((w) => <option key={w.id} value={w.id}>{w.id}{w.published ? '' : ' (без робочої версії)'}</option>)}
                      </select>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <textarea className={`${inputCls} h-[3.6rem]`} value={d.description} maxLength={255} disabled={!canEdit || busy} onChange={(e) => set({ description: e.target.value })} placeholder="Опис для Jev (до 255 символів)" data-gs-dest-description />
                      {canEdit && (
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" className={`${btn} border-emerald-500/50 text-emerald-200`} disabled={!dirty || busy} onClick={() => save(d)} data-gs-dest-save><Save className="h-3 w-3" /> Зберегти</button>
                          <button type="button" className={`${btn} border-rose-500/40 text-rose-300`} disabled={busy} onClick={() => remove(d0)} data-gs-dest-delete><Trash2 className="h-3 w-3" /> Вилучити</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {canEdit && (
        <section className="space-y-2 rounded-2xl border border-amber-500/30 bg-slate-900/70 p-3" data-gs-dest-new>
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-100"><Plus className="h-3.5 w-3.5" /> New destination (Новий напрямок)</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-[10px] text-slate-400">Реєстр
              <input className={inputCls} list="gs-registries" value={draft.registry} onChange={(e) => setDraft({ ...draft, registry: e.target.value.trim() })} placeholder="story_agents" data-gs-dest-new-registry />
              <datalist id="gs-registries">{registries.map((r) => <option key={r} value={r} />)}</datalist>
            </label>
            <label className="block text-[10px] text-slate-400">Варіант (id)
              <input className={inputCls} value={draft.option} onChange={(e) => setDraft({ ...draft, option: e.target.value.trim() })} placeholder="mystery" data-gs-dest-new-option />
            </label>
            <label className="block text-[10px] text-slate-400">Процес
              <select className={inputCls} value={draft.workflowId} onChange={(e) => setDraft({ ...draft, workflowId: e.target.value })} data-gs-dest-new-workflow>
                <option value="">—</option>
                {published.map((w) => <option key={w.id} value={w.id}>{w.id} — {w.name.uk}</option>)}
              </select>
            </label>
            <label className="block text-[10px] text-slate-400">Name (English)
              <input className={inputCls} value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} data-gs-dest-new-en />
            </label>
            <label className="block text-[10px] text-slate-400">Назва українською
              <input className={inputCls} value={draft.uk} onChange={(e) => setDraft({ ...draft, uk: e.target.value })} data-gs-dest-new-uk />
            </label>
            <label className="block text-[10px] text-slate-400">Опис для Jev
              <input className={inputCls} value={draft.description} maxLength={255} onChange={(e) => setDraft({ ...draft, description: e.target.value })} data-gs-dest-new-description />
            </label>
          </div>
          {(draft.registry && !ID_RE.test(draft.registry)) || (draft.option && !ID_RE.test(draft.option)) ? (
            <p className="text-[10px] text-rose-300">Реєстр і варіант — латиниця в нижньому регістрі, цифри й «_», з літери.</p>
          ) : null}
          <button
            type="button"
            className={`${btn} border-amber-500/60 bg-amber-500 text-slate-950`}
            disabled={!draftOk || busy}
            onClick={() => save({ registry: draft.registry, option: draft.option, label: { en: draft.en.trim(), uk: draft.uk.trim() }, description: draft.description.trim(), workflowId: draft.workflowId, enabled: true }, () => setDraft({ ...blank, registry: draft.registry }))}
            data-gs-dest-add
          >
            <Plus className="h-3 w-3" /> Додати напрямок
          </button>
        </section>
      )}
    </div>
  );
};

export default DestinationsPanel;
