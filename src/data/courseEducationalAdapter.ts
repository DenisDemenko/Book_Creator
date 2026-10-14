import type { CourseAssignment, CourseLessonV2, CourseModuleV2, CourseV2 } from '../types';
import type {
  EducationalDocument,
  EducationalDocumentBlock,
  EducationalLesson,
  EducationalModule,
} from './educationalDocument';
import type {
  EducationalDocumentType,
  EducationalPdfTemplateId,
  EducationalSemanticEntity,
} from './educationalPdfTemplates';

function cleanLines(lines: readonly string[] | undefined): string[] {
  return (lines || []).map((line) => String(line || '').trim()).filter(Boolean);
}

function block(
  id: string,
  entity: EducationalSemanticEntity,
  title: string,
  options: Omit<EducationalDocumentBlock, 'id' | 'entity' | 'title'> = {},
): EducationalDocumentBlock {
  return { id, entity, title, ...options };
}

function assignmentBlocks(
  assignment: CourseAssignment,
  prefix: string,
  entity: 'practice' | 'homework' | 'project',
): EducationalDocumentBlock[] {
  const result: EducationalDocumentBlock[] = [];
  const steps = cleanLines(assignment.steps);
  const criteria = cleanLines(assignment.acceptanceCriteria);

  result.push(
    block(`${prefix}-task`, entity, assignment.title || (entity === 'project' ? 'Проєкт' : 'Завдання'), {
      body: assignment.brief || undefined,
      items: steps.length ? steps : undefined,
      audience: 'both',
      meta: {
        ...(assignment.deliverable ? { deliverable: assignment.deliverable } : {}),
        ...(assignment.estimateMin ? { estimateMin: assignment.estimateMin } : {}),
      },
    }),
  );

  if (criteria.length) {
    result.push(
      block(`${prefix}-criteria`, 'assessment', 'Критерії виконання', {
        items: criteria,
        audience: 'both',
      }),
    );
  }

  if (assignment.deliverable) {
    result.push(
      block(`${prefix}-checklist`, 'checklist', 'Що потрібно здати', {
        items: [assignment.deliverable],
        audience: 'both',
      }),
    );
  }

  return result;
}

function lessonBlocks(lesson: CourseLessonV2, type: EducationalDocumentType): EducationalDocumentBlock[] {
  const blocks: EducationalDocumentBlock[] = [];
  const topics = cleanLines(lesson.topics);

  if (lesson.goal?.trim()) {
    blocks.push(
      block(`${lesson.id}-goal`, 'learning-goal', 'Мета уроку', {
        body: lesson.goal.trim(),
        audience: 'both',
      }),
    );
  }

  if (lesson.description?.trim()) {
    blocks.push(
      block(`${lesson.id}-theory`, 'theory', type === 'instruction' ? 'Пояснення' : 'Теорія', {
        body: lesson.description.trim(),
        audience: 'both',
      }),
    );
  }

  if (topics.length) {
    blocks.push(
      block(`${lesson.id}-topics`, type === 'instruction' ? 'step' : 'theory', type === 'instruction' ? 'Послідовність' : 'Зміст уроку', {
        items: topics,
        audience: 'both',
      }),
    );
  }

  if (lesson.videoUrl?.trim()) {
    blocks.push(
      block(`${lesson.id}-video`, 'additional-resource', 'Відео', {
        audience: 'both',
        media: [{ url: lesson.videoUrl.trim(), caption: lesson.title }],
        meta: { mediaKind: 'video' },
      }),
    );
  }

  const photos = cleanLines(lesson.photoUrls);
  if (photos.length) {
    blocks.push(
      block(`${lesson.id}-photos`, 'example', 'Ілюстрації та приклади', {
        audience: 'both',
        media: photos.map((url) => ({ url, altText: lesson.title })),
      }),
    );
  }

  if (lesson.assignment) {
    const assignmentEntity = type === 'worksheet' ? 'homework' : type === 'instruction' ? 'practice' : 'practice';
    blocks.push(...assignmentBlocks(lesson.assignment, `${lesson.id}-assignment`, assignmentEntity));
  }

  return blocks;
}

function lessonOf(lesson: CourseLessonV2, type: EducationalDocumentType): EducationalLesson {
  return {
    id: lesson.id,
    title: lesson.title || 'Урок без назви',
    durationMinutes: lesson.durationMin,
    blocks: lessonBlocks(lesson, type),
  };
}

function moduleOf(module: CourseModuleV2, type: EducationalDocumentType): EducationalModule {
  const lessons = module.lessons.map((lesson) => lessonOf(lesson, type));

  if (module.finalAssignment) {
    const finalLesson: EducationalLesson = {
      id: `${module.id}-final`,
      title: module.finalAssignment.title || 'Підсумкова робота',
      durationMinutes: module.finalAssignment.estimateMin,
      blocks: assignmentBlocks(module.finalAssignment, `${module.id}-final`, 'project'),
    };
    lessons.push(finalLesson);
  }

  return {
    id: module.id,
    title: module.title || 'Модуль без назви',
    summary: module.summary,
    lessons,
  };
}

/**
 * Pure adapter: CourseV2 remains the source of truth and is never mutated.
 * Methodic, instruction and worksheet are views of the same course data.
 */
export function courseToEducationalDocument(
  course: CourseV2,
  documentType: EducationalDocumentType,
  templateId?: EducationalPdfTemplateId,
): EducationalDocument {
  return {
    id: `${course.id}-${documentType}`,
    documentType,
    templateId,
    title: course.title,
    subtitle: course.subtitle,
    targetAudience: cleanLines(course.audience),
    learningResults: cleanLines(course.outcomes),
    modules: course.modules.map((module) => moduleOf(module, documentType)),
    appendix: [
      ...(cleanLines(course.outcomes).length
        ? [
            block(`${course.id}-outcomes`, 'learning-result', 'Результати навчання', {
              items: cleanLines(course.outcomes),
              audience: 'both',
            }),
          ]
        : []),
      ...(course.skills.length
        ? [
            block(`${course.id}-skills`, 'additional-resource', 'Навички курсу', {
              items: course.skills.map((skill) => skill.name).filter(Boolean),
              audience: 'teacher',
            }),
          ]
        : []),
    ],
  };
}

type DesigncraftEducationalStyle =
  | 'Body'
  | 'Quote'
  | 'LocationTime'
  | 'SystemMessage'
  | 'Evidence'
  | 'Lore'
  | 'CaseStudy'
  | 'KeyIdea'
  | 'Footnote';

function stripStyleMarkup(value: string): string {
  return value.replace(/\[\/?STYLE[^\]]*\]/gi, '').trim();
}

function styleMarker(style: DesigncraftEducationalStyle, value: string): string {
  const text = stripStyleMarkup(value);
  return text ? `[STYLE:${style}]${text}[/STYLE]` : '';
}

/**
 * Map the educational vocabulary to the renderer's existing semantic styles.
 * The public educational template stays independent from the 15 book themes;
 * this only reuses the mature DesignCraft paragraph-style protocol.
 *
 * A few entities deliberately vary by template: e.g. an instruction step is
 * a technical strip in Clear Steps, a boxed system block in Visual Flow, and
 * a compact key idea in Compact Manual. This makes educational templates
 * differ at block level rather than only by base typography.
 */
function designcraftStyleForBlock(
  entity: EducationalSemanticEntity,
  templateId: EducationalPdfTemplateId | undefined,
): DesigncraftEducationalStyle {
  switch (entity) {
    case 'learning-goal':
    case 'learning-result':
      return 'KeyIdea';
    case 'theory':
      return templateId === 'methodic-visual-pro' ? 'Lore' : 'Body';
    case 'example':
      return 'CaseStudy';
    case 'step':
      if (templateId === 'instruction-visual-flow') return 'SystemMessage';
      if (templateId === 'instruction-compact-manual') return 'KeyIdea';
      return 'LocationTime';
    case 'practice':
    case 'project':
      return 'CaseStudy';
    case 'homework':
      return templateId === 'worksheet-interactive' ? 'KeyIdea' : 'CaseStudy';
    case 'question':
    case 'reflection':
      return templateId === 'worksheet-interactive' ? 'KeyIdea' : 'Quote';
    case 'materials':
    case 'equipment':
      return 'SystemMessage';
    case 'warning':
    case 'safety':
    case 'common-mistake':
      return 'Evidence';
    case 'checklist':
    case 'assessment':
      return 'Evidence';
    case 'teacher-note':
      return 'KeyIdea';
    case 'additional-resource':
      return 'Footnote';
    default:
      return 'Body';
  }
}

function blockToDesigncraftText(
  item: EducationalDocumentBlock,
  templateId: EducationalPdfTemplateId | undefined,
): string {
  const style = designcraftStyleForBlock(item.entity, templateId);
  const title = item.title ? styleMarker(style, item.title) : '';
  const body = item.body ? styleMarker(style, item.body) : '';
  const items = (item.items || []).map((line, index) => styleMarker(style, `${index + 1}. ${line}`));
  const media = (item.media || []).map((mediaItem) =>
    styleMarker('Footnote', mediaItem.caption || mediaItem.url || ''),
  );
  return [title, body, ...items, ...media].filter(Boolean).join('\n\n');
}

/**
 * Compatibility projection for the current authoritative DesignCraft preview,
 * which consumes a Book-shaped payload. It carries educational content only;
 * it does not turn the course into a stored Book and never mutates the course.
 *
 * Semantic educational entities are materialized as DesignCraft STYLE markers
 * in this transient preview copy. The stored course/document remains clean.
 */
export function educationalDocumentToPreviewBook(document: EducationalDocument): Record<string, unknown> {
  return {
    id: document.id,
    title: document.title || 'Навчальний документ',
    subtitle: document.subtitle || '',
    author: '',
    language: 'uk',
    genre: 'education',
    synopsis: '',
    logline: '',
    theme: 'education',
    status: 'draft',
    chapters: document.modules.map((module, moduleIndex) => ({
      id: module.id,
      title: module.title,
      order: moduleIndex,
      sections: module.lessons.map((lesson, lessonIndex) => ({
        id: lesson.id,
        title: lesson.title,
        order: lessonIndex,
        content: [
          module.summary ? styleMarker('Body', module.summary) : '',
          ...lesson.blocks.map((item) => blockToDesigncraftText(item, document.templateId)),
        ]
          .filter(Boolean)
          .join('\n\n'),
      })),
    })),
    characters: [],
    illustrations: [],
    visualBible: {
      id: `${document.id}-visual`,
      bookId: document.id,
      styleName: 'Educational',
      artStyle: '',
      colorPalette: [],
      lighting: '',
      mood: '',
      referenceNotes: '',
      keyMotifs: [],
      aspectRatio: '3:4',
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}
