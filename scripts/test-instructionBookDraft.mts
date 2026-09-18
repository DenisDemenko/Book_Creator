/**
 * Тести перетворення документа інструкції на вміст книги (журнал #199) —
 * src/utils/instructionBookDraft.ts. Запуск: npm run test:instruction-book-draft
 *
 * Перевіряється лише чиста логіка складання маркерного рядка: сумісність
 * з форматом src/utils/manuscriptDoc.ts (заголовки `###`, [AI-DRAFT]) тут
 * НЕ перевіряється компонентно — досить, що рядки будуються за тими самими
 * правилами, які вже покриті scripts/test-bookVersion.mts та іншими чистими
 * тестами формату; сам парсер markerStringToTiptapDoc тестується окремо.
 */
import {
  buildInstructionBookSections,
  buildInstructionBookTitle,
  meaningfulInstructionSteps,
} from '../src/utils/instructionBookDraft.ts';
import { createEmptyInstruction, createEmptyStep } from '../src/utils/instructionDraft.ts';
import { findInstructionType } from '../src/data/instructionTypes.ts';
import type { Instruction } from '../src/types.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const assemblyType = findInstructionType('assembly');

function filledDoc(): Instruction {
  const d = createEmptyInstruction('assembly');
  d.title = 'Стіл письмовий';
  d.description = 'Компактний письмовий стіл.';
  d.materials = [
    { id: 'm1', code: 'A', name: 'Стільниця', qty: '1' },
    { id: 'm2', code: 'B', name: '', qty: '2' }, // порожнє ім'я — має бути відфільтровано
  ];
  d.tools = ['Шуруповерт', '', 'Рулетка'];
  d.warnings = ['Не переносити в одиночку', ''];
  d.steps = [
    { ...createEmptyStep(), id: 's1', title: 'Розпакування', description: 'Дістати деталі з коробки.', components: 'Коробка', toolsResources: 'Ніж', warning: 'Гострі краї', successCriterion: 'Усі деталі на місці' },
    { ...createEmptyStep(), id: 's2', title: '', description: '' }, // порожній — має бути відфільтрований
    { ...createEmptyStep(), id: 's3', title: 'Монтаж ніжок', description: 'Прикрутити ніжки до стільниці.' },
  ];
  d.finalChecks = ['Стіл не хитається', ''];
  d.troubleshooting = [{ id: 'i1', issue: 'Стіл хитається', cause: 'Не затягнуті гвинти', action: 'Затягнути шестигранником' }];
  d.warranty = { period: '12 місяців', responsible: 'Виробник', notes: '' };
  d.knowledgeBase = [{ id: 'k1', title: 'Відео складання', link: 'https://example.com', excerpt: 'Покроковий відеоурок' }];
  return d;
}

console.log('\nbuildInstructionBookTitle:');
{
  t('назва документа береться як є', buildInstructionBookTitle(filledDoc(), assemblyType) === 'Стіл письмовий');
  t('порожня назва — плейсхолдер типу', buildInstructionBookTitle(createEmptyInstruction('assembly'), assemblyType) === assemblyType.namePlaceholder);
}

console.log('\nmeaningfulInstructionSteps:');
{
  const steps = meaningfulInstructionSteps(filledDoc());
  t('порожній крок відфільтровано', steps.length === 2);
  t('порядок збережено', steps[0].id === 's1' && steps[1].id === 's3');
}

console.log('\nbuildInstructionBookSections — порожній документ:');
{
  const sections = buildInstructionBookSections(createEmptyInstruction('assembly'), assemblyType);
  t('лише розділ "Опис виробу" (метадані завжди присутні)', sections.length === 1 && sections[0].title === assemblyType.sections.overview.heading);
  t('метадані містять код/час/рівень/виконавців', sections[0].content.includes('Код:') && sections[0].content.includes('Орієнтовний час:'));
}

console.log('\nbuildInstructionBookSections — заповнений документ, без поглиблень ШІ:');
{
  const doc = filledDoc();
  const sections = buildInstructionBookSections(doc, assemblyType);
  const byTitle = (heading: string) => sections.find((s) => s.title === heading);

  t('усі змістовні розділи присутні (7: опис/комплектація/інструменти/безпека/кроки/перевірка/помилки/гарантія/база — 9 мінус 0 порожніх)', sections.length === 9);

  const materials = byTitle(assemblyType.sections.materials.heading);
  t('комплектація: порожній рядок відфільтровано', materials?.content === '— Стільниця — 1');

  const tools = byTitle(assemblyType.sections.tools.heading);
  t('інструменти: порожній рядок відфільтровано, дефіс-буллет', tools?.content === '— Шуруповерт\n— Рулетка');

  const warnings = byTitle(assemblyType.sections.warnings.heading);
  t('безпека: буллет із попереджувальним символом', warnings?.content === '⚠ Не переносити в одиночку');

  const steps = byTitle(assemblyType.sections.steps.heading);
  t('кроки: рівно 2 блоки (порожній крок вилучено)', (steps?.content.match(/^### \d/gm) || []).length === 2);
  t('перший крок пронумерований і має заголовок ###', steps!.content.startsWith('### 1. Розпакування'));
  t('другий крок — наступний номер, не 3', steps!.content.includes('### 2. Монтаж ніжок'));
  t('додаткові поля кроку присутні', steps!.content.includes('Компоненти/матеріали кроку: Коробка') && steps!.content.includes('Критерій виконання: Усі деталі на місці'));
  t('без переданих elaborations — жодного [AI-DRAFT] у тексті', !steps!.content.includes('[AI-DRAFT]'));

  const finalCheck = byTitle(assemblyType.sections.finalCheck.heading);
  t('фінальна перевірка: чекбокс-буллет', finalCheck?.content === '☐ Стіл не хитається');

  const issues = byTitle(assemblyType.sections.troubleshooting.heading);
  t('типові помилки: проблема жирним, причина й дія окремими рядками', issues?.content === '**Стіл хитається**\nПричина: Не затягнуті гвинти\nДія: Затягнути шестигранником');

  const warranty = byTitle(assemblyType.sections.warranty.heading);
  t('гарантія: порожні поля (notes) не додають зайвого рядка', warranty?.content === 'Термін / періодичність: 12 місяців\n\nВідповідальна особа: Виробник');

  const kb = byTitle(assemblyType.sections.knowledgeBase.heading);
  t('база знань: назва + посилання + витяг', kb?.content === '— Відео складання — https://example.com: Покроковий відеоурок');
}

console.log('\nbuildInstructionBookSections — гарантія повністю порожня не створює розділ:');
{
  const doc = filledDoc();
  doc.warranty = { period: '', responsible: '', notes: '' };
  const sections = buildInstructionBookSections(doc, assemblyType);
  t('розділу "Гарантія" немає', !sections.some((s) => s.title === assemblyType.sections.warranty.heading));
}

console.log('\nbuildInstructionBookSections — з поглибленнями ШІ:');
{
  const doc = filledDoc();
  const sections = buildInstructionBookSections(doc, assemblyType, ['Перший абзац.\n\nДругий абзац.', 'Поглиблення другого кроку.']);
  const steps = sections.find((s) => s.title === assemblyType.sections.steps.heading)!;
  t('обидва кроки отримали [AI-DRAFT]', (steps.content.match(/\[AI-DRAFT\]/g) || []).length === 2);
  t('AI-DRAFT відкривається і закривається парою маркерів', steps.content.includes('[AI-DRAFT]\n\nПерший абзац.\n\nДругий абзац.\n\n[/AI-DRAFT]'));
}

console.log('\nbuildInstructionBookSections — часткова відповідь ШІ (елаборацій менше, ніж кроків):');
{
  const doc = filledDoc();
  const sections = buildInstructionBookSections(doc, assemblyType, ['Лише перший крок поглиблено.']);
  const steps = sections.find((s) => s.title === assemblyType.sections.steps.heading)!;
  t('лише один [AI-DRAFT] у тексті', (steps.content.match(/\[AI-DRAFT\]/g) || []).length === 1);
  t('перший крок містить AI-DRAFT', steps.content.split('### 2.')[0].includes('[AI-DRAFT]'));
  t('другий крок не містить AI-DRAFT', !steps.content.split('### 2.')[1].includes('[AI-DRAFT]'));
}

console.log('\nbuildInstructionBookSections — порожній рядок елаборації не додає AI-DRAFT:');
{
  const doc = filledDoc();
  const sections = buildInstructionBookSections(doc, assemblyType, ['   ', 'Друге поглиблення.']);
  const steps = sections.find((s) => s.title === assemblyType.sections.steps.heading)!;
  t('лише один [AI-DRAFT] (порожній пропущено)', (steps.content.match(/\[AI-DRAFT\]/g) || []).length === 1);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
