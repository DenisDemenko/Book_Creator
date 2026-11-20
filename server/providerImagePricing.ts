import { getAppSetting, setAppSetting } from './store';
import { IMAGE_PRICING, imagePriceEntries, setImagePriceOverrides } from './pricing';

const SETTING = 'imagePricing.providerRates.v1';
const REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

type ConfirmedPrice = {
  costUsd: number;
  sourceUrl: string;
  updatedAt: string;
  updatedBy: string;
};

type PricingReview = {
  revision: number;
  reviewedAt: string | null;
  reviewedBy: string | null;
  prices: Record<string, ConfirmedPrice>;
};

let state: PricingReview = { revision: 0, reviewedAt: null, reviewedBy: null, prices: {} };
let pendingWrite = Promise.resolve();

export class ProviderImagePricingError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) {
    super(message);
  }
}

function applyPricingReview(next: PricingReview) {
  setImagePriceOverrides(Object.fromEntries(
    Object.entries(next.prices).map(([key, price]) => [key, price.costUsd]),
  ));
  state = next;
}

export async function loadProviderImagePricing() {
  const raw = await getAppSetting(SETTING);
  if (!raw) return;
  const saved: PricingReview = JSON.parse(raw);
  applyPricingReview(saved);
}

export function providerPricingReview(now = Date.now()) {
  const dueAt = state.reviewedAt
    ? new Date(Date.parse(state.reviewedAt) + REVIEW_INTERVAL_MS).toISOString()
    : null;
  return {
    revision: state.revision,
    reviewedAt: state.reviewedAt,
    dueAt,
    due: dueAt === null || Date.parse(dueAt) <= now,
  };
}

export function confirmedProviderImagePrice(key: string) {
  return Object.hasOwn(state.prices, key) ? state.prices[key] : null;
}

export async function saveProviderImagePricing(input: unknown, actorId: string) {
  const change = pendingWrite.then(async () => {
    if (!input || typeof input !== 'object') throw new ProviderImagePricingError('Некоректна зміна тарифу.');
    const request = input as {
      revision?: unknown;
      action?: unknown;
      key?: unknown;
      costUsd?: unknown;
      sourceUrl?: unknown;
    };
    if (request.revision !== state.revision)
      throw new ProviderImagePricingError('Тарифи вже оновлено в іншій вкладці. Оновіть таблицю й перевірте ціни.', 409);

    const now = new Date().toISOString();
    const next = { ...state, revision: state.revision + 1 };

    if (request.action === 'review') {
      next.reviewedAt = now;
      next.reviewedBy = actorId;
    } else if (request.action === 'price') {
      const key = request.key;
      const costUsd = request.costUsd;
      const exists = typeof key === 'string' && Object.keys(IMAGE_PRICING).some(
        (tableId) => imagePriceEntries(tableId).some((entry) => entry.key === key),
      );
      if (!exists || typeof key !== 'string') throw new ProviderImagePricingError('Невідомий тариф рушія.');
      const micros = typeof costUsd === 'number' ? Math.round(costUsd * 1_000_000) : NaN;
      if (!Number.isSafeInteger(micros) || micros < 1)
        throw new ProviderImagePricingError('Вкажіть додатну вартість у USD за одне зображення.');

      let url: URL;
      try {
        if (typeof request.sourceUrl !== 'string' || request.sourceUrl.length > 2_048) throw Error();
        url = new URL(request.sourceUrl);
        if (url.protocol !== 'https:' || url.username || url.password) throw Error();
      } catch {
        throw new ProviderImagePricingError('Додайте HTTPS-посилання на прайс або історію списань провайдера.');
      }
      next.prices = {
        ...state.prices,
        [key]: { costUsd: micros / 1_000_000, sourceUrl: url.href, updatedAt: now, updatedBy: actorId },
      };
    } else {
      throw new ProviderImagePricingError('Невідома дія з тарифом.');
    }

    await setAppSetting(SETTING, JSON.stringify(next));
    applyPricingReview(next);
    return providerPricingReview();
  });
  pendingWrite = change.then(() => {}, () => {});
  return change;
}
