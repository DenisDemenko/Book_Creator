/**
 * Промпт «Поглиблення кроків інструкції» — напрям «Інструкція» експрес-майстра
 * (src/components/InstructionBuilderView.tsx). За рішенням власника (запис
 * #199) готовий документ інструкції більше не лишається самостійним локальним
 * інструментом — він стає новою книгою в «Книга & Текст», а ШІ виступає
 * «уточнювачем та поглиблювачем дій»: для кожного кроку модель дописує
 * розгорнутий опис виконання (підкроки, нюанси, на що звернути увагу),
 * який лягає в текст книги як [AI-DRAFT] — автор бачить, що це доповнення
 * ШІ, і сам вирішує, прийняти його чи відхилити (той самий механізм, що й
 * для інших AI-доповнень у редакторі, src/utils/manuscriptDoc.ts).
 *
 * Один виклик — усі кроки одразу (а не N окремих запитів на кожен крок):
 * дешевше і швидше для читача/автора, а модель бачить кроки в контексті
 * одне одного й не повторюється.
 */

export interface InstructionElaborationStepInput {
  title: string;
  description: string;
}

export interface InstructionElaborationPromptValues {
  docTypeLabel: string;
  title: string;
  description: string;
  materials: string;
  tools: string;
  steps: InstructionElaborationStepInput[];
}

function stepsToPlainList(steps: InstructionElaborationStepInput[]): string {
  return steps
    .map((s, i) => `${i + 1}. ${s.title.trim() || '(без назви)'}${s.description.trim() ? ` — ${s.description.trim()}` : ''}`)
    .join('\n');
}

/**
 * Системна інструкція + жорсткий контракт JSON-відповіді. Частина після
 * позначки ⚠️ не редагується в конструкторі (readonly у «Ядрі AI»),
 * за тим самим принципом, що й у characterBioPrompt.ts.
 */
export function factoryInstructionElaborationSystemTemplate(): string {
  return [
    'Ти — досвідчений технічний редактор, який готує документ типу «{ТИП_ІНСТРУКЦІЇ}» під назвою «{НАЗВА}» ' +
      'до публікації в книзі. Твоя роль — уточнювач і поглиблювач дій: для кожного кроку, що вже описаний ' +
      'автором, допиши розгорнуте, конкретне пояснення ЯК саме його виконати — підкроки, практичні нюанси, ' +
      'типові помилки, на що звернути увагу. Не вигадуй нових кроків і не змінюй їх порядок чи суть — ' +
      'лише поглиблюй те, що вже написано.',
    'Контекст документа:\nОпис: {ОПИС}\nМатеріали/комплектація: {МАТЕРІАЛИ}\nІнструменти: {ІНСТРУМЕНТИ}',
    '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):\n' +
      'Поверни строгий JSON без жодного тексту навколо:\n' +
      '{\n' +
      '  "elaborations": ["поглиблення кроку 1", "поглиблення кроку 2", "..."]\n' +
      '}\n' +
      'Масив "elaborations" має РІВНО стільки елементів, скільки кроків подано в списку, у тому самому ' +
      'порядку. Кожен елемент — 2-4 абзаци українською, абзаци розділені порожнім рядком (\\n\\n). ' +
      'Без заголовків, без повторення назви кроку, без нумерації підпунктів символами Markdown — суцільний ' +
      'зв\'язний текст, готовий стати частиною книги.',
  ].join('\n\n');
}

/** Заводський шаблон user-промту. */
export function factoryInstructionElaborationUserTemplate(): string {
  return 'Кроки для поглиблення (номер. назва — опис від автора):\n{КРОКИ}';
}

export function renderInstructionElaborationSystemTemplate(
  template: string,
  values: InstructionElaborationPromptValues
): string {
  return template
    .replace(/\{ТИП_ІНСТРУКЦІЇ\}/g, values.docTypeLabel?.trim() || 'Інструкція')
    .replace(/\{НАЗВА\}/g, values.title?.trim() || 'Без назви')
    .replace(/\{ОПИС\}/g, values.description?.trim() || '—')
    .replace(/\{МАТЕРІАЛИ\}/g, values.materials?.trim() || '—')
    .replace(/\{ІНСТРУМЕНТИ\}/g, values.tools?.trim() || '—');
}

export function renderInstructionElaborationUserTemplate(
  template: string,
  values: InstructionElaborationPromptValues
): string {
  return template.replace('{КРОКИ}', stepsToPlainList(values.steps || []));
}

/** Заводська поведінка (без адмінського шаблону) — для тестів і фолбеку. */
export function buildInstructionElaborationPrompt(
  values: InstructionElaborationPromptValues
): { system: string; user: string } {
  return {
    system: renderInstructionElaborationSystemTemplate(factoryInstructionElaborationSystemTemplate(), values),
    user: renderInstructionElaborationUserTemplate(factoryInstructionElaborationUserTemplate(), values),
  };
}
