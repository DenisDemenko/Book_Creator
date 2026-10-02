/**
 * Graph Studio — `/admin/graph-studio/<вкладка>` (Т5.2, `PLAN_GRAPH_STUDIO.md`;
 * ТЗ Graph Studio §35: шість вкладок ONTOLOGY / AI WORKFLOWS / STORY GRAPH /
 * RUNS / VERSIONS / EVALUATIONS).
 *
 * Рішення власника (§2): адреса в адмінці; повноцінно в Т5.2 — Онтологія,
 * Процеси ШІ й Версії; Запуски — до Т5.4, Оцінювання — прогони якості Т2.8.
 * Т5.3: Граф твору — вибір книги, справжні сутності й зв'язки через Story
 * Core API, походження, пропозиції й запис у канон (`StoryGraphPanel`).
 * Т5.4: Запуски — журнал і трасування виконань опублікованих процесів,
 * пауза / продовження / повтор / відгалуження (`RunsPanel`).
 * Т5.5: Напрямки — реєстр напрямків маршрутизатора Jev (`DestinationsPanel`);
 * у «Запусках» — рішення Jev (розподіл, джерело, узгодження) і підпроцеси.
 *
 * Відкривають адмін і ролі з правом публікації схем (сервер перевіряє кожен
 * запит; тут — лише що показати).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, GitBranch, History, Loader2, Network, PlayCircle, Route, ShieldAlert, Sparkles, Workflow } from 'lucide-react';
import type { GraphStudioTab } from '../../utils/appRoutes';
import { ENV_CLASS, ENV_LABEL, gs, type GsAbilities } from './gsApi';
import { WorkflowEditor } from './WorkflowEditor';
import { OntologyCanvas } from './OntologyCanvas';
import { StoryGraphPanel } from './StoryGraphPanel';
import { RunsPanel } from './RunsPanel';
import { DestinationsPanel } from './DestinationsPanel';

const TABS: { id: GraphStudioTab; en: string; uk: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'ontology', en: 'Ontology', uk: 'Онтологія', icon: Network },
  { id: 'workflows', en: 'AI Workflows', uk: 'Процеси ШІ', icon: Workflow },
  { id: 'destinations', en: 'Destinations', uk: 'Напрямки', icon: Route },
  { id: 'story-graph', en: 'Story Graph', uk: 'Граф твору', icon: GitBranch },
  { id: 'runs', en: 'Runs', uk: 'Запуски', icon: PlayCircle },
  { id: 'versions', en: 'Versions', uk: 'Версії', icon: History },
  { id: 'evaluations', en: 'Evaluations', uk: 'Оцінювання', icon: Sparkles },
];

interface Props {
  tab: GraphStudioTab;
  onTabChange: (tab: GraphStudioTab) => void;
  bookTitle?: string;
  onOpenStoryGraph?: () => void;
}

// ── Версії ─────────────────────────────────────────────────────────────────

interface OntoVersion { id: string; version: number; status: string; label: string; publishedAt: string | null; createdAt: string; publishedBy: string | null }
interface WfVersion { id: string; version: number; environment: string; publishedAt: string | null; createdAt: string; notes: string }

const ONTO_STATUS_CLASS: Record<string, string> = {
  active: ENV_CLASS.production,
  draft: ENV_CLASS.draft,
  validated: ENV_CLASS.test,
  deprecated: ENV_CLASS.archived,
  archived: ENV_CLASS.archived,
};

const VersionsPanel: React.FC<{ abilities: GsAbilities }> = ({ abilities }) => {
  const [onto, setOnto] = useState<{ id: string; title: string; base: string; versions: OntoVersion[] }[]>([]);
  const [wfs, setWfs] = useState<{ id: string; name: string; versions: WfVersion[]; events: any[] }[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sources = [
      { id: 'fusion-story', title: 'Story Ontology (Онтологія твору)', base: '/api/core/ontology' },
      { id: 'fusion-collab', title: 'Collaboration Ontology (Онтологія співпраці)', base: '/api/core/collaboration/ontology' },
    ];
    setOnto(await Promise.all(sources.map(async (s) => ({ ...s, versions: (await gs<{ versions: OntoVersion[] }>('GET', `${s.base}/versions`)).versions }))));
    const list = await gs<{ workflows: { workflow: { id: string; name: { uk: string } } }[] }>('GET', '/api/core/workflows');
    setWfs(await Promise.all(list.workflows.map(async (w) => {
      const [d, e] = await Promise.all([
        gs<{ versions: WfVersion[] }>('GET', `/api/core/workflows/${w.workflow.id}`),
        gs<{ events: any[] }>('GET', `/api/core/workflows/${w.workflow.id}/events`),
      ]);
      return { id: w.workflow.id, name: w.workflow.name.uk, versions: d.versions, events: e.events };
    })));
  }, []);
  useEffect(() => { void load().catch((e) => setNotice({ kind: 'error', text: e.message })); }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try { setNotice({ kind: 'ok', text: await fn() }); await load(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('uk-UA') : '—');

  return (
    <div className="space-y-4" data-gs-versions>
      {notice && <div className={`rounded-xl border px-3 py-2 text-xs ${notice.kind === 'ok' ? 'border-emerald-500/40 text-emerald-200' : 'border-rose-500/40 text-rose-200'}`} data-gs-versions-notice={notice.kind}>{notice.text}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {onto.map((o) => (
          <section key={o.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-gs-onto-versions={o.id}>
            <h3 className="mb-2 text-sm font-bold text-slate-100">{o.title}</h3>
            <ul className="space-y-1.5">
              {o.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <span className="font-mono text-slate-100">v{v.version}</span>
                  <span className={`rounded-full border px-1.5 text-[10px] ${ONTO_STATUS_CLASS[v.status] ?? ENV_CLASS.archived}`}>{v.status}</span>
                  <span className="text-slate-500">{v.label}</span>
                  <span className="text-[10px] text-slate-500">{fmt(v.publishedAt ?? v.createdAt)}</span>
                  {abilities.canPublish && v.publishedAt && v.status !== 'active' && (
                    <button type="button" disabled={busy} className="ml-auto rounded-lg border border-violet-500/50 px-2 py-0.5 text-[10px] text-violet-200 hover:bg-violet-500/10" onClick={() => void act(async () => {
                      const r = await gs<{ version: { version: number } }>('POST', `${o.base}/versions/${v.id}/rollback`);
                      return `Відкат онтології: нова версія v${r.version.version} з визначенням v${v.version}.`;
                    })} data-gs-onto-rollback={v.version}>Відкотитися</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {wfs.map((w) => (
        <section key={w.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3" data-gs-wf-versions={w.id}>
          <h3 className="mb-2 text-sm font-bold text-slate-100">{w.name} <span className="font-mono text-[10px] text-slate-500">{w.id}</span></h3>
          <div className="grid gap-3 lg:grid-cols-2">
            <ul className="space-y-1.5">
              {w.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <span className="font-mono text-slate-100">v{v.version}</span>
                  <span className={`rounded-full border px-1.5 text-[10px] ${ENV_CLASS[v.environment]}`}>{ENV_LABEL[v.environment]}</span>
                  <span className="text-[10px] text-slate-500">{fmt(v.publishedAt ?? v.createdAt)}</span>
                  {v.notes && <span className="text-[10px] text-slate-500">{v.notes}</span>}
                  {abilities.canPublish && v.publishedAt && v.environment === 'archived' && (
                    <button type="button" disabled={busy} className="ml-auto rounded-lg border border-violet-500/50 px-2 py-0.5 text-[10px] text-violet-200 hover:bg-violet-500/10" onClick={() => void act(async () => {
                      const r = await gs<{ version: { version: number } }>('POST', `/api/core/workflows/${w.id}/versions/${v.id}/rollback`);
                      return `Відкат процесу: робоча тепер v${r.version.version} (копія v${v.version}).`;
                    })} data-gs-wf-rollback={`${w.id}:${v.version}`}>Відкотитися</button>
                  )}
                </li>
              ))}
            </ul>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-[11px] text-slate-400" data-gs-wf-events={w.id}>
              {w.events.map((e) => (
                <li key={e.id}><span className="text-slate-200">{e.action}</span> · {e.actor} · {fmt(e.createdAt)}</li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
};

// ── Оцінювання (прогони якості Т2.8) ───────────────────────────────────────

const EvaluationsPanel: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [runs, setRuns] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    gs<{ runs: any[] }>('GET', '/api/admin/quality/living-characters').then((r) => setRuns(r.runs)).catch((e) => setErr(e.message));
  }, [isAdmin]);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-300" data-gs-evaluations>
      <p className="mb-3">Оцінювання якості живих персонажів (Т2.8): контрольний набір допитів із Jev і без Jev. Запуск і звіт — у розділі адмінки «Якість персонажів».</p>
      {!isAdmin && <p className="text-slate-500">Журнал прогонів бачить адміністратор.</p>}
      {err && <p className="text-rose-300">{err}</p>}
      {runs && runs.length === 0 && <p className="text-slate-500">Прогонів ще не було.</p>}
      <ul className="space-y-1">
        {(runs ?? []).slice(0, 20).map((r) => (
          <li key={r.id} className="flex flex-wrap gap-2" data-gs-eval-run={r.id}>
            <span className="font-mono text-slate-100">{r.label || r.id.slice(0, 8)}</span>
            <span className="text-slate-400">{r.status}</span>
            <span className="text-slate-500">{r.createdAt ? new Date(r.createdAt).toLocaleString('uk-UA') : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── Сторінка ──────────────────────────────────────────────────────────────

export const GraphStudioPage: React.FC<Props> = ({ tab, onTabChange, bookTitle, onOpenStoryGraph }) => {
  const [abilities, setAbilities] = useState<GsAbilities | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    gs<GsAbilities>('GET', '/api/core/graph-studio/me').then(setAbilities).catch((e) => setDenied(e.message));
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-3 p-3 md:p-5" data-gs-page={tab}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black tracking-tight text-white">Graph Studio <span className="font-semibold text-slate-400">(Студія графів)</span></h1>
          <p className="text-[11px] text-slate-500">Онтологія, процеси ШІ та їхні версії для всієї платформи. Правка чернетки не змінює робочого (§38).</p>
        </div>
        {abilities && (
          <div className="flex gap-1.5 text-[10px]" data-gs-abilities>
            <span className={`rounded-full border px-2 py-0.5 ${abilities.canEdit ? ENV_CLASS.draft : ENV_CLASS.archived}`}>{abilities.canEdit ? 'правка чернеток' : 'без правки'}</span>
            <span className={`rounded-full border px-2 py-0.5 ${abilities.canPublish ? ENV_CLASS.production : ENV_CLASS.archived}`}>{abilities.canPublish ? 'PUBLISH_SCHEMA' : 'без публікації'}</span>
          </div>
        )}
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-1" data-gs-tabs>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${tab === t.id ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
              data-gs-tab={t.id}
              title={`${t.en} (${t.uk})`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.en.toUpperCase()}</span>
              <span className="hidden font-normal opacity-80 sm:inline">({t.uk})</span>
            </button>
          );
        })}
      </nav>

      {denied ? (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" data-gs-denied>
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {denied}
        </div>
      ) : !abilities ? (
        <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : tab === 'workflows' ? (
        <WorkflowEditor abilities={abilities} />
      ) : tab === 'destinations' ? (
        <DestinationsPanel abilities={abilities} />
      ) : tab === 'ontology' ? (
        <OntologyCanvas abilities={abilities} />
      ) : tab === 'versions' ? (
        <VersionsPanel abilities={abilities} />
      ) : tab === 'evaluations' ? (
        <EvaluationsPanel isAdmin={abilities.role === 'admin'} />
      ) : tab === 'story-graph' ? (
        <div className="space-y-2">
          <StoryGraphPanel />
          {onOpenStoryGraph && (
            <button type="button" onClick={onOpenStoryGraph} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/50 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/10" data-gs-open-story>
              <ExternalLink className="h-3.5 w-3.5" /> Граф відкритої книги в Студії{bookTitle ? ` «${bookTitle}»` : ''}
            </button>
          )}
        </div>
      ) : (
        <RunsPanel abilities={abilities} />
      )}
    </div>
  );
};

export default GraphStudioPage;
