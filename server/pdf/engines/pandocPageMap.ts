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

const LANDMARK_ORIGIN = 'https://bookcreator.invalid/__pandoc_landmark__/';
const MARKER_PREFIX = 'BCPANDOC_';
const HAIR_SPACE = '\u200a';

export interface PandocLandmarkExpectation {
  marker: string;
  uri: string;
  kind: 'chapter' | 'section';
  id: string;
  title: string;
  chapterId?: string;
}

export interface PreparedPandocLandmarks {
  book: PdfBookInput;
  expected: PandocLandmarkExpectation[];
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

/** Clone the structural titles and add renderer-only markers. */
export function preparePandocLandmarks(book: PdfBookInput): PreparedPandocLandmarks {
  const expected: PandocLandmarkExpectation[] = [];
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
 * Replace title markers with a normal Markdown hyperlink whose text is only a
 * hair-space. Pandoc/XeLaTeX emits it as a PDF URI annotation on the same page
 * as the heading. The technical marker itself never appears in visible text.
 */
export function injectPandocLandmarkLinks(
  markdown: string,
  expected: PandocLandmarkExpectation[],
): string {
  let out = markdown;
  for (const landmark of expected) {
    out = out.split(landmark.marker).join(`[${HAIR_SPACE}](${landmark.uri})`);
  }
  return out;
}

function decodedPdfString(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}

export async function extractPandocLandmarkPages(bytes: Uint8Array): Promise<Map<string, number>> {
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

/** Exact means exact physical PDF pages; TeX's printed folio may differ, so it stays null. */
export async function buildPandocCanonicalPageMap(input: {
  bytes: Uint8Array;
  pageCount: number;
  expected: PandocLandmarkExpectation[];
}): Promise<CanonicalPageMap | null> {
  if (input.expected.length === 0) return null;
  const found = await extractPandocLandmarkPages(input.bytes);
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
      displayPageNumber: null,
    };
  });

  const firstChapter = landmarks.find((item) => item.kind === 'chapter');
  if (!firstChapter) return null;

  return {
    version: 1,
    source: 'pandoc-pdf',
    engineId: 'pandoc',
    precision: 'exact',
    pageCount: Math.max(0, Math.round(Number(input.pageCount) || 0)),
    bodyStartPageIndex: firstChapter.filePageIndex,
    landmarks,
    noteUk: 'Фізичні сторінки точні; друкований номер сторінки TeX не виводиться з URI-анотацій, тому displayPageNumber лишається null.',
  };
}
