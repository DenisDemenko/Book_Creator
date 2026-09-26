/**
 * Прив'язки зображення до книги (Т2.3 В2, PLAN_VISUAL_LIBRARY.md) — у вікні
 * перегляду файлу в Медіатеці: до кого чи до чого належить зображення
 * (портрет героя, повний зріст, референс, «зображено», локація, предмет,
 * сцена), з позначкою джерела: «з книги» (перенесено синхронізацією ядра),
 * «автор», «ШІ». Прив'язати й відв'язати може той, хто редагує книгу.
 *
 * Дані — ядро книги: `GET/POST /api/projects/:id/visual/links`,
 * `DELETE …/visual/links/:linkId`, вибирач — `GET …/visual/targets`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Plus, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export const ASSET_ROLE_KEYS = ['portrait', 'full_body', 'reference', 'depicts', 'location', 'object', 'scene'] as const;
export type AssetRoleKey = (typeof ASSET_ROLE_KEYS)[number];
export const ROLE_LABEL_KEY: Record<AssetRoleKey, string> = {
  portrait: 'visualLibrary.rolePortrait',
  full_body: 'visualLibrary.roleFullBody',
  reference: 'visualLibrary.roleReference',
  depicts: 'visualLibrary.roleDepicts',
  location: 'visualLibrary.roleLocation',
  object: 'visualLibrary.roleObject',
  scene: 'visualLibrary.roleScene',
};

export interface VisualLink {
  id: string;
  assetUrl: string;
  entityId: string | null;
  sectionId: string | null;
  role: AssetRoleKey;
  status: string;
  source: 'author' | 'ai' | 'legacy';
  targetName: string;
  targetType: string;
  /** Т2.3 В3: версія зовнішності героя, чий це портрет. */
  appearanceVersionId?: string | null;
  versionLabel?: string | null;
}

const VERSIONED: readonly AssetRoleKey[] = ['portrait', 'full_body', 'reference'];

interface Targets {
  entities: { id: string; type: string; name: string }[];
  sections: { id: string; title: string; chapterNumber: number }[];
  roleTypes: Record<string, string[] | null>;
}

interface Props {
  bookId: string;
  assetUrl: string;
  onChanged?: () => void;
  onToast: (msg: string) => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

export const MediaLinksPanel: React.FC<Props> = ({ bookId, assetUrl, onChanged, onToast }) => {
  const { t } = useLanguage();
  const base = `/api/projects/${encodeURIComponent(bookId)}/visual`;
  const [state, setState] = useState<'loading' | 'ok' | 'off' | 'nosync' | 'noaccess'>('loading');
  const [links, setLinks] = useState<VisualLink[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<AssetRoleKey>('portrait');
  const [target, setTarget] = useState('');
  const [versions, setVersions] = useState<{ id: string; label: string }[]>([]);
  const [versionId, setVersionId] = useState('');
  const [busy, setBusy] = useState(false);
  const embedded = /^data:/i.test(assetUrl);

  const load = useCallback(async () => {
    if (embedded) return;
    setState('loading');
    const res = await api(`${base}/links?assetUrl=${encodeURIComponent(assetUrl)}`).catch(() => null);
    if (!res) return setState('off');
    if (res.status === 401 || res.status === 403) return setState('noaccess');
    if (!res.ok) return setState('off');
    const body = await res.json();
    if (!body.synced) return setState('nosync');
    setLinks(body.links ?? []);
    setCanEdit(!!body.canEdit);
    setState('ok');
  }, [base, assetUrl, embedded]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = async () => {
    setAdding(true);
    if (!targets) {
      const res = await api(`${base}/targets`).catch(() => null);
      if (res?.ok) setTargets(await res.json());
    }
  };

  const options = (() => {
    if (!targets) return [];
    if (role === 'scene') return targets.sections.map((s) => ({ id: s.id, label: `${s.chapterNumber}. ${s.title}` }));
    const types = targets.roleTypes[role];
    return targets.entities.filter((e) => !types || types.includes(e.type)).map((e) => ({ id: e.id, label: types ? e.name : `${e.name} · ${e.type}` }));
  })();

  // Версії зовнішності обраного героя (Т2.3 В3) — для портрета, повного зросту, референсу.
  const targetIsHero = !!targets?.entities.find((e) => e.id === target && e.type === 'character');
  useEffect(() => {
    setVersionId('');
    setVersions([]);
    if (!targetIsHero || !VERSIONED.includes(role)) return;
    let cancelled = false;
    api(`${base}/appearance/${encodeURIComponent(target)}`)
      .then(async (r) => (r.ok ? await r.json() : null))
      .catch(() => null)
      .then((d) => {
        if (!cancelled && d?.versions) setVersions(d.versions.map((v: { id: string; label: string }) => ({ id: v.id, label: v.label })));
      });
    return () => {
      cancelled = true;
    };
  }, [base, target, targetIsHero, role]);

  const save = async () => {
    if (!target) return;
    setBusy(true);
    const res = await api(`${base}/links`, {
      method: 'POST',
      body: JSON.stringify(role === 'scene' ? { assetUrl, role, sectionId: target } : { assetUrl, role, entityId: target, appearanceVersionId: versionId || null }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      onToast(t('visualLibrary.linkFailed', { reason: body.error || res?.status || '—' }));
      return;
    }
    onToast(t('visualLibrary.linkDone', { role: t(ROLE_LABEL_KEY[role]), name: body.link?.targetName ?? '' }));
    setAdding(false);
    setTarget('');
    await load();
    onChanged?.();
  };

  const remove = async (l: VisualLink) => {
    setBusy(true);
    const res = await api(`${base}/links/${l.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      onToast(t('visualLibrary.linkFailed', { reason: res?.status ?? '—' }));
      return;
    }
    onToast(t('visualLibrary.linkRemoved'));
    await load();
    onChanged?.();
  };

  const sourceLabel = (s: VisualLink['source']) => (s === 'legacy' ? t('visualLibrary.sourceLegacy') : s === 'ai' ? t('visualLibrary.sourceAi') : t('visualLibrary.sourceAuthor'));
  const selectCls = 'min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-hidden';

  return (
    <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3" data-media-links>
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-sky-300" />
        <h4 className="text-xs font-bold text-slate-100">{t('visualLibrary.linksTitle')}</h4>
        <span className="text-[10px] text-slate-500">{t('visualLibrary.linksHint')}</span>
      </div>
      {embedded ? (
        <p className="text-[11px] text-slate-500" data-media-links-state="embedded">{t('visualLibrary.linksDataUrl')}</p>
      ) : state === 'loading' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
      ) : state !== 'ok' ? (
        <p className="text-[11px] text-slate-500" data-media-links-state={state}>
          {state === 'nosync' ? t('visualLibrary.linksNotSynced') : state === 'noaccess' ? t('visualLibrary.linksNoAccess') : t('visualLibrary.linksCoreOff')}
        </p>
      ) : (
        <>
          {links.length ? (
            <div className="flex flex-wrap gap-1.5">
              {links.map((l) => (
                <span key={l.id} className="flex max-w-full items-center gap-1 rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-200" data-media-link={`${l.role}:${l.targetName}`}>
                  <span className="text-slate-400">{t(ROLE_LABEL_KEY[l.role])}</span>
                  <span className="min-w-0 truncate font-bold">{l.targetName || '—'}</span>
                  {l.versionLabel && <span className="min-w-0 truncate text-sky-300" data-media-link-version={l.versionLabel}>· {l.versionLabel}</span>}
                  <span className="text-[10px] text-slate-500">· {sourceLabel(l.source)}</span>
                  {canEdit && (
                    <button type="button" disabled={busy} onClick={() => void remove(l)} title={t('visualLibrary.linkRemove')} aria-label={t('visualLibrary.linkRemove')} className="text-slate-500 hover:text-rose-300" data-media-link-remove={l.id}>
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">{t('visualLibrary.linksEmpty')}</p>
          )}
          {canEdit && !adding && (
            <button type="button" onClick={() => void openAdd()} data-media-link-add className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:border-sky-500">
              <Plus className="h-3 w-3" /> {t('visualLibrary.linkAdd')}
            </button>
          )}
          {canEdit && adding && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[auto_1fr_auto]">
              <select className={selectCls} value={role} aria-label={t('visualLibrary.linkRole')} data-media-link-role onChange={(e) => { setRole(e.target.value as AssetRoleKey); setTarget(''); }}>
                {ASSET_ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>
                ))}
              </select>
              <select className={selectCls} value={target} aria-label={t('visualLibrary.linkTarget')} data-media-link-target onChange={(e) => setTarget(e.target.value)}>
                <option value="">{targets ? t('visualLibrary.linkTargetPick') : '…'}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              {versions.length > 0 && (
                <select className={`${selectCls} sm:col-span-3`} value={versionId} aria-label={t('visualLibrary.linkVersion')} data-media-link-version-pick onChange={(e) => setVersionId(e.target.value)}>
                  <option value="">{t('visualLibrary.linkVersion')}: {t('visualLibrary.linkVersionNone')}</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={!target || busy} onClick={() => void save()} data-media-link-save className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40">
                  {t('visualLibrary.linkSave')}
                </button>
                <button type="button" onClick={() => setAdding(false)} className="text-slate-500 hover:text-slate-200" aria-label="✕"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MediaLinksPanel;
