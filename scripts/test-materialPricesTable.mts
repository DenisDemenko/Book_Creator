/**
 * Тести таблиці довідника плит (src/components/adminOs/materialPricesTable.ts).
 * Запуск: npm run test:material-prices-table
 *
 * Чиста логіка без React: гривні ↔ копійки, перевірка рядка тими самими
 * межами, що й `readBoardPriceUpdate` у Marketplace, розрахунок ціни за лист
 * і за м², виявлення неопублікованих змін.
 */

const m = await import('../src/components/adminOs/materialPricesTable');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const board = {
  id: 'egger-h1388-st40-18', kind: 'chipboard' as const, name: 'EGGER H1388 ST40 Дуб Казелла пісочний',
  decor: 'H1388 ST40', lengthMm: 2800, widthMm: 2070, thicknessMm: 18,
  grain: 'length' as const, unit: 'sheet' as const, priceMinor: 245050,
};

console.log('Гривні ↔ копійки:');
t('«2450,50» → 245050', m.parsePriceInput('2450,50') === 245050);
t('«2 450.5 ₴» → 245050', m.parsePriceInput('2 450.5 ₴') === 245050);
t('порожньо → null (ціну не задано)', m.parsePriceInput('  ') === null);
t('три знаки після коми — помилка', m.parsePriceInput('1,234') === undefined);
t('від’ємне — помилка', m.parsePriceInput('-5') === undefined);
t('245050 → «2450,50»', m.formatPriceInput(245050) === '2450,50');
t('120000 → «1200» без копійок', m.formatPriceInput(120000) === '1200');
t('null → порожньо', m.formatPriceInput(null) === '');

console.log('\nЧернетка ↔ BoardPrice:');
{
  const draft = m.toDraft(board);
  const back = m.fromDrafts([draft])[0];
  t('туди й назад без втрат', JSON.stringify(back) === JSON.stringify({ ...board, name: board.name, decor: board.decor }) ||
    (back.id === board.id && back.priceMinor === board.priceMinor && back.lengthMm === 2800 && back.unit === 'sheet'));
  t('без змін — sameBoards = true', m.sameBoards([board], [draft]));
  t('змінена ціна — sameBoards = false', !m.sameBoards([board], [{ ...draft, price: '2500' }]));
  t('порядок ключів сервера не впливає',
    m.sameBoards([{ priceMinor: 245050, unit: 'sheet', grain: 'length', thicknessMm: 18, widthMm: 2070, lengthMm: 2800, kind: 'chipboard', decor: 'H1388 ST40', name: board.name, id: board.id } as any], [draft]));
}

console.log('\nПеревірка рядка (межі Marketplace):');
{
  const ok = m.toDraft(board);
  t('коректний рядок без помилок', Object.keys(m.validateDraft(ok, [ok.id])).length === 0);
  t('кирилиця в коді — помилка', Boolean(m.validateDraft({ ...ok, id: 'плита-1' }, ['плита-1']).id));
  t('дубль коду — помилка', Boolean(m.validateDraft(ok, [ok.id, ok.id]).id));
  t('порожня назва — помилка', Boolean(m.validateDraft({ ...ok, name: ' ' }, [ok.id]).name));
  t('довжина 199 мм — помилка', Boolean(m.validateDraft({ ...ok, lengthMm: '199' }, [ok.id]).lengthMm));
  t('товщина 101 мм — помилка', Boolean(m.validateDraft({ ...ok, thicknessMm: '101' }, [ok.id]).thicknessMm));
  t('товщина «18,5» приймається', !m.validateDraft({ ...ok, thicknessMm: '18,5' }, [ok.id]).thicknessMm);
  t('ціна «абв» — помилка', Boolean(m.validateDraft({ ...ok, price: 'абв' }, [ok.id]).price));
  let thrown = '';
  try { m.fromDrafts([{ ...ok, lengthMm: '50' }]); } catch (e) { thrown = (e as Error).message; }
  t('fromDrafts називає рядок і причину', thrown.startsWith('Рядок 1') && thrown.includes('мм'), thrown);
  const blank = m.blankDraft(['board-1']);
  t('новий рядок отримує вільний код', blank.id === 'board-2', blank.id);
}

console.log('\nЦіна за лист і за м²:');
{
  const sheet = m.derivedPrices(m.toDraft(board));
  const area = 2.8 * 2.07;
  t('площа листа 2800×2070 = 5,796 м²', Math.abs((sheet.areaM2 ?? 0) - area) < 1e-9);
  t('ціна за лист — як задано', sheet.perSheetMinor === 245050);
  t('ціна за м² = лист / площа', sheet.perM2Minor === Math.round(245050 / area), String(sheet.perM2Minor));
  const perM2 = m.derivedPrices(m.toDraft({ ...board, unit: 'm2', priceMinor: 50000 }));
  t('за м² — як задано', perM2.perM2Minor === 50000);
  t('за лист = м² × площа', perM2.perSheetMinor === Math.round(50000 * area), String(perM2.perSheetMinor));
  const none = m.derivedPrices(m.toDraft({ ...board, priceMinor: null }));
  t('без ціни — обидві порожні', none.perSheetMinor === null && none.perM2Minor === null);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail) process.exit(1);
