import React, { useState } from 'react';
import { 
  Calculator, 
  Copy, 
  Printer, 
  Check, 
  TrendingUp, 
  PackageCheck, 
  ShieldAlert,
  Sparkles,
  Layers,
  Save,
  FileSpreadsheet,
  FolderOpen,
  Coins,
  Calendar,
  Banknote,
} from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { formatMoney } from '../utils/calculator';
import { calculateProductionSchedule } from '../utils/timelineCalculator';

interface CostBreakdownDashboardProps {
  input: CalculationInput;
  result: CalculationResult;
  currency: Currency;
  onOpenCommercialOffer: () => void;
  onSaveCalculation: () => void;
  onExportExcel: () => void;
  onOpenTemplates: () => void;
  rates?: CurrencyRates;
  onOpenCurrencySettings?: () => void;
  onOpenApplyToProduct?: () => void;
}

export const CostBreakdownDashboard: React.FC<CostBreakdownDashboardProps> = ({
  input,
  result,
  currency,
  onOpenCommercialOffer,
  onSaveCalculation,
  onExportExcel,
  onOpenTemplates,
  rates = { USD: 41.5, EUR: 45.2 },
  onOpenCurrencySettings,
  onOpenApplyToProduct,
}) => {
  const [copied, setCopied] = useState(false);
  const schedule = calculateProductionSchedule(input);

  const handleCopySummary = () => {
    const text = `📊 Розрахунок вартості виробу з дерева та епоксидної смоли:
- Матеріали (деревина, смола, лак, опалубка, метал, упаковка): ${formatMoney(result.materialsCostTotal, currency)}
${input.includeElectronics ? `- Електроніка та LED (БЖ, стрічка, плата, аксесуари): ${formatMoney(result.totalElectronicsMaterialsCost, currency)}\n- Оплата пайщика (монтаж та пайка електроніки): ${formatMoney(result.soldererLaborCost, currency)}\n` : ''}- Оплата праці (столяр, збірник, дизайнер, менеджер, директор): ${formatMoney(result.laborCostTotal, currency)}
- ЧПУ фрезерування: ${formatMoney(result.totalCncCost, currency)}${input.includeRouterBitCost !== false ? ` (верстат: ${formatMoney(result.cncMachineCost, currency)}, оператор: ${formatMoney(result.cncOperatorCost, currency)}, амортизація фрези: ${formatMoney(result.routerBitDepreciationPerProduct, currency)})` : ''}
- Амортизація та комунальні платежі: ${formatMoney(result.totalOverheadCost, currency)}
- AI-контент для продажу (GPT фото 20 шт + Runway промо-відео): ${formatMoney(result.totalAiMediaCostUah, currency)} ($${result.totalAiMediaCostUsd.toFixed(2)})
- Накладні з борду витрат (ШІ+Railway+інше на одиницю): ${formatMoney(result.expenseBoardOverheadCostUah, currency)} ($${result.expenseBoardOverheadCostUsd.toFixed(2)})
- Доставка клієнту: ${formatMoney(result.finalDeliveryCost, currency)}
---------------------------------------------
🏷️ Повна собівартість: ${formatMoney(result.fullCostPrice, currency)}
💰 Чистий прибуток (${input.profitMarginPercent}%): ${formatMoney(result.netProfit, currency)}
🏛️ Податки (${input.taxRatePercent}%): ${formatMoney(result.taxAmount, currency)}
✨ РЕКОМЕНДОВАНА ЦІНА ДЛЯ КЛІЄНТА: ${formatMoney(result.totalSellingPrice, currency)}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Circular gauge value (percentage of profit vs total)
  const profitRadius = 38;
  const circumference = 2 * Math.PI * profitRadius;
  const strokeDashoffset = circumference - (circumference * (result.profitSharePercent || 1)) / 100;

  return (
    <div className="neo-card rounded-3xl p-6 lg:p-7 border border-cyan-500/20 shadow-[0_20px_50px_rgba(0,0,0,0.8)] relative overflow-hidden">
      {/* Background soft ambient glows */}
      <div className="absolute top-0 right-0 w-80 h-80 neo-glow-cyan pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 neo-glow-blue pointer-events-none" />

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8] animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">
              Neo-Tactile Pricing Engine
            </span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-bold text-white mt-1">
            Підсумок собівартості та ціни
          </h2>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenTemplates}
            className="px-3.5 py-2 rounded-xl neo-pill-default text-xs font-medium flex items-center gap-1.5 cursor-pointer active:scale-95 text-cyan-300 hover:text-white"
            title="Переглянути або обрати шаблон виробу за категоріями"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Шаблони</span>
          </button>

          <button
            type="button"
            onClick={onSaveCalculation}
            className="px-3.5 py-2 rounded-xl neo-pill-default text-xs font-medium flex items-center gap-1.5 cursor-pointer active:scale-95 hover:text-white"
            title="Зберегти поточні налаштування в мої шаблони"
          >
            <Save className="w-3.5 h-3.5 text-cyan-400" />
            <span>Зберегти як шаблон</span>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            className="px-3.5 py-2 rounded-xl neo-pill-default text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
            title="Експорт повної калькуляції та специфікації BOM в Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Експорт в Excel</span>
          </button>

          <button
            type="button"
            onClick={handleCopySummary}
            className="px-3.5 py-2 rounded-xl neo-pill-default text-xs font-medium flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Скопійовано!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-300" />
                <span>Скопіювати</span>
              </>
            )}
          </button>

          {onOpenCurrencySettings && (
            <button
              type="button"
              onClick={onOpenCurrencySettings}
              className="px-3 py-2 rounded-xl neo-pill-default text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 text-amber-300 hover:text-amber-200 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
              title="Налаштувати поточний курс валют (USD/EUR) для імпорту"
            >
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>Курс: ${(rates?.USD ?? 41.5).toFixed(1)}</span>
            </button>
          )}

          {onOpenApplyToProduct && (
            <button
              type="button"
              onClick={onOpenApplyToProduct}
              className="px-3.5 py-2 rounded-xl neo-pill-default text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
              title="Додати підсумок цього розрахунку до ціни опублікованого товару або чорнетки"
            >
              <Banknote className="w-3.5 h-3.5 text-emerald-400" />
              <span>Додати до ціни товару</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenCommercialOffer}
            className="px-4 py-2 rounded-xl neo-pill-active text-xs font-semibold flex items-center gap-2 cursor-pointer active:scale-95 shadow-[0_0_20px_rgba(59,130,246,0.6)]"
          >
            <Printer className="w-4 h-4" />
            <span>Комерційна пропозиція (КП)</span>
          </button>
        </div>
      </div>

      {/* Main KPI Hero Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-6 relative z-10">
        {/* Full cost */}
        <div className="p-5 rounded-2xl neo-inset border border-white/5 relative flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-400">Повна собівартість (Cost)</span>
          <div className="mt-2">
            <div className="text-2xl lg:text-3xl font-extrabold text-slate-100 font-mono tracking-tight">
              {formatMoney(result.fullCostPrice, currency)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <Layers className="w-3 h-3 text-cyan-400" />
              <span>Матеріали + Робота + ЧПУ + AI-медіа + Борд витрат + Логістика</span>
            </div>
          </div>
        </div>

        {/* Net Profit with Circular Gauge */}
        <div className="p-5 rounded-2xl neo-card-subtle border border-emerald-500/20 relative flex items-center justify-between shadow-[0_4px_20px_rgba(16,185,129,0.15)]">
          <div>
            <span className="text-xs font-medium text-emerald-400 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Чистий прибуток
            </span>
            <div className="text-2xl lg:text-3xl font-extrabold text-emerald-300 font-mono mt-2 tracking-tight">
              {formatMoney(result.netProfit, currency)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Маржинальність: <strong className="text-emerald-400 font-mono">{input.profitMarginPercent}%</strong>
            </div>
          </div>

          {/* Tactile Circular Gauge */}
          <div className="relative w-18 h-18 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 90 90">
              <circle
                cx="45"
                cy="45"
                r={profitRadius}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="6"
              />
              <circle
                cx="45"
                cy="45"
                r={profitRadius}
                fill="none"
                stroke="url(#profitGradient)"
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
              <defs>
                <linearGradient id="profitGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-xs font-bold text-emerald-300 font-mono">
                {result.profitSharePercent}%
              </span>
              <span className="text-[8px] text-slate-400 uppercase">частка</span>
            </div>
          </div>
        </div>

        {/* Final Selling Price with Glowing Neon Halo */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-900/60 to-slate-900/90 border border-blue-400/40 relative shadow-[0_0_30px_rgba(59,130,246,0.3)] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">
              Ціна для клієнта
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/30">
              Податок {input.taxRatePercent}%
            </span>
          </div>
          <div className="mt-2">
            <div className="text-3xl lg:text-4xl font-black text-white font-mono tracking-tight drop-shadow-[0_2px_10px_rgba(59,130,246,0.5)]">
              {formatMoney(result.totalSellingPrice, currency)}
            </div>
            <div className="text-[11px] text-blue-200/80 mt-1">
              Включає податок: {formatMoney(result.taxAmount, currency)}
            </div>
          </div>
        </div>
      </div>

      {/* Production Deadline Highlight Bar */}
      <div className="py-2.5 px-4 rounded-2xl neo-inset border border-emerald-500/20 flex flex-wrap items-center justify-between gap-3 text-xs relative z-10 mb-4 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <span className="text-slate-300 font-medium">Орієнтовна дата завершення:</span>
          <span className="font-bold text-emerald-300 font-mono bg-emerald-500/15 px-2.5 py-0.5 rounded-lg border border-emerald-500/30 text-xs">
            {schedule.completionDate} ({schedule.completionDayOfWeek})
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-400 text-[11px]">
          <span>Термін: <strong className="text-white font-mono">{schedule.totalDays} дн.</strong></span>
          <span className="hidden sm:inline">•</span>
          <span className="text-cyan-400 font-mono hidden sm:inline">
            Сушка {input.dryingStageDays ?? 5}д • Столяр {input.carpentryStageDays ?? 4}д • Смола {input.epoxyCureStageDays ?? 6}д • ЧПУ {input.cncStageDays ?? 2}д
          </span>
        </div>
      </div>

      {/* Visual Cost Structure Bar */}
      <div className="py-4 border-t border-white/5 relative z-10">
        <div className="flex items-center justify-between text-xs text-slate-300 mb-2 font-medium">
          <span>Структура ціни виробу (%):</span>
          <span className="text-slate-400 font-mono">100% загальна вартість</span>
        </div>

        <div className="h-4 w-full rounded-full neo-inset p-0.5 flex overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-300 rounded-l-full"
            style={{ width: `${result.materialsSharePercent}%` }}
            title={`Матеріали: ${result.materialsSharePercent}%`}
          />
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${result.laborSharePercent}%` }}
            title={`Оплата праці: ${result.laborSharePercent}%`}
          />
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${result.overheadSharePercent}%` }}
            title={`Накладні та ЧПУ: ${result.overheadSharePercent}%`}
          />
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${result.taxSharePercent}%` }}
            title={`Податки: ${result.taxSharePercent}%`}
          />
          <div
            className="h-full bg-emerald-500 transition-all duration-300 rounded-r-full"
            style={{ width: `${result.profitSharePercent}%` }}
            title={`Чистий прибуток: ${result.profitSharePercent}%`}
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-slate-300">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
            <span>Матеріали ({result.materialsSharePercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <span>Оплата праці ({result.laborSharePercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span>ЧПУ та накладні ({result.overheadSharePercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>Податки ({result.taxSharePercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Чистий прибуток ({result.profitSharePercent}%)</span>
          </div>
        </div>
      </div>

      {/* Pro tips: "Що ще врахувати?" checklist */}
      <div className="mt-4 p-4 rounded-2xl neo-card-subtle border border-cyan-500/10 text-xs relative z-10">
        <div className="flex items-center gap-2 text-cyan-300 font-semibold mb-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>Технологічний контроль майстерні (враховано у вашому калькуляторі):</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 text-slate-300 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">✓</span>
            <span>Запас на обрізку ({input.woodWastePercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">✓</span>
            <span>Залишки смоли ({input.epoxyWastePercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">✓</span>
            <span>Амортизація шпинделя</span>
          </div>
          {input.includeRouterBitCost !== false && (
            <div className="flex items-center gap-1.5">
              <span className="text-indigo-400 font-bold">✓</span>
              <span className="text-indigo-300">Фреза ({input.routerBitCost ?? 2200} ₴ / {input.routerBitLifespanProducts ?? 10} вир.)</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">✓</span>
            <span>Компенсатори C-channel</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 font-bold">✓</span>
            <span className="text-amber-300">Курс валют (${(rates?.USD ?? 41.5).toFixed(1)} ₴)</span>
          </div>
          {input.includeElectronics && (
            <div className="flex items-center gap-1.5 col-span-full sm:col-span-1">
              <span className="text-purple-400 font-bold">⚡</span>
              <span className="text-purple-300 font-semibold">LED + ESP32 + Пайка</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
