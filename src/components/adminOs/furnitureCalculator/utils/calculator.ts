import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';

export const DEFAULT_CURRENCY_RATES: CurrencyRates = {
  USD: 41.5,
  EUR: 45.2,
  lastUpdated: new Date().toLocaleDateString('uk-UA'),
  source: 'НБУ',
  autoSyncImported: true,
};

export const CURRENCY_RATES: Record<Currency, { symbol: string; rateToUah: number; label: string }> = {
  UAH: { symbol: '₴', rateToUah: 1, label: 'Гривня (UAH)' },
  USD: { symbol: '$', rateToUah: 41.5, label: 'Долар (USD)' },
  EUR: { symbol: '€', rateToUah: 45.2, label: 'Євро (EUR)' },
};

/**
 * Активний курс для форматування сум (formatMoney), коли викликач не передав
 * власний `customRates`. Це модульний стан, а не React-стан — свідомо: калькулятор
 * монтується в адмінпанелі рівно одним екземпляром на вкладку браузера (не
 * SSR, не кілька паралельних інстансів на сторінці), тож немає жодного
 * реального сценарію, де цей стан «протече» між користувачами чи вкладками.
 * Джерело правди для нього — сервер (`/api/admin/furniture-calc/rates`),
 * `FurnitureCalculatorPanel` синхронізує обидва при кожній зміні курсу.
 */
let currentRatesState: CurrencyRates = { ...DEFAULT_CURRENCY_RATES };

export function updateGlobalCurrencyRates(rates: Partial<CurrencyRates>) {
  currentRatesState = { ...currentRatesState, ...rates };
  if (rates.USD !== undefined && rates.USD > 0) {
    CURRENCY_RATES.USD.rateToUah = rates.USD;
  }
  if (rates.EUR !== undefined && rates.EUR > 0) {
    CURRENCY_RATES.EUR.rateToUah = rates.EUR;
  }
}

export function getGlobalCurrencyRates(): CurrencyRates {
  return currentRatesState;
}

export function formatMoney(
  amountUah: number,
  currency: Currency = 'UAH',
  decimals: number = 0,
  customRates?: CurrencyRates
): string {
  if (amountUah === undefined || amountUah === null || isNaN(amountUah)) {
    amountUah = 0;
  }
  let rateToUah = 1;
  let symbol = '₴';

  const rates = customRates || currentRatesState;

  if (currency === 'USD') {
    rateToUah = rates?.USD || CURRENCY_RATES.USD.rateToUah || 41.5;
    symbol = '$';
  } else if (currency === 'EUR') {
    rateToUah = rates?.EUR || CURRENCY_RATES.EUR.rateToUah || 45.2;
    symbol = '€';
  }

  const converted = amountUah / (rateToUah > 0 ? rateToUah : 1);
  const formatted = new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(converted);
  return `${formatted} ${symbol}`;
}

/**
 * Перераховує вартості імпортних матеріалів (смола, ЧПУ/обладнання, фінішні лаки/масла)
 * за актуальним курсом валют (USD / EUR до UAH).
 */
export function recalculateImportedMaterials(
  input: CalculationInput,
  newRates: CurrencyRates,
  oldRates?: CurrencyRates
): CalculationInput {
  const updated = { ...input };

  // 1. Смола (зазвичай деномінована в USD)
  if (updated.epoxyPriceCurrency === 'USD') {
    const baseForeign = updated.epoxyPriceInCurrency || (updated.epoxyPricePerLiter / (oldRates?.USD || newRates.USD));
    updated.epoxyPriceInCurrency = Number(baseForeign.toFixed(2));
    updated.epoxyPricePerLiter = Math.round(baseForeign * newRates.USD);
  } else if (updated.epoxyPriceCurrency === 'EUR') {
    const baseForeign = updated.epoxyPriceInCurrency || (updated.epoxyPricePerLiter / (oldRates?.EUR || newRates.EUR));
    updated.epoxyPriceInCurrency = Number(baseForeign.toFixed(2));
    updated.epoxyPricePerLiter = Math.round(baseForeign * newRates.EUR);
  } else if (oldRates && oldRates.USD > 0 && newRates.USD > 0 && oldRates.USD !== newRates.USD) {
    // Якщо явно не зазначено валюту, але користувач увімкнув автоперерахунок смоли як імпорту
    const scaleFactor = newRates.USD / oldRates.USD;
    updated.epoxyPricePerLiter = Math.round(updated.epoxyPricePerLiter * scaleFactor);
  }

  // 2. ЧПУ верстат та амортизація обладнання (шпинделі, імпортні фрези Freud/CMT в USD)
  if (updated.cncMachineCurrency === 'USD') {
    const baseForeign = updated.cncMachineRateInCurrency || (updated.cncMachineRatePerHour / (oldRates?.USD || newRates.USD));
    updated.cncMachineRateInCurrency = Number(baseForeign.toFixed(2));
    updated.cncMachineRatePerHour = Math.round(baseForeign * newRates.USD);
  } else if (updated.cncMachineCurrency === 'EUR') {
    const baseForeign = updated.cncMachineRateInCurrency || (updated.cncMachineRatePerHour / (oldRates?.EUR || newRates.EUR));
    updated.cncMachineRateInCurrency = Number(baseForeign.toFixed(2));
    updated.cncMachineRatePerHour = Math.round(baseForeign * newRates.EUR);
  } else if (oldRates && oldRates.USD > 0 && newRates.USD > 0 && oldRates.USD !== newRates.USD) {
    const scaleFactor = newRates.USD / oldRates.USD;
    updated.cncMachineRatePerHour = Math.round(updated.cncMachineRatePerHour * scaleFactor);
  }

  // 3. Фінішні покриття (Osmo, Rubio Monocoat, лаки в EUR або USD)
  if (updated.finishCostCurrency === 'EUR') {
    const baseForeign = updated.finishCostInCurrency || (updated.finishCostPerLiter / (oldRates?.EUR || newRates.EUR));
    updated.finishCostInCurrency = Number(baseForeign.toFixed(2));
    updated.finishCostPerLiter = Math.round(baseForeign * newRates.EUR);
  } else if (updated.finishCostCurrency === 'USD') {
    const baseForeign = updated.finishCostInCurrency || (updated.finishCostPerLiter / (oldRates?.USD || newRates.USD));
    updated.finishCostInCurrency = Number(baseForeign.toFixed(2));
    updated.finishCostPerLiter = Math.round(baseForeign * newRates.USD);
  }

  return updated;
}

export function calculateWoodAndEpoxyCost(rawInput: CalculationInput, customRates?: CurrencyRates): CalculationResult {
  const input: CalculationInput = {
    woodSpeciesId: 'oak',
    woodPricePerM3: 28000,
    woodDryingCostPerM3: 4500,
    woodWastePercent: 20,
    rawMaterialDeliveryCost: 600,
    useManualWoodVolume: false,
    woodVolumeM3Manual: 0.04,
    woodLengthMm: 1200,
    woodWidthMm: 600,
    woodThicknessMm: 40,
    useGeometricEpoxyCalc: true,
    riverLengthMm: 1200,
    riverAvgWidthMm: 150,
    riverDepthMm: 40,
    epoxyLiters: 7.2,
    epoxyWastePercent: 8,
    epoxyPricePerLiter: 750,
    pigmentCost: 250,
    formworkAndMouldCost: 400,
    finishType: 'oil_wax',
    finishAmountMl: 150,
    finishCostPerLiter: 1800,
    abrasivesAndSandingCost: 650,
    cncHours: 1.5,
    cncMachineRatePerHour: 800,
    cncOperatorRatePerHour: 350,
    includeRouterBitCost: true,
    routerBitCost: 2200,
    routerBitLifespanProducts: 10,
    routerBitType: 'Сляб-планер / спіральна фреза',
    carpenterLaborCost: 4000,
    assemblerLaborCost: 1000,
    designerLaborCost: 800,
    salesManagerLaborCost: 1200,
    directorOverheadCost: 1500,
    metalBaseCost: 3200,
    powderCoatingCost: 900,
    hardwareCost: 350,
    packagingCost: 450,
    finalDeliveryCost: 850,
    equipmentDepreciationPercent: 5,
    utilitiesShareCost: 750,
    workshopRentShareCost: 1200,
    taxMode: 'single_turnover_5',
    taxRatePercent: 5,
    profitMarginPercent: 35,
    includeAiMediaCost: true,
    gptPhotoMonthlyCostUsd: 25,
    gptPhotoMonthlyProductsCount: 25,
    gptPhotosPerProduct: 20,
    runwayVideoMonthlyCostUsd: 76,
    runwayVideoMonthlyVideosCount: 25,
    runwayVideosPerProduct: 1,
    includeElectronics: false,
    powerSupplyCost: 1150,
    powerSupplyWatts: 100,
    powerSupplyCount: 1,
    powerSupplyType: 'Mean Well 24V 100W LPV-100-24 (IP67)',
    ledStripLengthMeters: 2.5,
    ledStripPricePerMeter: 380,
    ledStripType: 'COB 24V Безкрапкова',
    ledProfileLengthMeters: 2.5,
    ledProfilePricePerMeter: 160,
    microcontrollerCost: 650,
    microcontrollerType: 'ESP32 Wi-Fi + BLE (WLED Smart Home)',
    electronicAccessoriesCost: 250,
    soldererLaborMode: 'hourly',
    soldererLaborHours: 2.0,
    soldererHourlyRate: 300,
    soldererFixedCost: 600,
    solderingConsumablesCost: 180,
    ...(rawInput || {}),
  };

  // 1. Деревина
  let baseWoodVolume = 0;
  if (input.useManualWoodVolume) {
    baseWoodVolume = input.woodVolumeM3Manual;
  } else {
    baseWoodVolume =
      (input.woodLengthMm / 1000) * (input.woodWidthMm / 1000) * (input.woodThicknessMm / 1000);
  }
  const actualWoodM3 = baseWoodVolume * (1 + (input.woodWastePercent || 0) / 100);
  const woodCostNet = actualWoodM3 * input.woodPricePerM3;
  const woodDryingCost = actualWoodM3 * input.woodDryingCostPerM3;
  const woodDeliveryCost = input.rawMaterialDeliveryCost;
  const totalWoodCost = woodCostNet + woodDryingCost + woodDeliveryCost;

  // 2. Епоксидна смола
  let baseEpoxyLiters = 0;
  if (input.useGeometricEpoxyCalc) {
    // Об'єм каналу в м3 = (L * W * H), потім * 1000 для літрів
    baseEpoxyLiters =
      (input.riverLengthMm / 1000) *
      (input.riverAvgWidthMm / 1000) *
      (input.riverDepthMm / 1000) *
      1000;
  } else {
    baseEpoxyLiters = input.epoxyLiters;
  }
  const calculatedEpoxyLiters = baseEpoxyLiters * (1 + (input.epoxyWastePercent || 0) / 100);
  const epoxyMaterialCost = calculatedEpoxyLiters * input.epoxyPricePerLiter;
  const pigmentCost = input.pigmentCost;
  const formworkCost = input.formworkAndMouldCost;
  const totalEpoxyGroupCost = epoxyMaterialCost + pigmentCost + formworkCost;

  // 3. Фініш та абразиви
  const finishCost = (input.finishAmountMl / 1000) * input.finishCostPerLiter;
  const abrasivesCost = input.abrasivesAndSandingCost;
  const totalFinishingGroupCost = finishCost + abrasivesCost;

  // 4. ЧПУ та фрези
  const cncMachineCost = input.cncHours * input.cncMachineRatePerHour;
  const cncOperatorCost = input.cncHours * input.cncOperatorRatePerHour;

  // Амортизація фрез (вартість однієї фрези від 1500 до 3000 грн, ресурс амортизації від 1 до 50 виробів)
  const routerBitCost = input.routerBitCost !== undefined ? input.routerBitCost : 2200;
  const routerBitLifespanProducts = Math.min(50, Math.max(1, input.routerBitLifespanProducts !== undefined ? input.routerBitLifespanProducts : 10));
  const includeRouterBit = input.includeRouterBitCost !== false;
  const routerBitDepreciationPerProduct = includeRouterBit ? (routerBitCost / routerBitLifespanProducts) : 0;

  const totalCncCost = cncMachineCost + cncOperatorCost + routerBitDepreciationPerProduct;

  // 5. Робота та персонал
  const carpenterLaborCost = input.carpenterLaborCost;
  const assemblerLaborCost = input.assemblerLaborCost;
  const designerLaborCost = input.designerLaborCost;
  const salesManagerLaborCost = input.salesManagerLaborCost;
  const directorCost = input.directorOverheadCost;
  const totalLaborCost =
    carpenterLaborCost + assemblerLaborCost + designerLaborCost + salesManagerLaborCost + directorCost;

  // 6. Метал, фурнітура, упаковка, доставка
  const metalBaseGroupCost = input.metalBaseCost + input.powderCoatingCost + input.hardwareCost;
  const packagingCost = input.packagingCost;
  const finalDeliveryCost = input.finalDeliveryCost;
  const totalLogisticsAndBaseCost = metalBaseGroupCost + packagingCost + finalDeliveryCost;

  // 7. Електроніка, LED підсвітка та мікропроцесорне керування
  const isElectronicsEnabled = Boolean(input.includeElectronics);
  const powerSupplyUnitCost = input.powerSupplyCost || 0;
  const powerSupplyCount = Math.max(1, input.powerSupplyCount || 1);
  const powerSupplyTotalCost = isElectronicsEnabled ? powerSupplyUnitCost * powerSupplyCount : 0;

  const ledStripLength = input.ledStripLengthMeters || 0;
  const ledStripPrice = input.ledStripPricePerMeter || 0;
  const ledStripTotalCost = isElectronicsEnabled ? ledStripLength * ledStripPrice : 0;

  const ledProfileLength = input.ledProfileLengthMeters || 0;
  const ledProfilePrice = input.ledProfilePricePerMeter || 0;
  const ledProfileTotalCost = isElectronicsEnabled ? ledProfileLength * ledProfilePrice : 0;

  const microcontrollerTotalCost = isElectronicsEnabled ? (input.microcontrollerCost || 0) : 0;
  const electronicAccessoriesTotalCost = isElectronicsEnabled ? (input.electronicAccessoriesCost || 0) : 0;
  const solderingConsumablesTotalCost = isElectronicsEnabled ? (input.solderingConsumablesCost || 0) : 0;

  const totalElectronicsMaterialsCost =
    powerSupplyTotalCost +
    ledStripTotalCost +
    ledProfileTotalCost +
    microcontrollerTotalCost +
    electronicAccessoriesTotalCost +
    solderingConsumablesTotalCost;

  // Робота пайщика для зборки електроніки
  let soldererLaborCost = 0;
  if (isElectronicsEnabled) {
    if (input.soldererLaborMode === 'fixed') {
      soldererLaborCost = input.soldererFixedCost || 0;
    } else {
      const hours = input.soldererLaborHours || 0;
      const rate = input.soldererHourlyRate || 0;
      soldererLaborCost = hours * rate;
    }
  }

  const totalElectronicsCost = totalElectronicsMaterialsCost + soldererLaborCost;

  // 8. Всі матеріали
  const materialsCostTotal =
    totalWoodCost +
    totalEpoxyGroupCost +
    totalFinishingGroupCost +
    metalBaseGroupCost +
    packagingCost +
    totalElectronicsMaterialsCost;

  // 9. Вся робота (включно з ЧПУ оператором, машиною та пайщиком)
  const allLaborPersonnelCost = totalLaborCost + soldererLaborCost;
  const laborCostTotal = allLaborPersonnelCost + totalCncCost;

  // 10. Амортизація та комунальні
  const directProductionBase = materialsCostTotal + laborCostTotal;
  const depreciationCost = directProductionBase * ((input.equipmentDepreciationPercent || 0) / 100);
  const utilitiesCost = (input.utilitiesShareCost || 0) + (input.workshopRentShareCost || 0);
  const totalOverheadCost = depreciationCost + utilitiesCost;

  // 10. AI-медіа підписки на контент (GPT фото $25/міс та Runway відео $76/міс)
  const usdRate = customRates?.USD || currentRatesState.USD || 41.5;

  // GPT: $25 на 25 товарів по 20 фото на товар
  const gptMonthlyCost = input.gptPhotoMonthlyCostUsd !== undefined ? input.gptPhotoMonthlyCostUsd : 25;
  const gptProducts = Math.max(1, input.gptPhotoMonthlyProductsCount !== undefined ? input.gptPhotoMonthlyProductsCount : 25);
  const gptPhotosPerProduct = Math.max(1, input.gptPhotosPerProduct !== undefined ? input.gptPhotosPerProduct : 20);

  const gptPhotoCostUsd = gptMonthlyCost / gptProducts; // $1.00 на 1 товар
  const costPerAiPhotoUsd = gptPhotoCostUsd / gptPhotosPerProduct; // $0.05 на 1 фото
  const gptPhotoCostUah = gptPhotoCostUsd * usdRate;

  // Runway: $76 на місяць. Кількість відео вводиться вручну (за замовчуванням 25 відео на місяць)
  const runwayMonthlyCost = input.runwayVideoMonthlyCostUsd !== undefined ? input.runwayVideoMonthlyCostUsd : 76;
  const runwayTotalVideos = Math.max(1, input.runwayVideoMonthlyVideosCount !== undefined ? input.runwayVideoMonthlyVideosCount : 25);
  const runwayVideosForProduct = Math.max(0, input.runwayVideosPerProduct !== undefined ? input.runwayVideosPerProduct : 1);

  const costPerAiVideoUsd = runwayMonthlyCost / runwayTotalVideos; // e.g. $76 / 25 = $3.04 на 1 відео
  const runwayVideoCostUsd = runwayVideosForProduct * costPerAiVideoUsd; // $3.04 на цей товар
  const runwayVideoCostUah = runwayVideoCostUsd * usdRate;

  const totalAiMediaCostUsd = gptPhotoCostUsd + runwayVideoCostUsd;
  const totalAiMediaCostUah = gptPhotoCostUah + runwayVideoCostUah;

  const includeAiCost = input.includeAiMediaCost !== false;
  const effectiveAiCostUah = includeAiCost ? totalAiMediaCostUah : 0;

  // 11. Собівартість
  const productionCost = materialsCostTotal + laborCostTotal + totalOverheadCost;
  const fullCostPrice = productionCost + finalDeliveryCost + effectiveAiCostUah;

  // 12. Маржа та Податки
  const profitMarginPercent = input.profitMarginPercent || 0;
  const taxRatePercent = input.taxRatePercent || 0;

  let totalSellingPrice = 0;
  let taxAmount = 0;
  let netProfit = 0;

  if (input.taxMode === 'single_turnover_5') {
    // Податок з обороту (наприклад 5% Єдиний податок)
    const baseWithProfit = fullCostPrice * (1 + profitMarginPercent / 100);
    const taxRateFraction = taxRatePercent / 100;
    if (taxRateFraction < 1) {
      totalSellingPrice = baseWithProfit / (1 - taxRateFraction);
      taxAmount = totalSellingPrice * taxRateFraction;
      netProfit = totalSellingPrice - fullCostPrice - taxAmount;
    } else {
      totalSellingPrice = baseWithProfit * 1.05;
      taxAmount = totalSellingPrice * 0.05;
      netProfit = totalSellingPrice - fullCostPrice - taxAmount;
    }
  } else {
    // Податок на прибуток (18% або кастомний від чистого прибутку)
    const rawProfit = fullCostPrice * (profitMarginPercent / 100);
    taxAmount = rawProfit * (taxRatePercent / 100);
    netProfit = rawProfit - taxAmount;
    totalSellingPrice = fullCostPrice + rawProfit;
  }

  // Частки у фінальній ціні для графіків та індикаторів
  const safeTotal = totalSellingPrice > 0 ? totalSellingPrice : 1;
  const materialsSharePercent = Math.round((materialsCostTotal / safeTotal) * 100);
  const laborSharePercent = Math.round((laborCostTotal / safeTotal) * 100);
  const overheadSharePercent = Math.round(((totalOverheadCost + finalDeliveryCost + effectiveAiCostUah) / safeTotal) * 100);
  const profitSharePercent = Math.round((netProfit / safeTotal) * 100);
  const taxSharePercent = Math.max(0, 100 - (materialsSharePercent + laborSharePercent + overheadSharePercent + profitSharePercent));

  const profitMarginPercentActual = fullCostPrice > 0 ? (netProfit / fullCostPrice) * 100 : 0;

  return {
    woodCostNet,
    woodDryingCost,
    woodDeliveryCost,
    totalWoodCost,
    actualWoodM3,

    epoxyMaterialCost,
    pigmentCost,
    formworkCost,
    totalEpoxyGroupCost,
    calculatedEpoxyLiters,

    finishCost,
    abrasivesCost,
    totalFinishingGroupCost,

    cncMachineCost,
    cncOperatorCost,
    routerBitDepreciationPerProduct,
    totalCncCost,

    carpenterLaborCost,
    assemblerLaborCost,
    designerLaborCost,
    salesManagerLaborCost,
    directorCost,
    totalLaborCost,

    metalBaseGroupCost,
    packagingCost,
    finalDeliveryCost,
    totalLogisticsAndBaseCost,

    depreciationCost,
    utilitiesCost,
    totalOverheadCost,

    // AI Media Metrics
    gptPhotoCostUsd,
    gptPhotoCostUah,
    costPerAiPhotoUsd,
    runwayVideoCostUsd,
    runwayVideoCostUah,
    costPerAiVideoUsd,
    totalAiMediaCostUsd,
    totalAiMediaCostUah,

    // Electronics & LED Metrics
    powerSupplyTotalCost,
    ledStripTotalCost,
    ledProfileTotalCost,
    microcontrollerTotalCost,
    electronicAccessoriesTotalCost,
    solderingConsumablesTotalCost,
    totalElectronicsMaterialsCost,
    soldererLaborCost,
    totalElectronicsCost,

    materialsCostTotal,
    laborCostTotal,
    productionCost,
    fullCostPrice,

    netProfit,
    taxAmount,
    totalSellingPrice,

    profitMarginPercentActual,
    materialsSharePercent,
    laborSharePercent,
    overheadSharePercent,
    profitSharePercent,
    taxSharePercent,
  };
}
