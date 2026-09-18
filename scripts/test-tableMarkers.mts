/**
 * Тести src/utils/tableMarkers.ts (спільний парсер `[TABLE]…[/TABLE]`) і
 * рендер таблиць у src/utils/helpers.ts (renderSectionContentHtml /
 * renderSectionBlocksHtml) — запис #193.
 */
import type { Book } from '../src/types.ts';
import {
  hasTableMarkers,
  parseTableMarkerBlock,
  tableMarkerString,
  replaceTableBlocks,
} from '../src/utils/tableMarkers.ts';
import { renderSectionContentHtml, renderSectionBlocksHtml } from '../src/utils/helpers.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

function minimalBook(): Book {
  return { id: 'b1', title: 'Т', author: 'А', language: 'uk', genre: 'проза', chapters: [], characters: [] } as unknown as Book;
}

console.log('\nhasTableMarkers / parseTableMarkerBlock / tableMarkerString — базовий round-trip:');
{
  const src = '[TABLE]\n[ROW][CELL]a[/CELL][CELL align=right]b[/CELL][/ROW]\n[/TABLE]';
  t('hasTableMarkers === true', hasTableMarkers(src));
  const parsed = parseTableMarkerBlock(src);
  t('розібрано в 1 рядок, 2 клітинки', parsed?.rows.length === 1 && parsed.rows[0].cells.length === 2, JSON.stringify(parsed));
  t('друга клітинка align=right', parsed?.rows[0].cells[1].align === 'right');
  t('tableMarkerString відтворює той самий рядок', parsed && tableMarkerString(parsed) === src, parsed ? tableMarkerString(parsed) : 'null');
}

console.log('\nparseTableMarkerBlock — не таблиця → null:');
{
  t('звичайний текст → null', parseTableMarkerBlock('Просто текст.') === null);
  t('незакрита таблиця → null', parseTableMarkerBlock('[TABLE]\n[ROW][CELL]a[/CELL][/ROW]') === null);
}

console.log('\nreplaceTableBlocks — знаходить [TABLE] серед іншого тексту, не займає решту:');
{
  const src = 'Перед.\n\n[TABLE]\n[ROW][CELL]x[/CELL][/ROW]\n[/TABLE]\n\nПісля.';
  const out = replaceTableBlocks(src, () => '<TBL/>');
  t('заміна відбулась, решта тексту ціла', out === 'Перед.\n\n<TBL/>\n\nПісля.', out);
  t('текст без [TABLE] повертається як є', replaceTableBlocks('Без таблиці.', () => '<TBL/>') === 'Без таблиці.');
}

console.log('\nrenderSectionContentHtml — таблиця розгортається в <table>/<tr>/<td>:');
{
  const book = minimalBook();
  const content = '[TABLE]\n[ROW][CELL]a1[/CELL][CELL]a2[/CELL][/ROW]\n[ROW][CELL]b1[/CELL][CELL]b2[/CELL][/ROW]\n[/TABLE]';
  const html = renderSectionContentHtml(content, book, [], []);
  t('є <table>', html.includes('<table'), html);
  t('2 рядки <tr>', (html.match(/<tr>/g) || []).length === 2, html);
  t('4 клітинки <td>', (html.match(/<td/g) || []).length === 4, html);
  t('текст клітинок на місці', html.includes('a1') && html.includes('a2') && html.includes('b1') && html.includes('b2'));
  t('немає сирих маркерів у виводі', !html.includes('[TABLE]') && !html.includes('[ROW]') && !html.includes('[CELL'));
}

console.log('\nrenderSectionContentHtml — вирівнювання клітинки (align=right/center) → text-align у стилі <td>:');
{
  const book = minimalBook();
  const content = '[TABLE]\n[ROW][CELL align=right]право[/CELL][CELL align=center]центр[/CELL][CELL]ліво[/CELL][/ROW]\n[/TABLE]';
  const html = renderSectionContentHtml(content, book, [], []);
  t('права клітинка має text-align:right', /text-align:right[^>]*>право|<td[^>]*text-align:right[^>]*>право/.test(html), html);
  t('центральна клітинка має text-align:center', /text-align:center[^>]*>центр|<td[^>]*text-align:center[^>]*>центр/.test(html), html);
  t('ліва клітинка (дефолт) НЕ отримує text-align у стилі', !new RegExp('text-align:[a-z]+[^>]*>ліво').test(html), html);
}

console.log('\nrenderSectionContentHtml — інлайн-маркери всередині клітинки розгортаються (bold), не витікають за межі клітинки:');
{
  const book = minimalBook();
  const content = '[TABLE]\n[ROW][CELL]**жирний**[/CELL][CELL]звичайний[/CELL][/ROW]\n[/TABLE]';
  const html = renderSectionContentHtml(content, book, [], []);
  t('перша клітинка містить <strong>', html.includes('<strong>жирний</strong>'), html);
  t('друга клітинка НЕ стала жирною', !html.includes('<strong>звичайний'), html);
}

console.log('\nrenderSectionContentHtml — незакритий ** в одній клітинці НЕ витікає в іншу клітинку/рядок (головна причина, чому таблиця розгортається ПЕРШОЮ в ланцюжку):');
{
  const book = minimalBook();
  // Клітинка 1: незакритий **. Клітинка 2 того ж рядка: звичайний текст.
  // Без правильного порядку розгортання (таблиця — перша) старий движок
  // сприйняв би це як "жирний від клітинки 1 аж до кінця тексту".
  const content = '[TABLE]\n[ROW][CELL]**незакритий[/CELL][CELL]другий[/CELL][/ROW]\n[/TABLE]';
  const html = renderSectionContentHtml(content, book, [], []);
  t('друга клітинка не потрапила під жирність першої', !html.includes('<strong>незакритий') || !html.includes('другий</strong>'), html);
}

console.log('\nrenderSectionContentHtml — текст навколо таблиці лишається звичайним текстом (не абзацами тут — ця функція абзаци не розбиває):');
{
  const book = minimalBook();
  const content = 'До таблиці.\n\n[TABLE]\n[ROW][CELL]x[/CELL][/ROW]\n[/TABLE]\n\nПісля таблиці.';
  const html = renderSectionContentHtml(content, book, [], []);
  t('текст до таблиці на місці', html.includes('До таблиці.'));
  t('текст після таблиці на місці', html.includes('Після таблиці.'));
  t('таблиця розгорнута', html.includes('<table'));
}

console.log('\nrenderSectionBlocksHtml — ціла таблиця стає ОДНИМ блоком <table>, без обгортки в <p> і без злиття рядків у один:');
{
  const book = minimalBook();
  const content = 'Перший абзац.\n\n[TABLE]\n[ROW][CELL]a1[/CELL][CELL]a2[/CELL][/ROW]\n[ROW][CELL]b1[/CELL][CELL]b2[/CELL][/ROW]\n[/TABLE]\n\nДругий абзац.';
  const html = renderSectionBlocksHtml(content, book, [], []);
  t('перший абзац у <p>', html.includes('<p>Перший абзац.</p>'), html);
  t('другий абзац у <p>', html.includes('<p>Другий абзац.</p>'), html);
  t('таблиця НЕ обгорнута в <p>', !html.includes('<p><table') && !html.includes('<table></p>') && !/<p>\s*<table/.test(html), html);
  t('2 рядки таблиці збережено (рядки НЕ злились в один через \\n→space)', (html.match(/<tr>/g) || []).length === 2, html);
  t('блоки в правильному порядку: p, table, p', /<p>Перший абзац\.<\/p>.*<table.*<\/table>.*<p>Другий абзац\.<\/p>/s.test(html), html);
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail > 0 ? 1 : 0);
