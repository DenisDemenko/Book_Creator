import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Gamepad2, GraduationCap, ListChecks, Lock, Wand2 } from 'lucide-react';
import { EXPRESS_TRACKS, findExpressTrack, isTrackRunnable, type ExpressTrack, type ExpressTrackId } from '../data/expressTracks';
import { ExpressWizardView, type ExpressWizardPayload } from './ExpressWizardView';

/**
 * Розвилка перед експрес-майстром (Завдання 4).
 *
 * Цей компонент — єдина брама до майстра: App більше не відкриває
 * ExpressWizardView напряму. Так гілка перестає бути припущенням «усе, що
 * створюють у Nova, — книга», і стає явним вибором, який видно і людині,
 * і серверу (напрям іде в чернетку).
 *
 * Чому вибір запамʼятовується. Майстер проходять анонімно, а чернетка
 * живе в localStorage і переживає перезавантаження сторінки. Якби напрям
 * не зберігався поруч, людина після F5 посеред роботи поверталася б на
 * екран вибору — і другий вибір міг би не збігтися з тим, під який уже
 * зібрана чернетка.
 */

const TRACK_KEY = 'nova_express_track';

const ICONS: Record<ExpressTrackId, React.ComponentType<{ className?: string }>> = {
  book: BookOpen,
  course: GraduationCap,
  instruction: ListChecks,
  game: Gamepad2,
};

function readSavedTrack(): ExpressTrackId | null {
  try {
    const saved = localStorage.getItem(TRACK_KEY);
    // Збережений напрям поважаємо лише поки гілка справді проходиться:
    // інакше старий вибір заведе в глухий кут після зміни статусу.
    return isTrackRunnable(saved) ? (saved as ExpressTrackId) : null;
  } catch {
    return null;
  }
}

const TrackCard: React.FC<{ track: ExpressTrack; onPick: (t: ExpressTrack) => void }> = ({ track, onPick }) => {
  const Icon = ICONS[track.id];
  const ready = track.status === 'ready';
  return (
    <button
      type="button"
      onClick={() => onPick(track)}
      className={`glass-panel group flex w-full flex-col rounded-2xl p-5 text-left transition-colors ${
        ready ? 'hover:border-emerald-500/40' : 'opacity-80 hover:opacity-100'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
            ready ? 'border-emerald-500/40 text-emerald-400' : 'border-white/10 text-slate-400'
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-slate-500">{track.order}</span>
            <h3 className="truncate text-base font-bold text-slate-100">{track.title}</h3>
            {!ready && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                <Lock className="h-3 w-3" />
                чекає на опис
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{track.tagline}</p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">{track.outcome}</p>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {track.steps.map((s, i) => (
          <React.Fragment key={s}>
            <span className={`text-[11px] ${ready ? 'text-emerald-400/80' : 'text-slate-500'}`}>{s}</span>
            {i < track.steps.length - 1 && <span className="text-slate-700">·</span>}
          </React.Fragment>
        ))}
      </div>

      {ready ? (
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-400">
          Почати <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      ) : (
        <span className="mt-4 text-[11px] text-slate-500">Кроки вище — пропозиція, не реалізована поведінка.</span>
      )}
    </button>
  );
};

const PlannedTrackNotice: React.FC<{ track: ExpressTrack; onBack: () => void }> = ({ track, onBack }) => {
  const Icon = ICONS[track.id];
  return (
    <section className="glass-panel rounded-2xl p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 text-slate-400">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-bold text-slate-100">{track.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{track.outcome}</p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
        Гілку зарезервовано, але її ще не описано. Щоб майстер вів людину крок за кроком, потрібно
        знати три речі: що саме має вийти наприкінці, з яких частин це складається і що робить
        модель на кожному кроці. Опишіть їх — і гілка збереться на цьому ж каркасі.
      </div>

      <h3 className="mt-5 text-sm font-semibold text-slate-200">Наше припущення про кроки</h3>
      <ol className="mt-2 space-y-1.5">
        {track.steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2.5 text-sm text-slate-400">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/15 font-mono text-[10px] text-slate-500">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-slate-500">
        Це чернетка форми, а не узгоджений план — виправляйте вільно.
      </p>

      <button
        type="button"
        onClick={onBack}
        className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.06]"
      >
        <ArrowLeft className="h-4 w-4" />
        До вибору напряму
      </button>
    </section>
  );
};

export const ExpressStartView: React.FC<{ onFinish?: (payload: ExpressWizardPayload) => void }> = ({ onFinish }) => {
  // Напрям із минулого візиту підхоплюємо одразу при першому рендері,
  // щоб не блимнути екраном вибору перед тим, як показати майстер.
  const [track, setTrack] = useState<ExpressTrackId | null>(() => readSavedTrack());
  const [preview, setPreview] = useState<ExpressTrack | null>(null);

  useEffect(() => {
    if (!track) return;
    try {
      localStorage.setItem(TRACK_KEY, track);
    } catch {
      /* приватний режим — вибір просто не переживе перезавантаження */
    }
  }, [track]);

  const pick = useCallback((t: ExpressTrack) => {
    if (t.status === 'ready') setTrack(t.id);
    else setPreview(t);
  }, []);

  const backToChoice = useCallback(() => {
    setPreview(null);
    setTrack(null);
    try {
      localStorage.removeItem(TRACK_KEY);
    } catch {
      /* не критично */
    }
  }, []);

  if (track === 'book') {
    const active = findExpressTrack(track);
    return (
      <ExpressWizardView
        onFinish={onFinish}
        track={track}
        trackTitle={active?.title}
        onChangeTrack={backToChoice}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-emerald-400">
          <Wand2 className="w-5 h-5" />
          <span className="font-mono text-xs font-bold tracking-widest uppercase">За 5 хвилин</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-slate-100">Що створюємо?</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
          Від цього вибору залежать кроки майстра й те, що модель пропонуватиме на кожному з них.
          Напрям можна змінити будь-коли — але тоді майстер почнеться заново.
        </p>
      </header>

      {preview ? (
        <PlannedTrackNotice track={preview} onBack={() => setPreview(null)} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {EXPRESS_TRACKS.map((t) => (
            <TrackCard key={t.id} track={t} onPick={pick} />
          ))}
        </div>
      )}
    </div>
  );
};
