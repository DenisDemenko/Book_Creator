import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, CornerUpLeft, ExternalLink, Loader2 } from 'lucide-react';
import { GRADUATE_SELLING_LABELS, normalizeGraduateSelling, videoProvider } from '../utils/coursePublishRules';

/**
 * Повна картка курсу в черзі модерації.
 *
 * Раніше адмін бачив у черзі лише назву й id курсу та натискав «Погодити»
 * наосліп: ціна, обкладинка, програма й відео лишались невідомими до
 * публікації. Тут — усе, що вирішує питання «публікувати чи ні», а також:
 *  - чого бракує за правилами подання (ті самі, що перевіряє сервер);
 *  - що автор змінив ПІСЛЯ подання (погоджується знімок, а не живий стан);
 *  - три рішення: «Опублікувати», «Повернути із зауваженнями» (з текстом),
 *    «Відхилити остаточно» (з причиною).
 */

interface ReviewLesson {
  id?: string;
  title: string;
  goal?: string;
  description?: string;
  durationMin?: number;
  videoUrl?: string;
  topics?: string[];
  assignment?: { title?: string };
}
interface ReviewModule {
  id?: string;
  title: string;
  summary?: string;
  coverPhotoUrl?: string;
  introVideoUrl?: string;
  lessons: ReviewLesson[];
  finalAssignment?: { title?: string };
}
interface ReviewCourse {
  id: string;
  graduateSelling?: string;
  title: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  audience: string[];
  outcomes: string[];
  highlights: string[];
  coverUrl?: string;
  priceMinor?: number;
  free?: boolean;
  skills: Array<{ id?: string; name: string; level?: string; whyItMatters?: string }>;
  modules: ReviewModule[];
  updatedAt?: string;
}
interface ReviewDetail {
  entry: { id: string; status: string; createdAt: string; reason?: string; decidedAt?: string };
  course?: ReviewCourse;
  source?: 'snapshot' | 'live';
  category?: { slug: string; name: string } | null;
  problems?: string[];
  changes?: string[];
  courseDeleted?: boolean;
}

const LEVEL: Record<string, string> = { base: 'базова', confident: 'впевнена', pro: 'професійна' };
const priceText = (c: ReviewCourse) =>
  c.free ? 'Безкоштовно' : c.priceMinor === undefined || c.priceMinor === null ? 'не вказана' : `${(c.priceMinor / 100).toLocaleString('uk-UA')} грн`;

const VideoLink: React.FC<{ url?: string; label: string }> = ({ url, label }) => {
  if (!url?.trim()) return <span className="text-slate-600">без відео</span>;
  const provider = videoProvider(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 ${provider ? 'text-sky-300 hover:underline' : 'text-rose-300'}`}
      title={url}
    >
      <ExternalLink className="w-3 h-3" />
      {label}: {provider === 'youtube' ? 'YouTube' : provider === 'vimeo' ? 'Vimeo' : 'невідоме посилання'}
    </a>
  );
};

export const AdminCourseReview: React.FC<{
  entryId: string;
  onDecided: (message: string) => void;
  onClose: () => void;
}> = ({ entryId, onDecided, onClose }) => {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    fetch(`/api/admin/moderation/${entryId}`, { credentials: 'same-origin' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || `Не вдалося відкрити запис (HTTP ${r.status}).`);
        return data as ReviewDetail;
      })
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [entryId]);

  const decide = useCallback(
    async (path: 'approve' | 'request-changes' | 'reject', body: Record<string, unknown>, okText: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/moderation/${entryId}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Не вдалося (HTTP ${res.status}).`);
        const mail = data?.notification;
        onDecided(
          okText +
            (mail?.sent
              ? ' Автору надіслано лист.'
              : mail
                ? ` Лист автору не надіслано (${mail.reason || 'невідомо'}) — повідомте його самі.`
                : '')
        );
      } catch (e: any) {
        setError(e?.message || 'Помилка.');
      } finally {
        setBusy(false);
      }
    },
    [entryId, onDecided]
  );

  if (error && !detail) {
    return <div className="mt-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{error}</div>;
  }
  if (!detail) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Відкриваю картку курсу…
      </div>
    );
  }
  return <CourseReviewCard entryId={entryId} detail={detail} busy={busy} error={error} onDecide={decide} onClose={onClose} />;
};

/**
 * Сама картка без запитів: усе, що показується, приходить пропсами — тож її
 * можна відрендерити в тесті з будь-якими даними, не здіймаючи сервер.
 */
export const CourseReviewCard: React.FC<{
  entryId: string;
  detail: ReviewDetail;
  busy: boolean;
  error: string | null;
  onDecide: (path: 'approve' | 'request-changes' | 'reject', body: Record<string, unknown>, okText: string) => void;
  onClose: () => void;
}> = ({ entryId, detail, busy, error, onDecide, onClose }) => {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const decide = onDecide;
  if (detail.courseDeleted && !detail.course) {
    return <div className="mt-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">Курс видалено автором — розглядати нічого.</div>;
  }

  const c: ReviewCourse = {
    ...detail.course!,
    audience: detail.course!.audience || [],
    outcomes: detail.course!.outcomes || [],
    highlights: detail.course!.highlights || [],
    skills: detail.course!.skills || [],
    modules: (detail.course!.modules || []).map((m) => ({ ...m, lessons: m.lessons || [] })),
  };
  const pending = detail.entry.status === 'pending';
  const problems = detail.problems || [];
  const changes = detail.changes || [];
  const lessonCount = c.modules.reduce((n, m) => n + m.lessons.length, 0);
  const minutes = c.modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + (Number(l.durationMin) || 0), 0), 0);

  return (
    <div className="mt-2 rounded-xl border border-slate-700 bg-slate-950/70 p-4 space-y-4" data-course-review={entryId}>
      <div className="flex items-start gap-4 flex-wrap">
        {c.coverUrl ? (
          <img src={c.coverUrl} alt="Обкладинка" className="w-40 h-28 object-cover rounded-lg border border-slate-700 bg-slate-900" />
        ) : (
          <div className="w-40 h-28 rounded-lg border border-dashed border-rose-500/40 text-rose-300 text-[11px] flex items-center justify-center text-center p-2">
            Немає обкладинки
          </div>
        )}
        <div className="flex-1 min-w-[220px] space-y-1">
          <h4 className="text-sm font-bold text-slate-100">{c.title}</h4>
          {c.subtitle && <p className="text-xs text-slate-400">{c.subtitle}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] pt-1">
            <dt className="text-slate-500">Ціна</dt>
            <dd className={c.free ? 'text-emerald-300 font-semibold' : 'text-slate-200 font-semibold'}>{priceText(c)}</dd>
            <dt className="text-slate-500">Категорія</dt>
            <dd className="text-slate-300">{detail.category ? detail.category.name : 'без категорії'}</dd>
            <dt className="text-slate-500">Роботи студентів</dt>
            <dd className="text-slate-300">{GRADUATE_SELLING_LABELS[normalizeGraduateSelling(c.graduateSelling)]}</dd>
            <dt className="text-slate-500">Обсяг</dt>
            <dd className="text-slate-300">
              {c.modules.length} модулів · {lessonCount} уроків{minutes > 0 ? ` · ${minutes} хв` : ''}
            </dd>
            <dt className="text-slate-500">Подано</dt>
            <dd className="text-slate-300">
              {new Date(detail.entry.createdAt).toLocaleString('uk-UA')}
              {detail.source === 'live' ? ' (старий запис — показано поточний стан курсу)' : ''}
            </dd>
          </dl>
        </div>
      </div>

      {changes.length > 0 && (
        <div data-review="changes" className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="w-4 h-4" /> Автор змінив курс після подання
          </div>
          <p className="text-amber-200/80">Погодження опублікує саме подану версію, нижче. Ці правки потраплять у вітрину лише після нового надсилання:</p>
          <ul className="list-disc ml-5">
            {changes.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      {problems.length > 0 && (
        <div data-review="problems" className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs space-y-1">
          <div className="font-semibold">Курс не відповідає правилам подання — погодити не вийде:</div>
          <ul className="list-disc ml-5">
            {problems.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 text-xs">
        <section className="space-y-2">
          {c.summary && <p className="text-slate-300">{c.summary}</p>}
          {c.description && <p className="text-slate-400 whitespace-pre-line max-h-40 overflow-y-auto">{c.description}</p>}
        </section>
        <section className="space-y-2">
          {[
            ['Аудиторія', c.audience],
            ['Результати навчання', c.outcomes],
            ['Вигоди на картку', c.highlights],
          ].map(([label, list]) => (
            <div key={label as string}>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{label as string}</div>
              <ul className="list-disc ml-4 text-slate-300">
                {(list as string[]).filter(Boolean).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>

      <section>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Навички ({c.skills.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {c.skills.map((s, i) => (
            <span key={s.id || i} className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 border border-slate-700 text-slate-300" title={s.whyItMatters}>
              {s.name}
              {s.level ? ` · ${LEVEL[s.level] || s.level}` : ''}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">Програма</div>
        {c.modules.map((m, mi) => (
          <details key={m.id || mi} className="rounded-lg border border-slate-800 bg-slate-900/50" open={mi === 0}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-200">
              Модуль {mi + 1}. {m.title} <span className="text-slate-500 font-normal">· {m.lessons.length} уроків</span>
            </summary>
            <div className="px-3 pb-3 space-y-1.5 text-[11px]">
              {m.summary && <p className="text-slate-400">{m.summary}</p>}
              <div>
                <VideoLink url={m.introVideoUrl} label="Вступне відео" />
              </div>
              <ol className="space-y-1">
                {m.lessons.map((l, li) => (
                  <li key={l.id || li} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-l-2 border-slate-700 pl-2">
                    <span className="text-slate-200">
                      {mi + 1}.{li + 1} {l.title}
                    </span>
                    <span className="text-slate-500">{l.durationMin ? `${l.durationMin} хв` : 'без тривалості'}</span>
                    <VideoLink url={l.videoUrl} label="Відео" />
                    {l.assignment?.title && <span className="text-slate-500">завдання: {l.assignment.title}</span>}
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ))}
      </section>

      {error && <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{error}</div>}

      {pending ? (
        <div className="space-y-3 pt-2 border-t border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || problems.length > 0}
              onClick={() => decide('approve', {}, 'Погоджено — курс опубліковано у вітрині.')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-40"
              title={problems.length ? 'Спершу має бути виправлено зауваження вище' : 'Опублікувати подану версію у вітрині'}
            >
              <CheckCircle2 className="w-4 h-4" /> Опублікувати
            </button>
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs">
              Закрити
            </button>
          </div>
          <div className="space-y-1.5">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Зауваження авторові: що виправити, щоб курс пройшов модерацію"
              className="w-full px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 placeholder-slate-600"
            />
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => decide('request-changes', { note }, 'Повернуто автору із зауваженнями.')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40"
            >
              <CornerUpLeft className="w-4 h-4" /> Повернути із зауваженнями
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина остаточної відмови"
              className="flex-1 min-w-[200px] px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 placeholder-slate-600"
            />
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => decide('reject', { reason }, 'Відхилено остаточно.')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-xs font-semibold disabled:opacity-40"
            >
              <Ban className="w-4 h-4" /> Відхилити остаточно
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-800">
          Запис уже вирішено: {detail.entry.status}
          {detail.entry.reason ? ` — ${detail.entry.reason}` : ''}.
        </p>
      )}
    </div>
  );
};
