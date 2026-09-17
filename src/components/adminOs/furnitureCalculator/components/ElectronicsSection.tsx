import React from 'react';
import { Zap, Cpu, Flame, Sliders, Radio, ShieldCheck, Wrench, Sparkles, Check, Info } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { NeoTactileCard } from './NeoTactileCard';
import { NeoTactileNumberInput } from './NeoTactileNumberInput';
import { NeoTactileToggle } from './NeoTactileToggle';
import { formatMoney } from '../utils/calculator';

interface ElectronicsSectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
  result: CalculationResult;
  currency: Currency;
  rates?: CurrencyRates;
}

// Популярні перевірені блоки живлення для меблів
const POWER_SUPPLY_PRESETS = [
  {
    name: 'Mean Well 24V 100W LPV-100-24 (Герметичний IP67)',
    watts: 100,
    cost: 1150,
    desc: 'Надійний вологозахищений БЖ для заливки та прихованого монтажу',
  },
  {
    name: 'Mean Well 24V 150W LPV-150-24 (IP67 Потужний)',
    watts: 150,
    cost: 1650,
    desc: 'Для великих обідніх столів-річок з довгою підсвіткою',
  },
  {
    name: 'Тонкий Slim 24V 100W (Товщина 18 мм)',
    watts: 100,
    cost: 890,
    desc: 'Ідеально ховається в потайні пази стільниці або металеве підстілля',
  },
  {
    name: 'Компактний 12V 60W (Для невеликих виробів)',
    watts: 60,
    cost: 550,
    desc: 'Для журнальних столиків, органайзерів та світильників',
  },
];

// Типи LED стрічок
const LED_STRIP_PRESETS = [
  {
    name: 'COB 24V Безкрапкова (Суцільне неонове сяйво, 480 LED/м)',
    type: 'COB 24V 4000K',
    pricePerM: 380,
    desc: 'Не дає окремих точок світла навіть крізь напівпрозору епоксидну смолу',
  },
  {
    name: 'ARGB WS2812B / WS2811 (Адресні ефекти річки, вогню, анімації)',
    type: 'ARGB WS2812B 60 LED/m',
    pricePerM: 420,
    desc: 'Кожен світлодіод керується окремо: плавні переливи та хвилі',
  },
  {
    name: 'RGB+W 5050 24V (Мультиколір + окремий теплий білий)',
    type: 'RGBW 5050 24V',
    pricePerM: 290,
    desc: 'Будь-який колір за настроєм або якісне фонове освітлення кімнати',
  },
  {
    name: 'SMD 2835 120 LED/м 24V (Класичний нейтральний білий 4000K)',
    type: 'SMD 2835 24V 120d',
    pricePerM: 190,
    desc: 'Бюджетний варіант для теплого або нейтрального підсвічування',
  },
];

// Мікропроцесорні плати керування
const MICROCONTROLLER_PRESETS = [
  {
    name: 'ESP32 Wi-Fi + Bluetooth (Прошивка WLED / Apple Home / Google)',
    cost: 650,
    desc: 'Керування зі смартфона по Wi-Fi, 100+ динамічних ефектів, таймери, Smart Home',
  },
  {
    name: 'SP107E Музичний ARGB контролер (Світломузика через мікрофон)',
    cost: 780,
    desc: 'Підсвітка реагує пульсаціями на музику та голос через вбудований AUX/мікрофон',
  },
  {
    name: 'Tuya Smart Wi-Fi + Сенсорний RF пульт ДК',
    cost: 540,
    desc: 'Зручний магнітний пульт на стіну/стіл + інтеграція в додаток Tuya / Smart Life',
  },
  {
    name: 'Сенсорний датчик-димер скритого монтажу (крізь масив дерева)',
    cost: 390,
    desc: 'Вмикання та плавне регулювання яскравості дотиком до поверхні стільниці',
  },
];

export const ElectronicsSection: React.FC<ElectronicsSectionProps> = ({
  input,
  onChange,
  result,
  currency,
  rates = { USD: 41.5, EUR: 45.2 },
}) => {
  const isEnabled = Boolean(input.includeElectronics);

  // Defaults when enabling
  const powerSupplyCost = input.powerSupplyCost ?? 1150;
  const powerSupplyWatts = input.powerSupplyWatts ?? 100;
  const powerSupplyCount = input.powerSupplyCount ?? 1;
  const powerSupplyType = input.powerSupplyType || 'Mean Well 24V 100W LPV-100-24 (IP67)';

  const ledStripLength = input.ledStripLengthMeters ?? 2.5;
  const ledStripPrice = input.ledStripPricePerMeter ?? 380;
  const ledStripType = input.ledStripType || 'COB 24V Безкрапкова';

  const ledProfileLength = input.ledProfileLengthMeters ?? 2.5;
  const ledProfilePrice = input.ledProfilePricePerMeter ?? 160;

  const microcontrollerCost = input.microcontrollerCost ?? 650;
  const microcontrollerType = input.microcontrollerType || 'ESP32 Wi-Fi + BLE (WLED Smart Home)';
  const electronicAccessoriesCost = input.electronicAccessoriesCost ?? 250;

  const soldererMode = input.soldererLaborMode || 'hourly';
  const soldererHours = input.soldererLaborHours ?? 2.0;
  const soldererHourlyRate = input.soldererHourlyRate ?? 300;
  const soldererFixedCost = input.soldererFixedCost ?? 600;
  const solderingConsumablesCost = input.solderingConsumablesCost ?? 180;

  const usdRate = rates.USD || 41.5;

  const handleToggle = (checked: boolean) => {
    if (checked) {
      onChange({
        includeElectronics: true,
        powerSupplyCost,
        powerSupplyWatts,
        powerSupplyCount,
        powerSupplyType,
        ledStripLengthMeters: ledStripLength,
        ledStripPricePerMeter: ledStripPrice,
        ledStripType,
        ledProfileLengthMeters: ledProfileLength,
        ledProfilePricePerMeter: ledProfilePrice,
        microcontrollerCost,
        microcontrollerType,
        electronicAccessoriesCost,
        soldererLaborMode: soldererMode,
        soldererLaborHours: soldererHours,
        soldererHourlyRate: soldererHourlyRate,
        soldererFixedCost,
        solderingConsumablesCost,
      });
    } else {
      onChange({ includeElectronics: false });
    }
  };

  return (
    <NeoTactileCard
      id="electronics-section-card"
      title="5. Електроніка, LED підсвітка та мікропроцесорне керування"
      subtitle="Розрахунок блоку живлення, LED стрічки з профілем, плати управління (ESP32/Tuya) та роботи пайщика"
      icon={Zap}
      badge={
        isEnabled
          ? `${formatMoney(result.totalElectronicsCost, currency)} ($${(result.totalElectronicsCost / usdRate).toFixed(1)})`
          : 'Не використовується'
      }
      badgeColor={isEnabled ? 'purple' : 'slate'}
      collapsible
      defaultExpanded={isEnabled}
    >
      <div className="space-y-6">
        {/* Enable / Disable Electronics Banner */}
        <div className="p-4 rounded-2xl neo-inset border border-amber-500/20 bg-slate-950/70 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5" /> Вбудована ілюмінація
              </span>
              <span className="text-xs text-slate-400">
                Стіл-річка з підсвіткою, нічник, барна стійка або настінне панно
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Калькулятор враховує апаратні компоненти (БЖ, стрічка, плата), а також роботу майстра-пайщика та витратні матеріали герметизації.
            </p>
          </div>

          <div className="flex items-center gap-3 self-end md:self-center">
            <span className="text-xs font-semibold text-slate-200">
              {isEnabled ? 'Підсвітка УВІМКНЕНА' : 'Увімкнути підсвітку:'}
            </span>
            <NeoTactileToggle
              id="toggle-include-electronics"
              checked={isEnabled}
              onChange={handleToggle}
              label=""
            />
          </div>
        </div>

        {isEnabled && (
          <div className="space-y-6">
            {/* Grid 1: Power Supply Unit & LED Strip */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* BLOCK 1: Блок живлення (БЖ) */}
              <div className="p-4.5 rounded-2xl neo-card border border-amber-500/30 bg-gradient-to-br from-slate-900/90 to-amber-950/20 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">Блок живлення (БЖ)</h4>
                      <p className="text-[11px] text-slate-400">Трансформатор 220V → 12V / 24V</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block font-mono">Сума за БЖ:</span>
                    <span className="text-sm font-bold text-amber-300 font-mono">
                      {formatMoney(result.powerSupplyTotalCost, currency)}
                    </span>
                  </div>
                </div>

                {/* Presets for Power Supply */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1.5">
                    Оберіть типовий блок живлення:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {POWER_SUPPLY_PRESETS.map((p, idx) => {
                      const isSelected = input.powerSupplyType === p.name || input.powerSupplyCost === p.cost;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            onChange({
                              powerSupplyType: p.name,
                              powerSupplyCost: p.cost,
                              powerSupplyWatts: p.watts,
                            })
                          }
                          className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-amber-500/20 border-amber-400 text-white shadow-md shadow-amber-500/10'
                              : 'bg-slate-950/40 border-white/10 text-slate-300 hover:border-amber-500/40'
                          }`}
                        >
                          <div className="font-semibold flex items-center justify-between">
                            <span className="truncate pr-1">{p.name}</span>
                            <span className="font-mono text-amber-300 shrink-0 font-bold">{p.cost} ₴</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 line-clamp-1">{p.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Manual inputs for Power Supply */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Ціна 1 блоку живлення
                    </label>
                    <NeoTactileNumberInput
                      id="input-psu-cost"
                      value={powerSupplyCost}
                      onChange={(val) => onChange({ powerSupplyCost: val })}
                      unit="₴"
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Кількість БЖ
                    </label>
                    <NeoTactileNumberInput
                      id="input-psu-count"
                      value={powerSupplyCount}
                      onChange={(val) => onChange({ powerSupplyCount: Math.max(1, Math.round(val)) })}
                      unit="шт"
                      min={1}
                    />
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/5 flex items-center justify-between text-xs">
                  <span className="text-slate-400 text-[11px]">Потужність блоку:</span>
                  <span className="font-mono font-bold text-amber-300">{powerSupplyWatts} Вт</span>
                </div>
              </div>

              {/* BLOCK 2: LED Підсвітка та Алюмінієвий профіль */}
              <div className="p-4.5 rounded-2xl neo-card border border-cyan-500/30 bg-gradient-to-br from-slate-900/90 to-cyan-950/20 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">LED стрічка та профіль</h4>
                      <p className="text-[11px] text-slate-400">Світлова лінія річки або контур столу</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block font-mono">Стрічка + профіль:</span>
                    <span className="text-sm font-bold text-cyan-300 font-mono">
                      {formatMoney(result.ledStripTotalCost + result.ledProfileTotalCost, currency)}
                    </span>
                  </div>
                </div>

                {/* Presets for LED Strip */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1.5">
                    Тип LED стрічки:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {LED_STRIP_PRESETS.map((s, idx) => {
                      const isSelected = input.ledStripPricePerMeter === s.pricePerM;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            onChange({
                              ledStripType: s.name,
                              ledStripPricePerMeter: s.pricePerM,
                            })
                          }
                          className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-md shadow-cyan-500/10'
                              : 'bg-slate-950/40 border-white/10 text-slate-300 hover:border-cyan-500/40'
                          }`}
                        >
                          <div className="font-semibold flex items-center justify-between">
                            <span className="truncate pr-1">{s.name.split('(')[0]}</span>
                            <span className="font-mono text-cyan-300 shrink-0 font-bold">{s.pricePerM} ₴/м</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 line-clamp-1">{s.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Manual inputs: Length & Price */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Довжина LED стрічки
                    </label>
                    <NeoTactileNumberInput
                      id="input-led-strip-length"
                      value={ledStripLength}
                      onChange={(val) => onChange({ ledStripLengthMeters: val })}
                      unit="м"
                      step={0.1}
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Ціна стрічки за 1 метр
                    </label>
                    <NeoTactileNumberInput
                      id="input-led-strip-price"
                      value={ledStripPrice}
                      onChange={(val) => onChange({ ledStripPricePerMeter: val })}
                      unit="₴/м"
                      min={0}
                    />
                  </div>
                </div>

                {/* Profile row */}
                <div className="p-3 rounded-xl bg-slate-950/50 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">
                      Алюмінієвий профіль з розсіювачем (опал):
                    </span>
                    <span className="font-mono font-bold text-cyan-300">
                      {formatMoney(result.ledProfileTotalCost, currency)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400 block mb-0.5">Довжина профілю:</span>
                      <NeoTactileNumberInput
                        id="input-profile-length"
                        value={ledProfileLength}
                        onChange={(val) => onChange({ ledProfileLengthMeters: val })}
                        unit="м"
                        step={0.1}
                        min={0}
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block mb-0.5">Ціна профілю:</span>
                      <NeoTactileNumberInput
                        id="input-profile-price"
                        value={ledProfilePrice}
                        onChange={(val) => onChange({ ledProfilePricePerMeter: val })}
                        unit="₴/м"
                        min={0}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Grid 2: Microcontroller Board & Soldering Labor */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* BLOCK 3: Плата мікропроцесора для управління */}
              <div className="p-4.5 rounded-2xl neo-card border border-purple-500/30 bg-gradient-to-br from-slate-900/90 to-purple-950/20 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">Плата мікропроцесора</h4>
                      <p className="text-[11px] text-slate-400">Контролер управління світлом, Wi-Fi, Bluetooth, пульт</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block font-mono">Плата + аксесуари:</span>
                    <span className="text-sm font-bold text-purple-300 font-mono">
                      {formatMoney(result.microcontrollerTotalCost + result.electronicAccessoriesTotalCost, currency)}
                    </span>
                  </div>
                </div>

                {/* Presets for Controllers */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1.5">
                    Оберіть тип плати / контролера:
                  </label>
                  <div className="space-y-2">
                    {MICROCONTROLLER_PRESETS.map((m, idx) => {
                      const isSelected = input.microcontrollerCost === m.cost;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            onChange({
                              microcontrollerType: m.name,
                              microcontrollerCost: m.cost,
                            })
                          }
                          className={`w-full p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer flex items-start justify-between gap-2 ${
                            isSelected
                              ? 'bg-purple-500/20 border-purple-400 text-white shadow-md shadow-purple-500/10'
                              : 'bg-slate-950/40 border-white/10 text-slate-300 hover:border-purple-500/40'
                          }`}
                        >
                          <div>
                            <div className="font-semibold">{m.name}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{m.desc}</div>
                          </div>
                          <span className="font-mono text-purple-300 font-bold shrink-0">{m.cost} ₴</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Manual Cost Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Вартість плати контролера
                    </label>
                    <NeoTactileNumberInput
                      id="input-microcontroller-cost"
                      value={microcontrollerCost}
                      onChange={(val) => onChange({ microcontrollerCost: val })}
                      unit="₴"
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Дроти, роз'єми IP68, конектори
                    </label>
                    <NeoTactileNumberInput
                      id="input-accessories-cost"
                      value={electronicAccessoriesCost}
                      onChange={(val) => onChange({ electronicAccessoriesCost: val })}
                      unit="₴"
                      min={0}
                    />
                  </div>
                </div>
              </div>

              {/* BLOCK 4: Робота пайщика для зборки електроніки */}
              <div className="p-4.5 rounded-2xl neo-card border border-emerald-500/30 bg-gradient-to-br from-slate-900/90 to-emerald-950/20 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">Робота пайщика (електромонтаж)</h4>
                      <p className="text-[11px] text-slate-400">Пайка стрічки, дротів, герметизація та тест схеми</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block font-mono">Оплата пайщика:</span>
                    <span className="text-sm font-bold text-emerald-300 font-mono">
                      {formatMoney(result.soldererLaborCost, currency)}
                    </span>
                  </div>
                </div>

                {/* Mode Selector: Hourly vs Fixed */}
                <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-950/60 border border-white/5">
                  <button
                    type="button"
                    onClick={() => onChange({ soldererLaborMode: 'hourly' })}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      soldererMode === 'hourly'
                        ? 'bg-emerald-500 text-black font-bold shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Погодинна оплата (год × ставка)
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ soldererLaborMode: 'fixed' })}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      soldererMode === 'fixed'
                        ? 'bg-emerald-500 text-black font-bold shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Фіксована ціна за вузол
                  </button>
                </div>

                {soldererMode === 'hourly' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-300 block mb-1">
                        Час роботи пайщика
                      </label>
                      <NeoTactileNumberInput
                        id="input-solderer-hours"
                        value={soldererHours}
                        onChange={(val) => onChange({ soldererLaborHours: val })}
                        unit="год"
                        step={0.5}
                        min={0}
                      />
                      <p className="text-[10px] text-slate-400 mt-1">зачистка, пайка, лудіння, термоусадка</p>
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-slate-300 block mb-1">
                        Погодинна ставка пайщика
                      </label>
                      <NeoTactileNumberInput
                        id="input-solderer-rate"
                        value={soldererHourlyRate}
                        onChange={(val) => onChange({ soldererHourlyRate: val })}
                        unit="₴/год"
                        min={0}
                      />
                      <p className="text-[10px] text-slate-400 mt-1">в середньому 250 - 350 ₴/год</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Фіксована вартість збірки та пайки
                    </label>
                    <NeoTactileNumberInput
                      id="input-solderer-fixed"
                      value={soldererFixedCost}
                      onChange={(val) => onChange({ soldererFixedCost: val })}
                      unit="₴"
                      min={0}
                    />
                  </div>
                )}

                {/* Soldering Consumables */}
                <div className="p-3 rounded-xl bg-slate-950/50 border border-white/5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">Розхідники пайки та гідроізоляції:</span>
                    <span className="font-mono font-bold text-emerald-300">
                      {formatMoney(result.solderingConsumablesTotalCost, currency)}
                    </span>
                  </div>
                  <NeoTactileNumberInput
                    id="input-soldering-consumables"
                    value={solderingConsumablesCost}
                    onChange={(val) => onChange({ solderingConsumablesCost: val })}
                    unit="₴"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400">
                    Припій ПОС-61, флюс, клейова термозбіжна трубка, компаунд герметизації пайки під заливку смоли
                  </p>
                </div>
              </div>
            </div>

            {/* Total Electronics Summary Bar */}
            <div className="p-4.5 rounded-2xl neo-inset border border-purple-500/30 bg-gradient-to-r from-slate-950/90 via-purple-950/30 to-slate-950/90 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Повна вартість електронного вузла виробу:</span>
                  <span className="text-lg font-bold text-white font-mono">
                    {formatMoney(result.totalElectronicsCost, currency)}
                  </span>
                  <span className="text-xs text-purple-300 font-mono">
                    (${ (result.totalElectronicsCost / usdRate).toFixed(2)} USD)
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    Матеріали: <strong className="text-slate-200">{formatMoney(result.totalElectronicsMaterialsCost, currency)}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Робота пайщика: <strong className="text-emerald-300">{formatMoney(result.soldererLaborCost, currency)}</strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 px-3.5 py-2 rounded-xl border border-amber-500/30">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Всі витрати автоматично додаються до матеріалів та фонду оплати праці виробу
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </NeoTactileCard>
  );
};
