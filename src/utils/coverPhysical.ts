/**
 * Фізичні розміри розгортки обкладинки (BACK + SPINE + FRONT) з bleed.
 *
 * Раніше ці два вирази стояли окремо в `CoverPhysicalSpec` і
 * `CoverPhysicalPreview`; тепер одне місце, яке перевіряє тест, і розмір
 * книги в мм завжди збігається в підписі та в превʼю.
 */

export interface CoverTrim {
  pageWidthMm: number;
  pageHeightMm: number;
  bleedMm?: number;
}

export interface CoverSpreadDimensions {
  /** Ширина розгортки, мм: 2 × сторінка + корінець + bleed з двох боків. */
  fullWidthMm: number;
  /** Висота розгортки, мм: сторінка + bleed зверху й знизу. */
  fullHeightMm: number;
  /** Частка корінця в ширині розгортки, %. Не менша за 0,8 % — щоб було видно. */
  spinePercent: number;
  /** Частка однієї сторінки (задня або передня) у ширині розгортки, %. */
  pagePercent: number;
}

const round1 = (value: number) => Number(value.toFixed(1));

export function coverSpreadDimensions(trim: CoverTrim, spineWidthMm: number): CoverSpreadDimensions {
  const bleedMm = Math.max(0, trim.bleedMm || 0);
  const spine = Math.max(0, Number.isFinite(spineWidthMm) ? spineWidthMm : 0);
  const rawWidth = trim.pageWidthMm * 2 + spine + bleedMm * 2;
  const rawHeight = trim.pageHeightMm + bleedMm * 2;
  const safeWidth = Math.max(rawWidth, 1);
  return {
    fullWidthMm: round1(rawWidth),
    fullHeightMm: round1(rawHeight),
    spinePercent: Math.max(0.8, (spine / safeWidth) * 100),
    pagePercent: (trim.pageWidthMm / safeWidth) * 100,
  };
}

/** Чи вказано розмір книги (формат) — без нього розгортку порахувати не можна. */
export function hasCoverTrim(trim: Partial<CoverTrim> | undefined | null): trim is CoverTrim {
  return !!trim
    && Number.isFinite(trim.pageWidthMm) && (trim.pageWidthMm as number) > 0
    && Number.isFinite(trim.pageHeightMm) && (trim.pageHeightMm as number) > 0;
}
