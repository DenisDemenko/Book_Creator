/**
 * Тарифні плани NOVA STUDIO.
 *
 * Ціни задані користувачем (UAH, місячний рахунок): Start 260, Pro 800,
 * Ultra 2600, і безкоштовний план з лімітом 10 генерацій зображень.
 *
 * Річна ціна користувачем не уточнювалась — застосовано типову для SaaS
 * знижку «2 місяці в подарунок» (річна = 10 місячних ціни), що дає ~17%
 * знижки. Це рішення, а не факт з ТЗ — за потреби легко змінити нижче.
 *
 * Квоти генерації зображень: план Free — 10 зображень за весь час
 * (не щомісяця, як прямо просив користувач). Пороги Start/Pro/Ultra —
 * наша пропозиція, орієнтована на реальну собівартість генерацій
 * (server/pricing.ts): Pro/Ultra свідомо з запасом, щоб не впертися
 * в ліміт при нормальному використанні.
 */

import type { Request, Response, NextFunction } from 'express';
import { getSubscription, upsertSubscription, listUsageSince, type StoredSubscription } from './store';

export type PlanId = 'free' | 'start' | 'pro' | 'ultra';
export type BillingCycle = 'monthly' | 'annual';

export interface PlanDefinition {
  id: PlanId;
  nameUk: string;
  nameEn: string;
  taglineUk: string;
  taglineEn: string;
  priceMonthlyUah: number;
  /** = priceMonthlyUah * 10 («2 місяці в подарунок»), крім Free. */
  priceAnnualUah: number;
  /** null = без обмеження. Для Free — ліміт за весь час, для інших — на період підписки. */
  imageQuota: number | null;
  imageQuotaPeriod: 'lifetime' | 'period';
  /**
   * Місячний ліміт витрат на чат-сесії AI-асистента, доларів США.
   * null = без ліміту. Ліміт по $, а не по кількості повідомлень, бо
   * вартість відповіді сильно залежить від обраної моделі. Лічиться за
   * usage_log (kind='text', context='AI-асистент (чат-сесія)') за період
   * підписки; адмін — без ліміту.
   */
  chatQuotaUsd: number | null;
  /**
   * Ліміт сховища для фотоальбому (завантажені з компʼютера + згенеровані
   * зображення), у мегабайтах. Рахується сумарно для облікового запису —
   * тобто загалом для всіх книг автора, а не окремо на кожну книгу.
   * На відміну від imageQuota це не лічильник за період, а загальний
   * («lifetime») обсяг — так само, як Free-план для генерацій зображень.
   */
  storageQuotaMb: number;
  engines: string[] | 'all';
  featuresUk: string[];
  /** Англійський переклад featuresUk — той самий порядок і зміст пунктів. */
  featuresEn: string[];
  highlighted?: boolean;
  badgeUk?: string;
  badgeEn?: string;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    nameUk: 'Безкоштовний',
    nameEn: 'Free',
    taglineUk: 'Спробувати платформу без картки',
    taglineEn: 'Try the platform with no card required',
    priceMonthlyUah: 0,
    priceAnnualUah: 0,
    imageQuota: 10,
    imageQuotaPeriod: 'lifetime',
    chatQuotaUsd: null,
    storageQuotaMb: 100,
    engines: ['nano-banana-2-lite', 'nano-banana-2'],
    featuresUk: [
      '10 генерацій ілюстрацій ШІ за весь час (Nano Banana Lite / Standard)',
      'Необмежене редагування тексту та AI-редактор (правки, граматика, стиль)',
      'Персонажі, сценарій, зміст, сноски та QR-теги — без обмежень',
      'Попередній перегляд книги та базовий експорт PDF',
      'Спільна робота в реальному часі з іншими авторами',
      '100 МБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '10 lifetime AI illustration generations (Nano Banana Lite / Standard)',
      'Unlimited text editing and AI editor (edits, grammar, style)',
      'Characters, scenario, table of contents, footnotes and QR tags — unlimited',
      'Book preview and basic PDF export',
      'Real-time collaboration with other authors',
      '100 MB photo album storage for your own uploads (jpg/png/svg), shared across all books',
    ],
  },
  start: {
    id: 'start',
    nameUk: 'Start',
    nameEn: 'Start',
    taglineUk: 'Для одного автора, що активно пише',
    taglineEn: 'For a single author writing actively',
    priceMonthlyUah: 260,
    priceAnnualUah: 2600,
    imageQuota: 100,
    imageQuotaPeriod: 'period',
    chatQuotaUsd: null,
    storageQuotaMb: 200,
    engines: 'all',
    featuresUk: [
      '100 генерацій зображень на місяць, усі рушії Nano Banana (Lite / 2 / Pro)',
      'Повний експорт: PDF, DOCX, EPUB під видавничі стандарти',
      'Історія версій книги з відновленням будь-якого зліпка',
      'Усе з плану «Безкоштовний»',
      '200 МБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '100 image generations per month, all Nano Banana engines (Lite / 2 / Pro)',
      'Full export: PDF, DOCX, EPUB to publishing standards',
      'Book version history with restore from any snapshot',
      'Everything in the Free plan',
      '200 MB photo album storage for your own uploads (jpg/png/svg), shared across all books',
    ],
  },
  pro: {
    id: 'pro',
    nameUk: 'Pro',
    nameEn: 'Pro',
    taglineUk: 'Для авторів з ілюстрованими виданнями',
    taglineEn: 'For authors publishing illustrated editions',
    priceMonthlyUah: 800,
    priceAnnualUah: 8000,
    imageQuota: 400,
    imageQuotaPeriod: 'period',
    chatQuotaUsd: 5,
    storageQuotaMb: 500,
    engines: 'all',
    featuresUk: [
      '400 генерацій зображень на місяць, пріоритет якості Nano Banana Pro (4K)',
      'ШІ-текст за мотивами зображення без обмежень (GPT та Gemini на вибір)',
      'Пріоритетна черга генерації в години пікового навантаження',
      'Усе з плану Start',
      '500 МБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '400 image generations per month, priority Nano Banana Pro quality (4K)',
      'Unlimited AI text from images (choice of GPT or Gemini)',
      'Priority generation queue during peak hours',
      'Everything in the Start plan',
      '500 MB photo album storage for your own uploads (jpg/png/svg), shared across all books',
    ],
    highlighted: true,
    badgeUk: 'Популярний вибір',
    badgeEn: 'Most popular',
  },
  ultra: {
    id: 'ultra',
    nameUk: 'Ultra',
    nameEn: 'Ultra',
    taglineUk: 'Для видавництв і команд',
    taglineEn: 'For publishing houses and teams',
    priceMonthlyUah: 2600,
    priceAnnualUah: 26000,
    imageQuota: 2000,
    imageQuotaPeriod: 'period',
    chatQuotaUsd: 20,
    storageQuotaMb: 2000,
    engines: 'all',
    featuresUk: [
      '2000 генерацій зображень на місяць — практично без обмежень',
      'Найвищий пріоритет обробки запитів у черзі генерації',
      'Пріоритетна підтримка команди NOVA STUDIO',
      'Усе з плану Pro',
      '2 ГБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '2000 image generations per month — practically unlimited',
      'Highest processing priority in the generation queue',
      'Priority support from the NOVA STUDIO team',
      'Everything in the Pro plan',
      '2 GB photo album storage for your own uploads (jpg/png/svg), shared across all books',
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'start', 'pro', 'ultra'];

/** Довжина періоду підписки в добах. Річний — календарний рік, а не 12×30. */
function periodDays(cycle: BillingCycle): number {
  return cycle === 'annual' ? 365 : 30;
}

export function priceFor(plan: PlanId, cycle: BillingCycle): number {
  const def = PLANS[plan];
  return cycle === 'annual' ? def.priceAnnualUah : def.priceMonthlyUah;
}

/** Публічний знімок тарифів для клієнта — щоб фронтенд не хардкодив ціни вдруге. */
export function plansSnapshot() {
  return {
    plans: PLAN_ORDER.map((id) => PLANS[id]),
    currency: 'UAH',
    annualDiscountNote:
      'Річна оплата = 10 місячних цін («2 місяці в подарунок»). Безкоштовний план — без оплати.',
    annualDiscountNoteEn:
      'Annual billing = 10 monthly prices ("2 months free"). The Free plan requires no payment.',
  };
}

/** Активна (або типова безкоштовна) підписка користувача. */
export async function resolveSubscription(userId: string): Promise<StoredSubscription> {
  const existing = await getSubscription(userId);
  if (existing) return existing;

  const now = new Date().toISOString();
  return {
    userId,
    plan: 'free',
    billingCycle: 'monthly',
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: now,
    createdAt: now,
    updatedAt: now,
  };
}

/** Активує (чи продовжує) підписку після успішної оплати. */
export async function activateSubscription(
  userId: string,
  plan: PlanId,
  cycle: BillingCycle,
  provider: 'liqpay' | 'paypal',
  providerRef?: string
): Promise<StoredSubscription> {
  const now = new Date();
  const end = new Date(now.getTime() + periodDays(cycle) * 86_400_000);
  const sub: StoredSubscription = {
    userId,
    plan,
    billingCycle: cycle,
    status: 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: end.toISOString(),
    provider,
    providerRef,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return upsertSubscription(sub);
}

export interface QuotaCheckResult {
  allowed: boolean;
  plan: PlanId;
  used: number;
  quota: number | null;
  remaining: number | null;
  reasonUk?: string;
}

/**
 * Перевіряє, чи користувач ще не вичерпав ліміт генерацій зображень
 * свого плану. admin/designer тощо не звільняються тут — обмеження суто
 * по тарифу, роль вирішує лише саму можливість (BASE_SERVER_PERMISSIONS).
 */
export async function checkImageQuota(userId: string, role: string): Promise<QuotaCheckResult> {
  // Адміністратор працює без лімітів тарифу — так само, як і раніше.
  if (role === 'admin') {
    return { allowed: true, plan: 'ultra', used: 0, quota: null, remaining: null };
  }

  const sub = await resolveSubscription(userId);
  const plan = (PLANS[sub.plan as PlanId] ? sub.plan : 'free') as PlanId;
  const def = PLANS[plan];

  if (def.imageQuota === null) {
    return { allowed: true, plan, used: 0, quota: null, remaining: null };
  }

  const since = def.imageQuotaPeriod === 'lifetime' ? '1970-01-01T00:00:00.000Z' : sub.currentPeriodStart;
  const records = await listUsageSince(since);
  const used = records.filter((r) => r.userId === userId && r.kind === 'image' && r.success).length;
  const remaining = Math.max(0, def.imageQuota - used);

  if (used >= def.imageQuota) {
    return {
      allowed: false,
      plan,
      used,
      quota: def.imageQuota,
      remaining: 0,
      reasonUk:
        plan === 'free'
          ? `Вичерпано безкоштовний ліміт (${def.imageQuota} зображень). Оберіть платний план на сторінці «Підписка».`
          : `Вичерпано місячний ліміт плану ${def.nameUk} (${def.imageQuota} зображень). Ліміт оновиться ${new Date(sub.currentPeriodEnd).toLocaleDateString('uk-UA')} або оберіть вищий план.`,
    };
  }

  return { allowed: true, plan, used, quota: def.imageQuota, remaining };
}

/**
 * Перевіряє, чи користувач ще не вичерпав місячний $-ліміт чат-сесій
 * свого плану (checkImageQuota рахує кількість, тут — гроші, бо вартість
 * повідомлення сильно залежить від моделі). Адмін працює без лімітів.
 *
 * Джерело лічильника — usage_log (kind='text', context='AI-асистент
 * (чат-сесія)'): саме туди пишеться кожна відповідь чату, і саме це бачить
 * адмінська вкладка «Витрати на API». Період — підписка користувача.
 *
 * @param usageContext мітка контексту чату (з server/chatRoutes.ts);
 *   задається явно, щоб subscriptions не залежав від chatRoutes.
 */
export async function checkChatQuota(
  userId: string,
  role: string,
  usageContext = 'AI-асистент (чат-сесія)'
): Promise<QuotaCheckResult> {
  if (role === 'admin') {
    return { allowed: true, plan: 'ultra', used: 0, quota: null, remaining: null };
  }

  const sub = await resolveSubscription(userId);
  const plan = (PLANS[sub.plan as PlanId] ? sub.plan : 'free') as PlanId;
  const def = PLANS[plan];

  if (def.chatQuotaUsd === null) {
    return { allowed: true, plan, used: 0, quota: null, remaining: null };
  }

  const records = await listUsageSince(sub.currentPeriodStart);
  const usedUsd = records
    .filter((r) => r.userId === userId && r.kind === 'text' && r.success && r.context === usageContext)
    .reduce((sum, r) => sum + (r.costUsd || 0), 0);
  const remaining = Math.max(0, def.chatQuotaUsd - usedUsd);

  if (usedUsd >= def.chatQuotaUsd) {
    return {
      allowed: false,
      plan,
      used: usedUsd,
      quota: def.chatQuotaUsd,
      remaining: 0,
      reasonUk:
        `Вичерпано місячний ліміт чат-витрат плану ${def.nameUk} ($${def.chatQuotaUsd}). ` +
        `Ліміт оновиться ${new Date(sub.currentPeriodEnd).toLocaleDateString('uk-UA')} або оберіть вищий план.`,
    };
  }

  return { allowed: true, plan, used: usedUsd, quota: def.chatQuotaUsd, remaining };
}

/**
 * Middleware для функцій, доступних лише певним платним планам (наприклад,
 * «Форматування файлу під KDP» — тільки Pro/Ultra). На відміну від
 * requireImageQuota, тут немає лічильника використання — це чисте
 * обмеження «є в тебе такий тариф чи нема». Адмін завжди проходить,
 * як і в усіх інших тарифних перевірках цього файлу.
 */
export function requirePlanAtLeast(allowed: PlanId[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const principal = req.principal;
    if (!principal || principal.isGuest || !principal.id) {
      res.status(403).json({ error: 'Ця функція доступна лише зареєстрованим користувачам з відповідним тарифом.', kind: 'plan_required' });
      return;
    }
    if (principal.role === 'admin') return next();

    try {
      const sub = await resolveSubscription(principal.id);
      const plan = (PLANS[sub.plan as PlanId] ? sub.plan : 'free') as PlanId;
      if (!allowed.includes(plan)) {
        const allowedNames = allowed.map((p) => PLANS[p].nameUk).join(' або ');
        res.status(403).json({
          error: `Ця функція доступна лише на тарифі ${allowedNames}. Ваш поточний тариф: ${PLANS[plan].nameUk}.`,
          kind: 'plan_required',
          requiredPlans: allowed,
          currentPlan: plan,
        });
        return;
      }
      next();
    } catch (err) {
      console.warn('[subscriptions] Не вдалося перевірити тариф для requirePlanAtLeast, блокуємо обережно:', err);
      res.status(500).json({ error: 'Не вдалося перевірити тарифний план.' });
    }
  };
}

/**
 * Middleware: ставиться ПІСЛЯ requirePermission('canGenerateImages').
 * Гість туди взагалі не доходить (403 раніше); тут лише зареєстровані
 * користувачі, для яких і має сенс лічити тарифну квоту.
 */
export function requireImageQuota() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const principal = req.principal;
    if (!principal || principal.isGuest || !principal.id) return next();

    try {
      const check = await checkImageQuota(principal.id, principal.role);
      if (!check.allowed) {
        res.status(402).json({
          error: check.reasonUk || 'Вичерпано ліміт генерацій вашого тарифу.',
          kind: 'quota_exceeded',
          plan: check.plan,
          quota: check.quota,
        });
        return;
      }
      next();
    } catch (err) {
      console.warn('[subscriptions] Не вдалося перевірити квоту, пропускаємо:', err);
      next();
    }
  };
}
