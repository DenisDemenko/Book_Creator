/**
 * Підключення гаманця балів до генерації зображень (ТЗ v0.5, §2.3).
 *
 * Правила власника (20.10.2026):
 *  - бали списуються ЛИШЕ за зображення; текст/JEV обмежені грошовим лімітом
 *    (TEXT_BUDGET_UAH, див. checkChatQuota у subscriptions.ts);
 *  - «гість» = зареєстрований користувач без платної підписки: одноразово
 *    300 пробних балів;
 *  - платна підписка: щомісяця пакет, залишок попереднього періоду згорає;
 *  - старі ліміти за кількістю зображень прибрані; адмін — без обмежень.
 *
 * Аварійний вимикач: AI_CREDITS_DISABLED=1 — гейт не втручається (як до змін).
 * Без SQLite (JSON-фолбек) гаманця немає — гейт теж не втручається.
 */

import { getDb, isAvailable } from './db';
import { CreditWallet, WalletError, type CreditBalance } from './creditWallet';
import { creditsForCostUsd } from './creditPricing';
import { JEV_USD_PER_MTOK } from './ai/adapters/jev';
import { priceForImage, priceForVideo } from './pricing';
import { resolveVideoParams } from './videoGeneration';
import { PLANS, resolveSubscription, type PlanId } from './subscriptions';
import { getPricingConfig } from './taxPricing';
import { JEV_RESERVE_BUFFER, JevCreditsError, jevCreditsForTokens, type JevBilling, type JevBillingJob, type JevTariff } from './core/ai/jevBilling';
const DAY_MS = 86_400_000;

export type CreditErrorCode = 'IMAGE_CREDITS_LOW' | 'IMAGE_PRICE_UNKNOWN';

/** kind='credits' — маршрути відповідають 402 (див. server.ts). */
export class ImageCreditsError extends Error {
  kind = 'credits' as const;
  status = 402;
  constructor(public code: CreditErrorCode, message: string) {
    super(message);
    this.name = 'ImageCreditsError';
  }
}

export function creditsEnabled(): boolean {
  return process.env.AI_CREDITS_DISABLED !== '1' && isAvailable();
}

function wallet(): CreditWallet {
  return new CreditWallet(getDb() as any);
}

/**
 * Лениво нараховує, що належить користувачеві зараз: пробні бали (без платної
 * підписки) або пакет поточного місяця підписки. Ідемпотентно — безпечно
 * викликати на кожен запит. Річна підписка отримує пакет щомісяця.
 */
export async function syncCredits(userId: string): Promise<CreditBalance> {
  const w = wallet();
  const sub = await resolveSubscription(userId);
  const now = Date.now();
  const def = PLANS[sub.plan as PlanId];
  const paid =
    !!def && sub.plan !== 'free' && sub.status === 'active' && new Date(sub.currentPeriodEnd).getTime() > now;

  if (paid) {
    const monthIdx = Math.min(
      11,
      Math.max(0, Math.floor((now - new Date(sub.currentPeriodStart).getTime()) / (30 * DAY_MS)))
    );
    w.grantPeriod(
      userId,
      def.aiCredits,
      `period:${userId}:${sub.currentPeriodStart}:${monthIdx}`,
      `Пакет ${def.nameUk}, місяць ${monthIdx + 1}`
    );
  } else {
    w.grant(userId, getPricingConfig().freeCredits, `trial:${userId}`, 'Пробна квота зареєстрованого користувача');
    if (sub.plan !== 'free') {
      // Підписка закінчилась: платні залишки згорають, пробні (до 300) лишаються.
      w.capAvailable(userId, getPricingConfig().freeCredits, `lapse:${userId}:${sub.currentPeriodStart}`, 'Підписку завершено');
    }
  }
  return w.getBalance(userId);
}

export interface ImageCreditJob {
  jobKey: string;
  reservedCredits: number;
  /** Успіх: списати за фактичною собівартістю (не більше за резерв). */
  settleUsd(actualCostUsd: number): void;
  /** Успіх фото: списати за фактичним рушієм/моделлю/розміром. */
  settle(engineId: string, modelId: string, sizeLabel: string): void;
  /** Успіх відео: за фактичними рушієм/моделлю/роздільністю/тривалістю. */
  settleVideo(engineId: string, modelId: string, resolution: string, durationSec: number | null): void;
  /** Збій провайдера: повернути весь резерв. */
  release(reason: string): void;
}

/**
 * Перевіряє принципала й повертає userId, якщо гейт діє. null — гейт не
 * застосовується (адмін, гість без входу, вимкнено).
 */
function gatedUserId(req: any): string | null {
  const p = req?.principal;
  if (!creditsEnabled() || !p || p.isGuest || !p.id || p.role === 'admin') return null;
  return String(p.id);
}

/** Скільки балів коштує виклик із собівартістю costUsd; невідома ціна — ImageCreditsError. */
function creditsOrThrow(costUsd: number): number {
  if (!(costUsd > 0)) {
    throw new ImageCreditsError('IMAGE_PRICE_UNKNOWN', 'Для цього рушія немає перевіреної ціни — генерацію не запущено.');
  }
  return creditsForCostUsd(costUsd);
}

function lowBalanceError(credits: number, have: number): ImageCreditsError {
  return new ImageCreditsError(
    'IMAGE_CREDITS_LOW',
    `Недостатньо AI-балів: ця генерація коштує ${credits}, на балансі ${have}. Поповніть підпискою на сторінці «Підписка».`
  );
}

/** Резервує бали під одну генерацію. Кидає ImageCreditsError, якщо запускати не можна (провайдера не викликано). */
async function beginCharge(req: any, costUsd: number, kind: 'img' | 'vid' | 'txt'): Promise<ImageCreditJob | null> {
  const userId = gatedUserId(req);
  if (!userId) return null;
  const credits = creditsOrThrow(costUsd);

  const w = wallet();
  const jobKey = `${kind}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  try {
    await syncCredits(userId);
    w.reserve(userId, jobKey, credits);
  } catch (err) {
    if (err instanceof WalletError && err.code === 'IMAGE_CREDITS_LOW') {
      throw lowBalanceError(credits, w.getBalance(userId).available);
    }
    console.warn('[creditGate] гаманець недоступний, генерацію пропускаємо без списання:', err);
    return null;
  }

  const settleUsd = (actualUsd: number) => {
    try {
      const actual = actualUsd > 0 ? Math.min(credits, creditsForCostUsd(actualUsd)) : credits;
      w.settle(jobKey, actual);
    } catch (err) {
      console.error('[creditGate] не вдалося списати резерв:', jobKey, err);
    }
  };
  return {
    jobKey,
    reservedCredits: credits,
    settleUsd,
    settle: (e, m, size) => settleUsd(priceForImage(e, size, m)),
    settleVideo: (e, m, res, dur) => settleUsd(priceForVideo(e, m, res, dur)),
    release(reason) {
      try {
        w.release(jobKey, reason);
      } catch (err) {
        console.error('[creditGate] не вдалося повернути резерв:', jobKey, err);
      }
    },
  };
}

/** Фото: резерв ДО провайдера. null — гейт не застосовується. */
export async function beginImage(req: any, engineId: string, modelId: string, sizeLabel: string): Promise<ImageCreditJob | null> {
  if (!gatedUserId(req)) return null;
  return beginCharge(req, priceForImage(engineId, sizeLabel, modelId), 'img');
}

/** Вартість відео в USD за фактично нормалізованими параметрами. */
/**
 * Резерв балів під текстовий прохід чернетки за фото (журнал #530): `maxCostUsd` — верхня оцінка
 * собівартості, фактична сума списується після відповіді моделі (не більше за резерв). Рішення
 * власника 09.11.2026: проходи 2–3 GrabFusion оплачуються балами за тарифом моделі з адмінки, а не
 * грошовим лімітом тексту. `null` — гейт не діє (адмін, гість, бали вимкнено, гаманець недоступний).
 */
export async function beginTextCharge(req: any, maxCostUsd: number): Promise<ImageCreditJob | null> {
  return beginCharge(req, maxCostUsd, 'txt');
}

export function videoCostUsd(engineId?: string, resolution?: string, durationSec?: number): { costUsd: number; params: ReturnType<typeof resolveVideoParams> } {
  const params = resolveVideoParams(engineId, resolution, durationSec);
  return { costUsd: priceForVideo(params.engine.id, params.modelId, params.resolution, params.durationSec), params };
}

/** Відео: резерв ДО провайдера. null — гейт не застосовується. */
export async function beginVideo(req: any, engineId?: string, resolution?: string, durationSec?: number): Promise<ImageCreditJob | null> {
  if (!gatedUserId(req)) return null;
  return beginCharge(req, videoCostUsd(engineId, resolution, durationSec).costUsd, 'vid');
}

/**
 * Швидка перевірка БЕЗ резерву — щоб маршрут відео відповів 402 одразу, а не
 * через хвилини у фоновому завданні. Справжній резерв робить beginVideo.
 */
export async function assertVideoAffordable(req: any, engineId?: string, resolution?: string, durationSec?: number): Promise<void> {
  const userId = gatedUserId(req);
  if (!userId) return;
  const credits = creditsOrThrow(videoCostUsd(engineId, resolution, durationSec).costUsd);
  try {
    const have = (await syncCredits(userId)).available;
    if (have < credits) throw lowBalanceError(credits, have);
  } catch (err) {
    if (err instanceof ImageCreditsError) throw err;
    console.warn('[creditGate] гаманець недоступний, перевірку відео пропускаємо:', err);
  }
}

/** Стан балів для UI й preflight. Адмін чи вимкнений гейт — без обмежень (balance = null). */
export async function creditStatus(
  userId: string,
  role: string
): Promise<{ unlimited: boolean; balance: CreditBalance | null }> {
  if (role === 'admin' || !creditsEnabled()) return { unlimited: true, balance: null };
  return { unlimited: false, balance: await syncCredits(userId) };
}

// ---------------------------------------------------------------------------
// Jev: кнопка «Проставити теги автоматично» (03.11.2026)
// ---------------------------------------------------------------------------

/** Тариф у балах за 1 млн токенів Jev — з адмінського конфігу цін. */
export function jevCreditsPerMillionTokens(): number {
  const fixed = getPricingConfig().jevCreditsPerMillionTokens;
  if (fixed !== null && fixed !== undefined) return fixed;
  // Типово — за собівартістю Jev і маржею платформи, як для зображень: ціна Jev береться з адаптера, а не вгадується.
  return creditsForCostUsd(JEV_USD_PER_MTOK);
}

/**
 * Резервує бали під прогін Jev. Токени Jev відомі лише після відповіді, тож резерв —
 * оцінка із запасом, а списується фактичне (не більше резерву). `null` — гейт не
 * застосовується: адмін, гість, вимкнені бали, нульовий тариф або недоступний гаманець.
 * Балів не вистачає — `JevCreditsError` (402), і до Jev не звертаються.
 */
export async function beginJev(req: any, estimatedTokens: number): Promise<JevBillingJob | null> {
  const userId = gatedUserId(req);
  const rate = jevCreditsPerMillionTokens();
  if (!userId || !(rate > 0) || !(estimatedTokens > 0)) return null;
  const reserve = jevCreditsForTokens(Math.ceil(estimatedTokens * JEV_RESERVE_BUFFER), rate);

  const w = wallet();
  const jobKey = `jev:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  try {
    await syncCredits(userId);
    w.reserve(userId, jobKey, reserve);
  } catch (err) {
    if (err instanceof WalletError && err.code === 'IMAGE_CREDITS_LOW') {
      const have = w.getBalance(userId).available;
      throw new JevCreditsError(
        reserve,
        have,
        `Недостатньо AI-балів для цього прогону Jev: потрібно ≈ ${reserve} (з запасом), на балансі ${have}. ` +
          `Тариф Jev — ${rate} балів за 1 млн токенів. Поповніть підпискою або оберіть менший розділ.`
      );
    }
    console.warn('[creditGate] гаманець недоступний, прогін Jev пропускаємо без списання:', err);
    return null;
  }

  return {
    reservedCredits: reserve,
    settleTokens(actualTokens: number) {
      const wanted = jevCreditsForTokens(actualTokens, rate);
      try {
        if (wanted <= 0) {
          w.release(jobKey, 'Jev не витратив токенів');
          return { credits: 0, capped: false };
        }
        const credits = Math.min(reserve, wanted);
        w.settle(jobKey, credits);
        return { credits, capped: wanted > reserve };
      } catch (err) {
        console.error('[creditGate] не вдалося списати за Jev:', jobKey, err);
        return { credits: 0, capped: false };
      }
    },
    release(reason: string) {
      try {
        w.release(jobKey, reason);
      } catch (err) {
        console.error('[creditGate] не вдалося повернути резерв Jev:', jobKey, err);
      }
    },
  };
}

/** Тариф і баланс для панелі: скільки коштує Jev і чи вистачить балів. */
export async function jevTariff(req: any): Promise<JevTariff> {
  const rate = jevCreditsPerMillionTokens();
  const userId = gatedUserId(req);
  if (!userId) return { creditsPerMillionTokens: rate, unlimited: true, balance: null };
  try {
    return { creditsPerMillionTokens: rate, unlimited: false, balance: (await syncCredits(userId)).available };
  } catch {
    return { creditsPerMillionTokens: rate, unlimited: true, balance: null };
  }
}

/** Підключення для маршрутів ядра (`registerProjectRoutes`). */
export const jevBilling: JevBilling = {
  creditsPerMillionTokens: jevCreditsPerMillionTokens,
  begin: beginJev,
  tariff: jevTariff,
};
