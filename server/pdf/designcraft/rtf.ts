import { bookToMarkdown, type MarkdownImage } from '../bookToMarkdown';
import type { PdfBookInput, PdfLayoutSpec } from '../pdfTypes';

/**
 * Interchange package handed to DesignCraft.  Studio remains canonical;
 * this RTF exists only inside one render job.
 */
export interface DesigncraftManuscript {
  rtf: string;
  images: MarkdownImage[];
  unresolvedMarkers: string[];
}

export const IMAGE_BEGIN = (placeholder: string) => `[[FLIMG:${placeholder}:BEGIN]]`;
export const IMAGE_END = (placeholder: string) => `[[FLIMG:${placeholder}:END]]`;

/** Reserve enough vertical space before real anchored images are inserted. */
const IMAGE_RESERVE_LINES = 28;

/** Escape Unicode as RTF \uN? UTF-16 code units. */
export function rtfText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const ch = value[i];
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\t') out += '\\tab ';
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else {
      const signed = code > 0x7fff ? code - 0x10000 : code;
      out += `\\u${signed}?`;
    }
  }
  return out;
}

function hp(pt: number | undefined, fallback: number): number {
  const n = Number(pt);
  return Math.max(12, Math.round((Number.isFinite(n) && n > 0 ? n : fallback) * 2));
}

function twips(pt: number): number {
  return Math.round(pt * 20);
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

function imagePlaceholderRtf(placeholder: string): string {
  const begin = rtfText(IMAGE_BEGIN(placeholder));
  const end = rtfText(IMAGE_END(placeholder));
  const reserve = Array.from({ length: IMAGE_RESERVE_LINES }, () => '\\pard\\s0 .\\par\n').join('');
  return `\\pard\\s0 ${begin}\\par\n${reserve}\\pard\\s0 ${end}\\par\n`;
}

/**
 * Convert the same normalized Markdown used by Chromium/Pandoc into RTF.
 * This keeps chapter/section semantics aligned across PDF engines and keeps
 * image positions recorded by Studio's [IMG: …] markers.
 */
export function buildDesigncraftRtf(
  book: PdfBookInput,
  spec: Partial<PdfLayoutSpec> = {}
): DesigncraftManuscript {
  const doc = bookToMarkdown(book as never, { withImages: true, frontmatter: false });

  const bodyPt = Number(spec.baseFontSize) > 0 ? Number(spec.baseFontSize) : 11;
  const lineHeight = Number(spec.lineHeight) > 0 ? Number(spec.lineHeight) : 1.45;
  const indentPt = Number(spec.paragraphIndent) >= 0 ? Number(spec.paragraphIndent) : 16;
  const spacingPt = Number(spec.paragraphSpacing) >= 0 ? Number(spec.paragraphSpacing) : 0;
  const bodyAlign = spec.bodyAlign === 'left' ? '\\ql' : '\\qj';
  const bodyFs = hp(bodyPt, 11);
  const heading1Fs = hp(spec.chapterTitle?.fontSize, Math.max(18, bodyPt * 1.8));
  const heading2Fs = hp(spec.sectionTitle?.fontSize, Math.max(13, bodyPt * 1.18));
  const lineTwips = Math.max(twips(bodyPt * lineHeight), twips(bodyPt));

  const out: string[] = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1',
    '{\\fonttbl{\\f0 DejaVu Serif;}}',
    `{\\stylesheet` +
      `{\\s0\\f0\\fs${bodyFs}${bodyAlign}\\sl${lineTwips}\\slmult1\\fi${twips(indentPt)}\\sa${twips(spacingPt)} Normal;}` +
      `{\\s1\\sbasedon0\\snext0\\keepn\\f0\\b\\fs${heading1Fs}\\ql\\sb480\\sa300 Heading 1;}` +
      `{\\s2\\sbasedon0\\snext0\\keepn\\f0\\b\\fs${heading2Fs}\\ql\\sb300\\sa160 Heading 2;}` +
    '}',
  ];

  const imageRe = /^!\[[^\]]*\]\((nova-image-\d+)\)$/;
  const blocks = doc.markdown.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let chapterSeen = false;

  for (const block of blocks) {
    const image = imageRe.exec(block);
    if (image) {
      out.push(imagePlaceholderRtf(image[1]));
      continue;
    }

    if (block.startsWith('# ')) {
      if (chapterSeen) out.push('\\page ');
      chapterSeen = true;
      out.push(`\\pard\\s1 ${rtfText(plainInline(block.slice(2)))}\\par\n`);
      continue;
    }
    if (block.startsWith('## ')) {
      out.push(`\\pard\\s2 ${rtfText(plainInline(block.slice(3)))}\\par\n`);
      continue;
    }

    const lines = block.split('\n').map((line) => plainInline(line)).filter(Boolean);
    for (const line of lines) out.push(`\\pard\\s0 ${rtfText(line)}\\par\n`);
  }

  if (!blocks.length) out.push('\\pard\\s0 \\par\n');
  out.push('}');

  return {
    rtf: out.join(''),
    images: doc.images,
    unresolvedMarkers: doc.unresolvedMarkers,
  };
}
