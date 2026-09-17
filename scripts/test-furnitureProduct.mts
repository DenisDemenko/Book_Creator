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
  t('порожній залишок — це null (на замовлення), а не 0',
    p.stock === null, String(p.stock));
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

console.log('\nМежі полів приймача (саме вони дали HTTP 400 16.09.2026):');
{
  t('межа тизера — 300', fp.TEASER_MAX === 300, String(fp.TEASER_MAX));
  t('межа назви — 160', fp.TITLE_MAX === 160, String(fp.TITLE_MAX));
  t('межа опису — 40000', fp.DESCRIPTION_MAX === 40000, String(fp.DESCRIPTION_MAX));

  const mk = () => {
    const p = fp.blankFurnitureProduct();
    p.name = 'Органайзер';
    p.sku = 'X-1';
    p.priceUah = 100;
    p.media = [{ id: 'm', label: 'b', src: 'data:,' }];
    return p;
  };

  const longName = mk();
  longName.name = 'О'.repeat(161);
  t('назва 161 символ → зауваження', fp.furniturePublishIssues(longName).some((i) => i.includes('Назва задовга')));

  const longTeaser = mk();
  longTeaser.teaser = 'т'.repeat(301);
  const teaserIssues = fp.furniturePublishIssues(longTeaser);
  t('тизер 301 символ → зауваження', teaserIssues.some((i) => i.includes('Тизер задовгий')), teaserIssues.join('; '));
  t('у зауваженні видно, скільки зайвого', teaserIssues.some((i) => i.includes('301 із 300')));
  t('у зауваженні сказано, куди подіти довгий текст', teaserIssues.some((i) => i.includes('Повний деталізований опис')));

  longTeaser.teaser = 'т'.repeat(300);
  t('тизер рівно 300 → проходить', !fp.furniturePublishIssues(longTeaser).some((i) => i.includes('Тизер')));

  const longDesc = mk();
  longDesc.description = 'д'.repeat(40001);
  t('опис 40001 символ → зауваження', fp.furniturePublishIssues(longDesc).some((i) => i.includes('Опис задовгий')));

  // Залишок не входить у перевірку перед публікацією: null (на замовлення) і
  // явний 0 обидва дозволені — це різні речі, але обидві законні.
  const madeToOrder = mk();
  madeToOrder.stock = null;
  t('виріб на замовлення (stock=null) проходить', fp.furniturePublishIssues(madeToOrder).length === 0);
  madeToOrder.stock = 0;
  t('явний нуль (розпродано) теж проходить валідацію', fp.furniturePublishIssues(madeToOrder).length === 0);
}

console.log('\nЕлектроніка (ESP32/Arduino, опційний модуль понад LED):');
{
  const p = fp.blankFurnitureProduct();
  t('вимкнена за замовчуванням', p.electronicsEnabled === false);
  t('типовий контролер — esp32', p.electronicsController === 'esp32', p.electronicsController);
  t('самопрограмування дозволене за замовчуванням', p.electronicsUserProgrammable === true);
  t('функції порожні за замовчуванням', p.electronicsFunctions.length === 0);

  t('10 прикладів функцій', fp.DEFAULT_ELECTRONICS_FUNCTIONS.length === 10, String(fp.DEFAULT_ELECTRONICS_FUNCTIONS.length));
  t('усі приклади — непорожні рядки', fp.DEFAULT_ELECTRONICS_FUNCTIONS.every((f: string) => f.trim().length > 0));
  t('приклади без повторів', new Set(fp.DEFAULT_ELECTRONICS_FUNCTIONS).size === fp.DEFAULT_ELECTRONICS_FUNCTIONS.length);

  const controllerIds = fp.ELECTRONICS_CONTROLLERS.map((c: { id: string }) => c.id);
  t('обидва контролери в переліку', controllerIds.includes('esp32') && controllerIds.includes('arduino'), controllerIds.join(','));

  const enabledNoFns = fp.blankFurnitureProduct();
  enabledNoFns.name = 'Органайзер';
  enabledNoFns.sku = 'X-2';
  enabledNoFns.priceUah = 100;
  enabledNoFns.media = [{ id: 'm', label: 'b', src: 'data:,' }];
  enabledNoFns.electronicsEnabled = true;
  const enabledIssues = fp.furniturePublishIssues(enabledNoFns);
  t('електроніка увімкнена без функцій → зауваження', enabledIssues.some((i: string) => i.includes('жодної функції не обрано')), enabledIssues.join('; '));

  const enabledWithFns = fp.blankFurnitureProduct();
  enabledWithFns.name = 'Органайзер';
  enabledWithFns.sku = 'X-3';
  enabledWithFns.priceUah = 100;
  enabledWithFns.media = [{ id: 'm', label: 'b', src: 'data:,' }];
  enabledWithFns.electronicsEnabled = true;
  enabledWithFns.electronicsFunctions = [fp.DEFAULT_ELECTRONICS_FUNCTIONS[0]];
  const okIssues = fp.furniturePublishIssues(enabledWithFns);
  t('електроніка увімкнена з функцією → без зауваження про електроніку', !okIssues.some((i: string) => i.includes('Електроніка')), okIssues.join('; '));

  const disabledNoFns = fp.blankFurnitureProduct();
  disabledNoFns.name = 'Органайзер';
  disabledNoFns.sku = 'X-4';
  disabledNoFns.priceUah = 100;
  disabledNoFns.media = [{ id: 'm', label: 'b', src: 'data:,' }];
  t('електроніка вимкнена — відсутність функцій не заважає публікації', fp.furniturePublishIssues(disabledNoFns).length === 0);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
