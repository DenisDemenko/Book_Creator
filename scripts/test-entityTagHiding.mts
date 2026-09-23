/**
 * Тести арифметики прихованих тегів (`src/utils/entityTagHiding.ts`) — вада,
 * яку знайшов власник 23.09.2026: кнопка «Сховати сутності» прибирала лише
 * колір, а сам тег лишався в канві сірим текстом.
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ. Поведінку плагіна (що саме ховається) перевіряє живий
 * прогін `live:core-entities` — у справжньому Chrome, бо `display: none`
 * неможливо перевірити модульно. А ось КУДИ має піти курсор, коли тег
 * невидимий, — це чиста арифметика позицій, і саме вона захищає розмітку від
 * тихого псування. Її перевіряємо тут, без браузера.
 *
 * Запуск: npm run test:entity-tag-hiding
 */
import { positionAfterHidden, textInsertionPoint } from '../src/utils/entityTagHiding.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// Абзац: `[/character:Олена] Текст книги.` — тег займає позиції 1..19.
const TAG = { from: 1, to: 19 };
const RANGES = [TAG];

console.log('\npositionAfterHidden — куди ставити каретку:');
{
  t('перед тегом — без змін', positionAfterHidden(0, RANGES) === 0);
  t('рівно на початку тега — без змін (це «ставити ПЕРЕД»)', positionAfterHidden(1, RANGES) === 1);
  t('усередині тега — виносить ПІСЛЯ', positionAfterHidden(5, RANGES) === 19);
  t('на останньому символі тега (перед `]`) — теж назовні', positionAfterHidden(18, RANGES) === 19);
  t('рівно на кінці тега — без змін (це «ставити ПІСЛЯ»)', positionAfterHidden(19, RANGES) === 19);
  t('після тега в тексті — без змін', positionAfterHidden(30, RANGES) === 30);

  const two = [{ from: 1, to: 19 }, { from: 40, to: 60 }];
  t('другий діапазон теж працює', positionAfterHidden(50, two) === 60);
  t('перший діапазон не плутається з другим', positionAfterHidden(10, two) === 19);
  t('між діапазонами — без змін', positionAfterHidden(25, two) === 25);

  t('порожній список — позиція як є', positionAfterHidden(7, []) === 7);
}

console.log('\ntextInsertionPoint — куди вставити набраний текст:');
{
  t('каретка в прихованому тегу — вставка ПІСЛЯ тега', textInsertionPoint(5, 5, RANGES) === 19);
  t('каретка поза тегом — звичайна вставка', textInsertionPoint(25, 25, RANGES) === 25);
  t('виділення перетинає тег — тег не знищується', textInsertionPoint(0, 25, RANGES) === 19);
  t('виділення рівно по тегу — теж назовні', textInsertionPoint(1, 19, RANGES) === 19);
  t('виділення ПЕРЕД тегом — звичайна заміна', textInsertionPoint(0, 1, RANGES) === 0);
  t('виділення ПІСЛЯ тега — звичайна заміна', textInsertionPoint(20, 30, RANGES) === 20);
  t('виділення доходить до початку тега — теж звичайна заміна (тег цілий)',
    textInsertionPoint(0, 1, RANGES) === 0);
  t('два теги у виділенні — вставка після ОСТАННЬОГО',
    textInsertionPoint(0, 70, [{ from: 1, to: 19 }, { from: 40, to: 60 }]) === 60);
  t('без прихованих діапазонів — поводиться як звичайна вставка',
    textInsertionPoint(5, 5, []) === 5);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail > 0 ? 1 : 0);
