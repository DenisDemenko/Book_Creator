import type { PageFormatPreset } from '../types';

/**
 * Формати сторінки — один список для «Верстка & Поля» і «Верстка для публікації»,
 * щоб обидві сторінки писали однакові розміри. Підписи — ключі словника layoutView.
 */
export interface PageFormatPresetDef {
  id: PageFormatPreset;
  widthMm: number;
  heightMm: number;
  labelKey: string;
  descKey: string;
  kdpTag?: string;
}

export const PAGE_FORMAT_PRESETS: readonly PageFormatPresetDef[] = [
  { id: '6x9', widthMm: 152.4, heightMm: 228.6, labelKey: 'layoutView.preset6x9Label', descKey: 'layoutView.preset6x9Desc', kdpTag: 'Amazon #1' },
  { id: '5.5x8.5', widthMm: 139.7, heightMm: 215.9, labelKey: 'layoutView.preset55x85Label', descKey: 'layoutView.preset55x85Desc', kdpTag: 'Amazon KDP' },
  { id: '5x8', widthMm: 127, heightMm: 203.2, labelKey: 'layoutView.preset5x8Label', descKey: 'layoutView.preset5x8Desc', kdpTag: 'Amazon KDP' },
  { id: '7x10', widthMm: 177.8, heightMm: 254, labelKey: 'layoutView.preset7x10Label', descKey: 'layoutView.preset7x10Desc', kdpTag: 'Amazon KDP' },
  { id: 'A5', widthMm: 148, heightMm: 210, labelKey: 'layoutView.presetA5Label', descKey: 'layoutView.presetA5Desc' },
  { id: 'A4', widthMm: 210, heightMm: 297, labelKey: 'layoutView.presetA4Label', descKey: 'layoutView.presetA4Desc' },
];

/** Застосувати формат: ті самі поля, що й раніше писав LayoutView. */
export function applyPageFormatPreset<T extends { formatPreset?: PageFormatPreset; pageWidthMm?: number; pageHeightMm?: number }>(
  layout: T,
  preset: PageFormatPreset
): T {
  const found = PAGE_FORMAT_PRESETS.find((p) => p.id === preset);
  if (!found) return layout;
  return { ...layout, formatPreset: preset, pageWidthMm: found.widthMm, pageHeightMm: found.heightMm };
}
