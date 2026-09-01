import React, { useEffect, useRef, useState } from 'react';
import { usePageScale } from './usePageScale';

interface PageColumnProps {
  children: React.ReactNode;
  widthMm: number;
  className?: string;
  /** Стеля масштабу понад фізичний розмір сторінки — див. usePageScale.ts. За замовчуванням 1 (поведінка не змінюється). */
  zoomFactor?: number;
}

/**
 * Показує вміст редактора як реальну сторінку книги: внутрішня колонка
 * рендериться на справжню ширину `${widthMm}mm` (той самий трюк з
 * CSS-одиницею mm, що й WrappedImageNode.tsx), а зовнішній контейнер
 * масштабує цю колонку через `transform: scale()`, коли вікно вужче за
 * сторінку (заякорена панель редактора чи вузька колонка в паралельному
 * UA|EN режимі). Трансформація не перераховує розкладку — блоки всередині
 * зберігають свій СПРАВЖНІЙ (фізичний, немасштабований) `offsetHeight`,
 * так само, як зум у Word не змінює реальну верстку тексту. Саме тому
 * PaginationPlugin.ts вимірює висоту через `offsetHeight`, а НЕ через
 * `getBoundingClientRect().height` — останній повертає вже візуально
 * масштабований розмір і призводив до розривів сторінок у неправильних
 * місцях.
 */
export const PageColumn: React.FC<PageColumnProps> = ({ children, widthMm, className, zoomFactor = 1 }) => {
  const { outerRef, scale, widthPx } = usePageScale(widthMm, zoomFactor);
  const innerRef = useRef<HTMLDivElement>(null);
  const [naturalHeightPx, setNaturalHeightPx] = useState(0);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const update = () => setNaturalHeightPx(inner.scrollHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={`overflow-y-auto ${className || ''}`} style={{ background: '#0f172a' }}>
      <div style={{ height: naturalHeightPx * scale, position: 'relative' }}>
        <div
          ref={innerRef}
          style={{
            width: widthPx,
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
            position: 'absolute',
            left: '50%',
            marginLeft: -widthPx / 2,
            background: '#fffefc',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
