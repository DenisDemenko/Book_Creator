/**
 * Рушій «Nova» — власна верстка на `pdf-lib`. Той самий код, що працював до
 * появи вибору рушіїв (`pdfRenderer.ts`, `pdfKdp.ts`), лише загорнутий у
 * спільний інтерфейс.
 *
 * Він лишається за замовчуванням, і не з інерції: це ЄДИНИЙ рушій, який
 * виконує макет точно — дзеркальні поля й корінець, порахований від
 * фактичної кількості сторінок у три проходи. Ні браузер, ні LaTeX цього не
 * дадуть без окремої роботи, а KDP відхиляє файл саме за поля.
 */

import { renderBookPdf, fontsAvailable, FONT_DIR } from '../pdfRenderer';
import { renderKdpInterior } from '../pdfKdp';
import { pageCountOnlyMap } from '../../../shared/canonicalPageMap';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

export const novaEngine: PdfEngine = {
  id: 'nova',
  label: 'Nova (власна верстка)',
  strengthUk:
    'Точні поля під KDP: дзеркальні відступи й корінець, порахований від ' +
    'фактичного обсягу. Працює миттєво й не залежить ні від чого зовнішнього.',
  limitUk:
    'Виглядом керує наш код, а не таблиця стилів: складні макети, обтікання ' +
    'та типографські переноси йому недоступні.',
  supportsPrint: true,

  async available(): Promise<PdfEngineAvailability> {
    if (!fontsAvailable()) {
      return {
        ok: false,
        reasonUk: `Шрифти для PDF не знайдено в ${FONT_DIR}.`,
        fixUk: 'Без вбудованого шрифту кирилиця в PDF неможлива — потрібні файли DejaVu у server/pdf/fonts.',
      };
    }
    return { ok: true };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const check = await this.available();
    if (!check.ok) {
      throw new PdfEngineError('nova', 'unavailable', check.reasonUk || 'Рушій недоступний.');
    }

    try {
      if (request.print) {
        const kdp = await renderKdpInterior(request.book, {
          base: request.spec as never,
          trimId: request.trimId,
          hasBleed: request.hasBleed,
          ownerId: request.ownerId,
        });
        return {
          bytes: kdp.bytes,
          pageCount: kdp.pageCount,
          engineId: 'nova',
          pageMap: pageCountOnlyMap(
            'nova',
            'nova-pdf',
            kdp.pageCount,
            'Nova вже знає точні координати глав усередині pdfRenderer; їх буде піднято в цей контракт без повторної пагінації.'
          ),
          honoredSpec: true,
          notesUk: [...kdp.warningsUk, ...kdp.notesUk],
        };
      }

      const result = await renderBookPdf(request.book, request.spec, { ownerId: request.ownerId });
      return {
        bytes: result.bytes,
        pageCount: result.pageCount,
        engineId: 'nova',
        pageMap: pageCountOnlyMap(
          'nova',
          'nova-pdf',
          result.pageCount,
          'Nova вже знає точні координати глав усередині pdfRenderer; їх буде піднято в цей контракт без повторної пагінації.'
        ),
        honoredSpec: true,
        notesUk: result.notesUk,
      };
    } catch (err) {
      throw new PdfEngineError('nova', 'engine', (err as Error).message);
    }
  },
};
