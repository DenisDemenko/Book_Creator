/**
 * PayPal — другий спосіб оплати підписки, для користувачів без
 * української картки. PayPal НЕ підтримує UAH як валюту транзакції
 * (офіційний список валют: developer.paypal.com/docs/reports/reference/
 * paypal-supported-currencies — UAH там немає), тож PayPal-платежі
 * рахуються в USD за курсом із PAYPAL_UAH_TO_USD_RATE. Це наближення,
 * яке варто тримати актуальним вручну (або підключити зовнішній курс),
 * а не факт, зафіксований назавжди в коді.
 *
 * Протокол — стандартний PayPal Orders API v2: OAuth client-credentials
 * токен → POST /v2/checkout/orders (CAPTURE-намір) → після схвалення
 * користувачем POST /v2/checkout/orders/{id}/capture.
 * Джерело: https://developer.paypal.com/api/orders/v2/orders-create
 */

export const paypalConfig = {
  clientId: process.env.PAYPAL_CLIENT_ID || '',
  clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  env: (process.env.PAYPAL_ENV || 'sandbox') as 'sandbox' | 'live',
  /** Скільки USD за 1 UAH. Приблизний курс — оновлюйте через env, не хардкодом. */
  uahToUsdRate: Number(process.env.PAYPAL_UAH_TO_USD_RATE) || 0.024,
  get enabled(): boolean {
    return !!(this.clientId && this.clientSecret);
  },
};

function apiBase(): string {
  return paypalConfig.env === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

/** Гривня → долар для транзакції PayPal. Округлення до 2 знаків, мінімум 0.5$. */
export function uahToUsd(amountUah: number): string {
  const usd = Math.max(0.5, amountUah * paypalConfig.uahToUsdRate);
  return usd.toFixed(2);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.value;
  }
  const basic = Buffer.from(`${paypalConfig.clientId}:${paypalConfig.clientSecret}`).toString('base64');
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`PayPal OAuth не вдався: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

export interface CreateOrderParams {
  amountUah: number;
  description: string;
  orderId: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CreateOrderResult {
  orderId: string;
  approveUrl: string;
  amountUsd: string;
}

export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  const token = await getAccessToken();
  const amountUsd = uahToUsd(params.amountUah);

  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': params.orderId,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: params.orderId,
          description: params.description,
          amount: { currency_code: 'USD', value: amountUsd },
        },
      ],
      application_context: {
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        brand_name: 'NOVA STUDIO',
        user_action: 'PAY_NOW',
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`PayPal не прийняв замовлення: HTTP ${res.status} ${detail}`);
  }

  const json = (await res.json()) as {
    id: string;
    links: { rel: string; href: string }[];
  };
  const approveLink = json.links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!approveLink) throw new Error('PayPal не повернув посилання для підтвердження оплати.');

  return { orderId: json.id, approveUrl: approveLink.href, amountUsd };
}

export interface CaptureResult {
  status: string;
  orderId: string;
  captureId?: string;
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const json = (await res.json()) as {
    status: string;
    id: string;
    purchase_units?: { payments?: { captures?: { id: string }[] } }[];
  };

  if (!res.ok) {
    throw new Error(`PayPal capture не вдався: HTTP ${res.status} ${JSON.stringify(json)}`);
  }

  const captureId = json.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  return { status: json.status, orderId: json.id, captureId };
}
