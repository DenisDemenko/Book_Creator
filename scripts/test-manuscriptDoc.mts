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

  console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
  if (failed > 0) process.exit(1);
}

main();
