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

/** Один завантажений файл-ілюстрація картки (превʼю як data URL). */
export interface FurnitureMediaItem {
  id: string;
  /** Підпис: «Головний банер CAD / CNC», «Інтерʼєр 2» тощо. */
  label: string;
  /** Data URL превʼю — для чорнетки; повний файл береться при публікації. */
  src: string;
  /** Імʼя файла — для підпису й перевірки формату. */
  filename?: string;
  /** Ширина/висота в px, якщо відомі (для підпису, як у макеті). */
  width?: number;
  height?: number;
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
  stock: number;
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
  media: FurnitureMediaItem[];
  /** Палітра тонів дерева (з вітрини). */
  woodTones: FurnitureWoodTone[];
  /** Доступні тони та персоналізація. */
  availableColors: FurnitureColor[];
  engraving: boolean;
  engravingPriceUah: number;
  resinColor: boolean;
  phoneFit: boolean;
  status: FurnitureProductStatus;
  publishedAt?: string | null;
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
    stock: 0,
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
    media: [],
    woodTones: DEFAULT_WOOD_TONES.map((t) => ({ ...t })),
    availableColors: DEFAULT_COLORS.map((c) => ({ ...c })),
    engraving: true,
    engravingPriceUah: 350,
    resinColor: true,
    phoneFit: true,
    status: 'draft',
    publishedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Чи картка заповнена настільки, щоб її можна було опублікувати.
 * Мінімум для вітрини: назва, артикул, ціна і хоча б одне фото.
 * Без обкладинки товар у каталозі показується порожнім прямокутником — те
 * саме правило, що й для книг (assertStorefrontCover у мості).
 */
export function furniturePublishIssues(p: FurnitureProduct): string[] {
  const issues: string[] = [];
  if (!p.name.trim()) issues.push('Немає назви виробу.');
  if (!p.sku.trim()) issues.push('Немає артикула / SKU.');
  if (!(p.priceUah > 0)) issues.push('Ціна має бути більшою за нуль.');
  if (p.media.length === 0) issues.push('Немає жодного фото — додайте головний банер.');
  return issues;
}
