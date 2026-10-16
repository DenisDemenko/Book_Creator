/**
 * Рушій верстки PDF. Єдиний на обидва варіанти (макет від коду й макет від
 * моделі) — див. коментар у pdfTypes.ts.
 *
 * ЩО ТУТ ДОВОДИТЬСЯ РОБИТИ РУКАМИ І ЧОМУ. `pdf-lib` — не рушій верстки, а
 * бібліотека для складання PDF: вона вміє покласти рядок у координату й
 * порахувати його ширину, і на цьому все. Тому перенос слів, вирівнювання
 * по ширині, розриви сторінок і колонтитули написані тут явно. Це не
 * винахід велосипеда: браузерного рушія на Railway немає, а тягнути
 * headless Chromium заради PDF — це +300 МБ образу.
 *
 * Кирилиця: стандартні шрифти PDF покривають лише латиницю (WinAnsi), тож
 * шрифт вбудовується з файлу через fontkit. Файли лежать поруч, у fonts/,
 * разом із ліцензією — DejaVu вільний, зміни в ньому в суспільному надбанні.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAYOUT_SPEC,
  PAGE_SIZES,
  type Align,
  type FontChoice,
  type HeadingStyle,
  type PdfBookInput,
  type PdfLayoutSpec,
} from './pdfTypes';
import { loadImageBytes } from '../media/imageBytes';
import { collectImageMarkerIds, splitImageMarkers } from '../../src/utils/imageMarkers';
import { hasTableMarkers, replaceTableBlocks } from '../../src/utils/tableMarkers';
import { entityTagRegexp, removeFormattedEntityTags } from '../../src/utils/coreEntities';
import {
  buildCanonicalPdfPageMap,
  type CanonicalPageMap,
} from '../../shared/canonicalPageMap';

export const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');

export const FONT_FILES = {
  serif: 'DejaVuSerif.ttf',
  serifBold: 'DejaVuSerif-Bold.ttf',
  sansBold: 'DejaVuSans-Bold.ttf',
} as const;

export function fontsAvailable(): boolean {
  return Object.values(FONT_FILES).every((f) => fs.existsSync(path.join(FONT_DIR, f)));
}

function flattenTableMarkersToPlainText(content: string): string {
  if (!hasTableMarkers(content)) return content;
  return replaceTableBlocks(content, (table) => {
    const rows = table.rows
      .map((row) => row.cells.map((c) => c.text.trim()).join('  |  ').trim())
      .filter((line) => line.length > 0);
    return rows.length ? `\n\n${rows.join('\n\n')}\n\n` : '';
  });
}

export function toParagraphs(content: string): string[] {
  const plain = flattenTableMarkersToPlainText(removeFormattedEntityTags(String(content ?? '')))
    .replace(entityTagRegexp(), '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n?/g, '\n');
  return plain
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

interface Measurable {
  widthOfTextAtSize(text: string, size: number): number;
}

export function wrapText(
  text: string,
  font: Measurable,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  const pushLongWord = (word: string) => {
    let chunk = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      pushLongWord(word);
    } else {
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface RenderResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Exact coordinates from the same final PDF render. */
  pageMap: CanonicalPageMap;
  /** Скільки сторінок пронумеровано — для звіту в інтерфейсі. */
  numberedPages: number;
  notesUk: string[];
}

export interface RenderContext {
  ownerId?: string | null;
  imageCache?: Map<string, { mimeType: string; bytes: Buffer }>;
}

async function loadImageCached(
  url: string,
  ownerId: string | null | undefined,
  cache?: Map<string, { mimeType: string; bytes: Buffer }>
): Promise<{ mimeType: string; bytes: Buffer }> {
  if (cache?.has(url)) return cache.get(url)!;
  const result = await loadImageBytes(url, ownerId);
  cache?.set(url, result);
  return result;
}

export async function renderBookPdf(
  book: PdfBookInput,
  specInput?: Partial<PdfLayoutSpec>,
  context?: RenderContext
): Promise<RenderResult> {
  if (!fontsAvailable()) {
    throw new Error(
      `Шрифти для PDF не знайдено в ${FONT_DIR}. Без вбудованого шрифту кирилиця в PDF неможлива.`
    );
  }

  const spec: PdfLayoutSpec = { ...DEFAULT_LAYOUT_SPEC, ...specInput } as PdfLayoutSpec;
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(book.title);
  if (book.author) doc.setAuthor(book.author);
  doc.setProducer('NOVA STUDIO');

  const serif = await doc.embedFont(fs.readFileSync(path.join(FONT_DIR, FONT_FILES.serif)), {
    subset: true,
  });
  const serifBold = await doc.embedFont(
    fs.readFileSync(path.join(FONT_DIR, FONT_FILES.serifBold)),
    { subset: true }
  );
  const sansBold = await doc.embedFont(fs.readFileSync(path.join(FONT_DIR, FONT_FILES.sansBold)), {
    subset: true,
  });

  const pick = (choice: FontChoice, bold: boolean) =>
    bold ? (choice === 'sans' ? sansBold : serifBold) : serif;

  const size =
    spec.pageWidthPt && spec.pageHeightPt
      ? { width: spec.pageWidthPt, height: spec.pageHeightPt }
      : PAGE_SIZES[spec.pageSize] || PAGE_SIZES.A5;
  const contentWidth = size.width - spec.margins.left - spec.margins.right;
  const contentHeight = size.height - spec.margins.top - spec.margins.bottom;
  const black = rgb(0.1, 0.09, 0.08);
  const grey = rgb(0.45, 0.43, 0.4);
  const ownerId = context?.ownerId ?? null;
  const notesUk: string[] = [];

  const leftOfPage = (index: number) =>
    spec.mirrorMargins && index % 2 === 1 ? spec.margins.right : spec.margins.left;

  let page = doc.addPage([size.width, size.height]);
  let pageIndex = 0;
  let curLeft = leftOfPage(0);
  let y = size.height - spec.margins.top;
  let bodyStarted = false;
  let currentChapter = '';
  let bodyStartPage = spec.titlePage.show ? 1 : 0;
  let insertedTocPages = 0;

  const chapterStarts: Array<{
    id?: string;
    title: string;
    pageIndex: number;
    sections: Array<{ id?: string; title: string; pageIndex: number }>;
  }> = [];

  const newPage = () => {
    page = doc.addPage([size.width, size.height]);
    pageIndex += 1;
    curLeft = leftOfPage(pageIndex);
    y = size.height - spec.margins.top;
  };

  const ensure = (needed: number) => {
    if (y - needed < spec.margins.bottom) newPage();
  };

  const drawLine = (
    text: string,
    font: typeof serif,
    fontSize: number,
    align: Align,
    color = black,
    justifyWidth?: number,
    x0 = curLeft,
    boxWidth = contentWidth
  ) => {
    const width = font.widthOfTextAtSize(text, fontSize);
    let x = x0;
    if (align === 'center') x = x0 + (boxWidth - width) / 2;
    if (align === 'justify' && justifyWidth && justifyWidth > width) {
      const words = text.split(' ');
      if (words.length > 1) {
        const extra = (justifyWidth - width) / (words.length - 1);
        let cursor = x;
        for (const word of words) {
          page.drawText(word, { x: cursor, y, size: fontSize, font, color });
          cursor += font.widthOfTextAtSize(word, fontSize) + font.widthOfTextAtSize(' ', fontSize) + extra;
        }
        return;
      }
    }
    page.drawText(text, { x, y, size: fontSize, font, color });
  };

  const drawParagraph = (text: string, indentFirst: boolean) => {
    const font = pick(spec.bodyFont, false);
    const step = spec.baseFontSize * spec.lineHeight;
    const indent = indentFirst ? spec.paragraphIndent : 0;
    const firstWidth = contentWidth - indent;
    const firstLines = wrapText(text, font, spec.baseFontSize, firstWidth);
    if (firstLines.length === 0) return;
    const rest = firstLines.slice(1).join(' ');
    const restLines = rest ? wrapText(rest, font, spec.baseFontSize, contentWidth) : [];
    const lines = [firstLines[0], ...restLines];

    lines.forEach((line, i) => {
      ensure(step);
      const isLast = i === lines.length - 1;
      const x = i === 0 ? curLeft + indent : curLeft;
      const width = i === 0 ? firstWidth : contentWidth;
      const align: Align = spec.bodyAlign === 'justify' && !isLast ? 'justify' : 'left';
      drawLine(line, font, spec.baseFontSize, align, black, width, x, width);
      y -= step;
    });
    y -= spec.paragraphSpacing;
  };

  const drawIllustration = async (ill: { url: string; caption?: string }) => {
    const captionText = String(ill.caption || '').trim();
    const label = captionText || ill.url;
    let embedded: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
    let failureUk = '';
    let headBytes = '';

    try {
      const { mimeType, bytes } = await loadImageCached(ill.url, ownerId, context?.imageCache);
      headBytes = [...bytes.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      if (/png/i.test(mimeType)) embedded = await doc.embedPng(bytes);
      else if (/jpe?g/i.test(mimeType)) embedded = await doc.embedJpg(bytes);
      else {
        failureUk =
          `формат ${mimeType} не підтримується власною версткою (лише PNG і JPEG) — ` +
          'зверстайте книгу рушієм «Chromium» або «pandoc + Eisvogel»';
      }
    } catch (err) {
      failureUk = err instanceof Error ? err.message : String(err);
    }

    if (!embedded) {
      notesUk.push(
        `Ілюстрація «${label}» не вставлена: ${failureUk}.` +
          (headBytes ? ` Початок файлу: ${headBytes}.` : '')
      );
      if (captionText) {
        ensure(spec.baseFontSize * spec.lineHeight + spec.paragraphSpacing);
        drawLine(`Ілюстрація: ${captionText}`, serif, spec.baseFontSize, 'center', grey);
        y -= spec.baseFontSize * spec.lineHeight + spec.paragraphSpacing;
      }
      return;
    }

    const dims = embedded.size();
    const maxHeight = contentHeight * 0.6;
    const scale = Math.min(contentWidth / dims.width, maxHeight / dims.height, 1);
    const w = dims.width * scale;
    const h = dims.height * scale;
    const captionSize = Math.max(7, Math.round(spec.baseFontSize * 0.85));
    const captionLines = captionText ? wrapText(captionText, serif, captionSize, contentWidth) : [];
    const captionStep = captionSize * 1.3;
    const gap = 8;
    const needed = h + gap + captionLines.length * captionStep + spec.paragraphSpacing;
    ensure(needed);

    const x = curLeft + (contentWidth - w) / 2;
    page.drawImage(embedded, { x, y: y - h, width: w, height: h });
    y -= h + gap;
    for (const line of captionLines) {
      drawLine(line, serif, captionSize, 'center', grey);
      y -= captionStep;
    }
    y -= spec.paragraphSpacing;
  };

  const drawMarkerImage = async (marker: { id: string; caption: string }): Promise<void> => {
    const target = book.markerImages?.[marker.id];
    if (!target) {
      notesUk.push(
        `Картинка «${marker.id}» з маркера не вставлена: у книзі немає ілюстрації з таким id — ` +
          'схоже, її прибрали з галереї, а посилання в тексті лишилось.'
      );
      return;
    }
    await drawIllustration({ url: target.url, caption: marker.caption || target.caption || '' });
  };

  const drawParagraphWithImages = async (paragraph: string, indentFirst: boolean): Promise<void> => {
    const segments = splitImageMarkers(paragraph);
    let first = indentFirst;
    for (const segment of segments) {
      if (segment.kind === 'text') drawParagraph(segment.text.replace(/\s+/g, ' ').trim(), first);
      else await drawMarkerImage(segment.marker);
      first = false;
    }
  };

  const WIDOW_LINES = 2;
  const drawHeading = (text: string, style: HeadingStyle) => {
    const font = pick(style.font, true);
    const label = style.uppercase ? text.toUpperCase() : text;
    const step = style.fontSize * 1.25;
    const lines = wrapText(label, font, style.fontSize, contentWidth);
    const needed =
      style.spaceBefore +
      lines.length * step +
      style.spaceAfter +
      WIDOW_LINES * spec.baseFontSize * spec.lineHeight;
    if (y - needed < spec.margins.bottom) newPage();
    y -= style.spaceBefore;
    for (const line of lines) {
      ensure(step);
      drawLine(line, font, style.fontSize, style.align === 'justify' ? 'left' : style.align);
      y -= step;
    }
    y -= style.spaceAfter;
  };

  if (spec.titlePage.show) {
    const titleFont = pick('serif', true);
    const centerY = size.height * 0.62;
    y = centerY;
    for (const line of wrapText(book.title, titleFont, spec.titlePage.titleSize, contentWidth)) {
      drawLine(line, titleFont, spec.titlePage.titleSize, 'center');
      y -= spec.titlePage.titleSize * 1.3;
    }
    if (book.subtitle) {
      y -= 10;
      for (const line of wrapText(book.subtitle, serif, spec.titlePage.subtitleSize, contentWidth)) {
        drawLine(line, serif, spec.titlePage.subtitleSize, 'center', grey);
        y -= spec.titlePage.subtitleSize * 1.35;
      }
    }
    if (book.author) {
      y = spec.margins.bottom + 60;
      drawLine(book.author, serif, spec.titlePage.authorSize, 'center', grey);
    }
    newPage();
  }

  const frontMatter = book.frontMatter;
  const showFront = frontMatter?.show ?? {};
  const drawFrontBlock = (
    lines: string[],
    align: 'left' | 'center',
    startY: number,
    width = contentWidth
  ) => {
    y = startY;
    const x0 = curLeft + (contentWidth - width) / 2;
    for (const line of lines) {
      ensure(spec.frontMatter.fontSize * 1.6);
      drawLine(line, serif, spec.frontMatter.fontSize, align, black, undefined, x0, width);
      y -= spec.frontMatter.fontSize * 1.6;
    }
  };

  if (showFront.copyright && frontMatter?.copyrightText?.trim()) {
    drawFrontBlock(
      wrapText(frontMatter.copyrightText.trim(), serif, spec.frontMatter.fontSize, contentWidth),
      'left',
      spec.margins.bottom + contentHeight * 0.18
    );
    newPage();
  }
  if (showFront.dedication && frontMatter?.dedicationText?.trim()) {
    drawFrontBlock(
      wrapText(frontMatter.dedicationText.trim(), serif, spec.frontMatter.fontSize, contentWidth * 0.72),
      'center',
      size.height - spec.margins.top - contentHeight * spec.frontMatter.upperShare,
      contentWidth * 0.72
    );
    newPage();
  }
  if (showFront.epigraph && frontMatter?.epigraphText?.trim()) {
    const epigraphLines = wrapText(
      `«${frontMatter.epigraphText.trim()}»`,
      serif,
      spec.frontMatter.fontSize,
      contentWidth * 0.68
    );
    if (frontMatter.epigraphAuthor) epigraphLines.push(`— ${frontMatter.epigraphAuthor}`);
    drawFrontBlock(
      epigraphLines,
      'left',
      size.height - spec.margins.top - contentHeight * spec.frontMatter.upperShare,
      contentWidth * 0.68
    );
    newPage();
  }

  const markerIds = new Set<string>();
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      for (const id of collectImageMarkerIds(section.content)) markerIds.add(id);
    }
  }

  for (const chapter of book.chapters) {
    if (spec.chapterStartsNewPage && (bodyStarted || !spec.titlePage.show)) {
      if (bodyStarted) newPage();
    }
    const firstChapter = !bodyStarted;
    bodyStarted = true;
    currentChapter = chapter.title;
    drawHeading(chapter.title, spec.chapterTitle);
    if (firstChapter) bodyStartPage = pageIndex;
    chapterStarts.push({ id: chapter.id, title: chapter.title, pageIndex, sections: [] });

    for (const section of chapter.sections) {
      if (section.title) {
        drawHeading(section.title, spec.sectionTitle);
        chapterStarts[chapterStarts.length - 1].sections.push({ id: section.id, title: section.title, pageIndex });
      }
      const paragraphs = toParagraphs(section.content);
      for (let index = 0; index < paragraphs.length; index += 1) {
        await drawParagraphWithImages(paragraphs[index], spec.paragraphIndent > 0 && index > 0);
      }
    }

    for (const ill of book.illustrations || []) {
      if (!chapter.id || ill.chapterId !== chapter.id) continue;
      if (ill.id && markerIds.has(ill.id)) continue;
      await drawIllustration(ill);
    }
  }

  if (showFront.contents && chapterStarts.length) {
    const labelOf = (index: number) => {
      if (!spec.pageNumber.show) return '';
      const first = spec.pageNumber.skipFrontMatter ? bodyStartPage : 0;
      return String(spec.pageNumber.startAt + (index - first));
    };

    const rowStep = spec.frontMatter.fontSize * 1.7;
    const tocTitleBlock = spec.sectionTitle.fontSize * 2.4;
    const capacity = Math.max(1, Math.floor((contentHeight - tocTitleBlock) / rowStep));
    type TocLine = { text: string; number: string; indent: number; bold: boolean; leader: boolean };
    const tocLines: TocLine[] = [];
    const pushRow = (title: string, pageIndexOf: number, indent: number, bold: boolean) => {
      const font = bold ? pick(spec.chapterTitle.font, true) : serif;
      const number = labelOf(pageIndexOf);
      const numberWidth = number ? serif.widthOfTextAtSize(number, spec.frontMatter.fontSize) + 14 : 0;
      const wrapped = wrapText(
        title,
        font,
        spec.frontMatter.fontSize,
        Math.max(60, contentWidth - indent - numberWidth)
      );
      wrapped.forEach((text, i) =>
        tocLines.push({
          text,
          number: i === wrapped.length - 1 ? number : '',
          indent,
          bold,
          leader: wrapped.length === 1,
        })
      );
    };
    for (const chapter of chapterStarts) {
      pushRow(chapter.title, chapter.pageIndex, 0, true);
      if (spec.frontMatter.contentsSections) {
        for (const section of chapter.sections) pushRow(section.title, section.pageIndex, 18, false);
      }
    }

    const tocPageCount = Math.max(1, Math.ceil(tocLines.length / capacity));
    insertedTocPages = tocPageCount;
    const tocPages = [];
    for (let i = 0; i < tocPageCount; i += 1) {
      tocPages.push(doc.insertPage(bodyStartPage, [size.width, size.height]));
    }

    tocPages.forEach((tocPage, pageNo) => {
      const left = leftOfPage(bodyStartPage + pageNo);
      let ty = size.height - spec.margins.top;
      const headingFont = pick(spec.sectionTitle.font, true);
      const heading = pageNo === 0 ? spec.frontMatter.contentsTitle : `${spec.frontMatter.contentsTitle} ${pageNo + 1}`;
      tocPage.drawText(spec.sectionTitle.uppercase ? heading.toUpperCase() : heading, {
        x: left,
        y: ty,
        size: spec.sectionTitle.fontSize,
        font: headingFont,
        color: black,
      });
      ty -= tocTitleBlock;

      for (const line of tocLines.slice(pageNo * capacity, (pageNo + 1) * capacity)) {
        const font = line.bold ? pick(spec.chapterTitle.font, true) : serif;
        const x = left + line.indent;
        tocPage.drawText(line.text, { x, y: ty, size: spec.frontMatter.fontSize, font, color: black });
        if (line.number) {
          const numberWidth = serif.widthOfTextAtSize(line.number, spec.frontMatter.fontSize);
          tocPage.drawText(line.number, {
            x: left + contentWidth - numberWidth,
            y: ty,
            size: spec.frontMatter.fontSize,
            font: serif,
            color: black,
          });
          if (spec.frontMatter.contentsLeader && line.leader) {
            const used = font.widthOfTextAtSize(line.text, spec.frontMatter.fontSize);
            const dotWidth = serif.widthOfTextAtSize('.', spec.frontMatter.fontSize);
            const dots = Math.floor((contentWidth - line.indent - used - numberWidth - 8) / dotWidth);
            if (dots > 2) {
              tocPage.drawText('.'.repeat(dots), {
                x: x + used + 4,
                y: ty,
                size: spec.frontMatter.fontSize,
                font: serif,
                color: grey,
              });
            }
          }
        }
        ty -= rowStep;
      }
    });

    bodyStartPage += tocPageCount;
  }

  const pages = doc.getPages();
  let numbered = 0;
  pages.forEach((p, index) => {
    const isFront = spec.pageNumber.skipFrontMatter && index < bodyStartPage;
    if (spec.runningHead.show && !isFront) {
      const head =
        spec.runningHead.content === 'author'
          ? book.author || book.title
          : spec.runningHead.content === 'chapter'
            ? currentChapter || book.title
            : book.title;
      const w = serif.widthOfTextAtSize(head, spec.runningHead.fontSize);
      p.drawText(head, {
        x: (size.width - w) / 2,
        y: size.height - spec.margins.top / 2,
        size: spec.runningHead.fontSize,
        font: serif,
        color: grey,
      });
    }
    if (!spec.pageNumber.show || isFront) return;
    numbered += 1;
    const label = String(spec.pageNumber.startAt + numbered - 1);
    const w = serif.widthOfTextAtSize(label, spec.pageNumber.fontSize);
    const pos = spec.pageNumber.position;
    const pageLeft = leftOfPage(index);
    const pageRight = spec.margins.left + spec.margins.right - pageLeft;
    const x = pos.endsWith('left')
      ? pageLeft
      : pos.endsWith('right')
        ? size.width - pageRight - w
        : (size.width - w) / 2;
    const yy = pos.startsWith('top')
      ? size.height - spec.margins.top / 2
      : spec.margins.bottom / 2;
    p.drawText(label, { x, y: yy, size: spec.pageNumber.fontSize, font: serif, color: grey });
  });

  const pageMap = buildCanonicalPdfPageMap({
    chapters: chapterStarts,
    pageCount: pages.length,
    bodyStartPageIndex: bodyStartPage,
    insertedTocPages,
    pageNumber: {
      show: spec.pageNumber.show,
      startAt: spec.pageNumber.startAt,
      skipFrontMatter: spec.pageNumber.skipFrontMatter,
    },
    engineId: 'nova',
    source: 'nova-pdf',
  });

  return {
    bytes: await doc.save(),
    pageCount: pages.length,
    pageMap,
    numberedPages: numbered,
    notesUk,
  };
}
