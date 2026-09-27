/**
 * Вкладка «За сутностями» Медіатеки (Т2.3 В7, PLAN_VISUAL_LIBRARY.md) — не
 * окрема сторінка, а подання наявної Медіатеки (рішення власника §6.1):
 * ліворуч герої, локації, предмети, сцени з кількістю зображень і
 * позначками «перевірити» / пропозиції ШІ / «без портрета»; праворуч —
 * зображення обраної сутності, версії зовнішності (герой), пропозиції AI-3
 * на розгляд, звірка з описом. Той самий паспорт і ті самі прив'язки, що й
 * у Медіатеці (`selectedMedia` там), клік на картку відкриває його ж.
 *
 * Дані: `GET /api/projects/:id/visual/entities` (ліва колонка — лічильники),
 * `GET …/visual/links?entityId=|sectionId=` (права колонка — самі
 * зображення), `GET …/visual/targets` (ролі, дозволені типу сутності, для
 * форми «Прив'язати»). Версії зовнішності героя — вже готова
 * `AppearanceVersionsPanel` (Т2.3 В3/В5/В6).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ImageOff, Link2, Loader2, Sparkles, X } from 'lucide-react';
import { Book, AuthUser } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { ROLE_LABEL_KEY, type AssetRoleKey, type VisualLink } from './MediaLinksPanel';
import { AppearanceVersionsPanel } from './AppearanceVersionsPanel';
import { GenerateFromEntityModal } from './GenerateFromEntityModal';
import { PickFromMediaLibraryModal } from './PickFromMediaLibraryModal';

interface EntitySummary {
  id: string;
  type: string;
  name: string;
  images: number;
  suggested: number;
  needsReview: number;
  hasPortrait: boolean;
}
interface SceneSummary {
  sectionId: string;
  title: string;
  chapterNumber: number | null;
  images: number;
}
interface Overview {
  synced: boolean;
  characters: EntitySummary[];
  locations: EntitySummary[];
  objects: EntitySummary[];
  other: EntitySummary[];
  scenes: SceneSummary[];
}

type Selected = { kind: 'entity'; id: string; type: string; name: string } | { kind: 'scene'; sectionId: string; title: string; chapterNumber: number | null } | null;

interface Targets {
  roleTypes: Record<string, string[] | null>;
}

interface Props {
  book: Book;
  authUser?: AuthUser | null;
  /** Відкрити паспорт файлу (спільний з галереєю лайтбокс) за URL. */
  onOpenAsset: (url: string) => void;
  /** «Відкрити в бібліотеці сутностей» із Медіатеки — яку сутність вибрати одразу. */
  focusEntityId?: string | null;
  onFocusHandled?: () => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

/** Групи лівої колонки — тип сутності книги → розділ переліку (Т2.3 В7). */
const GROUPS: { key: keyof Pick<Overview, 'characters' | 'locations' | 'objects' | 'other'>; labelKey: string }[] = [
  { key: 'characters', labelKey: 'visualLibrary.entGroupCharacters' },
  { key: 'locations', labelKey: 'visualLibrary.entGroupLocations' },
  { key: 'objects', labelKey: 'visualLibrary.entGroupObjects' },
  { key: 'other', labelKey: 'visualLibrary.entGroupOther' },
];

/** Зображення обраної сутності / сцени — та сама дія, що й у Медіатеці (паспорт спільний), лише картками, а не чипами. */
const EntityImagesGrid: React.FC<{
  bookId: string;
  entityId?: string;
  sectionId?: string;
  onOpenAsset: (url: string) => void;
  onChanged: () => void;
}> = ({ bookId, entityId, sectionId, onOpenAsset, onChanged }) => {
  const { t } = useLanguage();
  const base = `/api/projects/${encodeURIComponent(bookId)}/visual`;
  const [links, setLinks] = useState<VisualLink[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [state, setState] = useState<'loading' | 'ok' | 'off'>('loading');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    const q = entityId ? `entityId=${encodeURIComponent(entityId)}` : `sectionId=${encodeURIComponent(sectionId ?? '')}`;
    const res = await api(`${base}/links?${q}`).catch(() => null);
    if (!res?.ok) {
      setState('off');
      return;
    }
    const body = await res.json();
    setLinks(body.links ?? []);
    setCanEdit(!!body.canEdit);
    setState('ok');
  }, [base, entityId, sectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (url: string, init: RequestInit) => {
    setBusy(url);
    const res = await api(url, init).catch(() => null);
    setBusy(null);
    if (!res?.ok) return false;
    await load();
    onChanged();
    return true;
  };

  if (state === 'loading') return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  if (state === 'off') return <p className="text-[11px] text-slate-500">{t('visualLibrary.linksCoreOff')}</p>;
  if (!links.length) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500" data-ent-images-empty>
        <ImageOff className="h-3.5 w-3.5" /> {t('visualLibrary.entDetailEmpty')}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" data-ent-images={links.length}>
      {links.map((l) => (
        <div key={l.id} className={`overflow-hidden rounded-xl border bg-slate-950/40 ${l.status === 'suggested' ? 'border-dashed border-violet-500/60' : l.needsReview ? 'border-amber-500/50' : 'border-slate-800'}`} data-ent-image={l.id}>
          <button type="button" onClick={() => onOpenAsset(l.assetUrl)} className="block h-28 w-full cursor-pointer overflow-hidden bg-black" data-ent-image-open={l.id}>
            <img src={l.assetUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          </button>
          <div className="space-y-1 p-1.5">
            <div className="flex flex-wrap items-center gap-1 text-[10px]">
              <span className="rounded bg-slate-800 px-1.5 text-slate-300">{t(ROLE_LABEL_KEY[l.role])}</span>
              {l.versionLabel && <span className="truncate text-sky-300">· {l.versionLabel}</span>}
            </div>
            {l.status === 'suggested' && (
              <p className="text-[10px] font-bold text-violet-200" data-ent-image-suggested>{t('visualLibrary.entSuggestedLabel')}</p>
            )}
            {l.needsReview && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-200" data-ent-image-review>
                <AlertTriangle className="h-3 w-3" /> {t('visualLibrary.reviewBadge')}
              </p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-1">
                {l.status === 'suggested' && (
                  <>
                    <button type="button" disabled={!!busy} onClick={() => void mutate(`${base}/links/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'confirmed' }) })} className="rounded border border-emerald-500/50 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/10" data-ent-image-accept={l.id}>
                      <Check className="h-3 w-3" />
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => void mutate(`${base}/links/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'rejected' }) })} className="rounded border border-rose-500/40 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/10" data-ent-image-reject={l.id}>
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
                {l.status === 'confirmed' && l.needsReview && (
                  <button type="button" disabled={!!busy} onClick={() => void mutate(`${base}/links/${l.id}/checked`, { method: 'POST', body: '{}' })} className="rounded border border-emerald-500/50 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/10" data-ent-image-checked={l.id}>
                    ✓ {t('visualLibrary.reviewDone')}
                  </button>
                )}
                {l.status === 'confirmed' && (
                  <button type="button" disabled={!!busy} onClick={() => void mutate(`${base}/links/${l.id}`, { method: 'DELETE' })} title={t('visualLibrary.linkRemove')} aria-label={t('visualLibrary.linkRemove')} className="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-rose-400 hover:text-rose-300" data-ent-image-remove={l.id}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export const EntityVisualLibraryPanel: React.FC<Props> = ({ book, onOpenAsset, focusEntityId, onFocusHandled }) => {
  const { t } = useLanguage();
  const base = `/api/projects/${encodeURIComponent(book.id)}/visual`;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickRole, setPickRole] = useState<AssetRoleKey>('depicts');
  const [imagesKey, setImagesKey] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await api(`${base}/entities`).catch(() => null);
    if (!res?.ok) {
      setLoadError(t('visualLibrary.entError', { reason: String(res?.status ?? 'network') }));
      return;
    }
    setOverview((await res.json()) as Overview);
  }, [base, t]);

  useEffect(() => {
    void load();
    api(`${base}/targets`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setTargets(d)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // «Відкрити в бібліотеці сутностей» — щойно перелік завантажено, обрати сутність за id.
  useEffect(() => {
    if (!focusEntityId || !overview) return;
    const all = [...overview.characters, ...overview.locations, ...overview.objects, ...overview.other];
    const e = all.find((x) => x.id === focusEntityId);
    if (e) setSelected({ kind: 'entity', id: e.id, type: e.type, name: e.name });
    onFocusHandled?.();
  }, [focusEntityId, overview, onFocusHandled]);

  const reload = () => {
    void load();
    setImagesKey((k) => k + 1);
  };

  const badges = (e: EntitySummary) => (
    <span className="flex flex-wrap items-center gap-1 text-[10px]">
      <span className="rounded bg-slate-800 px-1.5 text-slate-300" data-ent-count={e.images}>{t('visualLibrary.entImages', { n: e.images })}</span>
      {!e.hasPortrait && <span className="rounded bg-slate-800 px-1.5 text-slate-400" data-ent-no-portrait>{t('visualLibrary.entBadgeNoPortrait')}</span>}
      {e.suggested > 0 && <span className="rounded bg-violet-500/20 px-1.5 font-bold text-violet-200" data-ent-suggested={e.suggested}>{t('visualLibrary.entBadgeSuggested', { n: e.suggested })}</span>}
      {e.needsReview > 0 && <span className="rounded bg-amber-500/20 px-1.5 font-bold text-amber-200" data-ent-review={e.needsReview}>{t('visualLibrary.entBadgeReview', { n: e.needsReview })}</span>}
    </span>
  );

  const entityRow = (e: EntitySummary) => (
    <button
      key={e.id}
      type="button"
      onClick={() => setSelected({ kind: 'entity', id: e.id, type: e.type, name: e.name })}
      data-ent-row={e.id}
      data-ent-row-active={selected?.kind === 'entity' && selected.id === e.id ? '1' : '0'}
      className={`flex w-full min-w-0 flex-col gap-1 rounded-xl border px-2.5 py-2 text-left transition-all ${
        selected?.kind === 'entity' && selected.id === e.id ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/30 hover:border-slate-600'
      }`}
    >
      <span className="truncate text-[12px] font-bold text-slate-100">{e.name}</span>
      {badges(e)}
    </button>
  );

  const sceneRow = (s: SceneSummary) => (
    <button
      key={s.sectionId}
      type="button"
      onClick={() => setSelected({ kind: 'scene', sectionId: s.sectionId, title: s.title, chapterNumber: s.chapterNumber })}
      data-ent-scene-row={s.sectionId}
      data-ent-row-active={selected?.kind === 'scene' && selected.sectionId === s.sectionId ? '1' : '0'}
      className={`flex w-full min-w-0 flex-col gap-1 rounded-xl border px-2.5 py-2 text-left transition-all ${
        selected?.kind === 'scene' && selected.sectionId === s.sectionId ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/30 hover:border-slate-600'
      }`}
    >
      <span className="truncate text-[12px] font-bold text-slate-100">{s.title}</span>
      <span className="flex items-center gap-1 text-[10px]">
        <span className="rounded bg-slate-800 px-1.5 text-slate-300">{s.chapterNumber ? t('visualLibrary.entSceneChapter', { n: s.chapterNumber }) : t('visualLibrary.entSceneNoChapter')}</span>
        <span className="rounded bg-slate-800 px-1.5 text-slate-300">{t('visualLibrary.entImages', { n: s.images })}</span>
      </span>
    </button>
  );

  // Ролі, дозволені для типу обраної сутності (`/visual/targets` → roleTypes — той самий договір, що в MediaLinksPanel);
  // головна роль типу (локація / предмет / «зображено») — першою, «референс» — останнім (рідше потрібен тут).
  const ROLE_PRIORITY: Record<string, number> = { location: 0, object: 1, portrait: 2, full_body: 3, depicts: 4, reference: 5 };
  const allowedRoles = useMemo(() => {
    if (!targets || !selected || selected.kind !== 'entity') return [];
    return (Object.keys(targets.roleTypes) as AssetRoleKey[])
      .filter((r) => {
        const types = targets.roleTypes[r];
        return !types || types.includes(selected.type);
      })
      .sort((a, b) => (ROLE_PRIORITY[a] ?? 9) - (ROLE_PRIORITY[b] ?? 9));
  }, [targets, selected]);

  useEffect(() => {
    if (allowedRoles.length) setPickRole(allowedRoles[0]);
  }, [allowedRoles]);

  const savePick = async (url: string) => {
    setPickOpen(false);
    if (!selected) return;
    await api(`${base}/links`, {
      method: 'POST',
      body: JSON.stringify(
        selected.kind === 'scene'
          ? { assetUrl: url, role: 'scene', sectionId: selected.sectionId }
          : { assetUrl: url, role: pickRole, entityId: selected.id },
      ),
    }).catch(() => null);
    reload();
  };

  if (loadError) return <p className="text-[12px] text-rose-300" data-ent-error>{loadError}</p>;
  if (!overview) return <Loader2 className="h-5 w-5 animate-spin text-slate-500" />;
  if (!overview.synced) return <p className="text-[12px] text-slate-400" data-ent-nosync>{t('visualLibrary.entNotSynced')}</p>;

  const hasAny = overview.characters.length || overview.locations.length || overview.objects.length || overview.other.length || overview.scenes.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row" data-entity-library>
      <div className="w-full shrink-0 space-y-3 overflow-y-auto lg:w-72" data-ent-list>
        {!hasAny && <p className="text-[11px] text-slate-500" data-ent-empty>{t('visualLibrary.entNoEntities')}</p>}
        {GROUPS.map(
          (g) =>
            overview[g.key].length > 0 && (
              <div key={g.key} className="space-y-1.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t(g.labelKey)} ({overview[g.key].length})</h4>
                <div className="space-y-1.5">{overview[g.key].map(entityRow)}</div>
              </div>
            ),
        )}
        {overview.scenes.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('visualLibrary.entGroupScenes')} ({overview.scenes.length})</h4>
            <div className="space-y-1.5">{overview.scenes.map(sceneRow)}</div>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/40 p-4" data-ent-detail>
        {!selected ? (
          <p className="text-[12px] text-slate-500">{t('visualLibrary.entPickHint')}</p>
        ) : selected.kind === 'entity' ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-bold text-slate-100">{selected.name}</h3>
              {selected.type !== 'character' && (
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setGenOpen(true)} data-ent-generate className="flex items-center gap-1 rounded-lg border border-violet-500/50 px-2.5 py-1 text-[11px] text-violet-200 hover:bg-violet-500/10">
                    <Sparkles className="h-3 w-3" /> {t('visualLibrary.genButton')}
                  </button>
                  {allowedRoles.length > 1 && (
                    <select
                      value={pickRole}
                      onChange={(e) => setPickRole(e.target.value as AssetRoleKey)}
                      aria-label={t('visualLibrary.linkRole')}
                      data-ent-link-role
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-hidden"
                    >
                      {allowedRoles.map((r) => (
                        <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>
                      ))}
                    </select>
                  )}
                  {allowedRoles.length > 0 && (
                    <button type="button" onClick={() => setPickOpen(true)} data-ent-link className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:border-sky-500">
                      <Link2 className="h-3 w-3" /> {t('visualLibrary.entLinkExisting')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {selected.type === 'character' && (
              <AppearanceVersionsPanel key={selected.id} bookId={book.id} entityId={selected.id} upto={null} onChanged={reload} />
            )}

            <div className="space-y-1.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">{t('visualLibrary.entDetailImagesTitle')}</h4>
              <p className="text-[10px] text-slate-500">{t('visualLibrary.entDetailImagesHint')}</p>
              <EntityImagesGrid key={`${selected.id}-${imagesKey}`} bookId={book.id} entityId={selected.id} onOpenAsset={onOpenAsset} onChanged={reload} />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-bold text-slate-100">{selected.title}</h3>
              <span className="rounded bg-slate-800 px-1.5 text-[10px] text-slate-300">
                {selected.chapterNumber ? t('visualLibrary.entSceneChapter', { n: selected.chapterNumber }) : t('visualLibrary.entSceneNoChapter')}
              </span>
              <button type="button" onClick={() => { setPickRole('scene'); setPickOpen(true); }} data-ent-link className="ml-auto flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:border-sky-500">
                <Link2 className="h-3 w-3" /> {t('visualLibrary.entLinkExisting')}
              </button>
            </div>
            <EntityImagesGrid key={`${selected.sectionId}-${imagesKey}`} bookId={book.id} sectionId={selected.sectionId} onOpenAsset={onOpenAsset} onChanged={reload} />
          </>
        )}
      </div>

      {genOpen && selected?.kind === 'entity' && (
        <GenerateFromEntityModal
          bookId={book.id}
          entityId={selected.id}
          onClose={() => setGenOpen(false)}
          onDone={reload}
        />
      )}

      {pickOpen && (
        <PickFromMediaLibraryModal
          title={t('visualLibrary.entLinkPickTitle')}
          onClose={() => setPickOpen(false)}
          onPick={(url) => void savePick(url)}
        />
      )}
    </div>
  );
};

export default EntityVisualLibraryPanel;
