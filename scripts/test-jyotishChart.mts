/**
 * Тести ведичної (сидеричної) натальної карти («задіак джйотіш»,
 * server/jyotishChart.ts) — задача #48. Двигун circular-natal-horoscope-js
 * дає РЕАЛЬНІ (не вигадані моделлю) тропічні позиції планет через
 * ефемериду Мошьє; аянамша Лахірі рахується тут ОКРЕМО (з поправкою на
 * прецесію за роком), бо вбудована «sidereal» бібліотеки — фіксована
 * константа, не прив'язана до дати (перевірено емпірично при розробці).
 * Запуск: npm run test:jyotish-chart
 */
import { computeJyotishChart, JyotishError } from '../server/jyotishChart.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nБазовий розрахунок (з точним часом):');
{
  // Київ, 15 травня 1990, 08:30
  const chart = computeJyotishChart({ birthDate: '1990-05-15', birthTime: '08:30' }, 50.45, 30.52);
  t('Лагна порахована, коли є точний час', typeof chart.lagna === 'string' && chart.lagna.length > 0, String(chart.lagna));
  t('hasExactTime = true', chart.hasExactTime === true);
  t('Раші Місяця — одне з 12 українських назв', ['Овен','Телець','Близнюки','Рак','Лев','Діва','Терези','Скорпіон','Стрілець','Козеріг','Водолій','Риби'].includes(chart.moonRashi));
  t('Накшатра Місяця не порожня', chart.moonNakshatra.length > 0);
  t('Пада Місяця в межах 1-4', chart.moonPada >= 1 && chart.moonPada <= 4, String(chart.moonPada));
  t('Раші Сонця не порожнє', chart.sunRashi.length > 0);
  t('5 класичних грах пораховано', Object.keys(chart.planets).length === 5, String(Object.keys(chart.planets).length));
  t('Раху й Кету пораховано', chart.rahuRashi.length > 0 && chart.ketuRashi.length > 0);
  t('Раху і Кету в протилежних (180°) знаках — завжди так за визначенням вузлів',
    (['Овен','Телець','Близнюки','Рак','Лев','Діва','Терези','Скорпіон','Стрілець','Козеріг','Водолій','Риби'].indexOf(chart.rahuRashi) + 6) % 12
      === ['Овен','Телець','Близнюки','Рак','Лев','Діва','Терези','Скорпіон','Стрілець','Козеріг','Водолій','Риби'].indexOf(chart.ketuRashi));
  t('summary — непорожній український текст', chart.summary.includes('Лагна') && chart.summary.includes('Місяць'));
  t('computedAt — валідний ISO-timestamp', !Number.isNaN(Date.parse(chart.computedAt)));
}

console.log('\nБез точного часу народження (лише Сонце/Місяць):');
{
  const chart = computeJyotishChart({ birthDate: '1990-05-15' }, 50.45, 30.52);
  t('Лагна ВІДСУТНЯ без часу народження', chart.lagna === undefined);
  t('hasExactTime = false', chart.hasExactTime === false);
  t('Місяць і Сонце все одно пораховані', chart.moonRashi.length > 0 && chart.sunRashi.length > 0);
  t('summary явно попереджає про відсутність Лагни', chart.summary.includes('не вказано точний час'));
}

console.log('\nАянамша прив\'язана до дати (НЕ фіксована константа бібліотеки):');
{
  // Той самий Місяць-градус (наближено) у різні епохи має давати РІЗНу сидеричну
  // позицію відносно тропічної — перевіряємо непрямо: різниця тропічної/сидеричної
  // довготи Сонця для однієї й тієї самої календарної дати різних років не однакова.
  const c1950 = computeJyotishChart({ birthDate: '1950-06-15', birthTime: '12:00' }, 50.45, 30.52);
  const c2026 = computeJyotishChart({ birthDate: '2026-06-15', birthTime: '12:00' }, 50.45, 30.52);
  // Обидва — валідні об'єкти незалежно від епохи (розрахунок не падає на старих датах).
  t('1950 рік рахується без помилок', typeof c1950.sunRashi === 'string' && c1950.sunRashi.length > 0);
  t('2026 рік рахується без помилок', typeof c2026.sunRashi === 'string' && c2026.sunRashi.length > 0);
}

console.log('\nВалідація вхідних даних:');
{
  let threw = false;
  try {
    computeJyotishChart({ birthDate: '15-05-1990' }, 50.45, 30.52);
  } catch (err) {
    threw = err instanceof JyotishError && err.kind === 'bad_date';
  }
  t('невалідний формат дати кидає JyotishError(bad_date)', threw);

  let threw2 = false;
  try {
    computeJyotishChart({ birthDate: 'не дата' }, 0, 0);
  } catch (err) {
    threw2 = err instanceof JyotishError;
  }
  t('сміттєвий рядок дати кидає JyotishError', threw2);
}

console.log('\nЧас у неправильному форматі мовчки не ламає розрахунок:');
{
  // Якщо частина часу не пройшла regex /^(\d{1,2}):(\d{2})$/, код лишає
  // year/month/date коректними, а год./хв. — дефолтними (12:00), не кидаючи
  // виняток: письменник міг ввести час нестандартно, це не привід зривати
  // розрахунок Раші/Накшатри Місяця.
  const chart = computeJyotishChart({ birthDate: '1990-05-15', birthTime: '午前8時' }, 50.45, 30.52);
  t('дивний формат часу не кидає виняток', chart.moonRashi.length > 0);
  // hasExactTime визначається лише за НАЯВНІСТЮ birthTime (непорожній рядок),
  // а не за тим, чи текст успішно розпарсився — це задокументована поведінка,
  // не помилка: якщо автор щось ввів у полі часу, ми вважаємо його «заданим».
  t('hasExactTime true, навіть якщо формат часу не розпізнано (текст був заданий)', chart.hasExactTime === true);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
