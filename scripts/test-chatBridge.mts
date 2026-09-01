/**
 * Тести мосту «книга ↔ чат».
 * Запуск: npm run test:chat-bridge
 *
 * Дві речі, які ламаються тихо:
 *   1) вставка з чату потрапляє не в той розділ — текст не зникає, тож
 *      помилку помічають лише коли книга вже перечитана;
 *   2) фрагмент іде в модель без межі між уривком і питанням — модель
 *      приймає уривок за вказівку й переписує його замість обговорення.
 */
import {
  appendTextToChapterEnd,
  formatFragmentForChat,
  CHAT_FRAGMENT_LIMIT,
} from '../src/utils/bookText.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const sec = (id: string, order: number, content: string) => ({
  id, chapterId: 'ch1', title: `Розділ ${order}`, order, content,
  wordCount: content.split(/\s+/).filter(Boolean).length, lastModified: '2026-01-01T00:00:00.000Z',
});
const chapters = () => ([
  {
    id: 'ch1', bookId: 'b1', title: 'Глава перша', order: 1,
    sections: [sec('s1', 1, 'Початок.'), sec('s2', 2, 'Середина.'), sec('s3', 3, 'Кінець.')],
  },
  { id: 'ch2', bookId: 'b1', title: 'Глава друга', order: 2, sections: [sec('s4', 1, 'Друга.')] },
] as any);

console.log('\nВибір розділу для вставки:');
{
  const r = appendTextToChapterEnd(chapters(), 'ch1', 'ВСТАВКА', 's2')!;
  t('текст пішов саме в обраний розділ', r.sectionId === 's2');
  const target = r.chapters[0].sections.find((s: any) => s.id === 's2');
  t('текст справді дописано', target.content === 'Середина.\n\nВСТАВКА');
  t('позиція вставки вказує на її початок', target.content.slice(r.start, r.end) === 'ВСТАВКА');
  const untouched = r.chapters[0].sections.find((s: any) => s.id === 's3');
  t('сусідній розділ не зачеплено', untouched.content === 'Кінець.');
  t('лічильник слів оновлено', target.wordCount === 2);

  // Стара поведінка має лишитись цілою: виклики без вибору розділу.
  const legacy = appendTextToChapterEnd(chapters(), 'ch1', 'ХВІСТ')!;
  t('без вибору — останній розділ за order', legacy.sectionId === 's3');

  t('перший розділ теж доступний', appendTextToChapterEnd(chapters(), 'ch1', 'X', 's1')!.sectionId === 's1');
}

console.log('\nЧужий або неіснуючий розділ:');
{
  // Найважливіше: не «дописати кудись», а відмовитись.
  t('невідомий sectionId → null', appendTextToChapterEnd(chapters(), 'ch1', 'X', 'немає') === null);
  t('розділ із ЧУЖОЇ глави → null', appendTextToChapterEnd(chapters(), 'ch1', 'X', 's4') === null);
  t('невідома глава → null', appendTextToChapterEnd(chapters(), 'chX', 'X', 's1') === null);
  t('порожній текст → null', appendTextToChapterEnd(chapters(), 'ch1', '   ', 's1') === null);
}

console.log('\nПорожній розділ:');
{
  const empty = [{ id: 'ch1', bookId: 'b1', title: 'Г', order: 1, sections: [sec('s1', 1, '')] }] as any;
  const r = appendTextToChapterEnd(empty, 'ch1', 'Перше речення.', 's1')!;
  t('без зайвого роздільника на початку', r.chapters[0].sections[0].content === 'Перше речення.');
  t('start = 0 у порожньому розділі', r.start === 0);
}

console.log('\nФрагмент для чату:');
{
  const f = formatFragmentForChat('Ліда прокинулась.', 'Глава перша → Ранок');
  t('уривок узято в лапки', f.includes('«Ліда прокинулась.»'));
  t('джерело підписано', f.includes('Глава перша → Ранок'));
  t('є межа між уривком і рештою', f.startsWith('Фрагмент книги'));

  const noWhere = formatFragmentForChat('Текст.');
  t('без джерела дужок не лишається', !noWhere.includes('()') && noWhere.includes('«Текст.»'));

  t('порожній текст — порожній рядок', formatFragmentForChat('   ') === '');
  t('null не кидає', formatFragmentForChat(null as any) === '');

  const long = 'слово '.repeat(2000);
  const cut = formatFragmentForChat(long);
  t('задовгий уривок обрізано', cut.length < long.length);
  t('обрізано близько до межі', cut.length <= CHAT_FRAGMENT_LIMIT + 60, `${cut.length}`);
  t('обрізання позначено трикрапкою', cut.includes('…'));
  t('обрізано по межі слова', !/\sсло…/.test(cut));

  const short = formatFragmentForChat('Коротко.');
  t('короткий уривок не чіпаємо', !short.includes('…'));

  t('переноси рядків усередині збережено', formatFragmentForChat('Перший.\n\nДругий.').includes('Перший.\n\nДругий.'));
  t('caret-return прибрано', !formatFragmentForChat('А.\r\nБ.').includes('\r'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
