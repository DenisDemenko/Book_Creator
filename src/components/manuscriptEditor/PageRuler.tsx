import React, { useRef } from 'react';
import { usePageScale } from './usePageScale';
import { PX_PER_MM, buildRulerMarks, buildRulerSheetLayout, formatMm } from '../../utils/mmUnits';
import { clampMarginMm, type MarginSide } from '../../utils/pageGeometry';
import { useLanguage } from '../../i18n/LanguageContext';

interface PageRulerProps {
  /** Повна ширина аркуша (мм) — формат сторінки від краю до краю, те, що друкується. Шкала лінійки починається з 0 на лівому краї АРКУША. */
  sheetWidthMm: number;
  /**
   * Ширина текстової колонки (мм) — те саме число, що `widthMm` у PageColumn
   * під цією лінійкою. Потрібне для ДВОХ речей: масштаб (щоб лінійка й текст
   * стискались однаково) і ширина світлої зони тексту між полями.
   */
  textWidthMm: number;
  insideMm: number;
  outsideMm: number;
  onChangeMargins: (patch: { insideMm?: number; outsideMm?: number }) => void;
  /** Той самий zoomFactor, що передається сусідньому PageColumn — інакше лінійка розійдеться з колонкою тексту під нею. */
  zoomFactor?: number;
  /**
   * Ширина смуги вертикальної лінійки, яка стоїть ЗЛІВА в PageColumn під цією
   * лінійкою (0 — коли вертикальної лінійки нема). Лінійка відступає на цю
   * ширину, щоб міряти рівно те поле, у якому лежить текст: без цього її
   * центр зсунувся б на половину смуги і шкала не збіглася б із текстом.
   */
  verticalRulerWidthPx?: number;
}

/**
 * Горизонтальна лінійка над текстом редактора — тепер по АРКУШУ, а не по
 * текстовій колонці.
 *
 * ЩО БУЛО НЕ ТАК. Раніше лінійка малювалась рівно на ширину текстової
 * колонки (`widthMm` = формат мінус поля), і «0» стояла на лівому краї
 * тексту. Для A4 з полями 20 мм автор бачив шкалу 0…170 — тобто жодного
 * мм зі справжніх 210, — і не міг ні перевірити формат, ні побачити, скільки
 * саме зʼїдають поля. Те саме число «ширина сторінки», яке сторінка має в
 * «Верстка & Поля», на лінійці не зʼявлялось ніде.
 *
 * ЩО ТЕПЕР. Лінійка малює ВЕСЬ аркуш: сіру смугу полів по краях і світлу
 * зону тексту всередині, а шкала йде від 0 на лівому краї аркуша до
 * `sheetWidthMm` (210 для A4). Ручки полів стоять точно на межах текстової
 * зони (а не на краях колонки), бо саме цю межу вони й рухають. Праворуч —
 * підпис ширини текстової зони в мм, тобто та цифра, яку автор і хотів
 * перевірити.
 *
 * ЧОМУ МАСШТАБ РАХУЄТЬСЯ ВІД ТЕКСТУ, А НЕ ВІД АРКУША. Сторінка в редакторі
 * намальована як текстова колонка (див. PageColumn.tsx) — аркуша як окремого
 * прямокутника в канві немає. Щоб зона тексту на лінійці стояла рівно над
 * колонкою тексту й лишалась нею і при зміні масштабу, лінійка бере ТОЙ
 * САМИЙ `usePageScale(textWidthMm, zoomFactor)`, що й колонка, а аркуш
 * домальовує навколо неї: ліва межа аркуша відходить від колонки на
 * `insideMm`, права — на `outsideMm`. Через це на вузькому вікні (аркуш
 * ширший за доступне місце) частину аркуша видно не повністю — дивитись
 * доведеться з меншим масштабом. Це чесніше, ніж стискати лінійку окремо
 * від тексту: саме та окремість і породила цю помилку.
 *
 * Ручки пишуть напряму в `book.layoutConfig.margins` (EditorView.tsx) — те
 * саме поле, що вже редагує «Верстка & Поля», тож обидва місця лишаються
 * синхронізованими без додаткового стану. Межі руху полів —
 * `clampMarginMm` з pageGeometry.ts (спільні з PdfEditorView найменші 5 мм).
 */

export const PageRuler: React.FC<PageRulerProps> = ({
  sheetWidthMm,
  textWidthMm,
  insideMm,
  outsideMm,
  onChangeMargins,
  zoomFactor = 1,
  verticalRulerWidthPx = 0,
}) => {
  const { t } = useLanguage();
  const { outerRef: marksRef, scale } = usePageScale(textWidthMm, zoomFactor);
  const dragRef = useRef<{ side: MarginSide; startClientX: number; startMm: number } | null>(null);

  const beginDrag = (side: MarginSide) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startMm = side === 'insideMm' ? insideMm : outsideMm;
    dragRef.current = { side, startClientX: e.clientX, startMm };

    const handleMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxPx = ev.clientX - d.startClientX;
      // Той самий scale, що масштабує лінійку, — тому ручка їде за курсором
      // один-до-одного, а не «приблизно за курсором».
      const dxMm = dxPx / (PX_PER_MM * (scale || 1));
      // Лівий маркер (внутрішнє поле) тягнуть вправо, щоб ЗБІЛЬШИТИ поле
      // (звузити колонку); правий (зовнішнє) тягнуть вліво з тим самим
      // ефектом — тому знак протилежний.
      const deltaMm = d.side === 'insideMm' ? dxMm : -dxMm;
      const nextMm = clampMarginMm(d.side, d.startMm + deltaMm, { pageWidthMm: sheetWidthMm, insideMm, outsideMm });
      onChangeMargins(d.side === 'insideMm' ? { insideMm: nextMm } : { outsideMm: nextMm });
    };
    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const marks = buildRulerMarks(sheetWidthMm);
  // Де стоїть аркуш відносно центру доступної ширини — уся арифметика
  // вирівнювання лінійки з текстом живе в buildRulerSheetLayout (mmUnits.ts)
  // і зафіксована тестом: колонка тексту в PageColumn центрується тим самим
  // «50% − пів ширини» і масштабується тим самим scale, тому світла зона на
  // лінійці стоїть точно над текстом.
  const sheet = buildRulerSheetLayout({ sheetWidthMm, textWidthMm, insideMm, outsideMm, scale });
  const { sheetWidthPx, insidePx, textWidthPx, outsidePx, sheetLeftScaledPx } = sheet;

  const widthLabel = formatMm(textWidthMm);
  const sheetTip = t('editor.rulerSheetTip', {
    sheet: formatMm(sheetWidthMm),
    text: widthLabel,
    inside: formatMm(insideMm),
    outside: formatMm(outsideMm),
  });

  return (
    <div className="w-full h-6 relative select-none shrink-0 flex overflow-hidden" style={{ background: '#1e293b' }}>
      {/* Смуга під вертикальну лінійку — такої ж ширини, як у PageColumn
          нижче, щоб лінійка міряла рівно поле з текстом. */}
      {verticalRulerWidthPx > 0 && <div className="shrink-0 h-full" style={{ width: verticalRulerWidthPx }} />}
      <div ref={marksRef} className="relative flex-1 min-w-0 h-full overflow-hidden">
        <div
          title={sheetTip}
          style={{
            width: sheetWidthPx,
            height: '100%',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: `calc(50% - ${sheetLeftScaledPx}px)`,
            // Сірий аркуш = поля; світлий поверх нього = текстова зона.
            background: '#dfe3e8',
            boxShadow: '0 0 0 1px rgba(100, 116, 139, 0.45)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: insidePx,
              width: textWidthPx,
              background: '#fffefc',
            }}
          />
          {marks.map((m) => (
            <div key={m.mm} className="absolute top-0 bottom-0" style={{ left: m.mm * PX_PER_MM }}>
              <div style={{ width: 1, height: m.major ? '100%' : '50%', background: '#94a3b8' }} />
              {m.major && (
                <span className="text-[8px] text-slate-500 absolute top-0.5 left-0.5 font-mono">{m.mm}</span>
              )}
            </div>
          ))}
          {/* Ручки — на межах текстової зони, а не на краях колонки: тягнуть
              саме цю межу. */}
          <div
            onPointerDown={beginDrag('insideMm')}
            className="absolute top-0 bottom-0 w-2.5 cursor-ew-resize bg-amber-500/70 hover:bg-amber-400"
            style={{ left: insidePx, transform: 'translateX(-50%)' }}
            title={t('editor.rulerInsideHandleTip')}
          />
          <div
            onPointerDown={beginDrag('outsideMm')}
            className="absolute top-0 bottom-0 w-2.5 cursor-ew-resize bg-amber-500/70 hover:bg-amber-400"
            style={{ left: sheetWidthPx - outsidePx, transform: 'translateX(-50%)' }}
            title={t('editor.rulerOutsideHandleTip')}
          />
        </div>
        {/* Підпис ширини текстової зони — та цифра, яку автор перевіряє. */}
        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 rounded bg-slate-900/85 text-[9px] font-mono text-slate-300 pointer-events-none whitespace-nowrap"
          title={sheetTip}
        >
          {t('editor.rulerTextWidth', { width: widthLabel })}
        </div>
      </div>
    </div>
  );
};
