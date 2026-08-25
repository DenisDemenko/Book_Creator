import React, { useState, useEffect, useCallback } from 'react';
import {
  Check,
  Sparkles,
  CreditCard,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Image as ImageIcon,
  Crown,
  Zap,
  Building2,
  Gift,
  HardDrive,
} from 'lucide-react';
import type { AuthUser } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

const MB = 1024 * 1024;

interface PlanDefinition {
  id: 'free' | 'start' | 'pro' | 'ultra';
  nameUk: string;
  nameEn: string;
  taglineUk: string;
  taglineEn: string;
  priceMonthlyUah: number;
  priceAnnualUah: number;
  imageQuota: number | null;
  imageQuotaPeriod: 'lifetime' | 'period';
  storageQuotaMb: number;
  engines: string[] | 'all';
  featuresUk: string[];
  featuresEn: string[];
  highlighted?: boolean;
  badgeUk?: string;
  badgeEn?: string;
}

interface PlansResponse {
  plans: PlanDefinition[];
  currency: string;
  annualDiscountNote: string;
  annualDiscountNoteEn: string;
  paymentProviders: {
    liqpay: { enabled: boolean; label: string; currency: string };
    paypal: { enabled: boolean; label: string; currency: string };
  };
}

interface SubscriptionInfo {
  subscription: { plan: string; billingCycle: 'monthly' | 'annual'; status: string; currentPeriodEnd: string };
  quota: { used: number; quota: number | null; remaining: number | null };
  storage?: { usedBytes: number; quotaBytes: number | null; remainingBytes: number | null };
  plan: PlanDefinition;
}

interface SubscriptionViewProps {
  authUser?: AuthUser | null;
}

const PLAN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  free: Gift,
  start: Zap,
  pro: Crown,
  ultra: Building2,
};

export const SubscriptionView: React.FC<SubscriptionViewProps> = ({ authUser }) => {
  const { lang, t } = useLanguage();
  const locale = lang === 'en' ? 'en-US' : 'uk-UA';
  const fmtUah = (n: number) => `${n.toLocaleString(locale)} ₴`;
  const planName = (p: PlanDefinition) => (lang === 'en' ? p.nameEn : p.nameUk);
  const planTagline = (p: PlanDefinition) => (lang === 'en' ? p.taglineEn : p.taglineUk);
  const planFeatures = (p: PlanDefinition) => (lang === 'en' ? p.featuresEn : p.featuresUk);
  const planBadge = (p: PlanDefinition) => (lang === 'en' ? p.badgeEn : p.badgeUk);

  const [data, setData] = useState<PlansResponse | null>(null);
  const [myInfo, setMyInfo] = useState<SubscriptionInfo | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanDefinition | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<'liqpay' | 'paypal' | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  const isRegistered = !!authUser && !authUser.isGuest;

  const loadMe = useCallback(async () => {
    if (!isRegistered) return;
    try {
      const res = await fetch('/api/subscription/me', { credentials: 'same-origin' });
      if (res.ok) setMyInfo(await res.json());
    } catch {
      /* тихо — інформаційний блок просто не покажеться */
    }
  }, [isRegistered]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/subscription/plans');
        setData(await res.json());
      } catch {
        setNotice({ kind: 'error', text: t('subscription.loadError') });
      } finally {
        setLoading(false);
      }
    })();
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMe]);

  // Повернення від платіжного провайдера (PayPal capture / LiqPay очікування).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('subscription');
    if (!status) return;

    const cleanUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('subscription');
      url.searchParams.delete('order');
      url.searchParams.delete('token');
      url.searchParams.delete('PayerID');
      window.history.replaceState({}, '', url.toString());
    };

    if (status === 'paypal_return') {
      const orderId = params.get('order');
      const paypalOrderId = params.get('token');
      if (!orderId || !paypalOrderId) {
        cleanUrl();
        return;
      }
      setNotice({ kind: 'info', text: t('subscription.confirmingPaypal') });
      fetch('/api/subscription/paypal/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ orderId, paypalOrderId }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || t('subscription.paypalConfirmFailed'));
          setNotice({ kind: 'success', text: t('subscription.paypalConfirmed') });
          loadMe();
        })
        .catch((err) => setNotice({ kind: 'error', text: err.message }))
        .finally(cleanUrl);
      return;
    }

    if (status === 'pending') {
      setNotice({ kind: 'info', text: t('subscription.pendingPrivatbank') });
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        await loadMe();
        if (attempts >= 6) clearInterval(poll);
      }, 3000);
      cleanUrl();
      return;
    }

    if (status === 'paypal_cancel') {
      setNotice({ kind: 'info', text: t('subscription.paypalCancelled') });
      cleanUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitLiqpay = async (plan: PlanDefinition) => {
    setCheckoutBusy('liqpay');
    setCheckoutError(null);
    try {
      const res = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ plan: plan.id, billingCycle: cycle, provider: 'liqpay' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t('subscription.liqpayPrepFailed'));

      // LiqPay вимагає класичний form-POST (не fetch) — так працює їхній checkout.
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = json.actionUrl;
      form.style.display = 'none';
      for (const [key, value] of Object.entries({ data: json.data, signature: json.signature })) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value as string;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (err: any) {
      setCheckoutError(err.message || t('subscription.paymentError'));
      setCheckoutBusy(null);
    }
  };

  const submitPaypal = async (plan: PlanDefinition) => {
    setCheckoutBusy('paypal');
    setCheckoutError(null);
    try {
      const res = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ plan: plan.id, billingCycle: cycle, provider: 'paypal' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t('subscription.paypalPrepFailed'));
      window.location.href = json.approveUrl;
    } catch (err: any) {
      setCheckoutError(err.message || t('subscription.paymentError'));
      setCheckoutBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 p-6">
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-sm">
          {t('subscription.loadErrorShort')}
        </div>
      </div>
    );
  }

  const currentPlanId = myInfo?.subscription?.plan;

  return (
    <div className="flex-1 p-4 lg:p-8 overflow-y-auto space-y-8 relative">
      <div className="orb-field -z-10 fixed inset-0 pointer-events-none">
        <div className="orb orb-amber orb-float w-[420px] h-[420px] -top-32 -right-24" />
        <div className="orb orb-cyan orb-float-slow w-[380px] h-[380px] bottom-0 -left-24" />
      </div>

      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full badge-glass text-[11px] font-bold text-amber-300 uppercase tracking-wider">
          <Sparkles className="w-3 h-3" />
          {t('subscription.badge')}
        </span>
        <h1 className="text-2xl lg:text-3xl font-bold font-heading">
          {t('subscription.heading')}
        </h1>
        <p className="text-sm text-slate-400">
          {t('subscription.priceIntro')} <b className="text-slate-300">PrivatBank (LiqPay)</b> {t('subscription.or')}{' '}
          <b className="text-slate-300">PayPal</b>. {lang === 'en' ? data.annualDiscountNoteEn : data.annualDiscountNote}
        </p>
      </div>

      {notice && (
        <div
          className={`max-w-2xl mx-auto p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            notice.kind === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
              : notice.kind === 'error'
              ? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
              : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-200'
          }`}
        >
          {notice.kind === 'info' && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          {notice.kind === 'success' && <Check className="w-4 h-4 shrink-0" />}
          {notice.kind === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Мій поточний тариф */}
      {isRegistered && myInfo && (
        <div className="max-w-2xl mx-auto p-4 rounded-2xl glass-panel flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
              <ShieldCheck className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs text-slate-400">{t('subscription.currentPlan')}</div>
              <div className="text-sm font-bold text-slate-100">{myInfo.plan ? planName(myInfo.plan) : t('subscription.freePlanName')}</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-xs">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-300">
                {myInfo.quota.quota === null
                  ? t('subscription.unlimitedImages')
                  : t('subscription.usedOfImages', { used: myInfo.quota.used, quota: myInfo.quota.quota })}
              </span>
            </div>
            {myInfo.storage && (
              <div className="flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-300">
                  {myInfo.storage.quotaBytes === null
                    ? t('subscription.storageUnlimited')
                    : t('subscription.storageUsage', {
                        used: (myInfo.storage.usedBytes / MB).toFixed(1),
                        quota: (myInfo.storage.quotaBytes / MB).toFixed(0),
                      })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Перемикач monthly/annual */}
      <div data-tour="subscription__1" className="flex items-center justify-center gap-1 p-1 rounded-xl badge-glass w-fit mx-auto">
        {(['monthly', 'annual'] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCycle(c)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              cycle === c ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {c === 'monthly' ? t('subscription.monthly') : t('subscription.annual')}
          </button>
        ))}
      </div>

      {/* Plan cards */}
      <div data-tour="subscription__2" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 max-w-6xl mx-auto">
        {data.plans.map((plan) => {
          const Icon = PLAN_ICONS[plan.id] || Gift;
          const price = cycle === 'annual' ? plan.priceAnnualUah : plan.priceMonthlyUah;
          const isCurrent = currentPlanId === plan.id;
          const isFree = plan.id === 'free';
          const badge = planBadge(plan);

          return (
            <div
              key={plan.id}
              className={`relative rounded-3xl p-5 flex flex-col gap-4 transition-all ${
                plan.highlighted ? 'glass-panel-elevated ring-1 ring-amber-500/40' : 'glass-panel'
              }`}
            >
              {badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 text-[10px] font-bold shadow-lg whitespace-nowrap">
                  {badge}
                </span>
              )}

              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                    plan.highlighted
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <div>
                  <div className="font-bold text-sm text-slate-100">{planName(plan)}</div>
                  <div className="text-[11px] text-slate-400">{planTagline(plan)}</div>
                </div>
              </div>

              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold font-heading text-slate-100">
                    {isFree ? t('subscription.free') : fmtUah(price)}
                  </span>
                  {!isFree && (
                    <span className="text-xs text-slate-400">/ {cycle === 'annual' ? t('subscription.perYear') : t('subscription.perMonth')}</span>
                  )}
                </div>
                {!isFree && cycle === 'annual' && (
                  <div className="text-[11px] text-emerald-400 mt-0.5">
                    {t('subscription.insteadOfPerYear', { price: fmtUah(plan.priceMonthlyUah * 12) })}
                  </div>
                )}
              </div>

              <ul className="space-y-2 flex-1">
                {planFeatures(plan).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold text-center">
                  {t('subscription.currentPlanBadge')}
                </div>
              ) : isFree ? (
                <div className="py-2.5 rounded-xl badge-glass text-slate-400 text-xs font-bold text-center">
                  {isRegistered ? t('subscription.defaultPlan') : t('subscription.availableAfterRegister')}
                </div>
              ) : (
                <button
                  data-tour={plan.highlighted ? 'subscription__3' : undefined}
                  onClick={() => {
                    setCheckoutPlan(plan);
                    setCheckoutError(null);
                  }}
                  disabled={!isRegistered}
                  className="py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-bold text-center transition-all"
                  title={isRegistered ? undefined : t('subscription.loginToSubscribe')}
                >
                  {t('subscription.chooseCta', { plan: planName(plan) })}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!isRegistered && (
        <p className="text-center text-xs text-slate-500 max-w-md mx-auto">
          {t('subscription.registeredOnly')}
        </p>
      )}

      {/* Checkout modal */}
      {checkoutPlan && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !checkoutBusy && setCheckoutPlan(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl glass-panel-elevated p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                {t('subscription.checkoutHeading', { plan: planName(checkoutPlan) })}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {fmtUah(cycle === 'annual' ? checkoutPlan.priceAnnualUah : checkoutPlan.priceMonthlyUah)} —{' '}
                {cycle === 'annual' ? t('subscription.perYearOnce') : t('subscription.monthly').toLowerCase()}
              </p>
            </div>

            {checkoutError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            <div className="space-y-2.5">
              <button
                data-tour="subscription__4"
                onClick={() => submitLiqpay(checkoutPlan)}
                disabled={!!checkoutBusy}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold text-xs transition-all disabled:opacity-60"
              >
                {checkoutBusy === 'liqpay' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CreditCard className="w-4 h-4" />
                )}
                <span>{t('subscription.payLiqpay')}</span>
              </button>
              <button
                data-tour="subscription__5"
                onClick={() => submitPaypal(checkoutPlan)}
                disabled={!!checkoutBusy}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#0070ba] hover:bg-[#005ea6] text-white font-bold text-xs transition-all disabled:opacity-60"
              >
                {checkoutBusy === 'paypal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="font-black italic">Pay</span>}
                <span>{t('subscription.payPaypal')}</span>
              </button>
              <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                {t('subscription.paypalNote')}
              </p>
            </div>

            <button
              onClick={() => setCheckoutPlan(null)}
              disabled={!!checkoutBusy}
              className="w-full py-2 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              {t('subscription.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
