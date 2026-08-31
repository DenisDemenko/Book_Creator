/**
 * Тести розвилки експрес-майстра (Завдання 4).
 * Запуск: npm run test:express-tracks
 *
 * Головне, що тут стережеться, — не зовнішній вигляд карток, а два тихі
 * способи зламати гілки:
 *   1) перелік напрямів продубльовано на сервері (server/expressRoutes.ts
 *      не імпортує з src/), і розходження двох списків не викличе жодної
 *      помилки — просто вибраний напрям мовчки не збережеться;
 *   2) гілку 2-4 колись позначать `ready`, не дописавши кроків, і людина
 *      піде в майстер, який обірветься.
 */
import { readFileSync } from 'node:fs';
import {
  EXPRESS_TRACKS,
  findExpressTrack,
  isTrackRunnable,
} from '../src/data/expressTracks.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nСклад реєстру:');
{
  t('чотири напрями, як у постановці', EXPRESS_TRACKS.length === 4);
  t('порядок 1-4 без дірок', EXPRESS_TRACKS.map((x) => x.order).join() === '1,2,3,4');
  t('перший — Книга', EXPRESS_TRACKS[0].id === 'book' && EXPRESS_TRACKS[0].order === 1);
  t('решта — курс, інструкція, гра',
    EXPRESS_TRACKS.slice(1).map((x) => x.id).join() === 'course,instruction,game');
  t('ідентифікатори унікальні', new Set(EXPRESS_TRACKS.map((x) => x.id)).size === 4);
  t('назви не порожні', EXPRESS_TRACKS.every((x) => x.title.trim().length > 0));
}

console.log('\nСтатуси:');
{
  const ready = EXPRESS_TRACKS.filter((x) => x.status === 'ready');
  t('готова рівно одна гілка', ready.length === 1);
  t('готова саме «Книга» — наявний майстер', ready[0]?.id === 'book');
  t('гілки 2-4 позначені як planned',
    EXPRESS_TRACKS.slice(1).every((x) => x.status === 'planned'));
  t('кожна гілка має описані кроки', EXPRESS_TRACKS.every((x) => x.steps.length >= 3));
  t('кроки книги збігаються з майстром',
    findExpressTrack('book')!.steps.join() === 'Зерно,Модель,Герої,Синопсис,Структура');
}

console.log('\nЧи можна вести людину в майстер:');
{
  t('книга — можна', isTrackRunnable('book') === true);
  t('курс — ні (немає опису)', isTrackRunnable('course') === false);
  t('інструкція — ні', isTrackRunnable('instruction') === false);
  t('гра — ні', isTrackRunnable('game') === false);
  t('невідомий рядок — ні', isTrackRunnable('книжка') === false);
  t('null не кидає', isTrackRunnable(null) === false);
  t('порожній рядок — ні', isTrackRunnable('') === false);
  t('пошук невідомого повертає undefined', findExpressTrack('нема') === undefined);
}

console.log('\nСервер знає ті самі напрями:');
{
  // Продубльований перелік — свідоме рішення (сервер не читає з src/),
  // тому розходження ловимо тестом, а не сподіванням на уважність.
  const src = readFileSync(new URL('../server/expressRoutes.ts', import.meta.url), 'utf8');
  const m = src.match(/const KNOWN_TRACKS\s*=\s*\[([^\]]*)\]/);
  t('перелік напрямів у маршрутах знайдено', !!m);
  const serverIds = (m?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  t('склад збігається з клієнтським реєстром',
    serverIds.slice().sort().join() === EXPRESS_TRACKS.map((x) => x.id).sort().join(),
    `сервер: ${serverIds.join(', ')}`);
  t('маршрут відкидає невідомий напрям', /KNOWN_TRACKS\.includes\(rawTrack\)/.test(src));
  t('напрям потрапляє в чернетку', /\.\.\.\(track \? \{ track \} : \{\}\)/.test(src));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
