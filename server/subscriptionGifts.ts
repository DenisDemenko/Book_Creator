import { createHash, randomBytes } from 'node:crypto';
import { getDb } from './db';
import { sendViaGmail } from './mail';
import { readSqliteSubscription, insertSubscriptionRow } from './store';
import { periodDays, PLANS, type BillingCycle, type PlanId } from './subscriptions';

type GiftPlan = Exclude<PlanId, 'free'>;
type Gift = { serial: number; plan: GiftPlan; billing_cycle: BillingCycle; redeemed_at: string | null };

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

export class SubscriptionGiftError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function giftDb() {
  const db = getDb();
  if (!db) throw new SubscriptionGiftError(503, 'Сховище сертифікатів недоступне.');
  return db;
}

export async function issueSubscriptionGift(input: {
  userId: string;
  email: string;
  adminId: string;
  plan: GiftPlan;
  cycle: BillingCycle;
}) {
  const db = giftDb();
  const code = randomBytes(16).toString('hex').toUpperCase();
  const row = db.prepare(
    'INSERT INTO subscription_gifts (code_hash, user_id, issued_by, plan, billing_cycle, issued_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING serial',
  ).get(hashCode(code), input.userId, input.adminId, input.plan, input.cycle, new Date().toISOString()) as { serial: number };

  const subject = `NOVA Studio — подарунковий сертифікат №${row.serial}`;
  const duration = input.cycle === 'annual' ? 'рік' : 'місяць';
  const instructions = 'Увійдіть у NOVA Studio під акаунтом, на який надійшов лист, відкрийте сторінку підписок і введіть код у полі «Подарунковий сертифікат».';
  const description = `Тариф ${PLANS[input.plan].nameUk}, ${duration} без оплати.`;
  const sent = await sendViaGmail({
    to: input.email,
    subject,
    text: `${description}\nКод: ${code}\n\n${instructions}`,
    html: `<p>${description}</p><p>Код: <strong>${code}</strong></p><p>${instructions}</p>`,
  }).catch(() => ({ ok: false }));
  return { serial: row.serial, code, sent: sent.ok };
}

export function redeemSubscriptionGift(userId: string, rawCode: unknown) {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!/^[A-F0-9]{32}$/.test(code)) {
    throw new SubscriptionGiftError(400, 'Перевірте код подарункового сертифіката.');
  }
  const db = giftDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const gift = db.prepare(
      'SELECT serial, plan, billing_cycle, redeemed_at FROM subscription_gifts WHERE code_hash = ? AND user_id = ?',
    ).get(hashCode(code), userId) as Gift | undefined;
    if (!gift || gift.redeemed_at) {
      throw new SubscriptionGiftError(400, 'Сертифікат недійсний або вже використаний.');
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const existing = readSqliteSubscription(userId);
    const active = existing?.status === 'active'
      && existing.plan !== 'free'
      && Date.parse(existing.currentPeriodEnd) > now.getTime()
      ? existing : undefined;
    if (active && active.plan !== gift.plan) {
      throw new SubscriptionGiftError(409, 'Сертифікат можна активувати після завершення чинної підписки на інший тариф.');
    }
    const start = active ? Date.parse(active.currentPeriodEnd) : now.getTime();
    const end = new Date(start + periodDays(gift.billing_cycle) * 86_400_000).toISOString();
    insertSubscriptionRow({
      userId,
      plan: gift.plan,
      billingCycle: active?.billingCycle ?? gift.billing_cycle,
      status: 'active',
      currentPeriodStart: active?.currentPeriodStart ?? timestamp,
      currentPeriodEnd: end,
      provider: active?.provider ?? 'admin',
      providerRef: active?.providerRef ?? `gift:${gift.serial}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.prepare('UPDATE subscription_gifts SET redeemed_at = ? WHERE serial = ?').run(timestamp, gift.serial);
    db.exec('COMMIT');
    return { serial: gift.serial, plan: gift.plan, periodEnd: end };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
