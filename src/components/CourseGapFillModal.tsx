import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { CourseV2, CourseAssignment, CourseSkillV2 } from '../types';
import { GAP_LABELS, gapForm, type CourseGap, type GapSuggestion } from '../../shared/courseGapFill';

/**
 * «Доповнити це з ШІ» — вікно для одного пункту блоку «Готовність»
 * (прохання власника 13.11.2026).
 *
 * ЧОМУ ВІКНО, А НЕ ПРЯМИЙ ЗАПИС У КУРС. Автор натискає кнопку навпроти рядка
 * «Урок 1.2: немає завдання з критеріями» — і далі має побачити, ЩО саме
 * збирається потрапити в його курс, і мати змогу це виправити. Курс — навчальний
 * матеріал, за який відповідає автор; мовчки вписаний туди текст моделі він
 * помітив би вже після подання на модерацію, якщо взагалі помітив би.
 *
 * Тому: запит → пропозиція у полях, які можна правити → «Застосувати до курсу».
 * Поки не застосовано, курс не змінюється зовсім.
 */

const LEVEL_LABELS: Record<CourseSkillV2['level'], string> = { base: 'базовий', confident: 'впевнений', pro: 'професійний' };

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const clean = (items: string[]): string[] => items.map((s) => s.trim()).filter(Boolean);

/** Пропозиція + правки автора → новий курс. Нічого не стирає: доповнює або заповнює порожнє. */
export function applyGapSuggestion(course: CourseV2, gap: CourseGap, suggestion: GapSuggestion): CourseV2 {
  const assignment = (): CourseAssignment | null => {
    if (suggestion.form !== 'assignment') return null;
    return {
      id: uid('as'),
      title: suggestion.title.trim(),
      brief: suggestion.brief.trim(),
      steps: clean(suggestion.steps),
      deliverable: suggestion.deliverable.trim(),
      acceptanceCriteria: clean(suggestion.acceptanceCriteria),
    };
  };
  const text = suggestion.form === 'text' ? suggestion.text.trim() : '';
  const items = suggestion.form === 'list' ? clean(suggestion.items) : [];

  const withModules = (fn: (m: CourseV2['modules'][number]) => CourseV2['modules'][number]) => ({
    ...course,
    modules: course.modules.map((m) => (m.id === gap.moduleId ? fn(m) : m)),
  });
  const withLesson = (fn: (l: CourseV2['modules'][number]['lessons'][number]) => CourseV2['modules'][number]['lessons'][number]) =>
    withModules((m) => ({ ...m, lessons: m.lessons.map((l) => (l.id === gap.lessonId ? fn(l) : l)) }));

  switch (gap.kind) {
    case 'subtitle':
      return { ...course, subtitle: text };
    // Наявні рядки лишаємо: автор міг написати один влучний, і замінювати його
    // переліком від моделі — це втрата його роботи, а не доповнення.
    case 'audience':
      return { ...course, audience: [...new Set([...clean(course.audience || []), ...items])] };
    case 'outcomes':
      return { ...course, outcomes: [...new Set([...clean(course.outcomes || []), ...items])] };
    case 'highlights':
      return { ...course, highlights: [...new Set([...clean(course.highlights || []), ...items])] };
    case 'skills':
      return suggestion.form === 'skills'
        ? {
            ...course,
            skills: [
              ...course.skills,
              ...suggestion.skills
                .filter((s) => s.name.trim())
                .map((s) => ({
                  id: uid('sk'),
                  name: s.name.trim(),
                  level: s.level,
                  whyItMatters: s.whyItMatters.trim(),
                  howToDevelop: [],
                  practiceIdeas: [],
                } satisfies CourseSkillV2)),
            ],
          }
        : course;
    case 'module-title':
      return withModules((m) => ({ ...m, title: text }));
    case 'module-summary':
      return withModules((m) => ({ ...m, summary: text }));
    case 'module-final': {
      const made = assignment();
      return made ? withModules((m) => ({ ...m, finalAssignment: made })) : course;
    }
    case 'lesson-title':
      return withLesson((l) => ({ ...l, title: text }));
    case 'lesson-goal':
      return withLesson((l) => ({ ...l, goal: text }));
    case 'lesson-description':
      return withLesson((l) => ({ ...l, description: text }));
    case 'lesson-assignment': {
      const made = assignment();
      return made ? withLesson((l) => ({ ...l, assignment: made })) : course;
    }
    default:
      return course;
  }
}

const inputCls = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-400';

function ListEditor({ items, onChange, label }: { items: string[]; onChange: (next: string[]) => void; label: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              className={inputCls}
              value={item}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              data-gap-item={i}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="px-2 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300"
              aria-label="Прибрати пункт"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="mt-1.5 text-[11px] text-slate-400 hover:text-slate-200"
      >
        + додати рядок
      </button>
    </div>
  );
}

export interface CourseGapFillModalProps {
  course: CourseV2;
  gap: CourseGap;
  /** Текст пункту готовності — показуємо його ж, щоб було видно, що саме закриваємо. */
  problem: string;
  onApply: (next: CourseV2) => void;
  onClose: () => void;
  /** Запит до сервера; підміняється в тестах. */
  request?: (courseId: string, gap: CourseGap) => Promise<GapSuggestion>;
}

async function askServer(courseId: string, gap: CourseGap): Promise<GapSuggestion> {
  const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/gap-fill`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gap }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Помилка ${res.status}`);
  return (body as { suggestion: GapSuggestion }).suggestion;
}

export const CourseGapFillModal: React.FC<CourseGapFillModalProps> = ({ course, gap, problem, onApply, onClose, request = askServer }) => {
  const [suggestion, setSuggestion] = useState<GapSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(() => {
    setLoading(true);
    setError(null);
    request(course.id, gap)
      .then((made) => setSuggestion(made))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Не вдалося отримати пропозицію.'))
      .finally(() => setLoading(false));
  }, [course.id, gap, request]);

  useEffect(() => {
    ask();
  }, [ask]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const form = gapForm(gap.kind);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-gap-modal={gap.kind}
    >
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Доповнити: {GAP_LABELS[gap.kind]}
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">{problem}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200" aria-label="Закрити">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-12 justify-center text-xs text-slate-400" data-gap-loading>
            <Loader2 className="w-4 h-4 animate-spin" /> ШІ готує пропозицію…
          </div>
        ) : error ? (
          <div className="mt-3">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200" data-gap-error>{error}</div>
            <button type="button" onClick={ask} className="mt-3 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200">
              Спробувати ще раз
            </button>
          </div>
        ) : suggestion ? (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-slate-500">
              Це пропозиція ШІ. Виправте її й натисніть «Застосувати до курсу» — доти курс не змінюється.
            </p>

            {form === 'text' && suggestion.form === 'text' && (
              <textarea
                className={inputCls + ' min-h-[96px]'}
                value={suggestion.text}
                onChange={(e) => setSuggestion({ form: 'text', text: e.target.value })}
                data-gap-text
              />
            )}

            {form === 'list' && suggestion.form === 'list' && (
              <ListEditor
                label="Пункти"
                items={suggestion.items}
                onChange={(items) => setSuggestion({ form: 'list', items })}
              />
            )}

            {form === 'skills' && suggestion.form === 'skills' && (
              <div className="space-y-2">
                {suggestion.skills.map((s, i) => (
                  <div key={i} className="rounded-xl border border-slate-800 p-2.5 space-y-1.5" data-gap-skill={i}>
                    <input
                      className={inputCls}
                      value={s.name}
                      onChange={(e) => setSuggestion({ form: 'skills', skills: suggestion.skills.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    />
                    <select
                      className={inputCls}
                      value={s.level}
                      onChange={(e) => setSuggestion({ form: 'skills', skills: suggestion.skills.map((x, j) => (j === i ? { ...x, level: e.target.value as CourseSkillV2['level'] } : x)) })}
                    >
                      {(Object.keys(LEVEL_LABELS) as CourseSkillV2['level'][]).map((lv) => (
                        <option key={lv} value={lv}>{LEVEL_LABELS[lv]}</option>
                      ))}
                    </select>
                    <textarea
                      className={inputCls}
                      value={s.whyItMatters}
                      onChange={(e) => setSuggestion({ form: 'skills', skills: suggestion.skills.map((x, j) => (j === i ? { ...x, whyItMatters: e.target.value } : x)) })}
                    />
                  </div>
                ))}
              </div>
            )}

            {form === 'assignment' && suggestion.form === 'assignment' && (
              <div className="space-y-2">
                <input className={inputCls} value={suggestion.title} onChange={(e) => setSuggestion({ ...suggestion, title: e.target.value })} data-gap-title />
                <textarea className={inputCls} value={suggestion.brief} onChange={(e) => setSuggestion({ ...suggestion, brief: e.target.value })} />
                <ListEditor label="Кроки" items={suggestion.steps} onChange={(steps) => setSuggestion({ ...suggestion, steps })} />
                <input className={inputCls} value={suggestion.deliverable} onChange={(e) => setSuggestion({ ...suggestion, deliverable: e.target.value })} placeholder="Що здає учень" />
                <ListEditor
                  label="Критерії приймання"
                  items={suggestion.acceptanceCriteria}
                  onChange={(acceptanceCriteria) => setSuggestion({ ...suggestion, acceptanceCriteria })}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onApply(applyGapSuggestion(course, gap, suggestion));
                  onClose();
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
                data-gap-apply
              >
                Застосувати до курсу
              </button>
              <button type="button" onClick={ask} className="px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200">
                Запитати ще раз
              </button>
              <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-xl border border-slate-700 text-xs font-bold text-slate-400">
                Скасувати
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
