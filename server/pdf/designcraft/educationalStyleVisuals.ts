import type {
  CustomBookDesignTheme,
  DesignerEntityStyle,
  DesignerThemeEntity,
} from '../../../src/data/customBookDesignTheme';
import type { EducationalPdfTemplateId } from './educationalTemplates';

type EducationalVisuals = Pick<CustomBookDesignTheme, 'fonts' | 'entities' | 'page'>;

function entity(
  id: DesignerThemeEntity,
  patch: Omit<DesignerEntityStyle, 'entity' | 'enabled'>,
): DesignerEntityStyle {
  return { entity: id, enabled: true, ...patch };
}

function border(color: string, sides: Array<'top' | 'right' | 'bottom' | 'left'> = ['left']) {
  return { style: 'solid' as const, widthPt: 1.1, color, sides };
}

const COMMON_FONTS: EducationalVisuals['fonts'] = [
  { slot: 'body', source: 'system', family: 'DejaVu Serif', weights: [400, 700], styles: ['normal', 'italic'] },
  { slot: 'heading', source: 'system', family: 'DejaVu Sans', weights: [400, 700], styles: ['normal'] },
  { slot: 'mono', source: 'system', family: 'DejaVu Sans Mono', weights: [400, 700], styles: ['normal'] },
];

function page(accentColor: string, textColor = '#1F2937', paper = '#FFFFFF'): EducationalVisuals['page'] {
  return {
    pageBackground: { kind: 'color', color: paper, opacity: 1, fit: 'cover', position: 'center' },
    textColor,
    accentColor,
    headerHeightMm: 8,
    footerHeightMm: 8,
    gutterMm: 4,
    mirroredMargins: false,
  };
}

/**
 * Authoritative PDF block styling for educational templates.
 *
 * The templates reuse DesignCraft's existing paragraph-style engine, but
 * deliberately enable and restyle the semantic entities used by educational
 * documents. This keeps the 15 book themes immutable while making the nine
 * educational designs genuinely different at block level.
 */
export function educationalVisualsFor(id: EducationalPdfTemplateId): EducationalVisuals {
  switch (id) {
    case 'methodic-classic':
      return {
        fonts: COMMON_FONTS,
        page: page('#334155', '#1F2937', '#FFFDF8'),
        entities: {
          'key-idea': entity('key-idea', { fontSlot: 'heading', fontWeight: 700, textColor: '#1E293B', border: border('#64748B') }),
          'case-study': entity('case-study', { background: { kind: 'color', color: '#F8FAFC', opacity: 1 }, border: border('#CBD5E1', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 3, right: 3, bottom: 3, left: 3 } }),
          evidence: entity('evidence', { fontSlot: 'mono', background: { kind: 'color', color: '#F1F5F9', opacity: 1 }, border: border('#94A3B8'), paddingMm: { top: 2, right: 2, bottom: 2, left: 3 } }),
          footnote: entity('footnote', { fontSizePt: 8.5, textColor: '#64748B' }),
        },
      };

    case 'methodic-modern':
      return {
        fonts: COMMON_FONTS,
        page: page('#0F766E', '#17323A', '#F8FAFC'),
        entities: {
          'key-idea': entity('key-idea', { fontSlot: 'heading', fontWeight: 700, textColor: '#0F766E', background: { kind: 'color', color: '#ECFDF5', opacity: 1 }, paddingMm: { top: 3, right: 3, bottom: 3, left: 3 }, border: border('#14B8A6') }),
          'case-study': entity('case-study', { background: { kind: 'color', color: '#F0FDFA', opacity: 1 }, border: border('#5EEAD4', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 3, right: 3, bottom: 3, left: 3 } }),
          evidence: entity('evidence', { fontSlot: 'mono', textColor: '#115E59', background: { kind: 'color', color: '#CCFBF1', opacity: 1 }, paddingMm: { top: 2, right: 2, bottom: 2, left: 2 } }),
          quote: entity('quote', { italic: true, textColor: '#334155', border: border('#99F6E4') }),
          footnote: entity('footnote', { fontSizePt: 8.5, textColor: '#64748B' }),
        },
      };

    case 'methodic-visual-pro':
      return {
        fonts: COMMON_FONTS,
        page: page('#C2410C', '#292524', '#FFF7ED'),
        entities: {
          lore: entity('lore', { background: { kind: 'color', color: '#FFEDD5', opacity: 1 }, border: border('#FB923C'), paddingMm: { top: 3, right: 4, bottom: 3, left: 4 } }),
          'key-idea': entity('key-idea', { fontSlot: 'heading', fontWeight: 700, textColor: '#9A3412', background: { kind: 'color', color: '#FED7AA', opacity: 1 }, paddingMm: { top: 3, right: 3, bottom: 3, left: 3 } }),
          'case-study': entity('case-study', { background: { kind: 'color', color: '#FFFFFF', opacity: 1 }, border: border('#FDBA74', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 4, right: 4, bottom: 4, left: 4 } }),
          evidence: entity('evidence', { fontSlot: 'mono', fontWeight: 700, textColor: '#7C2D12', background: { kind: 'color', color: '#FFEDD5', opacity: 1 }, border: border('#EA580C', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 2, right: 2, bottom: 2, left: 2 } }),
          footnote: entity('footnote', { fontSizePt: 8.5, textColor: '#78716C' }),
        },
      };

    case 'instruction-clear-steps':
      return {
        fonts: COMMON_FONTS,
        page: page('#047857', '#1F2937', '#FFFFFF'),
        entities: {
          'location-time': entity('location-time', { fontSlot: 'heading', fontWeight: 700, textColor: '#065F46', border: border('#10B981', ['bottom']), paddingMm: { top: 2, right: 2, bottom: 2, left: 2 } }),
          'key-idea': entity('key-idea', { fontWeight: 700, textColor: '#065F46' }),
          'case-study': entity('case-study', { background: { kind: 'color', color: '#ECFDF5', opacity: 1 }, paddingMm: { top: 3, right: 3, bottom: 3, left: 3 } }),
          evidence: entity('evidence', { fontSlot: 'mono', fontWeight: 700, textColor: '#991B1B', background: { kind: 'color', color: '#FEF2F2', opacity: 1 }, border: border('#EF4444'), paddingMm: { top: 2, right: 2, bottom: 2, left: 3 } }),
        },
      };

    case 'instruction-visual-flow':
      return {
        fonts: COMMON_FONTS,
        page: page('#2563EB', '#172554', '#F8FAFC'),
        entities: {
          'system-message': entity('system-message', { fontSlot: 'heading', fontWeight: 700, textColor: '#1D4ED8', background: { kind: 'color', color: '#DBEAFE', opacity: 1 }, border: border('#60A5FA', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 3, right: 4, bottom: 3, left: 4 } }),
          'case-study': entity('case-study', { background: { kind: 'color', color: '#EFF6FF', opacity: 1 }, border: border('#93C5FD'), paddingMm: { top: 3, right: 3, bottom: 3, left: 3 } }),
          evidence: entity('evidence', { fontSlot: 'mono', fontWeight: 700, textColor: '#9F1239', background: { kind: 'color', color: '#FFF1F2', opacity: 1 }, border: border('#FB7185', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 2, right: 2, bottom: 2, left: 2 } }),
          footnote: entity('footnote', { textColor: '#475569', fontSizePt: 8.5 }),
        },
      };

    case 'instruction-compact-manual':
      return {
        fonts: COMMON_FONTS,
        page: page('#475569', '#0F172A', '#FFFFFF'),
        entities: {
          'key-idea': entity('key-idea', { fontSlot: 'heading', fontSizePt: 9.5, fontWeight: 700, textColor: '#334155', border: border('#64748B', ['bottom']) }),
          'case-study': entity('case-study', { fontSizePt: 9, background: { kind: 'color', color: '#F8FAFC', opacity: 1 }, paddingMm: { top: 1.5, right: 2, bottom: 1.5, left: 2 } }),
          evidence: entity('evidence', { fontSlot: 'mono', fontSizePt: 8.5, textColor: '#7F1D1D', border: border('#B91C1C') }),
          footnote: entity('footnote', { fontSizePt: 7.5, textColor: '#64748B' }),
        },
      };

    case 'worksheet-clean':
      return {
        fonts: COMMON_FONTS,
        page: page('#334155', '#1F2937', '#FFFFFF'),
        entities: {
          'key-idea': entity('key-idea', { fontSlot: 'heading', fontWeight: 700, textColor: '#334155' }),
          'case-study': entity('case-study', { background: { kind: 'color', color: '#FFFFFF', opacity: 1 }, border: border('#CBD5E1', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 4, right: 4, bottom: 7, left: 4 } }),
          evidence: entity('evidence', { textColor: '#475569', border: border('#94A3B8', ['bottom']), paddingMm: { top: 2, right: 2, bottom: 4, left: 2 } }),
          quote: entity('quote', { italic: false, border: border('#CBD5E1', ['bottom']), paddingMm: { top: 2, right: 2, bottom: 7, left: 2 } }),
        },
      };

    case 'worksheet-interactive':
      return {
        fonts: COMMON_FONTS,
        page: page('#7C3AED', '#2E1065', '#FAF5FF'),
        entities: {
          'key-idea': entity('key-idea', { fontSlot: 'heading', fontWeight: 700, textColor: '#6D28D9', background: { kind: 'color', color: '#F3E8FF', opacity: 1 }, border: border('#C084FC'), paddingMm: { top: 3, right: 3, bottom: 5, left: 3 } }),
          'case-study': entity('case-study', { background: { kind: 'color', color: '#FFFFFF', opacity: 1 }, border: border('#D8B4FE', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 3, right: 3, bottom: 6, left: 3 } }),
          evidence: entity('evidence', { textColor: '#5B21B6', background: { kind: 'color', color: '#F5F3FF', opacity: 1 }, paddingMm: { top: 2, right: 2, bottom: 4, left: 2 } }),
          quote: entity('quote', { italic: false, textColor: '#6B21A8', background: { kind: 'color', color: '#FAE8FF', opacity: 1 }, paddingMm: { top: 2, right: 2, bottom: 6, left: 2 } }),
        },
      };

    case 'worksheet-project-sheet':
      return {
        fonts: COMMON_FONTS,
        page: page('#EA580C', '#422006', '#FFFBEB'),
        entities: {
          'key-idea': entity('key-idea', { fontSlot: 'heading', fontWeight: 700, textColor: '#C2410C', border: border('#F59E0B', ['bottom']) }),
          'case-study': entity('case-study', { fontWeight: 700, textColor: '#9A3412', background: { kind: 'color', color: '#FEF3C7', opacity: 1 }, border: border('#F59E0B', ['top', 'right', 'bottom', 'left']), paddingMm: { top: 4, right: 4, bottom: 6, left: 4 } }),
          evidence: entity('evidence', { textColor: '#92400E', background: { kind: 'color', color: '#FFFBEB', opacity: 1 }, border: border('#FBBF24'), paddingMm: { top: 2, right: 2, bottom: 4, left: 3 } }),
          'system-message': entity('system-message', { fontSlot: 'mono', textColor: '#78350F', background: { kind: 'color', color: '#FEF3C7', opacity: 1 }, paddingMm: { top: 2, right: 2, bottom: 2, left: 2 } }),
        },
      };
  }
}
