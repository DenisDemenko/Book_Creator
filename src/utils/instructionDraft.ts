/**
 * Чиста логіка конструктора інструкцій — порожній документ, короткі
 * ідентифікатори, відсоток готовності й локальна чернетка (localStorage).
 *
 * Винесено окремо від src/components/InstructionBuilderView.tsx так само,
 * як усюди в проєкті (bookVersion.ts, tableMarkers.ts, pageFormats.ts…):
 * усе, що можна перевірити без React і без DOM, перевіряється в
 * scripts/test-instructionDraft.mts, а компонент лише викликає ці функції.
 */

import type {
  Instruction,
  InstructionDocType,
  InstructionStep,
} from '../types';

export function instructionUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyStep(): InstructionStep {
  return {
    id: instructionUid('step'),
    title: '',
    description: '',
    components: '',
    toolsResources: '',
    warning: '',
    successCriterion: '',
  };
}

/**
 * Порожній документ обраного типу. Один порожній рядок/крок у кожному
 * розділі-списку — так само, як у довідковому інструменті (там теж
 * стартова «Комплектація» й «Кроки складання» не з нуля, а з одним
 * незаповненим рядком, готовим до редагування).
 */
export function createEmptyInstruction(docType: InstructionDocType): Instruction {
  return {
    docType,
    title: '',
    modelCode: '',
    estimatedTime: '',
    skillLevel: '',
    executorsCount: '',
    description: '',
    materials: [{ id: instructionUid('mat'), code: 'A', name: '', qty: '1' }],
    tools: [''],
    warnings: [''],
    steps: [createEmptyStep()],
    finalChecks: [''],
    troubleshooting: [{ id: instructionUid('issue'), issue: '', cause: '', action: '' }],
    warranty: { period: '', responsible: '', notes: '' },
    knowledgeBase: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Відсоток готовності документа («Готовність» у бічній панелі).
 *
 * Вісім рівноважних перевірок — по одній на кожен змістовний розділ
 * (розділ 1 «Основна інформація» рахується як один: і назва, і опис мають
 * бути заповнені, інакше розділ ще не готовий). «База знань» свідомо не
 * входить до розрахунку: це довідковий/дослідницький розділ, а не частина
 * самого документа — порожня база знань не робить інструкцію неповною.
 */
export function instructionCompleteness(doc: Instruction): number {
  const checks: boolean[] = [
    doc.title.trim().length > 0 && doc.description.trim().length > 0,
    doc.materials.some((m) => m.name.trim().length > 0),
    doc.tools.some((t) => t.trim().length > 0),
    doc.warnings.some((w) => w.trim().length > 0),
    doc.steps.some((s) => s.title.trim().length > 0 && s.description.trim().length > 0),
    doc.finalChecks.some((c) => c.trim().length > 0),
    doc.troubleshooting.some((r) => r.issue.trim().length > 0),
    doc.warranty.period.trim().length > 0 ||
      doc.warranty.responsible.trim().length > 0 ||
      doc.warranty.notes.trim().length > 0,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

/** Ім'я файлу експорту: транслітерація не потрібна — просто безпечний slug. */
export function instructionExportFileName(doc: Instruction): string {
  const base = doc.title.trim() || 'instruction';
  const slug = base
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9а-яіїєґ]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'instruction';
  return `${slug}.json`;
}

const DRAFT_KEY = 'nova_instruction_draft_v1';

/** Повертає `null`, якщо чернетки немає або вона зіпсована — виклик не кидає. */
export function loadInstructionDraft(): Instruction | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.docType !== 'string') return null;
    return parsed as Instruction;
  } catch {
    return null;
  }
}

export function saveInstructionDraft(doc: Instruction): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
  } catch {
    /* приватний режим або сховище переповнене — чернетка просто не переживе перезавантаження */
  }
}

export function clearInstructionDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* не критично */
  }
}
