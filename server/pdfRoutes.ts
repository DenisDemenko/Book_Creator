import type { Express } from 'express';
import {
  registerPdfRoutes as registerPdfRoutesBase,
  type PdfRoutesDeps,
  type StoredBookOps,
} from './pdfRoutesBase';
import { registerAuthorPdfPreviewRoutes } from './pdf/authorPreviewRoute';
import { registerDesigncraftThemePreviewRoutes } from './pdf/designcraft/themePreviewRoute';
import { registerDesigncraftDraftRoutes } from './pdf/designcraftDraftRoutes';

/**
 * Thin extension layer for Book Design Studio.
 *
 * The pre-existing PDF route implementation is kept byte-for-byte in
 * `pdfRoutesBase.ts`. We register author-facing preview extensions first,
 * then hand control to the old route set unchanged.
 */
export function registerPdfRoutes(app: Express, deps: PdfRoutesDeps): StoredBookOps {
  registerAuthorPdfPreviewRoutes(app);
  registerDesigncraftThemePreviewRoutes(app);
  registerDesigncraftDraftRoutes(app);
  return registerPdfRoutesBase(app, deps);
}

export type { PdfRoutesDeps, StoredBookOps } from './pdfRoutesBase';
