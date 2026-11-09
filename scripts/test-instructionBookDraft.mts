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
  buildInstructionBookIllustrations,
  buildInstructionBookSections,
  buildInstructionBookTitle,
  meaningfulInstructionSteps,
} from '../src/utils/instructionBookDraft.ts';
import { imageMarkerRegexp } from '../src/utils/imageMarkers.ts';
import { MAX_ENTITIES_PER_PARAGRAPH, isRegisteredEntityType, parseEntityTagsInSource, stripEntityTags } from '../src/utils/coreEntities.ts';
import { manuscriptTagIndex } from '../src/utils/manuscriptTagIndex.ts';
import { createEmptyInstruction, createEmptyStep } from '../src/utils/instructionDraft.ts';
import { findInstructionType } from '../src/data/instructionTypes.ts';
import type { Instruction } from '../src/types.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const assemblyType = findInstructionType('assembly');
/** Текст, яким його побачить читач: без службових тегів і без хвостових пропусків від них. */
const plain = (x: string | undefined) => stripEntityTags(x ?? '').replace(/[ 	]+$/gm, '');

/** Лише теги сутностей знято, маркери [AI-DRAFT] і розмітка лишились (stripEntityTags знімає й їх). */
const noTags = (x: string) => x.replace(/ ?\[\/[a-z0-9-]+:[^\]\n]*\]/g, '');

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
  t('комплектація: порожній рядок відфільтровано', plain(materials?.content) === '— Стільниця — 1');

  const tools = byTitle(assemblyType.sections.tools.heading);
  t('інструменти: порожній рядок відфільтровано, дефіс-буллет', plain(tools?.content) === '— Шуруповерт\n\n— Рулетка');

  const warnings = byTitle(assemblyType.sections.warnings.heading);
  t('безпека: буллет із попереджувальним символом', plain(warnings?.content) === '⚠ Не переносити в одиночку');

  const steps = byTitle(assemblyType.sections.steps.heading);
  t('кроки: рівно 2 блоки (порожній крок вилучено)', (steps?.content.match(/^### \d/gm) || []).length === 2);
  t('перший крок пронумерований і має заголовок ###', steps!.content.startsWith('### 1. Розпакування'));
  t('другий крок — наступний номер, не 3', steps!.content.includes('### 2. Монтаж ніжок'));
  t('додаткові поля кроку присутні', steps!.content.includes('Компоненти/матеріали кроку: Коробка') && steps!.content.includes('Критерій виконання: Усі деталі на місці'));
  t('без переданих elaborations — жодного [AI-DRAFT] у тексті', !steps!.content.includes('[AI-DRAFT]'));

  const finalCheck = byTitle(assemblyType.sections.finalCheck.heading);
  t('фінальна перевірка: чекбокс-буллет', plain(finalCheck?.content) === '☐ Стіл не хитається');

  const issues = byTitle(assemblyType.sections.troubleshooting.heading);
  t('типові помилки: проблема жирним, причина й дія окремими абзацами', issues?.content === '**Стіл хитається**\n\nПричина: Не затягнуті гвинти\n\nДія: Затягнути шестигранником');

  const warranty = byTitle(assemblyType.sections.warranty.heading);
  t('гарантія: порожні поля (notes) не додають зайвого рядка', warranty?.content === 'Термін / періодичність: 12 місяців\n\nВідповідальна особа: Виробник');

  const kb = byTitle(assemblyType.sections.knowledgeBase.heading);
  t('база знань: назва + посилання + витяг', plain(kb?.content) === '— Відео складання — https://example.com: Покроковий відеоурок');
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
  t('AI-DRAFT відкривається і закривається парою маркерів', noTags(steps.content).includes('[AI-DRAFT]\n\nПерший абзац.\n\nДругий абзац.\n\n[/AI-DRAFT]'));
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

console.log('\nКадри кроків (фото з телефона):');
{
  const doc = filledDoc();
  doc.steps[0] = { ...doc.steps[0], images: [{ assetId: 'a1', url: '/api/media/file/a1', caption: 'Розпакування, кадр 1' }, { assetId: 'a2', url: '/api/media/file/a2' }] };
  doc.steps[1] = { ...doc.steps[1], images: [{ assetId: 'skip', url: '/api/media/file/skip' }] }; // порожній крок — кадри не беруться
  doc.steps[2] = { ...doc.steps[2], images: [{ assetId: 'a3', url: '/api/media/file/a3', caption: 'Ніжка "ліва" [1]' }] };
  const illustrations = buildInstructionBookIllustrations(doc);
  t('ілюстрації — лише кадри змістовних кроків', illustrations.map((i) => i.url).join() === '/api/media/file/a1,/api/media/file/a2,/api/media/file/a3');
  t('id ілюстрацій унікальні й без пробілів', new Set(illustrations.map((i) => i.id)).size === 3 && illustrations.every((i) => /^[A-Za-z0-9_-]+$/.test(i.id)));
  t('підпис без символів, що ламають маркер', !/["\[\]]/.test(illustrations[2].caption), illustrations[2].caption);
  t('кадр без підпису отримує «Крок N, кадр M»', illustrations[1].caption === 'Крок 1, кадр 2', illustrations[1].caption);
  const steps = buildInstructionBookSections(doc, assemblyType).find((s) => s.title === assemblyType.sections.steps.heading)!;
  const markers = [...steps.content.matchAll(imageMarkerRegexp())];
  t('у тексті кроків стільки маркерів, скільки ілюстрацій', markers.length === illustrations.length, String(markers.length));
  t('id маркерів збігаються з id ілюстрацій, по порядку', markers.map((m) => m[1]).join() === illustrations.map((i) => i.id).join());
  t('маркер стоїть у блоці свого кроку, до наступного заголовка', steps.content.indexOf(illustrations[0].id) > steps.content.indexOf('### 1.') && steps.content.indexOf(illustrations[0].id) < steps.content.indexOf('### 2.'));
  t('режим обтікання — без обтікання', markers.every((m) => m[3] === 'none'));
  const plainAll = buildInstructionBookSections(filledDoc(), assemblyType).map((s) => s.content).join('\n');
  t('без кадрів у книзі немає маркерів, а ілюстрацій — порожній список', !plainAll.includes('[IMG:') && buildInstructionBookIllustrations(filledDoc()).length === 0);
}

console.log('\nТеги блоків інструкції (ставить код, не модель):');
{
  const doc = filledDoc();
  doc.steps[0] = {
    ...doc.steps[0], id: 's1', title: 'Розпакування', description: 'Дістати деталі з коробки.\n\nПерелічити їх за списком.', components: 'Коробка', toolsResources: 'Ніж',
    warning: 'Ріжте від себе', successCriterion: 'Усі деталі на столі', sourceIds: ['k1'], images: [{ assetId: 'a1', url: '/api/media/file/a1', caption: 'Розпакування, кадр 1' }],
  };
  const sections = buildInstructionBookSections(doc, assemblyType, ['Додатково: розкладіть деталі за номерами.']);
  const by = (h: string) => sections.find((x) => x.title === h)!;
  const tagsOf = (text: string) => parseEntityTagsInSource(text).map((x) => x.tag.replace(/^\//, ''));
  const valuesOf = (text: string, slug: string) => parseEntityTagsInSource(text).filter((x) => x.tag.replace(/^\//, '') === slug).map((x) => x.value);

  t('усі типи тегів є в реєстрі сутностей', sections.every((x) => tagsOf(x.content).every((slug) => isRegisteredEntityType(slug))));
  t('огляд — instruction з назвою виробу', valuesOf(by(assemblyType.sections.overview.heading).content, 'instruction')[0] === 'Стіл письмовий');
  t('комплектація — component на кожен непорожній рядок', valuesOf(by(assemblyType.sections.materials.heading).content, 'component').join() === 'Стільниця — 1');
  t('інструменти — tool на кожен рядок', valuesOf(by(assemblyType.sections.tools.heading).content, 'tool').join() === 'Шуруповерт,Рулетка');
  t('безпека — safety-rule (застереження використання)', valuesOf(by(assemblyType.sections.warnings.heading).content, 'safety-rule').join() === 'Не переносити в одиночку');
  t('фінальна перевірка — requirement', valuesOf(by(assemblyType.sections.finalCheck.heading).content, 'requirement').join() === 'Стіл не хитається');
  t('база знань — source', valuesOf(by(assemblyType.sections.knowledgeBase.heading).content, 'source')[0] === 'Відео складання');
  t('типові помилки й гарантія без тегів (тип неоднозначний — це робота Jev)', tagsOf(by(assemblyType.sections.troubleshooting.heading).content).length === 0 && tagsOf(by(assemblyType.sections.warranty.heading).content).length === 0);

  const steps = by(assemblyType.sections.steps.heading).content;
  const stepVals = valuesOf(steps, 'step');
  t('кожен крок несе свій тег step із номером і назвою', stepVals.includes('1. Розпакування') && stepVals.includes('2. Монтаж ніжок'));
  t('службові рядки кроку: component, tool, safety-rule, requirement, source', ['component', 'tool', 'safety-rule', 'requirement', 'source'].every((slug) => valuesOf(steps, slug).length > 0));
  t('значення службових тегів — вміст рядка', valuesOf(steps, 'component')[0] === 'Коробка' && valuesOf(steps, 'tool')[0] === 'Ніж' && valuesOf(steps, 'safety-rule')[0] === 'Ріжте від себе' && valuesOf(steps, 'requirement')[0] === 'Усі деталі на столі');
  const extraParas = steps.split(/\n{2,}/).filter((para) => /^(Компоненти\/матеріали кроку|Інструменти\/ресурси|Критерій виконання|Джерела): /.test(para));
  t('службові рядки кроку — окремі абзаци (4 з 4), без переносу всередині', extraParas.length === 4 && extraParas.every((para) => !para.includes('\n')));
  t('кожен службовий абзац кроку несе тег кроку', extraParas.every((para) => parseEntityTagsInSource(para).some((tg) => tg.slug === 'step')));
  t('кадр кроку — image із підписом', valuesOf(steps, 'image').join() === 'Розпакування, кадр 1');
  t('обидва абзаци опису й доповнення ШІ несуть тег кроку', steps.split('\n\n').filter((para) => /Дістати деталі|Перелічити їх|розкладіть деталі/.test(para)).every((para) => para.includes('[/step:1. Розпакування]')));
  t('в абзаці не більше тегів, ніж дозволяє реєстр', sections.every((x) => x.content.split(/\n{2,}/).every((para) => parseEntityTagsInSource(para).length <= MAX_ENTITIES_PER_PARAGRAPH)));
  t('читач тегів не бачить: після зняття не лишається жодного [/…:', sections.every((x) => !/\[\/[a-z0-9-]+:/.test(stripEntityTags(x.content))));
  t('значення тегів без дужок, довжина в межах', sections.every((x) => parseEntityTagsInSource(x.content).every((tg) => !/[\[\]]/.test(tg.value) && tg.value.length <= 80)));

  // Кожен пункт списку — окремий абзац: PDF склеює рядки одного абзацу в суцільний текст (запис #534).
  const big = filledDoc();
  big.materials = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, code: `K${i}`, name: `Деталь ${i + 1}`, qty: '1' }));
  const bigMaterials = buildInstructionBookSections(big, assemblyType).find((x) => x.title === assemblyType.sections.materials.heading)!.content;
  const bigParas = bigMaterials.split(/\n{2,}/);
  t('30 деталей — 30 абзаців, у кожному один пункт і один тег component', parseEntityTagsInSource(bigMaterials).length === 30 && bigParas.length === 30 && bigParas.every((para) => !para.includes('\n') && parseEntityTagsInSource(para).length === 1));
  const longWarn = filledDoc();
  longWarn.warnings = ['Не ' + 'дуже '.repeat(40) + 'обережно [важливо]'];
  const warnVals = valuesOf(buildInstructionBookSections(longWarn, assemblyType).find((x) => x.title === assemblyType.sections.warnings.heading)!.content, 'safety-rule');
  t('довге застереження: значення тега обрізано, дужки прибрано', warnVals.length === 1 && warnVals[0].length <= 80 && !/[\[\]]/.test(warnVals[0]));

  // Індекс тегів рукопису бачить абзаци кроків із типом.
  const index = manuscriptTagIndex({ chapters: [{ id: 'c', sections: sections.map((x, i) => ({ id: `s${i}`, content: x.content })) }] });
  t('індекс тегів: абзаци кроку мають тег step', index.some((row) => row.tags.some((tg) => tg === '/step:1. Розпакування')));
  t('індекс тегів: текст рядка без службових тегів', index.every((row) => !row.text.includes('[/')));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
