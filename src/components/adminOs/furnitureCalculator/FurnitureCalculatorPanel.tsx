import React, { useState, useEffect } from 'react';
import { CalculationInput, Currency, ProductTemplate, CurrencyRates } from './types';
import { PRODUCT_TEMPLATES } from './data/woodPresets';
import { calculateWoodAndEpoxyCost, DEFAULT_CURRENCY_RATES, updateGlobalCurrencyRates, recalculateImportedMaterials } from './utils/calculator';
import { exportCalculationToExcel } from './utils/excelExport';
import { Header } from './components/Header';
import { CostBreakdownDashboard } from './components/CostBreakdownDashboard';
import { WoodSection } from './components/WoodSection';
import { EpoxySection } from './components/EpoxySection';
import { FinishAndCncSection } from './components/FinishAndCncSection';
import { LaborAndOperationsSection } from './components/LaborAndOperationsSection';
import { AiMediaCostSection } from './components/AiMediaCostSection';
import { ExpenseBoardOverheadSection } from './components/ExpenseBoardOverheadSection';
import { ProductionTimelineSection } from './components/ProductionTimelineSection';
import { ElectronicsSection } from './components/ElectronicsSection';
import { ApplyToProductModal } from './components/ApplyToProductModal';
import { CommercialOfferModal } from './components/CommercialOfferModal';
import { TemplatesModal } from './components/TemplatesModal';
import { CurrencySettingsModal } from './components/CurrencySettingsModal';
import './furnitureCalculator.css';

// NOTE: this panel used to persist rates, custom templates and "saved calculations" to
// localStorage in the browser. It now persists rates and custom templates on the Nova
// server (see server/furnitureCalculatorRoutes.ts, requireAdmin-only), via
// getAppSetting/setAppSetting under the 'furniture_calc_rates' and
// 'furniture_calc_custom_templates' keys, so the data is shared across admins/devices
// instead of living only in one browser's localStorage. The old "saved calculations"
// feature (SavedCalculation) has been removed entirely: it loaded from localStorage but
// was never written to and never rendered anywhere in the original app — the "custom
// templates" feature already fully covers "save your work for later".

function currentPeriodYm(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Ставка «накладні на одиницю» з вкладки адмінки «Борд витрат» (#211) —
 * автопідключення калькулятора меблів до загального борду витрат бізнесу
 * (ШІ + Railway + інше, розподілені на мікс продажів поточного місяця).
 */
async function fetchExpenseBoardOverhead(): Promise<{ overheadPerUnitUsd: number; periodLabel: string } | null> {
  try {
    const period = currentPeriodYm();
    const res = await fetch(`/api/admin/expense-board/${period}`, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Не вдалося завантажити борд витрат');
    }
    const [y, m] = period.split('-').map(Number);
    const periodLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('uk-UA', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return { overheadPerUnitUsd: Number(data?.overheadPerUnitUsd) || 0, periodLabel };
  } catch (e) {
    console.error('Failed to load expense board overhead rate', e);
    return null;
  }
}

async function fetchFurnitureCalcRates(): Promise<CurrencyRates | null> {
  try {
    const res = await fetch('/api/admin/furniture-calc/rates', {
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Не вдалося завантажити курс валют');
    }
    return data?.rates || null;
  } catch (e) {
    console.error('Failed to load currency rates from server', e);
    return null;
  }
}

async function saveFurnitureCalcRates(rates: CurrencyRates): Promise<void> {
  const res = await fetch('/api/admin/furniture-calc/rates', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rates }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Не вдалося зберегти курс валют');
  }
}

async function fetchFurnitureCalcTemplates(): Promise<ProductTemplate[]> {
  try {
    const res = await fetch('/api/admin/furniture-calc/templates', {
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Не вдалося завантажити шаблони');
    }
    return Array.isArray(data?.templates) ? data.templates : [];
  } catch (e) {
    console.error('Failed to load custom templates from server', e);
    return [];
  }
}

async function saveFurnitureCalcTemplates(templates: ProductTemplate[]): Promise<void> {
  const res = await fetch('/api/admin/furniture-calc/templates', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templates }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Не вдалося зберегти шаблони');
  }
}

export const FurnitureCalculatorPanel: React.FC = () => {
  const [templates, setTemplates] = useState<ProductTemplate[]>(PRODUCT_TEMPLATES);
  const [currentPresetId, setCurrentPresetId] = useState<string>(PRODUCT_TEMPLATES[0].id);
  const [input, setInput] = useState<CalculationInput>(PRODUCT_TEMPLATES[0].input);
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [rates, setRates] = useState<CurrencyRates>(DEFAULT_CURRENCY_RATES);
  const [isCommercialOfferOpen, setIsCommercialOfferOpen] = useState(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [isApplyToProductModalOpen, setIsApplyToProductModalOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [expenseBoardLoaded, setExpenseBoardLoaded] = useState(false);
  const [expenseBoardError, setExpenseBoardError] = useState<string | null>(null);
  const [expenseBoardPeriodLabel, setExpenseBoardPeriodLabel] = useState<string | undefined>(undefined);

  // Load currency rates & custom templates from the Nova server on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const storedRates = await fetchFurnitureCalcRates();
      if (!cancelled && storedRates && typeof storedRates === 'object') {
        const mergedRates: CurrencyRates = {
          ...DEFAULT_CURRENCY_RATES,
          ...storedRates,
          USD: typeof storedRates.USD === 'number' && storedRates.USD > 0 ? storedRates.USD : DEFAULT_CURRENCY_RATES.USD,
          EUR: typeof storedRates.EUR === 'number' && storedRates.EUR > 0 ? storedRates.EUR : DEFAULT_CURRENCY_RATES.EUR,
        };
        setRates(mergedRates);
        updateGlobalCurrencyRates(mergedRates);
      }
    })();

    (async () => {
      const board = await fetchExpenseBoardOverhead();
      if (cancelled) return;
      if (board) {
        setExpenseBoardPeriodLabel(board.periodLabel);
        setExpenseBoardError(null);
        setInput((prev) => ({ ...prev, expenseBoardOverheadCostUsd: board.overheadPerUnitUsd }));
      } else {
        setExpenseBoardError('Не вдалося завантажити ставку з борду витрат — введіть її вручну або спробуйте оновити сторінку.');
      }
      setExpenseBoardLoaded(true);
    })();

    (async () => {
      const storedCustom = await fetchFurnitureCalcTemplates();
      if (!cancelled && Array.isArray(storedCustom) && storedCustom.length > 0) {
        // Merge preset templates with user custom templates, ensuring input object is complete
        const sanitizedCustom: ProductTemplate[] = storedCustom
          .filter((t) => t && typeof t === 'object' && t.id && t.name)
          .map((t) => ({
            ...t,
            input: {
              ...PRODUCT_TEMPLATES[0].input,
              ...(t.input || {}),
            },
          }));
        setTemplates([...sanitizedCustom, ...PRODUCT_TEMPLATES]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleUpdateInput = (updated: Partial<CalculationInput>) => {
    setInput((prev) => ({ ...prev, ...updated }));
  };

  const handleSelectTemplate = (template: ProductTemplate) => {
    setCurrentPresetId(template.id);
    setInput(template.input);
    showNotification(`Завантажено шаблон: [${template.category}] ${template.name}`);
  };

  const handleReset = () => {
    const defaultPreset = PRODUCT_TEMPLATES[0];
    setCurrentPresetId(defaultPreset.id);
    setInput(defaultPreset.input);
    showNotification('Параметри скинуто до базових значень');
  };

  // Currency Rates update handler
  const handleSaveRates = (newRates: CurrencyRates, applyToCalculations: boolean = true) => {
    setRates(newRates);
    updateGlobalCurrencyRates(newRates);
    saveFurnitureCalcRates(newRates).catch((e) => {
      console.error('Failed to save rates', e);
      showNotification('Не вдалося зберегти курс валют на сервері');
    });

    if (applyToCalculations) {
      setInput((prev) => recalculateImportedMaterials(prev, newRates, rates));
      showNotification(`Курс оновлено (1 USD = ${newRates.USD} ₴, 1 EUR = ${newRates.EUR} ₴). Імпортні матеріали перераховано!`);
    } else {
      showNotification(`Курс валют збережено (1 USD = ${newRates.USD} ₴, 1 EUR = ${newRates.EUR} ₴)`);
    }
  };

  // Custom Templates Handlers
  const handleSaveAsTemplate = (newTemplateData: Omit<ProductTemplate, 'id' | 'createdAt'>) => {
    const newTemplate: ProductTemplate = {
      ...newTemplateData,
      id: `custom_tpl_${Date.now()}`,
      createdAt: new Date().toISOString(),
      isCustom: true,
    };

    setTemplates((prev) => {
      const updated = [newTemplate, ...prev];
      const customOnly = updated.filter((t) => t.isCustom);
      saveFurnitureCalcTemplates(customOnly).catch((e) => {
        console.error('Failed to persist custom templates', e);
        showNotification('Не вдалося зберегти шаблон на сервері');
      });
      return updated;
    });

    setCurrentPresetId(newTemplate.id);
    showNotification(`Шаблон "${newTemplate.name}" збережено в категорію "${newTemplate.category}"`);
  };

  const handleUpdateTemplate = (id: string, updatedFields: Partial<ProductTemplate>) => {
    setTemplates((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...updatedFields } : t));
      const customOnly = next.filter((t) => t.isCustom);
      saveFurnitureCalcTemplates(customOnly).catch((e) => {
        console.error('Failed to persist custom templates', e);
        showNotification('Не вдалося зберегти зміни шаблону на сервері');
      });
      return next;
    });
    showNotification('Шаблон успішно оновлено');
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id);
      const customOnly = next.filter((t) => t.isCustom);
      saveFurnitureCalcTemplates(customOnly).catch((e) => {
        console.error('Failed to persist custom templates', e);
        showNotification('Не вдалося видалити шаблон на сервері');
      });
      return next;
    });
    showNotification('Шаблон видалено');
  };

  // Excel Export Handler
  const handleExportToExcel = () => {
    const activeTpl = templates.find((t) => t.id === currentPresetId);
    const calcResult = calculateWoodAndEpoxyCost(input, rates);
    exportCalculationToExcel(input, calcResult, currency, {
      productName: activeTpl?.name || 'Виріб з дерева та епоксидної смоли',
      category: activeTpl?.category || 'Меблі / Вироби',
      dimensions: `${input.woodLengthMm} × ${input.woodWidthMm} × ${input.woodThicknessMm} мм`,
      notes: activeTpl?.description,
      rates: rates,
    });
    showNotification('Excel файл (.xlsx) сформовано та завантажено!');
  };

  // Real-time cost calculation
  const result = calculateWoodAndEpoxyCost(input, rates);

  return (
    <div className="furniture-calc-scope min-h-screen bg-[#080d1a] text-slate-100 selection:bg-cyan-500 selection:text-black">
      {/* Background Ambient Glows (Neo-Tactile depth) */}
      <div className="fixed top-10 left-1/4 w-96 h-96 neo-glow-cyan rounded-full pointer-events-none -z-10" />
      <div className="fixed bottom-10 right-1/4 w-[32rem] h-[32rem] neo-glow-blue rounded-full pointer-events-none -z-10" />

      {/* Header */}
      <Header
        currentPresetId={currentPresetId}
        onSelectPreset={handleSelectTemplate}
        currency={currency}
        onSelectCurrency={setCurrency}
        onReset={handleReset}
        templates={templates}
        onOpenTemplatesModal={() => setIsTemplatesModalOpen(true)}
        onExportExcel={handleExportToExcel}
        rates={rates}
        onOpenCurrencySettings={() => setIsCurrencyModalOpen(true)}
      />

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900/90 text-cyan-300 px-4 py-2.5 rounded-2xl neo-card border border-cyan-400/40 text-xs font-mono shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
          {notification}
        </div>
      )}

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-8">
        {/* KPI Dashboard (Hero Summary) */}
        <CostBreakdownDashboard
          input={input}
          result={result}
          currency={currency}
          onOpenCommercialOffer={() => setIsCommercialOfferOpen(true)}
          onSaveCalculation={() => setIsTemplatesModalOpen(true)}
          onExportExcel={handleExportToExcel}
          onOpenTemplates={() => setIsTemplatesModalOpen(true)}
          rates={rates}
          onOpenCurrencySettings={() => setIsCurrencyModalOpen(true)}
          onOpenApplyToProduct={() => setIsApplyToProductModalOpen(true)}
        />

        {/* Core Calculation Sections */}
        <div className="space-y-6">
          {/* Section 1: Wood & Drying */}
          <WoodSection
            input={input}
            onChange={handleUpdateInput}
            result={result}
            currency={currency}
          />

          {/* Section 2: Epoxy & Pigments */}
          <EpoxySection
            input={input}
            onChange={handleUpdateInput}
            result={result}
            currency={currency}
            rates={rates}
            onOpenCurrencySettings={() => setIsCurrencyModalOpen(true)}
          />

          {/* Section 3 & 4: Finish, Abrasives & CNC */}
          <FinishAndCncSection
            input={input}
            onChange={handleUpdateInput}
            result={result}
            currency={currency}
            rates={rates}
            onOpenCurrencySettings={() => setIsCurrencyModalOpen(true)}
          />

          {/* Section 4.5: Electronics, LED illumination & Microcontrollers */}
          <ElectronicsSection
            input={input}
            onChange={handleUpdateInput}
            result={result}
            currency={currency}
            rates={rates}
          />

          {/* Section 5, 6, 7, 8, 9: Labor, Base, Logistics, Overhead, Depreciation, Taxes */}
          <LaborAndOperationsSection
            input={input}
            onChange={handleUpdateInput}
            result={result}
            currency={currency}
            rates={rates}
            onOpenCurrencySettings={() => setIsCurrencyModalOpen(true)}
          />

          {/* Section 6: AI Media Generation Subscriptions (GPT & Runway) */}
          <AiMediaCostSection
            input={input}
            onChange={handleUpdateInput}
            result={result}
            currency={currency}
            rates={rates}
            onOpenCurrencySettings={() => setIsCurrencyModalOpen(true)}
          />

          {/* Section 6б: Overhead from the expense board (AI + Railway + other, #211) */}
          <ExpenseBoardOverheadSection
            input={input}
            onChange={handleUpdateInput}
            result={result}
            currency={currency}
            rates={rates}
            boardLoaded={expenseBoardLoaded}
            boardError={expenseBoardError}
            boardPeriodLabel={expenseBoardPeriodLabel}
          />

          {/* Section 7: Production Timeline & Gantt Schedule */}
          <ProductionTimelineSection
            input={input}
            onChange={handleUpdateInput}
          />
        </div>

        {/* Footer info */}
        <footer className="pt-8 pb-12 border-t border-white/5 text-center text-xs text-slate-500 font-mono">
          <p>Neo-Tactile Wood & Epoxy Cost Calculator • Точний технологічний розрахунок собівартості: столи, органайзери, шкатулки</p>
        </footer>
      </main>

      {/* Templates Manager Modal */}
      <TemplatesModal
        isOpen={isTemplatesModalOpen}
        onClose={() => setIsTemplatesModalOpen(false)}
        templates={templates}
        activeTemplateId={currentPresetId}
        onSelectTemplate={handleSelectTemplate}
        currentInput={input}
        onSaveAsTemplate={handleSaveAsTemplate}
        onUpdateTemplate={handleUpdateTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        currency={currency}
      />

      {/* Commercial Offer Modal */}
      <CommercialOfferModal
        isOpen={isCommercialOfferOpen}
        onClose={() => setIsCommercialOfferOpen(false)}
        input={input}
        result={result}
        currency={currency}
      />

      {/* Currency Exchange Rates Modal */}
      <CurrencySettingsModal
        isOpen={isCurrencyModalOpen}
        onClose={() => setIsCurrencyModalOpen(false)}
        rates={rates}
        onUpdateRates={handleSaveRates}
        currentInput={input}
      />

      {/* Apply calculation total to a product's price ('published or planned to be published') */}
      <ApplyToProductModal
        isOpen={isApplyToProductModalOpen}
        onClose={() => setIsApplyToProductModalOpen(false)}
        totalSellingPriceUah={result.totalSellingPrice}
        currency={currency}
        onApplied={(msg) => showNotification(msg)}
      />
    </div>
  );
};

export default FurnitureCalculatorPanel;
