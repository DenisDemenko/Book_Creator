/**
 * Картка курсу в черзі модерації — на реальному компоненті, без браузера.
 * Запуск: npm run test:admin-course-review
 *
 * `renderToStaticMarkup` рендерить справжній CourseReviewCard (той самий
 * прийом, що в test-instructionBuilderView): ловить розсинхрон між даними
 * сервера й тим, що адмін бачить на екрані.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CourseReviewCard } from '../src/components/AdminCourseReview.tsx';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const course = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'Курс з основ ЧПУ',
  subtitle: 'Від нуля до першої деталі',
  summary: 'Короткий опис',
  description: 'Повний опис\nдругий рядок',
  audience: ['Школярі'],
  outcomes: ['Зробите деталь'],
  highlights: ['a', 'b', 'c'],
  coverUrl: 'https://example.test/cover.png',
  priceMinor: 150000,
  skills: [{ id: 's1', name: 'Безпека', level: 'base', whyItMatters: 'Без неї немає роботи' }],
  modules: [
    {
      id: 'm1', title: 'Знайомство', summary: 'Що це за верстат',
      introVideoUrl: 'https://vimeo.com/123456789',
      lessons: [
        { id: 'l1', title: 'Огляд', durationMin: 12, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' },
        { id: 'l2', title: 'Безпека', durationMin: 9, videoUrl: 'https://drive.google.com/x', assignment: { title: 'Чекліст' } },
      ],
    },
  ],
  ...over,
});
const entry = (over: Record<string, unknown> = {}) => ({ id: 'e1', status: 'pending', createdAt: '2026-10-27T10:00:00Z', ...over });
const render = (detail: any, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(CourseReviewCard, {
    entryId: 'e1', detail, busy: false, error: null, onDecide: () => {}, onClose: () => {}, ...extra,
  }));

console.log('\nПовна картка:');
{
  const html = render({ entry: entry(), course: course(), source: 'snapshot', category: { slug: 'chpu', name: 'ЧПУ та верстати' }, problems: [], changes: [] });
  t('назва й підзаголовок', html.includes('Курс з основ ЧПУ') && html.includes('Від нуля до першої деталі'));
  t('ціна у гривнях', /1[\s ]500 грн/.test(html), html.match(/dd[^>]*>[^<]*грн/)?.[0]);
  t('назва категорії, а не slug', html.includes('ЧПУ та верстати'));
  t('обкладинка показана', html.includes('src="https://example.test/cover.png"'));
  t('обсяг: модулі, уроки, хвилини', html.includes('1 модулів · 2 уроків · 21 хв'));
  t('аудиторія, результати, вигоди', html.includes('Школярі') && html.includes('Зробите деталь'));
  t('навичка з рівнем', html.includes('Безпека') && html.includes('базова'));
  t('програма: модуль і уроки з тривалістю', html.includes('Модуль 1. Знайомство') && html.includes('1.1 Огляд') && html.includes('12 хв'));
  t('YouTube і Vimeo названі', html.includes('YouTube') && html.includes('Vimeo'));
  t('невідоме посилання на відео підсвічено', html.includes('невідоме посилання'));
  t('завдання уроку видно', html.includes('Чекліст'));
  t('немає блоків зауважень і змін', !html.includes('data-review="problems"') && !html.includes('data-review="changes"'));
  t('кнопки трьох рішень', html.includes('Опублікувати') && html.includes('Повернути із зауваженнями') && html.includes('Відхилити остаточно'));
  t('«Опублікувати» доступна', !/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Опублікувати/s.test(html));
}

console.log('\nКурс із порушеннями:');
{
  const html = render({ entry: entry(), course: course({ priceMinor: undefined, coverUrl: '' }), source: 'snapshot', category: null,
    problems: ['Не вказано ціну.', 'Немає обкладинки.'], changes: [] });
  t('перелік порушень показаний', html.includes('data-review="problems"') && html.includes('Не вказано ціну.'));
  t('ціна «не вказана»', html.includes('не вказана'));
  t('замість обкладинки — попередження', html.includes('Немає обкладинки'));
  t('«Опублікувати» вимкнена', /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Опублікувати/s.test(html));
  t('категорії нема — так і написано', html.includes('без категорії'));
}

console.log('\nБезкоштовний і змінений після подання:');
{
  const html = render({ entry: entry(), course: course({ free: true, priceMinor: 0 }), source: 'snapshot', category: null, problems: [],
    changes: ['Ціна: 1 500 грн → 1 200 грн.', 'Програма змінена (модулів 1 → 2).'] });
  t('«Безкоштовно»', html.includes('Безкоштовно'));
  t('блок змін після подання', html.includes('data-review="changes"') && html.includes('Автор змінив курс після подання'));
  t('пояснено, що піде подана версія', html.includes('опублікує саме подану версію'));
  t('самі зміни перелічені', html.includes('Ціна: 1 500 грн → 1 200 грн.') && html.includes('Програма змінена'));
}

console.log('\nСтарий запис, вирішений запис, видалений курс:');
{
  const live = render({ entry: entry(), course: course(), source: 'live', category: null, problems: [], changes: [] });
  t('для запису без знімка сказано, що це поточний стан', live.includes('показано поточний стан курсу'));
  const decided = render({ entry: entry({ status: 'changes_requested', reason: 'Додайте ціну' }), course: course(), source: 'snapshot', category: null, problems: [], changes: [] });
  t('вирішений запис без кнопок рішення', !decided.includes('Повернути із зауваженнями') && decided.includes('changes_requested') && decided.includes('Додайте ціну'));
  const gone = render({ entry: entry(), courseDeleted: true });
  t('видалений курс — повідомлення, а не падіння', gone.includes('Курс видалено автором'));
  const sparse = render({ entry: entry(), course: { id: 'c9', title: 'Мінімум' }, source: 'snapshot', category: null, problems: [], changes: [] });
  t('курс без масивів не валить рендер', sparse.includes('Мінімум') && sparse.includes('0 модулів'));
  const err = render({ entry: entry(), course: course(), source: 'snapshot', problems: [], changes: [] }, { error: 'Маркетплейс не відповідає' });
  t('помилка рішення видна', err.includes('Маркетплейс не відповідає'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
