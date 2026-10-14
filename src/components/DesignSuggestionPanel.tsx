import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
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

interface PdfEngineOption {
  id: string;
  label: string;
  available: boolean;
  strengthUk?: string;
  limitUk?: string;
  reasonUk?: string;
  fixUk?: string;
  supportsPrint?: boolean;
}

const DEFAULT_PDF_ENGINE_ID = 'nova';

function readPdfNote(res: Response): string {
  const raw = res.headers.get('X-Pdf-Note') || '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const DesignSuggestionPanel: React.FC<Props> = ({ book, onUpdateBook }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResponse | null>(null);

  const [pdfEngines, setPdfEngines] = useState<PdfEngineOption[]>([]);
  const [pdfEngineId, setPdfEngineId] = useState(DEFAULT_PDF_ENGINE_ID);
  const [pdfEnginesLoading, setPdfEnginesLoading] = useState(true);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [pdfPreviewInfo, setPdfPreviewInfo] = useState<string | null>(null);

  const fonts = useMemo(() => availableFontFamilies(book), [book]);
  const sample = useMemo(() => designSampleText(book), [book]);
  const enoughText = sample.length >= SAMPLE_MIN;

  const changes = useMemo(
    () => (result ? describeDesignChanges(book.layoutConfig, result.patch) : []),
    [result, book.layoutConfig]
  );

  const selectedPdfEngine = useMemo(
    () => pdfEngines.find((engine) => engine.id === pdfEngineId) || null,
    [pdfEngines, pdfEngineId]
  );

  useEffect(() => {
    let cancelled = false;
    setPdfEnginesLoading(true);

    void fetch('/api/pdf/engines', { credentials: 'same-origin' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `Не вдалося прочитати PDF-рушії (${res.status}).`);
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        const engines = Array.isArray(body?.engines) ? (body.engines as PdfEngineOption[]) : [];
        setPdfEngines(engines);
        const requestedDefault = String(body?.defaultEngineId || DEFAULT_PDF_ENGINE_ID);
        setPdfEngineId((current) => {
          const currentItem = engines.find((item) => item.id === current);
          if (currentItem?.available) return current;
          const serverDefault = engines.find((item) => item.id === requestedDefault && item.available);
          return serverDefault?.id || engines.find((item) => item.available)?.id || requestedDefault;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setPdfEngines([]);
          setPdfPreviewError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setPdfEnginesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  async function previewPdf() {
    setPdfPreviewLoading(true);
    setPdfPreviewError(null);
    setPdfPreviewInfo(null);
    try {
      const res = await fetch('/api/admin/pdf/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          book,
          variant: 'code',
          format: 'digital',
          engineId: pdfEngineId,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Не вдалося створити PDF (${res.status}).`);
      }

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);

      const pages = res.headers.get('X-Pdf-Pages');
      const engine = res.headers.get('X-Pdf-Engine') || pdfEngineId;
      const honored = res.headers.get('X-Pdf-Honored-Spec');
      const note = readPdfNote(res);
      setPdfPreviewInfo(
        [
          `Рушій: ${engine}`,
          pages ? `${pages} стор.` : '',
          honored === '0' ? 'частину параметрів макета не підтримано' : '',
          note,
        ]
          .filter(Boolean)
          .join(' · ')
      );
    } catch (e) {
      setPdfPreviewError((e as Error).message);
    } finally {
      setPdfPreviewLoading(false);
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
      <div className="mb-5 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-200">
              <FileText className="h-3.5 w-3.5" />
              Рушій PDF
            </span>
            <select
              value={pdfEngineId}
              disabled={pdfEnginesLoading || pdfPreviewLoading || pdfEngines.length === 0}
              onChange={(e) => {
                setPdfEngineId(e.target.value);
                setPdfPreviewError(null);
                setPdfPreviewInfo(null);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-200 outline-none transition-colors focus:border-sky-500 disabled:opacity-50"
            >
              {pdfEnginesLoading && <option value={pdfEngineId}>Завантаження рушіїв…</option>}
              {!pdfEnginesLoading && pdfEngines.length === 0 && <option value={pdfEngineId}>Рушії недоступні</option>}
              {pdfEngines.map((engine) => (
                <option key={engine.id} value={engine.id} disabled={!engine.available}>
                  {engine.label}{engine.available ? '' : ' — недоступний'}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void previewPdf()}
            disabled={pdfPreviewLoading || pdfEnginesLoading || !selectedPdfEngine?.available}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pdfPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {pdfPreviewLoading ? 'Верстаю книгу…' : 'Відкрити PDF-прев’ю'}
          </button>
        </div>

        {selectedPdfEngine && (
          <div className="mt-2.5 space-y-1 text-[11px] leading-relaxed text-slate-400">
            {selectedPdfEngine.strengthUk && <p>{selectedPdfEngine.strengthUk}</p>}
            {selectedPdfEngine.limitUk && <p className="text-slate-500">Обмеження: {selectedPdfEngine.limitUk}</p>}
            {!selectedPdfEngine.available && selectedPdfEngine.reasonUk && (
              <p className="text-amber-300">{selectedPdfEngine.reasonUk}</p>
            )}
            {!selectedPdfEngine.available && selectedPdfEngine.fixUk && (
              <p className="text-slate-500">{selectedPdfEngine.fixUk}</p>
            )}
          </div>
        )}

        {pdfPreviewError && (
          <p role="alert" className="mt-2.5 flex items-start gap-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {pdfPreviewError}
          </p>
        )}
        {pdfPreviewInfo && <p className="mt-2.5 text-[11px] leading-relaxed text-emerald-300">{pdfPreviewInfo}</p>}
      </div>

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
