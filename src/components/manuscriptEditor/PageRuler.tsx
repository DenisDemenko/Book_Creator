import React, { useRef } from 'react';
import { usePageScale } from './usePageScale';
import { PX_PER_MM } from '../../utils/mmUnits';

interface PageRulerProps {
  /** Ширина текстового блоку сторінки (мм) — та сама, що й у PageColumn під лінійкою, щоб обидва лишались вирівняними. */
  widthMm: number;
  insideMm: number;
  outsideMm: number;
  onChangeMargins: (patch: { insideMm?: number; outsideMm?: number }) => void;
  /** Той самий zoomFactor, що передається сусідньому PageColumn — інакше лінійка розійдеться з колонкою тексту під нею. */
  zoomFactor?: number;
}

const MIN_MARGIN_MM = 5;

/**
 * Лінійка над текстовою колонкою редактора — сантиметрові позначки та два
 * жовтих маркери-ручки з боків, за які можна тягнути мишкою, щоб міняти
 * поля книги. Пише напряму в `book.layoutConfig.margins` (EditorView.tsx) —
 * те саме поле, що вже редагує «Верстка & Поля», тож обидва місця
 * лишаються синхронізованими без додаткового стану.
 *
 * Той самий usePageScale, що й PageColumn.tsx, — лінійка завжди має
 * однакову ширину/масштаб із колонкою тексту під нею.
 */
export const PageRuler: React.FC<PageRulerProps> = ({ widthMm, insideMm, outsideMm, onChangeMargins, zoomFactor = 1 }) => {
  const { outerRef, scale, widthPx } = usePageScale(widthMm, zoomFactor);
  const dragRef = useRef<{ side: 'inside' | 'outside'; startClientX: number; startMm: number } | null>(null);

  const beginDrag = (side: 'inside' | 'outside') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { side, startClientX: e.clientX, startMm: side === 'inside' ? insideMm : outsideMm };

    const handleMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxPx = ev.clientX - d.startClientX;
      const dxMm = dxPx / (PX_PER_MM * (scale || 1));
      // Лівий маркер (inside) тягнуть вправо, щоб ЗБІЛЬШИТИ поле (звузити колонку);
      // правий (outside) тягнуть вліво з тим самим ефектом — тому знак протилежний.
      const deltaMm = d.side === 'inside' ? dxMm : -dxMm;
      const nextMm = Math.max(MIN_MARGIN_MM, d.startMm + deltaMm);
      onChangeMargins(d.side === 'inside' ? { insideMm: nextMm } : { outsideMm: nextMm });
    };
    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const totalCm = Math.floor(widthMm / 10);
  const marks = Array.from({ length: totalCm + 1 }, (_, cm) => cm);

  return (
    <div ref={outerRef} className="w-full h-6 relative select-none shrink-0" style={{ background: '#1e293b' }}>
      <div
        style={{
          width: widthPx,
          height: '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          position: 'absolute',
          left: '50%',
          marginLeft: -widthPx / 2,
          background: '#fffefc',
        }}
      >
        {marks.map((cm) => (
          <div key={cm} className="absolute top-0 bottom-0" style={{ left: cm * 10 * PX_PER_MM }}>
            <div style={{ width: 1, height: cm % 5 === 0 ? '100%' : '50%', background: '#94a3b8' }} />
            {cm % 5 === 0 && (
              <span className="text-[8px] text-slate-500 absolute top-0.5 left-0.5 font-mono">{cm / 10}</span>
            )}
          </div>
        ))}
        <div
          onPointerDown={beginDrag('inside')}
          className="absolute top-0 bottom-0 w-2.5 -ml-1.5 cursor-ew-resize bg-amber-500/70 hover:bg-amber-400"
          style={{ left: 0 }}
          title="Внутрішнє поле — тягніть, щоб змінити"
        />
        <div
          onPointerDown={beginDrag('outside')}
          className="absolute top-0 bottom-0 w-2.5 -mr-1.5 cursor-ew-resize bg-amber-500/70 hover:bg-amber-400"
          style={{ right: 0 }}
          title="Зовнішнє поле — тягніть, щоб змінити"
        />
      </div>
    </div>
  );
};
