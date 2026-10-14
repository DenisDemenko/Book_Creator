import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, GraduationCap, Loader2, Palette, RefreshCw } from 'lucide-react';
import type { CourseV2 } from '../types';
import { CourseEducationalDesignPanel } from './CourseEducationalDesignPanel';
import { CourseStudioView as LegacyCourseStudioView } from './CourseStudioLegacy';

interface CourseStudioViewProps {
  onOpenWizard?: () => void;
  initialCourseId?: string | null;
  lang?: 'uk' | 'en';
}

type WorkspaceMode = 'course' | 'design';

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: 'Сервер повернув не JSON.' };
  }
  if (!response.ok) {
    throw new Error((body as { error?: string })?.error || `Помилка ${response.status}`);
  }
  return body as T;
}

/**
 * Additive shell around the existing Course Studio.
 *
 * The original editor is preserved in CourseStudioLegacy.tsx byte-for-byte.
 * Educational design is a sibling workspace, not a replacement of course
 * authoring: CourseV2 remains the single source of truth and design choices
 * are stored separately by CourseEducationalDesignPanel.
 */
export const CourseStudioView: React.FC<CourseStudioViewProps> = ({
  onOpenWizard,
  initialCourseId = null,
  lang = 'uk',
}) => {
  const [mode, setMode] = useState<WorkspaceMode>('course');
  const [courses, setCourses] = useState<CourseV2[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialCourseId);
  const [selectedCourse, setSelectedCourse] = useState<CourseV2 | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const L = useCallback((uk: string, en: string) => (lang === 'en' ? en : uk), [lang]);

  const loadCourses = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const data = await api<{ courses?: CourseV2[]; shared?: CourseV2[] }>('/api/courses');
      const map = new Map<string, CourseV2>();
      [...(data.courses || []), ...(data.shared || [])].forEach((course) => map.set(course.id, course));
      const merged = [...map.values()];
      setCourses(merged);
      setSelectedId((current) => current || initialCourseId || merged[0]?.id || null);
    } catch (cause) {
      setCourses([]);
      setError(cause instanceof Error ? cause.message : L('Не вдалося завантажити курси.', 'Could not load courses.'));
    } finally {
      setCoursesLoaded(true);
      setLoadingList(false);
    }
  }, [L, initialCourseId]);

  useEffect(() => {
    if (mode === 'design' && !coursesLoaded && !loadingList) void loadCourses();
  }, [mode, coursesLoaded, loadingList, loadCourses]);

  useEffect(() => {
    if (initialCourseId) setSelectedId(initialCourseId);
  }, [initialCourseId]);

  useEffect(() => {
    if (mode !== 'design' || !selectedId) {
      if (!selectedId) setSelectedCourse(null);
      return;
    }
    let cancelled = false;
    setLoadingCourse(true);
    setError(null);
    void api<{ course: CourseV2 }>(`/api/courses/${selectedId}`)
      .then((data) => {
        if (!cancelled) setSelectedCourse(data.course);
      })
      .catch((cause) => {
        if (!cancelled) {
          setSelectedCourse(null);
          setError(cause instanceof Error ? cause.message : L('Не вдалося відкрити курс.', 'Could not open course.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCourse(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedId, L]);

  const selectedSummary = useMemo(
    () => courses.find((item) => item.id === selectedId) || selectedCourse,
    [courses, selectedCourse, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-course-studio-workspace={mode}>
      <div className="shrink-0 border-b border-slate-800 bg-slate-950/80 px-4 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('course')}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                mode === 'course'
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="h-4 w-4" />
              {L('Курс і зміст', 'Course content')}
            </button>
            <button
              type="button"
              onClick={() => setMode('design')}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                mode === 'design'
                  ? 'border-violet-500/50 bg-violet-500/10 text-violet-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
              data-course-design-tab
            >
              <Palette className="h-4 w-4" />
              {L('Дизайн навчальних матеріалів', 'Educational materials design')}
            </button>
          </div>
          <div className="hidden items-center gap-2 text-[10px] text-slate-500 md:flex">
            <GraduationCap className="h-3.5 w-3.5" />
            {L('Зміст курсу не дублюється: дизайн працює як окреме представлення.', 'Course content is not duplicated: design is a separate presentation layer.')}
          </div>
        </div>
      </div>

      {mode === 'course' ? (
        <div className="min-h-0 flex-1">
          <LegacyCourseStudioView onOpenWizard={onOpenWizard} initialCourseId={initialCourseId} lang={lang} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto w-full max-w-7xl space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[260px] flex-1">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {L('Курс-джерело', 'Source course')}
                  </span>
                  <select
                    value={selectedId || ''}
                    onChange={(event) => setSelectedId(event.target.value || null)}
                    disabled={loadingList}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                  >
                    {!selectedId ? <option value="">{L('Оберіть курс', 'Choose a course')}</option> : null}
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>{course.title}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void loadCourses()}
                  disabled={loadingList}
                  className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {L('Оновити', 'Refresh')}
                </button>
              </div>
              {selectedSummary ? (
                <p className="mt-2 text-[11px] text-slate-500">
                  {selectedSummary.modules.length} {L('модулів', 'modules')} · {selectedSummary.modules.reduce((sum, module) => sum + module.lessons.length, 0)} {L('уроків', 'lessons')}
                </p>
              ) : null}
              {error ? <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div> : null}
            </div>

            {loadingCourse ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 py-24 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> {L('Відкриваю дизайн курсу…', 'Opening course design…')}
              </div>
            ) : selectedCourse ? (
              <CourseEducationalDesignPanel course={selectedCourse} />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 py-20 text-center text-sm text-slate-500">
                {L('Оберіть курс — тут з’являться 9 шаблонів методичок, інструкцій і робочих аркушів.', 'Choose a course to see the 9 methodic, instruction, and worksheet templates.')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
