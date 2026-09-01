/**
 * Тести синхронізації сесій: версія книги й ідентифікація пристрою.
 * Запуск: npm run test:book-version
 *
 * Це регресійний захист від конкретної втрати роботи: сесія зі старим станом
 * книги (та сама книга в іншому браузері чи на іншому пристрої) затирала
 * свіжий текст, бо `updatedAt` ніде не оновлювався, а вхідна копія
 * застосовувалась беззастережно.
 */
import {
  bookRevisionMs,
  isNewerBook,
  stampBookRevision,
  describeRevisionGap,
} from '../src/utils/bookVersion.ts';
import { otherSessionsOfSameUser } from '../src/utils/deviceSession.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const at = (iso: string) => ({ updatedAt: iso });

console.log('\nПозначка версії:');
{
  t('ISO-дата стає числом', bookRevisionMs(at('2026-08-31T18:00:00.000Z')) === Date.parse('2026-08-31T18:00:00.000Z'));
  t('відсутня дата — найстаріша', bookRevisionMs({ updatedAt: '' as any }) === 0);
  t('зіпсована дата не ламає порівняння', bookRevisionMs(at('не дата')) === 0);
  t('null книга не кидає', bookRevisionMs(null) === 0);
}

console.log('\nЧия копія новіша:');
{
  const older = at('2026-08-31T18:00:00.000Z');
  const newer = at('2026-08-31T18:05:00.000Z');
  t('новіша перемагає', isNewerBook(newer, older) === true);
  t('старіша НЕ перемагає', isNewerBook(older, newer) === false);
  t('однакові — не новіша (без пінг-понгу між клієнтами)', isNewerBook(older, { ...older }) === false);
  t('книга без дати не перемагає книгу з датою', isNewerBook(at(''), older) === false);
  t('книга з датою перемагає книгу без дати', isNewerBook(older, at('')) === true);
}

console.log('\nШтамп версії:');
{
  const before = at('2020-01-01T00:00:00.000Z');
  const after = stampBookRevision(before);
  t('дата оновилась уперед', bookRevisionMs(after) > bookRevisionMs(before));
  t('вихідний обʼєкт не мутовано', before.updatedAt === '2020-01-01T00:00:00.000Z');

  // Пристрій із годинником у майбутньому: наступний штамп не має «омолодити» книгу.
  const future = at(new Date(Date.now() + 60_000).toISOString());
  const stamped = stampBookRevision(future);
  t('монотонність: штамп не відкочує дату назад', bookRevisionMs(stamped) > bookRevisionMs(future));

  // Два штампи поспіль в одну мілісекунду мають розрізнятись.
  const a = stampBookRevision(at('2026-01-01T00:00:00.000Z'));
  const b = stampBookRevision(a);
  t('два послідовні штампи різні', bookRevisionMs(b) > bookRevisionMs(a));

  // Поля книги не губляться.
  const full = { updatedAt: '2026-01-01T00:00:00.000Z', title: 'Кристал', chapters: [1, 2] };
  const kept = stampBookRevision(full as any) as any;
  t('решта полів книги збережена', kept.title === 'Кристал' && kept.chapters.length === 2);
}

console.log('\nСценарій втрати тексту (регресія):');
{
  // Сесія А написала текст, сесія Б прокинулась зі станом годинної давнини.
  // Обидві дати — фіксовані фікстури, НЕ через stampBookRevision(): та
  // функція документовано бере `now = Date.now()` (реальний годинник), тож
  // застосована до дати в минулому вона мовчки підміняє її на "зараз" —
  // тест випадково проходив, доки реальна дата залишалась близько до
  // 2026-08-31, і зламався сам собою, коли час просто рушив далі.
  const sessionA = at('2026-08-31T18:30:00.000Z');
  const sessionB = at('2026-08-31T17:30:00.000Z');

  t('стара копія Б не застосується в А', isNewerBook(sessionB, sessionA) === false);
  t('свіжа копія А застосується в Б', isNewerBook(sessionA, sessionB) === true);
  t('розрив описано людською мовою', describeRevisionGap(sessionB, sessionA).includes('хв') || describeRevisionGap(sessionB, sessionA).includes('год'));
}

console.log('\nОпис розриву:');
{
  const now = Date.now();
  const gap = (ms: number) => describeRevisionGap(at(new Date(now - ms).toISOString()), at(new Date(now).toISOString()));
  t('секунди → «менш ніж хвилину»', gap(5_000) === 'менш ніж хвилину');
  t('хвилини', gap(5 * 60_000) === '5 хв');
  t('години', gap(3 * 3_600_000) === '3 год');
  t('дні', gap(2 * 86_400_000) === '2 дн');
}

console.log('\nСесії того самого автора:');
{
  const presence = [
    { userId: 'u1', clientId: 'c1', deviceLabel: 'Chrome · Windows' },
    { userId: 'u1', clientId: 'c2', deviceLabel: 'Safari · iOS' },
    { userId: 'u2', clientId: 'c3', deviceLabel: 'Firefox · Linux' },
  ];
  const mine = otherSessionsOfSameUser(presence, 'u1', 'c1');
  t('знайдено іншу власну сесію', mine.length === 1 && mine[0].clientId === 'c2');
  t('чужі сесії не рахуються', mine.every((p) => p.userId === 'u1'));
  t('власна поточна сесія виключена', !mine.some((p) => p.clientId === 'c1'));
  t('без userId нічого не вигадується', otherSessionsOfSameUser(presence, '', 'c1').length === 0);
  t('єдина сесія — порожньо', otherSessionsOfSameUser([presence[2]], 'u2', 'c3').length === 0);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
