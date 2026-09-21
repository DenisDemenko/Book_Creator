/**
 * Тестовий прогін публікації виробу (частина Г плану #173).
 * Запуск: npm run test:furniture-publish
 *
 * ЩО ПЕРЕВІРЯЄ. Увесь шлях Студії «картка → міст → приймач», на СПРАВЖНІХ
 * файлах власника: усі 10 зображень із теки `Рисунки\Товари\Органайзер`
 * читаються з диска, картка збирається за макетом і надсилається через
 * наявний міст (`publishProductToMarketplace` + `attachProductMediaToMarketplace`).
 *
 * ЧОМУ ПРИЙМАЧ ТУТ МОК. Справжній приймач `/bridge/products` — це окремий
 * репозиторій маркетплейсу з Postgres, і щоб він піднявся, потрібен Docker
 * (на машині власника він був вимкнений під час цього прогону). Замість того
 * щоб чекати на деплой, мок відтворює контракт приймача ТОЧНО — включно з
 * multipart-фото, — тож перевіряється реальний код моста, а не заглушка.
 * Коли приймач задеплоють, той самий скрипт можна спрямувати по-справжньому:
 * `FURNITURE_BRIDGE_URL` + `FURNITURE_BRIDGE_KEY` (див. примітку в кінці).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.tmpdir(), 'nova-furniture-publish');
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const bridge = await import('../server/marketplaceBridge');
const { blankFurnitureProduct } = await import('../src/components/adminOs/furnitureProduct');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const IMAGES_DIR = process.env.FURNITURE_IMAGES_DIR || 'D:\\Rama\\furnivision-architecture\\Рисунки\\Товари\\Органайзер';

console.log('Файли для прогону:');
if (!fs.existsSync(IMAGES_DIR)) {
  // Тека з фото лежить ПОЗА репозиторієм (це матеріали власника), тож на
  // іншій машині її може не бути. Це не помилка коду — пропускаємо прогін,
  // щоб не валити весь `npm test`.
  console.log(`  ⏭ теки немає (${IMAGES_DIR}) — прогін пропущено.`);
  console.log('\nПідсумок: 0 пройдено, 0 провалено (пропущено).');
  process.exit(0);
}
const images = fs
  .readdirSync(IMAGES_DIR)
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  .map((f) => {
    const full = path.join(IMAGES_DIR, f);
    return { name: f, full, size: fs.statSync(full).size };
  });
/**
 * Кількість знімків береться з теки, а не з константи: це матеріали ВЛАСНИКА
 * (`D:\Rama\…\Органайзер`), і він докладає туди файли. Раніше тут стояло
 * тверде «10», і 21.09.2026 прогін упав шість разів підряд лише тому, що в
 * теці стало 14 зображень — тест міряв теку, а не код.
 */
const PHOTO_COUNT = images.length;
t('знайдено зображень (мінімум одне)', PHOTO_COUNT >= 1, String(PHOTO_COUNT));
t('усі файли непорожні', images.every((i) => i.size > 0));
console.log(`     ${images.map((i) => i.name).join('\n     ')}`);

const mimeFor = (name: string) =>
  /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';

// ---------------------------------------------------------------------------
// Мок приймача: точно той контракт, що й у bridge.controller.ts маркетплейсу.
// ---------------------------------------------------------------------------
const received = {
  product: null as any,
  media: [] as { kind: string; filename: string; mimeType: string; sizeBytes: number; sha: string }[],
};

const mockFetch = (async (url: string, init: any = {}) => {
  const u = String(url);
  if (u.endsWith('/bridge/products') && init.method === 'POST') {
    received.product = JSON.parse(String(init.body));
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ created: true, listing: { slug: 'premium-organaizer-led', kind: 'product' } }),
    };
  }
  if (u.includes('/bridge/products/') && u.endsWith('/media')) {
    const form = init.body as FormData;
    const file = form.get('file') as unknown as { name?: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer> };
    const kind = String(form.get('kind') || 'gallery');
    const buf = Buffer.from(await file.arrayBuffer());
    const { createHash } = await import('node:crypto');
    received.media.push({
      kind,
      filename: file.name || 'file',
      mimeType: String(file.type || ''),
      sizeBytes: buf.byteLength,
      sha: createHash('sha1').update(buf).digest('hex').slice(0, 8),
    });
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ attached: true, kind, replaced: 0, media: { id: `m-${received.media.length}` } }),
    };
  }
  return { status: 404, ok: false, text: async () => JSON.stringify({ message: `Cannot POST ${u}` }) };
}) as never;

const settings = { url: 'http://localhost:9999', key: 'test-bridge-key' };

// ---------------------------------------------------------------------------
// Картка за макетом власника.
// ---------------------------------------------------------------------------
const product = blankFurnitureProduct();
Object.assign(product, {
  sku: 'BK-ORG-LED-2084',
  name: 'Преміальний органайзер для робочого столу з LED-підсвічуванням',
  category: 'Органайзери та підставки',
  subcategory: 'Авторський крафт (Дерево + Смола)',
  priceUah: 8900,
  basePriceUah: 9800,
  stock: 4,
  teaser: 'Преміальний настільний органайзер ручної роботи з масиву ясена з теплою LED-підсвіткою.',
  description:
    'Поєднання теплої текстури натурального ясена, прецизійної CNC-обробки та м’якого LED-підсвічування.\n\n' +
    'Кожен виріб виготовляється вручну, тому можливі відмінності в текстуру деревини.',
  material: 'Масив добірного Ясена (Ash Wood)',
  Finish: undefined,
  finish: 'Епоксидна смола бурштинового спектра + масло-віск',
  dimensions: '30 × 40 × 7.5 см',
  warranty: '24 місяці офіційної гарантії',
});

console.log('\nПублікація картки:');
{
  const result = await bridge.publishProductToMarketplace(
    {
      sku: product.sku,
      title: product.name,
      subtitle: product.teaser,
      summary: product.teaser,
      description: product.description,
      priceMinor: Math.round(product.priceUah * 100),
      basePriceMinor: Math.round(product.basePriceUah * 100),
      stock: product.stock,
      highlights: product.functionalZones,
      attributes: {
        category: product.category,
        subcategory: product.subcategory,
        material: product.material,
        finish: product.finish,
        dimensions: product.dimensions,
        warranty: product.warranty,
        leadTime: product.leadTime,
        physical: product.physical,
        ledStrip: product.ledStrip,
        ledPower: product.ledPower,
        ledControl: product.ledControl,
        functionalZones: product.functionalZones,
        woodTones: product.woodTones.map((w) => ({ label: w.label, color: w.color })),
        colors: product.availableColors.map((c) => ({ label: c.label, enabled: c.enabled })),
        engraving: product.engraving,
        engravingPriceMinor: Math.round(product.engravingPriceUah * 100),
        resinColor: product.resinColor,
        phoneFit: product.phoneFit,
      },
      sellerSlug: 'fusion-lab',
    },
    { fetch: mockFetch, settings }
  );

  t('картка дійшла до приймача', received.product !== null);
  t('externalId = product:<SKU>', received.product?.externalId === 'product:BK-ORG-LED-2084', String(received.product?.externalId));
  t('ціна в копійках', received.product?.priceMinor === 890000, String(received.product?.priceMinor));
  t('базова ціна (закреслена) передана', received.product?.basePriceMinor === 980000, String(received.product?.basePriceMinor));
  t('залишок передано', received.product?.stock === 4, String(received.product?.stock));
  t('меблеві атрибути в attributes', typeof received.product?.attributes?.material === 'string');
  t('LED-параметри в attributes', received.product?.attributes?.ledStrip === product.ledStrip);
  t('функціональні зони — 6', received.product?.attributes?.functionalZones?.length === 6, String(received.product?.attributes?.functionalZones?.length));
  t('тони дерева — 3', received.product?.attributes?.woodTones?.length === 3, String(received.product?.attributes?.woodTones?.length));
  t('кольори — 6', received.product?.attributes?.colors?.length === 6, String(received.product?.attributes?.colors?.length));
  t('slug повернувся', result.slug === 'premium-organaizer-led', String(result.slug));
  t('created прочитано', result.created === true);
}

console.log(`\nЗавантаження всіх ${PHOTO_COUNT} фото:`);
{
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    await bridge.attachProductMediaToMarketplace(
      {
        sku: product.sku,
        kind: i === 0 ? 'cover' : 'gallery',
        filename: img.name,
        mimeType: mimeFor(img.name),
        bytes: new Uint8Array(fs.readFileSync(img.full)),
      },
      { fetch: mockFetch, settings }
    );
  }

  t(`приймач отримав рівно ${PHOTO_COUNT} фото`, received.media.length === PHOTO_COUNT, String(received.media.length));
  t('перший файл — головний банер (cover)', received.media[0]?.kind === 'cover', received.media[0]?.kind);
  t('решта — галерея', received.media.slice(1).every((m) => m.kind === 'gallery'));
  t('кожен файл має тип зображення', received.media.every((m) => m.mimeType.startsWith('image/')), received.media.map((m) => m.mimeType).join(','));
  t('усі байти дійшли цілими (розмір збігається з диском)',
    received.media.every((m, i) => m.sizeBytes === images[i].size),
    received.media.map((m, i) => `${m.sizeBytes}/${images[i].size}`).join(' '));
  t('жодне фото не дублюється (усі різні)',
    new Set(received.media.map((m) => m.sha)).size === received.media.length,
    String(new Set(received.media.map((m) => m.sha)).size));

  console.log('     отримано:');
  received.media.forEach((m, i) => console.log(`       ${i + 1}. [${m.kind}] ${m.filename} — ${m.mimeType}, ${m.sizeBytes} Б`));
}

console.log('\nЩо побачить вітрина (симуляція рендера сторінки товару):');
{
  const a = received.product.attributes;
  const shop = {
    cover: received.media[0]?.filename,
    gallery: received.media.slice(1).map((m) => m.filename),
    specs: [a.material, a.finish, a.dimensions, a.warranty, a.leadTime].filter(Boolean),
    zones: a.functionalZones,
    led: [a.ledStrip, a.ledPower, a.ledControl].filter(Boolean),
    colors: a.colors.filter((c: any) => c.enabled).map((c: any) => c.label),
    tones: a.woodTones.map((w: any) => w.label),
  };
  t('обкладинка картки є', Boolean(shop.cover), String(shop.cover));
  t('у галереї всі фото, крім обкладинки', shop.gallery.length === PHOTO_COUNT - 1, String(shop.gallery.length));
  t('таблиця характеристик непорожня', shop.specs.length >= 4, String(shop.specs.length));
  t('функціональні зони показані', shop.zones.length === 6);
  t('LED-блок показаний', shop.led.length === 3, String(shop.led.length));
  t('кольори показані', shop.colors.length === 6, String(shop.colors.length));
  t('тони дерева показані', shop.tones.length === 3, String(shop.tones.join(', ')));
  t(`усього зображень на сторінці — ${PHOTO_COUNT}`, 1 + shop.gallery.length === PHOTO_COUNT, String(1 + shop.gallery.length));
}

console.log('\nПублікація везе й ФОТО (ланка, якої бракувало 16.09.2026):');
{
  const { uploadProductMedia } = await import('../server/furnitureProductRoutes');

  const calls: { method: string; url: string; kind?: string; name?: string; size?: number; mime?: string }[] = [];
  const mediaFetch = (async (url: string, init: any = {}) => {
    const u = String(url);
    const method = String(init.method || 'GET');
    if (u.endsWith('/media') && method === 'DELETE') {
      calls.push({ method, url: u });
      return { status: 200, ok: true, text: async () => JSON.stringify({ cleared: 0 }) };
    }
    const form = init.body as FormData;
    const file = form.get('file') as unknown as { name?: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer> };
    const buf = Buffer.from(await file.arrayBuffer());
    calls.push({
      method,
      url: u,
      kind: String(form.get('kind')),
      name: file.name,
      size: buf.byteLength,
      mime: String(file.type),
    });
    return { status: 200, ok: true, text: async () => JSON.stringify({ attached: true, kind: form.get('kind'), replaced: 0 }) };
  }) as never;

  const draft = {
    sku: 'BK-ORG-LED-2084',
    media: images.map((img) => ({
      src: `data:${mimeFor(img.name)};base64,${fs.readFileSync(img.full).toString('base64')}`,
    })),
  };

  const res = await uploadProductMedia(draft, 'product:BK-ORG-LED-2084', { fetch: mediaFetch, settings });

  t('спершу чиститься старий набір (DELETE), і лише потім фото',
    calls[0]?.method === 'DELETE' && calls[0]?.url.endsWith('/media'), `${calls[0]?.method} ${calls[0]?.url}`);
  t(`усі ${PHOTO_COUNT} фото поїхали (1 DELETE + ${PHOTO_COUNT} завантажень)`,
    res.uploaded === PHOTO_COUNT && calls.length === PHOTO_COUNT + 1, `uploaded=${res.uploaded}, дзвінків=${calls.length}`);
  t('жодної невдачі', res.failed.length === 0, res.failed.join('; '));
  t('перший файл — головний банер (cover)', calls[1]?.kind === 'cover', String(calls[1]?.kind));
  t('решта — галерея', calls.slice(2).every((c) => c.kind === 'gallery'));
  t('байти декодовані з data URL цілими (розмір як на диску)',
    calls.slice(1).every((c, i) => c.size === images[i].size),
    calls.slice(1).map((c, i) => `${c.size}/${images[i].size}`).join(' '));
  t('імена файлів детерміновані й без кирилиці',
    calls.slice(1).every((c) => /^BK-ORG-LED-2084-\d{2}\.(jpg|png|webp)$/.test(String(c.name))), String(calls[1]?.name));
  t('типи зображень збережені', calls.slice(1).every((c) => String(c.mime).startsWith('image/')));

  // Порожня галерея не має смикати міст взагалі.
  const empty = await uploadProductMedia({ sku: 'X', media: [] }, 'product:X', { fetch: mediaFetch, settings });
  t('без фото міст не турбують', empty.uploaded === 0 && calls.length === PHOTO_COUNT + 1, String(calls.length));
}

console.log('\nВаріанти їдуть на вітрину окремим полем (задача #225):');
{
  const { toBridgeVariants } = await import('../server/furnitureProductRoutes');

  const withVariants = blankFurnitureProduct();
  withVariants.sku = 'BK-LED-YSEN';
  withVariants.name = 'Модульний органайзер';
  withVariants.priceUah = 4400;
  withVariants.variants = [
    { id: 'v1', name: '4pc + 3 Lids', sku: 'BK-LED_YSEN_0004', priceUah: 4800, stock: 2, visible: true, options: [{ name: 'Комплектація', value: '4pc' }] },
    { id: 'v2', name: '2pc Phone/Pens Lid', sku: 'BK-LED_YSEN_0002', priceUah: 3800, stock: null, visible: true, options: [{ name: 'Комплектація', value: '2pc' }] },
    { id: 'v3', name: 'Прихований', sku: 'BK-LED_YSEN_0009', priceUah: 100, stock: null, visible: false, options: [] },
  ];

  const mapped = toBridgeVariants(withVariants.variants);
  t('видимі варіанти їдуть першими', mapped[0]?.visible === true && mapped[1]?.visible === true, mapped.map((v: any) => v.visible).join(','));
  t('прихований не викинуто, але він останній', mapped[2]?.visible === false && mapped.length === 3, String(mapped.length));
  t('серед видимих дешевший попереду', mapped[0]?.priceMinor === 380000, String(mapped[0]?.priceMinor));
  t('ціна варіанта — в копійках', mapped.every((v: any) => Number.isInteger(v.priceMinor)));
  t('залишок «на замовлення» не їде як null', mapped.find((v: any) => v.sku === 'BK-LED_YSEN_0002')?.stock === undefined);
  t('опції збережено парами', mapped[0]?.options?.[0]?.name === 'Комплектація', JSON.stringify(mapped[0]?.options));

  // Ламані варіанти (порожній артикул / нульова ціна) не мають доїхати:
  // інакше вітрина отримала б рядок без артикула.
  const broken = toBridgeVariants([
    { id: 'x', name: '', sku: '', priceUah: 100, stock: null, visible: true, options: [] },
    { id: 'y', name: 'Добрий', sku: 'OK-1', priceUah: 0, stock: null, visible: true, options: [] },
    { id: 'z', name: 'Робочий', sku: 'OK-2', priceUah: 100, stock: null, visible: true, options: [] },
  ] as never);
  t('варіант без артикула/назви не їде', broken.length === 1 && broken[0]?.sku === 'OK-2', JSON.stringify(broken));

  const sent = await bridge.publishProductToMarketplace(
    {
      sku: withVariants.sku,
      title: withVariants.name,
      priceMinor: 380000,
      variants: mapped as never,
      attributes: { variantPriceRange: true },
      sellerSlug: 'fusion-lab',
    },
    { fetch: mockFetch, settings }
  );
  t('міст надіслав варіанти в тілі запиту', Array.isArray(received.product?.variants) && received.product.variants.length === 3, JSON.stringify(received.product?.variants?.length));
  t('кожен варіант має власний артикул', received.product?.variants?.every((v: any) => typeof v.sku === 'string' && v.sku.length > 0));
  t('ціна картки передана окремо від цін варіантів', received.product?.priceMinor === 380000, String(received.product?.priceMinor));
  t('ознака «від» доїхала в attributes', received.product?.attributes?.variantPriceRange === true);
  t('публікація з варіантами не впала', sent.created === true);
}

// ---------------------------------------------------------------------------
// Як зробити СПРАВЖНІЙ прогін (коли приймач задеплоють):
//   1. задеплоїти маркетплейс (міграція product_attributes + /bridge/products);
//   2. задати BRIDGE_API_KEY у Студії через адмінку «Міст до вітрини»;
//   3. цей скрипт викликати з FURNITURE_BRIDGE_URL + FURNITURE_BRIDGE_KEY —
//      логіка та сама, змінюється лише `fetch` замість мока.
// ---------------------------------------------------------------------------
console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
