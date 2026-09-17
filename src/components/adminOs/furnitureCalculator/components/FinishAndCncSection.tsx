import React from 'react';
import { Paintbrush, Cpu, Disc3, Coins, Wrench, Sparkles, Layers } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { NeoTactileCard } from './NeoTactileCard';
import { NeoTactileSlider } from './NeoTactileSlider';
import { NeoTactileNumberInput } from './NeoTactileNumberInput';
import { UnitCostDisplay } from './UnitCostDisplay';
import { formatMoney } from '../utils/calculator';

interface FinishAndCncSectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
  result: CalculationResult;
  currency: Currency;
  rates?: CurrencyRates;
  onOpenCurrencySettings?: () => void;
}

const ROUTER_BIT_PRESETS = [
  {
    name: 'Сляб-планер для вирівнювання',
    type: 'Сляб-планер 50–80 мм зі змінними ножами',
    cost: 2800,
    lifespan: 15,
    desc: 'Калібрування площини слябів та епоксидних заливок',
  },
  {
    name: 'Спіральна компресійна фреза',
    type: 'Компресійна D12 для чистового різу',
    cost: 2100,
    lifespan: 20,
    desc: 'Чистовий контур без сколів з обох боків масиву',
  },
  {
    name: 'Твердосплавна чорнова для смоли',
    type: 'Твердосплавна для смоли + карагача/дуба',
    cost: 2600,
    lifespan: 10,
    desc: 'Підвищена зносостійкість при абразивній полімеризованій смолі',
  },
  {
    name: 'Кінцева пазова фреза',
    type: 'Спіральна D8–D10 для пазів та фурнітури',
    cost: 1750,
    lifespan: 30,
    desc: 'Пази під C-канали, кріплення Rampa та LED профіль',
  },
  {
    name: 'Монолітна фреза для капових зрізів',
    type: 'Посилена монолітна фреза HM',
    cost: 3000,
    lifespan: 6,
    desc: 'Ударні навантаження на капах, сувелях та кореневих зонах',
  },
];

export const FinishAndCncSection: React.FC<FinishAndCncSectionProps> = ({
  input,
  onChange,
  result,
  currency,
  rates = { USD: 41.5, EUR: 45.2 },
  onOpenCurrencySettings,
}) => {
  const usdRate = rates.USD || 41.5;
  const eurRate = rates.EUR || 45.2;

  // CNC Foreign Currency state
  const isCncUsd = input.cncMachineCurrency === 'USD';
  const currentCncUsd = input.cncMachineRateInCurrency || Number((input.cncMachineRatePerHour / usdRate).toFixed(1));

  // Finish Foreign Currency state
  const isFinishEur = input.finishCostCurrency === 'EUR';
  const currentFinishEur = input.finishCostInCurrency || Number((input.finishCostPerLiter / eurRate).toFixed(1));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 3. Фінішне покриття та абразиви */}
      <NeoTactileCard
        id="finish-section-card"
        title="3. Фініш, масло-віск та абразиви"
        subtitle="Захисне покриття, шліфувальні круги Р80-Р3000 та полірувальні пасти"
        icon={Paintbrush}
        badge={formatMoney(result.totalFinishingGroupCost, currency)}
        badgeColor="cyan"
        collapsible
        defaultExpanded
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-2">
              Тип фінішного покриття
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'oil_wax', label: 'Масло-віск', desc: 'Osmo / Rubio' },
                { id: 'polyurethane_varnish', label: 'Поліуретан лак', desc: 'Двокомпонентний' },
                { id: 'ceramic', label: 'Кераміка / нано', desc: 'Гіперстійкість' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChange({ finishType: opt.id as any })}
                  className={`p-2.5 rounded-xl text-center transition-all cursor-pointer ${
                    input.finishType === opt.id
                      ? 'neo-pill-active'
                      : 'neo-card-subtle text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  Ціна фінішу (Osmo/Rubio)
                </label>
                <div className="flex items-center rounded-lg p-0.5 neo-inset text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      onChange({
                        finishCostCurrency: 'EUR',
                        finishCostInCurrency: currentFinishEur,
                        finishCostPerLiter: Math.round(currentFinishEur * eurRate),
                      });
                    }}
                    className={`px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-all ${
                      isFinishEur ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Вказати ціну фінішу в EUR (імпортне масло Osmo/Rubio)"
                  >
                    € EUR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({
                        finishCostCurrency: 'UAH',
                      });
                    }}
                    className={`px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-all ${
                      !isFinishEur ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Вказати ціну фінішу в гривнях"
                  >
                    ₴ UAH
                  </button>
                </div>
              </div>

              {isFinishEur ? (
                <NeoTactileNumberInput
                  id="input-finish-price-eur"
                  value={currentFinishEur}
                  onChange={(val) => {
                    const newEur = Number(val.toFixed(1));
                    onChange({
                      finishCostCurrency: 'EUR',
                      finishCostInCurrency: newEur,
                      finishCostPerLiter: Math.round(newEur * eurRate),
                    });
                  }}
                  unit="€/л"
                  min={0}
                  step={1}
                />
              ) : (
                <NeoTactileNumberInput
                  id="input-finish-price"
                  value={input.finishCostPerLiter}
                  onChange={(val) => {
                    onChange({
                      finishCostPerLiter: val,
                      finishCostInCurrency: Number((val / eurRate).toFixed(1)),
                    });
                  }}
                  unit="₴/л"
                  min={0}
                />
              )}

              <div className="flex items-center justify-between mt-1 text-[10px]">
                {isFinishEur ? (
                  <span className="text-emerald-300 font-mono font-medium">
                    ≈ {input.finishCostPerLiter} ₴/л (курс: {eurRate} ₴/€)
                  </span>
                ) : (
                  <span className="text-slate-400 font-mono">
                    ≈ €{(input.finishCostPerLiter / eurRate).toFixed(1)} EUR/л
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
            </div>

            <div>
              <NeoTactileSlider
                id="slider-finish-ml"
                label="Витрата покриття"
                value={input.finishAmountMl}
                min={20}
                max={1500}
                step={20}
                unit="мл"
                onChange={(val) => onChange({ finishAmountMl: val })}
              />

              <div className="flex items-center justify-between mt-2 p-2 rounded-xl bg-slate-900/60 border border-emerald-500/20 text-xs font-mono">
                <span className="text-slate-300">Сушка та міжшарова кристалізація:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChange({ finishingStageDays: Math.max(0, (input.finishingStageDays ?? 3) - 1) })}
                    className="w-6 h-6 rounded bg-slate-800 text-emerald-300 font-bold flex items-center justify-center hover:bg-slate-700 cursor-pointer"
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-emerald-300 font-bold">
                    {input.finishingStageDays ?? 3} дн.
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange({ finishingStageDays: (input.finishingStageDays ?? 3) + 1 })}
                    className="w-6 h-6 rounded bg-slate-800 text-emerald-300 font-bold flex items-center justify-center hover:bg-slate-700 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          <UnitCostDisplay
            id="finish-liquid-unit-cost"
            unitLabel="1 л покриття"
            rate={input.finishCostPerLiter}
            quantity={input.finishAmountMl / 1000}
            quantityUnit="л"
            totalCost={result.finishCost}
            currency={currency}
            accentColor="cyan"
            decimals={3}
          />

          <div className="pt-2 border-t border-white/5">
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Шліфувальні круги, полірувальні пасти (3M/Menzerna)
            </label>
            <NeoTactileNumberInput
              id="input-abrasives-cost"
              value={input.abrasivesAndSandingCost}
              onChange={(val) => onChange({ abrasivesAndSandingCost: val })}
              unit="₴"
              min={0}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Абразиви P80, P120, P240, P400, P800, P1500, P3000 + круги для полірування
            </p>
          </div>
        </div>
      </NeoTactileCard>

      {/* 4. ЧПУ обробка */}
      <NeoTactileCard
        id="cnc-section-card"
        title="4. ЧПУ обробка та фрезерування"
        subtitle="Вирівнювання площини (сляб-планінг), вибірка пазів, 3D рельєф, фаски"
        icon={Cpu}
        badge={formatMoney(result.totalCncCost, currency)}
        badgeColor="blue"
        collapsible
        defaultExpanded
      >
        <div className="space-y-4">
          <NeoTactileSlider
            id="slider-cnc-hours"
            label="Години роботи ЧПУ верстата"
            sublabel="Чистий машинний час обробки"
            value={input.cncHours}
            min={0}
            max={20}
            step={0.5}
            unit="год"
            onChange={(val) => onChange({ cncHours: val })}
          />

          <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-indigo-500/20 text-xs font-mono">
            <span className="text-slate-300">Орієнтовний термін ЧПУ етапу:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ cncStageDays: Math.max(0, (input.cncStageDays ?? 2) - 1) })}
                className="w-6 h-6 rounded bg-slate-800 text-indigo-300 font-bold flex items-center justify-center hover:bg-slate-700 cursor-pointer"
              >
                -
              </button>
              <span className="w-8 text-center text-indigo-300 font-bold">
                {input.cncStageDays ?? 2} дн.
              </span>
              <button
                type="button"
                onClick={() => onChange({ cncStageDays: (input.cncStageDays ?? 2) + 1 })}
                className="w-6 h-6 rounded bg-slate-800 text-indigo-300 font-bold flex items-center justify-center hover:bg-slate-700 cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  Вартість ЧПУ станка
                </label>
                <div className="flex items-center rounded-lg p-0.5 neo-inset text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      onChange({
                        cncMachineCurrency: 'USD',
                        cncMachineRateInCurrency: currentCncUsd,
                        cncMachineRatePerHour: Math.round(currentCncUsd * usdRate),
                      });
                    }}
                    className={`px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-all ${
                      isCncUsd ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Вказати вартість машиногодини в USD (амортизація імпортного станка та фрез)"
                  >
                    $ USD
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({
                        cncMachineCurrency: 'UAH',
                      });
                    }}
                    className={`px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-all ${
                      !isCncUsd ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Вказати вартість у гривнях"
                  >
                    ₴ UAH
                  </button>
                </div>
              </div>

              {isCncUsd ? (
                <NeoTactileNumberInput
                  id="input-cnc-machine-usd"
                  value={currentCncUsd}
                  onChange={(val) => {
                    const newUsd = Number(val.toFixed(1));
                    onChange({
                      cncMachineCurrency: 'USD',
                      cncMachineRateInCurrency: newUsd,
                      cncMachineRatePerHour: Math.round(newUsd * usdRate),
                    });
                  }}
                  unit="$/год"
                  min={0}
                  step={0.5}
                />
              ) : (
                <NeoTactileNumberInput
                  id="input-cnc-machine"
                  value={input.cncMachineRatePerHour}
                  onChange={(val) => {
                    onChange({
                      cncMachineRatePerHour: val,
                      cncMachineRateInCurrency: Number((val / usdRate).toFixed(1)),
                    });
                  }}
                  unit="₴/год"
                  min={0}
                />
              )}

              <div className="flex items-center justify-between mt-1 text-[10px]">
                {isCncUsd ? (
                  <span className="text-cyan-300 font-mono font-medium">
                    ≈ {input.cncMachineRatePerHour} ₴/год (курс: {usdRate} ₴/$)
                  </span>
                ) : (
                  <span className="text-slate-400 font-mono">
                    ≈ ${(input.cncMachineRatePerHour / usdRate).toFixed(1)} USD/год
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
              <p className="text-[10px] text-slate-400 mt-1">Знос шпинделя, фрези Freud/CMT, електрика</p>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Вартість оператора ЧПУ за 1 год
              </label>
              <NeoTactileNumberInput
                id="input-cnc-operator"
                value={input.cncOperatorRatePerHour}
                onChange={(val) => onChange({ cncOperatorRatePerHour: val })}
                unit="₴/год"
                min={0}
              />
              <p className="text-[10px] text-slate-400 mt-1">Підготовка G-коду, позиціонування</p>
            </div>
          </div>

          {/* Router Bit & Tooling Cost Block (Амортизація фрез ЧПУ) */}
          <div className="p-4 rounded-2xl neo-inset border border-indigo-500/20 bg-slate-950/60 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
                  <Wrench className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                    <span>Амортизація та знос фрез ЧПУ</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      {formatMoney(result.routerBitDepreciationPerProduct, currency)} / виріб
                    </span>
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    Вартість 1 фрези (1 500 – 3 000 ₴) та ресурс від 1 до 50 виробів
                  </p>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer self-start sm:self-auto">
                <input
                  type="checkbox"
                  checked={input.includeRouterBitCost !== false}
                  onChange={(e) => onChange({ includeRouterBitCost: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500 relative" />
                <span className="text-[11px] font-medium text-slate-300">
                  {input.includeRouterBitCost !== false ? 'Враховано' : 'Вимкнено'}
                </span>
              </label>
            </div>

            {input.includeRouterBitCost !== false && (
              <>
                {/* Presets */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1.5">
                    Швидкий вибір типу фрези під завдання:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {ROUTER_BIT_PRESETS.map((p) => {
                      const isSelected =
                        input.routerBitCost === p.cost && input.routerBitLifespanProducts === p.lifespan;
                      return (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => {
                            onChange({
                              routerBitCost: p.cost,
                              routerBitLifespanProducts: p.lifespan,
                              routerBitType: p.type,
                            });
                          }}
                          className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-500/20 border-indigo-400/50 text-white shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                              : 'bg-slate-900/60 border-white/5 text-slate-300 hover:border-white/20 hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold">
                            <span className="truncate">{p.name}</span>
                            <span className="font-mono text-indigo-300 shrink-0 ml-1">{p.cost} ₴</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                            <span>Ресурс: <strong className="text-slate-200 font-mono">{p.lifespan} вир.</strong></span>
                            <span className="text-emerald-400 font-mono font-medium">
                              ≈ {Math.round(p.cost / p.lifespan)} ₴/вир.
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Concrete Cost Input (1500 - 3000 UAH) */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <label className="text-xs font-medium text-slate-200">
                        Вартість 1 фрези для цього шаблона
                      </label>
                      <p className="text-[10px] text-slate-400">
                        Діапазон професійних фрез Freud / CMT / WPW: 1 500 – 3 000 ₴
                      </p>
                    </div>

                    {/* Quick Cost Chips */}
                    <div className="flex flex-wrap items-center gap-1">
                      {[1500, 1850, 2200, 2600, 3000].map((costVal) => (
                        <button
                          key={costVal}
                          type="button"
                          onClick={() => onChange({ routerBitCost: costVal })}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                            (input.routerBitCost ?? 2200) === costVal
                              ? 'bg-indigo-500 text-white shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {costVal} ₴
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                    <div className="sm:col-span-2">
                      <NeoTactileSlider
                        id="slider-router-bit-cost"
                        label="Ціна нової фрези"
                        value={input.routerBitCost ?? 2200}
                        min={1500}
                        max={3000}
                        step={50}
                        unit="₴"
                        onChange={(val) => onChange({ routerBitCost: val })}
                      />
                    </div>
                    <div>
                      <NeoTactileNumberInput
                        id="input-router-bit-cost"
                        value={input.routerBitCost ?? 2200}
                        onChange={(val) => onChange({ routerBitCost: val })}
                        unit="₴"
                        min={500}
                        max={10000}
                        step={50}
                      />
                    </div>
                  </div>
                </div>

                {/* Lifespan / Depreciation in products range 1 to 50 */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <label className="text-xs font-medium text-slate-200">
                        Ресурс амортизації фрези (кількість виробів)
                      </label>
                      <p className="text-[10px] text-slate-400">
                        На скільки однакових виробів вистачає заточки/пластин (від 1 до 50)
                      </p>
                    </div>

                    {/* Quick Lifespan Chips */}
                    <div className="flex flex-wrap items-center gap-1">
                      {[1, 5, 10, 15, 25, 50].map((lifeVal) => (
                        <button
                          key={lifeVal}
                          type="button"
                          onClick={() => onChange({ routerBitLifespanProducts: lifeVal })}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                            (input.routerBitLifespanProducts ?? 10) === lifeVal
                              ? 'bg-indigo-500 text-white shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {lifeVal} {lifeVal === 1 ? 'виріб' : lifeVal < 5 ? 'вироби' : 'виробів'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                    <div className="sm:col-span-2">
                      <NeoTactileSlider
                        id="slider-router-bit-lifespan"
                        label="Амортизаційний ресурс фрези"
                        sublabel="Діапазон: 1 – 50 готових виробів"
                        value={input.routerBitLifespanProducts ?? 10}
                        min={1}
                        max={50}
                        step={1}
                        unit="виробів"
                        onChange={(val) => onChange({ routerBitLifespanProducts: Math.min(50, Math.max(1, val)) })}
                      />
                    </div>
                    <div>
                      <NeoTactileNumberInput
                        id="input-router-bit-lifespan"
                        value={input.routerBitLifespanProducts ?? 10}
                        onChange={(val) => onChange({ routerBitLifespanProducts: Math.min(50, Math.max(1, val)) })}
                        unit="вир."
                        min={1}
                        max={50}
                        step={1}
                      />
                    </div>
                  </div>

                  {/* Calculation Result Summary Pill */}
                  <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                      <span className="text-slate-300">
                        Розрахунок зносу: <strong className="text-white font-mono">{input.routerBitCost ?? 2200} ₴</strong> ÷ <strong className="text-white font-mono">{input.routerBitLifespanProducts ?? 10} вир.</strong>
                      </span>
                    </div>
                    <div className="text-indigo-300 font-mono font-bold bg-indigo-500/20 px-2.5 py-1 rounded-lg border border-indigo-500/30">
                      = {formatMoney(result.routerBitDepreciationPerProduct, currency)} / виріб
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <UnitCostDisplay
              id="cnc-machine-unit-cost"
              unitLabel="1 год роботи верстата"
              rate={input.cncMachineRatePerHour}
              quantity={input.cncHours}
              quantityUnit="год"
              totalCost={result.cncMachineCost}
              currency={currency}
              accentColor="blue"
              decimals={1}
            />
            <UnitCostDisplay
              id="cnc-operator-unit-cost"
              unitLabel="1 год оператора ЧПУ"
              rate={input.cncOperatorRatePerHour}
              quantity={input.cncHours}
              quantityUnit="год"
              totalCost={result.cncOperatorCost}
              currency={currency}
              accentColor="cyan"
              decimals={1}
            />
            {input.includeRouterBitCost !== false && (
              <UnitCostDisplay
                id="cnc-router-bit-unit-cost"
                unitLabel={`Амортизація фрези (${input.routerBitCost ?? 2200} ₴ / ${input.routerBitLifespanProducts ?? 10} вир.)`}
                rate={Math.round(result.routerBitDepreciationPerProduct)}
                quantity={1}
                quantityUnit="виріб"
                totalCost={result.routerBitDepreciationPerProduct}
                currency={currency}
                accentColor="cyan"
                decimals={0}
              />
            )}
          </div>

          <div className="p-3 rounded-xl neo-inset text-xs flex justify-between items-center text-slate-300">
            <span>Разом ЧПУ (верстат + оператор + фреза):</span>
            <span className="font-mono text-cyan-300 font-bold">
              {formatMoney(result.totalCncCost, currency)}
            </span>
          </div>
        </div>
      </NeoTactileCard>
    </div>
  );
};
