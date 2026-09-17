import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Check, Package, Search, X } from 'lucide-react';
import { Currency } from '../types';
import { formatMoney } from '../utils/calculator';

/**
 * Товар зі списку `/api/admin/furniture-products` — лише поля, які тут
 * читаються й пишуться назад. Повний `FurnitureProduct` живе в
 * `src/components/adminOs/furnitureProduct.ts`; калькулятор навмисно не
 * імпортує звідти типи (різні застосунки в одному репозиторії — форма й
 * тип-джерело мають лишитись незалежними), а працює зі структурною
 * підмножиною через сирий `fetch`, так само як і сам редактор картки.
 */
interface FurnitureProductLite {
  id: string;
  sku: string;
  name: string;
  priceUah: number;
  status: 'draft' | 'published' | 'archived';
  [key: string]: unknown;
}

interface ApplyToProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** result.totalSellingPrice поточного розрахунку — завжди в гривнях. */
  totalSellingPriceUah: number;
  currency: Currency;
  onApplied: (message: string) => void;
}

/**
 * «Додати до ціни товару» — власник: калькулятор собівартості повинен мати
 * можливість вибрати вже опублікований товар АБО чорнетку («той, що
 * планується опублікувати») і додати результат калькуляції до його ціни.
 * Саме ДОДАТИ (priceUah += підсумок), а не замінити — обрано власником:
 * розрахунок описує додаткову вартість (наприклад, вбудованої
 * електроніки) понад те, що товар уже коштує.
 *
 * Читання й запис ідуть через той самий маршрут, що й редактор картки
 * (`/api/admin/furniture-products`, GET список / POST upsert по id) —
 * окремого API для цього не заводилось.
 */
export const ApplyToProductModal: React.FC<ApplyToProductModalProps> = ({
  isOpen,
  onClose,
  totalSellingPriceUah,
  currency,
  onApplied,
}) => {
  const [products, setProducts] = useState<FurnitureProductLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    (async () => {
      try {
        const res = await fetch('/api/admin/furniture-products', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Не вдалося завантажити список товарів.');
        if (!cancelled) setProducts(Array.isArray(data?.products) ? data.products : []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Помилка завантаження списку товарів.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)
    );
  }, [products, query]);

  const selected = useMemo(() => products.find((p) => p.id === selectedId) ?? null, [products, selectedId]);

  if (!isOpen) return null;

  const handleApply = async () => {
    if (!selected) return;
    setApplyingId(selected.id);
    setError(null);
    try {
      const updated = { ...selected, priceUah: Math.round((selected.priceUah || 0) + totalSellingPriceUah) };
      const res = await fetch('/api/admin/furniture-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ product: updated }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося оновити ціну товару.');
      onApplied(
        `${selected.name || selected.sku}: ціну збільшено на ${formatMoney(totalSellingPriceUah, currency)} → ${formatMoney(
          updated.priceUah,
          currency
        )}`
      );
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Помилка застосування до товару.');
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl my-auto bg-[#0c1427] border border-white/10 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl neo-icon-btn flex items-center justify-center border border-emerald-400/30 text-emerald-300">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Додати до ціни товару</h2>
              <p className="text-xs text-slate-400">
                Підсумок розрахунку: <span className="text-emerald-300 font-semibold">{formatMoney(totalSellingPriceUah, currency)}</span> додасться до ціни обраного товару
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl neo-card flex items-center justify-center text-slate-400 hover:text-white cursor-pointer transition-colors"
            aria-label="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук за назвою або артикулом…"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl neo-inset text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>

          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-slate-400 font-mono py-6 text-center">Завантаження товарів…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-400 font-mono py-6 text-center">
              {products.length === 0 ? 'Ще немає жодної картки товару.' : 'Нічого не знайдено.'}
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {filtered.map((p) => {
                const isSelected = p.id === selectedId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-colors flex items-center gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500/50'
                        : 'neo-card-subtle border-white/5 hover:border-white/15'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-slate-400'
                      }`}
                    >
                      {isSelected ? <Check className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-white truncate">
                        {p.name || '(без назви)'}
                      </span>
                      <span className="block text-[11px] text-slate-400 font-mono">
                        {p.sku || '—'} · {p.status === 'published' ? 'опубліковано' : p.status === 'archived' ? 'в архіві' : 'чорнетка'}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-xs font-mono text-slate-300">{formatMoney(p.priceUah || 0, currency)}</span>
                      {isSelected ? (
                        <span className="block text-[11px] font-mono text-emerald-300">
                          → {formatMoney((p.priceUah || 0) + totalSellingPriceUah, currency)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] shrink-0 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl neo-card text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
          >
            Скасувати
          </button>
          <button
            type="button"
            disabled={!selected || applyingId !== null}
            onClick={handleApply}
            className="px-5 py-2 rounded-xl neo-pill-active text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(16,185,129,0.35)]"
          >
            <Check className="w-4 h-4" />
            <span>{applyingId ? 'Застосовую…' : 'Додати до ціни'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApplyToProductModal;
