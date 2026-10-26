/**
 * Імпорт користувацького шаблону з `.designcraft`, збереженого у вікні DesignCraft.
 *
 * Потік: Студія віддає КОПІЮ шаблону (`.designcraft` з усіма його стилями абзаців і зразками тексту);
 * автор правит стилі у DesignCraft, зберігає/експортує файл на диск; тут ми читаємо з нього стилі
 * абзаців і складаємо власну тему Студії (`CustomBookDesignTheme`). Текст і сторінки файла не
 * імпортуються — лише стилі: книга й далі верстається рушієм Студії за цими стилями.
 *
 * `.designcraft` — це ZIP (`mimetype`, `meta.json`, `document.json`). У `document.json`:
 * `styles.paragraph[]` ({ name, para, chars }) і `swatches[]` (іменовані кольори).
 */
import JSZip from 'jszip';
import {
  emptyCustomBookDesignTheme,
  type CustomBookDesignTheme,
  type DesignerEntityStyle,
  type DesignerFontSlot,
  type DesignerThemeEntity,
} from '../../../src/data/customBookDesignTheme';
import { semanticEntity } from './styleCommands';
import { sanitizeCustomDesignTheme, safeHexColor } from './customThemeSanitize';
import type { BookDesignThemeId, SemanticParagraphStyle } from './themes';

export const MAX_TEMPLATE_FILE_BYTES = 40 * 1024 * 1024;
const MAX_DOCUMENT_JSON_BYTES = 64 * 1024 * 1024;
const PT_TO_MM = 25.4 / 72;

/** Базові стилі Студії + смислові; назви збігаються з тими, що створює рушій (styleCommands). */
const SEMANTIC_NAMES: SemanticParagraphStyle[] = [
  'Quote', 'Epigraph', 'Letter', 'InnerThought', 'ChatMessage', 'SceneBreak', 'Caption', 'LocationTime',
  'SystemMessage', 'Evidence', 'Lore', 'CaseStudy', 'KeyIdea', 'Footnote',
];

export const TEMPLATE_STYLE_ENTITIES: ReadonlyArray<{ style: string; entity: DesignerThemeEntity }> = [
  { style: 'Body', entity: 'body' },
  { style: 'Heading 1', entity: 'heading-1' },
  { style: 'Heading 2', entity: 'heading-2' },
  ...SEMANTIC_NAMES.flatMap((name) => {
    const entity = semanticEntity(name);
    return entity ? [{ style: name as string, entity }] : [];
  }),
];

export class TemplateImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateImportError';
  }
}

export interface ImportedTemplate {
  theme: CustomBookDesignTheme;
  /** Які стилі знайдено у файлі й перенесено. */
  importedStyles: string[];
  /** Стилі Студії, яких у файлі немає (лишаються за базовим шаблоном). */
  missingStyles: string[];
  notesUk: string[];
}

type Swatches = Map<string, string>;

function toHex(r: number, g: number, b: number): string | null {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  if (![r, g, b].every(Number.isFinite)) return null;
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function swatchHex(value: any): string | null {
  const color = value?.color;
  if (!color || typeof color !== 'object') return null;
  if (color.model === 'rgb') return toHex(Number(color.r), Number(color.g), Number(color.b));
  if (color.model === 'cmyk') {
    const [c, m, y, k] = [color.c, color.m, color.y, color.k].map(Number);
    if (![c, m, y, k].every(Number.isFinite)) return null;
    return toHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
  }
  if (color.model === 'gray' || color.model === 'grey') {
    const g = Number(color.gray ?? color.value ?? color.k);
    return toHex(1 - (Number.isFinite(g) && g > 1 ? g / 100 : g), 1 - (Number.isFinite(g) && g > 1 ? g / 100 : g), 1 - (Number.isFinite(g) && g > 1 ? g / 100 : g));
  }
  return null;
}

function readSwatches(doc: any): Swatches {
  const map: Swatches = new Map();
  for (const s of Array.isArray(doc?.swatches) ? doc.swatches : []) {
    const name = String(s?.name || '');
    const hex = s?.value?.kind === 'paper' ? '#FFFFFF' : swatchHex(s?.value);
    if (name && hex) map.set(name, hex);
  }
  return map;
}

function colorOf(swatches: Swatches, name: unknown): string | null {
  const key = String(name || '');
  if (!key) return null;
  const hit = swatches.get(key);
  if (hit) return hit;
  // Кольори Студії названо «BookDesign RRGGBB» — читаємо навіть без запису в swatches.
  const m = /^BookDesign ([0-9a-fA-F]{6})$/.exec(key);
  return m ? `#${m[1].toUpperCase()}` : null;
}

function slotFor(family: string): { slot: DesignerFontSlot; known: boolean } {
  const f = family.toLowerCase();
  if (family === 'DejaVu Serif') return { slot: 'body', known: true };
  if (family === 'DejaVu Sans') return { slot: 'heading', known: true };
  if (family === 'DejaVu Sans Mono') return { slot: 'mono', known: true };
  if (/mono|courier|consol|code|typewriter/.test(f)) return { slot: 'mono', known: false };
  if (/sans|arial|helvet|calibri|inter\b|roboto|open|segoe|verdana|tahoma|gothic/.test(f)) return { slot: 'heading', known: false };
  return { slot: 'body', known: false };
}

function alignOf(value: unknown): DesignerEntityStyle['align'] | undefined {
  const v = String(value || '').toLowerCase();
  if (!v) return undefined;
  if (v.includes('justif')) return 'justify';
  if (v === 'center' || v === 'centre') return 'center';
  if (v === 'right') return 'right';
  if (v === 'left') return 'left';
  return undefined;
}

function offsetsToPadding(value: unknown): DesignerEntityStyle['paddingMm'] | undefined {
  if (!Array.isArray(value) || value.length < 4) return undefined;
  const [top, left, bottom, right] = value.map((v) => Math.max(0, Number(v) || 0) * PT_TO_MM);
  return { top: round(top), right: round(right), bottom: round(bottom), left: round(left) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function number(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Один стиль абзацу DesignCraft → стиль сутності Студії. */
function entityFromStyle(
  entity: DesignerThemeEntity,
  style: any,
  swatches: Swatches,
  notesUk: string[],
  styleName: string
): DesignerEntityStyle {
  const para = style?.para || {};
  const chars = style?.chars || {};
  const out: DesignerEntityStyle = { entity, enabled: true };

  const family = String(chars.fontFamily || '').trim();
  if (family) {
    const { slot, known } = slotFor(family);
    out.fontSlot = slot;
    if (!known) {
      const target = slot === 'mono' ? 'DejaVu Sans Mono' : slot === 'heading' ? 'DejaVu Sans' : 'DejaVu Serif';
      notesUk.push(`Стиль «${styleName}»: шрифт «${family}» сервер Студії не має — замінено на «${target}».`);
    }
  }

  const size = number(chars.size);
  if (size !== undefined && size > 0) out.fontSizePt = size;
  const leading = chars.leading;
  if (size && leading && typeof leading === 'object' && leading.kind === 'points' && Number(leading.value) > 0) {
    out.lineHeight = round(Number(leading.value) / size);
  }

  const fontStyle = String(chars.fontStyle || '');
  if (/bold|black|heavy/i.test(fontStyle)) out.fontWeight = 700;
  if (/italic|oblique/i.test(fontStyle)) out.italic = true;
  if (/allcaps|all caps|uppercase/i.test(String(chars.case || chars.capitalization || ''))) out.uppercase = true;

  const align = alignOf(para.align);
  if (align) out.align = align;

  const before = number(para.spaceBefore);
  if (before !== undefined) out.spaceBeforePt = Math.max(0, before);
  const after = number(para.spaceAfter);
  if (after !== undefined) out.spaceAfterPt = Math.max(0, after);
  const indent = number(para.firstLineIndent);
  if (indent !== undefined) out.firstLineIndentPt = Math.max(0, indent);

  const text = colorOf(swatches, chars.fill);
  if (text) out.textColor = text;

  if (para.shadingOn) {
    const color = colorOf(swatches, para.shadingColor);
    if (color) {
      let tint = number(para.shadingTint) ?? 1;
      if (tint > 1) tint /= 100;
      out.background = { kind: 'color', color, opacity: Math.min(1, Math.max(0.05, tint)) };
    }
  }

  if (para.borderOn) {
    const color = colorOf(swatches, para.borderColor);
    const weights = Array.isArray(para.borderWeights) ? para.borderWeights.map((w: unknown) => Number(w) || 0) : [];
    const sideNames: Array<'top' | 'left' | 'bottom' | 'right'> = ['top', 'left', 'bottom', 'right'];
    const sides = sideNames.filter((_, i) => (weights[i] || 0) > 0);
    const width = Math.max(0, ...weights);
    if (color && width > 0) out.border = { style: 'solid', widthPt: width, color, sides };
  }

  const padding = offsetsToPadding(para.shadingOffsets) || offsetsToPadding(para.borderOffsets);
  if (padding) out.paddingMm = padding;

  return out;
}

async function readDocument(bytes: Buffer): Promise<any> {
  if (!bytes?.length) throw new TemplateImportError('Файл порожній.');
  if (bytes.length > MAX_TEMPLATE_FILE_BYTES) throw new TemplateImportError('Файл завеликий (понад 40 МБ).');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new TemplateImportError('Це не файл DesignCraft (.designcraft): архів не відкривається.');
  }
  const doc = zip.file('document.json');
  if (!doc) throw new TemplateImportError('У файлі немає document.json — це не документ DesignCraft.');
  const declared = (doc as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === 'number' && declared > MAX_DOCUMENT_JSON_BYTES) {
    throw new TemplateImportError('Документ усередині файла завеликий.');
  }
  const mime = zip.file('mimetype') ? (await zip.file('mimetype')!.async('string')).trim() : '';
  if (mime && !/designcraft/i.test(mime)) throw new TemplateImportError('Це не документ DesignCraft.');
  try {
    return JSON.parse(await doc.async('string'));
  } catch {
    throw new TemplateImportError('document.json пошкоджено: не читається як JSON.');
  }
}

export interface ImportTemplateOptions {
  basedOn: BookDesignThemeId;
  /** Назва користувацького шаблону; типово — з назви документа. */
  name?: string;
}

export async function importDesigncraftTemplate(bytes: Buffer, options: ImportTemplateOptions): Promise<ImportedTemplate> {
  const doc = await readDocument(bytes);
  const paragraph: any[] = Array.isArray(doc?.styles?.paragraph) ? doc.styles.paragraph : [];
  if (!paragraph.length) throw new TemplateImportError('У файлі немає стилів абзаців.');
  const swatches = readSwatches(doc);
  const byName = new Map<string, any>(paragraph.map((s) => [String(s?.name || ''), s]));

  const notesUk: string[] = [];
  const theme = emptyCustomBookDesignTheme(
    String(options.name || '').trim().slice(0, 120) || `Мій шаблон${doc?.title ? ` — ${String(doc.title).slice(0, 60)}` : ''}`
  );
  theme.basedOn = options.basedOn;
  theme.descriptionUk = 'Користувацький шаблон: стилі абзаців імпортовано з DesignCraft.';

  const importedStyles: string[] = [];
  const missingStyles: string[] = [];
  for (const { style, entity } of TEMPLATE_STYLE_ENTITIES) {
    const found = byName.get(style);
    if (!found) {
      missingStyles.push(style);
      continue;
    }
    theme.entities[entity] = entityFromStyle(entity, found, swatches, notesUk, style);
    importedStyles.push(style);
  }

  if (!importedStyles.length) {
    throw new TemplateImportError(
      'У файлі не знайдено жодного стилю Студії (Body, Heading 1, Quote…). Відкрийте копію шаблону зі Студії, правте стилі в ній і збережіть той самий файл.'
    );
  }

  const bodyColor = theme.entities.body?.textColor;
  if (bodyColor) theme.page.textColor = bodyColor;
  const accent = theme.entities['heading-1']?.textColor;
  if (accent) theme.page.accentColor = accent;

  // Те, що потрапить у верстку, проходить ту саму перевірку, що й збережене в книзі.
  const checked = sanitizeCustomDesignTheme(theme);
  if (!checked) throw new TemplateImportError('Шаблон не пройшов перевірку (завеликий або пошкоджений).');
  for (const [key, value] of Object.entries(checked.visuals.entities)) {
    theme.entities[key as DesignerThemeEntity] = value;
  }
  if (safeHexColor(theme.page.textColor) === null) theme.page.textColor = '#1F2937';

  if (missingStyles.length) {
    notesUk.push(`Не знайдено стилів: ${missingStyles.join(', ')} — для них діє базовий шаблон.`);
  }
  return { theme, importedStyles, missingStyles, notesUk };
}
