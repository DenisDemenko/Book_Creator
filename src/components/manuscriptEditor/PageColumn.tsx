import React, { useEffect, useRef, useState } from 'react';
import { usePageScale, type PageScaleMode } from './usePageScale';
import { PX_PER_MM, buildRulerMarks, formatMm } from '../../utils/mmUnits';
import { PAGE_FORMAT_QUICK_OPTIONS } from '../../utils/pageFormats';
import type { PaginationSnapshot } from '../../utils/pageBreaker';
import type { PageGeometry } from '../../utils/pageGeometry';
import { useLanguage } from '../../i18n/LanguageContext';

interface PageColumnProps {
  children: React.ReactNode;
  widthMm: number;
  className?: string;
  /** Стеля масштабу понад фізичний розмір сторінки — див. usePageScale.ts. За замовчуванням 1 (поведінка не змінюється). */
  zoomFactor?: number;
  /**
   * `zoom` (за замовчуванням) — чесний масштаб: показаний відсоток і є
   * справжнім. `fit` — вміщати аркуш у панель. Докладніше — usePageScale.ts.
   */
  scaleMode?: PageScaleMode;
  /**
   * Горизонтальна лінійка — рендериться ВСЕРЕДИНІ цього ж контейнера, а не
   * поруч із ним у батьківській розмітці. Це не косметика: лінійка має
   * прокручуватись разом із текстом (інакше при чесному зумі, коли аркуш
   * ширший за панель, міліметри поїхали б відносно тексту) і міряти РІВНО ту
   * саму ширину, що й колонка (інакше її масштаб відрізняється на ширину
   * смуги прокрутки — ті самі ~3 px, які лишались у фазі 1).
   */
  ruler?: React.ReactNode;
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
 * Висота «листа» (px, немасштабовано) — натуральна висота вмісту,
 * округлена ВГОРУ до цілого числа бюджетів однієї сторінки. Чиста функція
 * (винесена з компонента навмисно, як `resolveSheetScale` в
 * usePageScale.ts) — щоб і формулу округлення, і її межові випадки можна
 * було перевірити тестом у Node, а не лише оком у браузері.
 *
 *  • Без бюджету сторінки (`pageContentBudgetPx === null` — пагінація ще
 *    не порахована на першому рендері) — стара поведінка: висота точно за
 *    вмістом, щоб нічого не зламати до першого виміру.
 *  • Порожній чи від'ємний вміст (`naturalHeightPx <= 0`) із бюджетом —
 *    все одно ОДНА повна сторінка (`Math.max(1, …)`), а не 0: щойно
 *    створений розділ теж має показувати порожній аркуш, а не порожнечу.
 *  • Вміст рівно на N сторінок (без переповнення) — рівно N сторінок, без
 *    зайвої (N+1)-ї порожньої.
 */
export function resolveSheetDisplayHeightPx(naturalHeightPx: number, pageContentBudgetPx: number | null): number {
  if (!pageContentBudgetPx || pageContentBudgetPx <= 0 || !Number.isFinite(naturalHeightPx)) {
    return Math.max(0, naturalHeightPx || 0);
  }
  const pages = Math.max(1, Math.ceil(naturalHeightPx / pageContentBudgetPx));
  return pages * pageContentBudgetPx;
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
export const PageColumn: React.FC<PageColumnProps> = ({
  children,
  widthMm,
  className,
  zoomFactor = 1,
  scaleMode = 'zoom',
  ruler = null,
  showVerticalRuler = false,
  pagination = null,
  pageGeometry,
}) => {
  const { t } = useLanguage();
  const { outerRef, scale, widthPx } = usePageScale(widthMm, zoomFactor, showVerticalRuler ? VERTICAL_RULER_WIDTH_PX : 0, scaleMode);
  const innerRef = useRef<HTMLDivElement>(null);
  const [naturalHeightPx, setNaturalHeightPx] = useState(0);

  /**
   * Висота «листа» (білого тла) — раніше рівно натуральна висота вмісту
   * (`naturalHeightPx`), тож короткий розділ малював лист лише на кілька
   * рядків, а решта формату лишалась просто фоном застосунку. Власник:
   * «розгорнути блок листа канви на всю висоту обраного формату листа, щоб
   * письменик міг бачити пусте пространство, яке ще залишається не
   * заповненим на поточному аркуші». Тепер висота округлюється ВГОРУ до
   * цілого числа «бюджетів сторінки» (`pagination.contentHeightPx` — той
   * самий бюджет, за яким плагін пагінації ставить розриви, див. коментар
   * нижче біля verticalMarks) — короткий розділ усе одно показує один
   * повний аркуш, а розділ довжиною в 1.3 сторінки — два повні аркуші з
   * видимим порожнім хвостом другого. Без знімка пагінації (перший рендер,
   * поки плагін ще не порахував розриви) — стара поведінка: висота точно
   * за вмістом, щоб нічого не зламати до першого виміру.
   */
  const pageContentBudgetPx = pagination && pagination.contentHeightPx > 0 ? pagination.contentHeightPx : null;
  const displayHeightPx = resolveSheetDisplayHeightPx(naturalHeightPx, pageContentBudgetPx);

  /**
   * Підпис формату в правому верхньому кутку панелі — «А4 (210×297 мм) ·
   * поля …» — чиста довідка (не редагується звідси), світлим кольором, за
   * межами самого листа. Формат підбирається за розміром із того самого
   * переліку, що й селектор формату в тулбарі (`pageFormats.ts`); нема
   * точного збігу (автор вручну ввів нестандартний розмір у «Верстка &
   * Поля») — показуємо голі міліметри без назви пресету.
   */
  const formatPreset = pageGeometry
    ? PAGE_FORMAT_QUICK_OPTIONS.find(
        (p) => Math.round(p.widthMm) === Math.round(pageGeometry.pageWidthMm) && Math.round(p.heightMm) === Math.round(pageGeometry.pageHeightMm)
      )
    : undefined;
  const formatBadgeText = pageGeometry
    ? t('editor.pageFormatBadge', {
        format: formatPreset ? t(formatPreset.labelKey) : t('editor.pageFormatBadgeCustom'),
        w: formatMm(pageGeometry.pageWidthMm),
        h: formatMm(pageGeometry.pageHeightMm),
        top: formatMm(pageGeometry.margins.topMm),
        bottom: formatMm(pageGeometry.margins.bottomMm),
        inside: formatMm(pageGeometry.margins.insideMm),
        outside: formatMm(pageGeometry.margins.outsideMm),
      })
    : '';

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
          .map((topPx, i) => ({
            topPx,
            heightPx: Math.max(0, (pagination.pageBottomsPx[i] ?? topPx) - topPx),
            overflows: pagination.pageOverflows[i] === true,
          }))
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
    <div ref={outerRef} className={`overflow-y-auto flex flex-col ${className || ''}`}>
      {/* Горизонтальна лінійка — першим РЯДКОМ цього ж прокручуваного
          контейнера, а не окремим блоком над ним. `sticky top-0` тримає її
          на виду при вертикальному прокручуванні, а горизонтально вона
          сунеться разом із текстом — саме тому при чесному зумі (коли аркуш
          ширший за панель) міліметри не поїдуть відносно рядка. */}
      {ruler && <div className="sticky top-0 z-20 shrink-0">{ruler}</div>}
      {/* Підпис формату аркуша — у правому верхньому кутку ПАНЕЛІ (не
          листа), світлим кольором, суто довідково. `sticky` без власної
          висоти (h-0): не рухається разом із текстом при скролі (лишається
          у видимій верхній частині панелі), і не штовхає розкладку вниз.
          Поза transform:scale листа — тому масштабування самого аркуша
          його не зменшує й не збільшує, як і просив власник. */}
      {formatBadgeText && (
        <div className="sticky top-0 z-30 h-0 pointer-events-none" aria-hidden={false}>
          <div
            className="absolute top-1 right-2 text-[10px] font-mono text-slate-400/80 whitespace-nowrap select-none bg-slate-950/40 backdrop-blur-[1px] px-1.5 py-0.5 rounded"
            title={t('editor.pageFormatBadgeTitle')}
          >
            {formatBadgeText}
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
      {showVerticalRuler && (
        <div
          className="shrink-0 relative select-none overflow-hidden sticky left-0 z-10"
          style={{
            width: VERTICAL_RULER_WIDTH_PX,
            height: displayHeightPx * scale,
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
              style={{
                top: z.topPx * scale,
                height: z.heightPx * scale,
                // Бурштиновий = сторінка переповнена (блок, вищий за аркуш).
                // Це ЄДИНЕ місце, де канва свідомо розходиться з PDF: друк
                // розриває такий блок усередині, редактор — поки що ні.
                // Краще показати це кольором, ніж мовчати.
                background: z.overflows ? '#fde68a' : '#fffefc',
              }}
              title={
                z.overflows
                  ? t('editor.verticalRulerOverflowTip', {
                      page: i + 1,
                      filled: formatMm(z.heightPx / PX_PER_MM),
                      budget: budgetMmLabel,
                    })
                  : t('editor.verticalRulerPageTip', {
                      page: i + 1,
                      filled: formatMm(z.heightPx / PX_PER_MM),
                      budget: budgetMmLabel,
                      sheet: sheetMmLabel,
                    })
              }
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
      <div style={{ height: displayHeightPx * scale, position: 'relative', flex: 1, minWidth: 0 }}>
        <div
          style={{
            width: widthPx,
            // Явна висота — округлена вгору до цілих «сторінок» вище — а не
            // просто природна висота вмісту: саме це малює порожній
            // папір під коротким текстом, а не обрізає лист по останньому
            // рядку. Природну висоту й далі міряємо ОКРЕМИМ вкладеним
            // вузлом (innerRef, нижче) — інакше ResizeObserver міряв би
            // висоту, яку сам щойно зафіксував, і лист ніколи не міг би
            // зменшитись назад, коли автор видаляє текст.
            height: displayHeightPx,
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
            position: 'absolute',
            left: '50%',
            marginLeft: -widthPx / 2,
            background: '#fffefc',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div ref={innerRef}>{children}</div>
        </div>
      </div>
      </div>
    </div>
  );
};
