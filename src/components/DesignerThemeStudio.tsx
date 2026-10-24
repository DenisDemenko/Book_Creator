import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Redo2,
  Save,
  Settings2,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { Book } from '../types';
import type { BookDesignThemeId } from '../data/bookDesignThemeCatalog';
import {
  DESIGNER_THEME_ENTITIES,
  cloneCustomBookDesignTheme,
  emptyCustomBookDesignTheme,
  type CustomBookDesignTheme,
  type DesignerCustomBlock,
  type DesignerEntityStyle,
  type DesignerFontAsset,
  type DesignerSemanticSource,
  type DesignerThemeEntity,
} from '../data/customBookDesignTheme';
import { defaultPlacementFor, defaultRepeatFor, placementOf } from '../data/bookDesignPlacement';
import { ZOOM_PRESETS, parseZoomValue, zoomLabel, zoomScaleOf, type ZoomValue } from '../utils/zoomPresets';
import { BookDesignBackgroundEditor } from './BookDesignBackgroundEditor';
import { BookDesignBackgroundLayers } from './BookDesignBackgroundLayers';
import { BookDesignBoxModelEditor } from './BookDesignBoxModelEditor';
import { BookDesignSemanticBlockEditor } from './BookDesignSemanticBlockEditor';

interface Props {
  book: Book;
  baseThemeId?: BookDesignThemeId | null;
  onDirtyChange?: (dirty: boolean) => void;
}

interface PreviewPage {
  chapter: string;
  section: string;
  body: string;
  sceneMeta: string;
}

type PreviewMode = 'page' | 'spread';
type ZoomMode = ZoomValue;
type MobilePanel = 'preview' | 'structure' | 'properties' | 'blocks';

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
    page: {
      ...fallback.page,
      ...(raw.page || {}),
      pageBackground: {
        ...fallback.page.pageBackground,
        ...(raw.page?.pageBackground || {}),
      },
    },
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
    fonts: theme.fonts.map((item) => item.slot === slot ? { ...item, ...patch } : item),
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
    background: { kind: 'none', opacity: 1 },
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

function plainText(value: string): string {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasBookText(book: Book): boolean {
  return (book.chapters || []).some((chapter) => (chapter.sections || []).some((section) => plainText(section.content || '').length > 0));
}

function previewPages(book: Book): PreviewPage[] {
  const pages: PreviewPage[] = [];
  for (const chapter of [...(book.chapters || [])].sort((a, b) => a.order - b.order)) {
    for (const section of [...(chapter.sections || [])].sort((a, b) => a.order - b.order)) {
      const body = plainText(section.content || '');
      if (!body) continue;
      pages.push({
        chapter: chapter.title || book.title || 'Розділ',
        section: section.title || '',
        body,
        sceneMeta: [section.scene?.location, section.scene?.timeOfDay].filter(Boolean).join(' · '),
      });
    }
  }
  if (!pages.length) {
    pages.push({ chapter: book.title || 'Книга', section: '', body: 'Додайте текст у розділі «Книга та текст», щоб побачити живий макет.', sceneMeta: '' });
  }
  return pages;
}

function readPdfNote(res: Response): string {
  const raw = res.headers.get('X-Pdf-Note') || '';
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function entityPreviewText(entity: DesignerThemeEntity): { eyebrow: string; text: string } {
  if (entity === 'character') return { eyebrow: 'Персонаж', text: 'Марта Лис · інженерка станції · мета: врятувати екіпаж.' };
  if (entity === 'scene') return { eyebrow: 'Сцена', text: 'Закритий шлюз · Орбіта · 02:47 · учасники: Марта, Лео.' };
  if (entity === 'conflict' || entity === 'evidence') return { eyebrow: 'Конфлікт', text: 'Шлюз заблокований. Рішення потребує ризикованого ручного втручання.' };
  if (entity === 'quote') return { eyebrow: 'Цитата', text: 'Книга повинна мати свій голос ще до того, як читач прочитає перше речення.' };
  if (entity === 'location-time') return { eyebrow: 'Локація / час', text: 'ОРБІТАЛЬНА СТАНЦІЯ · 02:47' };
  if (entity === 'heading-1') return { eyebrow: 'Заголовок розділу', text: 'Перший контакт' };
  return { eyebrow: DESIGNER_THEME_ENTITIES.find((item) => item.id === entity)?.labelUk || entity, text: 'Так виглядатиме вибрана сутність у дизайн-системі книги.' };
}

function pxFromMm(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value * 3.2;
}

function PreviewPageCard({ theme, page, entity }: { theme: CustomBookDesignTheme; page: PreviewPage; entity: DesignerThemeEntity }) {
  const style = entityStyle(theme, entity);
  const preview = entityPreviewText(entity);
  const bodyFont = font(theme, 'body').family;
  const headingFont = font(theme, 'heading').family;
  const blockBackground = style.background || { kind: 'none' as const, opacity: 1 };
  const paperColor = theme.page.pageBackground.color || '#fffdf8';
  const padding = style.paddingMm;
  const margin = style.marginMm;

  return (
    <div className="relative aspect-[0.705] w-[360px] max-w-full overflow-hidden rounded-[4px] bg-[#fffdf8] shadow-2xl shadow-black/30 ring-1 ring-black/10">
      <BookDesignBackgroundLayers background={theme.page.pageBackground} paperColor={paperColor} />
      <div className="relative z-10 flex h-full flex-col px-[10%] pb-[8%] pt-[9%]" style={{ color: theme.page.textColor, fontFamily: bodyFont }}>
        {page.sceneMeta && <div className="mb-4 text-[9px] font-semibold uppercase tracking-[0.2em] opacity-50">{page.sceneMeta}</div>}
        <div className="text-[10px] uppercase tracking-[0.18em] opacity-50">Розділ</div>
        <h3 className="mt-1 text-[25px] font-semibold leading-tight" style={{ color: theme.page.accentColor, fontFamily: headingFont }}>{page.chapter}</h3>
        {page.section && <div className="mt-2 text-[11px] font-medium opacity-65">{page.section}</div>}
        <p className="mt-6 text-[11px] leading-[1.75] text-current opacity-90">{page.body.slice(0, 610)}{page.body.length > 610 ? '…' : ''}</p>

        <div
          className="relative mt-6 overflow-hidden"
          style={{
            color: style.textColor || theme.page.textColor,
            fontFamily: font(theme, style.fontSlot || 'body').family,
            fontSize: style.fontSizePt ? `${Math.max(8, Math.min(20, style.fontSizePt))}px` : '11px',
            fontWeight: style.fontWeight,
            fontStyle: style.italic ? 'italic' : undefined,
            textAlign: style.align === 'justify' ? 'justify' : style.align || 'left',
            borderStyle: style.border?.style === 'none' ? undefined : style.border?.style,
            borderWidth: style.border?.style === 'none' ? undefined : `${style.border?.widthPt || 1}px`,
            borderColor: style.border?.style === 'none' ? undefined : style.border?.color || theme.page.accentColor,
            borderRadius: style.radiusMm ? `${pxFromMm(style.radiusMm)}px` : '6px',
            paddingTop: pxFromMm(padding?.top) ?? 12,
            paddingRight: pxFromMm(padding?.right) ?? 12,
            paddingBottom: pxFromMm(padding?.bottom) ?? 12,
            paddingLeft: pxFromMm(padding?.left) ?? 12,
            marginTop: pxFromMm(margin?.top),
            marginRight: pxFromMm(margin?.right),
            marginBottom: pxFromMm(margin?.bottom),
            marginLeft: pxFromMm(margin?.left),
          }}
        >
          <BookDesignBackgroundLayers background={blockBackground} paperColor="transparent" />
          <div className="relative z-10">
            <div className="text-[8px] font-bold uppercase tracking-[0.18em] opacity-55">{preview.eyebrow}</div>
            <div className="mt-1.5 leading-relaxed">{preview.text}</div>
          </div>
        </div>
        <div className="mt-auto text-center text-[9px] opacity-40">{page.chapter}</div>
      </div>
    </div>
  );
}

export const DesignerThemeStudio: React.FC<Props> = ({ book, baseThemeId, onDirtyChange }) => {
  const initialThemes = useMemo(() => loadThemes(book.id), [book.id]);
  const [themes, setThemes] = useState<CustomBookDesignTheme[]>(initialThemes);
  const [activeId, setActiveId] = useState<string | null>(initialThemes[0]?.id || null);
  const [entity, setEntity] = useState<DesignerThemeEntity>('body');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [undoStack, setUndoStack] = useState<CustomBookDesignTheme[]>([]);
  const [redoStack, setRedoStack] = useState<CustomBookDesignTheme[]>([]);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('page');
  const [zoom, setZoom] = useState<ZoomMode>('fit');
  const [pageIndex, setPageIndex] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('preview');
  const pages = useMemo(() => previewPages(book), [book]);
  const bookHasText = useMemo(() => hasBookText(book), [book]);
  const active = useMemo(() => themes.find((item) => item.id === activeId) || null, [themes, activeId]);

  useEffect(() => {
    const next = loadThemes(book.id);
    setThemes(next);
    setActiveId(next[0]?.id || null);
    setPreviewError(null);
    setPreviewInfo(null);
    setDirty(false);
    setUndoStack([]);
    setRedoStack([]);
    setPageIndex(0);
    setMobilePanel('preview');
  }, [book.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function createTheme() {
    const theme = emptyCustomBookDesignTheme(`Тема для «${book.title || 'книги'}»`);
    theme.basedOn = baseThemeId || 'classic';
    const next = [theme, ...themes];
    setThemes(next);
    setActiveId(theme.id);
    setDirty(true);
    setUndoStack([]);
    setRedoStack([]);
  }

  function updateActive(nextTheme: CustomBookDesignTheme, recordHistory = true) {
    if (!active) return;
    if (recordHistory) {
      setUndoStack((current) => [...current.slice(-39), active]);
      setRedoStack([]);
    }
    const next = themes.map((item) => item.id === nextTheme.id ? nextTheme : item);
    setThemes(next);
    persistThemes(book.id, next);
    setDirty(true);
    setPreviewError(null);
    setPreviewInfo(null);
  }

  function saveActive() {
    persistThemes(book.id, themes);
    setDirty(false);
  }

  function undo() {
    if (!active || !undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    const current = active;
    const next = themes.map((item) => item.id === current.id ? previous : item);
    setThemes(next);
    persistThemes(book.id, next);
    setUndoStack((items) => items.slice(0, -1));
    setRedoStack((items) => [...items.slice(-39), current]);
    setDirty(true);
  }

  function redo() {
    if (!active || !redoStack.length) return;
    const restored = redoStack[redoStack.length - 1];
    const current = active;
    const next = themes.map((item) => item.id === current.id ? restored : item);
    setThemes(next);
    persistThemes(book.id, next);
    setRedoStack((items) => items.slice(0, -1));
    setUndoStack((items) => [...items.slice(-39), current]);
    setDirty(true);
  }

  function chooseTheme(id: string) {
    if (id === activeId) return;
    if (dirty && typeof window !== 'undefined' && !window.confirm('Є незбережені зміни. Перейти до іншої теми? Локальна чернетка не буде втрачена.')) return;
    setActiveId(id);
    setDirty(false);
    setUndoStack([]);
    setRedoStack([]);
    setPreviewError(null);
    setPreviewInfo(null);
  }

  function selectEntity(nextEntity: DesignerThemeEntity) {
    setEntity(nextEntity);
    if (typeof window !== 'undefined' && window.innerWidth < 1280) setMobilePanel('properties');
  }

  function removeActive() {
    if (!active) return;
    const next = themes.filter((item) => item.id !== active.id);
    setThemes(next);
    setActiveId(next[0]?.id || null);
    persistThemes(book.id, next);
    setDirty(false);
    setUndoStack([]);
    setRedoStack([]);
  }

  function duplicateActive() {
    if (!active) return;
    const copy = cloneCustomBookDesignTheme(active);
    const next = [copy, ...themes];
    setThemes(next);
    setActiveId(copy.id);
    persistThemes(book.id, next);
    setDirty(false);
    setUndoStack([]);
    setRedoStack([]);
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
    if (!bookHasText) {
      setPreviewError('Щоб створити PDF preview, додайте хоча б один фрагмент тексту в розділі «Книга та текст».');
      setMobilePanel('preview');
      return;
    }

    const reservedWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
    if (reservedWindow) {
      reservedWindow.document.title = 'Готуємо PDF preview…';
      reservedWindow.document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Готуємо PDF preview…</p>';
    }

    setPreviewingId(theme.id);
    setPreviewError(null);
    setPreviewInfo(null);
    try {
      const res = await fetch('/api/pdf/designcraft/theme-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ book, engineId: 'designcraft', theme: theme.basedOn || 'classic', customTheme: theme }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Не вдалося створити preview власної теми (${res.status}).`);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      if (reservedWindow && !reservedWindow.closed) {
        reservedWindow.location.replace(href);
      } else {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      const pagesHeader = res.headers.get('X-Pdf-Pages');
      const blocks = res.headers.get('X-Pdf-Custom-Blocks');
      const note = readPdfNote(res);
      setPreviewInfo([`Власна тема: ${theme.name}`, pagesHeader ? `${pagesHeader} стор.` : '', blocks ? `${blocks} семантичних блоків` : '', note].filter(Boolean).join(' · '));
    } catch (error) {
      if (reservedWindow && !reservedWindow.closed) reservedWindow.close();
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

  function patchPageBackground(background: CustomBookDesignTheme['page']['pageBackground']) {
    if (!active) return;
    updateActive({
      ...active,
      page: { ...active.page, pageBackground: background },
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

  const currentPage = pages[Math.min(pageIndex, pages.length - 1)];
  const nextPage = pages[Math.min(pageIndex + 1, pages.length - 1)];
  const zoomScale = zoomScaleOf(zoom);

  return (
    <section className="rounded-2xl border border-violet-500/25 bg-violet-950/10 p-3 sm:p-4" data-designer-theme-studio>
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-300"><Settings2 className="h-4 w-4" /> Designer Theme Studio</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-white">{active?.name || 'Власна тема книги'}</h2>
            {active && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${dirty ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{dirty ? '● Є незбережені зміни' : 'Збережено ✓'}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={undo} disabled={!undoStack.length} className="rounded-lg border border-slate-700 p-2 text-slate-300 disabled:opacity-30" title="Скасувати"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={redo} disabled={!redoStack.length} className="rounded-lg border border-slate-700 p-2 text-slate-300 disabled:opacity-30" title="Повторити"><Redo2 className="h-4 w-4" /></button>
          {active && <button type="button" onClick={() => void previewTheme(active)} disabled={previewingId === active.id || !bookHasText} className="inline-flex items-center gap-2 rounded-lg border border-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">{previewingId === active.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} {previewingId === active.id ? 'Готуємо PDF…' : 'PDF preview'}</button>}
          {active && <button type="button" onClick={saveActive} disabled={!dirty} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-bold text-white hover:bg-violet-400 disabled:cursor-default disabled:bg-slate-800 disabled:text-slate-500"><Save className="h-4 w-4" /> Зберегти</button>}
          <button type="button" onClick={createTheme} className="inline-flex items-center gap-2 rounded-lg border border-violet-600 px-3 py-2 text-xs font-semibold text-violet-200"><Plus className="h-4 w-4" /> Нова тема</button>
        </div>
      </div>

      {previewingId && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.07] px-3 py-2 text-xs text-cyan-100" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Готуємо розворот книги… DesignCraft формує живий PDF preview.
        </div>
      )}
      {previewError && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3 py-3 text-xs text-red-100 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Не вдалося створити PDF preview.</strong> {previewError} Ваш дизайн не втрачено.</span></div>
          {active && bookHasText && <button type="button" onClick={() => void previewTheme(active)} className="rounded-lg border border-red-400/40 px-3 py-1.5 font-semibold text-red-100">Спробувати ще</button>}
        </div>
      )}
      {previewInfo && <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-emerald-200">{previewInfo}</div>}

      {themes.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{themes.map((theme) => <button key={theme.id} type="button" onClick={() => chooseTheme(theme.id)} className={`rounded-lg border px-3 py-1.5 text-xs ${activeId === theme.id ? 'border-violet-400 bg-violet-500/15 text-violet-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>{theme.name}</button>)}</div>}

      {!active ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <div className="text-base font-semibold text-slate-200">Створіть власну тему</div>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">Вона успадкує вибрану базову дизайн-систему, але всі зміни типографіки, кольорів і семантичних блоків залишаться окремими.</p>
          <button type="button" onClick={createTheme} className="mt-4 rounded-xl bg-violet-500 px-4 py-2 text-sm font-bold text-white">Створити тему</button>
        </div>
      ) : (
        <>
          {!bookHasText && (
            <div className="mt-4 rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/[0.05] p-5 text-center">
              <div className="text-sm font-semibold text-amber-100">У книзі ще немає тексту для живого preview</div>
              <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-slate-400">Додайте хоча б один фрагмент у розділі «Книга та текст». Налаштування теми можна продовжувати — вони не втратяться.</p>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950/70 p-1 sm:grid-cols-4 xl:hidden" aria-label="Мобільна навігація Designer Studio">
            {([
              ['preview', 'Preview'],
              ['structure', 'Структура'],
              ['properties', 'Властивості'],
              ['blocks', 'Блоки'],
            ] as Array<[MobilePanel, string]>).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setMobilePanel(id)} className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${mobilePanel === id ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400'}`}>{label}</button>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:min-h-[720px] xl:grid-cols-[260px_minmax(420px,1fr)_320px]">
            <aside className={`${mobilePanel === 'structure' ? 'block' : 'hidden'} space-y-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 xl:block`}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Тема</div>
                <input value={active.name} onChange={(e) => updateActive({ ...active, name: e.target.value, updatedAt: new Date().toISOString() })} className={`${inputClass()} mt-2`} />
                <select value={active.basedOn || 'classic'} onChange={(e) => updateActive({ ...active, basedOn: e.target.value as CustomBookDesignTheme['basedOn'], updatedAt: new Date().toISOString() })} className={`${inputClass()} mt-2`}>
                  <option value="classic">Classic</option><option value="modern-fiction">Modern Fiction</option><option value="sci-fi">Sci‑Fi</option><option value="fantasy">Fantasy</option><option value="dark-fantasy">Dark Fantasy</option><option value="thriller">Thriller</option><option value="noir-detective">Noir / Detective</option><option value="romance">Romance</option><option value="poetry-literary">Poetry / Literary</option><option value="non-fiction">Non‑Fiction</option><option value="academic-research">Academic / Research</option><option value="business-premium">Business Premium</option><option value="children">Children</option><option value="graphic-story">Graphic Story</option><option value="experimental-art">Experimental / Art</option>
                </select>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Структура</div>
                <div className="space-y-1">{DESIGNER_THEME_ENTITIES.map((item) => <button key={item.id} type="button" onClick={() => selectEntity(item.id)} className={`w-full rounded-lg px-2.5 py-2 text-left text-[11px] transition ${entity === item.id ? 'bg-cyan-500/15 font-semibold text-cyan-200' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>{item.labelUk}</button>)}</div>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <div className="mb-2 flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Блоки</div><button type="button" onClick={() => { addCustomBlock('manual'); setMobilePanel('blocks'); }} className="text-xs font-semibold text-amber-300">+ Додати</button></div>
                <div className="space-y-1">{active.customBlocks.map((block) => <button key={block.id} type="button" onClick={() => { selectEntity(block.style.entity); }} className="w-full rounded-lg border border-slate-800 px-2.5 py-2 text-left text-[11px] text-slate-400 hover:border-amber-600/50 hover:text-amber-200">{block.name}</button>)}{active.customBlocks.length === 0 && <div className="rounded-lg border border-dashed border-slate-800 p-3 text-[11px] text-slate-600">Блоків ще немає.</div>}</div>
              </div>
            </aside>

            <main className={`${mobilePanel === 'preview' ? 'flex' : 'hidden'} min-w-0 flex-col rounded-xl border border-slate-800 bg-slate-900/55 xl:flex`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
                <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-1"><button type="button" onClick={() => setPreviewMode('page')} className={`rounded-md px-2.5 py-1.5 text-[11px] ${previewMode === 'page' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Одна сторінка</button><button type="button" onClick={() => setPreviewMode('spread')} className={`hidden rounded-md px-2.5 py-1.5 text-[11px] sm:block ${previewMode === 'spread' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Розворот</button></div>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-400" data-zoom-select><span>Масштаб</span><select value={String(zoom)} onChange={(event) => setZoom(parseZoomValue(event.target.value))} aria-label="Масштаб перегляду" className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-cyan-200">{ZOOM_PRESETS.map((value) => <option key={value} value={String(value)}>{zoomLabel(value)}</option>)}<option value="fit">{zoomLabel('fit')}</option></select></label>
              </div>
              <div className="flex flex-1 overflow-auto bg-slate-950/40 p-3 sm:p-6">
                <div className="m-auto flex items-start justify-center gap-5" style={{ zoom: zoomScale }} data-zoom-scale={zoomScale}>
                  <PreviewPageCard theme={active} page={currentPage} entity={entity} />
                  {previewMode === 'spread' && <PreviewPageCard theme={active} page={nextPage} entity={entity} />}
                </div>
              </div>
              <div className="flex items-center justify-center gap-4 border-t border-slate-800 px-3 py-2.5 text-xs text-slate-400">
                <button type="button" onClick={() => setPageIndex((value) => Math.max(0, value - 1))} disabled={pageIndex <= 0} className="rounded-md p-1 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                <span>{Math.min(pageIndex + 1, pages.length)} / {pages.length}</span>
                <button type="button" onClick={() => setPageIndex((value) => Math.min(pages.length - 1, value + 1))} disabled={pageIndex >= pages.length - 1} className="rounded-md p-1 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </main>

            <aside className={`${mobilePanel === 'properties' ? 'block' : 'hidden'} space-y-3 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3 xl:block`}>
              <div className="flex items-start justify-between gap-2"><div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">Властивості</div><h3 className="mt-1 text-sm font-bold text-white">{DESIGNER_THEME_ENTITIES.find((item) => item.id === entity)?.labelUk}</h3></div>{entity !== 'page' && <label className="flex items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={entityStyle(active, entity).enabled} onChange={(e) => patchEntity({ enabled: e.target.checked })} /> On</label>}</div>

              {entity !== 'page' && <details open className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Типографіка</summary>
                <div className="mt-3 space-y-2">
                  <label className="block text-[11px] text-slate-500">Шрифт<select value={entityStyle(active, entity).fontSlot || 'body'} onChange={(e) => patchEntity({ fontSlot: e.target.value as DesignerFontAsset['slot'] })} className={`${inputClass()} mt-1`}><option value="body">Основний</option><option value="heading">Заголовки</option><option value="mono">Mono</option><option value="display">Display</option></select></label>
                  <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-500">Кегль, pt<input type="number" min={7} max={56} step={0.5} value={entityStyle(active, entity).fontSizePt ?? ''} onChange={(e) => patchEntity({ fontSizePt: e.target.value === '' ? undefined : Number(e.target.value) })} className={`${inputClass()} mt-1`} placeholder="За темою" /></label><label className="text-[11px] text-slate-500">Вирівнювання<select value={entityStyle(active, entity).align || 'left'} onChange={(e) => patchEntity({ align: e.target.value as DesignerEntityStyle['align'] })} className={`${inputClass()} mt-1`}><option value="left">Ліворуч</option><option value="center">Центр</option><option value="right">Праворуч</option><option value="justify">По ширині</option></select></label></div>
                  <div className="grid grid-cols-2 gap-2"><label className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-2 text-xs text-slate-300"><input type="checkbox" checked={Number(entityStyle(active, entity).fontWeight || 0) >= 600} onChange={(e) => patchEntity({ fontWeight: e.target.checked ? 700 : 400 })} /> <strong>Bold</strong></label><label className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-2 text-xs text-slate-300"><input type="checkbox" checked={Boolean(entityStyle(active, entity).italic)} onChange={(e) => patchEntity({ italic: e.target.checked })} /> <em>Italic</em></label></div>
                </div>
              </details>}

              {entity !== 'page' && <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Колір</summary>
                <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-500">Текст<input type="color" value={entityStyle(active, entity).textColor || active.page.textColor} onChange={(e) => patchEntity({ textColor: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950" /></label><label className="text-[11px] text-slate-500">Акцент<input type="color" value={entityStyle(active, entity).accentColor || active.page.accentColor} onChange={(e) => patchEntity({ accentColor: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950" /></label></div>
              </details>}

              {entity === 'page' && <details open className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Кольори сторінки</summary>
                <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-500">Текст<input type="color" value={active.page.textColor} onChange={(e) => updateActive({ ...active, page: { ...active.page, textColor: e.target.value }, updatedAt: new Date().toISOString() })} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950" /></label><label className="text-[11px] text-slate-500">Акцент<input type="color" value={active.page.accentColor} onChange={(e) => updateActive({ ...active, page: { ...active.page, accentColor: e.target.value }, updatedAt: new Date().toISOString() })} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950" /></label></div>
              </details>}

              <details open={entity === 'page'} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Фон</summary>
                <div className="mt-3">
                  <BookDesignBackgroundEditor
                    bookId={book.id}
                    background={entity === 'page' ? active.page.pageBackground : entityStyle(active, entity).background || { kind: 'none', opacity: 1 }}
                    paperColor={active.page.pageBackground.color || '#fffdf8'}
                    compact={entity !== 'page'}
                    onChange={(background) => entity === 'page' ? patchPageBackground(background) : patchEntity({ background })}
                  />
                </div>
              </details>

              {entity !== 'page' && <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Рамка та відступи</summary>
                <div className="mt-3">
                  <BookDesignBoxModelEditor style={entityStyle(active, entity)} onChange={patchEntity} />
                </div>
              </details>}

              <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Шрифти теми</summary>
                <div className="mt-3 space-y-3">{(['body', 'heading', 'mono', 'display'] as const).map((slot) => { const current = font(active, slot); return <div key={slot}><div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">{slot}</div><input value={current.family} onChange={(e) => updateActive(replaceFont(active, slot, { family: e.target.value }))} className={inputClass()} /></div>; })}</div>
              </details>

              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3"><button type="button" onClick={duplicateActive} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-300"><Copy className="h-3.5 w-3.5" /> Копія</button><button type="button" onClick={exportActive} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-300"><Download className="h-3.5 w-3.5" /> JSON</button><button type="button" onClick={removeActive} className="inline-flex items-center gap-1 rounded-lg border border-red-900/70 px-2.5 py-1.5 text-[11px] text-red-300"><Trash2 className="h-3.5 w-3.5" /> Видалити</button></div>
            </aside>
          </div>

          <div className={`${mobilePanel === 'blocks' ? 'block' : 'hidden'} mt-4 xl:block`}>
            <BookDesignSemanticBlockEditor
              blocks={active.customBlocks}
              onAdd={addCustomBlock}
              onChange={patchCustomBlock}
              onRemove={removeCustomBlock}
            />
          </div>
        </>
      )}
    </section>
  );
};
