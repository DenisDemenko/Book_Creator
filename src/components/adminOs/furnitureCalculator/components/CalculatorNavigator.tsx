/**
 * Навігатор сторінки «Управління цінами»: підменю швидкого переходу по
 * розділах калькулятора і блок керування (шаблони, Excel, курс, КП…).
 *
 * Сторінка довга — понад півтора десятка карток, — тож власник попросив
 * тримати зміст і кнопки «завжди під рукою». На широкому екрані обидва блоки
 * живуть у колонці «Інспектор вузла» адмінки (калькулятор кладе їх туди
 * через portal, див. `inspectorSlot` у FurnitureCalculatorPanel), на вузькому
 * — згорнутою панеллю в липкому рядку «Розділи» під шапкою.
 *
 * Ідентифікатори розділів — ті самі `id`, що вже стоять на картках
 * (`wood-section-card` тощо), плюс чотири обгортки в самій панелі. Порядок
 * списку — порядок на сторінці: від нього залежить, який розділ вважається
 * «поточним», коли в смузі видно кілька одразу.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Check,
  ChevronDown,
  Coins,
  Copy,
  FileSpreadsheet,
  FolderOpen,
  ListTree,
  Printer,
  Save,
} from 'lucide-react';
import { CalculationInput, CalculationResult, Currency, CurrencyRates } from '../types';
import { formatMoney } from '../utils/calculator';

export interface CalcSection {
  id: string;
  label: string;
}

export const CALC_SECTIONS: CalcSection[] = [
  { id: 'calc-tariff-publish', label: 'Публікація тарифів столів' },
  { id: 'calc-constructor-tariffs', label: 'Єдині тарифи конструкторів' },
  { id: 'calc-material-prices', label: 'Довідник: ДСП, фанера, слеби' },
  { id: 'calc-summary', label: 'Підсумок собівартості та ціни' },
  { id: 'wood-section-card', label: 'Деревина, сушіння, доставка' },
  { id: 'epoxy-section-card', label: 'Епоксидна смола й опалубка' },
  { id: 'finish-section-card', label: 'Фініш і абразиви' },
  { id: 'cnc-section-card', label: 'ЧПУ обробка' },
  { id: 'electronics-section-card', label: 'Електроніка та LED' },
  { id: 'labor-section-card', label: 'Команда й оплата праці' },
  { id: 'base-hardware-card', label: 'Металокаркас і фурнітура' },
  { id: 'packaging-delivery-card', label: 'Упаковка та доставка' },
  { id: 'depreciation-utilities-card', label: 'Амортизація й комунальні' },
  { id: 'taxes-profit-card', label: 'Податки та маржа' },
  { id: 'ai-media-cost-card', label: 'AI-контент для продажу' },
  { id: 'expense-board-overhead-card', label: 'Накладні з борду витрат' },
  { id: 'production-timeline-card', label: 'Графік виробництва' },
];

/** Відступ над розділом після переходу — щоб липка шапка калькулятора його не накрила. */
const SCROLL_GAP_PX = 16;

/**
 * Поточний розділ за прокруткою.
 *
 * IntersectionObserver стежить, які розділи перетинають смугу від низу липкої
 * шапки до ~45 % висоти вікна. Серед них поточним вважається той, чий верх
 * найближче під шапкою (найнижчий верх, що вже дійшов до лінії читання), —
 * а не «перший за порядком»: частина карток стоїть у дві колонки, і висока
 * ліва картка інакше «перебивала» б правого сусіда. Окремий випадок — дно
 * сторінки: останні короткі розділи можуть так і не дійти до лінії читання,
 * тож у самому низу підсвічуємо останній.
 *
 * Повертає також перелік розділів, що справді мають вміст: блок тарифів
 * конструкторів, наприклад, без даних не малює нічого, і пункт меню на
 * порожнє місце лише заплутував би.
 */
export function useActiveCalcSection(sections: CalcSection[], topOffsetPx: number) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const [presentIds, setPresentIds] = useState<string[]>(() => sections.map((s) => s.id));
  // Під час плавної прокрутки після кліку спостерігач перебирав би всі
  // проміжні розділи — підсвітка «бігла» б. Тримаємо обраний до кінця руху.
  const lockUntil = useRef(0);
  const lockTicket = useRef(0);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const idsKey = sections.map((s) => s.id).join('|');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ids = idsKey.split('|');
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const readingLine = Math.round(topOffsetPx) + SCROLL_GAP_PX + 8;
    const visible = new Set<string>();

    const refreshPresent = () => {
      const next = ids.filter((id) => (document.getElementById(id)?.offsetHeight ?? 0) > 0);
      setPresentIds((prev) => (prev.join('|') === next.join('|') ? prev : next));
    };

    const pick = () => {
      if (Date.now() < lockUntil.current) return;
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
        const last = [...ids].reverse().find((id) => (document.getElementById(id)?.offsetHeight ?? 0) > 0);
        if (last) setActiveId(last);
        return;
      }
      let best: { id: string; top: number } | null = null;
      for (const id of ids) {
        if (!visible.has(id)) continue;
        const top = Math.round(document.getElementById(id)!.getBoundingClientRect().top);
        if (top > readingLine) continue;
        // Рівний верх (картки в одному ряду) — лишаємо вже обраний, щоб
        // клік по правій картці не перескакував на ліву.
        if (!best || top > best.top || (top === best.top && id === activeRef.current)) best = { id, top };
      }
      if (!best) best = ids.filter((id) => visible.has(id)).map((id) => ({ id, top: 0 }))[0] ?? null;
      if (best) setActiveId(best.id);
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target.id);
            else visible.delete(entry.target.id);
          }
          pick();
        },
        { rootMargin: `-${Math.max(0, Math.round(topOffsetPx))}px 0px -55% 0px`, threshold: 0 },
      );
      elements.forEach((el) => observer!.observe(el));
    }
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refreshPresent) : null;
    elements.forEach((el) => resize?.observe(el));
    refreshPresent();
    // Смуга перетинів не змінюється, поки картка рухається всередині неї, —
    // тож «найближчий до лінії читання» перераховуємо й на прокрутці.
    window.addEventListener('scroll', pick, { passive: true });
    return () => {
      observer?.disconnect();
      resize?.disconnect();
      window.removeEventListener('scroll', pick);
    };
  }, [idsKey, topOffsetPx]);

  const goTo = useCallback(
    (id: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.scrollMarginTop = `${Math.round(topOffsetPx) + SCROLL_GAP_PX}px`;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Замок до кінця руху: `scrollend`, де браузер його має, інакше — таймер.
      // Тривалість плавної прокрутки залежить від відстані, тож фіксованих
      // 900 мс бракувало, і підсвітка встигала перескочити на сусіда.
      lockUntil.current = Number.POSITIVE_INFINITY;
      const ticket = ++lockTicket.current;
      const release = () => {
        window.removeEventListener('scrollend', release);
        // Таймер попереднього кліку не знімає замок нового переходу.
        if (ticket === lockTicket.current) lockUntil.current = Date.now() + 150;
      };
      window.addEventListener('scrollend', release);
      window.setTimeout(release, 2000);
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      setActiveId(id);
    },
    [topOffsetPx],
  );

  const presentSections = sections.filter((s) => presentIds.includes(s.id));
  return { activeId, goTo, presentSections };
}

/** Текст «Скопіювати» — раніше жив у CostBreakdownDashboard разом із кнопкою. */
export function buildCostSummaryText(input: CalculationInput, result: CalculationResult, currency: Currency): string {
  return `📊 Розрахунок вартості виробу з дерева та епоксидної смоли:
- Матеріали (деревина, смола, лак, опалубка, метал, упаковка): ${formatMoney(result.materialsCostTotal, currency)}
${input.includeElectronics ? `- Електроніка та LED (БЖ, стрічка, плата, аксесуари): ${formatMoney(result.totalElectronicsMaterialsCost, currency)}\n- Оплата пайщика (монтаж та пайка електроніки): ${formatMoney(result.soldererLaborCost, currency)}\n` : ''}- Оплата праці (столяр, збірник, дизайнер, менеджер, директор): ${formatMoney(result.laborCostTotal, currency)}
- ЧПУ фрезерування: ${formatMoney(result.totalCncCost, currency)}${input.includeRouterBitCost !== false ? ` (верстат: ${formatMoney(result.cncMachineCost, currency)}, оператор: ${formatMoney(result.cncOperatorCost, currency)}, амортизація фрези: ${formatMoney(result.routerBitDepreciationPerProduct, currency)})` : ''}
- Амортизація та комунальні платежі: ${formatMoney(result.totalOverheadCost, currency)}
- AI-контент для продажу (GPT фото 20 шт + Runway промо-відео): ${formatMoney(result.totalAiMediaCostUah, currency)} ($${result.totalAiMediaCostUsd.toFixed(2)})
- Накладні з борду витрат (ШІ+Railway+інше на одиницю): ${formatMoney(result.expenseBoardOverheadCostUah, currency)} ($${result.expenseBoardOverheadCostUsd.toFixed(2)})
- Доставка клієнту: ${formatMoney(result.finalDeliveryCost, currency)}
---------------------------------------------
🏷️ Повна собівартість: ${formatMoney(result.fullCostPrice, currency)}
💰 Чистий прибуток (${input.profitMarginPercent}%): ${formatMoney(result.netProfit, currency)}
🏛️ Податки (${input.taxRatePercent}%): ${formatMoney(result.taxAmount, currency)}
✨ РЕКОМЕНДОВАНА ЦІНА ДЛЯ КЛІЄНТА: ${formatMoney(result.totalSellingPrice, currency)}`;
}

export interface CalculatorControlsProps {
  input: CalculationInput;
  result: CalculationResult;
  currency: Currency;
  rates: CurrencyRates;
  onOpenTemplates: () => void;
  onSaveAsTemplate: () => void;
  onExportExcel: () => void;
  onOpenCurrencySettings: () => void;
  onOpenApplyToProduct: () => void;
  onOpenCommercialOffer: () => void;
}

const SECTION_LABEL = "font-['Barlow_Condensed',system-ui,sans-serif] text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[rgba(181,217,253,.7)]";

/** Кнопки, що раніше стояли в шапці «Підсумку собівартості та ціни». */
export const CalculatorControls: React.FC<CalculatorControlsProps> = ({
  input,
  result,
  currency,
  rates,
  onOpenTemplates,
  onSaveAsTemplate,
  onExportExcel,
  onOpenCurrencySettings,
  onOpenApplyToProduct,
  onOpenCommercialOffer,
}) => {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildCostSummaryText(input, result, currency));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2500);
    }
  };

  const pill =
    'px-3 py-2 rounded-xl neo-pill-default text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 hover:text-white min-w-0';

  return (
    <div className="flex flex-col gap-2" data-calc-controls="1">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onOpenTemplates} className={`${pill} text-cyan-300`} title="Переглянути або обрати шаблон виробу за категоріями">
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
          <span className="truncate">Шаблони</span>
        </button>
        <button type="button" onClick={onSaveAsTemplate} className={pill} title="Зберегти поточні налаштування в мої шаблони">
          <Save className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
          <span className="truncate">Зберегти як шаблон</span>
        </button>
        <button
          type="button"
          onClick={onExportExcel}
          className={`${pill} font-semibold text-emerald-400 hover:text-emerald-300 border border-emerald-500/30`}
          title="Експорт повної калькуляції та специфікації BOM в Excel (.xlsx)"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">Експорт в Excel</span>
        </button>
        <button type="button" onClick={() => void handleCopy()} className={pill} title="Скопіювати підсумок розрахунку текстом">
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              <span className="truncate text-emerald-300">Скопійовано!</span>
            </>
          ) : copyFailed ? (
            <span className="truncate text-rose-300">Не вдалося</span>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 shrink-0 text-slate-300" />
              <span className="truncate">Скопіювати</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenCurrencySettings}
          className={`${pill} font-semibold text-amber-300 hover:text-amber-200 border border-amber-500/30`}
          title="Налаштувати поточний курс валют (USD/EUR) для імпорту"
        >
          <Coins className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span className="truncate">Курс: ${(rates?.USD ?? 41.5).toFixed(1)}</span>
        </button>
        <button
          type="button"
          onClick={onOpenApplyToProduct}
          className={`${pill} font-semibold text-emerald-300 hover:text-emerald-200 border border-emerald-500/30`}
          title="Додати підсумок цього розрахунку до ціни опублікованого товару або чорнетки"
        >
          <Banknote className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">До ціни товару</span>
        </button>
      </div>
      <button
        type="button"
        onClick={onOpenCommercialOffer}
        className="w-full px-4 py-2.5 rounded-xl neo-pill-active text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer active:scale-95 shadow-[0_0_20px_rgba(59,130,246,0.5)]"
      >
        <Printer className="w-4 h-4" />
        <span>Комерційна пропозиція (КП)</span>
      </button>
    </div>
  );
};

/** Короткий живий підсумок над кнопками — щоб бачити, що змінила правка, не гортаючи вгору. */
const MiniTotals: React.FC<{ result: CalculationResult; currency: Currency }> = ({ result, currency }) => (
  <div className="grid grid-cols-2 gap-2">
    <div className="rounded-xl neo-inset border border-white/5 px-3 py-2">
      <div className="text-[10px] text-slate-400">Собівартість</div>
      <div className="font-mono text-sm font-bold text-slate-100 tabular-nums">{formatMoney(result.fullCostPrice, currency)}</div>
    </div>
    <div className="rounded-xl border border-blue-400/40 bg-blue-500/10 px-3 py-2">
      <div className="text-[10px] text-blue-300">Ціна для клієнта</div>
      <div className="font-mono text-sm font-bold text-white tabular-nums">{formatMoney(result.totalSellingPrice, currency)}</div>
    </div>
  </div>
);

interface SectionListProps {
  sections: CalcSection[];
  activeId: string;
  onGo: (id: string) => void;
}

/** Вертикальний зміст для інспектора. */
export const SectionNavList: React.FC<SectionListProps> = ({ sections, activeId, onGo }) => (
  <nav aria-label="Розділи сторінки «Управління цінами»">
    <ol className="flex flex-col gap-0.5">
      {sections.map((s, i) => {
        const active = s.id === activeId;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onGo(s.id)}
              aria-current={active ? 'location' : undefined}
              className={`group flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-[12px] leading-tight transition-colors ${
                active
                  ? 'border-cyan-400/50 bg-[rgba(0,180,255,.14)] text-white shadow-[0_0_12px_rgba(0,210,255,0.25)]'
                  : 'border-transparent text-[rgba(214,235,255,.72)] hover:border-cyan-400/25 hover:bg-[rgba(0,180,255,.06)] hover:text-white'
              }`}
            >
              <span
                className={`w-5 shrink-0 font-mono text-[10px] tabular-nums ${active ? 'text-cyan-300' : 'text-[rgba(181,217,253,.45)]'}`}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">{s.label}</span>
              {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_8px_#22d3ee]" />}
            </button>
          </li>
        );
      })}
    </ol>
  </nav>
);

interface InspectorProps extends CalculatorControlsProps {
  sections: CalcSection[];
  activeId: string;
  onGo: (id: string) => void;
}

/** Вміст «Інспектора вузла» для сторінки «Управління цінами». */
export const CalculatorInspector: React.FC<InspectorProps> = ({ sections, activeId, onGo, ...controls }) => (
  <div className="furniture-calc-scope flex flex-col gap-4 border-t border-cyan-400/20 pt-3" data-calc-inspector="1">
    <div className="flex flex-col gap-1.5">
      <span className={SECTION_LABEL}>Розділи сторінки</span>
      <SectionNavList sections={sections} activeId={activeId} onGo={onGo} />
    </div>
    <div className="flex flex-col gap-2 border-t border-cyan-400/20 pt-3">
      <span className={SECTION_LABEL}>Керування розрахунком</span>
      <MiniTotals result={controls.result} currency={controls.currency} />
      <CalculatorControls {...controls} />
    </div>
  </div>
);

/**
 * Вузький екран: інспектор адмінки там опиняється під усією сторінкою, тож
 * той самий зміст і кнопки ховаються в згорнуту панель липкого рядка.
 */
export const CalculatorMobileNav: React.FC<InspectorProps> = ({ sections, activeId, onGo, ...controls }) => {
  const [open, setOpen] = useState(false);
  const activeIndex = Math.max(0, sections.findIndex((s) => s.id === activeId));
  const activeLabel = sections[activeIndex]?.label ?? '';

  return (
    <div className="max-w-7xl mx-auto" data-calc-mobile-nav="1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl border border-cyan-400/30 bg-[rgba(0,180,255,.07)] px-3 py-2 text-left text-xs text-[#d6ebff]"
      >
        <ListTree className="h-4 w-4 shrink-0 text-cyan-300" />
        <span className="shrink-0 font-semibold uppercase tracking-[0.08em] text-cyan-300">Розділи</span>
        <span className="min-w-0 flex-1 truncate text-slate-300">
          {String(activeIndex + 1).padStart(2, '0')} · {activeLabel}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180 text-cyan-300' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 max-h-[65vh] overflow-y-auto rounded-2xl border border-cyan-400/25 bg-[#0a1322]/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
          <SectionNavList
            sections={sections}
            activeId={activeId}
            onGo={(id) => {
              setOpen(false);
              onGo(id);
            }}
          />
          <div className="mt-3 border-t border-cyan-400/20 pt-3">
            <CalculatorControls
              {...controls}
              onOpenTemplates={() => {
                setOpen(false);
                controls.onOpenTemplates();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
