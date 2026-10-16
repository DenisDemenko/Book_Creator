import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib';
import type { CanonicalPageMap, CanonicalPageLandmark } from '../../../shared/canonicalPageMap';
import type { PdfBookInput } from '../pdfTypes';

const LANDMARK_ORIGIN = 'https://bookcreator.invalid/__pdf_landmark__/';
const MARKER_PREFIX = 'BCPDFLM_';

export interface ChromiumLandmarkExpectation {
  marker: string;
  uri: string;
  kind: 'chapter' | 'section';
  id: string;
  title: string;
  chapterId?: string;
}

export interface PreparedChromiumLandmarks {
  book: PdfBookInput;
  expected: ChromiumLandmarkExpectation[];
}

function stableChapterId(chapter: PdfBookInput['chapters'][number], chapterIndex: number): string {
  return chapter.id || `chapter-${chapterIndex + 1}`;
}

function stableSectionId(
  section: PdfBookInput['chapters'][number]['sections'][number],
  chapterIndex: number,
  sectionIndex: number,
): string {
  return section.id || `section-${chapterIndex + 1}-${sectionIndex + 1}`;
}

function landmarkUri(kind: 'chapter' | 'section', id: string): string {
  return `${LANDMARK_ORIGIN}${kind}/${encodeURIComponent(id)}`;
}

/**
 * Prefix structural source titles with renderer-only markers.
 *
 * The Book object is cloned; source data is never mutated. Untitled sections
 * are intentionally skipped because bookToMarkdown does not emit a heading for
 * them, so claiming an exact coordinate would be a guess.
 */
export function prepareChromiumLandmarks(book: PdfBookInput): PreparedChromiumLandmarks {
  const expected: ChromiumLandmarkExpectation[] = [];
  let markerIndex = 0;

  const chapters = book.chapters.map((chapter, chapterIndex) => {
    const chapterId = stableChapterId(chapter, chapterIndex);
    const chapterMarker = `${MARKER_PREFIX}${markerIndex++}__`;
    expected.push({
      marker: chapterMarker,
      uri: landmarkUri('chapter', chapterId),
      kind: 'chapter',
      id: chapterId,
      chapterId,
      title: chapter.title,
    });

    const sections = chapter.sections.map((section, sectionIndex) => {
      if (!section.title) return { ...section };
      const sectionId = stableSectionId(section, chapterIndex, sectionIndex);
      const sectionMarker = `${MARKER_PREFIX}${markerIndex++}__`;
      expected.push({
        marker: sectionMarker,
        uri: landmarkUri('section', sectionId),
        kind: 'section',
        id: sectionId,
        chapterId,
        title: section.title,
      });
      return { ...section, title: `${sectionMarker}${section.title}` };
    });

    return {
      ...chapter,
      title: `${chapterMarker}${chapter.title}`,
      sections,
    };
  });

  return { book: { ...book, chapters }, expected };
}

/**
 * Turn renderer-only title markers into tiny invisible external links.
 * Chromium preserves external links as PDF annotations. The link occupies a
 * real 1px box (so Chromium cannot optimize it away) but cancels its width with
 * a negative margin, therefore the visible title and pagination do not change.
 */
export function injectChromiumLandmarkLinks(
  html: string,
  expected: ChromiumLandmarkExpectation[],
): string {
  let out = html;
  for (const landmark of expected) {
    const anchor =
      `<a href="${landmark.uri}" aria-hidden="true" ` +
      'style="display:inline-block;width:1px;height:1em;margin-right:-1px;' +
      'overflow:hidden;opacity:0;font-size:1px;line-height:1px;text-decoration:none">.</a>';
    out = out.split(landmark.marker).join(anchor);
  }
  return out;
}

function decodedPdfString(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return null;
}

/** Read URI link annotations from the FINAL PDF and return uri -> physical page index. */
export async function extractChromiumLandmarkPages(
  bytes: Uint8Array,
): Promise<Map<string, number>> {
  const pdf = await PDFDocument.load(bytes);
  const found = new Map<string, number>();
  const annotsName = PDFName.of('Annots');
  const actionName = PDFName.of('A');
  const uriName = PDFName.of('URI');

  pdf.getPages().forEach((page, pageIndex) => {
    const annotsRaw = page.node.get(annotsName);
    if (!annotsRaw) return;
    const annots = pdf.context.lookup(annotsRaw);
    if (!(annots instanceof PDFArray)) return;

    for (let index = 0; index < annots.size(); index += 1) {
      const annot = pdf.context.lookup(annots.get(index));
      if (!(annot instanceof PDFDict)) continue;
      const actionRaw = annot.get(actionName);
      if (!actionRaw) continue;
      const action = pdf.context.lookup(actionRaw);
      if (!(action instanceof PDFDict)) continue;
      const uriRaw = action.get(uriName);
      if (!uriRaw) continue;
      const uri = decodedPdfString(pdf.context.lookup(uriRaw));
      if (uri?.startsWith(LANDMARK_ORIGIN)) found.set(uri, pageIndex);
    }
  });

  return found;
}

/**
 * Build an exact CanonicalPageMap only when every expected structural marker
 * survived into the final PDF. Any missing marker returns null; the registry
 * then honestly falls back to page-count-only instead of inventing positions.
 */
export async function buildChromiumCanonicalPageMap(input: {
  bytes: Uint8Array;
  pageCount: number;
  expected: ChromiumLandmarkExpectation[];
}): Promise<CanonicalPageMap | null> {
  if (input.expected.length === 0) return null;

  const found = await extractChromiumLandmarkPages(input.bytes);
  if (input.expected.some((item) => !found.has(item.uri))) return null;

  const landmarks: CanonicalPageLandmark[] = input.expected.map((item) => {
    const filePageIndex = found.get(item.uri)!;
    return {
      kind: item.kind,
      id: item.id,
      title: item.title,
      chapterId: item.chapterId,
      filePageIndex,
      filePageNumber: filePageIndex + 1,
      // Chromium's footer currently prints the physical page number on every page.
      displayPageNumber: filePageIndex + 1,
    };
  });

  const firstChapter = landmarks.find((item) => item.kind === 'chapter');
  if (!firstChapter) return null;

  return {
    version: 1,
    source: 'chromium-pdf',
    engineId: 'chromium',
    precision: 'exact',
    pageCount: Math.max(0, Math.round(Number(input.pageCount) || 0)),
    bodyStartPageIndex: firstChapter.filePageIndex,
    landmarks,
  };
}
