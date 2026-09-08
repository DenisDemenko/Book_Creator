/**
 * Тести тренажера «Стиль письменника»:
 *   1) дані 8 компонентів / 24 вправи повні й несуперечливі;
 *   2) вставка відповіді автора в рукопис за тегом (collectBookTags +
 *      insertTextAfterTagInBook);
 *   3) вставка в кінець глави (appendTextToChapterEnd — місток, який
 *      використовує onSendTextToChapter).
 * Запуск: npm run test:style-trainer
 *
 * Чисті функції, без React/DOM.
 */
import type { Book } from '../src/types.ts';
import { STYLE_COMPONENTS, STYLE_CRITERIA_LABELS } from '../src/data/styleTrainerData.ts';
import { collectBookTags, insertTextAfterTagInBook } from '../src/utils/bookTags.ts';
import { appendTextToChapterEnd } from '../src/utils/bookText.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

function makeBookWithTag(): Book {
  const section = {
    id: 'sec-1',
    chapterId: 'chap-1',
    title: 'Розділ 1',
    order: 1,
    content: 'Перший абзац сцени.\n\nтега: #діалог_кав\'ярня\n\nОстанній абзац розділу.',
    wordCount: 18,
    lastModified: '2020-01-01T00:00:00.000Z',
  };
  const book = {
    id: 'book-test',
    version: 'v1',
    revisionNumber: 1,
    title: 'Тестова книга',
    author: 'Автор',
    language: 'uk',
    genre: 'Проза',
    synopsis: '…',
    logline: '…',
    theme: '…',
    status: 'editing' as const,
    chapters: [
      { id: 'chap-1', bookId: 'book-test', title: 'Глава 1', order: 1, sections: [section] },
    ],
    characters: [],
    visualBible: {} as never,
    layoutConfig: {} as never,
    coverConfig: {} as never,
  };
  return book as unknown as Book;
}

console.log('\nДані тренажера — 8 компонентів, по 3 вправи:');
{
  t('компонентів рівно 8', STYLE_COMPONENTS.length === 8, String(STYLE_COMPONENTS.length));
  t('у кожного компонента 3 вправи', STYLE_COMPONENTS.every((c) => c.exercises.length === 3));
  t('Частина 1 — 4 компоненти, Частина 2 — 4', STYLE_COMPONENTS.filter((c) => c.part === 1).length === 4 && STYLE_COMPONENTS.filter((c) => c.part === 2).length === 4);
  t('у кожного компонента є trainerType з префіксом style-', STYLE_COMPONENTS.every((c) => c.trainerType.startsWith('style-')));
  t('всі id вправ унікальні', new Set(STYLE_COMPONENTS.flatMap((c) => c.exercises.map((e) => e.id))).size === 24);
  t('у кожної вправи заповнені question/theory/placeholder/sample',
    STYLE_COMPONENTS.every((c) => c.exercises.every((e) => e.question.trim() && e.theory.trim() && e.placeholder.trim() && e.sample.trim())));
  t('для кожного trainerType задано 3 критерії', STYLE_COMPONENTS.every((c) => STYLE_CRITERIA_LABELS[c.trainerType]?.length === 3));
}

console.log('\nВставка за тегом — collectBookTags + insertTextAfterTagInBook:');
{
  const book = makeBookWithTag();
  const tags = collectBookTags(book);
  t('знайдено тег #діалог_кав\'ярня', tags.length === 1 && tags[0].name === "#діалог_кав'ярня", JSON.stringify(tags.map((x) => x.name)));

  const updated = insertTextAfterTagInBook(book, tags[0], 'Новий абзац від автора.');
  t('повертає оновлену книгу (не null)', updated !== null);
  const newContent = updated?.chapters[0].sections[0].content || '';
  t('текст вставлено одразу ПІСЛЯ тегу', newContent.includes("тега: #діалог_кав'ярня\n\nНовий абзац від автора."), newContent);
  t('останній абзац розділу зберігся після вставки', newContent.endsWith('Останній абзац розділу.'), newContent);
  t('wordCount секції перераховано (більше 0)', (updated?.chapters[0].sections[0].wordCount || 0) > 0);

  // Тег уже нема в книзі → null, книга не ламається.
  const missing = insertTextAfterTagInBook(book, { name: '#нема', chapterId: 'chap-1', chapterTitle: 'Глава 1', sectionId: 'sec-1', sectionTitle: 'Розділ 1' }, 'X');
  t('відсутній тег повертає null', missing === null);
}

console.log('\nВставка в кінець глави — appendTextToChapterEnd:');
{
  const book = makeBookWithTag();
  const result = appendTextToChapterEnd(book.chapters, 'chap-1', 'Фінальний фрагмент.');
  t('дописує в останню секцію', result !== null && result.chapters[0].sections[0].content.endsWith('Фінальний фрагмент.'));
  t('start/end вказують на вставлений діапазон', result?.end === (result?.start ?? 0) + 'Фінальний фрагмент.'.length);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} провалено.`);
if (fail > 0) process.exit(1);
