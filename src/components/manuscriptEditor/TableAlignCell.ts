import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

/**
 * Розширює стандартні tableCell/tableHeader атрибутом `align` —
 * горизонтальне вирівнювання тексту КЛІТИНКИ (ліворуч/по центру/праворуч),
 * саме те, про що попросив автор: «текст в них вирівнювати по лівому або
 * правому краю або по середині» (запис #193). Не чіпає вирівнювання
 * звичайних абзаців поза таблицею — там окремого перемикача нема, автор
 * просив вирівнювання САМЕ в клітинках.
 *
 * `align: null` = дефолт (ліворуч) — у маркер `[CELL align=…]` тоді
 * взагалі не пишеться атрибут (utils/tableMarkers.ts).
 */
export const TableCellAlign = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const style = element.style.textAlign;
          return style === 'right' || style === 'center' ? style : null;
        },
        renderHTML: (attrs: Record<string, any>) => {
          if (!attrs.align || attrs.align === 'left') return {};
          return { style: `text-align:${attrs.align}` };
        },
      },
    };
  },
});

export const TableHeaderAlign = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const style = element.style.textAlign;
          return style === 'right' || style === 'center' ? style : null;
        },
        renderHTML: (attrs: Record<string, any>) => {
          if (!attrs.align || attrs.align === 'left') return {};
          return { style: `text-align:${attrs.align}` };
        },
      },
    };
  },
});
