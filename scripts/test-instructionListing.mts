/**
 * Назва інструкції у вітрині. Запуск: npm run test:instruction-listing
 *
 * РІШЕННЯ ВЛАСНИКА (12.11.2026, запис #556): «інструкція іде на вітрину книгою
 * під назвою "Інструкція з ....."». Окремого виду лістинга у вітрині не
 * завдумо — там це книга; змінюється лише назва, і в журналі публікацій
 * інструкція рахується окремо.
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ:
 *  1. Підпис типу беремо з каталогу (`docBadge`), а не з копії на сервері —
 *     тож перевіряємо, що з КОЖНОГО реального типу виходить читабельна назва,
 *     а не «ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ: шафа» великими літерами.
 *  2. Подвійний префікс. Автор, який назвав документ «Інструкція зі складання
 *     шафи», не має отримати «Інструкція зі складання: Інструкція зі складання
 *     шафи» — найочевидніша дурість автоматичного префікса.
 *  3. Слід інструкції має ДОЇХАТИ: конструктор → книга → сервер. Ламається це
 *     не логікою, а пропущеним місцем, тож ці місця перевіряються по джерелах.
 *  4. Друковане видання лишається підписаним «(друковане видання)».
 */
import fs from 'node:fs';

const listing = await import('../shared/instructionListing');
const types = await import('../src/data/instructionTypes');
const bookBuild = await import('../src/utils/instructionBook');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

console.log('\n── Підпис типу стає назвою ──');
t('«ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ» → «Інструкція зі складання»',
  listing.instructionBadgeSentence('ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ') === 'Інструкція зі складання',
  listing.instructionBadgeSentence('ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ'));
t('порожній підпис — просто «Інструкція»', listing.instructionBadgeSentence('   ') === 'Інструкція');

for (const type of types.INSTRUCTION_TYPES) {
  const title = listing.instructionListingTitle({ docType: type.id, badge: type.docBadge, name: 'Шафа Соло' });
  const sentence = listing.instructionBadgeSentence(type.docBadge);
  t(`тип ${type.id}: «${title}»`,
    title === `${sentence}: Шафа Соло` && title.startsWith('Інструкція') && title === title.replace(/^ИНСТРУКЦИЯ/, ''),
    title);
  t(`тип ${type.id}: назва не криком`, !/[А-ЯІЇЄҐ]{4,}/.test(sentence), sentence);
}

console.log('\n── Межові випадки назви ──');
const mk = (name: string) => listing.instructionListingTitle({ docType: 'assembly', badge: 'ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ', name });
t('звичайна назва отримує префікс', mk('Шафа Соло') === 'Інструкція зі складання: Шафа Соло', mk('Шафа Соло'));
t('назва вже з «Інструкція» — без другого префікса', mk('Інструкція зі складання шафи') === 'Інструкція зі складання шафи', mk('Інструкція зі складання шафи'));
t('малими літерами теж розпізнається', mk('інструкція до станка') === 'інструкція до станка', mk('інструкція до станка'));
t('«Інструкції» у множині теж', mk('Інструкції для монтажників') === 'Інструкції для монтажників', mk('Інструкції для монтажників'));
t('порожня назва — лише підпис типу', mk('   ') === 'Інструкція зі складання', mk('   '));
t('зайві пробіли обрізано', mk('  Шафа  ') === 'Інструкція зі складання: Шафа', mk('  Шафа  '));
t('«Інструментальний цех» НЕ вважається інструкцією',
  mk('Інструментальний цех') === 'Інструкція зі складання: Інструментальний цех', mk('Інструментальний цех'));

console.log('\n── Слід доїжджає до книги ──');
const origin = { docType: 'assembly', badge: 'ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ', name: 'Шафа Соло' };
const built = bookBuild.buildBookFromInstructionPayload(
  { title: 'Шафа Соло', sections: [{ title: 'Огляд', content: 'Текст' }], instruction: origin },
  { now: 1762900000000, author: 'Денис', authorRole: 'writer' },
);
t('книга несе слід інструкції', JSON.stringify(built.book.instructionOrigin) === JSON.stringify(origin), JSON.stringify(built.book.instructionOrigin));
t('назва самої книги не змінюється', built.book.title === 'Шафа Соло', built.book.title);
const plain = bookBuild.buildBookFromInstructionPayload(
  { title: 'Повість', sections: [{ title: 'Р', content: '' }] },
  { now: 1762900000000, author: 'Денис', authorRole: 'writer' },
);
t('без сліду поле не вигадується', plain.book.instructionOrigin === undefined);

console.log('\n── Місця, де слід ставиться і читається ──');
const src = (p: string) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const builder = src('src/components/InstructionBuilderView.tsx');
t('конструктор віддає слід разом із книгою', builder.includes('const instruction = { docType: type.id, badge: type.docBadge, name: title };'));
t('слід іде в payload', builder.includes('onInstructionBookCreated?.({ title, sections, instruction,'));
t('верстка PDF складає книгу з тим самим слідом', builder.includes('instruction: { docType: type.id, badge: type.docBadge, name: buildInstructionBookTitle(doc, type) }'));

const book = src('src/utils/instructionBook.ts');
t('складання книги переносить слід', book.includes('if (payload.instruction) book.instructionOrigin = payload.instruction;'));

const routes = src('server/pdfRoutesBase.ts');
t('сервер бере назву з помічника, а не ліпить префікс сам', routes.includes("from '../shared/instructionListing'"));
t('публікація з браузера: назва з інструкції', routes.includes('instrOrigin ? instructionListingTitle(instrOrigin) : String(book.title)'));
t('публікація з адмінки: назва з інструкції', routes.includes('${instructionListingTitle(storedInstruction)}'));
t('друковане видання лишається підписаним', routes.includes("format === 'print' ? ' (друковане видання)' : ''"));
t('у журналі обидва місця рахують інструкцію окремо',
  (routes.match(/kind: (instrOrigin|storedInstruction) \? 'instruction' : 'book'/g) || []).length === 2,
  String((routes.match(/kind: (instrOrigin|storedInstruction) \? 'instruction' : 'book'/g) || []).length));

const pubs = src('server/storefrontPublications.ts');
t('журнал знає вид «instruction»', pubs.includes("| 'instruction'"));
const admin = src('server/adminRoutes.ts');
t('маршрут адмінки приймає фільтр за інструкціями', admin.includes("kind === 'instruction'"));
const view = src('src/components/AdminProductsView.tsx');
t('в адмінці інструкція має власну позначку', view.includes("instruction: 'Інструкція'"));

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail) process.exit(1);
