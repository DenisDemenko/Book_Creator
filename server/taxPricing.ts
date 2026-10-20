/**
 * Податкові сценарії та розрахунок цін підписок (ТЗ v0.5, §2.2–2.2.3).
 *
 * Ціна підписки — це те, що платить клієнт (gross). Скільки з неї лишається
 * на змінні витрати, залежить від податкового режиму продавця, тому режим
 * перемикається (адмін-панель → «Податки та ціни»), а ціни перераховуються
 * тією самою формулою:
 *
 *   дохід без ПДВ  N = P / (1 + vat)
 *   ціль           (N − податки з обороту − C_image − T − 8% накладних) ≥ 30% · N
 *
 * де C_image — повна собівартість зображень при 100% витрачених балів
 * (бали × $0.0007 × курс; 0.0007 = $0.001 / бал × (1 − 0.30)), T — бюджет на
 * текст/JEV, 8% = 3% платіжний оператор + 5% інфраструктура.
 *
 * Цифри — сценарні припущення ТЗ, а не підтверджені рахунки провайдерів:
 * їх замінюють фактичними значеннями змінні середовища/константи нижче.
 */

export type TaxRegimeId = 'vat_payer' | 'non_vat' | 'fop3_5pct' | 'fop3_3pct_vat';

export interface TaxRegime {
  id: TaxRegimeId;
  nameUk: string;
  noteUk: string;
  /** Ціна для клієнта включає ПДВ? (для чека: «в т.ч. ПДВ»). */
  vatIncluded: boolean;
  /** Ставка ПДВ, % (0, якщо не платник). */
  vatPercent: number;
  /** Податки з обороту (ЄП + військовий збір), частка від доходу без ПДВ. */
  turnoverTaxShare: number;
}

export const TAX_REGIMES: Record<TaxRegimeId, TaxRegime> = {
  vat_payer: {
    id: 'vat_payer',
    nameUk: 'Платник ПДВ 20%',
    noteUk: 'Ціна включає ПДВ 20% (ПДВ = ціна/6). Найконсервативніший сценарій — найвищі ціни.',
    vatIncluded: true,
    vatPercent: 20,
    turnoverTaxShare: 0,
  },
  non_vat: {
    id: 'non_vat',
    nameUk: 'Без ПДВ і без податків з обороту',
    noteUk: 'Спрощена модель: уся ціна — дохід. Лише для порівняння; не відображає реального режиму.',
    vatIncluded: false,
    vatPercent: 0,
    turnoverTaxShare: 0,
  },
  fop3_5pct: {
    id: 'fop3_5pct',
    nameUk: 'ФОП III групи: 5% ЄП + 1% військовий збір, без ПДВ',
    noteUk: 'У чеку немає ПДВ. ЄСВ та інші фіксовані платежі в ціну не закладені.',
    vatIncluded: false,
    vatPercent: 0,
    turnoverTaxShare: 0.06,
  },
  fop3_3pct_vat: {
    id: 'fop3_3pct_vat',
    nameUk: 'ФОП III групи: 3% ЄП + ПДВ 20% + 1% військовий збір',
    noteUk: 'Ціна включає ПДВ 20%; ЄП і збір рахуються від доходу без ПДВ (базу підтвердити з бухгалтером).',
    vatIncluded: true,
    vatPercent: 20,
    turnoverTaxShare: 0.04,
  },
};

export const TAX_REGIME_IDS = Object.keys(TAX_REGIMES) as TaxRegimeId[];
export const DEFAULT_TAX_REGIME: TaxRegimeId = 'vat_payer';

export function isTaxRegimeId(v: unknown): v is TaxRegimeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TAX_REGIMES, v);
}

/**
 * Параметри розрахунку цін і балів. Значення за замовчуванням — рішення
 * власника (ТЗ v0.5, 20.10.2026); адмін змінює їх у панелі, і зміна ОДРАЗУ
 * переноситься в ціни підписок, пакети балів, ліміт тексту й формулу
 * списання (server/subscriptions.ts applyPricing, server/creditPricing.ts).
 */
export interface PricingConfig {
  /** Цільова валова маржа, % від виручки без ПДВ (30 — маржа, а не націнка). */
  targetMarginPercent: number;
  /** Накладні (платіжний оператор 3% + інфраструктура 5%), % від ціни для клієнта. */
  overheadPercent: number;
  /** Роздрібна вартість 1 бала, USD. Собівартість бала = ця вартість × (1 − маржа). */
  usdPerCredit: number;
  /** Курс для розрахунку цін і ліміту тексту, ₴ за $ (стрес-курс 48 як буфер до НБУ 45.0013). */
  fxUahPerUsd: number;
  /** Ліміт витрат на текст/JEV, ₴ на період платної підписки (A-14). Закладений у ціну. */
  textBudgetUah: number;
  /** Пробні бали зареєстрованого користувача без підписки, одноразово. */
  freeCredits: number;
  /** Бали на місяць за планом. */
  planCredits: { start: number; pro: number; ultra: number; team: number };
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  targetMarginPercent: 30,
  overheadPercent: 8,
  usdPerCredit: 0.001,
  fxUahPerUsd: 48,
  textBudgetUah: 200,
  freeCredits: 300,
  planCredits: { start: 2_000, pro: 5_000, ultra: 25_000, team: 50_000 },
};

let pricingConfig: PricingConfig = structuredClone(DEFAULT_PRICING_CONFIG);

export function getPricingConfig(): PricingConfig {
  return structuredClone(pricingConfig);
}

/** Перевіряє й зливає часткове оновлення. Кидає Error з поясненням, якщо значення поза межами. */
export function mergePricingConfig(base: PricingConfig, patch: unknown): PricingConfig {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, any>;
  const next: PricingConfig = structuredClone(base);
  const num = (key: keyof PricingConfig, min: number, max: number, integer = false) => {
    if (p[key] === undefined) return;
    const v = Number(p[key]);
    if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      throw new Error(`Поле ${String(key)} має бути ${integer ? 'цілим ' : ''}числом від ${min} до ${max}.`);
    }
    (next as any)[key] = v;
  };
  num('targetMarginPercent', 0, 90);
  num('overheadPercent', 0, 40);
  num('usdPerCredit', 0.00001, 1);
  num('fxUahPerUsd', 1, 500);
  num('textBudgetUah', 0, 100_000);
  num('freeCredits', 0, 1_000_000, true);
  if (p.planCredits !== undefined) {
    for (const plan of ['start', 'pro', 'ultra', 'team'] as const) {
      if (p.planCredits?.[plan] === undefined) continue;
      const v = Number(p.planCredits[plan]);
      if (!Number.isInteger(v) || v < 1 || v > 10_000_000) {
        throw new Error(`Бали плану ${plan} мають бути цілим числом від 1 до 10 000 000.`);
      }
      next.planCredits[plan] = v;
    }
  }
  if (next.targetMarginPercent + next.overheadPercent >= 95) {
    throw new Error('Маржа й накладні разом мають бути менші за 95%.');
  }
  return next;
}

export function setPricingConfig(patch: unknown): PricingConfig {
  pricingConfig = mergePricingConfig(pricingConfig, patch);
  return getPricingConfig();
}

/** Цільова валова маржа як частка (0.30). */
export function targetMargin(): number {
  return pricingConfig.targetMarginPercent / 100;
}
export function overheadShare(): number {
  return pricingConfig.overheadPercent / 100;
}
/** Собівартість одного бала, USD (за замовчуванням $0.0007 = $0.001 × (1 − 0.30)). */
export function costUsdPerCredit(): number {
  return pricingConfig.usdPerCredit * (1 - targetMargin());
}
export function textBudgetUah(): number {
  return pricingConfig.textBudgetUah;
}
export function planCreditsFor(planId: string): number {
  if (planId === 'free') return pricingConfig.freeCredits;
  return (pricingConfig.planCredits as Record<string, number>)[planId] ?? 0;
}

/** Частка ціни (gross), яка лишається на змінні витрати після податків, накладних і цільової маржі. */
export function budgetShare(regime: TaxRegime): number {
  const net = 1 / (1 + regime.vatPercent / 100);
  return net * (1 - targetMargin() - regime.turnoverTaxShare) - overheadShare();
}

/** Мінімальна ціна (gross), що тримає цільову маржу, до округлення. */
export function minPriceUah(regime: TaxRegime, credits: number, otherAiUah: number, fx = pricingConfig.fxUahPerUsd): number {
  const imageCost = credits * costUsdPerCredit() * fx;
  return (imageCost + otherAiUah) / budgetShare(regime);
}

/** Вирівнювання вгору: до 1000 грн — кратне 10, від 1000 — кратне 100. */
export function roundUpPrice(price: number): number {
  const step = price < 1000 ? 10 : 100;
  // −1e-9: щоб похибка плаваючої крапки не штовхала точне кратне на наступний крок.
  return Math.ceil(price / step - 1e-9) * step;
}

export function monthlyPriceUah(regime: TaxRegime, planId: string, fx = pricingConfig.fxUahPerUsd): number {
  const credits = planCreditsFor(planId);
  if (!credits || planId === 'free') return 0;
  return roundUpPrice(minPriceUah(regime, credits, pricingConfig.textBudgetUah, fx));
}

export interface PriceBreakdown {
  grossUah: number;
  vatUah: number;
  netUah: number;
  turnoverTaxUah: number;
  overheadUah: number;
  imageCostUah: number;
  otherAiUah: number;
  contributionUah: number;
  /** Маржа від доходу без ПДВ, 0..1. */
  marginShare: number;
}

/** Розбір ціни за режимом: скільки ПДВ, податків і яка маржа при 100% витрачених балів. */
export function priceBreakdown(
  regime: TaxRegime,
  planId: string,
  grossUah: number,
  fx = pricingConfig.fxUahPerUsd
): PriceBreakdown {
  const net = grossUah / (1 + regime.vatPercent / 100);
  const imageCostUah = planCreditsFor(planId) * costUsdPerCredit() * fx;
  const otherAiUah = planId === 'free' ? 0 : pricingConfig.textBudgetUah;
  const turnoverTaxUah = net * regime.turnoverTaxShare;
  const overheadUah = grossUah * overheadShare();
  const contributionUah = net - turnoverTaxUah - overheadUah - imageCostUah - otherAiUah;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    grossUah,
    vatUah: r2(grossUah - net),
    netUah: r2(net),
    turnoverTaxUah: r2(turnoverTaxUah),
    overheadUah: r2(overheadUah),
    imageCostUah: r2(imageCostUah),
    otherAiUah,
    contributionUah: r2(contributionUah),
    marginShare: net > 0 ? contributionUah / net : 0,
  };
}
