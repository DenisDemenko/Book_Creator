import * as XLSX from 'xlsx';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { WOOD_SPECIES_LIST } from '../data/woodPresets';
import { calculateProductionSchedule } from './timelineCalculator';

export interface ExcelExportOptions {
  productName?: string;
  category?: string;
  dimensions?: string;
  notes?: string;
  rates?: CurrencyRates;
}

export function exportCalculationToExcel(
  input: CalculationInput,
  result: CalculationResult,
  currency: Currency = 'UAH',
  options?: ExcelExportOptions
): void {
  const wood = WOOD_SPECIES_LIST.find((w) => w.id === input.woodSpeciesId) || WOOD_SPECIES_LIST[0];
  const productName = options?.productName || 'Виріб з дерева та епоксидної смоли';
  const category = options?.category || 'Меблі / Вироби';
  const dimensions = options?.dimensions || `${input.woodLengthMm} × ${input.woodWidthMm} × ${input.woodThicknessMm} мм`;
  const dateStr = new Date().toLocaleDateString('uk-UA');
  const rates = options?.rates || { USD: 41.5, EUR: 45.2 };

  const currSymbol = currency === 'UAH' ? '₴' : currency === 'USD' ? '$' : '€';
  const schedule = calculateProductionSchedule(input);

  // --------------------------------------------------------------------------
  // SHEET 1: КАЛЬКУЛЯЦІЯ СОБІВАРТОСТІ
  // --------------------------------------------------------------------------
  const sheet1Data: (string | number | null)[][] = [
    ['ТЕХНОЛОГІЧНА КАЛЬКУЛЯЦІЯ СОБІВАРТОСТІ ВИРОБУ', null, null, null, null],
    ['Neo-Tactile Wood & Epoxy Pricing Engine v2.4', null, null, null, null],
    [],
    ['Загальні відомості про виріб:', null, null, null, null],
    ['Найменування виробу:', productName, null, 'Дата розрахунку:', dateStr],
    ['Категорія:', category, null, 'Валюта розрахунку:', currency],
    ['Габаритні розміри:', dimensions, null, 'Порода деревини:', wood.name],
    ['Коефіцієнт відходів:', `${input.woodWastePercent}%`, null, 'Фактичний об’єм дерева:', `${result.actualWoodM3.toFixed(4)} м³`],
    ['Курси валют:', `1 USD = ${rates.USD} ₴ | 1 EUR = ${rates.EUR} ₴`, null, 'Ціна смоли (імпорт):', input.epoxyPriceCurrency === 'USD' ? `$${input.epoxyPriceInCurrency || (input.epoxyPricePerLiter / rates.USD).toFixed(2)}/л` : `${input.epoxyPricePerLiter} ₴/л`],
    [],
    ['№', 'Стаття витрат / Технологічна операція', 'Кількість / Од.', 'Тариф за 1 од.', `Сума (${currSymbol})`],

    // 1. Деревина
    ['1', 'ДЕРЕВИНА ТА КАМЕРНЕ СУШІННЯ', null, null, null],
    ['1.1', `Масив дерева (${wood.name}) з урахуванням обрізки`, `${result.actualWoodM3.toFixed(4)} м³`, input.woodPricePerM3, Math.round(result.woodCostNet)],
    ['1.2', 'Камерне конвекційне сушіння до 8-10% вологості', `${result.actualWoodM3.toFixed(4)} м³`, input.woodDryingCostPerM3, Math.round(result.woodDryingCost)],
    ['1.3', 'Доставка сировини (слябів) у цех майстерні', '1 рейс', input.rawMaterialDeliveryCost, input.rawMaterialDeliveryCost],
    ['', 'РАЗОМ ПО ДЕРЕВИНІ:', null, null, Math.round(result.totalWoodCost)],

    // 2. Епоксидна смола
    ['2', 'ЕПОКСИДНА СМОЛА ТА ЗАЛИВКА', null, null, null],
    ['2.1', 'Епоксидна смола оптична прозора (комп. А+В)', `${result.calculatedEpoxyLiters.toFixed(2)} л`, input.epoxyPricePerLiter, Math.round(result.epoxyMaterialCost)],
    ['2.2', 'Барвники, перламутри, пігменти', '1 комплект', input.pigmentCost, input.pigmentCost],
    ['2.3', 'Опалубка, скотч, силіконовий герметик, віск', '1 виріб', input.formworkAndMouldCost, input.formworkAndMouldCost],
    ['', 'РАЗОМ ПО ЕПОКСИДНІЙ ГРУПІ:', null, null, Math.round(result.totalEpoxyGroupCost)],

    // 3. Фініш та шліфовка
    ['3', 'ФІНІШНЕ ПОКРИТТЯ ТА ШЛІФУВАННЯ', null, null, null],
    ['3.1', input.finishType === 'oil_wax' ? 'Масло-віск OSMO/Borma для стільниць' : input.finishType === 'polyurethane_varnish' ? 'Поліуретановий зносостійкий лак' : 'Керамічний фінішний шар', `${(input.finishAmountMl / 1000).toFixed(3)} л`, input.finishCostPerLiter, Math.round(result.finishCost)],
    ['3.2', 'Абразиви P80-P3000, круги, полірувальні пасти 3M/Menzerna', '1 комплект', input.abrasivesAndSandingCost, input.abrasivesAndSandingCost],
    ['', 'РАЗОМ ПО ФІНІШУ:', null, null, Math.round(result.totalFinishingGroupCost)],

    // 4. ЧПУ обробка
    ['4', 'ЧПУ ФРЕЗЕРУВАННЯ ТА КАЛІБРУВАННЯ', null, null, null],
    ['4.1', 'Робота верстата ЧПУ (вирівнювання площини, пази)', `${input.cncHours} год`, `${input.cncMachineRatePerHour} ${currSymbol}/год`, Math.round(result.cncMachineCost)],
    ['4.2', 'Робота оператора ЧПУ (G-код, позиціонування)', `${input.cncHours} год`, `${input.cncOperatorRatePerHour} ${currSymbol}/год`, Math.round(result.cncOperatorCost)],
    ...(input.includeRouterBitCost !== false ? [
      ['4.3', `Амортизація фрези ЧПУ (${input.routerBitType || 'Сляб-планер/спіральна'}, вартість ${input.routerBitCost ?? 2200} грн, ресурс ${input.routerBitLifespanProducts ?? 10} вир.)`, '1 виріб', `${Math.round(result.routerBitDepreciationPerProduct)} ${currSymbol}`, Math.round(result.routerBitDepreciationPerProduct)],
    ] : []),
    ['', 'РАЗОМ ПО ЧПУ ОБРОБЦІ:', null, null, Math.round(result.totalCncCost)],

    // 5. Оплата праці
    ['5', 'ОПЛАТА ПРАЦІ (ФОНД ЗАРПЛАТИ НА ВИРІБ)', null, null, null],
    ['5.1', 'Майстер-столяр (підготовка, склейка, шліфовка)', '1 виріб', input.carpenterLaborCost, input.carpenterLaborCost],
    ['5.2', 'Збірник продукції (монтаж, фурнітура, фінішна збірка)', '1 виріб', input.assemblerLaborCost, input.assemblerLaborCost],
    ['5.3', 'Дизайнер / 3D візуалізатор (розкладка, узгодження)', '1 проєкт', input.designerLaborCost, input.designerLaborCost],
    ['5.4', 'Менеджер з продажу (комунікація, супровід клієнта)', '1 замовлення', input.salesManagerLaborCost, input.salesManagerLaborCost],
    ['5.5', 'Директор / Адміністратор (ВТК, операційне керівництво)', '1 замовлення', input.directorOverheadCost, input.directorOverheadCost],
    ['', 'РАЗОМ ПО ОПЛАТІ ПРАЦІ:', null, null, Math.round(result.totalLaborCost)],

    // 6. Підстілля та фурнітура
    ['6', 'ПІДСТІЛЛЯ, КАРКАС ТА ФУРНІТУРА', null, null, null],
    ['6.1', 'Металеве підстілля / опори / каркас', '1 комплект', input.metalBaseCost, input.metalBaseCost],
    ['6.2', 'Порошкове фарбування металу в термокамері', '1 комплект', input.powderCoatingCost, input.powderCoatingCost],
    ['6.3', 'Кріплення: C-канали, різьбові муфти Rampa, гвинти', '1 комплект', input.hardwareCost, input.hardwareCost],
    ['', 'РАЗОМ ПО ПІДСТІЛЛЮ ТА ФУРНІТУРІ:', null, null, Math.round(result.metalBaseGroupCost)],

    // 7. Упаковка та логістика
    ['7', 'УПАКОВКА ТА ЛОГІСТИКА', null, null, null],
    ['7.1', 'Захисна упаковка (спінений ПЕ, кутики, дерев’яний ящик)', '1 виріб', input.packagingCost, input.packagingCost],
    ['7.2', 'Доставка готового виробу клієнту (вантажне авто / Нова Пошта)', '1 доставка', input.finalDeliveryCost, input.finalDeliveryCost],
    ['', 'РАЗОМ ПО ЛОГІСТИЦІ:', null, null, Math.round(result.packagingCost + result.finalDeliveryCost)],

    // 8. Накладні витрати
    ['8', 'НАКЛАДНІ ВИТРАТИ ТА АМОРТИЗАЦІЯ', null, null, null],
    ['8.1', `Амортизація верстатів та електроінструменту (${input.equipmentDepreciationPercent}%)`, 'частка', null, Math.round(result.depreciationCost)],
    ['8.2', 'Комунальні витрати цеху (електроенергія, аспірація, тепло)', 'частка', input.utilitiesShareCost, input.utilitiesShareCost],
    ['8.3', 'Частка орендної плати виробничого приміщення', 'частка', input.workshopRentShareCost, input.workshopRentShareCost],
    ['', 'РАЗОМ ПО НАКЛАДНИХ ВИТРАТАХ:', null, null, Math.round(result.totalOverheadCost)],

    // 9. AI-медіа та цифровий маркетинг
    ['9', 'AI-КОНТЕНТ ТА МАРКЕТИНГ ТОВАРУ (GPT & RUNWAY)', null, null, null],
    ['9.1', `Генерація фото товару (GPT: $${input.gptPhotoMonthlyCostUsd ?? 25}/міс, ${input.gptPhotosPerProduct ?? 20} фото/товар)`, '1 пакет (20 фото)', null, Math.round(result.gptPhotoCostUah)],
    ['9.2', `Генерація промо-відео (Runway: $${input.runwayVideoMonthlyCostUsd ?? 76}/міс, ліміт ${input.runwayVideoMonthlyVideosCount ?? 25} відео/міс)`, `${input.runwayVideosPerProduct ?? 1} відео`, null, Math.round(result.runwayVideoCostUah)],
    ['', 'РАЗОМ ПО AI-КОНТЕНТУ:', null, null, Math.round(result.totalAiMediaCostUah)],

    ...(input.includeElectronics ? [
      // 10. Електроніка та LED підсвітка
      ['10', 'ЕЛЕКТРОНІКА, LED ПІДСВІТКА ТА СМАРТ КЕРУВАННЯ', null, null, null],
      ['10.1', `Блок живлення (${input.powerSupplyType || 'Mean Well 24V'}, ${input.powerSupplyWatts ?? 100}W)`, `${input.powerSupplyCount ?? 1} шт`, input.powerSupplyCost, Math.round(result.powerSupplyTotalCost)],
      ['10.2', `LED стрічка (${input.ledStripType || 'COB 24V'})`, `${input.ledStripLengthMeters ?? 2.5} м`, input.ledStripPricePerMeter, Math.round(result.ledStripTotalCost)],
      ['10.3', 'Алюмінієвий профіль з розсіювачем (опал)', `${input.ledProfileLengthMeters ?? 2.5} м`, input.ledProfilePricePerMeter, Math.round(result.ledProfileTotalCost)],
      ['10.4', `Плата мікропроцесора (${input.microcontrollerType || 'ESP32 Wi-Fi'})`, '1 шт', input.microcontrollerCost, Math.round(result.microcontrollerTotalCost)],
      ['10.5', 'Дроти, роз’єми IP68, конектори живлення', '1 компл.', input.electronicAccessoriesCost, Math.round(result.electronicAccessoriesTotalCost)],
      ['10.6', `Робота пайщика (пайка контактів, гідроізоляція, тест)`, input.soldererLaborMode === 'fixed' ? 'фікс' : `${input.soldererLaborHours ?? 2} год`, input.soldererHourlyRate, Math.round(result.soldererLaborCost)],
      ['10.7', 'Розхідники пайки (припій ПОС-61, флюс, клейова термозбіжка, компаунд)', '1 компл.', input.solderingConsumablesCost, Math.round(result.solderingConsumablesTotalCost)],
      ['', 'РАЗОМ ПО ЕЛЕКТРОНІЦІ ТА ПАЙЦІ:', null, null, Math.round(result.totalElectronicsCost)],
    ] : []),

    [],
    ['ФІНАНСОВИЙ ПІДСУМОК ТА ФОРМУВАННЯ ЦІНИ', null, null, null, null],
    ['Прямі матеріальні витрати (всі матеріали):', null, null, null, Math.round(result.materialsCostTotal)],
    ['Загальний фонд заробітної плати (ФОП):', null, null, null, Math.round(result.laborCostTotal)],
    ['Виробнича собівартість (Матеріали + Праця + ЧПУ):', null, null, null, Math.round(result.productionCost)],
    ['ПОВНА СОБІВАРТІСТЬ ВИРОБУ (Всі витрати):', null, null, null, Math.round(result.fullCostPrice)],
    [`Чистий прибуток підприємства (націнка ${input.profitMarginPercent}%):`, null, null, null, Math.round(result.netProfit)],
    [`Податки (${input.taxRatePercent}%):`, null, null, null, Math.round(result.taxAmount)],
    ['РЕКОМЕНДОВАНА ЦІНА ДЛЯ КЛІЄНТА:', null, null, null, Math.round(result.totalSellingPrice)],
    ['Фактична маржинальність виробу:', null, null, null, `${result.profitMarginPercentActual.toFixed(1)}%`],
    [],
    ['ГРАФІК ТА ЕТАПИ ВИРОБНИЦТВА (SCHEDULE)', null, null, null, null],
    ['Дата старту проєкту:', schedule.startDateFormatted, null, null, null],
    ['Розрахункова дата завершення:', schedule.completionDate, `(${schedule.completionDayOfWeek})`, null, null],
    ['Загальний виробничий термін:', `${schedule.totalDays} ${schedule.isWorkingDaysMode ? 'робочих днів' : 'календарних днів'}`, null, null, null],
    ...schedule.stages.map((s) => [
      `Етап: ${s.shortName}`,
      `${s.days} дн.`,
      `${s.startDateFull} – ${s.endDateFull}`,
      s.description,
      null,
    ]),
  ];

  // --------------------------------------------------------------------------
  // SHEET 2: СПЕЦИФІКАЦІЯ МАТЕРІАЛІВ (BOM - BILL OF MATERIALS)
  // --------------------------------------------------------------------------
  const sheet2Data: (string | number | null)[][] = [
    ['СПЕЦИФІКАЦІЯ МАТЕРІАЛІВ ТА КОМПЛЕКТУЮЧИХ (BOM)', null, null, null, null, null, null],
    ['Проєкт:', productName, null, 'Категорія:', category, 'Дата:', dateStr],
    [],
    ['№', 'Найменування матеріалу / ресурсу', 'Категорія', 'Кількість', 'Одиниця', `Ціна за 1 од. (${currSymbol})`, `Всього (${currSymbol})`],
    ['1', `Масив: ${wood.name}`, 'Деревина', Number(result.actualWoodM3.toFixed(4)), 'м³', input.woodPricePerM3, Math.round(result.woodCostNet)],
    ['2', 'Камерне конвекційне сушіння', 'Послуги', Number(result.actualWoodM3.toFixed(4)), 'м³', input.woodDryingCostPerM3, Math.round(result.woodDryingCost)],
    ['3', 'Доставка сировини в цех', 'Логістика', 1, 'рейс', input.rawMaterialDeliveryCost, input.rawMaterialDeliveryCost],
    ['4', 'Епоксидна смола ювелірна (комп. А+В)', 'Смола', Number(result.calculatedEpoxyLiters.toFixed(2)), 'л', input.epoxyPricePerLiter, Math.round(result.epoxyMaterialCost)],
    ['5', 'Кольоровий пігмент / перламутр', 'Смола', 1, 'компл.', input.pigmentCost, input.pigmentCost],
    ['6', 'Матеріали для опалубки та герметизації', 'Розхідники', 1, 'компл.', input.formworkAndMouldCost, input.formworkAndMouldCost],
    ['7', 'Фінішне захисне покриття (масло-віск / лак)', 'Фініш', Number((input.finishAmountMl / 1000).toFixed(3)), 'л', input.finishCostPerLiter, Math.round(result.finishCost)],
    ['8', 'Шліфувальні та полірувальні круги / пасти', 'Розхідники', 1, 'компл.', input.abrasivesAndSandingCost, input.abrasivesAndSandingCost],
    ['9', 'Машинний час ЧПУ верстата', 'Обладнання', input.cncHours, 'год', input.cncMachineRatePerHour, Math.round(result.cncMachineCost)],
    ...(input.includeRouterBitCost !== false ? [
      ['9.1', `Амортизація фрези ЧПУ: ${input.routerBitType || 'Сляб-планер'} (ресурс: ${input.routerBitLifespanProducts ?? 10} вир.)`, 'Інструмент', 1, 'виріб', Math.round(result.routerBitDepreciationPerProduct), Math.round(result.routerBitDepreciationPerProduct)],
    ] : []),
    ['10', 'Металевий каркас / підстілля', 'Фурнітура', 1, 'шт.', input.metalBaseCost, input.metalBaseCost],
    ['11', 'Порошкове фарбування в камері', 'Покриття', 1, 'компл.', input.powderCoatingCost, input.powderCoatingCost],
    ['12', 'Кріплення: C-планки, муфти Rampa, гвинти', 'Фурнітура', 1, 'компл.', input.hardwareCost, input.hardwareCost],
    ['13', 'Захисне пакування для транспортування', 'Упаковка', 1, 'компл.', input.packagingCost, input.packagingCost],
    ['14', 'Доставка готової продукції замовнику', 'Логістика', 1, 'поїздка', input.finalDeliveryCost, input.finalDeliveryCost],
    ...(input.includeElectronics ? [
      ['15', `Блок живлення: ${input.powerSupplyType || 'Mean Well 24V'}`, 'Електроніка', input.powerSupplyCount ?? 1, 'шт.', input.powerSupplyCost ?? 1150, Math.round(result.powerSupplyTotalCost)],
      ['16', `LED стрічка: ${input.ledStripType || 'COB 24V'}`, 'Електроніка', input.ledStripLengthMeters ?? 2.5, 'м', input.ledStripPricePerMeter ?? 380, Math.round(result.ledStripTotalCost)],
      ['17', 'Алюмінієвий врізний профіль з розсіювачем', 'Електроніка', input.ledProfileLengthMeters ?? 2.5, 'м', input.ledProfilePricePerMeter ?? 160, Math.round(result.ledProfileTotalCost)],
      ['18', `Плата управління: ${input.microcontrollerType || 'ESP32 Wi-Fi'}`, 'Електроніка', 1, 'шт.', input.microcontrollerCost ?? 650, Math.round(result.microcontrollerTotalCost)],
      ['19', 'Конектори, роз’єми IP68, кабелі', 'Електроніка', 1, 'компл.', input.electronicAccessoriesCost ?? 250, Math.round(result.electronicAccessoriesTotalCost)],
      ['20', 'Розхідники пайки (припій ПОС-61, флюс, термозбіжка, компаунд)', 'Розхідники', 1, 'компл.', input.solderingConsumablesCost ?? 180, Math.round(result.solderingConsumablesTotalCost)],
    ] : []),
    [],
    ['', 'ЗАГАЛЬНА МАТЕРІАЛЬНА СОБІВАРТІСТЬ:', null, null, null, null, Math.round(result.materialsCostTotal)],
  ];

  // --------------------------------------------------------------------------
  // SHEET 3: КОМЕРЦІЙНА ПРОПОЗИЦІЯ ДЛЯ ЗАМОВНИКА (КП)
  // --------------------------------------------------------------------------
  const sheet3Data: (string | number | null)[][] = [
    ['КОМЕРЦІЙНА ПРОПОЗИЦІЯ (COMMERCIAL OFFER)', null, null, null],
    ['Майстерня авторських меблів та декору з дерева та епоксидної смоли', null, null, null],
    [],
    ['Параметр', 'Опис та характеристики', null, null],
    ['Виріб:', productName, null, null],
    ['Категорія:', category, null, null],
    ['Габаритні розміри:', dimensions, null, null],
    ['Матеріал масиву:', wood.name, null, null],
    ['Особливості деревини:', wood.description, null, null],
    ['Заливка:', input.useGeometricEpoxyCalc ? `Прозора/тонована річка глибиною ${input.riverDepthMm} мм` : 'Дизайнерська епоксидна заливка', null, null],
    ['Фінішне покриття:', input.finishType === 'oil_wax' ? 'Шовковисто-матове екологічне масло-віск (Німеччина)' : 'Поліуретановий захисний лак', null, null],
    ['Підстілля / фурнітура:', input.metalBaseCost > 0 ? 'Металокаркас з порошковим полімерним фарбуванням' : 'Авторська дерев’яна або інтегрована основа', null, null],
    ...(input.includeElectronics ? [
      ['Електроніка та LED підсвітка:', `Вбудована підсвітка (${input.ledStripType || 'COB 24V'}), БЖ ${input.powerSupplyWatts ?? 100}W, мікроконтролер ${input.microcontrollerType || 'ESP32'} з Wi-Fi керуванням`, null, null],
    ] : []),
    ['Комплектація:', 'Готовий виріб, захисна упаковка, комплект кріплення, інструкція з догляду', null, null],
    ['Термін виготовлення:', `${schedule.totalDays} ${schedule.isWorkingDaysMode ? 'робочих днів' : 'календарних днів'} (орієнтовна готовність до ${schedule.completionDate})`, null, null],
    ['Графік ключових етапів:', `Сушка ${input.dryingStageDays ?? 5}д | Столярні ${input.carpentryStageDays ?? 4}д | Смола ${input.epoxyCureStageDays ?? 6}д | ЧПУ ${input.cncStageDays ?? 2}д | Фініш ${input.finishingStageDays ?? 3}д`, null, null],
    ['Гарантійні зобов’язання:', '24 місяці офіційної гарантії на геометрію масиву та зчеплення смоли', null, null],
    [],
    ['ФІНАНСОВІ УМОВИ:', null, null, null],
    ['Загальна вартість виробу:', `${Math.round(result.totalSellingPrice).toLocaleString('uk-UA')} ${currSymbol}`, null, null],
    ['Передоплата (70%):', `${Math.round(result.totalSellingPrice * 0.7).toLocaleString('uk-UA')} ${currSymbol}`, null, null],
    ['Остаточний розрахунок (30%):', `${Math.round(result.totalSellingPrice * 0.3).toLocaleString('uk-UA')} ${currSymbol}`, '(після фото/відео звіту перед відправкою)', null],
  ];

  // Create workbook and worksheets
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);

  // Set column widths for readability
  ws1['!cols'] = [
    { wch: 8 },  // №
    { wch: 48 }, // Стаття витрат
    { wch: 22 }, // Кількість / Од
    { wch: 20 }, // Тариф
    { wch: 20 }, // Сума
  ];

  ws2['!cols'] = [
    { wch: 6 },  // №
    { wch: 45 }, // Назва
    { wch: 16 }, // Категорія
    { wch: 14 }, // Кількість
    { wch: 12 }, // Од
    { wch: 20 }, // Ціна
    { wch: 20 }, // Всього
  ];

  ws3['!cols'] = [
    { wch: 26 }, // Параметр
    { wch: 60 }, // Опис
    { wch: 25 },
    { wch: 20 },
  ];

  // Append sheets
  XLSX.utils.book_append_sheet(wb, ws1, 'Калькуляція собівартості');
  XLSX.utils.book_append_sheet(wb, ws2, 'Специфікація BOM');
  XLSX.utils.book_append_sheet(wb, ws3, 'Комерційна пропозиція');

  // Sanitize filename
  const safeName = productName
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  const fileName = `Kalkulyatsiya_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  // Write and trigger download
  try {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 150);
  } catch (err) {
    console.error('Failed to export Excel file via blob, falling back to XLSX.writeFile:', err);
    XLSX.writeFile(wb, fileName);
  }
}
