import React, { useEffect, useRef, useState } from 'react';
import { Move, X } from 'lucide-react';

/**
 * Універсальна плаваюча панель для редактора:
 *   — перетягується за шапку (на шапці значок «переміщення в 4 боки»);
 *   — змінює розмір перетягуванням за будь-яку прямокутну сторону/кут;
 *   — координати та розмір затискаються в межах вікна браузера.
 */
interface DraggablePanelProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  initialWidth?: number;
  initialHeight?: number;
  /** Початкова позиція (якщо немає збереженої у storageKey). */
  initialX?: number;
  initialY?: number;
  minWidth?: number;
  minHeight?: number;
  zIndex?: number;
  onClose?: () => void;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  /** Додатковий вміст у шапці (напр. перемикач глав) — кліки не запускають перетягування. */
  headerExtra?: React.ReactNode;
  /** Ключ localStorage для збереження позиції/розміру панелі між переходами. */
  storageKey?: string;
}

type DragMode = null | 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const DraggablePanel: React.FC<DraggablePanelProps> = ({
  title,
  children,
  initialWidth = 720,
  initialHeight = 560,
  initialX,
  initialY,
  minWidth = 320,
  minHeight = 240,
  zIndex = 45,
  onClose,
  className = '',
  headerClassName = '',
  bodyClassName = 'overflow-auto',
  headerExtra,
  storageKey,
}) => {
  const [rect, setRect] = useState(() => {
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as { x: number; y: number; w: number; h: number };
          if (
            typeof saved.x === 'number' &&
            typeof saved.y === 'number' &&
            typeof saved.w === 'number' &&
            typeof saved.h === 'number'
          ) {
            // Не даємо збереженій панелі випасти за межі поточного вікна
            const w = Math.min(Math.max(saved.w, minWidth), window.innerWidth - 24);
            const h = Math.min(Math.max(saved.h, minHeight), window.innerHeight - 24);
            const x = Math.max(0, Math.min(saved.x, window.innerWidth - 90));
            const y = Math.max(0, Math.min(saved.y, window.innerHeight - 50));
            return { x, y, w, h };
          }
        }
      } catch {
        /* пошкоджений запис — використовуємо типове розташування */
      }
    }
    const w = Math.min(initialWidth, window.innerWidth - 24);
    const h = Math.min(initialHeight, window.innerHeight - 24);
    const x = initialX !== undefined
      ? Math.max(0, Math.min(initialX, window.innerWidth - 90))
      : Math.max(8, (window.innerWidth - w) / 2);
    const y = initialY !== undefined
      ? Math.max(0, Math.min(initialY, window.innerHeight - 50))
      : Math.max(8, (window.innerHeight - h) / 2);
    return { x, y, w, h };
  });
  const [drag, setDrag] = useState<DragMode>(null);
  const startRef = useRef({ px: 0, py: 0, x: 0, y: 0, w: 0, h: 0 });

  // Автозбереження позиції/розміру (коли задано storageKey).
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(rect));
    } catch {
      /* сховище недоступне — не критично */
    }
  }, [storageKey, rect]);

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    setDrag(mode);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startRef.current.px;
      const dy = e.clientY - startRef.current.py;
      const { x, y, w, h } = startRef.current;
      let nx = x;
      let ny = y;
      let nw = w;
      let nh = h;

      // Напрямок визначаємо явним порівнянням, а НЕ `drag.includes(...)`:
      // рядок 'move' містить літеру 'e', тому `'move'.includes('e')` === true
      // і звичайне перетягування помилково розтягувало панель по ширині.
      const isEast = drag === 'e' || drag === 'ne' || drag === 'se';
      const isSouth = drag === 's' || drag === 'se' || drag === 'sw';
      const isWest = drag === 'w' || drag === 'nw' || drag === 'sw';
      const isNorth = drag === 'n' || drag === 'ne' || drag === 'nw';

      if (drag === 'move') {
        nx = x + dx;
        ny = y + dy;
      }
      if (isEast) nw = Math.max(minWidth, w + dx);
      if (isSouth) nh = Math.max(minHeight, h + dy);
      if (isWest) {
        nw = Math.max(minWidth, w - dx);
        nx = x + (w - nw);
      }
      if (isNorth) {
        nh = Math.max(minHeight, h - dy);
        ny = y + (h - nh);
      }

      // Обмежуємо розмір так, щоб панель не розросталась за межі екрана,
      // і не даємо повністю витягти панель за край.
      const maxW = window.innerWidth - 8;
      const maxH = window.innerHeight - 8;
      nw = Math.min(nw, maxW);
      nh = Math.min(nh, maxH);
      nx = Math.max(0, Math.min(nx, window.innerWidth - 90));
      ny = Math.max(0, Math.min(ny, window.innerHeight - 50));
      setRect({ x: nx, y: ny, w: nw, h: nh });
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, minWidth, minHeight]);

  return (
    <div
      className={`fixed flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/50 ${className}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex }}
    >
      {/* Шапка — ручка перетягування */}
      <div
        onPointerDown={begin('move')}
        className={`flex items-center gap-2 px-3 py-2 border-b border-slate-800 cursor-move select-none shrink-0 ${headerClassName}`}
        title="Перетягнути"
      >
        <Move className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="flex-1 text-xs font-bold text-slate-200 truncate">{title}</span>
        {headerExtra && (
          <div className="shrink-0" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            {headerExtra}
          </div>
        )}
        {onClose && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-md"
            title="Закрити"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Тіло панелі */}
      <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>

      {/* Ручки зміни розміру: 4 сторони */}
      <div onPointerDown={begin('n')} className="absolute top-0 left-8 right-8 h-1.5 cursor-n-resize" />
      <div onPointerDown={begin('s')} className="absolute bottom-0 left-8 right-8 h-1.5 cursor-s-resize" />
      <div onPointerDown={begin('w')} className="absolute left-0 top-8 bottom-8 w-1.5 cursor-w-resize" />
      <div onPointerDown={begin('e')} className="absolute right-0 top-8 bottom-8 w-1.5 cursor-e-resize" />

      {/* Ручки зміни розміру: 4 кути */}
      <div onPointerDown={begin('nw')} className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize" />
      <div onPointerDown={begin('ne')} className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize" />
      <div onPointerDown={begin('sw')} className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize" />
      <div onPointerDown={begin('se')} className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" />
    </div>
  );
};
