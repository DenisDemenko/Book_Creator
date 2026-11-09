/**
 * Тести PDF-верстки інструкції за шаблоном і рушієм (журнал #533). Запуск: npm run test:instruction-pdf
 *
 * Чиста логіка: перелік шаблонів, вибір → верстка в документі, застосування до книги, складання книги з документа
 * (те саме, що тепер робить App.handleInstructionBookCreated і PDF-верстка просто з конструктора).
 */
import {
  DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY,
  applyInstructionPdfLayout,
  buildInstructionPdfLayout,
  instructionPdfTemplateByKey,
  instructionPdfTemplates,
  templateKeyForLayout,
} from '../src/utils/instructionPdf.ts';
import { buildBookFromInstructionPayload } from '../src/utils/instructionBook.ts';
import { BOOK_DESIGN_THEME_CARDS } from '../src/data/bookDesignThemeCatalog.ts';
import { EDUCATIONAL_PDF_TEMPLATES } from '../src/data/educationalPdfTemplates.ts';
import { initialBookData } from '../src/data/initialBook.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`); };

console.log('\nПерелік шаблонів:');
{
  const all = instructionPdfTemplates();
  const edu = all.filter((x) => x.group === 'instruction');
  const books = all.filter((x) => x.group === 'book');
  t('три навчальні шаблони для інструкцій — рівно ті, що є в Студії', edu.length === 3 && edu.every((x) => EDUCATIONAL_PDF_TEMPLATES.some((e) => e.id === x.educationalTemplateId && e.documentType === 'instruction')));
  t('усі вбудовані шаблони книги в переліку', books.length === BOOK_DESIGN_THEME_CARDS.length && books.every((x) => BOOK_DESIGN_THEME_CARDS.some((c) => c.id === x.designThemeId)));
  t('ключі унікальні', new Set(all.map((x) => x.key)).size === all.length);
  t('навчальний шаблон іде в рушій через свій базовий шаблон книги', edu.every((x) => EDUCATIONAL_PDF_TEMPLATES.find((e) => e.id === x.educationalTemplateId)!.rendererBaseTheme === x.designThemeId));
  t('шаблони для інструкцій — першими', all.slice(0, 3).every((x) => x.group === 'instruction'));
  t('кожен шаблон має назву й опис', all.every((x) => x.label.trim() && x.description.trim()));
  t('типовий ключ існує', !!instructionPdfTemplateByKey(DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY));
  t('невідомий ключ — undefined', instructionPdfTemplateByKey('book:нема') === undefined && instructionPdfTemplateByKey(undefined) === undefined);
}

console.log('\nВибір → верстка в документі:');
{
  const at = new Date('2026-11-09T20:00:00.000Z');
  const edu = buildInstructionPdfLayout('edu:instruction-visual-flow', 'designcraft', at);
  t('навчальний шаблон: id, тема книги, рушій, час', edu.templateKey === 'edu:instruction-visual-flow' && edu.educationalTemplateId === 'instruction-visual-flow' && edu.designThemeId === EDUCATIONAL_PDF_TEMPLATES.find((e) => e.id === 'instruction-visual-flow')!.rendererBaseTheme && edu.engineId === 'designcraft' && edu.updatedAt === at.toISOString());
  const book = buildInstructionPdfLayout('book:sci-fi', 'nova', at);
  t('шаблон книги: без навчального id', book.designThemeId === 'sci-fi' && book.educationalTemplateId === undefined && !('educationalTemplateId' in book));
  const unknown = buildInstructionPdfLayout('щось-старе', 'nova', at);
  t('невідомий шаблон → типовий, не падіння', unknown.templateKey === DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY);
  t('діалог відкривається зі збереженим шаблоном', templateKeyForLayout(book) === 'book:sci-fi');
  t('збережений шаблон зник із Студії → типовий', templateKeyForLayout({ ...book, templateKey: 'book:видалений' }) === DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY);
  t('верстки ще немає → типовий', templateKeyForLayout(undefined) === DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY && templateKeyForLayout(null) === DEFAULT_INSTRUCTION_PDF_TEMPLATE_KEY);
  const before = JSON.stringify(initialBookData.layoutConfig);
  const applied = applyInstructionPdfLayout(initialBookData as any, book);
  t('застосування ставить шаблон книги', (applied.layoutConfig as any).bookDesignThemeId === 'sci-fi');
  t('вхідну книгу не змінює', JSON.stringify(initialBookData.layoutConfig) === before && applied !== (initialBookData as any));
}

console.log('\nКнига з документа інструкції:');
{
  const now = Date.UTC(2026, 10, 9, 20, 0, 0);
  const payload = {
    title: '  Стіл  ',
    sections: [{ title: 'Опис виробу', content: 'Перший абзац тексту.' }, { title: 'Кроки', content: 'Крок один два три' }],
    illustrations: [{ id: 'ill-1', url: '/api/media/file/a1', caption: 'Кадр 1' }],
  };
  const built = buildBookFromInstructionPayload(payload, { now, author: 'Авторка', authorRole: 'writer' });
  const b = built.book;
  t('назва без зайвих пропусків, автор', b.title === 'Стіл' && b.author === 'Авторка');
  t('одна глава з розділами у порядку', b.chapters.length === 1 && b.chapters[0].id === built.chapterId && b.chapters[0].sections.map((s) => s.title).join() === 'Опис виробу,Кроки' && built.sections.length === 2);
  t('id розділів і книги — від часу', built.sections[0].id === `sec-${now}-1` && b.id === `BK-${now.toString(36).toUpperCase()}` && built.chapterId === `chap-${now}-1`);
  t('кількість слів пораховано', built.sections[0].wordCount === 3 && built.sections[1].wordCount === 4);
  t('кадри кроків — в альбомі книги (після withoutDemoContent), привʼязані до глави', b.illustrations?.length === 1 && b.illustrations[0].id === 'ill-1' && b.illustrations[0].chapterId === built.chapterId && b.illustrations[0].url === '/api/media/file/a1');
  t('демо-вміст зразка не лишився', (b.characters ?? []).length === 0);
  t('історія версій: перший знімок із роллю автора', b.versionHistory?.length === 1 && (b.versionHistory![0] as any).authorRole === 'writer' && b.versionHistory![0].tags.includes('Інструкція'));
  t('без шаблону тема книги не чіпається', JSON.stringify(b.layoutConfig) === JSON.stringify(buildBookFromInstructionPayload({ ...payload }, { now, author: 'А', authorRole: 'writer' }).book.layoutConfig));
  const themed = buildBookFromInstructionPayload(payload, { now, author: 'А', authorRole: 'writer', designThemeId: 'non-fiction' });
  t('обраний шаблон лягає в книгу', (themed.book.layoutConfig as any).bookDesignThemeId === 'non-fiction');
  const empty = buildBookFromInstructionPayload({ title: '   ', sections: [] }, { now, author: 'А', authorRole: 'writer' });
  t('порожня назва — «Нова інструкція», порожні розділи — один порожній «Розділ»', empty.book.title === 'Нова інструкція' && empty.sections.length === 1 && empty.sections[0].title === 'Розділ' && (empty.book.illustrations ?? []).length === 0);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
