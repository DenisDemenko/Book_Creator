import React, { useState } from 'react';
import { GlassCard } from './GlassCard';
import { GlassButton } from './GlassButton';
import {
  translateEtsyTag,
  ETSY_SEO_DICTIONARY,
  SeoTranslationItem,
} from './seoTranslations';
import {
  Languages,
  Search,
  Copy,
  Check,
  Tag,
  BookOpen,
  Sparkles,
  HelpCircle,
  Layers,
  ArrowRight,
  Filter
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface SeoTranslationsTabProps {
  currentTags: string[];
  aiSuggestedTags?: string[];
  currentTitle?: string;
  aiOptimizedTitle?: string;
}

export const SeoTranslationsTab: React.FC<SeoTranslationsTabProps> = ({
  currentTags,
  aiSuggestedTags,
  currentTitle,
  aiOptimizedTitle,
}) => {
  const [dictionarySearch, setDictionarySearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Всі');
  const [customTagInput, setCustomTagInput] = useState('');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [activeSubView, setActiveSubView] = useState<'current' | 'ai' | 'dictionary'>('current');

  const categories = [
    'Всі',
    'Подарунки',
    'Стиль',
    'Матеріали',
    'Digital',
    'Свята',
    'Техніка',
    'Маркетинг',
    'Товари',
  ];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Filter dictionary
  const filteredDictionary = ETSY_SEO_DICTIONARY.filter((item) => {
    const matchesCat =
      selectedCategory === 'Всі' || item.category === selectedCategory;
    const matchesQuery =
      item.english.toLowerCase().includes(dictionarySearch.toLowerCase()) ||
      item.ukrainian.toLowerCase().includes(dictionarySearch.toLowerCase()) ||
      item.intent.toLowerCase().includes(dictionarySearch.toLowerCase());
    return matchesCat && matchesQuery;
  });

  // Translate current tags
  const translatedCurrentTags = currentTags.map((tag) => translateEtsyTag(tag));
  const translatedAiTags = (aiSuggestedTags || []).map((tag) => translateEtsyTag(tag));

  // Custom translation result
  const customTranslationResult = customTagInput.trim()
    ? translateEtsyTag(customTagInput.trim())
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header & Sub-Tab Navigation */}
      <GlassCard className="p-4 sm:p-5 bg-gradient-to-r from-blue-500/15 via-white/10 to-indigo-500/15 border-blue-400/30">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-300/40 flex items-center justify-center text-blue-200 shrink-0">
              <Languages className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                  Переклад та тлумачення SEO слів (EN ➔ UA)
                </h3>
                <span className="glass-badge bg-blue-400/20 text-blue-200 border-blue-300/30 text-[10px]">
                  Українська локалізація 🇺🇦
                </span>
              </div>
              <p className="text-xs text-white/80 mt-0.5">
                Повний переклад англійських тегів Etsy, розбір пошукового наміру покупців США та довідник ключових слів
              </p>
            </div>
          </div>

          {/* Sub-view switcher */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/30 border border-white/15 w-full md:w-auto overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveSubView('current')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                activeSubView === 'current'
                  ? 'bg-white/30 text-white shadow-md border border-white/40'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              Поточні теги ({currentTags.length})
            </button>

            {aiSuggestedTags && aiSuggestedTags.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveSubView('ai')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${
                  activeSubView === 'ai'
                    ? 'bg-emerald-500/30 text-emerald-200 shadow-md border border-emerald-400/40'
                    : 'text-emerald-300/70 hover:text-emerald-200'
                }`}
              >
                <Sparkles className="w-3 h-3 text-emerald-300" />
                ШІ-Теги (13)
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveSubView('dictionary')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${
                activeSubView === 'dictionary'
                  ? 'bg-amber-500/30 text-amber-200 shadow-md border border-amber-400/40'
                  : 'text-amber-200/70 hover:text-amber-200'
              }`}
            >
              <BookOpen className="w-3 h-3 text-amber-300" />
              Словник Etsy ({ETSY_SEO_DICTIONARY.length})
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Quick Interactive Single Tag Translator */}
      <GlassCard
        title="Швидкий перекладач власного тегу або фрази"
        subtitle="Введіть будь-яке англійське ключове слово для миттєвого перекладу та розбору наміру покупця"
      >
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Tag className="w-4 h-4 text-white/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              placeholder="Введіть англійське слово (напр. chunky knit merino wool blanket, birthstone ring)..."
              className="glass-input pl-10 w-full"
            />
          </div>
          {customTagInput && (
            <button
              type="button"
              onClick={() => setCustomTagInput('')}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-rose-500/20 text-xs text-white/70 hover:text-rose-200 border border-white/15 shrink-0 transition-all"
            >
              Очистити
            </button>
          )}
        </div>

        {customTranslationResult && (
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-white/15 to-white/5 border border-white/20 flex flex-col gap-2.5 animate-fadeIn">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-amber-300">
                  #{customTranslationResult.original}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-white/50" />
                <span className="text-sm font-bold text-emerald-300">
                  🇺🇦 {customTranslationResult.ukrainian}
                </span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/30 font-medium">
                Категорія: {customTranslationResult.category}
              </span>
            </div>

            <p className="text-xs text-white/80 leading-relaxed bg-black/20 p-2.5 rounded-lg border border-white/10">
              💡 <strong className="text-white">Пошуковий намір:</strong> {customTranslationResult.buyerIntent}
            </p>

            {/* Words breakdown */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-white/60 font-semibold mr-1">Послівний розбір:</span>
              {customTranslationResult.wordsBreakdown.map((w, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-[11px] text-white flex items-center gap-1"
                >
                  <span className="text-amber-200 font-mono">{w.en}</span>
                  <span className="text-white/40">=</span>
                  <span className="text-emerald-200 font-medium">{w.ua}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      {/* VIEW 1: Current Tags Translation Matrix */}
      {activeSubView === 'current' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-white/80 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" /> Поточні теги лістингу з перекладом ({translatedCurrentTags.length})
            </span>
            <span className="text-xs text-white/60">
              Синхронізовано з полями редактора
            </span>
          </div>

          {translatedCurrentTags.length === 0 ? (
            <GlassCard className="text-center py-10">
              <p className="text-white/70 text-sm">Теги ще не введені в редакторі лістингу.</p>
              <p className="text-xs text-white/50 mt-1">Оберіть зразок зверху або введіть теги через кому.</p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {translatedCurrentTags.map((item, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-white/10 hover:bg-white/18 border border-white/15 transition-all flex flex-col justify-between gap-3 group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-white/40 w-5">
                          #{idx + 1}
                        </span>
                        <h4 className="text-sm font-bold text-white group-hover:text-amber-200 transition-colors">
                          {item.original}
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopy(item.original, `tag-${idx}`)}
                        className="text-white/50 hover:text-white p-1 transition-all"
                        title="Скопіювати англійський тег"
                      >
                        {copiedText === `tag-${idx}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-300" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Ukrainian Translation Highlight */}
                    <div className="p-2.5 rounded-lg bg-blue-500/15 border border-blue-400/25 flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-bold text-blue-100 flex items-center gap-1.5">
                        <span className="text-sm">🇺🇦</span> {item.ukrainian}
                      </span>
                      <span className="text-[10px] text-blue-200/70 shrink-0 font-medium">
                        {item.category}
                      </span>
                    </div>

                    {/* Intent Description */}
                    <p className="text-[11px] text-white/75 leading-relaxed">
                      {item.buyerIntent}
                    </p>
                  </div>

                  {/* Word-by-word Breakdown Pills */}
                  <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-1">
                    {item.wordsBreakdown.map((w, wIdx) => (
                      <span
                        key={wIdx}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-black/20 border border-white/10 text-white/90"
                      >
                        <span className="text-white/60">{w.en}:</span>{' '}
                        <span className="text-emerald-300 font-medium">{w.ua}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: AI Suggested 13 Tags Translation */}
      {activeSubView === 'ai' && aiSuggestedTags && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Переклад 13 ШІ-Згенерованих тегів від Gemini 3.7
            </span>
            <span className="text-xs text-white/60">
              Повний комплект для американського ринку
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {translatedAiTags.map((item, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-400/25 transition-all flex flex-col justify-between gap-3 group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-emerald-300/60 w-5">
                        #{idx + 1}
                      </span>
                      <h4 className="text-sm font-bold text-white group-hover:text-emerald-200 transition-colors">
                        {item.original}
                      </h4>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopy(item.original, `ai-tag-${idx}`)}
                      className="text-white/50 hover:text-white p-1 transition-all"
                      title="Скопіювати тег"
                    >
                      {copiedText === `ai-tag-${idx}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-300" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Ukrainian Translation Highlight */}
                  <div className="p-2.5 rounded-lg bg-black/25 border border-emerald-400/30 flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-emerald-200 flex items-center gap-1.5">
                      <span className="text-sm">🇺🇦</span> {item.ukrainian}
                    </span>
                    <span className="text-[10px] text-emerald-300/70 shrink-0 font-medium">
                      {item.category}
                    </span>
                  </div>

                  {/* Intent Description */}
                  <p className="text-[11px] text-white/80 leading-relaxed">
                    {item.buyerIntent}
                  </p>
                </div>

                {/* Word breakdown */}
                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-1">
                  {item.wordsBreakdown.map((w, wIdx) => (
                    <span
                      key={wIdx}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-white/90"
                    >
                      <span className="text-white/60">{w.en}:</span>{' '}
                      <span className="text-emerald-300 font-medium">{w.ua}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 3: Full Searchable Etsy SEO Dictionary */}
      {activeSubView === 'dictionary' && (
        <div className="flex flex-col gap-4">
          {/* Dictionary Filters & Search Bar */}
          <GlassCard className="p-4">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-white/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={dictionarySearch}
                  onChange={(e) => setDictionarySearch(e.target.value)}
                  placeholder="Шукати за англійським або українським словом (напр. gift, leather, лляний)..."
                  className="glass-input pl-10 w-full"
                />
              </div>

              {/* Category Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 md:pb-0">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                      selectedCategory === cat
                        ? 'bg-amber-500/30 text-amber-200 border border-amber-400/40 shadow-sm'
                        : 'bg-white/10 text-white/70 hover:text-white border border-white/15'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </GlassCard>

          {/* Dictionary Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredDictionary.map((item, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-white/10 hover:bg-white/18 border border-white/15 transition-all flex flex-col justify-between gap-3 group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-bold text-white group-hover:text-amber-200 transition-colors">
                      {item.english}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/15 shrink-0">
                      {item.category}
                    </span>
                  </div>

                  <div className="text-xs font-bold text-emerald-300 mt-1 flex items-center gap-1">
                    <span>🇺🇦</span> {item.ukrainian}
                  </div>

                  <p className="text-[11px] text-white/75 mt-2 leading-relaxed">
                    {item.intent}
                  </p>
                </div>

                <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs">
                  <span className="text-[10px] text-white/50">
                    Довжина: {item.english.length} симв. (Etsy max 20)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      handleCopy(item.english, `dict-${idx}`);
                      confetti({ particleCount: 15, spread: 30 });
                    }}
                    className="text-[11px] text-amber-200 hover:text-white flex items-center gap-1 font-semibold"
                  >
                    {copiedText === `dict-${idx}` ? (
                      <span className="text-emerald-300">Скопійовано!</span>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Скопіювати
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredDictionary.length === 0 && (
            <GlassCard className="text-center py-10">
              <p className="text-white/70 text-sm">Не знайдено слів за запитом «{dictionarySearch}».</p>
              <button
                type="button"
                onClick={() => {
                  setDictionarySearch('');
                  setSelectedCategory('Всі');
                }}
                className="mt-3 text-xs text-amber-300 underline font-semibold"
              >
                Очистити пошуковий фільтр
              </button>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
};
