import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, FileText, GraduationCap, Loader2, RotateCcw, Smartphone } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { apiPath } from '../utils/basePath';
import type { MyCourseBrief, MyInstruction, MyPhoneDraft, MyWorks } from '../../shared/myWorks';

/**
 * Блоки «Інструкції» і «Курси» на дашборді (журнал #532): перелік усього, що автор створив як комплексні
 * продукти. Блок «Книги» лишився тим, що був у DashboardView, — він і стоїть першим у цьому ж ряду.
 * Презентаційні блоки не ходять у мережу (їх рендерить тест), дані тягне хук `useMyWorks`.
 */

const cardCls = 'nova-glass-dark rounded-2xl p-5 border border-slate-800';
const headCls = 'text-xs font-bold uppercase tracking-wider text-slate-400';
const rowCls = 'flex items-center gap-2 p-2.5 rounded-lg border bg-slate-900/60 border-slate-800';

/** «до 21:30» для сьогоднішнього терміну, «до 10.11, 21:30» для іншого дня. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const time = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}, ${time}`;
}

const COURSE_STATUS: Record<string, string> = {
  draft: 'чернетка',
  review: 'на перевірці',
  published: 'опубліковано',
  rejected: 'повернуто на доробку',
  archived: 'в архіві',
};

export interface MyWorksState {
  works: MyWorks | null;
  courses: MyCourseBrief[];
  /** Курси недоступні ролі (403): блок пояснює це, а не показує помилку. */
  coursesLocked: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: MyWorksState = { works: null, courses: [], coursesLocked: false, loading: false, error: null };

/** Курс сервера → рядок переліку. Приймає і «мої», і спільні. */
export function toCourseBrief(c: any, shared: boolean): MyCourseBrief {
  return {
    id: String(c.id),
    title: String(c.title || '').trim() || 'Курс без назви',
    status: String(c.status || 'draft'),
    updatedAt: String(c.updatedAt || c.createdAt || ''),
    modules: Array.isArray(c.modules) ? c.modules.length : 0,
    fromPhone: !!c.origin,
    shared,
  };
}

export function useMyWorks(userId: string | null | undefined): MyWorksState & { reload: () => void } {
  const [state, setState] = useState<MyWorksState>(EMPTY);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!userId) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([
      fetch(apiPath('/api/my-works'), { credentials: 'same-origin' }),
      fetch(apiPath('/api/courses'), { credentials: 'same-origin' }),
    ])
      .then(async ([w, c]) => {
        if (!w.ok) throw new Error('Не вдалося отримати перелік робіт.');
        const works = (await w.json()) as MyWorks;
        let courses: MyCourseBrief[] = [];
        let locked = false;
        if (c.status === 403) locked = true;
        else if (c.ok) {
          const data = await c.json();
          courses = [
            ...(Array.isArray(data?.courses) ? data.courses : []).map((x: any) => toCourseBrief(x, false)),
            ...(Array.isArray(data?.shared) ? data.shared : []).map((x: any) => toCourseBrief(x, true)),
          ].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        }
        if (!cancelled) setState({ works, courses, coursesLocked: locked, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ ...EMPTY, error: e instanceof Error ? e.message : 'Не вдалося отримати перелік робіт.' });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, tick]);
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

// ---------------------------------------------------------------------------
// Інструкції
// ---------------------------------------------------------------------------

export const InstructionsBlock: React.FC<{
  state: MyWorksState;
  /** Інструкція, що лежить у цьому браузері (конструктор зберігає її локально). */
  localTitle: string | null;
  restoringId: string | null;
  error: string | null;
  onOpenExpress: (draftId: string) => void;
  onRestore: (phoneDraftId: string) => void;
  onOpenLocal: () => void;
  now?: Date;
}> = ({ state, localTitle, restoringId, error, onOpenExpress, onRestore, onOpenLocal, now }) => {
  const { t } = useLanguage();
  const items: MyInstruction[] = state.works?.instructions ?? [];
  const empty = !state.loading && items.length === 0 && !localTitle;
  return (
    <div className={cardCls} data-my-works-instructions>
      <div className="mb-4 flex items-center gap-2">
        <FileText className="h-4 w-4 text-emerald-400" />
        <h3 className={headCls}>{t('dashboard.myInstructionsHeading')}</h3>
      </div>
      {state.loading && <p className="text-sm text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{t('dashboard.myUsageLoading')}</p>}
      {state.error && <p className="text-sm text-rose-300" role="alert">{state.error}</p>}
      {error && <p className="mb-2 text-xs text-rose-300" role="alert">{error}</p>}
      {empty && !state.error && <p className="text-sm text-slate-500" data-my-works-empty>{t('dashboard.myInstructionsEmpty')}</p>}
      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {localTitle && (
          <div className={rowCls} data-my-instruction="local">
            <button type="button" onClick={onOpenLocal} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-100">{localTitle}</span>
                <span className="block text-[10px] text-slate-500">{t('dashboard.localInstructionHint')}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </button>
          </div>
        )}
        {items.map((it) => (
          <div key={`${it.origin}-${it.id}`} className={rowCls} data-my-instruction={it.origin}>
            <button
              type="button"
              onClick={() => (it.origin === 'express' ? onOpenExpress(it.id) : onRestore(it.id))}
              disabled={restoringId === it.id}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-wait"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-100">{it.title}</span>
                <span className="block text-[10px] text-slate-500">
                  {t('dashboard.stepsAndFrames', { steps: String(it.steps), frames: String(it.frames) })}
                  {it.phoneDraftId ? ' · 📱' : ''}
                  {it.expiresAt ? ` · ${t('dashboard.expiresAt', { when: whenLabel(it.expiresAt, now) })}` : ''}
                </span>
              </span>
              {it.origin === 'phone' ? (
                <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-amber-300">
                  {restoringId === it.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  {t('dashboard.restoreInstruction')}
                </span>
              ) : (
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              )}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">{t('dashboard.instructionsNote')}</p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Курси
// ---------------------------------------------------------------------------

export const CoursesBlock: React.FC<{
  state: MyWorksState;
  onOpenCourse: (courseId: string) => void;
}> = ({ state, onOpenCourse }) => {
  const { t } = useLanguage();
  const empty = !state.loading && !state.coursesLocked && state.courses.length === 0;
  return (
    <div className={cardCls} data-my-works-courses>
      <div className="mb-4 flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-cyan-400" />
        <h3 className={headCls}>{t('dashboard.myCoursesHeading')}</h3>
      </div>
      {state.loading && <p className="text-sm text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{t('dashboard.myUsageLoading')}</p>}
      {state.coursesLocked && <p className="text-sm text-slate-500" data-my-works-locked>{t('dashboard.myCoursesLocked')}</p>}
      {empty && !state.error && <p className="text-sm text-slate-500" data-my-works-empty>{t('dashboard.myCoursesEmpty')}</p>}
      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {state.courses.map((c) => (
          <div key={c.id} className={rowCls} data-my-course={c.id}>
            <button type="button" onClick={() => onOpenCourse(c.id)} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-100">{c.title}</span>
                <span className="block text-[10px] text-slate-500">
                  {COURSE_STATUS[c.status] ?? c.status} · {t('dashboard.modulesCount', { n: String(c.modules) })}
                  {c.fromPhone ? ' · 📱' : ''}
                  {c.shared ? ` · ${t('dashboard.sharedCourse')}` : ''}
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Чернетки з телефона
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<MyPhoneDraft['kind'], string> = {
  course: 'курс',
  instruction: 'інструкція',
  book: 'книга',
  manuscript: 'набір книги',
};
const STATUS_LABEL: Record<string, string> = { collecting: 'збір кадрів', structured: 'є структура', written: 'текст написано' };

export const PhoneDraftsBlock: React.FC<{ state: MyWorksState }> = ({ state }) => {
  const { t } = useLanguage();
  const drafts = state.works?.phoneDrafts ?? [];
  const url = state.works?.grabfusionUrl ?? null;
  return (
    <div className={cardCls} data-my-works-phone>
      <div className="mb-4 flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-violet-300" />
        <h3 className={headCls}>{t('dashboard.phoneDraftsHeading')}</h3>
      </div>
      {!state.loading && drafts.length === 0 && <p className="text-sm text-slate-500" data-my-works-empty>{t('dashboard.phoneDraftsEmpty')}</p>}
      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {drafts.map((d) => (
          <div key={d.id} className={rowCls} data-phone-draft={d.id}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-slate-100">{d.title}</span>
              <span className="block text-[10px] text-slate-500">
                {KIND_LABEL[d.kind] ?? d.kind} · {STATUS_LABEL[d.status] ?? d.status} · {t('dashboard.framesCount', { n: String(d.photoCount) })}
              </span>
            </span>
          </div>
        ))}
      </div>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" data-open-grabfusion className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/40 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/10">
          <Smartphone className="h-3.5 w-3.5" /> {t('dashboard.openGrabfusion')}
        </a>
      )}
    </div>
  );
};
