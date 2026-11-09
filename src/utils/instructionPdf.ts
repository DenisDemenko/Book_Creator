import type { Book, InstructionPdfLayout } from '../types';
import { EDUCATIONAL_PDF_TEMPLATES, type EducationalPdfTemplateId } from '../data/educationalPdfTemplates';
import { BOOK_DESIGN_THEME_CARDS, applyBookDesignTheme, type BookDesignThemeId } from '../data/bookDesignThemeCatalog';

/**
 * PDF з інструкції за обраним шаблоном верстки й рушієм (запит власника 09.11.2026): людина вибирає один з наявних
 * шаблонів Студії і рушій, а вибір ЗБЕРІГАЄТЬСЯ в документі інструкції (`Instruction.pdfLayout`) — наступного разу
 * діалог відкриється з ним, а книга, створена з цього документа, одразу матиме цей шаблон.
 *
 * Шаблони — ті, що вже є в Студії, нічого нового не вигадано:
 *  - три навчальні шаблони для інструкцій (`educationalPdfTemplates`: Clear Steps, Visual Flow, Compact Manual) —
 *    вони спираються на вбудований шаблон книги (`rendererBaseTheme`);
 *  - усі вбудовані шаблони книги (`BOOK_DESIGN_THEME_CARDS`).
 * Рушій приймає лише шаблон книги (`layoutConfig.bookDesignThemeId`), тож навчальний шаблон застосовується через
 * його базовий шаблон; сам id навчального шаблону лишається в `pdfLayout` для рушіїв, що вміють його читати.
 */

export interface InstructionPdfTemplateOption {
  /** `edu:<id>` для навчального шаблону, `book:<id>` для шаблону книги — стабільний ключ вибору. */
  key: string;
  group: 'instruction' | 'book';
  label: string;
  description: string;
  designThemeId: BookDesignThemeId;
  educationalTemplateId?: EducationalPdfTemplateId;
}

export const DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY = 'edu:instruction-clear-steps';

export function instructionPdfTemplates(): InstructionPdfTemplateOption[] {
  const instruction = EDUCATIONAL_PDF_TEMPLATES.filter((t) => t.documentType === 'instruction').map(
    (t): InstructionPdfTemplateOption => ({
      key: `edu:${t.id}`,
      group: 'instruction',
      label: t.labelUk,
      description: t.descriptionUk,
      designThemeId: t.rendererBaseTheme,
      educationalTemplateId: t.id,
    })
  );
  const book = BOOK_DESIGN_THEME_CARDS.map(
    (c): InstructionPdfTemplateOption => ({
      key: `book:${c.id}`,
      group: 'book',
      label: c.label,
      description: c.taglineUk,
      designThemeId: c.id,
    })
  );
  return [...instruction, ...book];
}

export function instructionPdfTemplateByKey(key: string | undefined | null): InstructionPdfTemplateOption | undefined {
  return instructionPdfTemplates().find((t) => t.key === key);
}

/** Ключ шаблону для діалогу: збережений у документі, якщо він ще існує, інакше типовий. */
export function templateKeyForLayout(layout: InstructionPdfLayout | undefined | null): string {
  return instructionPdfTemplateByKey(layout?.templateKey)?.key ?? DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY;
}

/** Вибір у діалозі → те, що лягає в документ інструкції. Невідомий шаблон → типовий. */
export function buildInstructionPdfLayout(templateKey: string, engineId: string, now: Date = new Date()): InstructionPdfLayout {
  const t = instructionPdfTemplateByKey(templateKey) ?? instructionPdfTemplateByKey(DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY)!;
  return {
    engineId,
    templateKey: t.key,
    designThemeId: t.designThemeId,
    ...(t.educationalTemplateId ? { educationalTemplateId: t.educationalTemplateId } : {}),
    updatedAt: now.toISOString(),
  };
}

/** Книга з застосованим шаблоном (вхідну не змінює). */
export function applyInstructionPdfLayout(book: Book, layout: InstructionPdfLayout): Book {
  return { ...book, layoutConfig: applyBookDesignTheme(book.layoutConfig, layout.designThemeId as BookDesignThemeId) };
}
