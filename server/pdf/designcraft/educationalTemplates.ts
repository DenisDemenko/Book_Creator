import type { BookDesignThemeId } from './themes';

export type EducationalDocumentType = 'methodic' | 'instruction' | 'worksheet';

export type EducationalPdfTemplateId =
  | 'methodic-classic'
  | 'methodic-modern'
  | 'methodic-visual-pro'
  | 'instruction-clear-steps'
  | 'instruction-visual-flow'
  | 'instruction-compact-manual'
  | 'worksheet-clean'
  | 'worksheet-interactive'
  | 'worksheet-project-sheet';

export interface EducationalTemplateRenderProfile {
  id: EducationalPdfTemplateId;
  documentType: EducationalDocumentType;
  rendererBaseTheme: BookDesignThemeId;
  /**
   * Stable semantic style family. It is intentionally descriptive rather
   * than a set of raw DesignCraft commands: the educational adapter may add
   * block-level commands later without changing the public template id.
   */
  styleFamily:
    | 'methodic-classic'
    | 'methodic-cards'
    | 'methodic-visual'
    | 'instruction-steps'
    | 'instruction-flow'
    | 'instruction-compact'
    | 'worksheet-clean'
    | 'worksheet-interactive'
    | 'worksheet-project';
}

/**
 * Server-side mirror of the client template registry.
 *
 * Educational templates are first-class public ids, but the current
 * authoritative DesignCraft renderer already has a mature typography/theme
 * layer. Mapping to a proven base theme lets the new document kinds enter the
 * renderer additively while educational semantic block styling is expanded in
 * subsequent adapters. Existing book theme ids remain untouched.
 */
export const EDUCATIONAL_TEMPLATE_RENDER_PROFILES: readonly EducationalTemplateRenderProfile[] = [
  { id: 'methodic-classic', documentType: 'methodic', rendererBaseTheme: 'academic-research', styleFamily: 'methodic-classic' },
  { id: 'methodic-modern', documentType: 'methodic', rendererBaseTheme: 'non-fiction', styleFamily: 'methodic-cards' },
  { id: 'methodic-visual-pro', documentType: 'methodic', rendererBaseTheme: 'business-premium', styleFamily: 'methodic-visual' },
  { id: 'instruction-clear-steps', documentType: 'instruction', rendererBaseTheme: 'non-fiction', styleFamily: 'instruction-steps' },
  { id: 'instruction-visual-flow', documentType: 'instruction', rendererBaseTheme: 'graphic-story', styleFamily: 'instruction-flow' },
  { id: 'instruction-compact-manual', documentType: 'instruction', rendererBaseTheme: 'academic-research', styleFamily: 'instruction-compact' },
  { id: 'worksheet-clean', documentType: 'worksheet', rendererBaseTheme: 'academic-research', styleFamily: 'worksheet-clean' },
  { id: 'worksheet-interactive', documentType: 'worksheet', rendererBaseTheme: 'children', styleFamily: 'worksheet-interactive' },
  { id: 'worksheet-project-sheet', documentType: 'worksheet', rendererBaseTheme: 'business-premium', styleFamily: 'worksheet-project' },
] as const;

export function findEducationalTemplateRenderProfile(
  id: string | null | undefined,
): EducationalTemplateRenderProfile | null {
  if (!id) return null;
  return EDUCATIONAL_TEMPLATE_RENDER_PROFILES.find((profile) => profile.id === id) || null;
}

export function resolveEducationalRendererTheme(
  id: string | null | undefined,
): BookDesignThemeId | null {
  return findEducationalTemplateRenderProfile(id)?.rendererBaseTheme || null;
}
