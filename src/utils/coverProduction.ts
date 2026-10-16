export type CoverPaperStock = 'white' | 'cream' | 'coated-matte' | 'coated-gloss';
export type CoverMaterial = 'matte-card' | 'gloss-card' | 'soft-touch-card' | 'cloth' | 'case-laminate';
export type CoverFinish = 'none' | 'matte' | 'gloss' | 'soft-touch';

export interface CoverProductionSettings {
  backArtUrl?: string;
  paperStock?: CoverPaperStock;
  coverMaterial?: CoverMaterial;
  finish?: CoverFinish;
}

export interface CoverGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  bleedMm: number;
  spineWidthMm: number;
  fullWrapWidthMm: number;
  fullWrapHeightMm: number;
  pageCount: number;
}

const PAPER_BULK_MM: Record<CoverPaperStock, number> = {
  // KDP page-thickness factors used by the production validator.
  // Keeping them here makes Cover Studio, KDP checks and export share one source of truth.
  white: 0.0572,
  cream: 0.0635,
  // Generic production estimates for coated stocks; these are not KDP paper presets.
  'coated-matte': 0.06,
  'coated-gloss': 0.062,
};

export function calculatePaperSpineThicknessMm(
  pageCount: number,
  paperStock: CoverPaperStock = 'white',
): number {
  const safePages = Math.max(1, Math.round(Number(pageCount) || 1));
  const bulk = PAPER_BULK_MM[paperStock] ?? PAPER_BULK_MM.white;
  return Number((safePages * bulk).toFixed(2));
}

export function calculateCoverGeometry(input: {
  pageWidthMm: number;
  pageHeightMm: number;
  bleedMm?: number;
  pageCount: number;
  coverType?: 'paperback' | 'hardcover' | 'ebook';
  paperStock?: CoverPaperStock;
}): CoverGeometry {
  const pageWidthMm = Math.max(1, Number(input.pageWidthMm) || 1);
  const pageHeightMm = Math.max(1, Number(input.pageHeightMm) || 1);
  const bleedMm = Math.max(0, Number(input.bleedMm) || 0);
  const pageCount = Math.max(1, Math.round(Number(input.pageCount) || 1));
  const paperStock = input.paperStock ?? 'white';
  const paperSpineMm = calculatePaperSpineThicknessMm(pageCount, paperStock);
  const hardcoverAllowance = input.coverType === 'hardcover' ? 2 : 0;
  const spineWidthMm = input.coverType === 'ebook'
    ? 0
    : Number((paperSpineMm + hardcoverAllowance).toFixed(1));

  return {
    pageWidthMm,
    pageHeightMm,
    bleedMm,
    spineWidthMm,
    fullWrapWidthMm: Number((pageWidthMm * 2 + spineWidthMm + bleedMm * 2).toFixed(1)),
    fullWrapHeightMm: Number((pageHeightMm + bleedMm * 2).toFixed(1)),
    pageCount,
  };
}

export function coverSurfaceBackground(imageUrl?: string): string {
  return imageUrl?.trim() ? '#0f172a' : '#ffffff';
}

export function coverSurfaceTextColor(imageUrl?: string): string {
  return imageUrl?.trim() ? '#ffffff' : '#0f172a';
}
