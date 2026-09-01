import React, { useMemo, useRef, useState } from 'react';
import { Headphones, Play, Pause, SkipForward, SkipBack, Loader2, Lock, Crown, AlertTriangle } from 'lucide-react';
import type { AuthUser, Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { usePlanAccess } from '../hooks/usePlanAccess';
import { stripManuscriptMarkup } from '../utils/designSuggestion';
import {
  synthesizeNarration,
  splitForNarration,
  NarrationClientError,
  type NarrationLang,
} from '../utils/narrationClient';

interface NarrationViewProps {
  book: Book;
  authUser?: AuthUser | null;
  onGoToSubscription?: () => void;
}

interface Track {
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  chunks: string[];
}

/**
 * Плейлист озвучення всієї книги — «Курси» (IV) на бічній панелі.
 *
 * Свідомо НЕ намагається зібрати цілу книгу в один mp3: розділ довший за
 * NARRATION_MAX_CHARS (server/narration.ts) розбивається на частини
 * (splitForNarration), і кожна частина озвучується й кешується окремо —
 * той самий принцип, що вже працює для «Озвучити фрагмент» у редакторі
 * (EditorView.tsx). Повторне відтворення вже озвученого розділу нічого
 * не коштує: сервер віддає його з кешу (server/narrationStore.ts).
 */
export const NarrationView: React.FC<NarrationViewProps> = ({ book, authUser, onGoToSubscription }) => {
  const { t, lang: uiLang } = useLanguage();
  const access = usePlanAccess(authUser, ['pro', 'ultra']);

  const [lang, setLang] = useState<NarrationLang>(uiLang === 'en' ? 'en' : 'uk');
  const [trackIndex, setTrackIndex] = useState(0);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRequestId = useRef(0);

  const tracks = useMemo<Track[]>(() => {
    const list: Track[] = [];
    for (const chapter of book.chapters) {
      const sortedSections = [...chapter.sections].sort((a, b) => a.order - b.order);
      for (const section of sortedSections) {
        const clean = stripManuscriptMarkup(lang === 'en' && section.contentEn ? section.contentEn : section.content);
        const chunks = splitForNarration(clean);
        if (chunks.length === 0) continue;
        list.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          sectionId: section.id,
          sectionTitle: section.title,
          chunks,
        });
      }
    }
    return list;
  }, [book.chapters, lang]);

  const current = tracks[trackIndex];

  const loadAndPlay = async (nextTrackIndex: number, nextChunkIndex: number) => {
    const track = tracks[nextTrackIndex];
    if (!track) {
      setIsPlaying(false);
      return;
    }
    const text = track.chunks[nextChunkIndex];
    if (!text) {
      // Розділ закінчився — переходимо до наступного.
      void loadAndPlay(nextTrackIndex + 1, 0);
      return;
    }

    const requestId = ++playRequestId.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await synthesizeNarration({
        text,
        lang,
        scope: 'section',
        bookId: book.id,
        chapterId: track.chapterId,
        sectionId: track.sectionId,
      });
      if (playRequestId.current !== requestId) return; // користувач уже перейшов деінде
      setTrackIndex(nextTrackIndex);
      setChunkIndex(nextChunkIndex);
      setAudioUrl(result.audioUrl);
      setIsPlaying(true);
    } catch (err) {
      if (playRequestId.current !== requestId) return;
      setError(err instanceof NarrationClientError ? err.message : t('narration.genericError'));
      setIsPlaying(false);
    } finally {
      if (playRequestId.current === requestId) setIsLoading(false);
    }
  };

  const handlePlayTrack = (idx: number) => {
    if (idx === trackIndex && audioUrl && !isLoading) {
      setIsPlaying((v) => !v);
      return;
    }
    void loadAndPlay(idx, 0);
  };

  const handleEnded = () => {
    const track = tracks[trackIndex];
    if (track && chunkIndex + 1 < track.chunks.length) {
      void loadAndPlay(trackIndex, chunkIndex + 1);
    } else {
      void loadAndPlay(trackIndex + 1, 0);
    }
  };

  const handleNext = () => void loadAndPlay(trackIndex + 1, 0);
  const handlePrev = () => void loadAndPlay(Math.max(0, trackIndex - 1), 0);

  React.useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.play().catch(() => {});
    else audioRef.current.pause();
  }, [isPlaying, audioUrl]);

  if (!access.isRegistered) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8">
        <div className="p-6 rounded-2xl glass-panel space-y-3 text-center max-w-md mx-auto mt-10">
          <Lock className="w-8 h-8 text-slate-500 mx-auto" />
          <h3 className="text-sm font-bold text-slate-100">{t('narration.needRegHeading')}</h3>
          <p className="text-xs text-slate-400">{t('narration.needRegDesc')}</p>
        </div>
      </div>
    );
  }

  if (access.loading) {
    return <div className="flex-1 p-10 text-center text-sm text-slate-400">{t('narration.checkingPlan')}</div>;
  }

  if (!access.hasAccess) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8">
        <div className="p-6 rounded-2xl glass-panel space-y-3 text-center max-w-md mx-auto mt-10">
          <Crown className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-100">{t('narration.upgradeHeading')}</h3>
          <p className="text-xs text-slate-400">
            {t('narration.upgradeDesc', { plan: (uiLang === 'en' ? access.planNameEn : access.planNameUk) || t('narration.freePlanName') })}
          </p>
          {onGoToSubscription && (
            <button
              onClick={onGoToSubscription}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-md transition-all"
            >
              {t('narration.viewPlans')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-6 lg:p-8 space-y-6">
      <div className="relative overflow-hidden p-6 rounded-2xl glass-panel-elevated">
        <div className="absolute -top-20 -right-12 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl badge-glass text-sky-300">
              <Headphones className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl lg:text-2xl font-bold font-heading">{t('narration.heading')}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{t('narration.intro')}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl badge-glass">
            {(['uk', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => {
                  setIsPlaying(false);
                  setAudioUrl(null);
                  setLang(l);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  lang === l ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {l === 'uk' ? t('narration.langUk') : t('narration.langEn')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500">{t('narration.emptyBook')}</div>
      ) : (
        <>
          {/* Плеєр поточного треку */}
          <div className="p-4 rounded-2xl glass-panel flex items-center gap-3 sticky top-0 z-10">
            <button
              onClick={handlePrev}
              disabled={trackIndex === 0 || isLoading}
              className="p-2 rounded-xl badge-glass text-slate-300 disabled:opacity-40"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={() => handlePlayTrack(trackIndex)}
              disabled={isLoading}
              className="p-3 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-md disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5" />
              )}
            </button>
            <button
              onClick={handleNext}
              disabled={trackIndex >= tracks.length - 1 || isLoading}
              className="p-2 rounded-xl badge-glass text-slate-300 disabled:opacity-40"
            >
              <SkipForward className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">
                {current ? `${current.chapterTitle} — ${current.sectionTitle}` : t('narration.notStarted')}
              </p>
              {current && current.chunks.length > 1 && (
                <p className="text-[11px] text-slate-500">
                  {t('narration.chunkLabel', { current: String(chunkIndex + 1), total: String(current.chunks.length) })}
                </p>
              )}
            </div>
            <audio
              ref={audioRef}
              src={audioUrl || undefined}
              onEnded={handleEnded}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              className="hidden"
            />
          </div>

          {/* Список розділів книги */}
          <div className="flex flex-col divide-y divide-slate-800/60 rounded-2xl glass-panel overflow-hidden">
            {tracks.map((track, idx) => (
              <button
                key={track.sectionId}
                onClick={() => handlePlayTrack(idx)}
                className={`flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors ${
                  idx === trackIndex ? 'bg-sky-500/5' : ''
                }`}
              >
                <div className={`p-1.5 rounded-lg ${idx === trackIndex ? 'text-sky-400' : 'text-slate-500'}`}>
                  {idx === trackIndex && isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : idx === trackIndex && isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-200 truncate">{track.sectionTitle}</p>
                  <p className="text-[11px] text-slate-500 truncate">{track.chapterTitle}</p>
                </div>
                {track.chunks.length > 1 && (
                  <span className="text-[10px] font-mono text-slate-600">{track.chunks.length}×</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
