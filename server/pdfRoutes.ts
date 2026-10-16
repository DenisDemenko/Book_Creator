import type { Express } from 'express';
import {
  registerPdfRoutes as registerPdfRoutesBase,
  type PdfRoutesDeps,
  type StoredBookOps,
} from './pdfRoutesBase';
import { registerDesigncraftThemePreviewRoutes } from './pdf/designcraft/themePreviewRoute';
import { registerPdfExportRoutes } from './pdfExportRoutes';

/**
 * Thin extension layer for Book Design Studio.
 *
 * Author-facing routes are registered first:
 * - DesignCraft theme preview;
 * - direct PDF download through the same renderer registry as preview/publish.
 *
 * Then control passes to the pre-existing PDF route set unchanged.
 */
export function registerPdfRoutes(app: Express, deps: PdfRoutesDeps): StoredBookOps {
  registerDesigncraftThemePreviewRoutes(app);
  registerPdfExportRoutes(app);
  return registerPdfRoutesBase(app, deps);
}

export type { PdfRoutesDeps, StoredBookOps } from './pdfRoutesBase';
