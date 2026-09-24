import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GripVertical,
  Magnet,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Move,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import {
  DEFAULT_TOOL_DOCK,
  TOOL_DOCK_MIN_WIDTH,
  dockWidth,
  normalizeToolDockState,
  reserveFor,
  snapTarget,
  type DockEdge,
  type Rect,
  type ToolDockState,
} from '../utils/toolDockLayout';

/**
 * Плаваючий блок інструментів редактора «Книга та текст».
 *
 * Власник попросив: УСІ кнопки й повідомлення, що стояли смугами над полем
 * тексту, зібрати в ОДИН блок, який можна перетягнути будь-куди поверх
 * студії, змінити йому розмір і «примагнітити» до верху, низу, правої
 * панелі або лівого меню — а над текстом не лишити нічого.
 *
 * ЯК УЛАШТОВАНО.
 *  • Портал у `document.body`. У світлій темі `.editor-shell-glass` має
 *    `backdrop-filter`, а він робить предка «контейнером» для
 *    `position: fixed` — блок усередині редактора зʼїжджав би разом із ним і
 *    обрізався `overflow: hidden`.
 *  • Прилипання — до країв ПОЛЯ ТЕКСТУ (`anchorRef`): верх/низ, ліворуч
 *    (межа з лівим меню студії або змістом книги) і праворуч (межа з правою
 *    панеллю). Прилиплий блок не накриває текст: поле тексту звільняє під
 *    нього місце (`onReserveChange`). Вільний — плаває поверх усього.
 *  • Висота завжди за вмістом, змінюється ширина: широкий блок — рядок
 *    (горизонтально), вузький — колонка (вертикально). Так випадні
 *    палітри кольорів/посилань усередині ніколи не обрізаються скролом.
 *  • Стан (край, позиція, ширини, згорнутість) — у localStorage.
 */

export interface ToolDockLabels {
  title: string;
  dragHint: string;
  magnet: string;
  dockTop: string;
  dockBottom: string;
  dockLeft: string;
  dockRight: string;
  undock: string;
  minimize: string;
  expand: string;
  resize: string;
}

interface FloatingToolDockProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  storageKey: string;
  zIndex: number;
  labels: ToolDockLabels;
  style?: React.CSSProperties;
  /** Сховати на час набору (режим фокусу) — місце під блоком лишається. */
  hidden?: boolean;
  onReserveChange?: (reserve: { top: number; bottom: number; left: number; right: number }) => void;
  children: (layout: { orientation: 'horizontal' | 'vertical'; width: number }) => React.ReactNode;
}

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

function readState(key: string): ToolDockState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return normalizeToolDockState(JSON.parse(raw), { width: window.innerWidth, height: window.innerHeight });
  } catch {
    /* сховище недоступне або запис зіпсований — типове розташування */
  }
  return { ...DEFAULT_TOOL_DOCK };
}

type DragMode = null | 'move' | 'resize-left' | 'resize-right';

export const FloatingToolDock: React.FC<FloatingToolDockProps> = ({
  anchorRef,
  storageKey,
  zIndex,
  labels,
  style,
  hidden,
  onReserveChange,
  children,
}) => {
  const [state, setState] = useState<ToolDockState>(() => readState(storageKey));
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drag, setDrag] = useState<DragMode>(null);
  const [preview, setPreview] = useState<DockEdge | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const startRef = useRef({ px: 0, py: 0, x: 0, y: 0, w: 0, undocked: false });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* не критично */
    }
  }, [storageKey, state]);

  // Межі поля тексту: змінюються з розміром вікна, відкриттям змісту чи правої панелі.
  const measureAnchor = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const next = toRect(el.getBoundingClientRect());
    setAnchor((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom ? prev : next
    );
  }, [anchorRef]);

  useLayoutEffect(() => {
    measureAnchor();
    const el = anchorRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(measureAnchor) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', measureAnchor);
    window.addEventListener('scroll', measureAnchor, true);
    // Позиція поля може змінитись без зміни його розміру (зсув сусідів) —
    // рідкісна перевірка дешевша за пропущений зсув.
    const timer = window.setInterval(measureAnchor, 1000);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measureAnchor);
      window.removeEventListener('scroll', measureAnchor, true);
      window.clearInterval(timer);
    };
  }, [anchorRef, measureAnchor]);

  // Власний розмір — для резерву місця в полі тексту.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBoxSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor !== null]);

  // Поле тексту буває вищим за вікно (сторінка студії трохи прокручується):
  // прилиплий донизу блок тоді стоїть біля низу ВІКНА, і поле має звільнити
  // ще й ту частину, що сховалась за краєм.
  const bottomOverflow = anchor ? Math.max(0, Math.round(anchor.bottom - window.innerHeight)) : 0;
  const reserve = reserveFor(state.dock, boxSize);
  if (state.dock === 'bottom') reserve.bottom += bottomOverflow;
  const reserveKey = JSON.stringify(reserve);
  useEffect(() => {
    onReserveChange?.(JSON.parse(reserveKey));
  }, [reserveKey, onReserveChange]);

  const setDock = (dock: DockEdge | null) => {
    setMenuOpen(false);
    setState((s) => {
      if (dock || !anchor) return { ...s, dock };
      // «Відліпити»: блок лишається там, де був, але вже вільний.
      const r = boxRef.current?.getBoundingClientRect();
      return { ...s, dock: null, x: r ? r.left : s.x, y: r ? r.top : s.y, w: r ? Math.min(r.width, 760) : s.w };
    });
  };

  const beginMove = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    e.preventDefault();
    startRef.current = { px: e.clientX, py: e.clientY, x: r.left, y: r.top, w: r.width, undocked: state.dock === null };
    setDrag('move');
  };

  const beginResize = (side: 'resize-left' | 'resize-right') => (e: React.PointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { px: e.clientX, py: e.clientY, x: r.left, y: r.top, w: r.width, undocked: true };
    setDrag(side);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const s0 = startRef.current;
      const dx = e.clientX - s0.px;
      const dy = e.clientY - s0.py;
      const maxW = Math.max(TOOL_DOCK_MIN_WIDTH, window.innerWidth - 16);
      if (drag === 'move') {
        // Прилиплий блок відліплюється лише після помітного руху — інакше
        // випадковий клік по шапці скидав би прилипання.
        if (!s0.undocked) {
          if (Math.hypot(dx, dy) < 6) return;
          // Смуга на всю ширину поля, відліплена, стає компактним вікном.
          if (state.dock === 'top' || state.dock === 'bottom') {
            s0.w = Math.min(s0.w, 760);
            // Курсор лишається на шапці, навіть якщо хапали за далекий край смуги.
            s0.x = s0.px - Math.min(s0.px - s0.x, s0.w - 40);
          }
          s0.undocked = true;
        }
        const w = s0.w;
        const x = Math.min(Math.max(0, s0.x + dx), window.innerWidth - 80);
        const y = Math.min(Math.max(0, s0.y + dy), window.innerHeight - 40);
        setState((s) => ({ ...s, dock: null, x, y, w: Math.min(Math.max(w, TOOL_DOCK_MIN_WIDTH), maxW) }));
        if (anchor) {
          const h = boxRef.current?.getBoundingClientRect().height || 40;
          setPreview(snapTarget({ left: x, top: y, right: x + w, bottom: y + h }, anchor));
        }
        return;
      }
      setState((s) => {
        if (s.dock === 'left' || s.dock === 'right') {
          const grow = (s.dock === 'left' ? dx : -dx);
          return { ...s, vw: Math.min(Math.max(s0.w + grow, TOOL_DOCK_MIN_WIDTH), maxW) };
        }
        if (drag === 'resize-right') return { ...s, w: Math.min(Math.max(s0.w + dx, TOOL_DOCK_MIN_WIDTH), maxW) };
        const w = Math.min(Math.max(s0.w - dx, TOOL_DOCK_MIN_WIDTH), maxW);
        return { ...s, w, x: Math.max(0, s0.x + (s0.w - w)) };
      });
    };
    const onUp = () => {
      if (drag === 'move' && preview) {
        const edge = preview;
        setState((s) => ({ ...s, dock: edge, vw: edge === 'left' || edge === 'right' ? Math.min(s.w, Math.max(s.vw, TOOL_DOCK_MIN_WIDTH)) : s.vw }));
      }
      setPreview(null);
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, anchor, preview, state.dock]);

  if (!anchor || typeof document === 'undefined') return null;

  const width = dockWidth(state, anchor);
  const orientation: 'horizontal' | 'vertical' = state.dock === 'left' || state.dock === 'right' || width < 420 ? 'vertical' : 'horizontal';
  // Горизонтальний блок тримає «ручку» (перетягування, магніт, згортання)
  // вузькою колонкою ЗЛІВА, а не окремим рядком згори: мінус цілий рядок
  // висоти, тобто мінус рядок, який забирав би в тексту прилиплий згори блок.
  const sideHandle = orientation === 'horizontal' && !state.minimized;
  const pos: React.CSSProperties =
    state.dock === 'top'
      ? { left: anchor.left, top: anchor.top }
      : state.dock === 'bottom'
      ? { left: anchor.left, bottom: Math.max(0, window.innerHeight - anchor.bottom) }
      : state.dock === 'left'
      ? { left: anchor.left, top: anchor.top }
      : state.dock === 'right'
      ? { left: anchor.right - width, top: anchor.top }
      : { left: state.x, top: state.y };
  const canResizeLeft = state.dock === null || state.dock === 'right';
  const canResizeRight = state.dock === null || state.dock === 'left';

  const dockButtons: Array<[DockEdge | null, React.ReactNode, string]> = [
    ['top', <ArrowUpToLine key="t" className="w-3.5 h-3.5" />, labels.dockTop],
    ['bottom', <ArrowDownToLine key="b" className="w-3.5 h-3.5" />, labels.dockBottom],
    ['left', <ArrowLeftToLine key="l" className="w-3.5 h-3.5" />, labels.dockLeft],
    ['right', <ArrowRightToLine key="r" className="w-3.5 h-3.5" />, labels.dockRight],
    [null, <Move key="f" className="w-3.5 h-3.5" />, labels.undock],
  ];

  const previewStyle: React.CSSProperties | null = preview
    ? preview === 'top'
      ? { left: anchor.left, top: anchor.top, width: anchor.right - anchor.left, height: 6 }
      : preview === 'bottom'
      ? { left: anchor.left, top: anchor.bottom - 6, width: anchor.right - anchor.left, height: 6 }
      : preview === 'left'
      ? { left: anchor.left, top: anchor.top, width: 6, height: anchor.bottom - anchor.top }
      : { left: anchor.right - 6, top: anchor.top, width: 6, height: anchor.bottom - anchor.top }
    : null;

  return createPortal(
    <>
      {previewStyle && (
        <div
          aria-hidden="true"
          className="fixed rounded-full pointer-events-none [background-color:var(--sun-acc)] opacity-70 shadow-[0_0_18px_var(--sun-acc)]"
          style={{ ...style, ...previewStyle, zIndex: zIndex + 1 }}
        />
      )}
      <div
        ref={boxRef}
        data-editor-tool-dock
        data-dock={state.dock || 'float'}
        data-orientation={orientation}
        style={{ ...style, ...pos, width, zIndex }}
        className={`fixed flex ${sideHandle ? 'flex-row' : 'flex-col'} rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-md shadow-2xl shadow-black/50 transition-opacity duration-300 ${
          hidden ? 'opacity-0 pointer-events-none' : 'opacity-100'
        } ${drag ? 'select-none' : ''}`}
      >
        <div
          onPointerDown={beginMove}
          className={`flex ${
            sideHandle ? 'flex-col justify-center gap-1 px-1 py-1.5 border-r' : 'items-center gap-1.5 px-2 py-1 border-b'
          } border-slate-800 cursor-move select-none shrink-0 touch-none`}
          title={labels.dragHint}
        >
          <GripVertical className="w-3.5 h-3.5 [color:var(--sun-acc)] shrink-0 self-center" />
          <span className={sideHandle ? 'sr-only' : 'flex-1 min-w-0 text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate'}>{labels.title}</span>
          <div className={`relative flex ${sideHandle ? 'flex-col' : ''} items-center gap-0.5 shrink-0`} onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className={`p-1 rounded-md transition-colors ${menuOpen || state.dock ? '[color:var(--sun-acc)]' : 'text-slate-400'} hover:bg-slate-800`}
              title={labels.magnet}
              aria-label={labels.magnet}
              aria-expanded={menuOpen}
              data-tool-dock-menu
            >
              <Magnet className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, minimized: !s.minimized }))}
              className="p-1 rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
              title={state.minimized ? labels.expand : labels.minimize}
              aria-label={state.minimized ? labels.expand : labels.minimize}
            >
              {state.minimized ? <ChevronsUpDown className="w-3.5 h-3.5" /> : <ChevronsDownUp className="w-3.5 h-3.5" />}
            </button>
            {menuOpen && (
              <div
                className={`absolute z-10 p-1 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl flex gap-0.5 ${
                  sideHandle ? 'left-full top-0 ml-1' : 'top-full right-0 mt-1'
                }`}
              >
                {dockButtons.map(([edge, icon, label]) => (
                  <button
                    key={edge || 'float'}
                    type="button"
                    onClick={() => setDock(edge)}
                    className={`p-1.5 rounded-md transition-colors hover:bg-slate-800 ${
                      state.dock === edge ? '[background-color:var(--sun-acc-20)] [color:var(--sun-soft)]' : 'text-slate-300'
                    }`}
                    title={label}
                    aria-label={label}
                    data-tool-dock-edge={edge || 'float'}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {!state.minimized && (
          <div
            role="toolbar"
            aria-label={labels.title}
            aria-orientation={orientation}
            className="p-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-300"
          >
            {children({ orientation, width })}
          </div>
        )}

        {canResizeLeft && (
          <div onPointerDown={beginResize('resize-left')} title={labels.resize} className="absolute left-0 top-6 bottom-2 w-1.5 cursor-ew-resize touch-none" />
        )}
        {canResizeRight && (
          <div onPointerDown={beginResize('resize-right')} title={labels.resize} className="absolute right-0 top-6 bottom-2 w-1.5 cursor-ew-resize touch-none" />
        )}
      </div>
    </>,
    document.body
  );
};
