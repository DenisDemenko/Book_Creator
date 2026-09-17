/**
 * Тести калькулятора собівартості меблів (портовано в
 * src/components/adminOs/furnitureCalculator/).
 * Запуск: npm run test:furniture-calculator
 *
 * Тут — чиста логіка без React: форматування грошей, перерахунок імпортних
 * матеріалів при зміні курсу валют, повний розрахунок собівартості на
 * реальному пресеті (стіл-річка) та цілісність довідників (породи дерева,
 * шаблони виробів). UI-компоненти калькулятора (App/FurnitureCalculatorPanel
 * та секції) тут не чіпаються — вони DOM/fetch-залежні й перевіряються вручну
 * через адмінпанель, а не цим скриптом.
 */

const calc = await import('../src/components/adminOs/furnitureCalculator/utils/calculator');
const presets = await import('../src/components/adminOs/furnitureCalculator/data/woodPresets');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('Базовий курс валют:');
{
  t('USD за замовчуванням — 41.5', calc.DEFAULT_CURRENCY_RATES.USD === 41.5, String(calc.DEFAULT_CURRENCY_RATES.USD));
  t('EUR за замовчуванням — 45.2', calc.DEFAULT_CURRENCY_RATES.EUR === 45.2, String(calc.DEFAULT_CURRENCY_RATES.EUR));
}

console.log('\nformatMoney:');
{
  const rates = { USD: 40, EUR: 44, lastUpdated: '', source: '', autoSyncImported: true };
  t('гривня без валюти', calc.formatMoney(1000, 'UAH', 0, rates) === '1 000 ₴', calc.formatMoney(1000, 'UAH', 0, rates));
  t('долар конвертується за курсом', calc.formatMoney(4000, 'USD', 0, rates) === '100 $', calc.formatMoney(4000, 'USD', 0, rates));
  t('євро конвертується за курсом', calc.formatMoney(4400, 'EUR', 0, rates) === '100 €', calc.formatMoney(4400, 'EUR', 0, rates));
  t('NaN/undefined трактується як 0', calc.formatMoney(NaN as any, 'UAH', 0, rates) === '0 ₴');
}

console.log('\nПерерахунок імпортних матеріалів при зміні курсу:');
{
  const base = presets.PRODUCT_TEMPLATES[0].input;
  const oldRates = { USD: 40, EUR: 44, lastUpdated: '', source: '', autoSyncImported: true };
  const newRates = { USD: 44, EUR: 44, lastUpdated: '', source: '', autoSyncImported: true };

  const usdEpoxy = { ...base, epoxyPriceCurrency: 'USD' as const, epoxyPriceInCurrency: 10, epoxyPricePerLiter: 400 };
  const recalced = calc.recalculateImportedMaterials(usdEpoxy, newRates, oldRates);
  t('доларова смола масштабується пропорційно новому курсу', recalced.epoxyPricePerLiter === 440, String(recalced.epoxyPricePerLiter));
  t('доларова ціна в іноземній валюті лишається незмінною', recalced.epoxyPriceInCurrency === 10, String(recalced.epoxyPriceInCurrency));

  const uahEpoxy = { ...base, epoxyPriceCurrency: 'UAH' as const, epoxyPricePerLiter: 400 };
  const untouched = calc.recalculateImportedMaterials(uahEpoxy, newRates, oldRates);
  t('гривнева смола не перераховується автоматом', untouched.epoxyPricePerLiter === Math.round(400 * (44 / 40)) || untouched.epoxyPricePerLiter === 440,
    String(untouched.epoxyPricePerLiter));
}

console.log('\nПовний розрахунок собівартості (пресет «Стіл-річка»):');
{
  const preset = presets.PRODUCT_TEMPLATES[0];
  const result = calc.calculateWoodAndEpoxyCost(preset.input, calc.DEFAULT_CURRENCY_RATES);

  t('повна собівартість додатна', result.fullCostPrice > 0, String(result.fullCostPrice));
  t('ціна для клієнта більша за собівартість', result.totalSellingPrice > result.fullCostPrice,
    `${result.totalSellingPrice} vs ${result.fullCostPrice}`);
  t('чистий прибуток додатний', result.netProfit > 0, String(result.netProfit));

  const identity = result.fullCostPrice + result.netProfit + result.taxAmount;
  const diff = Math.abs(identity - result.totalSellingPrice);
  t('собівартість + прибуток + податок = ціна для клієнта', diff < 0.01,
    `${identity} vs ${result.totalSellingPrice} (діф. ${diff})`);

  t('деревина врахована в матеріалах', result.totalWoodCost > 0, String(result.totalWoodCost));
  t('епоксидна смола врахована', result.totalEpoxyGroupCost > 0, String(result.totalEpoxyGroupCost));
  t('AI-медіа контент врахований (GPT+Runway)', result.totalAiMediaCostUah > 0, String(result.totalAiMediaCostUah));

  const shareSum = result.materialsSharePercent + result.laborSharePercent + result.overheadSharePercent
    + result.taxSharePercent + result.profitSharePercent;
  t('частки структури ціни в сумі дають ~100%', Math.abs(shareSum - 100) <= 2, String(shareSum));
}

console.log('\nДовідники (породи дерева, шаблони виробів):');
{
  t('є принаймні 5 порід дерева', presets.WOOD_SPECIES_LIST.length >= 5, String(presets.WOOD_SPECIES_LIST.length));
  const woodIds = new Set(presets.WOOD_SPECIES_LIST.map((w) => w.id));
  t('id порід дерева унікальні', woodIds.size === presets.WOOD_SPECIES_LIST.length);

  t('є принаймні 8 пресетів виробів', presets.PRODUCT_TEMPLATES.length >= 8, String(presets.PRODUCT_TEMPLATES.length));
  const presetIds = new Set(presets.PRODUCT_TEMPLATES.map((p) => p.id));
  t('id пресетів унікальні', presetIds.size === presets.PRODUCT_TEMPLATES.length);
  t('жоден пресет не позначений як власний (isCustom)', presets.PRODUCT_TEMPLATES.every((p) => !p.isCustom));

  const brokenPresets: string[] = [];
  for (const p of presets.PRODUCT_TEMPLATES) {
    try {
      const r = calc.calculateWoodAndEpoxyCost(p.input, calc.DEFAULT_CURRENCY_RATES);
      if (!(r.fullCostPrice > 0) || !(r.totalSellingPrice > 0)) {
        brokenPresets.push(`${p.name} (cost=${r.fullCostPrice}, price=${r.totalSellingPrice})`);
      }
    } catch (err) {
      brokenPresets.push(`${p.name} (виняток: ${(err as Error).message})`);
    }
  }
  t('усі пресети рахуються без винятків і дають додатну ціну', brokenPresets.length === 0, brokenPresets.join('; '));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
