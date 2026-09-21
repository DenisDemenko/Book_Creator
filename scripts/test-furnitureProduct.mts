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

/**
 * Варіанти — додаткові артикули тієї самої назви (задача #225).
 *
 * Тут найдорожча властивість — УНІКАЛЬНІСТЬ АРТИКУЛА: два варіанти з тим самим
 * SKU на вітрині дали б дві позиції замовлення з різними цінами й однаковим
 * артикулом, а склад не знав би, що пакувати. Саме тому ці перевірки живуть
 * у моделі, а не лише в редакторі.
 */
console.log('\nВаріанти (додаткові артикули):');
{
  const p = fp.blankFurnitureProduct();
  t('у нової картки варіантів немає', Array.isArray(p.variants) && p.variants.length === 0);

  const v = fp.blankFurnitureVariant(1);
  t('порожній варіант видимий', v.visible === true);
  t('порожній варіант має порожній залишок (на замовлення)', v.stock === null);
  t('порожній варіант має заготовку опції', v.options.length === 1 && v.options[0].name === 'Комплектація', JSON.stringify(v.options));
  t('два порожні варіанти мають різні id', fp.blankFurnitureVariant(1).id !== fp.blankFurnitureVariant(2).id);

  // Базова картка для перевірок — та сама, що й у блоці вище.
  const base = () => {
    const product = fp.blankFurnitureProduct();
    product.name = 'Органайзер';
    product.sku = 'BK-ORG-001';
    product.priceUah = 8900;
    product.media = [{ id: 'm', label: 'b', src: 'data:,' }];
    return product;
  };

  const withVariants = base();
  withVariants.variants = [
    { id: 'v1', name: '2pc Phone/Pens Lid', sku: 'BK-LED_YSEN_0002', priceUah: 3800, stock: 5, visible: true, options: [{ name: 'Комплектація', value: '2pc' }] },
    { id: 'v2', name: '3pc + Open Notes', sku: 'BK-LED_YSEN_0003', priceUah: 4400, stock: null, visible: true, options: [{ name: 'Комплектація', value: '3pc + нотатки' }] },
    { id: 'v3', name: '4pc + 3 Lids', sku: 'BK-LED_YSEN_0004', priceUah: 4800, stock: 2, visible: false, options: [{ name: 'Комплектація', value: '4pc' }] },
  ];
  t('картка з варіантами проходить валідацію', fp.furniturePublishIssues(withVariants).length === 0, fp.furniturePublishIssues(withVariants).join('; '));
  t('видимих варіантів — два', fp.visibleVariants(withVariants).length === 2, String(fp.visibleVariants(withVariants).length));
  t('ціна каталогу — найдешевший ВИДИМИЙ', fp.effectivePriceUah(withVariants) === 3800, String(fp.effectivePriceUah(withVariants)));
  t('діапазон цін видно (каталог скаже «від»)', fp.hasVariantPriceRange(withVariants) === true);
  t('назви опцій унікальні', fp.variantOptionNames(withVariants).join(',') === 'Комплектація', fp.variantOptionNames(withVariants).join(','));

  // Прихований найдешевший не має опускати ціну каталогу: покупець його не бачить.
  const hidden = base();
  hidden.variants = [
    { id: 'v1', name: 'Дешевий (прихований)', sku: 'S-1', priceUah: 100, stock: null, visible: false, options: [] },
    { id: 'v2', name: 'Дорогий видимий', sku: 'S-2', priceUah: 5000, stock: null, visible: true, options: [] },
  ];
  t('ціна каталогу ігнорує приховані варіанти', fp.effectivePriceUah(hidden) === 5000, String(fp.effectivePriceUah(hidden)));
  t('одна ціна — без «від»', fp.hasVariantPriceRange(hidden) === false);

  // Дубль артикула — головна причина існування перевірок.
  const dup = base();
  dup.variants = [
    { id: 'v1', name: 'Перший', sku: 'SAME-1', priceUah: 100, stock: null, visible: true, options: [] },
    { id: 'v2', name: 'Другий', sku: 'same-1', priceUah: 200, stock: null, visible: true, options: [] },
  ];
  const dupIssues = fp.furniturePublishIssues(dup);
  t('дубль артикула (навіть у різному регістрі) → зауваження',
    dupIssues.some((i: string) => i.includes('уже зайнятий')), dupIssues.join('; '));
  t('у зауваженні видно, який саме варіант зайняв артикул',
    dupIssues.some((i: string) => i.includes('варіантом 1')), dupIssues.join('; '));

  const sameAsProduct = base();
  sameAsProduct.variants = [
    { id: 'v1', name: 'Той самий', sku: 'BK-ORG-001', priceUah: 100, stock: null, visible: true, options: [] },
  ];
  t('артикул варіанта не може дорівнювати артикулу товару',
    fp.furniturePublishIssues(sameAsProduct).some((i: string) => i.includes('збігається з артикулом товару')));

  const broken = base();
  broken.variants = [
    { id: 'v1', name: '', sku: '', priceUah: 0, stock: -5, visible: true, options: [{ name: 'Комплектація', value: '' }] },
  ];
  const brokenIssues = fp.furniturePublishIssues(broken);
  t('порожня назва варіанта → зауваження', brokenIssues.some((i: string) => i.includes('немає назви варіанта')));
  t('порожній артикул варіанта → зауваження', brokenIssues.some((i: string) => i.includes('немає артикула')));
  t('нульова ціна варіанта → зауваження', brokenIssues.some((i: string) => i.includes('ціна має бути більшою за нуль')));
  t('від’ємний залишок → зауваження', brokenIssues.some((i: string) => i.includes('не може бути від’ємним')));
  t('опція без значення → зауваження', brokenIssues.some((i: string) => i.includes('і назву, і значення')));

  const allHidden = base();
  allHidden.variants = [
    { id: 'v1', name: 'Прихований', sku: 'H-1', priceUah: 100, stock: null, visible: false, options: [] },
  ];
  t('усі варіанти приховані → зауваження',
    fp.furniturePublishIssues(allHidden).some((i: string) => i.includes('Усі варіанти приховані')));

  const duplicateOption = base();
  duplicateOption.variants = [
    {
      id: 'v1', name: 'Варіант', sku: 'O-1', priceUah: 100, stock: null, visible: true,
      options: [{ name: 'Колір', value: 'Oak' }, { name: 'колір', value: 'Walnut' }],
    },
  ];
  t('однакова опція двічі → зауваження',
    fp.furniturePublishIssues(duplicateOption).some((i: string) => i.includes('указана двічі')));

  // Товар без базової ціни, але з цінами у варіантах — валідний: саме так
  // виглядає картка, де вся ціна живе у варіантах.
  const variantOnlyPrice = base();
  variantOnlyPrice.priceUah = 0;
  variantOnlyPrice.variants = [
    { id: 'v1', name: 'Варіант', sku: 'P-1', priceUah: 2500, stock: null, visible: true, options: [] },
  ];
  t('ціна лише у варіантах — публікація дозволена', fp.furniturePublishIssues(variantOnlyPrice).length === 0, fp.furniturePublishIssues(variantOnlyPrice).join('; '));
  t('ціна каталогу береться з варіанта', fp.effectivePriceUah(variantOnlyPrice) === 2500);

  const nothingPriced = base();
  nothingPriced.priceUah = 0;
  nothingPriced.variants = [
    { id: 'v1', name: 'Варіант', sku: 'P-2', priceUah: 0, stock: null, visible: true, options: [] },
  ];
  t('ні базової ціни, ні цін варіантів → зауваження',
    fp.furniturePublishIssues(nothingPriced).some((i: string) => i.includes('Немає жодної ціни')));

  const tooMany = base();
  tooMany.variants = Array.from({ length: fp.MAX_VARIANTS + 1 }, (_, i) => ({
    id: `v${i}`, name: `Варіант ${i}`, sku: `SKU-${i}`, priceUah: 100, stock: null, visible: true, options: [],
  }));
  t('понад межу варіантів → зауваження',
    fp.furniturePublishIssues(tooMany).some((i: string) => i.includes('Забагато варіантів')));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
