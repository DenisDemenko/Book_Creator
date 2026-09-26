/**
 * Паспорт зображення (Т2.3 В1, PLAN_VISUAL_LIBRARY.md) — у вікні перегляду
 * файлу в Медіатеці: назва, опис для читача, джерело, автор, ліцензія,
 * статус; версії файлу («замінити новою версією» — стара лишається) та
 * історія: хто, коли й що зробив.
 *
 * Дані — `GET /api/media/:id/passport`, зміни — `PATCH /api/media/:id`, нова
 * версія — `POST /api/media/upload` з `parentId`. Після нової версії
 * Медіатека переводить посилання в книзі на неї (`onNewVersion`).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, History, Layers, Loader2, Save, ShieldCheck, Upload } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  MEDIA_LICENSE_KEYS,
  MEDIA_LICENSE_LABELS,
  MEDIA_SOURCE_KEYS,
  MEDIA_SOURCE_LABELS,
  MEDIA_STATUS_KEYS,
  MEDIA_STATUS_LABELS,
  passportWarnings,
} from '../utils/mediaPassport';
import { formatMediaDate } from '../utils/mediaSort';

export interface PassportAsset {
  id: string;
  url: string;
  bookId: string | null;
  kind: string;
  filename: string;
  sizeBytes: number;
  prompt?: string | null;
  model?: string | null;
  createdAt?: string;
  title?: string;
  altText?: string;
  source?: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
  status?: string;
  parentId?: string | null;
  rootId?: string;
  version?: number;
  updatedAt?: string;
}

interface HistoryEntry {
  id: number;
  assetId: string;
  at: string;
  actor: string;
  action: 'created' | 'version' | 'passport' | 'deleted';
  details: Record<string, any>;
}

interface Props {
  assetId: string;
  bookId: string;
  /** Паспорт змінено — Медіатека оновлює картку. */
  onChanged: (asset: PassportAsset) => void;
  /** Завантажено нову версію; повертає кількість замін посилань у книзі. */
  onNewVersion: (previous: PassportAsset, next: PassportAsset) => number;
  onToast: (msg: string) => void;
}

type Form = { title: string; altText: string; source: string; author: string; license: string; licenseUrl: string; status: string };
const toForm = (a: PassportAsset): Form => ({
  title: a.title || '',
  altText: a.altText || '',
  source: a.source || 'upload',
  author: a.author || '',
  license: a.license || 'unknown',
  licenseUrl: a.licenseUrl || '',
  status: a.status || 'final',
});

const KB = 1024;
const size = (b: number) => (b >= KB * KB ? `${(b / (KB * KB)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / KB))} KB`);

export const MediaPassportPanel: React.FC<Props> = ({ assetId, bookId, onChanged, onNewVersion, onToast }) => {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<{ asset: PassportAsset; versions: PassportAsset[]; history: HistoryEntry[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/passport`, { credentials: 'same-origin' });
      if (!res.ok) {
        setState('missing');
        return;
      }
      const body = await res.json();
      setData(body);
      setForm(toForm(body.asset));
      setState('ok');
    } catch {
      setState('missing');
    }
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400" data-media-passport="loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('mediaPassport.loading')}
      </div>
    );
  }
  if (state === 'missing' || !data || !form) {
    return <p className="text-[11px] text-slate-500" data-media-passport="missing">{t('mediaPassport.notStored')}</p>;
  }

  const { asset, versions, history } = data;
  const latest = versions[versions.length - 1] ?? asset;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(asset));
  const warnings = passportWarnings(form);
  const label = <T extends string>(map: Record<T, { uk: string; en: string }>, k: string) => map[k as T]?.[lang] ?? k;
  const inputCls = 'w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-hidden';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(asset.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t('mediaPassport.error', { reason: body.error || res.status }));
        return;
      }
      onChanged(body.asset);
      onToast(t('mediaPassport.saved'));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const uploadVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(String(ev.target?.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name, bookId: latest.bookId ?? bookId, kind: latest.kind, parentId: latest.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.asset) {
        setError(t('mediaPassport.error', { reason: body.error || res.status }));
        return;
      }
      const count = onNewVersion(latest, body.asset);
      onToast(t('mediaPassport.versionDone', { n: body.asset.version, count }));
      await load();
    } catch (err) {
      setError(t('mediaPassport.error', { reason: (err as Error).message }));
    } finally {
      setUploading(false);
    }
  };

  const action = (h: HistoryEntry) =>
    h.action === 'created' ? t('mediaPassport.actionCreated') : h.action === 'version' ? t('mediaPassport.actionVersion') : h.action === 'passport' ? t('mediaPassport.actionPassport') : t('mediaPassport.actionDeleted');
  const detail = (h: HistoryEntry) => {
    if (h.action === 'version') return `v${h.details.version} · ${h.details.filename ?? ''}`;
    if (h.action === 'passport') return Object.keys(h.details.changes ?? {}).join(', ');
    if (h.action === 'created') return [h.details.source, h.details.model].filter(Boolean).join(' · ');
    return h.details.version ? `v${h.details.version}` : '';
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3" data-media-passport={asset.id}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <h4 className="text-xs font-bold text-slate-100">{t('mediaPassport.title')}</h4>
        <span className="text-[10px] text-slate-500">
          {t('mediaPassport.fileLine', { name: asset.filename, size: size(asset.sizeBytes), date: formatMediaDate(asset.createdAt) || '—' })}
        </span>
        {asset.model && <span className="text-[10px] text-slate-500">{t('mediaPassport.modelLine', { model: asset.model })}</span>}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{t('mediaPassport.fieldTitle')}</span>
          <input className={inputCls} value={form.title} maxLength={200} placeholder={t('mediaPassport.fieldTitlePlaceholder')} data-passport-title onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{t('mediaPassport.fieldAuthor')}</span>
          <input className={inputCls} value={form.author} maxLength={200} placeholder={t('mediaPassport.fieldAuthorPlaceholder')} data-passport-author onChange={(e) => setForm({ ...form, author: e.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] text-slate-400 sm:col-span-2">
          <span>{t('mediaPassport.fieldAlt')}</span>
          <textarea className={`${inputCls} min-h-[48px]`} value={form.altText} maxLength={1000} placeholder={t('mediaPassport.fieldAltPlaceholder')} data-passport-alt onChange={(e) => setForm({ ...form, altText: e.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{t('mediaPassport.fieldSource')}</span>
          <select className={inputCls} value={form.source} data-passport-source onChange={(e) => setForm({ ...form, source: e.target.value })}>
            {MEDIA_SOURCE_KEYS.map((k) => (
              <option key={k} value={k}>{label(MEDIA_SOURCE_LABELS, k)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{t('mediaPassport.fieldStatus')}</span>
          <select className={inputCls} value={form.status} data-passport-status onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {MEDIA_STATUS_KEYS.map((k) => (
              <option key={k} value={k}>{label(MEDIA_STATUS_LABELS, k)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{t('mediaPassport.fieldLicense')}</span>
          <select className={inputCls} value={form.license} data-passport-license onChange={(e) => setForm({ ...form, license: e.target.value })}>
            {MEDIA_LICENSE_KEYS.map((k) => (
              <option key={k} value={k}>{label(MEDIA_LICENSE_LABELS, k)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{t('mediaPassport.fieldLicenseUrl')}</span>
          <input className={inputCls} value={form.licenseUrl} maxLength={500} placeholder="https://…" data-passport-license-url onChange={(e) => setForm({ ...form, licenseUrl: e.target.value })} />
        </label>
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1" data-passport-warnings>
          {warnings.includes('license') && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-200"><AlertTriangle className="h-3 w-3" /> {t('mediaPassport.warnLicense')}</p>
          )}
          {warnings.includes('author') && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-200"><AlertTriangle className="h-3 w-3" /> {t('mediaPassport.warnAuthor')}</p>
          )}
        </div>
      )}
      {error && <p className="text-[11px] text-rose-300" data-passport-error>{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} data-passport-save className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-40">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {saving ? t('mediaPassport.saving') : t('mediaPassport.save')}
        </button>
        <input ref={fileRef} type="file" accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml" className="hidden" onChange={uploadVersion} data-passport-version-input />
        <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} data-passport-new-version className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-500 disabled:opacity-50">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploading ? t('mediaPassport.uploading') : t('mediaPassport.newVersion')}
        </button>
      </div>
      <p className="text-[10px] text-slate-500">{t('mediaPassport.newVersionHint')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5" data-passport-versions>
          <h5 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><Layers className="h-3 w-3" /> {t('mediaPassport.versions', { n: versions.length })}</h5>
          <ul className="space-y-1">
            {[...versions].reverse().map((v) => (
              <li key={v.id} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-[11px] ${v.id === asset.id ? 'border-cyan-500/50' : 'border-slate-800'}`} data-passport-version={v.version}>
                <img src={v.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" referrerPolicy="no-referrer" />
                <span className="font-mono text-slate-200">v{v.version}</span>
                <span className="min-w-0 flex-1 truncate text-slate-400">{v.filename}</span>
                <span className="shrink-0 text-[10px] text-slate-500">{formatMediaDate(v.createdAt)}</span>
                {v.id === latest.id && <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-300">{t('mediaPassport.versionCurrent')}</span>}
                {v.id === asset.id && v.id !== latest.id && <span className="shrink-0 rounded bg-slate-700 px-1 text-[10px] text-slate-200">{t('mediaPassport.versionViewing')}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 space-y-1.5" data-passport-history>
          <h5 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><History className="h-3 w-3" /> {t('mediaPassport.history')}</h5>
          {history.length ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {history.map((h) => (
                <li key={h.id} className="text-[11px] text-slate-300" data-passport-history-item={h.action}>
                  <span className="text-slate-500">{formatMediaDate(h.at)}</span> · {action(h)}
                  {detail(h) && <span className="text-slate-500"> · {detail(h)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-500">{t('mediaPassport.historyEmpty')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaPassportPanel;
