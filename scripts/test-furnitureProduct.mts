/**
 * Тести моделі фізичного виробу (src/components/adminOs/furnitureProduct.ts).
 * Запуск: npm run test:furniture-product
 *
 * Тут — чиста логіка без React: порожня картка, валідація перед публікацією
 * і стабільність id. Це той мінімум, що має лишитись зеленим, навіть якщо
 * редактор перепишуть.
 */

const fp = await import('../src/components/adminOs/furnitureProduct');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('Порожня картка:');
{
  const p = fp.blankFurnitureProduct();
  t('id не порожній', typeof p.id === 'string' && p.id.length > 0, p.id);
  t('статус — чорнетка', p.status === 'draft');
  t('фізичний прапорець увімкнено', p.physical === true);
  t('шість функціональних зон за замовчуванням', p.functionalZones.length === 6, String(p.functionalZones.length));
  t('три тони дерева', p.woodTones.length === 3, String(p.woodTones.length));
  t('шість доступних кольорів', p.availableColors.length === 6, String(p.availableColors.length));
  t('медіа порожнє', p.media.length === 0);
  t('категорія — перша з переліку', p.category === 'Органайзери та підставки', p.category);
  t('оновлено — свіжа дата', !Number.isNaN(Date.parse(p.updatedAt)));
}

console.log('\nІдентифікатори:');
{
  const a = fp.furnitureUid();
  const b = fp.furnitureUid();
  t('два id різні', a !== b, `${a} / ${b}`);
  t('префікс виробу', a.startsWith('fp-'), a);
}

console.log('\nВалідація перед публікацією:');
{
  const empty = fp.blankFurnitureProduct();
  empty.name = '';
  empty.sku = '';
  empty.priceUah = 0;
  empty.media = [];
  const issues = fp.furniturePublishIssues(empty);
  t('порожня картка дає всі чотири зауваження', issues.length === 4, issues.join('; '));
  t('є зауваження про назву', issues.some((i) => i.includes('назви')));
  t('є зауваження про SKU', issues.some((i) => i.includes('SKU') || i.includes('артикул')));
  t('є зауваження про ціну', issues.some((i) => i.includes('Ціна')));
  t('є зауваження про фото', issues.some((i) => i.includes('фото')));

  const filled = fp.blankFurnitureProduct();
  filled.name = 'Органайзер';
  filled.sku = 'BK-ORG-001';
  filled.priceUah = 8900;
  filled.media = [{ id: 'm1', label: 'Банер', src: 'data:image/jpeg;base64,xx' }];
  t('заповнена картка проходить без зауважень', fp.furniturePublishIssues(filled).length === 0, fp.furniturePublishIssues(filled).join('; '));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
