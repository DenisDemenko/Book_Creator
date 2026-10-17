import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileCheck2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { Book } from '../../types';

interface EngineOption {
  id: string;
  label: string;
  available: boolean;
  supportsPrint: boolean;
  reasonUk?: string;
}

type PreviewFormat = 'digital' | 'print';

interface AuthoritativePdfPreviewProps {
  book: Book;
}

/**
 * Shows the actual bytes produced by the selected export engine.
 * This is intentionally separate from the editable WYSIWYG canvas: the canvas
 * is convenient for authoring, while this viewer is the acceptance source of
 * truth for physical page numbers.
 */
export const AuthoritativePdfPreview: React.FC<AuthoritativePdfPreviewProps> = ({ book }) => {
  const [engines, setEngines] = useState<EngineOption[]>([]);
  const [engineId, setEngineId] = useState('nova');
  const [format, setFormat] = useState<PreviewFormat>('digital');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [mappingLevel, setMappingLevel] = useState<string>('physical-only');
  const [authoritative, setAuthoritative] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string>('');
  const [renderedSignature, setRenderedSignature] = useState('');
  const currentUrl = useRef<string | null>(null);

  const bookSignature = useMemo(() => JSON.stringify({
    id: book.id,
    title: book.title,
    chapters: book.chapters,
    layoutConfig: book.layoutConfig,
    pdfLayout: book.pdfLayout,
    illustrations: book.illustrations,
    footnotes: book.footnotes,
  }), [book]);
  const targetSignature = `${engineId}:${format}:${bookSignature}`;
  const stale = Boolean(pdfUrl && renderedSignature !== targetSignature);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/pdf/engines', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Не вдалося отримати перелік PDF-рушіїв.');
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.engines) ? payload.engines : [];
        setEngines(list.map((item: any) => ({
          id: String(item.id || ''),
          label: String(item.label || item.id || ''),
          available: item.available !== false,
          supportsPrint: item.supportsPrint === true,
          reasonUk: item.reasonUk ? String(item.reasonUk) : undefined,
        })));
        if (typeof payload?.defaultEngineId === 'string') setEngineId(payload.defaultEngineId);
      })
      .catch(() => {
        // Nova is the safe UI default; the render request surfaces a concrete
        // server reason if even Nova is unavailable (for example fonts).
        if (!cancelled) setEngines([{ id: 'nova', label: 'Nova (власна верстка)', available: true, supportsPrint: true }]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
  }, []);

  const selected = engines.find((engine) => engine.id === engineId);
  const unsupportedPrint = format === 'print' && selected?.supportsPrint === false;

  const renderPdf = async () => {
    setRendering(true);
    setError('');
    try {
      const response = await fetch('/api/pdf/author-preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book, engineId, format, kind: 'book' }),
      });
      if (!response.ok) {
        let message = `PDF preview: HTTP ${response.status}`;
        try {
          const payload = await response.json();
          if (payload?.error) message = String(payload.error);
        } catch {
          // Preserve HTTP fallback.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (blob.type && blob.type !== 'application/pdf') {
        throw new Error('Сервер повернув не PDF-файл.');
      }
      const nextUrl = URL.createObjectURL(blob);
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = nextUrl;
      setPdfUrl(nextUrl);
      setPageCount(Number(response.headers.get('X-Pdf-Pages') || 0) || null);
      setMappingLevel(response.headers.get('X-Pdf-Mapping-Level') || 'physical-only');
      setAuthoritative(response.headers.get('X-Pdf-Authoritative') === '1');
      setRenderedSignature(targetSignature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося створити точний PDF preview.');
    } finally {
      setRendering(false);
    }
  };

  const fallbackEngines: EngineOption[] = [
    { id: 'nova', label: 'Nova (власна верстка)', available: true, supportsPrint: true },
  ];

  return (
    <section className="mx-4 mt-4 rounded-2xl border border-emerald-500/25 bg-slate-950/90 p-4 lg:mx-6" data-authoritative-pdf-preview>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
            <FileCheck2 className="h-4 w-4" />
            Точний PDF — джерело істини для номерів сторінок
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Тут показується сам файл, створений обраним експортним рушієм і форматом. Тому сторінка 73 у цьому перегляді — це фізично сторінка 73 відповідного PDF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as PreviewFormat)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200"
            aria-label="PDF format"
          >
            <option value="digital">Digital PDF</option>
            <option value="print">Print / KDP</option>
          </select>
          <select
            value={engineId}
            onChange={(event) => setEngineId(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200"
            aria-label="PDF engine"
          >
            {(engines.length ? engines : fallbackEngines).map((engine) => (
              <option key={engine.id} value={engine.id} disabled={!engine.available || (format === 'print' && !engine.supportsPrint)}>
                {engine.label}{!engine.available ? ' — недоступний' : format === 'print' && !engine.supportsPrint ? ' — без Print' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={renderPdf}
            disabled={rendering || selected?.available === false || unsupportedPrint}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${rendering ? 'animate-spin' : ''}`} />
            {rendering ? 'Верстаю…' : pdfUrl ? 'Оновити точний PDF' : 'Створити точний PDF'}
          </button>
        </div>
      </div>

      {selected?.available === false && selected.reasonUk && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          {selected.reasonUk}
        </div>
      )}
      {unsupportedPrint && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Цей рушій не створює Print/KDP. Для точного друкованого preview оберіть Nova.
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {pdfUrl && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-3 py-2 text-[10px] text-slate-400">
            <span>Формат: <b className="text-slate-200">{format === 'print' ? 'Print / KDP' : 'Digital'}</b></span>
            <span>Рушій: <b className="text-slate-200">{engineId}</b></span>
            <span>Сторінок: <b className="text-slate-200">{pageCount ?? '—'}</b></span>
            <span>Карта: <b className="text-slate-200">{mappingLevel}</b></span>
            <span className={authoritative ? 'text-emerald-300' : 'text-amber-300'}>
              {authoritative ? 'export-authoritative' : 'не підтверджено сервером'}
            </span>
            {stale && <span className="font-bold text-amber-300">Книга/формат/рушій змінені — preview треба оновити</span>}
          </div>
          <object data={pdfUrl} type="application/pdf" className="h-[72vh] min-h-[560px] w-full bg-white">
            <iframe title="Точний PDF preview" src={pdfUrl} className="h-[72vh] min-h-[560px] w-full bg-white" />
          </object>
        </div>
      )}
    </section>
  );
};
