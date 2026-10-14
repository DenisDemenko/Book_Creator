import type {
  EducationalDocumentType,
  EducationalPdfTemplateId,
  EducationalSemanticEntity,
} from './educationalPdfTemplates';

export type EducationalAudience = 'student' | 'teacher' | 'both';

export interface EducationalDocumentMediaRef {
  assetId?: string;
  url?: string;
  altText?: string;
  caption?: string;
}

export interface EducationalDocumentBlock {
  /** Stable id: content/progress must not depend on array index. */
  id: string;
  entity: EducationalSemanticEntity;
  title?: string;
  body?: string;
  items?: string[];
  audience?: EducationalAudience;
  media?: EducationalDocumentMediaRef[];
  meta?: Record<string, string | number | boolean | null>;
}

export interface EducationalLesson {
  id: string;
  title: string;
  durationMinutes?: number;
  blocks: EducationalDocumentBlock[];
}

export interface EducationalModule {
  id: string;
  title: string;
  summary?: string;
  lessons: EducationalLesson[];
}

/**
 * Shared semantic source for a course-derived printable document.
 *
 * The same content can be projected into a student course, a teacher guide,
 * an instruction or a worksheet. Design remains a separate layer selected by
 * `templateId`; the content model never stores renderer commands.
 */
export interface EducationalDocument {
  id: string;
  documentType: EducationalDocumentType;
  templateId?: EducationalPdfTemplateId;
  title: string;
  subtitle?: string;
  targetAudience?: string[];
  learningResults?: string[];
  duration?: string;
  format?: string;
  modules: EducationalModule[];
  appendix?: EducationalDocumentBlock[];
}

export function educationalBlockVisibleTo(
  block: EducationalDocumentBlock,
  audience: Exclude<EducationalAudience, 'both'>,
): boolean {
  return !block.audience || block.audience === 'both' || block.audience === audience;
}

export function projectEducationalDocumentForAudience(
  document: EducationalDocument,
  audience: Exclude<EducationalAudience, 'both'>,
): EducationalDocument {
  return {
    ...document,
    modules: document.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        blocks: lesson.blocks.filter((block) => educationalBlockVisibleTo(block, audience)),
      })),
    })),
    appendix: document.appendix?.filter((block) => educationalBlockVisibleTo(block, audience)),
  };
}

export function educationalDocumentStats(document: EducationalDocument): {
  modules: number;
  lessons: number;
  blocks: number;
} {
  let lessons = 0;
  let blocks = document.appendix?.length ?? 0;

  for (const module of document.modules) {
    lessons += module.lessons.length;
    for (const lesson of module.lessons) blocks += lesson.blocks.length;
  }

  return { modules: document.modules.length, lessons, blocks };
}
