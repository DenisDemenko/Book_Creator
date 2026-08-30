import { PageFormatPreset } from '../types';

/**
 * Короткий список форматів для швидкого перемикача просто в редакторі
 * (EditorView.tsx) — щоб змінити розмір аркуша, не виходячи з «Книга &
 * Текст» на вкладку «Верстка & Поля».
 *
 * Свідомо НЕ той самий масив, що в LayoutView.tsx: там кожен формат ще й
 * несе `desc`/`kdpTag` для розгорнутих карток вибору, і рефакторити великий
 * стабільний файл заради шести рядків тут — зайвий ризик. Джерело правди
 * для самих РОЗМІРІВ (id/мм) одне й те саме в обох місцях; якщо колись
 * зміниться, треба звірити з LayoutView.tsx.
 */
export interface PageFormatQuickOption {
  id: PageFormatPreset;
  widthMm: number;
  heightMm: number;
  /** Ключ i18n — той самий простір `layoutView`, що вже перекладений. */
  labelKey: string;
}

export const PAGE_FORMAT_QUICK_OPTIONS: PageFormatQuickOption[] = [
  { id: 'A5', widthMm: 148, heightMm: 210, labelKey: 'layoutView.presetA5Label' },
  { id: 'A4', widthMm: 210, heightMm: 297, labelKey: 'layoutView.presetA4Label' },
  { id: '6x9', widthMm: 152.4, heightMm: 228.6, labelKey: 'layoutView.preset6x9Label' },
  { id: '5.5x8.5', widthMm: 139.7, heightMm: 215.9, labelKey: 'layoutView.preset55x85Label' },
  { id: '5x8', widthMm: 127, heightMm: 203.2, labelKey: 'layoutView.preset5x8Label' },
  { id: '7x10', widthMm: 177.8, heightMm: 254, labelKey: 'layoutView.preset7x10Label' },
];
