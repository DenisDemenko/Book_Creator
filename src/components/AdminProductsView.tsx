import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Info, Package, RefreshCw } from 'lucide-react';

/**
 * «Управління товарами» — що зараз стоїть у вітрині маркетплейсу.
 *
 * ЧОМУ ОКРЕМИЙ РОЗДІЛ. Доти перелік товарів і зняття лістинга жили всередині
 * «Моста до вітрини» — поруч з адресою API та ключем. Це різні дії: міст
 * налаштовують один раз, а товари переглядають і знімають постійно. Вузол
 * «Управління товарами» дає їм окремий екран.
 *
 * ЧОМУ ТУТ НЕМА КНОПКИ «ДОДАТИ». Додавання товару — це публікація книги чи
 * курсу зі Студії: там збирається PDF, обкладинка й ціна, тобто все, що
 * маркетплейс приймає. Адмінпанель книги не має (рукопис живе в браузері
 * автора), тож «додати» звідси означало б або фальшиву кнопку, або майстер,
 * який просить файли руками. Тому екран чесно показує, ЗВІДКИ товар береться,
 * і дає те, що справді може: побачити перелік і зняти лістинг.
 */

/** Рядок вітрини — той самий, що віддає `/api/admin/marketplace-bridge/books`. */
interface ShelfRow {
  externalId: string;
  slug: string;
  title: string;
  status: string;
  priceMinor: number;
  sellerSlug: string | null;
  publishedAt: string | null;
  hasFile: boolean;
  fileName: string | null;
}

/**
 * `externalId` мосту — це `${bookId}:${format}` (див. bridgeExternalId у
 * server/marketplaceBridge.ts). Розбираємо з КІНЦЯ: формат — завжди одне слово
 * без двокрапки, а от ідентифікатор книги колись може її містити.
 */
function parseExternalId(externalId: string): { bookId: string; format: 'digital' | 'print' } {
  const at = externalId.lastIndexOf(':');
  const raw = at >= 0 ? externalId.slice(at + 1) : 'digital';
  return {
    bookId: at >= 0 ? externalId.slice(0, at) : externalId,
    format: raw === 'print' ? 'print' : 'digital',
  };
}

const FORMAT_LABELS: Record<'digital' | 'print', string> = {
  digital: 'Електронний',
  print: 'Друкований',
};

const money = (priceMinor: number) =>
  priceMinor > 0 ? `${(priceMinor / 100).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴` : '—';

export const AdminProductsView: React.FC = () => {
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Який саме лістинг чекає підтвердження — щоб не зняти чуже одним кліком. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/marketplace-bridge/books', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося прочитати перелік товарів.');
      setRows(Array.isArray(data.books) ? data.books : []);
    } catch (err: any) {
      setRows(null);
      setError(err?.message || 'Помилка читання переліку.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (row: ShelfRow) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/marketplace-bridge/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ externalId: row.externalId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося зняти лістинг.');
      setNotice(`«${row.title}» знято з вітрини.`);
      setConfirming(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Помилка зняття.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-slate-800 text-slate-300 shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Управління товарами</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Що зараз стоїть у вітрині: книги й курси, їхні формати й ціни.
              </p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            Оновити
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-950/50 border border-slate-800 p-3">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            <b className="text-slate-300">Додати товар</b> можна лише зі Студії: відкрийте книгу або курс і
            надішліть їх у вітрину з розділу «Публікація та експорт» — там збираються PDF, обкладинка й ціна.
            Тут товар <b className="text-slate-300">знімають</b>: лістинг іде в архів, а не видаляється, тож
            покупець, який уже придбав книгу, доступу не втрачає.
          </p>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2" role="status">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
        {rows === null && !error && <p className="text-xs text-slate-500">Завантаження…</p>}
        {rows?.length === 0 && <p className="text-xs text-slate-500">У вітрині порожньо.</p>}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((row) => {
              const { bookId, format } = parseExternalId(row.externalId);
              const waiting = confirming === row.externalId;
              return (
                <div
                  key={row.externalId}
                  className="flex items-center gap-3 rounded-xl bg-slate-950/50 border border-slate-800 p-3 flex-wrap"
                >
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 bg-slate-800 text-slate-300 border-slate-700">
                    {FORMAT_LABELS[format]}
                  </span>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-xs font-semibold text-slate-200 truncate">{row.title}</p>
                    <p className="text-[10px] text-slate-500 font-mono truncate">
                      {bookId}
                      {row.slug ? ` · ${row.slug}` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] tabular-nums text-slate-300 shrink-0">{money(row.priceMinor)}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${
                      row.hasFile
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                    title={row.fileName || 'Файл не вказано'}
                  >
                    {row.hasFile ? 'Файл є' : 'Без файла'}
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0">{row.status}</span>

                  {waiting ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => void remove(row)}
                        disabled={busy}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold disabled:opacity-50"
                      >
                        <Ban className="w-3.5 h-3.5" /> Підтвердити
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                      >
                        Скасувати
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming(row.externalId)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-[11px] font-semibold shrink-0"
                    >
                      <Ban className="w-3.5 h-3.5" /> Зняти з вітрини
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
