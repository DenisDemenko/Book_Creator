/**
 * Тарифні плани NOVA STUDIO.
 *
 * Місячні ціни платних планів НЕ задані вручну: їх рахує server/taxPricing.ts
 * за активним податковим режимом (ПДВ 20% / ФОП III 5% / 3%+ПДВ / без ПДВ) із
 * цільовою валовою маржею 30%, вирівняні вгору до кратного 10 (до 1000 грн)
 * або 100 грн. Значення в PLANS нижче — початкові; applyTaxRegime()
 * перезаписує їх при старті сервера й при перемиканні режиму в адмін-панелі.
 * Безкоштовний план — з лімітом 10 генерацій зображень.
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
import { getSubscription, upsertSubscription, listUsageSince, getAppSetting, setAppSetting, type StoredSubscription } from './store';
import {
  DEFAULT_TAX_REGIME,
  TAX_REGIMES,
  getPricingConfig,
  isTaxRegimeId,
  mergePricingConfig,
  planCreditsFor,
  setPricingConfig,
  textBudgetUah,
  monthlyPriceUah,
  type TaxRegime,
  type TaxRegimeId,
} from './taxPricing';

/** Ліміт текстових AI-витрат на період підписки, $ (бюджет у ₴ за курсом цін; змінюється з адмінки). */
export function textBudgetUsd(): number {
  const c = getPricingConfig();
  return c.textBudgetUah / c.fxUahPerUsd;
}

export type PlanId = 'free' | 'start' | 'pro' | 'ultra' | 'team';
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
   * AI-бали (ТЗ v0.5): Free — 300 одноразово, платні — щомісяця. Поки це дані
   * тарифу для показу й розрахунку цін; списання з гаманця (quote → reserve →
   * charge) ще не підключене, тож реально діє imageQuota.
   */
  aiCredits: number;
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
    aiCredits: planCreditsFor('free'),
    chatQuotaUsd: null,
    storageQuotaMb: 100,
    engines: ['nano-banana-2-lite', 'nano-banana-2'],
    featuresUk: [
      '300 пробних AI-балів одноразово (≈ 6 зображень Nano Banana Lite)',
      'Необмежене редагування тексту та AI-редактор (правки, граматика, стиль)',
      'Персонажі, сценарій, зміст, сноски та QR-теги — без обмежень',
      'Попередній перегляд книги та базовий експорт PDF',
      'Спільна робота в реальному часі з іншими авторами',
      '100 МБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '300 trial AI credits, one-time (≈ 6 Nano Banana Lite images)',
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
    aiCredits: planCreditsFor('start'),
    chatQuotaUsd: textBudgetUsd(),
    storageQuotaMb: 200,
    engines: 'all',
    featuresUk: [
      '2 000 AI-балів на місяць (≈ 41 зображення Lite або ≈ 20 Nano Banana 2), усі рушії; залишок згоряє',
      'Повний експорт: PDF, DOCX, EPUB під видавничі стандарти',
      'Історія версій книги з відновленням будь-якого зліпка',
      'Усе з плану «Безкоштовний»',
      '200 МБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '2,000 AI credits per month (≈ 41 Lite or ≈ 20 Nano Banana 2 images), all engines; unused credits expire',
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
    aiCredits: planCreditsFor('pro'),
    chatQuotaUsd: textBudgetUsd(),
    storageQuotaMb: 500,
    engines: 'all',
    featuresUk: [
      '5 000 AI-балів на місяць (≈ 104 зображення Lite або ≈ 52 Nano Banana 2), у т.ч. Nano Banana Pro',
      'ШІ-текст (GPT та Gemini на вибір) у межах 200 грн текстових витрат на період',
      'Пріоритетна черга генерації в години пікового навантаження',
      'Усе з плану Start',
      '500 МБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '5,000 AI credits per month (≈ 104 Lite or ≈ 52 Nano Banana 2 images), incl. Nano Banana Pro',
      'AI text (choice of GPT or Gemini) within a 200 UAH text-spend limit per period',
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
    aiCredits: planCreditsFor('ultra'),
    chatQuotaUsd: textBudgetUsd(),
    storageQuotaMb: 2000,
    engines: 'all',
    featuresUk: [
      '25 000 AI-балів на місяць (≈ 520 зображень Lite або ≈ 260 Nano Banana 2)',
      'Найвищий пріоритет обробки запитів у черзі генерації',
      'Пріоритетна підтримка команди NOVA STUDIO',
      'Усе з плану Pro',
      '2 ГБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '25,000 AI credits per month (≈ 520 Lite or ≈ 260 Nano Banana 2 images)',
      'Highest processing priority in the generation queue',
      'Priority support from the NOVA STUDIO team',
      'Everything in the Pro plan',
      '2 GB photo album storage for your own uploads (jpg/png/svg), shared across all books',
    ],
  },
  team: {
    id: 'team',
    nameUk: 'Team',
    nameEn: 'Team',
    taglineUk: 'Для видавництв з великим обсягом ілюстрацій',
    taglineEn: 'For publishers with a large illustration volume',
    priceMonthlyUah: 0,
    priceAnnualUah: 0,
    imageQuota: 4000,
    imageQuotaPeriod: 'period',
    aiCredits: planCreditsFor('team'),
    chatQuotaUsd: textBudgetUsd(),
    storageQuotaMb: 5000,
    engines: 'all',
    featuresUk: [
      '50 000 AI-балів на місяць (≈ 1 041 зображення Lite або ≈ 520 Nano Banana 2)',
      'Найвищий пріоритет обробки запитів у черзі генерації',
      'Пріоритетна підтримка команди NOVA STUDIO',
      'Усе з плану Ultra',
      '5 ГБ фотоальбому для власних завантажень (jpg/png/svg), загалом на всі книги',
    ],
    featuresEn: [
      '50,000 AI credits per month (≈ 1,041 Lite or ≈ 520 Nano Banana 2 images)',
      'Highest processing priority in the generation queue',
      'Priority support from the NOVA STUDIO team',
      'Everything in the Ultra plan',
      '5 GB photo album storage for your own uploads (jpg/png/svg), shared across all books',
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'start', 'pro', 'ultra', 'team'];

export const TAX_REGIME_SETTING_KEY = 'subscriptions.taxRegime';
export const PRICING_CONFIG_SETTING_KEY = 'subscriptions.pricingConfig';
let activeTaxRegime: TaxRegimeId = DEFAULT_TAX_REGIME;

export function getActiveTaxRegime(): TaxRegime {
  return TAX_REGIMES[activeTaxRegime];
}

/**
 * Єдина точка, де коригування адміна переходять у підписки: за активним
 * режимом і поточним PricingConfig перераховує ціни планів (річна = 10
 * місячних), пакети балів і ліміт тексту. Формула списання балів читає той
 * самий конфіг (server/creditPricing.ts), тож розходження неможливе.
 */
export function applyPricing(): void {
  const regime = TAX_REGIMES[activeTaxRegime];
  for (const planId of PLAN_ORDER) {
    PLANS[planId].aiCredits = planCreditsFor(planId);
    if (planId === 'free') continue;
    const monthly = monthlyPriceUah(regime, planId);
    PLANS[planId].priceMonthlyUah = monthly;
    PLANS[planId].priceAnnualUah = monthly * 10;
    PLANS[planId].chatQuotaUsd = textBudgetUsd();
  }
}

export function applyTaxRegime(id: TaxRegimeId): void {
  activeTaxRegime = id;
  applyPricing();
}

/** Зберігає й застосовує нові параметри цін/балів. Кидає Error, якщо значення некоректні. */
export async function updatePricingConfig(patch: unknown) {
  const next = mergePricingConfig(getPricingConfig(), patch); // валідація до запису
  await setAppSetting(PRICING_CONFIG_SETTING_KEY, JSON.stringify(next));
  setPricingConfig(next);
  applyPricing();
  return getPricingConfig();
}

/** Читає збережений режим зі сховища (старт сервера). Невідоме значення → типовий. */
export async function loadTaxRegime(): Promise<TaxRegimeId> {
  try {
    const raw = await getAppSetting(PRICING_CONFIG_SETTING_KEY);
    if (raw) setPricingConfig(JSON.parse(raw));
  } catch (err) {
    console.warn('[subscriptions] Збережені параметри цін пошкоджені, беремо типові:', err);
  }
  const stored = await getAppSetting(TAX_REGIME_SETTING_KEY);
  applyTaxRegime(isTaxRegimeId(stored) ? stored : DEFAULT_TAX_REGIME);
  return activeTaxRegime;
}

export async function setTaxRegime(id: TaxRegimeId): Promise<void> {
  await setAppSetting(TAX_REGIME_SETTING_KEY, id);
  applyTaxRegime(id);
}

applyTaxRegime(DEFAULT_TAX_REGIME);

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
    tax: {
      regime: activeTaxRegime,
      vatIncluded: TAX_REGIMES[activeTaxRegime].vatIncluded,
      vatPercent: TAX_REGIMES[activeTaxRegime].vatPercent,
    },
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
  provider: 'liqpay' | 'paypal' | 'admin',
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
 * Чи може користувач запускати генерацію зображення: перевіряє баланс AI-балів
 * (server/creditGate.ts). Старі ліміти за КІЛЬКІСТЮ зображень прибрано за
 * рішенням власника 20.10.2026. Поля used/quota/remaining тепер у балах.
 * Адмін працює без лімітів; без SQLite чи за AI_CREDITS_DISABLED=1 — теж.
 */
export async function checkImageQuota(userId: string, role: string): Promise<QuotaCheckResult> {
  const sub = await resolveSubscription(userId);
  const plan = (PLANS[sub.plan as PlanId] ? sub.plan : 'free') as PlanId;
  const unlimited: QuotaCheckResult = { allowed: true, plan: role === 'admin' ? 'ultra' : plan, used: 0, quota: null, remaining: null };
  if (role === 'admin') return unlimited;

  const { creditStatus } = await import('./creditGate');
  const { unlimited: off, balance } = await creditStatus(userId, role);
  if (off || !balance) return unlimited;

  const quota = PLANS[plan].aiCredits;
  const remaining = balance.available;
  // Найдешевше зображення коштує 18 балів — менше за це вже нічого не згенерувати.
  if (remaining < 18) {
    const renewal = new Date(sub.currentPeriodEnd).toLocaleDateString('uk-UA');
    return {
      allowed: false,
      plan,
      used: Math.max(0, quota - remaining),
      quota,
      remaining,
      reasonUk:
        plan === 'free'
          ? 'Пробні AI-бали вичерпано. Оберіть платний план на сторінці «Підписка».'
          : `Бали плану ${PLANS[plan].nameUk} на цей місяць вичерпано. Нові нарахуються ${renewal} або оберіть вищий план.`,
    };
  }
  return { allowed: true, plan, used: Math.max(0, quota - remaining), quota, remaining };
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
  _usageContext = 'AI-асистент (чат-сесія)'
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
    .filter((r) => r.userId === userId && r.kind === 'text' && r.success)
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
        `Вичерпано ліміт текстових AI-витрат плану ${def.nameUk} (${textBudgetUah()} грн на період). ` +
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
