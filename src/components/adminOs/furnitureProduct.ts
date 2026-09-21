/**
 * Меблеві / деревʼяні вироби на вітрині — модель картки товару.
 *
 * Це НЕ книга й НЕ курс: виріб має власний набір полів — матеріал,
 * оздоблення, габарити, LED-модуль, тони дерева, персоналізація. Усі вони
 * задані макетом `fusion_lab_studio` (нічна тема), який власник додав до
 * завдання. Денна тема — та сама модель, лише інша гама.
 *
 * Типи живуть окремо від компонента, щоб редактор, тест і серверні маршрути
 * (коли дійде до мосту) читали ОДНУ форму, а не три копії з розбіжностями.
 */

export type FurnitureProductStatus = 'draft' | 'published' | 'archived';

/** Вид медіа-файла картки: фото (типово) чи коротке відео виробу. */
export type FurnitureMediaKind = 'image' | 'video';

/** Один завантажений файл-ілюстрація картки (превʼю як data URL). */
export interface FurnitureMediaItem {
  id: string;
  /** Підпис: «Головний банер CAD / CNC», «Інтерʼєр 2», «Відео 1» тощо. */
  label: string;
  /** Data URL превʼю — для чорнетки; повний файл береться при публікації. */
  src: string;
  /** Імʼя файла — для підпису й перевірки формату. */
  filename?: string;
  /** Ширина/висота в px, якщо відомі (для підпису, як у макеті). Для відео не рахується. */
  width?: number;
  height?: number;
  /**
   * `'image'` за замовчуванням — поле додане пізніше, тож чорнетки без
   * нього лишаються фото. `'video'` — ролик виробу, що йде в слайд-шоу
   * вітрини разом із фото, але рахується в окремій межі (`MAX_GALLERY_VIDEOS`).
   */
  kind?: FurnitureMediaKind;
}

/** true, якщо елемент медіа — відео (з урахуванням відсутнього поля `kind`). */
export function isVideoMedia(item: Pick<FurnitureMediaItem, 'kind'>): boolean {
  return item.kind === 'video';
}

/** Тон дерева з палітри (3 варіанти, як у макеті). */
export interface FurnitureWoodTone {
  id: string;
  label: string;
  color: string;
}

/** Доступний колір для персоналізації (клієнт обирає в кошику). */
export interface FurnitureColor {
  id: string;
  label: string;
  enabled: boolean;
}

/**
 * Одна опція варіанта: «Комплектація» → «3pc + Open Notes», «Колір» → «Oak».
 *
 * ЧОМУ ПАРИ «назва → значення», а не фіксовані поля. Власник назвав три
 * різні вісі (комплектація, покраска, розміри) — і саме тому жорсткі колонки
 * під кожну з них застаріли б на першій же новій вісі. Пари дають і одну
 * вісь (як у прикладі на скріншоті: «Organizer Set» з трьома значеннями),
 * і кілька одразу, без зміни схеми.
 */
export interface FurnitureVariantOption {
  /** Назва опції: «Комплектація», «Колір», «Розмір». */
  name: string;
  /** Значення цієї опції у варіанті: «3pc + Open Notes», «Oak», «30 × 40 см». */
  value: string;
}

/**
 * Варіант виробу — ДОДАТКОВИЙ АРТИКУЛ тієї самої назви (задача #225).
 *
 * Навіщо окремий артикул, а не просто поле «колір»: у власника комплектації
 * відрізняються і складом, і ціною (2pc — 95$, 3pc — 110$, 4pc — 120$), тож
 * покупець має бачити вибір із власною ціною, а склад — знати, ЩО саме
 * поїхало. Наскрізний шлях одного варіанта: картка в Студії → міст →
 * `attributes.variants` лістингу → вибір на вітрині → рядок кошика →
 * позиція замовлення (там уже знімок назви й ціни).
 */
export interface FurnitureVariant {
  id: string;
  /** Назва у виборі покупця: «3pc + Open Notes». */
  name: string;
  /** Власний артикул варіанта — саме те, що просив власник. */
  sku: string;
  /** Ціна варіанта в гривнях цілими (так само, як у базової картки — `priceUah`). */
  priceUah: number;
  /** `null` — «не обліковується / на замовлення», як і в базової картки. */
  stock: number | null;
  /** Показувати цей варіант покупцеві на вітрині. */
  visible: boolean;
  options: FurnitureVariantOption[];
}

/**
 * Вбудована програмована електроніка — понад просту LED-підсвітку.
 * Плата монтується в деревʼяну основу, дисплея поки немає (керування
 * кнопками/датчиками/застосунком). Власник: «Клектроника додається
 * опційно» — самі поля вмикаються лише коли `electronicsEnabled`.
 */
export type FurnitureElectronicsController = 'esp32' | 'arduino';

/** Повна картка виробу. */
export interface FurnitureProduct {
  id: string;
  /** Артикул — він же джерело `externalId` мосту (стабільна пара). */
  sku: string;
  name: string;
  category: string;
  subcategory: string;
  /** Поточна ціна, гривень цілими (копійки множимо на 100 під час публікації). */
  priceUah: number;
  /** Базова ціна / до знижки. */
  basePriceUah: number;
  /**
   * Запис закупівлі (`ProcurementRecord.id`), звідки взялась поточна знижка —
   * `null`, якщо ціну ніколи не знижували через закупівлю. Дає простежуваність
   * «чому саме така ціна» назад до реальної економії на матеріалі.
   */
  discountSourceProcurementId: string | null;
  /**
   * Залишок. **`null` — «не обліковується»**: виріб роблять на замовлення,
   * тож 0 було б брехнею («продано») і вітрина показувала б «немає в
   * наявності» з вимкненою кнопкою покупки. Явний 0 лишається для випадку
   * «справді розпродано».
   */
  stock: number | null;
  leadTime: string;
  /** «Активний у Nexus» — чи показується в каталозі. */
  activeInNexus: boolean;
  /** «Фізичний (у Kyiv)» — handmade/CNC виріб. */
  physical: boolean;
  teaser: string;
  description: string;
  /** Функціональні зони та слоти — позначки характеристик. */
  functionalZones: string[];
  material: string;
  finish: string;
  dimensions: string;
  warranty: string;
  ledStrip: string;
  ledPower: string;
  ledControl: string;
  /** Чи вбудована в виріб програмована плата (ESP32/Arduino), понад LED. */
  electronicsEnabled: boolean;
  /** Яка плата — впливає на текст «самостійне програмування» на вітрині. */
  electronicsController: FurnitureElectronicsController;
  /** «Є можливість покупцю програмувати самостійно» — власник ТЗ. */
  electronicsUserProgrammable: boolean;
  /** Обрані функції (з DEFAULT_ELECTRONICS_FUNCTIONS або власні). */
  electronicsFunctions: string[];
  media: FurnitureMediaItem[];
  /** Палітра тонів дерева (з вітрини). */
  woodTones: FurnitureWoodTone[];
  /** Доступні тони та персоналізація. */
  availableColors: FurnitureColor[];
  /**
   * Додаткові артикули тієї самої назви (комплектація / колір / розмір).
   * Порожній масив — товар продається одним артикулом, як і до #225:
   * саме тому поле необов'язкове за змістом, а вітрина показує базову ціну
   * `priceUah` без вибору.
   */
  variants: FurnitureVariant[];
  engraving: boolean;
  engravingPriceUah: number;
  resinColor: boolean;
  phoneFit: boolean;
  status: FurnitureProductStatus;
  publishedAt?: string | null;
  /**
   * Слаг картки на вітрині (`/uk/catalog/:slug`) — приходить у відповіді
   * публікації (`publishProductToMarketplace`) і зберігається тут, щоб
   * кнопка «Переглянути товар на вітрині» працювала і після перезавантаження
   * сторінки, без повторного запиту до мосту. `null` — товар ще не публікувався
   * або слаг не повернувся (старий запис до цього поля).
   */
  slug?: string | null;
  updatedAt: string;
}

export const FURNITURE_CATEGORIES = [
  'Органайзери та підставки',
  'Ексклюзивний декор',
  'LED Еко-вироби',
  'Цифрові STL моделі',
] as const;

export const FURNITURE_SUBCATEGORIES = [
  'Авторський крафт (Дерево + Смола)',
  'Офісні аксесуари',
  'Подарункові комплекти',
] as const;

export const FURNITURE_MATERIALS = [
  'Масив добірного Ясена (Ash Wood)',
  'Американський Горіх (Walnut)',
  'Масив Дуба (Oak)',
  'Термоясен темний',
] as const;

export const DEFAULT_FUNCTIONAL_ZONES = [
  'Смартфон / iPhone (усі розміри)',
  'Навушники (True Wireless / Apple Watch)',
  'Годинник / браслет',
  'Чохли для телефону / дрібниці',
  'Слот під кабелі / тримач',
  'Додатковий слот',
] as const;

/**
 * Контролери, з яких обирає автор картки. Одна плата на виріб — не
 * мультивибір, бо це визначає й текст «самостійне програмування», і
 * приблизну вартість монтажу в калькуляторі собівартості.
 */
export const ELECTRONICS_CONTROLLERS: ReadonlyArray<{
  id: FurnitureElectronicsController;
  label: string;
}> = [
  { id: 'esp32', label: 'ESP32 (Wi-Fi + Bluetooth)' },
  { id: 'arduino', label: 'Arduino' },
];

/**
 * 10 прикладів функцій вбудованої електроніки — власник попросив
 * «придумай 10 функцій для органайзера для прикладу». Це не жорсткий
 * перелік: автор картки може прибрати будь-яку й дописати власну (див.
 * `toggleElectronicsFunction` у редакторі) — початковий список лише
 * пришвидшує заповнення.
 */
export const DEFAULT_ELECTRONICS_FUNCTIONS: readonly string[] = [
  'Розклад підсвітки за часом (таймер увімкнення/вимкнення)',
  'Звуковий будильник / нагадування за розкладом',
  'Плавне згасання та наростання яскравості',
  'Датчик руху — автоувімкнення при наближенні, автовимкнення в простої',
  'Датчик освітленості — підсвітка лише в темний час доби',
  'Індикатор заряду бездротової зарядки телефону',
  'Збережені сцени/кольори підсвітки з перемиканням кнопкою',
  'Керування зі смартфона по Wi-Fi (веб-сторінка або застосунок)',
  'Нагадування «зробити перерву» — періодичний сигнал',
  'Таймер фокусу (Pomodoro) зі звуковим сигналом завершення',
];

export const DEFAULT_WOOD_TONES: FurnitureWoodTone[] = [
  { id: 'light-oak', label: 'Світлий дуб', color: '#e8c99b' },
  { id: 'dark-walnut', label: 'Темний горіх', color: '#6b4a2b' },
  { id: 'smoked-oak', label: 'Морений дуб', color: '#3e2a1a' },
];

export const DEFAULT_COLORS: FurnitureColor[] = [
  { id: 'oak', label: 'Oak (Дуб)', enabled: true },
  { id: 'walnut', label: 'Walnut (Горіх)', enabled: true },
  { id: 'teak', label: 'Teak (Тик)', enabled: true },
  { id: 'black', label: 'Black (Вугільний)', enabled: true },
  { id: 'ebony', label: 'Ebony (Ебен)', enabled: true },
  { id: 'mahogany', label: 'Mahogany', enabled: true },
];

/** Короткий id без залежності від `crypto` (працює і в node, і в браузері). */
export function furnitureUid(): string {
  return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Межі варіантів. Числа тут — не естетика, а межа розуму: список варіантів
 * показується покупцеві в одному випадному списку, а приймач мосту валідує
 * кожен рядок. Ті самі межі перевіряються і в Студії, і в DTO маркетплейсу.
 */
export const MAX_VARIANTS = 30;
export const VARIANT_NAME_MAX = 120;
export const VARIANT_OPTION_NAME_MAX = 40;
export const VARIANT_OPTION_VALUE_MAX = 80;
export const MAX_VARIANT_OPTIONS = 6;

/** Порожній варіант — з підготовленими полями, щоб не вводити назви колонок двічі. */
export function blankFurnitureVariant(index = 1): FurnitureVariant {
  return {
    id: furnitureUid(),
    name: '',
    sku: '',
    priceUah: 0,
    stock: null,
    visible: true,
    options: [{ name: 'Комплектація', value: '' }],
  };
}

/** Варіанти, які покупець справді побачить на вітрині. */
export function visibleVariants(p: Pick<FurnitureProduct, 'variants'>): FurnitureVariant[] {
  return (p.variants || []).filter((v) => v.visible);
}

/**
 * Ціна, за якою товар показується в каталозі й сортується.
 *
 * З варіантами це НАЙДЕШЕВШИЙ видимий — те саме «від 95$», яке покупець
 * бачить на картці перед тим, як відкрити сторінку (на скріншоті власника
 * ціна картки — саме ціна вибраного варіанта). Якщо видимих варіантів немає
 * (їх не завели або всі приховані) — базова ціна товару, тобто поведінка до
 * #225 не ламається.
 */
export function effectivePriceUah(p: FurnitureProduct): number {
  const visible = visibleVariants(p).filter((v) => v.priceUah > 0);
  if (!visible.length) return p.priceUah;
  return Math.min(...visible.map((v) => v.priceUah));
}

/** Чи ціни видимих варіантів різні — тоді вітрина має казати «від», а не «ціна». */
export function hasVariantPriceRange(p: FurnitureProduct): boolean {
  const prices = visibleVariants(p)
    .filter((v) => v.priceUah > 0)
    .map((v) => v.priceUah);
  return new Set(prices).size > 1;
}

/** Унікальні назви опцій у товарі — підказка для колонки «Опції» в редакторі. */
export function variantOptionNames(p: Pick<FurnitureProduct, 'variants'>): string[] {
  const names: string[] = [];
  for (const variant of p.variants || []) {
    for (const option of variant.options || []) {
      const name = option.name.trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Перевірки варіантів — окремо від загальних, щоб і тест, і редактор
 * показували ТУ САМУ причину відмови, а не два схожі формулювання.
 *
 * Найважливіше тут — унікальність артикула: два варіанти з тим самим SKU на
 * вітрині означали б, що склад не знає, що саме пакувати, а покупець бачить
 * два однакові рядки з різними цінами.
 */
export function variantIssues(p: FurnitureProduct): string[] {
  const issues: string[] = [];
  const variants = p.variants || [];
  if (!variants.length) return issues;

  if (variants.length > MAX_VARIANTS) {
    issues.push(`Забагато варіантів: ${variants.length} із дозволених ${MAX_VARIANTS}.`);
  }

  const seenSku = new Map<string, number>();
  const baseSku = p.sku.trim().toLowerCase();

  variants.forEach((variant, index) => {
    const where = `Варіант ${index + 1}`;
    const name = variant.name.trim();
    const sku = variant.sku.trim();

    if (!name) issues.push(`${where}: немає назви варіанта.`);
    else if (name.length > VARIANT_NAME_MAX) {
      issues.push(`${where}: назва задовга (${name.length} із ${VARIANT_NAME_MAX}).`);
    }

    if (!sku) issues.push(`${where}: немає артикула / SKU.`);
    else if (baseSku && sku.toLowerCase() === baseSku) {
      issues.push(`${where}: артикул «${sku}» збігається з артикулом товару — потрібен власний.`);
    } else {
      const key = sku.toLowerCase();
      const first = seenSku.get(key);
      if (first !== undefined) issues.push(`${where}: артикул «${sku}» уже зайнятий варіантом ${first}.`);
      else seenSku.set(key, index + 1);
    }

    if (!(variant.priceUah > 0)) issues.push(`${where}: ціна має бути більшою за нуль.`);
    if (variant.stock !== null && (!Number.isFinite(variant.stock) || variant.stock < 0)) {
      issues.push(`${where}: залишок не може бути від’ємним.`);
    }

    const options = (variant.options || []).filter(
      (o) => o.name.trim() || o.value.trim()
    );
    if (options.length > MAX_VARIANT_OPTIONS) {
      issues.push(`${where}: забагато опцій (${options.length} із ${MAX_VARIANT_OPTIONS}).`);
    }
    const optionNames = new Set<string>();
    options.forEach((option) => {
      const optionName = option.name.trim();
      const value = option.value.trim();
      if (!optionName || !value) {
        issues.push(`${where}: опція має мати і назву, і значення.`);
        return;
      }
      if (optionName.length > VARIANT_OPTION_NAME_MAX) {
        issues.push(`${where}: назва опції задовга (${optionName.length} із ${VARIANT_OPTION_NAME_MAX}).`);
      }
      if (value.length > VARIANT_OPTION_VALUE_MAX) {
        issues.push(`${where}: значення опції задовге (${value.length} із ${VARIANT_OPTION_VALUE_MAX}).`);
      }
      if (optionNames.has(optionName.toLowerCase())) {
        issues.push(`${where}: опція «${optionName}» указана двічі.`);
      }
      optionNames.add(optionName.toLowerCase());
    });
  });

  if (!variants.some((v) => v.visible)) {
    issues.push('Усі варіанти приховані — покупець не побачить жодного.');
  }

  return issues;
}

/** Порожня картка — зі значеннями з макета, щоб не вводити з нуля. */
export function blankFurnitureProduct(): FurnitureProduct {
  return {
    id: furnitureUid(),
    sku: '',
    name: '',
    category: FURNITURE_CATEGORIES[0],
    subcategory: FURNITURE_SUBCATEGORIES[0],
    priceUah: 0,
    basePriceUah: 0,
    discountSourceProcurementId: null,
    stock: null,
    leadTime: '2–4 дні (або індивідуальне виготовлення 5-7 днів)',
    activeInNexus: true,
    physical: true,
    teaser: '',
    description: '',
    functionalZones: [...DEFAULT_FUNCTIONAL_ZONES],
    material: FURNITURE_MATERIALS[0],
    finish: 'Епоксидна смола бурштинового спектра + масло-віск',
    dimensions: '30 × 40 × 7.5 см',
    warranty: '24 місяці офіційної гарантії',
    ledStrip: '3000K (Теплий вінтажний тон)',
    ledPower: '12V блок живлення (імпульсний)',
    ledControl: 'Сенсорний модуль / перемикач',
    electronicsEnabled: false,
    electronicsController: 'esp32',
    electronicsUserProgrammable: true,
    electronicsFunctions: [],
    media: [],
    woodTones: DEFAULT_WOOD_TONES.map((t) => ({ ...t })),
    availableColors: DEFAULT_COLORS.map((c) => ({ ...c })),
    variants: [],
    engraving: true,
    engravingPriceUah: 350,
    resinColor: true,
    phoneFit: true,
    status: 'draft',
    publishedAt: null,
    slug: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Межі полів, які перевіряє приймач мосту (`apps/api/src/bridge/bridge.dto.ts`
 * маркетплейсу). Тримаємо ТІ САМІ числа тут, щоб автор бачив межу в редакторі,
 * а не дізнавався про неї із сирої відмови HTTP 400 аж після публікації.
 *
 * Саме так і сталося 16.09.2026: тизер довший за 300 символів приймач відкинув
 * (`subtitle must be shorter than or equal to 300 characters`), а Студія цю
 * межу взагалі не показувала. Тизер іде у вітрину підзаголовком картки — він
 * за визначенням короткий (у макеті — ~125 символів).
 */
export const TITLE_MAX = 160;
export const TEASER_MAX = 300;
export const DESCRIPTION_MAX = 40000;

/**
 * Межі галереї картки — ті самі числа, що й на боці мосту й приймача
 * (`server/marketplaceBridge.ts`, marketplace `bridge.service.ts`), щоб
 * автор бачив ліміт у редакторі, а не дізнавався про відмову вже після
 * публікації. Власник ТЗ: «Дозволити завантажувати до 20 фотографій і
 * до 2 відео».
 */
export const MAX_GALLERY_PHOTOS = 20;
export const MAX_GALLERY_VIDEOS = 2;

/**
 * Чи картка заповнена настільки, щоб її можна було опублікувати.
 * Мінімум для вітрини: назва, артикул, ціна і хоча б одне фото.
 * Без обкладинки товар у каталозі показується порожнім прямокутником — те
 * саме правило, що й для книг (assertStorefrontCover у мості).
 *
 * Плюс межі довжини (див. константи вище): краще відмовити тут із причиною
 * українською, ніж віддати авторові англійський текст валідації приймача.
 */
export function furniturePublishIssues(p: FurnitureProduct): string[] {
  const issues: string[] = [];
  const photoCount = p.media.filter((m) => !isVideoMedia(m)).length;
  const videoCount = p.media.filter((m) => isVideoMedia(m)).length;
  if (!p.name.trim()) issues.push('Немає назви виробу.');
  if (!p.sku.trim()) issues.push('Немає артикула / SKU.');
  // Ціну перевіряємо З УРАХУВАННЯМ варіантів (#225): товар, у якого базова
  // ціна порожня, а всі ціни лежать у варіантах, — це нормальний випадок, і
  // відмовляти йому через порожнє `priceUah` було б несправделиво.
  const effectivePrice = effectivePriceUah(p);
  if (!(effectivePrice > 0)) {
    issues.push(
      (p.variants || []).length
        ? 'Немає жодної ціни: задайте ціну хоча б одному видимому варіанту.'
        : 'Ціна має бути більшою за нуль.'
    );
  }
  if (photoCount === 0) issues.push('Немає жодного фото — додайте головний банер.');
  if (photoCount > MAX_GALLERY_PHOTOS) {
    issues.push(`Забагато фото: ${photoCount} із дозволених ${MAX_GALLERY_PHOTOS}.`);
  }
  if (videoCount > MAX_GALLERY_VIDEOS) {
    issues.push(`Забагато відео: ${videoCount} із дозволених ${MAX_GALLERY_VIDEOS}.`);
  }
  if (p.electronicsEnabled && p.electronicsFunctions.length === 0) {
    issues.push('Електроніка увімкнена, але жодної функції не обрано.');
  }
  if (p.name.trim().length > TITLE_MAX) {
    issues.push(`Назва задовга: ${p.name.trim().length} із ${TITLE_MAX} символів.`);
  }
  if (p.teaser.trim().length > TEASER_MAX) {
    issues.push(
      `Тизер задовгий: ${p.teaser.trim().length} із ${TEASER_MAX} символів — це підзаголовок картки. ` +
        'Довший текст перенесіть у «Повний деталізований опис».'
    );
  }
  if (p.description.trim().length > DESCRIPTION_MAX) {
    issues.push(`Опис задовгий: ${p.description.trim().length} із ${DESCRIPTION_MAX} символів.`);
  }
  // Варіанти (#225): кожен — окремий артикул, і відмова тут означає, що
  // вітрина не знає, що саме продає.
  issues.push(...variantIssues(p));
  return issues;
}
