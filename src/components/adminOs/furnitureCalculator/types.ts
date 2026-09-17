export type Currency = 'UAH' | 'USD' | 'EUR';

export interface CurrencyRates {
  USD: number; // e.g. 41.50
  EUR: number; // e.g. 45.20
  lastUpdated?: string;
  source?: string;
  autoSyncImported?: boolean; // whether to automatically scale imported prices when rates change
}

export interface WoodSpecies {
  id: string;
  name: string;
  pricePerM3: number; // in UAH
  dryingCostPerM3: number; // in UAH
  wasteFactorPercent: number; // typical waste %
  densityKgM3: number;
  description: string;
}

export interface CalculationInput {
  // 1. Деревина (Wood)
  woodSpeciesId: string;
  woodLengthMm: number;
  woodWidthMm: number;
  woodThicknessMm: number;
  woodVolumeM3Manual: number; // if manual override
  useManualWoodVolume: boolean;
  woodPricePerM3: number;
  woodDryingCostPerM3: number;
  rawMaterialDeliveryCost: number;
  woodWastePercent: number; // % на обрізку / брак

  // 2. Епоксидна смола (Epoxy)
  epoxyPricePerLiter: number;
  epoxyPriceCurrency?: Currency;
  epoxyPriceInCurrency?: number;
  epoxyLiters: number;
  useGeometricEpoxyCalc: boolean;
  riverLengthMm: number;
  riverAvgWidthMm: number;
  riverDepthMm: number;
  epoxyWastePercent: number; // % запасу на змішування/залишки у відрі
  pigmentCost: number; // барвники/пасти/пігменти на виріб
  formworkAndMouldCost: number; // опалубка (ДСП/поліпропілен, силікон, термоскотч, розділювальний віск)

  // 3. Фінішне покриття та абразиви (Finish & Polishing)
  finishType: 'oil_wax' | 'polyurethane_varnish' | 'ceramic';
  finishCostPerLiter: number;
  finishCostCurrency?: Currency;
  finishCostInCurrency?: number;
  finishAmountMl: number;
  abrasivesAndSandingCost: number; // шліфкруги P80-P3000, полірувальні пасти

  // 4. ЧПУ обробка (CNC)
  cncHours: number;
  cncMachineRatePerHour: number;
  cncMachineCurrency?: Currency;
  cncMachineRateInCurrency?: number;
  cncOperatorRatePerHour: number;
  // Вартість та амортизація фрез
  includeRouterBitCost?: boolean; // чи враховувати амортизацію фрези (default true)
  routerBitCost?: number; // вартість однієї фрези (від 1500 до 3000 грн)
  routerBitLifespanProducts?: number; // ресурс фрези в кількості виробів (від 1 до 50 виробів)
  routerBitType?: string; // тип фрези (напр. "Сляб-планер зі змінними ножами", "Спіральна компресійна фреза")

  // 5. Робота та заробітна плата (Labor)
  laborCalculationMode?: 'hourly' | 'fixed';
  carpenterHours?: number;
  carpenterHourlyRate?: number;
  assemblerHours?: number;
  assemblerHourlyRate?: number;
  carpenterLaborCost: number; // робота столяра
  assemblerLaborCost: number; // збірник продукції
  designerLaborCost: number; // дизайнер / 3D візуалізація
  salesManagerLaborCost: number; // менеджер з продажу (% або фікс)
  directorOverheadCost: number; // директор / керуючий

  // 6. Фурнітура, підстілля та конструктив (Hardware & Base)
  metalBaseCost: number; // підстілля / ніжки
  powderCoatingCost: number; // порошкове фарбування підстілля
  hardwareCost: number; // фурнітура (муфти Rampa, гвинти, C-channel)

  // 7. Упаковка та логістика (Packaging & Delivery)
  packagingCost: number; // пухирчаста плівка, картон, кутники, жорстка обрешітка
  finalDeliveryCost: number; // доставка готової продукції клієнту / підйом

  // 8. Виробничі накладні, амортизація, комунальні (Overhead & Operations)
  equipmentDepreciationPercent: number; // % амортизації верстатів/інструменту від витрат
  utilitiesShareCost: number; // комунальні цеху (електрика, опалення, вентиляція) на виріб
  workshopRentShareCost: number; // частка оренди цеху на виріб

  // 9. Фінанси, податки та маржа (Taxes & Profit)
  taxRatePercent: number; // податок на прибуток або ФОП (наприклад 5% єдиний податок або 18% податок на прибуток)
  taxMode: 'single_turnover_5' | 'profit_tax_18' | 'custom';
  profitMarginPercent: number; // бажана рентабельність/маржа прибутку %

  // 10. Терміни виробництва та етапи робіт (Production Timeline & Stages)
  projectStartDate?: string; // YYYY-MM-DD
  workDaysMode?: 'calendar' | 'working_days'; // 'calendar' or 'working_days'
  dryingStageDays?: number; // Сушка та стабілізація деревини (днів)
  carpentryStageDays?: number; // Робота столяра (калібрування, фугування, опалубка) (днів)
  epoxyCureStageDays?: number; // Заливка смоли та полімеризація (днів)
  cncStageDays?: number; // ЧПУ обробка, фрезерування, сляб-планінг (днів)
  finishingStageDays?: number; // Шліфування, полірування та сушка масла/лаку (днів)
  assemblyStageDays?: number; // Монтаж фурнітури/підстілля, ВТК та упаковка (днів)
  bufferDays?: number; // Технологічний запас/буфер на ризики (днів)

  // 11. Підписка на генерацію фото (GPT) та відео (Runway) для контенту товарів
  includeAiMediaCost?: boolean; // чи враховувати AI контент у повній собівартості (default true)
  gptPhotoMonthlyCostUsd?: number; // вартість підписки GPT на місяць ($25)
  gptPhotoMonthlyProductsCount?: number; // кількість товарів з підписки (25 товарів)
  gptPhotosPerProduct?: number; // кількість фото на 1 товар (20 фото)
  runwayVideoMonthlyCostUsd?: number; // вартість підписки Runway на місяць ($76)
  runwayVideoMonthlyVideosCount?: number; // загальна к-ть відео з підписки на місяць (ручне введення, за замовчуванням 25)
  runwayVideosPerProduct?: number; // к-ть згенерованих відео на цей товар (за замовчуванням 1)

  // 12. Електроніка, LED підсвітка та мікропроцесорне керування
  includeElectronics?: boolean; // чи встановлюється LED підсвітка та електроніка
  // Блок живлення
  powerSupplyCost?: number; // вартість блоку живлення (₴)
  powerSupplyType?: string; // тип БЖ (напр. "Mean Well 24V 100W IP67", "Тонкий Slim 12V 60W")
  powerSupplyWatts?: number; // потужність (Вт)
  powerSupplyCount?: number; // к-ть блоків живлення (шт)
  // LED підсвітка та алюмінієвий профіль
  ledStripLengthMeters?: number; // довжина стрічки (м)
  ledStripPricePerMeter?: number; // ціна за 1 м стрічки (₴/м)
  ledStripType?: string; // тип стрічки (напр. "COB 24V безкрапкова 4000K", "ARGB WS2812B", "RGB+W 5050")
  ledProfileLengthMeters?: number; // довжина профілю (м)
  ledProfilePricePerMeter?: number; // ціна за 1 м профілю з розсіювачем (₴/м)
  // Плата мікропроцесора для управління
  microcontrollerCost?: number; // вартість плати контролера (₴)
  microcontrollerType?: string; // назва контролера (ESP32 WLED, Tuya Smart, сенсорний диммер)
  electronicAccessoriesCost?: number; // дроти, конектори IP68, роз'єм живлення DC/Type-C (₴)
  // Робота пайщика для зборки та тестування електроніки
  soldererLaborMode?: 'hourly' | 'fixed'; // режим розрахунку роботи
  soldererLaborHours?: number; // тривалість пайки та монтажу (год)
  soldererHourlyRate?: number; // ставка пайщика (₴/год)
  soldererFixedCost?: number; // фіксована вартість послуги пайки (₴)
  solderingConsumablesCost?: number; // припій, термозбіжка з клеєм, флюс, компаунд для контактів (₴)
}

export interface ProductionStageItem {
  id: string;
  name: string;
  shortName: string;
  days: number;
  startDate: string; // e.g. "16.09"
  endDate: string; // e.g. "21.09"
  startDateFull: string; // e.g. "16.09.2026"
  endDateFull: string; // e.g. "21.09.2026"
  colorClass: string;
  bgClass: string;
  borderClass: string;
  iconName: 'wind' | 'hammer' | 'droplet' | 'cpu' | 'sparkles' | 'box' | 'shield';
  description: string;
}

export interface ProductionScheduleResult {
  startDate: string; // 'YYYY-MM-DD'
  startDateFormatted: string; // e.g. "16 вересня 2026"
  completionDate: string; // e.g. "06 жовтня 2026"
  completionDateShort: string; // e.g. "06.10.2026"
  completionDayOfWeek: string; // e.g. "Вівторок"
  totalDays: number;
  totalWorkingDays: number;
  isWorkingDaysMode: boolean;
  stages: ProductionStageItem[];
  daysRemaining: number;
}

export interface CalculationResult {
  // Розбивка витрат
  woodCostNet: number;
  woodDryingCost: number;
  woodDeliveryCost: number;
  totalWoodCost: number;
  actualWoodM3: number;

  epoxyMaterialCost: number;
  pigmentCost: number;
  formworkCost: number;
  totalEpoxyGroupCost: number;
  calculatedEpoxyLiters: number;

  finishCost: number;
  abrasivesCost: number;
  totalFinishingGroupCost: number;

  cncMachineCost: number;
  cncOperatorCost: number;
  routerBitDepreciationPerProduct: number; // частка вартості амортизації фрези на один даний виріб
  totalCncCost: number;

  carpenterLaborCost: number;
  assemblerLaborCost: number;
  designerLaborCost: number;
  salesManagerLaborCost: number;
  directorCost: number;
  totalLaborCost: number;

  metalBaseGroupCost: number;
  packagingCost: number;
  finalDeliveryCost: number;
  totalLogisticsAndBaseCost: number;

  depreciationCost: number;
  utilitiesCost: number;
  totalOverheadCost: number;

  // Витрати на генерацію AI контенту (GPT & Runway)
  gptPhotoCostUsd: number;
  gptPhotoCostUah: number;
  costPerAiPhotoUsd: number;
  runwayVideoCostUsd: number;
  runwayVideoCostUah: number;
  costPerAiVideoUsd: number;
  totalAiMediaCostUsd: number;
  totalAiMediaCostUah: number;

  // Витрати на електроніку та LED підсвітку
  powerSupplyTotalCost: number;
  ledStripTotalCost: number;
  ledProfileTotalCost: number;
  microcontrollerTotalCost: number;
  electronicAccessoriesTotalCost: number;
  solderingConsumablesTotalCost: number;
  totalElectronicsMaterialsCost: number; // матеріали електроніки
  soldererLaborCost: number; // оплата праці пайщика
  totalElectronicsCost: number; // сумарно електроніка + пайка

  // Підсумки
  materialsCostTotal: number; // Всі матеріали разом
  laborCostTotal: number; // Всі зарплати
  productionCost: number; // Виробнича собівартість
  fullCostPrice: number; // Повна собівартість (з логістикою, адмін, амортизацією)

  netProfit: number; // Чистий прибуток компанії
  taxAmount: number; // Сума податку
  totalSellingPrice: number; // Кінцева ціна для клієнта

  profitMarginPercentActual: number; // Фактична рентабельність
  materialsSharePercent: number;
  laborSharePercent: number;
  overheadSharePercent: number;
  profitSharePercent: number;
  taxSharePercent: number;
}

export interface ProductTemplate {
  id: string;
  name: string;
  category: string; // 'Столи', 'Органайзери', 'Шкатулки', 'Декор', 'Аксесуари' etc.
  dimensions?: string;
  description?: string;
  isCustom?: boolean; // true for user-saved templates
  createdAt?: string;
  updatedAt?: string;
  input: CalculationInput;
  estimatedPriceUah?: number;
}
