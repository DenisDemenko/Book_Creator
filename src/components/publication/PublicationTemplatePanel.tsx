import React, { useMemo } from 'react';
import { Check, LayoutTemplate, Sparkles } from 'lucide-react';
import type { Book } from '../../types';
import {
  BOOK_DESIGN_THEME_CARDS,
  applyBookDesignTheme,
  getBookDesignThemeCard,
  recommendBookDesignThemes,
  studioThemeForLegacy,
  type BookDesignThemeId,
} from '../../data/bookDesignThemeCatalog';
import { PAGE_FORMAT_PRESETS, applyPageFormatPreset } from '../../utils/pageFormatPresets';
import { useLanguage } from '../../i18n/LanguageContext';

interface Props {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
}

type LayoutWithTheme = Book['layoutConfig'] & { bookDesignThemeId?: BookDesignThemeId };

/**
 * Шаблони «Верстка & Поля» на сторінці «Верстка для публікації».
 *
 * Пише ТІ САМІ поля книги, що й «Верстка & Поля» (формат і шаблон), через спільні
 * `applyPageFormatPreset` / `applyBookDesignTheme`, тож дві сторінки не можуть розійтися.
 * Показано лише те, що реально застосовують рушії: формат — усі; тему — DesignCraft;
 * шаблони Студії (Studio Classic / Studio Editorial) — ще й браузерний експорт Студії («Експорт видання»).
 * Серверний рушій Студії (Nova) для точного PDF тем не має, і панель так і каже.
 */
export const PublicationTemplatePanel: React.FC<Props> = ({ book, onUpdateBook }) => {
  const { t } = useLanguage();
  const layout = book.layoutConfig as LayoutWithTheme;
  // Книга без явного шаблону відповідає своєму legacy-оформленню Студії.
  const activeThemeId: BookDesignThemeId = layout.bookDesignThemeId || studioThemeForLegacy(layout.designTheme);
  const explicit = Boolean(layout.bookDesignThemeId);
  const active = getBookDesignThemeCard(activeThemeId);
  const recommended = useMemo(() => new Set(recommendBookDesignThemes(book, 3).filter((r) => r.score > 0).map((r) => r.themeId)), [book]);

  const studio = BOOK_DESIGN_THEME_CARDS.filter((c) => c.novaDesignTheme);
  const designcraft = BOOK_DESIGN_THEME_CARDS.filter((c) => !c.novaDesignTheme);

  const pickTheme = (id: BookDesignThemeId) =>
    onUpdateBook(
      { ...book, layoutConfig: applyBookDesignTheme(book.layoutConfig, id) as Book['layoutConfig'] },
      'Шаблон верстки',
      `Обрано шаблон «${getBookDesignThemeCard(id).label}» на сторінці «Верстка для публікації».`
    );

  const pickFormat = (id: (typeof PAGE_FORMAT_PRESETS)[number]['id']) =>
    onUpdateBook(
      { ...book, layoutConfig: applyPageFormatPreset(book.layoutConfig, id) },
      'Зміна формату верстки',
      `Встановлено формат: ${t(PAGE_FORMAT_PRESETS.find((p) => p.id === id)!.labelKey)}`
    );

  const card = (c: (typeof BOOK_DESIGN_THEME_CARDS)[number]) => {
    const sel = c.id === activeThemeId;
    return (
      <button
        key={c.id}
        type="button"
        data-template-id={c.id}
        onClick={() => pickTheme(c.id)}
        className={`text-left p-3 rounded-xl border transition-all ${
          sel ? 'bg-amber-500/10 border-amber-500/70 ring-1 ring-amber-500/40' : 'bg-slate-950/60 border-slate-800 hover:border-slate-600'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-white">{c.label}</span>
          {sel ? <Check className="w-3.5 h-3.5 text-amber-300 shrink-0" /> : recommended.has(c.id) ? (
            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">радимо</span>
          ) : null}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-slate-400">{c.taglineUk}</p>
      </button>
    );
  };

  return (
    <section className="mx-4 mt-4 lg:mx-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-5 space-y-5" data-publication-templates>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <LayoutTemplate className="w-4 h-4 text-amber-300" /> Шаблон верстки
          </h2>
          <p className="mt-1 text-[11px] text-slate-400 max-w-3xl">
            Ті самі шаблони, що й у «Верстка & Поля»: вибір тут і там — одне поле книги. Формат застосовують усі рушії,
            тему — DesignCraft; шаблони Студії — ще й браузерний експорт («Експорт видання»). Рушій Студії (Nova) для
            точного PDF тем не має.
          </p>
        </div>
        <div className="text-[11px] text-slate-300 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
          Зараз: <b className="text-amber-200">{active.label}</b>
          {!explicit && <span className="text-slate-500"> (за оформленням Студії)</span>}
          <span className="text-slate-500"> · {t(PAGE_FORMAT_PRESETS.find((p) => p.id === layout.formatPreset)?.labelKey || 'layoutView.preset6x9Label')}</span>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Формат сторінки · усі рушії</div>
        <div className="flex flex-wrap gap-2">
          {PAGE_FORMAT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-format-id={p.id}
              onClick={() => pickFormat(p.id)}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold ${
                layout.formatPreset === p.id ? 'bg-amber-500/15 border-amber-500/60 text-amber-200' : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Шаблони Студії · експорт Студії + DesignCraft</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{studio.map(card)}</div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
          <Sparkles className="w-3 h-3" /> Теми DesignCraft · лише рушій DesignCraft
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{designcraft.map(card)}</div>
        <p className="mt-2 text-[10px] text-slate-500">
          Браузерний експорт Студії для цих тем лишає своє оформлення ({layout.designTheme === 'editorial' ? 'Studio Editorial' : 'Studio Classic'}).
          Щоб побачити тему, оберіть нижче рушій DesignCraft і створіть точний PDF.
        </p>
      </div>
    </section>
  );
};
