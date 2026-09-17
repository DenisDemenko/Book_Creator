import React from 'react';
import { TreePine, Info } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency } from '../types';
import { WOOD_SPECIES_LIST } from '../data/woodPresets';
import { NeoTactileCard } from './NeoTactileCard';
import { NeoTactileSlider } from './NeoTactileSlider';
import { NeoTactileToggle } from './NeoTactileToggle';
import { NeoTactileNumberInput } from './NeoTactileNumberInput';
import { UnitCostDisplay } from './UnitCostDisplay';
import { formatMoney } from '../utils/calculator';

interface WoodSectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
  result: CalculationResult;
  currency: Currency;
}

export const WoodSection: React.FC<WoodSectionProps> = ({
  input,
  onChange,
  result,
  currency,
}) => {
  const selectedSpecies = WOOD_SPECIES_LIST.find((w) => w.id === input.woodSpeciesId) || WOOD_SPECIES_LIST[0];

  const handleSpeciesChange = (speciesId: string) => {
    const found = WOOD_SPECIES_LIST.find((w) => w.id === speciesId);
    if (found) {
      onChange({
        woodSpeciesId: found.id,
        woodPricePerM3: found.pricePerM3,
        woodDryingCostPerM3: found.dryingCostPerM3,
        woodWastePercent: found.wasteFactorPercent,
      });
    }
  };

  return (
    <NeoTactileCard
      id="wood-section-card"
      title="1. Деревина, сушіння та доставка"
      subtitle="Вибір породи, розрахунок кубатури слебів та підготовка масиву"
      icon={TreePine}
      badge={`${result.actualWoodM3.toFixed(4)} м³`}
      badgeColor="cyan"
      collapsible
      defaultExpanded
    >
      {/* Wood Species Selection */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-300 uppercase tracking-wider block">
          Порода деревини (Слеби / Масив)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {WOOD_SPECIES_LIST.map((sp) => {
            const isSelected = sp.id === input.woodSpeciesId;
            return (
              <button
                key={sp.id}
                type="button"
                onClick={() => handleSpeciesChange(sp.id)}
                className={`p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'neo-pill-active border-blue-400'
                    : 'neo-card-subtle hover:border-white/20'
                }`}
              >
                <div>
                  <div className="font-semibold text-xs text-white">{sp.name}</div>
                  <div className="text-[11px] text-slate-300/80 mt-1 line-clamp-2">
                    {sp.description}
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-white/10 flex justify-between items-center text-[10px] font-mono">
                  <span className="text-cyan-300 font-medium">
                    {formatMoney(sp.pricePerM3, currency)}/м³
                  </span>
                  <span className="text-slate-400">~{sp.densityKgM3} кг/м³</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Manual vs Dimensions Calculation Toggle */}
      <div className="pt-2 border-t border-white/5">
        <NeoTactileToggle
          id="toggle-manual-wood-vol"
          checked={input.useManualWoodVolume}
          onChange={(checked) => onChange({ useManualWoodVolume: checked })}
          label="Ручний ввід об'єму деревини (м³)"
          sublabel="Увімкніть, якщо ви вже знаєте точний об'єм купленого слебу за накладною"
        />
      </div>

      {input.useManualWoodVolume ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NeoTactileSlider
            id="slider-wood-vol-manual"
            label="Об'єм деревини на виріб"
            sublabel="В кубічних метрах"
            value={input.woodVolumeM3Manual}
            min={0.001}
            max={0.5}
            step={0.001}
            unit="м³"
            onChange={(val) => onChange({ woodVolumeM3Manual: val })}
          />
          <div className="p-3 rounded-xl neo-inset flex items-center justify-between text-xs">
            <span className="text-slate-400">Приблизна вага масиву:</span>
            <span className="font-mono text-cyan-300 font-semibold">
              {(input.woodVolumeM3Manual * selectedSpecies.densityKgM3).toFixed(1)} кг
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NeoTactileSlider
            id="slider-wood-len"
            label="Довжина слебу/щита"
            value={input.woodLengthMm}
            min={200}
            max={4000}
            step={50}
            unit="мм"
            onChange={(val) => onChange({ woodLengthMm: val })}
          />
          <NeoTactileSlider
            id="slider-wood-width"
            label="Загальна ширина масиву"
            sublabel="Сума ширина слебів"
            value={input.woodWidthMm}
            min={100}
            max={1800}
            step={25}
            unit="мм"
            onChange={(val) => onChange({ woodWidthMm: val })}
          />
          <NeoTactileSlider
            id="slider-wood-thickness"
            label="Товщина слебу (чорнова)"
            value={input.woodThicknessMm}
            min={15}
            max={120}
            step={5}
            unit="мм"
            onChange={(val) => onChange({ woodThicknessMm: val })}
          />
        </div>
      )}

      {/* Cost inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-white/5">
        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            Ціна деревини за 1 м³
          </label>
          <NeoTactileNumberInput
            id="input-wood-price"
            value={input.woodPricePerM3}
            onChange={(val) => onChange({ woodPricePerM3: val })}
            unit="₴/м³"
            min={0}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            Вартість сушки за 1 м³
          </label>
          <NeoTactileNumberInput
            id="input-wood-drying"
            value={input.woodDryingCostPerM3}
            onChange={(val) => onChange({ woodDryingCostPerM3: val })}
            unit="₴/м³"
            min={0}
          />
          <div className="flex items-center justify-between mt-1 text-[11px] text-amber-400 font-mono">
            <span>Термін сушки:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={60}
                value={input.dryingStageDays ?? 5}
                onChange={(e) => onChange({ dryingStageDays: Math.max(0, parseInt(e.target.value) || 0) })}
                className="w-10 px-1 py-0.5 text-center rounded bg-slate-900 border border-amber-500/30 text-amber-300 font-bold"
              />
              <span>дн.</span>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-300 block mb-1">
            Доставка сировини в цех
          </label>
          <NeoTactileNumberInput
            id="input-wood-delivery"
            value={input.rawMaterialDeliveryCost}
            onChange={(val) => onChange({ rawMaterialDeliveryCost: val })}
            unit="₴"
            min={0}
          />
        </div>

        <div>
          <NeoTactileSlider
            id="slider-wood-waste"
            label="Запас на відходи/обрізку"
            value={input.woodWastePercent}
            min={0}
            max={35}
            step={1}
            unit="%"
            onChange={(val) => onChange({ woodWastePercent: val })}
          />
        </div>
      </div>

      {/* Unit Rate & Final Cost Breakdown for Wood */}
      <div className="space-y-2 pt-2">
        <UnitCostDisplay
          id="wood-raw-unit-cost"
          unitLabel="1 м³ деревини"
          rate={input.woodPricePerM3}
          quantity={result.actualWoodM3}
          quantityUnit="м³ (з урах. обрізки)"
          totalCost={result.woodCostNet}
          currency={currency}
          accentColor="cyan"
          decimals={4}
        />
        <UnitCostDisplay
          id="wood-drying-unit-cost"
          unitLabel="1 м³ сушіння"
          rate={input.woodDryingCostPerM3}
          quantity={result.actualWoodM3}
          quantityUnit="м³"
          totalCost={result.woodDryingCost}
          currency={currency}
          accentColor="blue"
          decimals={4}
        />
      </div>

      {/* Summary strip inside section */}
      <div className="mt-3 p-3 rounded-xl neo-inset bg-slate-900/60 border border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            Деревина: <strong className="text-white">{formatMoney(result.woodCostNet, currency)}</strong> + 
            Сушіння: <strong className="text-white">{formatMoney(result.woodDryingCost, currency)}</strong> + 
            Доставка: <strong className="text-white">{formatMoney(result.woodDeliveryCost, currency)}</strong>
          </span>
        </div>
        <div className="font-mono text-sm text-cyan-300 font-bold">
          Разом по деревині: {formatMoney(result.totalWoodCost, currency)}
        </div>
      </div>
    </NeoTactileCard>
  );
};
