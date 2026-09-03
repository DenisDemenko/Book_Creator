import React, { useState } from 'react';
import { ProfitCalcState } from '../../types/etsyMarket';
import { GlassCard } from './GlassCard';
import { GlassButton } from './GlassButton';
import { GlassToggle } from './GlassToggle';
import {
  Calculator,
  DollarSign,
  TrendingUp,
  Percent,
  Package,
  Truck,
  Sparkles,
  HelpCircle,
  PiggyBank,
  Receipt,
  Scale,
  Download,
  RotateCcw,
  Tag
} from 'lucide-react';
import confetti from 'canvas-confetti';

/**
 * Тарифи Etsy, з яких рахує калькулятор.
 *
 * Винесені сюди з двох причин. Перша: ставки 6.5% і 3% були вписані в
 * розрахунок ДВІЧІ — у комісіях і в формулі точки беззбитковості, — тож
 * зміна тарифу в одному місці мовчки розійшлася б з іншим, і два числа на
 * одному екрані почали б суперечити одне одному. Друга: тариф — не
 * константа природи. Etsy змінює ставки, а комісія за обробку платежу
 * взагалі залежить від країни продавця; нижче зафіксовані ставки Etsy
 * Payments для США станом на дату в LAST_VERIFIED. Продавцю з іншої країни
 * ці числа дадуть не його маржу, тому дата стоїть просто в підзаголовку —
 * там, де її прочитають до того, як побудують на розрахунку ціну.
 */
const ETSY_LISTING_FEE_USD = 0.2;
const ETSY_TRANSACTION_RATE = 0.065;
const ETSY_PAYMENT_RATE = 0.03;
const ETSY_PAYMENT_FIXED_USD = 0.25;
const ETSY_PLUS_MONTHLY_USD = 10;
const FEES_LAST_VERIFIED = 'вересень 2025';

interface FeeCalculatorViewProps {
  /**
   * Валюта відображення. За замовчуванням долар США і курс 1:1 — і це
   * навмисно: комісії Etsy встановлені в доларах ($0.20 за лістинг, 6.5%
   * транзакційна, 3% + $0.25 за обробку платежу), а курсу до гривні в
   * студії немає. Перерахунок за вигаданим курсом зробив би з точного
   * розрахунку приблизний, не попередивши про це. Хто передасть реальний
   * курс — отримає перерахунок; за замовчуванням числа лишаються тими,
   * якими їх бачить сам Etsy.
   */
  currencySymbol?: string;
  currencyRate?: number;
}

export const FeeCalculatorView: React.FC<FeeCalculatorViewProps> = ({
  currencySymbol = '$',
  currencyRate = 1,
}) => {
  const [state, setState] = useState<ProfitCalcState>({
    itemSalePrice: 38.0,
    shippingCharged: 0.0, // Free shipping
    itemCost: 9.5,
    shippingCost: 4.8,
    packagingCost: 1.2,
    marketingBudgetPerItem: 2.0,
    monthlySalesQuantity: 85,
    offsiteAdsRate: 0.15, // 15%
    isEtsyPlus: false,
    isDomesticFreeShipping: true,
    discountPercent: 0,
  });

  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiPricingAdvice, setAiPricingAdvice] = useState<string | null>(null);
  const [aiAdviceModel, setAiAdviceModel] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const effectiveSalePrice = state.itemSalePrice * (1 - state.discountPercent / 100);
  const totalBuyerPays = effectiveSalePrice + state.shippingCharged;

  // Etsy Fees
  const listingFee = ETSY_LISTING_FEE_USD;
  const transactionFee = totalBuyerPays * ETSY_TRANSACTION_RATE;
  const paymentProcessingFee = totalBuyerPays * ETSY_PAYMENT_RATE + ETSY_PAYMENT_FIXED_USD;
  const offsiteAdsFee = effectiveSalePrice * state.offsiteAdsRate;
  const etsyPlusMonthlyPerItem = state.isEtsyPlus
    ? ETSY_PLUS_MONTHLY_USD / (state.monthlySalesQuantity || 1)
    : 0;

  const totalEtsyFeesPerUnit =
    listingFee + transactionFee + paymentProcessingFee + offsiteAdsFee + etsyPlusMonthlyPerItem;

  const totalCOGS =
    state.itemCost + state.shippingCost + state.packagingCost + state.marketingBudgetPerItem;

  const netProfitPerUnit = totalBuyerPays - totalEtsyFeesPerUnit - totalCOGS;
  const profitMarginPercent =
    totalBuyerPays > 0 ? (netProfitPerUnit / totalBuyerPays) * 100 : 0;
  const roiPercent = totalCOGS > 0 ? (netProfitPerUnit / totalCOGS) * 100 : 0;

  const monthlyTotalRevenue = totalBuyerPays * state.monthlySalesQuantity;
  const monthlyTotalNetProfit = netProfitPerUnit * state.monthlySalesQuantity;
  const monthlyTotalEtsyFees = totalEtsyFeesPerUnit * state.monthlySalesQuantity;

  // Breakeven price
  // Знаменник теоретично може дійти до нуля (Offsite Ads 90.5% і вище) —
  // тоді ціни беззбитковості просто не існує, і показати «нескінченність»
  // чесніше, ніж поділити й вивести стрибок у мільйони.
  const breakevenDenominator =
    1 - ETSY_TRANSACTION_RATE - ETSY_PAYMENT_RATE - state.offsiteAdsRate;
  const breakevenPrice =
    breakevenDenominator > 0
      ? (totalCOGS + listingFee + ETSY_PAYMENT_FIXED_USD) / breakevenDenominator
      : Number.POSITIVE_INFINITY;
  /** Показ ціни беззбитковості: «—», коли її не існує. */
  const breakevenLabel = Number.isFinite(breakevenPrice)
    ? `${currencySymbol}${(breakevenPrice * currencyRate).toFixed(2)}`
    : '—';

  const handleApplyPreset = (type: 'digital' | 'ceramic' | 'jewelry' | 'clothing') => {
    if (type === 'digital') {
      setState({
        itemSalePrice: 14.99,
        shippingCharged: 0,
        itemCost: 0,
        shippingCost: 0,
        packagingCost: 0,
        marketingBudgetPerItem: 1.5,
        monthlySalesQuantity: 240,
        offsiteAdsRate: 0,
        isEtsyPlus: true,
        isDomesticFreeShipping: true,
        discountPercent: 0,
      });
    } else if (type === 'ceramic') {
      setState({
        itemSalePrice: 35.0,
        shippingCharged: 0,
        itemCost: 7.5,
        shippingCost: 5.5,
        packagingCost: 1.8,
        marketingBudgetPerItem: 2.2,
        monthlySalesQuantity: 90,
        offsiteAdsRate: 0.15,
        isEtsyPlus: false,
        isDomesticFreeShipping: true,
        discountPercent: 0,
      });
    } else if (type === 'jewelry') {
      setState({
        itemSalePrice: 48.0,
        shippingCharged: 0,
        itemCost: 11.0,
        shippingCost: 4.2,
        packagingCost: 2.5,
        marketingBudgetPerItem: 3.0,
        monthlySalesQuantity: 110,
        offsiteAdsRate: 0.12,
        isEtsyPlus: true,
        isDomesticFreeShipping: true,
        discountPercent: 10,
      });
    } else if (type === 'clothing') {
      setState({
        itemSalePrice: 42.0,
        shippingCharged: 5.0,
        itemCost: 14.0,
        shippingCost: 6.0,
        packagingCost: 2.0,
        marketingBudgetPerItem: 2.5,
        monthlySalesQuantity: 65,
        offsiteAdsRate: 0.15,
        isEtsyPlus: false,
        isDomesticFreeShipping: false,
        discountPercent: 0,
      });
    }
    setAiPricingAdvice(null);
    confetti({ particleCount: 20, spread: 35 });
  };

  const handleResetCalculator = () => {
    setState({
      itemSalePrice: 30.0,
      shippingCharged: 0,
      itemCost: 8.0,
      shippingCost: 4.0,
      packagingCost: 1.0,
      marketingBudgetPerItem: 2.0,
      monthlySalesQuantity: 50,
      offsiteAdsRate: 0,
      isEtsyPlus: false,
      isDomesticFreeShipping: true,
      discountPercent: 0,
    });
    setAiPricingAdvice(null);
  };

  const handleExportCsv = () => {
    const rows = [
      ['ETSY PROFIT & FEES BREAKDOWN', ''],
      ['Item Sale Price', `${currencySymbol}${(state.itemSalePrice * currencyRate).toFixed(2)}`],
      ['Discount %', `${state.discountPercent}%`],
      ['Effective Sale Price', `${currencySymbol}${(effectiveSalePrice * currencyRate).toFixed(2)}`],
      ['Shipping Charged to Buyer', `${currencySymbol}${(state.shippingCharged * currencyRate).toFixed(2)}`],
      ['Total Buyer Pays', `${currencySymbol}${(totalBuyerPays * currencyRate).toFixed(2)}`],
      [''],
      ['COGS Breakdown', ''],
      ['Item Materials/Production', `${currencySymbol}${(state.itemCost * currencyRate).toFixed(2)}`],
      ['Actual Shipping Cost', `${currencySymbol}${(state.shippingCost * currencyRate).toFixed(2)}`],
      ['Packaging Cost', `${currencySymbol}${(state.packagingCost * currencyRate).toFixed(2)}`],
      ['Marketing Per Item', `${currencySymbol}${(state.marketingBudgetPerItem * currencyRate).toFixed(2)}`],
      ['Total COGS Per Unit', `${currencySymbol}${(totalCOGS * currencyRate).toFixed(2)}`],
      [''],
      ['Etsy Fees Breakdown', ''],
      ['Listing Fee', `${currencySymbol}${(listingFee * currencyRate).toFixed(2)}`],
      ['Transaction Fee (6.5%)', `${currencySymbol}${(transactionFee * currencyRate).toFixed(2)}`],
      ['Payment Processing (3% + $0.25)', `${currencySymbol}${(paymentProcessingFee * currencyRate).toFixed(2)}`],
      ['Offsite Ads Fee', `${currencySymbol}${(offsiteAdsFee * currencyRate).toFixed(2)}`],
      ['Total Etsy Fees Per Unit', `${currencySymbol}${(totalEtsyFeesPerUnit * currencyRate).toFixed(2)}`],
      [''],
      ['Profitability Summary', ''],
      ['Net Profit Per Unit', `${currencySymbol}${(netProfitPerUnit * currencyRate).toFixed(2)}`],
      ['Profit Margin %', `${profitMarginPercent.toFixed(2)}%`],
      ['ROI %', `${roiPercent.toFixed(2)}%`],
      ['Monthly Sales Qty', state.monthlySalesQuantity],
      ['Monthly Net Profit', `${currencySymbol}${(monthlyTotalNetProfit * currencyRate).toFixed(2)}`],
      ['Monthly Total Revenue', `${currencySymbol}${(monthlyTotalRevenue * currencyRate).toFixed(2)}`],
      ['Breakeven Price', breakevenLabel],
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `etsy_fee_calculation_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    confetti({ particleCount: 25, spread: 45 });
  };

  const handleAiPricingAnalysis = async () => {
    setIsAiAnalyzing(true);
    setAiError(null);
    try {
      const res = await fetch('/api/market/advisor', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'pricing',
          question: `Проаналізуй фінансову модель товару на Etsy:
Ціна продажу: $${state.itemSalePrice}, Знижка: ${state.discountPercent}%, Доставка: $${state.shippingCharged}.
Собівартість виробу: $${state.itemCost}, Доставка витрати: $${state.shippingCost}, Упаковка: $${state.packagingCost}.
Чистий прибуток на шт: $${netProfitPerUnit.toFixed(2)}, Маржа: ${profitMarginPercent.toFixed(1)}%, Продажі/міс: ${state.monthlySalesQuantity} шт.
Offsite Ads: ${state.offsiteAdsRate * 100}%.
Дай 3 конкретні практичні рекомендації щодо підвищення маржинальності, AOV (середнього чека) та оптимізації рекламних витрат для Etsy.`,
        }),
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      // Мовчазний console.error ховав від автора саме ті випадки, коли
      // порада не прийшла через тариф або відсутній ключ провайдера, —
      // кнопка просто переставала блимати. Причину показуємо в картці.
      if (!res.ok) {
        setAiError(data?.error || `Помилка ${res.status}`);
        return;
      }
      if (!data?.answer) {
        setAiError('Модель повернула порожню відповідь.');
        return;
      }
      setAiPricingAdvice(data.answer);
      setAiAdviceModel(typeof data.modelId === 'string' ? data.modelId : null);
      confetti({ particleCount: 30, spread: 50 });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Не вдалося звернутися до консультанта.');
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Preset Quick Selectors */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Calculator className="w-5 h-5 text-amber-300" />
              Калькулятор комісій Etsy та чистого прибутку
            </h3>
            <p className="text-xs text-white/70 mt-0.5">
              Ставки Etsy Payments для США станом на {FEES_LAST_VERIFIED}: лістинг $0.20,
              транзакційна 6.5%, обробка платежу 3% + $0.25, плюс Offsite Ads. Комісія за
              обробку платежу залежить від країни продавця — звірте свою в налаштуваннях Etsy.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-white/70 font-semibold">Готові шаблони:</span>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => handleApplyPreset('ceramic')}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white border border-white/20 transition-all"
              >
                Кераміка
              </button>
              <button
                onClick={() => handleApplyPreset('digital')}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white border border-white/20 transition-all"
              >
                Цифровий товар
              </button>
              <button
                onClick={() => handleApplyPreset('jewelry')}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white border border-white/20 transition-all"
              >
                Ювелірка
              </button>
              <button
                onClick={() => handleApplyPreset('clothing')}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white border border-white/20 transition-all"
              >
                Одяг
              </button>
              <button
                onClick={handleResetCalculator}
                className="px-2 py-1 rounded-lg bg-white/5 hover:bg-rose-500/20 text-xs text-white/60 hover:text-rose-200 border border-white/10 transition-all flex items-center gap-1"
                title="Скинути до стандартних"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Inputs Matrix */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <GlassCard title="Параметри ціни та собівартості">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Sale Price */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                  Ціна продажу ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={state.itemSalePrice}
                  onChange={(e) =>
                    setState({ ...state, itemSalePrice: parseFloat(e.target.value) || 0 })
                  }
                  className="glass-input text-base font-bold"
                />
              </div>

              {/* Shipping Charged to Buyer */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                  Доставка для покупця ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={state.shippingCharged}
                  onChange={(e) =>
                    setState({ ...state, shippingCharged: parseFloat(e.target.value) || 0 })
                  }
                  className="glass-input"
                  placeholder="0 для Free Shipping"
                />
              </div>

              {/* Discount Slider */}
              <div className="sm:col-span-2 flex flex-col gap-1.5 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-white/80 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-amber-300" /> Знижка / Sale на Etsy:
                  </span>
                  <span className="font-bold text-amber-300">{state.discountPercent}% OFF</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={state.discountPercent}
                  onChange={(e) =>
                    setState({ ...state, discountPercent: parseInt(e.target.value) || 0 })
                  }
                  className="accent-amber-400 cursor-pointer"
                />
                {state.discountPercent > 0 && (
                  <span className="text-[11px] text-white/60">
                    Фактична ціна зі знижкою: {currencySymbol}{(effectiveSalePrice * currencyRate).toFixed(2)}
                  </span>
                )}
              </div>

              {/* Item Cost */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                  Собівартість виробу / матеріали ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={state.itemCost}
                  onChange={(e) =>
                    setState({ ...state, itemCost: parseFloat(e.target.value) || 0 })
                  }
                  className="glass-input"
                />
              </div>

              {/* Shipping Cost */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                  Фактична вартість доставки ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={state.shippingCost}
                  onChange={(e) =>
                    setState({ ...state, shippingCost: parseFloat(e.target.value) || 0 })
                  }
                  className="glass-input"
                />
              </div>

              {/* Packaging */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                  Упаковка & маркетинг ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={state.packagingCost + state.marketingBudgetPerItem}
                  onChange={(e) =>
                    setState({
                      ...state,
                      packagingCost: parseFloat(e.target.value) * 0.4 || 0,
                      marketingBudgetPerItem: parseFloat(e.target.value) * 0.6 || 0,
                    })
                  }
                  className="glass-input"
                />
              </div>

              {/* Monthly Volume */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-white/80">
                  Очікувані продажі / міс (шт)
                </label>
                <input
                  type="number"
                  value={state.monthlySalesQuantity}
                  onChange={(e) =>
                    setState({
                      ...state,
                      monthlySalesQuantity: parseInt(e.target.value) || 1,
                    })
                  }
                  className="glass-input"
                />
              </div>
            </div>

            {/* Advanced Toggles */}
            <div className="mt-5 pt-4 border-t border-white/15 flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white block">
                    Etsy Offsite Ads
                  </span>
                  <span className="text-[11px] text-white/60">
                    Зовнішня реклама Google/Facebook від Etsy
                  </span>
                </div>
                <div className="glass-tabs-container">
                  {[
                    { rate: 0, label: 'Вимк (0%)' },
                    { rate: 0.12, label: '12% (>10k)' },
                    { rate: 0.15, label: '15% (<10k)' },
                  ].map((opt) => (
                    <button
                      key={opt.rate}
                      type="button"
                      onClick={() => setState({ ...state, offsiteAdsRate: opt.rate })}
                      className={`glass-tab-btn py-1 px-2.5 text-xs ${
                        state.offsiteAdsRate === opt.rate ? 'active' : ''
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <GlassToggle
                  checked={state.isEtsyPlus}
                  onChange={(chk) => setState({ ...state, isEtsyPlus: chk })}
                  label="Підписка Etsy Plus ($10/міс)"
                  sublabel="Включає 15 безкоштовних лістингів та $5 Etsy Ads кредит"
                />
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Right Financial Results Matrix */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          {/* Main Profit Card */}
          <GlassCard
            className="bg-gradient-to-br from-white/25 via-white/15 to-emerald-500/15 border-emerald-400/40"
            headerAction={
              <div className="flex items-center gap-2">
                <GlassButton
                  variant="secondary"
                  size="sm"
                  onClick={handleExportCsv}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Експорт CSV
                </GlassButton>
                <GlassButton
                  variant="primary"
                  size="sm"
                  onClick={handleAiPricingAnalysis}
                  isLoading={isAiAnalyzing}
                  icon={<Sparkles className="w-3.5 h-3.5 text-amber-200" />}
                >
                  ШІ-Аналіз
                </GlassButton>
              </div>
            }
          >
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-200">
              Підсумок прибутковості
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-4">
              <div className="p-3.5 rounded-xl bg-black/20 border border-white/15">
                <span className="text-[10px] text-white/60 uppercase font-semibold">
                  Чистий прибуток / шт
                </span>
                <div className="text-2xl font-black text-emerald-300 mt-0.5">
                  {currencySymbol}
                  {(netProfitPerUnit * currencyRate).toFixed(2)}
                </div>
                <span className="text-[10px] text-white/70">за одиницю товару</span>
              </div>

              <div className="p-3.5 rounded-xl bg-black/20 border border-white/15">
                <span className="text-[10px] text-white/60 uppercase font-semibold">
                  Маржа прибутку
                </span>
                <div
                  className={`text-2xl font-black mt-0.5 ${
                    profitMarginPercent >= 40
                      ? 'text-emerald-300'
                      : profitMarginPercent >= 20
                      ? 'text-amber-300'
                      : 'text-rose-300'
                  }`}
                >
                  {profitMarginPercent.toFixed(1)}%
                </div>
                <span className="text-[10px] text-white/70">від обороту</span>
              </div>

              <div className="p-3.5 rounded-xl bg-black/20 border border-white/15 col-span-2 sm:col-span-1">
                <span className="text-[10px] text-white/60 uppercase font-semibold">
                  ROI інвестицій
                </span>
                <div className="text-2xl font-black text-white mt-0.5">
                  {roiPercent.toFixed(0)}%
                </div>
                <span className="text-[10px] text-white/70">рентабельність витрат</span>
              </div>
            </div>

            {/* Monthly Forecast Bar */}
            <div className="p-4 rounded-xl bg-white/15 border border-white/20 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-white/75">
                  Місячний чистий дохід ({state.monthlySalesQuantity} замовлень):
                </span>
                <div className="text-2xl font-extrabold text-white mt-0.5">
                  {currencySymbol}
                  {(monthlyTotalNetProfit * currencyRate).toLocaleString('en-US', {
                    maximumFractionDigits: 0,
                  })}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-white/70">Оборот:</span>
                <div className="text-sm font-bold text-white/90">
                  {currencySymbol}
                  {(monthlyTotalRevenue * currencyRate).toLocaleString('en-US', {
                    maximumFractionDigits: 0,
                  })}
                </div>
              </div>
            </div>

            {/* Fee Breakdown List */}
            <div className="mt-5 pt-4 border-t border-white/15 flex flex-col gap-2 text-xs">
              <span className="font-bold uppercase tracking-wider text-white/80 text-[11px] mb-1">
                Структура витрат на одиницю ({currencySymbol}
                {(totalBuyerPays * currencyRate).toFixed(2)}):
              </span>

              <div className="flex justify-between text-white/80 py-1 border-b border-white/10">
                <span>Etsy Listing Fee:</span>
                <span className="font-semibold text-white">
                  {currencySymbol}{(listingFee * currencyRate).toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between text-white/80 py-1 border-b border-white/10">
                <span>Etsy Transaction Fee (6.5%):</span>
                <span className="font-semibold text-white">
                  {currencySymbol}{(transactionFee * currencyRate).toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between text-white/80 py-1 border-b border-white/10">
                <span>Платіжна комісія (3% + $0.25):</span>
                <span className="font-semibold text-white">
                  {currencySymbol}{(paymentProcessingFee * currencyRate).toFixed(2)}
                </span>
              </div>

              {state.offsiteAdsRate > 0 && (
                <div className="flex justify-between text-white/80 py-1 border-b border-white/10">
                  <span>Offsite Ads ({(state.offsiteAdsRate * 100).toFixed(0)}%):</span>
                  <span className="font-semibold text-rose-300">
                    {currencySymbol}{(offsiteAdsFee * currencyRate).toFixed(2)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-amber-200 font-bold py-1.5">
                <span>Точка беззбитковості (Breakeven Price):</span>
                <span>
                  {breakevenLabel}
                </span>
              </div>
            </div>
          </GlassCard>

          {aiError && (
            <GlassCard className="border-rose-400/40 bg-rose-500/10 p-4">
              <p className="text-xs text-rose-100">{aiError}</p>
            </GlassCard>
          )}

          {/* AI Pricing Advice Card */}
          {aiPricingAdvice && (
            <GlassCard
              title="ШІ-Поради з оптимізації прибутку"
              badge={
                <span className="glass-badge bg-amber-400/20 text-amber-200 text-xs">
                  {aiAdviceModel || 'Консультант ядра'}
                </span>
              }
              className="bg-gradient-to-r from-white/20 to-amber-500/10 border-amber-400/30 animate-fadeIn"
            >
              <div className="text-xs text-white/90 leading-relaxed whitespace-pre-line p-3 rounded-xl bg-black/20 border border-white/10">
                {aiPricingAdvice}
              </div>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
};

