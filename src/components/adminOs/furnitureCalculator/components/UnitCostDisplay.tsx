import React from 'react';
import { Currency } from '../types';
import { formatMoney } from '../utils/calculator';

interface UnitCostDisplayProps {
  id?: string;
  unitLabel: string; // e.g. "1 м³", "1 л", "1 год", "1 шт"
  rate: number; // e.g. 13000 (грн за одиницю)
  quantity: number; // e.g. 0.045
  quantityUnit: string; // e.g. "м³", "л", "год"
  totalCost: number; // кінцева собівартість (грн)
  currency?: Currency;
  accentColor?: 'cyan' | 'blue' | 'emerald' | 'amber' | 'slate';
  decimals?: number;
}

export const UnitCostDisplay: React.FC<UnitCostDisplayProps> = ({
  id,
  unitLabel,
  rate,
  quantity,
  quantityUnit,
  totalCost,
  currency = 'UAH' as Currency,
  accentColor = 'cyan',
  decimals = 3,
}) => {
  const accentClasses = {
    cyan: 'text-cyan-300 border-cyan-500/25 bg-cyan-500/5',
    blue: 'text-blue-300 border-blue-500/25 bg-blue-500/5',
    emerald: 'text-emerald-300 border-emerald-500/25 bg-emerald-500/5',
    amber: 'text-amber-300 border-amber-500/25 bg-amber-500/5',
    slate: 'text-slate-300 border-slate-600/30 bg-slate-800/30',
  }[accentColor];

  const safeQty = typeof quantity === 'number' && !isNaN(quantity) ? quantity : 0;
  const safeDecimals = typeof decimals === 'number' && !isNaN(decimals) && decimals >= 0 ? decimals : 2;

  const formattedQuantity =
    safeQty < 1
      ? Number(safeQty.toFixed(safeDecimals)).toString()
      : safeQty % 1 === 0
      ? safeQty.toString()
      : Number(safeQty.toFixed(2)).toString();

  return (
    <div
      id={id}
      className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs transition-all ${accentClasses}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-slate-300">
        <span className="text-slate-400">Тариф:</span>
        <span className="font-mono font-semibold text-slate-200">
          {formatMoney(rate, currency)} / {unitLabel}
        </span>
        <span className="text-slate-500">×</span>
        <span className="text-slate-400">На 1 виріб:</span>
        <span className="font-mono font-semibold text-white px-1.5 py-0.5 rounded-md bg-white/10">
          {formattedQuantity} {quantityUnit}
        </span>
      </div>

      <div className="flex items-center gap-1.5 sm:self-auto self-end font-mono">
        <span className="text-[11px] text-slate-400 font-sans">Кінцева вартість:</span>
        <span className="font-bold text-sm text-white">
          {formatMoney(totalCost, currency)}
        </span>
      </div>
    </div>
  );
};
