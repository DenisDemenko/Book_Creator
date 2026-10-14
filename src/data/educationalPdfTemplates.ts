import type { BookDesignThemeId } from './bookDesignThemeCatalog';

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

export type EducationalSemanticEntity =
  | 'course-title'
  | 'module-title'
  | 'lesson-title'
  | 'learning-goal'
  | 'learning-result'
  | 'theory'
  | 'example'
  | 'step'
  | 'practice'
  | 'project'
  | 'homework'
  | 'question'
  | 'test'
  | 'reflection'
  | 'materials'
  | 'equipment'
  | 'warning'
  | 'safety'
  | 'checklist'
  | 'teacher-note'
  | 'common-mistake'
  | 'assessment'
  | 'additional-resource';

export interface EducationalPdfTemplate {
  id: EducationalPdfTemplateId;
  documentType: EducationalDocumentType;
  labelUk: string;
  shortLabelUk: string;
  descriptionUk: string;
  recommendedFor: readonly string[];
  rendererBaseTheme: BookDesignThemeId;
  preview: {
    layout: 'classic' | 'cards' | 'visual' | 'steps' | 'flow' | 'compact' | 'worksheet' | 'interactive' | 'project';
    density: 'airy' | 'balanced' | 'compact';
    headingAlign: 'left' | 'center';
    accentColor: string;
    paperColor: string;
  };
  defaultEntities: readonly EducationalSemanticEntity[];
}

const METHODIC_COMMON: readonly EducationalSemanticEntity[] = [
  'learning-goal',
  'learning-result',
  'materials',
  'equipment',
  'practice',
  'assessment',
  'teacher-note',
  'common-mistake',
  'additional-resource',
];

const INSTRUCTION_COMMON: readonly EducationalSemanticEntity[] = [
  'learning-goal',
  'materials',
  'equipment',
  'step',
  'warning',
  'safety',
  'checklist',
  'common-mistake',
];

const WORKSHEET_COMMON: readonly EducationalSemanticEntity[] = [
  'learning-goal',
  'theory',
  'practice',
  'homework',
  'question',
  'reflection',
  'checklist',
  'assessment',
];

/**
 * Client-safe catalog of educational PDF design systems.
 *
 * These are separate from the 15 built-in BOOK themes on purpose: a course
 * document has its own semantic vocabulary, while DesignCraft may still use
 * a proven book theme as the low-level typography/rendering base.
 */
export const EDUCATIONAL_PDF_TEMPLATES: readonly EducationalPdfTemplate[] = [
  {
    id: 'methodic-classic',
    documentType: 'methodic',
    labelUk: 'Methodic Classic',
    shortLabelUk: 'Classic',
    descriptionUk: 'Стримана академічна методичка з чіткою ієрархією та високою читабельністю.',
    recommendedFor: ['школи', 'формальні програми', 'навчальні центри', 'текстові методички'],
    rendererBaseTheme: 'academic-research',
    preview: { layout: 'classic', density: 'balanced', headingAlign: 'left', accentColor: '#334155', paperColor: '#fffdf8' },
    defaultEntities: METHODIC_COMMON,
  },
  {
    id: 'methodic-modern',
    documentType: 'methodic',
    labelUk: 'Methodic Modern',
    shortLabelUk: 'Modern',
    descriptionUk: 'Сучасна карткова методичка з акцентними блоками для STEAM та онлайн-курсів.',
    recommendedFor: ['STEAM', 'онлайн-курси', 'творчі програми', 'сучасна освіта'],
    rendererBaseTheme: 'non-fiction',
    preview: { layout: 'cards', density: 'balanced', headingAlign: 'left', accentColor: '#0f766e', paperColor: '#f8fafc' },
    defaultEntities: [...METHODIC_COMMON, 'reflection', 'checklist'],
  },
  {
    id: 'methodic-visual-pro',
    documentType: 'methodic',
    labelUk: 'Methodic Visual Pro',
    shortLabelUk: 'Visual Pro',
    descriptionUk: 'Візуально насичена методичка з таймінгом, схемами, safety та великими ілюстраціями.',
    recommendedFor: ['технічні курси', 'майстерні', 'лабораторії', 'практичні заняття'],
    rendererBaseTheme: 'business-premium',
    preview: { layout: 'visual', density: 'airy', headingAlign: 'left', accentColor: '#c2410c', paperColor: '#fff7ed' },
    defaultEntities: [...METHODIC_COMMON, 'safety', 'example'],
  },
  {
    id: 'instruction-clear-steps',
    documentType: 'instruction',
    labelUk: 'Instruction Clear Steps',
    shortLabelUk: 'Clear Steps',
    descriptionUk: 'Максимально зрозуміла покрокова інструкція з великими номерами та контрольними точками.',
    recommendedFor: ['збірка', 'технічні роботи', 'виробництво', 'навчальні інструкції'],
    rendererBaseTheme: 'non-fiction',
    preview: { layout: 'steps', density: 'balanced', headingAlign: 'left', accentColor: '#047857', paperColor: '#ffffff' },
    defaultEntities: INSTRUCTION_COMMON,
  },
  {
    id: 'instruction-visual-flow',
    documentType: 'instruction',
    labelUk: 'Instruction Visual Flow',
    shortLabelUk: 'Visual Flow',
    descriptionUk: 'Інструкція зі схемами, step-cards, великими фото та візуальним рухом між діями.',
    recommendedFor: ['DIY', 'обладнання', 'майстер-класи', 'складні процеси'],
    rendererBaseTheme: 'graphic-story',
    preview: { layout: 'flow', density: 'airy', headingAlign: 'left', accentColor: '#2563eb', paperColor: '#f8fafc' },
    defaultEntities: [...INSTRUCTION_COMMON, 'example', 'additional-resource'],
  },
  {
    id: 'instruction-compact-manual',
    documentType: 'instruction',
    labelUk: 'Instruction Compact Manual',
    shortLabelUk: 'Compact Manual',
    descriptionUk: 'Щільний технічний мануал для коротких інструкцій, регламентів і друку.',
    recommendedFor: ['короткі мануали', 'регламенти', 'сервісні інструкції', 'чеклісти'],
    rendererBaseTheme: 'academic-research',
    preview: { layout: 'compact', density: 'compact', headingAlign: 'left', accentColor: '#475569', paperColor: '#ffffff' },
    defaultEntities: INSTRUCTION_COMMON,
  },
  {
    id: 'worksheet-clean',
    documentType: 'worksheet',
    labelUk: 'Homework Clean Worksheet',
    shortLabelUk: 'Clean Worksheet',
    descriptionUk: 'Чистий друкований робочий лист з великою кількістю місця для відповіді.',
    recommendedFor: ['домашні завдання', 'шкільні вправи', 'друковані робочі листи'],
    rendererBaseTheme: 'academic-research',
    preview: { layout: 'worksheet', density: 'airy', headingAlign: 'left', accentColor: '#334155', paperColor: '#ffffff' },
    defaultEntities: WORKSHEET_COMMON,
  },
  {
    id: 'worksheet-interactive',
    documentType: 'worksheet',
    labelUk: 'Homework Interactive Blocks',
    shortLabelUk: 'Interactive Blocks',
    descriptionUk: 'Картковий робочий лист із підказками, рефлексією та різними типами активностей.',
    recommendedFor: ['онлайн-курси', 'діти', 'творчі завдання', 'самостійна робота'],
    rendererBaseTheme: 'children',
    preview: { layout: 'interactive', density: 'balanced', headingAlign: 'left', accentColor: '#7c3aed', paperColor: '#faf5ff' },
    defaultEntities: [...WORKSHEET_COMMON, 'example', 'additional-resource'],
  },
  {
    id: 'worksheet-project-sheet',
    documentType: 'worksheet',
    labelUk: 'Homework Project Sheet',
    shortLabelUk: 'Project Sheet',
    descriptionUk: 'Проєктний аркуш для STEAM, DIY та інженерних завдань із планом, матеріалами й самооцінкою.',
    recommendedFor: ['STEAM', 'DIY', 'інженерні проєкти', 'проєктне навчання'],
    rendererBaseTheme: 'business-premium',
    preview: { layout: 'project', density: 'balanced', headingAlign: 'left', accentColor: '#ea580c', paperColor: '#fffbeb' },
    defaultEntities: [...WORKSHEET_COMMON, 'project', 'materials', 'equipment', 'safety'],
  },
] as const;

export function educationalPdfTemplatesFor(type: EducationalDocumentType): readonly EducationalPdfTemplate[] {
  return EDUCATIONAL_PDF_TEMPLATES.filter((template) => template.documentType === type);
}

export function findEducationalPdfTemplate(id: string | null | undefined): EducationalPdfTemplate | null {
  if (!id) return null;
  return EDUCATIONAL_PDF_TEMPLATES.find((template) => template.id === id) || null;
}

export function isEducationalPdfTemplateId(value: string): value is EducationalPdfTemplateId {
  return EDUCATIONAL_PDF_TEMPLATES.some((template) => template.id === value);
}
