/**
 * Інструкція набору-конструктора (трек K3 плану GrabFusion,
 * docs/proposals/GRABFUSION_PHOTO_COURSE_APP_2026-10-28.md, §4а).
 *
 * «Комплектація» й «Безпека» інструкції беруться зі специфікації набору (K1/K2) — ОДНЕ
 * джерело: автор не вводить деталі вдруге, а зміна специфікації видна в інструкції.
 * Решта документа (кроки, інструменти, перевірки, усунення несправностей) — ручна, і
 * синхронізація її не чіпає.
 *
 * Ключові правила синхронізації (`syncInstructionWithKit`):
 *  - рядок «Комплектації» зі специфікації має `specLineId` = id деталі; кожну синхронізацію
 *    він оновлюється (назва, кількість), зникає разом із деталлю, а нова деталь додається;
 *  - коди деталей (A, B, C…) СТАБІЛЬНІ: у кроках пишуть «деталь B», тож код існуючого рядка
 *    не змінюється, а нова деталь отримує перший вільний код;
 *  - ручні рядки (без `specLineId`) і ручні попередження лишаються;
 *  - для вимкненого набору нічого не змінюється;
 *  - повторна синхронізація без змін повертає той самий обʼєкт (нічого зайвого не пишеться).
 *
 * Модуль чистий (без React і Node): його читають редактор, сервер і тест.
 */
import type { Instruction, InstructionDocType, InstructionMaterialRow, InstructionStep } from '../types';
import type { KitLine, KitSpec } from '../components/adminOs/kitSpec';
import { kitSafetyPublic } from '../components/adminOs/kitSafety';
import { createEmptyStep, instructionUid } from './instructionDraft';

export const INSTRUCTION_TEXT_MAX = 2000;
export const INSTRUCTION_SHORT_MAX = 200;
export const INSTRUCTION_LIST_MAX = 100;
export const INSTRUCTION_STEPS_MAX = 200;

const DOC_TYPES: readonly InstructionDocType[] = ['assembly', 'usage', 'safety', 'sequence'];

// ---------------------------------------------------------------------------
// Комплектація зі специфікації
// ---------------------------------------------------------------------------

/** A…Z, потім AA, AB… (стабільні літерні коди деталей у кроках інструкції). */
export function kitPartCode(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const fmtQty = (qty: number): string => {
  const n = Number(qty) || 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000).replace('.', ',');
};

/** Підпис у «Комплектації»: «Бокова панель (береза 6 мм)». */
export function kitPartLabel(line: Pick<KitLine, 'name' | 'material'>): string {
  const name = line.name.trim();
  const material = line.material.trim();
  return material ? `${name} (${material})` : name;
}

/** Кількість у ОДНОМУ наборі з одиницею: «10 шт», «0,5 м». */
export function kitPartQty(line: Pick<KitLine, 'qty' | 'unit'>): string {
  return `${fmtQty(line.qty)} ${line.unit.trim() || 'шт'}`;
}

/** Деталі специфікації, які потрапляють у «Комплектацію» (з назвою; пакування — ні). */
export function kitInstructionParts(kit: KitSpec | null | undefined): KitLine[] {
  return (kit?.parts || []).filter((p) => p.name.trim());
}

/** Рядки «Безпеки» зі специфікації: вік і всі попередження. Порожньо, поки безпека неповна. */
export function kitInstructionWarnings(kit: KitSpec | null | undefined): string[] {
  const pub = kitSafetyPublic(kit);
  return pub ? [`Вік: ${pub.ageLabel}.`, ...pub.warnings] : [];
}

// ---------------------------------------------------------------------------
// Побудова й синхронізація
// ---------------------------------------------------------------------------

export interface KitSyncChanges {
  materialsAdded: number;
  materialsUpdated: number;
  materialsRemoved: number;
  warningsAdded: number;
  warningsRemoved: number;
}

export interface KitSyncResult {
  doc: Instruction;
  changes: KitSyncChanges;
  /** Було хоч щось змінено (інакше `doc` — той самий обʼєкт, що прийшов). */
  changed: boolean;
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function syncInstructionWithKit(doc: Instruction, kit: KitSpec | null | undefined, now: Date = new Date()): KitSyncResult {
  const none: KitSyncChanges = { materialsAdded: 0, materialsUpdated: 0, materialsRemoved: 0, warningsAdded: 0, warningsRemoved: 0 };
  if (!kit || !kit.enabled) return { doc, changes: none, changed: false };

  // --- Комплектація ---
  const parts = kitInstructionParts(kit);
  const existing = new Map<string, InstructionMaterialRow>();
  for (const row of doc.materials) if (row.specLineId) existing.set(row.specLineId, row);
  // Порожній ручний рядок-заглушка зі стартового документа не лишаємо поруч зі специфікацією
  // (і не даємо йому «займати» код A).
  const manualKept = doc.materials.filter((r) => !r.specLineId && (r.name.trim() || r.qty.trim() !== '1' || r.code.trim() !== 'A'));
  const usedCodes = new Set<string>(manualKept.map((r) => r.code.trim()).filter(Boolean));
  for (const part of parts) {
    const row = existing.get(part.id);
    if (row && row.code.trim()) usedCodes.add(row.code.trim());
  }
  const nextFreeCode = (): string => {
    for (let i = 0; ; i++) {
      const code = kitPartCode(i);
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
  };
  let added = 0;
  let updated = 0;
  const specRows: InstructionMaterialRow[] = parts.map((part) => {
    const row = existing.get(part.id);
    const name = kitPartLabel(part);
    const qty = kitPartQty(part);
    if (row) {
      const code = row.code.trim() || nextFreeCode();
      if (row.name !== name || row.qty !== qty || row.code !== code) updated++;
      return { ...row, code, name, qty, specLineId: part.id };
    }
    added++;
    return { id: `mat-${part.id}`, code: nextFreeCode(), name, qty, specLineId: part.id };
  });
  const removed = [...existing.keys()].filter((id) => !parts.some((p) => p.id === id)).length;
  const materials = [...specRows, ...manualKept];

  // --- Безпека ---
  const previous = doc.kitSource?.specWarnings ?? [];
  const previousSet = new Set(previous);
  const specWarnings = kitInstructionWarnings(kit);
  const manualWarnings = doc.warnings.filter((w) => w.trim() && !previousSet.has(w));
  const warnings = [...specWarnings, ...manualWarnings];
  const warningsAdded = specWarnings.filter((w) => !previousSet.has(w)).length;
  const warningsRemoved = previous.filter((w) => !specWarnings.includes(w)).length;

  const changes: KitSyncChanges = { materialsAdded: added, materialsUpdated: updated, materialsRemoved: removed, warningsAdded, warningsRemoved };
  const sameMaterials =
    materials.length === doc.materials.length &&
    materials.every((m, i) => {
      const o = doc.materials[i];
      return o && o.id === m.id && o.code === m.code && o.name === m.name && o.qty === m.qty && o.specLineId === m.specLineId;
    });
  const sameWarnings = sameList(warnings.length ? warnings : [''], doc.warnings.length ? doc.warnings : ['']) && sameList(specWarnings, previous);
  if (sameMaterials && sameWarnings && doc.kitSource) return { doc, changes: none, changed: false };

  return {
    doc: {
      ...doc,
      materials: materials.length ? materials : [{ id: instructionUid('mat'), code: 'A', name: '', qty: '1' }],
      warnings: warnings.length ? warnings : [''],
      kitSource: { specWarnings, syncedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    },
    changes,
    changed: true,
  };
}

/** Нова інструкція набору: назва й код — з картки виробу, комплектація й безпека — зі специфікації. */
export function buildKitInstruction(product: { name: string; sku: string }, kit: KitSpec, now: Date = new Date()): Instruction {
  const blank: Instruction = {
    docType: 'assembly',
    title: product.name.trim(),
    modelCode: product.sku.trim(),
    estimatedTime: '',
    skillLevel: '',
    executorsCount: '',
    description: '',
    materials: [],
    tools: [''],
    warnings: [''],
    steps: [createEmptyStep()],
    finalChecks: [''],
    troubleshooting: [{ id: instructionUid('issue'), issue: '', cause: '', action: '' }],
    warranty: { period: '', responsible: '', notes: '' },
    knowledgeBase: [],
    updatedAt: now.toISOString(),
  };
  return syncInstructionWithKit(blank, kit, now).doc;
}

/** Специфікація змінилась після останньої синхронізації — інструкцію варто оновити. */
export function kitInstructionDrift(doc: Instruction | null | undefined, kit: KitSpec | null | undefined): boolean {
  if (!doc || !kit || !kit.enabled) return false;
  return syncInstructionWithKit(doc, kit).changed;
}

// ---------------------------------------------------------------------------
// Приведення (сервер не довіряє тілу запиту)
// ---------------------------------------------------------------------------

const text = (value: unknown, max: number): string => {
  const s = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  return [...s].slice(0, max).join('');
};
const line = (value: unknown, max = INSTRUCTION_SHORT_MAX): string => text(value, max).replace(/\s+/g, ' ');
const list = (value: unknown, max = INSTRUCTION_SHORT_MAX): string[] => {
  const out = (Array.isArray(value) ? value : []).slice(0, INSTRUCTION_LIST_MAX).map((v) => line(v, max));
  return out.length ? out : [''];
};
const uniqueId = (raw: unknown, prefix: string, seen: Set<string>): string => {
  let id = line(raw, 60);
  if (!id || seen.has(id)) id = instructionUid(prefix);
  seen.add(id);
  return id;
};

/**
 * Документ інструкції із зовнішнього джерела → безпечний вигляд. `undefined` — не схоже на
 * інструкцію (поле просто не пишемо). Прапорці `sourceBased`/`needsVerification`/`aiGenerated`
 * зберігаються лише як булеві; `sourceIds` — масив коротких рядків.
 */
export function normalizeKitInstruction(value: unknown, now: Date = new Date()): Instruction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, any>;
  const seen = new Set<string>();
  const materials: InstructionMaterialRow[] = (Array.isArray(v.materials) ? v.materials : []).slice(0, INSTRUCTION_STEPS_MAX).flatMap((m: any) => {
    if (!m || typeof m !== 'object') return [];
    const row: InstructionMaterialRow = { id: uniqueId(m.id, 'mat', seen), code: line(m.code, 12), name: line(m.name), qty: line(m.qty, 40) };
    const spec = line(m.specLineId, 60);
    if (spec) row.specLineId = spec;
    return [row];
  });
  const steps: InstructionStep[] = (Array.isArray(v.steps) ? v.steps : []).slice(0, INSTRUCTION_STEPS_MAX).flatMap((s: any) => {
    if (!s || typeof s !== 'object') return [];
    const step: InstructionStep = {
      id: uniqueId(s.id, 'step', seen),
      title: line(s.title),
      description: text(s.description, INSTRUCTION_TEXT_MAX),
      components: line(s.components),
      toolsResources: line(s.toolsResources),
      warning: line(s.warning),
      successCriterion: line(s.successCriterion),
    };
    if (s.needsVerification === true) step.needsVerification = true;
    if (s.aiGenerated === true) step.aiGenerated = true;
    if (Array.isArray(s.sourceIds)) step.sourceIds = s.sourceIds.slice(0, 20).map((x: unknown) => line(x, 60)).filter(Boolean);
    return [step];
  });
  const troubleshooting = (Array.isArray(v.troubleshooting) ? v.troubleshooting : []).slice(0, INSTRUCTION_LIST_MAX).flatMap((r: any) =>
    r && typeof r === 'object'
      ? [{ id: uniqueId(r.id, 'issue', seen), issue: line(r.issue), cause: line(r.cause), action: text(r.action, INSTRUCTION_SHORT_MAX) }]
      : []
  );
  const knowledgeBase = (Array.isArray(v.knowledgeBase) ? v.knowledgeBase : []).slice(0, INSTRUCTION_LIST_MAX).flatMap((k: any) =>
    k && typeof k === 'object'
      ? [{ id: uniqueId(k.id, 'kb', seen), title: line(k.title), link: line(k.link, 500), excerpt: text(k.excerpt, INSTRUCTION_TEXT_MAX) }]
      : []
  );
  const w = v.warranty && typeof v.warranty === 'object' ? v.warranty : {};
  const updated = typeof v.updatedAt === 'string' && !Number.isNaN(Date.parse(v.updatedAt)) ? new Date(v.updatedAt).toISOString() : now.toISOString();
  const doc: Instruction = {
    docType: DOC_TYPES.includes(v.docType) ? v.docType : 'assembly',
    title: line(v.title),
    modelCode: line(v.modelCode, 60),
    estimatedTime: line(v.estimatedTime, 60),
    skillLevel: line(v.skillLevel, 60),
    executorsCount: line(v.executorsCount, 20),
    description: text(v.description, INSTRUCTION_TEXT_MAX),
    materials: materials.length ? materials : [{ id: instructionUid('mat'), code: 'A', name: '', qty: '1' }],
    tools: list(v.tools),
    warnings: list(v.warnings),
    steps: steps.length ? steps : [createEmptyStep()],
    finalChecks: list(v.finalChecks),
    troubleshooting: troubleshooting.length ? troubleshooting : [{ id: instructionUid('issue'), issue: '', cause: '', action: '' }],
    warranty: { period: line(w.period, 60), responsible: line(w.responsible, 120), notes: text(w.notes, INSTRUCTION_SHORT_MAX) },
    knowledgeBase,
    updatedAt: updated,
  };
  if (v.sourceBased === true) doc.sourceBased = true;
  if (v.kitSource && typeof v.kitSource === 'object') {
    const ks = v.kitSource as Record<string, unknown>;
    doc.kitSource = {
      specWarnings: (Array.isArray(ks.specWarnings) ? ks.specWarnings : []).slice(0, 40).map((x) => line(x, 400)).filter(Boolean),
      syncedAt: typeof ks.syncedAt === 'string' && !Number.isNaN(Date.parse(ks.syncedAt)) ? new Date(ks.syncedAt).toISOString() : '',
    };
  }
  return doc;
}
