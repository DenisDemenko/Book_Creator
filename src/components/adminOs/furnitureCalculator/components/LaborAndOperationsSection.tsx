import React from 'react';
import { Users, Truck, ShieldCheck, Landmark, DollarSign, Wrench, Coins } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { NeoTactileCard } from './NeoTactileCard';
import { NeoTactileSlider } from './NeoTactileSlider';
import { NeoTactileNumberInput } from './NeoTactileNumberInput';
import { UnitCostDisplay } from './UnitCostDisplay';
import { formatMoney } from '../utils/calculator';

interface LaborAndOperationsSectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
  result: CalculationResult;
  currency: Currency;
  rates?: CurrencyRates;
  onOpenCurrencySettings?: () => void;
}

export const LaborAndOperationsSection: React.FC<LaborAndOperationsSectionProps> = ({
  input,
  onChange,
  result,
  currency,
  rates = { USD: 41.5, EUR: 45.2 },
  onOpenCurrencySettings,
}) => {
  return (
    <div className="space-y-6">
      {/* 5. Персонал та оплата праці */}
      <NeoTactileCard
        id="labor-section-card"
        title="5. Команда, майстри та оплата праці"
        subtitle="Столяр, збірник, дизайнер, менеджер з продажу та директор"
        icon={Users}
        badge={formatMoney(result.totalLaborCost, currency)}
        badgeColor="cyan"
        collapsible
        defaultExpanded
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Робота столяра
            </label>
            <NeoTactileNumberInput
              id="input-labor-carpenter"
              value={input.carpenterLaborCost}
              onChange={(val) => onChange({ carpenterLaborCost: val })}
              unit="₴"
              min={0}
            />
            <p className="text-[10px] text-slate-400 mt-1">Підготовка, склейка, шліфовка</p>
            <div className="flex items-center justify-between mt-1.5 text-[11px] text-blue-400 font-mono">
              <span>Термін робіт:</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={input.carpentryStageDays ?? 4}
                  onChange={(e) => onChange({ carpentryStageDays: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-10 px-1 py-0.5 text-center rounded bg-slate-900 border border-blue-500/30 text-blue-300 font-bold"
                />
                <span>дн.</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Збірник продукції
            </label>
            <NeoTactileNumberInput
              id="input-labor-assembler"
              value={input.assemblerLaborCost}
              onChange={(val) => onChange({ assemblerLaborCost: val })}
              unit="₴"
              min={0}
            />
            <p className="text-[10px] text-slate-400 mt-1">Монтаж підстілля, фінальна збірка</p>
            <div className="flex items-center justify-between mt-1.5 text-[11px] text-purple-400 font-mono">
              <span>Монтаж та ВТК:</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={input.assemblyStageDays ?? 2}
                  onChange={(e) => onChange({ assemblyStageDays: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-10 px-1 py-0.5 text-center rounded bg-slate-900 border border-purple-500/30 text-purple-300 font-bold"
                />
                <span>дн.</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Дизайнер / 3D візуалізатор
            </label>
            <NeoTactileNumberInput
              id="input-labor-designer"
              value={input.designerLaborCost}
              onChange={(val) => onChange({ designerLaborCost: val })}
              unit="₴"
              min={0}
            />
            <p className="text-[10px] text-slate-400 mt-1">Концепт, розкладка слебів, рендери</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Менеджер з продажу
            </label>
            <NeoTactileNumberInput
              id="input-labor-sales"
              value={input.salesManagerLaborCost}
              onChange={(val) => onChange({ salesManagerLaborCost: val })}
              unit="₴"
              min={0}
            />
            <p className="text-[10px] text-slate-400 mt-1">Комунікація, узгодження, супровід</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Директор / Адмін
            </label>
            <NeoTactileNumberInput
              id="input-labor-director"
              value={input.directorOverheadCost}
              onChange={(val) => onChange({ directorOverheadCost: val })}
              unit="₴"
              min={0}
            />
            <p className="text-[10px] text-slate-400 mt-1">Керівництво, контроль якості</p>
          </div>
        </div>

        {/* Breakdown for labor */}
        <div className="space-y-2 pt-3 border-t border-white/5">
          <UnitCostDisplay
            id="carpenter-labor-unit-cost"
            unitLabel="1 стіл/виріб"
            rate={input.carpenterLaborCost}
            quantity={1}
            quantityUnit="виріб (столярні роботи)"
            totalCost={input.carpenterLaborCost}
            currency={currency}
            accentColor="cyan"
            decimals={0}
          />
          <UnitCostDisplay
            id="assembler-labor-unit-cost"
            unitLabel="1 стіл/виріб"
            rate={input.assemblerLaborCost}
            quantity={1}
            quantityUnit="виріб (монтаж/збірка)"
            totalCost={input.assemblerLaborCost}
            currency={currency}
            accentColor="blue"
            decimals={0}
          />
        </div>
      </NeoTactileCard>

      {/* 6 & 7. Метал, упаковка та логістика */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NeoTactileCard
          id="base-hardware-card"
          title="6. Металокаркас, підстілля та фурнітура"
          subtitle="Виготовлення ніжок, порошкове фарбування в камері та компенсатори C-channel"
          icon={Wrench}
          badge={formatMoney(result.metalBaseGroupCost, currency)}
          badgeColor="slate"
          collapsible
          defaultExpanded
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Підстілля / метал
                </label>
                <NeoTactileNumberInput
                  id="input-metal-base"
                  value={input.metalBaseCost}
                  onChange={(val) => onChange({ metalBaseCost: val })}
                  unit="₴"
                  min={0}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Порошкове фарбування
                </label>
                <NeoTactileNumberInput
                  id="input-powder-coating"
                  value={input.powderCoatingCost}
                  onChange={(val) => onChange({ powderCoatingCost: val })}
                  unit="₴"
                  min={0}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Фурнітура та муфти
                </label>
                <NeoTactileNumberInput
                  id="input-hardware-cost"
                  value={input.hardwareCost}
                  onChange={(val) => onChange({ hardwareCost: val })}
                  unit="₴"
                  min={0}
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-400">
              Включає різьбові муфти Rampa, оцинковані гвинти та компенсаційні планки проти сезонного кручення дерева.
            </p>

            <UnitCostDisplay
              id="metal-base-unit-cost"
              unitLabel="1 комплект підстілля"
              rate={result.metalBaseGroupCost}
              quantity={1}
              quantityUnit="комплект (метал + порошок + кріплення)"
              totalCost={result.metalBaseGroupCost}
              currency={currency}
              accentColor="slate"
              decimals={0}
            />
          </div>
        </NeoTactileCard>

        <NeoTactileCard
          id="packaging-delivery-card"
          title="7. Упаковка та фінішна доставка"
          subtitle="Захисне упакування в короб/обрешітку та логістика до замовника"
          icon={Truck}
          badge={formatMoney(result.packagingCost + result.finalDeliveryCost, currency)}
          badgeColor="cyan"
          collapsible
          defaultExpanded
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Вартість упаковки
                </label>
                <NeoTactileNumberInput
                  id="input-packaging-cost"
                  value={input.packagingCost}
                  onChange={(val) => onChange({ packagingCost: val })}
                  unit="₴"
                  min={0}
                />
                <p className="text-[10px] text-slate-400 mt-1">Пухирчаста плівка, спінений ПЕ, дерево-каркас</p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Доставка готової продукції
                </label>
                <NeoTactileNumberInput
                  id="input-delivery-cost"
                  value={input.finalDeliveryCost}
                  onChange={(val) => onChange({ finalDeliveryCost: val })}
                  unit="₴"
                  min={0}
                />
                <p className="text-[10px] text-slate-400 mt-1">Адресна доставка кур'єром або вантажним авто</p>
              </div>
            </div>

            <UnitCostDisplay
              id="packaging-delivery-unit-cost"
              unitLabel="1 замовлення"
              rate={result.packagingCost + result.finalDeliveryCost}
              quantity={1}
              quantityUnit="виріб (упаковка + логістика)"
              totalCost={result.packagingCost + result.finalDeliveryCost}
              currency={currency}
              accentColor="cyan"
              decimals={0}
            />
          </div>
        </NeoTactileCard>
      </div>

      {/* 8 & 9. Амортизація, комунальні, податки та маржа */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NeoTactileCard
          id="depreciation-utilities-card"
          title="8. Амортизація та комунальні платежі"
          subtitle="Знос обладнання, електроенергія цеху, опалення та вентиляція"
          icon={Landmark}
          badge={formatMoney(result.totalOverheadCost, currency)}
          badgeColor="amber"
          collapsible
          defaultExpanded
        >
          <div className="space-y-4">
            <NeoTactileSlider
              id="slider-depreciation"
              label="Амортизація обладнання"
              sublabel="% від витрат на матеріали та оплату праці"
              value={input.equipmentDepreciationPercent}
              min={0}
              max={15}
              step={0.5}
              unit="%"
              onChange={(val) => onChange({ equipmentDepreciationPercent: val })}
            />

            <div className="p-2.5 rounded-xl neo-inset bg-slate-900/50 border border-white/5 flex items-center justify-between text-[11px] text-slate-300">
              <span className="flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Оновлення парку верстатів прив'язане до курсу USD (1$ = {rates?.USD ?? 41.5} ₴)</span>
              </span>
              {onOpenCurrencySettings && (
                <button
                  type="button"
                  onClick={onOpenCurrencySettings}
                  className="text-amber-400 hover:text-amber-300 underline cursor-pointer text-[10px] shrink-0 ml-2"
                >
                  Змінити курс
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/5">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Комунальні платежі (на виріб)
                </label>
                <NeoTactileNumberInput
                  id="input-utilities-cost"
                  value={input.utilitiesShareCost}
                  onChange={(val) => onChange({ utilitiesShareCost: val })}
                  unit="₴"
                  min={0}
                />
                <p className="text-[10px] text-slate-400 mt-1">Електроенергія, аспірація, опалення</p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Частка оренди цеху (на виріб)
                </label>
                <NeoTactileNumberInput
                  id="input-rent-cost"
                  value={input.workshopRentShareCost}
                  onChange={(val) => onChange({ workshopRentShareCost: val })}
                  unit="₴"
                  min={0}
                />
                <p className="text-[10px] text-slate-400 mt-1">Оренда площі майстерні на цикл</p>
              </div>
            </div>
          </div>
        </NeoTactileCard>

        <NeoTactileCard
          id="taxes-profit-card"
          title="9. Податки та рентабельність (Маржа)"
          subtitle="Система оподаткування бізнесу та бажаний чистий прибуток"
          icon={DollarSign}
          badge={`Прибуток: ${formatMoney(result.netProfit, currency)}`}
          badgeColor="blue"
          collapsible
          defaultExpanded
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-2">
                Режим оподаткування
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ taxMode: 'single_turnover_5', taxRatePercent: 5 })}
                  className={`p-2.5 rounded-xl text-left cursor-pointer transition-all ${
                    input.taxMode === 'single_turnover_5'
                      ? 'neo-pill-active'
                      : 'neo-card-subtle text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-semibold">ФОП 3 група (5%)</div>
                  <div className="text-[10px] opacity-75">5% від загального обороту</div>
                </button>

                <button
                  type="button"
                  onClick={() => onChange({ taxMode: 'profit_tax_18', taxRatePercent: 18 })}
                  className={`p-2.5 rounded-xl text-left cursor-pointer transition-all ${
                    input.taxMode === 'profit_tax_18'
                      ? 'neo-pill-active'
                      : 'neo-card-subtle text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-semibold">Податок на прибуток (18%)</div>
                  <div className="text-[10px] opacity-75">18% від чистої маржі</div>
                </button>
              </div>
            </div>

            <NeoTactileSlider
              id="slider-margin"
              label="Цільова націнка прибутку (Маржа)"
              sublabel="Відсоток чистого прибутку компанії від собівартості"
              value={input.profitMarginPercent}
              min={5}
              max={80}
              step={1}
              unit="%"
              onChange={(val) => onChange({ profitMarginPercent: val })}
            />

            <div className="p-3 rounded-xl neo-inset flex items-center justify-between text-xs">
              <span className="text-slate-400">Податок до сплати ({input.taxRatePercent}%):</span>
              <span className="font-mono text-amber-300 font-semibold">
                {formatMoney(result.taxAmount, currency)}
              </span>
            </div>
          </div>
        </NeoTactileCard>
      </div>
    </div>
  );
};
