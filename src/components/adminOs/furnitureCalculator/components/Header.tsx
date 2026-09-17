import React from 'react';
import { Sparkles, RotateCcw, Bookmark, ChevronDown, FolderOpen, FileSpreadsheet, Coins } from 'lucide-react';
import { Currency, ProductTemplate, CurrencyRates } from '../types';

interface HeaderProps {
  currentPresetId: string;
  onSelectPreset: (preset: ProductTemplate) => void;
  currency: Currency;
  onSelectCurrency: (c: Currency) => void;
  onReset: () => void;
  templates: ProductTemplate[];
  onOpenTemplatesModal: () => void;
  onExportExcel: () => void;
  rates?: CurrencyRates;
  onOpenCurrencySettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPresetId,
  onSelectPreset,
  currency,
  onSelectCurrency,
  onReset,
  templates,
  onOpenTemplatesModal,
  onExportExcel,
  rates = { USD: 41.5, EUR: 45.2 },
  onOpenCurrencySettings,
}) => {
  // Group templates by category for the select
  const tables = templates.filter((t) => t.category === 'Столи');
  const organizers = templates.filter((t) => t.category === 'Органайзери');
  const boxes = templates.filter((t) => t.category === 'Шкатулки');
  const decor = templates.filter((t) => t.category === 'Декор' || t.category === 'Аксесуари');
  const custom = templates.filter((t) => t.isCustom);

  return (
    <header className="sticky top-0 z-30 w-full backdrop-blur-2xl bg-[#080d1a]/85 border-b border-white/10 px-4 lg:px-8 py-3 transition-all">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Brand & Reference Neo-Tactile Look */}
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-2xl neo-icon-btn flex items-center justify-center shrink-0 border border-cyan-400/30 shadow-[0_0_15px_rgba(56,189,248,0.25)]">
            <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-blue-600 to-cyan-400 animate-pulse" />
            <div className="absolute inset-0 rounded-2xl border border-white/20" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base lg:text-lg font-bold text-white tracking-tight">
                Neo-Tactile
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                Wood & Epoxy v2.4
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Калькулятор собівартості: столи, органайзери, шкатулки, декор
            </p>
          </div>
        </div>

        {/* Controls: Templates, Presets, Excel, Currency, Reset */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Templates Manager Button */}
          <button
            type="button"
            onClick={onOpenTemplatesModal}
            className="px-3 py-1.5 rounded-xl neo-card text-xs font-semibold text-cyan-300 border border-cyan-500/30 flex items-center gap-1.5 cursor-pointer hover:border-cyan-400 hover:text-white transition-all shadow-[0_0_12px_rgba(56,189,248,0.15)]"
            title="Відкрити каталог шаблонів за категоріями"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Шаблони</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-200">
              {templates.length}
            </span>
          </button>

          {/* Grouped Preset Quick Selector */}
          <div className="relative">
            <select
              value={currentPresetId}
              onChange={(e) => {
                const found = templates.find((p) => p.id === e.target.value);
                if (found) onSelectPreset(found);
              }}
              aria-label="Швидкий вибір виробу"
              className="appearance-none pl-3 pr-7 py-1.5 rounded-xl neo-pill-default text-xs font-medium cursor-pointer text-slate-200 focus:outline-none focus:border-cyan-400 max-w-[180px] sm:max-w-[240px] truncate"
            >
              {custom.length > 0 && (
                <optgroup label="⭐ Мої збережені шаблони" className="bg-slate-900 text-amber-300">
                  {custom.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                      ★ {p.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {tables.length > 0 && (
                <optgroup label="🪑 Столи" className="bg-slate-900 text-cyan-400 font-semibold">
                  {tables.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100 font-normal">
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {organizers.length > 0 && (
                <optgroup label="📱 Органайзери" className="bg-slate-900 text-violet-400 font-semibold">
                  {organizers.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100 font-normal">
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {boxes.length > 0 && (
                <optgroup label="💍 Шкатулки" className="bg-slate-900 text-amber-400 font-semibold">
                  {boxes.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100 font-normal">
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {decor.length > 0 && (
                <optgroup label="🪵 Декор та аксесуари" className="bg-slate-900 text-emerald-400 font-semibold">
                  {decor.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100 font-normal">
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
          </div>

          {/* Export to Excel Header Action */}
          <button
            type="button"
            onClick={onExportExcel}
            title="Експортувати розрахунок в Excel (.xlsx)"
            className="px-2.5 sm:px-3 py-1.5 rounded-xl neo-card text-xs font-semibold text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 cursor-pointer hover:border-emerald-400 hover:text-emerald-300 transition-all hover:bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Excel</span>
          </button>

          {/* Currency Switcher & Rates Settings */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-xl p-0.5 neo-inset">
              {(['UAH', 'USD', 'EUR'] as Currency[]).map((curr) => {
                const active = currency === curr;
                return (
                  <button
                    key={curr}
                    type="button"
                    onClick={() => onSelectCurrency(curr)}
                    className={`px-2 py-1 text-xs font-mono font-semibold rounded-lg transition-all cursor-pointer ${
                      active ? 'neo-pill-active' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {curr === 'UAH' ? '₴' : curr === 'USD' ? '$' : '€'}
                  </button>
                );
              })}
            </div>

            {onOpenCurrencySettings && (
              <button
                type="button"
                onClick={onOpenCurrencySettings}
                title="Налаштування курсу валют (USD/EUR) та автоперерахунок імпорту"
                className="px-2.5 py-1.5 rounded-xl neo-card text-xs font-mono font-semibold text-amber-300 border border-amber-500/30 flex items-center gap-1.5 cursor-pointer hover:border-amber-400 hover:text-white transition-all shadow-[0_0_12px_rgba(245,158,11,0.15)] active:scale-95"
              >
                <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden lg:inline text-[11px] text-slate-300 font-sans font-normal">Курс:</span>
                <span className="text-[11px] font-bold text-amber-300">${(rates?.USD ?? 41.5).toFixed(1)}</span>
              </button>
            )}
          </div>

          {/* Reset button */}
          <button
            type="button"
            onClick={onReset}
            title="Скинути до стандартних налаштувань"
            className="w-8 h-8 rounded-xl neo-icon-btn flex items-center justify-center text-slate-400 hover:text-slate-200 cursor-pointer active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
