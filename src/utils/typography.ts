/**
 * Типографіка аркуша — ОДНЕ джерело правди для того, як виглядає текст книги,
 * незалежно від того, де його намальовано: у живому редакторі, у «Розвороті
 * книги» чи в PDF.
 *
 * НАВІЩО ОКРЕМИЙ МОДУЛЬ. До цього ті самі числа з `layoutConfig.typography`
 * кожне місце рахувало по-своєму — і кожне по-своєму помилялось:
 *   • живий редактор (`EditorView.tsx`) брав кегль як `fontSizePt * 1.3` px
 *     (правильно `* 96/72`), тримав власний відступ між абзацами `0.9em` у
 *     `index.css`, і **взагалі не читав** ні `firstLineIndentMm`, ні
 *     `paragraphSpacingMm`, ні `textAlign` — тобто налаштування з «Верстка &
 *     Поля» в канві не робили нічого;
 *   • вимір «Розвороту книги» (`useRealBookPages.ts`) клав ті самі абзаци в
 *     голий контейнер, де Tailwind-ів preflight знімає поля абзаців до нуля —
 *     тому сторінок виходило менше, ніж у редакторі;
 *   • превʼю «Розвороту» (`BookPreviewView.tsx`) малювало абзацний відступ як
 *     `firstLineIndentMm * 2` пікселів, тобто 6 мм ставали 12 px замість
 *     22.7 px;
 *   • друкарські рушії читають ті самі поля правильно (у пунктах і мм) — і
 *     саме тому канва не збігалась із тим, що надрукується.
 *
 * Спільна структура стилів для екрана — клас `.nova-manuscript-blocks` у
 * `index.css`; його правила працюють виключно через CSS-змінні, які віддає
 * `paragraphCssVars` нижче. Тобто значення приходять з цього модуля, а не з
 * трьох різних місць — і розійтись більше не можуть.
 */
import type { BookLayoutConfig } from '../types';
import { PT_TO_PX } from './mmUnits';

export const DEFAULT_FONT_SIZE_PT = 11;
export const DEFAULT_LINE_HEIGHT = 1.5;
/** Абзацний відступ за замовчуванням, мм — той самий, що в `initialBook.ts`. */
export const DEFAULT_FIRST_LINE_INDENT_MM = 6;
export const DEFAULT_PARAGRAPH_SPACING_MM = 0;

export interface ParagraphGeometry {
  /** Кегль основного тексту в пунктах — та сама величина, що в друкарських рушіях. */
  fontSizePt: number;
  /** Той самий кегль у CSS-пікселях — 1 pt = 96/72 px (а не 1.3, як було). */
  fontSizePx: number;
  lineHeight: number;
  firstLineIndentMm: number;
  paragraphSpacingMm: number;
  textAlign: 'justify' | 'left';
}

/** Число в межах, інакше запасне: зіпсовані дані не мають ламати верстку. */
function inRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Геометрія абзацу для ЕКРАНА. Діапазони свідомо ті самі, що вже перевіряє
 * `PdfEditorView` і KDP-порадник (відступ 4…12 мм — «чітке розділення думок»),
 * а не вигадані тут: занадто великий відступ на екрані — це вже не верстка.
 */
export function resolveParagraphGeometry(
  layout?: Partial<BookLayoutConfig> | null
): ParagraphGeometry {
  const t = layout?.typography;
  return {
    fontSizePt: inRange(t?.fontSizePt, 6, 24, DEFAULT_FONT_SIZE_PT),
    fontSizePx: inRange(t?.fontSizePt, 6, 24, DEFAULT_FONT_SIZE_PT) * PT_TO_PX,
    lineHeight: inRange(t?.lineHeight, 1, 2.5, DEFAULT_LINE_HEIGHT),
    firstLineIndentMm: inRange(t?.firstLineIndentMm, 0, 20, DEFAULT_FIRST_LINE_INDENT_MM),
    paragraphSpacingMm: inRange(t?.paragraphSpacingMm, 0, 20, DEFAULT_PARAGRAPH_SPACING_MM),
    textAlign: t?.textAlign === 'justify' ? 'justify' : 'left',
  };
}

/**
 * CSS-змінні для класу `.nova-manuscript-blocks`. Міліметри, а не пікселі:
 * усередині колонки сторінка вже масштабується через `transform: scale()`, і
 * `6mm` там лишається шістьма міліметрами аркуша — тими самими, що поїдуть у
 * PDF. Пікселі в цьому місці означали б ще одну власну арифметику.
 */
export function paragraphCssVars(geometry: ParagraphGeometry): Record<string, string> {
  return {
    '--para-indent': `${geometry.firstLineIndentMm}mm`,
    '--para-gap': `${geometry.paragraphSpacingMm}mm`,
    '--para-align': geometry.textAlign,
  };
}

/**
 * Назва шрифту з налаштувань книги → повний CSS-стек із запасними.
 * `customFont` — шрифт, підключений автором (`@font-face` додається в
 * EditorView): для нього стек коротший, лише засічковий фолбек.
 */
export function bodyFontStack(bodyFont: string, customFont = false): string {
  if (customFont) return `"${bodyFont}", Georgia, serif`;
  switch (bodyFont) {
    case 'Cormorant Garamond':
      return "'Cormorant Garamond', Georgia, serif";
    case 'Outfit':
      return "Outfit, 'Plus Jakarta Sans', sans-serif";
    case 'Plus Jakarta Sans':
      return "'Plus Jakarta Sans', -apple-system, sans-serif";
    case 'Literata':
    default:
      return "Literata, 'Cormorant Garamond', Georgia, serif";
  }
}
