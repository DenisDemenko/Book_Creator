import type { Express } from 'express';
import {
  registerPdfRoutes as registerPdfRoutesBase,
  type PdfRoutesDeps,
  type StoredBookOps,
} from './pdfRoutesBase';
import { registerDesigncraftThemePreviewRoutes } from './pdf/designcraft/themePreviewRoute';

/**
 * Thin extension layer for Book Design Studio.
 *
 * The pre-existing PDF route implementation is kept byte-for-byte in
 * `pdfRoutesBase.ts`. We register the new author-facing DesignCraft preview
 * first, then hand control to the old route set unchanged.
 */
export function registerPdfRoutes(app: Express, deps: PdfRoutesDeps): StoredBookOps {
  registerDesigncraftThemePreviewRoutes(app);
  return registerPdfRoutesBase(app, deps);
}

export type { PdfRoutesDeps, StoredBookOps } from './pdfRoutesBase';
