import { PLANS, type PlanId } from './subscriptions';

/**
 * Хто взагалі може стати продавцем.
 *
 * Рішення власника 28.09.2026: «Продавець може стати той — хто придбав
 * мінімальну підписку». Причина не бюрократична: продавець готує товар саме
 * тими засобами, які платить підписка — генерація зображень і тексти ШІ. Тож
 * безкоштовний акаунт із 10 зображеннями за весь час не може бути продавцем:
 * він не виробить товару, а платформу витратить.
 *
 * Порогом узято **найдешевший платний тариф** (`start`), а не конкретний
 * тариф: власник сказав «мінімальну підписку», і вищий тариф теж її включає.
 * Безкоштовний `free` не рахується — він не куплений.
 *
 * Гейт живе в Студії, бо саме тут є підписки: у маркетплейсі моделі підписки
 * немає взагалі (Фаза E була пропущена), тож перевіряти там нічого.
 */

/** Мінімальний тариф, з яким можна стати продавцем. */
export const MIN_SELLER_PLAN: PlanId = 'start';

/**
 * Чи це платний тариф. `null` тут означає «у Студії немає облікового запису з
 * такою поштою» — тобто підписки теж немає, і це не помилка, а відповідь.
 */
export function isPaidPlan(plan: string | null | undefined): boolean {
  if (!plan || plan === 'free') return false;
  return Object.prototype.hasOwnProperty.call(PLANS, plan);
}

/** Людська назва тарифу; невідоме значення читаємо як безкоштовний. */
export function planLabel(plan: string | null | undefined): string {
  const id: PlanId =
    plan && Object.prototype.hasOwnProperty.call(PLANS, plan) ? (plan as PlanId) : 'free';
  return PLANS[id].nameUk;
}

/**
 * Причина відмови — або `null`, якщо людині можна схвалювати заявку.
 *
 * Текст навмисно називає і тариф, і вимогу: власник має бачити не «заборонено»,
 * а чого саме бракує, бо рішення про виняток залишається за ним.
 */
export function sellerGateRefusal(
  plan: string | null | undefined,
  email: string | null | undefined
): string | null {
  if (isPaidPlan(plan)) return null;

  const who = email ? `Акаунт «${email}»` : 'Цей акаунт';
  const requirement = `продавцем стає лише той, хто придбав платну підписку (мінімум «${PLANS[MIN_SELLER_PLAN].nameUk}»)`;

  if (!plan) {
    return `${who} не має облікового запису в Студії, а отже й підписки — ${requirement}.`;
  }
  return `${who} на тарифі «${planLabel(plan)}» — ${requirement}.`;
}
