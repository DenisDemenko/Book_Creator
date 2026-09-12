/**
 * Схема всіх комітів — вертикальна стрічка часу від самого першого
 * (прохання власника, запис #150).
 *
 * Чому стрічка, а не граф гілок: історія проєкту майже лінійна — 209
 * комітів і один мердж, тож граф показав би одну пряму лінію й нічого
 * більше. Значуща структура тут інша — час, автор, обсяг зміни і зв'язок
 * із записом журналу `log.md`, на який посилається дві третини комітів.
 *
 * Дані читає `GET /api/admin/git/commits` (server/gitHistoryRoutes.ts) з
 * живого `git log`, тому розділ працює лише при локальному запуску — так
 * задачу й поставлено. У проді вкладка лишається на місці й чесно пояснює
 * причину, а не зникає без слова.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitCommit, RefreshCw, Loader2, AlertTriangle, FileDiff, BookOpen,
  CloudUpload, CloudOff, ChevronDown, Radio,
} from 'lucide-react';

interface Commit {
  hash: string;
  shortHash: string;
  date: string;
  commitDate: string;
  author: string;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  journalEntry: number | null;
  isMerge: boolean;
  pushedTo: string[];
}

interface JournalEntry {
  n: number;
  title: string;
  status: string;
  excerpt: string;
}

interface RemoteCheck {
  remote: string;
  ok: boolean;
  shortHash?: string;
  upToDate?: boolean;
  error?: string;
}

/** Автор у git може бути записаний по-різному — зводимо до однієї особи. */
function normalizeAuthor(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === 'denis demenko' || n === 'денис') return 'Денис';
  return name.trim();
}

const AUTHOR_TONE: Record<string, string> = {
  Денис: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  Claude: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

// Локаль задана явно, а не `undefined`: адмінка написана українською, і
// брати мову з налаштувань браузера означало б «August 25, 2026» посеред
// українського інтерфейсу — саме це й було видно на першій перевірці.
const LOCALE = 'uk-UA';

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** Українська форма числівника: 1 коміт, 2-4 коміти, 5+ комітів. */
function pluralCommits(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} комітів`;
  if (mod10 === 1) return `${n} коміт`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} коміти`;
  return `${n} комітів`;
}

export const AdminGitHistoryView: React.FC = () => {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [total, setTotal] = useState(0);
  const [branch, setBranch] = useState('');
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [journal, setJournal] = useState<Record<number, JournalEntry>>({});
  const [remotes, setRemotes] = useState<string[]>([]);
  const [onlyUnpushed, setOnlyUnpushed] = useState(false);
  /** Розкритий коміт → повний текст запису журналу (вантажиться на вимогу). */
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entryText, setEntryText] = useState<Record<number, string>>({});
  const [verify, setVerify] = useState<{ busy: boolean; head?: string; results?: RemoteCheck[]; error?: string }>({ busy: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/git/commits', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      setAvailable(!!data.available);
      setReason(data.reason || '');
      setCommits(Array.isArray(data.commits) ? data.commits : []);
      setTotal(Number(data.total) || 0);
      setBranch(data.branch || '');
      setJournal(data.journal || {});
      setRemotes(Array.isArray(data.remotes) ? data.remotes : []);
    } catch (err: any) {
      setAvailable(false);
      setReason(err?.message || 'Не вдалося прочитати історію комітів.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const authors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of commits) {
      const a = normalizeAuthor(c.author);
      counts.set(a, (counts.get(a) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [commits]);

  const visible = useMemo(() => {
    let list = commits;
    if (authorFilter) list = list.filter((c) => normalizeAuthor(c.author) === authorFilter);
    // «Не запушені» — ті, яких немає ні на ОДНОМУ remote. Саме цей
    // фільтр і відповідає на питання «що ще не на GitHub».
    if (onlyUnpushed) list = list.filter((c) => c.pushedTo.length === 0);
    return list;
  }, [commits, authorFilter, onlyUnpushed]);

  const unpushedCount = useMemo(() => commits.filter((c) => c.pushedTo.length === 0).length, [commits]);

  /** Повний текст запису журналу — тягнемо лише коли коміт розкрили. */
  const toggleExpand = async (c: Commit) => {
    const next = expanded === c.hash ? null : c.hash;
    setExpanded(next);
    if (next && c.journalEntry !== null && !entryText[c.journalEntry]) {
      try {
        const res = await fetch(`/api/admin/git/journal/${c.journalEntry}`, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (data?.text) setEntryText((prev) => ({ ...prev, [c.journalEntry as number]: data.text }));
      } catch {
        /* не критично: уривок у картці однаково лишається */
      }
    }
  };

  const runVerify = async () => {
    setVerify({ busy: true });
    try {
      const res = await fetch('/api/admin/git/verify-remotes', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setVerify({ busy: false, error: data?.error || `HTTP ${res.status}` });
      else setVerify({ busy: false, head: data.shortHead, results: data.results });
    } catch (err: any) {
      setVerify({ busy: false, error: err?.message || String(err) });
    }
  };

  /** Групування по днях — кістяк стрічки. */
  const days = useMemo(() => {
    const map = new Map<string, Commit[]>();
    for (const c of visible) {
      const key = c.date.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(c);
      else map.set(key, [c]);
    }
    return [...map.entries()];
  }, [visible]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, c) => ({
          insertions: acc.insertions + c.insertions,
          deletions: acc.deletions + c.deletions,
          files: acc.files + c.filesChanged,
        }),
        { insertions: 0, deletions: 0, files: 0 }
      ),
    [visible]
  );

  /** Найбільший коміт у вибірці — щоб смужка обсягу мала масштаб. */
  const peak = useMemo(
    () => visible.reduce((m, c) => Math.max(m, c.insertions + c.deletions), 1),
    [visible]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Читаємо історію комітів…
      </div>
    );
  }

  if (!available) {
    return (
      <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/40 space-y-2">
        <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
          <AlertTriangle className="w-4 h-4" />
          Історія комітів тут недоступна
        </div>
        <p className="text-xs text-amber-100/80 leading-relaxed">{reason}</p>
        <p className="text-[11px] text-amber-100/60 leading-relaxed">
          Розділ задуманий як локальний інструмент: щоб побачити схему, запустіть студію з теки
          репозиторію (<span className="font-mono">npm run dev</span>) і відкрийте цю вкладку там.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Зведення */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="px-3 py-2 rounded-xl bg-slate-900 border border-white/[0.06] text-xs">
          <span className="text-slate-500">Комітів: </span>
          <span className="font-bold text-slate-100">{total}</span>
          {commits.length < total && <span className="text-slate-500"> (показано {commits.length})</span>}
        </div>
        <div className="px-3 py-2 rounded-xl bg-slate-900 border border-white/[0.06] text-xs">
          <span className="text-slate-500">Днів: </span>
          <span className="font-bold text-slate-100">{days.length}</span>
        </div>
        <div className="px-3 py-2 rounded-xl bg-slate-900 border border-white/[0.06] text-xs font-mono">
          <span className="text-emerald-400">+{totals.insertions.toLocaleString()}</span>
          <span className="text-slate-600"> / </span>
          <span className="text-rose-400">−{totals.deletions.toLocaleString()}</span>
        </div>
        {branch && (
          <div className="px-3 py-2 rounded-xl bg-slate-900 border border-white/[0.06] text-xs font-mono text-slate-400">
            {branch}
          </div>
        )}
        {/* Головне питання власника: що ще не на GitHub. */}
        <button
          onClick={() => setOnlyUnpushed((v) => !v)}
          className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${
            onlyUnpushed
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
              : unpushedCount > 0
                ? 'bg-slate-900 text-amber-300/90 border-amber-500/25 hover:border-amber-500/50'
                : 'bg-slate-900 text-slate-500 border-white/[0.06]'
          }`}
          title="Показати лише коміти, яких немає ні на одному remote"
        >
          {unpushedCount > 0 ? <CloudOff className="w-3.5 h-3.5" /> : <CloudUpload className="w-3.5 h-3.5" />}
          {unpushedCount > 0 ? `Не запушено: ${unpushedCount}` : 'Усе запушено'}
        </button>
        <button
          onClick={runVerify}
          disabled={verify.busy}
          className="px-3 py-2 rounded-xl bg-slate-900 border border-white/[0.06] text-xs text-slate-300 hover:text-white flex items-center gap-1.5 disabled:opacity-50"
          title="Запитати GitHub напряму, на якому коміті кожен remote"
        >
          {verify.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
          Звірити з GitHub
        </button>
        <button
          onClick={load}
          className="ml-auto px-3 py-2 rounded-xl bg-slate-900 border border-white/[0.06] text-xs text-slate-300 hover:text-white flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Оновити
        </button>
      </div>

      {/* Результат звірки з GitHub */}
      {(verify.results || verify.error) && (
        <div className="p-3 rounded-xl bg-slate-900 border border-white/[0.06] space-y-1.5">
          {verify.error && <p className="text-[11px] text-rose-300">{verify.error}</p>}
          {verify.results?.map((r) => (
            <div key={r.remote} className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-mono font-bold text-slate-200 min-w-[80px]">{r.remote}</span>
              {r.ok ? (
                <>
                  <span className="font-mono text-slate-400">{r.shortHash}</span>
                  {r.upToDate ? (
                    <span className="px-1.5 py-px rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                      співпадає з HEAD
                    </span>
                  ) : (
                    <span className="px-1.5 py-px rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                      відстає від HEAD ({verify.head})
                    </span>
                  )}
                </>
              ) : (
                /* Для приватного репозиторію без збережених облікових даних
                   це очікувано, а не поломка — так і пишемо. */
                <span className="text-slate-500">
                  не вдалося запитати: {r.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Автори — заразом і фільтр стрічки */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setAuthorFilter(null)}
          className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
            authorFilter === null
              ? 'bg-white/10 text-white border-white/20'
              : 'bg-slate-900 text-slate-400 border-white/[0.06] hover:text-white'
          }`}
        >
          Усі
        </button>
        {authors.map(([name, count]) => (
          <button
            key={name}
            onClick={() => setAuthorFilter(authorFilter === name ? null : name)}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
              authorFilter === name
                ? AUTHOR_TONE[name] || 'bg-white/10 text-white border-white/20'
                : 'bg-slate-900 text-slate-400 border-white/[0.06] hover:text-white'
            }`}
          >
            {name} · {count}
          </button>
        ))}
      </div>

      {/* Стрічка часу */}
      <div className="relative pl-5">
        {/* Вертикаль стрічки */}
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-white/[0.08]" aria-hidden="true" />

        {days.map(([day, dayCommits]) => (
          <section key={day} className="mb-5">
            <div className="relative mb-2">
              <span
                className="absolute -left-5 top-1 w-[15px] h-[15px] rounded-full bg-slate-950 border-2 [border-color:var(--sun-acc)]"
                aria-hidden="true"
              />
              <h3 className="text-xs font-bold [color:var(--sun-acc)] uppercase tracking-wider">
                {fmtDay(day)}
                <span className="ml-2 text-slate-500 font-normal tracking-normal normal-case">
                  {pluralCommits(dayCommits.length)}
                </span>
              </h3>
            </div>

            <div className="space-y-1.5">
              {dayCommits.map((c) => {
                const volume = c.insertions + c.deletions;
                // Дата застосування помітно пізніша за авторство = коміт
                // приїхав патчем. Показуємо, бо інакше порядок у стрічці
                // виглядав би як помилка.
                const applied =
                  Date.parse(c.commitDate) - Date.parse(c.date) > 3600_000 ? c.commitDate : null;
                return (
                  <article
                    key={c.hash}
                    className="relative p-2.5 rounded-xl bg-slate-900/70 border border-white/[0.06] hover:border-white/[0.14] transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="shrink-0 mt-0.5 text-slate-600">
                        <GitCommit className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-200 leading-snug break-words">{c.subject}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px]">
                          <span className="font-mono text-slate-500">{c.shortHash}</span>
                          <span className="text-slate-600">{fmtTime(c.date)}</span>
                          <span
                            className={`px-1.5 py-px rounded border font-semibold ${
                              AUTHOR_TONE[normalizeAuthor(c.author)] ||
                              'bg-slate-800 text-slate-400 border-white/[0.08]'
                            }`}
                          >
                            {normalizeAuthor(c.author)}
                          </span>
                          {c.isMerge && (
                            <span className="px-1.5 py-px rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                              мердж
                            </span>
                          )}
                          {c.journalEntry !== null && (
                            <span
                              className="px-1.5 py-px rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold flex items-center gap-1"
                              title={`Коміт посилається на запис #${c.journalEntry} у log.md`}
                            >
                              <BookOpen className="w-2.5 h-2.5" />
                              log.md #{c.journalEntry}
                            </span>
                          )}
                          {/* Де коміт уже є. Порожньо = ще нікуди не
                              запушений, і це головне, що видно з картки. */}
                          {c.pushedTo.length > 0 ? (
                            <span
                              className="px-1.5 py-px rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1"
                              title={`Коміт уже є на: ${c.pushedTo.join(', ')}`}
                            >
                              <CloudUpload className="w-2.5 h-2.5" />
                              {c.pushedTo.join(' · ')}
                            </span>
                          ) : (
                            <span
                              className="px-1.5 py-px rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1"
                              title="Цього коміта ще немає ні на одному remote"
                            >
                              <CloudOff className="w-2.5 h-2.5" />
                              не запушено
                            </span>
                          )}
                          {!c.isMerge && (
                            <span className="flex items-center gap-1 font-mono text-slate-500">
                              <FileDiff className="w-2.5 h-2.5" />
                              {c.filesChanged}
                              <span className="text-emerald-500">+{c.insertions}</span>
                              <span className="text-rose-500">−{c.deletions}</span>
                            </span>
                          )}
                          {applied && (
                            <span className="text-slate-600" title="Коміт застосовано патчем пізніше за дату авторства">
                              застосовано {fmtDay(applied)}
                            </span>
                          )}
                        </div>
                        {/* Що саме зроблено — із журналу log.md. Тема
                            коміта каже, ЩО змінилось, запис — ЧОМУ це
                            робилось; без нього схема була б причесаним
                            `git log`. */}
                        {c.journalEntry !== null && journal[c.journalEntry] && (
                          <div className="mt-1.5 pl-2 border-l-2 border-cyan-500/25">
                            <button
                              onClick={() => toggleExpand(c)}
                              className="w-full text-left group/j"
                            >
                              <span className="flex items-start gap-1 text-[11px] font-semibold text-cyan-200/90">
                                <ChevronDown
                                  className={`w-3 h-3 mt-0.5 shrink-0 transition-transform ${
                                    expanded === c.hash ? 'rotate-0' : '-rotate-90'
                                  }`}
                                />
                                <span className="min-w-0">
                                  {journal[c.journalEntry].title}
                                  {journal[c.journalEntry].status && (
                                    <span className="ml-1.5 font-normal text-slate-400">
                                      {journal[c.journalEntry].status}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </button>
                            {expanded === c.hash ? (
                              <pre className="mt-1.5 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300 font-sans">
                                {entryText[c.journalEntry] || 'Читаємо запис…'}
                              </pre>
                            ) : (
                              <p className="mt-0.5 text-[10.5px] leading-snug text-slate-400 line-clamp-2">
                                {journal[c.journalEntry].excerpt}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Смужка обсягу: відносно найбільшого коміта у
                            вибірці, тож масштаб завжди осмислений. */}
                        {volume > 0 && (
                          <div className="mt-1.5 h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500/70 to-sky-500/70"
                              style={{ width: `${Math.max(2, (volume / peak) * 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-xs text-slate-500 py-8 text-center">Для цього фільтра комітів немає.</p>
      )}
    </div>
  );
};
