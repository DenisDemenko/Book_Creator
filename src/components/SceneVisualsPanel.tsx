/**
 * «Хто в сцені» (Т2.3 В2, критерій сторінки 7) — у редакторі, вкладка
 * «Персонажі і сцена»: герої, згадані в активному розділі, з портретами з
 * бібліотеки ілюстрацій (а без прив'язки — з картки героя), і ілюстрації,
 * прив'язані до цієї сцени.
 *
 * Дані — `GET /api/projects/:id/visual/scene?sectionId=`. Ядро недоступне,
 * розділ ще не синхронізовано чи гість — панель просто не показується: вона
 * доповнює редактор, а не заважає йому.
 */

import React, { useEffect, useState } from 'react';
import { Images, UserRound } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface SceneData {
  sectionId: string;
  title: string;
  cast: { entityId: string; name: string; portraitUrl: string | null; portraitSource: 'link' | 'card' | null }[];
  illustrations: { linkId: string; url: string; source: string }[];
}

interface Props {
  bookId: string;
  sectionId?: string | null;
  /** Змінюється після збереження книги — щоб підтягнути свіже з ядра. */
  refreshKey?: unknown;
}

export const SceneVisualsPanel: React.FC<Props> = ({ bookId, sectionId, refreshKey }) => {
  const { t } = useLanguage();
  const [data, setData] = useState<SceneData | null>(null);

  useEffect(() => {
    if (!sectionId) {
      setData(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(bookId)}/visual/scene?sectionId=${encodeURIComponent(sectionId)}`, { credentials: 'same-origin' })
      .then(async (r) => (r.ok ? ((await r.json()) as SceneData) : null))
      .catch(() => null)
      .then((d) => {
        if (!cancelled) setData(d);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, sectionId, refreshKey]);

  if (!data) return null;
  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3" data-scene-visuals={data.sectionId}>
      <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <UserRound className="h-3.5 w-3.5" /> {t('visualLibrary.sceneTitle')}
      </h4>
      {data.cast.length ? (
        <div className="flex flex-wrap gap-2">
          {data.cast.map((c) => (
            <div key={c.entityId} className="flex w-16 flex-col items-center gap-1 text-center" data-scene-cast={c.name}>
              {c.portraitUrl ? (
                <img
                  src={c.portraitUrl}
                  alt={c.name}
                  title={c.portraitSource === 'link' ? t('visualLibrary.scenePortraitLink') : t('visualLibrary.scenePortraitCard')}
                  data-scene-portrait={c.portraitSource ?? ''}
                  className="h-12 w-12 rounded-full border border-slate-700 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-slate-700 bg-slate-800" title={t('visualLibrary.sceneNoPortrait')}>
                  <UserRound className="h-5 w-5 text-slate-500" />
                </div>
              )}
              <span className="w-full truncate text-[10px] text-slate-300">{c.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">{t('visualLibrary.sceneEmpty')}</p>
      )}
      {data.illustrations.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <Images className="h-3 w-3" /> {t('visualLibrary.sceneIllustrations')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.illustrations.map((i) => (
              <img key={i.linkId} src={i.url} alt="" data-scene-illustration={i.linkId} className="h-14 w-20 rounded-lg border border-slate-800 object-cover" referrerPolicy="no-referrer" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SceneVisualsPanel;
