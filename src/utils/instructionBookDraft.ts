/**
 * Перетворення готового документа інструкції на вміст майбутньої книги —
 * розділ «Кроки виконання» дописується поглибленнями ШІ як [AI-DRAFT]
 * (src/utils/manuscriptDoc.ts), решта розділів переносяться як є.
 *
 * Свідоме рішення власника (журнал #199, зміна рішення із #198): готовий
 * документ інструкції більше НЕ лишається самостійним локальним
 * інструментом — він стає новою книгою в «Книга & Текст» (завжди НОВА
 * книга, ніколи не дописується в уже відкриту, за прямою відповіддю
 * власника на уточнення). ШІ виступає «уточнювачем і поглиблювачем дій»:
 * для кожного кроку модель дописує розгорнуте пояснення виконання, яке
 * лягає в текст як [AI-DRAFT] — автор бачить, що це доповнення ШІ, і сам
 * вирішує прийняти чи відхилити (той самий редакторський механізм, що й
 * для інших AI-доповнень у книзі).
 *
 * Винесено окремо від instructionDraft.ts: та частина відповідає за сам
 * документ (порожній стан, готовність, чернетка), ця — за переклад
 * документа в маркерний формат розділу книги. Кожна функція тут чиста —
 * перевіряється без React/DOM у scripts/test-instructionBookDraft.mts.
 */

import type { Instruction } from '../types';
import type { InstructionTypeConfig } from '../data/instructionTypes';

export interface InstructionBookSectionDraft {
  /** Заголовок розділу книги (стає title нового Section). */
  title: string;
  /** Вміст розділу книги в маркерному форматі (section.content). */
  content: string;
}

function listBlock(lines: string[], bullet = '— '): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `${bullet}${l}`)
    .join('\n');
}

/** Назва майбутньої книги — назва документа або плейсхолдер типу, якщо автор її не вписав. */
export function buildInstructionBookTitle(doc: Instruction, type: InstructionTypeConfig): string {
  return doc.title.trim() || type.namePlaceholder;
}

/**
 * Розділи майбутньої книги. `elaborations`, якщо передано, мають РІВНО
 * стільки елементів, скільки й змістовних кроків (доц.steps, відфільтрованих
 * тим самим правилом, що й тут) — індекс до індексу; елемент, якого немає
 * або який порожній, просто не додає [AI-DRAFT] до цього кроку (проєкт
 * лишається читабельним і без запиту до ШІ, і при частковій відповіді).
 */
export function buildInstructionBookSections(
  doc: Instruction,
  type: InstructionTypeConfig,
  elaborations?: string[]
): InstructionBookSectionDraft[] {
  const sections: InstructionBookSectionDraft[] = [];

  const metaLine =
    `Код: ${doc.modelCode.trim() || '—'} · Орієнтовний час: ${doc.estimatedTime.trim() || '—'} · ` +
    `Рівень: ${doc.skillLevel.trim() || '—'} · Виконавців: ${doc.executorsCount.trim() || '—'}`;
  const overviewParas = [metaLine];
  if (doc.description.trim()) overviewParas.push(doc.description.trim());
  sections.push({ title: type.sections.overview.heading, content: overviewParas.join('\n\n') });

  const materials = doc.materials.filter((m) => m.name.trim());
  if (materials.length) {
    sections.push({
      title: type.sections.materials.heading,
      content: listBlock(materials.map((m) => `${m.name.trim()}${m.qty.trim() ? ` — ${m.qty.trim()}` : ''}`)),
    });
  }

  const tools = doc.tools.filter((t) => t.trim());
  if (tools.length) {
    sections.push({ title: type.sections.tools.heading, content: listBlock(tools) });
  }

  const warnings = doc.warnings.filter((w) => w.trim());
  if (warnings.length) {
    sections.push({ title: type.sections.warnings.heading, content: listBlock(warnings, '⚠ ') });
  }

  const steps = doc.steps.filter((s) => s.title.trim() || s.description.trim());
  if (steps.length) {
    const blocks = steps.map((s, i) => {
      const parts: string[] = [`### ${i + 1}. ${s.title.trim() || `${type.stepPrefix} ${i + 1}`}`];
      if (s.description.trim()) parts.push(s.description.trim());
      const extra: string[] = [];
      if (s.components.trim()) extra.push(`Компоненти/матеріали кроку: ${s.components.trim()}`);
      if (s.toolsResources.trim()) extra.push(`Інструменти/ресурси: ${s.toolsResources.trim()}`);
      if (s.warning.trim()) extra.push(`⚠ ${s.warning.trim()}`);
      if (s.successCriterion.trim()) extra.push(`Критерій виконання: ${s.successCriterion.trim()}`);
      if (extra.length) parts.push(extra.join('\n'));
      const elaboration = elaborations?.[i]?.trim();
      if (elaboration) parts.push(`[AI-DRAFT]\n\n${elaboration}\n\n[/AI-DRAFT]`);
      return parts.join('\n\n');
    });
    sections.push({ title: type.sections.steps.heading, content: blocks.join('\n\n') });
  }

  const finalChecks = doc.finalChecks.filter((c) => c.trim());
  if (finalChecks.length) {
    sections.push({ title: type.sections.finalCheck.heading, content: listBlock(finalChecks, '☐ ') });
  }

  const issues = doc.troubleshooting.filter((r) => r.issue.trim() || r.cause.trim() || r.action.trim());
  if (issues.length) {
    const blocks = issues.map((r) => {
      const parts = [`**${r.issue.trim() || 'Відхилення'}**`];
      if (r.cause.trim()) parts.push(`Причина: ${r.cause.trim()}`);
      if (r.action.trim()) parts.push(`Дія: ${r.action.trim()}`);
      return parts.join('\n');
    });
    sections.push({ title: type.sections.troubleshooting.heading, content: blocks.join('\n\n') });
  }

  const hasWarranty =
    doc.warranty.period.trim() || doc.warranty.responsible.trim() || doc.warranty.notes.trim();
  if (hasWarranty) {
    const parts: string[] = [];
    if (doc.warranty.period.trim()) parts.push(`Термін / періодичність: ${doc.warranty.period.trim()}`);
    if (doc.warranty.responsible.trim()) parts.push(`Відповідальна особа: ${doc.warranty.responsible.trim()}`);
    if (doc.warranty.notes.trim()) parts.push(doc.warranty.notes.trim());
    sections.push({ title: type.sections.warranty.heading, content: parts.join('\n\n') });
  }

  const kb = doc.knowledgeBase.filter((k) => k.title.trim());
  if (kb.length) {
    sections.push({
      title: type.sections.knowledgeBase.heading,
      content: listBlock(
        kb.map(
          (k) =>
            `${k.title.trim()}${k.link.trim() ? ` — ${k.link.trim()}` : ''}${
              k.excerpt.trim() ? `: ${k.excerpt.trim()}` : ''
            }`
        )
      ),
    });
  }

  return sections;
}

/** Кроки з непорожнім заголовком чи описом, у тому самому порядку й фільтруванні, що й розділ «Кроки». Використовується як контракт індексів для elaborations (і в компоненті, і в тестах). */
export function meaningfulInstructionSteps(doc: Instruction) {
  return doc.steps.filter((s) => s.title.trim() || s.description.trim());
}
