/**
 * Версії зовнішності героя за віком чи етапом (Т2.3 В3, PLAN_VISUAL_LIBRARY.md)
 * — у профілі героя: стрічка «Картка героя» (канон автора) → «Олена, 8 років ·
 * гл. 1–2» → «30 років · з гл. 3», у кожної версії свій портрет із Медіатеки
 * і затверджений опис. У режимі «стан на главі N» пізніші версії приховано,
 * діюча позначена — її портрет і показує профіль.
 *
 * Дані — ядро книги: `GET/POST /api/projects/:id/visual/appearance/:entityId`,
 * `PATCH/DELETE …/versions/:versionId`, `PUT …/versions/:versionId/portrait`.
 * Змінювати може той, хто редагує книгу; решта — лише бачить.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, History, ImagePlus, Loader2, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { PickFromMediaLibraryModal } from './PickFromMediaLibraryModal';

interface VersionView {
  id: string;
  label: string;
  age: string;
  fromChapter: number | null;
  toChapter: number | null;
  description: string;
  approved: boolean;
  portraitUrl: string | null;
  overlapsWith: string[];
  active: boolean;
}

interface Overview {
  base: { description: string; portraitUrl: string | null; portraitSource: 'link' | 'card' | null };
  versions: VersionView[];
  activeId: string | null;
  upto: number | null;
  history: { versionId: string; action: string; label: string; actor: string; at: string }[];
  chapters: { number: number; title: string }[];
  canEdit: boolean;
}

interface Draft {
  label: string;
  age: string;
  fromChapter: string;
  toChapter: string;
  description: string;
  approved: boolean;
}

interface Props {
  bookId: string;
  entityId: string;
  /** «Стан на главі N» профілю; null — уся книга. */
  upto: number | null;
  /** Після змін — щоб профіль підтягнув новий портрет. */
  onChanged?: () => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

const HIST_KEY: Record<string, string> = {
  created: 'visualLibrary.avHistCreated',
  updated: 'visualLibrary.avHistUpdated',
  deleted: 'visualLibrary.avHistDeleted',
  portrait: 'visualLibrary.avHistPortrait',
  portrait_removed: 'visualLibrary.avHistPortraitRemoved',
};

export const AppearanceVersionsPanel: React.FC<Props> = ({ bookId, entityId, upto, onChanged }) => {
  const { t } = useLanguage();
  const base = `/api/projects/${encodeURIComponent(bookId)}/visual/appearance/${encodeURIComponent(entityId)}`;
  const [data, setData] = useState<Overview | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    const res = await api(`${base}${upto ? `?chapter=${upto}` : ''}`).catch(() => null);
    const body = res && res.ok ? ((await res.json().catch(() => null)) as Overview | null) : null;
    if (my === seq.current) setData(body);
  }, [base, upto]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;

  const chaptersText = (v: Pick<VersionView, 'fromChapter' | 'toChapter'>) =>
    v.fromChapter && v.toChapter
      ? t('visualLibrary.avChapters', { from: v.fromChapter, to: v.toChapter })
      : v.fromChapter
        ? t('visualLibrary.avChaptersFrom', { from: v.fromChapter })
        : v.toChapter
          ? t('visualLibrary.avChaptersTo', { to: v.toChapter })
          : t('visualLibrary.avChaptersAll');
  const nameOf = (id: string) => data.versions.find((v) => v.id === id)?.label ?? '…';

  const startNew = () => {
    setEditing('new');
    setConfirmDelete(null);
    setDraft({ label: '', age: '', fromChapter: upto ? String(upto) : '', toChapter: '', description: data.base.description, approved: true });
  };
  const startEdit = (v: VersionView) => {
    setEditing(v.id);
    setConfirmDelete(null);
    setDraft({ label: v.label, age: v.age, fromChapter: v.fromChapter ? String(v.fromChapter) : '', toChapter: v.toChapter ? String(v.toChapter) : '', description: v.description, approved: v.approved });
  };

  const done = async (msg: string) => {
    setNote(msg);
    await load();
    onChanged?.();
  };
  const failed = async (res: Response | null) => {
    const body = res ? await res.json().catch(() => ({})) : {};
    setNote(t('visualLibrary.avFailed', { reason: (body as any).error || res?.status || '—' }));
  };

  const save = async () => {
    if (!draft || !editing) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      label: draft.label,
      age: draft.age,
      fromChapter: draft.fromChapter ? Number(draft.fromChapter) : null,
      toChapter: draft.toChapter ? Number(draft.toChapter) : null,
      approved: draft.approved,
    };
    // Нова версія з порожнім описом — сервер візьме опис із картки героя.
    if (editing !== 'new' || draft.description.trim()) payload.description = draft.description;
    const res = await api(editing === 'new' ? base : `${base}/versions/${editing}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(payload) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return failed(res);
    setEditing(null);
    setDraft(null);
    await done(t('visualLibrary.avSaved'));
  };

  const remove = async (v: VersionView) => {
    setBusy(true);
    const res = await api(`${base}/versions/${v.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirmDelete(null);
    if (!res?.ok) return failed(res);
    await done(t('visualLibrary.avDeleted'));
  };

  const setPortrait = async (versionId: string, assetUrl: string | null) => {
    setBusy(true);
    const res = await api(`${base}/versions/${versionId}/portrait`, { method: 'PUT', body: JSON.stringify({ assetUrl }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return failed(res);
    await done(t('visualLibrary.avSaved'));
  };

  const field = 'w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-hidden';
  const chapterOptions = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {data.chapters.map((c) => (
        <option key={c.number} value={c.number}>
          {c.number}. {c.title}
        </option>
      ))}
    </>
  );

  const form = draft && (
    <div className="space-y-2 rounded-xl border border-sky-500/30 bg-slate-950/40 p-3" data-av-form={editing ?? ''}>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
        <label className="min-w-0 text-[10px] uppercase text-slate-500">
          {t('visualLibrary.avLabel')}
          <input className={field} value={draft.label} maxLength={120} placeholder={t('visualLibrary.avLabelPh')} data-av-label onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </label>
        <label className="min-w-0 text-[10px] uppercase text-slate-500">
          {t('visualLibrary.avAge')}
          <input className={field} value={draft.age} maxLength={40} data-av-age onChange={(e) => setDraft({ ...draft, age: e.target.value })} />
        </label>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <label className="min-w-0 text-[10px] uppercase text-slate-500">
          {t('visualLibrary.avFrom')}
          <select className={field} value={draft.fromChapter} data-av-from onChange={(e) => setDraft({ ...draft, fromChapter: e.target.value })}>
            {chapterOptions(t('visualLibrary.avStart'))}
          </select>
        </label>
        <label className="min-w-0 text-[10px] uppercase text-slate-500">
          {t('visualLibrary.avTo')}
          <select className={field} value={draft.toChapter} data-av-to onChange={(e) => setDraft({ ...draft, toChapter: e.target.value })}>
            {chapterOptions(t('visualLibrary.avEnd'))}
          </select>
        </label>
      </div>
      <label className="block min-w-0 text-[10px] uppercase text-slate-500">
        {t('visualLibrary.avDescription')}
        <textarea className={`${field} min-h-[72px] normal-case`} value={draft.description} maxLength={4000} placeholder={t('visualLibrary.avDescriptionPh')} data-av-description onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
        <input type="checkbox" checked={draft.approved} data-av-approved onChange={(e) => setDraft({ ...draft, approved: e.target.checked })} />
        {t('visualLibrary.avApproved')}
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy || !draft.label.trim()} onClick={() => void save()} data-av-save className="flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t('visualLibrary.avSave')}
        </button>
        <button type="button" onClick={() => { setEditing(null); setDraft(null); }} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500">
          {t('visualLibrary.avCancel')}
        </button>
      </div>
    </div>
  );

  const Portrait = ({ url }: { url: string | null }) =>
    url ? (
      <img src={url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" />
    ) : (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800" title={t('visualLibrary.avNoPortrait')}>
        <UserRound className="h-6 w-6 text-slate-500" />
      </div>
    );

  return (
    <section className="min-w-0 space-y-2.5 rounded-2xl border border-slate-800 bg-slate-900/50 p-4" data-appearance-versions={data.versions.length} data-av-active={data.activeId ?? ''}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">{t('visualLibrary.avTitle')}</h3>
        {data.canEdit && editing !== 'new' && (
          <button type="button" onClick={startNew} data-av-add className="ml-auto flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:border-sky-500">
            <Plus className="h-3 w-3" /> {t('visualLibrary.avAdd')}
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500">{t('visualLibrary.avHint')}</p>
      {note && <p className="text-[11px] text-amber-300" data-av-note>{note}</p>}
      {editing === 'new' && form}

      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex min-w-0 gap-2.5 rounded-xl border border-slate-800 bg-slate-950/30 p-2.5" data-av-base>
          <Portrait url={data.base.portraitUrl} />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-slate-100">{t('visualLibrary.avBase')}</p>
            <p className="text-[10px] text-slate-500">{data.upto ? t('visualLibrary.avBaseHidden') : t('visualLibrary.avBaseHint')}</p>
            {data.base.description && <p className="mt-1 break-words text-[11px] text-slate-300">{data.base.description}</p>}
          </div>
        </div>

        {data.versions.map((v) =>
          editing === v.id ? (
            <div key={v.id} className="md:col-span-2 xl:col-span-3">{form}</div>
          ) : (
            <div
              key={v.id}
              className={`flex min-w-0 gap-2.5 rounded-xl border p-2.5 ${v.active ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/30'} ${v.approved ? '' : 'opacity-70'}`}
              data-av-version={v.label}
              data-av-version-active={v.active ? '1' : '0'}
            >
              <Portrait url={v.portraitUrl} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words text-[12px] font-bold text-slate-100">{v.label}</p>
                <div className="flex flex-wrap gap-1 text-[10px]">
                  {v.age && <span className="rounded bg-slate-800 px-1.5 text-slate-300">{v.age}</span>}
                  <span className="rounded bg-slate-800 px-1.5 text-slate-300" data-av-chapters>{chaptersText(v)}</span>
                  {v.active && upto && <span className="rounded bg-emerald-500/20 px-1.5 text-emerald-200">{t('visualLibrary.avActive', { n: upto })}</span>}
                  {!v.approved && <span className="rounded bg-amber-500/20 px-1.5 text-amber-200">{t('visualLibrary.avDraft')}</span>}
                </div>
                {v.overlapsWith.length > 0 && (
                  <p className="flex items-start gap-1 text-[10px] text-amber-300" data-av-overlap>
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {t('visualLibrary.avOverlap', { names: v.overlapsWith.map(nameOf).join(', ') })}
                  </p>
                )}
                {v.description && <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-slate-300">{v.description}</p>}
                {data.canEdit && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    <button type="button" disabled={busy} onClick={() => setPickFor(v.id)} data-av-portrait={v.id} title={t('visualLibrary.avPortraitPick')} className="flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 hover:border-sky-500">
                      <ImagePlus className="h-3 w-3" /> {t('visualLibrary.avPortrait')}
                    </button>
                    {v.portraitUrl && (
                      <button type="button" disabled={busy} onClick={() => void setPortrait(v.id, null)} title={t('visualLibrary.avPortraitRemove')} aria-label={t('visualLibrary.avPortraitRemove')} data-av-portrait-remove={v.id} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-400 hover:text-rose-300">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => startEdit(v)} data-av-edit={v.id} className="flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 hover:border-sky-500">
                      <Pencil className="h-3 w-3" /> {t('visualLibrary.avEdit')}
                    </button>
                    {confirmDelete === v.id ? (
                      <span className="flex w-full flex-wrap items-center gap-1 text-[10px] text-rose-200" data-av-delete-confirm>
                        {t('visualLibrary.avDeleteConfirm', { label: v.label })}
                        <button type="button" disabled={busy} onClick={() => void remove(v)} data-av-delete-yes className="rounded bg-rose-600 px-2 py-0.5 font-bold text-white hover:bg-rose-500">{t('visualLibrary.avDelete')}</button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className="rounded border border-slate-700 px-2 py-0.5 text-slate-300">{t('visualLibrary.avCancel')}</button>
                      </span>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => setConfirmDelete(v.id)} data-av-delete={v.id} className="flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-rose-400 hover:text-rose-300">
                        <Trash2 className="h-3 w-3" /> {t('visualLibrary.avDelete')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
      </div>
      {!data.versions.length && editing !== 'new' && <p className="text-[11px] text-slate-500" data-av-empty>{t('visualLibrary.avEmpty')}</p>}

      {data.history.length > 0 && (
        <details className="text-[11px] text-slate-400" data-av-history>
          <summary className="flex cursor-pointer items-center gap-1 text-slate-500 hover:text-slate-300">
            <History className="h-3 w-3" /> {t('visualLibrary.avHistory')} ({data.history.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {data.history.map((h, i) => (
              <li key={`${h.versionId}-${h.at}-${i}`} className="break-words">
                <span className="text-slate-500">{new Date(h.at).toLocaleString()}</span> · {h.label || '—'} · {HIST_KEY[h.action] ? t(HIST_KEY[h.action]) : h.action}
              </li>
            ))}
          </ul>
        </details>
      )}

      {pickFor && (
        <PickFromMediaLibraryModal
          title={t('visualLibrary.avPortraitPick')}
          onClose={() => setPickFor(null)}
          onPick={(url) => {
            const id = pickFor;
            setPickFor(null);
            void setPortrait(id, url);
          }}
        />
      )}
    </section>
  );
};

export default AppearanceVersionsPanel;
