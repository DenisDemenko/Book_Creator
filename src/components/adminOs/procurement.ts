/**
 * Закупівлі матеріалів — реальна економіка, з якої виводяться знижки.
 *
 * ЧОМУ ЦЕ ОКРЕМА СУТНІСТЬ. Знижки на товарах не повинні братись «зі стелі»:
 * власник попросив, щоб кожна знижка спиралась на конкретну закупівлю —
 * дешевшу деревину, епоксидку чи іншу сировину, знайдену як альтернативне
 * джерело постачання. Запис закупівлі фіксує стару й нову ціну за одиницю,
 * постачальника і те, ЗВІДКИ взялась дешевша ціна (посилання/нотатка —
 * пошук веде асистент на запит, живої інтеграції з пошуковим API немає).
 *
 * Від запису до товару: власник вручну обирає, на які картки виробів
 * поширити знижку (як і в калькуляторі — «Додати до ціни товару»). Запис
 * закупівлі зберігає історію застосувань (`appliedTo`) — так знижка на
 * товарі лишається простежуваною до конкретної закупівлі, а не висить
 * непоясненим числом.
 *
 * Сховище — той самий принцип, що й чорнетки виробів
 * (`server/furnitureProductRoutes.ts`): один ключ `meta` Студії з JSON-
 * масивом, бо записів закупівель мало і окрема таблиця була б зайвою.
 */

/** Одиниця виміру закупівлі — довільний текст із підказками, не жорсткий enum. */
export const PROCUREMENT_UNIT_HINTS: readonly string[] = ['м³', 'л', 'кг', 'шт', 'компл.'];

/** Категорія матеріалу — для фільтрів і швидкого вибору, теж не жорсткий enum. */
export const PROCUREMENT_MATERIAL_KIND_HINTS: readonly string[] = [
  'Деревина',
  'Епоксидна смола',
  'Фурнітура',
  'Електроніка (плати/датчики)',
  'ЛЕД-підсвітка',
  'Розхідні матеріали',
  'Інше',
];

/** Один запис застосування знижки цього запису закупівлі до товару. */
export interface ProcurementApplication {
  productId: string;
  /** Назва товару на момент застосування — щоб історія читалась і після перейменування/видалення картки. */
  productName: string;
  /** Ціна товару ДО застосування знижки, грн. */
  priceBeforeUah: number;
  /** Ціна товару ПІСЛЯ застосування знижки, грн. */
  priceAfterUah: number;
  /** Відсоток знижки, застосований цього разу (міг бути відредагований власником, не обов'язково = savingsPercent). */
  discountPercentApplied: number;
  appliedAt: string;
}

/** Запис закупівлі — джерело реальної економіки для знижок. */
export interface ProcurementRecord {
  id: string;
  /** Матеріал — вільний текст (напр. "Дуб масив" або "ArtResin епоксидна смола"), з підказками з PROCUREMENT_MATERIAL_KIND_HINTS. */
  material: string;
  supplier: string;
  unit: string;
  /** Стара ціна за одиницю, грн — те, за скільки закуповували раніше / ринкова ціна для порівняння. */
  oldPricePerUnitUah: number;
  /** Нова (дешевша) ціна за одиницю, грн — те, що вдалось знайти в альтернативного постачальника. */
  newPricePerUnitUah: number;
  /** Скільки одиниць закуплено — необов'язково, потрібно лише для підрахунку загальної суми економії. */
  quantity: number;
  purchaseDate: string;
  /** Звідки взялась дешевша ціна — посилання або опис постачальника (результат пошуку асистента на запит). */
  sourceNote: string;
  note: string;
  /** Історія застосувань знижки цього запису до товарів — для простежуваності. */
  appliedTo: ProcurementApplication[];
  createdAt: string;
  updatedAt: string;
}

export function procurementUid(): string {
  return `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Порожній запис закупівлі — з чистими значеннями, готовий до заповнення форми. */
export function blankProcurementRecord(): ProcurementRecord {
  const now = new Date().toISOString();
  return {
    id: procurementUid(),
    material: '',
    supplier: '',
    unit: PROCUREMENT_UNIT_HINTS[0],
    oldPricePerUnitUah: 0,
    newPricePerUnitUah: 0,
    quantity: 0,
    purchaseDate: now.slice(0, 10),
    sourceNote: '',
    note: '',
    appliedTo: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Економія за одиницю, грн — може бути відʼємною (нова ціна вища за стару), тоді знижки бути не може. */
export function procurementSavingsPerUnit(r: Pick<ProcurementRecord, 'oldPricePerUnitUah' | 'newPricePerUnitUah'>): number {
  return r.oldPricePerUnitUah - r.newPricePerUnitUah;
}

/**
 * Відсоток економії відносно старої ціни. `0`, якщо стара ціна не задана
 * (ділення на нуль) — краще чесний нуль, ніж NaN у інтерфейсі.
 */
export function procurementSavingsPercent(r: Pick<ProcurementRecord, 'oldPricePerUnitUah' | 'newPricePerUnitUah'>): number {
  if (!(r.oldPricePerUnitUah > 0)) return 0;
  const percent = (procurementSavingsPerUnit(r) / r.oldPricePerUnitUah) * 100;
  return Math.round(percent * 10) / 10;
}

/** Загальна сума економії за всю закупівлю (savings/одиницю × кількість), грн. `undefined`, якщо кількість не вказана. */
export function procurementTotalSavingsUah(r: ProcurementRecord): number | undefined {
  if (!(r.quantity > 0)) return undefined;
  return Math.round(procurementSavingsPerUnit(r) * r.quantity);
}

/** Мінімум для збереження запису — без цього форма не дає натиснути «Зберегти». */
export function procurementIssues(r: ProcurementRecord): string[] {
  const issues: string[] = [];
  if (!r.material?.trim()) issues.push('Не вказано матеріал.');
  if (!r.supplier?.trim()) issues.push('Не вказано постачальника.');
  if (!(r.oldPricePerUnitUah > 0)) issues.push('Стара ціна за одиницю має бути більшою за нуль.');
  if (!(r.newPricePerUnitUah > 0)) issues.push('Нова ціна за одиницю має бути більшою за нуль.');
  if (r.oldPricePerUnitUah > 0 && r.newPricePerUnitUah > 0 && r.newPricePerUnitUah >= r.oldPricePerUnitUah) {
    issues.push('Нова ціна не дешевша за стару — знижку з такого запису застосувати не вийде.');
  }
  return issues;
}
