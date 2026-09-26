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
import { Link2, Loader2, Plus, ScanEye, X } from 'lucide-react';
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
  /** Т2.3 В5: опис змінився після звірки — «перевірити». */
  needsReview?: boolean;
}

const VERSIONED: readonly AssetRoleKey[] = ['portrait', 'full_body', 'reference'];

/** Висновок AI-3 про зображення (Т2.3 В4). */
interface AiItem {
  id: string;
  kind: string;
  entityName: string;
  field: string;
  summary: string;
  insufficientData: boolean;
}
interface Analysis {
  recognize: AiItem[];
  compare: Record<string, { verdict: 'match' | 'mismatch' | 'insufficient'; at: string; items: AiItem[] }>;
  available: boolean;
}

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
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  /** Що зараз робить AI-3: `recognize` або id зв'язку, який звіряється. */
  const [aiBusy, setAiBusy] = useState<string | null>(null);
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
    const a = await api(`${base}/analysis?assetUrl=${encodeURIComponent(assetUrl)}`).catch(() => null);
    setAnalysis(a?.ok ? ((await a.json()) as Analysis) : null);
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

  const markChecked = async (l: VisualLink) => {
    setBusy(true);
    const res = await api(`${base}/links/${l.id}/checked`, { method: 'POST', body: '{}' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      onToast(t('visualLibrary.linkFailed', { reason: res?.status ?? '—' }));
      return;
    }
    onToast(t('visualLibrary.reviewDoneToast'));
    await load();
    onChanged?.();
  };

  // ── AI-3 (Т2.3 В4): лише за командою, фоновою задачею ──
  const runAi = async (key: string, url: string, body: object) => {
    setAiBusy(key);
    const res = await api(url, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    const started = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok || !started.jobId) {
      setAiBusy(null);
      onToast(res?.status === 400 ? t('visualLibrary.aiNoImage') : t('visualLibrary.aiFailed', { reason: started.error || res?.status || '—' }));
      return null;
    }
    const jobUrl = `/api/projects/${encodeURIComponent(bookId)}/jobs/${started.jobId}`;
    let job: any = null;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await api(jobUrl).catch(() => null);
      job = r?.ok ? await r.json() : null;
      if (job && ['succeeded', 'failed', 'cancelled'].includes(job.status)) break;
    }
    setAiBusy(null);
    if (!job || job.status !== 'succeeded') {
      onToast(t('visualLibrary.aiFailed', { reason: job?.error || job?.status || '—' }));
      return null;
    }
    await load();
    onChanged?.();
    return job.result as Record<string, any>;
  };
  const recognize = async () => {
    const r = await runAi('recognize', `${base}/recognize`, { assetUrl });
    if (!r) return;
    if (r.status === 'no_image') onToast(t('visualLibrary.aiNoImage'));
    else onToast(t('visualLibrary.aiDoneRecognize', { links: r.suggestedLinks ?? 0, traits: r.traits ?? 0, mismatches: r.mismatches ?? 0 }));
  };
  const compare = async (l: VisualLink) => {
    const r = await runAi(l.id, `${base}/links/${l.id}/compare`, {});
    if (!r) return;
    if (r.status === 'no_description') onToast(t('visualLibrary.aiNoDescription'));
    else if (r.status === 'no_image') onToast(t('visualLibrary.aiNoImage'));
    else onToast(r.verdict === 'match' ? t('visualLibrary.aiVerdictMatch') : r.verdict === 'mismatch' ? t('visualLibrary.aiVerdictMismatch') : t('visualLibrary.aiVerdictInsufficient'));
  };
  const decide = async (l: VisualLink, status: 'confirmed' | 'rejected') => {
    setBusy(true);
    const res = await api(`${base}/links/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      onToast(t('visualLibrary.linkFailed', { reason: res?.status ?? '—' }));
      return;
    }
    onToast(status === 'confirmed' ? t('visualLibrary.linkDone', { role: t(ROLE_LABEL_KEY[l.role]), name: l.targetName }) : t('visualLibrary.linkRemoved'));
    await load();
    onChanged?.();
  };
  const FIELDS = ['hair', 'eyes', 'build', 'face', 'clothing', 'marks', 'height', 'other'];
  const fieldLabel = (f: string) => (FIELDS.includes(f) ? t(`visualLibrary.aiField_${f}`) : f);
  const verdictLabel = (v: string) => (v === 'match' ? t('visualLibrary.aiVerdictMatch') : v === 'mismatch' ? t('visualLibrary.aiVerdictMismatch') : t('visualLibrary.aiVerdictInsufficient'));
  const verdictCls = (v: string) => (v === 'match' ? 'text-emerald-300' : v === 'mismatch' ? 'text-rose-300' : 'text-slate-400');

  const sourceLabel = (s: VisualLink['source']) => (s === 'legacy' ? t('visualLibrary.sourceLegacy') : s === 'ai' ? t('visualLibrary.sourceAi') : t('visualLibrary.sourceAuthor'));
  const selectCls = 'min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-hidden';

  return (
    <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3" data-media-links>
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-sky-300" />
        <h4 className="text-xs font-bold text-slate-100">{t('visualLibrary.linksTitle')}</h4>
        <span className="text-[10px] text-slate-500">{t('visualLibrary.linksHint')}</span>
        {state === 'ok' && canEdit && !embedded && analysis?.available && (
          <button
            type="button"
            disabled={!!aiBusy}
            onClick={() => void recognize()}
            title={t('visualLibrary.aiRecognizeHint')}
            data-media-ai-recognize
            className="ml-auto flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-bold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
          >
            {aiBusy === 'recognize' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanEye className="h-3 w-3" />}
            {aiBusy === 'recognize' ? t('visualLibrary.aiRunning') : t('visualLibrary.aiRecognize')}
          </button>
        )}
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
                <div key={l.id} className="flex max-w-full flex-col gap-0.5">
                <span
                  className={`flex max-w-full flex-wrap items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-slate-200 ${l.status === 'suggested' ? 'border-dashed border-violet-500/60 bg-violet-500/10' : 'border-slate-700 bg-slate-950'}`}
                  data-media-link={`${l.role}:${l.targetName}`}
                  data-media-link-status={l.status}
                >
                  {l.status === 'suggested' && <span className="text-[10px] font-bold text-violet-200">{t('visualLibrary.aiSuggested')}:</span>}
                  <span className="text-slate-400">{t(ROLE_LABEL_KEY[l.role])}</span>
                  <span className="min-w-0 truncate font-bold">{l.targetName || '—'}</span>
                  {l.versionLabel && <span className="min-w-0 truncate text-sky-300" data-media-link-version={l.versionLabel}>· {l.versionLabel}</span>}
                  {l.needsReview && (
                    <span className="rounded-full bg-amber-500/25 px-1.5 text-[10px] font-bold text-amber-200" title={t('visualLibrary.reviewHint')} data-media-link-review={l.id}>
                      ⚠ {t('visualLibrary.reviewBadge')}
                    </span>
                  )}
                  {l.needsReview && canEdit && (
                    <button type="button" disabled={busy} onClick={() => void markChecked(l)} title={t('visualLibrary.reviewDoneHint')} className="rounded-full border border-emerald-500/50 px-1.5 text-[10px] text-emerald-200 hover:bg-emerald-500/10" data-media-link-checked={l.id}>
                      ✓ {t('visualLibrary.reviewDone')}
                    </button>
                  )}
                  <span className="text-[10px] text-slate-500">· {sourceLabel(l.source)}</span>
                  {l.status === 'suggested' && canEdit && (
                    <>
                      <button type="button" disabled={busy} onClick={() => void decide(l, 'confirmed')} className="rounded-full border border-emerald-500/50 px-1.5 text-[10px] text-emerald-200 hover:bg-emerald-500/10" data-media-link-accept={l.id}>
                        ✓ {t('visualLibrary.aiAccept')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => void decide(l, 'rejected')} title={t('visualLibrary.aiRejectHint')} className="rounded-full border border-rose-500/40 px-1.5 text-[10px] text-rose-200 hover:bg-rose-500/10" data-media-link-reject={l.id}>
                        ✗ {t('visualLibrary.aiReject')}
                      </button>
                    </>
                  )}
                  {l.status === 'confirmed' && canEdit && l.entityId && VERSIONED.includes(l.role) && analysis?.available && (
                    <button type="button" disabled={!!aiBusy} onClick={() => void compare(l)} title={t('visualLibrary.aiCompareHint')} className="flex items-center gap-0.5 rounded-full border border-violet-500/40 px-1.5 text-[10px] text-violet-200 hover:bg-violet-500/10 disabled:opacity-50" data-media-link-compare={l.id}>
                      {aiBusy === l.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ScanEye className="h-2.5 w-2.5" />} {t('visualLibrary.aiCompare')}
                    </button>
                  )}
                  {canEdit && l.status !== 'suggested' && (
                    <button type="button" disabled={busy} onClick={() => void remove(l)} title={t('visualLibrary.linkRemove')} aria-label={t('visualLibrary.linkRemove')} className="text-slate-500 hover:text-rose-300" data-media-link-remove={l.id}>
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
                {analysis?.compare[l.id] && (
                  <div className="ml-2 space-y-0.5 text-[10px]" data-media-link-verdict={analysis.compare[l.id].verdict}>
                    <span className={`font-bold ${verdictCls(analysis.compare[l.id].verdict)}`}>AI-3: {verdictLabel(analysis.compare[l.id].verdict)}</span>
                    {analysis.compare[l.id].items.filter((i) => i.kind !== 'visual_match').map((i) => (
                      <p key={i.id} className={i.kind === 'visual_mismatch' ? 'text-rose-200' : 'text-slate-500'}>
                        {i.field ? `${fieldLabel(i.field)}: ` : ''}{i.kind === 'visual_unknown' ? t('visualLibrary.aiUnknown') : i.summary}
                      </p>
                    ))}
                  </div>
                )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">{t('visualLibrary.linksEmpty')}</p>
          )}
          {analysis && analysis.recognize.some((i) => i.kind !== 'visual_link') && (
            <div className="space-y-1 rounded-xl border border-violet-500/20 bg-violet-500/5 p-2 text-[10px]" data-media-ai-findings>
              {analysis.recognize.some((i) => i.kind === 'visual_trait') && (
                <div>
                  <p className="font-bold text-violet-200">{t('visualLibrary.aiTraits')}</p>
                  {analysis.recognize.filter((i) => i.kind === 'visual_trait').map((i) => (
                    <p key={i.id} className="text-slate-300" data-media-ai-trait>{i.entityName ? `${i.entityName} · ` : ''}{i.field && i.field !== 'other' ? `${fieldLabel(i.field)}: ` : ''}{i.summary}</p>
                  ))}
                </div>
              )}
              {analysis.recognize.some((i) => i.kind === 'visual_mismatch') && (
                <div>
                  <p className="font-bold text-rose-200">{t('visualLibrary.aiMismatches')}</p>
                  {analysis.recognize.filter((i) => i.kind === 'visual_mismatch').map((i) => (
                    <p key={i.id} className="text-rose-100/80" data-media-ai-mismatch>{i.entityName ? `${i.entityName} · ` : ''}{i.field && i.field !== 'other' ? `${fieldLabel(i.field)}: ` : ''}{i.summary}</p>
                  ))}
                </div>
              )}
            </div>
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
