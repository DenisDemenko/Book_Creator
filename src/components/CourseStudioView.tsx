import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Store,
  Check,
  Loader2,
  Wand2,
  BookOpen,
  GraduationCap,
  ListChecks,
  X,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import {
  CourseAssignment,
  CourseLessonV2,
  CourseModuleV2,
  CourseSkillV2,
  CourseStatusV2,
  CourseV2,
} from '../types';

// ---------------------------------------------------------------------------
// Дрібні допоміжні функції
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: 'Сервер повернув не JSON.' };
  }
  if (!res.ok) {
    const err = body as { error?: string };
    throw new Error(err?.error || `Помилка ${res.status}`);
  }
  return body as T;
}

function emptyAssignment(): CourseAssignment {
  return { id: uid('as'), title: '', brief: '', steps: [], deliverable: '', acceptanceCriteria: [] };
}

function emptyLesson(): CourseLessonV2 {
  return { id: uid('le'), title: '', goal: '', description: '', topics: [], photoUrls: [] };
}

function emptyModule(): CourseModuleV2 {
  return { id: uid('mo'), title: '', summary: '', lessons: [], skillIds: [] };
}

function emptyCourse(): CourseV2 {
  return {
    id: '',
    ownerId: '',
    status: 'draft',
    title: 'Новий курс',
    audience: [],
    outcomes: [],
    highlights: ['', '', ''],
    skills: [],
    modules: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const STATUS_LABELS: Record<CourseStatusV2, string> = {
  draft: 'Чернетка',
  ready: 'Готовий',
  published: 'Опубліковано',
};

// ---------------------------------------------------------------------------
// Спільні дрібні редактори
// ---------------------------------------------------------------------------

/** Багаторядковий список: кожен рядок — елемент масиву. */
const LinesEditor: React.FC<{
  label: string;
  lines: string[];
  onChange: (lines: string[]) => void;
  placeholder?: string;
  min?: number;
}> = ({ label, lines, onChange, placeholder, min }) => {
  const value = lines.join('\n');
  return (
    <label className="block">
      <span className="text-[11px] text-slate-400 font-semibold">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        placeholder={placeholder}
        rows={Math.max(3, Math.min(8, value.split('\n').length + 1))}
        className="mt-1 w-full px-2.5 py-2 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-amber-400"
      />
      {min !== undefined && (
        <span className={`block text-[10px] mt-0.5 ${lines.filter(Boolean).length >= min ? 'text-slate-600' : 'text-amber-400'}`}>
          {lines.filter(Boolean).length}/{min}
        </span>
      )}
    </label>
  );
};

const AssignmentEditor: React.FC<{
  label: string;
  assignment: CourseAssignment | undefined;
  onChange: (a: CourseAssignment | undefined) => void;
  optional?: boolean;
}> = ({ label, assignment, onChange, optional }) => {
  const a = assignment;
  if (!a) {
    return (
      <div className="p-3 rounded-xl border border-dashed border-slate-700 text-center">
        <span className="text-[11px] text-slate-500">{label} — ще не створено.</span>
        <div className="mt-1.5">
          <button
            onClick={() => onChange(emptyAssignment())}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors"
          >
            + Додати завдання
          </button>
        </div>
      </div>
    );
  }
  const set = (patch: Partial<CourseAssignment>) => onChange({ ...a, ...patch });
  return (
    <div className="space-y-2.5 p-3 rounded-xl bg-slate-900/70 border border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400 font-semibold">{label}</span>
        {optional && (
          <button onClick={() => onChange(undefined)} className="text-[10px] text-slate-500 hover:text-rose-300 transition-colors">
            прибрати
          </button>
        )}
      </div>
      <input
        value={a.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder="Назва завдання"
        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 focus:outline-hidden focus:border-amber-400"
      />
      <textarea
        value={a.brief}
        onChange={(e) => set({ brief: e.target.value })}
        placeholder="Що зробити"
        rows={2}
        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 focus:outline-hidden focus:border-amber-400"
      />
      <LinesEditor label="Кроки" lines={a.steps} onChange={(steps) => set({ steps })} placeholder="По одному кроку на рядок" min={3} />
      <input
        value={a.deliverable}
        onChange={(e) => set({ deliverable: e.target.value })}
        placeholder="Що студент здає (файл / фото / текст)"
        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 focus:outline-hidden focus:border-amber-400"
      />
      <LinesEditor label="Критерії «зроблено правильно»" lines={a.acceptanceCriteria} onChange={(v) => set({ acceptanceCriteria: v })} min={3} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Готовність до публікації
// ---------------------------------------------------------------------------

function collectReadiness(course: CourseV2): string[] {
  const missing: string[] = [];
  if (!course.title.trim() || course.title === 'Новий курс') missing.push('Курс без назви.');
  if (!course.subtitle?.trim()) missing.push('Немає підзаголовка.');
  if (course.audience.filter(Boolean).length === 0) missing.push('Не описана аудиторія.');
  if (course.outcomes.filter(Boolean).length === 0) missing.push('Немає результатів навчання.');
  if (course.highlights.filter(Boolean).length < 3) missing.push('Менше трьох вигод на картку курсу.');
  if (course.skills.length === 0) missing.push('Немає навичок курсу.');
  if (course.modules.length === 0) missing.push('Немає жодного модуля.');

  course.modules.forEach((m, mi) => {
    const n = mi + 1;
    if (!m.title.trim()) missing.push(`Модуль ${n}: без назви.`);
    if (!m.summary?.trim()) missing.push(`Модуль ${n}: без опису.`);
    if (!m.coverPhotoUrl?.trim()) missing.push(`Модуль ${n}: немає фото.`);
    if (m.lessons.length === 0) missing.push(`Модуль ${n}: жодного уроку.`);
    if (!m.finalAssignment || m.finalAssignment.acceptanceCriteria.filter(Boolean).length === 0) {
      missing.push(`Модуль ${n}: немає підсумкового завдання з критеріями.`);
    }
    m.lessons.forEach((l, li) => {
      const label = `${n}.${li + 1}`;
      if (!l.title.trim()) missing.push(`Урок ${label}: без назви.`);
      if (!l.goal?.trim()) missing.push(`Урок ${label}: без мети.`);
      if (!l.description?.trim()) missing.push(`Урок ${label}: без опису.`);
      if (!l.assignment || l.assignment.acceptanceCriteria.filter(Boolean).length === 0) {
        missing.push(`Урок ${label}: немає завдання з критеріями.`);
      }
    });
  });

  return missing;
}

// ---------------------------------------------------------------------------
// Екран
// ---------------------------------------------------------------------------

export const CourseStudioView: React.FC<{ onOpenWizard?: () => void }> = ({ onOpenWizard }) => {
  const [courses, setCourses] = useState<CourseV2[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseV2 | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ type: 'course' | 'skill' | 'module' | 'lesson'; skillId?: string; moduleId?: string; lessonId?: string }>({ type: 'course' });

  const loadCourses = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ courses: CourseV2[] }>('/api/courses');
      setCourses(data.courses);
    } catch (e) {
      setError((e as Error).message);
      setCourses([]);
    }
  }, []);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  const openCourse = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const data = await api<{ course: CourseV2 }>(`/api/courses/${id}`);
        setCourse(data.course);
        setActiveId(id);
        setDirty(false);
        setSelection({ type: 'course' });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    []
  );

  const patch = useCallback((fn: (c: CourseV2) => CourseV2) => {
    setCourse((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (next !== prev) setDirty(true);
      return next;
    });
  }, []);

  const createCourse = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ course: CourseV2 }>('/api/courses', {
        method: 'POST',
        body: JSON.stringify({ title: 'Новий курс' }),
      });
      setCourse(data.course);
      setActiveId(data.course.id);
      setDirty(false);
      setSelection({ type: 'course' });
      setCourses((prev) => (prev ? [data.course, ...prev] : [data.course]));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const saveCourse = useCallback(async () => {
    if (!course) return;
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ course: CourseV2 }>(`/api/courses/${course.id}`, {
        method: 'PUT',
        body: JSON.stringify(course),
      });
      setCourse(data.course);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [course]);

  const publishCourse = useCallback(async () => {
    if (!course) return;
    setPublishing(true);
    setError(null);
    setSubmitted(false);
    try {
      // Спершу зберігаємо, щоб на модерацію поїхав останній стан курсу.
      const saved = await api<{ course: CourseV2 }>(`/api/courses/${course.id}`, {
        method: 'PUT',
        body: JSON.stringify(course),
      });
      setCourse(saved.course);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }));

      const res = await fetch(`/api/courses/${course.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const text = await res.text();
      let body: { submitted?: boolean; error?: string; problems?: string[] } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        body = {};
      }
      if (!res.ok) {
        const problems = Array.isArray(body.problems) ? body.problems : [];
        throw new Error(
          problems.length
            ? `${body.error || 'Курс не готовий до публікації'}: ${problems.join('; ')}`
            : body.error || `Помилка ${res.status}`
        );
      }
      setSubmitted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }, [course]);

  const deleteCourse = useCallback(async () => {
    if (!course || !window.confirm('Видалити курс без можливості відновлення?')) return;
    setError(null);
    try {
      await api(`/api/courses/${course.id}`, { method: 'DELETE' });
      setCourse(null);
      setActiveId(null);
      setDirty(false);
      void loadCourses();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [course, loadCourses]);

  const closeCourse = useCallback(() => {
    setCourse(null);
    setActiveId(null);
    setDirty(false);
  }, []);

  const readiness = useMemo(() => (course ? collectReadiness(course) : []), [course]);

  // -------- модифікатори структури --------
  const addModule = () => patch((c) => ({ ...c, modules: [...c.modules, emptyModule()] }));
  const addLesson = (moduleId: string) =>
    patch((c) => ({
      ...c,
      modules: c.modules.map((m) => (m.id === moduleId ? { ...m, lessons: [...m.lessons, emptyLesson()] } : m)),
    }));
  const addSkill = () =>
    patch((c) => ({
      ...c,
      skills: [
        ...c.skills,
        { id: uid('sk'), name: '', level: 'base', whyItMatters: '', howToDevelop: [], practiceIdeas: [] } satisfies CourseSkillV2,
      ],
    }));
  const removeModule = (moduleId: string) =>
    patch((c) => ({ ...c, modules: c.modules.filter((m) => m.id !== moduleId) }));
  const removeLesson = (moduleId: string, lessonId: string) =>
    patch((c) => ({
      ...c,
      modules: c.modules.map((m) => (m.id === moduleId ? { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) } : m)),
    }));
  const removeSkill = (skillId: string) =>
    patch((c) => ({
      ...c,
      skills: c.skills.filter((s) => s.id !== skillId),
      modules: c.modules.map((m) => ({ ...m, skillIds: m.skillIds.filter((id) => id !== skillId) })),
    }));
  const moveModule = (index: number, dir: -1 | 1) =>
    patch((c) => {
      const modules = [...c.modules];
      const j = index + dir;
      if (j < 0 || j >= modules.length) return c;
      [modules[index], modules[j]] = [modules[j], modules[index]];
      return { ...c, modules };
    });
  const moveLesson = (moduleId: string, index: number, dir: -1 | 1) =>
    patch((c) => ({
      ...c,
      modules: c.modules.map((m) => {
        if (m.id !== moduleId) return m;
        const lessons = [...m.lessons];
        const j = index + dir;
        if (j < 0 || j >= lessons.length) return m;
        [lessons[index], lessons[j]] = [lessons[j], lessons[index]];
        return { ...m, lessons };
      }),
    }));
  const patchModule = (moduleId: string, p: Partial<CourseModuleV2>) =>
    patch((c) => ({ ...c, modules: c.modules.map((m) => (m.id === moduleId ? { ...m, ...p } : m)) }));
  const patchLesson = (moduleId: string, lessonId: string, p: Partial<CourseLessonV2>) =>
    patch((c) => ({
      ...c,
      modules: c.modules.map((m) =>
        m.id === moduleId ? { ...m, lessons: m.lessons.map((l) => (l.id === lessonId ? { ...l, ...p } : l)) } : m
      ),
    }));
  const patchSkill = (skillId: string, p: Partial<CourseSkillV2>) =>
    patch((c) => ({ ...c, skills: c.skills.map((s) => (s.id === skillId ? { ...s, ...p } : s)) }));

  const selectedModule = course?.modules.find((m) => m.id === selection.moduleId) ?? null;
  const selectedLesson = selectedModule?.lessons.find((l) => l.id === selection.lessonId) ?? null;
  const selectedSkill = course?.skills.find((s) => s.id === selection.skillId) ?? null;

  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-amber-400';

  // ============================ Рендер ============================

  if (!courses) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Завантаження курсів…
      </div>
    );
  }

  if (!course) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Створити курс</h1>
            <p className="text-xs text-slate-400 mt-1">
              Самостійні навчальні курси: модулі, уроки, практика та готовність до публікації.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenWizard && (
              <button
                onClick={onOpenWizard}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all"
              >
                <Wand2 className="w-4 h-4" />
                Майстер (за 5 хвилин)
              </button>
            )}
            <button
              onClick={createCourse}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all"
            >
              <Plus className="w-4 h-4" />
              Новий курс
            </button>
            <button
              onClick={() => void loadCourses()}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 transition-all"
              title="Оновити список"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs">{error}</div>
        )}

        {courses.length === 0 ? (
          <div className="mt-10 text-center text-slate-500 text-sm py-16 border border-dashed border-slate-800 rounded-2xl">
            Курсів ще немає. Створіть перший вручну або через майстер.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => void openCourse(c.id)}
                className="text-left p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-400/40 transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-100 truncate">{c.title}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                    c.status === 'published'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : c.status === 'ready'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500">
                  {c.modules.length} модулів · {c.modules.reduce((n, m) => n + m.lessons.length, 0)} уроків
                </div>
                <div className="mt-1 text-[10px] text-slate-600 font-mono">
                  оновлено {new Date(c.updatedAt).toLocaleDateString('uk-UA')}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0 flex flex-col px-4 py-4 gap-3">
      {/* Верхня панель */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={closeCourse}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 transition-all shrink-0"
          title="До списку курсів"
        >
          <X className="w-4 h-4" />
        </button>
        <input
          value={course.title}
          onChange={(e) => patch((c) => ({ ...c, title: e.target.value }))}
          className="flex-1 min-w-[180px] max-w-sm px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-bold text-slate-100 focus:outline-hidden focus:border-amber-400"
        />
        <select
          value={course.status}
          onChange={(e) => patch((c) => ({ ...c, status: e.target.value as CourseStatusV2 }))}
          className="px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-hidden"
        >
          <option value="draft">Чернетка</option>
          <option value="ready">Готовий</option>
          <option value="published">Опубліковано</option>
        </select>
        <button
          onClick={() => void saveCourse()}
          disabled={saving || !dirty}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
            dirty
              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : dirty ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? 'Збереження…' : dirty ? 'Зберегти' : savedAt ? `Збережено ${savedAt}` : 'Збережено'}
        </button>
        <button
          onClick={() => void publishCourse()}
          disabled={publishing || saving}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
            publishing || saving
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
          title="Надіслати курс на модерацію — адміністратор погодить публікацію у вітрину"
        >
          {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />}
          {publishing ? 'Публікація…' : 'Опублікувати'}
        </button>
        <button
          onClick={() => void deleteCourse()}
          className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 transition-all"
          title="Видалити курс"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs">{error}</div>
      )}

      {submitted && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Курс надіслано на модерацію. Адміністратор має погодити публікацію у вітрину —
            після цього курс зʼявиться в каталозі.
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-3">
        {/* ---------- Дерево курсу ---------- */}
        <div className="min-h-0 flex flex-col rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Дерево курсу</span>
            <div className="flex items-center gap-1">
              <button onClick={addModule} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors">
                + Модуль
              </button>
              <button onClick={addSkill} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors">
                + Навичка
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            <button
              onClick={() => setSelection({ type: 'course' })}
              className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors ${
                selection.type === 'course' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'text-slate-300 hover:bg-white/[0.04]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Про курс
            </button>
            <button
              onClick={() => setSelection({ type: 'skill' })}
              className={`w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors ${
                selection.type === 'skill' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'text-slate-300 hover:bg-white/[0.04]'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" /> Навички ({course.skills.length})
            </button>

            {course.modules.map((m, mi) => (
              <div key={m.id} className="pl-1">
                <div className="flex items-center gap-1 group">
                  <button
                    onClick={() => setSelection({ type: 'module', moduleId: m.id })}
                    className={`flex-1 text-left px-2 py-1.5 rounded-lg text-xs font-semibold truncate transition-colors ${
                      selection.type === 'module' && selection.moduleId === m.id
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'text-slate-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    {mi + 1}. {m.title || 'Без назви'}
                  </button>
                  <span className="hidden group-hover:flex items-center gap-0.5">
                    <button onClick={() => moveModule(mi, -1)} className="p-1 text-slate-500 hover:text-slate-200" title="Вгору">
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => moveModule(mi, 1)} className="p-1 text-slate-500 hover:text-slate-200" title="Вниз">
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button onClick={() => removeModule(m.id)} className="p-1 text-slate-500 hover:text-rose-300" title="Видалити">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                </div>
                <div className="pl-3 space-y-0.5 mt-0.5">
                  {m.lessons.map((l, li) => (
                    <div key={l.id} className="flex items-center gap-1 group">
                      <button
                        onClick={() => setSelection({ type: 'lesson', moduleId: m.id, lessonId: l.id })}
                        className={`flex-1 text-left px-2 py-1 rounded-lg text-[11px] truncate transition-colors ${
                          selection.type === 'lesson' && selection.lessonId === l.id
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                        }`}
                      >
                        {mi + 1}.{li + 1} {l.title || 'Без назви'}
                      </button>
                      <span className="hidden group-hover:flex items-center gap-0.5">
                        <button onClick={() => moveLesson(m.id, li, -1)} className="p-1 text-slate-500 hover:text-slate-200" title="Вгору">
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button onClick={() => moveLesson(m.id, li, 1)} className="p-1 text-slate-500 hover:text-slate-200" title="Вниз">
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button onClick={() => removeLesson(m.id, l.id)} className="p-1 text-slate-500 hover:text-rose-300" title="Видалити">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                  ))}
                  <button
                    onClick={() => addLesson(m.id)}
                    className="text-[10px] text-slate-500 hover:text-amber-300 transition-colors px-2 py-0.5"
                  >
                    + Урок
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------- Редактор вибраного ---------- */}
        <div className="min-h-0 overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
          {selection.type === 'course' && (
            <>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Про курс</h3>
              <input value={course.subtitle ?? ''} onChange={(e) => patch((c) => ({ ...c, subtitle: e.target.value }))} placeholder="Підзаголовок" className={inputCls} />
              <textarea
                value={course.summary ?? ''}
                onChange={(e) => patch((c) => ({ ...c, summary: e.target.value }))}
                placeholder="Короткий опис (для картки)"
                rows={2}
                className={inputCls}
              />
              <textarea
                value={course.description ?? ''}
                onChange={(e) => patch((c) => ({ ...c, description: e.target.value }))}
                placeholder="Повний опис"
                rows={4}
                className={inputCls}
              />
              <LinesEditor label="Аудиторія (по одному на рядок)" lines={course.audience} onChange={(audience) => patch((c) => ({ ...c, audience }))} min={1} />
              <LinesEditor label="Результати навчання" lines={course.outcomes} onChange={(outcomes) => patch((c) => ({ ...c, outcomes }))} min={1} />
              <LinesEditor label="Три вигоди на картку" lines={course.highlights} onChange={(highlights) => patch((c) => ({ ...c, highlights }))} min={3} />
              <input value={course.coverUrl ?? ''} onChange={(e) => patch((c) => ({ ...c, coverUrl: e.target.value }))} placeholder="Обкладинка (URL)" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <input value={course.category ?? ''} onChange={(e) => patch((c) => ({ ...c, category: e.target.value }))} placeholder="Категорія" className={inputCls} />
                <input
                  type="number"
                  value={course.priceMinor ?? ''}
                  onChange={(e) => patch((c) => ({ ...c, priceMinor: e.target.value ? Number(e.target.value) : undefined }))}
                  placeholder="Ціна (мінори)"
                  className={inputCls}
                />
              </div>
              <input value={course.currency ?? ''} onChange={(e) => patch((c) => ({ ...c, currency: e.target.value }))} placeholder="Валюта (UAH)" className={inputCls} />
            </>
          )}

          {selection.type === 'skill' && (
            <>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Навички курсу</h3>
              {course.skills.length === 0 && (
                <p className="text-xs text-slate-500">Навичок ще немає — додайте вручну або через майстер.</p>
              )}
              {course.skills.map((s) => (
                <div key={s.id} className="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <input
                      value={s.name}
                      onChange={(e) => patchSkill(s.id, { name: e.target.value })}
                      placeholder="Назва навички"
                      className={`${inputCls} flex-1`}
                    />
                    <select value={s.level} onChange={(e) => patchSkill(s.id, { level: e.target.value as CourseSkillV2['level'] })} className={inputCls + ' w-28'}>
                      <option value="base">Базова</option>
                      <option value="confident">Впевнена</option>
                      <option value="pro">Pro</option>
                    </select>
                    <button onClick={() => removeSkill(s.id)} className="p-1.5 text-slate-500 hover:text-rose-300 transition-colors" title="Видалити">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input value={s.whyItMatters} onChange={(e) => patchSkill(s.id, { whyItMatters: e.target.value })} placeholder="Навіщо в ремеслі" className={inputCls} />
                  <LinesEditor label="Як розвивати" lines={s.howToDevelop} onChange={(howToDevelop) => patchSkill(s.id, { howToDevelop })} />
                  <LinesEditor label="Вправи поза курсом" lines={s.practiceIdeas} onChange={(practiceIdeas) => patchSkill(s.id, { practiceIdeas })} />
                </div>
              ))}
              <button onClick={addSkill} className="w-full py-2 rounded-xl border border-dashed border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-400/40 text-xs font-semibold transition-colors">
                + Навичка
              </button>
            </>
          )}

          {selection.type === 'module' && selectedModule && (
            <>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Модуль</h3>
              <input value={selectedModule.title} onChange={(e) => patchModule(selectedModule.id, { title: e.target.value })} placeholder="Назва модуля" className={inputCls} />
              <textarea value={selectedModule.summary ?? ''} onChange={(e) => patchModule(selectedModule.id, { summary: e.target.value })} placeholder="Опис модуля" rows={3} className={inputCls} />
              <input value={selectedModule.coverPhotoUrl ?? ''} onChange={(e) => patchModule(selectedModule.id, { coverPhotoUrl: e.target.value })} placeholder="Фото модуля (URL)" className={inputCls} />
              <input value={selectedModule.introVideoUrl ?? ''} onChange={(e) => patchModule(selectedModule.id, { introVideoUrl: e.target.value })} placeholder="Оглядове відео (YouTube/Vimeo URL)" className={inputCls} />
              <div>
                <span className="text-[11px] text-slate-400 font-semibold">Які навички розвиває модуль</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {course.skills.map((s) => {
                    const on = selectedModule.skillIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() =>
                          patchModule(selectedModule.id, {
                            skillIds: on ? selectedModule.skillIds.filter((id) => id !== s.id) : [...selectedModule.skillIds, s.id],
                          })
                        }
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                          on ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {s.name || 'Без назви'}
                      </button>
                    );
                  })}
                </div>
              </div>
              <AssignmentEditor
                label="Підсумкове завдання модуля"
                assignment={selectedModule.finalAssignment}
                onChange={(finalAssignment) => patchModule(selectedModule.id, { finalAssignment })}
                optional
              />
            </>
          )}

          {selection.type === 'lesson' && selectedModule && selectedLesson && (
            <>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Урок</h3>
              <input value={selectedLesson.title} onChange={(e) => patchLesson(selectedModule.id, selectedLesson.id, { title: e.target.value })} placeholder="Назва уроку" className={inputCls} />
              <input value={selectedLesson.goal ?? ''} onChange={(e) => patchLesson(selectedModule.id, selectedLesson.id, { goal: e.target.value })} placeholder="Мета одним реченням" className={inputCls} />
              <textarea value={selectedLesson.description ?? ''} onChange={(e) => patchLesson(selectedModule.id, selectedLesson.id, { description: e.target.value })} placeholder="Опис уроку" rows={3} className={inputCls} />
              <LinesEditor label="Зміст уроку" lines={selectedLesson.topics} onChange={(topics) => patchLesson(selectedModule.id, selectedLesson.id, { topics })} />
              <input value={selectedLesson.videoUrl ?? ''} onChange={(e) => patchLesson(selectedModule.id, selectedLesson.id, { videoUrl: e.target.value })} placeholder="Відео уроку (YouTube/Vimeo URL)" className={inputCls} />
              <LinesEditor label="Фото уроку (URL, по одному на рядок)" lines={selectedLesson.photoUrls} onChange={(photoUrls) => patchLesson(selectedModule.id, selectedLesson.id, { photoUrls })} />
              <input
                type="number"
                value={selectedLesson.durationMin ?? ''}
                onChange={(e) => patchLesson(selectedModule.id, selectedLesson.id, { durationMin: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Тривалість, хв"
                className={inputCls}
              />
              <AssignmentEditor
                label="Завдання уроку"
                assignment={selectedLesson.assignment}
                onChange={(assignment) => patchLesson(selectedModule.id, selectedLesson.id, { assignment })}
                optional
              />
            </>
          )}
        </div>

        {/* ---------- Готовність ---------- */}
        <div className="min-h-0 flex flex-col rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-amber-400" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Готовність</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {readiness.length === 0 ? (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                Курс повний — можна позначати «Готовий».
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-amber-300 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  Бракує: {readiness.length}
                </div>
                <ul className="space-y-1.5">
                  {readiness.map((item, i) => (
                    <li key={i} className="text-[11px] text-slate-400 leading-relaxed border-l-2 border-amber-500/40 pl-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
