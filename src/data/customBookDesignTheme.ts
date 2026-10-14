import type { BookDesignThemeId } from './bookDesignThemeCatalog';

export type DesignerFontSource = 'google-fonts' | 'font-url' | 'upload' | 'system';
export type DesignerFontSlot = 'body' | 'heading' | 'mono' | 'display';

export interface DesignerFontAsset {
  slot: DesignerFontSlot;
  source: DesignerFontSource;
  family: string;
  /** Google Fonts CSS URL, direct WOFF/WOFF2/TTF/OTF URL, or future media asset URL. */
  sourceUrl?: string;
  weights: number[];
  styles: Array<'normal' | 'italic'>;
  licenseName?: string;
  licenseUrl?: string;
  fileName?: string;
}

export type DesignerBackgroundKind = 'none' | 'color' | 'gradient' | 'image';

export interface DesignerBackground {
  kind: DesignerBackgroundKind;
  color?: string;
  gradient?: string;
  imageUrl?: string;
  opacity?: number;
  fit?: 'cover' | 'contain' | 'stretch' | 'tile';
}

export type DesignerThemeEntity =
  | 'page'
  | 'chapter-opening'
  | 'running-header'
  | 'running-footer'
  | 'page-number'
  | 'body'
  | 'heading-1'
  | 'heading-2'
  | 'quote'
  | 'epigraph'
  | 'letter'
  | 'inner-thought'
  | 'chat-message'
  | 'scene-break'
  | 'caption'
  | 'location-time'
  | 'system-message'
  | 'evidence'
  | 'lore'
  | 'case-study'
  | 'key-idea'
  | 'footnote'
  | 'illustration'
  | 'table'
  | 'toc'
  | 'character'
  | 'scene'
  | 'conflict';

export type DesignerSemanticSource =
  | 'manual'
  | 'character'
  | 'scene'
  | 'conflict'
  | 'tag'
  | 'paragraph-style';

export type DesignerBlockPlacement =
  | 'inline'
  | 'scene-opening'
  | 'chapter-opening'
  | 'full-width'
  | 'full-page'
  | 'appendix';

export type DesignerBlockRepeat =
  | 'once'
  | 'per-character'
  | 'per-scene'
  | 'per-conflict'
  | 'matched';

export interface DesignerEntityStyle {
  entity: DesignerThemeEntity;
  enabled: boolean;
  fontSlot?: DesignerFontSlot;
  fontSizePt?: number;
  lineHeight?: number;
  fontWeight?: number;
  italic?: boolean;
  uppercase?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  textColor?: string;
  accentColor?: string;
  background?: DesignerBackground;
  border?: {
    style: 'none' | 'solid' | 'double' | 'dashed';
    widthPt?: number;
    color?: string;
    sides?: Array<'top' | 'right' | 'bottom' | 'left'>;
  };
  paddingMm?: { top: number; right: number; bottom: number; left: number };
  marginMm?: { top: number; right: number; bottom: number; left: number };
  radiusMm?: number;
  before?: string;
  after?: string;
}

export interface DesignerCustomBlock {
  id: string;
  name: string;
  descriptionUk?: string;
  source: DesignerSemanticSource;
  /** Optional semantic selector, e.g. character id/name, tag, scene property or conflict kind. */
  selector?: string;
  /** Where the block belongs in the book. Old themes may omit this and use source-derived defaults. */
  placement?: DesignerBlockPlacement;
  /** How often a resolved semantic block may appear. */
  repeat?: DesignerBlockRepeat;
  style: DesignerEntityStyle;
  /** Which entity fields may be surfaced by renderer in the block. */
  fields?: string[];
}

export interface DesignerPageSystem {
  pageBackground: DesignerBackground;
  textColor: string;
  accentColor: string;
  headerHeightMm: number;
  footerHeightMm: number;
  gutterMm: number;
  mirroredMargins: boolean;
}

export interface DesignerChapterOpening {
  align: 'left' | 'center' | 'right';
  showNumber: boolean;
  numberFormat: 'arabic' | 'roman' | 'words' | 'none';
  showLocation: boolean;
  showTime: boolean;
  showPov: boolean;
  showEpigraph: boolean;
  startOn: 'any' | 'recto';
  topSpaceMm: number;
  sceneBreak: string;
}

export interface CustomBookDesignTheme {
  id: string;
  name: string;
  descriptionUk: string;
  basedOn?: BookDesignThemeId;
  version: 2;
  createdAt: string;
  updatedAt: string;
  fonts: DesignerFontAsset[];
  page: DesignerPageSystem;
  chapterOpening: DesignerChapterOpening;
  entities: Partial<Record<DesignerThemeEntity, DesignerEntityStyle>>;
  customBlocks: DesignerCustomBlock[];
  /** Writer has the same capabilities as designer in Theme Studio. */
  editorRoles: Array<'designer' | 'writer'>;
  /** Assets are references only. Binary upload will live in Media Library. */
  assetUrls: string[];
}

export const DESIGNER_THEME_ENTITIES: ReadonlyArray<{ id: DesignerThemeEntity; labelUk: string }> = [
  { id: 'page', labelUk: 'Сторінка' },
  { id: 'chapter-opening', labelUk: 'Початок розділу' },
  { id: 'running-header', labelUk: 'Колонтитул зверху' },
  { id: 'running-footer', labelUk: 'Колонтитул знизу' },
  { id: 'page-number', labelUk: 'Номер сторінки' },
  { id: 'body', labelUk: 'Основний текст' },
  { id: 'heading-1', labelUk: 'Заголовок розділу' },
  { id: 'heading-2', labelUk: 'Заголовок секції' },
  { id: 'quote', labelUk: 'Цитата' },
  { id: 'epigraph', labelUk: 'Епіграф' },
  { id: 'letter', labelUk: 'Лист' },
  { id: 'inner-thought', labelUk: 'Внутрішня думка' },
  { id: 'chat-message', labelUk: 'Повідомлення / чат' },
  { id: 'scene-break', labelUk: 'Розділювач сцени' },
  { id: 'caption', labelUk: 'Підпис ілюстрації' },
  { id: 'location-time', labelUk: 'Локація / час' },
  { id: 'system-message', labelUk: 'Системне повідомлення' },
  { id: 'evidence', labelUk: 'Доказ / досьє' },
  { id: 'lore', labelUk: 'Lore / легенда світу' },
  { id: 'case-study', labelUk: 'Case Study' },
  { id: 'key-idea', labelUk: 'Ключова ідея' },
  { id: 'footnote', labelUk: 'Виноска' },
  { id: 'illustration', labelUk: 'Ілюстрація' },
  { id: 'table', labelUk: 'Таблиця' },
  { id: 'toc', labelUk: 'Зміст' },
  { id: 'character', labelUk: 'Персонаж' },
  { id: 'scene', labelUk: 'Сцена' },
  { id: 'conflict', labelUk: 'Конфлікт' },
] as const;

export function emptyCustomBookDesignTheme(name = 'Моя тема'): CustomBookDesignTheme {
  const now = new Date().toISOString();
  return {
    id: `custom-${Date.now().toString(36)}`,
    name,
    descriptionUk: '',
    version: 2,
    createdAt: now,
    updatedAt: now,
    fonts: [
      { slot: 'body', source: 'system', family: 'DejaVu Serif', weights: [400, 700], styles: ['normal', 'italic'] },
      { slot: 'heading', source: 'system', family: 'DejaVu Sans', weights: [400, 700], styles: ['normal'] },
      { slot: 'mono', source: 'system', family: 'DejaVu Sans Mono', weights: [400, 700], styles: ['normal'] },
      { slot: 'display', source: 'system', family: 'DejaVu Sans', weights: [700], styles: ['normal'] },
    ],
    page: {
      pageBackground: { kind: 'color', color: '#fffdf8', opacity: 1 },
      textColor: '#1f2937',
      accentColor: '#0f766e',
      headerHeightMm: 8,
      footerHeightMm: 8,
      gutterMm: 4,
      mirroredMargins: true,
    },
    chapterOpening: {
      align: 'left',
      showNumber: true,
      numberFormat: 'arabic',
      showLocation: false,
      showTime: false,
      showPov: false,
      showEpigraph: false,
      startOn: 'any',
      topSpaceMm: 24,
      sceneBreak: '· · ·',
    },
    entities: {},
    customBlocks: [],
    editorRoles: ['designer', 'writer'],
    assetUrls: [],
  };
}

export function cloneCustomBookDesignTheme(theme: CustomBookDesignTheme): CustomBookDesignTheme {
  const now = new Date().toISOString();
  const cloned = JSON.parse(JSON.stringify(theme)) as CustomBookDesignTheme;
  return {
    ...cloned,
    version: 2,
    customBlocks: cloned.customBlocks || [],
    editorRoles: ['designer', 'writer'],
    id: `custom-${Date.now().toString(36)}`,
    name: `${theme.name} — копія`,
    createdAt: now,
    updatedAt: now,
  };
}
