import React from 'react';
import { Sparkles, FlaskConical, Layers, Coins } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { NeoTactileCard } from './NeoTactileCard';
import { NeoTactileSlider } from './NeoTactileSlider';
import { NeoTactileToggle } from './NeoTactileToggle';
import { NeoTactileNumberInput } from './NeoTactileNumberInput';
import { UnitCostDisplay } from './UnitCostDisplay';
import { formatMoney } from '../utils/calculator';

interface EpoxySectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
  result: CalculationResult;
  currency: Currency;
  rates?: CurrencyRates;
  onOpenCurrencySettings?: () => void;
}

export const EpoxySection: React.FC<EpoxySectionProps> = ({
  input,
  onChange,
  result,
  currency,
  rates = { USD: 41.5, EUR: 45.2 },
  onOpenCurrencySettings,
}) => {
  const isUsdMode = input.epoxyPriceCurrency === 'USD';
  const usdRate = rates.USD || 41.5;
  const currentUsdPrice = input.epoxyPriceInCurrency || Number((input.epoxyPricePerLiter / usdRate).toFixed(2));
  return (
    <NeoTactileCard
      id="epoxy-section-card"
      title="2. Епоксидна смола, барвники та опалубка"
      subtitle="Розрахунок об'єму заливки річки/тріщин, пігментів, герметизації та розділювачів"
      icon={FlaskConical}
      badge={`${result.calculatedEpoxyLiters.toFixed(2)} л (~${(result.calculatedEpoxyLiters * 1.1).toFixed(1)} кг)`}
      badgeColor="blue"
      collapsible
      defaultExpanded
    >
      {/* Geometric vs Direct volume toggle */}
      <div className="pb-2">
        <NeoTactileToggle
          id="toggle-geometric-epoxy"
          checked={input.useGeometricEpoxyCalc}
          onChange={(checked) => onChange({ useGeometricEpoxyCalc: checked })}
          label="Геометричний калькулятор річки (Довжина × Ширина × Глибина)"
          sublabel="Автоматично вираховує точний літраж річки за розмірами заливального каналу"
        />
      </div>

      {input.useGeometricEpoxyCalc ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl neo-card-subtle border border-cyan-500/20">
          <NeoTactileSlider
            id="slider-river-len"
            label="Довжина заливки річки"
            value={input.riverLengthMm}
            min={100}
            max={4000}
            step={50}
            unit="мм"
            onChange={(val) => onChange({ riverLengthMm: val })}
          />
          <NeoTactileSlider
            id="slider-river-width"
            label="Середня ширина річки"
            sublabel="З урахуванням вигинів"
            value={input.riverAvgWidthMm}
            min={10}
            max={800}
            step={10}
            unit="мм"
            onChange={(val) => onChange({ riverAvgWidthMm: val })}
          />
          <NeoTactileSlider
            id="slider-river-depth"
            label="Глибина заливки (шар)"
            value={input.riverDepthMm}
            min={5}
            max={100}
            step={5}
            unit="мм"
            onChange={(val) => onChange({ riverDepthMm: val })}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NeoTactileSlider
            id="slider-epoxy-liters"
            label="Прямий об'єм епоксидної смоли"
            sublabel="Включаючи компонент А та компонент Б (затверджувач)"
            value={input.epoxyLiters}
            min={0.1}
            max={100}
            step={0.5}
            unit="л"
            onChange={(val) => onChange({ epoxyLiters: val })}
          />
          <div className="p-3.5 rounded-xl neo-inset flex flex-col justify-center gap-1 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Вага суміші (густина 1.1 кг/л):</span>
              <span className="font-mono text-cyan-300 font-semibold">
                {(input.epoxyLiters * 1.1).toFixed(2)} кг
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Орієнтовна вартість смоли:</span>
              <span className="font-mono text-white font-semibold">
                {formatMoney(input.epoxyLiters * input.epoxyPricePerLiter, currency)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pricing & Pigment Parameters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-white/5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-300">
              Вартість смоли
            </label>
            <div className="flex items-center rounded-lg p-0.5 neo-inset text-[10px]">
              <button
                type="button"
                onClick={() => {
                  onChange({
                    epoxyPriceCurrency: 'USD',
                    epoxyPriceInCurrency: currentUsdPrice,
                    epoxyPricePerLiter: Math.round(currentUsdPrice * usdRate),
                  });
                }}
                className={`px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-all ${
                  isUsdMode ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Вказати ціну смоли в USD (імпортна закупівля)"
              >
                $ USD
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({
                    epoxyPriceCurrency: 'UAH',
                  });
                }}
                className={`px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-all ${
                  !isUsdMode ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Вказати ціну смоли в гривнях"
              >
                ₴ UAH
              </button>
            </div>
          </div>

          {isUsdMode ? (
            <NeoTactileNumberInput
              id="input-epoxy-price-usd"
              value={currentUsdPrice}
              onChange={(val) => {
                const newUsd = Number(val.toFixed(2));
                onChange({
                  epoxyPriceCurrency: 'USD',
                  epoxyPriceInCurrency: newUsd,
                  epoxyPricePerLiter: Math.round(newUsd * usdRate),
                });
              }}
              unit="$/л"
              min={0}
              step={0.25}
            />
          ) : (
            <NeoTactileNumberInput
              id="input-epoxy-price"
              value={input.epoxyPricePerLiter}
              onChange={(val) => {
                onChange({
                  epoxyPricePerLiter: val,
                  epoxyPriceInCurrency: Number((val / usdRate).toFixed(2)),
                });
              }}
              unit="₴/л"
              min={0}
            />
          )}

          <div className="flex items-center justify-between mt-1 text-[10px]">
            {isUsdMode ? (
              <span className="text-cyan-300 font-mono font-medium">
                ≈ {input.epoxyPricePerLiter} ₴/л (курс: {usdRate} ₴/$)
              </span>
            ) : (
              <span className="text-slate-400 font-mono">
                ≈ ${(input.epoxyPricePerLiter / usdRate).toFixed(2)} USD/л
              </span>
            )}

            {onOpenCurrencySettings && (
              <button
                type="button"
                onClick={onOpenCurrencySettings}
                className="text-amber-400 hover:text-amber-300 underline cursor-pointer flex items-center gap-0.5"
                title="Налаштувати курс валют"
              >
                <Coins className="w-2.5 h-2.5" />
                <span>Курс</span>
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Оптично прозора смола для заливки (А+Б)</p>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            Вартість красителя / пігменту
          </label>
          <NeoTactileNumberInput
            id="input-epoxy-pigment"
            value={input.pigmentCost}
            onChange={(val) => onChange({ pigmentCost: val })}
            unit="₴"
            min={0}
          />
          <p className="text-[10px] text-slate-400 mt-1">Перламутри, металіки або спиртові чорнила</p>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            Опалубка, скотч, герметик, віск
          </label>
          <NeoTactileNumberInput
            id="input-epoxy-formwork"
            value={input.formworkAndMouldCost}
            onChange={(val) => onChange({ formworkAndMouldCost: val })}
            unit="₴"
            min={0}
          />
          <div className="flex items-center justify-between mt-1 text-[11px] text-cyan-400 font-mono">
            <span>Полімеризація смоли:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={30}
                value={input.epoxyCureStageDays ?? 6}
                onChange={(e) => onChange({ epoxyCureStageDays: Math.max(1, parseInt(e.target.value) || 1) })}
                className="w-10 px-1 py-0.5 text-center rounded bg-slate-900 border border-cyan-500/30 text-cyan-300 font-bold"
              />
              <span>дн.</span>
            </div>
          </div>
        </div>

        <div>
          <NeoTactileSlider
            id="slider-epoxy-waste"
            label="Запас на залишки у відрах"
            sublabel="Втрати на змішуванні та меніск"
            value={input.epoxyWastePercent}
            min={0}
            max={20}
            step={1}
            unit="%"
            onChange={(val) => onChange({ epoxyWastePercent: val })}
          />
        </div>
      </div>

      {/* Unit Rate & Final Cost Breakdown for Epoxy */}
      <div className="space-y-2 pt-2">
        <UnitCostDisplay
          id="epoxy-liquid-unit-cost"
          unitLabel="1 л смоли (А+Б)"
          rate={input.epoxyPricePerLiter}
          quantity={result.calculatedEpoxyLiters}
          quantityUnit="л (з урах. меніску)"
          totalCost={result.epoxyMaterialCost}
          currency={currency}
          accentColor="blue"
          decimals={2}
        />
      </div>

      {/* Summary strip inside section */}
      <div className="mt-3 p-3 rounded-xl neo-inset bg-slate-900/60 border border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
          <span>
            Смола ({result.calculatedEpoxyLiters.toFixed(1)} л): <strong className="text-white">{formatMoney(result.epoxyMaterialCost, currency)}</strong> + 
            Барвник: <strong className="text-white">{formatMoney(result.pigmentCost, currency)}</strong> + 
            Опалубка: <strong className="text-white">{formatMoney(result.formworkCost, currency)}</strong>
          </span>
        </div>
        <div className="font-mono text-sm text-blue-300 font-bold">
          Разом по смолі: {formatMoney(result.totalEpoxyGroupCost, currency)}
        </div>
      </div>
    </NeoTactileCard>
  );
};
