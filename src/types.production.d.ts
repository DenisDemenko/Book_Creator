import type { BookDesignThemeId } from './data/bookDesignThemeCatalog';
import type { CoverFinish, CoverMaterial, CoverPaperStock } from './utils/coverProduction';
import './types';

declare module './types' {
  interface BookLayoutConfig {
    /** Book Design Studio v1 theme persisted with the book. */
    bookDesignThemeId?: BookDesignThemeId;
    /** PDF renderer chosen by the author for this concrete book. */
    preferredPdfEngineId?: string;
  }

  interface CoverConfig {
    /** Optional separate art for the back cover. */
    backArtUrl?: string;
    /** Physical paper stock used for spine/binding geometry. */
    paperStock?: CoverPaperStock;
    /** Physical cover material. */
    coverMaterial?: CoverMaterial;
    /** Surface finish / lamination. */
    finish?: CoverFinish;
  }
}

export {};
