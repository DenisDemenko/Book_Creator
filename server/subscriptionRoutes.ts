/**
 * Маршрути тарифів, оформлення підписки та оплати.
 *
 * Оплата у два кроки для обох провайдерів:
 *   1. POST /checkout — сервер готує платіж (LiqPay data+signature, або
 *      PayPal order+approveUrl) і повертає клієнту, що саме
 *      відправляти/куди редіректити.
 *   2. Підтвердження: LiqPay сам стукає на /liqpay/callback (server_url,
 *      подія «сервер-сервер», без участі браузера користувача) — саме
 *      там активується підписка. PayPal, навпаки, вимагає явного
 *      POST /paypal/capture з фронтенду після повернення користувача
 *      зі сторінки схвалення — тому там підписка активується одразу
 *      в обробнику капчі.
 *
 * Жоден платіж не активує підписку «по дорозі»: спочатку створюється
 * запис payments зі статусом pending, і лише коли провайдер підтвердив
 * гроші, він переводиться в paid і лише тоді активується підписка.
 */

import crypto from 'node:crypto';
import type { Express } from 'express';
import { requireAuth } from './auth';
import { recordPayment, updatePaymentStatus } from './store';
import {
  PLANS,
  PLAN_ORDER,
  plansSnapshot,
  priceFor,
  resolveSubscription,
  activateSubscription,
  checkImageQuota,
  type PlanId,
  type BillingCycle,
} from './subscriptions';
import { getStorageUsage } from './mediaStorage';
import { liqpayConfig, buildCheckout, verifySignature, parseCallbackData, LIQPAY_SUCCESS_STATUSES } from './payments/liqpay';
import { paypalConfig, createOrder, captureOrder, uahToUsd } from './payments/paypal';

function appBaseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  return process.env.APP_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
}

function isValidPlan(plan: unknown): plan is PlanId {
  return typeof plan === 'string' && (PLAN_ORDER as string[]).includes(plan) && plan !== 'free';
}

function isValidCycle(cycle: unknown): cycle is BillingCycle {
  return cycle === 'monthly' || cycle === 'annual';
}

export function registerSubscriptionRoutes(app: Express): void {
  /** Публічні тарифи — доступно й гостю, це маркетингова сторінка. */
  app.get('/api/subscription/plans', (_req, res) => {
    res.json({
      ...plansSnapshot(),
      paymentProviders: {
        liqpay: { enabled: liqpayConfig.enabled, label: 'PrivatBank (LiqPay)', currency: 'UAH' },
        paypal: { enabled: paypalConfig.enabled, label: 'PayPal', currency: 'USD' },
      },
    });
  });

  /** Підписка поточного користувача + скільки генерацій лишилось. */
  app.get('/api/subscription/me', requireAuth, async (req, res) => {
    try {
      const userId = req.principal!.id as string;
      const sub = await resolveSubscription(userId);
      const quota = await checkImageQuota(userId, req.principal!.role);
      const storage = await getStorageUsage(userId, req.principal!.role);
      res.json({ subscription: sub, quota, storage, plan: PLANS[sub.plan as PlanId] || PLANS.free });
    } catch (err) {
      console.error('[subscription] me:', err);
      res.status(500).json({ error: 'Не вдалося завантажити дані підписки.' });
    }
  });

  /** Крок 1: підготувати оплату. Повертає дані для LiqPay-форми або посилання PayPal. */
  app.post('/api/subscription/checkout', requireAuth, async (req, res) => {
    try {
      const { plan, billingCycle, provider } = req.body || {};
      if (!isValidPlan(plan)) {
        return res.status(400).json({ error: 'Невідомий тарифний план.' });
      }
      if (!isValidCycle(billingCycle)) {
        return res.status(400).json({ error: 'Невідомий період оплати (monthly / annual).' });
      }
      if (provider !== 'liqpay' && provider !== 'paypal') {
        return res.status(400).json({ error: 'Оберіть спосіб оплати: liqpay або paypal.' });
      }

      const amountUah = priceFor(plan, billingCycle);
      const userId = req.principal!.id as string;
      const orderId = `sub-${userId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const description = `NOVA STUDIO — план ${PLANS[plan].nameUk} (${billingCycle === 'annual' ? 'рік' : 'місяць'})`;
      const base = appBaseUrl(req);

      if (provider === 'liqpay') {
        if (!liqpayConfig.enabled) {
          return res.status(503).json({
            error: 'Оплата через PrivatBank (LiqPay) ще не налаштована. Задайте LIQPAY_PUBLIC_KEY та LIQPAY_PRIVATE_KEY.',
          });
        }
        await recordPayment({
          id: orderId,
          userId,
          provider: 'liqpay',
          plan,
          billingCycle,
          amount: amountUah,
          currency: 'UAH',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        const checkout = buildCheckout({
          amount: amountUah,
          currency: 'UAH',
          description,
          orderId,
          resultUrl: `${base}/?subscription=pending`,
          serverUrl: `${base}/api/subscription/liqpay/callback`,
        });
        return res.json({ provider: 'liqpay', orderId, amountUah, ...checkout });
      }

      // provider === 'paypal'
      if (!paypalConfig.enabled) {
        return res.status(503).json({
          error: 'Оплата через PayPal ще не налаштована. Задайте PAYPAL_CLIENT_ID та PAYPAL_CLIENT_SECRET.',
        });
      }
      const order = await createOrder({
        amountUah,
        description,
        orderId,
        returnUrl: `${base}/?subscription=paypal_return&order=${orderId}`,
        cancelUrl: `${base}/?subscription=paypal_cancel`,
      });
      await recordPayment({
        id: orderId,
        userId,
        provider: 'paypal',
        plan,
        billingCycle,
        amount: Number(order.amountUsd),
        currency: 'USD',
        status: 'pending',
        externalId: order.orderId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      res.json({
        provider: 'paypal',
        orderId,
        paypalOrderId: order.orderId,
        approveUrl: order.approveUrl,
        amountUsd: order.amountUsd,
        exchangeNote: `Курс орієнтовний: ${amountUah} грн ≈ ${order.amountUsd} $ (PayPal не приймає UAH).`,
      });
    } catch (err: any) {
      console.error('[subscription] checkout:', err);
      res.status(500).json({ error: err?.message || 'Не вдалося підготувати оплату.' });
    }
  });

  /**
   * LiqPay стукає сюди сервер-сервер після завершення оплати (server_url).
   * Це НЕ той запит, що бачить браузер користувача — result_url окремий.
   */
  app.post('/api/subscription/liqpay/callback', async (req, res) => {
    try {
      const { data, signature } = req.body || {};
      if (typeof data !== 'string' || typeof signature !== 'string' || !verifySignature(data, signature)) {
        console.warn('[subscription] LiqPay callback з недійсним підписом');
        return res.status(400).json({ error: 'Недійсний підпис.' });
      }

      const payload = parseCallbackData(data);
      // order_id — це і є id запису платежу (ми самі його згенерували в /checkout).

      if (!LIQPAY_SUCCESS_STATUSES.has(payload.status)) {
        await updatePaymentStatus(payload.order_id, 'failed', String(payload.payment_id || ''));
        console.warn(`[subscription] LiqPay: платіж ${payload.order_id} не успішний (${payload.status})`);
        return res.json({ ok: true });
      }

      const updated = await updatePaymentStatus(payload.order_id, 'paid', String(payload.payment_id || ''));
      if (updated) {
        await activateSubscription(updated.userId, updated.plan as PlanId, updated.billingCycle, 'liqpay', String(payload.payment_id || ''));
        console.log(`[subscription] LiqPay: активовано план ${updated.plan} для ${updated.userId}`);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[subscription] liqpay callback:', err);
      res.status(500).json({ error: 'Помилка обробки колбека LiqPay.' });
    }
  });

  /** Крок 2 для PayPal: користувач повернувся зі сторінки схвалення — фіксуємо гроші. */
  app.post('/api/subscription/paypal/capture', requireAuth, async (req, res) => {
    try {
      const { orderId, paypalOrderId } = req.body || {};
      if (typeof orderId !== 'string' || typeof paypalOrderId !== 'string') {
        return res.status(400).json({ error: 'Відсутній ідентифікатор замовлення.' });
      }

      const capture = await captureOrder(paypalOrderId);
      if (capture.status !== 'COMPLETED') {
        await updatePaymentStatus(orderId, 'failed', capture.captureId);
        return res.status(402).json({ error: `PayPal не підтвердив оплату (статус ${capture.status}).` });
      }

      const updated = await updatePaymentStatus(orderId, 'paid', capture.captureId);
      if (!updated) {
        return res.status(404).json({ error: 'Платіж не знайдено.' });
      }
      if (updated.userId !== req.principal!.id) {
        return res.status(403).json({ error: 'Це замовлення належить іншому користувачу.' });
      }

      const sub = await activateSubscription(updated.userId, updated.plan as PlanId, updated.billingCycle, 'paypal', capture.captureId);
      res.json({ ok: true, subscription: sub });
    } catch (err: any) {
      console.error('[subscription] paypal capture:', err);
      res.status(500).json({ error: err?.message || 'Не вдалося підтвердити оплату PayPal.' });
    }
  });
}
