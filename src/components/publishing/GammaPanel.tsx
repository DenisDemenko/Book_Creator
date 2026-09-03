/**
 * Третя гілка публікації — матеріали, які продають книгу.
 *
 * ЧОМУ ЦЕ НЕ «ТРЕТІЙ МАЙДАНЧИК» ПОРУЧ ІЗ KDP ТА ETSY. На KDP і Etsy книгу
 * купують; на Gamma — ні. Поставити три рівні вкладки означало б пообіцяти
 * автору три джерела доходу там, де їх два, а третє — вітрина ПЕРЕД ними.
 * Тому назва говорить про матеріали, а не про майданчик, а лендінг у ній
 * веде кнопками саме на KDP, Etsy й Fusion Lab.
 *
 * ЩО ТУТ СПРАВДІ Є ТОВАРОМ. Курс-презентація — не маркетинг: вона лягає
 * складником у набір Etsy (`coursePackager.ts`) і продається. Решта —
 * лендінг, медіакіт, пост — працює на два наявні канали.
 *
 * КОШТИ ПОКАЗУЮТЬСЯ ДО НАТИСКАННЯ. Кожна генерація списує кредити з рахунку
 * ВЛАСНИКА студії, Gamma не документує ціни за операцію, а правити
 * згенероване вона не вміє взагалі — невдалий результат означає повторну
 * оплату. Тому поруч із кнопкою стоїть спостережена вартість, а не мовчання.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, ExternalLink, Loader2, AlertTriangle, Coins, RefreshCw } from 'lucide-react';
import type { Book } from '../../types';

/** Вартість за спостереженням із пробного прогону 03.09.2026. */
const OBSERVED_COST: Record<string, string> = {
  course_deck: '≈40–50 кредитів за 9 карток',
  landing: '≈30–40 кредитів',
  social: '≈10–15 кредитів',
  document: '≈25–35 кредитів',
};

const KIND_LABELS: Record<string, { title: string; hint: string; product: boolean }> = {
  course_deck: {
    title: 'Курс-презентація',
    hint: 'Складник набору для Etsy — це товар, а не реклама. Експортується у PPTX або PDF.',
    product: true,
  },
  landing: {
    title: 'Лендінг книги',
    hint: 'Сторінка з уривком і кнопками на Amazon KDP, Etsy та вітрину Fusion Lab.',
    product: false,
  },
  document: {
    title: 'Медіакіт / одностронічник',
    hint: 'Для преси, партнерів і заявок на гранти. Експорт у PDF.',
    product: false,
  },
  social: {
    title: 'Пост у соцмережі',
    hint: 'Анонс книги. Найдешевша з генерацій.',
    product: false,
  },
};

interface GammaJob {
  id: string;
  kind: string;
  status: 'pending' | 'completed' | 'failed';
  title: string;
  gammaUrl: string | null;
  exportUrl: string | null;
  creditsUsed: number | null;
  creditsLeft: number | null;
  errorUk: string | null;
  createdAt: string;
}

interface GammaSettings {
  configured: boolean;
  reasonUk?: string;
  themes?: { themes?: Array<{ id: string; name: string }> } | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.error || `Помилка ${res.status}`);
  return data as T;
}

/**
 * Текст для генерації збирається З КНИГИ, а не з порожнього поля.
 *
 * У цьому й полягає інтеграція: якби автор мав сам переписувати синопсис у
 * textarea, Gamma лишалася б окремим сайтом, до якого просто є посилання.
 */
function inputTextFor(kind: string, book: Book): string {
  const title = book.title || 'Без назви';
  const author = book.author || '';
  const genre = book.genre || '';
  const synopsis = book.synopsis || book.logline || '';
  const chapters = (book.chapters || []).map((c, i) => `${i + 1}. ${c.title || 'Розділ'}`).join('\n');

  if (kind === 'course_deck') {
    return [
      `Курс за книгою «${title}»${author ? `, автор ${author}` : ''}.`,
      genre ? `Жанр: ${genre}.` : '',
      synopsis ? `Про що книга: ${synopsis}` : '',
      '',
      'Структура книги, за якою будується курс:',
      chapters || '(розділи не задані)',
      '',
      'Зроби практичну навчальну презентацію: одна картка на змістовий блок,',
      'у кожній — що читач опанує і як це застосувати. Без переказу сюжету.',
    ].filter(Boolean).join('\n');
  }

  if (kind === 'landing') {
    return [
      `Сторінка книги «${title}»${author ? ` — ${author}` : ''}.`,
      genre ? `Жанр: ${genre}.` : '',
      synopsis ? `Анотація: ${synopsis}` : '',
      '',
      'Структура сторінки:',
      '1. Обкладинка й одне речення, заради якого книгу відкривають.',
      '2. Про що книга — без спойлерів.',
      '3. Уривок: перші сторінки доступні безкоштовно.',
      '4. Про автора.',
      '5. Де купити: Amazon KDP (друк і Kindle), Etsy (цифрова версія), вітрина Fusion Lab.',
      '',
      'Тон стриманий. Без обіцянок «бестселер» і «змінить ваше життя».',
    ].filter(Boolean).join('\n');
  }

  if (kind === 'document') {
    return [
      `Медіакіт книги «${title}»${author ? `, автор ${author}` : ''}.`,
      genre ? `Жанр: ${genre}.` : '',
      synopsis ? `Анотація: ${synopsis}` : '',
      `Обсяг: ${(book.chapters || []).length} розділів.`,
      '',
      'Одностронічник для преси й партнерів: суть книги, для кого вона,',
      'чим відрізняється, дані про автора, як звʼязатися. Фактично, без реклами.',
    ].filter(Boolean).join('\n');
  }

  return [
    `Анонс книги «${title}»${author ? ` — ${author}` : ''}.`,
    synopsis ? `Про що: ${synopsis}` : '',
    '',
    'Короткий пост: чим книга цікава і де її взяти. Без вигуків і хештег-спаму.',
  ].filter(Boolean).join('\n');
}

export const GammaPanel: React.FC<{ book: Book; isGuest: boolean }> = ({ book, isGuest }) => {
  const [settings, setSettings] = useState<GammaSettings | null>(null);
  const [kind, setKind] = useState('course_deck');
  const [numCards, setNumCards] = useState(9);
  const [exportAs, setExportAs] = useState<'' | 'pptx' | 'pdf'>('pptx');
  const [themeId, setThemeId] = useState('');
  const [jobs, setJobs] = useState<GammaJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => inputTextFor(kind, book), [kind, book]);

  useEffect(() => {
    if (isGuest) return;
    api<GammaSettings>('/api/gamma/settings').then(setSettings).catch(() => setSettings(null));
    api<{ jobs: GammaJob[] }>('/api/gamma/jobs').then((d) => setJobs(d.jobs)).catch(() => undefined);
  }, [isGuest]);

  /*
    Опитування статусу. Генерація триває 1–3 хвилини, тож питаємо раз на
    5 секунд — саме так радить документація Gamma, і частіше немає сенсу.
    Опитуємо лише поки є незавершені: інакше вкладка стукала б у сервер
    вічно, нічого не дізнаючись.
  */
  useEffect(() => {
    const pending = jobs.filter((j) => j.status === 'pending');
    if (pending.length === 0) return;
    const timer = setInterval(async () => {
      for (const job of pending) {
        try {
          const fresh = await api<GammaJob>(`/api/gamma/jobs/${job.id}`);
          setJobs((all) => all.map((j) => (j.id === fresh.id ? fresh : j)));
        } catch {
          // Сервер міг тимчасово не відповісти — наступний тик спробує знову.
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [jobs]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ job: GammaJob }>('/api/gamma/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          inputText: preview,
          bookId: book.id,
          title: `${KIND_LABELS[kind].title}: ${book.title || 'книга'}`,
          numCards: kind === 'course_deck' ? numCards : undefined,
          themeId: themeId || undefined,
          exportAs: exportAs || undefined,
        }),
      });
      setJobs((all) => [out.job, ...all]);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося поставити задачу.');
    } finally {
      setBusy(false);
    }
  };

  if (isGuest) {
    return (
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-white/[0.06] text-sm text-slate-400">
        Генерація матеріалів доступна власнику книги після входу.
      </div>
    );
  }

  const themes = settings?.themes?.themes || [];

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-white/[0.06] space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-100">Матеріали для просування (Gamma)</h3>
          <p className="text-[11px] text-slate-400 leading-snug mt-1">
            Не третій майданчик продажу, а вітрина перед двома наявними: на KDP і Etsy книгу
            купують, а тут робиться те, що веде до них. Виняток — курс-презентація: вона стає
            складником набору для Etsy, тобто товаром.
          </p>
        </div>

        {settings && !settings.configured && (
          <p className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-[11px] flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {settings.reasonUk}
          </p>
        )}

        <div>
          <span className="block text-[11px] font-semibold text-slate-300 mb-1">Що зробити</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(KIND_LABELS).map(([id, meta]) => (
              <button
                key={id}
                onClick={() => setKind(id)}
                className={`text-left p-3 rounded-xl border transition ${
                  kind === id
                    ? 'bg-cyan-500/15 border-cyan-500/50'
                    : 'bg-slate-950/60 border-slate-700 hover:border-slate-500'
                }`}
              >
                <span className="text-xs font-bold text-slate-100 flex items-center gap-2">
                  {meta.title}
                  {meta.product && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                      товар
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-slate-400 mt-1">{meta.hint}</span>
                <span className="block text-[11px] text-amber-300/90 mt-1">
                  <Coins className="w-3 h-3 inline" /> {OBSERVED_COST[id]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {kind === 'course_deck' && (
            <label className="block">
              <span className="block text-[11px] text-slate-400 mb-1">Карток</span>
              <select
                value={numCards}
                onChange={(e) => setNumCards(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
              >
                {[6, 9, 12, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="block text-[11px] text-slate-400 mb-1">Експорт</span>
            <select
              value={exportAs}
              onChange={(e) => setExportAs(e.target.value as never)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="">без експорту</option>
              <option value="pptx">PPTX</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] text-slate-400 mb-1">Тема</span>
            <select
              value={themeId}
              onChange={(e) => setThemeId(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="">за замовчуванням</option>
              {themes.map((th) => <option key={th.id} value={th.id}>{th.name}</option>)}
            </select>
          </label>
        </div>

        <details className="rounded-xl border border-slate-800 bg-slate-950/60">
          <summary className="px-3 py-2 text-[11px] text-slate-300 cursor-pointer">
            Що саме піде в Gamma (складено з твоєї книги)
          </summary>
          <pre className="px-3 pb-3 text-[11px] text-slate-400 whitespace-pre-wrap">{preview}</pre>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void start()}
            disabled={busy || !settings?.configured}
            className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {busy ? 'Ставлю задачу…' : `Згенерувати — ${OBSERVED_COST[kind]}`}
          </button>
          <span className="text-[11px] text-slate-500">
            Триває 1–3 хвилини. Правити згенероване Gamma не вміє — зміни означають повторну оплату.
          </span>
        </div>

        {error && (
          <p className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px]">{error}</p>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-white/[0.06] space-y-2">
          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Створене
          </h4>
          {jobs.map((job) => (
            <div key={job.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <p className="text-xs text-slate-100">
                {KIND_LABELS[job.kind]?.title || job.kind}
                {job.status === 'pending' && <span className="text-amber-300"> · генерується…</span>}
                {job.status === 'failed' && <span className="text-rose-300"> · не вдалося</span>}
              </p>
              {job.creditsUsed !== null && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Витрачено {job.creditsUsed} кредитів
                  {job.creditsLeft !== null ? ` · лишилось ${job.creditsLeft}` : ''}
                </p>
              )}
              {job.errorUk && <p className="text-[11px] text-rose-300 mt-0.5">{job.errorUk}</p>}
              <div className="flex flex-wrap gap-3 mt-1">
                {job.gammaUrl && (
                  <a href={job.gammaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-300 underline flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> відкрити в Gamma
                  </a>
                )}
                {job.exportUrl && (
                  <a href={job.exportUrl} className="text-[11px] text-emerald-300 underline">
                    завантажити файл
                  </a>
                )}
              </div>
              {job.exportUrl && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Посилання на файл живе близько тижня й не захищене — завантажте одразу.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
