/**
 * Тести appendTextToChapterEnd (src/utils/bookText.ts) — «Передати текст у
 * книгу» з AI-чату (QuickAiModal.tsx → App.tsx handleSendChatTextToChapter).
 * Запуск: npm run test:book-text
 *
 * Чиста функція, без React/DOM — той самий підхід, що для server/chatRoutes.ts
 * (scripts/test-chatSessions.mts): тестуємо шов напряму, без браузера.
 */
import type { Chapter } from '../src/types.ts';
import { appendTextToChapterEnd } from '../src/utils/bookText.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

function makeSection(id: string, order: number, content: string) {
  return {
    id, chapterId: 'chap-1', title: `Секція ${order}`, order, content,
    wordCount: 0, lastModified: '2020-01-01T00:00:00.000Z',
  };
}

console.log('\nappendTextToChapterEnd — дописує в кінець ОСТАННЬОЇ секції розділу:');
{
  const chapters: Chapter[] = [
    {
      id: 'chap-1', bookId: 'book-1', title: 'Глава 1', order: 1,
      sections: [makeSection('sec-1', 1, 'Hello.')],
    },
  ];

  const result = appendTextToChapterEnd(chapters, 'chap-1', 'World.');
  t('повертає результат (не null)', result !== null);
  t('роздільник — порожній рядок, коли контенту секції ще нема, або \\n\\n, коли є',
    result?.chapters[0].sections[0].content === 'Hello.\n\nWorld.',
    result?.chapters[0].sections[0].content);
  t('start вказує на позицію ПІСЛЯ старого контенту й роздільника', result?.start === 'Hello.\n\n'.length, String(result?.start));
  t('end = start + довжина вставленого тексту', result?.end === (result?.start ?? 0) + 'World.'.length, String(result?.end));
  t('sectionId вказує саме на секцію, куди вставили', result?.sectionId === 'sec-1');
}

console.log('\nappendTextToChapterEnd — секція без наявного тексту:');
{
  const chapters: Chapter[] = [
    {
      id: 'chap-1', bookId: 'book-1', title: 'Глава 1', order: 1,
      sections: [makeSection('sec-1', 1, '')],
    },
  ];

  const result = appendTextToChapterEnd(chapters, 'chap-1', 'Перший рядок.');
  t('немає зайвого роздільника перед першим текстом секції',
    result?.chapters[0].sections[0].content === 'Перший рядок.',
    result?.chapters[0].sections[0].content);
  t('start = 0, коли секція була порожня', result?.start === 0, String(result?.start));
}

console.log('\nappendTextToChapterEnd — «остання секція» визначається за order, не за позицією в масиві:');
{
  const chapters: Chapter[] = [
    {
      id: 'chap-1', bookId: 'book-1', title: 'Глава 1', order: 1,
      // Навмисно в масиві секція з order=2 йде ПЕРШОЮ — має однаково знайти order=3 як останню.
      sections: [
        makeSection('sec-mid', 2, 'Середина.'),
        makeSection('sec-last', 3, 'Кінець.'),
        makeSection('sec-first', 1, 'Початок.'),
      ],
    },
  ];

  const result = appendTextToChapterEnd(chapters, 'chap-1', 'Додано.');
  t('вставляє в секцію з найбільшим order (sec-last), а не в першу в масиві',
    result?.sectionId === 'sec-last', result?.sectionId);
  t('інші секції розділу лишаються незмінними',
    result?.chapters[0].sections.find((s) => s.id === 'sec-mid')?.content === 'Середина.' &&
    result?.chapters[0].sections.find((s) => s.id === 'sec-first')?.content === 'Початок.');
}

console.log('\nappendTextToChapterEnd — розділ не знайдено або без секцій:');
{
  const chapters: Chapter[] = [
    { id: 'chap-1', bookId: 'book-1', title: 'Глава 1', order: 1, sections: [makeSection('sec-1', 1, 'X')] },
    { id: 'chap-empty', bookId: 'book-1', title: 'Порожня глава', order: 2, sections: [] },
  ];

  t('невідомий chapterId → null', appendTextToChapterEnd(chapters, 'no-such-chapter', 'текст') === null);
  t('розділ без жодної секції → null', appendTextToChapterEnd(chapters, 'chap-empty', 'текст') === null);
  t('порожній/пробільний текст → null', appendTextToChapterEnd(chapters, 'chap-1', '   ') === null);
}

console.log('\nappendTextToChapterEnd — не чіпає інші розділи книги (імутабельність):');
{
  const otherChapter: Chapter = { id: 'chap-2', bookId: 'book-1', title: 'Глава 2', order: 2, sections: [makeSection('sec-2', 1, 'Не чіпати.')] };
  const chapters: Chapter[] = [
    { id: 'chap-1', bookId: 'book-1', title: 'Глава 1', order: 1, sections: [makeSection('sec-1', 1, 'X')] },
    otherChapter,
  ];

  const result = appendTextToChapterEnd(chapters, 'chap-1', 'Y');
  t('інший розділ повертається тим самим об’єктом (без зайвого клонування)', result?.chapters[1] === otherChapter);
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail > 0 ? 1 : 0);
