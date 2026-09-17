/**
 * Тести моделі закупівель (src/components/adminOs/procurement.ts).
 * Запуск: npm run test:procurement
 *
 * Чиста логіка без React: порожній запис, рахунок економії, валідація перед
 * збереженням. Серверний CRUD (server/procurementRoutes.ts) дзеркалить
 * furnitureProductRoutes.ts один в один, тож окремого HTTP-тесту немає —
 * так само, як для чорнеток виробів немає окремого HTTP-тесту.
 */

const pc = await import('../src/components/adminOs/procurement');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('Порожній запис:');
{
  const r = pc.blankProcurementRecord();
  t('id не порожній', typeof r.id === 'string' && r.id.length > 0, r.id);
  t('id має префікс pr-', r.id.startsWith('pr-'), r.id);
  t('матеріал порожній', r.material === '');
  t('одиниця — перша з підказок', r.unit === pc.PROCUREMENT_UNIT_HINTS[0], r.unit);
  t('appliedTo порожній', Array.isArray(r.appliedTo) && r.appliedTo.length === 0);
  t('дата закупівлі — сьогодні (ISO-дата)', /^\d{4}-\d{2}-\d{2}$/.test(r.purchaseDate), r.purchaseDate);
}

console.log('\nІдентифікатори:');
{
  const a = pc.procurementUid();
  const b = pc.procurementUid();
  t('два id різні', a !== b, `${a} / ${b}`);
}

console.log('\nЕкономія:');
{
  const r = pc.blankProcurementRecord();
  r.oldPricePerUnitUah = 1000;
  r.newPricePerUnitUah = 800;
  t('економія за одиницю = 200', pc.procurementSavingsPerUnit(r) === 200, String(pc.procurementSavingsPerUnit(r)));
  t('економія у відсотках = 20', pc.procurementSavingsPercent(r) === 20, String(pc.procurementSavingsPercent(r)));

  const withQty = { ...r, quantity: 5 };
  t('загальна економія на партію = 1000', pc.procurementTotalSavingsUah(withQty) === 1000, String(pc.procurementTotalSavingsUah(withQty)));

  const noQty = { ...r, quantity: 0 };
  t('без кількості — загальна економія undefined', pc.procurementTotalSavingsUah(noQty) === undefined);

  const zeroOld = pc.blankProcurementRecord();
  zeroOld.oldPricePerUnitUah = 0;
  zeroOld.newPricePerUnitUah = 100;
  t('без старої ціни — 0%, не NaN', pc.procurementSavingsPercent(zeroOld) === 0, String(pc.procurementSavingsPercent(zeroOld)));

  const higher = pc.blankProcurementRecord();
  higher.oldPricePerUnitUah = 500;
  higher.newPricePerUnitUah = 700;
  t('нова ціна вища за стару — відʼємна економія', pc.procurementSavingsPerUnit(higher) === -200, String(pc.procurementSavingsPerUnit(higher)));
}

console.log('\nВалідація перед збереженням:');
{
  const empty = pc.blankProcurementRecord();
  const emptyIssues = pc.procurementIssues(empty);
  t('порожній запис — є зауваження', emptyIssues.length > 0, emptyIssues.join('; '));
  t('без матеріалу — зауваження про матеріал', emptyIssues.some((i: string) => i.includes('матеріал')), emptyIssues.join('; '));
  t('без постачальника — зауваження про постачальника', emptyIssues.some((i: string) => i.includes('постачальника')), emptyIssues.join('; '));

  const valid = pc.blankProcurementRecord();
  valid.material = 'Дуб масив';
  valid.supplier = 'Пилорама «Ліс»';
  valid.oldPricePerUnitUah = 1000;
  valid.newPricePerUnitUah = 800;
  t('коректний запис — без зауважень', pc.procurementIssues(valid).length === 0, pc.procurementIssues(valid).join('; '));

  const notCheaper = pc.blankProcurementRecord();
  notCheaper.material = 'Дуб масив';
  notCheaper.supplier = 'Пилорама «Ліс»';
  notCheaper.oldPricePerUnitUah = 800;
  notCheaper.newPricePerUnitUah = 900;
  const notCheaperIssues = pc.procurementIssues(notCheaper);
  t('нова ціна не дешевша — зауваження', notCheaperIssues.some((i: string) => i.includes('не дешевша')), notCheaperIssues.join('; '));

  const equal = pc.blankProcurementRecord();
  equal.material = 'Дуб масив';
  equal.supplier = 'Пилорама «Ліс»';
  equal.oldPricePerUnitUah = 800;
  equal.newPricePerUnitUah = 800;
  const equalIssues = pc.procurementIssues(equal);
  t('однакові ціни — теж зауваження (не дешевша)', equalIssues.some((i: string) => i.includes('не дешевша')), equalIssues.join('; '));
}

console.log('\nПідказки:');
{
  t('є підказки одиниць', pc.PROCUREMENT_UNIT_HINTS.length > 0, String(pc.PROCUREMENT_UNIT_HINTS.length));
  t('є підказки матеріалів', pc.PROCUREMENT_MATERIAL_KIND_HINTS.length > 0, String(pc.PROCUREMENT_MATERIAL_KIND_HINTS.length));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
