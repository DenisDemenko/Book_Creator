/**
 * LiqPay — платіжний шлюз ПриватБанку, єдиний спосіб приймати оплату в
 * гривні без міжнародної картки. UAH-ціни підписки (Start/Pro/Ultra)
 * оплачуються саме через нього; PayPal (server/payments/paypal.ts) не
 * підтримує UAH узагалі, тож рахує ту саму підписку в доларах.
 *
 * Протокол LiqPay навмисно простий і без SDK: JSON-параметри пакуються
 * в base64 (`data`), підпис — sha1(private_key + data + private_key),
 * теж у base64 (`signature`). Клієнт отримує обидва поля і сабмітить
 * прихованою HTML-формою на https://www.liqpay.ua/api/3/checkout —
 * саме так, як задокументовано в data_signature.
 *
 * Джерело: https://www.liqpay.ua/documentation/en/data_signature
 */

import crypto from 'node:crypto';

export const liqpayConfig = {
  publicKey: process.env.LIQPAY_PUBLIC_KEY || '',
  privateKey: process.env.LIQPAY_PRIVATE_KEY || '',
  get enabled(): boolean {
    return !!(this.publicKey && this.privateKey);
  },
};

export const LIQPAY_CHECKOUT_URL = 'https://www.liqpay.ua/api/3/checkout';

export interface LiqpayCheckoutParams {
  amount: number;
  currency: string;
  description: string;
  orderId: string;
  resultUrl: string;
  serverUrl: string;
}

function sign(data: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(liqpayConfig.privateKey + data + liqpayConfig.privateKey)
    .digest();
  return hash.toString('base64');
}

/** Формує пару data+signature для форми оплати. */
export function buildCheckout(params: LiqpayCheckoutParams): {
  data: string;
  signature: string;
  actionUrl: string;
} {
  const payload = {
    public_key: liqpayConfig.publicKey,
    version: '3',
    action: 'pay',
    amount: params.amount,
    currency: params.currency,
    description: params.description,
    order_id: params.orderId,
    result_url: params.resultUrl,
    server_url: params.serverUrl,
    language: 'uk',
  };
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return { data, signature: sign(data), actionUrl: LIQPAY_CHECKOUT_URL };
}

/** Перевіряє підпис вебхука/колбека LiqPay сталим за часом порівнянням. */
export function verifySignature(data: string, signature: string): boolean {
  if (!data || !signature) return false;
  const expected = sign(data);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface LiqpayCallbackPayload {
  status: string;
  order_id: string;
  amount: number;
  currency: string;
  payment_id?: number | string;
  err_description?: string;
}

/** Розпаковує base64 `data` з колбека у обʼєкт. */
export function parseCallbackData(data: string): LiqpayCallbackPayload {
  return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
}

/** Статуси LiqPay, що означають успішну (чи в процесі) оплату. */
export const LIQPAY_SUCCESS_STATUSES = new Set(['success', 'sandbox', 'wait_accept']);
export const LIQPAY_FAILURE_STATUSES = new Set(['failure', 'error', 'reversed', 'expired']);
