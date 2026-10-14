import type { PdfLayoutSpec } from '../pdfTypes';
import {
  getBookDesignTheme,
  type BookDesignTheme,
  type SemanticParagraphStyle,
  type SemanticStyleRule,
} from './themes';

export interface DesigncraftParagraphStyleDefinition {
  name: SemanticParagraphStyle;
  para: {
    align: 'left' | 'center' | 'right' | 'leftJustified';
    firstLineIndent?: number;
    spaceBefore?: number;
    spaceAfter?: number;
  };
  chars: {
    size: number;
    fontFamily: string;
    fontStyle?: 'Bold' | 'Italic' | 'Bold Italic';
  };
}

type ThemeSpec = PdfLayoutSpec & { themeId?: unknown };

function dcAlign(value: string | undefined): 'left' | 'center' | 'right' | 'leftJustified' {
  if (value === 'left' || value === 'center' || value === 'right') return value;
  return 'leftJustified';
}

function themeOf(spec: PdfLayoutSpec): BookDesignTheme | null {
  return getBookDesignTheme((spec as ThemeSpec).themeId);
}

function fontForRule(theme: BookDesignTheme | null, rule: SemanticStyleRule | undefined): string {
  if (!theme) return 'DejaVu Serif';
  if (rule?.font === 'heading') return theme.headingFont;
  if (rule?.font === 'mono') return theme.monoFont;
  return theme.bodyFont;
}

function fontStyle(rule: SemanticStyleRule | undefined): 'Bold' | 'Italic' | 'Bold Italic' | undefined {
  if (rule?.bold && rule?.italic) return 'Bold Italic';
  if (rule?.bold) return 'Bold';
  if (rule?.italic) return 'Italic';
  return undefined;
}

function semanticDefinition(
  spec: PdfLayoutSpec,
  theme: BookDesignTheme,
  name: SemanticParagraphStyle
): DesigncraftParagraphStyleDefinition | null {
  const rule = theme.semanticStyles[name];
  if (!rule?.enabled) return null;

  const base = Math.max(8, spec.baseFontSize + theme.bodySizeDelta);
  let size = base;
  let before = Math.max(2, spec.paragraphSpacing * theme.paragraphSpacingMultiplier);
  let after = Math.max(2, spec.paragraphSpacing * theme.paragraphSpacingMultiplier);
  let firstLineIndent = 0;

  switch (name) {
    case 'Quote':
      before = Math.max(8, before);
      after = Math.max(8, after);
      break;
    case 'Epigraph':
      size = Math.max(8, base - 0.75);
      before = Math.max(10, before);
      after = Math.max(12, after);
      break;
    case 'Letter':
      before = Math.max(8, before);
      after = Math.max(8, after);
      break;
    case 'InnerThought':
      firstLineIndent = spec.paragraphIndent * theme.paragraphIndentMultiplier;
      break;
    case 'ChatMessage':
    case 'SystemMessage':
    case 'Evidence':
      size = Math.max(8, base - 0.4);
      before = Math.max(6, before);
      after = Math.max(6, after);
      break;
    case 'LocationTime':
      size = Math.max(7.5, base - 1.25);
      before = Math.max(10, before);
      after = Math.max(6, after);
      break;
    case 'SceneBreak':
      size = Math.max(8, base - 0.75);
      before = Math.max(12, before);
      after = Math.max(12, after);
      break;
    case 'Caption':
      size = Math.max(7.5, base - 1.5);
      before = Math.max(4, before);
      after = Math.max(8, after);
      break;
    case 'Lore':
      before = Math.max(8, before);
      after = Math.max(8, after);
      break;
    case 'CaseStudy':
      before = Math.max(10, before);
      after = Math.max(10, after);
      break;
    case 'KeyIdea':
      size = Math.max(base, base + 0.6);
      before = Math.max(10, before);
      after = Math.max(8, after);
      break;
    case 'Footnote':
      size = Math.max(7.5, base - 2);
      before = Math.max(2, before);
      after = Math.max(2, after);
      break;
    default:
      break;
  }

  return {
    name,
    para: {
      align: dcAlign(rule.align || theme.bodyAlign),
      firstLineIndent,
      spaceBefore: before,
      spaceAfter: after,
    },
    chars: {
      size,
      fontFamily: fontForRule(theme, rule),
      ...(fontStyle(rule) ? { fontStyle: fontStyle(rule) } : {}),
    },
  };
}

/**
 * Build only the paragraph styles actually present in the manuscript. This
 * keeps DesignCraft documents small while still giving every semantic block a
 * real named style that a professional designer can inspect and override.
 *
 * Borders/backgrounds from the theme schema are intentionally not translated
 * here yet: DesignCraft v0.7.1's proven production path in this repository
 * only uses paragraph + character attributes. We first make semantics real and
 * stable, then add object/rule decoration in a separate tested slice.
 */
export function buildDesigncraftParagraphStyles(
  spec: PdfLayoutSpec,
  used: readonly SemanticParagraphStyle[]
): DesigncraftParagraphStyleDefinition[] {
  const theme = themeOf(spec);
  const bodySize = Math.max(8, spec.baseFontSize + (theme?.bodySizeDelta || 0));
  const chapterSize = Math.max(12, spec.chapterTitle.fontSize + (theme?.chapterSizeDelta || 0));
  const sectionSize = Math.max(10, spec.sectionTitle.fontSize + (theme?.sectionSizeDelta || 0));
  const bodyFont = theme?.bodyFont || 'DejaVu Serif';
  const headingFont = theme?.headingFont || 'DejaVu Serif';
  const bodyAlign = theme?.bodyAlign || spec.bodyAlign;
  const chapterAlign = theme?.chapterAlign || spec.chapterTitle.align;

  const definitions: DesigncraftParagraphStyleDefinition[] = [
    {
      name: 'Body',
      para: {
        align: dcAlign(bodyAlign),
        firstLineIndent: spec.paragraphIndent * (theme?.paragraphIndentMultiplier ?? 1),
        spaceAfter: spec.paragraphSpacing * (theme?.paragraphSpacingMultiplier ?? 1),
      },
      chars: { size: bodySize, fontFamily: bodyFont },
    },
    {
      name: 'Heading 1',
      para: {
        align: dcAlign(chapterAlign),
        spaceBefore: spec.chapterTitle.spaceBefore,
        spaceAfter: spec.chapterTitle.spaceAfter,
      },
      chars: { size: chapterSize, fontFamily: headingFont, fontStyle: 'Bold' },
    },
    {
      name: 'Heading 2',
      para: {
        align: dcAlign(spec.sectionTitle.align),
        spaceBefore: spec.sectionTitle.spaceBefore,
        spaceAfter: spec.sectionTitle.spaceAfter,
      },
      chars: { size: sectionSize, fontFamily: headingFont, fontStyle: 'Bold' },
    },
  ];

  if (!theme) return definitions;

  const seen = new Set<SemanticParagraphStyle>(['Body', 'Heading 1', 'Heading 2']);
  for (const name of used) {
    if (seen.has(name)) continue;
    const definition = semanticDefinition(spec, theme, name);
    if (definition) {
      definitions.push(definition);
      seen.add(name);
    }
  }

  return definitions;
}

export function serializeDesigncraftParagraphStyles(
  spec: PdfLayoutSpec,
  used: readonly SemanticParagraphStyle[]
): string[] {
  return buildDesigncraftParagraphStyles(spec, used).map(
    (style) => `style.paragraph.create ${JSON.stringify({ name: style.name, para: style.para, chars: style.chars })}`
  );
}
