import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, Sparkles } from 'lucide-react';
import type { Book } from '../types';
import {
  BOOK_DESIGN_THEME_CARDS,
  getBookDesignThemeCard,
  recommendBookDesignThemes,
  type BookDesignThemeCard,
  type BookDesignThemeId,
} from '../data/bookDesignThemeCatalog';

interface BookDesignThemeGalleryProps {
  book: Book;
  selectedThemeId?: BookDesignThemeId | null;
  onSelectTheme: (themeId: BookDesignThemeId) => void;
  onOpenPreview?: (themeId: BookDesignThemeId) => void;
}

function plainText(value: string): string {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sampleFromBook(book: Book): { chapter: string; section: string; body: string; sceneMeta: string } {
  const chapter = [...(book.chapters || [])].sort((a, b) => a.order - b.order).find((item) => item.sections?.length) || book.chapters?.[0];
  const section = chapter?.sections?.find((item) => plainText(item.content).length > 80) || chapter?.sections?.[0];
  const body = plainText(section?.content || book.synopsis || book.logline || 'Тут з’явиться фрагмент вашої книги.');
  const scene = section?.scene;
  const sceneMeta = [scene?.location, scene?.timeOfDay].filter(Boolean).join(' · ');
  return {
    chapter: chapter?.title || book.title || 'Розділ',
    section: section?.title || '',
    body: body.slice(0, 330),
    sceneMeta,
  };
}

function ThemeBookPreview({ book, theme, compact = false }: { book: Book; theme: BookDesignThemeCard; compact?: boolean }) {
  const sample = useMemo(() => sampleFromBook(book), [book]);
  const displayNumber = theme.preview.chapterNumber === 'display';
  const technical = theme.preview.chapterNumber === 'technical';
  const ornamental = theme.preview.chapterNumber === 'ornamental';
  const centered = theme.preview.align === 'center';
  const mono = theme.preview.accent === 'mono';
  const sans = theme.preview.accent === 'sans';

  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-700/80 bg-[#f7f3e9] text-slate-900 shadow-inner ${compact ? 'h-44' : 'h-64'}`}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300/70" />
      <div className="grid h-full grid-cols-2">
        <div className={`p-4 ${compact ? 'text-[8px]' : 'text-[10px]'} ${centered ? 'text-center' : 'text-left'}`}>
          {sample.sceneMeta && (technical || theme.id === 'thriller' || theme.id === 'graphic-story') ? (
            <div className={`mb-3 uppercase tracking-[0.16em] text-slate-500 ${mono ? 'font-mono' : ''}`}>
              {technical ? '// ' : ''}{sample.sceneMeta}
            </div>
          ) : null}

          {displayNumber ? (
            <div className={`${compact ? 'text-3xl' : 'text-5xl'} mb-1 font-semibold leading-none text-slate-300`}>03</div>
          ) : technical ? (
            <div className={`mb-2 font-mono text-slate-500`}>РОЗДІЛ 03</div>
          ) : ornamental ? (
            <div className="mb-2 text-slate-500">✦ РОЗДІЛ ТРЕТІЙ ✦</div>
          ) : (
            <div className="mb-2 uppercase tracking-[0.18em] text-slate-500">Розділ третій</div>
          )}

          <div className={`${compact ? 'text-sm' : 'text-lg'} font-semibold leading-tight ${sans ? 'font-sans' : 'font-serif'}`}>
            {sample.chapter}
          </div>
          {sample.section && <div className="mt-1 text-slate-500">{sample.section}</div>}
          <div className="my-3 text-slate-400">{theme.preview.sceneBreak}</div>
          <p className={`${sans ? 'font-sans' : 'font-serif'} leading-relaxed text-slate-700`}>
            {sample.body.slice(0, compact ? 120 : 175)}{sample.body.length > (compact ? 120 : 175) ? '…' : ''}
          </p>
        </div>

        <div className={`p-4 ${compact ? 'text-[8px]' : 'text-[10px]'} leading-relaxed text-slate-700 ${sans ? 'font-sans' : 'font-serif'}`}>
          <p>{sample.body.slice(compact ? 120 : 175, compact ? 245 : 330) || sample.body}</p>
          {(theme.id === 'sci-fi' || theme.id === 'thriller' || theme.id === 'noir-detective') && (
            <div className={`mt-4 rounded-md border border-slate-400/60 bg-slate-200/70 p-2 ${mono ? 'font-mono' : 'font-sans'}`}>
              <div className="mb-1 text-[0.8em] font-bold uppercase tracking-wider">
                {theme.id === 'sci-fi' ? 'Повідомлення · система' : theme.id === 'thriller' ? 'Доказ · 02:47' : 'Матеріали справи'}
              </div>
              <div>Семантичний блок автоматично отримує характер вибраної теми.</div>
            </div>
          )}
          {theme.id === 'classic' && <div className="mt-5 text-right italic text-slate-500">«Епіграф або цитата автора»</div>}
          {theme.id === 'business-premium' && <div className="mt-5 border-l-2 border-slate-700 pl-2 font-sans font-semibold">Ключова ідея</div>}
          {theme.id === 'children' && <div className="mt-4 rounded-lg border border-dashed border-slate-400 p-3 text-center font-sans">Місце для ілюстрації</div>}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  book,
  theme,
  selected,
  recommendedReason,
  large,
  onSelect,
  onPreview,
}: {
  book: Book;
  theme: BookDesignThemeCard;
  selected: boolean;
  recommendedReason?: string;
  large?: boolean;
  onSelect: () => void;
  onPreview?: () => void;
}) {
  return (
    <article className={`group rounded-2xl border transition-all ${selected ? 'border-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-950/20' : 'border-slate-800 bg-slate-950/75 hover:border-slate-600'} ${large ? 'p-4' : 'p-3'}`}>
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <ThemeBookPreview book={book} theme={theme} compact={!large} />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className={`${large ? 'text-base' : 'text-sm'} font-bold text-white`}>{theme.label}</h3>
              {selected && <Check className="h-4 w-4 text-cyan-300" />}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{theme.taglineUk}</p>
          </div>
        </div>
      </button>

      {recommendedReason && (
        <div className="mt-3 rounded-xl bg-slate-900/80 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          <span className="font-semibold text-cyan-300">Чому пасує: </span>{recommendedReason}
        </div>
      )}

      {onPreview && (
        <button type="button" onClick={onPreview} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-200">
          Відкрити живий розворот <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </article>
  );
}

export const BookDesignThemeGallery: React.FC<BookDesignThemeGalleryProps> = ({
  book,
  selectedThemeId,
  onSelectTheme,
  onOpenPreview,
}) => {
  const [showAll, setShowAll] = useState(true);
  const recommendations = useMemo(() => recommendBookDesignThemes(book, 3), [book]);
  const recommendedIds = new Set(recommendations.map((item) => item.themeId));

  return (
    <section className="space-y-6" data-book-design-gallery>
      <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/25 via-slate-950 to-slate-950 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">
              <Sparkles className="h-4 w-4" /> Рекомендовано для вашої книги
            </div>
            <h2 className="text-xl font-bold text-white">Один текст — три художні характери</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Це не демо-текст: картки беруть заголовок і фрагмент із поточної книги. Рекомендації пояснюються жанром, структурою, ілюстраціями та виносками.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {recommendations.map((recommendation) => {
            const theme = getBookDesignThemeCard(recommendation.themeId);
            return (
              <ThemeCard
                key={theme.id}
                book={book}
                theme={theme}
                large
                selected={selectedThemeId === theme.id}
                recommendedReason={recommendation.reasonsUk[0]}
                onSelect={() => onSelectTheme(theme.id)}
                onPreview={onOpenPreview ? () => onOpenPreview(theme.id) : undefined}
              />
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Усі 15 дизайн-систем</h2>
            <p className="text-xs text-slate-500">Рекомендовані теми залишаються у загальному каталозі — нічого не приховується від автора.</p>
          </div>
          <button type="button" onClick={() => setShowAll((value) => !value)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500">
            {showAll ? 'Згорнути' : 'Показати всі'}
          </button>
        </div>

        {showAll && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {BOOK_DESIGN_THEME_CARDS.map((theme) => (
              <ThemeCard
                key={theme.id}
                book={book}
                theme={theme}
                selected={selectedThemeId === theme.id}
                recommendedReason={recommendedIds.has(theme.id) ? 'Одна з трьох рекомендацій для цієї книги.' : undefined}
                onSelect={() => onSelectTheme(theme.id)}
                onPreview={onOpenPreview ? () => onOpenPreview(theme.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
