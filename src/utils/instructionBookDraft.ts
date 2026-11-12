import { aiDraftText } from '../../shared/aiTextOrigin';
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
import { buildEntityTag } from './coreEntities';
import type { InstructionTypeConfig } from '../data/instructionTypes';
import type { InstructionListingOrigin } from '../../shared/instructionListing';

/** Ілюстрація майбутньої книги — кадр кроку інструкції; id збігається з маркером `[IMG: …]` у тексті кроку. */
export interface InstructionBookIllustrationDraft {
  id: string;
  url: string;
  caption: string;
}

/** Що «Створити книгу» передає в App (і що PDF-верстка просто з конструктора складає в книгу — instructionBook.ts). */
export interface InstructionBookCreationPayload {
  title: string;
  sections: InstructionBookSectionDraft[];
  /** Кадри кроків: лягають в альбом книги, а в тексті стоять маркерами `[IMG: id …]`. */
  illustrations?: InstructionBookIllustrationDraft[];
  /** Шаблон верстки (`BookDesignThemeId`), обраний у документі інструкції. */
  designThemeId?: string;
  /** Слід інструкції: з нього складається назва лістинга у вітрині (#556). */
  instruction?: InstructionListingOrigin;
}

export interface InstructionBookSectionDraft {
  /** Заголовок розділу книги (стає title нового Section). */
  title: string;
  /** Вміст розділу книги в маркерному форматі (section.content). */
  content: string;
}

/**
 * ТЕГИ БЛОКІВ ІНСТРУКЦІЇ (запит власника 09.11.2026: текст і картинки мають потрапляти в «Книга & Текст» уже з тегами).
 * Група G реєстру сутностей («Технічні інструкції та послідовності дій») має рівно ті типи, що є в документі:
 * instruction, step, tool, component, safety-rule, requirement, а `source` і `image` — з груп I і D. Вміст
 * кожного блока точно відомий (розділ «Безпека» — це правила безпеки), тож теги ставить код, а не модель: без
 * запиту до Jev, без балів і без здогадів. Що не має однозначного типу (типові помилки, гарантія) лишається
 * без тега — його можна доповнити кнопкою «Проставити теги автоматично» (Jev) у редакторі.
 *
 * Тег — службова мітка `[/тип:значення]` у кінці абзацу: у виданій книзі її немає (stripEntityTags знімає її
 * на експорті), а індекс тегів і Jev бачать абзац із типом.
 */
export const INSTRUCTION_TAG_VALUE_MAX = 80;

function tagOf(slug: string, text: string): string {
  return buildEntityTag(slug, text.replace(/\s+/g, ' ').trim().slice(0, INSTRUCTION_TAG_VALUE_MAX));
}

/** Дописує тег у кінець КОЖНОГО абзацу тексту (абзаци розділені порожнім рядком). */
function tagParagraphs(text: string, tag: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => (p.trim() ? `${p.trimEnd()} ${tag}` : p))
    .join('\n\n');
}

/**
 * Список рядків. КОЖЕН ПУНКТ — окремий абзац (порожній рядок між ними), а не рядок усередині одного: рушії PDF
 * зводять одинарний перенос у пропуск (Nova — `toParagraphs`, Markdown — так само), і список склеювався б в один
 * суцільний абзац (запис #534, знімок власника). Заодно кожен тег стоїть при своєму пункті й не впирається в межу
 * реєстру на кількість тегів в абзаці. З `slug` пункт несе свій тег.
 */
function listBlock(lines: string[], bullet = '— ', slug?: string): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `${bullet}${l}${slug ? ` ${tagOf(slug, l)}` : ''}`)
    .join('\n\n');
}


/**
 * Кадри кроків, що потраплять у книгу: ті самі кроки, що й у розділі «Кроки» (змістовні), по порядку.
 * Єдине місце, де народжуються id: і маркери в тексті, і ілюстрації книги беруть їх звідси, тож
 * розбіжності між ними бути не може.
 */
function stepImageEntries(doc: Instruction): Array<InstructionBookIllustrationDraft & { stepIndex: number }> {
  const steps = doc.steps.filter((s) => s.title.trim() || s.description.trim());
  const out: Array<InstructionBookIllustrationDraft & { stepIndex: number }> = [];
  steps.forEach((s, i) => {
    (s.images ?? []).filter((im) => im.url).forEach((im, n) => {
      out.push({
        id: `ill-instr-${s.id}-${n + 1}`.replace(/[^A-Za-z0-9_-]/g, '-'),
        url: im.url,
        caption: (im.caption?.trim() || `Крок ${i + 1}, кадр ${n + 1}`).replace(/["\]\[]/g, ''),
        stepIndex: i,
      });
    });
  });
  return out;
}

/** Ілюстрації для книги, створеної з документа (App.tsx кладе їх у `book.illustrations`). */
export function buildInstructionBookIllustrations(doc: Instruction): InstructionBookIllustrationDraft[] {
  return stepImageEntries(doc).map(({ id, url, caption }) => ({ id, url, caption }));
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
  const overviewParas = [`${metaLine} ${tagOf('instruction', buildInstructionBookTitle(doc, type))}`];
  if (doc.description.trim()) overviewParas.push(tagParagraphs(doc.description.trim(), tagOf('instruction', buildInstructionBookTitle(doc, type))));
  sections.push({ title: type.sections.overview.heading, content: overviewParas.join('\n\n') });

  const materials = doc.materials.filter((m) => m.name.trim());
  if (materials.length) {
    sections.push({
      title: type.sections.materials.heading,
      content: listBlock(materials.map((m) => `${m.name.trim()}${m.qty.trim() ? ` — ${m.qty.trim()}` : ''}`), '— ', 'component'),
    });
  }

  const tools = doc.tools.filter((t) => t.trim());
  if (tools.length) {
    sections.push({ title: type.sections.tools.heading, content: listBlock(tools, '— ', 'tool') });
  }

  const warnings = doc.warnings.filter((w) => w.trim());
  if (warnings.length) {
    sections.push({ title: type.sections.warnings.heading, content: listBlock(warnings, '⚠ ', 'safety-rule') });
  }

  const steps = doc.steps.filter((s) => s.title.trim() || s.description.trim());
  if (steps.length) {
    const images = stepImageEntries(doc);
    const blocks = steps.map((s, i) => {
      const stepName = `${i + 1}. ${s.title.trim() || `${type.stepPrefix} ${i + 1}`}`;
      const stepTag = tagOf('step', stepName);
      const parts: string[] = [`### ${stepName} ${stepTag}`];
      if (s.description.trim()) {
        const body = tagParagraphs(s.description.trim(), stepTag);
        parts.push(s.aiGenerated ? '[AI-DRAFT]\n\n' + body + '\n\n[/AI-DRAFT]' : body);
      }
      const stepImages = images.filter((im) => im.stepIndex === i);
      if (stepImages.length) parts.push(stepImages.map((im) => `[IMG: ${im.id} "${im.caption}" wrap=none] ${tagOf('image', im.caption)} ${stepTag}`).join('\n\n'));
      // Службові рядки кроку — окремі абзаци (інакше PDF склеює їх в один, див. listBlock), кожен несе свій тип і крок.
      const extra: string[] = [];
      if (s.components.trim()) extra.push(`Компоненти/матеріали кроку: ${s.components.trim()} ${tagOf('component', s.components)}`);
      if (s.toolsResources.trim()) extra.push(`Інструменти/ресурси: ${s.toolsResources.trim()} ${tagOf('tool', s.toolsResources)}`);
      if (s.warning.trim()) extra.push(`⚠ ${s.warning.trim()} ${tagOf('safety-rule', s.warning)}`);
      if (s.successCriterion.trim()) extra.push(`Критерій виконання: ${s.successCriterion.trim()} ${tagOf('requirement', s.successCriterion)}`);
      if (s.sourceIds?.length) {
        const names = s.sourceIds.map((id) => doc.knowledgeBase.find((k) => k.id === id)?.title || id);
        extra.push('Джерела: ' + names.join('; ') + ' ' + names.slice(0, 4).map((n) => tagOf('source', n)).join(' '));
      }
      if (extra.length) parts.push(extra.map((line) => `${line} ${stepTag}`).join('\n\n'));
      const elaboration = elaborations?.[i]?.trim();
      if (elaboration) parts.push(`[AI-DRAFT]\n\n${tagParagraphs(elaboration, stepTag)}\n\n[/AI-DRAFT]`);
      return s.aiGenerated ? aiDraftText(parts.join('\n\n')) : parts.join('\n\n');
    });
    sections.push({ title: type.sections.steps.heading, content: blocks.join('\n\n') });
  }

  const finalChecks = doc.finalChecks.filter((c) => c.trim());
  if (finalChecks.length) {
    sections.push({ title: type.sections.finalCheck.heading, content: listBlock(finalChecks, '☐ ', 'requirement') });
  }

  const issues = doc.troubleshooting.filter((r) => r.issue.trim() || r.cause.trim() || r.action.trim());
  if (issues.length) {
    const blocks = issues.map((r) => {
      const parts = [`**${r.issue.trim() || 'Відхилення'}**`];
      if (r.cause.trim()) parts.push(`Причина: ${r.cause.trim()}`);
      if (r.action.trim()) parts.push(`Дія: ${r.action.trim()}`);
      return parts.join('\n\n');
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
      content: kb
        .map(
          (k) =>
            `— ${k.title.trim()}${k.link.trim() ? ` — ${k.link.trim()}` : ''}${
              k.excerpt.trim() ? `: ${k.excerpt.trim()}` : ''
            } ${tagOf('source', k.title)}`
        )
        .join('\n\n'),
    });
  }

  return sections;
}

/** Кроки з непорожнім заголовком чи описом, у тому самому порядку й фільтруванні, що й розділ «Кроки». Використовується як контракт індексів для elaborations (і в компоненті, і в тестах). */
export function meaningfulInstructionSteps(doc: Instruction) {
  return doc.steps.filter((s) => s.title.trim() || s.description.trim());
}
