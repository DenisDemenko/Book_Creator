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
import {
  GRADUATE_SELLING_LABELS,
  GRADUATE_SELLING_MODES,
  courseSubmitProblems,
  lessonDurationProblem,
  normalizeGraduateSelling,
  videoUrlProblem,
} from '../utils/coursePublishRules';
import { parsePriceMinor } from './adminOs/priceInput';
import CourseGraduateStats from './CourseGraduateStats';
import { PickFromMediaLibraryModal } from './PickFromMediaLibraryModal';

/** Останнє рішення модерації щодо курсу — з `GET /api/courses/:id`. */
interface CourseModerationInfo {
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  reason?: string;
  createdAt: string;
  decidedAt?: string;
}

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
  // «Готовий» тепер означає «подано й чекає на модерацію»: статус виводиться
  // з черги, автор його не обирає.
  ready: 'На модерації',
  published: 'Опубліковано',
};

/**
 * Ціна в ГРИВНЯХ, а зберігається в копійках. Раніше поле було «Ціна (мінори)»:
 * автор писав 1500, маючи на увазі гривні, і курс коштував 15 грн.
 * Некоректний ввід (порожньо, «abc», «1,5,0») дає «ціну не задано», а не 0.
 */
const PriceUahInput: React.FC<{
  priceMinor?: number;
  disabled?: boolean;
  className: string;
  onChange: (priceMinor: number | undefined) => void;
}> = ({ priceMinor, disabled, className, onChange }) => {
  const shown = (m?: number) => (m && m > 0 ? String(m / 100) : '');
  const [raw, setRaw] = useState(shown(priceMinor));
  useEffect(() => {
    // Синхронізація лише коли ціна змінилась ззовні (інший курс), а не з
    // нашого ж вводу — інакше «99,» стерлося б посеред набору.
    setRaw((current) => (parsePriceMinor(current) === (priceMinor ?? null) ? current : shown(priceMinor)));
  }, [priceMinor]);
  const invalid = raw.trim() !== '' && parsePriceMinor(raw) === null;
  return (
    <span className="block">
      <input
        value={disabled ? '0' : raw}
        disabled={disabled}
        onChange={(e) => {
          setRaw(e.target.value);
          const minor = parsePriceMinor(e.target.value);
          onChange(minor === null ? undefined : minor);
        }}
        placeholder="Ціна, грн"
        inputMode="decimal"
        className={`${className} disabled:opacity-50`}
      />
      {invalid && <span className="block text-[10px] text-rose-300 mt-0.5">Потрібне число гривень, напр. 1500 або 99,50.</span>}
    </span>
  );
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

/**
 * Готовність у двох частинах: `blocking` — ті самі правила, що перевіряє
 * сервер при поданні й погодженні (coursePublishRules), `polish` — те, що
 * редактор радить доробити, але подання не зупиняє.
 */
function collectReadiness(course: CourseV2, categoryRequired = false): { blocking: string[]; polish: string[] } {
  const blocking = courseSubmitProblems(course, { categoryRequired });
  const missing: string[] = [];

  course.modules.forEach((m, mi) => {
    const n = mi + 1;
    if (!m.summary?.trim()) missing.push(`Модуль ${n}: без опису.`);
    if (!m.coverPhotoUrl?.trim()) missing.push(`Модуль ${n}: немає фото.`);
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

  return { blocking, polish: missing };
}

// ---------------------------------------------------------------------------
// Екран
// ---------------------------------------------------------------------------

export const CourseStudioView: React.FC<{ onOpenWizard?: () => void; initialCourseId?: string | null; lang?: 'uk' | 'en' }> = ({ onOpenWizard, initialCourseId = null, lang = 'uk' }) => {
  const [courses, setCourses] = useState<CourseV2[] | null>(null);
  /** Т6.3: чужі курси, де людина — співавтор за наданим доступом. */
  const [shared, setShared] = useState<CourseV2[]>([]);
  const [canAuthor, setCanAuthor] = useState(true);
  /** Доступ до відкритого курсу: власник / адмін — manage, співавтор — edit чи view. */
  const [access, setAccess] = useState<'manage' | 'edit' | 'view'>('manage');
  const L = (uk: string, en: string) => (lang === 'en' ? en : uk);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseV2 | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [moderation, setModeration] = useState<CourseModerationInfo | null>(null);
  // Категорії вітрини — справжній перелік маркетплейсу, а не вільний текст.
  const [storefrontCategories, setStorefrontCategories] = useState<Array<{ slug: string; name: string }>>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/courses/storefront-categories', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && Array.isArray(data?.categories)) setStorefrontCategories(data.categories);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ type: 'course' | 'skill' | 'module' | 'lesson'; skillId?: string; moduleId?: string; lessonId?: string }>({ type: 'course' });
  // Вікно вибору фото з медіатеки: що саме робити з обраним посиланням, знає місце виклику.
  const [picker, setPicker] = useState<{ onPick: (url: string) => void } | null>(null);

  const loadCourses = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ courses: CourseV2[]; shared?: CourseV2[]; canAuthor?: boolean }>('/api/courses');
      setCourses(data.courses);
      setShared(data.shared ?? []);
      setCanAuthor(data.canAuthor !== false);
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
        const data = await api<{ course: CourseV2; access?: 'manage' | 'edit' | 'view'; moderation?: CourseModerationInfo | null }>(`/api/courses/${id}`);
        setCourse(data.course);
        setModeration(data.moderation ?? null);
        setSubmitted(false);
        setAccess(data.access ?? 'manage');
        setActiveId(id);
        setDirty(false);
        setSelection({ type: 'course' });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    []
  );

  // Т6.3: «Відкрити у Студії» спільний курс — одразу на ньому.
  useEffect(() => {
    if (initialCourseId) void openCourse(initialCourseId);
  }, [initialCourseId, openCourse]);

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
      setModeration(null);
      setAccess('manage');
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
      let body: { submitted?: boolean; error?: string; problems?: string[]; course?: CourseV2; moderation?: CourseModerationInfo } = {};
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
      if (body.course) setCourse(body.course);
      if (body.moderation) setModeration(body.moderation);
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

  const readiness = useMemo(
    () => (course ? collectReadiness(course, storefrontCategories.length > 0) : { blocking: [], polish: [] }),
    [course, storefrontCategories.length]
  );

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

  /**
   * Кнопка «З медіатеки». Фото з медіатеки Студії при публікації їдуть у вітрину
   * файлами (`courseMediaSync`): обкладинка — публічна, фото модуля й уроку —
   * лише для покупців. Посилання http(s) працюють, як і раніше.
   */
  const libraryButton = (onPick: (url: string) => void, label = 'З медіатеки') => (
    <button
      type="button"
      onClick={() => setPicker({ onPick })}
      className="shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-700 text-[11px] font-semibold text-amber-300 hover:border-amber-400"
    >
      {label}
    </button>
  );

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
            {canAuthor && onOpenWizard && (
              <button
                onClick={onOpenWizard}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all"
              >
                <Wand2 className="w-4 h-4" />
                Майстер (за 5 хвилин)
              </button>
            )}
            {canAuthor && <button
              onClick={createCourse}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all"
            >
              <Plus className="w-4 h-4" />
              Новий курс
            </button>}
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

        {shared.length > 0 && (
          <section className="mt-5" data-course-shared>
            <h2 className="text-xs font-bold uppercase tracking-wide text-sky-300">{L('Спільні курси — ви співавтор', 'Shared courses — you are a co-author')}</h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shared.map((c) => (
                <button key={c.id} onClick={() => void openCourse(c.id)} className="text-left p-4 rounded-2xl bg-slate-900 border border-sky-500/30 hover:border-sky-400/60 transition-all" data-course-shared-item={c.id}>
                  <span className="text-sm font-bold text-slate-100 truncate block">{c.title}</span>
                  <div className="mt-1.5 text-[11px] text-slate-500">
                    {c.modules.length} модулів · {c.modules.reduce((n, m) => n + m.lessons.length, 0)} уроків
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {courses.length === 0 && shared.length > 0 ? null : courses.length === 0 ? (
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
        {/* Статус не обирається: його виставляє модерація. */}
        <span
          data-course-status={course.status}
          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border ${
            course.status === 'published'
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              : course.status === 'ready'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}
        >
          {STATUS_LABELS[course.status]}
        </span>
        {access !== 'manage' && (
          <span className="px-2 py-1 rounded-full text-[10px] font-bold border border-sky-500/40 bg-sky-500/10 text-sky-200" data-course-access={access}>
            {access === 'edit' ? L('Співавтор · редагування', 'Co-author · edit') : L('Лише перегляд', 'View only')}
          </span>
        )}
        <button
          onClick={() => void saveCourse()}
          disabled={saving || !dirty || access === 'view'}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
            dirty
              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : dirty ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? 'Збереження…' : dirty ? 'Зберегти' : savedAt ? `Збережено ${savedAt}` : 'Збережено'}
        </button>
        {access === 'manage' && (<>
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
          {publishing
            ? 'Надсилаю…'
            : course.status === 'published'
              ? 'Надіслати оновлення на модерацію'
              : 'Надіслати на модерацію'}
        </button>
        <button
          onClick={() => void deleteCourse()}
          className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 transition-all"
          title="Видалити курс"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        </>)}
      </div>

      {error && (
        <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs">{error}</div>
      )}

      {moderation?.status === 'pending' && (
        <div data-course-moderation="pending" className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {submitted ? 'Курс надіслано на модерацію. ' : `На модерації з ${new Date(moderation.createdAt).toLocaleDateString('uk-UA')}. `}
            Адміністратор погоджує версію, яку ви подали. Якщо щось виправите до рішення — надішліть курс ще раз, і розглядатиметься свіжа версія.
          </span>
        </div>
      )}
      {moderation?.status === 'changes_requested' && (
        <div data-course-moderation="changes_requested" className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Модератор повернув курс із зауваженнями{moderation.decidedAt ? ` (${new Date(moderation.decidedAt).toLocaleDateString('uk-UA')})` : ''}:
            {' '}<b>{moderation.reason || '—'}</b> Виправте курс і надішліть на модерацію ще раз — це той самий курс, нового створювати не треба.
          </span>
        </div>
      )}
      {moderation?.status === 'rejected' && (
        <div data-course-moderation="rejected" className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Модерацію не пройдено{moderation.decidedAt ? ` (${new Date(moderation.decidedAt).toLocaleDateString('uk-UA')})` : ''}.
            {moderation.reason ? <> Причина: <b>{moderation.reason}</b>.</> : null} Виправте курс і надішліть ще раз.
          </span>
        </div>
      )}
      {course.status === 'published' && moderation?.status !== 'pending' && (
        <div data-course-moderation="published" className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs">
          Курс у вітрині. Правки потраплять туди лише після повторного надсилання на модерацію.
        </div>
      )}
      {course.status === 'published' && <CourseGraduateStats courseId={course.id} />}

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
              <div className="flex gap-2">
                <input value={course.coverUrl ?? ''} onChange={(e) => patch((c) => ({ ...c, coverUrl: e.target.value }))} placeholder="Обкладинка (URL або з медіатеки)" className={inputCls} />
                {libraryButton((url) => patch((c) => ({ ...c, coverUrl: url })))}
              </div>
              {/*
                Картка без обкладинки у каталозі — порожній прямокутник, і
                саме це власник назвав «книга на вітрині без фотографій»
                (запис #168). Публікація тепер таку картку не створює, і
                краще сказати про це ТУТ, ніж відмовити на кнопці.
              */}
              <p className="text-[11px] text-slate-500 -mt-1">
                Без обкладинки публікація не піде: у каталозі картка буде порожнім прямокутником.
                Дайте посилання на зображення або оберіть фото з медіатеки (JPEG, PNG, WebP або AVIF — інші формати вітрина не прийме).
              </p>
              <label className="block">
                <span className="text-[11px] text-slate-400 font-semibold">Категорія у вітрині</span>
                <select
                  value={course.categorySlug ?? ''}
                  onChange={(e) => patch((c) => ({ ...c, categorySlug: e.target.value }))}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">{storefrontCategories.length > 0 ? 'Оберіть категорію…' : 'Без категорії'}</option>
                  {storefrontCategories.map((cat) => (
                    <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                  ))}
                </select>
                {course.category && course.categorySlug === undefined && (
                  <span className="block text-[10px] text-amber-300 mt-0.5">
                    Стара категорія «{course.category}» — оберіть відповідну зі списку вітрини.
                  </span>
                )}
                {storefrontCategories.length === 0 && (
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    Перелік категорій вітрини недоступний — поки він не з'явиться, категорія не вимагається.
                  </span>
                )}
              </label>
              <label className="block sm:col-span-2">
                <span className="text-[11px] text-slate-400 font-semibold">Продаж робіт студентів</span>
                <select
                  value={normalizeGraduateSelling(course.graduateSelling)}
                  onChange={(e) => patch((c) => ({ ...c, graduateSelling: e.target.value as CourseV2['graduateSelling'] }))}
                  className={`${inputCls} mt-1`}
                >
                  {GRADUATE_SELLING_MODES.map((mode) => (
                    <option key={mode} value={mode}>{GRADUATE_SELLING_LABELS[mode]}</option>
                  ))}
                </select>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  Чи можуть студенти цього курсу виставити на продаж у маркетплейсі власну роботу, зроблену під час навчання, і з якого моменту.
                </span>
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400 font-semibold">Ціна, грн</span>
                <span className="mt-1 block">
                  <PriceUahInput
                    priceMinor={course.priceMinor}
                    disabled={course.free === true}
                    className={inputCls}
                    // null, а не undefined: курс зберігається цілим JSON-ом, і
                    // undefined просто випав би з тіла — стерта ціна лишилась би на сервері.
                    onChange={(priceMinor) => patch((c) => ({ ...c, priceMinor: priceMinor ?? null }))}
                  />
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={course.free === true}
                    onChange={(e) =>
                      patch((c) => ({ ...c, free: e.target.checked, priceMinor: e.target.checked ? 0 : null }))
                    }
                  />
                  Безкоштовний (кожен забере курс у кабінеті без оплати)
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">Оплата у вітрині — лише в гривнях.</span>
              </label>
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
              <div className="flex gap-2">
                <input value={selectedModule.coverPhotoUrl ?? ''} onChange={(e) => patchModule(selectedModule.id, { coverPhotoUrl: e.target.value })} placeholder="Фото модуля (URL або з медіатеки)" className={inputCls} />
                {libraryButton((url) => patchModule(selectedModule.id, { coverPhotoUrl: url }))}
              </div>
              <input value={selectedModule.introVideoUrl ?? ''} onChange={(e) => patchModule(selectedModule.id, { introVideoUrl: e.target.value })} placeholder="Оглядове відео (YouTube/Vimeo URL)" className={inputCls} />
              {videoUrlProblem(selectedModule.introVideoUrl) && (
                <span className="block text-[10px] text-rose-300 -mt-1">Відео: {videoUrlProblem(selectedModule.introVideoUrl)}.</span>
              )}
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
              {videoUrlProblem(selectedLesson.videoUrl) && (
                <span className="block text-[10px] text-rose-300 -mt-1">Відео: {videoUrlProblem(selectedLesson.videoUrl)}.</span>
              )}
              <LinesEditor label="Фото уроку (URL, по одному на рядок)" lines={selectedLesson.photoUrls} onChange={(photoUrls) => patchLesson(selectedModule.id, selectedLesson.id, { photoUrls })} />
              <div className="flex items-center gap-2 -mt-1">
                {libraryButton(
                  (url) => patchLesson(selectedModule.id, selectedLesson.id, { photoUrls: [...selectedLesson.photoUrls.filter(Boolean), url] }),
                  'Додати фото з медіатеки'
                )}
                <span className="text-[10px] text-slate-500 leading-snug">Фото з медіатеки покупець бачить у уроці лише після оплати.</span>
              </div>
              <input
                type="number"
                value={selectedLesson.durationMin ?? ''}
                onChange={(e) => patchLesson(selectedModule.id, selectedLesson.id, { durationMin: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Тривалість, хв"
                min={1}
                step={1}
                className={inputCls}
              />
              {lessonDurationProblem(selectedLesson.durationMin) && (
                <span className="block text-[10px] text-rose-300 -mt-1">Тривалість: {lessonDurationProblem(selectedLesson.durationMin)}.</span>
              )}
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
            {readiness.blocking.length === 0 && readiness.polish.length === 0 ? (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                Курс повний — можна надсилати на модерацію.
              </div>
            ) : (
              <>
                {readiness.blocking.length > 0 && (
                  <div className="mb-3" data-readiness="blocking">
                    <div className="flex items-center gap-2 text-xs text-rose-300 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Без цього не подати: {readiness.blocking.length}
                    </div>
                    <ul className="space-y-1.5">
                      {readiness.blocking.map((item, i) => (
                        <li key={i} className="text-[11px] text-slate-300 leading-relaxed border-l-2 border-rose-500/50 pl-2">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {readiness.polish.length > 0 && (
                  <div data-readiness="polish">
                    <div className="flex items-center gap-2 text-xs text-amber-300 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      Варто доробити: {readiness.polish.length}
                    </div>
                    <ul className="space-y-1.5">
                      {readiness.polish.map((item, i) => (
                        <li key={i} className="text-[11px] text-slate-400 leading-relaxed border-l-2 border-amber-500/40 pl-2">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {picker && (
        <PickFromMediaLibraryModal
          onPick={(url) => picker.onPick(url)}
          onClose={() => setPicker(null)}
          title="Фото для курсу"
        />
      )}
    </div>
  );
};

