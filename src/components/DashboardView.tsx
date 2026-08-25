import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Flame,
  Sparkles,
  PenSquare,
  BarChart3,
  BookOpen,
  GraduationCap,
  Wand2,
  Trophy,
  Users,
  ArrowRight,
  CheckCircle2,
  FileWarning,
  Loader2,
  Library,
  Coins,
} from 'lucide-react';
import type { AuthUser, Book, NavigationTab, WriterMasteryState, SkillCategory } from '../types';
import { SKILL_CATEGORIES, SKILL_TASKS, INITIAL_MASTERY_STATE } from '../data/skillsData';
import { useLanguage } from '../i18n/LanguageContext';
import { listBooks, saveMeta, META_ACTIVE_BOOK, type BookSummary } from '../utils/storage';

interface DashboardViewProps {
  book: Book;
  authUser: AuthUser | null;
  totalWords: number;
  onNavigateToTab: (tab: NavigationTab) => void;
}

interface StyleStatus {
  loading: boolean;
  exists: boolean;
  updatedAt?: string;
}

interface LastAiAnalysis {
  readabilityScore: number;
  issuesCount: number;
  checkedAt: string;
  sectionTitle?: string;
}

/** Той самий орієнтир «повноцінного роману», що і в бейджі «100 000 слів» (skillsData.ts). */
const BOOK_WORDS_MILESTONE = 100_000;

/** Той самий localStorage-місток, яким AIStudioView повідомляє MasteryView про використання AI-редактора (Фаза 0, 0.5). */
const LAST_AI_ANALYSIS_KEY = 'nova_last_ai_analysis';

export const DashboardView: React.FC<DashboardViewProps> = ({ book, authUser, totalWords, onNavigateToTab }) => {
  const { t } = useLanguage();

  // Стан майстерності живе лише в MasteryView (localStorage) — тут лише
  // читаємо той самий ключ, як і AIStudioView/MasteryView уже роблять одне
  // з одним (Фаза 0), щоб не вигадувати нову архітектуру підняття стану.
  const mastery: WriterMasteryState = useMemo(() => {
    try {
      const saved = localStorage.getItem('nova_writer_mastery_state');
      if (saved) return JSON.parse(saved);
    } catch {
      /* фолбек нижче */
    }
    return INITIAL_MASTERY_STATE;
  }, []);

  const [styleStatus, setStyleStatus] = useState<StyleStatus>({ loading: !!authUser?.id, exists: false });
  const [lastAnalysis, setLastAnalysis] = useState<LastAiAnalysis | null>(null);

  useEffect(() => {
    if (!authUser?.id) {
      setStyleStatus({ loading: false, exists: false });
      return;
    }
    let cancelled = false;
    setStyleStatus({ loading: true, exists: false });
    fetch(`/api/style/${authUser.id}`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.contentMd) {
          setStyleStatus({ loading: false, exists: true, updatedAt: data.updatedAt });
        } else {
          setStyleStatus({ loading: false, exists: false });
        }
      })
      .catch(() => {
        if (!cancelled) setStyleStatus({ loading: false, exists: false });
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_AI_ANALYSIS_KEY);
      if (raw) setLastAnalysis(JSON.parse(raw));
    } catch {
      /* немає збереженого аналізу — це нормальний стан */
    }
  }, []);

  // "Де мені це подивитися" — список УСІХ книг письменника. Раніше такого
  // списку не було в жодному екрані застосунку: письменник бачив лише
  // активну книгу (utils/storage.ts → META_ACTIVE_BOOK).
  const [myBooks, setMyBooks] = useState<BookSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    listBooks()
      .then((books) => {
        if (!cancelled) setMyBooks(books);
      })
      .catch(() => {
        /* немає книг або сховище недоступне — порожній список ок */
      });
    return () => {
      cancelled = true;
    };
  }, [book.id, book.updatedAt]);

  const handleSwitchBook = async (id: string) => {
    if (id === book.id) return;
    await saveMeta(META_ACTIVE_BOOK, id);
    window.location.reload();
  };

  // Персональний облік витрат токенів (Завдання 2 grill-me сесії) — та сама
  // усage_log-агрегація, що й адмінська панель, але відфільтрована сервером
  // (server/usageRoutes.ts → GET /api/usage/me) лише під цього користувача.
  interface MyUsage {
    totals: { totalUsd: number; todayUsd: number; generations: number };
    byModel: { key: string; count: number; costUsd: number }[];
  }
  const [myUsage, setMyUsage] = useState<MyUsage | null>(null);
  useEffect(() => {
    if (!authUser?.id) {
      setMyUsage(null);
      return;
    }
    let cancelled = false;
    fetch('/api/usage/me?days=30', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setMyUsage(data);
      })
      .catch(() => {
        /* тихо: віджет просто не покажеться */
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id]);

  const weakestCategories = useMemo(() => {
    const scores = mastery.diagnostic?.categoryScores;
    if (!scores) return [];
    return (Object.entries(scores) as [SkillCategory, number][])
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([id, score]) => {
        const info = SKILL_CATEGORIES.find((c) => c.id === id);
        return { id, score, titleUk: info?.titleUk || id, titleEn: info?.titleEn || id };
      });
  }, [mastery.diagnostic]);

  const todayTask = useMemo(
    () => SKILL_TASKS.find((task) => task.id === mastery.todayTaskId),
    [mastery.todayTaskId]
  );

  const bookProgressPct = Math.min(100, Math.round((totalWords / BOOK_WORDS_MILESTONE) * 100));

  const quickLinks: { tab: NavigationTab; icon: React.ComponentType<{ className?: string }>; labelKey: string }[] = [
    { tab: 'editor', icon: BookOpen, labelKey: 'dashboard.quickBook' },
    { tab: 'courses', icon: GraduationCap, labelKey: 'dashboard.quickCourses' },
    { tab: 'mastery', icon: Trophy, labelKey: 'dashboard.quickMastery' },
    { tab: 'ai-studio', icon: Wand2, labelKey: 'dashboard.quickAi' },
    { tab: 'characters', icon: Users, labelKey: 'dashboard.quickCharacters' },
  ];

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      {/* Header */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
          <LayoutDashboard className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">{t('dashboard.title')}</h1>
          <p className="text-sm text-slate-400">{t('dashboard.subtitle', { name: authUser?.name || t('dashboard.guestName') })}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 1. Профіль + XP + Рівень */}
        <div className="lg:col-span-1 nova-glass-dark rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm shrink-0">
              Lvl {mastery.level}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-100 truncate">{mastery.levelTitle}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-orange-400 font-semibold">
                <Flame className="w-3.5 h-3.5" />
                <span>{t('dashboard.streak', { n: String(mastery.dailyStreak) })}</span>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mb-1 flex justify-between">
            <span>{t('dashboard.xpLabel')}</span>
            <span className="font-mono text-slate-300">{mastery.xp} XP</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-400"
              style={{ width: `${Math.min(100, mastery.xp % 100)}%` }}
            />
          </div>
          <button
            onClick={() => onNavigateToTab('mastery')}
            className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors"
          >
            <span>{t('dashboard.goToMastery')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 2. Мій стиль */}
        <div className="lg:col-span-1 nova-glass-dark rounded-2xl p-5 border border-slate-800 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('dashboard.styleHeading')}</h3>
          </div>
          {styleStatus.loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('dashboard.styleLoading')}</span>
            </div>
          ) : styleStatus.exists ? (
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {t('dashboard.styleReady', {
                  date: styleStatus.updatedAt ? new Date(styleStatus.updatedAt).toLocaleDateString() : '',
                })}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <FileWarning className="w-4 h-4 shrink-0" />
              <span>{authUser?.id ? t('dashboard.styleNotReady') : t('dashboard.styleNeedsLogin')}</span>
            </div>
          )}
          <button
            onClick={() => onNavigateToTab('mastery')}
            className="mt-auto pt-4 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 text-xs font-bold transition-colors"
          >
            <span>{t('dashboard.goToStyle')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 4. Поточний проєкт */}
        <div className="lg:col-span-1 nova-glass-dark rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('dashboard.projectHeading')}</h3>
          </div>
          <div className="text-sm font-bold text-slate-100 truncate mb-0.5">{book.title || t('dashboard.untitled')}</div>
          <div className="text-[11px] text-slate-500 mb-3">{book.genre}</div>
          <div className="text-[11px] text-slate-400 mb-1 flex justify-between">
            <span>{t('dashboard.wordsProgress', { n: totalWords.toLocaleString() })}</span>
            <span className="font-mono text-slate-300">{bookProgressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-blue-400" style={{ width: `${bookProgressPct}%` }} />
          </div>
          <p className="mt-2 text-[10px] text-slate-500">{t('dashboard.wordsProgressHint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 3. Найслабші навички */}
        <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-rose-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('dashboard.weakestHeading')}</h3>
          </div>
          {weakestCategories.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.weakestEmpty')}</p>
          ) : (
            <div className="space-y-2.5">
              {weakestCategories.map((cat) => (
                <div key={cat.id}>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>{cat.titleUk}</span>
                    <span className="font-mono">{cat.score}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-rose-500 to-orange-400" style={{ width: `${cat.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5 + 6: Сьогоднішня вправа та останній AI-аналіз */}
        <div className="space-y-4">
          <div className="nova-glass-dark rounded-2xl p-5 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('dashboard.todayTaskHeading')}</h3>
            </div>
            {todayTask ? (
              <>
                <div className="text-sm font-bold text-slate-100 mb-1">{todayTask.title}</div>
                <p className="text-[11px] text-slate-500 mb-3 line-clamp-2">{todayTask.goal}</p>
                <button
                  onClick={() => onNavigateToTab('mastery')}
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300"
                >
                  <span>{mastery.todayTaskCompleted ? t('dashboard.taskDoneToday') : t('dashboard.startTask')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-500">{t('dashboard.noTaskToday')}</p>
            )}
          </div>

          <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <PenSquare className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('dashboard.lastAnalysisHeading')}</h3>
            </div>
            {lastAnalysis ? (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-slate-100">
                    {t('dashboard.readabilityScore', { score: String(lastAnalysis.readabilityScore) })}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {t('dashboard.issuesFound', { n: String(lastAnalysis.issuesCount) })} ·{' '}
                    {new Date(lastAnalysis.checkedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => onNavigateToTab('ai-studio')}
                  className="text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  {t('dashboard.recheck')} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t('dashboard.lastAnalysisEmpty')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Мої книги — де мені це подивитися */}
        <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center gap-2 mb-4">
            <Library className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('dashboard.myBooksHeading')}</h3>
          </div>
          {myBooks.length === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.myBooksEmpty')}</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {myBooks.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleSwitchBook(b.id)}
                  disabled={b.id === book.id}
                  className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-lg text-left transition-colors ${
                    b.id === book.id
                      ? 'bg-amber-500/10 border border-amber-500/30 cursor-default'
                      : 'bg-slate-900/60 border border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-100 truncate">{b.title}</div>
                    <div className="text-[10px] text-slate-500">
                      {b.status} · {b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : ''}
                    </div>
                  </div>
                  {b.id === book.id ? (
                    <span className="text-[10px] font-bold text-amber-400 shrink-0">{t('dashboard.myBooksActive')}</span>
                  ) : (
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Мій облік витрат токенів */}
        {authUser?.id && (
          <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800">
            <div className="flex items-center gap-2 mb-4">
              <Coins className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('dashboard.myUsageHeading')}</h3>
            </div>
            {!myUsage ? (
              <p className="text-sm text-slate-500">{t('dashboard.myUsageLoading')}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">{t('dashboard.myUsageToday')}</div>
                    <div className="text-lg font-bold font-mono text-emerald-300">${myUsage.totals.todayUsd.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">{t('dashboard.myUsage30d')}</div>
                    <div className="text-lg font-bold font-mono text-slate-200">${myUsage.totals.totalUsd.toFixed(2)}</div>
                  </div>
                </div>
                {myUsage.byModel.length > 0 && (
                  <div className="space-y-1.5">
                    {myUsage.byModel.slice(0, 5).map((row) => (
                      <div key={row.key} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 truncate">{row.key}</span>
                        <span className="font-mono text-slate-300 shrink-0 ml-2">
                          ${row.costUsd.toFixed(3)} · {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 7. Швидкий доступ */}
      <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">{t('dashboard.quickAccessHeading')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.tab}
                onClick={() => onNavigateToTab(link.tab)}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors"
              >
                <Icon className="w-5 h-5 text-slate-300" />
                <span className="text-[11px] font-semibold text-slate-300 text-center">{t(link.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
