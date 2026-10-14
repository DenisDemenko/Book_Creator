import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, ExternalLink, Loader2, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import type { Book } from '../types';
import {
  DESIGNER_THEME_ENTITIES,
  cloneCustomBookDesignTheme,
  emptyCustomBookDesignTheme,
  type CustomBookDesignTheme,
  type DesignerBlockPlacement,
  type DesignerBlockRepeat,
  type DesignerCustomBlock,
  type DesignerEntityStyle,
  type DesignerFontAsset,
  type DesignerSemanticSource,
  type DesignerThemeEntity,
} from '../data/customBookDesignTheme';
import { defaultPlacementFor, defaultRepeatFor, placementOf } from '../data/bookDesignPlacement';

interface Props {
  book: Book;
}

function storageKey(bookId: string): string {
  return `book-design-studio:custom-themes:${bookId || 'draft'}`;
}

function normalizeTheme(raw: Partial<CustomBookDesignTheme>): CustomBookDesignTheme {
  const fallback = emptyCustomBookDesignTheme(raw.name || 'Моя тема');
  return {
    ...fallback,
    ...raw,
    version: 2,
    fonts: Array.isArray(raw.fonts) && raw.fonts.length ? raw.fonts : fallback.fonts,
    page: { ...fallback.page, ...(raw.page || {}) },
    chapterOpening: { ...fallback.chapterOpening, ...(raw.chapterOpening || {}) },
    entities: raw.entities || {},
    customBlocks: Array.isArray(raw.customBlocks)
      ? raw.customBlocks.map((block) => ({ ...block, ...placementOf(block, block.source) }))
      : [],
    editorRoles: ['designer', 'writer'],
    assetUrls: Array.isArray(raw.assetUrls) ? raw.assetUrls : [],
  };
}

function loadThemes(bookId: string): CustomBookDesignTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(storageKey(bookId));
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.map((item) => normalizeTheme(item)) : [];
  } catch {
    return [];
  }
}

function persistThemes(bookId: string, themes: CustomBookDesignTheme[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(bookId), JSON.stringify(themes));
}

function replaceFont(theme: CustomBookDesignTheme, slot: DesignerFontAsset['slot'], patch: Partial<DesignerFontAsset>): CustomBookDesignTheme {
  return {
    ...theme,
    fonts: theme.fonts.map((font) => font.slot === slot ? { ...font, ...patch } : font),
    updatedAt: new Date().toISOString(),
  };
}

function font(theme: CustomBookDesignTheme, slot: DesignerFontAsset['slot']): DesignerFontAsset {
  return theme.fonts.find((item) => item.slot === slot) || {
    slot,
    source: 'system',
    family: slot === 'body' ? 'DejaVu Serif' : 'DejaVu Sans',
    weights: [400, 700],
    styles: ['normal'],
  };
}

function entityStyle(theme: CustomBookDesignTheme, entity: DesignerThemeEntity): DesignerEntityStyle {
  return theme.entities[entity] || {
    entity,
    enabled: true,
    fontSlot: entity === 'body' || entity === 'quote' || entity === 'epigraph' ? 'body' : 'heading',
    align: 'left',
    background: { kind: 'none' },
    border: { style: 'none', sides: [] },
  };
}

function inputClass(): string {
  return 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500';
}

function defaultFields(source: DesignerSemanticSource): string[] {
  if (source === 'character') return ['name', 'description', 'goal', 'emotionalState'];
  if (source === 'scene') return ['title', 'location', 'timeOfDay', 'summary', 'participants'];
  if (source === 'conflict') return ['conflict', 'goal', 'resolution', 'intensityScore'];
  return ['title', 'text'];
}

function readPdfNote(res: Response): string {
  const raw = res.headers.get('X-Pdf-Note') || '';
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export const DesignerThemeStudio: React.FC<Props> = ({ book }) => {
  const initialThemes = useMemo(() => loadThemes(book.id), [book.id]);
  const [themes, setThemes] = useState<CustomBookDesignTheme[]>(initialThemes);
  const [activeId, setActiveId] = useState<string | null>(initialThemes[0]?.id || null);
  const [entity, setEntity] = useState<DesignerThemeEntity>('running-header');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<string | null>(null);
  const active = useMemo(() => themes.find((item) => item.id === activeId) || null, [themes, activeId]);

  useEffect(() => {
    const next = loadThemes(book.id);
    setThemes(next);
    setActiveId(next[0]?.id || null);
    setPreviewError(null);
    setPreviewInfo(null);
  }, [book.id]);

  function createTheme() {
    const theme = emptyCustomBookDesignTheme(`Тема для «${book.title || 'книги'}»`);
    const next = [theme, ...themes];
    setThemes(next);
    setActiveId(theme.id);
    persistThemes(book.id, next);
  }

  function updateActive(nextTheme: CustomBookDesignTheme) {
    const next = themes.map((item) => item.id === nextTheme.id ? nextTheme : item);
    setThemes(next);
    persistThemes(book.id, next);
    setPreviewError(null);
    setPreviewInfo(null);
  }

  function removeActive() {
    if (!active) return;
    const next = themes.filter((item) => item.id !== active.id);
    setThemes(next);
    setActiveId(next[0]?.id || null);
    persistThemes(book.id, next);
  }

  function duplicateActive() {
    if (!active) return;
    const copy = cloneCustomBookDesignTheme(active);
    const next = [copy, ...themes];
    setThemes(next);
    setActiveId(copy.id);
    persistThemes(book.id, next);
  }

  function exportActive() {
    if (!active) return;
    const blob = new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${active.name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'book-theme'}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  async function previewTheme(theme: CustomBookDesignTheme) {
    setPreviewingId(theme.id);
    setPreviewError(null);
    setPreviewInfo(null);
    try {
      const res = await fetch('/api/pdf/designcraft/theme-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          book,
          engineId: 'designcraft',
          theme: theme.basedOn || 'classic',
          customTheme: theme,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Не вдалося створити preview власної теми (${res.status}).`);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);

      const pages = res.headers.get('X-Pdf-Pages');
      const blocks = res.headers.get('X-Pdf-Custom-Blocks');
      const note = readPdfNote(res);
      setPreviewInfo([
        `Власна тема: ${theme.name}`,
        pages ? `${pages} стор.` : '',
        blocks ? `${blocks} семантичних блоків` : '',
        note,
      ].filter(Boolean).join(' · '));
    } catch (error) {
      setPreviewError((error as Error).message);
    } finally {
      setPreviewingId(null);
    }
  }

  function patchEntity(patch: Partial<DesignerEntityStyle>) {
    if (!active) return;
    const current = entityStyle(active, entity);
    updateActive({
      ...active,
      entities: { ...active.entities, [entity]: { ...current, ...patch, entity } },
      updatedAt: new Date().toISOString(),
    });
  }

  function addCustomBlock(source: DesignerSemanticSource = 'manual') {
    if (!active) return;
    const styleEntity: DesignerThemeEntity = source === 'character' || source === 'scene' || source === 'conflict' ? source : 'body';
    const block: DesignerCustomBlock = {
      id: `block-${Date.now().toString(36)}`,
      name: source === 'character' ? 'Картка персонажа' : source === 'scene' ? 'Картка сцени' : source === 'conflict' ? 'Картка конфлікту' : 'Новий блок',
      source,
      selector: '',
      placement: defaultPlacementFor(source),
      repeat: defaultRepeatFor(source),
      fields: defaultFields(source),
      style: { ...entityStyle(active, styleEntity), entity: styleEntity },
    };
    updateActive({ ...active, customBlocks: [...active.customBlocks, block], updatedAt: new Date().toISOString() });
  }

  function patchCustomBlock(id: string, patch: Partial<DesignerCustomBlock>) {
    if (!active) return;
    updateActive({
      ...active,
      customBlocks: active.customBlocks.map((block) => block.id === id ? { ...block, ...patch } : block),
      updatedAt: new Date().toISOString(),
    });
  }

  function removeCustomBlock(id: string) {
    if (!active) return;
    updateActive({ ...active, customBlocks: active.customBlocks.filter((block) => block.id !== id), updatedAt: new Date().toISOString() });
  }

  return (
    <section className="rounded-2xl border border-violet-500/25 bg-violet-950/10 p-5" data-designer-theme-studio>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-300"><Settings2 className="h-4 w-4" /> Designer Theme Studio</div>
          <h2 className="text-lg font-bold text-white">Власна тема книги</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Однаковий редактор доступний дизайнеру і письменнику. Обидва можуть збирати повну дизайн-систему книги: шрифти, сторінку, колонтитули, персонажів, сцени, конфлікти, семантичні блоки, ілюстрації, зміст та службові елементи.</p>
        </div>
        <button type="button" onClick={createTheme} className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-3.5 py-2 text-sm font-bold text-white hover:bg-violet-400"><Plus className="h-4 w-4" /> Створити тему</button>
      </div>

      {themes.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{themes.map((theme) => <button key={theme.id} type="button" onClick={() => setActiveId(theme.id)} className={`rounded-lg border px-3 py-1.5 text-xs ${activeId === theme.id ? 'border-violet-400 bg-violet-500/15 text-violet-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>{theme.name}</button>)}</div>}

      {!active ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">Створіть першу власну тему. Вона зберігатиметься окремо від 15 заводських дизайн-систем.</div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">Назва теми</label>
              <input value={active.name} onChange={(e) => updateActive({ ...active, name: e.target.value, updatedAt: new Date().toISOString() })} className={`${inputClass()} mt-1`} />
              <label className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Опис</label>
              <textarea value={active.descriptionUk} onChange={(e) => updateActive({ ...active, descriptionUk: e.target.value, updatedAt: new Date().toISOString() })} rows={3} className={`${inputClass()} mt-1 resize-y`} />
              <label className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Базова дизайн-система</label>
              <select value={active.basedOn || 'classic'} onChange={(e) => updateActive({ ...active, basedOn: e.target.value as CustomBookDesignTheme['basedOn'], updatedAt: new Date().toISOString() })} className={`${inputClass()} mt-1`}>
                <option value="classic">Classic</option><option value="modern-fiction">Modern Fiction</option><option value="sci-fi">Sci‑Fi</option><option value="fantasy">Fantasy</option><option value="dark-fantasy">Dark Fantasy</option><option value="thriller">Thriller</option><option value="noir-detective">Noir / Detective</option><option value="romance">Romance</option><option value="poetry-literary">Poetry / Literary</option><option value="non-fiction">Non‑Fiction</option><option value="academic-research">Academic / Research</option><option value="business-premium">Business Premium</option><option value="children">Children</option><option value="graphic-story">Graphic Story</option><option value="experimental-art">Experimental / Art</option>
              </select>
              <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-200">Повні права редагування теми: <strong>дизайнер + письменник</strong>.</div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="mb-2 text-xs font-bold text-white">Сутності теми</div>
              <div className="grid grid-cols-2 gap-1.5">{DESIGNER_THEME_ENTITIES.map((item) => <button key={item.id} type="button" onClick={() => setEntity(item.id)} className={`rounded-lg px-2 py-1.5 text-left text-[11px] ${entity === item.id ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:bg-slate-900'}`}>{item.labelUk}</button>)}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => updateActive({ ...active, updatedAt: new Date().toISOString() })} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"><Save className="h-3.5 w-3.5" /> Зберегти</button>
              <button type="button" onClick={() => void previewTheme(active)} disabled={previewingId === active.id} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50">{previewingId === active.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Живий PDF</button>
              <button type="button" onClick={duplicateActive} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"><Copy className="h-3.5 w-3.5" /> Копія</button>
              <button type="button" onClick={exportActive} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"><Download className="h-3.5 w-3.5" /> JSON</button>
              <button type="button" onClick={removeActive} className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/70 px-3 py-2 text-xs text-red-300"><Trash2 className="h-3.5 w-3.5" /> Видалити</button>
            </div>
            {previewError && <p role="alert" className="text-xs leading-relaxed text-red-300">{previewError}</p>}
            {previewInfo && <p className="text-[11px] leading-relaxed text-emerald-300">{previewInfo}</p>}
          </aside>

          <div className="space-y-5">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <h3 className="text-sm font-bold text-white">Шрифти</h3>
              <p className="mt-1 text-xs text-slate-500">Google Fonts можна підключити CSS-посиланням; інше джерело — прямим URL на WOFF2/WOFF/TTF/OTF. Завантаження файлу в Медіатеку додамо як серверне сховище, тому бінарні шрифти тут не кладемо в localStorage.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">{(['body', 'heading', 'mono', 'display'] as const).map((slot) => { const current = font(active, slot); return <div key={slot} className="rounded-lg border border-slate-800 p-3"><div className="mb-2 text-xs font-semibold text-slate-300">{slot === 'body' ? 'Основний текст' : slot === 'heading' ? 'Заголовки' : slot === 'mono' ? 'Службовий / mono' : 'Акцентний / display'}</div><select value={current.source} onChange={(e) => updateActive(replaceFont(active, slot, { source: e.target.value as DesignerFontAsset['source'] }))} className={inputClass()}><option value="system">Вбудований</option><option value="google-fonts">Google Fonts</option><option value="font-url">Інше URL-джерело</option><option value="upload">Файл / Медіатека</option></select><input value={current.family} onChange={(e) => updateActive(replaceFont(active, slot, { family: e.target.value }))} placeholder="Назва гарнітури" className={`${inputClass()} mt-2`} />{current.source !== 'system' && <input value={current.sourceUrl || ''} onChange={(e) => updateActive(replaceFont(active, slot, { sourceUrl: e.target.value }))} placeholder={current.source === 'google-fonts' ? 'https://fonts.googleapis.com/css2?...' : 'https://.../font.woff2'} className={`${inputClass()} mt-2`} />}<div className="mt-2 grid grid-cols-2 gap-2"><input value={current.licenseName || ''} onChange={(e) => updateActive(replaceFont(active, slot, { licenseName: e.target.value }))} placeholder="Ліцензія (напр. OFL)" className={inputClass()} /><input value={current.licenseUrl || ''} onChange={(e) => updateActive(replaceFont(active, slot, { licenseUrl: e.target.value }))} placeholder="URL ліцензії" className={inputClass()} /></div></div>; })}</div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <h3 className="text-sm font-bold text-white">Сторінка та службові області</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-400">Фон сторінки<input type="color" value={active.page.pageBackground.color || '#fffdf8'} onChange={(e) => updateActive({ ...active, page: { ...active.page, pageBackground: { ...active.page.pageBackground, kind: 'color', color: e.target.value } }, updatedAt: new Date().toISOString() })} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950" /></label><label className="text-xs text-slate-400">Колір тексту<input type="color" value={active.page.textColor} onChange={(e) => updateActive({ ...active, page: { ...active.page, textColor: e.target.value }, updatedAt: new Date().toISOString() })} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950" /></label><label className="text-xs text-slate-400">Акцент<input type="color" value={active.page.accentColor} onChange={(e) => updateActive({ ...active, page: { ...active.page, accentColor: e.target.value }, updatedAt: new Date().toISOString() })} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950" /></label></div>
            </div>

            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4">
              <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-white">{DESIGNER_THEME_ENTITIES.find((item) => item.id === entity)?.labelUk}</h3><p className="text-xs text-slate-500">Окрема візуальна роль для цієї сутності книги.</p></div><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={entityStyle(active, entity).enabled} onChange={(e) => patchEntity({ enabled: e.target.checked })} /> Увімкнено</label></div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="text-xs text-slate-400">Шрифт<select value={entityStyle(active, entity).fontSlot || 'body'} onChange={(e) => patchEntity({ fontSlot: e.target.value as DesignerFontAsset['slot'] })} className={`${inputClass()} mt-1`}><option value="body">Body</option><option value="heading">Heading</option><option value="mono">Mono</option><option value="display">Display</option></select></label><label className="text-xs text-slate-400">Вирівнювання<select value={entityStyle(active, entity).align || 'left'} onChange={(e) => patchEntity({ align: e.target.value as DesignerEntityStyle['align'] })} className={`${inputClass()} mt-1`}><option value="left">Ліворуч</option><option value="center">По центру</option><option value="right">Праворуч</option><option value="justify">По ширині</option></select></label><label className="text-xs text-slate-400">Колір тексту<input type="color" value={entityStyle(active, entity).textColor || active.page.textColor} onChange={(e) => patchEntity({ textColor: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950" /></label><label className="text-xs text-slate-400">Фон<select value={entityStyle(active, entity).background?.kind || 'none'} onChange={(e) => patchEntity({ background: { ...entityStyle(active, entity).background, kind: e.target.value as NonNullable<DesignerEntityStyle['background']>['kind'] } })} className={`${inputClass()} mt-1`}><option value="none">Немає</option><option value="color">Колір</option><option value="gradient">Градієнт</option><option value="image">Зображення</option></select></label></div>
              {entityStyle(active, entity).background?.kind === 'color' && <label className="mt-3 block text-xs text-slate-400">Колір фону<input type="color" value={entityStyle(active, entity).background?.color || '#e2e8f0'} onChange={(e) => patchEntity({ background: { ...entityStyle(active, entity).background, kind: 'color', color: e.target.value } })} className="mt-1 h-10 w-40 rounded-lg border border-slate-700 bg-slate-950" /></label>}
              {entityStyle(active, entity).background?.kind === 'image' && <label className="mt-3 block text-xs text-slate-400">URL фонового зображення<input value={entityStyle(active, entity).background?.imageUrl || ''} onChange={(e) => patchEntity({ background: { ...entityStyle(active, entity).background, kind: 'image', imageUrl: e.target.value, fit: 'cover' } })} placeholder="https://..." className={`${inputClass()} mt-1`} /></label>}
              {entityStyle(active, entity).background?.kind === 'gradient' && <label className="mt-3 block text-xs text-slate-400">Градієнт<input value={entityStyle(active, entity).background?.gradient || ''} onChange={(e) => patchEntity({ background: { ...entityStyle(active, entity).background, kind: 'gradient', gradient: e.target.value } })} placeholder="linear-gradient(90deg, #111827, #334155)" className={`${inputClass()} mt-1`} /></label>}
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-700" style={{ background: active.page.pageBackground.color || '#fffdf8' }}><div className="p-5" style={{ color: entityStyle(active, entity).textColor || active.page.textColor }}><div className="rounded-lg p-3" style={{ background: entityStyle(active, entity).background?.kind === 'color' ? entityStyle(active, entity).background?.color : entityStyle(active, entity).background?.kind === 'gradient' ? entityStyle(active, entity).background?.gradient : entityStyle(active, entity).background?.kind === 'image' && entityStyle(active, entity).background?.imageUrl ? `url(${entityStyle(active, entity).background?.imageUrl}) center/cover` : 'transparent', textAlign: entityStyle(active, entity).align === 'justify' ? 'justify' : entityStyle(active, entity).align || 'left' }}><div className="text-[10px] uppercase tracking-[0.14em] opacity-60">{DESIGNER_THEME_ENTITIES.find((item) => item.id === entity)?.labelUk}</div><div className="mt-2 text-sm">{entity === 'character' ? 'Персонаж: ім’я, опис, ціль, емоційний стан.' : entity === 'scene' ? 'Сцена: назва, локація, час, учасники та короткий опис.' : entity === 'conflict' ? 'Конфлікт: сторони, мета, напруга та розв’язання.' : 'Так виглядатиме сутність теми на реальному книжковому розвороті.'}</div></div></div></div>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-white">Власні семантичні блоки</h3><p className="mt-1 text-xs text-slate-500">Створюйте «Попередження», «Документ», «Пророцтво», «SMS», «Архівний запис» або блоки, що автоматично беруть дані з персонажа, сцени чи конфлікту.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => addCustomBlock('manual')} className="rounded-lg border border-amber-700 px-2.5 py-1.5 text-xs text-amber-200">+ Власний</button><button type="button" onClick={() => addCustomBlock('character')} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300">+ Персонаж</button><button type="button" onClick={() => addCustomBlock('scene')} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300">+ Сцена</button><button type="button" onClick={() => addCustomBlock('conflict')} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300">+ Конфлікт</button></div></div>
              <div className="mt-3 space-y-3">{active.customBlocks.map((block) => { const placement = placementOf(block, block.source); return <div key={block.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"><div className="grid gap-2 md:grid-cols-[1.1fr_180px_1fr_auto]"><input value={block.name} onChange={(e) => patchCustomBlock(block.id, { name: e.target.value })} className={inputClass()} placeholder="Назва блоку" /><select value={block.source} onChange={(e) => { const source = e.target.value as DesignerSemanticSource; patchCustomBlock(block.id, { source, fields: defaultFields(source), placement: defaultPlacementFor(source), repeat: defaultRepeatFor(source), style: { ...block.style, entity: source === 'character' || source === 'scene' || source === 'conflict' ? source : 'body' } }); }} className={inputClass()}><option value="manual">Ручний</option><option value="character">Персонаж</option><option value="scene">Сцена</option><option value="conflict">Конфлікт</option><option value="tag">Тег</option><option value="paragraph-style">Стиль абзацу</option></select><input value={block.selector || ''} onChange={(e) => patchCustomBlock(block.id, { selector: e.target.value })} className={inputClass()} placeholder="Умова / selector: ім’я, тег, тип…" /><button type="button" onClick={() => removeCustomBlock(block.id)} className="rounded-lg border border-red-900/70 px-2.5 text-red-300"><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 grid gap-2 md:grid-cols-2"><label className="text-[11px] text-slate-500">Розміщення<select value={placement.placement} onChange={(e) => patchCustomBlock(block.id, { placement: e.target.value as DesignerBlockPlacement })} className={`${inputClass()} mt-1`}><option value="inline">У тексті</option><option value="scene-opening">На початку сцени</option><option value="chapter-opening">На початку розділу</option><option value="full-width">На всю ширину</option><option value="full-page">Окрема сторінка</option><option value="appendix">У додатку</option></select></label><label className="text-[11px] text-slate-500">Повторення<select value={placement.repeat} onChange={(e) => patchCustomBlock(block.id, { repeat: e.target.value as DesignerBlockRepeat })} className={`${inputClass()} mt-1`}><option value="once">Один раз</option><option value="per-character">Для кожного персонажа</option><option value="per-scene">Для кожної сцени</option><option value="per-conflict">Для кожного конфлікту</option><option value="matched">Для кожного збігу selector</option></select></label></div><input value={(block.fields || []).join(', ')} onChange={(e) => patchCustomBlock(block.id, { fields: e.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className={`${inputClass()} mt-2`} placeholder="Поля блоку через кому" /><p className="mt-2 text-[11px] text-slate-500">Renderer adapter уже зв’язує джерела character / scene / conflict з реальними сутностями книги та передає для них розміщення «{placement.placement}» і повторення «{placement.repeat}».</p></div>; })}{active.customBlocks.length === 0 && <div className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-xs text-slate-500">Ще немає власних блоків.</div>}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
