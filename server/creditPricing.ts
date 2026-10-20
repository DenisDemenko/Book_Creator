/**
 * Ціна AI-виклику в балах за цільовою валовою маржею 30% (ТЗ v0.5, §2.2):
 *   R = C / (1 − M),  бали = ceil(R / V),  V = $0.001, M = 0.30.
 * Тобто бали = ceil(C / $0.0007). Рахуємо в цілих мікродоларах: ділення
 * плаваючих (0.0336 / 0.0007 = 48.00000000000001) дало б зайвий бал.
 */

import { COST_USD_PER_CREDIT, TARGET_MARGIN, USD_PER_CREDIT } from './taxPricing';

const MICRO = 1_000_000;
const MICRO_PER_CREDIT = Math.round(COST_USD_PER_CREDIT * MICRO); // 700

export class CreditPriceError extends Error {
  constructor(public code: 'IMAGE_PRICE_UNKNOWN', message: string) {
    super(message);
  }
}

/** Скільки балів списати за виклик із повною собівартістю C (USD). */
export function creditsForCostUsd(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) {
    throw new CreditPriceError('IMAGE_PRICE_UNKNOWN', 'Собівартість виклику невідома — генерацію не запущено.');
  }
  return Math.ceil(Math.round(costUsd * MICRO) / MICRO_PER_CREDIT);
}

export interface CreditQuote {
  costUsd: number;
  /** Бали до очікуваного списання. */
  estimatedCredits: number;
  /** Верхня межа резерву: +reserveBuffer до собівартості (токени, комісії). */
  maxCredits: number;
}

/** Quote зі стрес-запасом (типово +10% до C), як у §2.2 «Версійний прайс». */
export function quoteCredits(costUsd: number, reserveBuffer = 0.1): CreditQuote {
  return {
    costUsd,
    estimatedCredits: creditsForCostUsd(costUsd),
    maxCredits: creditsForCostUsd(costUsd * (1 + reserveBuffer)),
  };
}

/** Інваріант C-15: (charge·V − C) / (charge·V) ≥ 30% для списаних балів. */
export function marginOfCharge(costUsd: number, chargedCredits: number): number {
  const revenue = chargedCredits * USD_PER_CREDIT;
  return revenue > 0 ? (revenue - costUsd) / revenue : 0;
}

export function meetsTargetMargin(costUsd: number, chargedCredits: number): boolean {
  return marginOfCharge(costUsd, chargedCredits) >= TARGET_MARGIN - 1e-9;
}
