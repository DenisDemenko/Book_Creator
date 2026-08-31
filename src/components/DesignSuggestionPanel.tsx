import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { Book } from '../types';
import {
  applyDesignPatch,
  availableFontFamilies,
  designSampleText,
  describeDesignChanges,
  SAMPLE_MIN,
  type DesignPatch,
} from '../utils/designSuggestion';

/**
 * Панель скіла /design (Завдання 3в) — на вкладці «Верстка».
 *
 * Порядок навмисно триактний: попросити → подивитись, що зміниться →
 * застосувати. Середній акт і є суттю панелі. Оформлення торкається всієї
 * книги одразу, і якщо застосувати його одним натисканням, автор побачить
 * результат уже на розвороті, коли не памʼятає попередніх значень —
 * скасування перетворюється на відновлення по памʼяті.
 *
 * Окремо показуємо `corrections`: сервер обрізає відповідь моделі до
 * друкарських меж (поле 8 мм, кегль 7 pt книга не пережила б у KDP), і
 * автор має знати, що модель запропонувала непридатне, а не думати, що
 * панель самовільно змінила його числа.
 */

interface Props {
  book: Book;
  onUpdateBook: (updatedBook: Book, action?: string, details?: string) => void;
}

interface DesignResponse {
  patch: DesignPatch;
  modelId?: string;
  engine?: string;
}

export const DesignSuggestionPanel: React.FC<Props> = ({ book, onUpdateBook }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResponse | null>(null);

  const fonts = useMemo(() => availableFontFamilies(book), [book]);
  const sample = useMemo(() => designSampleText(book), [book]);
  const enoughText = sample.length >= SAMPLE_MIN;

  const changes = useMemo(
    () => (result ? describeDesignChanges(book.layoutConfig, result.patch) : []),
    [result, book.layoutConfig]
  );

  async function ask() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/design-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          bookId: book.id,
          bookTitle: book.title,
          genre: book.genre,
          audience: book.targetAudience ?? '',
          pageFormat: `${book.layoutConfig.formatPreset} (${book.layoutConfig.pageWidthMm}×${book.layoutConfig.pageHeightMm} мм)`,
          availableFonts: fonts,
          sampleText: sample,
          modelId: book.preferredAiModelId || undefined,
        }),
      });
      const body = await res.json().catch(() => ({ error: 'Сервер повернув не JSON.' }));
      if (!res.ok) throw new Error(body?.error || `Помилка ${res.status}`);
      setResult(body as DesignResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    const updated = applyDesignPatch(book, result.patch);
    onUpdateBook(
      updated,
      'Оформлення /design',
      changes.length
        ? `Застосовано ${changes.length} змін оформлення: ${changes.map((c) => c.label.toLowerCase()).join(', ')}`
        : 'Оформлення підтверджено без змін'
    );
    setResult(null);
  }

  return (
    <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-300" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
              Оформлення книги · /design
            </h3>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-slate-400">
            Модель читає початок вашого тексту й підбирає типографіку та поля під нього — а тоді
            показує, що саме зміниться. Нічого не застосовується, доки ви не натиснете «Застосувати».
            Результат видно на вкладці «Розворот книги».
          </p>
        </div>
        <button
          type="button"
          onClick={() => void ask()}
          disabled={busy || !enoughText}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {result ? 'Переглянути ще раз' : 'Підібрати оформлення'}
        </button>
      </div>

      {!enoughText && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-xs text-slate-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
          Замало тексту: у книзі {sample.length} знаків, потрібно щонайменше {SAMPLE_MIN}. Оформлення
          підбирається під живий текст, а не під порожній макет.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
          {result.patch.rationale && (
            <p className="text-xs italic leading-relaxed text-slate-300">«{result.patch.rationale}»</p>
          )}

          {result.patch.corrections?.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-amber-200">
                <ShieldCheck className="h-3.5 w-3.5" />
                Виправлено до друкарських меж
              </div>
              <ul className="space-y-0.5 text-[11px] leading-relaxed text-amber-100/90">
                {result.patch.corrections.map((c, i) => (
                  <li key={i}>— {c}</li>
                ))}
              </ul>
            </div>
          )}

          {changes.length === 0 ? (
            <p className="text-xs text-slate-400">
              Модель не запропонувала нічого нового: теперішнє оформлення вже відповідає тексту.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-xs">
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.label} className="border-b border-slate-800/70 last:border-0">
                      <td className="px-3 py-2 text-slate-400">{c.label}</td>
                      <td className="px-3 py-2 text-right text-slate-500 line-through">{c.before}</td>
                      <td className="w-6 px-0 py-2 text-center text-slate-600">
                        <ArrowRight className="mx-auto h-3 w-3" />
                      </td>
                      <td className="px-3 py-2 font-semibold text-emerald-300">{c.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={changes.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
              Застосувати {changes.length > 0 && `(${changes.length})`}
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.05]"
            >
              <X className="h-4 w-4" />
              Відхилити
            </button>
            {result.modelId && (
              <span className="font-mono text-[11px] text-slate-600">{result.modelId}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
