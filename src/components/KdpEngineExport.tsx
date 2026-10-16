import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import type { Book } from '../types';

interface PdfEngineOption {
  id: string;
  label: string;
  available: boolean;
  supportsPrint?: boolean;
  reasonUk?: string;
  badgeUk?: string;
}

interface KdpEngineExportProps {
  book: Book;
  className?: string;
  compact?: boolean;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

function filenameFromDisposition(res: Response, fallback: string): string {
  const raw = res.headers.get('Content-Disposition') || '';
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(raw)?.[1];
  if (utf) {
    try { return decodeURIComponent(utf); } catch { return utf; }
  }
  const plain = /filename="?([^";]+)"?/i.exec(raw)?.[1];
  return plain || fallback;
}

function decodePdfNote(res: Response): string {
  const raw = res.headers.get('X-Pdf-Note') || '';
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const KdpEngineExport: React.FC<KdpEngineExportProps> = ({
  book,
  className = '',
  compact = false,
  onSuccess,
  onError,
}) => {
  const [engines, setEngines] = useState<PdfEngineOption[]>([]);
  const [engineId, setEngineId] = useState('nova');
  const [loadingEngines, setLoadingEngines] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingEngines(true);
    fetch('/api/pdf/engines', { credentials: 'include' })
      .then(async (res) => (res.ok ? res.json() : Promise.reject(new Error('engine_list_failed'))))
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.engines) ? payload.engines : [];
        setEngines(list);
        const supported = list.filter((engine: PdfEngineOption) => engine.supportsPrint);
        if (!supported.some((engine: PdfEngineOption) => engine.id === engineId && engine.available)) {
          const preferred = supported.find((engine: PdfEngineOption) => engine.id === 'nova' && engine.available)
            || supported.find((engine: PdfEngineOption) => engine.available)
            || supported[0];
          if (preferred) setEngineId(preferred.id);
        }
      })
      .catch(() => setEngines([]))
      .finally(() => {
        if (!cancelled) setLoadingEngines(false);
      });
    return () => { cancelled = true; };
  }, []);

  const printEngines = useMemo(
    () => engines.filter((engine) => engine.supportsPrint),
    [engines]
  );
  const selected = printEngines.find((engine) => engine.id === engineId) || null;
  const canExport = Boolean(selected?.available) && !isExporting;

  const exportKdp = async () => {
    if (!selected?.available) return;
    setIsExporting(true);
    onError?.('');
    try {
      const res = await fetch('/api/pdf/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book,
          format: 'print',
          engineId: selected.id,
          hasBleed: Number(book.layoutConfig.margins.bleedMm || 0) > 0,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.error || 'Не вдалося згенерувати KDP PDF.'));
      }
      const blob = await res.blob();
      const actualEngine = res.headers.get('X-Pdf-Engine') || selected.id;
      const pages = res.headers.get('X-Pdf-Pages');
      const note = decodePdfNote(res);
      const fallback = `${book.title.replace(/\s+/g, '_')}_KDP_${actualEngine}.pdf`;
      downloadBlob(blob, filenameFromDisposition(res, fallback));
      onSuccess?.(`KDP PDF готовий: ${actualEngine}${pages ? ` · ${pages} стор.` : ''}${note ? ` · ${note}` : ''}`);
    } catch (err) {
      onError?.(String((err as Error)?.message || err));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`${compact ? 'space-y-2' : 'space-y-3'} ${className}`}>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <label className="flex-1 min-w-0">
          <span className="block text-[11px] font-bold text-slate-400 mb-1">Рушій KDP PDF</span>
          <select
            value={engineId}
            onChange={(event) => setEngineId(event.target.value)}
            disabled={loadingEngines || isExporting || printEngines.length === 0}
            className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-100 disabled:opacity-50"
          >
            {printEngines.length === 0 && <option value="nova">Завантаження рушіїв…</option>}
            {printEngines.map((engine) => (
              <option key={engine.id} value={engine.id} disabled={!engine.available}>
                {engine.label}{engine.available ? '' : ' — недоступний'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={exportKdp}
          disabled={!canExport}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500 text-slate-950 text-xs font-bold shadow-lg transition-all flex items-center justify-center gap-2"
        >
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          <span>Експорт KDP · {selected?.label || 'оберіть рушій'}</span>
        </button>
      </div>
      {selected?.reasonUk && !selected.available && (
        <p className="text-[11px] text-rose-300">{selected.reasonUk}</p>
      )}
      {!loadingEngines && printEngines.length > 0 && (
        <p className="text-[11px] text-slate-500">
          Вибір явний: Studio не підмінює KDP-рушій автоматично. Nova — стабільний production renderer; DesignCraft — для складної дизайнерської верстки та ілюстрацій.
        </p>
      )}
    </div>
  );
};
