/**
 * Розділ калькулятора меблів «Накладні витрати з борду» (задача #211).
 *
 * Автопідключення до вкладки адмінки «Борд витрат»
 * (src/components/AdminExpenseBoardView.tsx): ставка «на одиницю» (ШІ +
 * Railway + інші накладні витрати, розподілені на кількість проданого за
 * поточний місяць) підтягується сервером при відкритті калькулятора
 * (FurnitureCalculatorPanel), а тут лише показується й може бути
 * перевизначена вручну — якщо борд ще порожній (0 продажів = нема на що
 * ділити) чи недоступний.
 */
import React from 'react';
import { Wallet, TrendingUp, AlertTriangle } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { NeoTactileCard } from './NeoTactileCard';
import { NeoTactileNumberInput } from './NeoTactileNumberInput';
import { NeoTactileToggle } from './NeoTactileToggle';
import { formatMoney } from '../utils/calculator';

interface ExpenseBoardOverheadSectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
  result: CalculationResult;
  currency: Currency;
  rates?: CurrencyRates;
  boardLoaded: boolean;
  boardError: string | null;
  boardPeriodLabel?: string;
}

export const ExpenseBoardOverheadSection: React.FC<ExpenseBoardOverheadSectionProps> = ({
  input,
  onChange,
  result,
  currency,
  rates = { USD: 41.5, EUR: 45.2 },
  boardLoaded,
  boardError,
  boardPeriodLabel,
}) => {
  const isIncluded = input.includeExpenseBoardOverhead !== false;
  const overheadUsd = input.expenseBoardOverheadCostUsd ?? 0;
  const usdRate = rates.USD || 41.5;

  return (
    <NeoTactileCard
      id="expense-board-overhead-card"
      title="6б. Накладні витрати з борду (ШІ + Railway + інше)"
      subtitle="Автоматично з вкладки адмінки «Борд витрат»: сума ділиться на кількість проданого за місяць у трьох лінійках бізнесу"
      icon={Wallet}
      badge={
        isIncluded
          ? `${formatMoney(result.expenseBoardOverheadCostUah, currency)} ($${result.expenseBoardOverheadCostUsd.toFixed(2)})`
          : 'Вимкнено'
      }
      badgeColor="amber"
      collapsible
      defaultExpanded
    >
      <div className="space-y-4">
        <div className="p-4 rounded-2xl neo-inset border border-amber-500/20 bg-slate-950/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> Overhead Absorption
              </span>
              {boardPeriodLabel && (
                <span className="text-xs text-slate-400">
                  Період: <strong className="text-white font-mono capitalize">{boardPeriodLabel}</strong>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300">
              Ставка розраховується на вкладці «Борд витрат» і тут лише читається — редагувати мікс продажів і
              статті витрат треба там. Поле нижче — ручне перевизначення на випадок, якщо борд ще порожній.
            </p>
            {boardError && (
              <p className="text-[11px] text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {boardError}
              </p>
            )}
            {!boardError && !boardLoaded && (
              <p className="text-[11px] text-slate-500">Завантаження ставки з борду витрат…</p>
            )}
          </div>

          <div className="flex items-center gap-3 self-end md:self-center">
            <span className="text-xs font-medium text-slate-300">Враховувати у собівартості:</span>
            <NeoTactileToggle
              id="toggle-include-expense-board-overhead"
              checked={isIncluded}
              onChange={(checked) => onChange({ includeExpenseBoardOverhead: checked })}
              label=""
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">
              Ставка «на одиницю» ($)
            </label>
            <NeoTactileNumberInput
              id="input-expense-board-overhead-usd"
              value={overheadUsd}
              onChange={(val) => onChange({ expenseBoardOverheadCostUsd: Math.max(0, val) })}
              unit="$"
              min={0}
              step={0.01}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              автопідтягнута з борду; можна перевизначити вручну
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 flex flex-col justify-center">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">У гривні на цей виріб</span>
            <div className="text-lg font-bold font-mono text-amber-300 mt-1">
              {formatMoney(overheadUsd * usdRate, currency)}
            </div>
          </div>
        </div>
      </div>
    </NeoTactileCard>
  );
};
