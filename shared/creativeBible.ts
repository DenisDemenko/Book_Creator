/** Versioned, declarative visual continuity; no executable prompts or credentials. */
export const BIBLE_CATEGORIES = [
  "character",
  "location",
  "object",
  "costume",
  "transport",
  "architecture",
  "creature",
  "symbol",
  "palette",
  "cover",
] as const;
export type BibleCategory = (typeof BIBLE_CATEGORIES)[number];
export const VISUAL_FIELDS = [
  "description",
  "angle",
  "expression",
  "clothing",
  "visualAge",
  "keyFeatures",
  "forbiddenChanges",
  "timeOfDay",
  "season",
  "architecture",
  "lighting",
  "materials",
  "colors",
  "weather",
  "keyObjects",
  "forbiddenElements",
] as const;
export const STYLE_FIELDS = [
  "genre",
  "mood",
  "visualTone",
  "emotionalTone",
  "primaryPalette",
  "secondaryPalette",
  "accentPalette",
  "prohibitedColors",
  "lighting",
  "contrast",
  "composition",
  "framing",
  "cameraDistance",
  "titleSafeZones",
  "visualLanguage",
  "prohibitedStyles",
] as const;
export type VisualRules = Partial<
  Record<(typeof VISUAL_FIELDS)[number], string>
>;
export type StyleRules = Partial<Record<(typeof STYLE_FIELDS)[number], string>>;
export interface BibleEntry {
  id: string;
  bookId: string;
  category: BibleCategory;
  entityId: string | null;
  assetId: string;
  linkId: string | null;
  appearanceVersionId: string | null;
  title: string;
  master: boolean;
  rules: VisualRules;
  revision: number;
  active: boolean;
  addedBy: string;
  addedAt: string;
  removedBy: string | null;
  removedAt: string | null;
  styleVersionId: string | null;
  sceneIds: string[];
  snapshot: {
    assetVersion: number;
    mimeType: string;
    provenance: unknown;
    appearance: unknown;
    link: unknown;
  };
}
export interface StyleVersion {
  id: string;
  bookId: string;
  version: number;
  title: string;
  rules: StyleRules;
  createdBy: string;
  createdAt: string;
}
export class BibleInputError extends Error {}
export function normalizeRules<T extends string>(
  raw: unknown,
  keys: readonly T[],
): Partial<Record<T, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new BibleInputError("Правила мають бути об’єктом.");
  const result: Partial<Record<T, string>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (
      !keys.includes(k as T) ||
      typeof v !== "string" ||
      v.length > 2000 ||
      /\u0000/.test(v)
    )
      throw new BibleInputError("Невідоме поле або завелике значення правил.");
    result[k as T] = v.trim();
  }
  return result;
}
