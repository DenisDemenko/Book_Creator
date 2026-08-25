import { useEffect, useRef, useState } from 'react';
import { PX_PER_MM } from '../../utils/mmUnits';

/**
 * Спільний розрахунок масштабу "справжня сторінка → вільно розтяжний
 * контейнер" — використовується і PageColumn.tsx (сам текст розділу), і
 * PageRuler.tsx (лінійка над ним), щоб обидва завжди мали ОДНАКОВУ ширину
 * й масштаб (лінійка має лишатися вирівняною з колонкою тексту під нею).
 */
export function usePageScale(widthMm: number) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const widthPx = widthMm * PX_PER_MM;

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const update = () => setScale(outer.clientWidth > 0 ? Math.min(1, outer.clientWidth / widthPx) : 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [widthPx]);

  return { outerRef, scale, widthPx };
}
