/**
 * Ціна AI-виклику в балах за цільовою валовою маржею 30% (ТЗ v0.5, §2.2):
 *   R = C / (1 − M),  бали = ceil(R / V),  V = $0.001, M = 0.30.
 * Тобто бали = ceil(C / $0.0007) за типових параметрів (маржа й вартість бала
 * задає адмін, див. PricingConfig). Рахуємо в цілих мікродоларах: ділення
 * плаваючих (0.0336 / 0.0007 = 48.00000000000001) дало б зайвий бал.
 */

import { costUsdPerCredit, getPricingConfig, targetMargin } from './taxPricing';

const MICRO = 1_000_000;

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
  // Вартість бала в мікродоларах: за типових параметрів рівно 700.
  const microPerCredit = Math.max(1, Math.round(costUsdPerCredit() * MICRO));
  return Math.ceil(Math.round(costUsd * MICRO) / microPerCredit);
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
  const revenue = chargedCredits * getPricingConfig().usdPerCredit;
  return revenue > 0 ? (revenue - costUsd) / revenue : 0;
}

export function meetsTargetMargin(costUsd: number, chargedCredits: number): boolean {
  return marginOfCharge(costUsd, chargedCredits) >= targetMargin() - 1e-9;
}
