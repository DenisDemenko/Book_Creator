import React, { useState } from 'react';
import { 
  X, 
  Coins, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  ArrowRightLeft, 
  Sparkles, 
  TrendingUp, 
  Cpu, 
  FlaskConical, 
  Paintbrush 
} from 'lucide-react';
import { CurrencyRates, CalculationInput } from '../types';
import { DEFAULT_CURRENCY_RATES, formatMoney } from '../utils/calculator';

interface CurrencySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rates: CurrencyRates;
  onUpdateRates: (newRates: CurrencyRates, applyToInput?: boolean) => void;
  currentInput: CalculationInput;
}

export const CurrencySettingsModal: React.FC<CurrencySettingsModalProps> = ({
  isOpen,
  onClose,
  rates,
  onUpdateRates,
  currentInput,
}) => {
  const [usdRate, setUsdRate] = useState<number>(rates.USD || 41.5);
  const [eurRate, setEurRate] = useState<number>(rates.EUR || 45.2);
  const [autoSync, setAutoSync] = useState<boolean>(rates.autoSyncImported ?? true);
  const [isLoadingNbu, setIsLoadingNbu] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sourceNote, setSourceNote] = useState<string>(rates.source || 'НБУ');

  if (!isOpen) return null;

  // NOTE: NBU rates are fetched through the Nova server proxy (server/furnitureCalculatorRoutes.ts)
  // rather than calling bank.gov.ua directly from the browser, since the NBU API does not send
  // CORS headers and a direct client-side fetch fails silently in production.
  const handleFetchNbuRates = async () => {
    setIsLoadingNbu(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/furniture-calc/nbu-rates', {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Не вдалося отримати курс НБУ');
      }

      if (data && typeof data.usd === 'number' && typeof data.eur === 'number') {
        const fetchedUsd = Number(data.usd.toFixed(2));
        const fetchedEur = Number(data.eur.toFixed(2));
        const exchangeDate = data.exchangeDate || new Date().toLocaleDateString('uk-UA');

        setUsdRate(fetchedUsd);
        setEurRate(fetchedEur);
        setSourceNote(`Офіційний курс НБУ на ${exchangeDate}`);
        setStatusMessage(`Курс НБУ успішно оновлено: USD = ${fetchedUsd} ₴, EUR = ${fetchedEur} ₴`);
      } else {
        throw new Error('Невірний формат відповіді НБУ');
      }
    } catch (err) {
      console.warn('Failed to fetch NBU rates via server proxy:', err);
      setStatusMessage(
        err instanceof Error && err.message
          ? err.message
          : 'Не вдалося зв’язатися із сервером НБУ напряму. Ви можете ввести актуальний курс вручну.'
      );
    } finally {
      setIsLoadingNbu(false);
    }
  };

  const handleResetToDefault = () => {
    setUsdRate(DEFAULT_CURRENCY_RATES.USD);
    setEurRate(DEFAULT_CURRENCY_RATES.EUR);
    setAutoSync(true);
    setSourceNote('Базовий курс');
    setStatusMessage('Курси скинуто до базових значень (41.50 / 45.20)');
  };

  const handleSave = (recalcNow: boolean = false) => {
    const validUsd = usdRate > 0 ? usdRate : 41.5;
    const validEur = eurRate > 0 ? eurRate : 45.2;

    const newRates: CurrencyRates = {
      USD: validUsd,
      EUR: validEur,
      lastUpdated: new Date().toLocaleDateString('uk-UA'),
      source: sourceNote,
      autoSyncImported: autoSync,
    };

    onUpdateRates(newRates, recalcNow || autoSync);
    onClose();
  };

  // Preview values for imported materials
  const epoxyUsdPrice = currentInput.epoxyPriceCurrency === 'USD' && currentInput.epoxyPriceInCurrency
    ? currentInput.epoxyPriceInCurrency
    : (currentInput.epoxyPricePerLiter / (rates.USD || 41.5));
  const epoxyNewUah = Math.round(epoxyUsdPrice * usdRate);

  const cncUsdRate = currentInput.cncMachineCurrency === 'USD' && currentInput.cncMachineRateInCurrency
    ? currentInput.cncMachineRateInCurrency
    : (currentInput.cncMachineRatePerHour / (rates.USD || 41.5));
  const cncNewUah = Math.round(cncUsdRate * usdRate);

  const finishEurPrice = currentInput.finishCostCurrency === 'EUR' && currentInput.finishCostInCurrency
    ? currentInput.finishCostInCurrency
    : (currentInput.finishCostPerLiter / (rates.EUR || 45.2));
  const finishNewUah = Math.round(finishEurPrice * eurRate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div 
        className="relative w-full max-w-2xl my-auto bg-[#0c1427] border border-white/10 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl neo-icon-btn flex items-center justify-center border border-amber-400/30 text-amber-300">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  Поточний курс валют
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  USD & EUR
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Автоматичний перерахунок імпортної смоли, ЧПУ та імпортних матеріалів
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
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Live Status/Notification */}
          {statusMessage && (
            <div className="p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200 flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Quick NBU Fetch Banner */}
          <div className="p-4 rounded-2xl neo-inset bg-gradient-to-r from-amber-500/10 via-slate-900 to-cyan-500/10 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white">Офіційний курс НБУ</span>
                <span className="text-[10px] font-mono text-slate-400">({sourceNote})</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Завантажуйте актуальні міжбанківські котирування Національного Банку в 1 клік
              </p>
            </div>

            <button
              type="button"
              disabled={isLoadingNbu}
              onClick={handleFetchNbuRates}
              className="px-3.5 py-2 rounded-xl neo-pill-default text-xs font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-2 cursor-pointer transition-all active:scale-95 disabled:opacity-50 shrink-0 border border-amber-500/30"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingNbu ? 'animate-spin' : ''}`} />
              <span>{isLoadingNbu ? 'Завантаження...' : 'Оновити з НБУ'}</span>
            </button>
          </div>

          {/* Currency Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* USD Input */}
            <div className="p-4 rounded-2xl neo-card-subtle border border-cyan-500/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-xl neo-inset flex items-center justify-center font-bold text-cyan-300 text-sm">
                    $
                  </span>
                  <div>
                    <span className="text-xs font-bold text-white block">Долар США (USD)</span>
                    <span className="text-[10px] text-slate-400">Смола, обладнання, фрези</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">1 USD =</span>
                  <span className="text-sm font-mono font-bold text-cyan-300">{usdRate.toFixed(2)} ₴</span>
                </div>
              </div>

              <div className="relative">
                <input
                  type="number"
                  step="0.05"
                  min="1"
                  max="100"
                  value={usdRate}
                  onChange={(e) => setUsdRate(parseFloat(e.target.value) || 0)}
                  className="w-full pl-3.5 pr-14 py-2.5 rounded-xl neo-inset text-sm font-mono text-white focus:outline-none focus:border-cyan-400"
                />
                <span className="absolute right-3.5 top-3 text-xs font-mono text-slate-400 pointer-events-none">
                  ₴ / USD
                </span>
              </div>

              {/* Quick Steppers */}
              <div className="flex items-center gap-1.5 pt-1">
                {[-1, -0.5, +0.5, +1].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => setUsdRate((prev) => Number((prev + delta).toFixed(2)))}
                    className="flex-1 py-1 rounded-lg neo-card-subtle text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer"
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            </div>

            {/* EUR Input */}
            <div className="p-4 rounded-2xl neo-card-subtle border border-emerald-500/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-xl neo-inset flex items-center justify-center font-bold text-emerald-300 text-sm">
                    €
                  </span>
                  <div>
                    <span className="text-xs font-bold text-white block">Євро (EUR)</span>
                    <span className="text-[10px] text-slate-400">Osmo, Rubio, лаки ЕС</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">1 EUR =</span>
                  <span className="text-sm font-mono font-bold text-emerald-300">{eurRate.toFixed(2)} ₴</span>
                </div>
              </div>

              <div className="relative">
                <input
                  type="number"
                  step="0.05"
                  min="1"
                  max="100"
                  value={eurRate}
                  onChange={(e) => setEurRate(parseFloat(e.target.value) || 0)}
                  className="w-full pl-3.5 pr-14 py-2.5 rounded-xl neo-inset text-sm font-mono text-white focus:outline-none focus:border-emerald-400"
                />
                <span className="absolute right-3.5 top-3 text-xs font-mono text-slate-400 pointer-events-none">
                  ₴ / EUR
                </span>
              </div>

              {/* Quick Steppers */}
              <div className="flex items-center gap-1.5 pt-1">
                {[-1, -0.5, +0.5, +1].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => setEurRate((prev) => Number((prev + delta).toFixed(2)))}
                    className="flex-1 py-1 rounded-lg neo-card-subtle text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer"
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Auto-recalculate Toggle */}
          <div className="p-4 rounded-2xl neo-card flex items-start gap-3 cursor-pointer select-none" onClick={() => setAutoSync(!autoSync)}>
            <div className="pt-0.5">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="w-4 h-4 rounded text-cyan-500 focus:ring-cyan-400 bg-slate-900 border-white/20 cursor-pointer"
              />
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>Автоматично перераховувати ціни імпортних матеріалів при зміні курсу</span>
                <span className="text-[10px] font-mono text-cyan-300 px-1.5 py-0.2 rounded bg-cyan-500/20">
                  Рекомендовано
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Якщо курс долара або євро змінюється, вартість закупівлі епоксидної смоли, машиногодини ЧПУ та фінішного масла миттєво масштабується пропорційно новому курсу.
              </p>
            </div>
          </div>

          {/* Live Preview of Recalculation Impact */}
          <div className="p-4 rounded-2xl neo-inset bg-slate-950/70 border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300 border-b border-white/5 pb-2">
              <span className="flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                <span>Прогноз перерахунку за курсом {usdRate.toFixed(2)} ₴/$ та {eurRate.toFixed(2)} ₴/€:</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">Гривнева ціна</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {/* Epoxy Preview */}
              <div className="p-2.5 rounded-xl neo-card-subtle flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-blue-400" />
                  <div>
                    <span className="text-[11px] text-slate-300 block font-medium">Смола 1 л</span>
                    <span className="text-[10px] font-mono text-slate-400">${epoxyUsdPrice.toFixed(2)} USD</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-blue-300">{epoxyNewUah} ₴</span>
                  <span className="text-[9px] block text-slate-500 line-through">{currentInput.epoxyPricePerLiter} ₴</span>
                </div>
              </div>

              {/* CNC Machine Preview */}
              <div className="p-2.5 rounded-xl neo-card-subtle flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <div>
                    <span className="text-[11px] text-slate-300 block font-medium">ЧПУ станок 1 год</span>
                    <span className="text-[10px] font-mono text-slate-400">${cncUsdRate.toFixed(2)} USD</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-cyan-300">{cncNewUah} ₴</span>
                  <span className="text-[9px] block text-slate-500 line-through">{currentInput.cncMachineRatePerHour} ₴</span>
                </div>
              </div>

              {/* Finish Preview */}
              <div className="p-2.5 rounded-xl neo-card-subtle flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Paintbrush className="w-4 h-4 text-emerald-400" />
                  <div>
                    <span className="text-[11px] text-slate-300 block font-medium">Фініш/лак 1 л</span>
                    <span className="text-[10px] font-mono text-slate-400">€{finishEurPrice.toFixed(2)} EUR</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-emerald-300">{finishNewUah} ₴</span>
                  <span className="text-[9px] block text-slate-500 line-through">{currentInput.finishCostPerLiter} ₴</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            Скинути до базового курсу (41.5 / 45.2)
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => handleSave(true)}
              className="px-4 py-2 rounded-xl neo-pill-default text-xs font-medium text-amber-300 hover:text-white cursor-pointer active:scale-95 border border-amber-500/30"
              title="Перерахувати поточні матеріали калькулятора за цим курсом"
            >
              Перерахувати зараз
            </button>

            <button
              type="button"
              onClick={() => handleSave(autoSync)}
              className="px-5 py-2 rounded-xl neo-pill-active text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-[0_0_15px_rgba(245,158,11,0.4)]"
            >
              <Check className="w-4 h-4" />
              <span>Зберегти налаштування</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
