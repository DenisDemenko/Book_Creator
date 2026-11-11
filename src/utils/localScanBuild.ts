/**
 * З результату локального розкладання (shared/localScanStructure.ts) — справжні ПРИВАТНІ матеріали Studio (журнал #550):
 * курс (`CourseV2`), інструкція (`Instruction`), книга (`Book`). Кожен має `privateStore` і лягає лише на локальний сервер автора.
 * Функції чисті: час і ідентифікатори приходять ззовні, браузерних залежностей немає.
 */
import type { Book, CourseV2, Instruction, InstructionDocType, Section } from '../types';
import type { LocalBook, LocalCourse, LocalInstruction } from '../../shared/localScanStructure';
import { createEmptyInstruction, createEmptyStep, instructionUid } from './instructionDraft';
import { buildBookFromInstructionPayload } from './instructionBook';
import { calculateWordCount } from './helpers';

const uid = (prefix: string, salt: string): string => `${prefix}-${salt}`;

/** Приватний курс: статус «чернетка», без ціни й публікації (їх у приватного курсу немає). */
export function buildPrivateCourse(course: LocalCourse, opts: { storeId: string; id: string; now: Date; origin?: { draftId: string } }): CourseV2 {
  const at = opts.now.toISOString();
  const salt = opts.id.replace(/^crs_/, '').slice(0, 8);
  let counter = 0;
  const next = () => (counter++).toString(36);
  return {
    id: opts.id,
    ownerId: 'local',
    status: 'draft',
    title: course.title || 'Курс із документа',
    summary: course.summary || undefined,
    audience: course.audience,
    outcomes: course.outcomes,
    highlights: ['', '', ''],
    skills: [],
    modules: course.modules.map((m) => ({
      id: uid('mo', `${salt}-${next()}`),
      title: m.title,
      summary: m.summary || undefined,
      skillIds: [],
      lessons: m.lessons.map((l) => ({
        id: uid('le', `${salt}-${next()}`),
        title: l.title,
        description: l.body,
        topics: l.topics,
        photoUrls: [],
      })),
    })),
    createdAt: at,
    updatedAt: at,
    privateStore: { storeId: opts.storeId },
  };
}

/** Приватна інструкція: тип «складання» чи «користування» з форми, рядки правил — у поля документа. */
export function buildPrivateInstruction(ins: LocalInstruction, opts: { storeId: string; docId: string; now: Date; mode?: 'assembly' | 'operation' | null }): Instruction {
  const docType: InstructionDocType = opts.mode === 'operation' ? 'usage' : 'assembly';
  const base = createEmptyInstruction(docType);
  return {
    ...base,
    title: ins.title,
    modelCode: ins.modelCode,
    description: ins.description,
    materials: ins.materials.length ? ins.materials.map((m) => ({ id: instructionUid('mat'), code: m.code || '', name: m.name, qty: m.qty || '1' })) : base.materials,
    tools: ins.tools.length ? ins.tools : base.tools,
    warnings: ins.warnings.length ? ins.warnings : base.warnings,
    steps: ins.steps.length ? ins.steps.map((s) => ({ ...createEmptyStep(), title: s.title, description: s.description, warning: s.warning })) : base.steps,
    finalChecks: ins.finalChecks.length ? ins.finalChecks : base.finalChecks,
    updatedAt: opts.now.toISOString(),
    privateStore: { storeId: opts.storeId, docId: opts.docId },
  };
}

/** Приватна книга: розділи й секції з рукопису. Основу (id, версія, тема) дає загальне складання книги з документа. */
export function buildPrivateBook(book: LocalBook, opts: { storeId: string; author: string; now: Date }): Book {
  const nowMs = opts.now.getTime();
  const iso = opts.now.toISOString();
  const first = book.chapters[0];
  const base = buildBookFromInstructionPayload(
    { title: book.title, sections: (first?.sections ?? []).map((s) => ({ title: s.title, content: s.content })) },
    { now: nowMs, author: opts.author, authorRole: 'writer' }
  ).book;
  const chapters = book.chapters.map((ch, ci) => {
    const chapterId = ci === 0 ? base.chapters[0].id : `chap-${nowMs}-${ci + 1}`;
    const sections: Section[] = ch.sections.map((s, si) => ({
      id: `sec-${nowMs}-${ci + 1}-${si + 1}`,
      chapterId,
      title: s.title,
      order: si + 1,
      content: s.content,
      wordCount: calculateWordCount(s.content),
      lastModified: iso,
    }));
    return { id: chapterId, bookId: base.id, title: ch.title, order: ci + 1, sections };
  });
  const note = 'Книга створена з розпізнаних сторінок на локальному сервері (без ШІ й без хмари).';
  const versionHistory = base.versionHistory.map((v, i) => (i === 0 ? { ...v, comment: note, note, tags: ['Створення', 'Рукопис', 'Локально'] } : v));
  return { ...base, versionHistory, chapters: chapters.length ? chapters : base.chapters, privateStore: { storeId: opts.storeId } };
}
