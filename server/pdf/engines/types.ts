/**
 * Спільний контракт рушіїв PDF.
 *
 * Рушій — це вибір автора, як шрифт чи формат. Кожен рушій зобов'язаний
 * чесно повідомляти про свою доступність до запуску публікації.
 */

import type { PdfBookInput, PdfLayoutSpec } from '../pdfTypes';
import type { CanonicalPageMap } from '../../../shared/canonicalPageMap';

export type PdfEngineId = 'nova' | 'chromium' | 'pandoc' | 'designcraft' | 'gamma';

export const PDF_ENGINE_IDS: readonly PdfEngineId[] = [
  'nova',
  'designcraft',
  'chromium',
  'pandoc',
  'gamma',
];

/** Рушій за замовчуванням: єдиний, який не залежить ні від чого зовнішнього. */
export const DEFAULT_PDF_ENGINE: PdfEngineId = 'nova';

/** Що саме друкуємо. */
export type PdfDocumentKind = 'book' | 'course';

export interface PdfRenderRequest {
  /** Мінімальний зріз книги — той самий, який приймає власний рушій. */
  book: PdfBookInput;
  kind: PdfDocumentKind;
  /** Налаштування макета від Studio. */
  spec?: Partial<PdfLayoutSpec>;
  /** Друкована редакція під KDP. Підтримує лише рушій `nova`. */
  print?: boolean;
  /** Хто друкує — для рушіїв, які працюють під ключем автора. */
  ownerId?: string | null;
  /** Роль того, хто друкує. */
  ownerRole?: string | null;
  /** Тема оформлення для рушіїв, які мають кілька виглядів. */
  theme?: string;
}

export interface PdfRenderResult {
  bytes: Uint8Array;
  pageCount: number;
  engineId: PdfEngineId;
  /**
   * Єдине джерело правди про пагінацію саме ЦЬОГО PDF-рендера.
   * UI/TOC/Spread не повинні повторно рахувати сторінки з тексту книги.
   */
  pageMap: CanonicalPageMap;
  /** false означає, що макет Studio виконано лише частково. */
  honoredSpec: boolean;
  /** Що саме рушій зробив інакше. */
  notesUk: string[];
}

export interface PdfEngineAvailability {
  ok: boolean;
  /** Чому не працює — конкретно й українською. */
  reasonUk?: string;
  /** Що зробити, щоб запрацював. */
  fixUk?: string;
}

export interface PdfEngineContext {
  ownerId?: string | null;
  ownerRole?: string | null;
}

export interface PdfEngine {
  id: PdfEngineId;
  label: string;
  /** Одне речення для автора: у чому саме цей рушій сильніший за інші. */
  strengthUk: string;
  /** Чого він НЕ вміє. */
  limitUk: string;
  /** Чи підтримує друковану редакцію під KDP. */
  supportsPrint: boolean;
  available(context?: PdfEngineContext): Promise<PdfEngineAvailability>;
  render(request: PdfRenderRequest): Promise<PdfRenderResult>;
}

/** Помилка рендера з причиною, придатною для показу авторові. */
export class PdfEngineError extends Error {
  constructor(
    readonly engineId: PdfEngineId,
    readonly kind: 'unavailable' | 'timeout' | 'bad_input' | 'engine',
    message: string
  ) {
    super(message);
    this.name = 'PdfEngineError';
  }
}
