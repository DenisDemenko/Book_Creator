import React, { useEffect, useRef, useState } from 'react';
import { usePageScale } from './usePageScale';
import { PX_PER_MM, buildRulerMarks } from '../../utils/mmUnits';

interface PageColumnProps {
  children: React.ReactNode;
  widthMm: number;
  className?: string;
  /** Стеля масштабу понад фізичний розмір сторінки — див. usePageScale.ts. За замовчуванням 1 (поведінка не змінюється). */
  zoomFactor?: number;
  /** Показати вертикальну лінійку (мм) зліва від тексту — керується тим самим перемикачем «показати лінійку», що й горизонтальна PageRuler.tsx. За замовчуванням false (поведінка не змінюється). */
  showVerticalRuler?: boolean;
}

/** Ширина смуги вертикальної лінійки, px — та сама висота (24px = h-6), що й у горизонтальної PageRuler.tsx, для візуальної симетрії. */
const VERTICAL_RULER_WIDTH_PX = 24;

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
export const PageColumn: React.FC<PageColumnProps> = ({ children, widthMm, className, zoomFactor = 1, showVerticalRuler = false }) => {
  const { outerRef, scale, widthPx } = usePageScale(widthMm, zoomFactor, showVerticalRuler ? VERTICAL_RULER_WIDTH_PX : 0);
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

  // Вертикальна лінійка (мм) — та сама логіка позначок (buildRulerMarks),
  // що й у горизонтальної PageRuler.tsx, лише вздовж висоти. `naturalHeightPx`
  // — це РЕАЛЬНА (немасштабована) висота вмісту в px (той самий scrollHeight,
  // яким вимірює пагінація) — переведена в мм тим самим PX_PER_MM, яким уже
  // рахує ширину лінійка зверху, тож обидві лінійки лишаються в одних
  // одиницях. Рендериться СЕРЕДИНИ того самого прокручуваного контейнера
  // (outerRef), не окремим елементом — тому прокручується разом із текстом
  // без додаткової синхронізації скролу.
  const verticalMarks = showVerticalRuler ? buildRulerMarks(naturalHeightPx / PX_PER_MM) : [];

  return (
    // Раніше тут був суцільний непрозорий `background: '#0f172a'` — саме те
    // «темно-синє поле» за межами аркуша, на яке скаржився власник. Тепер
    // прозоро: крізь цей контейнер видно фон застосунку (`.app-shell-root`
    // — спокійний голубий градієнт у світлій темі). Водяний canvas, що
    // лежав під ним раніше, прибрано цілком (запис #142). Сама сторінка
    // (`#fffefc` нижче) лишається непрозорою — прозорий лише простір
    // навколо неї.
    <div ref={outerRef} className={`overflow-y-auto flex ${className || ''}`}>
      {showVerticalRuler && (
        <div
          className="shrink-0 relative select-none"
          style={{ width: VERTICAL_RULER_WIDTH_PX, height: naturalHeightPx * scale, background: 'rgba(30, 41, 59, 0.55)' }}
        >
          {verticalMarks.map((m) => (
            <div key={m.mm} className="absolute left-0 right-0" style={{ top: m.mm * PX_PER_MM * scale }}>
              <div style={{ height: 1, width: m.major ? '100%' : '50%', background: '#94a3b8' }} />
              {m.major && (
                <span
                  className="text-[8px] text-slate-500 absolute left-0.5 top-0.5 font-mono"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {m.mm}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ height: naturalHeightPx * scale, position: 'relative', flex: 1, minWidth: 0 }}>
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
