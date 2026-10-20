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

/** Цільова валова маржа (частка від доходу без ПДВ) — рішення власника: 30%, а не націнка. */
export const TARGET_MARGIN = 0.3;
/** 3% платіжний оператор + 5% інфраструктура — від ціни, яку платить клієнт. */
export const OVERHEAD_SHARE = 0.08;
/** 1 бал = $0.001 роздрібної вартості; собівартість бала при марже 30% = $0.0007. */
export const USD_PER_CREDIT = 0.001;
export const COST_USD_PER_CREDIT = USD_PER_CREDIT * (1 - TARGET_MARGIN);
/** Курс для розрахунку цін: НБУ 20.10.2026 = 45.0013, у цінах — стрес-курс 48 як буфер. */
export const PRICING_FX_UAH_PER_USD = 48;

/** Бюджет на текст/JEV/інші змінні AI-витрати, грн/міс, на повністю використаний пакет. */
export const OTHER_AI_BUDGET_UAH: Record<string, number> = {
  start: 40,
  pro: 100,
  ultra: 400,
  team: 500,
};

/** Бали за місяць (free — одноразова пробна квота). */
export const PLAN_CREDITS: Record<string, number> = {
  free: 300,
  start: 2_000,
  pro: 5_000,
  ultra: 25_000,
  team: 50_000,
};

/** Частка ціни (gross), яка лишається на змінні витрати після податків, накладних і 30% маржі. */
export function budgetShare(regime: TaxRegime): number {
  const net = 1 / (1 + regime.vatPercent / 100);
  return net * (1 - TARGET_MARGIN - regime.turnoverTaxShare) - OVERHEAD_SHARE;
}

/** Мінімальна ціна (gross), що тримає 30% маржі, до округлення. */
export function minPriceUah(
  regime: TaxRegime,
  credits: number,
  otherAiUah: number,
  fx = PRICING_FX_UAH_PER_USD
): number {
  const imageCost = credits * COST_USD_PER_CREDIT * fx;
  return (imageCost + otherAiUah) / budgetShare(regime);
}

/** Вирівнювання вгору: до 1000 грн — кратне 10, від 1000 — кратне 100. */
export function roundUpPrice(price: number): number {
  const step = price < 1000 ? 10 : 100;
  // −1e-9: щоб похибка плаваючої крапки не штовхала точне кратне на наступний крок.
  return Math.ceil(price / step - 1e-9) * step;
}

export function monthlyPriceUah(regime: TaxRegime, planId: string, fx = PRICING_FX_UAH_PER_USD): number {
  const credits = PLAN_CREDITS[planId];
  if (!credits || planId === 'free') return 0;
  return roundUpPrice(minPriceUah(regime, credits, OTHER_AI_BUDGET_UAH[planId] ?? 0, fx));
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
  fx = PRICING_FX_UAH_PER_USD
): PriceBreakdown {
  const net = grossUah / (1 + regime.vatPercent / 100);
  const imageCostUah = (PLAN_CREDITS[planId] ?? 0) * COST_USD_PER_CREDIT * fx;
  const otherAiUah = OTHER_AI_BUDGET_UAH[planId] ?? 0;
  const turnoverTaxUah = net * regime.turnoverTaxShare;
  const overheadUah = grossUah * OVERHEAD_SHARE;
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
