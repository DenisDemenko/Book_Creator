import React, { useMemo, useState } from 'react';
import type { Book } from '../types';
import type { BookDesignThemeId } from '../data/bookDesignThemeCatalog';
import { emptyCustomBookDesignTheme, type CustomBookDesignTheme } from '../data/customBookDesignTheme';

interface Props {
  book: Book;
  baseThemeId: BookDesignThemeId;
  baseThemeLabel: string;
  onCreated?: (theme: CustomBookDesignTheme) => void;
}

type AuthorPreset = 'literary' | 'compact' | 'airy' | 'large';
type AuthorHeadingStyle = 'classic' | 'modern';

const PRESETS: Record<AuthorPreset, { label: string; description: string; body: number; h1: number; h2: number }> = {
  literary: { label: 'Літературний', description: 'Збалансований кегль для прози й романів.', body: 11.5, h1: 27, h2: 17 },
  compact: { label: 'Компактний', description: 'Більше тексту на сторінці, щільніший ритм.', body: 10, h1: 23, h2: 15 },
  airy: { label: 'Повітряний', description: 'Більше візуального простору та крупніший текст.', body: 12.5, h1: 30, h2: 19 },
  large: { label: 'Великий шрифт', description: 'Підвищена читабельність і виразні заголовки.', body: 14, h1: 34, h2: 21 },
};

function storageKey(bookId: string): string {
  return `book-design-studio:custom-themes:${bookId || 'draft'}`;
}

function loadStoredThemes(bookId: string): CustomBookDesignTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(bookId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTheme(bookId: string, theme: CustomBookDesignTheme) {
  if (typeof window === 'undefined') return;
  const existing = loadStoredThemes(bookId).filter((item) => item?.id !== theme.id);
  window.localStorage.setItem(storageKey(bookId), JSON.stringify([theme, ...existing]));
}

export const BookDesignAuthorQuickSetup: React.FC<Props> = ({ book, baseThemeId, baseThemeLabel, onCreated }) => {
  const [preset, setPreset] = useState<AuthorPreset>('literary');
  const [bodyFont, setBodyFont] = useState<'DejaVu Serif' | 'DejaVu Sans'>('DejaVu Serif');
  const [headingStyle, setHeadingStyle] = useState<AuthorHeadingStyle>('classic');
  const [accentColor, setAccentColor] = useState('#0f766e');
  const [bodySize, setBodySize] = useState(PRESETS.literary.body);

  const preview = useMemo(() => {
    const chapter = [...(book.chapters || [])].sort((a, b) => a.order - b.order)[0];
    const section = chapter?.sections?.[0];
    const raw = String(section?.content || book.synopsis || book.logline || 'Тут з’явиться фрагмент вашої книги.');
    const body = raw.replace(/<[^>]*>/g, ' ').replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim();
    return {
      chapter: chapter?.title || book.title || 'Розділ',
      section: section?.title || '',
      body: body.slice(0, 420),
    };
  }, [book]);

  function choosePreset(next: AuthorPreset) {
    setPreset(next);
    setBodySize(PRESETS[next].body);
  }

  function createCustomTheme() {
    const now = new Date().toISOString();
    const sizes = PRESETS[preset];
    const theme = emptyCustomBookDesignTheme(`${baseThemeLabel} — моя версія`);
    theme.basedOn = baseThemeId;
    theme.updatedAt = now;
    theme.page = { ...theme.page, accentColor };
    theme.fonts = theme.fonts.map((font) => {
      if (font.slot === 'body') return { ...font, source: 'system', family: bodyFont };
      if (font.slot === 'heading') return { ...font, source: 'system', family: headingStyle === 'classic' ? 'DejaVu Serif' : 'DejaVu Sans' };
      return font;
    });
    theme.entities = {
      ...theme.entities,
      body: { entity: 'body', enabled: true, fontSlot: 'body', fontSizePt: bodySize, align: 'justify' },
      'heading-1': { entity: 'heading-1', enabled: true, fontSlot: 'heading', fontSizePt: sizes.h1, fontWeight: 700, align: headingStyle === 'classic' ? 'center' : 'left', accentColor },
      'heading-2': { entity: 'heading-2', enabled: true, fontSlot: 'heading', fontSizePt: sizes.h2, fontWeight: 700, align: 'left', accentColor },
    };
    saveTheme(book.id, theme);
    onCreated?.(theme);
  }

  const headingFont = headingStyle === 'classic' ? 'DejaVu Serif' : 'DejaVu Sans';

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-slate-950/80 p-4" data-author-quick-setup>
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">Швидке налаштування стилю</div>
          <h3 className="mt-1 text-lg font-bold text-white">{baseThemeLabel} — зробіть стиль своїм</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Тут залишені лише параметри, які найчастіше потрібні автору. Розширені налаштування завжди доступні в режимі «Дизайнер».</p>

          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">Стиль набору</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.entries(PRESETS) as Array<[AuthorPreset, (typeof PRESETS)[AuthorPreset]]>).map(([id, item]) => (
                <button key={id} type="button" onClick={() => choosePreset(id)} className={`rounded-xl border p-3 text-left ${preset === id ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'}`}>
                  <div className={`text-xs font-bold ${preset === id ? 'text-cyan-200' : 'text-slate-200'}`}>{item.label}</div>
                  <div className="mt-1 text-[10px] leading-relaxed text-slate-500">{item.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[11px] text-slate-500">Шрифт тексту<select value={bodyFont} onChange={(event) => setBodyFont(event.target.value as typeof bodyFont)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"><option value="DejaVu Serif">Класичний serif</option><option value="DejaVu Sans">Сучасний sans</option></select></label>
            <label className="text-[11px] text-slate-500">Розмір тексту<div className="mt-1 flex h-[34px] items-center overflow-hidden rounded-lg border border-slate-700 bg-slate-950"><button type="button" onClick={() => setBodySize((value) => Math.max(8, Number((value - 0.5).toFixed(1))))} className="h-full px-3 text-slate-300">−</button><div className="flex-1 text-center text-xs text-slate-200">{bodySize} pt</div><button type="button" onClick={() => setBodySize((value) => Math.min(24, Number((value + 0.5).toFixed(1))))} className="h-full px-3 text-slate-300">+</button></div></label>
            <label className="text-[11px] text-slate-500">Заголовки<select value={headingStyle} onChange={(event) => setHeadingStyle(event.target.value as AuthorHeadingStyle)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"><option value="classic">Класичні</option><option value="modern">Сучасні</option></select></label>
            <label className="text-[11px] text-slate-500">Колір акценту<input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} className="mt-1 h-[34px] w-full rounded-lg border border-slate-700 bg-slate-950" /></label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={createCustomTheme} className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400">Зберегти як свою тему</button>
            <span className="text-[10px] text-slate-500">Вбудована тема {baseThemeLabel} не змінюється — створюється окрема копія.</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#fffdf8] p-6 text-slate-900 shadow-inner" style={{ fontFamily: bodyFont }}>
          <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400">Preview</div>
          <h4 className="mt-4 font-bold leading-tight" style={{ color: accentColor, fontFamily: headingFont, fontSize: `${Math.max(18, PRESETS[preset].h1 * 0.75)}px`, textAlign: headingStyle === 'classic' ? 'center' : 'left' }}>{preview.chapter}</h4>
          {preview.section && <div className="mt-2 text-[10px] text-slate-500">{preview.section}</div>}
          <p className="mt-5 leading-[1.75] text-slate-700" style={{ fontSize: `${Math.max(10, bodySize * 0.9)}px`, textAlign: 'justify' }}>{preview.body || 'Додайте текст книги, щоб побачити живий preview.'}</p>
          <div className="mt-5 border-l-2 pl-3 text-[10px] font-semibold" style={{ borderColor: accentColor, color: accentColor }}>Акцент теми</div>
        </div>
      </div>
    </section>
  );
};
