import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, History, Loader2, Stethoscope } from 'lucide-react';
import type { Book } from '../types';
import { DiagnosticReportCard, type DiagnReport } from './DiagnosticReportCard';
import { designSampleText } from '../utils/designSuggestion';

/**
 * Вкладка «Діагностика» — вхід до модуля /diagn
 * (diagn-module-tech-spec-v1.0.md).
 *
 * Три підмодулі — три окремі перемикачі, а не одна кнопка «аналізувати».
 * Кожен підмодуль — це окремий виклик моделі, тобто окремі гроші; автор,
 * якому потрібна лише структура, не має платити за три.
 *
 * Джерело тексту за замовчуванням — сам рукопис, і це навмисно: команда з
 * ТЗ приймає довільний текст, але людина, яка відкрила студію, майже
 * завжди хоче діагностику того, що вже написала, а не того, що зараз
 * вставить із буфера.
 */

const MODULES: { id: 'style' | 'structure' | 'competency'; label: string; hint: string }[] = [
  { id: 'style', label: 'Стиль', hint: 'синтаксис, лексика, ритм, діалоги' },
  { id: 'structure', label: 'Структура', hint: 'архетип Польті, дуга героя, відхилення' },
  { id: 'competency', label: 'Компетенції', hint: 'радар навичок і вправи далі' },
];

interface HistoryItem {
  diagn_id: string;
  created_at: string;
  modules: string[];
  word_count: number;
}

export const DiagnosticsView: React.FC<{ book: Book }> = ({ book }) => {
  const [selected, setSelected] = useState<string[]>(MODULES.map((m) => m.id));
  const [useManuscript, setUseManuscript] = useState(true);
  const [customText, setCustomText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnReport | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Беремо той самий екстрактор, що й /design: розмітка рукопису
  // ([IMG:…], [AI-DRAFT]) не є текстом книги й не має аналізуватись як він.
  const manuscript = useMemo(() => designSampleText(book, 40_000), [book]);
  const text = useManuscript ? manuscript : customText;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/diagn/history?document_id=${encodeURIComponent(book.id)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const body = await res.json();
      setHistory(Array.isArray(body.items) ? body.items : []);
    } catch {
      /* історія — довідка, її відсутність не має ламати екран */
    }
  }, [book.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/diagn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          input: { type: 'raw_text', content: text },
          modules: selected,
          format: 'card',
          locale: 'uk',
          book_id: book.id,
          book_title: book.title,
          genre: book.genre,
        }),
      });
      const body = await res.json().catch(() => ({ error: 'Сервер повернув не JSON.' }));
      if (!res.ok) {
        throw new Error(
          body?.kind === 'rate_limited' && body?.retry_at
            ? `${body.error} Спробуйте після ${new Date(body.retry_at).toLocaleTimeString('uk-UA')}.`
            : body?.error || `Помилка ${res.status}`
        );
      }
      setReport(body as DiagnReport);
      void loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/diagn/${id}`, { credentials: 'same-origin' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Не вдалося відкрити діагностику.');
      setReport(body as DiagnReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="flex-1 space-y-6 overflow-y-auto bg-slate-900 p-4 text-slate-100 lg:p-6">
      <header className="nova-glass-dark rounded-2xl border border-slate-800 p-6">
        <div className="mb-1 flex items-center gap-2 text-emerald-400">
          <Stethoscope className="h-5 w-5" />
          <span className="font-mono text-xs font-bold uppercase tracking-widest">/diagn</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-100">Діагностика тексту й автора</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
          Три незалежні аналізи. Кожен — окремий виклик моделі, тож обирайте те, що справді
          потрібно: за все одразу платить ваш ключ.
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {MODULES.map((m) => {
            const on = selected.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  on
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                }`}
              >
                <div className={`text-sm font-bold ${on ? 'text-emerald-300' : 'text-slate-300'}`}>
                  {m.label}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{m.hint}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-slate-300">
            <input
              type="radio"
              checked={useManuscript}
              onChange={() => setUseManuscript(true)}
              className="accent-emerald-500"
            />
            Рукопис книги
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-slate-300">
            <input
              type="radio"
              checked={!useManuscript}
              onChange={() => setUseManuscript(false)}
              className="accent-emerald-500"
            />
            Свій текст
          </label>
          <span className={`font-mono ${words < 300 ? 'text-amber-300' : 'text-slate-500'}`}>
            {words} слів
          </span>
        </div>

        {!useManuscript && (
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={6}
            placeholder="Вставте уривок для аналізу…"
            className="mt-3 w-full resize-y rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
          />
        )}

        {words > 0 && words < 300 && selected.some((s) => s === 'style' || s === 'structure') && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Менш ніж 300 слів. Аналіз відпрацює, але висновки про стиль і структуру будуть
            орієнтовними — про це буде сказано і в самому звіті.
          </p>
        )}

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || words === 0 || selected.length === 0}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
          Запустити діагностику
        </button>

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
      </header>

      {report && <DiagnosticReportCard report={report} documentTitle={book.title} />}

      {history.length > 0 && (
        <section className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
            <History className="h-3.5 w-3.5" />
            Історія діагностик
          </h3>
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.diagn_id}>
                <button
                  type="button"
                  onClick={() => void open(h.diagn_id)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.05]"
                >
                  <span className="font-mono text-slate-400">
                    {new Date(h.created_at).toLocaleString('uk-UA')}
                  </span>
                  <span className="text-slate-500">{h.modules.join(', ')}</span>
                  <span className="text-slate-600">{h.word_count} слів</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">
            Звіти зберігаються, щоб радар компетенцій можна було порівняти через місяці.
          </p>
        </section>
      )}
    </div>
  );
};
