import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { CanonicalPageMap } from '../../shared/canonicalPageMap';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface FinalPdfManifest {
  version: 1;
  bookId: string;
  format: 'digital' | 'print';
  bookRevision: number;
  engineId: string;
  filename: string;
  sizeBytes: number;
  pageCount: number;
  pageMap: CanonicalPageMap;
  builtAt: string;
  stale: boolean;
  pdfUrl: string;
}

export interface FinalPdfSpreadState {
  manifest: FinalPdfManifest;
  pageCount: number;
}

interface FinalPdfSpreadProps {
  bookId: string;
  format?: 'digital' | 'print';
  currentPageIndex: number;
  /** Visual scale only. PDF raster density stays high enough for reading. */
  zoom?: number;
  onReady?: (state: FinalPdfSpreadState) => void;
  onUnavailable?: (message: string) => void;
}

interface PdfPageCanvasProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  side: 'left' | 'right';
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({ document, pageNumber, zoom, side }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;

    const render = async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;

        // Render at a useful raster density; CSS zoom controls visual size.
        const viewport = page.getViewport({ scale: Math.max(1.25, 1.6 * zoom) });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas 2D недоступний.');

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;

        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setRenderError(null);
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== 'RenderingCancelledException') {
          setRenderError((err as Error)?.message || 'Не вдалося намалювати сторінку PDF.');
        }
      }
    };

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, zoom]);

  return (
    <div
      className={`relative overflow-hidden bg-white shadow-md ${side === 'left' ? 'rounded-l-xl border-r' : 'rounded-r-xl border-l'} border-slate-200`}
      data-final-pdf-page={pageNumber}
    >
      <canvas ref={canvasRef} className="block h-auto w-full bg-white" />
      {renderError && (
        <div className="absolute inset-0 flex items-center justify-center bg-white p-4 text-center text-xs text-rose-700">
          {renderError}
        </div>
      )}
    </div>
  );
};

/**
 * Displays pages from the persisted FINAL PDF, never from browser re-pagination.
 * Its manifest is fetched first and points to the exact PDF whose CanonicalPageMap
 * was produced by the same render. If either side is unavailable, the parent may
 * keep the legacy browser preview as a fallback.
 */
export const FinalPdfSpread: React.FC<FinalPdfSpreadProps> = ({
  bookId,
  format = 'digital',
  currentPageIndex,
  zoom = 1,
  onReady,
  onUnavailable,
}) => {
  const [manifest, setManifest] = useState<FinalPdfManifest | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;

    const load = async () => {
      setLoading(true);
      setError(null);
      setManifest(null);
      setDocument(null);

      try {
        const manifestResponse = await fetch(
          `/api/books/${encodeURIComponent(bookId)}/artifact/pdf/manifest?format=${format}`,
          { credentials: 'include' },
        );
        if (!manifestResponse.ok) {
          const payload = await manifestResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || 'Фінальний PDF ще не зібрано.');
        }
        const nextManifest = await manifestResponse.json() as FinalPdfManifest;

        const pdfResponse = await fetch(nextManifest.pdfUrl, { credentials: 'include' });
        if (!pdfResponse.ok) throw new Error('Не вдалося завантажити фінальний PDF.');
        const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
        if (bytes.byteLength !== nextManifest.sizeBytes) {
          throw new Error('PDF змінився після завантаження manifest. Оновіть розворот.');
        }

        loadedDocument = await getDocument({ data: bytes }).promise;
        if (loadedDocument.numPages !== nextManifest.pageCount) {
          throw new Error(
            `PDF має ${loadedDocument.numPages} стор., а render manifest — ${nextManifest.pageCount}. Оновіть розворот.`,
          );
        }
        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }

        setManifest(nextManifest);
        setDocument(loadedDocument);
        onReady?.({ manifest: nextManifest, pageCount: loadedDocument.numPages });
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error)?.message || 'Фінальний PDF недоступний.';
        setError(message);
        onUnavailable?.(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (loadedDocument) void loadedDocument.destroy();
    };
  }, [bookId, format, onReady, onUnavailable]);

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-sm text-slate-400">
        Завантажуємо фінальний PDF…
      </div>
    );
  }

  if (!manifest || !document || error) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-amber-900/60 bg-amber-950/20 p-6 text-center text-sm text-amber-200">
        {error || 'Фінальний PDF недоступний.'}
      </div>
    );
  }

  const safeLeftIndex = Math.max(0, Math.min(currentPageIndex, document.numPages - 1));
  const leftPageNumber = safeLeftIndex + 1;
  const rightPageNumber = leftPageNumber + 1 <= document.numPages ? leftPageNumber + 1 : null;

  return (
    <div className="space-y-3" data-final-pdf-spread data-pdf-engine={manifest.engineId}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>
          Фінальний PDF · {manifest.engineId} · {manifest.pageMap.precision === 'exact' ? 'точна карта сторінок' : 'лише кількість сторінок'}
        </span>
        {manifest.stale && (
          <span className="rounded-full border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-amber-300">
            PDF створено з попередньої ревізії книги
          </span>
        )}
      </div>

      <div style={{ zoom }} className="relative grid grid-cols-1 gap-0 rounded-2xl border-4 border-slate-800 bg-[#e2ded6] p-2 shadow-2xl md:grid-cols-2 sm:p-3">
        <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 z-10 hidden w-8 -translate-x-1/2 bg-gradient-to-r from-black/20 via-black/40 to-black/20 md:block" />
        <PdfPageCanvas document={document} pageNumber={leftPageNumber} zoom={zoom} side="left" />
        {rightPageNumber ? (
          <PdfPageCanvas document={document} pageNumber={rightPageNumber} zoom={zoom} side="right" />
        ) : (
          <div className="flex min-h-[520px] items-center justify-center rounded-r-xl border-l border-slate-200 bg-[#faf9f5] text-xs italic text-slate-300">
            Порожня сторінка
          </div>
        )}
      </div>
    </div>
  );
};
