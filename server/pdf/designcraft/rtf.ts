import { bookToMarkdown, type MarkdownImage } from '../bookToMarkdown';
import type { PdfBookInput, PdfLayoutSpec } from '../pdfTypes';

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

function plainInline(markdown: string): string {
  return String(markdown || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\([\\`*_[\]{}()#+\-.!])/g, '$1')
    .trim();
}

function paragraph(style: string, text: string, local = ''): string {
  const reset = local
    ? '<cFont:><cTypeface:><cSize:>'
    : '';
  return `<ParaStyle:${style}>${local}${rtfText(text)}${reset}`;
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
 */
export function buildDesigncraftRtf(
  book: PdfBookInput,
  spec: Partial<PdfLayoutSpec> = {}
): DesigncraftManuscript {
  const doc = bookToMarkdown(book as never, { withImages: true, frontmatter: false });
  const bodyPt = Number(spec.baseFontSize) > 0 ? Number(spec.baseFontSize) : 11;
  const h1Pt = Number(spec.chapterTitle?.fontSize) > 0 ? Number(spec.chapterTitle?.fontSize) : Math.max(18, bodyPt * 1.8);
  const h2Pt = Number(spec.sectionTitle?.fontSize) > 0 ? Number(spec.sectionTitle?.fontSize) : Math.max(13, bodyPt * 1.18);

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
          plainInline(block.slice(2)),
          `<cFont:DejaVu Serif><cTypeface:Bold><cSize:${h1Pt}>`
        )
      );
      continue;
    }

    if (block.startsWith('## ')) {
      lines.push(
        paragraph(
          'Heading 2',
          plainInline(block.slice(3)),
          `<cFont:DejaVu Serif><cTypeface:Bold><cSize:${h2Pt}>`
        )
      );
      continue;
    }

    for (const line of block.split('\n').map((v) => plainInline(v)).filter(Boolean)) {
      lines.push(paragraph('Body', line, `<cFont:DejaVu Serif><cSize:${bodyPt}>`));
    }
  }

  if (!blocks.length) lines.push(paragraph('Body', ''));
  return {
    rtf: lines.join('\r\n') + '\r\n',
    images: doc.images,
    unresolvedMarkers: doc.unresolvedMarkers,
  };
}
