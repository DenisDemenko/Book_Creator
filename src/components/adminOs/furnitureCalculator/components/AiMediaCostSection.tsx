import React from 'react';
import { Sparkles, Camera, Video, Bot, Film, Coins, CheckCircle2, TrendingDown, Layers } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { NeoTactileCard } from './NeoTactileCard';
import { NeoTactileNumberInput } from './NeoTactileNumberInput';
import { NeoTactileToggle } from './NeoTactileToggle';
import { formatMoney } from '../utils/calculator';

interface AiMediaCostSectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
  result: CalculationResult;
  currency: Currency;
  rates?: CurrencyRates;
  onOpenCurrencySettings?: () => void;
}

export const AiMediaCostSection: React.FC<AiMediaCostSectionProps> = ({
  input,
  onChange,
  result,
  currency,
  rates = { USD: 41.5, EUR: 45.2 },
  onOpenCurrencySettings,
}) => {
  const isIncluded = input.includeAiMediaCost !== false;
  const gptCost = input.gptPhotoMonthlyCostUsd ?? 25;
  const gptProducts = input.gptPhotoMonthlyProductsCount ?? 25;
  const gptPhotos = input.gptPhotosPerProduct ?? 20;

  const runwayCost = input.runwayVideoMonthlyCostUsd ?? 76;
  const runwayTotalVideos = input.runwayVideoMonthlyVideosCount ?? 25;
  const runwayVideosPerItem = input.runwayVideosPerProduct ?? 1;

  const usdRate = rates.USD || 41.5;

  return (
    <NeoTactileCard
      id="ai-media-cost-card"
      title="6. AI-контент для продажу: фото та відео товарів"
      subtitle="Розподіл вартості підписок GPT ($25/міс) та Runway ($76/міс) на собівартість одиниці виробу"
      icon={Sparkles}
      badge={
        isIncluded
          ? `${formatMoney(result.totalAiMediaCostUah, currency)} ($${result.totalAiMediaCostUsd.toFixed(2)})`
          : 'Вимкнено'
      }
      badgeColor="purple"
      collapsible
      defaultExpanded
    >
      <div className="space-y-6">
        {/* Toggle & Quick Highlights */}
        <div className="p-4 rounded-2xl neo-inset border border-purple-500/20 bg-slate-950/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                <Bot className="w-3.5 h-3.5" /> AI Content Unit Economics
              </span>
              <span className="text-xs text-slate-400">
                Курс перерахунку: 1 USD = <strong className="text-white font-mono">{usdRate} ₴</strong>
              </span>
              {onOpenCurrencySettings && (
                <button
                  type="button"
                  onClick={onOpenCurrencySettings}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 underline font-mono cursor-pointer"
                >
                  змінити
                </button>
              )}
            </div>
            <p className="text-xs text-slate-300">
              Включення генерації фото та відео до повної собівартості дозволяє автоматично закласти маркетингові витрати у ціну для клієнта.
            </p>
          </div>

          <div className="flex items-center gap-3 self-end md:self-center">
            <span className="text-xs font-medium text-slate-300">Враховувати у собівартості:</span>
            <NeoTactileToggle
              id="toggle-include-ai-cost"
              checked={isIncluded}
              onChange={(checked) => onChange({ includeAiMediaCost: checked })}
              label=""
            />
          </div>
        </div>

        {/* 2 Main Columns: GPT Photos vs Runway Video */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* CARD 1: GPT Photo Generation */}
          <div className="p-4.5 rounded-2xl neo-card border border-cyan-500/30 bg-gradient-to-br from-slate-900/90 to-cyan-950/20 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    Генерація фото товарів
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      GPT / DALL-E
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">20 ракурсів, текстура дерева, макрозйомка та інтер'єр</p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[11px] text-slate-400 block font-mono">На цей виріб:</span>
                <span className="text-sm font-bold text-cyan-300 font-mono">
                  ${result.gptPhotoCostUsd.toFixed(2)} <span className="text-[11px] font-normal text-slate-400">({formatMoney(result.gptPhotoCostUah, currency)})</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Вартість підписки GPT
                </label>
                <NeoTactileNumberInput
                  id="input-gpt-cost-usd"
                  value={gptCost}
                  onChange={(val) => onChange({ gptPhotoMonthlyCostUsd: val })}
                  unit="$"
                  min={1}
                />
                <p className="text-[10px] text-slate-400 mt-1">на місяць</p>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Товарів з підписки
                </label>
                <NeoTactileNumberInput
                  id="input-gpt-products-count"
                  value={gptProducts}
                  onChange={(val) => onChange({ gptPhotoMonthlyProductsCount: Math.max(1, Math.round(val)) })}
                  unit="шт"
                  min={1}
                />
                <p className="text-[10px] text-slate-400 mt-1">на місяць</p>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Фото на 1 товар
                </label>
                <NeoTactileNumberInput
                  id="input-gpt-photos-per-item"
                  value={gptPhotos}
                  onChange={(val) => onChange({ gptPhotosPerProduct: Math.max(1, Math.round(val)) })}
                  unit="фото"
                  min={1}
                />
                <p className="text-[10px] text-slate-400 mt-1">ракурсів</p>
              </div>
            </div>

            {/* Calculations metrics pills */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="space-y-0.5">
                <span className="text-slate-400 text-[10px]">Собівартість 1 фото:</span>
                <div className="font-bold text-cyan-300">
                  ${result.costPerAiPhotoUsd.toFixed(3)} <span className="text-[10px] text-slate-400">({(result.costPerAiPhotoUsd * usdRate).toFixed(2)} ₴)</span>
                </div>
              </div>
              <div className="space-y-0.5 text-right">
                <span className="text-slate-400 text-[10px]">Всього за пакет {gptPhotos} фото:</span>
                <div className="font-bold text-white">
                  ${result.gptPhotoCostUsd.toFixed(2)} <span className="text-[10px] text-cyan-400">({formatMoney(result.gptPhotoCostUah, currency)})</span>
                </div>
              </div>
            </div>
          </div>

          {/* CARD 2: Runway Video Generation */}
          <div className="p-4.5 rounded-2xl neo-card border border-fuchsia-500/30 bg-gradient-to-br from-slate-900/90 to-fuchsia-950/20 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/40 flex items-center justify-center text-fuchsia-400">
                  <Video className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    Генерація промо-відео
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">
                      Runway Gen-3
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">Динамічний 4K огляд, відблиски світла та 360° обльоти</p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[11px] text-slate-400 block font-mono">На цей виріб:</span>
                <span className="text-sm font-bold text-fuchsia-300 font-mono">
                  ${result.runwayVideoCostUsd.toFixed(2)} <span className="text-[11px] font-normal text-slate-400">({formatMoney(result.runwayVideoCostUah, currency)})</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Підписка Runway
                </label>
                <NeoTactileNumberInput
                  id="input-runway-cost-usd"
                  value={runwayCost}
                  onChange={(val) => onChange({ runwayVideoMonthlyCostUsd: val })}
                  unit="$"
                  min={1}
                />
                <p className="text-[10px] text-slate-400 mt-1">на місяць</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-amber-300">
                    Відео з підписки:
                  </label>
                  <span className="text-[9px] font-mono text-amber-400/80 uppercase">Ручне поле</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={runwayTotalVideos}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value, 10);
                      onChange({ runwayVideoMonthlyVideosCount: isNaN(parsed) ? 1 : Math.max(1, parsed) });
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-amber-500/50 text-amber-200 font-mono font-bold text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]"
                  />
                  <span className="absolute right-3 top-2 text-xs font-mono text-slate-400">відео</span>
                </div>
                <p className="text-[10px] text-amber-400/90 mt-1 font-mono">За замовчуванням: 25 відео/міс</p>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Відео на цей товар
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChange({ runwayVideosPerProduct: Math.max(0, runwayVideosPerItem - 1) })}
                    className="w-8 h-9 rounded-xl bg-slate-800 border border-white/10 text-white font-bold hover:bg-slate-700 cursor-pointer flex items-center justify-center transition-colors"
                  >
                    -
                  </button>
                  <div className="flex-1 text-center py-1.5 rounded-xl bg-slate-900 border border-white/10 font-mono font-bold text-fuchsia-300">
                    {runwayVideosPerItem} {runwayVideosPerItem === 1 ? 'відео' : 'відео'}
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange({ runwayVideosPerProduct: runwayVideosPerItem + 1 })}
                    className="w-8 h-9 rounded-xl bg-slate-800 border border-white/10 text-white font-bold hover:bg-slate-700 cursor-pointer flex items-center justify-center transition-colors"
                  >
                    +
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">для Reels/Etsy</p>
              </div>
            </div>

            {/* Calculations metrics pills */}
            <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="space-y-0.5">
                <span className="text-slate-400 text-[10px]">Вартість 1 відео Runway:</span>
                <div className="font-bold text-fuchsia-300">
                  ${result.costPerAiVideoUsd.toFixed(2)} <span className="text-[10px] text-slate-400">({(result.costPerAiVideoUsd * usdRate).toFixed(2)} ₴)</span>
                </div>
              </div>
              <div className="space-y-0.5 text-right">
                <span className="text-slate-400 text-[10px]">Всього за {runwayVideosPerItem} відео:</span>
                <div className="font-bold text-white">
                  ${result.runwayVideoCostUsd.toFixed(2)} <span className="text-[10px] text-fuchsia-400">({formatMoney(result.runwayVideoCostUah, currency)})</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Total & Business Logic Bar */}
        <div className="p-4 rounded-2xl neo-inset border border-indigo-500/20 bg-gradient-to-r from-slate-950/80 via-indigo-950/20 to-slate-950/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Разом витрат на медіа для виробу:</span>
                <span className="text-base font-bold text-white font-mono">
                  ${result.totalAiMediaCostUsd.toFixed(2)} USD
                </span>
                <span className="text-sm font-bold text-indigo-400 font-mono">
                  ({formatMoney(result.totalAiMediaCostUah, currency)})
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Комплект для маркетингу: {gptPhotos} фото високої роздільності + {runwayVideosPerItem} кінематографічне промо-відео
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-emerald-300 bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/30">
            <TrendingDown className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Економія порівняно з живою фотосесією цеху (~3 500 ₴): <strong className="font-mono font-bold">~95%</strong>
            </span>
          </div>
        </div>
      </div>
    </NeoTactileCard>
  );
};
