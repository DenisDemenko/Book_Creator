import { DEFAULT_PDF_ENGINE } from './engines/types';

/**
 * PDF engine preference is book-owned layout state.
 *
 * Resolution order is deliberately explicit and shared by every render path:
 *   1. operation/edition override;
 *   2. book.layoutConfig.preferredPdfEngineId;
 *   3. legacy server default (Nova).
 *
 * This function only RESOLVES an id. It never checks availability and never
 * silently substitutes a different engine. Availability/capability failures
 * belong to renderWithEngine so the author can see and correct them.
 */
export function resolveBookPdfEngineId(
  book: Record<string, unknown> | null | undefined,
  explicitEngineId?: unknown
): string {
  const explicit = typeof explicitEngineId === 'string' ? explicitEngineId.trim() : '';
  if (explicit) return explicit;

  const layoutConfig = book?.layoutConfig;
  if (layoutConfig && typeof layoutConfig === 'object' && !Array.isArray(layoutConfig)) {
    const preferred = (layoutConfig as Record<string, unknown>).preferredPdfEngineId;
    if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
  }

  return DEFAULT_PDF_ENGINE;
}
