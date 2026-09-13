/**
 * Тести маркерів зображень `[IMG: id "підпис" wrap=режим width=Nmm height=Nmm]`:
 *   • розбір самого маркера (`parseImageMarker`);
 *   • поділ тексту на шматки «текст / картинка» зі збереженням порядку
 *     (`splitImageMarkers`);
 *   • збір id, на які в тексті є маркер (`collectImageMarkerIds`);
 *   • розвʼязання id → посилання (`resolveImageMarker`, `buildMarkerImageMap`).
 * Запуск: npm run test:image-markers
 *
 * ЧОМУ З'ЯВИВСЯ ЦЕЙ НАБІР. Доти маркер розбирався ЛИШЕ на клієнті
 * (`utils/helpers.ts#renderImageMarkers`): браузер малював картинку, а
 * серверні рушії PDF вважали маркер звичайним текстом і друкували його
 * голим рядком. На книзі, зібраній із .docx (#159), це дало 39 сторінок із
 * 373, де замість малюнка стояло `[IMG: docx-img-3 "Санскрит7" wrap=left]`,
 * а всі 42 картинки лежали купою в кінці першого розділу (запис #169).
 * Тепер розбір один на всіх, і саме він перевіряється тут.
 *
 * Модуль чистий — без DOM і без Node — тож тестується напряму, без браузера
 * (той самий підхід, що й у scripts/test-imageWrap.mts).
 */
import {
  buildMarkerImageMap,
  collectImageMarkerIds,
  hasImageMarkers,
  imageMarkerRegexp,
  parseImageMarker,
  resolveImageMarker,
  splitImageMarkers,
} from '../src/utils/imageMarkers.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const book = {
  illustrations: [
    { id: 'docx-img-0', url: '/api/media/file/md-1', caption: 'Обложка ч_б' },
    { id: 'docx-img-1', url: '/api/media/file/md-2', caption: 'санскрит7' },
    { id: 'ill-bez-pidpysu', url: '/api/media/file/md-3', caption: '' },
  ],
  /*
    Герої в книзі мають власні id, які самі починаються з `char-`
    (`CharactersView.tsx`: `char-${Date.now()}`), а галерея додає до них ще
    один префікс: `InsertImageModal.tsx` віддає id `char-${c.id}`. Тому
    реальний маркер портрета виглядає як `char-char-1739…` — і розвʼязання
    відрізає РІВНО один префікс. Фікстура повторює саме цю будову, а не
    вигадану зручну.
  */
  characters: [{ id: 'char-1739', avatarUrl: '/api/media/file/md-portret' }],
  coverConfig: { frontArtUrl: '/api/media/file/md-cover' },
};

console.log('\nРозбір маркера:');
{
  const m = parseImageMarker('[IMG: docx-img-3 "Санскрит7" wrap=left]');
  t('id прочитано', m?.id === 'docx-img-3', String(m?.id));
  t('підпис прочитано', m?.caption === 'Санскрит7', String(m?.caption));
  t('режим обтікання прочитано', m?.wrap === 'left', String(m?.wrap));

  const full = parseImageMarker('[IMG: ill-1 "Підпис" wrap=contour width=40mm height=30mm shape="0.0% 0.0%, 100.0% 50.0%"]');
  t('розміри й контур прочитано', full?.widthMm === '40mm' || full?.widthMm === '40', String(full?.widthMm));
  t('полігон прочитано', full?.shape === '0.0% 0.0%, 100.0% 50.0%', String(full?.shape));

  // Книги, написані до появи режимів обтікання, мають маркер без `wrap`.
  t('маркер без wrap теж розбирається', parseImageMarker('[IMG: a1 "Підпис"]')?.id === 'a1');
  t('порожній підпис не ламає розбір', parseImageMarker('[IMG: a1 ""]')?.caption === '');

  // Лапки й дужки в підписі — реальність книг із Word («artwork (3)»).
  t('дужки в підписі збережено', parseImageMarker('[IMG: a1 "artwork (3)"]')?.caption === 'artwork (3)');
  t('лучені лапки всередині підпису збережено',
    parseImageMarker('[IMG: a1 "він сказав: «так»"]')?.caption === 'він сказав: «так»');

  t('звичайний текст — не маркер', parseImageMarker('Просто речення [IMG: не всередині].') === null);
  t('порожній рядок — не маркер', parseImageMarker('') === null);
}

console.log('\nПоділ тексту на текст і картинки:');
{
  const segments = splitImageMarkers('До картинки.\n\n[IMG: docx-img-0 "Обложка ч_б" wrap=left]\n\nПісля картинки.');
  t('три шматки: текст, картинка, текст', segments.length === 3, String(segments.length));
  t('порядок збережено',
    segments[0].kind === 'text' && segments[1].kind === 'image' && segments[2].kind === 'text',
    segments.map((s) => s.kind).join(','));
  t('текст до картинки не зʼїдено', segments[0].kind === 'text' && segments[0].text.includes('До картинки'));
  t('текст після картинки не зʼїдено', segments[2].kind === 'text' && segments[2].text.includes('Після картинки'));

  // Маркер усередині рядка — так теж буває: його ставить кнопка в редакторі.
  const inline = splitImageMarkers('Текст [IMG: a1 "П" wrap=left] і далі.');
  t('маркер усередині рядка знайдено', inline.some((s) => s.kind === 'image'));
  t('текст з обох боків лишився', inline.filter((s) => s.kind === 'text').length === 2);

  t('текст без маркерів — один шматок', splitImageMarkers('Просто текст.').length === 1);
  t('порожній текст — жодного шматка', splitImageMarkers('').length === 0);
  t('сам маркер — один шматок-картинка', splitImageMarkers('[IMG: a1 ""]').length === 1);

  t('hasImageMarkers бачить маркер', hasImageMarkers('x [IMG: a1 ""] y'));
  t('hasImageMarkers не чіпає звичайний текст', !hasImageMarkers('звичайний текст'));
}

console.log('\nRegexp як фабрика, а не спільний обʼєкт:');
{
  /*
    Пастка `/g`-виразів: у них є `lastIndex`, і другий прохід тим самим
    обʼєктом почався б із середини рядка. Саме тому назовні віддається
    фабрика, і це перевіряється, а не лишається на совість.
  */
  const text = '[IMG: a1 "Перший"] і [IMG: a2 "Другий"]';
  const re = imageMarkerRegexp();
  re.exec(text);
  t('перший прохід знайшов два маркери', collectImageMarkerIds(text).length === 2);
  t('другий прохід тим самим обʼєктом не лишився без результату', re.exec(text) !== null || re.lastIndex === 0);
  t('два різні виклики дають два різні обʼєкти', imageMarkerRegexp() !== imageMarkerRegexp());
}

console.log('\nЗбір id із тексту:');
{
  t('id у порядку появи',
    collectImageMarkerIds('[IMG: b ""] текст [IMG: a ""]').join(',') === 'b,a');
  t('той самий id двічі — двічі у списку',
    collectImageMarkerIds('[IMG: a ""] [IMG: a ""]').length === 2,
    collectImageMarkerIds('[IMG: a ""] [IMG: a ""]').join(','));
  t('без маркерів — порожній список', collectImageMarkerIds('текст').length === 0);
}

console.log('\nРозвʼязання id → посилання:');
{
  t('ілюстрація за id', resolveImageMarker('docx-img-0', book)?.url === '/api/media/file/md-1');
  t('підпис береться з книги, якщо в маркері порожній',
    resolveImageMarker('docx-img-0', book)?.caption === 'Обложка ч_б');
  t('портрет героя за `char-…`', resolveImageMarker('char-char-1739', book)?.url === '/api/media/file/md-portret');
  t('зайвий префікс не відрізається', resolveImageMarker('char-1739', book) === null);
  t('обкладинка за `cover-front`', resolveImageMarker('cover-front', book)?.url === '/api/media/file/md-cover');
  t('невідомий id — null, а не порожній рядок', resolveImageMarker('нема-такого', book) === null);
  t('книга без обкладинки не дає фальшивого посилання',
    resolveImageMarker('cover-front', { illustrations: [] }) === null);
}

console.log('\nКарта «id маркера → картинка» для верстки PDF:');
{
  const map = buildMarkerImageMap(book);
  t('ілюстрації в карті', map['docx-img-0']?.url === '/api/media/file/md-1');
  t('портрет у карті під префіксом', map['char-char-1739']?.url === '/api/media/file/md-portret');
  t('обкладинка в карті', map['cover-front']?.url === '/api/media/file/md-cover');
  t('ілюстрація без url у карту не потрапляє', buildMarkerImageMap({ illustrations: [{ id: 'x' }] })['x'] === undefined);
  t('порожня книга дає порожню карту', Object.keys(buildMarkerImageMap({})).length === 0);
}

console.log(`\nПідсумок: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
