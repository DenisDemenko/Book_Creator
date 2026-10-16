import { PDFDocument } from 'pdf-lib';
import { DEFAULT_LAYOUT_SPEC, MM_TO_PT, PAGE_SIZES, type PdfLayoutSpec } from '../pdfTypes';
import { designcraftEngineV3 } from './designcraftEngineV3';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

const KDP_BLEED_PT = 0.125 * 72;

function specOf(input?: Partial<PdfLayoutSpec>): PdfLayoutSpec {
  return {
    ...DEFAULT_LAYOUT_SPEC,
    ...(input || {}),
    margins: { ...DEFAULT_LAYOUT_SPEC.margins, ...(input?.margins || {}) },
    chapterTitle: { ...DEFAULT_LAYOUT_SPEC.chapterTitle, ...(input?.chapterTitle || {}) },
    sectionTitle: { ...DEFAULT_LAYOUT_SPEC.sectionTitle, ...(input?.sectionTitle || {}) },
    titlePage: { ...DEFAULT_LAYOUT_SPEC.titlePage, ...(input?.titlePage || {}) },
    frontMatter: { ...DEFAULT_LAYOUT_SPEC.frontMatter, ...(input?.frontMatter || {}) },
    pageNumber: { ...DEFAULT_LAYOUT_SPEC.pageNumber, ...(input?.pageNumber || {}) },
    runningHead: { ...DEFAULT_LAYOUT_SPEC.runningHead, ...(input?.runningHead || {}) },
  };
}

function pageSize(spec: PdfLayoutSpec): { width: number; height: number } {
  if (Number(spec.pageWidthPt) > 0 && Number(spec.pageHeightPt) > 0) {
    return { width: Number(spec.pageWidthPt), height: Number(spec.pageHeightPt) };
  }
  return PAGE_SIZES[spec.pageSize] || PAGE_SIZES.A5;
}

function ptToMm(pt: number): number {
  return Number((pt / MM_TO_PT).toFixed(1));
}

async function imposeForKdp(
  sourceBytes: Uint8Array,
  request: PdfRenderRequest,
  spec: PdfLayoutSpec,
): Promise<{ bytes: Uint8Array; notesUk: string[] }> {
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  const { width: trimWidth, height: trimHeight } = pageSize(spec);
  const hasBleed = Boolean(request.hasBleed);
  const bleed = hasBleed ? KDP_BLEED_PT : 0;
  const notesUk: string[] = [];

  const sourcePages = source.getPages();
  for (let index = 0; index < sourcePages.length; index += 1) {
    const sourcePage = sourcePages[index];
    const [embedded] = await output.embedPages([sourcePage]);
    const evenPage = (index + 1) % 2 === 0;

    // KDP interior bleed is 0.125" on the three outer trim edges: top,
    // bottom and the outside edge. There is no bleed on the binding edge.
    const outWidth = trimWidth + bleed;
    const outHeight = trimHeight + bleed * 2;
    const page = output.addPage([outWidth, outHeight]);

    // The DesignCraft digital document uses inside=left/outside=right on all
    // pages. For print, even (left-hand) pages swap those sides. Since the
    // text block width is unchanged, shifting the complete composed page by
    // outside-inside produces the mirrored physical placement without a
    // second text reflow (which would invalidate the canonical PageMap).
    const mirrorShift = evenPage ? spec.margins.right - spec.margins.left : 0;
    const bleedX = hasBleed && evenPage ? bleed : 0;
    const x = bleedX + mirrorShift;
    const y = bleed;

    page.drawPage(embedded, {
      x,
      y,
      width: trimWidth,
      height: trimHeight,
    });
  }

  output.setTitle(request.book.title || 'Fusion Lab book');
  if (request.book.author) output.setAuthor(request.book.author);
  output.setCreator('Fusion Lab Studio / DesignCraft KDP adapter');
  output.setProducer('Fusion Lab Studio');

  if (hasBleed) {
    notesUk.push(
      'DesignCraft KDP: додано геометрію bleed 0.125″ на зовнішньому, верхньому й нижньому краях. ' +
      'Фонове зображення має вже доходити до краю trim у DesignCraft-макеті, щоб фізично заповнити bleed.'
    );
  }

  return { bytes: new Uint8Array(await output.save()), notesUk };
}

export const designcraftKdpEngine: PdfEngine = {
  ...designcraftEngineV3,
  id: 'designcraft',
  label: 'DesignCraft',
  strengthUk:
    'Професійна книжкова верстка з нативним reflow, автоматичним змістом, ілюстраціями, темами та окремим KDP print-режимом.',
  limitUk:
    'KDP print використовує фінальний DesignCraft layout як source of truth; PDF/X-4 preflight та спеціалізовані друкарські мітки ще не є частиною цього адаптера.',
  supportsPrint: true,

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    if (!request.print) {
      return designcraftEngineV3.render(request);
    }

    const spec = specOf(request.spec);
    try {
      const digital = await designcraftEngineV3.render({
        ...request,
        print: false,
      });
      const imposed = await imposeForKdp(digital.bytes, request, spec);
      const gutterMm = ptToMm(spec.margins.left);
      const trimId = request.trimId || 'custom';

      return {
        ...digital,
        bytes: imposed.bytes,
        engineId: 'designcraft',
        printInfo: {
          trimId,
          gutterMm,
          passes: 1,
          designerNoteUk:
            'KDP PDF побудовано з фінального DesignCraft layout без повторної пагінації; парні сторінки отримали дзеркальне положення текстового блока.',
          warningsUk: imposed.notesUk,
        },
        honoredSpec: true,
        notesUk: [
          ...digital.notesUk,
          'DesignCraft KDP: застосовано друкарське дзеркалення inside/outside без зміни кількості сторінок або CanonicalPageMap.',
          ...imposed.notesUk,
        ],
      };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('designcraft', 'engine', `DesignCraft KDP: ${(err as Error).message}`);
    }
  },
};
