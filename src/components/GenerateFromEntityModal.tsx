/**
 * Генерація зображення від сутності книги (Т2.3 В6, PLAN_VISUAL_LIBRARY.md) —
 * лише за командою автора. Сервер складає промпт із затвердженого опису
 * (версія зовнішності чи картка героя) і пропонує референсами вже прив'язані
 * зображення сутності; автор може правити промпт і зняти референси. Готове
 * зображення лягає в Медіатеку (паспорт — «ШІ», модель, промпт) і одразу
 * прив'язане до сутності.
 *
 * `GET /api/projects/:id/visual/generation-brief`, `POST …/visual/generate`
 * (202 + jobId), статус — `GET /api/ai/generate-media-art/status/:jobId`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { ROLE_LABEL_KEY, type AssetRoleKey } from './MediaLinksPanel';

interface Brief {
  entity: { id: string; name: string; type: string };
  version: { id: string; label: string; age: string } | null;
  role: AssetRoleKey;
  roles: AssetRoleKey[];
  description: string;
  missingDescription: boolean;
  prompt: string;
  references: { linkId: string; assetUrl: string; role: AssetRoleKey; versionLabel: string | null }[];
  maxReferences: number;
  available: boolean;
}

interface EngineInfo {
  id: string;
  label: string;
  available: boolean;
  supportsReferenceImages?: boolean;
  maxReferenceImages?: number;
}

interface LinkResult {
  id: string;
  entityName: string;
  role: AssetRoleKey;
  versionLabel: string | null;
  needsReview: boolean;
}

interface Props {
  bookId: string;
  entityId: string;
  /** Версія зовнішності (лише затверджена); null — за карткою героя. */
  versionId?: string | null;
  role?: AssetRoleKey;
  onClose: () => void;
  /** Зображення згенеровано й прив'язано — оновити стрічку, профіль. */
  onDone?: () => void;
}

/** Пропорції за роллю: портрет — вертикальний, повний зріст — ще вужчий, локація — широка. */
const ASPECT_FOR: Record<string, string[]> = {
  portrait: ['3:4', '1:1', '4:5'],
  full_body: ['9:16', '2:3', '3:4'],
  reference: ['16:9', '4:3', '1:1'],
  location: ['16:9', '4:3', '21:9'],
  object: ['1:1', '4:3'],
  depicts: ['4:3', '16:9', '1:1'],
};

const POLL_MS = 3000;
const POLL_MAX = 160; // ~8 хв — із запасом над найдовшою моделлю (як у Медіатеці)

export const GenerateFromEntityModal: React.FC<Props> = ({ bookId, entityId, versionId = null, role, onClose, onDone }) => {
  const { t } = useLanguage();
  const api = `/api/projects/${encodeURIComponent(bookId)}/visual`;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<AssetRoleKey | undefined>(role);
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<Set<string>>(new Set());
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [ratios, setRatios] = useState<string[]>([]);
  const [engineId, setEngineId] = useState('');
  const [aspect, setAspect] = useState('');
  const [running, setRunning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; model: string; link: LinkResult | null; linkError?: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const loadBrief = useCallback(async (r?: AssetRoleKey) => {
    setLoadError(null);
    const q = new URLSearchParams({ entityId, ...(versionId ? { versionId } : {}), ...(r ? { role: r } : {}) });
    const res = await fetch(`${api}/generation-brief?${q}`, { credentials: 'same-origin' }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!alive.current) return;
    if (!res || !res.ok) {
      setLoadError(res?.status === 403 ? t('visualLibrary.genForbidden') : body?.error || t('visualLibrary.genFailed', { reason: String(res?.status ?? 'network') }));
      return;
    }
    const b = body as Brief;
    setBrief(b);
    setCurrentRole(b.role);
    setPrompt(b.prompt);
    setRefs(new Set(b.references.map((x) => x.assetUrl)));
    setAspect((prev) => (prev && (ASPECT_FOR[b.role] ?? []).includes(prev) ? prev : ASPECT_FOR[b.role]?.[0] ?? '1:1'));
  }, [api, entityId, versionId, t]);

  useEffect(() => {
    void loadBrief(role);
    fetch('/api/ai/image-engines', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (!alive.current) return;
        const list: EngineInfo[] = (data?.engines || []).filter((e: EngineInfo) => e.available);
        setEngines(list);
        setEngineId((prev) => prev || list[0]?.id || '');
        if (Array.isArray(data?.aspectRatios)) setRatios(data.aspectRatios);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && running == null) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, running]);

  const engine = engines.find((e) => e.id === engineId);
  const engineRefs = engine ? (engine.supportsReferenceImages === false ? 0 : engine.maxReferenceImages ?? brief?.maxReferences ?? 0) : brief?.maxReferences ?? 0;
  const chosenRefs = (brief?.references ?? []).filter((r) => refs.has(r.assetUrl)).map((r) => r.assetUrl).slice(0, engineRefs);
  const aspectOptions = [...new Set([...(ASPECT_FOR[currentRole ?? ''] ?? []), ...ratios])].filter((r) => !ratios.length || ratios.includes(r));

  const generate = async () => {
    if (!brief || !prompt.trim()) return;
    setError(null);
    setResult(null);
    setRunning(0);
    try {
      const res = await fetch(`${api}/generate`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId,
          appearanceVersionId: versionId || undefined,
          role: currentRole,
          prompt: prompt.trim(),
          engine: engineId || undefined,
          aspectRatio: aspect || undefined,
          referenceAssets: chosenRefs,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402 || body?.kind === 'quota_exceeded') throw new Error(t('visualLibrary.genQuota'));
      if (res.status === 403) throw new Error(body?.error || t('visualLibrary.genForbidden'));
      if (res.status === 503) throw new Error(body?.error || t('visualLibrary.genUnavailable'));
      if (res.status !== 202 || !body?.jobId) throw new Error(body?.error || String(res.status));
      const started = Date.now();
      for (let i = 0; i < POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        setRunning(Math.round((Date.now() - started) / 1000));
        const st = await fetch(`/api/ai/generate-media-art/status/${encodeURIComponent(body.jobId)}`, { credentials: 'same-origin' }).catch(() => null);
        if (!st) continue;
        const s = await st.json().catch(() => ({}));
        if (s?.status === 'pending') continue;
        if (s?.status === 'complete') {
          setResult({ url: s.imageUrl, model: s.modelUsed || '', link: s.link ?? null, linkError: s.linkError });
          onDone?.();
          return;
        }
        throw new Error(s?.error || String(st.status));
      }
      throw new Error('timeout');
    } catch (err: any) {
      if (alive.current) setError(t('visualLibrary.genFailed', { reason: err?.message || 'error' }));
    } finally {
      if (alive.current) setRunning(null);
    }
  };

  const roleText = (r: string) => t(ROLE_LABEL_KEY[r as AssetRoleKey] ?? r);
  const field = 'w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-hidden';

  return (
    <div onClick={() => running == null && onClose()} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" data-gen-modal>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 p-4">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-300" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-bold text-slate-100">{t('visualLibrary.genTitle', { name: brief?.entity.name ?? '…' })}</h3>
            <p className="truncate text-[11px] text-slate-400" data-gen-version>{brief ? (brief.version ? brief.version.label : brief.entity.type === 'character' ? t('visualLibrary.genBase') : brief.entity.type) : ''}</p>
          </div>
          <button type="button" disabled={running != null} onClick={onClose} aria-label={t('visualLibrary.genClose')} className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-slate-500 disabled:opacity-40">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {loadError && <p className="text-[12px] text-rose-300" data-gen-load-error>{loadError}</p>}
          {!brief && !loadError && (
            <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> …</p>
          )}
          {brief && (
            <>
              {brief.roles.length > 1 && (
                <label className="block space-y-1">
                  <span className="text-[11px] font-bold text-slate-300">{t('visualLibrary.genRole')}</span>
                  <select className={field} value={currentRole} disabled={running != null} data-gen-role onChange={(e) => void loadBrief(e.target.value as AssetRoleKey)}>
                    {brief.roles.map((r) => <option key={r} value={r}>{roleText(r)}</option>)}
                  </select>
                </label>
              )}

              {brief.description ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-slate-300">{t('visualLibrary.genDescription')}</p>
                  <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[11px] text-slate-300" data-gen-description>{brief.description}</p>
                </div>
              ) : brief.missingDescription ? (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-300" data-gen-no-description>
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {t('visualLibrary.genNoDescription')}
                </p>
              ) : null}

              <label className="block space-y-1">
                <span className="text-[11px] font-bold text-slate-300">{t('visualLibrary.genPrompt')}</span>
                <textarea className={`${field} min-h-[96px]`} value={prompt} disabled={running != null} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} data-gen-prompt />
                <span className="text-[10px] text-slate-500">{t('visualLibrary.genPromptHint')}</span>
              </label>

              <div className="space-y-1" data-gen-refs={brief.references.length}>
                <p className="text-[11px] font-bold text-slate-300">{t('visualLibrary.genRefs', { n: chosenRefs.length })}</p>
                {brief.references.length ? (
                  <>
                    <p className="text-[10px] text-slate-500">{t('visualLibrary.genRefsHint')}</p>
                    <div className="flex flex-wrap gap-2">
                      {brief.references.map((r) => {
                        const on = refs.has(r.assetUrl);
                        return (
                          <button
                            key={r.linkId}
                            type="button"
                            disabled={running != null}
                            onClick={() => setRefs((prev) => { const n = new Set(prev); if (n.has(r.assetUrl)) n.delete(r.assetUrl); else n.add(r.assetUrl); return n; })}
                            data-gen-ref={r.assetUrl}
                            data-gen-ref-on={on ? '1' : '0'}
                            aria-pressed={on}
                            title={`${roleText(r.role)}${r.versionLabel ? ` · ${r.versionLabel}` : ''}`}
                            className={`relative h-16 w-16 overflow-hidden rounded-lg border-2 ${on ? 'border-violet-400' : 'border-slate-700 opacity-50'}`}
                          >
                            <img src={r.assetUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                            {on && <Check className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-violet-500 p-0.5 text-white" />}
                          </button>
                        );
                      })}
                    </div>
                    {engine && engineRefs === 0 && refs.size > 0 && <p className="text-[10px] text-amber-300" data-gen-refs-unsupported>{t('visualLibrary.genRefsUnsupported')}</p>}
                  </>
                ) : (
                  <p className="text-[10px] text-slate-500" data-gen-refs-none>{t('visualLibrary.genRefsNone')}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block min-w-0 space-y-1">
                  <span className="text-[11px] font-bold text-slate-300">{t('visualLibrary.genEngine')}</span>
                  <select className={field} value={engineId} disabled={running != null} onChange={(e) => setEngineId(e.target.value)} data-gen-engine>
                    {engines.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                  </select>
                </label>
                <label className="block min-w-0 space-y-1">
                  <span className="text-[11px] font-bold text-slate-300">{t('visualLibrary.genAspect')}</span>
                  <select className={field} value={aspect} disabled={running != null} onChange={(e) => setAspect(e.target.value)} data-gen-aspect>
                    {aspectOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              </div>

              {!brief.available && <p className="text-[11px] text-amber-300" data-gen-unavailable>{t('visualLibrary.genUnavailable')}</p>}
              {error && <p className="break-words text-[12px] text-rose-300" data-gen-error>{error}</p>}
              {result && (
                <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 sm:flex-row" data-gen-result>
                  <img src={result.url} alt="" className="h-40 w-full rounded-lg object-contain sm:w-40" data-gen-result-img />
                  <div className="min-w-0 space-y-1 text-[12px]">
                    <p className="text-emerald-200">{t('visualLibrary.genDone', { model: result.model })}</p>
                    {result.link ? (
                      <p className="text-slate-200" data-gen-linked={result.link.id}>
                        {t('visualLibrary.genLinked', { role: roleText(result.link.role), name: result.link.entityName, version: result.link.versionLabel ? ` · ${result.link.versionLabel}` : '' })}
                      </p>
                    ) : (
                      <p className="text-amber-300" data-gen-link-failed>{t('visualLibrary.genLinkFailed', { reason: result.linkError || '—' })}</p>
                    )}
                    {result.link?.needsReview && <p className="text-amber-300" data-gen-needs-review>⚠ {t('visualLibrary.genNeedsReview')}</p>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 p-3">
          {running != null && (
            <span className="mr-auto flex items-center gap-1.5 text-[11px] text-slate-400" data-gen-running>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('visualLibrary.genRunning', { s: running })}
            </span>
          )}
          <button type="button" disabled={running != null} onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-[12px] text-slate-300 hover:border-slate-500 disabled:opacity-40">
            {t('visualLibrary.genClose')}
          </button>
          <button
            type="button"
            disabled={!brief || !brief.available || !prompt.trim() || running != null}
            onClick={() => void generate()}
            data-gen-start
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" /> {result ? t('visualLibrary.genAgain') : t('visualLibrary.genStart')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GenerateFromEntityModal;
