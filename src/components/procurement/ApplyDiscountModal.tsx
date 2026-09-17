import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Check, Package, Search, X } from 'lucide-react';
import { procurementSavingsPercent, type ProcurementApplication, type ProcurementRecord } from '../adminOs/procurement';

/**
 * Товар зі списку `/api/admin/furniture-products` — структурна підмножина,
 * той самий підхід, що й у `ApplyToProductModal.tsx` калькулятора: форма й
 * тип-джерело (`FurnitureProduct`) навмисно лишаються незалежними.
 */
interface FurnitureProductLite {
  id: string;
  sku: string;
  name: string;
  priceUah: number;
  basePriceUah: number;
  discountSourceProcurementId: string | null;
  status: 'draft' | 'published' | 'archived';
  [key: string]: unknown;
}

interface ApplyDiscountModalProps {
  record: ProcurementRecord | null;
  onClose: () => void;
  onApplied: (updatedRecord: ProcurementRecord, message: string) => void;
}

const money = (uah: number) => `${uah.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;

/**
 * «Застосувати знижку» — від запису закупівлі до вибраних карток товарів.
 *
 * Власник (підтверджено окремим питанням) обирає товари ВРУЧНУ — жодного
 * автоматичного зіставлення за матеріалом. Відсоток знижки за замовчуванням —
 * реальна економія цього запису закупівлі (`procurementSavingsPercent`), але
 * власник може відредагувати число перед застосуванням: закупівля дає
 * ОБҐРУНТУВАННЯ знижки, а не жорстко нав'язаний відсоток.
 *
 * Механіка на товарі: `basePriceUah` — це референс «до знижки». Якщо він ще
 * не встановлений вище за поточну ціну, беремо поточну ціну за референс
 * (перша знижка на товар). Далі `priceUah` рахується як
 * `basePriceUah * (1 - percent/100)` — округлено до гривні. Саме цю пару вже
 * читає бейдж знижки на вітрині (перевірено робочим у записі журналу #180).
 *
 * Запис закупівлі отримує новий рядок в `appliedTo` — так знижка на товарі
 * лишається простежуваною до конкретної закупівлі.
 */
export const ApplyDiscountModal: React.FC<ApplyDiscountModalProps> = ({ record, onClose, onApplied }) => {
  const [products, setProducts] = useState<FurnitureProductLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [percent, setPercent] = useState(0);

  const isOpen = record !== null;

  useEffect(() => {
    if (!isOpen || !record) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    setPercent(procurementSavingsPercent(record));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, record?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
  }, [products, query]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const priceAfterDiscount = (p: FurnitureProductLite): number => {
    const base = p.basePriceUah > p.priceUah ? p.basePriceUah : p.priceUah;
    return Math.max(0, Math.round(base * (1 - percent / 100)));
  };

  if (!isOpen || !record) return null;

  const selectedProducts = products.filter((p) => selectedIds.has(p.id));

  const handleApply = async () => {
    if (selectedProducts.length === 0 || !(percent > 0)) return;
    setApplying(true);
    setError(null);
    try {
      const applications: ProcurementApplication[] = [];
      for (const p of selectedProducts) {
        const base = p.basePriceUah > p.priceUah ? p.basePriceUah : p.priceUah;
        const newPrice = priceAfterDiscount(p);
        const updated = {
          ...p,
          basePriceUah: base,
          priceUah: newPrice,
          discountSourceProcurementId: record.id,
        };
        const res = await fetch('/api/admin/furniture-products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ product: updated }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Не вдалося оновити ціну товару «${p.name || p.sku}».`);
        applications.push({
          productId: p.id,
          productName: p.name || p.sku || p.id,
          priceBeforeUah: p.priceUah,
          priceAfterUah: newPrice,
          discountPercentApplied: percent,
          appliedAt: new Date().toISOString(),
        });
      }

      const updatedRecord: ProcurementRecord = {
        ...record,
        appliedTo: [...record.appliedTo, ...applications],
      };
      const recRes = await fetch('/api/admin/procurement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ record: updatedRecord }),
      });
      const recData = await recRes.json().catch(() => ({}));
      if (!recRes.ok) throw new Error(recData?.error || 'Ціни оновлено, але не вдалося зберегти історію застосувань у закупівлі.');

      const names = applications.map((a) => a.productName).join(', ');
      onApplied(
        recData.record as ProcurementRecord,
        `Знижку ${percent}% застосовано: ${names}.`
      );
    } catch (err: any) {
      setError(err?.message || 'Помилка застосування знижки.');
    } finally {
      setApplying(false);
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
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center border border-emerald-400/30 text-emerald-300 shrink-0">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Застосувати знижку</h2>
              <p className="text-xs text-slate-400">
                {record.material || 'Закупівля'} · {money(record.oldPricePerUnitUah)} → {money(record.newPricePerUnitUah)} / {record.unit}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white cursor-pointer transition-colors"
            aria-label="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <label className="block text-[11px] text-slate-400 space-y-1">
            <span>
              Розмір знижки, % <span className="text-slate-600">(за замовчуванням — реальна економія цієї закупівлі, можна відредагувати)</span>
            </span>
            <input
              type="number"
              min={0}
              max={95}
              step="0.1"
              value={percent || ''}
              onChange={(e) => setPercent(Math.max(0, Math.min(95, Number(e.target.value) || 0)))}
              className="w-32 px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Пошук за назвою або артикулом…"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>

          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200">{error}</div>
          )}

          {loading ? (
            <p className="text-xs text-slate-400 font-mono py-6 text-center">Завантаження товарів…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-400 font-mono py-6 text-center">
              {products.length === 0 ? 'Ще немає жодної картки товару.' : 'Нічого не знайдено.'}
            </p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {filtered.map((p) => {
                const isSelected = selectedIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleSelected(p.id)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-colors flex items-center gap-3 cursor-pointer ${
                      isSelected ? 'bg-emerald-950/40 border-emerald-500/50' : 'bg-slate-900/60 border-white/5 hover:border-white/15'
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
                      <span className="block text-sm font-semibold text-white truncate">{p.name || '(без назви)'}</span>
                      <span className="block text-[11px] text-slate-400 font-mono">
                        {p.sku || '—'} · {p.status === 'published' ? 'опубліковано' : p.status === 'archived' ? 'в архіві' : 'чорнетка'}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-xs font-mono text-slate-300">{money(p.priceUah || 0)}</span>
                      {isSelected && percent > 0 && (
                        <span className="block text-[11px] font-mono text-emerald-300">→ {money(priceAfterDiscount(p))}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] shrink-0 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">{selectedProducts.length} обрано</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={selectedProducts.length === 0 || !(percent > 0) || applying}
              onClick={() => void handleApply()}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(16,185,129,0.35)]"
            >
              <Check className="w-4 h-4" />
              <span>{applying ? 'Застосовую…' : `Застосувати до ${selectedProducts.length || ''}`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApplyDiscountModal;
