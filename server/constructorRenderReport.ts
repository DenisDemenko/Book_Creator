import { constructorImageAccess, quoteConstructorImages, DEFAULT_CONSTRUCTOR_ENGINE } from './constructorImageEngines';
import { creditsForCostUsd } from './creditPricing';
import { priceForImage, SEEDREAM_ARK_MODEL, SEEDREAM_FAL_EDIT_MODEL } from './pricing';
import { PLAN_ORDER, PLANS, getActiveTaxRegime } from './subscriptions';
import { getPricingConfig, priceBreakdown, type TaxRegime } from './taxPricing';

const MARKUP_PERCENT = 30;
const FREE_CONSTRUCTOR_RENDERS = 5;
const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function constructorPlanProjection(
  plan: { id: string; credits: number; priceMonthlyUah: number; priceAnnualUah: number },
  rate: { costUsd: number; credits: number },
  regime: TaxRegime,
  fxUahPerUsd: number,
  annual: boolean,
) {
  const months = annual ? 12 : 1;
  const photos = plan.id === 'free'
    ? FREE_CONSTRUCTOR_RENDERS
    : Math.floor(plan.credits / rate.credits) * months;
  const photoCostUah = rate.costUsd * photos * fxUahPerUsd;
  const grossUah = annual ? plan.priceAnnualUah : plan.priceMonthlyUah;
  return {
    photos,
    ...priceBreakdown(regime, plan.id, grossUah, fxUahPerUsd, { imageCostUah: photoCostUah, months }),
    markupUah: roundMoney(photoCostUah * MARKUP_PERCENT / 100),
    markupRevenueUah: roundMoney(photoCostUah * (1 + MARKUP_PERCENT / 100)),
  };
}

export async function constructorRenderReport() {
  const access = await constructorImageAccess();
  const config = getPricingConfig();
  const regime = getActiveTaxRegime();
  const plans = PLAN_ORDER.map((id) => ({
    id,
    name: PLANS[id].nameUk,
    credits: PLANS[id].aiCredits,
    priceMonthlyUah: PLANS[id].priceMonthlyUah,
    priceAnnualUah: PLANS[id].priceAnnualUah,
  }));

  const rates = new Map<string, {
    id: string;
    modelId: string;
    label: string;
    provider: string;
    formats: string[];
    available: boolean;
    costUsd: number;
    credits: number;
  }>();
  for (const imageSize of ['1K', '2K', '4K']) {
    for (const engine of quoteConstructorImages(access, imageSize)) {
      const key = `${engine.id}:${engine.modelId}:${engine.costUsd}`;
      const format = engine.id === DEFAULT_CONSTRUCTOR_ENGINE ? '1 024 × 1 024' : engine.imageSize;
      const rate = rates.get(key);
      if (rate) {
        if (!rate.formats.includes(format)) rate.formats.push(format);
      } else {
        rates.set(key, { ...engine, formats: [format] });
      }
    }
  }

  const rectangle = quoteConstructorImages(access, '1K', '16:9').find((engine) => engine.id === DEFAULT_CONSTRUCTOR_ENGINE);
  if (rectangle) rates.set('openai:rectangle', { ...rectangle, formats: ['1 536 × 1 024 / 1 024 × 1 536'] });

  const secondarySeedream = access.seedreamViaFal
    ? { modelId: SEEDREAM_ARK_MODEL, label: 'Seedream (ByteDance, Ark)' }
    : { modelId: SEEDREAM_FAL_EDIT_MODEL, label: 'Seedream (через fal.ai)' };
  const secondaryCostUsd = priceForImage('seedream', '1K', secondarySeedream.modelId);
  if (secondaryCostUsd > 0) {
    rates.set('seedream:secondary', {
      ...secondarySeedream,
      id: 'seedream',
      provider: 'bytedance',
      formats: ['1K / 2K / 4K'],
      available: false,
      costUsd: secondaryCostUsd,
      credits: creditsForCostUsd(secondaryCostUsd),
    });
  }

  const rows = [...rates].map(([key, rate]) => ({
    key,
    label: rate.label,
    modelId: rate.modelId,
    provider: rate.provider,
    formats: rate.formats,
    available: rate.available,
    costUsd: rate.costUsd,
    credits: rate.credits,
    markupPriceUsd: rate.costUsd * (1 + MARKUP_PERCENT / 100),
    plans: plans.map((plan) => ({
      id: plan.id,
      monthly: constructorPlanProjection(plan, rate, regime, config.fxUahPerUsd, false),
      annual: constructorPlanProjection(plan, rate, regime, config.fxUahPerUsd, true),
    })),
  }));
  rows.sort((a, b) => Number(b.modelId.startsWith('gpt-image-')) - Number(a.modelId.startsWith('gpt-image-')));

  return { markupPercent: MARKUP_PERCENT, targetMarginPercent: config.targetMarginPercent, fx: config.fxUahPerUsd, taxRegime: regime.nameUk, plans, rows };
}

export type ConstructorRenderReport = Awaited<ReturnType<typeof constructorRenderReport>>;
