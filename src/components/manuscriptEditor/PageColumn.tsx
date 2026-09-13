import React, { useEffect, useRef, useState } from 'react';
import { usePageScale } from './usePageScale';
import { PX_PER_MM, buildRulerMarks, formatMm } from '../../utils/mmUnits';
import type { PaginationSnapshot } from '../../utils/pageBreaker';
import type { PageGeometry } from '../../utils/pageGeometry';
import { useLanguage } from '../../i18n/LanguageContext';

interface PageColumnProps {
  children: React.ReactNode;
  widthMm: number;
  className?: string;
  /** Стеля масштабу понад фізичний розмір сторінки — див. usePageScale.ts. За замовчуванням 1 (поведінка не змінюється). */
  zoomFactor?: number;
  /** Показати вертикальну лінійку (мм) зліва від тексту — керується тим самим перемикачем «показати лінійку», що й горизонтальна PageRuler.tsx. За замовчуванням false (поведінка не змінюється). */
  showVerticalRuler?: boolean;
  /**
   * Відрендерні межі сторінок — від PaginationPlugin.ts. Без них вертикальна
   * лінійка лишається порожньою смугою: міряти їй нічого, а вигадувати
   * числа замість виміряних ми не будемо (див. PaginationSnapshot у
   * pageBreaker.ts — до цього тут малювалась одна шкала на всю ВИСОТУ
   * ВМІСТУ, і числа на ній не мали відношення до жодного аркуша).
   */
  pagination?: PaginationSnapshot | null;
  /** Геометрія аркуша — для підказки вертикальної лінійки («аркуш 297 мм, текст 257 мм»). */
  pageGeometry?: PageGeometry;
}

/**
 * Ширина смуги вертикальної лінійки, px — та сама висота (24px = h-6), що й
 * у горизонтальної PageRuler.tsx, для візуальної симетрії. Експортована, бо
 * саме на цю ширину горизонтальна лінійка мусить відступити від лівого краю
 * панелі: інакше вона міряла б усе поле панелі, а текст лежить у вужчому
 * (панель мінус смуга), і центри цих двох прямокутників не збігаються.
 */
export const VERTICAL_RULER_WIDTH_PX = 24;

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
export const PageColumn: React.FC<PageColumnProps> = ({
  children,
  widthMm,
  className,
  zoomFactor = 1,
  showVerticalRuler = false,
  pagination = null,
  pageGeometry,
}) => {
  const { t } = useLanguage();
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

  // Вертикальна лінійка — та сама логіка позначок (buildRulerMarks), що й у
  // горизонтальної PageRuler.tsx, але своя шкала НА КОЖНУ СТОРІНКУ: 0 на
  // верху текстової зони, далі кожні 5 мм, цифра — кожні 10. Бюджет висоти
  // береться зі знімка пагінації (`contentHeightPx`), а не з геометрії:
  // це саме те число, за яким плагін робив розриви, тож п'ятдесяті міліметри
  // лінійки і розрив у тексті не можуть розійтись.
  const verticalMarks = showVerticalRuler && pagination ? buildRulerMarks(pagination.contentHeightPx / PX_PER_MM) : [];

  // Світлі зони = заповнений текст кожної сторінки. Між ними лишається тло
  // смуги — і воно ж стоїть під смугою розриву в тексті, тому межа сторінки
  // на лінійці видно рівно там, де вона в рукописі.
  const pageZones =
    showVerticalRuler && pagination
      ? pagination.pageTopsPx
          .map((topPx, i) => ({ topPx, heightPx: Math.max(0, (pagination.pageBottomsPx[i] ?? topPx) - topPx) }))
          .filter((z) => z.heightPx > 0)
      : [];
  const budgetMmLabel = pagination ? formatMm(pagination.contentHeightPx / PX_PER_MM) : '';
  const sheetMmLabel = pageGeometry ? formatMm(pageGeometry.pageHeightMm) : '';

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
          className="shrink-0 relative select-none overflow-hidden"
          style={{
            width: VERTICAL_RULER_WIDTH_PX,
            height: naturalHeightPx * scale,
            background: '#1e293b',
            // Внутрішня лінія по правому краю: світлі зони тексту тієї ж
            // барви, що й аркуш (`#fffefc`), тож без цієї межі смуга
            // зливалась би зі сторінкою в одну білу пляму. Inset-тінь, а не
            // border — щоб не зсунути розкладку на 1 px.
            boxShadow: 'inset -1px 0 0 rgba(100, 116, 139, 0.45)',
          }}
        >
          {pageZones.map((z, i) => (
            <div
              key={z.topPx}
              className="absolute left-0 right-0 overflow-hidden"
              style={{ top: z.topPx * scale, height: z.heightPx * scale, background: '#fffefc' }}
              title={t('editor.verticalRulerPageTip', {
                page: i + 1,
                filled: formatMm(z.heightPx / PX_PER_MM),
                budget: budgetMmLabel,
                sheet: sheetMmLabel,
              })}
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
