import { useEffect, useRef, useState } from 'react';
import { PX_PER_MM } from '../../utils/mmUnits';

/**
 * Спільний розрахунок масштабу "справжня сторінка → вільно розтяжний
 * контейнер" — використовується і PageColumn.tsx (сам текст розділу), і
 * PageRuler.tsx (лінійка над ним), щоб обидва завжди мали ОДНАКОВУ ширину
 * й масштаб (лінійка має лишатися вирівняною з колонкою тексту під нею).
 *
 * `zoomFactor` (за замовчуванням 1 — поведінка не змінюється для жодного
 * наявного виклику) піднімає СТЕЛЮ масштабу вище фізичного розміру
 * сторінки: раніше `Math.min(1, ...)` ніколи не давав сторінці вирости
 * понад свій справжній друкований розміру, авіть на широкому екрані у
 * фулскріні, де навколо неї лишалось порожнє тло. Це НЕ підміна ширини
 * сторінки (`widthMm`/`widthPx` не зачіпаються — розкладку/пагінацію, яка
 * міряє `offsetHeight` немасштабованого блока, це не торкається жодним
 * чином, той самий принцип, що вже описаний у PageColumn.tsx), а суто
 * `transform: scale()` понад 1 — те саме масштабування, яким сторінка й
 * так уже стискається на вузьких екранах, лише в інший бік. Верхня межа
 * лишається `outer.clientWidth / widthPx`: збільшена сторінка ніколи не
 * вилізе за межі контейнера й не потребує горизонтального скролу.
 */
export function usePageScale(widthMm: number, zoomFactor: number = 1) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const widthPx = widthMm * PX_PER_MM;

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const update = () => {
      const fitRatio = outer.clientWidth > 0 ? outer.clientWidth / widthPx : 1;
      setScale(Math.min(zoomFactor, fitRatio));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [widthPx, zoomFactor]);

  return { outerRef, scale, widthPx };
}
