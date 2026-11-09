/**
 * Позначка запису журналу витрат: цей текстовий виклик оплачено БАЛАМИ, тож у грошовий ліміт
 * тексту (checkChatQuota) він не рахується — інакше проходи 2–3 чернеток за фото списувалися б
 * двічі: балами з гаманця і гривнями з ліміту чату (журнал #530).
 *
 * Позначка живе в підписі виклику (`context` запису), бо схема журналу не має окремого поля, а
 * підпис уже несе id чернетки для `aiUsageForDraft`.
 */
export const CREDIT_BILLED_MARK = '[бали]';

export function creditBilledLabel(label: string): string {
  return label.includes(CREDIT_BILLED_MARK) ? label : `${label} ${CREDIT_BILLED_MARK}`;
}

export function isCreditBilledContext(context: unknown): boolean {
  return typeof context === 'string' && context.includes(CREDIT_BILLED_MARK);
}
