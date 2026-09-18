/**
 * Юніт-тести для src/utils/manuscriptDoc.ts — двостороннього перетворювача
 * між текстом розділу (bracket-маркери) і документом TipTap.
 *
 * Досі цей модуль не мав окремого тесту (лише опосередковано через
 * EditorView.tsx у браузері). Додано разом із новими маркерами
 * [COLOR="…"]…[/COLOR] і [HL="…"]…[/HL] (редизайн «Книга і текст», задача
 * Colors/Highlight) — насамперед щоб перевірити, щоround-trip
 * (текст → doc → текст) не змінює вихідний рядок і коректно взаємодіє зі
 * старими маркерами (**жирний**, *курсив*, [FONT], [SIZE]).
 */
import assert from 'node:assert/strict';
import { markerStringToTiptapDoc, tiptapDocToMarkerString, markerSnippetToNodes } from '../src/utils/manuscriptDoc.ts';

let passed = 0;
let failed = 0;
function t(name: string, ok: boolean, extra?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function roundTrip(input: string): string {
  const doc = markerStringToTiptapDoc(input);
  return tiptapDocToMarkerString(doc);
}

function main() {
  console.log('\nCOLOR — базовий round-trip:');
  {
    const src = 'Звичайний текст [COLOR="#ff0000"]червоний фрагмент[/COLOR] далі звичайний.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    const textNode = doc.content?.[0]?.content?.find((n) => n.text === 'червоний фрагмент');
    t('вузол отримав mark textColor з правильним кольором', !!textNode?.marks?.some((m) => m.type === 'textColor' && m.attrs?.color === '#ff0000'));
  }

  console.log('\nHL (highlight) — базовий round-trip:');
  {
    const src = 'Текст [HL="#fff3b0"]виділений жовтим[/HL] і далі.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    const textNode = doc.content?.[0]?.content?.find((n) => n.text === 'виділений жовтим');
    t('вузол отримав mark highlight з правильним кольором', !!textNode?.marks?.some((m) => m.type === 'highlight' && m.attrs?.color === '#fff3b0'));
  }

  console.log('\nCOLOR + HL одночасно на тому самому фрагменті:');
  {
    const src = 'До [COLOR="#0000ff"][HL="#ffff00"]синій на жовтому[/HL][/COLOR] після.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
  }

  console.log('\nCOLOR разом зі старими маркерами (bold/italic/FONT/SIZE):');
  {
    const src = 'Просто **жирний і [COLOR="#00aa00"]зелений жирний[/COLOR] знову жирний** кінець.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
  }
  {
    const src = '[FONT="Georgia"][SIZE=14][COLOR="#123456"]шрифт+кегль+колір разом[/COLOR][/SIZE][/FONT] звичайний.';
    t('текст не змінюється після round-trip (FONT+SIZE+COLOR вкладені)', roundTrip(src) === src, roundTrip(src));
  }

  console.log('\nЗакриття маркерів, що лишились відкритими в кінці абзацу:');
  {
    const src = 'До кінця речення [COLOR="#ff00ff"]без явного закриття';
    const out = roundTrip(src);
    t('COLOR сам закрився в кінці', out === src + '[/COLOR]', out);
  }

  console.log('\nmarkerSnippetToNodes — вставка фрагмента з COLOR/HL (напр. через AI-вставку):');
  {
    const nodes = markerSnippetToNodes('[COLOR="#ff0000"]вставлений фрагмент[/HL]'.replace('[/HL]', '[/COLOR]'));
    t('фрагмент розпізнав mark textColor', !!nodes[0]?.content?.[0]?.marks?.some((m) => m.type === 'textColor'));
  }

  console.log('\nПорожній документ (без COLOR/HL) лишається як був — регресія на старий формат:');
  {
    const src = 'Звичайний абзац без жодних маркерів.\n\nІ другий абзац.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
  }

  console.log('\nLINK — базовий round-trip:');
  {
    const src = 'До [LINK="https://example.com"]посилання на приклад[/LINK] після.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    const textNode = doc.content?.[0]?.content?.find((n) => n.text === 'посилання на приклад');
    t('вузол отримав mark nlink з правильним href', !!textNode?.marks?.some((m) => m.type === 'nlink' && m.attrs?.href === 'https://example.com'));
  }

  console.log('\nLINK разом з COLOR/HL/bold (вкладені, перевіряє порядок закриття/відкриття):');
  {
    const src = 'До **[COLOR="#0000ff"][HL="#ffff00"][LINK="https://x.test"]жирне синє на жовтому з посиланням[/LINK][/HL][/COLOR]** після.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
  }

  console.log('\nLINK — незакритий в кінці абзацу закривається сам:');
  {
    const src = 'До кінця речення [LINK="https://x.test"]без явного закриття';
    const out = roundTrip(src);
    t('LINK сам закрився в кінці', out === src + '[/LINK]', out);
  }

  console.log('\nDIVIDER — блоковий розділювач сцени (round-trip):');
  {
    const src = 'Перший абзац.\n\n[DIVIDER]\n\nДругий абзац.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    t('є блок sceneDivider між двома абзацами', doc.content?.[1]?.type === 'sceneDivider');
  }

  console.log('\nmarkerSnippetToNodes — вставка DIVIDER (напр. через кнопку панелі):');
  {
    const nodes = markerSnippetToNodes('[DIVIDER]');
    t('фрагмент розпізнав блок sceneDivider', nodes[0]?.type === 'sceneDivider');
  }

  console.log('\nHEADING — рівні 1-3, round-trip:');
  {
    for (const level of [1, 2, 3] as const) {
      const src = 'Перший абзац.\n\n' + '#'.repeat(level) + ' Заголовок ' + level + ' рівня\n\nДругий абзац.';
      const out = roundTrip(src);
      t(`H${level}: текст не змінюється після round-trip`, out === src, out);
      const doc = markerStringToTiptapDoc(src);
      const heading = doc.content?.[1];
      t(`H${level}: блок має type heading і attrs.level=${level}`, heading?.type === 'heading' && heading?.attrs?.level === level);
    }
  }

  console.log('\nHEADING разом з інлайн-маркерами (жирний/колір усередині заголовка):');
  {
    const src = '## Заголовок із **жирним** і [COLOR="#ff0000"]кольором[/COLOR]';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    const heading = doc.content?.[0];
    t('усередині заголовка розпізналось форматування', !!heading?.content?.some((n) => n.marks?.some((m) => m.type === 'bold')));
  }

  console.log('\nHEADING — 4+ решітки НЕ є заголовком (лишається звичайним текстом):');
  {
    const src = '#### Це не заголовок, а звичайний текст';
    const doc = markerStringToTiptapDoc(src);
    t('блок лишився paragraph, а не heading', doc.content?.[0]?.type === 'paragraph');
  }

  console.log('\nmarkerSnippetToNodes — вставка HEADING:');
  {
    const nodes = markerSnippetToNodes('# Швидкий заголовок');
    t('фрагмент розпізнав блок heading рівня 1', nodes[0]?.type === 'heading' && nodes[0]?.attrs?.level === 1);
  }

  console.log('\nTABLE — базовий round-trip (2x2, без вирівнювання):');
  {
    const src = 'Перед.\n\n[TABLE]\n[ROW][CELL]a1[/CELL][CELL]a2[/CELL][/ROW]\n[ROW][CELL]b1[/CELL][CELL]b2[/CELL][/ROW]\n[/TABLE]\n\nПісля.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    const table = doc.content?.[1];
    t('блок має type table', table?.type === 'table');
    t('2 рядки', table?.content?.length === 2, JSON.stringify(table?.content?.length));
    t('перший рядок — 2 клітинки', table?.content?.[0]?.content?.length === 2);
    t('перша клітинка — параграф з текстом a1', table?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text === 'a1', JSON.stringify(table?.content?.[0]));
    t('align клітинки за замовчуванням — null', table?.content?.[0]?.content?.[0]?.attrs?.align == null);
  }

  console.log('\nTABLE — вирівнювання клітинок (align=right/center), round-trip:');
  {
    const src = '[TABLE]\n[ROW][CELL align=right]праворуч[/CELL][CELL align=center]по центру[/CELL][CELL]ліворуч[/CELL][/ROW]\n[/TABLE]';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    const cells = doc.content?.[0]?.content?.[0]?.content;
    t('перша клітинка align=right', cells?.[0]?.attrs?.align === 'right');
    t('друга клітинка align=center', cells?.[1]?.attrs?.align === 'center');
    t('третя клітинка align=null (не пишеться в маркері)', cells?.[2]?.attrs?.align == null);
  }

  console.log('\nTABLE — інлайн-маркери всередині клітинки (жирний/колір), round-trip:');
  {
    const src = '[TABLE]\n[ROW][CELL]**жирний** і [COLOR="#ff0000"]червоний[/COLOR][/CELL][CELL]звичайний[/CELL][/ROW]\n[/TABLE]';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    const firstCellPara = doc.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0];
    t('усередині клітинки розпізналось форматування (bold)', firstCellPara?.content?.some((n: any) => n.marks?.some((m: any) => m.type === 'bold')));
  }

  console.log('\nTABLE — кілька рядків різної довжини (нерівна кількість клітинок), round-trip:');
  {
    const src = '[TABLE]\n[ROW][CELL]a[/CELL][CELL]b[/CELL][CELL]c[/CELL][/ROW]\n[ROW][CELL]тільки одна[/CELL][/ROW]\n[/TABLE]';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    t('перший рядок — 3 клітинки', doc.content?.[0]?.content?.[0]?.content?.length === 3);
    t('другий рядок — 1 клітинка', doc.content?.[0]?.content?.[1]?.content?.length === 1);
  }

  console.log('\nTABLE — жорсткий перенос (Shift+Enter) усередині клітинки не губить рядок:');
  {
    // Раніше parseTableMarkerBlock ділив блок на рядки через один '\n' —
    // hardBreak (Shift+Enter) усередині клітинки серіалізується саме як
    // літеральний '\n' (serializeInline), тож [ROW]…[/ROW] розривався на
    // два «рядки», жоден з яких не збігався з ROW_RE, і рядок таблиці
    // мовчки зникав. Тепер [ROW]…[/ROW] шукається нежадібним глобальним
    // виразом по всьому блоку — байдуже, скільки в клітинці своїх переносів.
    const src = '[TABLE]\n[ROW][CELL]перший\nдругий рядок клітинки[/CELL][CELL]сусідня[/CELL][/ROW]\n[/TABLE]';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    t('рядок таблиці не зник — один [ROW]', doc.content?.[0]?.content?.length === 1, JSON.stringify(doc.content?.[0]));
    t('у рядку лишились обидві клітинки', doc.content?.[0]?.content?.[0]?.content?.length === 2);
    const firstCellPara = doc.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0];
    t('перенос усередині клітинки розпізнано як hardBreak', firstCellPara?.content?.some((n: any) => n.type === 'hardBreak'));
  }

  console.log('\nmarkerSnippetToNodes — вставка порожньої 2x2 таблиці (кнопка «Вставити таблицю»):');
  {
    const nodes = markerSnippetToNodes('[TABLE]\n[ROW][CELL][/CELL][CELL][/CELL][/ROW]\n[ROW][CELL][/CELL][CELL][/CELL][/ROW]\n[/TABLE]');
    t('фрагмент розпізнав блок table', nodes[0]?.type === 'table');
    t('2 рядки по 2 клітинки', nodes[0]?.content?.length === 2 && nodes[0]?.content?.every((r: any) => r.content?.length === 2));
  }

  console.log('\nTABLE поряд із іншими блоками (заголовок/DIVIDER навколо) — увесь документ round-trip:');
  {
    const src = '# Глава\n\nВступний абзац.\n\n[TABLE]\n[ROW][CELL align=center]Зведення[/CELL][/ROW]\n[/TABLE]\n\n[DIVIDER]\n\nЗавершальний абзац.';
    t('текст не змінюється після round-trip', roundTrip(src) === src, roundTrip(src));
    const doc = markerStringToTiptapDoc(src);
    t('порядок блоків: heading, paragraph, table, sceneDivider, paragraph', doc.content?.map((b) => b.type).join(',') === 'heading,paragraph,table,sceneDivider,paragraph', doc.content?.map((b) => b.type).join(','));
  }

  console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
  if (failed > 0) process.exit(1);
}

main();
