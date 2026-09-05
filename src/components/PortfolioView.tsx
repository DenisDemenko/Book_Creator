import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Lock,
  BookOpen,
  GraduationCap,
  Trophy,
  Sparkles,
  ArrowRight,
  MonitorPlay,
  TrendingUp,
} from 'lucide-react';
import type { AuthUser, Book, NavigationTab, WriterMasteryState } from '../types';
import { INITIAL_MASTERY_STATE } from '../data/skillsData';
import { getAiScoreHistory, getAverageAiScore } from '../utils/aiScoreHistory';
import { useLanguage } from '../i18n/LanguageContext';

interface PortfolioViewProps {
  book: Book;
  authUser: AuthUser | null;
  totalWords: number;
  onNavigateToTab: (tab: NavigationTab) => void;
}

const STATUS_LABELS: Record<Book['status'], { uk: string; en: string; color: string }> = {
  draft: { uk: 'Чернетка', en: 'Draft', color: 'bg-slate-700 text-slate-300' },
  editing: { uk: 'У редагуванні', en: 'Editing', color: 'bg-cyan-500/20 text-cyan-300' },
  layout: { uk: 'У верстці', en: 'Layout', color: 'bg-amber-500/20 text-amber-300' },
  ready_to_publish: { uk: 'Готова до публікації', en: 'Ready to publish', color: 'bg-emerald-500/20 text-emerald-300' },
};

export const PortfolioView: React.FC<PortfolioViewProps> = ({ book, authUser, totalWords, onNavigateToTab }) => {
  const { t, lang } = useLanguage();

  // Той самий localStorage-місток стану майстерності, яким уже
  // користуються DashboardView / MasteryView (Фаза 0-1) — тут лише
  // читаємо, нічого не пишемо.
  const mastery: WriterMasteryState = useMemo(() => {
    try {
      const saved = localStorage.getItem('nova_writer_mastery_state');
      if (saved) return JSON.parse(saved);
    } catch {
      /* фолбек нижче */
    }
    return INITIAL_MASTERY_STATE;
  }, []);

  const scoreHistory = useMemo(() => getAiScoreHistory(), []);
  const { average: avgScore, count: scoreCount } = useMemo(() => getAverageAiScore(), []);
  const unlockedAchievements = mastery.achievements.filter((a) => !!a.unlockedAt).length;

  const [styleExists, setStyleExists] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authUser?.id) {
      setStyleExists(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/style/${authUser.id}`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setStyleExists(!!data?.contentMd);
      })
      .catch(() => {
        if (!cancelled) setStyleExists(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id]);

  const statusInfo = STATUS_LABELS[book.status];
  const bookProgressPct = Math.min(100, Math.round((totalWords / 100_000) * 100));
  const recentScores = scoreHistory.slice(-6).reverse();

  // Фаза 3, 3.3 — «Портфоліо». Спец очікував список УСІХ книг автора,
  // але в реальній архітектурі Fusion Lab Studio книга живе лише в браузері
  // (IndexedDB) сесії, і застосунок веде рівно один активний проєкт —
  // окремого сховища «бібліотеки книг» немає (див. Фазу 2). Тому
  // портфоліо чесно показує поточний активний проєкт (і курс на його
  // основі, якщо увімкнено) як картки, а не вигадану мультикнижкову
  // бібліотеку, якої не існує.
  const completedProjectsCount = (book.status === 'ready_to_publish' ? 1 : 0) + (book.course?.enabled ? 1 : 0);

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-5">
      <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100">{t('portfolioView.title')}</h1>
            <p className="text-xs text-slate-500">{t('portfolioView.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 text-slate-400 text-[11px]">
          <Lock className="w-3.5 h-3.5" />
          <span>{t('portfolioView.privateNote')}</span>
        </div>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t('portfolioView.statTotalWords')}</p>
          <p className="text-xl font-bold text-slate-100">{totalWords.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')}</p>
        </div>
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t('portfolioView.statCompletedProjects')}</p>
          <p className="text-xl font-bold text-slate-100">{completedProjectsCount}</p>
        </div>
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t('portfolioView.statAvgAiScore')}</p>
          <p className="text-xl font-bold text-slate-100">
            {avgScore !== null ? `${avgScore}/100` : '—'}
          </p>
          {scoreCount > 0 && <p className="text-[10px] text-slate-600 mt-0.5">{t('portfolioView.statAvgAiScoreCount', { n: String(scoreCount) })}</p>}
        </div>
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t('portfolioView.statXpLevel')}</p>
          <p className="text-xl font-bold text-slate-100">{mastery.xp.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')} XP</p>
          <p className="text-[10px] text-slate-600 mt-0.5">{mastery.levelTitle}</p>
        </div>
      </div>

      {/* Проєкти */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{t('portfolioView.projectsHeading')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => onNavigateToTab('editor')}
            className="text-left nova-glass-dark rounded-2xl border border-slate-800 hover:border-rose-500/50 p-4 transition-colors group"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-bold text-slate-100 group-hover:text-rose-300">{book.title || t('portfolioView.untitledBook')}</h3>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusInfo.color}`}>
                {lang === 'uk' ? statusInfo.uk : statusInfo.en}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-3 line-clamp-2">{book.synopsis || book.logline || t('portfolioView.noSynopsis')}</p>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>{t('portfolioView.wordsProgress', { words: totalWords.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US'), pct: String(bookProgressPct) })}</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-rose-400" />
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden mt-2">
              <div className="h-full bg-gradient-to-r from-rose-500 to-amber-400" style={{ width: `${bookProgressPct}%` }} />
            </div>
          </button>

          {book.course?.enabled ? (
            <button
              onClick={() => onNavigateToTab('courses')}
              className="text-left nova-glass-dark rounded-2xl border border-slate-800 hover:border-indigo-500/50 p-4 transition-colors group"
            >
              <div className="flex items-center gap-2 mb-2">
                <MonitorPlay className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-slate-100 group-hover:text-indigo-300">{book.course.title || t('portfolioView.untitledCourse')}</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3 line-clamp-2">{book.course.description || t('portfolioView.noDescription')}</p>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{t('portfolioView.courseStats', { tags: String(book.course.tags?.length || 0), materials: String(book.course.materials?.length || 0) })}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400" />
              </div>
            </button>
          ) : (
            <div className="nova-glass-dark rounded-2xl border border-dashed border-slate-800 p-4 flex flex-col items-center justify-center text-center gap-2">
              <MonitorPlay className="w-5 h-5 text-slate-600" />
              <p className="text-xs text-slate-500">{t('portfolioView.noCourseYet')}</p>
              <button onClick={() => onNavigateToTab('courses')} className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300">
                {t('portfolioView.createCourseLink')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Майстерність & Стиль */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => onNavigateToTab('mastery')}
          className="text-left nova-glass-dark rounded-2xl border border-slate-800 hover:border-amber-500/50 p-4 transition-colors group"
        >
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100 group-hover:text-amber-300">{t('portfolioView.achievementsHeading')}</h3>
          </div>
          <p className="text-xs text-slate-500">{t('portfolioView.achievementsCount', { unlocked: String(unlockedAchievements), total: String(mastery.achievements.length) })}</p>
        </button>
        <button
          onClick={() => onNavigateToTab('mastery')}
          className="text-left nova-glass-dark rounded-2xl border border-slate-800 hover:border-cyan-500/50 p-4 transition-colors group"
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100 group-hover:text-cyan-300">{t('portfolioView.styleHeading')}</h3>
          </div>
          <p className="text-xs text-slate-500">
            {styleExists === null ? t('portfolioView.styleUnknown') : styleExists ? t('portfolioView.styleReady') : t('portfolioView.styleMissing')}
          </p>
        </button>
      </div>

      {/* Останні AI-оцінки */}
      {recentScores.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            {t('portfolioView.recentScoresHeading')}
          </h2>
          <div className="nova-glass-dark rounded-2xl border border-slate-800 divide-y divide-slate-800">
            {recentScores.map((entry, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-2.5 text-xs">
                <span className="text-slate-400">{entry.source}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-slate-200">{entry.score}/100</span>
                  <span className="text-slate-600">{new Date(entry.at).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!authUser || authUser.isGuest ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
          <GraduationCap className="w-4 h-4 shrink-0" />
          <span>{t('portfolioView.guestNote')}</span>
        </div>
      ) : null}
    </div>
  );
};
