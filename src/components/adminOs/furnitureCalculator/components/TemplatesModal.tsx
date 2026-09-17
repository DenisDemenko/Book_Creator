import React, { useState, useMemo } from 'react';
import { 
  X, 
  FolderPlus, 
  Search, 
  Trash2, 
  Check, 
  Sparkles, 
  Box, 
  Layers, 
  Table, 
  FileSpreadsheet, 
  Plus,
  RefreshCw,
  FolderOpen,
  Sliders,
  Tag
} from 'lucide-react';
import { ProductTemplate, CalculationInput, Currency } from '../types';
import { DEFAULT_TEMPLATE_CATEGORIES, WOOD_SPECIES_LIST, PRODUCT_TEMPLATES } from '../data/woodPresets';
import { calculateWoodAndEpoxyCost, formatMoney } from '../utils/calculator';
import { exportCalculationToExcel } from '../utils/excelExport';

interface TemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: ProductTemplate[];
  activeTemplateId: string;
  onSelectTemplate: (template: ProductTemplate) => void;
  currentInput: CalculationInput;
  onSaveAsTemplate: (newTemplate: Omit<ProductTemplate, 'id' | 'createdAt'>) => void;
  onUpdateTemplate: (id: string, updated: Partial<ProductTemplate>) => void;
  onDeleteTemplate: (id: string) => void;
  currency: Currency;
}

export const TemplatesModal: React.FC<TemplatesModalProps> = ({
  isOpen,
  onClose,
  templates,
  activeTemplateId,
  onSelectTemplate,
  currentInput,
  onSaveAsTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  currency,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);

  // New template form state
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<string>('Столи');
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [newDimensions, setNewDimensions] = useState(
    `${currentInput.woodLengthMm} × ${currentInput.woodWidthMm} × ${currentInput.woodThicknessMm} мм`
  );
  const [newDescription, setNewDescription] = useState('');

  // Collect all unique categories from templates
  const allCategories = useMemo(() => {
    const cats = new Set<string>(DEFAULT_TEMPLATE_CATEGORIES);
    templates.forEach((t) => {
      if (t.category) cats.add(t.category);
    });
    return Array.from(cats);
  }, [templates]);

  // Filter templates based on category and search query
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      // Category match
      if (selectedCategory === 'custom') {
        if (!t.isCustom) return false;
      } else if (selectedCategory !== 'all') {
        if (t.category !== selectedCategory) return false;
      }

      // Search match
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        (t.dimensions && t.dimensions.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [templates, selectedCategory, searchQuery]);

  if (!isOpen) return null;

  const handleOpenCreateForm = () => {
    setNewName('');
    setNewDimensions(`${currentInput.woodLengthMm} × ${currentInput.woodWidthMm} × ${currentInput.woodThicknessMm} мм`);
    setNewDescription('');
    setCustomCategoryInput('');
    setIsCreatingNew(true);
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const finalCategory = newCategory === 'custom' 
      ? (customCategoryInput.trim() || 'Власні вироби') 
      : newCategory;

    const currentResult = calculateWoodAndEpoxyCost(currentInput);

    onSaveAsTemplate({
      name: newName.trim(),
      category: finalCategory,
      dimensions: newDimensions.trim(),
      description: newDescription.trim() || `Створено користувачем на основі параметрів калькулятора`,
      input: currentInput,
      isCustom: true,
      estimatedPriceUah: currentResult.totalSellingPrice,
    });

    setIsCreatingNew(false);
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'Столи':
        return '🪑';
      case 'Органайзери':
        return '📱';
      case 'Шкатулки':
        return '💍';
      case 'Декор':
        return '🪵';
      case 'Аксесуари':
        return '✨';
      default:
        return '📦';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div 
        className="relative w-full max-w-5xl my-auto bg-[#0c1427] border border-white/10 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl neo-icon-btn flex items-center justify-center border border-cyan-400/30 text-cyan-300">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  Шаблони виробів та налаштувань
                </h2>
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  {templates.length} шаблонів
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Зберігайте розрахунки за категоріями: столи, органайзери, шкатулки, декор з унікальними витратами
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isCreatingNew && (
              <button
                type="button"
                onClick={handleOpenCreateForm}
                className="px-3.5 py-1.5 rounded-xl neo-pill-active text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-[0_0_15px_rgba(56,189,248,0.3)]"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Зберегти поточний як шаблон</span>
                <span className="sm:hidden">Зберегти</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl neo-card flex items-center justify-center text-slate-400 hover:text-white cursor-pointer transition-colors"
              aria-label="Закрити"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Create new template banner/drawer if triggered */}
        {isCreatingNew && (
          <form 
            onSubmit={handleSaveSubmit}
            className="p-5 bg-gradient-to-b from-cyan-950/40 to-slate-900/60 border-b border-cyan-500/30 shrink-0 space-y-4 animate-in fade-in duration-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-300 text-sm font-semibold">
                <FolderPlus className="w-4 h-4" />
                <span>Зберегти поточний розрахунок калькулятора у шаблони</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCreatingNew(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Скасувати
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Назва виробу <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="напр., Стіл Oval River 1800 або Шкатулка Jade"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl neo-inset text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Категорія виробу
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl neo-inset text-xs text-white focus:outline-none focus:border-cyan-400 bg-slate-900"
                >
                  {allCategories.map((c) => (
                    <option key={c} value={c}>
                      {getCategoryIcon(c)} {c}
                    </option>
                  ))}
                  <option value="custom">➕ Інша категорія...</option>
                </select>
                {newCategory === 'custom' && (
                  <input
                    type="text"
                    placeholder="Введіть нову категорію"
                    value={customCategoryInput}
                    onChange={(e) => setCustomCategoryInput(e.target.value)}
                    className="w-full mt-2 px-3 py-1.5 rounded-xl neo-inset text-xs text-white focus:outline-none focus:border-cyan-400"
                  />
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Габаритні розміри
                </label>
                <input
                  type="text"
                  placeholder="2000 × 900 × 45 мм"
                  value={newDimensions}
                  onChange={(e) => setNewDimensions(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl neo-inset text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Короткий опис / особливості матеріалів
              </label>
              <input
                type="text"
                placeholder="Особливості слябів, фурнітури або технологічні примітки"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-xl neo-inset text-xs text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsCreatingNew(false)}
                className="px-4 py-2 rounded-xl neo-card text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                Скасувати
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl neo-pill-active text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(56,189,248,0.4)]"
              >
                <Check className="w-4 h-4" />
                <span>Зберегти в мої шаблони</span>
              </button>
            </div>
          </form>
        )}

        {/* Filter Bar: Category Tabs & Search */}
        <div className="px-6 py-3 border-b border-white/10 bg-white/[0.01] shrink-0 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'neo-pill-active'
                    : 'neo-card-subtle text-slate-400 hover:text-slate-200'
                }`}
              >
                🗂️ Всі ({templates.length})
              </button>

              {allCategories.map((cat) => {
                const count = templates.filter((t) => t.category === cat).length;
                if (count === 0) return null;
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                      active
                        ? 'neo-pill-active'
                        : 'neo-card-subtle text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>{getCategoryIcon(cat)} {cat}</span>
                    <span className="ml-1.5 text-[10px] opacity-70 font-mono">({count})</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setSelectedCategory('custom')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                  selectedCategory === 'custom'
                    ? 'neo-pill-active'
                    : 'neo-card-subtle text-amber-400/80 hover:text-amber-300'
                }`}
              >
                ⭐ Мої збережені ({templates.filter((t) => t.isCustom).length})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64 shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Пошук шаблону..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl neo-inset text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Template Cards Grid (Scrollable) */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {filteredTemplates.length === 0 ? (
            <div className="text-center py-16 text-slate-400 space-y-3">
              <Box className="w-12 h-12 mx-auto text-slate-600 stroke-[1.5]" />
              <p className="text-sm font-medium">Шаблонів за вашим запитом не знайдено</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('all');
                  setSearchQuery('');
                }}
                className="px-4 py-2 rounded-xl neo-pill-default text-xs font-medium text-cyan-300 cursor-pointer"
              >
                Скинути фільтри
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredTemplates.map((template) => {
                const isActive = template.id === activeTemplateId;
                const wood = (template.input?.woodSpeciesId && WOOD_SPECIES_LIST.find((w) => w.id === template.input.woodSpeciesId)) || WOOD_SPECIES_LIST[0];
                const previewCalc = calculateWoodAndEpoxyCost(template.input || PRODUCT_TEMPLATES[0].input);

                return (
                  <div
                    key={template.id}
                    className={`rounded-2xl p-5 transition-all flex flex-col justify-between relative group ${
                      isActive
                        ? 'neo-card border-2 border-cyan-400/80 shadow-[0_0_25px_rgba(56,189,248,0.25)]'
                        : 'neo-card-subtle border border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                            {getCategoryIcon(template.category)} {template.category}
                          </span>
                          {template.dimensions && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/5">
                              {template.dimensions}
                            </span>
                          )}
                          {template.isCustom && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              ⭐️ Власний
                            </span>
                          )}
                        </div>

                        {isActive && (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 font-mono">
                            <Check className="w-3.5 h-3.5 text-cyan-400" />
                            Активний
                          </span>
                        )}
                      </div>

                      {/* Title & Description */}
                      <h3 className="text-base font-bold text-white tracking-tight">
                        {template.name}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {template.description || 'Налаштований технологічний шаблон виробу'}
                      </p>

                      {/* Quick Specs Bento */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3 p-2.5 rounded-xl neo-inset text-[11px] font-mono">
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">Порода дерева</span>
                          <span className="text-slate-200 truncate block font-sans font-medium" title={wood?.name || 'Дуб'}>
                            {(wood?.name || 'Дуб').split(' ')[0]}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">Смола (л)</span>
                          <span className="text-cyan-300 font-semibold">
                            {previewCalc.calculatedEpoxyLiters.toFixed(1)} л
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">Фреза ЧПУ</span>
                          <span className="text-indigo-300 font-semibold truncate block" title={`${template.input.routerBitCost ?? 2200} грн / ресурс ${template.input.routerBitLifespanProducts ?? 10} виробів`}>
                            {template.input.includeRouterBitCost !== false 
                              ? `${template.input.routerBitCost ?? 2200}₴ (${template.input.routerBitLifespanProducts ?? 10}в)`
                              : 'Вимкнено'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">Орієнт. ціна</span>
                          <span className="text-emerald-400 font-semibold">
                            {formatMoney(previewCalc.totalSellingPrice, currency)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {/* Export to Excel directly from card */}
                        <button
                          type="button"
                          onClick={() => {
                            exportCalculationToExcel(template.input, previewCalc, currency, {
                              productName: template.name,
                              category: template.category,
                              dimensions: template.dimensions,
                              notes: template.description,
                            });
                          }}
                          title="Експортувати шаблон в Excel (.xlsx)"
                          className="p-2 rounded-xl neo-card text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                        </button>

                        {template.isCustom && (
                          <>
                            {/* Update with current calculator input */}
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Оновити шаблон "${template.name}" поточними значеннями з калькулятора?`)) {
                                  onUpdateTemplate(template.id, {
                                    input: currentInput,
                                    updatedAt: new Date().toISOString(),
                                  });
                                }
                              }}
                              title="Оновити цей шаблон поточними налаштуваннями з калькулятора"
                              className="p-2 rounded-xl neo-card text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 cursor-pointer transition-colors"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>

                            {/* Delete custom template */}
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Ви впевнені, що хочете видалити шаблон "${template.name}"?`)) {
                                  onDeleteTemplate(template.id);
                                }
                              }}
                              title="Видалити шаблон"
                              className="p-2 rounded-xl neo-card text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Primary Load Action */}
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTemplate(template);
                          onClose();
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                          isActive
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                            : 'neo-pill-active active:scale-95'
                        }`}
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>{isActive ? 'Завантажено' : 'Завантажити в розрахунок'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer Info */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>Кожен шаблон автоматично враховує габарити, витрату смоли та роботу</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 rounded-xl neo-pill-default text-slate-200 hover:text-white cursor-pointer"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
