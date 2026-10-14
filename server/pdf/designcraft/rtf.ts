import { bookToMarkdown, type MarkdownImage } from '../bookToMarkdown';
import type { PdfBookInput, PdfLayoutSpec } from '../pdfTypes';
import {
  getBookDesignTheme,
  type BookDesignTheme,
  type SemanticParagraphStyle,
  type SemanticStyleRule,
} from './themes';

/**
 * DesignCraft interchange manuscript. The historical property name `rtf`
 * is kept to avoid churn in the engine, but its contents are DesignCraft
 * Tagged Text: unlike the current RTF importer, Tagged Text preserves
 * paragraph style names, which are required for TOC/running headers and now
 * for the semantic Book Design Studio vocabulary as well.
 */
export interface DesigncraftManuscript {
  rtf: string;
  images: MarkdownImage[];
  unresolvedMarkers: string[];
  semanticStylesUsed: SemanticParagraphStyle[];
}

export const IMAGE_BEGIN = (placeholder: string) => `[[FLIMG:${placeholder}:BEGIN]]`;
export const IMAGE_END = (placeholder: string) => `[[FLIMG:${placeholder}:END]]`;

const IMAGE_RESERVE_LINES = 28;
const SEMANTIC_STYLE_NAMES: readonly SemanticParagraphStyle[] = [
  'Body',
  'Heading 1',
  'Heading 2',
  'Quote',
  'Epigraph',
  'Letter',
  'InnerThought',
  'ChatMessage',
  'SceneBreak',
  'Caption',
  'LocationTime',
  'SystemMessage',
  'Evidence',
  'Lore',
  'CaseStudy',
  'KeyIdea',
  'Footnote',
];

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
 * DesignCraft Tagged Text instead of flattening it. Unknown constructs stay
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
      out += `<cFont:DejaVu Sans Mono>${rtfText(match[7])}<cFont:${fontFamily}>${restore}`;
    } else if (match[8] !== undefined) out += rtfText(match[8]);
    cursor = token.lastIndex;
  }
  out += rtfText(input.slice(cursor));
  return out.trim();
}

function paragraph(style: string, text: string, local = '', tagged = false): string {
  const reset = local ? '<cFont:><cTypeface:><cSize:>' : '';
  return `<ParaStyle:${style}>${local}${tagged ? text : rtfText(text)}${reset}`;
}

function imagePlaceholder(placeholder: string): string[] {
  return [
    paragraph('Body', IMAGE_BEGIN(placeholder)),
    ...Array.from({ length: IMAGE_RESERVE_LINES }, () => paragraph('Body', '.')),
    paragraph('Body', IMAGE_END(placeholder)),
  ];
}

function canonicalSemanticStyle(raw: string): SemanticParagraphStyle | null {
  const compact = raw.replace(/[\s_-]+/g, '').toLowerCase();
  for (const style of SEMANTIC_STYLE_NAMES) {
    if (style.replace(/[\s_-]+/g, '').toLowerCase() === compact) return style;
  }
  return null;
}

/**
 * The writer never needs to type these markers manually. The editor can store
 * them as an internal semantic annotation. Until that UI lands, this bridge
 * also recognizes Markdown blockquotes and conventional scene separators.
 *
 * Example internal form: `[STYLE:Letter]...[/STYLE]`.
 */
function semanticOfLine(
  line: string,
  theme: BookDesignTheme | null
): { style: SemanticParagraphStyle; text: string } {
  const explicit = /^\[STYLE:([^\]]+)\]\s*([\s\S]*?)\s*\[\/STYLE\]$/i.exec(line);
  if (explicit) {
    const style = canonicalSemanticStyle(explicit[1]);
    if (style) return { style, text: explicit[2] };
  }

  if (/^>\s?/.test(line)) return { style: 'Quote', text: line.replace(/^>\s?/, '') };

  if (/^(?:\*\s*\*\s*\*|---+|___+|·\s*·\s*·|◇|❦|⁂|✦|◆|†|♡)$/u.test(line.trim())) {
    return { style: 'SceneBreak', text: theme?.sceneBreak || '* * *' };
  }

  return { style: 'Body', text: line };
}

function semanticRule(theme: BookDesignTheme | null, style: SemanticParagraphStyle): SemanticStyleRule | null {
  if (!theme || style === 'Body' || style === 'Heading 1' || style === 'Heading 2') return null;
  const rule = theme.semanticStyles[style];
  return rule?.enabled ? rule : null;
}

function fontForRule(theme: BookDesignTheme | null, rule: SemanticStyleRule | null, fallback: string): string {
  if (!theme || !rule?.font) return fallback;
  if (rule.font === 'heading') return theme.headingFont;
  if (rule.font === 'mono') return theme.monoFont;
  return theme.bodyFont;
}

function semanticLocal(
  theme: BookDesignTheme | null,
  style: SemanticParagraphStyle,
  bodyPt: number,
  fallbackFont: string
): { local: string; font: string; typeface: string } {
  const rule = semanticRule(theme, style);
  const font = fontForRule(theme, rule, fallbackFont);
  const typeface = rule?.bold && rule?.italic ? 'Bold Italic' : rule?.bold ? 'Bold' : rule?.italic ? 'Italic' : '';
  const size = style === 'Caption' || style === 'Footnote' ? Math.max(7.5, bodyPt - 1.5) : bodyPt;
  return {
    local: `<cFont:${font}>${typeface ? `<cTypeface:${typeface}>` : ''}<cSize:${size}>`,
    font,
    typeface,
  };
}

/**
 * Build Tagged Text from the same normalized Markdown used by the other
 * external engines. `Heading 1` / `Heading 2` survive import by name, so
 * DesignCraft can generate and later update its own table of contents.
 *
 * `themeId` is read as an optional extension of PdfLayoutSpec. Books that do
 * not opt into Book Design Studio still follow the old neutral path.
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
  const semanticStylesUsed = new Set<SemanticParagraphStyle>();

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
      semanticStylesUsed.add('Heading 1');
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
      semanticStylesUsed.add('Heading 2');
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

    for (const sourceLine of block.split('\n').map((v) => v.trim()).filter(Boolean)) {
      const semantic = semanticOfLine(sourceLine, theme);
      const rule = semanticRule(theme, semantic.style);
      // A theme may not expose a specialist style. The text must still render,
      // so fall back to Body while preserving every character of the manuscript.
      const style: SemanticParagraphStyle = semantic.style === 'Body' || rule ? semantic.style : 'Body';
      const displayText = rule?.uppercase ? semantic.text.toLocaleUpperCase('uk-UA') : semantic.text;
      const local = semanticLocal(theme, style, bodyPt, bodyFont);
      semanticStylesUsed.add(style);
      lines.push(
        paragraph(
          style,
          taggedInline(displayText, local.font, local.typeface),
          local.local,
          true
        )
      );
    }
  }

  if (!blocks.length) {
    semanticStylesUsed.add('Body');
    lines.push(paragraph('Body', ''));
  }

  return {
    rtf: lines.join('\r\n') + '\r\n',
    images: doc.images,
    unresolvedMarkers: doc.unresolvedMarkers,
    semanticStylesUsed: Array.from(semanticStylesUsed),
  };
}
