/**
 * Списання балів за кнопку Jev «Проставити теги автоматично» (постановка власника
 * 03.11.2026: «списання 1 млн токенів за 4000 балів»).
 *
 * ЩО БУЛО ДО ЦЬОГО. За правилом від 20.10.2026 (`server/creditGate.ts`) бали діяли лише
 * для зображень, а Jev не рахувався ніде. Власник побачив, що собівартість прогону
 * (≈ $2,2 за 1 млн слів) далека від його прикладу в 100 балів, і задав тариф у балах за
 * токени Jev. Тариф — `PricingConfig.jevCreditsPerMillionTokens`, редагується в адмінці.
 *
 * СХЕМА — та сама, що для зображень: резерв ДО звернення до Jev, списання за фактично
 * витраченими токенами (не більше за резерв), повернення резерву, якщо Jev нічого не
 * витратив. Токени Jev стануть відомі лише після відповіді, тож резерв береться з
 * оцінки з запасом, а точна сума — з `usage.input_tokens`.
 *
 * Модуль не знає про базу й гаманець: їх підставляє `server/creditGate.ts` через
 * `JevBilling`, тож маршрути ядра й тести лишаються без SQLite.
 */

import { JEV_MAX_QUESTIONS_PER_PARAGRAPH, jevAnswerKey, type JevAnswerCache, type JevTagParagraph } from './jevTags';

/** Токени, що їх Jev бере понад текст і питання: службова частина запиту. */
export const JEV_ESTIMATE_OVERHEAD_TOKENS = 100;
/** Символів кирилиці на токен: ≈ 2,5 (≈ 330 знаків на абзац ≈ 130 токенів). Занижувати не можна — резерв стане замалим. */
export const JEV_ESTIMATE_CHARS_PER_TOKEN = 2.5;
/**
 * Токенів на одне питання «чи є тут сутність X». Два виміри на справжній книзі дають
 * ≈ 105–115: пілот (24 питання → 2599 токенів на запит) і повний прогін (110 типів на
 * абзац = 13 142 токени).
 */
export const JEV_ESTIMATE_TOKENS_PER_QUESTION = 115;
/** Запас резерву над оцінкою: помилка оцінки не має лишати прогін без резерву. */
export const JEV_RESERVE_BUFFER = 1.25;

/**
 * Бали за токени за заданим тарифом. Округлення вгору, а за будь-якої витрати — не менше
 * одного бала: інакше дрібний прогін був би безкоштовним, а тариф — обхідним.
 */
export function jevCreditsForTokens(tokens: number, creditsPerMillionTokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  if (!Number.isFinite(creditsPerMillionTokens) || creditsPerMillionTokens <= 0) return 0;
  return Math.max(1, Math.ceil((tokens * creditsPerMillionTokens) / 1_000_000));
}

export interface JevTokenEstimate {
  /** Оцінка вхідних токенів Jev, яких це коштуватиме (лише питання, яких немає в пам'яті відповідей). */
  tokens: number;
  freshQuestions: number;
  cachedQuestions: number;
}

/**
 * Скільки токенів піде, якщо запустити прогін зараз. Питання з пам'яті відповідей до Jev
 * не йдуть, тож повтор із нижчим порогом оцінюється в нуль і резерву не потребує.
 */
export function estimateJevTokens(
  paragraphs: readonly JevTagParagraph[],
  opts: { cache?: JevAnswerCache; scope?: string } = {}
): JevTokenEstimate {
  let tokens = 0;
  let freshQuestions = 0;
  let cachedQuestions = 0;
  for (const p of paragraphs) {
    const asked = p.candidates.slice(0, JEV_MAX_QUESTIONS_PER_PARAGRAPH);
    const fresh = asked.filter((c) => opts.cache?.get(jevAnswerKey(opts.scope ?? '', p, c)) === undefined).length;
    cachedQuestions += asked.length - fresh;
    if (!fresh) continue;
    freshQuestions += fresh;
    tokens += JEV_ESTIMATE_OVERHEAD_TOKENS + Math.ceil(p.text.length / JEV_ESTIMATE_CHARS_PER_TOKEN) + JEV_ESTIMATE_TOKENS_PER_QUESTION * fresh;
  }
  return { tokens, freshQuestions, cachedQuestions };
}

/** Балів не вистачає: маршрут відповідає 402, а Jev не викликається. */
export class JevCreditsError extends Error {
  kind = 'credits' as const;
  status = 402;
  code = 'JEV_CREDITS_LOW' as const;
  constructor(public needed: number, public available: number, message: string) {
    super(message);
    this.name = 'JevCreditsError';
  }
}

export interface JevSettled {
  /** Скільки балів списано. */
  credits: number;
  /** Витрата перевищила резерв, і списано лише резерв: решту вбрала платформа. */
  capped: boolean;
}

export interface JevBillingJob {
  reservedCredits: number;
  /** Списати за фактичними токенами; нуль токенів повертає весь резерв. */
  settleTokens(actualTokens: number): JevSettled;
  /** Jev не відповів зовсім: повернути весь резерв. */
  release(reason: string): void;
}

export interface JevTariff {
  creditsPerMillionTokens: number;
  /** Адміністратор або вимкнений гейт: бали не списуються. */
  unlimited: boolean;
  /** Баланс, який доступний зараз; `null`, коли обмежень нема. */
  balance: number | null;
}

/** Підключення гаманця (реалізує `server/creditGate.ts`). */
export interface JevBilling {
  creditsPerMillionTokens(): number;
  /** Резервує бали під прогін. `null` — гейт не застосовується (адмін, вимкнено, гаманець недоступний). */
  begin(req: unknown, estimatedTokens: number): Promise<JevBillingJob | null>;
  tariff(req: unknown): Promise<JevTariff>;
}
