import { bookToMarkdown, type MarkdownImage } from '../bookToMarkdown';
import type { PdfBookInput, PdfLayoutSpec } from '../pdfTypes';
import { getBookDesignTheme } from './themes';

/**
 * DesignCraft interchange manuscript.  The historical property name `rtf`
 * is kept to avoid churn in the engine, but its contents are DesignCraft
 * Tagged Text: unlike the current RTF importer, Tagged Text preserves
 * paragraph style names, which are required for TOC/running headers.
 */
export interface DesigncraftManuscript {
  rtf: string;
  images: MarkdownImage[];
  unresolvedMarkers: string[];
}

export const IMAGE_BEGIN = (placeholder: string) => `[[FLIMG:${placeholder}:BEGIN]]`;
export const IMAGE_END = (placeholder: string) => `[[FLIMG:${placeholder}:END]]`;

const IMAGE_RESERVE_LINES = 28;

/** Tagged Text writes non-ASCII as UTF-16 code units `<0xNNNN>`. */
export function rtfText(value: string): string {
  let out = '';
  for (const ch of String(value || '')) {
    if (ch === '<' || ch === '>' || ch === '\\') {
      out += `\\${ch}`;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    const units: number[] = [];
    if (code <= 0xffff) units.push(code);
    else {
      const n = code - 0x10000;
      units.push(0xd800 + (n >> 10), 0xdc00 + (n & 0x3ff));
    }
    out += units.map((u) => `<0x${u.toString(16).toUpperCase().padStart(4, '0')}>`).join('');
  }
  return out;
}

/**
 * Convert the small inline-Markdown subset produced by the Studio editor to
 * DesignCraft Tagged Text instead of flattening it.  Unknown constructs stay
 * readable as text; links keep their label and images keep their alt text.
 */
function taggedInline(markdown: string, fontFamily: string, baseTypeface = ''): string {
  const input = String(markdown || '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+[.)]\s+/gm, '');
  const token = /!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\([^)]*\)|\*\*([^*]+)\*\*|__([^_]+)__|(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)|`([^`]+)`|\\([\\`*_[\]{}()#+\-.!])/g;
  const restore = `<cTypeface:${baseTypeface}>`;
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(input))) {
    out += rtfText(input.slice(cursor, match.index));
    if (match[1] !== undefined) out += rtfText(match[1]);
    else if (match[2] !== undefined) out += rtfText(match[2]);
    else if (match[3] !== undefined || match[4] !== undefined) {
      out += `<cTypeface:Bold>${rtfText(match[3] ?? match[4] ?? '')}${restore}`;
    } else if (match[5] !== undefined || match[6] !== undefined) {
      out += `<cTypeface:Italic>${rtfText(match[5] ?? match[6] ?? '')}${restore}`;
    } else if (match[7] !== undefined) {
      out += `<cFont:DejaVu Sans>${rtfText(match[7])}<cFont:${fontFamily}>${restore}`;
    } else if (match[8] !== undefined) out += rtfText(match[8]);
    cursor = token.lastIndex;
  }
  out += rtfText(input.slice(cursor));
  return out.trim();
}

function paragraph(style: string, text: string, local = '', tagged = false): string {
  const reset = local
    ? '<cFont:><cTypeface:><cSize:>'
    : '';
  return `<ParaStyle:${style}>${local}${tagged ? text : rtfText(text)}${reset}`;
}

function imagePlaceholder(placeholder: string): string[] {
  return [
    paragraph('Body', IMAGE_BEGIN(placeholder)),
    ...Array.from({ length: IMAGE_RESERVE_LINES }, () => paragraph('Body', '.')),
    paragraph('Body', IMAGE_END(placeholder)),
  ];
}

/**
 * Build Tagged Text from the same normalized Markdown used by the other
 * external engines. `Heading 1` / `Heading 2` survive import by name, so
 * DesignCraft can generate and later update its own table of contents.
 *
 * `themeId` is intentionally read as an optional extension of PdfLayoutSpec.
 * This keeps books that do not opt into Book Design Studio byte-compatible
 * with the previous path while the shared public type is introduced in the
 * next integration slice.
 */
export function buildDesigncraftRtf(
  book: PdfBookInput,
  spec: Partial<PdfLayoutSpec> = {}
): DesigncraftManuscript {
  const doc = bookToMarkdown(book as never, { withImages: true, frontmatter: false });
  const themeId = (spec as Partial<PdfLayoutSpec> & { themeId?: unknown }).themeId;
  const theme = getBookDesignTheme(themeId);
  const bodyPtBase = Number(spec.baseFontSize) > 0 ? Number(spec.baseFontSize) : 11;
  const h1PtBase = Number(spec.chapterTitle?.fontSize) > 0 ? Number(spec.chapterTitle?.fontSize) : Math.max(18, bodyPtBase * 1.8);
  const h2PtBase = Number(spec.sectionTitle?.fontSize) > 0 ? Number(spec.sectionTitle?.fontSize) : Math.max(13, bodyPtBase * 1.18);
  const bodyPt = Math.max(8, bodyPtBase + (theme?.bodySizeDelta || 0));
  const h1Pt = Math.max(12, h1PtBase + (theme?.chapterSizeDelta || 0));
  const h2Pt = Math.max(10, h2PtBase + (theme?.sectionSizeDelta || 0));
  const bodyFont = theme?.bodyFont || 'DejaVu Serif';
  const headingFont = theme?.headingFont || 'DejaVu Serif';

  const lines: string[] = ['<ASCII-WIN>', '<Version:7>'];
  const imageRe = /^!\[[^\]]*\]\((nova-image-\d+)\)$/;
  const blocks = doc.markdown.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let chapterSeen = false;

  for (const block of blocks) {
    const image = imageRe.exec(block);
    if (image) {
      lines.push(...imagePlaceholder(image[1]));
      continue;
    }

    if (block.startsWith('# ')) {
      if (chapterSeen && spec.chapterStartsNewPage !== false) {
        // U+E004 is DesignCraft's PAGE_BREAK marker.
        lines.push(paragraph('Body', '\uE004'));
      }
      chapterSeen = true;
      lines.push(
        paragraph(
          'Heading 1',
          taggedInline(block.slice(2), headingFont, 'Bold'),
          `<cFont:${headingFont}><cTypeface:Bold><cSize:${h1Pt}>`,
          true
        )
      );
      continue;
    }

    if (block.startsWith('## ')) {
      lines.push(
        paragraph(
          'Heading 2',
          taggedInline(block.slice(3), headingFont, 'Bold'),
          `<cFont:${headingFont}><cTypeface:Bold><cSize:${h2Pt}>`,
          true
        )
      );
      continue;
    }

    for (const line of block.split('\n').map((v) => v.trim()).filter(Boolean)) {
      lines.push(
        paragraph(
          'Body',
          taggedInline(line, bodyFont),
          `<cFont:${bodyFont}><cSize:${bodyPt}>`,
          true
        )
      );
    }
  }

  if (!blocks.length) lines.push(paragraph('Body', ''));
  return {
    rtf: lines.join('\r\n') + '\r\n',
    images: doc.images,
    unresolvedMarkers: doc.unresolvedMarkers,
  };
}
