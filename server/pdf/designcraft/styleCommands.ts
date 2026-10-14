import type {
  CustomBookDesignTheme,
  DesignerEntityStyle,
  DesignerFontSlot,
  DesignerThemeEntity,
} from '../../../src/data/customBookDesignTheme';
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

type CustomVisuals = Pick<CustomBookDesignTheme, 'fonts' | 'entities'>;
type ThemeSpec = PdfLayoutSpec & { themeId?: unknown; customThemeVisuals?: CustomVisuals };

const SAFE_CUSTOM_FONTS = new Set(['DejaVu Serif', 'DejaVu Sans', 'DejaVu Sans Mono']);

function dcAlign(value: string | undefined): 'left' | 'center' | 'right' | 'leftJustified' {
  if (value === 'left' || value === 'center' || value === 'right') return value;
  return 'leftJustified';
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function themeOf(spec: PdfLayoutSpec): BookDesignTheme | null {
  return getBookDesignTheme((spec as ThemeSpec).themeId);
}

function customVisualsOf(spec: PdfLayoutSpec): CustomVisuals | null {
  return (spec as ThemeSpec).customThemeVisuals || null;
}

function customEntityStyle(spec: PdfLayoutSpec, entity: DesignerThemeEntity): DesignerEntityStyle | null {
  return customVisualsOf(spec)?.entities?.[entity] || null;
}

function customFontFamily(spec: PdfLayoutSpec, slot: DesignerFontSlot | undefined): string | null {
  if (!slot) return null;
  const family = String(customVisualsOf(spec)?.fonts?.find((item) => item.slot === slot)?.family || '').trim();
  return SAFE_CUSTOM_FONTS.has(family) ? family : null;
}

function semanticEntity(name: SemanticParagraphStyle): DesignerThemeEntity | null {
  switch (name) {
    case 'Quote': return 'quote';
    case 'Epigraph': return 'epigraph';
    case 'Letter': return 'letter';
    case 'InnerThought': return 'inner-thought';
    case 'ChatMessage': return 'chat-message';
    case 'SceneBreak': return 'scene-break';
    case 'Caption': return 'caption';
    case 'LocationTime': return 'location-time';
    case 'SystemMessage': return 'system-message';
    case 'Evidence': return 'evidence';
    case 'Lore': return 'lore';
    case 'CaseStudy': return 'case-study';
    case 'KeyIdea': return 'key-idea';
    case 'Footnote': return 'footnote';
    default: return null;
  }
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

function customFontStyle(
  custom: DesignerEntityStyle | null,
  fallback: 'Bold' | 'Italic' | 'Bold Italic' | undefined
): 'Bold' | 'Italic' | 'Bold Italic' | undefined {
  if (!custom) return fallback;
  const bold = Number(custom.fontWeight || 0) >= 600;
  const italic = Boolean(custom.italic);
  if (bold && italic) return 'Bold Italic';
  if (bold) return 'Bold';
  if (italic) return 'Italic';
  return fallback;
}

function semanticDefinition(
  spec: PdfLayoutSpec,
  theme: BookDesignTheme,
  name: SemanticParagraphStyle
): DesigncraftParagraphStyleDefinition | null {
  const rule = theme.semanticStyles[name];
  const entity = semanticEntity(name);
  const custom = entity ? customEntityStyle(spec, entity) : null;

  // A custom theme may explicitly introduce a semantic style that is not part
  // of the selected base theme (for example Evidence on top of Sci-Fi). It may
  // also explicitly disable a base-theme style. This keeps custom Theme Studio
  // semantics authoritative without changing any of the 15 factory themes.
  if (custom?.enabled === false) return null;
  if (!rule?.enabled && !custom?.enabled) return null;

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

  const family = customFontFamily(spec, custom?.fontSlot) || fontForRule(theme, rule);
  const fallbackStyle = fontStyle(rule);

  return {
    name,
    para: {
      align: dcAlign(custom?.align || rule?.align || theme.bodyAlign),
      firstLineIndent,
      spaceBefore: before,
      spaceAfter: after,
    },
    chars: {
      size: clamp(custom?.fontSizePt, 7, 36, size),
      fontFamily: family,
      ...(customFontStyle(custom, fallbackStyle) ? { fontStyle: customFontStyle(custom, fallbackStyle) } : {}),
    },
  };
}

/**
 * Build only paragraph/character attributes that are proven by the production
 * DesignCraft v0.7.1 path. Custom themes may override installed font family,
 * size, alignment and bold/italic. Colors, backgrounds, borders, radius and
 * remote font URLs stay in the manifest until their DesignCraft commands are
 * validated by a separate Gate B slice.
 */
export function buildDesigncraftParagraphStyles(
  spec: PdfLayoutSpec,
  used: readonly SemanticParagraphStyle[]
): DesigncraftParagraphStyleDefinition[] {
  const theme = themeOf(spec);
  const bodyCustom = customEntityStyle(spec, 'body');
  const h1Custom = customEntityStyle(spec, 'heading-1');
  const h2Custom = customEntityStyle(spec, 'heading-2');
  const bodySize = clamp(bodyCustom?.fontSizePt, 8, 24, Math.max(8, spec.baseFontSize + (theme?.bodySizeDelta || 0)));
  const chapterSize = clamp(h1Custom?.fontSizePt, 12, 56, Math.max(12, spec.chapterTitle.fontSize + (theme?.chapterSizeDelta || 0)));
  const sectionSize = clamp(h2Custom?.fontSizePt, 9, 36, Math.max(10, spec.sectionTitle.fontSize + (theme?.sectionSizeDelta || 0)));
  const bodyFont = customFontFamily(spec, bodyCustom?.fontSlot) || theme?.bodyFont || 'DejaVu Serif';
  const headingFont = theme?.headingFont || 'DejaVu Serif';
  const h1Font = customFontFamily(spec, h1Custom?.fontSlot) || headingFont;
  const h2Font = customFontFamily(spec, h2Custom?.fontSlot) || headingFont;
  const bodyAlign = bodyCustom?.align || theme?.bodyAlign || spec.bodyAlign;
  const chapterAlign = h1Custom?.align || theme?.chapterAlign || spec.chapterTitle.align;

  const definitions: DesigncraftParagraphStyleDefinition[] = [
    {
      name: 'Body',
      para: {
        align: dcAlign(bodyAlign),
        firstLineIndent: spec.paragraphIndent * (theme?.paragraphIndentMultiplier ?? 1),
        spaceAfter: spec.paragraphSpacing * (theme?.paragraphSpacingMultiplier ?? 1),
      },
      chars: {
        size: bodySize,
        fontFamily: bodyFont,
        ...(customFontStyle(bodyCustom, undefined) ? { fontStyle: customFontStyle(bodyCustom, undefined) } : {}),
      },
    },
    {
      name: 'Heading 1',
      para: {
        align: dcAlign(chapterAlign),
        spaceBefore: spec.chapterTitle.spaceBefore,
        spaceAfter: spec.chapterTitle.spaceAfter,
      },
      chars: {
        size: chapterSize,
        fontFamily: h1Font,
        fontStyle: customFontStyle(h1Custom, 'Bold') || 'Bold',
      },
    },
    {
      name: 'Heading 2',
      para: {
        align: dcAlign(h2Custom?.align || spec.sectionTitle.align),
        spaceBefore: spec.sectionTitle.spaceBefore,
        spaceAfter: spec.sectionTitle.spaceAfter,
      },
      chars: {
        size: sectionSize,
        fontFamily: h2Font,
        fontStyle: customFontStyle(h2Custom, 'Bold') || 'Bold',
      },
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
