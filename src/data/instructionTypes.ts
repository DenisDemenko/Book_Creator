/**
 * Реєстр типів документа для конструктора інструкцій (напрям «Інструкція»,
 * src/data/expressTracks.ts → src/components/InstructionBuilderView.tsx).
 *
 * Скопійовано за зразком, який власник надав посиланням (окремий інструмент
 * «Конструктор інструкцій» на fusion-instruction-builder.<...>.chatgpt.site):
 * там теж один документ на 9 розділів, а «4 розгалуження видів інструкцій» —
 * це НЕ чотири різні форми, а той самий каркас із підміненими підписами.
 * Перемикання типу (кнопки в розділі «Опис виробу») тому не скидає вже
 * введені дані — воно лише міняє, як розділи називаються і що показує
 * підказка-плейсхолдер; структура полів у src/types.ts (`Instruction`)
 * спільна для всіх чотирьох.
 *
 * Підписи розділів 2-4 (звірено з довідковим інструментом за трьома
 * реальними переходами між типами): «Комплектація» → «Що знадобиться» →
 * «Небезпечні фактори» → «Вхідні дані й матеріали». Друга колонка цього
 * розділу («Деталь» / «Компонент» / «Фактор») для типу «Послідовність дій»
 * в оригіналі не звірялась напряму (пройдено 3 з 4 типів наживо) — тут
 * підставлено «Матеріал», що узгоджено з підписом розділу; якщо власник
 * побачить інший текст у джерелі — виправити тут одним рядком.
 */

import type { InstructionDocType } from '../types';

export interface InstructionSectionLabels {
  /** Підпис пункту в бічній навігації. */
  nav: string;
  /** Заголовок розділу у формі й у прев'ю документа. */
  heading: string;
}

export type InstructionSectionKey =
  | 'overview'
  | 'materials'
  | 'tools'
  | 'warnings'
  | 'steps'
  | 'finalCheck'
  | 'troubleshooting'
  | 'warranty'
  | 'knowledgeBase';

export interface InstructionTypeConfig {
  id: InstructionDocType;
  /** Назва картки вибору типу («Зі складання» тощо). */
  cardTitle: string;
  cardSubtitle: string;
  /** Підпис документа вгорі прев'ю/друку («ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ»). */
  docBadge: string;
  nameFieldLabel: string;
  namePlaceholder: string;
  materialsColumnLabel: string;
  materialsPlaceholder: string;
  stepPrefix: string;
  toolsPlaceholder: string;
  warningPlaceholder: string;
  finalCheckPlaceholder: string;
  sections: Record<InstructionSectionKey, InstructionSectionLabels>;
}

export const INSTRUCTION_TYPES: InstructionTypeConfig[] = [
  {
    id: 'assembly',
    cardTitle: 'Зі складання',
    cardSubtitle: 'Деталі, інструменти, монтаж і контроль.',
    docBadge: 'ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ',
    nameFieldLabel: 'Назва виробу / документа',
    namePlaceholder: 'Новий виріб',
    materialsColumnLabel: 'Деталь',
    materialsPlaceholder: 'Назва деталі',
    stepPrefix: 'Крок складання',
    toolsPlaceholder: 'Необхідний інструмент',
    warningPlaceholder: 'Введіть правило або обмеження',
    finalCheckPlaceholder: 'Як підтвердити правильний результат?',
    sections: {
      overview: { nav: 'Опис виробу', heading: 'Опис виробу' },
      materials: { nav: 'Комплектація', heading: 'Комплектація' },
      tools: { nav: 'Інструменти', heading: 'Інструменти' },
      warnings: { nav: 'Безпека', heading: 'Безпека' },
      steps: { nav: 'Кроки складання', heading: 'Кроки складання' },
      finalCheck: { nav: 'Фінальна перевірка', heading: 'Фінальна перевірка' },
      troubleshooting: { nav: 'Типові помилки', heading: 'Типові помилки' },
      warranty: { nav: 'Гарантія', heading: 'Гарантія' },
      knowledgeBase: { nav: 'База знань', heading: 'База знань' },
    },
  },
  {
    id: 'usage',
    cardTitle: 'З використання',
    cardSubtitle: 'Підготовка, запуск, режими та догляд.',
    docBadge: 'ІНСТРУКЦІЯ З ВИКОРИСТАННЯ',
    nameFieldLabel: 'Назва виробу / документа',
    namePlaceholder: 'Новий виріб',
    materialsColumnLabel: 'Компонент',
    materialsPlaceholder: 'Назва компонента',
    stepPrefix: 'Етап використання',
    toolsPlaceholder: 'Умова або крок підготовки',
    warningPlaceholder: 'Введіть застереження',
    finalCheckPlaceholder: 'Як підтвердити правильний результат?',
    sections: {
      overview: { nav: 'Про обладнання або продукт', heading: 'Про обладнання або продукт' },
      materials: { nav: 'Що знадобиться', heading: 'Що знадобиться' },
      tools: { nav: 'Умови та підготовка', heading: 'Умови та підготовка' },
      warnings: { nav: 'Застереження', heading: 'Застереження' },
      steps: { nav: 'Порядок використання', heading: 'Порядок використання' },
      finalCheck: { nav: 'Перевірка результату', heading: 'Перевірка результату' },
      troubleshooting: { nav: 'Проблеми під час роботи', heading: 'Проблеми під час роботи' },
      warranty: { nav: 'Обслуговування і підтримка', heading: 'Обслуговування і підтримка' },
      knowledgeBase: { nav: 'База знань', heading: 'База знань' },
    },
  },
  {
    id: 'safety',
    cardTitle: 'З техніки безпеки',
    cardSubtitle: 'Ризики, ЗІЗ, заборони та дії при аварії.',
    docBadge: 'ІНСТРУКЦІЯ З ТЕХНІКИ БЕЗПЕКИ',
    nameFieldLabel: 'Назва робіт',
    namePlaceholder: 'Нові роботи',
    materialsColumnLabel: 'Фактор',
    materialsPlaceholder: 'Небезпечний фактор',
    stepPrefix: 'Безпечна дія',
    toolsPlaceholder: 'Засіб захисту',
    warningPlaceholder: 'Введіть обов’язкове правило',
    finalCheckPlaceholder: 'Як підтвердити допуск до роботи?',
    sections: {
      overview: { nav: 'Сфера застосування', heading: 'Сфера застосування' },
      materials: { nav: 'Небезпечні фактори', heading: 'Небезпечні фактори' },
      tools: { nav: 'Засоби захисту', heading: 'Засоби захисту' },
      warnings: { nav: 'Обов’язкові правила', heading: 'Обов’язкові правила' },
      steps: { nav: 'Безпечний порядок дій', heading: 'Безпечний порядок дій' },
      finalCheck: { nav: 'Допуск і контроль', heading: 'Допуск і контроль' },
      troubleshooting: { nav: 'Аварійні ситуації', heading: 'Аварійні ситуації' },
      warranty: { nav: 'Відповідальні особи', heading: 'Відповідальні особи' },
      knowledgeBase: { nav: 'База знань', heading: 'База знань' },
    },
  },
  {
    id: 'sequence',
    cardTitle: 'Послідовність дій',
    cardSubtitle: 'Мета, ресурси, кроки та критерії виконання.',
    docBadge: 'ІНСТРУКЦІЯ З ВИКОНАННЯ ДІЙ',
    nameFieldLabel: 'Назва процесу',
    namePlaceholder: 'Новий процес',
    materialsColumnLabel: 'Матеріал',
    materialsPlaceholder: 'Вхідний матеріал або дані',
    stepPrefix: 'Дія',
    toolsPlaceholder: 'Ресурс або умова',
    warningPlaceholder: 'Введіть обмеження',
    finalCheckPlaceholder: 'Як підтвердити виконання критерію?',
    sections: {
      overview: { nav: 'Мета та результат процесу', heading: 'Мета та результат процесу' },
      materials: { nav: 'Вхідні дані й матеріали', heading: 'Вхідні дані й матеріали' },
      tools: { nav: 'Ресурси та умови', heading: 'Ресурси та умови' },
      warnings: { nav: 'Обмеження', heading: 'Обмеження' },
      steps: { nav: 'Послідовність дій', heading: 'Послідовність дій' },
      finalCheck: { nav: 'Критерії виконання', heading: 'Критерії виконання' },
      troubleshooting: { nav: 'Відхилення від процесу', heading: 'Відхилення від процесу' },
      warranty: { nav: 'Власник процесу', heading: 'Власник процесу' },
      knowledgeBase: { nav: 'База знань', heading: 'База знань' },
    },
  },
];

export function findInstructionType(id: InstructionDocType): InstructionTypeConfig {
  return INSTRUCTION_TYPES.find((t) => t.id === id) ?? INSTRUCTION_TYPES[0];
}

/** Порядок розділів у навігації, формі й прев'ю — той самий для всіх типів. */
export const INSTRUCTION_SECTION_ORDER: InstructionSectionKey[] = [
  'overview',
  'materials',
  'tools',
  'warnings',
  'steps',
  'finalCheck',
  'troubleshooting',
  'warranty',
  'knowledgeBase',
];
