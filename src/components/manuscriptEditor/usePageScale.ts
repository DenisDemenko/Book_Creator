import { useEffect, useRef, useState } from 'react';
import { PX_PER_MM } from '../../utils/mmUnits';

/**
 * Режим масштабу аркуша.
 *   • `zoom` — ЧЕСНИЙ зум: показаний відсоток і є справжнім масштабом
 *     (`100 %` = аркуш 1:1 із тим, що поїде в друк). Якщо аркуш ширший за
 *     панель, він не стискається — панель прокручується горизонтально.
 *   • `fit` — «вмістити»: аркуш завжди вписується в панель, а відсоток стає
 *     лише верхньою межею (стара поведінка цілком).
 *
 * ЧОМУ ЦЕ ДВА РЕЖИМИ, А НЕ ОДИН. Раніше формула була одна —
 * `min(zoomFactor, fitRatio)` — і вона робила число в списку масштабу
 * неправдою: автор вибирав «100 %», бачив на екрані 70 %, і не мав жодного
 * способу дізнатись ані котрий масштаб насправді, ані чому аркуш не такий,
 * як у друці. Тепер «100 %» означає рівно 100 %, а «Авто» — те, що було
 * раніше (і те, що зручно на вузькому екрані).
 */
export type PageScaleMode = 'zoom' | 'fit';

/**
 * Скільки CSS-масштабу застосувати. Чиста функція — щоб формулу можна було
 * перевірити тестом, а не тільки в браузері (сам хук для цього потребує DOM).
 */
export function resolveSheetScale(
  mode: PageScaleMode,
  zoomFactor: number,
  widthPx: number,
  availablePx: number
): number {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  if (mode === 'zoom') return zoom;
  const fitRatio = availablePx > 0 && widthPx > 0 ? availablePx / widthPx : 1;
  return Math.min(zoom, fitRatio);
}

/**
 * Спільний розрахунок масштабу "справжня сторінка → вільно розтяжний
 * контейнер" — використовується і PageColumn.tsx (сам текст розділу), і
 * PageRuler.tsx (лінійка над ним), щоб обидва завжди мали ОДНАКОВИЙ
 * масштаб (лінійка має лишатися вирівняною з колонкою тексту під нею).
 *
 * `zoomFactor` (за замовчуванням 1) піднімає масштаб вище фізичного розміру
 * сторінки: раніше `Math.min(1, ...)` ніколи не давав сторінці вирости
 * понад свій справжній друкований розмір, авіть на широкому екрані у
 * фулскріні, де навколо неї лишалось порожнє тло. Це НЕ підміна ширини
 * сторінки (`widthMm`/`widthPx` не зачіпаються — розкладку/пагінацію, яка
 * міряє `offsetHeight` немасштабованого блока, це не торкається жодним
 * чином, той самий принцип, що вже описаний у PageColumn.tsx), а суто
 * `transform: scale()`.
 *
 * `reservedPx` (за замовчуванням 0) віднімається від виміряної ширини
 * контейнера ДО розрахунку fitRatio — потрібно, коли всередині того самого
 * `outerRef` зі сторінкою тепер ще й вертикальна лінійка (PageColumn.tsx):
 * без цього сторінка масштабувалась би так, ніби вся ширина контейнера
 * належить ЇЙ, і вилізала б під смугу лінійки замість того, щоб стиснутись
 * під неї.
 *
 * У режимі `zoom` контейнер не вимірюється взагалі (ResizeObserver не
 * потрібен): масштаб не залежить від того, скільки місця є.
 */
export function usePageScale(
  widthMm: number,
  zoomFactor: number = 1,
  reservedPx: number = 0,
  mode: PageScaleMode = 'zoom'
) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(() => resolveSheetScale(mode, zoomFactor, 0, 0));
  const widthPx = widthMm * PX_PER_MM;

  useEffect(() => {
    if (mode === 'zoom') {
      // Контейнер не потрібен — і це навмисно: у чесному зумі масштаб не
      // залежить від вільного місця, тож ані ResizeObserver, ані вимір
      // контейнера не потрібні.
      setScale(resolveSheetScale('zoom', zoomFactor, widthPx, 0));
      return;
    }
    const outer = outerRef.current;
    const update = () => {
      const availablePx = outer ? Math.max(0, outer.clientWidth - reservedPx) : 0;
      setScale(resolveSheetScale('fit', zoomFactor, widthPx, availablePx));
    };
    update();
    if (!outer) return;
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [widthPx, zoomFactor, reservedPx, mode]);

  return { outerRef, scale, widthPx };
}
