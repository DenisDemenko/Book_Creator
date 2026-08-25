import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutPanelTop,
  Image as ImageIcon,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Move,
  Maximize2,
  Info,
  Hash,
} from 'lucide-react';
import { Book, PdfChapterLayout, PdfFrameObject, PdfWrapMode } from '../types';
import { getChapterDisplayPageNumber } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';

interface PdfEditorViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onSaveBook?: () => void;
}

/**
 * WYSIWYG-верстка PDF: (1) «рамка тексту» — межі текстового блоку сторінки
 * (відступи top/bottom/inside/outside), які можна тягнути прямо на канві;
 * (2) графічні об'єкти (ілюстрації глави) з режимом обтікання текстом.
 *
 * Технічне обмеження, зафіксоване свідомо: у браузері немає нативного API
 * для обтікання тексту довільною формою навколо об'єкта з довільними
 * (x, y) — це підтримують лише спеціалізовані DTP-рушії (InDesign тощо).
 * Тому: об'єкти з wrapMode 'none' переміщуються повністю вільно (drag у
 * будь-яку точку сторінки, реальний overlay). Об'єкти з wrapMode
 * 'left'/'right'/'top-bottom' розміщуються як справжні CSS float/block-
 * елементи на початку текстового потоку глави — це дає СПРАВЖНє, живе
 * обтікання тексту (не імітацію), але порядок серед таких об'єктів
 * керується кнопками «вище/нижче», а не довільним (x, y).
 */

const SCALE = 3; // px на 1 мм
const MIN_MARGIN_MM = 5;
const MIN_OBJECT_MM = 10;

function mmToPx(mm: number): number {
  return mm * SCALE;
}
function pxToMm(px: number): number {
  return px / SCALE;
}

type DragState =
  | { type: 'frame-edge'; edge: 'top' | 'bottom' | 'inside' | 'outside'; startClientX: number; startClientY: number; startMm: number }
  | { type: 'object-move'; objectId: string; startClientX: number; startClientY: number; startXMm: number; startYMm: number }
  | { type: 'object-resize'; objectId: string; startClientX: number; startClientY: number; startWidthMm: number; startHeightMm: number };

export const PdfEditorView: React.FC<PdfEditorViewProps> = ({ book, onUpdateBook, onSaveBook }) => {
  const { t } = useLanguage();
  const [selectedChapterId, setSelectedChapterId] = useState<string>(book.chapters[0]?.id || '');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const chapter = book.chapters.find((c) => c.id === selectedChapterId) || book.chapters[0];
  const pdfLayout = book.pdfLayout || { chapters: [] };

  const pageWidthMm = book.layoutConfig.pageWidthMm || 148;
  const pageHeightMm = book.layoutConfig.pageHeightMm || 210;

  // --- Нумерація сторінок (глобальний друкарський параметр книги) ---
  const typography = book.layoutConfig.typography || ({} as Book['layoutConfig']['typography']);
  const showPageNumbers = typography.showPageNumbers !== false;
  // 6 позицій номера; сумісність зі старими значеннями 'bottom-outside'/'top-outside'
  const POSITIONS = ['bottom-center', 'bottom-left', 'bottom-right', 'top-left', 'top-right', 'top-center'] as const;
  type PageNumPos = (typeof POSITIONS)[number];
  const rawPosition: string = (typography.pageNumberPosition as string) || 'bottom-center';
  const pageNumPosition: PageNumPos =
    rawPosition === 'bottom-outside' ? 'bottom-right'
    : rawPosition === 'top-outside' ? 'top-right'
    : (POSITIONS as readonly string[]).includes(rawPosition) ? (rawPosition as PageNumPos)
    : 'bottom-center';

  const pageNumStart = typography.pageNumberStart;
  const pageNumStartMode = pageNumStart?.mode || 'title';
  const pageNumStartNumber = pageNumStart?.startNumber ?? 1;

  const updatePageNumbering = (patch: Partial<typeof typography>) => {
    onUpdateBook({
      ...book,
      layoutConfig: {
        ...book.layoutConfig,
        typography: { ...typography, ...patch },
      },
    });
  };

  // Номер сторінки для прев'ю — спільна пагінація + вибраний початок нумерації.
  const chapterPageNumber = getChapterDisplayPageNumber(book, selectedChapterId);

  const defaultMargins = {
    topMm: book.layoutConfig.margins?.topMm ?? 20,
    bottomMm: book.layoutConfig.margins?.bottomMm ?? 20,
    insideMm: book.layoutConfig.margins?.insideMm ?? 18,
    outsideMm: book.layoutConfig.margins?.outsideMm ?? 15,
  };

  const chapterLayout: PdfChapterLayout = pdfLayout.chapters.find((c) => c.chapterId === selectedChapterId) || {
    chapterId: selectedChapterId,
    margins: defaultMargins,
    objects: [],
  };
  const margins = chapterLayout.margins || defaultMargins;
  const objects = chapterLayout.objects || [];

  const commitChapterLayout = (patch: Partial<PdfChapterLayout>) => {
    const nextLayout: PdfChapterLayout = { ...chapterLayout, margins, objects, ...patch };
    const otherChapters = pdfLayout.chapters.filter((c) => c.chapterId !== selectedChapterId);
    onUpdateBook({
      ...book,
      pdfLayout: { chapters: [...otherChapters, nextLayout] },
    });
  };

  const updateMargins = (patch: Partial<typeof margins>) => {
    commitChapterLayout({ margins: { ...margins, ...patch } });
  };

  const updateObject = (objectId: string, patch: Partial<PdfFrameObject>) => {
    commitChapterLayout({ objects: objects.map((o) => (o.id === objectId ? { ...o, ...patch } : o)) });
  };

  const deleteObject = (objectId: string) => {
    commitChapterLayout({ objects: objects.filter((o) => o.id !== objectId) });
    if (selectedObjectId === objectId) setSelectedObjectId(null);
  };

  const reorderObject = (objectId: string, direction: 'up' | 'down') => {
    const idx = objects.findIndex((o) => o.id === objectId);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= objects.length) return;
    const next = [...objects];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    commitChapterLayout({ objects: next });
  };

  const addObjectFromIllustration = (ill: { id: string; url: string; caption: string }) => {
    const newObj: PdfFrameObject = {
      id: `pdf-obj-${Date.now()}`,
      chapterId: selectedChapterId,
      sourceIllustrationId: ill.id,
      imageUrl: ill.url,
      caption: ill.caption,
      xMm: Math.max(0, pageWidthMm / 2 - 25),
      yMm: Math.max(0, pageHeightMm / 2 - 25),
      widthMm: 50,
      heightMm: 50,
      wrapMode: 'none',
      wrapMarginMm: 4,
      zIndex: objects.length,
    };
    commitChapterLayout({ objects: [...objects, newObj] });
    setSelectedObjectId(newObj.id);
  };

  // ---- Drag / resize (frame edges + free objects) ----
  const beginFrameEdgeDrag = (e: React.PointerEvent, edge: 'top' | 'bottom' | 'inside' | 'outside') => {
    e.stopPropagation();
    e.preventDefault();
    const startMm = edge === 'top' ? margins.topMm : edge === 'bottom' ? margins.bottomMm : edge === 'inside' ? margins.insideMm : margins.outsideMm;
    setDragState({ type: 'frame-edge', edge, startClientX: e.clientX, startClientY: e.clientY, startMm });
  };

  const beginObjectMove = (e: React.PointerEvent, obj: PdfFrameObject) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedObjectId(obj.id);
    setDragState({ type: 'object-move', objectId: obj.id, startClientX: e.clientX, startClientY: e.clientY, startXMm: obj.xMm, startYMm: obj.yMm });
  };

  const beginObjectResize = (e: React.PointerEvent, obj: PdfFrameObject) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedObjectId(obj.id);
    setDragState({ type: 'object-resize', objectId: obj.id, startClientX: e.clientX, startClientY: e.clientY, startWidthMm: obj.widthMm, startHeightMm: obj.heightMm });
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (e: PointerEvent) => {
      if (dragState.type === 'frame-edge') {
        const deltaMm = pxToMm(dragState.edge === 'top' || dragState.edge === 'bottom' ? e.clientY - dragState.startClientY : e.clientX - dragState.startClientX);
        if (dragState.edge === 'top') updateMargins({ topMm: Math.max(MIN_MARGIN_MM, dragState.startMm + deltaMm) });
        else if (dragState.edge === 'bottom') updateMargins({ bottomMm: Math.max(MIN_MARGIN_MM, dragState.startMm - deltaMm) });
        else if (dragState.edge === 'inside') updateMargins({ insideMm: Math.max(MIN_MARGIN_MM, dragState.startMm + deltaMm) });
        else if (dragState.edge === 'outside') updateMargins({ outsideMm: Math.max(MIN_MARGIN_MM, dragState.startMm - deltaMm) });
      } else if (dragState.type === 'object-move') {
        const obj = objects.find((o) => o.id === dragState.objectId);
        if (!obj) return;
        const dxMm = pxToMm(e.clientX - dragState.startClientX);
        const dyMm = pxToMm(e.clientY - dragState.startClientY);
        const nextX = Math.min(Math.max(0, dragState.startXMm + dxMm), pageWidthMm - obj.widthMm);
        const nextY = Math.min(Math.max(0, dragState.startYMm + dyMm), pageHeightMm - obj.heightMm);
        updateObject(dragState.objectId, { xMm: nextX, yMm: nextY });
      } else if (dragState.type === 'object-resize') {
        const dxMm = pxToMm(e.clientX - dragState.startClientX);
        const dyMm = pxToMm(e.clientY - dragState.startClientY);
        updateObject(dragState.objectId, {
          widthMm: Math.max(MIN_OBJECT_MM, dragState.startWidthMm + dxMm),
          heightMm: Math.max(MIN_OBJECT_MM, dragState.startHeightMm + dyMm),
        });
      }
    };
    const handleUp = () => setDragState(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState, objects, margins]);

  const chapterIllustrations = (book.illustrations || []).filter((ill) => ill.chapterId === selectedChapterId);

  const paragraphs = chapter
    ? chapter.sections.flatMap((s) => (s.content || '').split(/\n\s*\n/)).map((p) => p.trim()).filter(Boolean)
    : [];

  const freeObjects = objects.filter((o) => o.wrapMode === 'none');
  const flowObjects = objects.filter((o) => o.wrapMode !== 'none');

  const pageWidthPx = mmToPx(pageWidthMm);
  const pageHeightPx = mmToPx(pageHeightMm);
  const frameLeftPx = mmToPx(margins.insideMm);
  const frameTopPx = mmToPx(margins.topMm);
  const frameWidthPx = Math.max(10, mmToPx(pageWidthMm - margins.insideMm - margins.outsideMm));
  const frameHeightPx = Math.max(10, mmToPx(pageHeightMm - margins.topMm - margins.bottomMm));

  const wrapModeOptions: { id: PdfWrapMode; label: string }[] = [
    { id: 'none', label: t('pdfEditorView.wrapNone') },
    { id: 'left', label: t('pdfEditorView.wrapLeft') },
    { id: 'right', label: t('pdfEditorView.wrapRight') },
    { id: 'top-bottom', label: t('pdfEditorView.wrapTopBottom') },
  ];

  const selectedObject = selectedObjectId ? objects.find((o) => o.id === selectedObjectId) || null : null;

  if (!chapter) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center text-slate-500 text-xs bg-slate-900">
        {t('pdfEditorView.noChaptersYet')}
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">

      {/* Top Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {t('pdfEditorView.headerBadge')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">{t('pdfEditorView.pageTitle')}</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedChapterId}
            onChange={(e) => { setSelectedChapterId(e.target.value); setSelectedObjectId(null); }}
            data-tour="pdf-editor__1"
            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 font-bold"
          >
            {book.chapters.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>

          {onSaveBook && (
            <button
              onClick={onSaveBook}
              data-tour="pdf-editor__5"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('pdfEditorView.saveBtn')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Info note about wrap-mode technical scope */}
      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-2 text-[11px] text-slate-400">
        <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <span>{t('pdfEditorView.scopeNote')}</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* Left: Canvas */}
        <div className="xl:col-span-8 space-y-4">
          <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 overflow-auto">
            <div
              ref={canvasRef}
              className="relative bg-[#fffefc] mx-auto shadow-2xl select-none"
              style={{ width: pageWidthPx, height: pageHeightPx }}
              onPointerDown={() => setSelectedObjectId(null)}
              data-tour="pdf-editor__2"
            >
              {/* Text frame boundary */}
              <div
                className="absolute border-2 border-dashed border-cyan-400/60"
                style={{ left: frameLeftPx, top: frameTopPx, width: frameWidthPx, height: frameHeightPx }}
              >
                {/* Text flow: float/block objects first, then paragraphs */}
                <div className="w-full h-full overflow-hidden p-1 text-[9px] leading-relaxed text-slate-700 text-justify font-serif-book">
                  {flowObjects.map((obj) => (
                    <div
                      key={obj.id}
                      onPointerDown={(e) => { e.stopPropagation(); setSelectedObjectId(obj.id); }}
                      className={`relative border-2 ${selectedObjectId === obj.id ? 'border-amber-400' : 'border-transparent'} ${
                        obj.wrapMode === 'left' ? 'float-left mr-2 mb-1' : obj.wrapMode === 'right' ? 'float-right ml-2 mb-1' : 'block clear-both mx-auto mb-2'
                      }`}
                      style={{
                        width: mmToPx(obj.widthMm),
                        height: mmToPx(obj.heightMm),
                        margin: obj.wrapMode !== 'top-bottom' ? `0 ${mmToPx(obj.wrapMarginMm)}px ${mmToPx(obj.wrapMarginMm)}px ${mmToPx(obj.wrapMarginMm)}px` : `${mmToPx(obj.wrapMarginMm)}px auto`,
                      }}
                    >
                      <img src={obj.imageUrl} alt={obj.caption || ''} className="w-full h-full object-cover" draggable={false} />
                      <div
                        onPointerDown={(e) => beginObjectResize(e, obj)}
                        className="absolute bottom-0 right-0 w-3 h-3 bg-amber-400 cursor-nwse-resize"
                      />
                    </div>
                  ))}
                  {paragraphs.map((p, i) => (
                    <p key={i} className="mb-1.5">{p}</p>
                  ))}
                </div>
              </div>

              {/* Free (wrapMode='none') objects — real absolute drag */}
              {freeObjects.map((obj) => (
                <div
                  key={obj.id}
                  onPointerDown={(e) => beginObjectMove(e, obj)}
                  className={`absolute cursor-move border-2 ${selectedObjectId === obj.id ? 'border-amber-400' : 'border-slate-400/50'} bg-black/5`}
                  style={{ left: mmToPx(obj.xMm), top: mmToPx(obj.yMm), width: mmToPx(obj.widthMm), height: mmToPx(obj.heightMm), zIndex: 10 + obj.zIndex }}
                >
                  <img src={obj.imageUrl} alt={obj.caption || ''} className="w-full h-full object-cover pointer-events-none" draggable={false} />
                  <div className="absolute top-0 left-0 p-0.5 bg-slate-900/70 text-amber-300"><Move className="w-2.5 h-2.5" /></div>
                  <div
                    onPointerDown={(e) => beginObjectResize(e, obj)}
                    className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-amber-400 cursor-nwse-resize flex items-center justify-center"
                  >
                    <Maximize2 className="w-2 h-2 text-slate-950" />
                  </div>
                </div>
              ))}

              {/* Frame edge drag handles */}
              <div onPointerDown={(e) => beginFrameEdgeDrag(e, 'top')} className="absolute left-1/2 -translate-x-1/2 w-8 h-2 bg-cyan-400 rounded-full cursor-ns-resize" style={{ top: frameTopPx - 4 }} />
              <div onPointerDown={(e) => beginFrameEdgeDrag(e, 'bottom')} className="absolute left-1/2 -translate-x-1/2 w-8 h-2 bg-cyan-400 rounded-full cursor-ns-resize" style={{ top: frameTopPx + frameHeightPx - 4 }} />
              <div onPointerDown={(e) => beginFrameEdgeDrag(e, 'inside')} className="absolute top-1/2 -translate-y-1/2 h-8 w-2 bg-cyan-400 rounded-full cursor-ew-resize" style={{ left: frameLeftPx - 4 }} />
              <div onPointerDown={(e) => beginFrameEdgeDrag(e, 'outside')} className="absolute top-1/2 -translate-y-1/2 h-8 w-2 bg-cyan-400 rounded-full cursor-ew-resize" style={{ left: frameLeftPx + frameWidthPx - 4 }} />

              {/* Номер сторінки (прев'ю) — у полях, поза текстовою рамкою */}
              {showPageNumbers && (
                <div
                  className="absolute font-mono text-slate-500 select-none pointer-events-none"
                  style={{
                    fontSize: '9px',
                    ...(pageNumPosition === 'bottom-center'
                      ? { bottom: mmToPx(4), left: '50%', transform: 'translateX(-50%)' }
                      : pageNumPosition === 'bottom-left'
                      ? { bottom: mmToPx(4), left: mmToPx(8) }
                      : pageNumPosition === 'bottom-right'
                      ? { bottom: mmToPx(4), right: mmToPx(8) }
                      : pageNumPosition === 'top-left'
                      ? { top: mmToPx(4), left: mmToPx(8) }
                      : pageNumPosition === 'top-right'
                      ? { top: mmToPx(4), right: mmToPx(8) }
                      : { top: mmToPx(4), left: '50%', transform: 'translateX(-50%)' }),
                  }}
                >
                  — {chapterPageNumber} —
                </div>
              )}
            </div>
          </div>

          {/* Margins numeric readout */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {(['topMm', 'bottomMm', 'insideMm', 'outsideMm'] as const).map((key) => (
              <div key={key}>
                <label className="text-[10px] text-slate-500 block mb-1">{t(`pdfEditorView.margin_${key}`)}</label>
                <input
                  type="number"
                  min={MIN_MARGIN_MM}
                  value={Math.round(margins[key])}
                  onChange={(e) => updateMargins({ [key]: Math.max(MIN_MARGIN_MM, Number(e.target.value) || MIN_MARGIN_MM) } as any)}
                  className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Object inspector + add-from-illustrations */}
        <div className="xl:col-span-4 space-y-4">

          {/* Add images from this chapter */}
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3" data-tour="pdf-editor__3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4" />
              {t('pdfEditorView.chapterIllustrationsHeading')}
            </h3>
            {chapterIllustrations.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">{t('pdfEditorView.noIllustrationsInChapter')}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {chapterIllustrations.map((ill) => (
                  <button
                    key={ill.id}
                    onClick={() => addObjectFromIllustration(ill)}
                    className="aspect-square rounded-lg overflow-hidden border border-slate-800 hover:border-amber-400 transition-all"
                    title={t('pdfEditorView.addToPageBtn')}
                  >
                    <img src={ill.url} alt={ill.caption} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Page numbering (глобальний параметр книги) */}
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3" data-tour="pdf-editor__page-num">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Hash className="w-4 h-4" />
              {t('pdfEditorView.pageNumberingHeading')}
            </h3>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-[11px] text-slate-300">{t('pdfEditorView.showPageNumbersLabel')}</span>
              <input
                type="checkbox"
                checked={showPageNumbers}
                onChange={(e) => updatePageNumbering({ showPageNumbers: e.target.checked })}
                className="accent-amber-400 w-4 h-4"
              />
            </label>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1.5">{t('pdfEditorView.pageNumberPositionLabel')}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { id: 'bottom-left', label: t('pdfEditorView.positionBottomLeft') },
                  { id: 'bottom-center', label: t('pdfEditorView.positionBottomCenter') },
                  { id: 'bottom-right', label: t('pdfEditorView.positionBottomRight') },
                  { id: 'top-left', label: t('pdfEditorView.positionTopLeft') },
                  { id: 'top-center', label: t('pdfEditorView.positionTopCenter') },
                  { id: 'top-right', label: t('pdfEditorView.positionTopRight') },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => updatePageNumbering({ pageNumberPosition: opt.id })}
                    disabled={!showPageNumbers}
                    title={opt.id}
                    className={`px-1.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                      pageNumPosition === opt.id
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Початок нумерації сторінок */}
            <div className="pt-2 border-t border-slate-800">
              <label className="text-[10px] text-slate-500 block mb-1.5">{t('pdfEditorView.pageNumberStartHeading')}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { id: 'title', label: t('pdfEditorView.startModeTitle'), desc: t('pdfEditorView.startModeTitleDesc') },
                  { id: 'after-toc', label: t('pdfEditorView.startModeAfterToc'), desc: t('pdfEditorView.startModeAfterTocDesc') },
                  { id: 'custom', label: t('pdfEditorView.startModeCustom'), desc: t('pdfEditorView.startModeCustomDesc') },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => updatePageNumbering({ pageNumberStart: { mode: opt.id, startNumber: pageNumStartNumber } })}
                    disabled={!showPageNumbers}
                    title={opt.id}
                    className={`px-1.5 py-1.5 rounded-lg text-left border transition-all ${
                      pageNumStartMode === opt.id
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <div className="text-[10px] font-bold">{opt.label}</div>
                    <div className="text-[8px] text-slate-500 leading-tight">{opt.desc}</div>
                  </button>
                ))}
              </div>

              {pageNumStartMode === 'custom' && (
                <div className="mt-2">
                  <label className="text-[10px] text-slate-500 block mb-1">{t('pdfEditorView.startNumberLabel')}</label>
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={pageNumStartNumber}
                    disabled={!showPageNumbers}
                    onChange={(e) =>
                      updatePageNumbering({
                        pageNumberStart: { mode: 'custom', startNumber: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                    className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono text-xs disabled:opacity-40"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Object inspector */}
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3" data-tour="pdf-editor__4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <LayoutPanelTop className="w-4 h-4" />
              {t('pdfEditorView.objectInspectorHeading')}
            </h3>

            {!selectedObject ? (
              <p className="text-[11px] text-slate-500 italic">{t('pdfEditorView.selectObjectHint')}</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <img src={selectedObject.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-800" />
                  <span className="text-xs text-slate-300 truncate flex-1">{selectedObject.caption || t('pdfEditorView.untitledObject')}</span>
                  <button onClick={() => deleteObject(selectedObject.id)} className="text-slate-500 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">{t('pdfEditorView.wrapModeLabel')}</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {wrapModeOptions.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => updateObject(selectedObject.id, { wrapMode: opt.id })}
                        className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                          selectedObject.wrapMode === opt.id ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">{t('pdfEditorView.wrapMarginLabel')}: {selectedObject.wrapMarginMm}mm</label>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={selectedObject.wrapMarginMm}
                    onChange={(e) => updateObject(selectedObject.id, { wrapMarginMm: Number(e.target.value) })}
                    className="w-full accent-amber-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">{t('pdfEditorView.widthLabel')}</label>
                    <input
                      type="number"
                      min={MIN_OBJECT_MM}
                      value={Math.round(selectedObject.widthMm)}
                      onChange={(e) => updateObject(selectedObject.id, { widthMm: Math.max(MIN_OBJECT_MM, Number(e.target.value) || MIN_OBJECT_MM) })}
                      className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">{t('pdfEditorView.heightLabel')}</label>
                    <input
                      type="number"
                      min={MIN_OBJECT_MM}
                      value={Math.round(selectedObject.heightMm)}
                      onChange={(e) => updateObject(selectedObject.id, { heightMm: Math.max(MIN_OBJECT_MM, Number(e.target.value) || MIN_OBJECT_MM) })}
                      className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-mono text-xs"
                    />
                  </div>
                </div>

                {selectedObject.wrapMode !== 'none' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">{t('pdfEditorView.orderLabel')}</span>
                    <button onClick={() => reorderObject(selectedObject.id, 'up')} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-300">
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => reorderObject(selectedObject.id, 'down')} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-300">
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* All objects on this page */}
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              {t('pdfEditorView.objectsListHeading', { n: String(objects.length) })}
            </h3>
            {objects.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">{t('pdfEditorView.noObjectsYet')}</p>
            ) : (
              objects.map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => setSelectedObjectId(obj.id)}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-all ${
                    selectedObjectId === obj.id ? 'bg-amber-500/20' : 'hover:bg-slate-900'
                  }`}
                >
                  <img src={obj.imageUrl} alt="" className="w-7 h-7 rounded object-cover border border-slate-800" />
                  <span className="text-[11px] text-slate-300 truncate flex-1">{obj.caption || t('pdfEditorView.untitledObject')}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{obj.wrapMode}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
