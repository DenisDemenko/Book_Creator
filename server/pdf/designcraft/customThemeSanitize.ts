/**
 * Безпечне читання власного шаблону й фонів блоків із `layoutConfig` книги.
 *
 * Дані приходять із браузера й зберігаються в книзі, тож перед тим як вони потраплять у команди
 * DesignCraft, їх очищено: відомі сутності, колір лише `#RRGGBB`, числа в межах, розмір обмежений.
 */
import {
  BLOCK_BACKGROUND_TARGETS,
  DESIGNER_THEME_ENTITIES,
  type BlockBackgrounds,
  type CustomBookDesignTheme,
  type DesignerEntityStyle,
  type DesignerThemeEntity,
} from '../../../src/data/customBookDesignTheme';
import { isBookDesignThemeId, type BookDesignThemeId } from './themes';

export const MAX_CUSTOM_THEME_BYTES = 96_000;

export type CustomVisualsSnapshot = Pick<CustomBookDesignTheme, 'fonts' | 'entities' | 'page'>;

export interface SanitizedCustomDesignTheme {
  id: string;
  name: string;
  basedOn: BookDesignThemeId;
  visuals: CustomVisualsSnapshot;
}

const ENTITY_IDS = new Set<string>(DESIGNER_THEME_ENTITIES.map((e) => e.id));
const BLOCK_IDS = new Set<string>(BLOCK_BACKGROUND_TARGETS.map((e) => e.id));
const SLOTS = new Set(['body', 'heading', 'mono', 'display']);
const SAFE_FONTS = new Set(['DejaVu Serif', 'DejaVu Sans', 'DejaVu Sans Mono']);

export function safeHexColor(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : null;
}

function num(value: unknown, min: number, max: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function box(value: unknown): { top: number; right: number; bottom: number; left: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const read = (k: string) => num(v[k], 0, 60) ?? 0;
  return { top: read('top'), right: read('right'), bottom: read('bottom'), left: read('left') };
}

function cleanEntity(id: DesignerThemeEntity, raw: unknown): DesignerEntityStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const out: DesignerEntityStyle = { entity: id, enabled: r.enabled !== false };
  if (SLOTS.has(r.fontSlot)) out.fontSlot = r.fontSlot;
  const size = num(r.fontSizePt, 6, 72);
  if (size !== undefined) out.fontSizePt = size;
  const lh = num(r.lineHeight, 0.8, 3);
  if (lh !== undefined) out.lineHeight = lh;
  const weight = num(r.fontWeight, 100, 900);
  if (weight !== undefined) out.fontWeight = weight;
  if (typeof r.italic === 'boolean') out.italic = r.italic;
  if (typeof r.uppercase === 'boolean') out.uppercase = r.uppercase;
  if (['left', 'center', 'right', 'justify'].includes(r.align)) out.align = r.align;
  const text = safeHexColor(r.textColor);
  if (text) out.textColor = text;
  const accent = safeHexColor(r.accentColor);
  if (accent) out.accentColor = accent;
  const bg = safeHexColor(r.background?.color);
  if (r.background?.kind === 'color' && bg) {
    out.background = { kind: 'color', color: bg, opacity: num(r.background.opacity, 0, 1) ?? 1 };
  }
  if (r.border?.style === 'solid') {
    const color = safeHexColor(r.border.color);
    if (color) {
      const sides = Array.isArray(r.border.sides) ? r.border.sides.filter((s: unknown) => ['top', 'right', 'bottom', 'left'].includes(String(s))) : [];
      out.border = { style: 'solid', widthPt: num(r.border.widthPt, 0.25, 6) ?? 1, color, ...(sides.length ? { sides } : {}) };
    }
  }
  const padding = box(r.paddingMm);
  if (padding) out.paddingMm = padding;
  const before = num(r.spaceBeforePt, 0, 144);
  if (before !== undefined) out.spaceBeforePt = before;
  const after = num(r.spaceAfterPt, 0, 144);
  if (after !== undefined) out.spaceAfterPt = after;
  const indent = num(r.firstLineIndentPt, 0, 144);
  if (indent !== undefined) out.firstLineIndentPt = indent;
  return out;
}

/** Власний шаблон книги (`layoutConfig.customDesignTheme`) → безпечні візуальні параметри. */
export function sanitizeCustomDesignTheme(raw: unknown): SanitizedCustomDesignTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_CUSTOM_THEME_BYTES) return null;
  } catch {
    return null;
  }
  const r = raw as Record<string, any>;
  if (!isBookDesignThemeId(r.basedOn)) return null;
  const name = String(r.name || '').trim().slice(0, 120);
  if (!name) return null;

  const entities: Partial<Record<DesignerThemeEntity, DesignerEntityStyle>> = {};
  for (const [key, value] of Object.entries(r.entities || {})) {
    if (!ENTITY_IDS.has(key)) continue;
    const cleaned = cleanEntity(key as DesignerThemeEntity, value);
    if (cleaned) entities[key as DesignerThemeEntity] = cleaned;
  }

  const fonts = (Array.isArray(r.fonts) ? r.fonts : [])
    .filter((f: any) => f && SLOTS.has(f.slot) && SAFE_FONTS.has(String(f.family)))
    .map((f: any) => ({ slot: f.slot, source: 'system' as const, family: String(f.family), weights: [400, 700], styles: ['normal', 'italic'] as Array<'normal' | 'italic'> }));

  const page = {
    pageBackground: { kind: 'color' as const, color: safeHexColor(r.page?.pageBackground?.color) || '#FFFFFF', opacity: 1 },
    textColor: safeHexColor(r.page?.textColor) || '#1F2937',
    accentColor: safeHexColor(r.page?.accentColor) || '#0F766E',
    headerHeightMm: num(r.page?.headerHeightMm, 0, 40) ?? 8,
    footerHeightMm: num(r.page?.footerHeightMm, 0, 40) ?? 8,
    gutterMm: num(r.page?.gutterMm, 0, 40) ?? 4,
    mirroredMargins: r.page?.mirroredMargins !== false,
  };

  return {
    id: String(r.id || 'custom').slice(0, 80),
    name,
    basedOn: r.basedOn,
    visuals: { fonts, entities, page },
  };
}

/** Фони блоків (`layoutConfig.blockBackgrounds`) → лише відомі блоки й безпечні кольори. */
export function sanitizeBlockBackgrounds(raw: unknown): BlockBackgrounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, { color: string | null; opacity?: number }> = {};
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    if (!BLOCK_IDS.has(key) || !value || typeof value !== 'object') continue;
    if (value.color === null) {
      out[key] = { color: null };
      continue;
    }
    const color = safeHexColor(value.color);
    if (!color) continue;
    out[key] = { color, opacity: num(value.opacity, 0.05, 1) ?? 1 };
  }
  return Object.keys(out).length ? (out as BlockBackgrounds) : null;
}
