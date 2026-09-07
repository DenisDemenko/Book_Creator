import React, { useMemo, useState } from 'react';
import {
  Wand2,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  RefreshCw,
  Trash2,
  Users,
  Target,
  GraduationCap,
  Layers,
  BookOpen,
  Hammer,
} from 'lucide-react';
import {
  CourseAssignment,
  CourseLessonV2,
  CourseModuleV2,
  CourseSkillV2,
  CourseV2,
} from '../types';

// ---------------------------------------------------------------------------

const STAGES = [
  { id: 'theme', label: 'Тема й аудиторія', icon: Users },
  { id: 'outcomes', label: 'Результати навчання', icon: Target },
  { id: 'skills', label: 'Навички', icon: GraduationCap },
  { id: 'modules', label: 'Модулі', icon: Layers },
  { id: 'lessons', label: 'Уроки', icon: BookOpen },
  { id: 'practice', label: 'Практика', icon: Hammer },
] as const;

type StageId = (typeof STAGES)[number]['id'];

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

const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-amber-400';
const areaCls = inputCls + ' resize-y';

interface WizardCourse extends Omit<CourseV2, 'id' | 'ownerId' | 'status' | 'createdAt' | 'updatedAt' | 'publishedAt'> {
  title: string;
}

export const CourseWizardView: React.FC<{
  onChangeTrack?: () => void;
  onCourseCreated?: (course: CourseV2) => void;
}> = ({ onChangeTrack, onCourseCreated }) => {
  const [stageIndex, setStageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Record<StageId, boolean>>({
    theme: false, outcomes: false, skills: false, modules: false, lessons: false, practice: false,
  });

  const [context, setContext] = useState({ craft: '', audience: '', level: 'початківці' });

  const [course, setCourse] = useState<WizardCourse>({
    title: '',
    subtitle: '',
    summary: '',
    description: '',
    audience: [],
    outcomes: [],
    highlights: ['', '', ''],
    skills: [],
    modules: [],
  });

  const stage: StageId = STAGES[stageIndex].id;

  const patch = (p: Partial<WizardCourse>) => setCourse((prev) => ({ ...prev, ...p }));

  /** Один запит до сервера з одним автоматичним повтором на порожні 502 (таймаут проксі). */
  const requestStage = async (body: Record<string, unknown>) => {
    const doCall = () =>
      api<{ stage: StageId; data: Record<string, unknown> }>('/api/courses/wizard/stage', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    try {
      return await doCall();
    } catch (e) {
      if (String((e as Error).message).includes('502')) {
        await new Promise((r) => setTimeout(r, 1500));
        return await doCall();
      }
      throw e;
    }
  };

  const courseForServer = () => ({
    title: course.title || undefined,
    subtitle: course.subtitle || undefined,
    skills: course.skills.map((s) => ({ name: s.name })),
    modules: course.modules.map((m) => ({
      title: m.title,
      summary: m.summary,
      lessons: m.lessons.map((l) => ({ title: l.title })),
    })),
  });

  const applyStageData = (
    prev: WizardCourse,
    stageId: StageId,
    d: Record<string, any>,
    moduleIndex?: number
  ): WizardCourse => {
    const next: WizardCourse = { ...prev };
    if (stageId === 'theme') {
      // Скалярні поля заповнюються лише якщо користувач ще нічого не ввів:
      // його власний текст — за основу, модель лише доповнює порожнє.
      if (typeof d.title === 'string' && d.title && !next.title.trim()) next.title = d.title;
      if (typeof d.subtitle === 'string' && !(next.subtitle ?? '').trim()) next.subtitle = d.subtitle;
      if (Array.isArray(d.audience)) {
        const existing = new Set(next.audience.map((a) => a.trim().toLowerCase()).filter(Boolean));
        const added = d.audience.map(String).filter((a) => a.trim() && !existing.has(a.trim().toLowerCase()));
        next.audience = [...next.audience, ...added];
      }
    } else if (stageId === 'outcomes') {
      if (Array.isArray(d.outcomes)) {
        const existing = new Set(next.outcomes.map((o) => o.trim().toLowerCase()).filter(Boolean));
        const added = d.outcomes.map(String).filter((o) => o.trim() && !existing.has(o.trim().toLowerCase()));
        next.outcomes = [...next.outcomes, ...added];
      }
      if (Array.isArray(d.highlights)) {
        next.highlights = next.highlights.map((h, i) => (h.trim() ? h : String(d.highlights[i] ?? '')));
      }
    } else if (stageId === 'skills') {
      if (Array.isArray(d.skills)) {
        const existing = new Set(next.skills.map((s) => s.name.trim().toLowerCase()).filter(Boolean));
        const added: CourseSkillV2[] = [];
        for (const s of d.skills as any[]) {
          const name = String(s?.name ?? '').trim();
          if (!name || existing.has(name.toLowerCase())) continue;
          existing.add(name.toLowerCase());
          added.push({
            id: uid('sk'),
            name,
            level: s?.level === 'pro' || s?.level === 'confident' ? s.level : 'base',
            whyItMatters: String(s?.whyItMatters ?? ''),
            howToDevelop: Array.isArray(s?.howToDevelop) ? s.howToDevelop.map(String) : [],
            practiceIdeas: Array.isArray(s?.practiceIdeas) ? s.practiceIdeas.map(String) : [],
          });
        }
        next.skills = [...next.skills, ...added];
      }
    } else if (stageId === 'modules') {
      if (Array.isArray(d.modules)) {
        const existing = new Set(next.modules.map((m) => m.title.trim().toLowerCase()).filter(Boolean));
        const added: CourseModuleV2[] = [];
        for (const m of d.modules as any[]) {
          const title = String(m?.title ?? '').trim();
          if (!title || existing.has(title.toLowerCase())) continue;
          existing.add(title.toLowerCase());
          const skillIds = (Array.isArray(m?.skillIndexes) ? m.skillIndexes : [])
            .map((idx: number) => next.skills[idx]?.id)
            .filter(Boolean) as string[];
          added.push({ id: uid('mo'), title, summary: typeof m?.summary === 'string' ? m.summary : '', skillIds, lessons: [], finalAssignment: undefined });
        }
        next.modules = [...next.modules, ...added];
      }
    } else if (stageId === 'lessons' && moduleIndex !== undefined) {
      if (Array.isArray(d.lessons)) {
        next.modules = next.modules.map((m, mi) => {
          if (mi !== moduleIndex) return m;
          const existing = new Set(m.lessons.map((l) => l.title.trim().toLowerCase()).filter(Boolean));
          const added: CourseLessonV2[] = [];
          for (const l of d.lessons as any[]) {
            const title = String(l?.title ?? '').trim();
            if (!title || existing.has(title.toLowerCase())) continue;
            existing.add(title.toLowerCase());
            added.push({
              id: uid('le'),
              title,
              goal: typeof l?.goal === 'string' ? l.goal : '',
              description: typeof l?.description === 'string' ? l.description : '',
              topics: Array.isArray(l?.topics) ? l.topics.map(String) : [],
              photoUrls: [],
            });
          }
          return { ...m, lessons: [...m.lessons, ...added] };
        });
      }
    } else if (stageId === 'practice' && moduleIndex !== undefined) {
      const mapAssignment = (a: any): CourseAssignment => ({
        id: uid('as'),
        title: String(a?.title ?? ''),
        brief: String(a?.brief ?? ''),
        steps: Array.isArray(a?.steps) ? a.steps.map(String) : [],
        deliverable: String(a?.deliverable ?? ''),
        acceptanceCriteria: Array.isArray(a?.acceptanceCriteria) ? a.acceptanceCriteria.map(String) : [],
      });
      next.modules = next.modules.map((m, mi) => {
        if (mi !== moduleIndex) return m;
        let lessons = m.lessons;
        if (Array.isArray(d.assignments)) {
          lessons = lessons.map((l, li) => {
            if (l.assignment) return l;
            const entry = (d.assignments as any[]).find((x: any) => Number(x?.lessonIndex) === li);
            return entry ? { ...l, assignment: mapAssignment(entry.assignment) } : l;
          });
        }
        return {
          ...m,
          lessons,
          finalAssignment: m.finalAssignment ?? (d.finalAssignment ? mapAssignment(d.finalAssignment) : undefined),
        };
      });
    }
    return next;
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      if (stage === 'lessons' || stage === 'practice') {
        if (course.modules.length === 0) {
          setError(stage === 'lessons' ? 'Спершу згенеруйте модулі (крок 4).' : 'Спершу створіть модулі та уроки (кроки 4-5).');
          return;
        }
        // Генерація ПО ОДНОМУ МОДУЛЮ за виклик: один великий JSON на всі модулі
        // впирався в таймаут проксі й повертав порожній 502.
        const label = stage === 'lessons' ? 'Уроки' : 'Практика';
        for (let mi = 0; mi < course.modules.length; mi++) {
          setProgress(`${label}: модуль ${mi + 1}/${course.modules.length} — «${course.modules[mi].title || 'без назви'}»`);
          const res = await requestStage({
            stage,
            moduleIndex: mi,
            course: courseForServer(),
            context,
          });
          const d = res.data as Record<string, any>;
          setCourse((prev) => applyStageData(prev, stage, d, mi));
        }
      } else {
        const res = await requestStage({ stage, course: courseForServer(), context });
        const d = res.data as Record<string, any>;
        setCourse((prev) => applyStageData(prev, stage, d));
      }
      setGenerated((g) => ({ ...g, [stage]: true }));
    } catch (e) {
      setError((e as Error).message || 'Не вдалося згенерувати. Спробуйте ще раз.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const finish = async () => {
    setCreating(true);
    setError(null);
    try {
      const data = await api<{ course: CourseV2 }>('/api/courses', {
        method: 'POST',
        body: JSON.stringify({
          title: course.title || 'Новий курс',
          subtitle: course.subtitle,
          summary: course.summary,
          description: course.description,
          audience: course.audience,
          outcomes: course.outcomes,
          highlights: course.highlights,
          skills: course.skills,
          modules: course.modules,
        }),
      });
      onCourseCreated?.(data.course);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const canFinish = useMemo(
    () => course.title.trim().length > 0 && course.modules.length > 0,
    [course]
  );

  const StageIcon = STAGES[stageIndex].icon;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      {/* Шапка */}
      <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-amber-400">
            <Wand2 className="w-5 h-5" />
            <span className="font-mono text-xs font-bold tracking-widest uppercase">Майстер · Навчальний курс</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">
            {course.title || 'Курс без назви'}
          </h1>
        </div>
        {onChangeTrack && (
          <button onClick={onChangeTrack} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.06]">
            <ArrowLeft className="h-3.5 w-3.5" />
            До вибору напряму
          </button>
        )}
      </header>

      {/* Кроки */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          const active = i === stageIndex;
          const done = generated[s.id];
          return (
            <button
              key={s.id}
              onClick={() => !busy && setStageIndex(i)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                active
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : done
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              {done && !active ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
              <span className="hidden sm:inline">{i + 1}. {s.label}</span>
              <span className="sm:hidden">{i + 1}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-slate-200">
            <StageIcon className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold">Крок {stageIndex + 1}. {STAGES[stageIndex].label}</h2>
          </div>
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-xs font-bold transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : generated[stage] ? <RefreshCw className="w-4 h-4" /> : <Wand2 className="w-4 h-4" />}
            {busy ? (progress ?? 'Модель думає…') : generated[stage] ? 'Запропонувати ще раз' : 'Запропонувати'}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs">{error}</div>
        )}

        {/* ---------- Крок 1: тема й аудиторія ---------- */}
        {stage === 'theme' && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={context.craft} onChange={(e) => setContext((c) => ({ ...c, craft: e.target.value }))} placeholder="Ремесло (напр. меблеве виробництво)" className={inputCls} />
              <input value={context.audience} onChange={(e) => setContext((c) => ({ ...c, audience: e.target.value }))} placeholder="Для кого (напр. майстри-початківці)" className={inputCls} />
            </div>
            <input value={context.level} onChange={(e) => setContext((c) => ({ ...c, level: e.target.value }))} placeholder="Рівень входу" className={inputCls} />
            <div className="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <input value={course.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Назва курсу (свій текст — за основу)" className={inputCls + ' font-bold'} />
              <input value={course.subtitle ?? ''} onChange={(e) => patch({ subtitle: e.target.value })} placeholder="Підзаголовок" className={inputCls} />
              <div>
                <span className="text-[11px] text-slate-400 font-semibold">Аудиторія (по одному на рядок)</span>
                <textarea value={course.audience.join('\n')} onChange={(e) => patch({ audience: e.target.value.split('\n') })} rows={4} className={areaCls + ' mt-1'} />
              </div>
            </div>
          </div>
        )}

        {/* ---------- Крок 2: результати ---------- */}
        {stage === 'outcomes' && (
          <div className="space-y-3">
            <div>
              <span className="text-[11px] text-slate-400 font-semibold">Результати навчання (свій текст — за основу)</span>
              <textarea value={course.outcomes.join('\n')} onChange={(e) => patch({ outcomes: e.target.value.split('\n') })} rows={5} className={areaCls + ' mt-1'} />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-semibold">Три вигоди на картку</span>
              {course.highlights.map((h, i) => (
                <input
                  key={i}
                  value={h}
                  onChange={(e) => {
                    const highlights = [...course.highlights];
                    highlights[i] = e.target.value;
                    patch({ highlights });
                  }}
                  placeholder={`Вигода ${i + 1}`}
                  className={inputCls + ' mt-1'}
                />
              ))}
            </div>
          </div>
        )}

        {/* ---------- Крок 3: навички ---------- */}
        {stage === 'skills' && (
          <div className="space-y-3">
            {course.skills.map((s, i) => (
              <div key={s.id} className="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500">{i + 1}.</span>
                  <input
                    value={s.name}
                    onChange={(e) => patch({ skills: course.skills.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) })}
                    placeholder="Назва навички"
                    className={inputCls + ' flex-1 font-bold'}
                  />
                  <select
                    value={s.level}
                    onChange={(e) => patch({ skills: course.skills.map((x) => (x.id === s.id ? { ...x, level: e.target.value as CourseSkillV2['level'] } : x)) })}
                    className={inputCls + ' w-28'}
                  >
                    <option value="base">Базова</option>
                    <option value="confident">Впевнена</option>
                    <option value="pro">Pro</option>
                  </select>
                  <button
                    onClick={() => patch({ skills: course.skills.filter((x) => x.id !== s.id) })}
                    className="p-1.5 text-slate-500 hover:text-rose-300 transition-colors"
                    title="Видалити"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input value={s.whyItMatters} onChange={(e) => patch({ skills: course.skills.map((x) => (x.id === s.id ? { ...x, whyItMatters: e.target.value } : x)) })} placeholder="Навіщо в ремеслі" className={inputCls} />
              </div>
            ))}
            <button
              onClick={() => patch({ skills: [...course.skills, { id: uid('sk'), name: '', level: 'base', whyItMatters: '', howToDevelop: [], practiceIdeas: [] }] })}
              className="w-full py-2 rounded-xl border border-dashed border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-400/40 text-xs font-semibold transition-colors"
            >
              + Додати навичку вручну
            </button>
          </div>
        )}

        {/* ---------- Крок 4: модулі ---------- */}
        {stage === 'modules' && (
          <div className="space-y-2">
            {course.modules.map((m, i) => (
              <div key={m.id} className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500">{i + 1}.</span>
                  <input
                    value={m.title}
                    onChange={(e) => patch({ modules: course.modules.map((x) => (x.id === m.id ? { ...x, title: e.target.value } : x)) })}
                    placeholder="Назва модуля"
                    className={inputCls + ' flex-1 font-bold'}
                  />
                  <button
                    onClick={() => patch({ modules: course.modules.filter((x) => x.id !== m.id) })}
                    className="p-1.5 text-slate-500 hover:text-rose-300 transition-colors"
                    title="Видалити"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <textarea
                  value={m.summary ?? ''}
                  onChange={(e) => patch({ modules: course.modules.map((x) => (x.id === m.id ? { ...x, summary: e.target.value } : x)) })}
                  rows={2}
                  placeholder="Опис модуля"
                  className={areaCls}
                />
              </div>
            ))}
            <button
              onClick={() => patch({ modules: [...course.modules, { id: uid('mo'), title: '', summary: '', skillIds: [], lessons: [] }] })}
              className="w-full py-2 rounded-xl border border-dashed border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-400/40 text-xs font-semibold transition-colors"
            >
              + Додати модуль вручну
            </button>
          </div>
        )}

        {/* ---------- Крок 5: уроки ---------- */}
        {stage === 'lessons' && (
          <div className="space-y-3">
            {course.modules.length === 0 ? (
              <p className="text-xs text-slate-500">Спершу створіть модулі (крок 4, вручну або через «Запропонувати»).</p>
            ) : (
              course.modules.map((m, mi) => (
                <div key={m.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="text-xs font-bold text-slate-200 mb-2">{mi + 1}. {m.title || 'Без назви'}</div>
                  {m.lessons.length === 0 && <div className="text-[11px] text-slate-500 mb-1.5">Уроків поки немає — натисніть «Запропонувати».</div>}
                  <div className="space-y-2">
                    {m.lessons.map((l, li) => (
                      <div key={l.id} className="space-y-1.5 p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-slate-500">{mi + 1}.{li + 1}</span>
                          <input
                            value={l.title}
                            onChange={(e) =>
                              patch({
                                modules: course.modules.map((x) =>
                                  x.id === m.id ? { ...x, lessons: x.lessons.map((y) => (y.id === l.id ? { ...y, title: e.target.value } : y)) } : x
                                ),
                              })
                            }
                            className={inputCls + ' flex-1 font-semibold'}
                          />
                        </div>
                        <input value={l.goal ?? ''} onChange={(e) => patchLesson(m.id, l.id, { goal: e.target.value })} placeholder="Мета" className={inputCls} />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ---------- Крок 6: практика ---------- */}
        {stage === 'practice' && (
          <div className="space-y-3">
            {course.modules.length === 0 ? (
              <p className="text-xs text-slate-500">Спершу створіть модулі та уроки (кроки 4-5).</p>
            ) : (
              course.modules.map((m, mi) => (
                <div key={m.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="text-xs font-bold text-slate-200">{mi + 1}. {m.title}</div>
                  {m.lessons.map((l, li) => (
                    <div key={l.id} className="text-[11px] text-slate-400 flex items-center gap-2">
                      <Check className={`w-3.5 h-3.5 ${l.assignment ? 'text-emerald-400' : 'text-slate-600'}`} />
                      {mi + 1}.{li + 1} {l.title || 'Без назви'}
                      {l.assignment && <span className="text-slate-500">— {l.assignment.title}</span>}
                    </div>
                  ))}
                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    <Check className={`w-3.5 h-3.5 ${m.finalAssignment ? 'text-emerald-400' : 'text-slate-600'}`} />
                    Підсумкове завдання модуля {m.finalAssignment ? `— ${m.finalAssignment.title}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Навігація */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
          <button
            onClick={() => setStageIndex((i) => Math.max(0, i - 1))}
            disabled={stageIndex === 0 || busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/15 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Назад
          </button>
          {stageIndex < STAGES.length - 1 ? (
            <button
              onClick={() => setStageIndex((i) => Math.min(STAGES.length - 1, i + 1))}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 disabled:opacity-40 transition-all"
            >
              Далі <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => void finish()}
              disabled={creating || !canFinish}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold transition-all"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {creating ? 'Створення курсу…' : 'Створити курс'}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  function patchLesson(moduleId: string, lessonId: string, p: Partial<CourseLessonV2>) {
    patch({
      modules: course.modules.map((x) =>
        x.id === moduleId ? { ...x, lessons: x.lessons.map((y) => (y.id === lessonId ? { ...y, ...p } : y)) } : x
      ),
    });
  }
};
